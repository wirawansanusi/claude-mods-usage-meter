import type { ContextCategory, ModelUsage, SessionRateLimit, SessionUsage } from 'claude-code'

import type { CacheReading, Segment, SegmentKind, Snapshot } from '../types'
import { clamp, countdown } from './format'

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

export const SEGMENT_ORDER: readonly SegmentKind[] = ['system', 'tools', 'files', 'messages', 'other']

// /context's own row names; a row this does not know lands in `other`.
const kindOf = (name: string): SegmentKind => {
  if (/^system prompt/i.test(name)) return 'system'
  if (/tool/i.test(name)) return 'tools'
  if (/memory|file/i.test(name)) return 'files'
  if (/^messages$/i.test(name)) return 'messages'

  return 'other'
}

const segmentsOf = (categories: readonly ContextCategory[]): Segment[] => {
  const totals = new Map<SegmentKind, number>()

  for (const category of categories) {
    if (category.kind !== 'used') continue
    const kind = kindOf(category.name)
    totals.set(kind, (totals.get(kind) ?? 0) + category.tokens)
  }

  return SEGMENT_ORDER.flatMap(kind => {
    const count = totals.get(kind) ?? 0

    return count > 0 ? [{ kind, tokens: count }] : []
  })
}

const cacheOf = (
  api: ModelUsage | null,
  now: number,
  previous: Snapshot | null,
  isStart: boolean,
): CacheReading | undefined => {
  if (!api) return undefined

  const promptTokens = api.input_tokens + api.cache_read_input_tokens + api.cache_creation_input_tokens
  const signature = [
    api.input_tokens,
    api.output_tokens,
    api.cache_read_input_tokens,
    api.cache_creation_input_tokens,
  ].join('/')
  const before = previous?.cache

  // A response this plugin saw arrive is dated now. One already there when it
  // loaded (a resumed session) has no known time, so its warmth is unknown.
  const at = before?.signature === signature ? before.at : isStart ? undefined : now

  return {
    hitPercent: promptTokens > 0 ? Math.round((api.cache_read_input_tokens / promptTokens) * 100) : 0,
    promptTokens,
    signature,
    at,
  }
}

// The card's one value, from what `$.session.usage({ breakdown })` answers.
// `isStart` is the session starting (or this plugin reloading), not a response arriving.
export const buildSnapshot = (
  usage: SessionUsage,
  now: number,
  previous: Snapshot | null,
  isStart: boolean,
): Snapshot | null => {
  const { context, rateLimits } = usage
  const breakdown = context.breakdown
  const used = breakdown?.totalTokens ?? context.tokens
  const window = breakdown?.rawMaxTokens ?? context.window

  if (used === undefined || window <= 0) return null

  return {
    now,
    window,
    used,
    segments: breakdown ? segmentsOf(breakdown.categories) : [{ kind: 'other', tokens: used }],
    compactAt: breakdown?.isAutoCompactEnabled ? breakdown.autoCompactThreshold : undefined,
    limits: [...rateLimits],
    cache: cacheOf(breakdown?.apiUsage ?? null, now, previous, isStart),
  }
}

export type PaceReading =
  | { state: 'missing' }
  | { state: 'reset' }
  // `elapsed` is how much of the window's time has passed, 0 to 100.
  | { state: 'live'; usage: number; elapsed?: number; resetsIn?: string }

export const WINDOWS = {
  session: { kind: 'five_hour', lengthMs: 5 * HOUR },
  weekly: { kind: 'seven_day', lengthMs: 7 * DAY },
} as const

export const paceOf = (
  limits: readonly SessionRateLimit[],
  window: (typeof WINDOWS)[keyof typeof WINDOWS],
  now: number,
): PaceReading => {
  const limit = limits.find(one => one.kind === window.kind)

  if (!limit) return { state: 'missing' }

  const resetsAt = limit.resetsAt === undefined ? Number.NaN : Date.parse(limit.resetsAt)

  if (Number.isNaN(resetsAt)) return { state: 'live', usage: limit.percentUsed }

  // The reading is from before the window reset; it says nothing about the new one.
  if (resetsAt <= now) return { state: 'reset' }

  const elapsed = clamp(100 - ((resetsAt - now) / window.lengthMs) * 100, 0, 100)

  return {
    state: 'live',
    usage: limit.percentUsed,
    elapsed: Math.round(elapsed),
    resetsIn: countdown(resetsAt, now),
  }
}

export type CacheView =
  | { state: 'unknown' }
  | {
      state: 'warm' | 'cold'
      // How much of the cache's lifetime is left, 0 to 100.
      warmth: number
      hitPercent: number
      promptTokens: number
      leftMinutes: number
      ttlMinutes: number
    }

export const cacheViewOf = (cache: CacheReading | undefined, now: number, ttlMs: number): CacheView => {
  if (!cache || cache.at === undefined) return { state: 'unknown' }

  const left = clamp(ttlMs - (now - cache.at), 0, ttlMs)

  return {
    state: left > 0 ? 'warm' : 'cold',
    warmth: Math.round((left / ttlMs) * 100),
    hitPercent: cache.hitPercent,
    promptTokens: cache.promptTokens,
    leftMinutes: Math.ceil(left / MINUTE),
    ttlMinutes: Math.round(ttlMs / MINUTE),
  }
}
