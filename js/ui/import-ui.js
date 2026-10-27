// Ajustes › Importar extractos: reading the files and the list of what each one added.
import { app, save, leaveSample, persistStorage } from '../store.js';
import { $, esc, toast } from './dom.js';
import { classify } from '../classify.js';
import { readStatement } from '../parse/files.js';
import { importStatement, setFileAccount, removeFile } from '../import.js';
import { plural, fmtD } from '../util.js';

let busy = false;

export async function handleFiles(list) {
  const files = [...list];
  if (!files.length || busy) return;
  busy = true;
  $('files').insertAdjacentHTML('afterbegin', '<div class="file-row muted" id="reading">Leyendo…</div>');
  leaveSample();
  const fresh = new Set();
  let added = 0, maybe = 0;
  for (const f of files) {
    try {
      const parsed = await readStatement(f);
      const r = importStatement(app.state, parsed, { name: f.name });
      r.fresh.forEach((id) => fresh.add(id));
      added += r.entry.added; maybe += r.entry.maybe;
    } catch (e) {
      app.state.files.push({ id: 'f_err' + Date.now(), name: f.name, added: 0, dup: 0, maybe: 0, error: e.message || String(e), at: new Date().toISOString() });
    }
  }
  classify(app.state, fresh);
  save();
  persistStorage();
  busy = false;
  app.render();
  toast(added ? plural(added, 'movimiento añadido', 'movimientos añadidos') + (maybe ? ` · ${plural(maybe, 'posible duplicado', 'posibles duplicados')} en «Por revisar»` : '') : 'No hay movimientos nuevos en estos archivos.');
}

export function renderImport() {
  const s = app.state;
  const opts = (sel) => '<option value="">Sin cuenta</option>' + s.accounts.map((a) => `<option value="${a.id}"${a.id === sel ? ' selected' : ''}>${esc(a.name)}</option>`).join('');
  $('files').innerHTML = s.files.slice().reverse().map((f) => `<div class="file-row"><strong>${esc(f.name)}</strong>${f.at ? `<span class="muted small">${fmtD(f.at)}</span>` : ''}
    ${f.error ? `<span class="err">${esc(f.error)}</span><button class="x" type="button" data-delfile="${f.id}" aria-label="Quitar">×</button>`
      : `<span class="ok">${plural(f.added, 'añadido', 'añadidos')}</span>${f.dup ? `<span class="muted">${plural(f.dup, 'repetido ignorado', 'repetidos ignorados')}</span>` : ''}${f.maybe ? `<span class="warn">${plural(f.maybe, 'por revisar', 'por revisar')}</span>` : ''}${f.flipped ? '<span class="muted">Importes en positivo: tomados como gastos</span>' : ''}
      ${s.accounts.length ? `<select data-fileacct="${f.id}" aria-label="Cuenta del extracto">${opts(f.acct)}</select>` : ''}
      <button class="btn sm danger" type="button" data-delfile="${f.id}">Quitar sus movimientos</button>`}</div>`).join('');
}

export function bindImport() {
  const drop = $('drop'), fi = $('file');
  drop.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fi.click(); } });
  fi.addEventListener('change', () => { handleFiles(fi.files); fi.value = ''; });
  ['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('over'); }));
  ['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('over'); }));
  drop.addEventListener('drop', (e) => handleFiles(e.dataTransfer.files));
  $('files').addEventListener('change', (e) => {
    const s = e.target.closest('select[data-fileacct]');
    if (!s) return;
    setFileAccount(app.state, s.dataset.fileacct, s.value);
    classify(app.state);
    save();
    app.render();
  });
  $('files').addEventListener('click', (e) => {
    const b = e.target.closest('[data-delfile]');
    if (!b) return;
    const f = app.state.files.find((x) => x.id === b.dataset.delfile);
    if (f && !f.error && !b.dataset.sure) { b.dataset.sure = '1'; b.textContent = `¿Quitar ${plural(f.added, 'movimiento', 'movimientos')}? Pulsa otra vez`; return; }
    removeFile(app.state, b.dataset.delfile);
    classify(app.state);
    save();
    app.render();
  });
}
