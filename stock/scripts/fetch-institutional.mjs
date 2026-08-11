// Runs in GitHub Actions every 5 minutes (same workflow as fetch-quotes.mjs)
// but only actually hits the upstream government endpoints after 16:00
// Taipei and only until today's data is complete — otherwise it's a cheap
// no-op. Parsing logic ported directly from
// Work7_stock/Real_time/server/institutional.mjs (verified there against
// live TWSE/TPEx responses in 2026-07); kept in sync manually since this
// runs on GitHub's infrastructure, not the dev machine, and its access to
// these government endpoints from a cloud-datacenter IP hasn't been
// verified the way the dev-machine version has — if this starts failing
// with HTTP errors (as opposed to "尚無資料" meaning "not published yet"),
// that's the first thing to check.
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const OUT_PATH = path.join(__dirname, '..', 'data', 'institutional-history.json')
// Bounds file size / fetch cost — 40 calendar days comfortably covers the
// 30 trading days ForeignFlowChart requests even across weekends/holidays.
const RETAIN_CALENDAR_DAYS = 40

function nowTaipei() {
  return new Date(Date.now() + 8 * 3600 * 1000)
}
function todayStr() {
  return nowTaipei().toISOString().slice(0, 10).replace(/-/g, '')
}
function adToRoc(dateStr) {
  const y = parseInt(dateStr.slice(0, 4), 10) - 1911
  return `${y}/${dateStr.slice(4, 6)}/${dateStr.slice(6, 8)}`
}

/* ─── TWSE listed (上市): 三大法人買賣超 — T86 ─── */
function parseT86CSV(csvText) {
  const lines = csvText.split('\n')
  const stocks = []
  for (const line of lines) {
    const cols = line.split('","').map((c) => c.replace(/^="?"?|^"+|"+$/g, '').trim())
    if (cols.length < 19) continue
    const code = cols[0]
    if (!code || !/^\d{4}$/.test(code)) continue
    const num = (s) => parseInt(String(s).replace(/,/g, '')) || 0
    const foreignNet = num(cols[4]) + num(cols[7])
    const investNet = num(cols[10])
    const dealerNet = num(cols[11])
    stocks.push({
      symbol: code, name: cols[1], market: 'listed',
      foreignBuy: num(cols[2]) + num(cols[5]), foreignSell: num(cols[3]) + num(cols[6]), foreignNet,
      dealerBuy: num(cols[12]) + num(cols[15]), dealerSell: num(cols[13]) + num(cols[16]), dealerNet,
      investBuy: num(cols[8]), investSell: num(cols[9]), investNet,
      total: num(cols[18]),
    })
  }
  return stocks
}
async function fetchTwseT86(dateStr) {
  const url = `https://www.twse.com.tw/fund/T86?response=csv&date=${dateStr}&selectType=ALLBUT0999`
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } })
  if (!res.ok) throw new Error(`TWSE T86 HTTP ${res.status}`)
  const buffer = await res.arrayBuffer()
  const csvText = new TextDecoder('big5').decode(buffer)
  const stocks = parseT86CSV(csvText)
  if (stocks.length === 0) throw new Error('TWSE T86: 尚無資料 (通常表示今日盤後資料還沒公布)')
  return stocks
}

/* ─── TPEx OTC (上櫃): 三大法人買賣超 ─── */
function parseTpex3instiJSON(json) {
  const table = json?.tables?.[0]
  if (!table || !Array.isArray(table.data)) return []
  const num = (s) => parseInt(String(s).replace(/,/g, '')) || 0
  const stocks = []
  for (const row of table.data) {
    const code = row[0]
    if (!code || !/^\d{4}$/.test(code)) continue
    stocks.push({
      symbol: code, name: row[1], market: 'otc',
      foreignBuy: num(row[8]), foreignSell: num(row[9]), foreignNet: num(row[10]),
      investBuy: num(row[11]), investSell: num(row[12]), investNet: num(row[13]),
      dealerBuy: num(row[20]), dealerSell: num(row[21]), dealerNet: num(row[22]),
      total: num(row[23]),
    })
  }
  return stocks
}
async function fetchTpex3insti(dateStr) {
  const url = `https://www.tpex.org.tw/web/stock/3insti/daily_trade/3itrade_hedge_result.php?l=zh-tw&se=EW&t=D&d=${adToRoc(dateStr)}&s=0,asc`
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } })
  if (!res.ok) throw new Error(`TPEx 3insti HTTP ${res.status}`)
  const json = await res.json()
  const stocks = parseTpex3instiJSON(json)
  if (stocks.length === 0) throw new Error('TPEx 3insti: 尚無資料 (通常表示今日盤後資料還沒公布)')
  return stocks
}

/* ─── TWSE listed (上市): 外資及陸資持股比率 — MI_QFIIS ─── */
async function fetchTwseHoldRatio(dateStr) {
  const url = `https://www.twse.com.tw/rwd/zh/fund/MI_QFIIS?response=json&date=${dateStr}&selectType=ALLBUT0999`
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } })
  if (!res.ok) throw new Error(`TWSE MI_QFIIS HTTP ${res.status}`)
  const json = await res.json()
  if (json.stat !== 'OK' || !Array.isArray(json.data)) throw new Error('TWSE MI_QFIIS: 尚無資料')
  const ratios = new Map()
  for (const row of json.data) {
    const code = row[0]
    if (!code || !/^\d{4}$/.test(code)) continue
    const ratio = parseFloat(row[7])
    if (!Number.isNaN(ratio)) ratios.set(code, ratio)
  }
  return ratios
}

/* ─── TPEx OTC (上櫃): 僑外資及陸資持股比率 ─── */
async function fetchTpexHoldRatio(dateStr) {
  const url = `https://www.tpex.org.tw/web/stock/3insti/qfii/qfii_result.php?l=zh-tw&o=data&d=${adToRoc(dateStr)}`
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } })
  if (!res.ok) throw new Error(`TPEx qfii HTTP ${res.status}`)
  const csvText = await res.text()
  const lines = csvText.split('\n').slice(1)
  const ratios = new Map()
  for (const line of lines) {
    const cols = line.split('","').map((c) => c.replace(/^"+|"+$/g, '').trim())
    if (cols.length < 9) continue
    const code = cols[2]
    if (!code || !/^\d{4}$/.test(code)) continue
    const ratio = parseFloat(cols[8].replace('%', ''))
    if (!Number.isNaN(ratio)) ratios.set(code, ratio)
  }
  if (ratios.size === 0) throw new Error('TPEx qfii: 尚無資料 (通常表示今日盤後資料還沒公布)')
  return ratios
}

async function fetchDailyData(dateStr) {
  const [t86, tpex3insti, twseRatio, tpexRatio] = await Promise.allSettled([
    fetchTwseT86(dateStr), fetchTpex3insti(dateStr), fetchTwseHoldRatio(dateStr), fetchTpexHoldRatio(dateStr),
  ])
  const stocks = []
  if (t86.status === 'fulfilled') stocks.push(...t86.value)
  if (tpex3insti.status === 'fulfilled') stocks.push(...tpex3insti.value)
  const ratioMap = new Map()
  if (twseRatio.status === 'fulfilled') for (const [k, v] of twseRatio.value) ratioMap.set(k, v)
  if (tpexRatio.status === 'fulfilled') for (const [k, v] of tpexRatio.value) ratioMap.set(k, v)
  for (const s of stocks) if (ratioMap.has(s.symbol)) s.foreignHoldRatio = ratioMap.get(s.symbol)
  const sources = {
    twseT86: t86.status === 'fulfilled',
    tpex3insti: tpex3insti.status === 'fulfilled',
    twseRatio: twseRatio.status === 'fulfilled',
    tpexRatio: tpexRatio.status === 'fulfilled',
  }
  if (stocks.length === 0) {
    const errors = [t86, tpex3insti, twseRatio, tpexRatio].filter((r) => r.status === 'rejected').map((r) => r.reason?.message || String(r.reason))
    throw new Error(`所有來源皆尚無資料: ${errors.join('; ')}`)
  }
  return { stocks, sources }
}

/* ─── Storage: same shape as server/data/institutional.json ─── */
let history = {}
try { history = JSON.parse(fs.readFileSync(OUT_PATH, 'utf-8')) } catch {}

function isDateComplete(dateStr) {
  const s = history[dateStr]?.sources
  return !!(s && s.twseT86 && s.tpex3insti && s.twseRatio && s.tpexRatio)
}

function pruneOldDates() {
  const cutoff = new Date(nowTaipei())
  cutoff.setUTCDate(cutoff.getUTCDate() - RETAIN_CALENDAR_DAYS)
  const cutoffStr = cutoff.toISOString().slice(0, 10).replace(/-/g, '')
  for (const d of Object.keys(history)) {
    if (d < cutoffStr) delete history[d]
  }
}

const dateStr = todayStr()
const taipeiHour = nowTaipei().getUTCHours()

if (isDateComplete(dateStr)) {
  console.log(`${dateStr} already complete, nothing to do.`)
} else if (taipeiHour < 16) {
  console.log(`Taipei hour ${taipeiHour} < 16 — today's 三大法人 data isn't published yet, skipping.`)
} else {
  try {
    const result = await fetchDailyData(dateStr)
    const existing = history[dateStr]
    const map = new Map((existing?.stocks || []).map((s) => [s.symbol, s]))
    for (const s of result.stocks) {
      const prev = map.get(s.symbol)
      map.set(s.symbol, prev ? { ...prev, ...s } : s)
    }
    history[dateStr] = {
      date: dateStr,
      stocks: Array.from(map.values()),
      sources: { ...(existing?.sources || {}), ...result.sources },
      updatedAt: new Date().toISOString(),
    }
    pruneOldDates()
    fs.writeFileSync(OUT_PATH, JSON.stringify(history))
    console.log(`${dateStr}: sources ok = ${JSON.stringify(result.sources)}, ${result.stocks.length} rows`)
  } catch (err) {
    console.log(`Fetch failed (expected until officials publish, or if TWSE/TPEx block this runner's IP): ${err.message}`)
  }
}
