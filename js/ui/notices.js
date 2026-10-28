// Messages at the top: things that need you (a failed save, a backup, a bank permission about to expire…).
import { app, save, bankSave } from '../store.js';
import { ui } from './state.js';
import { $, esc, toast } from './dom.js';
import { backupDue } from '../backup.js';
import { expired, expiresSoon } from '../bank.js';
import { fmtD } from '../util.js';
import { exportBackup } from './backup-ui.js';
import { checkClaim, stopClaimPolling, startClaimPolling, connectBank, loadAspsps, GUIDE, SERVER_VERSION } from '../sync.js';

let returnedCode = null;
export const setReturnedCode = (c) => { returnedCode = c; };

export function renderNotices() {
  const s = app.state, b = app.bank, out = [];
  const n = (cls, text, actions = '') => out.push(`<div class="notice ${cls}"><span>${text}</span>${actions ? `<span class="tools">${actions}</span>` : ''}</div>`);
  if (app.saveError) n('bad', '<strong>No he podido guardar los cambios en este dispositivo.</strong> El almacenamiento está lleno o bloqueado: exporta una copia ahora para no perderlos.', '<button class="btn sm primary" type="button" data-nt="export">Exportar copia</button>');
  if (ui.update) n('info', 'Hay una versión nueva de la app.', '<button class="btn sm primary" type="button" data-nt="update">Actualizar</button>');
  if (returnedCode) n('info', `Has vuelto del banco en otro navegador. Copia este código, abre la app desde la pantalla de inicio y pégalo en Ajustes › Bancos conectados: <strong class="num">${esc(returnedCode)}</strong>`, '<button class="btn sm" type="button" data-nt="copycode">Copiar código</button>');
  if (ui.serverVersion && ui.serverVersion < SERVER_VERSION) n('', 'Tu servidor de Cloudflare es de una versión anterior. Vuelve a pegar el código de <strong>servidor/worker.js</strong> para tener los saldos de tus cuentas, la copia cifrada, los avisos y los precios guardados.', `<a class="btn sm" href="${GUIDE}#actualizar-el-servidor" target="_blank" rel="noopener">Cómo hacerlo</a>`);
  const pa = b.pendingAuth;
  if (pa && pa.via === 'server') n('info', `Esperando la autorización de <strong>${esc(pa.aspsp.name)}</strong>. Cuando termines en la web del banco, vuelve a esta app.`, '<button class="btn sm" type="button" data-nt="claim">Comprobar</button><button class="btn sm" type="button" data-nt="cancelauth">Cancelar</button>');
  for (const c of b.conns) {
    if (expired(c)) n('bad', `El permiso de <strong>${esc(c.aspsp.name)}</strong> ha caducado y ya no se sincroniza.`, `<button class="btn sm primary" type="button" data-nt-reconn="${c.id}">Volver a autorizar</button>`);
    else if (expiresSoon(c)) n('', `El permiso de <strong>${esc(c.aspsp.name)}</strong> caduca el ${fmtD(c.valid_until)}.`, `<button class="btn sm" type="button" data-nt-reconn="${c.id}">Renovar ahora</button>`);
  }
  const snooze = s.settings.backupSnooze && new Date(s.settings.backupSnooze).getTime() > Date.now();
  if (!snooze && backupDue(s)) {
    const last = s.settings.lastBackup;
    n('', last ? `Hace ${Math.floor((Date.now() - new Date(last).getTime()) / 864e5)} días que no guardas una copia de tus datos.` : 'Todavía no has guardado ninguna copia de tus datos. Si cambias de iPhone o iOS libera espacio, se perderían.',
      '<button class="btn sm primary" type="button" data-nt="export">Exportar copia</button><button class="btn sm" type="button" data-nt="snooze">Más tarde</button>');
  }
  if (s.sample) n('info', '<strong>Estás viendo datos de ejemplo.</strong> Importa tus extractos o conecta tus bancos y se sustituirán por los tuyos.', '<button class="btn sm" type="button" data-nt="settings">Ir a Ajustes</button>');
  $('notices').innerHTML = out.join('');
}

export function bindNotices(rerender) {
  $('notices').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-nt],[data-nt-reconn]');
    if (!b) return;
    const a = b.dataset.nt;
    if (a === 'export') exportBackup();
    else if (a === 'update' && ui.update) { ui.reloadOnUpdate = true; ui.update.postMessage({ type: 'skip-waiting' }); }
    else if (a === 'copycode') { try { await navigator.clipboard.writeText(returnedCode); toast('Código copiado.'); } catch (err) { toast('Mantén pulsado el código para copiarlo.'); } }
    else if (a === 'claim') { try { if (!(await checkClaim())) { toast('El banco todavía no ha devuelto la autorización.'); startClaimPolling(); } } catch (err) { toast(err.message); } }
    else if (a === 'cancelauth') { stopClaimPolling(); app.bank.pendingAuth = null; bankSave(); rerender(); }
    else if (a === 'snooze') { app.state.settings.backupSnooze = new Date(Date.now() + 7 * 864e5).toISOString(); save(); rerender(); }
    else if (a === 'settings') location.hash = '#ajustes';
    else if (b.dataset.ntReconn) {
      const c = app.bank.conns.find((x) => x.id === b.dataset.ntReconn);
      try {
        if (!ui.aspsps.length) await loadAspsps();
        await connectBank(ui.aspsps.find((x) => x.name === c.aspsp.name && x.country === c.aspsp.country) || c.aspsp, c.id);
      } catch (err) { toast(err.message); }
    }
  });
}
