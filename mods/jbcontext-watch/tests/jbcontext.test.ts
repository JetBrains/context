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
  touchesJbcontext,
} from '../hooks/model'

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
  const { searches, errors } = mergeDays([parseStatsDay(DAY), parseStatsDay('not json')], 20)
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
