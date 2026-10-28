// Ajustes › Bancos conectados.
import { app, bankSave, save } from '../store.js';
import { ui } from './state.js';
import { $, esc } from './dom.js';
import { hasServer } from '../api.js';
import { loadAspsps, loadFeatures, connectBank, finishWithCode, syncAll, checkClaim, startClaimPolling, GUIDE, SERVER_VERSION } from '../sync.js';
import { expired, expiresSoon, coolingDown } from '../bank.js';
import { fmtD, fmtDT, plural } from '../util.js';
import { classify } from '../classify.js';


export function renderBank() {
  const b = app.bank;
  $('bkServer').value = b.server;
  $('bkToken').value = b.token;
  let h = '';
  if (!b.server) h += `<p class="muted small">Conecta tus bancos y los movimientos llegarán solos cada vez que abras la app. Sigue la <a href="${GUIDE}" target="_blank" rel="noopener">guía para preparar el servidor</a> y rellena los ajustes de abajo.</p>`;
  else if (!b.conns.length) h += '<p class="muted small">Todavía no hay ningún banco conectado. Elige uno en «Ajustes de conexión».</p>';
  for (const c of b.conns) {
    const acc = (c.accounts || []).map((a) => a.name).filter(Boolean);
    const state = expired(c) ? '<span class="err">Permiso caducado</span>' : expiresSoon(c) ? `<span class="warn">El permiso caduca el ${fmtD(c.valid_until)}</span>` : c.valid_until ? `<span class="muted">Autorizado hasta ${fmtD(c.valid_until)}</span>` : '';
    h += `<div class="conn"><strong>${esc(c.aspsp.name)}</strong><span class="muted">${plural((c.accounts || []).length, 'cuenta', 'cuentas')}${acc.length ? ': ' + esc(acc.join(', ')) : ''}</span>${state}
      ${c.lastSync ? `<span class="muted">Sincronizado ${fmtDT(c.lastSync)}</span>` : ''}${coolingDown(c) ? `<span class="warn">En pausa hasta ${fmtDT(c.cooldownUntil)}</span>` : ''}${c.error ? `<span class="err">${esc(c.error)}</span>` : ''}
      <button class="btn sm" type="button" data-reconn="${c.id}">${expired(c) ? 'Volver a autorizar' : 'Renovar'}</button>
      <button class="btn sm" type="button" data-syncone="${c.id}"${ui.syncing || expired(c) ? ' disabled' : ''}>Sincronizar</button>
      <button class="x" type="button" data-delconn="${c.id}" aria-label="Quitar ${esc(c.aspsp.name)}">×</button></div>`;
  }
  if (ui.bankMsg) h += `<div class="conn">${ui.bankMsg}</div>`;
  $('bankStatus').innerHTML = h;
  const sel = $('bkAspsp');
  if (ui.aspsps.length && sel.options.length !== ui.aspsps.length) {
    const group = (c, label) => `<optgroup label="${label}">` + ui.aspsps.map((a, i) => (a.country === c ? `<option value="${i}">${esc(a.name)}</option>` : '')).join('') + '</optgroup>';
    sel.innerHTML = group('ES', 'España') + group('DE', 'Alemania');
  }
  $('bkAdd').hidden = !ui.aspsps.length;
}

async function saveServer() {
  app.bank.server = $('bkServer').value.trim();
  app.bank.token = $('bkToken').value.trim();
  bankSave();
  try {
    const f = await loadFeatures();
    await loadAspsps();
    ui.bankMsg = `<span class="ok">Servidor conectado: ${ui.aspsps.length} bancos disponibles.</span>` + (f.callback ? '' : ' <span class="warn">Sin el espacio KV «CG», al volver del banco tendrás que copiar un código (mira la guía).</span>');
  } catch (e) { ui.bankMsg = `<span class="err">${esc(e.message)}</span>`; }
  renderBank();
}

export function bindBank() {
  $('bkSave').addEventListener('click', saveServer);
  $('bkConnect').addEventListener('click', async () => {
    const a = ui.aspsps[+$('bkAspsp').value];
    if (!a) return;
    try { await connectBank(a); } catch (e) { ui.bankMsg = `<span class="err">${esc(e.message)}</span>`; renderBank(); }
  });
  $('bkCodeBtn').addEventListener('click', async () => {
    const code = $('bkCode').value.trim();
    if (!code) return;
    try { await finishWithCode(code); $('bkCode').value = ''; } catch (e) { ui.bankMsg = `<span class="err">${esc(e.message)}</span>`; renderBank(); }
  });
  $('bankStatus').addEventListener('click', async (e) => {
    const r = e.target.closest('[data-reconn]'), d = e.target.closest('[data-delconn]'), s = e.target.closest('[data-syncone]');
    if (r) {
      const c = app.bank.conns.find((x) => x.id === r.dataset.reconn);
      try {
        if (!ui.aspsps.length) await loadAspsps();
        const a = ui.aspsps.find((x) => x.name === c.aspsp.name && x.country === c.aspsp.country) || c.aspsp;
        await connectBank(a, c.id);
      } catch (err) { ui.bankMsg = `<span class="err">${esc(err.message)}</span>`; renderBank(); }
    }
    if (s) syncAll({ only: s.dataset.syncone, manual: true });
    if (d) {
      if (!d.dataset.sure) { d.dataset.sure = '1'; d.textContent = '¿Quitar? Pulsa otra vez'; d.className = 'btn sm danger'; return; }
      app.bank.conns = app.bank.conns.filter((c) => c.id !== d.dataset.delconn);
      bankSave();
      classify(app.state);
      save();
      app.render();
    }
  });
}

// On start and whenever the app comes back to the screen.
export async function bankWake() {
  if (!hasServer()) return;
  if (app.bank.pendingAuth && app.bank.pendingAuth.via === 'server') {
    try { if (!(await checkClaim())) startClaimPolling(); } catch (e) { /* the notice offers to retry */ }
  }
  if (!ui.aspsps.length && (!app.bank.conns.length || $('bankSetup').open)) loadAspsps().then(renderBank).catch(() => {});
  if (!ui.features) loadFeatures().then(() => { if (ui.serverVersion < SERVER_VERSION) app.render(); }).catch(() => {});
}
