import type { RenderElement } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

import {
  claudeProjectDir,
  explorePrice,
  isInRepo,
  mergeDays,
  normalizeRepo,
  parseStatsDay,
  parseStatus,
  savedTokens,
  scopeToRepo,
  touchesJbcontext,
} from '../hooks/model'
import type { JbError, JbSearch } from '../types'

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

test('band shows index status and the last search while Claude works', async ($, on) => {
  mock.env(on, { HOME: '/home/dev' })
  mock.clock(on, { now: NOW })
  on('fs.list', async () => ({
    value: [{ name: '2026-10-07.json', kind: 'file', size: DAY.length, mtimeMs: NOW, isLink: false }],
  }))
  on('fs.read', async () => ({ value: DAY }))
  on('fs.exists', async () => ({ value: true }))
  on('ui.panes', async () => ({ value: [] }))
  on('session.start', async (_$, e) => ({ cwd: e.cwd }))
  on('command.register', async (_$, e) => ({ value: { command: e.name } }))
  on('ui.render', async ($, e) => {
    const { Text } = $.ui.resolve(e)
    return h(Text, {}, 'engine band') as RenderElement
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

  await $.session.start({ cwd: '/repo', surface: 'terminal' } as never)

  const band = (isWorking: boolean) => ({
    hasSurvey: false,
    isWorking,
    maxRows: 10,
    bodyColumns: 120,
    scroll: { offset: 0, bodyRows: 9 },
    view: {},
  })

  for (const surface of ['terminal', 'desktop'] as const) {
    let ui = await $.ui.mount({ plugin: 'jbcontext-watch', surface, component: 'AbovePrompt', props: band(true) as never })
    for (let attempt = 0; attempt < 20 && !(await ui.find({ text: /indexed/ })); attempt++) {
      await ui.unmount()
      ui = await $.ui.mount({ plugin: 'jbcontext-watch', surface, component: 'AbovePrompt', props: band(true) as never })
    }
    expect((await ui.find({ text: /main @ a6f44ddb indexed 1h ago/ }))).toBeDefined()
    expect((await ui.find({ text: /where is the stats writer/ }))).toBeDefined()
    expect(await ui.find({ text: /air assistant button/ })).toBeUndefined()
    expect((await ui.find({ text: /Token is expired/ }))).toBeDefined()
    await ui.unmount()

    const idle = await $.ui.mount({ plugin: 'jbcontext-watch', surface, component: 'AbovePrompt', props: band(false) as never })
    expect(await idle.find({ text: /jbcontext/ })).toBeUndefined()
    await idle.unmount()

    const pane = await $.ui.mount({
      plugin: 'jbcontext-watch',
      surface,
      component: 'Pane',
      requestId: 'jbcontext',
      props: { title: 'jbcontext', bodyColumns: 120 } as never,
    })
    expect(await pane.find({ text: /Latest searches in widgets/ })).toBeDefined()
    expect(await pane.find({ text: /where is the stats writer/ })).toBeDefined()
    expect(await pane.find({ text: /air assistant button/ })).toBeUndefined()
    expect(await pane.find({ text: /1 more in other repositories/ })).toBeDefined()
    expect(await pane.find({ text: /Token is expired/ })).toBeDefined()
    await pane.unmount()
  }
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
