import type { Segment, SegmentKind } from '../types'
import { clamp } from './format'

// A run of text in one colour: what the card draws a bar from.
export type Span = { text: string; color?: string; dim?: boolean; bold?: boolean }

type Cell = { char: string; color: string }
type Rgb = readonly [number, number, number]

const LINE = '━'
const TICK = '┃'

export const COLORS: Record<SegmentKind, string> & {
  track: string
  danger: string
  warm: string
  cold: string
} = {
  system: '#8b8b90',
  tools: '#8b6bd6',
  files: '#4f86e8',
  messages: '#d2733f',
  other: '#b9a24b',
  track: '#38383a',
  danger: '#e5584b',
  warm: '#e8944a',
  cold: '#4f86e8',
}

export const PALETTES = {
  session: { bright: '#6cc07a', dim: '#335a3b' },
  weekly: { bright: '#4f86e8', dim: '#2c4478' },
}

const CACHE_FROM: Rgb = [0x4f, 0x86, 0xe8]
const CACHE_TO: Rgb = [0xe8, 0x94, 0x4a]

const emptyCells = (width: number): Cell[] =>
  Array.from({ length: width }, () => ({ char: LINE, color: COLORS.track }))

// Neighbouring cells of one colour become one span.
const toSpans = (cells: readonly Cell[]): Span[] => {
  const spans: Span[] = []

  for (const cell of cells) {
    const last = spans[spans.length - 1]

    if (last && last.color === cell.color) {
      last.text += cell.char
    } else {
      spans.push({ text: cell.char, color: cell.color })
    }
  }

  return spans
}

// The context window: a slice per category, a tick where auto-compaction runs.
export const contextBar = (
  width: number,
  window: number,
  segments: readonly Segment[],
  compactAt?: number,
): Span[] => {
  const cells = emptyCells(width)
  let end = 0
  let cumulative = 0

  for (const segment of segments) {
    if (segment.tokens <= 0) continue

    cumulative += segment.tokens
    // Every category with tokens keeps at least one cell, however small.
    const next = Math.min(width, Math.max(end + 1, Math.round((cumulative / window) * width)))

    for (let i = end; i < next; i++) cells[i] = { char: LINE, color: COLORS[segment.kind] }

    end = next
  }

  if (compactAt !== undefined && compactAt > 0) {
    cells[Math.min(width - 1, Math.round((compactAt / window) * width))] = { char: TICK, color: 'text' }
  }

  return toSpans(cells)
}

// A rate-limit window: usage in the bright colour, the time elapsed marked by a
// tick, and the stretch between usage and the tick dim: what was allowed so far
// and not used. Past the tick, usage is ahead of time.
export const paceBar = (
  width: number,
  usage: number,
  elapsed: number | undefined,
  palette: { bright: string; dim: string },
): Span[] => {
  const used = Math.round((clamp(usage, 0, 100) / 100) * width)
  const tick = elapsed === undefined ? -1 : Math.min(width - 1, Math.round((elapsed / 100) * width))
  const bright = usage >= 90 ? COLORS.danger : palette.bright

  return toSpans(
    emptyCells(width).map((cell, i): Cell => {
      if (i === tick) return { char: TICK, color: 'text' }
      if (i < used) return { char: LINE, color: bright }
      if (i < tick) return { char: LINE, color: palette.dim }

      return cell
    }),
  )
}

const hex = ([r, g, b]: Rgb): string =>
  `#${[r, g, b].map(channel => Math.round(channel).toString(16).padStart(2, '0')).join('')}`

const mix = (from: Rgb, to: Rgb, t: number): Rgb => [
  from[0] + (to[0] - from[0]) * t,
  from[1] + (to[1] - from[1]) * t,
  from[2] + (to[2] - from[2]) * t,
]

// The prompt cache: a blue-to-orange gradient filled as far as it is warm.
export const cacheBar = (width: number, warmth: number): Span[] => {
  const filled = Math.round((clamp(warmth, 0, 100) / 100) * width)

  return toSpans(
    emptyCells(width).map((cell, i): Cell =>
      i < filled
        ? { char: LINE, color: hex(mix(CACHE_FROM, CACHE_TO, width > 1 ? i / (width - 1) : 1)) }
        : cell,
    ),
  )
}
