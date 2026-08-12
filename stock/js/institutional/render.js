import { CONDITIONS } from './conditions.js'

export function fmt(n) {
  if (n === undefined || n === null) return '--'
  if (Math.abs(n) >= 1000000) return (n / 1000000).toFixed(1) + 'M'
  if (Math.abs(n) >= 1000) return (n / 1000).toFixed(0) + 'K'
  return n.toLocaleString()
}

export function fmtPct(n) {
  return typeof n === 'number' ? n.toFixed(2) + '%' : '--'
}

export function marketLabel(m) {
  return m === 'listed' ? '上市' : m === 'otc' ? '上櫃' : '--'
}

function filterByMarket(list, market) {
  if (market === 'all') return list
  return list.filter((d) => d.market === market)
}

export function renderBanner(el, { sources, latest, total }) {
  if (!latest) {
    el.innerHTML = `<div class="banner warn">尚無任何一天的籌碼資料，請按下方「立即抓取」或等待每日 16:00 後自動抓取。</div>`
    return
  }
  const s = sources || {}
  const parts = [
    ['TWSE 上市買賣超', s.twseT86],
    ['TPEx 上櫃買賣超', s.tpex3insti],
    ['TWSE 外資持股比率', s.twseRatio],
    ['TPEx 外資持股比率', s.tpexRatio],
  ]
  const missing = parts.filter(([, ok]) => !ok).map(([label]) => label)
  const statusLine = missing.length
    ? `<span class="warn">⚠ ${latest} 尚未齊全，缺少：${missing.join('、')}（連續天數類條件會在資料補齊前持續更新）</span>`
    : `<span class="ok">✓ ${latest} 四項來源皆已齊全</span>`
  el.innerHTML = `<div class="banner">資料最新日期 ${latest}（共 ${total} 檔） ${statusLine}</div>`
}

// Part-to-whole (2 categories): a single stacked bar with direct labels —
// per dataviz form guidance a 2-slice pie is a meter/split-bar, not a pie.
export function renderMarketSplit(el, { allData }) {
  const listed = allData.filter((d) => d.market === 'listed').length
  const otc = allData.filter((d) => d.market === 'otc').length
  const total = listed + otc || 1
  const listedPct = (listed / total) * 100
  el.innerHTML = `
    <div class="split-label"><span>上市 ${listed}</span><span>上櫃 ${otc}</span></div>
    <div class="split-track">
      <div class="split-seg listed" style="width:${listedPct}%"></div>
      <div class="split-seg otc" style="width:${100 - listedPct}%"></div>
    </div>`
}

// Big-card grid, one card per condition. Cards are multi-select toggles
// (checkmark = selected); clicking a card never navigates by itself — the
// floating bar (renderFloatingBar) is what surfaces "查看詳細" once >=1 card
// is selected, and THAT is what opens the full-screen result view.
export function renderCards(el, { allData, selectedIds, market, datesCount }) {
  const scoped = filterByMarket(allData, market)
  el.innerHTML = CONDITIONS.map((c) => {
    const active = selectedIds.has(c.id)
    const insufficient = datesCount < c.minDays
    const cnt = scoped.filter((d) => d.conditions?.includes(c.label)).length
    const countHtml = insufficient
      ? `<div class="count insufficient" title="需要連續 ${c.minDays} 天資料，目前累積 ${datesCount} 天">資料不足 (${datesCount}/${c.minDays}天)</div>`
      : `<div class="count ${c.sentiment}">${cnt.toLocaleString()}</div>`
    return `<div class="cond-card ${active ? 'active' : ''} ${insufficient ? 'disabled' : ''}" data-cond-id="${c.id}">
      <div class="check">✓</div>
      <div class="tag">${c.label}</div>
      <div class="desc">${c.desc}</div>
      ${countHtml}
    </div>`
  }).join('')
}

// Floating confirm bar — appears once >=1 condition card is selected. This is
// the only thing that navigates anywhere: clicking "查看詳細" opens a real
// new browser tab (institutional-result.html) with large, clear typography,
// per the requested flow: select cards -> a box appears asking to view
// details -> that's what jumps to "another screen".
export function renderFloatingBar(el, { selectedCount }) {
  if (selectedCount === 0) {
    el.classList.remove('show')
    return
  }
  el.classList.add('show')
  el.innerHTML = `<span>已選 ${selectedCount} 個條件（需全部符合）</span><button class="btn accent" id="view-detail-btn">查看詳細 →</button>`
}

// 外資買賣超/前一天外資買賣超 labels get their actual date spliced in at
// render time (renderStockTable's `latestDate`/`prevDate` args) — never
// just labeled "今日", since the latest STORED day is often not literally
// today (T86/3insti publish after market close, with a lag).
const SORT_COLUMNS = [
  { key: 'symbol', label: '代號' },
  { key: 'name', label: '名稱' },
  { key: 'market', label: '市場' },
  { key: 'price', label: '現價' },
  { key: 'changeToday', label: '漲幅%(開盤→現在)' },
  { key: 'foreignNet', label: '外資買賣超' },
  { key: 'foreignNetPrev', label: '前一天外資買賣超' },
  { key: 'investNet', label: '投信買賣超' },
  { key: 'dealerNet', label: '自營買賣超' },
  { key: 'total', label: '三大法人合計' },
  { key: 'foreignHoldRatio', label: '外資持股比率' },
]

function fmtDate(d) {
  return d ? `${d.slice(4, 6)}/${d.slice(6, 8)}` : null
}
// institutional.mjs stores T86/3insti buy-sell in 股 (raw shares) — the
// per-symbol drawer view (ForeignFlowChart.tsx / /api/institutional/symbol)
// already converts to 張 at its own API boundary; this table reads straight
// from /api/institutional/analyze, which still returns raw shares, so the
// conversion happens here instead, only for the two 外資買賣超 columns.
function fmtLots(v) {
  if (v === null || v === undefined) return '--'
  const lots = Math.round(v / 1000)
  return `${lots >= 0 ? '+' : ''}${lots.toLocaleString()}張`
}

export function sortStocks(stocks, key, dir) {
  const sign = dir === 'asc' ? 1 : -1
  return [...stocks].sort((a, b) => {
    const av = a[key], bv = b[key]
    if (av == null && bv == null) return 0
    if (av == null) return 1
    if (bv == null) return -1
    if (typeof av === 'string') return sign * av.localeCompare(bv)
    return sign * (av - bv)
  })
}

// Most-common non-null value — used to pick one representative date to show
// in a column header even though a handful of symbols might have a gap on
// that exact date (per-row cells still use each row's own `d.date`/`d.datePrev`
// via the title attribute, so a gappy symbol is never mislabeled).
function mostCommon(values) {
  const counts = new Map()
  for (const v of values) {
    if (v == null) continue
    counts.set(v, (counts.get(v) || 0) + 1)
  }
  let best = null, bestCount = 0
  for (const [v, c] of counts) if (c > bestCount) { best = v; bestCount = c }
  return best
}

export function renderStockTable(el, title, stocks, sort) {
  if (stocks.length === 0) {
    el.innerHTML = `<div class="detail-header"><h2>${title} (0 檔)</h2></div>
      <div class="table-wrap"><table><tbody><tr><td style="text-align:center;padding:30px;color:var(--dim)">無符合股票</td></tr></tbody></table></div>`
    return
  }
  const latestDate = fmtDate(mostCommon(stocks.map((d) => d.date)))
  const prevDate = fmtDate(mostCommon(stocks.map((d) => d.datePrev)))

  const rows = stocks.map((d) => {
    const fc = d.foreignNet > 0 ? 'up' : d.foreignNet < 0 ? 'down' : ''
    const fpc = d.foreignNetPrev > 0 ? 'up' : d.foreignNetPrev < 0 ? 'down' : ''
    const ic = d.investNet > 0 ? 'up' : d.investNet < 0 ? 'down' : ''
    const dc = d.dealerNet > 0 ? 'up' : d.dealerNet < 0 ? 'down' : ''
    const tc = d.total > 0 ? 'up' : d.total < 0 ? 'down' : ''
    const pc = d.changeToday > 0 ? 'up' : d.changeToday < 0 ? 'down' : ''
    return `<tr data-symbol="${d.symbol}">
      <td class="sym">${d.symbol}</td>
      <td>${d.name}</td>
      <td class="mkt">${marketLabel(d.market)}</td>
      <td class="num">${typeof d.price === 'number' ? d.price.toFixed(2) : '--'}</td>
      <td class="num ${pc}">${fmtPct(d.changeToday)}</td>
      <td class="num ${fc}" title="${fmtDate(d.date) || '無資料'}">${fmtLots(d.foreignNet)}</td>
      <td class="num ${fpc}" title="${fmtDate(d.datePrev) || '無資料'}">${fmtLots(d.foreignNetPrev)}</td>
      <td class="num ${ic}">${fmt(d.investNet)}</td>
      <td class="num ${dc}">${fmt(d.dealerNet)}</td>
      <td class="num ${tc}">${fmt(d.total)}</td>
      <td class="num">${fmtPct(d.foreignHoldRatio)}</td>
    </tr>`
  }).join('')
  const headCells = SORT_COLUMNS.map((c) => {
    const activeSort = sort?.key === c.key
    const arrow = activeSort ? (sort.dir === 'asc' ? ' ▲' : ' ▼') : ''
    let label = c.label
    if (c.key === 'foreignNet') label = `外資買賣超${latestDate ? `(${latestDate})` : ''}·不累積`
    if (c.key === 'foreignNetPrev') label = `前一天外資買賣超${prevDate ? `(${prevDate})` : ''}`
    return `<th data-sort-key="${c.key}" class="${activeSort ? 'sorted' : ''}">${label}${arrow}</th>`
  }).join('')
  el.innerHTML = `
    <div class="detail-header">
      <h2>${title} (${stocks.length} 檔)</h2>
    </div>
    <div class="table-wrap">
      <table>
        <thead><tr>${headCells}</tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`
}

export { filterByMarket, SORT_COLUMNS }
