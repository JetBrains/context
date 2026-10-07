import type { JbError, JbIndex, JbSearch } from '../types'

// The CLI's local stats format: one file per day,
// `{ date, events: [...] }`, each event tagged by `type`.
type RawEvent = {
  type?: string
  timestamp?: string
  clientType?: string | null
  searchKind?: string
  toolName?: string | null
  query?: string
  repositoryUrls?: string[]
  repositoryUrl?: string | null
  resultCount?: number | null
  durationMs?: number | null
  success?: boolean
  errorMessage?: string | null
  message?: string
  source?: string | null
  projectRoot?: string | null
}

export type DayEvents = { searches: JbSearch[]; errors: JbError[] }

export function parseStatsDay(text: string): DayEvents {
  const searches: JbSearch[] = []
  const errors: JbError[] = []
  let events: RawEvent[] = []
  try {
    const parsed = JSON.parse(text)
    events = Array.isArray(parsed?.events) ? parsed.events : []
  } catch {
    return { searches, errors }
  }

  for (const event of events) {
    const at = Date.parse(event.timestamp ?? '')
    if (Number.isNaN(at)) continue

    if (event.type === 'search') {
      searches.push({
        at,
        query: event.query ?? '',
        kind: event.searchKind ?? 'semantic',
        client: event.toolName ?? event.clientType ?? 'CLI',
        repos: event.repositoryUrls ?? [],
        results: event.resultCount ?? null,
        durationMs: event.durationMs ?? null,
        success: event.success !== false,
        projectRoot: event.projectRoot ?? null,
      })
      if (event.success === false) {
        errors.push({
          at,
          source: 'search',
          message: event.errorMessage ?? 'Search failed',
          repos: event.repositoryUrls ?? [],
          projectRoot: event.projectRoot ?? null,
        })
      }
    } else if (event.type === 'indexing' && event.success === false) {
      errors.push({
        at,
        source: 'indexing',
        message: event.errorMessage ?? 'Indexing failed',
        repos: event.repositoryUrl ? [event.repositoryUrl] : [],
        projectRoot: null,
      })
    } else if (event.type === 'error' && event.message) {
      errors.push({ at, source: event.source ?? 'error', message: event.message, repos: [], projectRoot: null })
    }
  }

  return { searches, errors }
}

export function mergeDays(days: DayEvents[], limit: number): DayEvents {
  const byTimeDesc = <T extends { at: number }>(a: T, b: T) => b.at - a.at
  const searches = days.flatMap(day => day.searches).sort(byTimeDesc).slice(0, limit)
  const seen = new Set<string>()
  const errors = days
    .flatMap(day => day.errors)
    .sort(byTimeDesc)
    .filter(error => {
      const id = `${error.at}|${error.message}`
      if (seen.has(id)) return false
      seen.add(id)
      return true
    })
    .slice(0, limit)

  return { searches, errors }
}

type RawSnapshot = { revision?: string; branches?: string[]; createdAt?: number }
type RawStatus = {
  repositoryId?: string
  message?: string
  indices?: { indexAlias?: { name?: string }; snapshots?: RawSnapshot[] }[]
}

export type StatusSummary = { repositoryId: string | null; index: JbIndex }

export function parseStatus(text: string, head: string, branch: string): StatusSummary {
  let status: RawStatus
  try {
    status = JSON.parse(text)
  } catch {
    return { repositoryId: null, index: { state: 'unavailable', reason: firstLine(text) || 'Unreadable status output' } }
  }

  const indices = status.indices ?? []
  const codeBlocks =
    indices.find(index => index.indexAlias?.name?.endsWith('CodeBlocks')) ?? indices[0]
  const snapshots = [...(codeBlocks?.snapshots ?? [])]
    .filter(snapshot => typeof snapshot.revision === 'string')
    .sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0))
  const repositoryId = status.repositoryId ?? null

  const exact = snapshots.find(snapshot => snapshot.revision === head)
  if (exact) {
    return { repositoryId, index: { state: 'current', branch, revision: head, at: exact.createdAt ?? 0 } }
  }

  const onBranch = snapshots.find(snapshot =>
    (snapshot.branches ?? []).some(name => name === branch || name === `origin/${branch}`),
  )
  if (onBranch) {
    return {
      repositoryId,
      index: { state: 'stale', branch, head, revision: onBranch.revision!, at: onBranch.createdAt ?? 0 },
    }
  }

  const latest = snapshots[0]
  if (latest) {
    return {
      repositoryId,
      index: { state: 'other', branch, head, revision: latest.revision!, at: latest.createdAt ?? 0 },
    }
  }

  return { repositoryId, index: { state: 'none', branch } }
}

// `ssh://git@github.com/JetBrains/x.git`, `git@github.com:JetBrains/x.git` and
// `https://github.com/JetBrains/x` all become `github.com/jetbrains/x`, the
// spelling the stats files and `jbcontext status` use.
export function normalizeRepo(url: string): string {
  return url
    .trim()
    .toLowerCase()
    .replace(/^[a-z][a-z0-9+.-]*:\/\//, '')
    .replace(/^[^@/]+@/, '')
    .replace(/^([^/:]+):(?!\d+\/)/, '$1/')
    .replace(/^([^/:]+):\d+\//, '$1/')
    .replace(/\.git$/, '')
    .replace(/\/+$/, '')
}

type Scoped = { repos: string[]; projectRoot: string | null }

// Events that name no repository count when they ran from inside the session's directory.
export function isInRepo(item: Scoped, repoKey: string | null, cwd: string): boolean {
  if (repoKey !== null && item.repos.some(repo => normalizeRepo(repo) === repoKey)) return true
  if (item.repos.length > 0 || item.projectRoot === null || cwd === '') return false
  return cwd === item.projectRoot || cwd.startsWith(`${item.projectRoot}/`)
}

export function repoName(repo: string): string {
  return repo.split('/').pop() ?? repo
}

export type SessionStatus = { exploreTokens: number; reductionPct: number | null; embarkInvoked: boolean }

export function parseSessionStatus(text: string): SessionStatus | null {
  try {
    const json = JSON.parse(text)
    if (typeof json?.exploreTokens !== 'number') return null
    return {
      exploreTokens: json.exploreTokens,
      reductionPct: typeof json.reductionPct === 'number' ? json.reductionPct : null,
      embarkInvoked: json.embarkInvoked === true,
    }
  } catch {
    return null
  }
}

// A session that used jbcontext reports its reduction as already realized, so what it
// saved is measured against the larger cost it would have had without it; a session that
// did not use it saved nothing.
export function savedTokens(status: SessionStatus): number {
  const pct = status.reductionPct
  if (pct === null || !status.embarkInvoked || pct <= 0 || pct >= 100) return 0
  return Math.round((status.exploreTokens * pct) / (100 - pct))
}

export function explorePrice(analyzeJson: string): number | null {
  try {
    const phases: { phase?: string; totalTokensBilled?: number; totalCostUsd?: number }[] =
      JSON.parse(analyzeJson)?.phaseBreakdown ?? []
    const exploring = phases.find(phase => phase.phase === 'Exploring')
    if (!exploring?.totalTokensBilled || !exploring.totalCostUsd) return null
    return exploring.totalCostUsd / exploring.totalTokensBilled
  } catch {
    return null
  }
}

// Claude Code names a project's transcript folder after its directory, every
// character but a letter or digit replaced with `-`.
export function claudeProjectDir(cwd: string): string {
  return cwd.replace(/[^a-zA-Z0-9]/g, '-')
}

export function formatTokens(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`
  if (tokens >= 1_000) return `${Math.round(tokens / 1_000)}K`
  return String(tokens)
}

export function formatUsd(usd: number): string {
  return usd >= 10 ? `$${Math.round(usd)}` : `$${usd.toFixed(2)}`
}

export function firstLine(text: string): string {
  return (
    text
      .split('\n')
      .map(line => line.trim())
      .find(line => line.length > 0) ?? ''
  )
}

export function ago(at: number, now: number): string {
  const seconds = Math.max(0, Math.round((now - at) / 1000))
  if (seconds < 60) return `${seconds}s ago`
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.round(minutes / 60)
  if (hours < 48) return `${hours}h ago`
  return `${Math.round(hours / 24)}d ago`
}

export function short(revision: string): string {
  return revision.slice(0, 8)
}

export function describeIndex(index: JbIndex | null, now: number): { text: string; color: string } {
  if (index === null) return { text: 'checking index…', color: 'inactive' }
  switch (index.state) {
    case 'current':
      return { text: `${index.branch} @ ${short(index.revision)} indexed ${ago(index.at, now)}`, color: 'success' }
    case 'stale':
      return {
        text: `${index.branch} HEAD ${short(index.head)} not indexed; branch snapshot ${short(index.revision)} from ${ago(index.at, now)}`,
        color: 'warning',
      }
    case 'other':
      return {
        text: `${index.branch} not indexed; newest snapshot ${short(index.revision)} from ${ago(index.at, now)}`,
        color: 'warning',
      }
    case 'none':
      return { text: 'no snapshots for this repository; run `jbcontext index`', color: 'error' }
    case 'unavailable':
      return { text: index.reason, color: 'error' }
  }
}

// Bash commands that change what the stats files or the server hold.
export function touchesJbcontext(command: string): 'index' | 'other' | null {
  if (!/\bjbcontext\b/.test(command)) return null
  return /\bjbcontext\s+(?:--\S+\s+)*index\b/.test(command) ? 'index' : 'other'
}
