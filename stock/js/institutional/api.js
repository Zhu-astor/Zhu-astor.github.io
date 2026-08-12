// Thin fetch wrappers around the /api/institutional/* routes in server/index.mjs.
export async function loadAnalysis(topPercent) {
  const qs = topPercent ? `?topPercent=${topPercent}` : ''
  const res = await fetch(`/api/institutional/analyze${qs}`)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

export async function loadStatus() {
  const res = await fetch('/api/institutional/status')
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

export async function fetchToday() {
  const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '')
  const res = await fetch(`/api/institutional/fetch/${dateStr}`)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

// Backfills historical days (each date issues up to 4 upstream requests,
// run sequentially server-side with a delay) — can take a while for a large
// `days`, so callers should show a "this may take a while" state.
export async function backfill(days) {
  const res = await fetch(`/api/institutional/backfill/${days}`)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}
