// Totals by category and by month. Only "gasto" and "ingreso" categories count; "inversion" is tracked apart and
// "excluir" (transfers between your accounts) is left out.
export function agg(list, kindOf) {
  const e = {}, inc = {};
  let te = 0, ti = 0, tinv = 0;
  for (const t of list) {
    const k = kindOf(t.cat);
    if (k === 'gasto') e[t.cat] = (e[t.cat] || 0) - t.amount;
    else if (k === 'ingreso') inc[t.cat] = (inc[t.cat] || 0) + t.amount;
    else if (k === 'inversion') tinv -= t.amount;
  }
  for (const k of Object.keys(e)) { if (e[k] <= 0.004) delete e[k]; else te += e[k]; }
  for (const k of Object.keys(inc)) { if (inc[k] <= 0.004) delete inc[k]; else ti += inc[k]; }
  return { e, inc, te, ti, tinv };
}

export function byMonth(tx) {
  const m = new Map();
  for (const t of tx) {
    const k = t.date.slice(0, 7);
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(t);
  }
  return m;
}

export const monthsOf = (tx) => [...new Set(tx.map((t) => t.date.slice(0, 7)))].sort();
