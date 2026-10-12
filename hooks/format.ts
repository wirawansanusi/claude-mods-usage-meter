// Token counts as the card writes them: 63k, 301k, 1M, 1.5M.
export const tokens = (count: number): string => {
  if (count >= 999_500) return `${parseFloat((count / 1_000_000).toFixed(1))}M`
  if (count >= 1000) return `${Math.round(count / 1000)}k`

  return `${Math.round(count)}`
}

// Time left until `resetsAt` (ms), as the two largest units: 42m, 2h 18m, 3d 4h.
export const countdown = (resetsAt: number, now: number): string => {
  const minutes = Math.max(0, Math.ceil((resetsAt - now) / 60_000))
  const days = Math.floor(minutes / 1440)
  const hours = Math.floor((minutes % 1440) / 60)

  if (days > 0) return `${days}d ${hours}h`
  if (hours > 0) return `${hours}h ${minutes % 60}m`

  return `${minutes}m`
}

export const clamp = (value: number, low: number, high: number): number =>
  Math.min(high, Math.max(low, value))
