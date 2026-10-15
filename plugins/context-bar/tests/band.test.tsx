// The whole mod, end to end, as a session runs it: a fake session beneath it
// (usage, conversation, limits, cost, zoom, theme), then its hooks raised as
// the engine raises them, drawn on the terminal and in the desktop app.

import { describe, expect, mock, test } from 'claude-code/testing'

import { CATEGORY_COLORS, LIGHT_THEME_COLORS } from '../hooks/config'

const HOUR = 3_600_000
const NOW = Date.parse('2026-10-13T10:00:00Z')
const ZOOM = 1.2 ** -0.5
const SURFACES = ['terminal', 'desktop'] as const

type World = {
  messagesTokens: number
  free: number
  rateLimits: { kind: string; percentUsed: number; resetsAt?: string }[]
  costUsd: number
  lightTheme: boolean
}

/** A session beneath the plugin, answering everything it asks. */
function setUp(on: any, overrides: Partial<World> = {}) {
  const world: World = {
    messagesTokens: 40_000,
    free: 130_000,
    rateLimits: [
      { kind: 'five_hour', percentUsed: 30, resetsAt: new Date(NOW + 2.5 * HOUR).toISOString() }, // half the window gone
      { kind: 'seven_day', percentUsed: 20, resetsAt: new Date(NOW + 84 * HOUR).toISOString() },
    ],
    costUsd: 1.237,
    lightTheme: false,
    ...overrides,
  }
  const clock = mock.clock(on, { now: NOW })
  mock.store(on)
  mock.env(on, { APPDATA: 'C:/AppData' })
  const toasts: string[] = []

  // The engine's own part of each event the plugin hooks, answered plainly.
  on('session.start', (_$: any, e: any) => ({ cwd: e.cwd }))
  on('turn.complete', (_$: any, e: any) => ({ text: e.text }))
  on('session.measure', (_$: any, e: any) => ({ changed: e.changed }))
  on('command.register', () => ({ value: {} }))
  on('ui.toast', (_$: any, e: any) => {
    toasts.push(String(e.text ?? e))
    return { value: undefined }
  })
  on('fs.read', (_$: any, e: any) => {
    // The engine hands paths over in the platform's form (backslashes on Windows).
    if (String(e.path).replace(/\\/g, '/').endsWith('Claude/config.json')) return { value: JSON.stringify({ windowControlsZoomFactor: ZOOM }) }
    return { deny: 'no such file' }
  })
  on('process.run', () => ({
    value: { exitCode: 0, stdout: `    AppsUseLightTheme    REG_DWORD    0x${world.lightTheme ? 1 : 0}`, stderr: '' },
  }))
  on('session.messages', () => ({ value: [
    { role: 'user', content: [{ type: 'text', text: 'x'.repeat(4_000) }] },
    { role: 'assistant', content: [{ type: 'text', text: 'x'.repeat(8_000) }] },
    { role: 'assistant', content: [{ type: 'tool_use', id: 'r', name: 'Read', input: { file_path: 'a.ts' } }] },
    { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'r', content: 'x'.repeat(16_000) }] },
    { role: 'assistant', content: [{ type: 'tool_use', id: 'b', name: 'Bash', input: { command: 'npm test' } }] },
    { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'b', content: 'x'.repeat(12_000) }] },
  ] }))
  on('session.usage', () => {
    const categories = [
      { name: 'System prompt', tokens: 800, color: 'promptBorder', kind: 'used' }, // under 1%: Other
      { name: 'System tools', tokens: 6_800, color: 'inactive', kind: 'used' },
      { name: 'Skills', tokens: 3_000, color: 'warning', kind: 'used' },
      { name: 'Messages', tokens: world.messagesTokens, color: 'purple', kind: 'used' },
      { name: 'Free space', tokens: world.free, color: 'promptBorder', kind: 'free' },
      { name: 'Autocompact buffer', tokens: 6_600, color: 'inactive', kind: 'buffer' },
    ]
    return {
      value: {
        startedAt: NOW,
        context: { window: 200_000, breakdown: { categories, rawMaxTokens: 200_000 } },
        rateLimits: world.rateLimits,
        cost: { usd: world.costUsd },
      },
    }
  })
  return { world, clock, toasts }
}

const start = ($: any) => $.session.start({ source: 'startup', cwd: 'C:/project', surface: null, isInteractive: true })
const reply = ($: any) => $.turn.complete({ reason: 'end_turn', text: '', turnId: 't', category: null, explanation: null })
const command = ($: any, args: string) =>
  $.command.run({ command: 'context-bar', args, origin: { kind: 'composer' }, presentation: {} })
const mount = ($: any, surface: (typeof SURFACES)[number]) =>
  $.ui.mount({
    plugin: 'context-bar',
    surface,
    component: 'AbovePrompt',
    props: { hasSurvey: false, isWorking: false, maxRows: 20, bodyColumns: 140 },
  })

/** The legend's entries, in order, as drawn (without the details after `│`). */
async function legend(ui: any): Promise<string[]> {
  const row = await ui.find({ key: 'legend' })
  return (row?.text ?? '').split('│')[0].split('■').map((s: string) => s.trim()).filter(Boolean)
}

for (const surface of SURFACES) {
  describe(`on the ${surface}`, () => {
    test('draws the bar, the legend in order, both limits and the buttons', async ($, on) => {
      setUp(on)
      await start($)
      const ui = await mount($, surface)

      const names = (await legend(ui)).map(e => e.replace(/ [\d.]+%.*$/, ''))
      expect(names[0]).toBe('Autocompact buffer')
      expect(names[1]).toBe('Other')
      expect(names.at(-1)).toBe('Free space')
      // Between Other and Free space, smallest first; Messages split in parts.
      const middle = (await legend(ui)).slice(2, -1).map(e => parseFloat(e.match(/([\d.]+)%/)![1]!))
      expect(middle.length).toBeGreaterThan(3)
      expect([...middle].sort((a, b) => a - b)).toEqual(middle)
      expect(names).toContain('File reads')
      expect(names).toContain('Commands')
      expect(names).not.toContain('Messages')

      expect(await ui.find({ type: 'Text', text: /^◷ Session 30%/ })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: /^▦ Weekly 20%/ })).toBeDefined()
      for (const part of ['context', 'session', 'weekly']) expect(await ui.find({ key: `toggle-${part}-box` })).toBeDefined()
      await ui.unmount()
    })

    test('a click moves a category into Other, and back', async ($, on) => {
      setUp(on)
      await start($)
      const ui = await mount($, surface)
      await ui.press({ key: 'legend-Skills-press' })
      expect((await legend(ui)).some(e => e.startsWith('Skills'))).toBe(false)
      await ui.press({ key: 'legend-other-press' })
      expect((await ui.find({ key: 'other-list' }))?.text).toContain('Skills')
      await ui.press({ key: 'other-Skills-press' })
      expect((await legend(ui)).some(e => e.startsWith('Skills'))).toBe(true)
      await ui.unmount()
    })

    test('commands hide and bring back a category', async ($, on) => {
      setUp(on)
      await start($)
      expect((await command($, 'hide skills')).text).toBe('Skills moved into Other.')
      let ui = await mount($, surface)
      expect((await legend(ui)).some(e => e.startsWith('Skills'))).toBe(false)
      await ui.unmount()
      expect((await command($, 'unhide all')).text).toBe('Every category is back in the legend.')
      expect((await command($, 'hide nothing-like-this')).text).toContain('No category called')
      ui = await mount($, surface)
      expect((await legend(ui)).some(e => e.startsWith('Skills'))).toBe(true)
      await ui.unmount()
    })

    test('the buttons and commands show and hide each part', async ($, on) => {
      setUp(on)
      await start($)
      const ui = await mount($, surface)
      await ui.press({ key: 'toggle-session' })
      expect(await ui.find({ type: 'Text', text: /^◷ Session/ })).toBeUndefined()
      await ui.press({ key: 'toggle-session' })
      expect(await ui.find({ type: 'Text', text: /^◷ Session/ })).toBeDefined()
      await ui.unmount()
      expect((await command($, 'weekly')).text).toBe('Weekly hidden.')
      expect((await command($, 'weekly')).text).toBe('Weekly shown.')
      expect((await command($, '')).text).toBe('Context bar off.')
      expect((await command($, '')).text).toBe('Context bar on.')
    })

    test('after a reply, the legend says what it added', async ($, on) => {
      const { world } = setUp(on, { rateLimits: [] })
      await start($)
      world.messagesTokens += 3_200
      world.free -= 3_200
      await reply($)
      const ui = await mount($, surface)
      expect((await ui.find({ type: 'Text', text: /^│/ }))?.text).toBe('│ +3.2k last reply · $1.24 session')
      await ui.unmount()
    })

    test('"resets in" moves with the clock between replies', async ($, on) => {
      const { clock } = setUp(on)
      await start($)
      const ui = await mount($, surface)
      expect(await ui.find({ type: 'Text', text: /Session 30% · 2h 30m/ })).toBeDefined()
      await clock.advance(60_000)
      expect(await ui.find({ type: 'Text', text: /Session 30% · 2h 29m/ })).toBeDefined()
      await ui.unmount()
    })
  })
}

describe('in the desktop app', () => {
  test('bars carry hover details and land on whole screen pixels', async ($, on) => {
    setUp(on)
    await start($)
    const ui = await mount($, 'desktop')
    const svgs = await ui.findAll({ type: 'Svg' })
    const context = svgs.find((s: any) => /Context window/.test(s.props.alt)).props
    expect(context.isInteractive).toBe(true)
    expect(context.source).toContain('<title>System tools · 6.8k · 3.4%</title>')
    const session = svgs.find((s: any) => /Session limit/.test(s.props.alt)).props
    expect(session.source).toContain('<title>Session: 30% used, resets in 2h 30m</title>')
    // 5 screen pixels at the app's zoom, for both limit bars.
    const weekly = svgs.find((s: any) => /Weekly limit/.test(s.props.alt)).props
    expect(Math.abs(session.height - 5 / ZOOM)).toBeLessThan(1e-9)
    expect(weekly.height).toBe(session.height)
    await ui.unmount()
  })

  test('follows a light system theme', async ($, on) => {
    setUp(on, { lightTheme: true })
    await start($)
    const ui = await mount($, 'desktop')
    expect((await ui.find({ type: 'Text', text: /^System tools/ }))?.props.color).toBe(CATEGORY_COLORS['System tools'])
    const context = (await ui.findAll({ type: 'Svg' })).find((s: any) => /Context window/.test(s.props.alt)).props
    expect(context.source).toContain(`fill="${LIGHT_THEME_COLORS.free}"`)
    await ui.unmount()
  })
})

describe('alerts', () => {
  test('once when the context passes 80%, not again on the next reply', async ($, on) => {
    const { world, toasts } = setUp(on)
    await start($)
    expect(toasts).toEqual([])
    world.messagesTokens += 100_000
    world.free -= 100_000 // 85% full
    await reply($)
    await reply($)
    expect(toasts.filter(t => t.startsWith('Context'))).toEqual(['Context 85% full: 30k left before it compacts.'])
  })

  test('once when a limit turns red', async ($, on) => {
    const { world, toasts } = setUp(on)
    await start($)
    world.rateLimits = [{ kind: 'five_hour', percentUsed: 80, resetsAt: new Date(NOW + 2.5 * HOUR).toISOString() }]
    await reply($)
    await reply($)
    expect(toasts.filter(t => t.startsWith('Session'))).toEqual([
      'Session limit 80%: at this pace it runs out before it resets (in 2h 30m).',
    ])
  })
})
