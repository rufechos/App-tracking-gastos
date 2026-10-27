// Bank and card statements as PDF text lines (one line per visual row, left to right).
import { norm, round2, ymd, dayDiff, addDays, localIso, findIban } from '../util.js';
import { parseNum, MONTH_WORDS, MONTH_DATE_RE } from './numbers.js';

const AMT_RE = /[-−+]?\s?\d{1,3}(?:[.\s]\d{3})*,\d{2}(?!\d)\s?-?|[-−+]?\d+,\d{2}(?!\d)\s?-?/g;
const NUM_DATE_RE = /^(\d{1,2})[/\-.](\d{1,2})(?:[/\-.](\d{4}|\d{2}))?(?!\d)/;
const FULL_DATE_G = /(?<!\d)(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4}|\d{2})(?!\d)/g;

function leadingDate(line) {
  let m = line.match(NUM_DATE_RE);
  if (m) return { len: m[0].length, d: +m[1], m: +m[2], y: m[3] ? +m[3] : null };
  m = line.match(MONTH_DATE_RE);
  if (m) return { len: m[0].length, d: +m[1], m: MONTH_WORDS[m[2].toLowerCase()], y: m[3] ? +m[3] : null };
  return null;
}

// Dates without a year ("20/12") take the year that puts them inside, or closest to, the period the
// statement covers (its full dates). A card statement from 15/12/2025 to 14/01/2026 puts 03/01 in 2026.
export function yearResolver(lines, today = localIso()) {
  const full = [];
  for (const l of lines) for (const m of l.matchAll(FULL_DATE_G)) { const d = ymd(+m[3], +m[2], +m[1]); if (d) full.push(d); }
  if (full.length) {
    const years = full.map((d) => +d.slice(0, 4)).sort((a, b) => a - b), mid = years[Math.floor(years.length / 2)];
    const kept = full.filter((d) => Math.abs(+d.slice(0, 4) - mid) <= 1).sort(); // drops stray dates (birth dates, old contracts)
    const lo = kept[0], hi = kept[kept.length - 1];
    return (d, m) => {
      let best = null, bestDist = Infinity;
      for (let y = +lo.slice(0, 4) - 1; y <= +hi.slice(0, 4) + 1; y++) {
        const iso = ymd(y, m, d);
        if (!iso) continue;
        const dist = iso < lo ? dayDiff(iso, lo) : iso > hi ? dayDiff(hi, iso) : 0;
        if (dist < bestDist || (dist === bestDist && iso > best)) { best = iso; bestDist = dist; }
      }
      return best;
    };
  }
  return (d, m) => {
    const y = +today.slice(0, 4), iso = ymd(y, m, d);
    return iso && iso > addDays(today, 1) ? ymd(y - 1, m, d) : iso;
  };
}

// -> { tx: [{date, concept, amount}], iban }
export function linesToTx(lines, today) {
  const resolve = yearResolver(lines, today);
  const recs = [];
  for (const line of lines) {
    const ld = leadingDate(line);
    if (!ld) {
      const last = recs[recs.length - 1];
      AMT_RE.lastIndex = 0;
      if (last && last.canAppend && !AMT_RE.test(line) && line.length < 80) { last.concept += ' ' + line; last.canAppend = false; }
      AMT_RE.lastIndex = 0;
      continue;
    }
    const date = ld.y != null ? ymd(ld.y, ld.m, ld.d) : resolve(ld.d, ld.m);
    if (!date) continue;
    let rest = line.slice(ld.len).trim();
    const second = leadingDate(rest); // value date right after the operation date
    if (second) rest = rest.slice(second.len).trim();
    const amts = (rest.match(AMT_RE) || []).map((a) => parseNum(a.replace(/\s/g, ''))).filter((v) => v != null);
    if (!amts.length) continue;
    const concept = rest.replace(AMT_RE, ' ').replace(/(?<!\d)\d{1,2}[/\-.]\d{1,2}(?:[/\-.]\d{2,4})?(?!\d)/g, ' ').replace(/\s+/g, ' ').trim();
    if (!concept || concept.length < 2) continue;
    recs.push({ date, concept, amount: amts.length >= 2 ? amts[amts.length - 2] : amts[0], balance: amts.length >= 2 ? amts[amts.length - 1] : null, canAppend: true });
  }
  if (!recs.length) throw new Error('No he encontrado movimientos en el PDF. Si es posible, descárgalo en CSV o Excel desde tu banca online.');
  if (!recs.some((r) => r.amount < 0)) {
    // Unsigned amounts: the balance change says the direction; failing that, the wording.
    recs.forEach((r, i) => {
      const a = Math.abs(r.amount), prev = recs[i - 1], next = recs[i + 1];
      let s = null;
      if (prev && prev.balance != null && r.balance != null && Math.abs(Math.abs(r.balance - prev.balance) - a) < 0.011) s = Math.sign(r.balance - prev.balance);
      else if (next && next.balance != null && r.balance != null && Math.abs(Math.abs(r.balance - next.balance) - a) < 0.011) s = Math.sign(r.balance - next.balance);
      if (!s) s = /nomina|abono|recibida|devolucion|ingreso|reembolso|intereses a su favor|pension|pago recibido|su pago/.test(norm(r.concept)) ? 1 : -1;
      r.amount = s * a;
    });
  }
  return { tx: recs.map((r) => ({ date: r.date, concept: r.concept, amount: round2(r.amount) })), iban: findIban(lines.slice(0, 40).join(' ')) };
}
