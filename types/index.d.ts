// One rate-limit window, as `$.session.usage()` reports it.
export type RateLimit = { kind: string; percentUsed: number; resetsAt?: string }

export type SegmentKind = 'system' | 'tools' | 'files' | 'messages' | 'other'

// One slice of the context window, in tokens.
export type Segment = { kind: SegmentKind; tokens: number }

// What the last response says about the prompt cache.
export type CacheReading = {
  // Share of that response's prompt the cache served, 0 to 100.
  hitPercent: number
  // That response's whole prompt: what the next message re-sends.
  promptTokens: number
  // The response's token counts joined, to tell a new response from the last one.
  signature: string
  // When this plugin first saw the response, in ms; absent when it predates the load.
  at?: number
}

// Everything the card draws, taken from `$.session.usage()` and kept as one value.
export type Snapshot = {
  // When it was last refreshed, in ms; the countdowns count from here.
  now: number
  // The window the context bar is scaled against, in tokens.
  window: number
  // Tokens in use.
  used: number
  segments: Segment[]
  // Where auto-compaction runs, in tokens; absent when it is off.
  compactAt?: number
  limits: RateLimit[]
  cache?: CacheReading
}

declare module 'claude-code' {
  interface PluginState {
    'usage-meter': { snapshot: Snapshot | null }
  }
}
