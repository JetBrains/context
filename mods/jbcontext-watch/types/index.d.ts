export type JbSearch = {
  at: number
  query: string
  kind: string
  client: string
  repos: string[]
  results: number | null
  durationMs: number | null
  success: boolean
  projectRoot: string | null
}

export type JbError = {
  at: number
  source: string
  message: string
  repos: string[]
  projectRoot: string | null
}

export type JbIndex =
  | { state: 'current'; branch: string; revision: string; at: number }
  | { state: 'stale'; branch: string; head: string; revision: string; at: number }
  | { state: 'other'; branch: string; head: string; revision: string; at: number }
  | { state: 'none'; branch: string }
  | { state: 'unavailable'; reason: string }

// Today's exploration in this repository's Claude sessions, from `jbcontext analyze --status`.
export type JbSavings = {
  sessions: number
  // Sessions the CLI had an eval-backed reduction for; only these add to savedTokens.
  measuredSessions: number
  exploreTokens: number
  savedTokens: number
  // Blended Exploring-phase price from `jbcontext analyze`; null until that succeeded today.
  usdPerToken: number | null
}

// This session's exploration, its subagents' included, as of the last turn: the phase
// figures from `jbcontext analyze`, the jbcontext part from the transcripts' tool calls.
export type JbSession = {
  sessionId: string
  exploreTokens: number
  exploreMs: number
  exploreUsd: number
  // Every phase's cost, the session's as `jbcontext analyze` prices it.
  totalUsd: number
  jbcontextCalls: number
  // The exploring tokens billed for the responses that called jbcontext.
  jbcontextTokens: number
}

// The running turn, counted from its tool calls (its subagents' included) as they run.
export type JbTurn = {
  // Reads, greps, globs, listings and read-only shell commands, jbcontext's calls included.
  explorations: number
  jbcontextCalls: number
  jbcontextHits: number
  // Local exploration calls since the turn's last jbcontext call.
  streak: number
  // The jbcontext call running now, as the spinner says it.
  searching: string | null
  // The last jbcontext call's outcome, which the spinner says until `until`.
  result: { text: string; until: number } | null
}

export type JbView = {
  // This repository's, newest first; the other repositories' only counted.
  searches: JbSearch[]
  errors: JbError[]
  otherSearches: number
  otherErrors: number
  index: JbIndex | null
  repositoryId: string | null
  // The repository the session runs in, as the stats files spell repositories.
  repoKey: string | null
  indexingSince: number | null
  savings: JbSavings | null
  session: JbSession | null
  updatedAt: number
}

declare module 'claude-code' {
  interface PluginState {
    'jbcontext-watch': { view: JbView | null; turn: JbTurn | null; isBandHidden: boolean }
  }
}
