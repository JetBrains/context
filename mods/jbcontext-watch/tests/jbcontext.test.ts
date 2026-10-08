import type { RenderElement } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

import {
  claudeProjectDir,
  describeSession,
  describeTurn,
  explorationKind,
  explorePrice,
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
  expect(describeTurn({ explorations: 1, jbcontextCalls: 1, jbcontextHits: 1, streak: 0, searching: null, result: null })).toBe(
    'this turn: 1 exploration call · 1 via jbcontext (1 hit)',
  )
})

test('the status line has the index, and the session share once measured', () => {
  const view = (fields: Partial<JbView>): JbView => ({
    searches: [],
    errors: [],
    otherSearches: 0,
    otherErrors: 0,
    index: { state: 'current', branch: 'main', revision: HEAD, at: NOW },
    repositoryId: null,
    repoKey: null,
    indexingSince: null,
    savings: null,
    session: null,
    updatedAt: 0,
    ...fields,
  })
  expect(statusLine(view({}))).toBe('jbcontext ✓ main indexed')
  expect(statusLine(view({ indexingSince: NOW }))).toBe('jbcontext · indexing…')
  expect(statusLine(view({ index: { state: 'stale', branch: 'main', head: 'b', revision: 'a', at: NOW } }))).toBe(
    'jbcontext ⚠ main HEAD not indexed',
  )
  expect(statusLine(view({ index: { state: 'unavailable', reason: 'not a git repository' } }))).toBe(undefined)
  expect(statusLine(view({ index: null }))).toBe(undefined)
  const session = { sessionId: 's', exploreTokens: 4_000, exploreMs: 1, exploreUsd: 1, totalUsd: 2, jbcontextCalls: 2, jbcontextTokens: 800 }
  expect(statusLine(view({ session }))).toBe('jbcontext ✓ main indexed · session: 20% of exploring via jbcontext')
  expect(statusLine(view({ session: { ...session, jbcontextCalls: 0, jbcontextTokens: 0 } }))).toBe(
    'jbcontext ✓ main indexed · session: jbcontext not used',
  )
})

test('during a turn: the spinner says what jbcontext searches, the band counts and nudges, the status line has the index', async ($, on) => {
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
    return { ref: 'r', result: {}, text: 'ok' } as never
  })

  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true } as never)
  await clock.settle()
  expect(statuses.at(-1)).toBe('jbcontext ✓ main indexed')

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
  let ui = await band(true)
  expect(await ui.find({ text: /this turn: 6 exploration calls · none via jbcontext/ })).toBeDefined()
  expect(await ui.find({ text: /6 grep\/read calls in a row without jbcontext/ })).toBeDefined()
  await ui.unmount()

  const search = $.tool.call({ tool: 'mcp__jbcontext__code_search', text: 'where is the stats writer' } as never)
  await clock.settle()
  expect(await spinner()).toBe('Searching jbcontext: "where is the stats writer"…')
  release()
  await search
  await clock.settle()
  expect(await spinner()).toBe('jbcontext: 12 hits in 1.4s')
  ui = await band(true)
  expect(await ui.find({ text: /this turn: 7 exploration calls · 1 via jbcontext \(12 hits\)/ })).toBeDefined()
  expect(await ui.find({ text: /in a row/ })).toBeUndefined()
  expect(await ui.find({ text: /Token is expired/ })).toBeDefined()
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
  expect(await pane.find({ text: /Latest searches in widgets/ })).toBeDefined()
  expect(await pane.find({ text: /where is the stats writer/ })).toBeDefined()
  expect(await pane.find({ text: /air assistant button/ })).toBeUndefined()
  expect(await pane.find({ text: /1 more in other repositories/ })).toBeDefined()
  await pane.unmount()
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

test('the session line gives exploring tokens, time, cost and the jbcontext share', () => {
  const phases = parseSessionPhases(SESSION_ANALYZE)!
  expect(phases).toEqual({ exploreTokens: 4_000, exploreMs: 75_000, exploreUsd: 3, totalUsd: 4 })
  expect(describeSession({ sessionId: 's', ...phases, jbcontextCalls: 2, jbcontextTokens: 800 })).toBe(
    'jbcontext · this session explored 4K tokens in 1m 15s, ≈$3.00 (75% of $4.00) · jbcontext 2 calls, 20% of exploring tokens',
  )
  expect(describeSession({ sessionId: 's', ...phases, jbcontextCalls: 0, jbcontextTokens: 0 })).toContain('jbcontext not used')
  expect(parseSessionPhases('{}')).toBe(null)
})

test('a turn that explored ends with the session line; one that did not, or a subagent’s, does not', async ($, on) => {
  mock.env(on, { HOME: '/home/dev', TMPDIR: '/tmp/dev/' })
  mock.clock(on, { now: NOW })
  const project = '/home/dev/.claude/projects/-repo'
  let transcript = TRANSCRIPT
  on('session.id', async () => ({ value: 'sess' }))
  on('fs.stat', async () => ({ value: { kind: 'file' as const, size: transcript.length, mtimeMs: NOW, isLink: false } }))
  on('fs.list', async (_$, e) => ({
    value:
      e.path === `${project}/sess/subagents`
        ? [{ name: 'agent-1.jsonl', kind: 'file' as const, size: 1, mtimeMs: NOW, isLink: false }]
        : [],
  }))
  on('fs.read', async (_$, e) => ({ value: e.path.endsWith('sess.jsonl') ? transcript : '' }))
  on('fs.exists', async () => ({ value: false }))
  on('ui.panes', async () => ({ value: [] }))
  on('session.start', async (_$, e) => ({ cwd: e.cwd }))
  on('command.register', async (_$, e) => ({ value: { command: e.name } }))
  on('turn.complete', async (_$, e) => ({ text: e.answer }))
  on('ui.render', async ($, e) => {
    const { Text } = $.ui.resolve(e)
    return h(Text, {}, 'engine') as RenderElement
  })
  const linked: string[][] = []
  let analyzed: string[] = []
  on('process.run', async (_$, e) => {
    if (e.argv[0] === 'ln') linked.push([...e.argv])
    if (e.argv.includes('--projects-dir')) {
      analyzed = [...e.argv]
      return ran(SESSION_ANALYZE)
    }
    if (e.argv[0] === 'git') return { value: { ...ran('').value, exitCode: 128 } }
    return ran('')
  })

  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true } as never)
  const turn = (fields: object) =>
    $.turn.complete({ answer: 'Here.', durationMs: 1_000, isAborted: false, turnId: 't', reason: 'answer', ...fields } as never)

  expect((await turn({})).text).toBe(
    'jbcontext · this session explored 4K tokens in 1m 15s, ≈$3.00 (75% of $4.00) · jbcontext 2 calls, 20% of exploring tokens',
  )
  expect(linked).toEqual([
    ['ln', '-sf', `${project}/sess.jsonl`, `${project}/sess/subagents/agent-1.jsonl`, '/tmp/dev/jbcontext-watch/sess/session/'],
  ])
  expect(analyzed).toContain('/tmp/dev/jbcontext-watch/sess')

  // Nothing new explored: the answer stands alone.
  expect((await turn({})).text).toBe('Here.')
  // A subagent's turn never gets the line.
  transcript = `${TRANSCRIPT}\n${response('m5', 100, toolUse('Read', { file_path: '/r/b.kt' }))}`
  expect((await turn({ agentId: 'a1' })).text).toBe('Here.')

  const pane = await $.ui.mount({
    plugin: 'jbcontext-watch',
    surface: 'terminal',
    component: 'Pane',
    requestId: 'jbcontext',
    props: { title: 'jbcontext', bodyColumns: 120 } as never,
  })
  expect(await pane.find({ text: /Explored 4K tokens in 1m 15s, ≈\$3\.00/ })).toBeDefined()
  expect(await pane.find({ text: /jbcontext: 2 calls, 800 tokens, 20% of exploring/ })).toBeDefined()
  await pane.unmount()
})
