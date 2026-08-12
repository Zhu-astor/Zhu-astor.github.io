import { loadAnalysis, loadStatus, fetchToday, backfill } from './api.js'
import { labelOf } from './conditions.js'
import { renderBanner, renderCards, renderMarketSplit, renderFloatingBar, filterByMarket } from './render.js'

const state = {
  allData: [],
  selectedIds: new Set(),
  market: 'all', // 'all' | 'listed' | 'otc'
  topPercent: 10, // "近一日籌碼大買" = top N% of that day's positive net-buyers
  datesCount: 0,
}

const el = {
  loading: document.getElementById('loading'),
  banner: document.getElementById('banner'),
  marketSplit: document.getElementById('market-split'),
  cardGrid: document.getElementById('card-grid'),
  floatingBar: document.getElementById('floating-bar'),
  marketFilter: document.getElementById('market-filter'),
  thresholdInput: document.getElementById('threshold-input'),
  fetchNowBtn: document.getElementById('fetch-now-btn'),
  fetchStatus: document.getElementById('fetch-status'),
  backfillDaysInput: document.getElementById('backfill-days-input'),
  backfillBtn: document.getElementById('backfill-btn'),
  backfillStatus: document.getElementById('backfill-status'),
  savedCombosBtn: document.getElementById('saved-combos-btn'),
  statDate: document.getElementById('stat-date'),
  statTotal: document.getElementById('stat-total'),
  statAny: document.getElementById('stat-any'),
  statSel: document.getElementById('stat-sel'),
}

function redrawCards() {
  renderCards(el.cardGrid, { allData: state.allData, selectedIds: state.selectedIds, market: state.market, datesCount: state.datesCount })
  el.statSel.textContent = state.selectedIds.size
}

function redrawFloatingBar() {
  renderFloatingBar(el.floatingBar, { selectedCount: state.selectedIds.size })
}

// Live count of stocks matching the CURRENTLY selected combo (AND across all
// selected conditions), updated on every toggle/market change — this is what
// actually answers "how many stocks does my combo match", replacing the old
// static "matches at least one of 11 conditions" stat that nobody could act on.
function updateMatchStat() {
  if (state.selectedIds.size === 0) {
    el.statAny.textContent = '--'
    return
  }
  const labels = Array.from(state.selectedIds).map(labelOf)
  const scoped = filterByMarket(state.allData, state.market)
  const count = scoped.filter((d) => d.conditions && labels.every((l) => d.conditions.includes(l))).length
  el.statAny.textContent = count.toLocaleString()
}

function toggleCard(id) {
  if (state.selectedIds.has(id)) state.selectedIds.delete(id)
  else state.selectedIds.add(id)
  redrawCards()
  redrawFloatingBar()
  updateMatchStat()
}

// The only place selection navigates anywhere — opens a real new tab
// (not an in-page overlay) with large, clear typography; combo save/switch
// now lives entirely on that results page, not on this card-selection page.
function openResultTab() {
  if (state.selectedIds.size === 0) return
  const ids = Array.from(state.selectedIds)
  window.open(`/institutional-result.html?conds=${ids.join(',')}&topPercent=${state.topPercent}`, '_blank')
}

function wireEvents() {
  el.cardGrid.addEventListener('click', (e) => {
    const card = e.target.closest('[data-cond-id]')
    if (card) toggleCard(card.dataset.condId)
  })

  el.floatingBar.addEventListener('click', (e) => {
    if (e.target.closest('#view-detail-btn')) openResultTab()
  })

  el.savedCombosBtn.addEventListener('click', () => {
    window.open('/institutional-result.html', '_blank')
  })

  el.marketFilter.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-market]')
    if (!btn) return
    state.market = btn.dataset.market
    for (const b of el.marketFilter.querySelectorAll('[data-market]')) b.classList.toggle('active', b === btn)
    redrawCards()
    updateMatchStat()
  })

  el.thresholdInput.addEventListener('change', () => {
    const v = parseFloat(el.thresholdInput.value)
    state.topPercent = Number.isFinite(v) && v > 0 && v < 100 ? v : 10
    load()
  })

  el.fetchNowBtn.addEventListener('click', async () => {
    el.fetchNowBtn.disabled = true
    el.fetchStatus.textContent = '抓取中…'
    try {
      const result = await fetchToday()
      if (result.ok) {
        const s = result.sources
        const okList = Object.entries(s).filter(([, v]) => v).map(([k]) => k)
        const failList = Object.entries(s).filter(([, v]) => !v).map(([k]) => k)
        el.fetchStatus.textContent = `完成：成功 ${okList.join(',') || '無'}；尚未齊全 ${failList.join(',') || '無'}`
      } else {
        el.fetchStatus.textContent = `失敗：${result.error}`
      }
    } catch (err) {
      el.fetchStatus.textContent = `失敗：${err.message}`
    }
    el.fetchNowBtn.disabled = false
    await load()
  })

  el.backfillBtn.addEventListener('click', async () => {
    const days = Math.min(Math.max(parseInt(el.backfillDaysInput.value) || 10, 1), 60)
    el.backfillBtn.disabled = true
    el.backfillStatus.textContent = `回補中…（${days} 天，可能要 1 分鐘以上，請耐心等候）`
    try {
      const result = await backfill(days)
      el.backfillStatus.textContent =
        `完成：成功 ${result.succeeded.length} 天、部分成功 ${result.partial.length} 天、` +
        `略過(非交易日) ${result.skipped.length} 天`
    } catch (err) {
      el.backfillStatus.textContent = `失敗：${err.message}`
    }
    el.backfillBtn.disabled = false
    await load()
  })
}

async function load() {
  try {
    const [data, status] = await Promise.all([loadAnalysis(state.topPercent), loadStatus()])
    state.allData = data.stocks || []
    state.datesCount = (data.dates || []).length
    el.loading.style.display = 'none'
    el.cardGrid.style.display = 'grid'

    renderBanner(el.banner, { sources: data.sources, latest: data.latest, total: state.allData.length })
    renderMarketSplit(el.marketSplit, { allData: state.allData })
    el.statDate.textContent = data.latest || '--'
    el.statTotal.textContent = state.allData.length

    redrawCards()
    redrawFloatingBar()
    updateMatchStat()
  } catch (err) {
    el.loading.innerHTML = `⚠️ ${err.message}`
  }
}

function init() {
  wireEvents()
  load()
  // 三大法人 data only ever changes once/day server-side (see startPolling in
  // institutional.mjs — official TWSE/TPEx post-market publications, not an
  // intraday feed), but this page previously never re-fetched after first
  // load, so an already-open tab would never notice today's data landing
  // after ~16:00 without a manual reload. Polling every 5 min matches the
  // server's own poll cadence.
  setInterval(load, 300000)
}

init()
