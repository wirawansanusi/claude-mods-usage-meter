import type { Elements } from 'claude-code'

import type { SegmentKind, Snapshot } from '../types'
import { cacheBar, COLORS, contextBar, PALETTES, paceBar } from './bars'
import type { Span } from './bars'
import { tokens } from './format'
import { cacheViewOf, paceOf, WINDOWS } from './model'
import type { CacheView, PaceReading } from './model'

// The elements the card draws with, the same on the terminal and the desktop.
type Kit = Pick<Elements['terminal'], 'Box' | 'Text'>

export type CardProps = {
  snapshot: Snapshot
  // How long the prompt cache keeps a conversation warm, in ms.
  ttlMs: number
  // Cells and rows the band has (`bodyColumns`, `maxRows`).
  columns: number
  rows: number
}

type Column = { heading: Span[]; bar: Span[]; stats: Span[]; detail: Span[] }

const LABELS: Record<SegmentKind, string> = {
  system: 'System',
  tools: 'Tools',
  files: 'Files',
  messages: 'Messages',
  other: 'Other',
}

const COLUMN_GAP = 3
// Border and padding on each side of the card's content.
const FRAME = 6
// The narrowest a column may be before the three stack: the longest line one
// holds ("Usage 100% · Time 100%") is 22 cells.
const MIN_COLUMN = 22
// Rows the card takes with a blank row between its sections.
const SPACIOUS_ROWS = 11

const paceColumn = (
  title: string,
  pace: PaceReading,
  width: number,
  palette: { bright: string; dim: string },
): Column => {
  const heading: Span[] = [{ text: title, bold: true }]

  if (pace.state !== 'live') {
    return {
      heading,
      bar: paceBar(width, 0, undefined, palette),
      stats: [{ text: 'Usage –' }],
      detail: [{ text: pace.state === 'reset' ? 'Window reset' : 'Waiting for a reading', dim: true }],
    }
  }

  return {
    heading,
    bar: paceBar(width, pace.usage, pace.elapsed, palette),
    stats: [
      { text: `Usage ${Math.round(pace.usage)}%` },
      ...(pace.elapsed === undefined ? [] : [{ text: ` · Time ${pace.elapsed}%`, dim: true }]),
    ],
    detail: pace.resetsIn === undefined ? [] : [{ text: `Resets in ${pace.resetsIn}`, dim: true }],
  }
}

const cacheColumn = (cache: CacheView, width: number): Column => {
  if (cache.state === 'unknown') {
    return {
      heading: [{ text: 'Cache', bold: true }],
      bar: cacheBar(width, 0),
      stats: [{ text: 'Warmth –' }],
      detail: [{ text: 'Waiting for a reply', dim: true }],
    }
  }

  const isWarm = cache.state === 'warm'

  return {
    heading: [
      { text: 'Cache · ', bold: true },
      { text: isWarm ? 'Warm' : 'Cold', bold: true, color: isWarm ? COLORS.warm : COLORS.cold },
    ],
    bar: cacheBar(width, cache.warmth),
    stats: [{ text: `Warmth ${cache.warmth}%` }, { text: ` · Hit ${cache.hitPercent}%`, dim: true }],
    detail: [{ text: isWarm ? `${cache.leftMinutes}m left of ${cache.ttlMinutes}m` : 'Expired', dim: true }],
  }
}

const noteOf = (cache: CacheView): Span[] => {
  if (cache.state === 'unknown') return []

  const isWarm = cache.state === 'warm'
  const size = tokens(cache.promptTokens)

  return [
    { text: '● ', color: isWarm ? COLORS.warm : COLORS.cold },
    {
      text: isWarm
        ? `Cache warm: next message reuses ${size} from cache.`
        : `Cache cold: next message re-caches ${size}.`,
      dim: true,
    },
  ]
}

// The card above the prompt: the context window by category, the 5-hour and
// weekly windows against the time elapsed, and the prompt cache.
export const card = ({ Box, Text }: Kit, props: CardProps) => {
  const { snapshot } = props
  const inner = Math.max(MIN_COLUMN, props.columns - FRAME)
  const isStacked = inner < 3 * MIN_COLUMN + 2 * COLUMN_GAP
  const columnWidth = isStacked ? inner : Math.floor((inner - 2 * COLUMN_GAP) / 3)
  const gap = props.rows >= SPACIOUS_ROWS ? 1 : 0

  const row = (spans: readonly Span[]) => (
    <Box>
      {spans.map(span => (
        <Text color={span.color} dimColor={span.dim} bold={span.bold}>
          {span.text}
        </Text>
      ))}
    </Box>
  )

  const percent = Math.round((snapshot.used / snapshot.window) * 100)
  const stat = `  ${tokens(snapshot.used)} / ${tokens(snapshot.window)} (${percent}%)  `
  const compact =
    snapshot.compactAt === undefined
      ? ''
      : `  Compact at ${Math.round((snapshot.compactAt / snapshot.window) * 100)}%`
  const leadWidth = 'Context'.length + stat.length
  const hasCompact = compact !== '' && inner - leadWidth - compact.length >= 16
  const barWidth = Math.max(8, inner - leadWidth - (hasCompact ? compact.length : 0))

  const cache = cacheViewOf(snapshot.cache, snapshot.now, props.ttlMs)
  const note = noteOf(cache)
  const columns: Column[] = [
    paceColumn('Current session', paceOf(snapshot.limits, WINDOWS.session, snapshot.now), columnWidth, PALETTES.session),
    paceColumn('Weekly limits', paceOf(snapshot.limits, WINDOWS.weekly, snapshot.now), columnWidth, PALETTES.weekly),
    cacheColumn(cache, columnWidth),
  ]

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="subtle" paddingX={2} width={props.columns}>
      {row([
        { text: 'Context', bold: true },
        { text: stat, dim: true },
        ...contextBar(barWidth, snapshot.window, snapshot.segments, snapshot.compactAt),
        ...(hasCompact ? [{ text: compact, dim: true }] : []),
      ])}
      <Box columnGap={2} flexWrap="wrap">
        {snapshot.segments.map(segment => (
          <Box>
            <Text color={COLORS[segment.kind]}>● </Text>
            <Text dimColor>{`${LABELS[segment.kind]} ${tokens(segment.tokens)}`}</Text>
          </Box>
        ))}
        <Text dimColor>{`Free ${tokens(Math.max(0, snapshot.window - snapshot.used))}`}</Text>
      </Box>
      <Box marginTop={gap} flexDirection={isStacked ? 'column' : 'row'} columnGap={COLUMN_GAP} rowGap={gap}>
        {columns.map(column => (
          <Box flexDirection="column" width={columnWidth}>
            {row(column.heading)}
            {row(column.bar)}
            {row(column.stats)}
            {row(column.detail)}
          </Box>
        ))}
      </Box>
      {note.length > 0 && <Box marginTop={gap}>{row(note)}</Box>}
    </Box>
  )
}
