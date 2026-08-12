// Shared condition catalogue: `label` must match the Chinese string the
// backend pushes into `entry.conditions` (server/institutional.mjs
// `analyze()`) EXACTLY — the card counts are computed by exact string
// membership, not substring match, so any drift here silently shows 0
// regardless of the underlying data. `minDays` is how many stored daily
// snapshots analyze() needs before this condition can produce anything but
// 0 — the UI uses it to show "資料不足" instead of a misleading "0".
// `sentiment` drives bar color: 'bull' reuses the app's existing --up (red,
// Taiwan convention) token, 'bear' reuses --down (green) — the same
// semantic already used for foreignNet/investNet/total table cells, so the
// condition chart and the detail table read as one system instead of two.
// Evidence-strength labeling: TWSE/TPEx never publish a "主力" flag — the
// rigorous version of that concept is broker-branch trading data (券商分點),
// which TWSE only sells as a paid product, not a free API. So nothing here
// is called "主力" anymore; conditions are named for the official field they
// actually read. Day-count streaks (5天/3天) are conventional round numbers
// from Taiwan retail chip-analysis commentary, not backtest-validated
// thresholds — flagged in `desc` rather than presented as authoritative.
export const CONDITIONS = [
  { id: 'mainBuy', label: '三大法人合計買超', desc: '三大法人(外資+投信+自營商)合計 > 0 — 常被稱為「主力買超」，但這只是三種法人加總的近似值，不是券商分點等級的真實主力資料', sentiment: 'bull', minDays: 1 },
  { id: 'foreignBuy', label: '外資買超', desc: '外資買賣超 > 0（官方欄位直接對應）', sentiment: 'bull', minDays: 1 },
  { id: 'investBuy', label: '投信買超', desc: '投信買賣超 > 0（官方欄位直接對應）', sentiment: 'bull', minDays: 1 },
  { id: 'bigBuy', label: '近一日籌碼大買', desc: '三大法人合計淨買超排在當日全市場前 10%（相對排名，可調整百分位）', sentiment: 'bull', minDays: 1 },
  { id: 'smallBuy', label: '近一日籌碼小買', desc: '三大法人合計 > 0，且排在當日全市場後 50%（真正偏小，不是「大買以外的全部」）', sentiment: 'bull', minDays: 1 },
  { id: 'foreignBuy5', label: '外資連買5天', desc: '連續 5 個交易日外資買超（已檢查日期真的相鄰，中間斷過就不算）— 5 天為業界常見經驗值，未經回測驗證', sentiment: 'bull', minDays: 5 },
  { id: 'investBuy5', label: '投信連買5天', desc: '連續 5 個交易日投信買超（已檢查日期真的相鄰）— 5 天為業界常見經驗值，未經回測驗證', sentiment: 'bull', minDays: 5 },
  { id: 'foreignSell3', label: '外資連3賣', desc: '連續 3 個交易日外資賣超（已檢查日期真的相鄰）— 3 天為業界常見經驗值，未經回測驗證', sentiment: 'bear', minDays: 3 },
  { id: 'investSell3', label: '投信連3賣', desc: '連續 3 個交易日投信賣超（已檢查日期真的相鄰）— 3 天為業界常見經驗值，未經回測驗證', sentiment: 'bear', minDays: 3 },
  { id: 'foreignSell3toBuy', label: '外資連3賣轉買', desc: '前 3 個交易日賣 + 今日買（已檢查日期真的相鄰）— 3 天為業界常見經驗值，未經回測驗證', sentiment: 'bull', minDays: 4 },
  { id: 'foreignAccBuy3', label: '外資近3日買超(流量近似)', desc: '近 3 個交易日外資買賣超加總 > 0 — 只反映買賣「流量」，不是持股「存量」的實際變化，兩者不完全等價', sentiment: 'bull', minDays: 3 },
  { id: 'foreignRatioUp3', label: '外資持股比率連3日增加', desc: '外資持股比率連續 3 個交易日上升（已檢查日期真的相鄰）— 官方持股比率原始數字，是 12 個條件裡證據最紮實的一個', sentiment: 'bull', minDays: 3 },
]

export function labelOf(id) {
  return CONDITIONS.find((c) => c.id === id)?.label || id
}

export function idOf(label) {
  return CONDITIONS.find((c) => c.label === label)?.id || label
}
