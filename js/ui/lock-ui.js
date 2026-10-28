// The lock screen, and Ajustes › Bloqueo con Face ID.
import { ui } from './state.js';
import { $, esc, toast } from './dom.js';
import { lockConf, lockAvailable, enableLock, renewCode, disableLock, verify, checkCode, relockMs, setRelock, RELOCK_CHOICES } from '../lock.js';

const root = document.documentElement;
const isLocked = () => root.classList.contains('locked');
const HINT = 'Toca la pantalla para usar Face ID.';
let asking = false, hiddenAt = 0, retry = false;

function unlock() {
  root.classList.remove('locked');
  $('lockMsg').textContent = HINT;
  $('lockCode').value = '';
  $('lockAlt').open = false;
}

// auto: on opening or coming back, without a tap. Safari refuses it while the app is not yet in front (just
// opened, or coming back from the app switcher): then it is tried again as soon as it is, and a tap anywhere asks too.
async function ask(auto) {
  if (asking || !isLocked()) return;
  if (auto && (document.visibilityState !== 'visible' || !document.hasFocus())) { retry = true; return; }
  asking = true; retry = false;
  $('lockMsg').textContent = '';
  try {
    if (await verify()) unlock();
    else $('lockMsg').textContent = 'No se ha podido comprobar que eras tú.';
  } catch (e) {
    if (auto) { if (e && e.name === 'NotAllowedError') retry = true; $('lockMsg').textContent = HINT; }
    else $('lockMsg').textContent = e && e.name === 'NotAllowedError' ? 'Cancelado. Toca la pantalla para intentarlo otra vez.' : 'No ha funcionado: ' + (e.message || e.name);
  } finally { asking = false; }
}
const again = () => { if (retry && isLocked()) ask(true); };

export function bindLock() {
  $('lockBtn').addEventListener('click', () => ask(false));
  // Anywhere on the lock screen but the recovery code: Face ID.
  $('lockScreen').addEventListener('click', (e) => { if (e.target.id !== 'lockBtn' && !e.target.closest('#lockAlt')) ask(false); });
  window.addEventListener('focus', again);
  window.addEventListener('pageshow', again);
  $('lockCodeForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (await checkCode($('lockCode').value)) {
      unlock();
      toast('Has entrado con el código de recuperación. Si Face ID ya no funciona, vuelve a activar el bloqueo en Ajustes.');
    } else $('lockMsg').textContent = 'Ese código no es el correcto.';
  });
  // Away from the app: hidden at once (also in the app switcher), and Face ID again after the time chosen in Ajustes.
  document.addEventListener('visibilitychange', () => {
    const c = lockConf();
    if (!c || !c.on) return;
    if (document.visibilityState === 'hidden') {
      if (!isLocked()) { hiddenAt = Date.now(); root.classList.add('locked'); }
    } else if (hiddenAt && Date.now() - hiddenAt < relockMs()) { hiddenAt = 0; unlock(); }
    else { hiddenAt = 0; ask(true); }
  });
  if (isLocked()) ask(true);
}

let avail = null;
export function renderLockSettings() {
  const box = $('lockBody');
  if (avail === null) { avail = 'checking'; lockAvailable().then((a) => { avail = a; renderLockSettings(); }); }
  if (avail === 'checking') { box.innerHTML = ''; return; }
  const c = lockConf(), on = !!(c && c.on);
  if (!avail && !on) { box.innerHTML = '<p class="muted small">Este dispositivo no deja que una web use Face ID, Touch ID ni su código.</p>'; return; }
  const mins = Math.round(relockMs() / 60e3), after = (m) => (m === 60 ? 'una hora' : m === 1 ? 'un minuto' : m + ' minutos');
  let h = on ? `<p class="small">Activado: la app pide Face ID al abrirla y al volver a ella después de ${after(mins)}.</p>
      <label class="small" for="lockRelock">Volver a pedirlo si sales de la app más de</label>
      <select id="lockRelock">${RELOCK_CHOICES.map((m) => `<option value="${m}"${m === mins ? ' selected' : ''}>${after(m)}</option>`).join('')}</select>`
    : '<p class="muted small">La app pedirá Face ID (o el código del iPhone) al abrirla y al volver a ella después de un minuto, para que nadie la abra si coge tu iPhone desbloqueado.</p>';
  if (ui.lockCode) {
    h += `<div class="notice"><span>Tu código de recuperación es <strong class="num" style="white-space:nowrap">${esc(ui.lockCode)}</strong>. Guárdalo en un sitio seguro: con él puedes entrar si Face ID deja de funcionar.</span>
      <span class="tools"><button class="btn sm" type="button" id="lockCopy">Copiar</button><button class="btn sm" type="button" id="lockCodeDone">Ya lo he guardado</button></span></div>`;
  }
  h += '<div class="tools" style="margin-top:8px">' + (on ? '<button class="btn" type="button" id="lockOff">Desactivar</button><button class="btn" type="button" id="lockRenew">Nuevo código de recuperación</button>'
    : '<button class="btn primary" type="button" id="lockOn">Activar el bloqueo</button>') + '</div><p class="small" id="lockSetMsg"></p>';
  box.innerHTML = h;
}

export function bindLockSettings() {
  $('lockBody').addEventListener('change', (e) => {
    if (e.target.id !== 'lockRelock') return;
    setRelock(+e.target.value);
    renderLockSettings();
    toast('Guardado.');
  });
  $('lockBody').addEventListener('click', async (e) => {
    const id = e.target.id;
    try {
      if (id === 'lockOn') { ui.lockCode = await enableLock(); renderLockSettings(); toast('Bloqueo activado.'); }
      else if (id === 'lockOff') { disableLock(); ui.lockCode = null; renderLockSettings(); toast('Bloqueo desactivado.'); }
      else if (id === 'lockRenew') { ui.lockCode = await renewCode(); renderLockSettings(); }
      else if (id === 'lockCodeDone') { ui.lockCode = null; renderLockSettings(); }
      else if (id === 'lockCopy') { await navigator.clipboard.writeText(ui.lockCode); toast('Código copiado.'); }
    } catch (err) {
      $('lockSetMsg').innerHTML = `<span class="err">${esc(err && err.name === 'NotAllowedError' ? 'Cancelado o no permitido.' : 'No ha funcionado: ' + (err.message || err.name))}</span>`;
    }
  });
}
