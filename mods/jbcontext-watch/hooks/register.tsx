import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { JbView } from '../types'
import {
  ago,
  claudeProjectDir,
  describeIndex,
  explorePrice,
  firstLine,
  formatTokens,
  formatUsd,
  isInRepo,
  mergeDays,
  normalizeRepo,
  parseSessionStatus,
  parseStatsDay,
  parseStatus,
  repoName,
  savedTokens,
  touchesJbcontext,
} from './model'
import type { SessionStatus } from './model'

const PANE = 'jbcontext'
const STATS_POLL_MS = 5_000
const STATUS_POLL_MS = 120_000
const STATS_DAYS = 7
const KEPT = 200
const MAX_SESSIONS_SCANNED = 40
const PRICE_KEY = 'explorePrice'

const view = atom({ plugin: 'jbcontext-watch', key: 'view' } as const, null as JbView | null)
const isBandHidden = atom({ plugin: 'jbcontext-watch', key: 'isBandHidden' } as const, false)

const EMPTY: JbView = {
  searches: [],
  errors: [],
  index: null,
  repositoryId: null,
  repoKey: null,
  indexingSince: null,
  savings: null,
  updatedAt: 0,
}

let appHome = ''
let claudeHome = ''
let cwd = ''
let statsStamp = ''
let isStatusRunning = false
let isSavingsRunning = false
let isPriceRunning = false
let isPaneOpen = false
const sessionCache = new Map<string, { mtimeMs: number; status: SessionStatus | null }>()

function patch($: EngineInterface, fn: (current: JbView) => Partial<JbView>) {
  return update($, view, current => {
    const base = current ?? EMPTY
    return { ...base, ...fn(base) }
  })
}

async function jbcontextBinary($: EngineInterface): Promise<string> {
  const bundled = `${appHome}/bin/jbcontext`
  return (await $.fs.exists(bundled)) ? bundled : 'jbcontext'
}

async function refreshStats($: EngineInterface) {
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
  const { searches, errors } = mergeDays(parsed, KEPT)
  const now = await $.clock.now()
  await patch($, () => ({ searches, errors, updatedAt: now }))
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
    await patch($, current => ({ repoKey: current.repoKey ?? originKey }))

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
    await patch($, () => ({ ...summary, repoKey }))
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
// session on the machine (~20 s), so its Exploring price is taken once a day.
async function refreshPrice($: EngineInterface, day: string) {
  const cached = (await $.store.get(PRICE_KEY)) as { day: string; usdPerToken: number | null } | undefined
  if (cached?.day === day) {
    await patch($, current => ({
      savings: current.savings ? { ...current.savings, usdPerToken: cached.usdPerToken } : current.savings,
    }))
    return cached.usdPerToken
  }
  if (isPriceRunning) return null
  isPriceRunning = true
  try {
    const analyze = await $.process.run([await jbcontextBinary($), 'analyze', '--json-output'], {
      cwd,
      timeoutMs: 180_000,
    })
    const usdPerToken = analyze.exitCode === 0 ? explorePrice(analyze.stdout) : null
    await $.store.set(PRICE_KEY, { day, usdPerToken })
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
    if (statuses.length > 0) void refreshPrice($, today.key)
  } finally {
    isSavingsRunning = false
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    cwd = e.cwd
    const home = (await $.env.get('HOME')) ?? ''
    const explicit = await $.env.get('JBCONTEXT_HOME')
    appHome = explicit && explicit.length > 0 ? explicit : `${home}/.jbcontext`
    const claudeConfig = await $.env.get('CLAUDE_CONFIG_DIR')
    claudeHome = claudeConfig && claudeConfig.length > 0 ? claudeConfig : `${home}/.claude`

    await $.command.register({
      name: 'jbcontext',
      description: 'Show jbcontext searches, errors, index status and today’s savings for this repo (run again or `/jbcontext close` to hide; `/jbcontext band` toggles the band)',
      argumentHint: '[close|band]',
    })

    void refreshStats($)
    void refreshStatus($)
    void refreshSavings($)
    $.clock.every(STATS_POLL_MS, () => void refreshStats($))
    $.clock.every(STATUS_POLL_MS, () => {
      void refreshStatus($)
      void refreshSavings($)
    })

    return started
  })

  on('command.run', { command: 'jbcontext' }, async ($, e) => {
    if (e.args.trim() === 'band') {
      const hidden = await update($, isBandHidden, value => !value)
      return { text: hidden ? 'jbcontext band hidden.' : 'jbcontext band shown while Claude works.' }
    }
    if (isPaneOpen || e.args.trim() === 'close') {
      await $.ui.close({ id: PANE })
      isPaneOpen = false
      return { text: 'jbcontext pane closed.' }
    }
    void refreshStatus($)
    void refreshSavings($)
    await $.ui.open({ id: PANE, title: 'jbcontext' })
    isPaneOpen = true
    return { text: 'jbcontext pane opened.' }
  })

  on('ui.close', async ($, e, next) => {
    if (e.id === PANE) isPaneOpen = false
    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    const isMcp = e.tool.startsWith('mcp__') && /jbcontext|embark/.test(e.tool)
    const touch = e.tool === 'Bash' ? touchesJbcontext(e.command) : isMcp ? 'other' : null
    if (touch === null) return next(e)

    if (touch === 'index') {
      const now = await $.clock.now()
      await patch($, () => ({ indexingSince: now }))
    }
    try {
      return await next(e)
    } finally {
      if (touch === 'index') await patch($, () => ({ indexingSince: null }))
      void refreshStats($)
      if (touch === 'index') void refreshStatus($)
    }
  })

  on('turn.complete', async ($, e, next) => {
    void refreshStats($)
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey || !e.props.isWorking || (await read($, isBandHidden))) return next(e)
    const current = await read($, view)
    if (current === null) return next(e)

    const { Box, Text } = $.ui.resolve(e)
    const now = await $.clock.now()
    const index = describeIndex(current.index, now)
    const search = current.searches[0]
    const error = current.errors[0]
    const isFreshError = error !== undefined && now - error.at < 60 * 60 * 1000

    return (
      <Box flexDirection="column" width={e.props.bodyColumns}>
        <Text wrap="truncate-end">
          <Text color="claude" bold>jbcontext </Text>
          {current.indexingSince !== null ? (
            <Text color="suggestion">indexing… {ago(current.indexingSince, now).replace(' ago', '')}</Text>
          ) : (
            <Text color={index.color}>{index.text}</Text>
          )}
        </Text>
        {search && (
          <Text wrap="truncate-end" dimColor>
            {'  last search '}
            {ago(search.at, now)}: “{search.query}” → {search.results ?? '?'} results
            {search.durationMs !== null ? ` in ${(search.durationMs / 1000).toFixed(1)}s` : ''}
          </Text>
        )}
        {isFreshError && (
          <Text wrap="truncate-end" color="error">
            {'  '}
            {error.source}
            {error.repos[0] ? ` (${repoName(error.repos[0])})` : ''} {ago(error.at, now)}: {error.message}
          </Text>
        )}
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const current = (await read($, view)) ?? EMPTY
    const now = await $.clock.now()
    const index = describeIndex(current.index, now)
    const repoKey = current.repoKey
    const searches = current.searches.filter(search => isInRepo(search, repoKey, cwd))
    const errors = current.errors.filter(error => isInRepo(error, repoKey, cwd))
    const otherSearches = current.searches.length - searches.length
    const otherErrors = current.errors.length - errors.length
    const repoLabel = repoKey ? repoName(repoKey) : 'this repository'

    const rows = Math.max(6, (e.viewport?.rows ?? 30) - 14)
    const searchRows = Math.max(3, Math.ceil(rows * 0.6))
    const errorRows = Math.max(2, rows - searchRows)
    const savings = current.savings
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
