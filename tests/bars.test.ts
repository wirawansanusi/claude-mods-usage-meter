import { describe, expect, test } from 'claude-code/testing'

import { cacheBar, COLORS, contextBar, PALETTES, paceBar } from '../hooks/bars'
import type { Span } from '../hooks/bars'

const length = (spans: readonly Span[]) => spans.reduce((sum, span) => sum + span.text.length, 0)
const runs = (spans: readonly Span[]) => spans.map(span => [span.color, span.text.length])

describe('contextBar', () => {
  const segments = [
    { kind: 'system', tokens: 11_000 },
    { kind: 'tools', tokens: 63_000 },
    { kind: 'files', tokens: 108_000 },
    { kind: 'messages', tokens: 301_000 },
  ] as const

  test('is as wide as asked, each category in its colour, the rest track', () => {
    const bar = contextBar(50, 1_000_000, segments)

    expect(length(bar)).toBe(50)
    expect(bar.map(span => span.color)).toEqual([
      COLORS.system,
      COLORS.tools,
      COLORS.files,
      COLORS.messages,
      COLORS.track,
    ])
  })

  test('a category too small for a cell still gets one', () => {
    const bar = contextBar(40, 1_000_000, segments)

    expect(bar[0]).toMatchObject({ color: COLORS.system })
    expect(bar[0]?.text.length).toBe(1)
  })

  test('marks where auto-compaction runs', () => {
    const bar = contextBar(100, 1_000_000, segments, 970_000)

    expect(length(bar)).toBe(100)
    expect(bar.at(-2)).toMatchObject({ color: 'text', text: '┃' })
  })

  test('a window filled past its end stays inside the bar', () => {
    const bar = contextBar(20, 100, [{ kind: 'messages', tokens: 150 }])

    expect(runs(bar)).toEqual([[COLORS.messages, 20]])
  })
})

describe('paceBar', () => {
  test('usage bright, the allowance up to the time tick dim, the rest track', () => {
    const bar = paceBar(29, 34, 54, PALETTES.session)

    expect(length(bar)).toBe(29)
    expect(runs(bar)).toEqual([
      [PALETTES.session.bright, 10],
      [PALETTES.session.dim, 6],
      ['text', 1],
      [COLORS.track, 12],
    ])
  })

  test('usage ahead of time runs bright past the tick, with no allowance to show', () => {
    const bar = paceBar(29, 80, 30, PALETTES.weekly)

    expect(length(bar)).toBe(29)
    expect(runs(bar)).toEqual([
      [PALETTES.weekly.bright, 9],
      ['text', 1],
      [PALETTES.weekly.bright, 13],
      [COLORS.track, 6],
    ])
  })

  test('nearly out turns the bar to the danger colour', () => {
    expect(paceBar(20, 93, 10, PALETTES.session)[0]?.color).toBe(COLORS.danger)
  })

  test('without a time there is no tick', () => {
    expect(runs(paceBar(20, 50, undefined, PALETTES.session))).toEqual([
      [PALETTES.session.bright, 10],
      [COLORS.track, 10],
    ])
  })
})

describe('cacheBar', () => {
  test('a warm cache is a blue-to-orange gradient to its end', () => {
    const bar = cacheBar(30, 100)

    expect(length(bar)).toBe(30)
    expect(bar[0]?.color).toBe('#4f86e8')
    expect(bar.at(-1)?.color).toBe('#e8944a')
  })

  test('the gradient stops where the warmth does', () => {
    const bar = cacheBar(30, 50)

    expect(length(bar)).toBe(30)
    expect(bar.at(-1)).toMatchObject({ color: COLORS.track, text: '━'.repeat(15) })
  })

  test('a cold cache is all track', () => {
    expect(runs(cacheBar(30, 0))).toEqual([[COLORS.track, 30]])
  })
})
