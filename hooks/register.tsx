import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, Timer } from 'claude-code'

import { card } from './card'
import { buildSnapshot } from './model'

const snapshot = atom({ plugin: 'usage-meter', key: 'snapshot' } as const, null)

// The countdowns only need to move once a minute.
const TICK_MS = 60_000
const TTL_MS = { '5m': 5 * 60_000, '1h': 60 * 60_000 } as const

// Takes the figures again. `isStart` is the session starting, not a response arriving.
async function refresh($: EngineInterface, isStart: boolean) {
  const usage = await $.session.usage({ breakdown: 'summary' })
  const now = await $.clock.now()

  await update($, snapshot, previous => buildSnapshot(usage, now, previous, isStart))
}

// Moves the clock the countdowns count from.
async function tick($: EngineInterface) {
  const now = await $.clock.now()

  await update($, snapshot, current => (current ? { ...current, now } : current))
}

export const register: Register = (on, options) => {
  const ttlMs = options.cacheTtl === '5m' ? TTL_MS['5m'] : TTL_MS['1h']
  let ticker: Timer | undefined

  on('session.start', async ($, e, next) => {
    await refresh($, true)

    ticker?.cancel()
    ticker = $.clock.every(TICK_MS, () => void tick($))

    return next(e)
  })

  // Pushed after each turn and whenever a rate-limit window moves a whole point.
  on('session.measure', async ($, e, next) => {
    await refresh($, false)

    return next(e)
  })

  on('session.compact', async ($, e, next) => {
    const result = await next(e)

    // The card is only a view: a failed refresh must not hold a compaction up.
    if (e.trigger !== 'precompute') {
      await refresh($, false).catch(error =>
        $.ui.log(`usage-meter: refresh after compaction failed: ${String(error)}`, { to: 'debug' }),
      )
    }

    return result
  })

  on('session.end', async ($, e, next) => {
    if (e.reason === 'clear') {
      // The old conversation's figures are gone, and no session.start follows a
      // /clear, so the timer keeps running.
      await update($, snapshot, () => null)
    } else {
      ticker?.cancel()
      ticker = undefined
    }

    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const current = await read($, snapshot)

    if (e.props.hasSurvey || current === null) return next(e)

    return card($.ui.resolve(e), {
      snapshot: current,
      ttlMs,
      columns: e.props.bodyColumns,
      rows: e.props.maxRows,
    })
  })
}
