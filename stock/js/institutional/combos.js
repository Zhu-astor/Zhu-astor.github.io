// User-defined "condition combos" — a named set of condition ids the user
// wants to re-select later. Stored client-side only (single-machine usage);
// see PAPER/AskUserQuestion decision: server-side JSON was the alternative,
// localStorage was chosen because this is single-user, single-machine.
const STORAGE_KEY = 'institutional.combos.v1'

function readAll() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

function writeAll(list) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(list))
}

export function listCombos() {
  return readAll()
}

export function saveCombo(name, conditionIds) {
  const list = readAll()
  const combo = { id: String(Date.now()), name, conditionIds: [...conditionIds] }
  list.push(combo)
  writeAll(list)
  return combo
}

export function deleteCombo(id) {
  writeAll(readAll().filter((c) => c.id !== id))
}

export function getCombo(id) {
  return readAll().find((c) => c.id === id) || null
}
