import type { RenderElement } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

import {
  claudeProjectDir,
  describeIndex,
  describeSession,
  describeTurn,
  explorationKind,
  explorePrice,
  formatShare,
  isInRepo,
  isJbcontextCall,
  jbcontextUsage,
  mergeDays,
  normalizeRepo,
  parseSessionPhases,
  parseStatsDay,
  parseStatus,
  savedTokens,
  scopeToRepo,
  searchLabel,
  statusLine,
  touchesJbcontext,
} from '../hooks/model'
import type { JbError, JbSearch, JbView } from '../types'

const NOW = Date.parse('2026-10-07T10:00:00Z')
const HEAD = 'a6f44ddb12b8657bd682019566d0f3ff7449f590'

const DAY = JSON.stringify({
  date: '2026-10-07',
  events: [
    {
      type: 'search',
      timestamp: '2026-10-07T09:58:00Z',
      clientType: 'MCP',
      toolName: 'code_search',
      query: 'where is the stats writer',
      repositoryUrls: ['github.com/acme/widgets'],
      resultCount: 12,
      durationMs: 1400,
      success: true,
    },
    {
      type: 'search',
      timestamp: '2026-10-07T09:59:00Z',
      clientType: 'CLI',
      query: 'air assistant button',
      repositoryUrls: ['github.com/jetbrains/air-mobile'],
      resultCount: 3,
      durationMs: 900,
      success: true,
    },
    {
      type: 'indexing',
      timestamp: '2026-10-07T09:50:00Z',
      repositoryUrl: 'github.com/acme/widgets',
      durationMs: 4000,
      success: false,
      errorMessage: 'Token is expired',
    },
    { type: 'api_call', timestamp: '2026-10-07T09:59:00Z', operation: 'x', durationMs: 1, success: false },
  ],
})

const STATUS = JSON.stringify({
  type: 'status_result',
  repositoryId: 'github.com/acme/widgets',
  indices: [
    {
      indexAlias: { name: 'ai.grazie.code.indexing.model.ProductionIndices.CodeBlocks' },
      snapshots: [
        { revision: 'old', branches: ['main'], createdAt: NOW - 86_400_000 },
        { revision: HEAD, branches: ['origin/main', 'main'], createdAt: NOW - 3_600_000 },
      ],
    },
  ],
})

// `$.fs.read` as the engine answers it: a byte range when asked, never more than 4 MiB,
// a character cut at a range edge read as U+FFFD.
const READ_LIMIT = 4 * 1024 * 1024
const utf8 = (text: string) => new TextEncoder().encode(text)
const byteLength = (text: string) => utf8(text).length
const readRange = (text: string, e: { offset?: number; length?: number }) => {
  const bytes = utf8(text)
  const offset = e.offset ?? 0
  const length = e.length ?? bytes.length - offset
  if (length > READ_LIMIT) throw new Error('the answer would be over 4 MiB')
  return { value: new TextDecoder().decode(bytes.subarray(offset, offset + length)) }
}
const fileStat = (text: string) => ({ value: { kind: 'file' as const, size: byteLength(text), mtimeMs: NOW, isLink: false } })

const ran = (stdout: string) => ({
  value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false },
})

test('stats files yield searches and failures, api calls ignored', () => {
  const { searches, errors } = mergeDays([parseStatsDay(DAY), parseStatsDay('not json')])
  expect(searches.map(search => search.query)).toEqual(['air assistant button', 'where is the stats writer'])
  expect(searches[1]?.client).toBe('code_search')
  expect(errors.map(error => error.message)).toEqual(['Token is expired'])
})

test('index status resolves HEAD, branch and fallback snapshots', () => {
  expect(parseStatus(STATUS, HEAD, 'main').index.state).toBe('current')
  expect(parseStatus(STATUS, 'deadbeef', 'main').index).toEqual({
    state: 'stale',
    branch: 'main',
    head: 'deadbeef',
    revision: HEAD,
    at: NOW - 3_600_000,
  })
  expect(parseStatus(STATUS, 'deadbeef', 'feature').index.state).toBe('other')
  expect(parseStatus(JSON.stringify({ indices: [] }), HEAD, 'main').index.state).toBe('none')
  // `storage` is left out of the JSON when it is `remote`.
  expect(parseStatus(STATUS, HEAD, 'main').storage).toBe('remote')
  expect(parseStatus(JSON.stringify({ ...JSON.parse(STATUS), storage: 'local' }), HEAD, 'main').storage).toBe('local')
})

test('the pane tells the snapshots against HEAD; one of another commit is a fact, not a warning', () => {
  expect(describeIndex({ state: 'current', branch: 'main', revision: 'a'.repeat(40), at: NOW - 3_600_000 }, NOW)).toEqual({
    text: 'HEAD aaaaaaaa of main indexed 1h ago',
    color: 'success',
  })
  expect(describeIndex({ state: 'stale', branch: 'main', head: 'b'.repeat(40), revision: 'a'.repeat(40), at: NOW - 3_600_000 }, NOW)).toEqual({
    text: 'HEAD bbbbbbbb not indexed; newest snapshot of main: aaaaaaaa, 1h ago',
    color: undefined,
  })
  expect(describeIndex({ state: 'other', branch: 'feature', head: 'b'.repeat(40), revision: 'a'.repeat(40), at: NOW - 7_200_000 }, NOW)).toEqual({
    text: 'HEAD bbbbbbbb not indexed; feature has no snapshots; newest snapshot: aaaaaaaa, 2h ago',
    color: undefined,
  })
  // A detached HEAD's branch reads `HEAD`, which no snapshot names.
  expect(describeIndex({ state: 'current', branch: 'HEAD', revision: 'a'.repeat(40), at: NOW - 3_600_000 }, NOW).text).toBe('HEAD aaaaaaaa indexed 1h ago')
  expect(describeIndex({ state: 'other', branch: 'HEAD', head: 'b'.repeat(40), revision: 'a'.repeat(40), at: NOW - 3_600_000 }, NOW).text).toBe(
    'HEAD bbbbbbbb not indexed; newest snapshot: aaaaaaaa, 1h ago',
  )
  expect(describeIndex({ state: 'none', branch: 'main' }, NOW).color).toBe('error')
})

test('repository URLs normalize to the stats spelling', () => {
  const key = 'github.com/acme/widgets'
  expect(normalizeRepo('ssh://git@github.com/Acme/widgets.git\n')).toBe(key)
  expect(normalizeRepo('git@github.com:Acme/widgets.git')).toBe(key)
  expect(normalizeRepo('https://github.com/Acme/widgets/')).toBe(key)
  expect(normalizeRepo('ssh://git@git.jetbrains.team:22/ij/ultimate.git')).toBe('git.jetbrains.team/ij/ultimate')
  expect(claudeProjectDir('/Users/dev/Projects/widgets')).toBe('-Users-dev-Projects-widgets')
})

test('repo scope matches by URL, or by directory when no URL is recorded', () => {
  const key = 'github.com/acme/widgets'
  expect(isInRepo({ repos: ['github.com/Acme/widgets'], projectRoot: null }, key, '/r')).toBe(true)
  expect(isInRepo({ repos: ['github.com/jetbrains/air-mobile'], projectRoot: '/r' }, key, '/r')).toBe(false)
  expect(isInRepo({ repos: [], projectRoot: '/r' }, key, '/r/sub')).toBe(true)
  expect(isInRepo({ repos: [], projectRoot: '/r2' }, key, '/r')).toBe(false)
  expect(isInRepo({ repos: [], projectRoot: null }, key, '/r')).toBe(false)
})

test('repo scope keeps errors that name no repository and limits after filtering', () => {
  const key = 'github.com/acme/widgets'
  const search = (at: number, repo: string): JbSearch => ({
    at,
    query: `${repo} ${at}`,
    kind: 'semantic',
    client: 'CLI',
    repos: [repo],
    results: 1,
    durationMs: 1,
    success: true,
    projectRoot: null,
  })
  const error = (at: number, repos: string[]): JbError => ({ at, source: 'error', message: `e${at}`, repos, projectRoot: null })
  const scoped = scopeToRepo(
    {
      searches: [search(4, 'github.com/x/y'), search(3, 'github.com/x/y'), search(2, key), search(1, key)],
      errors: [error(3, ['github.com/x/y']), error(2, []), error(1, [key])],
    },
    key,
    '/r',
    1,
  )
  expect(scoped.searches.map(one => one.at)).toEqual([2])
  expect(scoped.otherSearches).toBe(2)
  expect(scoped.errors.map(one => one.message)).toEqual(['e2'])
  expect(scoped.otherErrors).toBe(1)
})

test('savings count only sessions that used jbcontext with a measured reduction', () => {
  expect(savedTokens({ exploreTokens: 3_000_000, reductionPct: 25, embarkInvoked: true })).toBe(1_000_000)
  expect(savedTokens({ exploreTokens: 3_000_000, reductionPct: 25, embarkInvoked: false })).toBe(0)
  expect(savedTokens({ exploreTokens: 3_000_000, reductionPct: null, embarkInvoked: true })).toBe(0)
  const analyze = JSON.stringify({
    phaseBreakdown: [{ phase: 'Exploring', totalTokensBilled: 2_000_000, totalCostUsd: 1.5 }],
  })
  expect(explorePrice(analyze)).toBe(0.00000075)
  expect(explorePrice('{}')).toBe(null)
})

test('only jbcontext commands count, index runs flagged', () => {
  expect(touchesJbcontext('jbcontext index --project-path .')).toBe('index')
  expect(touchesJbcontext('jbcontext --ci index')).toBe('index')
  expect(touchesJbcontext('jbcontext search "x" | head')).toBe('other')
  expect(touchesJbcontext('git status')).toBe(null)
})

test('exploration calls are reads, greps, globs, listings and read-only shell commands', () => {
  expect(explorationKind('mcp__jbcontext__code_search', { text: 'x' })).toBe('jbcontext')
  expect(explorationKind('Bash', { command: 'jbcontext search --git-remote-url "github.com/a/b" --limit 5 "billing retry"' })).toBe('jbcontext')
  expect(explorationKind('Grep', { pattern: 'x' })).toBe('local')
  expect(explorationKind('Bash', { command: 'cd /r && rg -n "foo|bar" src | head' })).toBe('local')
  expect(explorationKind('Bash', { command: 'git -C /r log --oneline -5' })).toBe('local')
  expect(explorationKind('Bash', { command: "sed -n '1,20p' a.kt" })).toBe('local')
  expect(explorationKind('Bash', { command: 'sed -i s/a/b/ a.kt' })).toBe(null)
  expect(explorationKind('Bash', { command: 'git commit -m "grep fix"' })).toBe(null)
  expect(explorationKind('Edit', { file_path: 'a.kt' })).toBe(null)
})

test('the spinner names the query of a jbcontext call', () => {
  expect(searchLabel('mcp__jbcontext__code_search', { text: 'where is the stats writer' })).toBe('Searching jbcontext: "where is the stats writer"')
  expect(searchLabel('Bash', { command: 'jbcontext search --git-remote-url "github.com/a/b" --limit 10 "billing retry policy" 2>&1 | head' })).toBe(
    'Searching jbcontext: "billing retry policy"',
  )
  expect(searchLabel('Bash', { command: 'jbcontext repos "payments" --limit 30' })).toBe('Finding repositories in jbcontext: "payments"')
  expect(searchLabel('Bash', { command: 'jbcontext search' })).toBe('Searching jbcontext')
  expect(describeTurn({ explorations: 1, jbcontextCalls: 1, jbcontextHits: 1, searching: null, result: null })).toBe(
    'this turn: 1 exploration call · 1 via jbcontext (1 hit)',
  )
})

test('the status line says shortly whether search can use the index, and the session share once measured if jbcontext was used', () => {
  const view = (fields: Partial<JbView>): JbView => ({
    searches: [],
    errors: [],
    otherSearches: 0,
    otherErrors: 0,
    index: { state: 'current', branch: 'main', revision: HEAD, at: NOW },
    storage: 'remote',
    repositoryId: null,
    repoKey: null,
    indexingSince: null,
    savings: null,
    session: null,
    updatedAt: 0,
    ...fields,
  })
  expect(statusLine(view({}))).toBe('jbcontext · remote index ✓')
  expect(statusLine(view({ storage: 'local' }))).toBe('jbcontext · on-device index ✓')
  // A view written before `storage` existed outlives a reload.
  expect(statusLine(view({ storage: undefined as never }))).toBe('jbcontext · remote index ✓')
  expect(statusLine(view({ indexingSince: NOW }))).toBe('jbcontext · indexing…')
  // Search answers from another commit's snapshot, or another branch's, by itself.
  expect(statusLine(view({ index: { state: 'stale', branch: 'main', head: 'b', revision: 'a', at: NOW } }))).toBe('jbcontext · remote index ✓')
  expect(statusLine(view({ index: { state: 'other', branch: 'feature', head: 'b', revision: 'a', at: NOW } }))).toBe('jbcontext · remote index ✓')
  expect(statusLine(view({ index: { state: 'none', branch: 'main' } }))).toBe('jbcontext ✗ repository not indexed')
  expect(statusLine(view({ index: { state: 'unavailable', reason: 'Token is expired' } }))).toBe('jbcontext ✗ Token is expired')
  expect(statusLine(view({ index: { state: 'unavailable', reason: 'not a git repository' } }))).toBe(undefined)
  expect(statusLine(view({ index: null }))).toBe(undefined)
  const session = { sessionId: 's', exploreTokens: 4_000, exploreMs: 1, exploreUsd: 1, totalUsd: 2, jbcontextCalls: 2, jbcontextTokens: 800 }
  expect(statusLine(view({ session }))).toBe('jbcontext · remote index ✓ · session: 20% of exploring via jbcontext')
  expect(statusLine(view({ session: { ...session, jbcontextTokens: 10 } }))).toBe(
    'jbcontext · remote index ✓ · session: <1% of exploring via jbcontext',
  )
  expect(statusLine(view({ session: { ...session, jbcontextCalls: 0, jbcontextTokens: 0 } }))).toBe('jbcontext · remote index ✓')
  // No exploring tokens to take a share of: not `<1%`.
  expect(formatShare({ ...session, exploreTokens: 0, jbcontextTokens: 10 })).toBe('0%')
})

test('during a turn: the spinner says what jbcontext searches, the band counts once jbcontext ran, the status line has the index', async ($, on) => {
  mock.env(on, { HOME: '/home/dev' })
  const clock = mock.clock(on, { now: NOW })
  // The stats file gains the MCP search's event once the call has run.
  let stats = DAY
  let statsMtime = NOW
  on('fs.list', async () => ({
    value: [{ name: '2026-10-07.json', kind: 'file' as const, size: stats.length, mtimeMs: statsMtime, isLink: false }],
  }))
  on('fs.read', async () => ({ value: stats }))
  on('fs.exists', async () => ({ value: true }))
  on('ui.panes', async () => ({ value: [] }))
  on('session.start', async (_$, e) => ({ cwd: e.cwd }))
  on('turn.start', async (_$, e) => ({ turnId: e.turnId }))
  on('command.register', async (_$, e) => ({ value: { command: e.name } }))
  const statuses: (string | undefined)[] = []
  on('ui.status', async (_$, e) => (statuses.push(e.text), { value: undefined }))
  on('ui.render', async ($, e) => {
    const { Text } = $.ui.resolve(e)
    const props = e.props as { message?: string | null; word?: string; suffix?: string }
    return h(Text, {}, props.word !== undefined ? `${props.message ?? props.word}${props.suffix ?? ''}` : 'engine') as RenderElement
  })
  on('process.run', async (_$, e) => {
    if (e.argv[0] === 'git') {
      const stdout = e.argv.includes('--abbrev-ref')
        ? 'main\n'
        : e.argv.includes('remote')
          ? 'git@github.com:Acme/widgets.git\n'
          : `${HEAD}\n`
      return ran(stdout)
    }
    return ran(STATUS)
  })
  let release = () => {}
  on('tool.call', async (_$, e) => {
    if ((e as { text?: string }).text === 'refused') return { deny: 'not allowed' } as never
    if ((e as { text?: string }).text === 'boom') throw new Error('MCP server gone')
    if ((e as { text?: string }).text === 'broken') return { ref: 'r', result: {}, text: 'MCP error', isError: true } as never
    if (e.tool.startsWith('mcp__')) {
      await new Promise<void>(resolve => (release = resolve))
      const event = {
        type: 'search',
        timestamp: new Date(NOW + 500).toISOString(),
        clientType: 'MCP',
        toolName: 'code_search',
        query: 'stats writer',
        repositoryUrls: ['github.com/acme/widgets'],
        resultCount: 12,
        durationMs: 1400,
        success: true,
      }
      stats = JSON.stringify({ ...JSON.parse(DAY), events: [...JSON.parse(DAY).events, event] })
      statsMtime = NOW + 1
    }
    // A result that ran may carry the key with no value.
    return { ref: 'r', result: {}, text: 'ok', deny: undefined } as never
  })

  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true } as never)
  await clock.settle()
  expect(statuses.at(-1)).toBe('jbcontext · remote index ✓')

  const band = (isWorking: boolean) =>
    $.ui.mount({
      plugin: 'jbcontext-watch',
      surface: 'terminal',
      component: 'AbovePrompt',
      props: { hasSurvey: false, isWorking, maxRows: 10, bodyColumns: 120, scroll: { offset: 0, bodyRows: 9 }, view: {} } as never,
    })
  const spinner = async () => {
    const ui = await $.ui.mount({
      plugin: 'jbcontext-watch',
      surface: 'terminal',
      component: 'Spinner',
      props: { word: 'Thinking', message: null, suffix: '…', mode: 'tool-use' } as never,
    })
    const text = (await ui.find({ text: /./ }))?.text
    await ui.unmount()
    return text
  }

  await $.turn.start({ text: 'where is it?', turnId: 't1' } as never)
  for (let call = 0; call < 6; call++) await $.tool.call({ tool: 'Grep', pattern: 'stats' } as never)
  // No jbcontext call yet: the band has only the fresh error, no counts and no nudge.
  let ui = await band(true)
  expect(await ui.find({ text: /this turn/ })).toBeUndefined()
  expect(await ui.find({ text: /in a row/ })).toBeUndefined()
  expect(await ui.find({ text: /Token is expired/ })).toBeDefined()
  await ui.unmount()

  // A refused jbcontext call never ran: it counts for nothing and says nothing.
  await $.tool.call({ tool: 'mcp__jbcontext__code_search', text: 'refused' } as never)
  await clock.settle()
  ui = await band(true)
  expect(await ui.find({ text: /this turn/ })).toBeUndefined()
  await ui.unmount()
  expect(await spinner()).toBe('Thinking…')

  const search = $.tool.call({ tool: 'mcp__jbcontext__code_search', text: 'where is the stats writer' } as never)
  await clock.settle()
  expect(await spinner()).toBe('Searching jbcontext: "where is the stats writer"…')
  release()
  await search
  await clock.settle()
  expect(await spinner()).toBe('jbcontext: 12 hits in 1.4s')
  ui = await band(true)
  expect(await ui.find({ text: /this turn: 7 exploration calls · 1 via jbcontext \(12 hits\)/ })).toBeDefined()
  expect(await ui.find({ text: /Token is expired/ })).toBeDefined()
  await ui.unmount()

  // A subagent starting inside the turn does not reset its counts.
  await $.turn.start({ text: 'look around', turnId: 't2', agentId: 'a1' } as never)
  await $.tool.call({ tool: 'Read', file_path: '/repo/a.kt' } as never)
  ui = await band(true)
  expect(await ui.find({ text: /this turn: 8 exploration calls · 1 via jbcontext \(12 hits\)/ })).toBeDefined()
  await ui.unmount()

  // A call that threw counts, and the spinner says it failed.
  await $.tool.call({ tool: 'mcp__jbcontext__code_search', text: 'boom' } as never).catch(() => undefined)
  await clock.settle()
  expect(await spinner()).toBe('jbcontext search failed')
  ui = await band(true)
  expect(await ui.find({ text: /this turn: 9 exploration calls · 2 via jbcontext \(12 hits\)/ })).toBeDefined()
  await ui.unmount()

  // So does one the tool answered with an error.
  await clock.advance(5_000)
  await $.tool.call({ tool: 'mcp__jbcontext__code_search', text: 'broken' } as never)
  await clock.settle()
  expect(await spinner()).toBe('jbcontext search failed')
  ui = await band(true)
  expect(await ui.find({ text: /this turn: 10 exploration calls · 3 via jbcontext \(12 hits\)/ })).toBeDefined()
  await ui.unmount()

  await clock.advance(5_000)
  expect(await spinner()).toBe('Thinking…')
  const idle = await band(false)
  expect(await idle.find({ text: /jbcontext/ })).toBeUndefined()
  await idle.unmount()

  const pane = await $.ui.mount({
    plugin: 'jbcontext-watch',
    surface: 'terminal',
    component: 'Pane',
    requestId: 'jbcontext',
    props: { title: 'jbcontext', bodyColumns: 120 } as never,
  })
  expect(await pane.find({ text: /^Remote index$/ })).toBeDefined()
  expect(await pane.find({ text: /local overlay/ })).toBeDefined()
  expect(await pane.find({ text: /Latest searches in widgets/ })).toBeDefined()
  expect(await pane.find({ text: /where is the stats writer/ })).toBeDefined()
  expect(await pane.find({ text: /air assistant button/ })).toBeUndefined()
  expect(await pane.find({ text: /1 more in other repositories/ })).toBeDefined()
  await pane.unmount()

  // An hour on the error is stale: a turn with no jbcontext call, in a repository whose
  // HEAD is indexed, draws no band at all.
  await clock.advance(60 * 60 * 1000)
  await $.turn.start({ text: 'and then?', turnId: 't3' } as never)
  for (let call = 0; call < 6; call++) await $.tool.call({ tool: 'Grep', pattern: 'stats' } as never)
  const quiet = await band(true)
  expect(await quiet.find({ text: /jbcontext/ })).toBeUndefined()
  await quiet.unmount()
})

test('an older snapshot: the status line names the index, the band says nothing, the pane says which; no snapshot or a failure is on the band', async ($, on) => {
  mock.env(on, { HOME: '/home/dev' })
  const clock = mock.clock(on, { now: NOW })
  on('fs.list', async () => ({ value: [] }))
  on('fs.exists', async () => ({ value: true }))
  on('ui.panes', async () => ({ value: [] }))
  on('session.start', async (_$, e) => ({ cwd: e.cwd }))
  on('command.register', async (_$, e) => ({ value: { command: e.name } }))
  const statuses: (string | undefined)[] = []
  on('ui.status', async (_$, e) => (statuses.push(e.text), { value: undefined }))
  on('ui.render', async ($, e) => {
    const { Text } = $.ui.resolve(e)
    return h(Text, {}, 'engine') as RenderElement
  })
  // HEAD is a commit after the branch's snapshot; the index is kept on this machine.
  let status = ran(JSON.stringify({ ...JSON.parse(STATUS), storage: 'local' }))
  on('process.run', async (_$, e) => {
    if (e.argv[0] === 'git') {
      const stdout = e.argv.includes('--abbrev-ref')
        ? 'main\n'
        : e.argv.includes('remote')
          ? 'git@github.com:Acme/widgets.git\n'
          : `${'d'.repeat(40)}\n`
      return ran(stdout)
    }
    return status
  })
  const mount = (component: 'AbovePrompt' | 'Pane') =>
    $.ui.mount({
      plugin: 'jbcontext-watch',
      surface: 'terminal',
      component,
      ...(component === 'Pane' ? { requestId: 'jbcontext' } : {}),
      props: (component === 'Pane'
        ? { title: 'jbcontext', bodyColumns: 120 }
        : { hasSurvey: false, isWorking: true, maxRows: 10, bodyColumns: 120, scroll: { offset: 0, bodyRows: 9 }, view: {} }) as never,
    })

  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true } as never)
  await clock.settle()
  expect(statuses.at(-1)).toBe('jbcontext · on-device index ✓')
  // Search can use the branch's snapshot: nothing for the band to say; the pane says which.
  let ui = await mount('AbovePrompt')
  expect(await ui.find({ text: /^engine$/ })).toBeDefined()
  expect(await ui.find({ text: /index|snapshot/ })).toBeUndefined()
  await ui.unmount()
  ui = await mount('Pane')
  expect(await ui.find({ text: /^On-device index$/ })).toBeDefined()
  expect(await ui.find({ text: /^HEAD dddddddd not indexed; newest snapshot of main: a6f44ddb, 1h ago$/ })).toBeDefined()
  expect(await ui.find({ text: /^Snapshots on this machine\./ })).toBeDefined()
  await ui.unmount()

  // Nothing indexed stops search: the band says so, and what fixes it.
  status = ran(JSON.stringify({ indices: [], storage: 'local' }))
  await clock.advance(120_000)
  expect(statuses.at(-1)).toBe('jbcontext ✗ repository not indexed')
  ui = await mount('AbovePrompt')
  expect(await ui.find({ text: /^on-device index: no snapshots for this repository; run `jbcontext index`$/ })).toBeDefined()
  await ui.unmount()

  // A failure to read the status is not about a snapshot: it carries no label.
  status = { value: { ...ran('').value, exitCode: 1, stdout: JSON.stringify({ message: 'Token is expired' }) } }
  await clock.advance(120_000)
  expect(statuses.at(-1)).toBe('jbcontext ✗ Token is expired')
  ui = await mount('AbovePrompt')
  expect(await ui.find({ text: /^Token is expired$/ })).toBeDefined()
  await ui.unmount()
})

test('the pane toggles from the engine record; savings scan only while it is open; a failed price is retried', async ($, on) => {
  mock.env(on, { HOME: '/home/dev' })
  const clock = mock.clock(on, { now: NOW })
  mock.store(on)
  let transcriptMtime = NOW
  on('fs.list', async (_$, e) => ({
    value:
      e.path === '/home/dev/.claude/projects'
        ? [{ name: '-repo', kind: 'dir' as const, size: 0, mtimeMs: 0, isLink: false }]
        : e.path === '/home/dev/.claude/projects/-repo'
          ? [{ name: 'session.jsonl', kind: 'file' as const, size: 1, mtimeMs: transcriptMtime, isLink: false }]
          : [],
  }))
  on('fs.exists', async () => ({ value: false }))
  on('session.start', async (_$, e) => ({ cwd: e.cwd }))
  on('command.register', async (_$, e) => ({ value: { command: e.name } }))
  on('ui.render', async ($, e) => {
    const { Text } = $.ui.resolve(e)
    return h(Text, {}, 'engine') as RenderElement
  })
  let isOpen = false
  on('ui.panes', async () => ({
    value: isOpen ? [{ id: 'jbcontext', title: 'jbcontext', isShown: true, isFocused: false, isPlaced: true }] : [],
  }))
  on('ui.open', async () => ((isOpen = true), { value: { isPlaced: true as const } }))
  on('ui.close', async () => ((isOpen = false), { value: undefined }))

  const runs: string[] = []
  const ANALYZE = JSON.stringify({ phaseBreakdown: [{ phase: 'Exploring', totalTokensBilled: 2_000_000, totalCostUsd: 1.5 }] })
  on('process.run', async (_$, e) => {
    if (e.argv[0] === 'git') return ran(e.argv.includes('--abbrev-ref') ? 'main\n' : `${HEAD}\n`)
    if (e.argv.includes('--status')) {
      runs.push('session')
      return ran(JSON.stringify({ exploreTokens: 3_000_000, reductionPct: 25, embarkInvoked: true }))
    }
    if (e.argv.includes('analyze')) {
      runs.push('price')
      if (runs.filter(run => run === 'price').length === 1) throw new Error('timed out')
      return ran(ANALYZE)
    }
    return ran(STATUS)
  })

  const pane = async (text: RegExp) => {
    const ui = await $.ui.mount({
      plugin: 'jbcontext-watch',
      surface: 'terminal',
      component: 'Pane',
      requestId: 'jbcontext',
      props: { title: 'jbcontext', bodyColumns: 120 } as never,
    })
    const found = await ui.find({ text })
    await ui.unmount()
    return found
  }

  await $.session.start({ cwd: '/repo', surface: 'terminal' } as never)
  await clock.settle()
  expect(runs).toEqual([])

  expect((await $.command.run({ command: 'jbcontext', args: '' } as never)).text).toBe('jbcontext pane opened.')
  await clock.settle()
  expect(runs).toEqual(['session', 'price'])
  expect(await pane(/Saved ≈ 1M tokens/)).toBeDefined()
  expect(await pane(/once `jbcontext analyze` has run/)).toBeDefined()

  await clock.advance(120_000)
  expect(runs).toEqual(['session', 'price'])

  await clock.advance(60 * 60 * 1000)
  expect(runs).toEqual(['session', 'price', 'price'])
  expect(await pane(/≈ \$0\.75/)).toBeDefined()

  expect((await $.command.run({ command: 'jbcontext', args: '' } as never)).text).toBe('jbcontext pane closed.')
  transcriptMtime = NOW + 1
  await clock.advance(120_000)
  expect(runs).toEqual(['session', 'price', 'price'])
})

const usage = (billed: number) => ({ input_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: billed, output_tokens: 0 })
const toolUse = (name: string, input: unknown) => ({ type: 'tool_use', id: `t-${name}`, name, input })
const response = (id: string, billed: number, ...content: unknown[]) =>
  JSON.stringify({ type: 'assistant', message: { id, usage: usage(billed), content } })

// A response that searched and read (split over two lines, as Claude Code writes one
// line per content block), one that ran `jbcontext search` in a shell, one that only
// grepped for the phrase, and one with no tools.
const TRANSCRIPT = [
  JSON.stringify({ type: 'user', message: { content: 'where is the stats writer?' } }),
  response('m1', 1_000, toolUse('mcp__jbcontext__code_search', { text: 'stats writer' })),
  response('m1', 1_000, toolUse('Read', { file_path: '/r/a.kt' })),
  response('m2', 300, toolUse('Bash', { command: 'cd /r && jbcontext search "stats writer" | head' })),
  response('m3', 200, toolUse('Bash', { command: "grep -rn 'jbcontext search' docs | head" })),
  response('m4', 50, { type: 'text', text: 'Here.' }),
].join('\n')

const SESSION_ANALYZE = JSON.stringify({
  tasks: 2,
  phaseBreakdown: [
    { phase: 'Exploring', totalTokensBilled: 4_000, totalDurationMs: 75_000, totalCostUsd: 3 },
    { phase: 'Editing', totalTokensBilled: 1_000, totalDurationMs: 1_000, totalCostUsd: 0.5 },
    { phase: 'Thinking', totalTokensBilled: 1_000, totalDurationMs: 9_000, totalCostUsd: 0.5 },
  ],
})

test('jbcontext calls take their share of the responses that made them', () => {
  expect(jbcontextUsage(TRANSCRIPT)).toEqual({ calls: 2, tokens: 800 })
  expect(isJbcontextCall('Bash', { command: '~/.jbcontext/bin/jbcontext repos "billing" --limit 5' })).toBe(true)
  expect(isJbcontextCall('Bash', { command: 'jbcontext analyze --json-output' })).toBe(false)
  expect(isJbcontextCall('mcp__glean_default__code_search', {})).toBe(false)
})

test('the session line gives the jbcontext calls and share, and the exploring tokens and time, no cost', () => {
  const phases = parseSessionPhases(SESSION_ANALYZE)!
  expect(phases).toEqual({ exploreTokens: 4_000, exploreMs: 75_000, exploreUsd: 3, totalUsd: 4 })
  expect(describeSession({ sessionId: 's', ...phases, jbcontextCalls: 2, jbcontextTokens: 800 })).toBe(
    'jbcontext · 2 calls, 20% of this session’s exploring tokens (4K in 1m 15s)',
  )
  expect(describeSession({ sessionId: 's', ...phases, jbcontextCalls: 1, jbcontextTokens: 10 })).toBe(
    'jbcontext · 1 call, <1% of this session’s exploring tokens (4K in 1m 15s)',
  )
  expect(parseSessionPhases('{}')).toBe(null)
})

test('a turn that called jbcontext ends with the session line; one that did not, or a subagent’s, does not', async ($, on) => {
  mock.env(on, { HOME: '/home/dev', TMPDIR: '/tmp/dev/' })
  const clock = mock.clock(on, { now: NOW })
  const project = '/home/dev/.claude/projects/-repo'
  let transcript = TRANSCRIPT
  let sessionId = 'sess'
  // The session's exploring tokens, which grow between turns: a line that came from their
  // growth alone would show.
  let exploring = 4_000
  on('session.id', async () => ({ value: sessionId }))
  on('fs.stat', async () => fileStat(transcript))
  on('fs.list', async (_$, e) => ({
    value:
      e.path === `${project}/sess/subagents`
        ? [{ name: 'agent-1.jsonl', kind: 'file' as const, size: 1, mtimeMs: NOW, isLink: false }]
        : [],
  }))
  on('fs.read', async (_$, e) => readRange(e.path === `${project}/${sessionId}.jsonl` ? transcript : '', e))
  on('fs.exists', async () => ({ value: false }))
  let isPaneShown = false
  on('ui.panes', async () => ({
    value: isPaneShown ? [{ id: 'jbcontext', title: 'jbcontext', isShown: true, isFocused: false, isPlaced: true }] : [],
  }))
  on('session.start', async (_$, e) => ({ cwd: e.cwd }))
  on('command.register', async (_$, e) => ({ value: { command: e.name } }))
  on('turn.start', async (_$, e) => ({ turnId: e.turnId }))
  on('tool.call', async () => ({ ref: 'r', result: {}, text: 'ok' }) as never)
  on('turn.complete', async (_$, e) => ({ text: e.answer }))
  on('ui.render', async ($, e) => {
    const { Text } = $.ui.resolve(e)
    return h(Text, {}, 'engine') as RenderElement
  })
  const linked: string[][] = []
  let analyzed: string[] = []
  let analyzeRuns = 0
  on('process.run', async (_$, e) => {
    if (e.argv[0] === 'ln') linked.push([...e.argv])
    if (e.argv.includes('--projects-dir')) {
      analyzed = [...e.argv]
      analyzeRuns++
      return ran(
        JSON.stringify({
          phaseBreakdown: [
            { phase: 'Exploring', totalTokensBilled: exploring, totalDurationMs: 75_000, totalCostUsd: 3 },
            { phase: 'Editing', totalTokensBilled: 1_000, totalDurationMs: 1_000, totalCostUsd: 1 },
          ],
        }),
      )
    }
    if (e.argv[0] === 'git') return { value: { ...ran('').value, exitCode: 128 } }
    return ran('')
  })

  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true } as never)
  const search = () => $.tool.call({ tool: 'mcp__jbcontext__code_search', text: 'billing' } as never)
  const end = async (fields: object = {}) => {
    const done = await $.turn.complete({ answer: 'Here.', durationMs: 1_000, isAborted: false, turnId: 't', reason: 'answer', ...fields } as never)
    // Lets a measurement the turn left running in the background land.
    await clock.settle()
    return done.text
  }

  await $.turn.start({ text: 'where is it?', turnId: 't1' } as never)
  await search()
  expect(await end()).toBe('jbcontext · 2 calls, 20% of this session’s exploring tokens (4K in 1m 15s)')
  expect(linked).toEqual([
    ['ln', '-sf', `${project}/sess.jsonl`, `${project}/sess/subagents/agent-1.jsonl`, '/tmp/dev/jbcontext-watch/sess/session/'],
  ])
  expect(analyzed).toContain('/tmp/dev/jbcontext-watch/sess')

  // A turn without a jbcontext call adds no line, though the session explored more.
  exploring = 8_000
  await $.turn.start({ text: 'and the reader?', turnId: 't2' } as never)
  transcript = `${TRANSCRIPT}\n${response('m5', 100, toolUse('Read', { file_path: '/r/b.kt' }))}`
  await $.tool.call({ tool: 'Read', file_path: '/r/b.kt' } as never)
  expect(await end()).toBe('Here.')

  // Its figures were still measured, in the background, for the status line and pane.
  const pane = await $.ui.mount({
    plugin: 'jbcontext-watch',
    surface: 'terminal',
    component: 'Pane',
    requestId: 'jbcontext',
    props: { title: 'jbcontext', bodyColumns: 120 } as never,
  })
  expect(await pane.find({ text: /Explored 8K tokens in 1m 15s, ≈\$3\.00/ })).toBeDefined()
  expect(await pane.find({ text: /jbcontext: 2 calls, 800 tokens, 10% of exploring/ })).toBeDefined()
  // Not a git repository here: no note about where snapshots are kept.
  expect(await pane.find({ text: /not a git repository/ })).toBeDefined()
  expect(await pane.find({ text: /local overlay/ })).toBeUndefined()
  await pane.unmount()

  // A subagent starting after the turn's jbcontext call leaves the turn's count alone, and
  // its own end gets no line.
  await $.turn.start({ text: 'look around', turnId: 't3' } as never)
  transcript = `${transcript}\n${response('m6', 400, toolUse('mcp__jbcontext__code_search', { text: 'billing' }))}`
  await search()
  await $.turn.start({ text: 'read the billing code', turnId: 't3a', agentId: 'a1' } as never)
  await $.tool.call({ tool: 'Read', file_path: '/r/billing.kt' } as never)
  expect(await end({ agentId: 'a1' })).toBe('Here.')
  expect(await end()).toBe('jbcontext · 3 calls, 15% of this session’s exploring tokens (8K in 1m 15s)')

  // A session that never called jbcontext: no line, and no `jbcontext analyze` run for it.
  sessionId = 'other'
  transcript = response('m1', 100, toolUse('Read', { file_path: '/r/a.kt' }))
  await $.turn.start({ text: 'hello', turnId: 't4' } as never)
  const runsBefore = analyzeRuns
  expect(await end()).toBe('Here.')
  expect(analyzeRuns).toBe(runsBefore)
  // Unless the pane is open, which shows its figures: then it is measured, with no line.
  isPaneShown = true
  await $.turn.start({ text: 'and now?', turnId: 't5' } as never)
  expect(await end()).toBe('Here.')
  expect(analyzeRuns).toBe(runsBefore + 1)
})

test('a turn’s session line comes from a measurement of its own, which an older one ending later does not overwrite', async ($, on) => {
  mock.env(on, { HOME: '/home/dev', TMPDIR: '/tmp/dev/' })
  const clock = mock.clock(on, { now: NOW })
  const project = '/home/dev/.claude/projects/-repo'
  let transcript = TRANSCRIPT
  const reads: number[] = []
  on('session.id', async () => ({ value: 'sess' }))
  on('fs.stat', async () => fileStat(transcript))
  on('fs.list', async () => ({ value: [] }))
  on('fs.read', async (_$, e) => {
    if (e.path === `${project}/sess.jsonl`) reads.push(e.offset ?? 0)
    return readRange(e.path === `${project}/sess.jsonl` ? transcript : '', e)
  })
  on('fs.exists', async () => ({ value: false }))
  on('ui.panes', async () => ({ value: [] }))
  on('ui.open', async () => ({ value: { isPlaced: true as const } }))
  on('session.start', async (_$, e) => ({ cwd: e.cwd }))
  on('command.register', async (_$, e) => ({ value: { command: e.name } }))
  on('turn.start', async (_$, e) => ({ turnId: e.turnId }))
  on('tool.call', async () => ({ ref: 'r', result: {}, text: 'ok' }) as never)
  on('turn.complete', async (_$, e) => ({ text: e.answer }))
  on('ui.render', async ($, e) => {
    const { Text } = $.ui.resolve(e)
    return h(Text, {}, 'engine') as RenderElement
  })
  // The first analyze run, started by opening the pane, is held until released and
  // measures the session as it was; the next sees 8K exploring tokens.
  let release = () => {}
  const held = new Promise<void>(resolve => (release = resolve))
  let started = () => {}
  const isStarted = new Promise<void>(resolve => (started = resolve))
  let analyzeRuns = 0
  on('process.run', async (_$, e) => {
    if (e.argv.includes('--projects-dir')) {
      analyzeRuns++
      if (analyzeRuns === 1) {
        started()
        await held
        return ran(SESSION_ANALYZE)
      }
      return ran(JSON.stringify({ phaseBreakdown: [{ phase: 'Exploring', totalTokensBilled: 8_000, totalDurationMs: 90_000, totalCostUsd: 6 }] }))
    }
    if (e.argv[0] === 'git') return { value: { ...ran('').value, exitCode: 128 } }
    return ran('')
  })

  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true } as never)
  await $.command.run({ command: 'jbcontext', args: '' } as never)
  await isStarted
  // While that run is held, a turn calls jbcontext once more and ends: its line does not
  // wait for the held run (waiting would spend the hook's budget) and is not taken from it.
  await $.turn.start({ text: 'where is billing?', turnId: 't1' } as never)
  transcript = `${TRANSCRIPT}\n${response('m6', 400, toolUse('mcp__jbcontext__code_search', { text: 'billing' }))}`
  await $.tool.call({ tool: 'mcp__jbcontext__code_search', text: 'billing' } as never)
  const line = await $.turn.complete({ answer: 'Here.', durationMs: 1_000, isAborted: false, turnId: 't1', reason: 'answer' } as never)
  expect(line.text).toBe('jbcontext · 3 calls, 15% of this session’s exploring tokens (8K in 1m 30s)')
  expect(analyzeRuns).toBe(2)

  // The held run ends last, with older figures: the pane keeps the turn's. The size it took
  // before the turn read further does not make it read the transcript again.
  const readsBefore = reads.length
  release()
  await clock.settle()
  expect(reads.slice(readsBefore)).toEqual([])
  const pane = await $.ui.mount({
    plugin: 'jbcontext-watch',
    surface: 'terminal',
    component: 'Pane',
    requestId: 'jbcontext',
    props: { title: 'jbcontext', bodyColumns: 120 } as never,
  })
  expect(await pane.find({ text: /Explored 8K tokens in 1m 30s/ })).toBeDefined()
  await pane.unmount()
})

test('background measurements never hold a turn’s end, run one at a time, and never outlive their session', async ($, on) => {
  mock.env(on, { HOME: '/home/dev', TMPDIR: '/tmp/dev/' })
  const clock = mock.clock(on, { now: NOW })
  const project = '/home/dev/.claude/projects/-repo'
  let sessionId = 'sess'
  const transcripts: Record<string, string> = { sess: TRANSCRIPT }
  on('session.id', async () => ({ value: sessionId }))
  on('fs.stat', async (_$, e) => {
    const text = transcripts[e.path.replace(`${project}/`, '').replace(/\.jsonl$/, '')]
    if (text === undefined) throw new Error('ENOENT')
    return fileStat(text)
  })
  on('fs.list', async () => ({ value: [] }))
  on('fs.read', async (_$, e) => readRange(transcripts[e.path.replace(`${project}/`, '').replace(/\.jsonl$/, '')] ?? '', e))
  on('fs.exists', async () => ({ value: false }))
  on('ui.panes', async () => ({ value: [] }))
  on('session.start', async (_$, e) => ({ cwd: e.cwd }))
  // What the engine does while the session ends, its id still the old one's.
  let whileEnding = () => {}
  on('session.end', async () => {
    whileEnding()
    // Lets what was released end while the session is still ending.
    await clock.settle()
    return { sessionId }
  })
  on('command.register', async (_$, e) => ({ value: { command: e.name } }))
  on('turn.start', async (_$, e) => ({ turnId: e.turnId }))
  on('tool.call', async () => ({ ref: 'r', result: {}, text: 'ok' }) as never)
  on('turn.complete', async (_$, e) => ({ text: e.answer }))
  const statuses: (string | undefined)[] = []
  on('ui.status', async (_$, e) => (statuses.push(e.text), { value: undefined }))
  // While `held` is set, analyze runs wait for it.
  let held: Promise<void> | null = null
  let analyzeRuns = 0
  on('process.run', async (_$, e) => {
    if (e.argv[0] === 'git') return ran(e.argv.includes('--abbrev-ref') ? 'main\n' : e.argv.includes('remote') ? 'git@github.com:Acme/widgets.git\n' : `${HEAD}\n`)
    if (e.argv.includes('--projects-dir')) {
      analyzeRuns++
      if (held !== null) await held
      return ran(SESSION_ANALYZE)
    }
    return ran(STATUS)
  })
  const end = (turnId: string) =>
    $.turn.complete({ answer: 'Here.', durationMs: 1_000, isAborted: false, turnId, reason: 'answer' } as never)

  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true } as never)
  await clock.settle()
  await $.turn.start({ text: 'where?', turnId: 't1' } as never)
  await $.tool.call({ tool: 'mcp__jbcontext__code_search', text: 'billing' } as never)
  expect((await end('t1')).text).toBe('jbcontext · 2 calls, 20% of this session’s exploring tokens (4K in 1m 15s)')
  expect(statuses.at(-1)).toBe('jbcontext · remote index ✓ · session: 20% of exploring via jbcontext')
  expect(analyzeRuns).toBe(1)

  // Turns without a jbcontext call end at once though their measurement is held; the
  // second, asked for during the first, is queued, not started beside it.
  let release = () => {}
  held = new Promise<void>(resolve => (release = resolve))
  await $.turn.start({ text: 'and?', turnId: 't2' } as never)
  expect((await end('t2')).text).toBe('Here.')
  await clock.settle()
  expect(analyzeRuns).toBe(2)
  await $.turn.start({ text: 'and then?', turnId: 't3' } as never)
  expect((await end('t3')).text).toBe('Here.')
  await clock.settle()
  expect(analyzeRuns).toBe(2)
  await $.turn.start({ text: 'and after that?', turnId: 't4' } as never)
  expect((await end('t4')).text).toBe('Here.')
  await clock.settle()
  expect(analyzeRuns).toBe(2)

  // Another session takes this one's place, and the held measurement ends while the old
  // session is still ending: its share goes and stays gone.
  whileEnding = () => {
    held = null
    release()
  }
  await $.session.end({ reason: 'resume' } as never)
  sessionId = 'resumed'
  transcripts.resumed = response('r1', 100, toolUse('Read', { file_path: '/r/a.kt' }))
  const resumedAt = statuses.length
  expect(statuses.at(-1)).toBe('jbcontext · remote index ✓')
  await clock.settle()
  expect(statuses.slice(resumedAt).filter(text => text?.includes('session:'))).toEqual([])
  expect(statuses.at(-1)).toBe('jbcontext · remote index ✓')
  // The held one, and the one queued behind it: three asks during it queued one.
  expect(analyzeRuns).toBe(3)

  // In the resumed session, which uses jbcontext, a measurement still running once a
  // /clear has ended writes nothing when it ends.
  transcripts.resumed = TRANSCRIPT
  whileEnding = () => {}
  await $.turn.start({ text: 'where?', turnId: 't5' } as never)
  await $.tool.call({ tool: 'mcp__jbcontext__code_search', text: 'billing' } as never)
  expect((await end('t5')).text).toBe('jbcontext · 2 calls, 20% of this session’s exploring tokens (4K in 1m 15s)')
  held = new Promise<void>(resolve => (release = resolve))
  await $.turn.start({ text: 'and?', turnId: 't6' } as never)
  expect((await end('t6')).text).toBe('Here.')
  await clock.settle()
  expect(analyzeRuns).toBe(5)
  await $.session.end({ reason: 'clear' } as never)
  sessionId = 'cleared'
  const clearedAt = statuses.length
  expect(statuses.at(-1)).toBe('jbcontext · remote index ✓')
  held = null
  release()
  await clock.settle()
  expect(statuses.slice(clearedAt)).toEqual([])
})

test('a transcript over 4 MiB is read in ranges, on from where the last read stopped', async ($, on) => {
  mock.env(on, { HOME: '/home/dev', TMPDIR: '/tmp/dev/' })
  mock.clock(on, { now: NOW })
  const project = '/home/dev/.claude/projects/-repo'
  // A long session's transcript: a filler line sized so that the first range ends inside
  // the 2-byte é of the jbcontext call's response, its last line.
  const tail = response('m9', 400, { type: 'text', text: 'é' }, toolUse('mcp__jbcontext__code_search', { text: 'billing' }))
  const head = `${TRANSCRIPT}\n`
  const beforeChar = byteLength(tail.slice(0, tail.indexOf('é')))
  const empty = JSON.stringify({ type: 'user', message: { content: '' } })
  const padding = READ_LIMIT - 1 - byteLength(head) - beforeChar - 1 - byteLength(empty)
  const filler = JSON.stringify({ type: 'user', message: { content: 'x'.repeat(padding) } })
  let transcript = `${head}${filler}\n${tail}\n`
  expect(byteLength(`${head}${filler}\n`) + beforeChar).toBe(READ_LIMIT - 1)
  const reads: { offset?: number; length?: number }[] = []
  let isReadFailing = false
  on('session.id', async () => ({ value: 'sess' }))
  on('fs.stat', async () => fileStat(transcript))
  on('fs.list', async () => ({ value: [] }))
  on('fs.read', async (_$, e) => {
    if (e.path !== `${project}/sess.jsonl`) return { value: '' }
    if (isReadFailing) throw new Error('EIO')
    reads.push({ offset: e.offset, length: e.length })
    return readRange(transcript, e)
  })
  on('fs.exists', async () => ({ value: false }))
  on('ui.panes', async () => ({ value: [] }))
  on('session.start', async (_$, e) => ({ cwd: e.cwd }))
  on('command.register', async (_$, e) => ({ value: { command: e.name } }))
  on('turn.start', async (_$, e) => ({ turnId: e.turnId }))
  on('tool.call', async () => ({ ref: 'r', result: {}, text: 'ok' }) as never)
  on('turn.complete', async (_$, e) => ({ text: e.answer }))
  on('process.run', async (_$, e) => {
    if (e.argv.includes('--projects-dir')) return ran(SESSION_ANALYZE)
    if (e.argv[0] === 'git') return { value: { ...ran('').value, exitCode: 128 } }
    return ran('')
  })
  const turn = async (turnId: string) => {
    await $.turn.start({ text: 'where?', turnId } as never)
    await $.tool.call({ tool: 'mcp__jbcontext__code_search', text: 'billing' } as never)
    return (await $.turn.complete({ answer: 'Here.', durationMs: 1_000, isAborted: false, turnId, reason: 'answer' } as never)).text
  }

  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true } as never)
  expect(await turn('t1')).toBe('jbcontext · 3 calls, 30% of this session’s exploring tokens (4K in 1m 15s)')
  const size = byteLength(transcript)
  expect(reads[0]).toEqual({ offset: 0, length: READ_LIMIT })
  expect(reads.at(-1)).toEqual({ offset: READ_LIMIT, length: size - READ_LIMIT })

  // The next turn's call is read from where the last read stopped, the rest not again.
  transcript = `${transcript}${response('m10', 400, toolUse('mcp__jbcontext__code_search', { text: 'retry' }))}\n`
  const readsBefore = reads.length
  expect(await turn('t2')).toBe('jbcontext · 4 calls, 40% of this session’s exploring tokens (4K in 1m 15s)')
  expect(reads.slice(readsBefore)).toEqual([{ offset: size, length: byteLength(transcript) - size }])

  // A read that fails keeps what was read: the line has the calls so far, and the next
  // turn reads on.
  const grown = byteLength(transcript)
  transcript = `${transcript}${response('m11', 400, toolUse('mcp__jbcontext__code_search', { text: 'queue' }))}\n`
  isReadFailing = true
  expect(await turn('t3')).toBe('jbcontext · 4 calls, 40% of this session’s exploring tokens (4K in 1m 15s)')
  isReadFailing = false
  const readsAfterFailure = reads.length
  expect(await turn('t4')).toBe('jbcontext · 5 calls, 50% of this session’s exploring tokens (4K in 1m 15s)')
  expect(reads.slice(readsAfterFailure)).toEqual([{ offset: grown, length: byteLength(transcript) - grown }])

  // Rewritten shorter: read again from the start.
  transcript = `${TRANSCRIPT}\n`
  expect(await turn('t5')).toBe('jbcontext · 2 calls, 20% of this session’s exploring tokens (4K in 1m 15s)')
})

const SEARCH_OUTPUT = [
  '1. File: src/billing/RetryPolicy.kt',
  '  Content:',
  '     250|     fun delayFor(attempt: Int): Duration = base * 2.0.pow(attempt)',
  '     251|     fun shouldGiveUp(attempt: Int) = attempt >= maxAttempts',
  '',
  '2. File: src/billing/Charge.kt',
  '  Content:',
  '      12|     val schedule = BackoffSchedule(maxAttempts = 5)',
].join('\n')

test('effects show under the search row and in the band, and survive a subagent turn', async ($, on) => {
  mock.env(on, { HOME: '/home/dev' })
  const clock = mock.clock(on, { now: NOW })
  const store = new Map<string, unknown>()
  on('store.get', async (_$, e) => ({ value: store.get(e.key) }))
  on('store.set', async (_$, e) => (store.set(e.key, e.value), { value: undefined }))
  on('fs.list', async () => ({ value: [] }))
  on('fs.exists', async () => ({ value: false }))
  on('ui.panes', async () => ({ value: [] }))
  on('session.start', async (_$, e) => ({ cwd: e.cwd }))
  on('turn.start', async (_$, e) => ({ turnId: e.turnId }))
  on('command.register', async (_$, e) => ({ value: { command: e.name } }))
  on('ui.status', async () => ({ value: undefined }))
  let groupExpanded: boolean | undefined
  on('ui.render', async ($, e) => {
    if (e.component === 'ToolGroup') groupExpanded = (e.props as { isExpanded: boolean }).isExpanded
    const { Text } = $.ui.resolve(e)
    return h(Text, {}, 'engine') as RenderElement
  })
  on('process.run', async (_$, e) => {
    if (e.argv[0] === 'git') {
      if (e.argv.includes('--show-toplevel')) return ran('/repo\n')
      if (e.argv.includes('--abbrev-ref')) return ran('main\n')
      if (e.argv.includes('remote')) return ran('git@github.com:Acme/widgets.git\n')
      return ran(`${HEAD}\n`)
    }
    return ran(STATUS)
  })
  let searchId = ''
  on('tool.call', async (_$, e) => {
    const call = e as unknown as Record<string, unknown>
    if (e.tool === 'Bash') return { ref: 1, result: { stdout: '', stderr: '', interrupted: false }, text: 'Exit code 1', isError: true } as never
    if (e.tool.startsWith('mcp__')) {
      searchId = String(call.tool_use_id)
      return { ref: 1, result: {}, text: SEARCH_OUTPUT } as never
    }
    if (e.tool === 'Read') {
      return {
        ref: 1,
        result: { type: 'text', file: { filePath: call.file_path, content: '', numLines: 40, startLine: 240, totalLines: 900 } },
        text: '...',
      } as never
    }
    // Edit: the hunk sits at the line the search pointed at.
    return {
      ref: 1,
      result: { filePath: call.file_path, oldString: '', newString: '', originalFile: null, structuredPatch: [{ oldStart: 12, oldLines: 1, newStart: 12, newLines: 1, lines: [] }], userModified: false, replaceAll: false },
      text: 'ok',
    } as never
  })

  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true } as never)
  await clock.settle()
  await $.turn.start({ text: 'make retries back off', turnId: 't1' } as never)
  await $.tool.call({ tool: 'Bash', command: 'rg -n "RetryBackoff" src' } as never)
  await $.tool.call({ tool: 'Bash', command: 'grep -rn "backoff" src' } as never)
  await $.tool.call({ tool: 'mcp__jbcontext__code_search', text: 'where retries back off between attempts' } as never)
  await $.tool.call({ tool: 'Read', file_path: '/repo/src/billing/RetryPolicy.kt', offset: 240, limit: 40 } as never)
  // A subagent's turn starts inside this one, and edits one of the files.
  await $.turn.start({ text: 'edit it', turnId: 't2', agentId: 'a1' } as never)
  await $.tool.call({ tool: 'Edit', file_path: '/repo/src/billing/Charge.kt', old_string: 'x', new_string: 'y', agentId: 'a1' } as never)
  await $.tool.call({ tool: 'Edit', file_path: '/repo/src/billing/RetryPolicy.kt', old_string: 'x', new_string: 'y' } as never)
  await clock.settle()

  const row = await $.ui.mount({
    plugin: 'jbcontext-watch',
    surface: 'terminal',
    component: 'ToolUse',
    props: { tool_use_id: searchId, tool: 'mcp__jbcontext__code_search', input: { text: 'x' }, isRunning: false, isErrored: false, isInterrupted: false } as never,
  })
  expect(await row.find({ text: /found after 2 empty greps · exact lines · 2 files changed/ })).toBeDefined()
  expect(await row.find({ text: /ctrl\+o: how/ })).toBeDefined()
  await row.unmount()

  // Expanded (ctrl+o): the trail, from the empty greps to the edits on the hits.
  const expanded = await $.ui.mount({
    plugin: 'jbcontext-watch',
    surface: 'terminal',
    component: 'ToolUse',
    props: { tool_use_id: searchId, tool: 'mcp__jbcontext__code_search', input: { text: 'x' }, isRunning: false, isErrored: false, isInterrupted: false, isExpanded: true } as never,
  })
  expect(await expanded.find({ text: /rg -n "RetryBackoff" src/ })).toBeDefined()
  expect(await expanded.find({ text: /nothing found/ })).toBeDefined()
  expect(await expanded.find({ text: /jbcontext search "where retries back off between attempts"/ })).toBeDefined()
  expect(await expanded.find({ text: /Read src\/billing\/RetryPolicy\.kt:240-279/ })).toBeDefined()
  expect(await expanded.find({ text: /hit #1, lines 250-251 · on the hit/ })).toBeDefined()
  expect(await expanded.find({ text: /Edit src\/billing\/Charge\.kt:12/ })).toBeDefined()
  await expanded.unmount()

  // A folded run holding that search unfolds; one without a search stays folded.
  const group = (calls: unknown[]) =>
    $.ui.mount({ plugin: 'jbcontext-watch', surface: 'terminal', component: 'ToolGroup', props: { calls, isActive: false, isExpanded: false } as never })
  const call = (tool: string, input: unknown, tool_use_id: string) => ({ tool, input, tool_use_id, isRunning: false, isErrored: false, isInterrupted: false })
  let folded = await group([call('Bash', { command: 'rg x' }, 'other'), call('mcp__jbcontext__code_search', { text: 'x' }, searchId)])
  expect(groupExpanded).toBe(true)
  await folded.unmount()
  folded = await group([call('Bash', { command: 'rg x' }, 'other')])
  expect(groupExpanded).toBe(false)
  await folded.unmount()

  const band = async () =>
    $.ui.mount({
      plugin: 'jbcontext-watch',
      surface: 'terminal',
      component: 'AbovePrompt',
      props: { hasSurvey: false, isWorking: true, maxRows: 10, bodyColumns: 120, scroll: { offset: 0, bodyRows: 9 }, view: {} } as never,
    })
  let ui = await band()
  // The subagent's turn start reset nothing: the band still counts the main turn's calls.
  expect(await ui.find({ text: /this turn: 4 exploration calls · 1 via jbcontext/ })).toBeDefined()
  expect(await ui.find({ text: /jbcontext delivered: 1 found after empty greps · 1 at the exact lines · 1 search → several files changed/ })).toBeDefined()
  expect(await ui.find({ text: /jump to its search/ })).toBeDefined()
  await ui.unmount()

  // Once the turn ended the band stays, with the list, until the next prompt.
  const idle = await $.ui.mount({
    plugin: 'jbcontext-watch',
    surface: 'terminal',
    component: 'AbovePrompt',
    props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 120, scroll: { offset: 0, bodyRows: 9 }, view: {} } as never,
  })
  expect(await idle.find({ text: /found after 2 empty greps · exact lines · 2 files changed/ })).toBeDefined()
  expect(await idle.find({ text: /"where retries back off between attempts"/ })).toBeDefined()
  await idle.unmount()

  const stored = store.get('effects:github.com/acme/widgets') as { days: Record<string, { afterEmpty: number; multiFile: number }> }
  const today = Object.values(stored.days)[0]
  expect(today?.afterEmpty).toBe(1)
  expect(today?.multiFile).toBe(1)

  // A new main turn clears the band's line; the badge under the search stays.
  await $.turn.start({ text: 'next', turnId: 't3' } as never)
  ui = await band()
  expect(await ui.find({ text: /delivered/ })).toBeUndefined()
  await ui.unmount()
  const again = await $.ui.mount({
    plugin: 'jbcontext-watch',
    surface: 'terminal',
    component: 'ToolUse',
    props: { tool_use_id: searchId, tool: 'mcp__jbcontext__code_search', input: { text: 'x' }, isRunning: false, isErrored: false, isInterrupted: false } as never,
  })
  expect(await again.find({ text: /found after 2 empty greps/ })).toBeDefined()
  await again.unmount()
})
