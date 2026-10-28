// Ajustes › Avisos en el iPhone: turning them on (the iPhone's permission and your server), what to be told about,
// a test, and keeping the server up to date after each sync.
import { app, bankSave } from '../store.js';
import { ui } from './state.js';
import { $, esc, toast } from './dom.js';
import { api, hasServer } from '../api.js';
import { GUIDE, loadFeatures } from '../sync.js';
import { pushPayload, payloadHash, PUSH_DEFAULTS } from '../push.js';
import { unb64u } from '../vault.js';
import { parseNum } from '../parse/numbers.js';
import { fmtDT } from '../util.js';

const supported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
const standalone = () => navigator.standalone === true || (!!window.matchMedia && matchMedia('(display-mode: standalone)').matches);
const isIOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const conf = () => app.bank.push || (app.bank.push = {});
const prefsOf = () => Object.assign({}, PUSH_DEFAULTS, conf().prefs || {});

function ready() {
  return Promise.race([navigator.serviceWorker.ready, new Promise((_, reject) => setTimeout(() => reject(new Error('La app todavía no está instalada del todo: ciérrala, vuelve a abrirla y prueba otra vez.')), 10000))]);
}

async function send(sub) {
  const p = pushPayload(app.state, app.bank, prefsOf());
  const r = await api('/push/subscribe', { body: { sub: sub.toJSON(), ...p } });
  Object.assign(conf(), { id: r.id, hash: payloadHash(p), at: new Date().toISOString(), error: null });
  bankSave();
}

const sameKey = (a, b) => !!a && a.byteLength === b.byteLength && new Uint8Array(a).every((x, i) => x === b[i]);

async function enable() {
  if (Notification.permission !== 'granted' && (await Notification.requestPermission()) !== 'granted') {
    throw new Error('Sin tu permiso no te pueden llegar avisos. Puedes darlo en Ajustes del iPhone › Notificaciones › Gastos.');
  }
  const reg = await ready();
  const key = unb64u((await api('/push/key')).key);
  let sub = await reg.pushManager.getSubscription();
  if (sub && !sameKey(sub.options && sub.options.applicationServerKey, key)) { await sub.unsubscribe(); sub = null; } // made for another server
  sub = sub || await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
  await send(sub);
}

async function disable() {
  const c = conf();
  try { if (c.id) await api('/push/unsubscribe', { body: { id: c.id } }); } catch (e) { /* the server may not have it any more */ }
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    const sub = reg && await reg.pushManager.getSubscription();
    if (sub) await sub.unsubscribe();
  } catch (e) { /* already gone */ }
  app.bank.push = { prefs: prefsOf() };
  bankSave();
}

// After a sync, a change of budgets or of what to be told about: the server gets the new picture if it changed.
export async function refreshPush(force = false) {
  const c = app.bank.push;
  if (!c || !c.id || !hasServer() || !supported() || Notification.permission !== 'granted') return;
  const p = pushPayload(app.state, app.bank, prefsOf());
  if (!force && payloadHash(p) === c.hash) return;
  try {
    const sub = await (await ready()).pushManager.getSubscription();
    if (!sub) { Object.assign(c, { id: null, error: 'El iPhone ha retirado la suscripción a los avisos: vuelve a activarlos.' }); bankSave(); return; }
    await send(sub);
  } catch (e) { c.error = e.message; bankSave(); }
}

let loading = false;
export function renderPush() {
  const box = $('pushBody');
  if (document.activeElement && document.activeElement.id === 'puBig') return; // typing the amount
  const c = app.bank.push || {}, on = !!c.id, p = prefsOf();
  if (hasServer() && !ui.features && !loading) { loading = true; loadFeatures().then(() => renderPush(), () => {}).finally(() => { loading = false; }); }
  let h;
  if (!hasServer()) h = '<p class="muted small">Con tu servidor conectado (en «Bancos»), el iPhone te avisa de gastos grandes, presupuestos superados y permisos de bancos a punto de caducar, aunque no abras la app.</p>';
  else if (ui.features && !ui.features.push) h = `<p class="muted small">Tu servidor todavía no puede enviar avisos: actualízalo y añádele el espacio KV «CG» y el repaso programado, como explica la <a href="${GUIDE}#avisos-en-el-iphone" target="_blank" rel="noopener">guía</a>.</p>`;
  else if (!supported() && isIOS() && !standalone()) h = '<p class="muted small">En el iPhone, los avisos solo funcionan con la app en la pantalla de inicio: en Safari, pulsa Compartir › «Añadir a pantalla de inicio» y ábrela desde ahí.</p>';
  else if (!supported()) h = '<p class="muted small">Este navegador no admite avisos.</p>';
  else if (Notification.permission === 'denied') h = '<p class="muted small">Los avisos de esta app están bloqueados. Actívalos en Ajustes del iPhone › Notificaciones › Gastos y vuelve aquí.</p>';
  else {
    h = `<p class="${on ? '' : 'muted '}small">${on ? 'Activados. Tu servidor mira tus bancos tres veces al día y te avisa de:' : 'Tu servidor mira tus bancos tres veces al día, aunque no abras la app, y puede avisarte de:'}</p>
      <form class="form push-form" id="pushForm">
        <div class="push-big"><label class="check" for="puBigOn"><input type="checkbox" id="puBigOn"${p.big > 0 ? ' checked' : ''}> Un gasto de</label><input type="text" id="puBig" inputmode="decimal" value="${p.big > 0 ? String(p.big).replace('.', ',') : '100'}" aria-label="Importe del gasto"><span>€ o más</span></div>
        <label class="check"><input type="checkbox" id="puBudget"${p.budget ? ' checked' : ''}> Un presupuesto superado</label>
        <label class="check"><input type="checkbox" id="puExpiry"${p.expiry ? ' checked' : ''}> El permiso de un banco a punto de caducar</label>
      </form>
      <div class="tools" style="margin-top:8px">${on ? '<button class="btn" type="button" id="pushTest">Enviar un aviso de prueba</button><button class="btn" type="button" id="pushOff">Desactivar</button>'
        : '<button class="btn primary" type="button" id="pushOn">Activar los avisos</button>'}</div>`;
    if (on) h += `<p class="muted small">${ui.cron ? 'Último repaso del servidor: ' + fmtDT(ui.cron) + '.' : 'Tu servidor todavía no ha hecho ningún repaso. Si en unas horas sigue así, revisa que tenga el repaso programado (Cron Trigger) de la guía.'}</p>`;
    if (c.error) h += `<p class="err small">${esc(c.error)}</p>`;
  }
  box.innerHTML = h + '<p class="small" id="pushMsg" aria-live="polite"></p>';
}

function savePrefs() {
  const big = parseNum($('puBig').value);
  conf().prefs = { big: $('puBigOn').checked && big > 0 ? Math.round(big) : 0, budget: $('puBudget').checked, expiry: $('puExpiry').checked };
  bankSave();
}

export function bindPush() {
  const box = $('pushBody');
  box.addEventListener('click', async (e) => {
    const b = e.target, id = b.id;
    if (!['pushOn', 'pushOff', 'pushTest'].includes(id)) return;
    b.disabled = true;
    try {
      if (id === 'pushOn') { savePrefs(); await enable(); renderPush(); toast('Avisos activados.'); }
      else if (id === 'pushOff') { await disable(); renderPush(); toast('Avisos desactivados.'); }
      else { await api('/push/test', { body: { id: conf().id } }); $('pushMsg').innerHTML = '<span class="ok">Enviado: te llegará en unos segundos.</span>'; }
    } catch (err) {
      if (id === 'pushTest' && (err.status === 404 || err.status === 410)) { conf().id = null; bankSave(); renderPush(); }
      $('pushMsg').innerHTML = `<span class="err">${esc(err.message)}</span>`;
    } finally { b.disabled = false; }
  });
  box.addEventListener('change', () => {
    savePrefs();
    if (conf().id) refreshPush(true).then(() => renderPush());
  });
  box.addEventListener('submit', (e) => e.preventDefault());
}
