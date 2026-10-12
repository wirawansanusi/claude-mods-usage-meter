import { describe, expect, test } from 'claude-code/testing'

import { clamp, countdown, tokens } from '../hooks/format'
import { buildSnapshot, cacheViewOf, paceOf, WINDOWS } from '../hooks/model'
import { API_USAGE, at, DAY, HOUR, MINUTE, NOW, usage } from './fixtures'

describe('format', () => {
  test('tokens are written as the design writes them', () => {
    expect(tokens(950)).toBe('950')
    expect(tokens(11_000)).toBe('11k')
    expect(tokens(301_400)).toBe('301k')
    expect(tokens(516_000)).toBe('516k')
    expect(tokens(1_000_000)).toBe('1M')
    expect(tokens(1_500_000)).toBe('1.5M')
    expect(tokens(999_700)).toBe('1M')
  })

  test('a countdown names the two largest units', () => {
    expect(countdown(NOW + 42 * MINUTE, NOW)).toBe('42m')
    expect(countdown(NOW + 2 * HOUR + 18 * MINUTE, NOW)).toBe('2h 18m')
    expect(countdown(NOW + 3 * DAY + 4 * HOUR, NOW)).toBe('3d 4h')
    expect(countdown(NOW - MINUTE, NOW)).toBe('0m')
  })

  test('clamp holds a value inside its range', () => {
    expect(clamp(120, 0, 100)).toBe(100)
    expect(clamp(-3, 0, 100)).toBe(0)
    expect(clamp(40, 0, 100)).toBe(40)
  })
})

describe('buildSnapshot', () => {
  test('groups the used rows into the design categories and leaves free space out', () => {
    const snapshot = buildSnapshot(usage(), NOW, null, true)

    expect(snapshot?.segments).toEqual([
      { kind: 'system', tokens: 11_000 },
      { kind: 'tools', tokens: 63_000 },
      { kind: 'files', tokens: 108_000 },
      { kind: 'messages', tokens: 301_000 },
    ])
    expect(snapshot?.used).toBe(484_000)
    expect(snapshot?.window).toBe(1_000_000)
  })

  test('a row it does not know lands in other', () => {
    const base = usage()
    const breakdown = base.context.breakdown as unknown as { categories: unknown[] }
    breakdown.categories.push({ name: 'Skills', tokens: 5_000, color: 'x', isDeferred: false, kind: 'used' })

    expect(buildSnapshot(base, NOW, null, true)?.segments.at(-1)).toEqual({ kind: 'other', tokens: 5_000 })
  })

  test('auto-compaction is marked only while it is on', () => {
    expect(buildSnapshot(usage(), NOW, null, true)?.compactAt).toBe(970_000)
    expect(buildSnapshot(usage({ isAutoCompactEnabled: false }), NOW, null, true)?.compactAt).toBeUndefined()
  })

  test('without a breakdown the whole fill is one slice', () => {
    const bare = { startedAt: 0, context: { window: 200_000, tokens: 50_000, percent: 25 }, rateLimits: [] }
    const snapshot = buildSnapshot(bare as never, NOW, null, true)

    expect(snapshot?.segments).toEqual([{ kind: 'other', tokens: 50_000 }])
    expect(snapshot?.window).toBe(200_000)
  })

  test('nothing to draw before the window has a fill', () => {
    const empty = { startedAt: 0, context: { window: 200_000 }, rateLimits: [] }

    expect(buildSnapshot(empty as never, NOW, null, true)).toBeNull()
  })

  test('the cache hit is the share of the prompt the cache served', () => {
    expect(buildSnapshot(usage(), NOW, null, true)?.cache).toMatchObject({ hitPercent: 99, promptTokens: 484_000 })
  })

  test('a response already there at start has no known time', () => {
    expect(buildSnapshot(usage(), NOW, null, true)?.cache?.at).toBeUndefined()
  })

  test('a response that arrives is dated when it is seen, and keeps that date until the next', () => {
    const fresh = buildSnapshot(usage({ apiUsage: null }), NOW, null, true)
    const first = buildSnapshot(usage(), NOW + MINUTE, fresh, false)
    const later = buildSnapshot(usage(), NOW + 5 * MINUTE, first, false)
    const next = buildSnapshot(
      usage({ apiUsage: { ...API_USAGE, output_tokens: 1_200 } }),
      NOW + 9 * MINUTE,
      later,
      false,
    )

    expect(first?.cache?.at).toBe(NOW + MINUTE)
    expect(later?.cache?.at).toBe(NOW + MINUTE)
    expect(next?.cache?.at).toBe(NOW + 9 * MINUTE)
  })

  test('a reload mid-session keeps the date of the response it saw', () => {
    const seen = buildSnapshot(usage(), NOW + MINUTE, buildSnapshot(usage({ apiUsage: null }), NOW, null, true), false)
    const reloaded = buildSnapshot(usage(), NOW + 7 * MINUTE, seen, true)

    expect(reloaded?.cache?.at).toBe(NOW + MINUTE)
  })

  test('no cache reading after a compaction, until the next response', () => {
    expect(buildSnapshot(usage({ apiUsage: null }), NOW, null, false)?.cache).toBeUndefined()
  })
})

describe('paceOf', () => {
  const limits = usage().rateLimits

  test('the session window: 34% used with 54% of its time gone', () => {
    expect(paceOf(limits, WINDOWS.session, NOW)).toEqual({
      state: 'live',
      usage: 34,
      elapsed: 54,
      resetsIn: '2h 18m',
    })
  })

  test('the weekly window: 23% used with 26% of its time gone', () => {
    expect(paceOf(limits, WINDOWS.weekly, NOW)).toEqual({
      state: 'live',
      usage: 23,
      elapsed: 26,
      resetsIn: '5d 4h',
    })
  })

  test('a window that reset since the last reading says so', () => {
    const stale = [{ kind: 'five_hour', percentUsed: 88, resetsAt: at(-MINUTE) }]

    expect(paceOf(stale, WINDOWS.session, NOW)).toEqual({ state: 'reset' })
  })

  test('a window without a reading is missing', () => {
    expect(paceOf([], WINDOWS.weekly, NOW)).toEqual({ state: 'missing' })
    expect(paceOf([{ kind: 'spend_limit', percentUsed: 40 }], WINDOWS.weekly, NOW)).toEqual({ state: 'missing' })
  })

  test('a window without a reset time still reports its usage', () => {
    expect(paceOf([{ kind: 'five_hour', percentUsed: 5 }], WINDOWS.session, NOW)).toEqual({
      state: 'live',
      usage: 5,
    })
  })
})

describe('cacheViewOf', () => {
  const cache = { hitPercent: 99, promptTokens: 484_000, signature: 'x', at: NOW }

  test('a minute after the response, 59 of 60 minutes are left', () => {
    expect(cacheViewOf(cache, NOW + MINUTE, HOUR)).toEqual({
      state: 'warm',
      warmth: 98,
      hitPercent: 99,
      promptTokens: 484_000,
      leftMinutes: 59,
      ttlMinutes: 60,
    })
  })

  test('past its lifetime the cache is cold', () => {
    expect(cacheViewOf(cache, NOW + HOUR + MINUTE, HOUR)).toMatchObject({ state: 'cold', warmth: 0, leftMinutes: 0 })
  })

  test('the lifetime is the one asked for', () => {
    expect(cacheViewOf(cache, NOW + 6 * MINUTE, 5 * MINUTE).state).toBe('cold')
    expect(cacheViewOf(cache, NOW + 6 * MINUTE, HOUR).state).toBe('warm')
  })

  test('no reading, or one without a time, is unknown', () => {
    expect(cacheViewOf(undefined, NOW, HOUR)).toEqual({ state: 'unknown' })
    expect(cacheViewOf({ ...cache, at: undefined }, NOW, HOUR)).toEqual({ state: 'unknown' })
  })
})
