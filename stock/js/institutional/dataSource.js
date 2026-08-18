// institutional.html / institutional-result.html are plain static pages
// served outside the Vite build (no import.meta.env.PROD to key off, unlike
// src/api/dataSource.ts), so backend availability has to be detected purely
// at runtime:
//   1. Same origin `/api/health` — works whenever this page is served BY the
//      backend itself (self-hosted `node server/index.mjs`) or via Vite's
//      dev proxy (`npm run dev`), since both put this page and /api on the
//      same origin already. This is the common case and needs no tunnel.
//   2. cloudflared quick-tunnel registry (same retry-once-then-hysteresis
//      logic as dataSource.ts) — covers viewing a deployed copy (e.g. GitHub
//      Pages) while the dev machine happens to have `npm run dev` + the
//      tunnel running.
//   3. Neither reachable -> 'static': caller must fall back to the prebaked
//      institutional-history.json / quotes.json snapshots.
const REGISTRY_URL = './data/tunnel-registry.json'
const HEALTH_PATH = '/api/health'
const HEALTH_TIMEOUT_MS = 3000
const RECHECK_INTERVAL_MS = 30000

let mode = 'static' // 'live' (same origin) | 'live-tunnel' | 'static'
let liveBase = null // '' for same-origin, or the tunnel's absolute origin, or null
let consecutiveFailures = 0
let started = false
let firstResolve = null

async function pingOnce(base) {
  try {
    const res = await fetch(base + HEALTH_PATH, { signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS) })
    return res.ok
  } catch {
    return false
  }
}

async function findTunnelUrl() {
  let reg
  try {
    reg = await fetch(`${REGISTRY_URL}?_=${Date.now()}`).then((r) => r.json())
  } catch {
    return null
  }
  if (!reg?.url) return null
  if (await pingOnce(reg.url)) return reg.url
  await new Promise((r) => setTimeout(r, 800))
  if (await pingOnce(reg.url)) return reg.url
  return null
}

async function resolveOnce() {
  if (await pingOnce('')) {
    mode = 'live'
    liveBase = ''
    consecutiveFailures = 0
    return
  }
  const tunnelUrl = await findTunnelUrl()
  if (tunnelUrl) {
    mode = 'live-tunnel'
    liveBase = tunnelUrl
    consecutiveFailures = 0
    return
  }
  consecutiveFailures++
  // One bad cycle doesn't drop an already-live connection — matches
  // dataSource.ts's hysteresis so a single flaky health check doesn't flip
  // an open tab to static mode mid-session.
  if (mode !== 'static' && consecutiveFailures < 2) return
  mode = 'static'
  liveBase = null
}

export function ensureResolved() {
  if (!started) {
    started = true
    firstResolve = resolveOnce().then(() => {
      setInterval(resolveOnce, RECHECK_INTERVAL_MS)
    })
  }
  return firstResolve
}

export function getMode() {
  return mode
}

// Resolves the URL to fetch a backend API path from, or null if no live
// backend is currently reachable (callers must use a static JSON fallback).
export async function apiUrl(path) {
  await ensureResolved()
  if (liveBase === null) return null
  return `${liveBase}${path}`
}
