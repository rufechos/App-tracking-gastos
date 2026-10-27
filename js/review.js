// «Por revisar»: new movements whose category is unclear, possible duplicates, refunds without their purchase
// and possible transfers between your accounts. Each one is settled with one tap.
export const RV_LABEL = {
  otros: 'No sé en qué categoría va',
  generic: 'Categoría dudosa',
  dup: '¿Es el mismo movimiento que otro que ya tenías?',
  refund: 'Devolución: no encuentro la compra original',
  transfer: '¿Es dinero entre tus propias cuentas?',
};

export const reviewItems = (state) => state.tx.filter((t) => t.rv).sort((a, b) => b.date.localeCompare(a.date) || a.amount - b.amount);

// The duplicate is the same movement: keep the one you had, with the bank's key so the next sync skips it.
export function confirmDuplicate(state, id) {
  const t = state.tx.find((x) => x.id === id);
  if (!t) return;
  const other = state.tx.find((x) => x.id === t.dupOf);
  if (other) {
    if (t.ext && !other.ext) other.ext = t.ext;
    if (t.acct && !other.acct) other.acct = t.acct;
    for (const k of ['ref', 'mcc', 'cpIban', 'cpName']) if (t[k] && !other[k]) other[k] = t[k];
  }
  state.tx = state.tx.filter((x) => x.id !== id);
  const f = t.fid && state.files.find((x) => x.id === t.fid);
  if (f) { f.added = Math.max(0, f.added - 1); f.dup++; }
}

export function settle(state, id, cat) {
  const t = state.tx.find((x) => x.id === id);
  if (!t) return null;
  if (cat && cat !== t.cat) { t.cat = cat; t.manual = true; }
  else if (t.rv === 'transfer' || t.rv === 'refund') t.manual = true; // keep what the app proposed
  delete t.rv;
  delete t.dupOf;
  return t;
}
