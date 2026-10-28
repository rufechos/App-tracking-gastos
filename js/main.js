// Start-up, tabs and drawing. Each screen lives in js/ui/; the logic it uses, in js/.
import { app, load, loadSample, bankLoad } from './store.js';
import { ui } from './ui/state.js';
import { $ } from './ui/dom.js';
import { loadChart } from './lazy.js';
import { invalidate } from './ui/summary.js';
import { renderHome, bindHome } from './ui/home.js';
import { renderMoves, bindMoves } from './ui/moves.js';
import { renderAnalysis, bindAnalysis } from './ui/analysis.js';
import { renderInv, bindInv, maybeAutoQuotes } from './ui/invest-ui.js';
import { renderImport, bindImport } from './ui/import-ui.js';
import { renderBank, bindBank, bankWake } from './ui/bank-ui.js';
import { renderAccounts, bindAccounts } from './ui/accounts-ui.js';
import { renderCats, bindCats } from './ui/cats-ui.js';
import { renderBackup, bindBackup } from './ui/backup-ui.js';
import { renderVault, bindVault, autoVault } from './ui/vault-ui.js';
import { bindLock, renderLockSettings, bindLockSettings } from './ui/lock-ui.js';
import { renderPush, bindPush, refreshPush } from './ui/push-ui.js';
import { renderBudgetSettings, bindBudgets } from './ui/budgets-ui.js';
import { renderPayday, bindPayday } from './ui/payday-ui.js';
import { renderWorth, bindWorth } from './ui/worth-ui.js';
import { renderNotices, bindNotices, setReturnedCode } from './ui/notices.js';
import { bindReview, reviewCount, resetReviewView } from './ui/review-ui.js';
import { bindPeriod } from './ui/period-ui.js';
import { syncAll, maybeAutoSync, handleReturn } from './sync.js';
import { fmtDT } from './util.js';

const TABS = ['inicio', 'movimientos', 'analisis', 'inversiones', 'ajustes'];
const VIEWS = {
  inicio: renderHome,
  movimientos: renderMoves,
  analisis: renderAnalysis,
  inversiones: () => { renderWorth(); renderInv(); },
  ajustes: () => { renderImport(); renderBank(); renderAccounts(); renderCats(); renderPayday(); renderBudgetSettings(); renderPush(); renderLockSettings(); renderBackup(); renderVault(); },
};

function renderHeader() {
  const b = app.bank;
  $('syncBtn').hidden = !b.conns.length;
  $('syncBtn').disabled = ui.syncing;
  $('syncBtn').textContent = ui.syncing ? 'Sincronizando…' : 'Sincronizar';
  const last = b.conns.map((c) => c.lastSync).filter(Boolean).sort().pop();
  $('syncLine').textContent = ui.syncing ? '' : last ? 'Actualizado ' + fmtDT(last) : '';
  const n = reviewCount();
  $('tabBadge').hidden = !n;
  $('tabBadge').textContent = n > 99 ? '99+' : String(n);
  try { if (navigator.setAppBadge) { if (n) navigator.setAppBadge(n); else navigator.clearAppBadge(); } } catch (e) { /* not available */ }
}

function renderAll() {
  invalidate();
  renderHeader();
  renderNotices();
  for (const t of TABS) $('view-' + t).hidden = t !== ui.tab;
  document.querySelectorAll('.tab').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === ui.tab)));
  VIEWS[ui.tab]();
  if (ui.scrollTo) { const el = $(ui.scrollTo); ui.scrollTo = null; if (el) el.scrollIntoView(); }
}
app.render = renderAll;
app.onSaveError = () => renderNotices();

function route() {
  const t = (location.hash || '').slice(1);
  const next = TABS.includes(t) ? t : 'inicio';
  if (next !== ui.tab) { ui.tab = next; ui.pending = null; resetReviewView(); window.scrollTo(0, 0); }
  renderAll();
}

function bindTabs() {
  document.querySelector('.tabs').addEventListener('click', (e) => {
    const b = e.target.closest('[data-tab]');
    if (b) location.hash = '#' + b.dataset.tab;
  });
  window.addEventListener('hashchange', route);
}

function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (ui.reloadOnUpdate) location.reload(); });
  // A tapped notification: the screen it is about.
  navigator.serviceWorker.addEventListener('message', (e) => { if (e.data && e.data.type === 'open' && /^#\w+$/.test(e.data.hash || '')) location.hash = e.data.hash; });
  navigator.serviceWorker.register('sw.js').then((reg) => {
    const offer = (w) => { if (w && navigator.serviceWorker.controller) { ui.update = w; renderNotices(); } };
    if (reg.waiting) offer(reg.waiting);
    reg.addEventListener('updatefound', () => {
      const w = reg.installing;
      if (w) w.addEventListener('statechange', () => { if (w.state === 'installed') offer(w); });
    });
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') reg.update().catch(() => {}); });
  }).catch(() => {});
}

async function boot() {
  bindLock();
  if (!load()) loadSample();
  bankLoad();
  if (app.state.sample && app.state.tx.length && !app.state.tx.some((t) => t.date.startsWith(ui.period.m))) {
    ui.period = { kind: 'month', m: app.state.tx.map((t) => t.date.slice(0, 7)).sort().pop() };
  }
  bindTabs(); bindHome(); bindMoves(); bindAnalysis(); bindInv(); bindWorth(); bindImport(); bindBank(); bindAccounts(); bindCats(); bindPayday(); bindBudgets(); bindBackup(); bindVault(); bindLockSettings(); bindPush();
  bindNotices(renderAll); bindReview(renderAll);
  bindPeriod((changed) => renderAll(changed));
  $('syncBtn').addEventListener('click', () => syncAll({ manual: true }).then(() => refreshPush()));
  try { matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => renderAll()); } catch (e) { /* old Safari */ }
  route();
  const ret = await handleReturn();
  if (ret && ret.code) { setReturnedCode(ret.code); $('bankSetup').open = true; $('bkCode').value = ret.code; }
  renderAll();
  loadChart().then(() => renderAll()).catch(() => {});
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { if (window.Chart) renderAll(); });
  await bankWake();
  const afterSync = () => Promise.resolve(maybeAutoSync()).then(autoVault).then(() => refreshPush());
  afterSync();
  maybeAutoQuotes();
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    bankWake().then(() => { afterSync(); maybeAutoQuotes(); });
  });
  registerServiceWorker();
  showVersion();
}

// The version (the service worker's cache name) at the bottom of Ajustes, to know which one you are running.
function showVersion() {
  if (!window.caches) return;
  caches.keys().then((ks) => { const k = ks.find((x) => x.startsWith('cg-app-')); if (k) $('appVersion').textContent = 'Versión ' + k.slice(7) + '.'; }).catch(() => {});
}

// For the automated tests.
window.__cg = { state: () => app.state, bank: () => app.bank, ui };
window.__cg.ready = boot();
