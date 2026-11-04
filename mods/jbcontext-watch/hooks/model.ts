import type { JbError, JbIndex, JbSearch, JbSession, JbTurn, JbView } from '../types'

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

export function mergeDays(days: DayEvents[]): DayEvents {
  const byTimeDesc = <T extends { at: number }>(a: T, b: T) => b.at - a.at
  const searches = days.flatMap(day => day.searches).sort(byTimeDesc)
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

  return { searches, errors }
}

export type RepoEvents = DayEvents & { otherSearches: number; otherErrors: number }

// The repository's newest `limit` searches and errors, the rest counted; filtered
// before the limit, so busy other repositories never push this one's out.
export function scopeToRepo(events: DayEvents, repoKey: string | null, cwd: string, limit: number): RepoEvents {
  const searches = events.searches.filter(search => isInRepo(search, repoKey, cwd))
  const errors = events.errors.filter(error => isErrorInRepo(error, repoKey, cwd))
  return {
    searches: searches.slice(0, limit),
    errors: errors.slice(0, limit),
    otherSearches: events.searches.length - searches.length,
    otherErrors: events.errors.length - errors.length,
  }
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

// An error that names neither a repository nor a directory (an expired token, say)
// concerns every repository.
export function isErrorInRepo(error: JbError, repoKey: string | null, cwd: string): boolean {
  return (error.repos.length === 0 && error.projectRoot === null) || isInRepo(error, repoKey, cwd)
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

export type SessionPhases = Pick<JbSession, 'exploreTokens' | 'exploreMs' | 'exploreUsd' | 'totalUsd'>

// `jbcontext analyze --json-output` over a projects folder holding one session's transcripts.
export function parseSessionPhases(analyzeJson: string): SessionPhases | null {
  try {
    const phases: { phase?: string; totalTokensBilled?: number; totalDurationMs?: number; totalCostUsd?: number }[] =
      JSON.parse(analyzeJson)?.phaseBreakdown ?? []
    const exploring = phases.find(phase => phase.phase === 'Exploring')
    if (!exploring) return null
    return {
      exploreTokens: exploring.totalTokensBilled ?? 0,
      exploreMs: exploring.totalDurationMs ?? 0,
      exploreUsd: exploring.totalCostUsd ?? 0,
      totalUsd: phases.reduce((sum, phase) => sum + (phase.totalCostUsd ?? 0), 0),
    }
  } catch {
    return null
  }
}

export type JbcontextUsage = { calls: number; tokens: number }

// A jbcontext MCP tool, or a shell command that runs `jbcontext search` or `jbcontext
// repos` (first in the command or after `;`, `&&`, `|`, `(`), not one that only names
// it in a quoted argument (`grep 'jbcontext search'`).
export function isJbcontextCall(name: string, input: unknown): boolean {
  if (name.startsWith('mcp__')) return /jbcontext|embark/i.test(name)
  if (name !== 'Bash') return false
  const command = (input as { command?: unknown } | null)?.command
  if (typeof command !== 'string') return false
  return /(?:^|[;&|(\n])\s*(?:\S*\/)?jbcontext\s+(?:--?\S+\s+)*(?:search|repos)\b/.test(unquote(command))
}

function unquote(command: string): string {
  return command.replace(/'[^']*'|"(?:[^"\\]|\\.)*"/g, "''")
}

const LOCAL_TOOLS = new Set(['Read', 'Grep', 'Glob', 'LS', 'NotebookRead', 'LSP'])
const READ_ONLY_COMMANDS = new Set(['grep', 'egrep', 'fgrep', 'rg', 'ag', 'ack', 'find', 'fd', 'ls', 'tree', 'cat', 'head', 'tail', 'less', 'wc'])
const READ_ONLY_GIT = new Set(['grep', 'log', 'show', 'blame', 'ls-files', 'ls-tree'])

// What a tool call is to exploration: a jbcontext call, a local one (a read, grep, glob,
// listing, or a shell command led by one of those), or none.
export function explorationKind(tool: string, args: unknown): 'jbcontext' | 'local' | null {
  if (isJbcontextCall(tool, args)) return 'jbcontext'
  if (LOCAL_TOOLS.has(tool)) return 'local'
  if (tool !== 'Bash') return null
  const command = (args as { command?: unknown } | null)?.command
  if (typeof command !== 'string') return null
  const segment = unquote(command)
    .split(/&&|\|\||;|\n/)
    .map(part => part.trim().split(/\s+/).filter(word => !/^[A-Za-z_]\w*=/.test(word)))
    .find(words => words.length > 0 && words[0] !== 'cd')
  if (!segment) return null
  const name = segment[0]!.split('/').pop()!
  if (READ_ONLY_COMMANDS.has(name)) return 'local'
  if (name === 'sed' && segment.includes('-n')) return 'local'
  if (name === 'git') {
    const sub = segment[1] === '-C' ? segment[3] : segment[1]
    return sub !== undefined && READ_ONLY_GIT.has(sub) ? 'local' : null
  }
  return null
}

// What the spinner says while a jbcontext call runs: `Searching jbcontext: "query"`.
export function searchLabel(tool: string, args: unknown): string {
  const record = (args ?? {}) as Record<string, unknown>
  const isRepos = tool === 'Bash' ? /\bjbcontext\s+(?:--?\S+\s+)*repos\b/.test(unquote(String(record.command ?? ''))) : /repositor/i.test(tool)
  const query = tool === 'Bash' ? shellQuery(String(record.command ?? '')) : firstString(record.text, record.query, record.q)
  const verb = isRepos ? 'Finding repositories in jbcontext' : 'Searching jbcontext'
  return query ? `${verb}: "${query.length > 60 ? `${query.slice(0, 59)}…` : query}"` : verb
}

function firstString(...values: unknown[]): string | null {
  const found = values.find(value => typeof value === 'string' && value.trim().length > 0)
  return typeof found === 'string' ? found.trim() : null
}

// The query of `jbcontext search|repos ...`, among the words up to the next shell
// operator: the last that holds a space (a semantic query; an URL or a path holds
// none), else the first that is neither a flag nor a flag's value (`--limit 10`).
function shellQuery(command: string): string | null {
  const head = /\bjbcontext\s+(?:--?\S+\s+)*(?:search|repos)\b/.exec(command)
  if (!head) return null
  const words: { text: string; isFlag: boolean }[] = []
  const token = /"((?:[^"\\]|\\.)*)"|'([^']*)'|(\|\||&&|\d*[<>]|[|;&\n])|([^\s|;&<>]+)/g
  token.lastIndex = head.index + head[0].length
  for (let match = token.exec(command); match; match = token.exec(command)) {
    if (match[3] !== undefined) break
    const text = match[1] ?? match[2] ?? match[4] ?? ''
    words.push({ text, isFlag: match[4] !== undefined && text.startsWith('-') })
  }
  const spaced = [...words].reverse().find(word => !word.isFlag && /\s/.test(word.text))
  const positional = words.find(
    (word, at) => !word.isFlag && !(at > 0 && words[at - 1]!.isFlag && !words[at - 1]!.text.includes('=')),
  )
  return (spaced ?? positional ?? words.find(word => !word.isFlag))?.text ?? null
}

export function describeTurn(turn: JbTurn): string {
  const calls = `${turn.explorations} exploration call${turn.explorations === 1 ? '' : 's'}`
  const jbcontext =
    turn.jbcontextCalls === 0
      ? 'none via jbcontext'
      : `${turn.jbcontextCalls} via jbcontext (${turn.jbcontextHits} hit${turn.jbcontextHits === 1 ? '' : 's'})`
  return `this turn: ${calls} · ${jbcontext}`
}

// The status line under the prompt: the index of this branch, and once a turn has been
// measured, how much of the session's exploring went through jbcontext.
export function statusLine(view: JbView): string | undefined {
  const index = view.index
  let head: string
  if (view.indexingSince !== null) head = 'jbcontext · indexing…'
  else if (index === null) return undefined
  else if (index.state === 'current') head = `jbcontext ✓ ${index.branch} indexed`
  else if (index.state === 'stale') head = `jbcontext ⚠ ${index.branch} HEAD not indexed`
  else if (index.state === 'other') head = `jbcontext ⚠ ${index.branch} not indexed`
  else if (index.state === 'none') head = 'jbcontext ✗ repository not indexed'
  else if (index.reason === 'not a git repository') return undefined
  else head = `jbcontext ✗ ${index.reason.length > 60 ? `${index.reason.slice(0, 59)}…` : index.reason}`

  const session = view.session ?? null
  if (session === null || session.exploreTokens === 0) return head
  return session.jbcontextCalls === 0
    ? `${head} · session: jbcontext not used`
    : `${head} · session: ${jbcontextShare(session)}% of exploring via jbcontext`
}

// The tokens billed for the responses that called jbcontext, the way `jbcontext analyze`
// bills a response to the phase of its tool calls: input, cache writes, cache reads and
// output; a response that also called other tools is split evenly among its calls.
// A response spans several transcript lines, one per content block, under one id.
export function jbcontextUsage(transcript: string): JbcontextUsage {
  const responses = new Map<string, { billed: number; tools: number; jbcontext: number }>()
  for (const line of transcript.split('\n')) {
    if (!line.includes('"assistant"')) continue
    let entry
    try {
      entry = JSON.parse(line)
    } catch {
      continue
    }
    const message = entry?.type === 'assistant' ? entry.message : undefined
    if (typeof message?.id !== 'string') continue
    const response = responses.get(message.id) ?? { billed: 0, tools: 0, jbcontext: 0 }
    const usage = message.usage ?? {}
    response.billed =
      (usage.input_tokens ?? 0) +
      (usage.cache_creation_input_tokens ?? 0) +
      (usage.cache_read_input_tokens ?? 0) +
      (usage.output_tokens ?? 0)
    for (const block of Array.isArray(message.content) ? message.content : []) {
      if (block?.type !== 'tool_use') continue
      response.tools++
      if (isJbcontextCall(String(block.name ?? ''), block.input)) response.jbcontext++
    }
    responses.set(message.id, response)
  }

  let calls = 0
  let tokens = 0
  for (const response of responses.values()) {
    if (response.jbcontext === 0) continue
    calls += response.jbcontext
    tokens += (response.billed * response.jbcontext) / response.tools
  }
  return { calls, tokens: Math.round(tokens) }
}

export function jbcontextShare(session: JbSession): number {
  if (session.exploreTokens <= 0) return 0
  return Math.min(100, Math.round((session.jbcontextTokens / session.exploreTokens) * 100))
}

export function describeSession(session: JbSession): string {
  const costShare = session.totalUsd > 0 ? ` (${Math.round((session.exploreUsd / session.totalUsd) * 100)}% of ${formatUsd(session.totalUsd)})` : ''
  const jbcontext =
    session.jbcontextCalls === 0
      ? 'jbcontext not used'
      : `jbcontext ${session.jbcontextCalls} call${session.jbcontextCalls === 1 ? '' : 's'}, ${jbcontextShare(session)}% of exploring tokens`
  return `jbcontext · this session explored ${formatTokens(session.exploreTokens)} tokens in ${formatDuration(session.exploreMs)}, ≈${formatUsd(session.exploreUsd)}${costShare} · ${jbcontext}`
}

export function formatDuration(ms: number): string {
  const seconds = Math.round(ms / 1000)
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`
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
