import type { On } from 'claude-code'
import { describe, expect, mock, test } from 'claude-code/testing'

import { API_USAGE, MINUTE, NOW, usage } from './fixtures'

const SURFACES = ['terminal', 'desktop'] as const

const band = (over: { bodyColumns?: number; maxRows?: number; hasSurvey?: boolean } = {}) =>
  ({
    hasSurvey: over.hasSurvey ?? false,
    isWorking: false,
    maxRows: over.maxRows ?? 20,
    bodyColumns: over.bodyColumns ?? 100,
  }) as never

// The engine beneath the plugin: what a session answers, and what the card's presses reach.
const world = (on: On) => {
  const clock = mock.clock(on, { now: NOW })
  let answer = usage({ apiUsage: null })

  on('session.usage', () => ({ value: answer }))
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('session.measure', (_$, e) => ({ changed: e.changed }))
  on('session.end', () => ({ sessionId: 'test' }))
  on('session.compact', () => ({ skip: 'test' }))
  // What the engine draws in the band when the card yields.
  on('ui.render', () => ({ type: 'Text', children: ['engine band'] }) as never)

  return {
    clock,
    answer: (next: ReturnType<typeof usage>) => {
      answer = next
    },
  }
}

const shown = async (ui: { find: (query: { text: string }) => Promise<unknown> }, text: string) =>
  (await ui.find({ text })) !== undefined

describe('the card', () => {
  test('draws the design on every surface that takes it', async ($, on) => {
    world(on)
    await $.session.start({ cwd: '/tmp' } as never)

    for (const surface of SURFACES) {
      const ui = await $.ui.mount({ plugin: 'usage-meter', surface, component: 'AbovePrompt', props: band() })

      for (const text of [
        'Context',
        '484k / 1M (48%)',
        'Compact at 97%',
        'System 11k',
        'Tools 63k',
        'Files 108k',
        'Messages 301k',
        'Free 516k',
        'Current session',
        'Usage 34%',
        'Time 54%',
        'Resets in 2h 18m',
        'Weekly limits',
        'Usage 23%',
        'Time 26%',
        'Resets in 5d 4h',
      ]) {
        expect(await shown(ui, text)).toBe(true)
      }

      expect(await ui.findAll({ type: 'Button' })).toHaveLength(0)

      await ui.unmount()
    }
  })

  test('the cache column waits for a reply, then shows warmth, hits and the note', async ($, on) => {
    const engine = world(on)
    await $.session.start({ cwd: '/tmp' } as never)
    const ui = await $.ui.mount({
      plugin: 'usage-meter',
      surface: 'terminal',
      component: 'AbovePrompt',
      props: band(),
    })

    expect(await shown(ui, 'Waiting for a reply')).toBe(true)

    engine.answer(usage({ apiUsage: API_USAGE }))
    await $.session.measure({ context: {}, rateLimits: [], changed: ['context'] } as never)

    expect(await shown(ui, 'Warm')).toBe(true)
    expect(await shown(ui, 'Warmth 100%')).toBe(true)
    expect(await shown(ui, 'Hit 99%')).toBe(true)
    expect(await shown(ui, '60m left of 60m')).toBe(true)
    expect(await shown(ui, 'Cache warm: next message reuses 484k from cache.')).toBe(true)

    await ui.unmount()
  })

  test('the countdowns run down as the minutes pass', async ($, on) => {
    const engine = world(on)
    await $.session.start({ cwd: '/tmp' } as never)
    engine.answer(usage())
    await $.session.measure({ context: {}, rateLimits: [], changed: ['context'] } as never)
    const ui = await $.ui.mount({
      plugin: 'usage-meter',
      surface: 'terminal',
      component: 'AbovePrompt',
      props: band(),
    })

    await engine.clock.advance(MINUTE)

    expect(await shown(ui, 'Resets in 2h 17m')).toBe(true)
    expect(await shown(ui, '59m left of 60m')).toBe(true)
    expect(await shown(ui, 'Warmth 98%')).toBe(true)

    await engine.clock.advance(60 * MINUTE)

    expect(await shown(ui, 'Cold')).toBe(true)
    expect(await shown(ui, 'Expired')).toBe(true)

    await ui.unmount()
  })

  test('the cache lifetime is the one configured', { options: { cacheTtl: '5m' } }, async ($, on) => {
    const engine = world(on)
    await $.session.start({ cwd: '/tmp' } as never)
    engine.answer(usage())
    await $.session.measure({ context: {}, rateLimits: [], changed: ['context'] } as never)
    const ui = await $.ui.mount({
      plugin: 'usage-meter',
      surface: 'terminal',
      component: 'AbovePrompt',
      props: band(),
    })

    expect(await shown(ui, '5m left of 5m')).toBe(true)

    await ui.unmount()
  })

  test('stacks its columns in a narrow terminal, and still draws every one', async ($, on) => {
    world(on)
    await $.session.start({ cwd: '/tmp' } as never)
    const ui = await $.ui.mount({
      plugin: 'usage-meter',
      surface: 'terminal',
      component: 'AbovePrompt',
      props: band({ bodyColumns: 60, maxRows: 8 }),
    })

    for (const text of ['Current session', 'Weekly limits', 'Cache']) {
      expect(await shown(ui, text)).toBe(true)
    }

    await ui.unmount()
  })

  test('keeps its three columns at 80 columns', async ($, on) => {
    world(on)
    await $.session.start({ cwd: '/tmp' } as never)
    const ui = await $.ui.mount({
      plugin: 'usage-meter',
      surface: 'terminal',
      component: 'AbovePrompt',
      props: band({ bodyColumns: 80 }),
    })
    const drawn = JSON.stringify(await ui.drawn())

    // Three columns of 22 cells and two gaps of 3 fit 74; stacked, each would be 74 wide.
    expect(drawn).toContain('"width":22')
    expect(drawn).toContain('"flexDirection":"row"')

    await ui.unmount()
  })

  test('yields to a survey', async ($, on) => {
    world(on)
    await $.session.start({ cwd: '/tmp' } as never)
    const ui = await $.ui.mount({
      plugin: 'usage-meter',
      surface: 'terminal',
      component: 'AbovePrompt',
      props: band({ hasSurvey: true }),
    })

    expect(await shown(ui, 'Current session')).toBe(false)

    await ui.unmount()
  })

  test('takes the figures again after a /compact', async ($, on) => {
    const engine = world(on)
    await $.session.start({ cwd: '/tmp' } as never)
    const ui = await $.ui.mount({
      plugin: 'usage-meter',
      surface: 'terminal',
      component: 'AbovePrompt',
      props: band(),
    })

    expect(await shown(ui, 'Usage 34%')).toBe(true)

    engine.answer(usage({ withLimits: false }))
    await $.session.compact({
      trigger: 'manual',
      messages: [{ role: 'user', text: 'hello', toolUses: [] }],
    } as never)

    expect(await shown(ui, 'Waiting for a reading')).toBe(true)

    await ui.unmount()
  })

  test('takes the card down on /clear, until the next response brings figures', async ($, on) => {
    const engine = world(on)
    await $.session.start({ cwd: '/tmp' } as never)
    const ui = await $.ui.mount({
      plugin: 'usage-meter',
      surface: 'terminal',
      component: 'AbovePrompt',
      props: band(),
    })

    await $.session.end({ reason: 'clear' } as never)
    expect(await shown(ui, 'Current session')).toBe(false)

    engine.answer(usage())
    await $.session.measure({ context: {}, rateLimits: [], changed: ['context'] } as never)
    expect(await shown(ui, 'Current session')).toBe(true)

    await ui.unmount()
  })
})
