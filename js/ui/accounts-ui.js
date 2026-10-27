// Ajustes › Mis cuentas.
import { app, save } from '../store.js';
import { $, esc } from './dom.js';
import { classify } from '../classify.js';
import { ACCOUNT_KINDS, makeAccount, trackedSet, guessAccount } from '../accounts.js';
import { cleanIban, maskIban, norm, plural } from '../util.js';

export function renderAccounts() {
  const s = app.state;
  const tracked = trackedSet(s.accounts, s.tx);
  const counts = {};
  for (const t of s.tx) if (t.acct) counts[t.acct] = (counts[t.acct] || 0) + 1;
  const linked = new Map();
  for (const c of app.bank.conns) for (const a of c.accounts || []) linked.set(a.acctId, c.aspsp.name);
  $('acctList').innerHTML = s.accounts.length ? s.accounts.map((a) => `<div class="acct"><span><strong>${esc(a.name)}</strong> <span class="muted">· ${ACCOUNT_KINDS[a.kind] || a.kind}${a.iban ? ' · ' + maskIban(a.iban) : ''}</span></span>
      <span class="tools"><button class="btn sm" type="button" data-editacct="${a.id}">Editar</button>${linked.has(a.id) ? '' : `<button class="x" type="button" data-delacct="${a.id}" aria-label="Quitar ${esc(a.name)}">×</button>`}</span>
      <span class="meta">${counts[a.id] ? plural(counts[a.id], 'movimiento', 'movimientos') + ' en la app' : 'Sin movimientos en la app'}${linked.has(a.id) ? ' · sincronizada con ' + esc(linked.get(a.id)) : ''}
      · ${tracked.has(a.id) ? 'lo que le envías cuenta como traspaso' : a.kind === 'broker' ? 'lo que le envías cuenta como inversión' : a.kind === 'tarjeta' ? 'su pago mensual cuenta como gasto' : 'lo que le envías cuenta como traspaso'}${a.aliases && a.aliases.length ? ' · se reconoce por «' + esc(a.aliases.join('», «')) + '»' : ''}</span></div>`).join('')
    : '<p class="muted small">Añade aquí tus cuentas, tarjetas y brókers. Las de los bancos conectados aparecen solas. Así un traspaso entre ellas, o el pago mensual de la tarjeta, no cuenta dos veces.</p>';
  $('owners').value = (s.settings.owners || []).join(', ');
}

function fill(a) {
  $('acId').value = a ? a.id : '';
  $('acName').value = a ? a.name : '';
  $('acKind').value = a ? a.kind : 'banco';
  $('acIban').value = a ? a.iban || '' : '';
  $('acAliases').value = a ? (a.aliases || []).join(', ') : '';
  $('acTrack').value = a ? a.track || 'auto' : 'auto';
  $('acSubmit').textContent = a ? 'Guardar cambios' : 'Guardar cuenta';
  $('acCancel').hidden = !a;
}

export function bindAccounts() {
  $('acName').addEventListener('change', () => {
    if ($('acId').value || $('acAliases').value) return;
    const g = guessAccount($('acName').value);
    $('acKind').value = g.kind;
    $('acAliases').value = g.aliases.join(', ');
  });
  $('acctForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const s = app.state, id = $('acId').value;
    const d = { name: $('acName').value.trim(), kind: $('acKind').value, iban: cleanIban($('acIban').value), aliases: $('acAliases').value.split(',').map(norm).filter(Boolean), track: $('acTrack').value };
    const ex = s.accounts.find((a) => a.id === id);
    if (ex) Object.assign(ex, d); else s.accounts.push(makeAccount(d));
    fill(null);
    $('acctAdd').open = false;
    classify(s);
    save();
    app.render();
  });
  $('acCancel').addEventListener('click', () => fill(null));
  $('acctList').addEventListener('click', (e) => {
    const ed = e.target.closest('[data-editacct]'), dl = e.target.closest('[data-delacct]');
    const s = app.state;
    if (ed) { fill(s.accounts.find((a) => a.id === ed.dataset.editacct)); $('acctAdd').open = true; $('acName').focus(); }
    if (dl) {
      if (!dl.dataset.sure) { dl.dataset.sure = '1'; dl.textContent = '¿Quitar?'; dl.className = 'btn sm danger'; return; }
      s.accounts = s.accounts.filter((a) => a.id !== dl.dataset.delacct);
      for (const t of s.tx) if (t.acct === dl.dataset.delacct) delete t.acct;
      for (const f of s.files) if (f.acct === dl.dataset.delacct) f.acct = null;
      classify(s);
      save();
      app.render();
    }
  });
  $('ownerForm').addEventListener('submit', (e) => {
    e.preventDefault();
    app.state.settings.owners = $('owners').value.split(',').map((x) => x.trim()).filter(Boolean);
    classify(app.state);
    save();
    app.render();
  });
}
