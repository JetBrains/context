import { expect, test } from 'claude-code/testing'

import {
  EMPTY_LEDGER,
  ZERO_COUNTS,
  addToDay,
  classifyCall,
  describeEffects,
  describeTurnEffects,
  diffBadges,
  evaluate,
  isAimed,
  isMentioned,
  localPathsInRepo,
  parseLocalOutcome,
  parseSearchOutput,
  reduce,
  shellRead,
  toRepoPath,
  tokenMatch,
  tokens,
} from '../hooks/effects'
import type { LedgerEvent, ParsedHit, UseDetail } from '../hooks/effects'
import type { JbLedger } from '../types'

const REPO = 'github.com/acme/widgets'

const CLI_OUTPUT = [
  'Searched revision: eee5d95b781b',
  '',
  '1. File: src/stats/StatsRecorder.kt',
  '  Content:',
  '     120|     fun appendEvent(event: StatsEvent) {',
  '     121|         val file = statsDir.resolve("$day.json")',
  '     122|         writeAtomically(file, render(event))...',
  '',
  '2. File: src/stats/StatsCommand.kt',
].join('\n')

const MCP_OUTPUT = [
  '1. File: src/billing/RetryPolicy.kt',
  '  Content:',
  '      40| class BackoffSchedule(private val attempts: Int) {',
  '      41|     fun delayFor(attempt: Int): Duration = base * 2.0.pow(attempt)',
  '',
  '2. File: src/billing/RetryPolicy.kt',
  '  Content:',
  '      90|     fun shouldGiveUp(attempt: Int) = attempt >= attempts',
].join('\n')

test('search output: CLI and MCP hits, names-only hits, truncation, multi-repo and empty results', () => {
  const cli = parseSearchOutput(CLI_OUTPUT)!
  expect(cli.hits.map(hit => [hit.path, hit.start, hit.lines, hit.isTruncated])).toEqual([
    ['src/stats/StatsRecorder.kt', 120, 3, true],
    ['src/stats/StatsCommand.kt', null, 0, false],
  ])
  expect(cli.hits[0]!.snippet[2]).toBe('        writeAtomically(file, render(event))')

  expect(parseSearchOutput(MCP_OUTPUT)!.hits.map(hit => hit.start)).toEqual([40, 90])

  const multi = parseSearchOutput(
    ['1. widgets: File: a/One.kt', '  Content:', '       1| one', '', '---', '', '1. https://github.com/acme/other: File: b/Two.kt'].join('\n'),
  )!
  expect(multi.hits.map(hit => [hit.label, hit.path])).toEqual([
    ['widgets', 'a/One.kt'],
    ['https://github.com/acme/other', 'b/Two.kt'],
  ])

  expect(parseSearchOutput('Searched revision: abc\n\nNo relevant results found. Try rephrasing your query.')).toEqual({ hits: [] })
  expect(parseSearchOutput('No results found')).toEqual({ hits: [] })
  expect(parseSearchOutput('Error: index not found')).toBe(null)

  const json = parseSearchOutput(
    JSON.stringify({
      type: 'search_result',
      results: [{ result: { sourcePosition: { relativePath: 'a.kt' } }, content: 'x\ny', contentStartLine: 7 }],
    }),
  )!
  expect(json.hits.map(hit => [hit.path, hit.start, hit.lines])).toEqual([['a.kt', 7, 2]])
})

test('calls are sorted into searches, local searches, reads and edits', () => {
  expect(classifyCall('mcp__jbcontext__code_search', { text: 'x' })).toBe('search')
  expect(classifyCall('mcp__jbcontext__find_repositories', { query: 'x' })).toBe(null)
  expect(classifyCall('Bash', { command: 'jbcontext search "billing retry"' })).toBe('search')
  expect(classifyCall('Bash', { command: 'jbcontext repos "billing"' })).toBe(null)
  expect(classifyCall('Grep', { pattern: 'x' })).toBe('local')
  expect(classifyCall('Bash', { command: 'cd /r && rg -n "foo|bar" src | head' })).toBe('local')
  expect(classifyCall('Bash', { command: 'git -C /r grep -n retry' })).toBe('local')
  expect(classifyCall('Bash', { command: 'find . -name "*.kt"' })).toBe('local')
  expect(classifyCall('Bash', { command: "sed -n '40,80p' src/a.kt" })).toBe('read')
  expect(classifyCall('Bash', { command: 'cat src/a.kt' })).toBe('read')
  expect(classifyCall('Bash', { command: 'ls src' })).toBe(null)
  expect(classifyCall('Read', { file_path: '/r/a.kt' })).toBe('read')
  expect(classifyCall('Edit', { file_path: '/r/a.kt' })).toBe('edit')
  expect(classifyCall('Write', { file_path: '/r/a.kt' })).toBe('edit')
  expect(shellRead("sed -n '40,80p' src/a.kt")).toEqual({ path: 'src/a.kt', start: 40, end: 80, isPartial: true })
})

test('local searches: empty, found with paths, failed', () => {
  expect(parseLocalOutcome('Grep', { pattern: 'BackoffSchedule' }, 'No files found', false)).toEqual({
    outcome: 'empty',
    paths: [],
    patterns: ['BackoffSchedule'],
  })
  const rg = { command: 'rg -n "retry policy" src' }
  expect(parseLocalOutcome('Bash', rg, 'Exit code 1', true).outcome).toBe('empty')
  expect(parseLocalOutcome('Bash', rg, '', false).outcome).toBe('empty')
  expect(parseLocalOutcome('Bash', rg, '(Bash completed with no output)', false).outcome).toBe('empty')
  expect(parseLocalOutcome('Bash', rg, 'Exit code 2\nrg: regex parse error', true).outcome).toBe('failed')
  expect(parseLocalOutcome('Bash', { command: 'grep -rn retry src | wc -l' }, '0', false).outcome).toBe('empty')
  expect(parseLocalOutcome('Bash', rg, 'src/a.kt:12:retry\nsrc/a.kt:20:retry\nsrc/b.kt:3:retry', false)).toEqual({
    outcome: 'found',
    paths: ['src/a.kt', 'src/b.kt'],
    patterns: ['retry policy'],
  })
  expect(parseLocalOutcome('Bash', { command: 'find . -iname "*retry*"' }, './src/RetryPolicy.kt', false)).toEqual({
    outcome: 'found',
    paths: ['./src/RetryPolicy.kt'],
    patterns: ['*retry*'],
  })
  expect(parseLocalOutcome('Bash', { command: 'grep -rn -e backoff -A 3 src' }, 'Exit code 1', true).patterns).toEqual(['backoff'])
})

test('words: identifiers split, stopwords dropped, stems matched', () => {
  expect([...tokens('HTTPServerConfig stats_writer')]).toEqual(['http', 'server', 'config', 'stat', 'writer'])
  expect([...tokens('where is the code that handles retries')]).toEqual(['retry'])
  expect(tokenMatch('write', 'writer')).toBe(true)
  expect(tokenMatch('retry', 'retry')).toBe(true)
  expect(tokenMatch('ret', 'retry')).toBe(false)
})

test('paths: repository-relative, worktrees, outside the repository, mentions', () => {
  expect(toRepoPath('/r/src/a.kt', '/r')).toBe('src/a.kt')
  expect(toRepoPath('/r/.claude/worktrees/fix/src/a.kt', '/r')).toBe('src/a.kt')
  expect(toRepoPath('/elsewhere/a.kt', '/r')).toBe(null)
  expect(toRepoPath('./src/a.kt', '/r')).toBe('src/a.kt')
  expect(localPathsInRepo(['a.kt'], 'cd /r/src && rg -n x', '/r')).toEqual(['src/a.kt'])
  expect(isMentioned(['a.kt'], 'src/a.kt')).toBe(true)
  expect(isMentioned(['src/b.kt'], 'src/a.kt')).toBe(false)
})

// ---------- the ledger ----------

let seq = 0
const search = (id: string, hits: ParsedHit[], query = 'billing retry backoff', loop = 'main'): LedgerEvent => ({
  type: 'search',
  id,
  loop,
  doneSeq: ++seq,
  query,
  hits,
  repoKey: REPO,
})
const local = (outcome: 'empty' | 'found', paths: string[] = [], patterns: string[] = ['RetryPolicy'], loop = 'main'): LedgerEvent => ({
  type: 'local',
  loop,
  seq: ++seq,
  outcome,
  paths,
  patterns,
})
const read = (path: string, start = 1, end = 40, isPartial = true): LedgerEvent => {
  const startSeq = ++seq
  return { type: 'use', path, startSeq, doneSeq: ++seq, detail: { kind: 'read', start, end, isPartial } }
}
const edit = (path: string, hunks: { start: number; end: number }[] = [], oldLines: string[] = []): LedgerEvent => {
  const startSeq = ++seq
  return { type: 'use', path, startSeq, doneSeq: ++seq, detail: { kind: 'edit', hunks, oldLines } }
}
const hit = (path: string, start: number | null = 40, lines = 2, snippet: string[] = [], label: string | null = null): ParsedHit => ({
  path,
  label,
  start,
  lines: start === null ? 0 : lines,
  isTruncated: false,
  snippet,
})

function run(events: LedgerEvent[], ledger: JbLedger = { ...EMPTY_LEDGER, turn: 1 }) {
  let badges = {}
  let counts = ZERO_COUNTS
  for (const event of events) {
    const result = reduce(ledger, event)
    ledger = result.ledger
    const diff = diffBadges(badges, ledger, result.changed)
    badges = diff.badges
    for (const key of Object.keys(counts) as (keyof typeof counts)[]) counts = { ...counts, [key]: counts[key] + diff.delta[key] }
  }
  return { ledger, badges: badges as Record<string, ReturnType<typeof evaluate>>, counts }
}

test('found after empty greps: credited once a hit is used, not for a read issued beside the search', () => {
  const sideBySide = { type: 'use', path: 'src/billing/RetryPolicy.kt', startSeq: seq + 1, doneSeq: seq + 3, detail: { kind: 'read', start: 1, end: 40, isPartial: true } } as LedgerEvent
  const parallel = run([local('empty'), local('empty'), search('s1', [hit('src/billing/RetryPolicy.kt')]), sideBySide])
  expect(parallel.badges.s1).toBeUndefined()

  const { badges, counts } = run([local('empty'), local('empty'), search('s1', [hit('src/billing/RetryPolicy.kt')]), read('src/billing/RetryPolicy.kt')])
  expect(badges.s1?.afterEmpty).toBe(2)
  expect(counts.afterEmpty).toBe(1)

  // One empty grep counts only when it hunted for what the query asks.
  const one = run([local('empty', [], ['BackoffSchedule']), search('s1', [hit('src/a.kt')], 'backoff schedule for retries'), read('src/a.kt')])
  expect(one.badges.s1?.afterEmpty).toBe(1)
  const unrelated = run([local('empty', [], ['TODO']), search('s1', [hit('src/a.kt')]), read('src/a.kt')])
  expect(unrelated.badges.s1?.afterEmpty).toBe(0)
})

test('greps that returned results earn the search no grep effect', () => {
  const missed = run([local('found', ['src/other.kt']), local('empty'), search('s1', [hit('src/a.kt')]), read('src/a.kt')])
  expect(missed.badges.s1?.afterEmpty).toBe(0)
  expect(missed.badges.s1?.usedFiles).toBe(1)
  expect(describeEffects(missed.badges.s1!)).not.toMatch(/grep/)
})

test('exact lines: an aimed read or edit, not a whole-file read', () => {
  const file = { ranges: [{ start: 120, end: 122, isTruncated: true }], snippet: ['writeAtomically(file, render(event))'] }
  const aimed = (detail: UseDetail) => isAimed(detail, file)
  expect(aimed({ kind: 'read', start: 100, end: 160, isPartial: true })).toBe(true)
  expect(aimed({ kind: 'read', start: 1, end: 900, isPartial: false })).toBe(false)
  expect(aimed({ kind: 'read', start: 140, end: 150, isPartial: true })).toBe(true)
  expect(aimed({ kind: 'read', start: 200, end: 260, isPartial: true })).toBe(false)
  expect(aimed({ kind: 'edit', hunks: [{ start: 121, end: 121 }], oldLines: [] })).toBe(true)
  expect(aimed({ kind: 'edit', hunks: [{ start: 400, end: 401 }], oldLines: ['    writeAtomically(file, render(event))'] })).toBe(true)
  expect(aimed({ kind: 'edit', hunks: [{ start: 400, end: 401 }], oldLines: ['}'] })).toBe(false)
  expect(isAimed({ kind: 'read', start: 1, end: 40, isPartial: true }, { ranges: [], snippet: [] })).toBe(false)

  const { badges, counts } = run([search('s1', [hit('src/a.kt', 40, 2)]), read('src/a.kt', 30, 70)])
  expect(badges.s1?.exactLines).toBe(true)
  expect(counts.exactLines).toBe(1)
})

test('several files to change from one search; a file edited twice counts once', () => {
  const { badges, counts } = run([
    search('s1', [hit('src/a.kt'), hit('src/b.kt', null), hit('src/c.kt')]),
    edit('src/a.kt'),
    edit('src/a.kt'),
    edit('src/b.kt'),
  ])
  expect(badges.s1?.filesChanged).toBe(2)
  expect(counts.multiFile).toBe(1)
  expect(counts.filesChanged).toBe(2)
})

test('found by meaning: no word of the query in the used file', () => {
  const meaning = run([
    search('s1', [hit('src/billing/Schedule.kt', 40, 2, ['class Schedule(private val attempts: Int) {'])], 'exponential delay between payment attempts'),
    read('src/billing/Schedule.kt'),
  ])
  // "attempts" is in the snippet: a name match, not a meaning match.
  expect(meaning.badges.s1?.byMeaning).toBe(false)
  const byMeaning = run([
    search('s2', [hit('src/billing/Schedule.kt', 40, 2, ['fun next(n: Int): Duration = base * 2.0.pow(n)'])], 'exponential backoff between payment retries'),
    read('src/billing/Schedule.kt'),
  ])
  expect(byMeaning.badges.s2?.byMeaning).toBe(true)
})

test('discovery goes to the first search that listed the file; uses to every search', () => {
  const { badges } = run([
    local('empty'),
    local('empty'),
    search('s1', [hit('src/a.kt')]),
    search('s2', [hit('src/a.kt')]),
    read('src/a.kt', 30, 60),
  ])
  expect(badges.s1?.afterEmpty).toBe(2)
  expect(badges.s2?.afterEmpty).toBe(0)
  expect(badges.s2?.exactLines).toBe(true)
})

test('other repositories, subagents, repeated uses and the search lifetime', () => {
  const foreign = run([search('s1', [hit('src/a.kt', 40, 2, [], 'https://github.com/acme/other')]), read('src/a.kt')])
  expect(foreign.badges.s1).toBeUndefined()
  const ownLabel = run([search('s1', [hit('src/a.kt', 40, 2, [], 'widgets')]), read('src/a.kt')])
  expect(ownLabel.badges.s1?.usedFiles).toBe(1)

  // A subagent's search is credited by the main loop's edits.
  const sub = run([search('s1', [hit('src/a.kt'), hit('src/b.kt')], 'billing retry backoff', 'a1'), edit('src/a.kt'), edit('src/b.kt')])
  expect(sub.badges.s1?.filesChanged).toBe(2)
  // A subagent's empty greps stay its own: they do not feed the main loop's search.
  const isolated = run([local('empty', [], ['x'], 'a1'), local('empty', [], ['x'], 'a1'), search('s1', [hit('src/a.kt')]), read('src/a.kt')])
  expect(isolated.badges.s1?.usedFiles).toBe(1)
  expect(isolated.badges.s1?.afterEmpty).toBe(0)

  const twice = run([search('s1', [hit('src/a.kt')]), read('src/a.kt'), read('src/a.kt')])
  expect(twice.counts.used).toBe(1)

  // Uses count in the search's turn and the next one, not after.
  const first = run([search('s1', [hit('src/a.kt')])])
  const next = run([{ type: 'turn' }, edit('src/a.kt')], first.ledger)
  expect(next.badges.s1?.filesChanged).toBe(1)
  const later = run([{ type: 'turn' }, { type: 'turn' }, edit('src/a.kt')], first.ledger)
  expect(later.badges.s1).toBeUndefined()
})

test('the badge and the band say what was achieved, nothing when nothing was', () => {
  expect(
    describeEffects({ afterEmpty: 3, byMeaning: false, exactLines: true, filesChanged: 2, usedFiles: 2 }),
  ).toBe('↳ found after 3 empty greps · exact lines · 2 files changed')
  expect(describeEffects({ afterEmpty: 0, byMeaning: true, exactLines: false, filesChanged: 1, usedFiles: 1 })).toBe(
    '↳ found by meaning, not by name',
  )
  expect(describeEffects({ afterEmpty: 0, byMeaning: false, exactLines: false, filesChanged: 1, usedFiles: 1 })).toBe(null)
  expect(describeTurnEffects({ ...ZERO_COUNTS, afterEmpty: 1, exactLines: 2, multiFile: 1 })).toBe(
    'jbcontext delivered: 1 found after empty greps · 2 at the exact lines · 1 search → several files changed',
  )
  expect(describeTurnEffects({ ...ZERO_COUNTS, searches: 3, used: 2 })).toBe(null)
})

test('daily totals add up and keep the newest days', () => {
  const one = addToDay(undefined, '2026-11-18', { ...ZERO_COUNTS, afterEmpty: 1 })
  const two = addToDay(one, '2026-11-18', { ...ZERO_COUNTS, afterEmpty: 1, exactLines: 1 })
  expect(two.days['2026-11-18']).toEqual({ ...ZERO_COUNTS, afterEmpty: 2, exactLines: 1 })
  const kept = addToDay(addToDay(two, '2026-11-19', ZERO_COUNTS, 2), '2026-11-20', ZERO_COUNTS, 2)
  expect(Object.keys(kept.days)).toEqual(['2026-11-19', '2026-11-20'])
})
