// Ajustes › Copia de seguridad › Copia cifrada en tu servidor: choosing the passphrase, saving and getting the copy back,
// and the copy of each day, made when you open the app.
import { app, save, bankSave } from '../store.js';
import { ui } from './state.js';
import { $, esc, toast } from './dom.js';
import { api, hasServer } from '../api.js';
import { loadFeatures, GUIDE } from '../sync.js';
import { exportData, validateBackup } from '../backup.js';
import { deriveKey, seal, unseal, checkBlob, newSalt, passProblem, sameKey } from '../vault.js';
import { getKey, putKey, delKey } from '../keystore.js';
import { renderBackup } from './backup-ui.js';
import { fmtDT } from '../util.js';

const KEY = 'vault';
const DAY = 20 * 3600e3; // once a day, give or take the time you open the app
const RETRY = 3600e3;
const AUTO_LABEL = 'Guardar una copia cada día al abrir la app';
const conf = () => app.bank.vault || (app.bank.vault = { auto: false, last: null, n: 0, size: 0, error: null, tried: null, paused: false });
const kb = (n) => (n < 1e6 ? Math.max(1, Math.round(n / 1024)) + ' KB' : (n / 1048576).toFixed(1).replace('.', ',') + ' MB');

// The server took the copy: what it covers and when, for the next automatic one.
async function upload(k) {
  const st = app.state, blob = await seal(exportData(st, app.bank), k);
  const r = await api('/backup', { method: 'PUT', body: blob, timeout: 60000 });
  Object.assign(conf(), { last: blob.at, n: st.tx.length, size: r.size || 0, error: null, paused: false });
  bankSave();
  st.settings.lastBackup = blob.at;
  save();
}

function form() {
  const s = ui.vault, setup = s.mode === 'setup' || (!s.has && s.mode !== 'open');
  if (s.mode === 'open') {
    return `<form class="form" id="vaultOpen">
      <p class="small">Hay una copia del ${fmtDT(s.blob.at)} en tu servidor. Escribe la frase con la que se cifró.</p>
      <label for="vaultOpenPass">Frase de la copia</label><input type="password" id="vaultOpenPass" autocomplete="current-password" required>
      <div class="tools"><button class="btn primary" type="submit"${s.busy ? ' disabled' : ''}>Abrir la copia</button><button class="btn" type="button" id="vaultCancel">Cancelar</button></div>
    </form>`;
  }
  if (setup) {
    return `<form class="form" id="vaultForm">
      <p class="muted small">La copia se cifra en este iPhone con una frase que solo sabes tú, y el servidor guarda algo que no puede leer. Si olvidas la frase, nadie podrá abrir la copia: guárdala en el llavero o apúntala en un sitio seguro.</p>
      <label for="vaultPass">${s.has ? 'Nueva frase' : 'Frase para cifrar'}</label><input type="password" id="vaultPass" autocomplete="new-password" required>
      <label for="vaultPass2">Repítela</label><input type="password" id="vaultPass2" autocomplete="new-password" required>
      <label class="check"><input type="checkbox" id="vaultAutoNew"${!s.has || conf().auto ? ' checked' : ''}> ${AUTO_LABEL}</label>
      <div class="tools"><button class="btn primary" type="submit"${s.busy ? ' disabled' : ''}>Cifrar y guardar</button>${s.has
        ? '<button class="btn" type="button" id="vaultCancel">Cancelar</button>' : '<button class="btn" type="button" id="vaultGet">Ya tengo una copia: recuperarla</button>'}</div>
    </form>`;
  }
  const b = conf();
  return `<p class="small">${b.last ? `Última copia en el servidor: ${fmtDT(b.last)}${b.size ? ' (' + kb(b.size) + ')' : ''}.` : 'Todavía no hay ninguna copia en el servidor.'}</p>`
    + (b.paused ? `<p class="warn small">La copia diaria está en pausa: ahora hay muchos menos movimientos que en la última copia (${b.n}). Si es lo que quieres, pulsa «Guardar ahora».</p>` : '')
    + (b.error ? `<p class="err small">La última copia automática falló: ${esc(b.error)}</p>` : '')
    + `<label class="check"><input type="checkbox" id="vaultAuto"${b.auto ? ' checked' : ''}> ${AUTO_LABEL}</label>
    <div class="tools" style="margin-top:8px"><button class="btn primary" type="button" id="vaultSave"${s.busy ? ' disabled' : ''}>Guardar ahora</button><button class="btn" type="button" id="vaultGet"${s.busy ? ' disabled' : ''}>Recuperar del servidor</button></div>
    <div class="tools"><button class="btn link" type="button" id="vaultChange">Cambiar la frase</button><button class="btn link" type="button" id="vaultForget">Dejar de usarla en este iPhone</button></div>`;
}

function draw() {
  const s = ui.vault;
  $('vaultBody').innerHTML = form() + `<p class="small" id="vaultMsg" aria-live="polite">${s.busy ? `<span class="muted">${esc(s.busy)}</span>` : s.msg}</p>`;
}

let checking = false;
export function renderVault() {
  const box = $('vaultBody');
  if (!hasServer()) {
    box.innerHTML = '<p class="muted small">Si conectas tu servidor (en «Bancos»), la app puede guardar allí cada día una copia cifrada con una frase que solo sabes tú, para no perder nada si cambias de iPhone.</p>';
    return;
  }
  if (ui.features && !ui.features.backup) {
    box.innerHTML = `<p class="muted small">Tu servidor todavía no puede guardar copias: actualízalo y añádele el espacio KV «CG», como explica la <a href="${GUIDE}#copia-cifrada" target="_blank" rel="noopener">guía</a>.</p>`;
    return;
  }
  if (ui.vault.has === null) {
    if (!checking) { checking = true; getKey(KEY).then((k) => { ui.vault.has = !!(k && k.key); checking = false; renderVault(); }); }
    box.innerHTML = '';
    return;
  }
  // Not while you are typing a passphrase: it would be lost.
  const a = document.activeElement;
  if (a && a.type === 'password' && box.contains(a)) return;
  draw();
}

const busy = (text) => { ui.vault.busy = text; ui.vault.msg = ''; draw(); };
function done(msg) {
  ui.vault.busy = '';
  ui.vault.msg = msg || '';
  draw();
}
const fail = (e) => done(`<span class="err">${esc(e.message || String(e))}</span>`);
// A message under the form that keeps what you typed.
const say = (msg) => { ui.vault.msg = msg; $('vaultMsg').innerHTML = msg; };

// A copy opened with its key: the usual check and «Restaurar», as with a file.
function opened(obj) {
  ui.restore = validateBackup(obj);
  Object.assign(ui.vault, { mode: null, blob: null });
  done();
  renderBackup();
  $('restoreBox').scrollIntoView({ block: 'nearest' });
}

async function getCopy() {
  busy('Descargando la copia…');
  try {
    const blob = checkBlob(await api('/backup', { timeout: 60000 }));
    const k = await getKey(KEY);
    if (sameKey(k, blob)) { opened(await unseal(blob, k)); return; }
    Object.assign(ui.vault, { mode: 'open', blob });
    done();
    $('vaultOpenPass').focus();
  } catch (e) { fail(e); }
}

export function bindVault() {
  const box = $('vaultBody');
  box.addEventListener('click', async (e) => {
    const id = e.target.id, s = ui.vault;
    if (s.busy) return;
    if (id === 'vaultGet') getCopy();
    else if (id === 'vaultCancel') { Object.assign(s, { mode: null, blob: null, msg: '' }); draw(); }
    else if (id === 'vaultChange') { s.mode = 'setup'; s.msg = ''; draw(); $('vaultPass').focus(); }
    else if (id === 'vaultForget') {
      await delKey(KEY);
      delete app.bank.vault;
      bankSave();
      Object.assign(s, { has: false, mode: null, msg: '<span class="muted">Este iPhone ya no guarda copias cifradas. La última sigue en tu servidor.</span>' });
      draw();
    } else if (id === 'vaultSave') {
      busy('Cifrando y guardando…');
      try {
        const k = await getKey(KEY);
        if (!k || !k.key) { s.has = false; done('<span class="err">Este iPhone ya no tiene la frase: vuelve a escribirla.</span>'); return; }
        await upload(k);
        done('<span class="ok">Copia guardada en tu servidor.</span>');
        renderBackup();
      } catch (err) { fail(err); }
    }
  });
  box.addEventListener('change', (e) => {
    if (e.target.id !== 'vaultAuto') return;
    conf().auto = e.target.checked;
    bankSave();
  });
  box.addEventListener('submit', async (e) => {
    e.preventDefault();
    const s = ui.vault;
    if (s.busy) return;
    if (e.target.id === 'vaultForm') {
      const pass = $('vaultPass').value, problem = passProblem(pass, $('vaultPass2').value), auto = $('vaultAutoNew').checked;
      if (problem) { say(`<span class="err">${esc(problem)}</span>`); return; }
      // A new iPhone without your data would replace the good copy: get that one back first.
      if (app.state.sample || !app.state.tx.length) { say('<span class="err">Este iPhone todavía no tiene datos que guardar. Si ya tienes una copia en el servidor, recupérala.</span>'); return; }
      busy('Cifrando y guardando…');
      try {
        const k = await deriveKey(pass, newSalt());
        await upload(k);
        await putKey(KEY, k);
        conf().auto = auto;
        bankSave();
        Object.assign(s, { has: true, mode: null });
        done('<span class="ok">Copia cifrada guardada en tu servidor.</span>');
        renderBackup();
        toast(auto ? 'Copia cifrada guardada. Desde hoy se guarda una al día.' : 'Copia cifrada guardada.');
      } catch (err) { fail(err); }
    } else if (e.target.id === 'vaultOpen') {
      const pass = $('vaultOpenPass').value;
      busy('Abriendo la copia…');
      try {
        const k = await deriveKey(pass, s.blob.salt, s.blob.iter);
        const obj = await unseal(s.blob, k);
        // The passphrase was right: keep its key so the copies of each day go on from this iPhone.
        await putKey(KEY, k).then(() => { s.has = true; }).catch(() => {});
        Object.assign(conf(), { auto: true, last: s.blob.at, n: obj.state && Array.isArray(obj.state.tx) ? obj.state.tx.length : 0, size: 0, error: null, paused: false });
        bankSave();
        opened(obj);
      } catch (err) { fail(err); }
    }
  });
}

// The copy of the day, when the app opens (after the banks have synced).
let running = false;
export async function autoVault() {
  const b = app.bank.vault;
  if (running || !b || !b.auto || !hasServer() || app.state.sample || !app.state.tx.length) return;
  const now = Date.now();
  if ((b.last && now - Date.parse(b.last) < DAY) || (b.tried && now - Date.parse(b.tried) < RETRY)) return;
  // Far fewer movements than in the last copy: something may have gone wrong here, so it waits for you.
  if (b.n && app.state.tx.length < b.n / 2) { if (!b.paused) { b.paused = true; bankSave(); } return; }
  running = true;
  try {
    if (!ui.features) await loadFeatures().catch(() => {});
    if (ui.features && !ui.features.backup) return;
    const k = await getKey(KEY);
    if (!k || !k.key) return;
    b.tried = new Date().toISOString();
    await upload(k);
  } catch (e) {
    b.error = e.message;
    bankSave();
  } finally {
    running = false;
    if (ui.tab === 'ajustes') { renderBackup(); renderVault(); }
  }
}
