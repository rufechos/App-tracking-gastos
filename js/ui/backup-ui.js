// Ajustes › Copia de seguridad, exportar a CSV y borrar todo.
import { app, save, bankSave, resetAll } from '../store.js';
import { ui } from './state.js';
import { $, esc, toast } from './dom.js';
import { exportData, validateBackup, movementsCSV, shareOrDownload, backupName } from '../backup.js';
import { readText } from '../parse/files.js';
import { fmtD, fmtDT, plural } from '../util.js';
import { defaultPeriod } from '../period.js';

export async function exportBackup() {
  const json = JSON.stringify(exportData(app.state, app.bank), null, 1);
  const how = await shareOrDownload(backupName('json'), json, 'application/json');
  if (how === 'cancelled') return;
  app.state.settings.lastBackup = new Date().toISOString();
  save();
  app.render();
  toast(how === 'shared' ? 'Copia lista: guárdala en Archivos o en iCloud Drive.' : 'Copia descargada.');
}

export function renderBackup() {
  const last = app.state.settings.lastBackup;
  $('lastBackup').textContent = last ? 'Última copia: ' + fmtDT(last) : 'Todavía no has guardado ninguna copia';
  const r = ui.restore;
  $('restoreBox').innerHTML = !r ? '' : r.error ? `<div class="file-row"><span class="err">${esc(r.error)}</span></div>`
    : `<div class="notice"><span>La copia${r.summary.exportedAt ? ' del ' + fmtD(r.summary.exportedAt) : ''} tiene ${plural(r.summary.tx, 'movimiento', 'movimientos')}${r.summary.from ? ' (del ' + fmtD(r.summary.from) + ' al ' + fmtD(r.summary.to) + ')' : ''} y ${plural(r.summary.positions, 'posición', 'posiciones')}. Sustituirá lo que hay ahora (${plural(app.state.sample ? 0 : app.state.tx.length, 'movimiento', 'movimientos')}).</span>
      <span class="tools"><button class="btn primary" type="button" id="restoreYes">Restaurar</button><button class="btn" type="button" id="restoreNo">Cancelar</button></span></div>`;
}

export function bindBackup() {
  $('exportBtn').addEventListener('click', exportBackup);
  $('csvBtn').addEventListener('click', () => shareOrDownload(backupName('csv'), movementsCSV(app.state), 'text/csv'));
  $('restoreFile').addEventListener('change', async () => {
    const f = $('restoreFile').files[0];
    $('restoreFile').value = '';
    if (!f) return;
    try { ui.restore = validateBackup(JSON.parse(await readText(f))); }
    catch (e) { ui.restore = { ok: false, error: 'No he podido leer el archivo: ' + e.message }; }
    renderBackup();
  });
  $('restoreBox').addEventListener('click', (e) => {
    if (e.target.id === 'restoreNo') { ui.restore = null; renderBackup(); }
    if (e.target.id === 'restoreYes' && ui.restore && ui.restore.ok) {
      const r = ui.restore;
      app.state = r.state;
      app.state.settings.lastBackup = app.state.settings.lastBackup || new Date().toISOString();
      if (r.bank) {
        if (r.bank.server && !app.bank.server) app.bank.server = r.bank.server;
        if (r.bank.conns.length) app.bank.conns = r.bank.conns;
        bankSave();
      }
      ui.restore = null;
      ui.period = defaultPeriod();
      save();
      app.render();
      toast('Copia restaurada.' + (r.bank && r.bank.conns.length && !app.bank.token ? ' Escribe la clave de acceso del servidor para volver a sincronizar.' : ''));
    }
  });
  $('resetBox').addEventListener('click', (e) => {
    if (e.target.id === 'resetBtn') $('resetBox').innerHTML = '<span>Se borrarán todos los movimientos, cuentas, reglas y la cartera. Los bancos conectados volverán a descargar su historial.</span><button class="btn danger" type="button" id="resetYes">Sí, borrar</button><button class="btn" type="button" id="resetNo">Cancelar</button>';
    else if (e.target.id === 'resetYes') { resetAll(); ui.pending = null; ui.period = defaultPeriod(); resetButton(); app.render(); toast('Datos borrados.'); }
    else if (e.target.id === 'resetNo') resetButton();
  });
}
function resetButton() { $('resetBox').innerHTML = '<button class="btn danger" id="resetBtn" type="button">Borrar todos los datos</button>'; }
