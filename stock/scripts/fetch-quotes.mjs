// Runs in GitHub Actions every 5 minutes (see ../../.github/workflows/update-stock-quotes.yml).
// Pulls the same Fugle v1.0 snapshot endpoint the local dev server uses, so the
// static fallback page's numbers are directly comparable to the live dashboard —
// not a different data source that could quietly disagree.
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

const [tse, otc] = await Promise.all([fetchSnapshot('TSE'), fetchSnapshot('OTC')])

const stocks = [...tse, ...otc]
  .map((s) => ({
    symbol: s.symbol,
    name: s.name,
    price: s.lastPrice || s.closePrice || 0,
    changePercent: typeof s.changePercent === 'number' ? Math.round(s.changePercent * 100) / 100 : 0,
    volume: Math.round(s.tradeVolume || 0),
  }))
  .filter((s) => s.price > 0)
  .sort((a, b) => b.volume - a.volume)
  .slice(0, 100) // top 100 by volume keeps the static page light; this is a fallback view, not the full dashboard

fs.writeFileSync(OUT_PATH, JSON.stringify({ updatedAt: new Date().toISOString(), stocks }, null, 0))
console.log(`Wrote ${stocks.length} stocks to ${OUT_PATH}`)
