import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { EffectCounts, JbLedger, JbSearch, JbSession, JbTurn, JbView, SearchEffects, SearchTrail } from '../types'
import {
  EMPTY_LEDGER,
  ZERO_COUNTS,
  addCounts,
  addToDay,
  classifyCall,
  describeEffects,
  describeTrail,
  describeTurnEffects,
  diffBadges,
  isZero,
  localPathsInRepo,
  parseLocalOutcome,
  parseSearchOutput,
  reduce,
  shellRead,
  toRepoPath,
  trailOf,
} from './effects'
import type { CallRole, LedgerEvent, StoredEffects, UseDetail } from './effects'
import {
  ago,
  claudeProjectDir,
  describeIndex,
  describeSession,
  describeTurn,
  explorationKind,
  explorePrice,
  firstLine,
  formatDuration,
  formatShare,
  formatTokens,
  formatUsd,
  indexLabel,
  indexNote,
  isJbcontextSearch,
  isWholeLine,
  mergeDays,
  normalizeRepo,
  parseSessionPhases,
  parseSessionStatus,
  parseStatsDay,
  parseStatus,
  repoName,
  savedTokens,
  scopeToRepo,
  searchLabel,
  searchQuery,
  statusLine,
  tallyLines,
  touchesJbcontext,
  usageOf,
} from './model'
import type { DayEvents, JbcontextUsage, RepoEvents, SessionStatus, UsageTally } from './model'

const PANE = 'jbcontext'
const STATS_POLL_MS = 5_000
const STATUS_POLL_MS = 120_000
const STATS_DAYS = 7
const KEPT = 200
const MAX_SESSIONS_SCANNED = 40
const PRICE_KEY = 'explorePrice'
const PRICE_RETRY_MS = 60 * 60 * 1000
// How long the spinner says how a jbcontext call went.
const RESULT_SHOWN_MS = 4_000

const view = atom({ plugin: 'jbcontext-watch', key: 'view' } as const, null as JbView | null)
const turnState = atom({ plugin: 'jbcontext-watch', key: 'turn' } as const, null as JbTurn | null)
const isBandHidden = atom({ plugin: 'jbcontext-watch', key: 'isBandHidden' } as const, false)
// The effects' bookkeeping, never read while drawing so its writes redraw nothing; what
// the transcript's search rows and the band draw from it lives in the two after it.
const ledgerState = atom({ plugin: 'jbcontext-watch', key: 'ledger' } as const, null as JbLedger | null)
const badgesState = atom({ plugin: 'jbcontext-watch', key: 'badges' } as const, null as Record<string, SearchEffects> | null)
const countsState = atom(
  { plugin: 'jbcontext-watch', key: 'effectCounts' } as const,
  null as { session: EffectCounts; turn: EffectCounts } | null,
)
// How each search delivered, for its row's expanded view, and this turn's delivering
// searches in order, for the band's list; the band stays until the next prompt.
const trailsState = atom({ plugin: 'jbcontext-watch', key: 'trails' } as const, null as Record<string, SearchTrail> | null)
const deliveriesState = atom({ plugin: 'jbcontext-watch', key: 'deliveries' } as const, null as string[] | null)
const EFFECTS_KEY = 'effects:'
const MAX_TRAILS = 200
// Rows of a page of the band's list, each a click to its search; ‹ prev and next › turn pages.
const DELIVERIES_PER_PAGE = 3
// The keys that turn its pages from the prompt, no focus needed: the engine actions bound to
// alt+↑ / alt+↓ (⌥ on Mac) and ctrl+↑ / ctrl+↓ (taken by macOS for Mission Control), which
// only the diff panel handles; elsewhere a Button naming them takes the chord.
const PAGE_PREV_ACTION = 'app:diffFileListUp'
const PAGE_NEXT_ACTION = 'app:diffFileListDown'
// The page of the band's list on screen, from 0; back to the first with each turn.
const deliveriesPage = atom({ plugin: 'jbcontext-watch', key: 'deliveriesPage' } as const, 0)
// What the band's list starts with once the turn ended.
const DELIVERED_HEADING = 'jbcontext delivered:'

const EMPTY_TURN: JbTurn = {
  explorations: 0,
  jbcontextCalls: 0,
  jbcontextHits: 0,
  searching: null,
  result: null,
}

const EMPTY: JbView = {
  searches: [],
  errors: [],
  otherSearches: 0,
  otherErrors: 0,
  index: null,
  storage: 'remote',
  repositoryId: null,
  repoKey: null,
  indexingSince: null,
  savings: null,
  session: null,
  updatedAt: 0,
}

let appHome = ''
let claudeHome = ''
let tempHome = ''
let cwd = ''
let repoRoot = ''
// The order calls start and finish in, so a read issued beside a search is not taken
// for a use of its hits; carried on from the ledger after a reload.
let seq = 0
// Calls are recorded one after another, in the order they finished.
let recording: Promise<void> = Promise.resolve()
let isInteractive = false
let statsStamp = ''
// Every repository's searches and errors from the stats files, scoped to this one
// whenever it or the repository changes.
let statsEvents: DayEvents = { searches: [], errors: [] }
let statsRun: Promise<void> | null = null
let isStatsQueued = false
let shownStatus: string | undefined
const creditedSearches = new Set<string>()
let isStatusRunning = false
let isSavingsRunning = false
let isPriceRunning = false
const sessionCache = new Map<string, { mtimeMs: number; status: SessionStatus | null }>()
// Each transcript's jbcontext usage so far, read up to `offset`; `rest` is the start of a
// line whose end has not been read yet. `reading` keeps a transcript's reads in order.
const transcriptTallies = new Map<string, { offset: number; rest: string; tally: UsageTally; reading: Promise<unknown> }>()
// The most one `$.fs.read` may answer.
const READ_LIMIT = 4 * 1024 * 1024
// Background measurements run one at a time; asking during one queues one more.
let refreshing: Promise<void> | null = null
let isRefreshQueued = false
// Measurements are numbered as they start, so one that ends after a later one does not
// overwrite its figures.
let measureSeq = 0
let patchedSeq = 0

async function patch($: EngineInterface, fn: (current: JbView) => Partial<JbView>) {
  const written = await update($, view, current => {
    const base = current ?? EMPTY
    return { ...base, ...fn(base) }
  })
  const line = written ? statusLine(written) : undefined
  if (line !== shownStatus) {
    shownStatus = line
    $.ui.status(line)
  }
  return written
}

function patchTurn($: EngineInterface, fn: (current: JbTurn) => Partial<JbTurn>) {
  return update($, turnState, current => {
    const base = current ?? EMPTY_TURN
    return { ...base, ...fn(base) }
  })
}

function inRepo(repoKey: string | null): RepoEvents {
  return scopeToRepo(statsEvents, repoKey, cwd, KEPT)
}

// The engine's record, which outlives a reload of this module.
async function isPaneOpen($: EngineInterface): Promise<boolean> {
  return (await $.ui.panes()).some(pane => pane.id === PANE)
}

async function jbcontextBinary($: EngineInterface): Promise<string> {
  const bundled = `${appHome}/bin/jbcontext`
  return (await $.fs.exists(bundled)) ? bundled : 'jbcontext'
}

// A call made while a read runs gets another read after it, so whoever awaits this sees
// the files as they stood when it asked.
function refreshStats($: EngineInterface): Promise<void> {
  if (statsRun !== null) {
    isStatsQueued = true
    return statsRun
  }
  statsRun = (async () => {
    try {
      do {
        isStatsQueued = false
        await readStats($)
      } while (isStatsQueued)
    } finally {
      statsRun = null
    }
  })()
  return statsRun
}

async function readStats($: EngineInterface) {
  const dir = `${appHome}/stats`
  let entries
  try {
    entries = await $.fs.list(dir)
  } catch {
    return
  }
  const days = entries
    .filter(entry => entry.kind === 'file' && /^\d{4}-\d{2}-\d{2}\.json$/.test(entry.name))
    .sort((a, b) => b.name.localeCompare(a.name))
    .slice(0, STATS_DAYS)
  const stamp = days.map(day => `${day.name}:${day.mtimeMs}:${day.size}`).join('|')
  if (stamp === statsStamp) return
  statsStamp = stamp

  const parsed = await Promise.all(
    days.map(async day => parseStatsDay(await $.fs.read(`${dir}/${day.name}`).catch(() => ''))),
  )
  statsEvents = mergeDays(parsed)
  const now = await $.clock.now()
  await patch($, current => ({ ...inRepo(current.repoKey), updatedAt: now }))
}

async function refreshStatus($: EngineInterface) {
  if (isStatusRunning) return
  isStatusRunning = true
  try {
    const git = (args: string[]) => $.process.run(['git', ...args], { cwd, timeoutMs: 5_000 })
    const [head, branch, origin, toplevel] = await Promise.all([
      git(['rev-parse', 'HEAD']),
      git(['rev-parse', '--abbrev-ref', 'HEAD']),
      git(['remote', 'get-url', 'origin']),
      git(['rev-parse', '--show-toplevel']),
    ])
    if (toplevel?.exitCode === 0 && toplevel.stdout.trim() !== '') repoRoot = toplevel.stdout.trim()
    if (head.exitCode !== 0) {
      await patch($, () => ({ index: { state: 'unavailable', reason: 'not a git repository' } }))
      return
    }
    const originKey = origin.exitCode === 0 ? normalizeRepo(origin.stdout) : null
    await patch($, current => {
      const repoKey = current.repoKey ?? originKey
      return { repoKey, ...inRepo(repoKey) }
    })

    const status = await $.process.run([await jbcontextBinary($), 'status', '--json-output'], {
      cwd,
      timeoutMs: 30_000,
    })
    const summary =
      status.exitCode === 0
        ? parseStatus(status.stdout, head.stdout.trim(), branch.stdout.trim())
        : {
            repositoryId: null,
            index: {
              state: 'unavailable' as const,
              reason: statusFailure(status.stdout, status.stderr, status.exitCode),
            },
          }
    const repoKey = summary.repositoryId ? normalizeRepo(summary.repositoryId) : originKey
    await patch($, () => ({ ...summary, repoKey, ...inRepo(repoKey) }))
  } catch (error) {
    await patch($, () => ({
      index: { state: 'unavailable', reason: `jbcontext status failed: ${String(error)}` },
    }))
  } finally {
    isStatusRunning = false
  }
}

function localDay(now: number): { key: string; startMs: number } {
  const start = new Date(now)
  start.setHours(0, 0, 0, 0)
  const key = `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}-${String(start.getDate()).padStart(2, '0')}`
  return { key, startMs: start.getTime() }
}

// `jbcontext analyze` has no repository or date filter, and a full run reads every
// session on the machine (~20 s), so its Exploring price is taken once a day; a run
// that failed, timed out or found no price is tried again after an hour.
async function refreshPrice($: EngineInterface, day: string, now: number) {
  const cached = (await $.store.get(PRICE_KEY)) as
    | { day: string; usdPerToken: number | null; checkedAt?: number }
    | undefined
  if (cached?.day === day && (cached.usdPerToken !== null || now - (cached.checkedAt ?? 0) < PRICE_RETRY_MS)) {
    await patch($, current => ({
      savings: current.savings ? { ...current.savings, usdPerToken: cached.usdPerToken } : current.savings,
    }))
    return cached.usdPerToken
  }
  if (isPriceRunning) return null
  isPriceRunning = true
  try {
    const analyze = await $.process
      .run([await jbcontextBinary($), 'analyze', '--json-output'], { cwd, timeoutMs: 180_000 })
      .catch(() => null)
    const usdPerToken = analyze?.exitCode === 0 ? explorePrice(analyze.stdout) : null
    await $.store.set(PRICE_KEY, { day, usdPerToken, checkedAt: now })
    await patch($, current => ({
      savings: current.savings ? { ...current.savings, usdPerToken } : current.savings,
    }))
    return usdPerToken
  } catch {
    return null
  } finally {
    isPriceRunning = false
  }
}

async function refreshSavings($: EngineInterface) {
  if (isSavingsRunning || claudeHome === '') return
  isSavingsRunning = true
  try {
    const now = await $.clock.now()
    const today = localDay(now)
    const ownDir = claudeProjectDir(cwd)
    const projects = await $.fs.list(`${claudeHome}/projects`).catch(() => [])
    // The session's own folder and those of directories inside it (`.claude/worktrees/x`
    // encodes as `<dir>--claude-worktrees-x`).
    const dirs = projects
      .filter(entry => entry.kind === 'dir' && (entry.name === ownDir || entry.name.startsWith(`${ownDir}--`)))
      .map(entry => `${claudeHome}/projects/${entry.name}`)

    const transcripts = (
      await Promise.all(
        dirs.map(async dir =>
          (await $.fs.list(dir).catch(() => []))
            .filter(entry => entry.kind === 'file' && entry.name.endsWith('.jsonl') && entry.mtimeMs >= today.startMs)
            .map(entry => ({ path: `${dir}/${entry.name}`, mtimeMs: entry.mtimeMs })),
        ),
      )
    )
      .flat()
      .sort((a, b) => b.mtimeMs - a.mtimeMs)
      .slice(0, MAX_SESSIONS_SCANNED)

    const binary = await jbcontextBinary($)
    const statuses: SessionStatus[] = []
    for (const transcript of transcripts) {
      let cached = sessionCache.get(transcript.path)
      if (cached?.mtimeMs !== transcript.mtimeMs) {
        const run = await $.process
          .run([binary, 'analyze', '--status', '--transcript', transcript.path, '--json-output'], {
            cwd,
            timeoutMs: 30_000,
          })
          .catch(() => null)
        cached = { mtimeMs: transcript.mtimeMs, status: run ? parseSessionStatus(run.stdout) : null }
        sessionCache.set(transcript.path, cached)
      }
      if (cached.status) statuses.push(cached.status)
    }

    const previous = (await read($, view))?.savings?.usdPerToken ?? null
    await patch($, () => ({
      savings: {
        sessions: statuses.length,
        measuredSessions: statuses.filter(status => status.reductionPct !== null).length,
        exploreTokens: statuses.reduce((sum, status) => sum + status.exploreTokens, 0),
        savedTokens: statuses.reduce((sum, status) => sum + savedTokens(status), 0),
        usdPerToken: previous,
      },
    }))
    if (statuses.length > 0) void refreshPrice($, today.key, now)
  } finally {
    isSavingsRunning = false
  }
}

// Savings show only in the pane, and scanning them runs `jbcontext analyze` for each
// changed transcript, so a closed pane skips it.
async function refreshSavingsIfShown($: EngineInterface) {
  if (await isPaneOpen($)) await refreshSavings($)
}

// A transcript only grows, so it is read on from where the last read of it stopped, in
// ranges a read may answer (a long session's runs to tens of MB), its lines tallied once
// whole. A range that cuts a character reads it as U+FFFD, harmless inside a JSON string.
// A read that fails leaves the tally where it was, to go on from next time.
function transcriptUsage($: EngineInterface, path: string, size: number): Promise<JbcontextUsage> {
  let known = transcriptTallies.get(path)
  if (known === undefined) {
    known = { offset: 0, rest: '', tally: new Map(), reading: Promise.resolve() }
    transcriptTallies.set(path, known)
  }
  const one = known
  const run = one.reading.catch(() => undefined).then(async () => {
    let upTo = size
    try {
      // A size taken before a later read went further only looks shorter: the file's own
      // says whether it was rewritten, and then it is read again from the start.
      if (upTo < one.offset) {
        upTo = (await $.fs.stat(path)).size
        if (upTo < one.offset) Object.assign(one, { offset: 0, rest: '', tally: new Map() })
      }
      while (one.offset < upTo) {
        const length = Math.min(READ_LIMIT, upTo - one.offset)
        const text = one.rest + (await $.fs.read(path, { offset: one.offset, length }))
        one.offset += length
        const end = text.lastIndexOf('\n') + 1
        tallyLines(one.tally, text.slice(0, end))
        one.rest = text.slice(end)
      }
      if (one.rest !== '' && isWholeLine(one.rest)) {
        tallyLines(one.tally, one.rest)
        one.rest = ''
      }
    } catch {
      // Not readable now: what was read stands.
    }
    return usageOf(one.tally)
  })
  one.reading = run
  return run
}

type Transcript = { path: string; size: number }
type SessionTranscripts = { sessionId: string; transcripts: Transcript[] }

// This session's transcript and each of its subagents'.
async function sessionTranscripts($: EngineInterface): Promise<SessionTranscripts | null> {
  if (claudeHome === '') return null
  const sessionId = await $.session.id()
  const projectDir = `${claudeHome}/projects/${claudeProjectDir(cwd)}`
  const main = `${projectDir}/${sessionId}.jsonl`
  const mainStat = await $.fs.stat(main).catch(() => null)
  if (mainStat?.kind !== 'file') return null
  const subagentDir = `${projectDir}/${sessionId}/subagents`
  const transcripts = [
    { path: main, size: mainStat.size },
    ...(await $.fs.list(subagentDir).catch(() => []))
      .filter(entry => entry.kind === 'file' && entry.name.endsWith('.jsonl'))
      .map(entry => ({ path: `${subagentDir}/${entry.name}`, size: entry.size })),
  ]
  return { sessionId, transcripts }
}

async function sessionUsage($: EngineInterface, transcripts: Transcript[]): Promise<JbcontextUsage> {
  const usages = await Promise.all(transcripts.map(one => transcriptUsage($, one.path, one.size)))
  return {
    calls: usages.reduce((sum, usage) => sum + usage.calls, 0),
    tokens: usages.reduce((sum, usage) => sum + usage.tokens, 0),
  }
}

// `jbcontext analyze` reads a projects folder, so the session's transcript and each of
// its subagents' are linked into one of their own, the subagents as sessions beside it:
// the CLI counts a subagent's tokens only in a transcript of its own.
async function measureSession($: EngineInterface, given?: SessionTranscripts): Promise<JbSession | null> {
  const seq = ++measureSeq
  const found = given ?? (await sessionTranscripts($))
  if (found === null) return null
  const { sessionId, transcripts } = found

  const linkRoot = `${tempHome}/jbcontext-watch/${sessionId}`
  const links = `${linkRoot}/session`
  const made = await $.process.run(['mkdir', '-p', links], { timeoutMs: 5_000 })
  if (made.exitCode !== 0) return null
  const linked = await $.process.run(['ln', '-sf', ...transcripts.map(one => one.path), `${links}/`], {
    timeoutMs: 5_000,
  })
  if (linked.exitCode !== 0) return null
  const analyze = await $.process.run(
    [await jbcontextBinary($), 'analyze', '--projects-dir', linkRoot, '--agent', 'claude', '--min-tool-calls', '0', '--json-output'],
    { cwd, timeoutMs: 20_000 },
  )
  const phases = analyze.exitCode === 0 ? parseSessionPhases(analyze.stdout) : null
  if (phases === null) return null

  const usage = await sessionUsage($, transcripts)
  const session: JbSession = { sessionId, ...phases, jbcontextCalls: usage.calls, jbcontextTokens: usage.tokens }
  // Written only while it is still this session's (not after a /clear or /resume), and
  // when no later measurement has written meanwhile.
  const isCurrent = sessionId === (await $.session.id())
  if (isCurrent && seq > patchedSeq) {
    patchedSeq = seq
    await patch($, () => ({ session }))
  }
  return session
}

// For the pane and the status line, in the background: one measurement at a time, and a
// call during one gets another after it, so the figures catch up with the transcripts.
function refreshSession($: EngineInterface): void {
  if (refreshing !== null) {
    isRefreshQueued = true
    return
  }
  refreshing = (async () => {
    try {
      do {
        isRefreshQueued = false
        await measureSession($).catch(() => null)
      } while (isRefreshQueued)
    } finally {
      refreshing = null
    }
  })()
}

// At the end of a turn: one of its own, never one already running, which may have read
// the transcripts before the turn's calls; and waiting on it would spend the hook's
// budget, which stops only for the hook's own `$` calls.
function measureSessionFresh($: EngineInterface, found: SessionTranscripts): Promise<JbSession | null> {
  return measureSession($, found).catch(() => null)
}

function searchKey(search: JbSearch): string {
  return `${search.at}|${search.query}`
}

// How a jbcontext call went, from the search event the CLI or MCP server writes to the
// stats files: read again a second later when it is not there yet.
async function finishSearch($: EngineInterface, startedAt: number, isError: boolean, isRetry = false) {
  await refreshStats($)
  // Any repository's: an org-wide search names another. One credited to a call is not
  // credited again to a call beside it.
  const search = statsEvents.searches.find(one => one.at >= startedAt - 2_000 && !creditedSearches.has(searchKey(one)))
  if (search !== undefined) creditedSearches.add(searchKey(search))
  if (search === undefined && !isError && !isRetry) {
    $.clock.after(1_000, () => void finishSearch($, startedAt, isError, true))
    return
  }
  const now = await $.clock.now()
  const seconds = (((search?.durationMs ?? null) ?? now - startedAt) / 1000).toFixed(1)
  const text =
    isError || search?.success === false
      ? 'jbcontext search failed'
      : search?.results != null
        ? `jbcontext: ${search.results} hit${search.results === 1 ? '' : 's'} in ${seconds}s`
        : `jbcontext: done in ${seconds}s`
  await patchTurn($, turn => ({
    jbcontextHits: turn.jbcontextHits + (search?.results ?? 0),
    result: { text, until: now + RESULT_SHOWN_MS },
  }))
  // Redraws the spinner once the outcome is due to go.
  $.clock.after(RESULT_SHOWN_MS + 100, () => $.ui.invalidate('ui.render'))
}

// ---------- effects ----------

type CallOutcome = { deny?: string; result?: unknown; text?: string; isError?: boolean }

function root(): string {
  return repoRoot || cwd
}

function readDetail(e: Record<string, unknown>, result: unknown): { path: string; detail: UseDetail } | null {
  if (e.tool === 'Bash') {
    const read = shellRead(String(e.command ?? ''))
    return read ? { path: read.path, detail: { kind: 'read', start: read.start, end: read.end, isPartial: read.isPartial } } : null
  }
  const path = typeof e.file_path === 'string' ? e.file_path : typeof e.notebook_path === 'string' ? e.notebook_path : null
  if (path === null) return null
  const file = (result as { file?: { startLine?: unknown; numLines?: unknown; totalLines?: unknown } } | undefined)?.file
  if (file && typeof file.startLine === 'number' && typeof file.numLines === 'number') {
    const total = typeof file.totalLines === 'number' ? file.totalLines : file.numLines
    const start = file.startLine
    return {
      path,
      detail: { kind: 'read', start, end: start + Math.max(file.numLines, 1) - 1, isPartial: start > 1 || file.numLines < total },
    }
  }
  const offset = typeof e.offset === 'number' ? e.offset : null
  const limit = typeof e.limit === 'number' ? e.limit : null
  const start = offset ?? 1
  return {
    path,
    detail: { kind: 'read', start, end: start + (limit ?? Number.MAX_SAFE_INTEGER - start) - 1, isPartial: offset !== null || limit !== null },
  }
}

function editDetail(e: Record<string, unknown>, result: unknown): { path: string; detail: UseDetail } | null {
  const path = typeof e.file_path === 'string' ? e.file_path : typeof e.notebook_path === 'string' ? e.notebook_path : null
  if (path === null) return null
  const record = (result ?? {}) as { structuredPatch?: unknown; originalFile?: unknown }
  const olds = [
    typeof e.old_string === 'string' ? e.old_string : null,
    ...(Array.isArray(e.edits) ? e.edits.map(edit => (typeof edit?.old_string === 'string' ? edit.old_string : null)) : []),
  ].filter((one): one is string => one !== null && one.length > 0)
  let hunks = (Array.isArray(record.structuredPatch) ? record.structuredPatch : [])
    .filter(hunk => typeof hunk?.oldStart === 'number')
    .map(hunk => ({ start: hunk.oldStart, end: hunk.oldStart + Math.max(Number(hunk.oldLines) || 1, 1) - 1 }))
  if (hunks.length === 0 && typeof record.originalFile === 'string') {
    const original = record.originalFile
    hunks = olds.flatMap(old => {
      const at = original.indexOf(old)
      if (at < 0) return []
      const start = original.slice(0, at).split('\n').length
      return [{ start, end: start + old.split('\n').length - 1 }]
    })
  }
  return { path, detail: { kind: 'edit', hunks, oldLines: olds.flatMap(old => old.split('\n')) } }
}

// A local search as the trail names it: the shell command, or the tool and its pattern.
function localLabel(tool: string, e: Record<string, unknown>): string {
  if (typeof e.command === 'string') return e.command
  const parts = [tool, e.pattern, e.path].filter((one): one is string => typeof one === 'string' && one.length > 0)
  return parts.join(' ')
}

// Turns a finished call into a ledger event, or null when it says nothing about the effects.
function effectEvent(role: CallRole, e: Record<string, unknown>, outcome: CallOutcome, startSeq: number, doneSeq: number, repoKey: string | null): LedgerEvent | null {
  if ('deny' in outcome && outcome.deny !== undefined) return null
  const loop = typeof e.agentId === 'string' ? e.agentId : 'main'
  const text = typeof outcome.text === 'string' ? outcome.text : ''
  const tool = String(e.tool)
  if (role === 'local') {
    // A shell search's own output, not the text the model reads, which stands a
    // placeholder in for none.
    const stdout = (outcome.result as { stdout?: unknown } | undefined)?.stdout
    const output = tool === 'Bash' && outcome.isError !== true && typeof stdout === 'string' ? stdout : text
    const local = parseLocalOutcome(tool, e, output, outcome.isError === true)
    const command = typeof e.command === 'string' ? e.command : null
    return {
      type: 'local',
      loop,
      seq: doneSeq,
      outcome: local.outcome,
      paths: localPathsInRepo(local.paths, command, root()),
      patterns: local.patterns,
      id: typeof e.tool_use_id === 'string' ? e.tool_use_id : null,
      label: localLabel(tool, e),
    }
  }
  if (outcome.isError === true) return null
  if (role === 'search') {
    const parsed = parseSearchOutput(text)
    if (parsed === null || typeof e.tool_use_id !== 'string') return null
    return { type: 'search', id: e.tool_use_id, loop, doneSeq, query: searchQuery(tool, e) ?? '', hits: parsed.hits, repoKey }
  }
  const use = role === 'read' ? readDetail(e, outcome.result) : editDetail(e, outcome.result)
  if (use === null) return null
  const path = toRepoPath(use.path, root())
  if (path === null) return null
  const tool_ = tool === 'Bash' ? (String(e.command ?? '').trim().split(/\s+/)[0] ?? 'Bash') : tool
  return { type: 'use', path, startSeq, doneSeq, detail: use.detail, id: typeof e.tool_use_id === 'string' ? e.tool_use_id : null, tool: tool_ }
}

async function recordEffect($: EngineInterface, role: CallRole, e: Record<string, unknown>, outcome: CallOutcome, startSeq: number, doneSeq: number) {
  try {
    const current = await read($, view)
    const repoKey = current?.repoKey ?? null
    const event = effectEvent(role, e, outcome, startSeq, doneSeq, repoKey)
    if (event === null) return
    let changed: string[] = []
    let searched = false
    const ledger = await update($, ledgerState, value => {
      const result = reduce(value ?? EMPTY_LEDGER, event)
      changed = result.changed
      searched = event.type === 'search'
      return result.ledger
    })
    let delta: EffectCounts = { ...ZERO_COUNTS, searches: searched ? 1 : 0 }
    if (changed.length > 0 && ledger) {
      let found = ZERO_COUNTS
      const badges = await update($, badgesState, value => {
        const result = diffBadges(value ?? {}, ledger, changed)
        found = result.delta
        return result.badges
      })
      delta = addCounts(delta, found)
      await recordTrails($, ledger, badges ?? {}, changed)
    }
    if (isZero(delta)) return
    await update($, countsState, value => ({
      session: addCounts(value?.session ?? ZERO_COUNTS, delta),
      turn: addCounts(value?.turn ?? ZERO_COUNTS, delta),
    }))
    void bumpStore($, repoKey ?? root(), delta)
  } catch {
    // The effects are a view: a call they cannot read leaves them as they were.
  }
}

// The changed searches' trails, and this turn's ones that delivered something added to
// the band's list.
async function recordTrails($: EngineInterface, ledger: JbLedger, badges: Record<string, SearchEffects>, changed: string[]) {
  const searches = ledger.searches.filter(one => changed.includes(one.id))
  if (searches.length === 0) return
  await update($, trailsState, value => {
    const next = { ...(value ?? {}) }
    for (const search of searches) {
      delete next[search.id]
      next[search.id] = trailOf(search)
    }
    const ids = Object.keys(next)
    for (const id of ids.slice(0, Math.max(0, ids.length - MAX_TRAILS))) delete next[id]
    return next
  })
  const delivering = searches
    .filter(one => one.turn === ledger.turn && badges[one.id] && describeEffects(badges[one.id]!) !== null)
    .map(one => one.id)
  if (delivering.length === 0) return
  await update($, deliveriesState, value => {
    const list = value ?? []
    const fresh = delivering.filter(id => !list.includes(id))
    return fresh.length === 0 ? list : [...list, ...fresh]
  })
}

const TRAIL_COLOR = { miss: 'error', near: 'warning', search: 'claude', use: 'success', meaning: 'suggestion' } as const

function clipQuery(query: string): string {
  return query.length > 48 ? `${query.slice(0, 47)}…` : query
}

// Brings a search's row into view: a press is the person's own input, the only time a
// transcript row may be scrolled to.
async function jumpTo($: EngineInterface, id: string) {
  try {
    const moved = await $.ui.scroll({ to: { requestId: id }, block: 'center' })
    if ('deny' in moved && moved.deny) $.ui.toast(`Couldn't scroll to that search (${moved.deny}); ctrl+o lists it with how it delivered.`)
  } catch {
    $.ui.toast("Couldn't scroll to that search; ctrl+o lists it with how it delivered.")
  }
}

async function bumpStore($: EngineInterface, repo: string, delta: EffectCounts) {
  if (repo === '') return
  try {
    const key = `${EFFECTS_KEY}${repo}`
    const stored = (await $.store.get(key)) as StoredEffects | undefined
    await $.store.set(key, addToDay(stored, localDay(await $.clock.now()).key, delta))
  } catch {
    // Daily totals are best effort.
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    cwd = e.cwd
    isInteractive = e.isInteractive
    const home = (await $.env.get('HOME')) ?? ''
    const explicit = await $.env.get('JBCONTEXT_HOME')
    appHome = explicit && explicit.length > 0 ? explicit : `${home}/.jbcontext`
    const claudeConfig = await $.env.get('CLAUDE_CONFIG_DIR')
    claudeHome = claudeConfig && claudeConfig.length > 0 ? claudeConfig : `${home}/.claude`
    tempHome = ((await $.env.get('TMPDIR')) || '/tmp').replace(/\/+$/, '')
    seq = Math.max(seq, (await read($, ledgerState))?.seq ?? 0)

    await $.command.register({
      name: 'jbcontext',
      description: 'Show jbcontext searches, errors, index status, this session’s exploration and today’s savings for this repo (run again or `/jbcontext close` to hide; `/jbcontext band` toggles the band)',
      argumentHint: '[close|band]',
    })

    void refreshStats($)
    void refreshStatus($)
    void refreshSavingsIfShown($)
    $.clock.every(STATS_POLL_MS, () => {
      void refreshStats($)
      // The "ago" times and the indexing clock move with no state write to redraw them.
      $.ui.invalidate('ui.render')
    })
    $.clock.every(STATUS_POLL_MS, () => {
      void refreshStatus($)
      void refreshSavingsIfShown($)
    })

    return started
  })

  on('command.run', { command: 'jbcontext' }, async ($, e) => {
    if (e.args.trim() === 'band') {
      const hidden = await update($, isBandHidden, value => !value)
      return { text: hidden ? 'jbcontext band hidden.' : 'jbcontext band shown while Claude works.' }
    }
    if (e.args.trim() === 'close' || (await isPaneOpen($))) {
      await $.ui.close({ id: PANE })
      return { text: 'jbcontext pane closed.' }
    }
    void refreshStatus($)
    void refreshSavings($)
    refreshSession($)
    await $.ui.open({ id: PANE, title: 'jbcontext' })
    return { text: 'jbcontext pane opened.' }
  })

  // A subagent's turn runs inside the main one, whose counts go on through it.
  on('turn.start', async ($, e, next) => {
    if (e.agentId !== undefined) return next(e)
    await update($, turnState, () => EMPTY_TURN)
    await update($, ledgerState, value => reduce(value ?? EMPTY_LEDGER, { type: 'turn' }).ledger)
    await update($, countsState, value => ({ session: value?.session ?? ZERO_COUNTS, turn: ZERO_COUNTS }))
    await update($, deliveriesState, () => [])
    await update($, deliveriesPage, () => 0)
    return next(e)
  })

  // Counts the turn's exploration, each call once it ended (a refused one never reached
  // jbcontext; one that threw is reported as failed), says in the spinner what jbcontext
  // is searching for, and marks a `jbcontext index` run while it lasts.
  on('tool.call', async ($, e, next) => {
    const kind = explorationKind(e.tool, e)
    const touch = e.tool === 'Bash' ? touchesJbcontext(e.command) : kind === 'jbcontext' ? 'other' : null
    const role = classifyCall(e.tool, e)
    if (kind === null && touch === null && role === null) return next(e)

    const startSeq = ++seq
    const startedAt = await $.clock.now()
    const label = kind === 'jbcontext' ? searchLabel(e.tool, e) : null
    if (label !== null) await patchTurn($, () => ({ searching: label }))
    if (touch === 'index') await patch($, () => ({ indexingSince: startedAt }))
    let isRefused = false
    let isError = true
    let outcome: CallOutcome | undefined
    try {
      const result = await next(e)
      outcome = result as CallOutcome
      isRefused = result.deny !== undefined
      isError = isRefused || result.isError === true
      return result
    } finally {
      if (role !== null && outcome !== undefined && !isRefused) {
        const doneSeq = ++seq
        const call = e as unknown as Record<string, unknown>
        const done = outcome
        recording = recording.then(() => recordEffect($, role, call, done, startSeq, doneSeq))
      }
      if (kind !== null && !isRefused) {
        await patchTurn($, turn => ({
          explorations: turn.explorations + 1,
          jbcontextCalls: turn.jbcontextCalls + (kind === 'jbcontext' ? 1 : 0),
        }))
      }
      if (label !== null) {
        await patchTurn($, turn => ({ searching: turn.searching === label ? null : turn.searching }))
        if (!isRefused) void finishSearch($, startedAt, isError)
      }
      if (touch === 'index') await patch($, () => ({ indexingSince: null }))
      if (touch !== null && label === null) void refreshStats($)
      if (touch === 'index') void refreshStatus($)
    }
  })

  // Beneath an answer whose turn called jbcontext (its subagents included), the session's
  // jbcontext share so far; once the session ends, the last of these lines stands as its
  // summary.
  on('turn.complete', async ($, e, next) => {
    void refreshStats($)
    const result = await next(e)
    if (!isInteractive || e.agentId !== undefined || result.text !== e.answer) return result
    // The transcripts are cheap to read and `jbcontext analyze` is not: a session that has
    // not called jbcontext shows no figures, so it is measured only for an open pane.
    const found = await sessionTranscripts($).catch(() => null)
    if (found === null) return result
    if ((await sessionUsage($, found.transcripts)).calls === 0) {
      if (await isPaneOpen($)) refreshSession($)
      return result
    }
    // A turn without a jbcontext call adds no line; the status line's share is kept
    // current without holding the turn's end.
    if (((await read($, turnState))?.jbcontextCalls ?? 0) === 0) {
      refreshSession($)
      return result
    }
    const session = await measureSessionFresh($, found)
    if (session === null || session.exploreTokens === 0 || session.jbcontextCalls === 0) return result
    return { ...result, text: describeSession(session) }
  })

  // Another session takes this one's place: its figures go with it, and no measurement
  // started before the end, while the session's id may still be the old one's, writes.
  on('session.end', async ($, e, next) => {
    const isReplaced = e.reason === 'clear' || e.reason === 'resume'
    const forget = async () => {
      patchedSeq = measureSeq
      await update($, countsState, () => ({ session: ZERO_COUNTS, turn: ZERO_COUNTS }))
      await update($, deliveriesState, () => [])
    await update($, deliveriesPage, () => 0)
      return patch($, () => ({ session: null }))
    }
    if (isReplaced) await forget()
    const ended = await next(e)
    if (isReplaced) await forget()
    return ended
  })

  // While Claude works: the turn's exploration once it called jbcontext, an index search
  // cannot use, a fresh error, and one line totalling what the turn's searches delivered.
  // Once the turn ended the band stays until the next prompt, the totals giving way to
  // the list: a row per search that delivered, which jumps to it.
  // Nothing when there is nothing of these to say.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey || (await read($, isBandHidden))) return next(e)
    const deliveries = (await read($, deliveriesState)) ?? []
    if (!e.props.isWorking && deliveries.length === 0) return next(e)
    const current = await read($, view)
    if (current === null) return next(e)
    const turn = (await read($, turnState)) ?? EMPTY_TURN

    const now = await $.clock.now()
    const error = current.errors[0]
    const isFreshError = error !== undefined && now - error.at < 60 * 60 * 1000
    const isIndexing = current.indexingSince !== null
    const isTurnShown = turn.jbcontextCalls > 0
    // Only what stops search: whichever snapshot answers is the pane's to say.
    const isIndexShown =
      !isIndexing &&
      (current.index?.state === 'none' ||
        (current.index?.state === 'unavailable' && current.index.reason !== 'not a git repository'))
    const effectsLine = describeTurnEffects((await read($, countsState))?.turn ?? ZERO_COUNTS)
    if (!isIndexing && !isTurnShown && !isIndexShown && !isFreshError && effectsLine === null) return next(e)
    // The list waits for the turn's end: while Claude works the totals line says it all.
    const isListed = !e.props.isWorking && deliveries.length > 0
    const badges = isListed ? ((await read($, badgesState)) ?? {}) : {}
    const trails = isListed ? ((await read($, trailsState)) ?? {}) : {}
    const listed = isListed ? deliveries.filter(id => badges[id] !== undefined) : []
    const pages = Math.max(1, Math.ceil(listed.length / DELIVERIES_PER_PAGE))
    const page = Math.min(isListed ? await read($, deliveriesPage) : 0, pages - 1)
    const first = page * DELIVERIES_PER_PAGE
    const shown = listed.slice(first, first + DELIVERIES_PER_PAGE)
    const turnPage = (by: number) => void update($, deliveriesPage, value => Math.max(0, Math.min(pages - 1, Math.min(value, pages - 1) + by)))

    const { Box, Text, Button } = $.ui.resolve(e)
    const index = describeIndex(current.index, now)
    // A failure is not about a snapshot; the rest says which index it describes.
    const indexText = current.index?.state === 'unavailable' ? index.text : `${indexLabel(current.storage)}: ${index.text}`
    return (
      <Box flexDirection="column" width={e.props.bodyColumns} borderStyle="round" borderColor="inactive" paddingX={1}>
        <Text wrap="truncate-end">
          <Text color="claude" bold>jbcontext</Text>
          {'  '}
          {isIndexing ? (
            <Text color="suggestion">indexing... {ago(current.indexingSince!, now).replace(' ago', '')}</Text>
          ) : isTurnShown ? (
            describeTurn(turn)
          ) : (
            ''
          )}
        </Text>
        {shown.length > 0 ? (
          <Text color="success" wrap="truncate-end">
            {DELIVERED_HEADING}
          </Text>
        ) : (
          effectsLine !== null && (
            <Text color="success" wrap="truncate-end">
              {effectsLine}
            </Text>
          )
        )}
        {shown.map(id => (
          <Button key={`jump:${id}`} plain onPress={() => void jumpTo($, id)}>
            <Text color="success">{`  ${describeEffects(badges[id]!) ?? ''}`}</Text>
            <Text dimColor>{trails[id] ? `  "${clipQuery(trails[id]!.query)}"` : ''}</Text>
          </Button>
        ))}
        {pages > 1 && (
          <Box flexDirection="row">
            {page > 0 ? (
              <Button key="page:prev" plain action={PAGE_PREV_ACTION} onPress={() => turnPage(-1)}>‹ prev</Button>
            ) : (
              <Text dimColor>‹ prev</Text>
            )}
            <Text dimColor>{`   ${first + 1}–${first + shown.length} of ${listed.length}   `}</Text>
            {page < pages - 1 ? (
              <Button key="page:next" plain action={PAGE_NEXT_ACTION} onPress={() => turnPage(1)}>next ›</Button>
            ) : (
              <Text dimColor>next ›</Text>
            )}
          </Box>
        )}
        {shown.length > 0 && (
          <Text dimColor wrap="truncate-end">
            {`click a row to go to its search${pages > 1 ? ' · more: click ‹ prev / next ›, or alt+↑ / alt+↓ (⌥ on Mac)' : ''}`}
          </Text>
        )}
        {isIndexShown && (
          <Text color={index.color} wrap="truncate-end">
            {indexText}
          </Text>
        )}
        {isFreshError && (
          <Text wrap="truncate-end">
            <Text color="error">{error.source} {ago(error.at, now).padEnd(8)}</Text>
            {error.message}
          </Text>
        )}
      </Box>
    )
  })

  // Under a jbcontext search's row in the transcript: what it achieved so far, and in the
  // expanded view (ctrl+o) how: the local searches before it, what it returned, and the
  // reads and edits of its hits since.
  on('ui.render', { component: 'ToolUse' }, async ($, e, next) => {
    // Other rows read nothing, so the badges' writes redraw only search rows.
    if (!isJbcontextSearch(e.props.tool, e.props.input)) return next(e)
    const effects = (await read($, badgesState))?.[e.props.tool_use_id]
    const text = effects ? describeEffects(effects) : null
    const row = await next(e)
    if (text === null) return row
    const { Box, Text } = $.ui.resolve(e)
    if (!e.props.isExpanded) {
      return (
        <Box flexDirection="column">
          {row}
          <Text wrap="truncate-end">
            <Text color="success">{`  ${text}`}</Text>
            <Text dimColor>{'   ctrl+o: how'}</Text>
          </Text>
        </Box>
      )
    }
    const trail = (await read($, trailsState))?.[e.props.tool_use_id]
    const lines = trail ? describeTrail(trail) : []
    const width = Math.max(0, ...lines.map(line => line.text.length))
    return (
      <Box flexDirection="column">
        {row}
        <Text color="success" wrap="truncate-end">{`  ${text}`}</Text>
        {lines.map((line, at) => (
          <Text key={`trail:${at}`} wrap="truncate-end">
            <Text color={TRAIL_COLOR[line.kind]}>{`    ${line.mark} `}</Text>
            {line.text.padEnd(width)}
            <Text dimColor>{`   ${line.note}`}</Text>
          </Text>
        ))}
      </Box>
    )
  })

  // A run of calls the transcript folds into one line hides a search's row and its
  // badge: a run holding a search that delivered something unfolds.
  on('ui.render', { component: 'ToolGroup' }, async ($, e, next) => {
    if (e.props.isExpanded) return next(e)
    const ids = e.props.calls
      .filter(call => call.tool_use_id !== undefined && isJbcontextSearch(call.tool, call.input))
      .map(call => call.tool_use_id!)
    if (ids.length === 0) return next(e)
    const badges = await read($, badgesState)
    const isDelivered = ids.some(id => badges?.[id] !== undefined && describeEffects(badges[id]!) !== null)
    return isDelivered ? next({ ...e, props: { ...e.props, isExpanded: true } }) : next(e)
  })

  // Says what jbcontext is searching for while the call runs, then how it went.
  on('ui.render', { component: 'Spinner' }, async ($, e, next) => {
    const turn = await read($, turnState)
    if (turn === null) return next(e)
    if (turn.searching !== null) return next({ ...e, props: { ...e.props, message: turn.searching } })
    const now = await $.clock.now()
    if (turn.result === null || turn.result.until <= now) return next(e)
    return next({ ...e, props: { ...e.props, message: turn.result.text, suffix: '' } })
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const current = (await read($, view)) ?? EMPTY
    const now = await $.clock.now()
    const index = describeIndex(current.index, now)
    const { searches, errors, otherSearches, otherErrors, repoKey } = current
    const repoLabel = repoKey ? repoName(repoKey) : 'this repository'

    const rows = Math.max(6, (e.viewport?.rows ?? 30) - 14)
    const searchRows = Math.max(3, Math.ceil(rows * 0.6))
    const errorRows = Math.max(2, rows - searchRows)
    const savings = current.savings
    // `?? null`: a view written before this field existed outlives a reload.
    const session = current.session ?? null
    const price = savings?.usdPerToken ?? null
    const label = indexLabel(current.storage)

    return (
      <Box flexDirection="column" width={e.props.bodyColumns}>
        <Text bold>{label.charAt(0).toUpperCase() + label.slice(1)}</Text>
        {current.repositoryId && <Text dimColor wrap="truncate-end">{current.repositoryId}</Text>}
        {current.indexingSince !== null && (
          <Text color="suggestion">indexing in this session since {ago(current.indexingSince, now)}</Text>
        )}
        <Text color={index.color} wrap="wrap">{index.text}</Text>
        {current.index !== null && current.index.state !== 'unavailable' && (
          <Text dimColor wrap="wrap">{indexNote(current.storage)}</Text>
        )}

        <Text> </Text>
        <Text bold>This session</Text>
        {session === null && <Text dimColor>Measured when Claude finishes a turn.</Text>}
        {session !== null && (
          <Text wrap="wrap">
            Explored {formatTokens(session.exploreTokens)} tokens in {formatDuration(session.exploreMs)}, ≈
            {formatUsd(session.exploreUsd)}
            {session.totalUsd > 0 && (
              <Text dimColor>
                {' '}
                ({Math.round((session.exploreUsd / session.totalUsd) * 100)}% of the session’s {formatUsd(session.totalUsd)})
              </Text>
            )}
          </Text>
        )}
        {session !== null && session.jbcontextCalls === 0 && (
          <Text dimColor>jbcontext not used in this session.</Text>
        )}
        {session !== null && session.jbcontextCalls > 0 && (
          <Text color="claude" wrap="wrap">
            jbcontext: {session.jbcontextCalls} call{session.jbcontextCalls === 1 ? '' : 's'},{' '}
            {formatTokens(session.jbcontextTokens)} tokens, {formatShare(session)} of exploring
          </Text>
        )}

        <Text> </Text>
        <Text bold>Today in {repoLabel}</Text>
        {savings === null && <Text dimColor>scanning today’s sessions…</Text>}
        {savings !== null && savings.sessions === 0 && (
          <Text dimColor>No Claude sessions with exploration in this repository today.</Text>
        )}
        {savings !== null && savings.sessions > 0 && (
          <Text wrap="wrap">
            Explored {formatTokens(savings.exploreTokens)} tokens in {savings.sessions} session
            {savings.sessions === 1 ? '' : 's'}
            {price !== null ? <Text dimColor> (≈ {formatUsd(savings.exploreTokens * price)})</Text> : ''}
          </Text>
        )}
        {savings !== null && savings.sessions > 0 && savings.measuredSessions === 0 && (
          <Text dimColor wrap="wrap">
            No saving estimate: this jbcontext build has no eval results for these sessions.
          </Text>
        )}
        {savings !== null && savings.measuredSessions > 0 && (
          <Text color="success" wrap="wrap">
            Saved ≈ {formatTokens(savings.savedTokens)} tokens
            {price !== null ? ` ≈ ${formatUsd(savings.savedTokens * price)}` : ''}
            <Text dimColor>
              {' '}
              (est., {savings.measuredSessions} of {savings.sessions} sessions measured
              {price === null ? '; $ once `jbcontext analyze` has run' : ''})
            </Text>
          </Text>
        )}

        <Text> </Text>
        <Text bold>Latest searches in {repoLabel}</Text>
        {searches.length === 0 && <Text dimColor>No searches in this repository in the last {STATS_DAYS} days.</Text>}
        {searches.slice(0, searchRows).map(search => (
          <Text wrap="truncate-end" color={search.success ? undefined : 'error'}>
            <Text dimColor>{ago(search.at, now).padEnd(8)}</Text>
            {search.query}
            <Text dimColor>
              {'  '}
              {search.results ?? '?'} hits · {search.client}
            </Text>
          </Text>
        ))}
        {otherSearches > 0 && <Text dimColor>{otherSearches} more in other repositories</Text>}

        <Text> </Text>
        <Text bold>Latest errors in {repoLabel}</Text>
        {errors.length === 0 && <Text dimColor>No errors in this repository in the last {STATS_DAYS} days.</Text>}
        {errors.slice(0, errorRows).map(error => (
          <Text wrap="truncate-end">
            <Text dimColor>{ago(error.at, now).padEnd(8)}</Text>
            <Text color="error">{error.source}</Text>: {error.message}
          </Text>
        ))}
        {otherErrors > 0 && <Text dimColor>{otherErrors} more in other repositories</Text>}
      </Box>
    )
  })
}

function statusFailure(stdout: string, stderr: string, exitCode: number): string {
  try {
    const message = JSON.parse(stdout)?.message
    if (typeof message === 'string' && message.length > 0) return message
  } catch {
    // not JSON: fall back to the first line of output
  }
  return firstLine(stderr) || firstLine(stdout) || `jbcontext status exited with ${exitCode}`
}
