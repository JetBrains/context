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

// Where the indexed snapshots `jbcontext status` reports are kept: on the server, or on
// this machine with `runtime.storage local`. Local changes (the overlay `jbcontext watch`
// keeps) are not among them.
export type IndexStorage = 'remote' | 'local'

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

// The running turn, counted from the tool calls that ran (its subagents' included), each as it ends.
export type JbTurn = {
  // Reads, greps, globs, listings and read-only shell commands, jbcontext's calls included.
  explorations: number
  jbcontextCalls: number
  jbcontextHits: number
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
  storage: IndexStorage
  repositoryId: string | null
  // The repository the session runs in, as the stats files spell repositories.
  repoKey: string | null
  indexingSince: number | null
  savings: JbSavings | null
  session: JbSession | null
  updatedAt: number
}

// A hit's lines as the search printed them; `end` is a lower bound when the snippet
// was cut (`isTruncated`).
export type HitRange = { start: number; end: number; isTruncated: boolean }

// What the agent did with a hit's file after the search.
export type HitUse = { read: boolean; edited: boolean; exact: boolean }

// One file of a search's hits, the hits in it merged.
export type HitFile = {
  // Repository-relative, as the search printed it.
  path: string
  // The repository label of a multi-repo hit that is not this repository; null for this one.
  repo: string | null
  // Empty for a hit listed by name alone.
  ranges: HitRange[]
  // The snippet's lines, trimmed, those of 8 characters or more.
  snippet: string[]
  // Named by a local search's output, read or edited earlier this turn.
  isKnown: boolean
  // No earlier jbcontext search this turn listed it.
  isFirstFinder: boolean
  use: HitUse | null
  // The place of its first hit in the search's results, from 1.
  rank?: number
}

// One local search as the trail shows it: what was run, and what it gave.
export type TrailLocal = {
  // Its tool_use_id, the transcript row it was; null when the call carried none.
  id: string | null
  // The command, or `Grep <pattern> <path>` for a tool.
  label: string
  outcome: 'empty' | 'found'
  // Files its output named, and the first few of them.
  files: number
  sample: string[]
}

// One read or edit of a search's hit file, as the trail shows it.
export type TrailUse = {
  id: string | null
  kind: 'read' | 'edit'
  // `Read`, `Edit`, `cat`, `sed`...
  tool: string
  path: string
  // The lines read or changed; null for a whole-file read.
  lines: { start: number; end: number } | null
  // The search's hit it fell on: its place in the results, and its lines (null for
  // a hit listed by name alone).
  rank: number
  hit: { start: number; end: number } | null
  exact: boolean
}

// How a search delivered, kept for its row after the ledger has let it go.
export type SearchTrail = {
  turn: number
  query: string
  hitCount: number
  fileCount: number
  before: TrailLocal[]
  uses: TrailUse[]
  // A used file it found that the local searches before it had not named.
  target: string | null
  // The used files it found that share no word with the query.
  meaning: string[]
}

// Local searches (grep, rg, find...) a loop ran since its last jbcontext search.
export type LoopWindow = { empty: number; nonEmpty: number; patterns: string[]; steps?: TrailLocal[] }

export type SearchRecord = {
  // The search call's tool_use_id: the transcript row its badge goes under.
  id: string
  turn: number
  // The subagent's id, or 'main'.
  loop: string
  // When it finished, in the ledger's call order.
  doneSeq: number
  query: string
  files: HitFile[]
  window: LoopWindow
  hitCount?: number
  // Reads and edits of its files since, oldest first.
  uses?: TrailUse[]
}

// Every jbcontext search of the current and the previous main turn, and what the turn's
// local searches, reads and edits have shown so far.
export type JbLedger = {
  turn: number
  seq: number
  seen: string[]
  windows: Record<string, LoopWindow>
  searches: SearchRecord[]
}

// What one search achieved; each field only grows.
export type SearchEffects = {
  // Empty local searches before it, when it found a used file they could not; 0 otherwise.
  afterEmpty: number
  byMeaning: boolean
  exactLines: boolean
  // Distinct files of its hits edited since.
  filesChanged: number
  usedFiles: number
}

export type EffectCounts = {
  searches: number
  used: number
  afterEmpty: number
  byMeaning: number
  exactLines: number
  multiFile: number
  filesChanged: number
}

declare module 'claude-code' {
  interface PluginState {
    'jbcontext-watch': {
      view: JbView | null
      turn: JbTurn | null
      isBandHidden: boolean
      ledger: JbLedger | null
      badges: Record<string, SearchEffects> | null
      effectCounts: { session: EffectCounts; turn: EffectCounts } | null
      // tool_use_id → how that search delivered.
      trails: Record<string, SearchTrail> | null
      // This turn's searches with something on their badge, in the order they first got it.
      deliveries: string[] | null
    }
  }
}
