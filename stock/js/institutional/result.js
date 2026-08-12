import { loadAnalysis } from './api.js'
import { listCombos, saveCombo, getCombo, deleteCombo } from './combos.js'
import { labelOf } from './conditions.js'
import { renderStockTable, sortStocks } from './render.js'

const urlParams = new URLSearchParams(location.search)
const condIds = (urlParams.get('conds') || '').split(',').filter(Boolean)
const topPercent = parseFloat(urlParams.get('topPercent')) || undefined
const sort = { key: 'foreignNet', dir: 'desc' }
let allData = []

const el = {
  headerInfo: document.getElementById('header-info'),
  actionRow: document.getElementById('action-row'),
  saveToggleBtn: document.getElementById('save-toggle-btn'),
  saveRow: document.getElementById('save-row'),
  saveNameInput: document.getElementById('save-name-input'),
  saveConfirmBtn: document.getElementById('save-confirm-btn'),
  saveMsg: document.getElementById('save-msg'),
  comboSwitch: document.getElementById('combo-switch'),
  loading: document.getElementById('loading'),
  picker: document.getElementById('picker'),
  tableContainer: document.getElementById('table-container'),
}

function populateComboSwitch() {
  const combos = listCombos()
  el.comboSwitch.innerHTML =
    '<option value="">切換已儲存組合…</option>' +
    combos.map((c) => `<option value="${c.id}">${c.name} (${c.conditionIds.length} 個條件)</option>`).join('')
}

function goToCombo(id) {
  const combo = getCombo(id)
  if (!combo) return
  const pct = topPercent ? `&topPercent=${topPercent}` : ''
  location.href = `/institutional-result.html?conds=${combo.conditionIds.join(',')}${pct}`
}

function renderPicker() {
  el.loading.style.display = 'none'
  el.picker.style.display = 'flex'
  const combos = listCombos()
  if (combos.length === 0) {
    el.picker.innerHTML = `<div class="picker-empty">尚未儲存任何策略組合。請先回到 <a href="/institutional.html" style="color:var(--accent)">條件選擇頁</a> 勾選條件、按「查看詳細」，再於此頁把目前組合存起來。</div>`
    return
  }
  el.picker.innerHTML = combos.map((c) => `
    <div class="picker-item" data-combo-id="${c.id}">
      <span class="del" data-del-id="${c.id}">刪除 ✕</span>
      <div class="name">${c.name}</div>
      <div class="meta">${c.conditionIds.length} 個條件：${c.conditionIds.map(labelOf).join('、')}</div>
    </div>`).join('')
  el.picker.addEventListener('click', (e) => {
    const del = e.target.closest('[data-del-id]')
    if (del) { e.stopPropagation(); deleteCombo(del.dataset.delId); renderPicker(); return }
    const item = e.target.closest('[data-combo-id]')
    if (item) goToCombo(item.dataset.comboId)
  })
}

function draw() {
  const sorted = sortStocks(allData, sort.key, sort.dir)
  renderStockTable(el.tableContainer, condIds.map(labelOf).join(' 且 '), sorted, sort)
}

function wireResultEvents() {
  el.saveToggleBtn.addEventListener('click', () => {
    el.saveRow.classList.toggle('show')
    if (el.saveRow.classList.contains('show')) el.saveNameInput.focus()
  })

  el.saveConfirmBtn.addEventListener('click', () => {
    const name = el.saveNameInput.value.trim()
    if (!name) { el.saveNameInput.focus(); return }
    saveCombo(name, condIds)
    el.saveMsg.textContent = `已儲存「${name}」`
    el.saveNameInput.value = ''
    el.saveRow.classList.remove('show')
    populateComboSwitch()
  })

  el.comboSwitch.addEventListener('change', () => {
    if (el.comboSwitch.value) goToCombo(el.comboSwitch.value)
  })

  el.tableContainer.addEventListener('click', (e) => {
    const th = e.target.closest('th[data-sort-key]')
    if (th) {
      const key = th.dataset.sortKey
      if (sort.key === key) sort.dir = sort.dir === 'asc' ? 'desc' : 'asc'
      else { sort.key = key; sort.dir = 'desc' }
      draw()
      return
    }
    const row = e.target.closest('tr[data-symbol]')
    if (row) window.open(`/stock?symbol=${row.dataset.symbol}`, '_blank')
  })
}

async function init() {
  wireResultEvents()

  if (condIds.length === 0) {
    renderPicker()
    return
  }

  el.actionRow.style.display = 'flex'
  populateComboSwitch()
  try {
    await loadAndDraw()
    el.loading.style.display = 'none'
    el.tableContainer.style.display = 'block'
    // 三大法人 data itself only ever changes once/day (official TWSE/TPEx
    // post-market publications — there is no intraday version), but price/
    // 漲幅% on this same table comes from the live quote cache, which does
    // update all day. Re-poll on that cadence so an already-open tab picks
    // up new prices (and, after 16:00, the next day's chip data) without a
    // manual reload — this page previously never refreshed after first load.
    setInterval(loadAndDraw, 60000)
  } catch (err) {
    el.loading.textContent = `⚠️ ${err.message}`
  }
}

// Price/漲幅% are NOT part of institutional.mjs's daily chip snapshot — they
// come from the same live quote cache the /dashboard table reads
// (/api/quotes), merged in here by symbol so this table can show "current
// price" without institutional.mjs needing to know anything about live quotes.
async function loadAndDraw() {
  const [data, quotesRes] = await Promise.all([
    loadAnalysis(topPercent),
    fetch('/api/quotes').then((r) => (r.ok ? r.json() : { stocks: [] })).catch(() => ({ stocks: [] })),
  ])
  const quoteBySymbol = new Map((quotesRes.stocks || []).map((q) => [q.symbol, q]))
  const labels = condIds.map(labelOf)
  allData = (data.stocks || [])
    .filter((d) => d.conditions && labels.every((l) => d.conditions.includes(l)))
    .map((d) => {
      const q = quoteBySymbol.get(d.symbol)
      return q ? { ...d, price: q.price, changeToday: q.changeToday } : d
    })
  draw()
}

init()
