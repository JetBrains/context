import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { JbSearch, JbSession, JbTurn, JbView } from '../types'
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
  formatTokens,
  formatUsd,
  jbcontextShare,
  jbcontextUsage,
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
  statusLine,
  touchesJbcontext,
} from './model'
import type { DayEvents, JbcontextUsage, RepoEvents, SessionStatus } from './model'

const PANE = 'jbcontext'
const STATS_POLL_MS = 5_000
const STATUS_POLL_MS = 120_000
const STATS_DAYS = 7
const KEPT = 200
const MAX_SESSIONS_SCANNED = 40
const PRICE_KEY = 'explorePrice'
const PRICE_RETRY_MS = 60 * 60 * 1000
// Local exploration calls in a row, with the repository indexed, that turn the band's
// nudge on; and how long the spinner says how a jbcontext call went.
const NUDGE_STREAK = 6
const RESULT_SHOWN_MS = 4_000

const view = atom({ plugin: 'jbcontext-watch', key: 'view' } as const, null as JbView | null)
const turnState = atom({ plugin: 'jbcontext-watch', key: 'turn' } as const, null as JbTurn | null)
const isBandHidden = atom({ plugin: 'jbcontext-watch', key: 'isBandHidden' } as const, false)

const EMPTY_TURN: JbTurn = {
  explorations: 0,
  jbcontextCalls: 0,
  jbcontextHits: 0,
  streak: 0,
  searching: null,
  result: null,
}

const EMPTY: JbView = {
  searches: [],
  errors: [],
  otherSearches: 0,
  otherErrors: 0,
  index: null,
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
const usageCache = new Map<string, { stamp: string; usage: JbcontextUsage }>()
let measuring: Promise<JbSession | null> | null = null
// The exploring tokens the last line under an answer showed, so a turn that explored
// nothing adds no line.
let shownTokens: { sessionId: string; tokens: number } | null = null

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
    const [head, branch, origin] = await Promise.all([
      git(['rev-parse', 'HEAD']),
      git(['rev-parse', '--abbrev-ref', 'HEAD']),
      git(['remote', 'get-url', 'origin']),
    ])
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

async function transcriptUsage($: EngineInterface, path: string, size: number, mtimeMs: number) {
  const stamp = `${size}:${mtimeMs}`
  const cached = usageCache.get(path)
  if (cached?.stamp === stamp) return cached.usage
  const usage = jbcontextUsage(await $.fs.read(path).catch(() => ''))
  usageCache.set(path, { stamp, usage })
  return usage
}

// `jbcontext analyze` reads a projects folder, so the session's transcript and each of
// its subagents' are linked into one of their own, the subagents as sessions beside it:
// the CLI counts a subagent's tokens only in a transcript of its own.
async function measureSession($: EngineInterface): Promise<JbSession | null> {
  if (claudeHome === '') return null
  const sessionId = await $.session.id()
  const projectDir = `${claudeHome}/projects/${claudeProjectDir(cwd)}`
  const main = `${projectDir}/${sessionId}.jsonl`
  const mainStat = await $.fs.stat(main).catch(() => null)
  if (mainStat?.kind !== 'file') return null
  const subagentDir = `${projectDir}/${sessionId}/subagents`
  const transcripts = [
    { path: main, size: mainStat.size, mtimeMs: mainStat.mtimeMs },
    ...(await $.fs.list(subagentDir).catch(() => []))
      .filter(entry => entry.kind === 'file' && entry.name.endsWith('.jsonl'))
      .map(entry => ({ path: `${subagentDir}/${entry.name}`, size: entry.size, mtimeMs: entry.mtimeMs })),
  ]

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

  const usages = await Promise.all(transcripts.map(one => transcriptUsage($, one.path, one.size, one.mtimeMs)))
  const session: JbSession = {
    sessionId,
    ...phases,
    jbcontextCalls: usages.reduce((sum, usage) => sum + usage.calls, 0),
    jbcontextTokens: usages.reduce((sum, usage) => sum + usage.tokens, 0),
  }
  await patch($, () => ({ session }))
  return session
}

function measureSessionOnce($: EngineInterface): Promise<JbSession | null> {
  measuring ??= measureSession($)
    .catch(() => null)
    .finally(() => {
      measuring = null
    })
  return measuring
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
    void measureSessionOnce($)
    await $.ui.open({ id: PANE, title: 'jbcontext' })
    return { text: 'jbcontext pane opened.' }
  })

  on('turn.start', async ($, e, next) => {
    await update($, turnState, () => EMPTY_TURN)
    return next(e)
  })

  // Counts the turn's exploration as it runs, says in the spinner what jbcontext is
  // searching for, and marks a `jbcontext index` run while it lasts.
  on('tool.call', async ($, e, next) => {
    const kind = explorationKind(e.tool, e)
    const touch = e.tool === 'Bash' ? touchesJbcontext(e.command) : kind === 'jbcontext' ? 'other' : null
    if (kind === null && touch === null) return next(e)

    const startedAt = await $.clock.now()
    const label = kind === 'jbcontext' ? searchLabel(e.tool, e) : null
    if (kind !== null) {
      await patchTurn($, turn => ({
        explorations: turn.explorations + 1,
        jbcontextCalls: turn.jbcontextCalls + (kind === 'jbcontext' ? 1 : 0),
        streak: kind === 'jbcontext' ? 0 : turn.streak + 1,
        searching: label ?? turn.searching,
      }))
    }
    if (touch === 'index') await patch($, () => ({ indexingSince: startedAt }))
    let isError = true
    try {
      const result = await next(e)
      isError = 'deny' in result || result.isError === true
      return result
    } finally {
      if (label !== null) {
        await patchTurn($, turn => ({ searching: turn.searching === label ? null : turn.searching }))
        void finishSearch($, startedAt, isError)
      }
      if (touch === 'index') await patch($, () => ({ indexingSince: null }))
      if (touch !== null && label === null) void refreshStats($)
      if (touch === 'index') void refreshStatus($)
    }
  })

  // Beneath an answer whose turn explored, the session's exploration so far; once the
  // session ends, the last of these lines stands as its summary.
  on('turn.complete', async ($, e, next) => {
    void refreshStats($)
    const result = await next(e)
    if (!isInteractive || e.agentId !== undefined || result.text !== e.answer) return result
    const session = await measureSessionOnce($)
    if (session === null || session.exploreTokens === 0) return result
    if (shownTokens?.sessionId === session.sessionId && shownTokens.tokens === session.exploreTokens) return result
    shownTokens = { sessionId: session.sessionId, tokens: session.exploreTokens }
    return { ...result, text: describeSession(session) }
  })

  on('session.end', async ($, e, next) => {
    if (e.reason === 'clear') await patch($, () => ({ session: null }))
    return next(e)
  })

  // While Claude works: the turn's exploration so far, a nudge when it greps on and on in
  // an indexed repository, the index when it is not current, and a fresh error. Nothing
  // when there is nothing of these to say.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey || !e.props.isWorking || (await read($, isBandHidden))) return next(e)
    const current = await read($, view)
    if (current === null) return next(e)
    const turn = (await read($, turnState)) ?? EMPTY_TURN

    const now = await $.clock.now()
    const error = current.errors[0]
    const isFreshError = error !== undefined && now - error.at < 60 * 60 * 1000
    const isIndexing = current.indexingSince !== null
    const state = current.index?.state
    const isIndexShown =
      !isIndexing &&
      current.index !== null &&
      state !== 'current' &&
      !(current.index.state === 'unavailable' && current.index.reason === 'not a git repository')
    const isNudge = (state === 'current' || state === 'stale') && turn.streak >= NUDGE_STREAK
    if (!isIndexing && turn.explorations === 0 && !isIndexShown && !isFreshError) return next(e)

    const { Box, Text } = $.ui.resolve(e)
    const index = describeIndex(current.index, now)
    return (
      <Box
        flexDirection="column"
        width={e.props.bodyColumns}
        borderStyle="round"
        borderColor={isNudge ? 'warning' : 'inactive'}
        paddingX={1}
      >
        <Text wrap="truncate-end">
          <Text color="claude" bold>jbcontext</Text>
          {'  '}
          {isIndexing ? (
            <Text color="suggestion">indexing... {ago(current.indexingSince!, now).replace(' ago', '')}</Text>
          ) : turn.explorations > 0 ? (
            describeTurn(turn)
          ) : (
            ''
          )}
        </Text>
        {isNudge && (
          <Text color="warning" wrap="truncate-end">
            {turn.streak} grep/read calls in a row without jbcontext; this repository is indexed
          </Text>
        )}
        {isIndexShown && (
          <Text color={index.color} wrap="truncate-end">
            {index.text}
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

    return (
      <Box flexDirection="column" width={e.props.bodyColumns}>
        <Text bold>Index</Text>
        {current.repositoryId && <Text dimColor wrap="truncate-end">{current.repositoryId}</Text>}
        {current.indexingSince !== null && (
          <Text color="suggestion">indexing in this session since {ago(current.indexingSince, now)}</Text>
        )}
        <Text color={index.color} wrap="wrap">{index.text}</Text>

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
            {formatTokens(session.jbcontextTokens)} tokens, {jbcontextShare(session)}% of exploring
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
