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
  updatedAt: number
}

declare module 'claude-code' {
  interface PluginState {
    'jbcontext-watch': { view: JbView | null; isBandHidden: boolean }
  }
}
