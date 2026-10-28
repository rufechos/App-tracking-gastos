// Backups: a JSON file with everything except the server key, and a CSV of the movements for Excel.
import { upgrade, safeId } from './store.js';
import { toCSV } from './parse/csv.js';
import { localIso, uid } from './util.js';

export const BACKUP_REMINDER_DAYS = 30;
export const FORMAT = 'cuaderno-gastos';

export function exportData(state, bank, now = new Date()) {
  return {
    app: FORMAT, format: 1, exportedAt: now.toISOString(),
    state,
    bank: { server: bank.server || '', conns: bank.conns || [] }, // never the key: on a new device you type it again
  };
}

export function validateBackup(obj) {
  if (!obj || obj.app !== FORMAT || !obj.state || !Array.isArray(obj.state.tx)) return { ok: false, error: 'El archivo no es una copia del Cuaderno de gastos.' };
  if (obj.format > 1) return { ok: false, error: 'La copia es de una versión más nueva de la app. Actualiza la app y vuelve a intentarlo.' };
  for (const t of obj.state.tx) {
    if (typeof t.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(t.date) || typeof t.amount !== 'number' || !isFinite(t.amount)) {
      return { ok: false, error: 'La copia está dañada: hay movimientos sin fecha o sin importe.' };
    }
  }
  const state = upgrade(obj.state);
  const dates = state.tx.map((t) => t.date).sort();
  const conns = obj.bank && Array.isArray(obj.bank.conns) ? obj.bank.conns
    .filter((c) => c && c.aspsp && typeof c.aspsp.name === 'string' && typeof c.session_id === 'string' && Array.isArray(c.accounts))
    .map((c) => ({ ...c, id: safeId(c.id) ? c.id : 'c_' + uid() })) : null;
  return {
    ok: true, state,
    bank: conns ? { server: String(obj.bank.server || ''), conns } : null,
    summary: { tx: state.tx.length, from: dates[0] || null, to: dates[dates.length - 1] || null, exportedAt: obj.exportedAt || null, positions: (state.inv.positions || []).length },
  };
}

// Text that starts like a formula (=, +, -, @) would run when the file is opened in Excel: it goes as text.
const cellText = (v) => (/^[=+\-@\t\r]/.test(v || '') ? "'" + v : v || '');

export function movementsCSV(state) {
  const cat = new Map(state.cats.map((c) => [c.id, c]));
  const acct = new Map((state.accounts || []).map((a) => [a.id, a.name]));
  const KIND = { gasto: 'Gasto', ingreso: 'Ingreso', inversion: 'Inversión', excluir: 'No cuenta' };
  const rows = [['Fecha', 'Concepto', 'Importe', 'Categoría', 'Tipo', 'Cuenta', 'Origen']];
  for (const t of state.tx.slice().sort((a, b) => a.date.localeCompare(b.date))) {
    const c = cat.get(t.cat) || {};
    rows.push([t.date.slice(8, 10) + '/' + t.date.slice(5, 7) + '/' + t.date.slice(0, 4), cellText(t.concept), t.amount.toFixed(2).replace('.', ','),
      cellText(c.name), KIND[c.kind] || '', cellText(acct.get(t.acct)), cellText(t.src)]);
  }
  return toCSV(rows);
}

export function backupDue(state, now = Date.now()) {
  if (state.sample || !state.tx.length) return false;
  const last = state.settings && state.settings.lastBackup;
  return !last || now - new Date(last).getTime() > BACKUP_REMINDER_DAYS * 864e5;
}

export const backupName = (ext, d = new Date()) => 'cuaderno-gastos-' + localIso(d) + '.' + ext;

// On the iPhone this opens the share sheet («Guardar en Archivos», iCloud Drive…); elsewhere it downloads.
export async function shareOrDownload(name, text, type) {
  const file = typeof File === 'function' ? new File([text], name, { type }) : null;
  if (file && navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title: name }); return 'shared'; }
    catch (e) { if (e && e.name === 'AbortError') return 'cancelled'; }
  }
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
  return 'downloaded';
}
