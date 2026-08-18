// Fetch wrappers around the /api/institutional/* routes in server/index.mjs.
// Routed through dataSource.js so this page also works when served from an
// origin with no backend (e.g. GitHub Pages) — read paths (loadAnalysis,
// loadStatus) fall back to the static institutional-history.json snapshot;
// write/trigger paths (fetchToday, backfill) have no static equivalent since
// they ask a live server to go hit TWSE/TPEx, so they surface a clear
// Chinese error instead of a raw fetch to a nonexistent origin.
import { apiUrl, getMode } from './dataSource.js'
import { loadStaticAnalysis, loadStaticStatus } from './staticAnalyze.js'

const NO_BACKEND_MSG = '目前為靜態頁面（偵測不到本機看盤伺服器），此操作需要連線後端，請在本機執行 npm run dev 後再試'

export async function loadAnalysis(topPercent) {
  const qs = topPercent ? `?topPercent=${topPercent}` : ''
  const url = await apiUrl(`/api/institutional/analyze${qs}`)
  if (url === null) return loadStaticAnalysis(topPercent)
  const res = await fetch(url)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

export async function loadStatus() {
  const url = await apiUrl('/api/institutional/status')
  if (url === null) return loadStaticStatus()
  const res = await fetch(url)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

export async function fetchToday() {
  const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '')
  const url = await apiUrl(`/api/institutional/fetch/${dateStr}`)
  if (url === null) throw new Error(NO_BACKEND_MSG)
  const res = await fetch(url)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

// Backfills historical days (each date issues up to 4 upstream requests,
// run sequentially server-side with a delay) — can take a while for a large
// `days`, so callers should show a "this may take a while" state.
export async function backfill(days) {
  const url = await apiUrl(`/api/institutional/backfill/${days}`)
  if (url === null) throw new Error(NO_BACKEND_MSG)
  const res = await fetch(url)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

export { getMode }
