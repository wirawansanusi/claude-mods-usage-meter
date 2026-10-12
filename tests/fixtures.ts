import type { SessionUsage } from 'claude-code'

export const NOW = Date.parse('2026-10-12T10:00:00Z')
export const MINUTE = 60_000
export const HOUR = 60 * MINUTE
export const DAY = 24 * HOUR

export const at = (offsetMs: number): string => new Date(NOW + offsetMs).toISOString()

const category = (name: string, tokens: number, kind: 'used' | 'free' | 'buffer' = 'used') => ({
  name,
  tokens,
  color: 'inactive',
  isDeferred: false,
  kind,
})

export const API_USAGE = {
  input_tokens: 4_000,
  output_tokens: 900,
  cache_read_input_tokens: 478_000,
  cache_creation_input_tokens: 2_000,
}

// 484k of a 1M window: what the design shows.
export const usage = (
  over: { apiUsage?: typeof API_USAGE | null; isAutoCompactEnabled?: boolean; withLimits?: boolean } = {},
): SessionUsage =>
  ({
    startedAt: 0,
    context: {
      window: 1_000_000,
      tokens: 484_000,
      percent: 48,
      breakdown: {
        categories: [
          category('System prompt', 11_000),
          category('System tools', 40_000),
          category('MCP tools', 23_000),
          category('Memory files', 108_000),
          category('Messages', 301_000),
          category('Free space', 516_000, 'free'),
          category('Autocompact buffer', 30_000, 'buffer'),
        ],
        totalTokens: 484_000,
        rawMaxTokens: 1_000_000,
        isAutoCompactEnabled: over.isAutoCompactEnabled ?? true,
        autoCompactThreshold: 970_000,
        apiUsage: over.apiUsage === undefined ? API_USAGE : over.apiUsage,
      },
    },
    rateLimits:
      over.withLimits === false
        ? []
        : [
            { kind: 'five_hour', percentUsed: 34, resetsAt: at(2 * HOUR + 18 * MINUTE) },
            { kind: 'seven_day', percentUsed: 23, resetsAt: at(5 * DAY + 4 * HOUR + 18 * MINUTE) },
          ],
  }) as unknown as SessionUsage
