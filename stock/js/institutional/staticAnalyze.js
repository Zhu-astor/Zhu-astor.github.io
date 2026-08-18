// Client-side reimplementation of institutional.mjs's analyze() /
// getSourcesStatus(), used only when dataSource.js falls back to 'static'
// mode (no reachable backend — e.g. institutional.html viewed on GitHub
// Pages with no dev machine tunnel up). Reads the same
// institutional-history.json snapshot ForeignFlowChart.tsx already uses in
// that mode, and reproduces the exact condition rules from institutional.mjs
// so the card grid shows real results instead of a permanent 404.
//
// Kept in manual lockstep with server/institutional.mjs's analyze() — any
// change to the condition rules there (streak lengths, percentile cutoffs,
// etc.) must be mirrored here too, same as fetch-institutional.mjs already
// does for the fetch/parse side.
const FOREIGN_INVEST_STREAK_DAYS = 5
const SELL_STREAK_DAYS = 3
const REVERSAL_LOOKBACK_DAYS = 3

let historyCache = null
function loadHistory() {
  if (!historyCache) {
    historyCache = fetch(`./data/institutional-history.json?_=${Date.now()}`)
      .then((r) => (r.ok ? r.json() : {}))
      .catch(() => ({}))
  }
  return historyCache
}

function getAvailableDates(history) {
  return Object.keys(history).sort()
}

export async function loadStaticStatus() {
  const history = await loadHistory()
  const out = {}
  for (const d of getAvailableDates(history)) out[d] = history[d].sources || null
  return { sources: out }
}

export async function loadStaticAnalysis(topPercent) {
  const history = await loadHistory()
  const allDates = getAvailableDates(history)
  const latest = allDates[allDates.length - 1]
  if (!latest) return { stocks: [], dates: [], latest: null, sources: null }

  // topPercent=10 means "top 10% of that day's positive net-buyers" ->
  // 0.9 percentile cutoff, same conversion as server/index.mjs's route.
  const bigBuyPercentile =
    Number.isFinite(topPercent) && topPercent > 0 && topPercent < 100 ? 1 - topPercent / 100 : 0.9
  const dates = allDates.slice(-20) // bound history scan to last 20 stored days, same as analyze()

  const dateMaps = dates.map((d) => {
    const map = new Map()
    for (const s of history[d]?.stocks || []) map.set(s.symbol, s)
    return map
  })

  // Symbol universe = every symbol appearing anywhere in the retained
  // window. institutional.mjs derives its universe from tw_stocks.json
  // instead, but analyze() there skips any symbol with zero stored entries
  // regardless (`seq.length < 1 -> continue`), so the effective result set
  // is identical without needing a separate master-list fetch here.
  const symbols = new Set()
  for (const map of dateMaps) for (const sym of map.keys()) symbols.add(sym)

  const cutoffByDate = new Map()
  function cutoffsFor(date) {
    if (cutoffByDate.has(date)) return cutoffByDate.get(date)
    const totals = (history[date]?.stocks || [])
      .map((s) => s.total)
      .filter((t) => t > 0)
      .sort((a, b) => a - b)
    const at = (p) => (totals.length > 0 ? totals[Math.min(Math.floor(totals.length * p), totals.length - 1)] : Infinity)
    const result = { big: at(bigBuyPercentile), small: at(0.5) }
    cutoffByDate.set(date, result)
    return result
  }

  function isConsecutive(window) {
    for (let i = 1; i < window.length; i++) {
      if (dates.indexOf(window[i].date) - dates.indexOf(window[i - 1].date) !== 1) return false
    }
    return true
  }

  const results = []
  for (const sym of symbols) {
    const seq = []
    for (let i = 0; i < dates.length; i++) {
      const stock = dateMaps[i].get(sym)
      if (stock) seq.push({ date: dates[i], ...stock })
    }
    if (seq.length < 1) continue

    const last = seq[seq.length - 1]
    const entry = { symbol: sym, name: last.name, market: last.market, conditions: [] }

    if (last.total > 0) entry.conditions.push('三大法人合計買超')
    if (last.foreignNet > 0) entry.conditions.push('外資買超')
    if (last.investNet > 0) entry.conditions.push('投信買超')
    const cutoffs = cutoffsFor(last.date)
    if (last.total > cutoffs.big) entry.conditions.push('近一日籌碼大買')
    else if (last.total > 0 && last.total <= cutoffs.small) entry.conditions.push('近一日籌碼小買')

    if (seq.length >= FOREIGN_INVEST_STREAK_DAYS) {
      const w5 = seq.slice(-FOREIGN_INVEST_STREAK_DAYS)
      if (isConsecutive(w5)) {
        if (w5.every((s) => s.foreignNet > 0)) entry.conditions.push('外資連買5天')
        if (w5.every((s) => s.investNet > 0)) entry.conditions.push('投信連買5天')
      }
    }
    if (seq.length >= SELL_STREAK_DAYS) {
      const w3 = seq.slice(-SELL_STREAK_DAYS)
      if (isConsecutive(w3)) {
        if (w3.every((s) => s.foreignNet < 0)) entry.conditions.push('外資連3賣')
        if (w3.every((s) => s.investNet < 0)) entry.conditions.push('投信連3賣')
        const sum3 = w3.reduce((a, s) => a + s.foreignNet, 0)
        if (sum3 > 0) entry.conditions.push('外資近3日買超(流量近似)')
      }
    }
    if (seq.length >= REVERSAL_LOOKBACK_DAYS + 1) {
      const w4 = seq.slice(-(REVERSAL_LOOKBACK_DAYS + 1))
      const prevDays = w4.slice(0, -1)
      if (isConsecutive(w4) && prevDays.every((s) => s.foreignNet < 0) && last.foreignNet > 0) {
        entry.conditions.push('外資連3賣轉買')
      }
    }

    const ratioSeq = seq.filter((s) => typeof s.foreignHoldRatio === 'number').slice(-3)
    if (
      ratioSeq.length === 3 &&
      isConsecutive(ratioSeq) &&
      ratioSeq[0].foreignHoldRatio < ratioSeq[1].foreignHoldRatio &&
      ratioSeq[1].foreignHoldRatio < ratioSeq[2].foreignHoldRatio
    ) {
      entry.conditions.push('外資持股比率連3日增加')
    }

    entry.date = last.date // which day foreignNet etc. below actually belong to
    entry.foreignNet = last.foreignNet
    entry.investNet = last.investNet
    entry.dealerNet = last.dealerNet
    entry.total = last.total
    entry.foreignHoldRatio = last.foreignHoldRatio ?? null

    const prevDay = seq.length >= 2 ? seq[seq.length - 2] : null
    const prevIsConsecutive = prevDay && isConsecutive([prevDay, last])
    entry.datePrev = prevIsConsecutive ? prevDay.date : null
    entry.foreignNetPrev = prevIsConsecutive ? prevDay.foreignNet : null

    results.push(entry)
  }

  return { stocks: results, dates: allDates, latest, sources: history[latest]?.sources || null }
}
