// A search's hit counts once it is used: its file read or edited after the search
// finished. Five effects are credited to a search:
//  1. afterEmpty  - local searches came up empty, then it found a file that got used;
//  2. byMeaning   - a used file shares no word with the query;
//  3. exactLines  - a read or an edit landed on the lines it pointed at;
//  4. missedBy    - local searches returned results, none of them the used file it found;
//  5. filesChanged - several of its files got edited.
// 1, 2 and 4 claim a discovery, so they go only to the first search of the turn that
// listed the file and only when the turn had not seen the file before; 3 and 5 go to
// every search that held it.

import type {
  EffectCounts,
  HitFile,
  HitRange,
  HitUse,
  JbLedger,
  LoopWindow,
  SearchEffects,
  SearchRecord,
} from '../types'
import { commandSegments, isJbcontextSearch, normalizeRepo, repoName } from './model'

export type CallRole = 'search' | 'local' | 'read' | 'edit'

const LOCAL_SEARCH_COMMANDS = new Set(['grep', 'egrep', 'fgrep', 'rg', 'ag', 'ack', 'find', 'fd'])
const READ_TOOLS = new Set(['Read', 'NotebookRead'])
const EDIT_TOOLS = new Set(['Edit', 'MultiEdit', 'Write', 'NotebookEdit'])

// What a tool call is to the effects: a jbcontext search, a local search, a read or an
// edit of a file, or none of these.
export function classifyCall(tool: string, args: unknown): CallRole | null {
  if (isJbcontextSearch(tool, args)) return 'search'
  if (tool === 'Grep' || tool === 'Glob') return 'local'
  if (READ_TOOLS.has(tool)) return 'read'
  if (EDIT_TOOLS.has(tool)) return 'edit'
  if (tool !== 'Bash') return null
  const command = (args as { command?: unknown } | null)?.command
  if (typeof command !== 'string') return null
  const first = commandSegments(command)[0]
  if (!first) return null
  const name = first[0]!.split('/').pop()!
  if (LOCAL_SEARCH_COMMANDS.has(name)) return 'local'
  if (name === 'git' && ['grep', 'ls-files'].includes(gitSub(first) ?? '')) return 'local'
  if (shellRead(command) !== null) return 'read'
  return null
}

function gitSub(words: string[]): string | undefined {
  return words[1] === '-C' ? words[3] : words[1]
}

// ---------- shell words ----------

// A shell command's commands, split at `&&`, `||`, `;`, `|` and newlines, each as its
// words with quotes removed (unlike commandSegments, which blanks quoted strings).
export function shellWords(command: string): string[][] {
  const segments: string[][] = [[]]
  const token = /"((?:[^"\\]|\\.)*)"|'([^']*)'|(\|\||&&|[|;&\n])|([^\s|;&"']+)/g
  for (let match = token.exec(command); match; match = token.exec(command)) {
    if (match[3] !== undefined) {
      segments.push([])
      continue
    }
    const text = match[1] !== undefined ? match[1].replace(/\\(.)/g, '$1') : (match[2] ?? match[4] ?? '')
    segments[segments.length - 1]!.push(text)
  }
  return segments.filter(words => words.length > 0 && words[0] !== 'cd' && !/^[A-Za-z_]\w*=/.test(words[0]!))
}

// The directory a command's leading `cd <dir> &&` moves to, when it names one.
function leadingCd(command: string): string | null {
  const match = /^\s*cd\s+("([^"]+)"|'([^']+)'|(\S+))\s*(?:&&|;)/.exec(command)
  return match ? (match[2] ?? match[3] ?? match[4] ?? null) : null
}

// A shell command that prints part or all of one file: `sed -n 'A,Bp' file` or `cat file`.
export function shellRead(command: string): { path: string; start: number; end: number; isPartial: boolean } | null {
  const segment = shellWords(command)[0]
  if (!segment) return null
  const name = segment[0]!.split('/').pop()!
  const files = segment.slice(1).filter(word => !word.startsWith('-'))
  if (name === 'sed' && segment.includes('-n')) {
    const range = files.map(word => /^(\d+)(?:,(\d+))?p$/.exec(word)).find(Boolean)
    const path = files.filter(word => !/^\d+(?:,\d+)?p$/.test(word))
    if (!range || path.length !== 1) return null
    const start = Number(range[1])
    return { path: path[0]!, start, end: Number(range[2] ?? range[1]), isPartial: true }
  }
  if (name === 'cat' && files.length === 1) return { path: files[0]!, start: 1, end: Number.MAX_SAFE_INTEGER, isPartial: false }
  return null
}

// ---------- jbcontext search output ----------

export type ParsedHit = {
  path: string
  // The repository label printed before `File:`, or null when none was.
  label: string | null
  start: number | null
  lines: number
  isTruncated: boolean
  snippet: string[]
}

const NO_RESULTS = /^(?:No relevant results found|No results found)/m
const HIT_HEADER = /^\s*\d+\.\s+(?:(.+?):\s+)?File:\s+(.+?)\s*$/
const NUMBERED_LINE = /^\s*(\d+)\|\s?(.*)$/
const TRUNCATED = /\.\.\.\s*$/

// The hits of a jbcontext search, as its CLI or MCP output printed them (the hybrid
// text, or the CLI's `--json-output` line); null when the text is no search output.
export function parseSearchOutput(text: string): { hits: ParsedHit[] } | null {
  const json = parseSearchJson(text)
  if (json !== null) return json

  const hits: ParsedHit[] = []
  let current: ParsedHit | null = null
  for (const line of text.split('\n')) {
    const header = HIT_HEADER.exec(line)
    if (header) {
      current = { path: header[2]!, label: header[1] ?? null, start: null, lines: 0, isTruncated: false, snippet: [] }
      hits.push(current)
      continue
    }
    const numbered = current ? NUMBERED_LINE.exec(line) : null
    if (current && numbered) {
      if (current.start === null) current.start = Number(numbered[1])
      current.lines++
      current.snippet.push(numbered[2] ?? '')
      continue
    }
    if (line.trim() === '---') current = null
  }
  for (const hit of hits) {
    const last = hit.snippet.length - 1
    if (last >= 0 && TRUNCATED.test(hit.snippet[last]!)) {
      hit.isTruncated = true
      hit.snippet[last] = hit.snippet[last]!.replace(TRUNCATED, '')
    }
  }
  if (hits.length > 0) return { hits }
  return NO_RESULTS.test(text) ? { hits: [] } : null
}

function parseSearchJson(text: string): { hits: ParsedHit[] } | null {
  const lines = text.split('\n').filter(line => line.trimStart().startsWith('{"type":"search_result"'))
  if (lines.length === 0) return null
  const hits: ParsedHit[] = []
  for (const line of lines) {
    let parsed
    try {
      parsed = JSON.parse(line)
    } catch {
      continue
    }
    for (const one of Array.isArray(parsed?.results) ? parsed.results : []) {
      const path = one?.result?.sourcePosition?.relativePath
      if (typeof path !== 'string') continue
      const content = typeof one.content === 'string' ? one.content.split('\n') : []
      hits.push({
        path,
        label: typeof parsed.repository === 'string' ? parsed.repository : null,
        start: typeof one.contentStartLine === 'number' ? one.contentStartLine : null,
        lines: content.length,
        isTruncated: false,
        snippet: content,
      })
    }
  }
  return { hits }
}

// Whether a hit's repository label names the session's repository.
export function isThisRepo(label: string | null, repoKey: string | null): boolean {
  if (label === null) return true
  if (repoKey === null) return false
  const normalized = normalizeRepo(label)
  return normalized === repoKey || normalized === repoName(repoKey).toLowerCase()
}

const MAX_SNIPPET_LINES = 40

// The hits grouped by file, their ranges merged.
export function groupHits(hits: ParsedHit[], repoKey: string | null): Omit<HitFile, 'isKnown' | 'isFirstFinder'>[] {
  const files = new Map<string, Omit<HitFile, 'isKnown' | 'isFirstFinder'>>()
  for (const hit of hits) {
    const repo = isThisRepo(hit.label, repoKey) ? null : hit.label
    const path = stripDot(hit.path)
    const key = `${repo ?? ''}|${path}`
    const file = files.get(key) ?? { path, repo, ranges: [], snippet: [], use: null }
    if (hit.start !== null && hit.lines > 0) {
      file.ranges.push({ start: hit.start, end: hit.start + hit.lines - 1, isTruncated: hit.isTruncated })
    }
    for (const line of hit.snippet) {
      const trimmed = line.trim()
      if (trimmed.length >= 8 && file.snippet.length < MAX_SNIPPET_LINES) file.snippet.push(trimmed)
    }
    files.set(key, file)
  }
  return [...files.values()]
}

// ---------- local searches ----------

export type LocalOutcome = { outcome: 'empty' | 'found' | 'failed'; paths: string[]; patterns: string[] }

const MAX_LOCAL_PATHS = 500
const FAILURE = /regex parse error|No such file or directory|Invalid (?:regular expression|argument)|unrecognized option|unknown option/i

// How a local search went, from its output: empty, found something (and which files it
// named), or failed (an error, which says nothing about the code).
export function parseLocalOutcome(tool: string, args: unknown, text: string, isError: boolean): LocalOutcome {
  const record = (args ?? {}) as Record<string, unknown>
  const patterns = localPatterns(tool, record)
  const exit = /^\s*Exit code (\d+)/m.exec(text)
  const code = exit ? Number(exit[1]) : isError ? 1 : 0
  const body = text
    .replace(/^\s*Exit code \d+\s*$/m, '')
    // The placeholder the model reads for a command that printed nothing.
    .replace(/^\s*\([^()\n]*\bno (?:output|content)\)\s*$/im, '')
    .trim()

  if (code >= 2 || (FAILURE.test(body) && !/^\S+:\d+:/m.test(body))) return { outcome: 'failed', paths: [], patterns }
  if (/^No (?:files|matches) found/i.test(body) || body === '') return { outcome: 'empty', paths: [], patterns }
  const command = typeof record.command === 'string' ? record.command : ''
  if (/\|\s*wc\s+-l\s*$/.test(command) && body === '0') return { outcome: 'empty', paths: [], patterns }

  const paths: string[] = []
  for (const line of body.split('\n')) {
    if (paths.length >= MAX_LOCAL_PATHS) break
    const trimmed = line.trim()
    const withLine = /^(\S+?):\d+(?:[:-]|$)/.exec(trimmed)
    if (withLine) paths.push(withLine[1]!)
    else if (/^[^\s:]+$/.test(trimmed) && (trimmed.includes('/') || /\.\w{1,8}$/.test(trimmed))) paths.push(trimmed)
  }
  return { outcome: 'found', paths: [...new Set(paths)], patterns }
}

const VALUE_FLAGS = new Set(['-A', '-B', '-C', '-m', '-g', '-t', '-T', '--glob', '--type', '--max-count', '-f', '--include', '--exclude', '--context', '-d', '--max-depth'])

function localPatterns(tool: string, record: Record<string, unknown>): string[] {
  if (tool === 'Grep' || tool === 'Glob') return typeof record.pattern === 'string' ? [record.pattern] : []
  const command = typeof record.command === 'string' ? record.command : ''
  const segment = shellWords(command)[0]
  if (!segment) return []
  const name = segment[0]!.split('/').pop()!
  const words = name === 'git' ? segment.slice(segment[1] === '-C' ? 4 : 2) : segment.slice(1)
  if (name === 'find') {
    return words.flatMap((word, at) => (['-name', '-iname', '-path', '-regex'].includes(word) && words[at + 1] ? [words[at + 1]!] : []))
  }
  const explicit = words.flatMap((word, at) => (word === '-e' && words[at + 1] ? [words[at + 1]!] : []))
  if (explicit.length > 0) return explicit
  for (let at = 0; at < words.length; at++) {
    const word = words[at]!
    if (VALUE_FLAGS.has(word)) {
      at++
      continue
    }
    if (!word.startsWith('-')) return [word]
  }
  return []
}

// ---------- paths ----------

function stripDot(path: string): string {
  return path.replace(/^\.\//, '')
}

// A path as the repository names it: relative paths kept (they name the repository's
// files), absolute ones under the root, a worktree's under `.claude/worktrees/<name>/`
// included, made relative; null for a path outside the repository.
export function toRepoPath(path: string, root: string): string | null {
  if (!path.startsWith('/')) return stripDot(path)
  const base = root.replace(/\/+$/, '')
  if (base === '' || !path.startsWith(`${base}/`)) return null
  const relative = path.slice(base.length + 1)
  const worktree = /^\.claude\/worktrees\/[^/]+\/(.+)$/.exec(relative)
  return worktree ? worktree[1]! : relative
}

// Whether a local search's mention names this file: the same path, or one is the
// other's tail (a search run from a subdirectory names its files relative to it).
export function isMentioned(seen: readonly string[], path: string): boolean {
  return seen.some(one => one === path || one.endsWith(`/${path}`) || path.endsWith(`/${one}`))
}

// A local search's paths as the repository names them, a leading `cd` honoured.
export function localPathsInRepo(paths: string[], command: string | null, root: string): string[] {
  const cd = command ? leadingCd(command) : null
  return paths
    .map(path => (path.startsWith('/') || cd === null || !cd.startsWith('/') ? path : `${cd.replace(/\/+$/, '')}/${stripDot(path)}`))
    .map(path => toRepoPath(path, root))
    .filter((path): path is string => path !== null)
}

// ---------- words ----------

const STOPWORDS = new Set([
  // English
  'the', 'and', 'for', 'with', 'that', 'this', 'from', 'into', 'are', 'was', 'were', 'which', 'what', 'when', 'who',
  'its', 'all', 'any', 'can', 'does', 'not', 'but', 'has', 'have', 'our', 'their', 'there', 'then', 'than', 'out',
  'about', 'over', 'under', 'via', 'per', 'each', 'other', 'some', 'such', 'only',
  // query filler
  'where', 'how', 'why', 'find', 'finds', 'code', 'implement', 'implements', 'implementation', 'implemented', 'handle',
  'handles', 'handled', 'handling',
  'logic', 'use', 'used', 'using', 'function', 'method', 'class', 'file', 'files', 'place', 'part', 'way', 'done',
  'happen', 'happens', 'work', 'works', 'located', 'defined', 'definition', 'responsible',
  // language keywords
  'const', 'let', 'var', 'val', 'fun', 'def', 'return', 'import', 'export', 'public', 'private', 'protected', 'static',
  'void', 'new', 'true', 'false', 'null', 'undefined', 'string', 'int', 'boolean', 'number', 'async', 'await', 'else',
  'override', 'internal', 'object', 'interface', 'type', 'package',
])

function stem(word: string): string {
  if (word.length > 4 && word.endsWith('ies')) return `${word.slice(0, -3)}y`
  if (word.length > 5 && word.endsWith('ing')) return word.slice(0, -3)
  if (word.length > 4 && word.endsWith('ed')) return word.slice(0, -2)
  if (word.length > 4 && word.endsWith('es')) return word.slice(0, -2)
  if (word.length > 3 && word.endsWith('s') && !word.endsWith('ss')) return word.slice(0, -1)
  return word
}

// The meaningful words of a text, identifiers split (`HTTPServerConfig` is http, server,
// config; `stats_writer` is stats, writer), lowercased, stemmed, stopwords and words
// under 3 letters dropped.
export function tokens(text: string): Set<string> {
  const out = new Set<string>()
  for (const word of text.split(/[^A-Za-z0-9]+/)) {
    const parts = word
      .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
      .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
      .replace(/([A-Za-z])(\d)/g, '$1 $2')
      .replace(/(\d)([A-Za-z])/g, '$1 $2')
      .split(' ')
    for (const part of parts) {
      const lower = part.toLowerCase()
      if (lower.length < 3 || /^\d+$/.test(lower) || STOPWORDS.has(lower)) continue
      out.add(stem(lower))
    }
  }
  return out
}

// Two stems name the same thing: equal, or the shorter (4 letters or more) begins the
// longer (`write` and `writer`).
export function tokenMatch(a: string, b: string): boolean {
  if (a === b) return true
  const [shorter, longer] = a.length <= b.length ? [a, b] : [b, a]
  return shorter.length >= 4 && longer.startsWith(shorter)
}

function sharesWord(a: Set<string>, b: Set<string>): boolean {
  for (const one of a) for (const other of b) if (tokenMatch(one, other)) return true
  return false
}

// ---------- the ledger ----------

export const EMPTY_WINDOW: LoopWindow = { empty: 0, nonEmpty: 0, patterns: [] }
export const EMPTY_LEDGER: JbLedger = { turn: 0, seq: 0, seen: [], windows: {}, searches: [] }

const MAX_SEEN = 5_000
const MAX_SEARCHES = 50
const MAX_PATTERNS = 20

// Lines a read or an edit may be off a hit's range and still be at it; and the most a
// read may span to count as aimed (a whole-file read is aimed at nothing).
const NEAR = 10
const TRUNCATED_SLACK = 20
const MAX_AIMED_READ = 300

export type UseDetail =
  | { kind: 'read'; start: number; end: number; isPartial: boolean }
  | { kind: 'edit'; hunks: { start: number; end: number }[]; oldLines: string[] }

export type LedgerEvent =
  | { type: 'turn' }
  | { type: 'search'; id: string; loop: string; doneSeq: number; query: string; hits: ParsedHit[]; repoKey: string | null }
  | { type: 'local'; loop: string; seq: number; outcome: LocalOutcome['outcome']; paths: string[]; patterns: string[] }
  | { type: 'use'; path: string; startSeq: number; doneSeq: number; detail: UseDetail }

// The ledger after one event, and the ids of the searches whose effects may have changed.
export function reduce(ledger: JbLedger, event: LedgerEvent): { ledger: JbLedger; changed: string[] } {
  switch (event.type) {
    case 'turn': {
      const turn = ledger.turn + 1
      return {
        ledger: { ...ledger, turn, seen: [], windows: {}, searches: ledger.searches.filter(one => one.turn >= turn - 1) },
        changed: [],
      }
    }
    case 'search': {
      const window = ledger.windows[event.loop] ?? EMPTY_WINDOW
      const earlier = ledger.searches.filter(one => one.turn === ledger.turn)
      const files: HitFile[] = groupHits(event.hits, event.repoKey).map(file => ({
        ...file,
        isKnown: file.repo === null && isMentioned(ledger.seen, file.path),
        isFirstFinder: !earlier.some(one => one.files.some(other => other.repo === file.repo && other.path === file.path)),
      }))
      const record: SearchRecord = {
        id: event.id,
        turn: ledger.turn,
        loop: event.loop,
        doneSeq: event.doneSeq,
        query: event.query,
        files,
        window,
      }
      // A search that found nothing leaves the loop's empty greps to the next one.
      const windows = files.length > 0 ? { ...ledger.windows, [event.loop]: EMPTY_WINDOW } : ledger.windows
      return {
        ledger: {
          ...ledger,
          seq: Math.max(ledger.seq, event.doneSeq),
          windows,
          searches: [...ledger.searches, record].slice(-MAX_SEARCHES),
        },
        changed: [],
      }
    }
    case 'local': {
      if (event.outcome === 'failed') return { ledger: { ...ledger, seq: Math.max(ledger.seq, event.seq) }, changed: [] }
      const window = ledger.windows[event.loop] ?? EMPTY_WINDOW
      const next: LoopWindow = {
        empty: window.empty + (event.outcome === 'empty' ? 1 : 0),
        nonEmpty: window.nonEmpty + (event.outcome === 'found' ? 1 : 0),
        patterns: [...window.patterns, ...event.patterns].slice(-MAX_PATTERNS),
      }
      return {
        ledger: {
          ...ledger,
          seq: Math.max(ledger.seq, event.seq),
          seen: addSeen(ledger.seen, event.paths),
          windows: { ...ledger.windows, [event.loop]: next },
        },
        changed: [],
      }
    }
    case 'use': {
      const changed: string[] = []
      const searches = ledger.searches.map(search => {
        if (search.doneSeq >= event.startSeq) return search
        let isChanged = false
        const files = search.files.map(file => {
          if (file.repo !== null || file.path !== event.path) return file
          const use = mergeUse(file.use, event.detail, file)
          if (sameUse(use, file.use)) return file
          isChanged = true
          return { ...file, use }
        })
        if (!isChanged) return search
        changed.push(search.id)
        return { ...search, files }
      })
      return {
        ledger: { ...ledger, seq: Math.max(ledger.seq, event.doneSeq), seen: addSeen(ledger.seen, [event.path]), searches },
        changed,
      }
    }
  }
}

function addSeen(seen: string[], paths: string[]): string[] {
  const fresh = paths.filter(path => !seen.includes(path))
  return fresh.length === 0 ? seen : [...seen, ...fresh].slice(-MAX_SEEN)
}

function sameUse(a: HitUse | null, b: HitUse | null): boolean {
  return a?.read === b?.read && a?.edited === b?.edited && a?.exact === b?.exact
}

function mergeUse(use: HitUse | null, detail: UseDetail, file: HitFile): HitUse {
  const base = use ?? { read: false, edited: false, exact: false }
  return {
    read: base.read || detail.kind === 'read',
    edited: base.edited || detail.kind === 'edit',
    exact: base.exact || isAimed(detail, file),
  }
}

function widened(range: HitRange): { start: number; end: number } {
  return { start: range.start - NEAR, end: range.end + NEAR + (range.isTruncated ? TRUNCATED_SLACK : 0) }
}

function overlaps(a: { start: number; end: number }, b: { start: number; end: number }): boolean {
  return a.start <= b.end && b.start <= a.end
}

// Whether a read or an edit landed on the lines the hit pointed at.
export function isAimed(detail: UseDetail, file: Pick<HitFile, 'ranges' | 'snippet'>): boolean {
  if (file.ranges.length === 0) return false
  if (detail.kind === 'read') {
    if (!detail.isPartial || detail.end - detail.start + 1 > MAX_AIMED_READ) return false
    return file.ranges.some(range => overlaps(detail, widened(range)))
  }
  if (detail.hunks.some(hunk => file.ranges.some(range => overlaps(hunk, widened(range))))) return true
  // The same code the hit showed, wherever it has moved to since.
  return detail.oldLines.some(line => {
    const trimmed = line.trim()
    return trimmed.length >= 8 && file.snippet.includes(trimmed)
  })
}

// ---------- effects ----------

export const NO_EFFECTS: SearchEffects = {
  afterEmpty: 0,
  missedBy: 0,
  byMeaning: false,
  exactLines: false,
  filesChanged: 0,
  usedFiles: 0,
}

// What a search has achieved by now.
export function evaluate(search: SearchRecord): SearchEffects {
  const used = search.files.filter(file => file.use !== null)
  const discovered = used.filter(file => file.isFirstFinder && !file.isKnown)
  const { window } = search
  const queryWords = tokens(search.query)
  const patternWords = tokens(window.patterns.join(' '))
  const isEmptyHunt = window.empty >= 2 || (window.empty >= 1 && sharesWord(queryWords, patternWords))
  return {
    afterEmpty: discovered.length > 0 && window.nonEmpty === 0 && isEmptyHunt ? window.empty : 0,
    missedBy: discovered.length > 0 && window.nonEmpty >= 1 ? window.empty + window.nonEmpty : 0,
    byMeaning:
      queryWords.size >= 2 &&
      discovered.some(file => !sharesWord(queryWords, tokens(`${file.path} ${file.snippet.join(' ')}`))),
    exactLines: used.some(file => file.use!.exact),
    filesChanged: used.filter(file => file.use!.edited).length,
    usedFiles: used.length,
  }
}

// Effects never go away once shown: each field keeps the larger of the two.
export function mergeEffects(a: SearchEffects, b: SearchEffects): SearchEffects {
  return {
    afterEmpty: Math.max(a.afterEmpty, b.afterEmpty),
    missedBy: Math.max(a.missedBy, b.missedBy),
    byMeaning: a.byMeaning || b.byMeaning,
    exactLines: a.exactLines || b.exactLines,
    filesChanged: Math.max(a.filesChanged, b.filesChanged),
    usedFiles: Math.max(a.usedFiles, b.usedFiles),
  }
}

export const ZERO_COUNTS: EffectCounts = {
  searches: 0,
  used: 0,
  afterEmpty: 0,
  missedByGrep: 0,
  byMeaning: 0,
  exactLines: 0,
  multiFile: 0,
  filesChanged: 0,
}

// What turning `before` into `after` adds to the counts: a search counts once per effect.
export function countDelta(before: SearchEffects, after: SearchEffects): EffectCounts {
  const turnedOn = (was: boolean, is: boolean) => (!was && is ? 1 : 0)
  return {
    ...ZERO_COUNTS,
    used: turnedOn(before.usedFiles > 0, after.usedFiles > 0),
    afterEmpty: turnedOn(before.afterEmpty > 0, after.afterEmpty > 0),
    missedByGrep: turnedOn(before.missedBy > 0, after.missedBy > 0),
    byMeaning: turnedOn(before.byMeaning, after.byMeaning),
    exactLines: turnedOn(before.exactLines, after.exactLines),
    multiFile: turnedOn(before.filesChanged >= 2, after.filesChanged >= 2),
    filesChanged: Math.max(0, after.filesChanged - before.filesChanged),
  }
}

export function addCounts(a: EffectCounts, b: EffectCounts): EffectCounts {
  const out = { ...a }
  for (const key of Object.keys(b) as (keyof EffectCounts)[]) out[key] = (a[key] ?? 0) + b[key]
  return out
}

export function isZero(counts: EffectCounts): boolean {
  return Object.values(counts).every(value => value === 0)
}

const MAX_BADGES = 200

// The badges after the changed searches are evaluated again, and what that adds to the counts.
export function diffBadges(
  badges: Record<string, SearchEffects>,
  ledger: JbLedger,
  changed: string[],
): { badges: Record<string, SearchEffects>; delta: EffectCounts } {
  let next = badges
  let delta = ZERO_COUNTS
  for (const id of new Set(changed)) {
    const search = ledger.searches.find(one => one.id === id)
    if (!search) continue
    const before = badges[id] ?? NO_EFFECTS
    const after = mergeEffects(before, evaluate(search))
    if (JSON.stringify(after) === JSON.stringify(before)) continue
    if (next === badges) next = { ...badges }
    delete next[id]
    next[id] = after
    delta = addCounts(delta, countDelta(before, after))
  }
  const ids = Object.keys(next)
  if (ids.length > MAX_BADGES) {
    next = { ...next }
    for (const id of ids.slice(0, ids.length - MAX_BADGES)) delete next[id]
  }
  return { badges: next, delta }
}

// ---------- daily totals ----------

export type StoredEffects = { days: Record<string, EffectCounts> }

// The stored daily totals with `delta` added to `day`, days older than the newest `keep` dropped.
export function addToDay(stored: StoredEffects | undefined, day: string, delta: EffectCounts, keep = 30): StoredEffects {
  const days = { ...(stored?.days ?? {}) }
  days[day] = addCounts(days[day] ?? ZERO_COUNTS, delta)
  const kept = Object.keys(days).sort().slice(-keep)
  return { days: Object.fromEntries(kept.map(key => [key, days[key]!])) }
}

// ---------- text ----------

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? '' : 's'}`
}

// The line under a search's row: what it achieved, or null when nothing yet.
export function describeEffects(effects: SearchEffects): string | null {
  const parts: string[] = []
  if (effects.afterEmpty > 0) parts.push(`found after ${plural(effects.afterEmpty, 'empty grep')}`)
  if (effects.missedBy > 0) parts.push(`missed by ${plural(effects.missedBy, 'grep')}`)
  if (effects.byMeaning) parts.push('found by meaning, not by name')
  if (effects.exactLines) parts.push('exact lines')
  if (effects.filesChanged >= 2) parts.push(`${effects.filesChanged} files changed`)
  return parts.length === 0 ? null : `↳ ${parts.join(' · ')}`
}

// The band's line: what this turn's searches achieved, or null when nothing yet.
export function describeTurnEffects(counts: EffectCounts): string | null {
  const parts: string[] = []
  if (counts.afterEmpty > 0) parts.push(`${counts.afterEmpty} found after empty greps`)
  if (counts.missedByGrep > 0) parts.push(`${counts.missedByGrep} missed by greps`)
  if (counts.byMeaning > 0) parts.push(`${counts.byMeaning} found by meaning`)
  if (counts.exactLines > 0) parts.push(`${counts.exactLines} at the exact lines`)
  if (counts.multiFile > 0) parts.push(`${plural(counts.multiFile, 'search')} → several files changed`)
  return parts.length === 0 ? null : `jbcontext delivered: ${parts.join(' · ')}`
}
