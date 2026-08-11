// Runs in GitHub Actions every 5 minutes (see ../../.github/workflows/update-stock-quotes.yml).
// Pulls the same Fugle v1.0 snapshot endpoint the local dev server uses, and
// emits the SAME per-stock shape /api/quotes returns (not a simplified
// subset) so the deployed React app's static-mode branch (src/api/stockAPI.ts)
// can render it with the exact same StockTable/StatsCards components the
// live dashboard uses — no separate static-only UI to keep in sync.
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const OUT_PATH = path.join(__dirname, '..', 'data', 'quotes.json')

// Same public snapshot API key already embedded client-side in the Work7_stock
// dashboard's own source (server/index.mjs) — not a secret, so no extra
// GitHub Actions secret needed.
const MKT_API_KEY = '50226AAC80634EE7'

// Fugle tradeVolume is already denominated in 張 (1張=1000股) — do not divide
// by 1000 again (see Work7_stock/Real_time/server/index.mjs for how this was
// verified against tradeValue/(tradeVolume*1000) ≈ price).
async function fetchSnapshot(market) {
  const r = await fetch(`https://api.fugle.tw/marketdata/v1.0/snapshot/quotes/${market}?apiKey=${MKT_API_KEY}`)
  if (!r.ok) throw new Error(`Fugle ${market} snapshot failed: ${r.status}`)
  const json = await r.json()
  return (json.data || []).filter((s) => s.type === 'EQUITY')
}

// Taiwan market trading hours: 09:00–13:30 Asia/Taipei, Mon–Fri. Same
// reasoning as server/index.mjs's isMarketOpen() — fixed UTC+8 offset so
// this is correct regardless of the GitHub Actions runner's own timezone.
function isMarketOpen() {
  const t = new Date(Date.now() + 8 * 3600 * 1000)
  const day = t.getUTCDay()
  if (day === 0 || day === 6) return false
  const mins = t.getUTCHours() * 60 + t.getUTCMinutes()
  return mins >= 9 * 60 && mins <= 13 * 60 + 30
}

const [tse, otc] = await Promise.all([fetchSnapshot('TSE'), fetchSnapshot('OTC')])

const now = new Date().toISOString()
let latestMarketTick = null

const stocks = [...tse, ...otc]
  .filter((s) => (s.lastPrice || s.closePrice) > 0)
  .map((s) => {
    const price = s.lastPrice || s.closePrice
    const open = s.openPrice || price
    const prevClose = typeof s.changePercent === 'number' && s.changePercent > -100
      ? price / (1 + s.changePercent / 100)
      : open
    const volume = Math.round(s.tradeVolume || 0)
    const changeToday = open > 0 ? ((price - open) / open) * 100 : 0
    const changeFromYesterday = typeof s.changePercent === 'number'
      ? s.changePercent
      : (prevClose > 0 ? ((price - prevClose) / prevClose) * 100 : 0)
    const tickMs = s.lastUpdated ? Math.round(s.lastUpdated / 1000) : Date.now()
    if (latestMarketTick === null || tickMs > latestMarketTick) latestMarketTick = tickMs
    return {
      symbol: s.symbol,
      price: Math.round(price * 100) / 100,
      openPrice: Math.round(open * 100) / 100,
      yesterdayClose: Math.round(prevClose * 100) / 100,
      todayClose: Math.round(price * 100) / 100,
      // A 5-min-stale snapshot has no meaningful "in the last minute" delta
      // to report — reported honestly as 0 rather than fabricated, same
      // convention server/index.mjs already uses once the market is closed.
      change1m: 0,
      changeToday: Math.round(changeToday * 100) / 100,
      changeFromYesterday: Math.round(changeFromYesterday * 100) / 100,
      volume,
      score: 0, // filled in below once maxVol across all stocks is known
      marketTime: new Date(tickMs).toISOString(),
    }
  })

const maxVol = Math.max(...stocks.map((d) => d.volume), 1)
for (const d of stocks) {
  d.score = Math.round((d.change1m * 0.5 + d.changeToday * 0.2 + (d.volume / maxVol) * 30) * 100) / 100
}

const dataTime = latestMarketTick ? new Date(latestMarketTick).toISOString() : now

fs.writeFileSync(OUT_PATH, JSON.stringify({
  stocks,
  updatedAt: now,
  total: stocks.length,
  dataTime,
  marketOpen: isMarketOpen(),
}))
console.log(`Wrote ${stocks.length} stocks to ${OUT_PATH}`)
