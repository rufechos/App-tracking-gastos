// Turns a chosen file into rows or text lines, using the bundled readers.
import { loadPdf } from '../lazy.js';
import { decodeText, parseCSV } from './csv.js';
import { rowsToTx } from './tabular.js';
import { linesToTx } from './pdf-statement.js';
import { rowsToPositions, linesToPositions } from './positions.js';

const extOf = (f) => (f.name.split('.').pop() || '').toLowerCase();
const isPdf = (f) => extOf(f) === 'pdf' || f.type === 'application/pdf';
const isText = (f) => ['csv', 'txt', 'tsv'].includes(extOf(f)) || f.type === 'text/csv';

export function readSheets(buf, timeoutMs = 60000) {
  return new Promise((resolve, reject) => {
    const w = new Worker(new URL('./xlsx-worker.js', import.meta.url));
    const done = (fn, v) => { clearTimeout(timer); w.terminate(); fn(v); };
    const timer = setTimeout(() => done(reject, new Error('El archivo tarda demasiado en leerse.')), timeoutMs);
    w.onmessage = (e) => (e.data.ok ? done(resolve, e.data.sheets) : done(reject, new Error('No he podido leer el Excel: ' + e.data.error)));
    w.onerror = (e) => { e.preventDefault(); done(reject, new Error('No se pudo cargar el lector de Excel.')); };
    w.postMessage(buf, [buf]);
  });
}

export async function pdfLines(buf) {
  const pdfjs = await loadPdf();
  const pdf = await pdfjs.getDocument({ data: buf, isEvalSupported: false }).promise;
  const lines = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const tc = await (await pdf.getPage(p)).getTextContent();
    const rows = [];
    for (const it of tc.items) {
      if (!it.str || !it.str.trim()) continue;
      const y = it.transform[5];
      let r = rows.find((row) => Math.abs(row.y - y) < 2.5);
      if (!r) { r = { y, items: [] }; rows.push(r); }
      r.items.push({ x: it.transform[4], s: it.str });
    }
    rows.sort((a, b) => b.y - a.y).forEach((r) => lines.push(r.items.sort((a, b) => a.x - b.x).map((i) => i.s).join(' ').replace(/\s+/g, ' ').trim()));
  }
  await pdf.destroy();
  return lines;
}

// Statement file -> { tx, iban }
export async function readStatement(file) {
  const buf = await file.arrayBuffer();
  if (isPdf(file)) return linesToTx(await pdfLines(buf));
  if (isText(file)) return rowsToTx(parseCSV(decodeText(buf)));
  const sheets = await readSheets(buf);
  let best = null, lastErr = null;
  for (const rows of sheets) {
    try { const r = rowsToTx(rows); if (!best || r.tx.length > best.tx.length) best = r; } catch (e) { lastErr = e; }
  }
  if (!best || !best.tx.length) throw lastErr || new Error('No he encontrado movimientos en el archivo.');
  return best;
}

// Positions report -> [{name, isin, qty, cost, price, costGuess}]
export async function readPositions(file) {
  const buf = await file.arrayBuffer();
  if (isPdf(file)) return linesToPositions(await pdfLines(buf));
  if (isText(file)) return rowsToPositions(parseCSV(decodeText(buf)));
  let err = null;
  for (const rows of await readSheets(buf)) {
    try { return rowsToPositions(rows); } catch (e) { err = e; }
  }
  throw err || new Error('No he encontrado posiciones en el archivo.');
}

export async function readText(file) { return decodeText(await file.arrayBuffer()); }
