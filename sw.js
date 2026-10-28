// Offline support. The app's files are served from the cache straight away (a fast start with poor coverage);
// when this file changes, the new version is downloaded in the background and the app offers to reload.
const VERSION = '75e499faab22'; // tools/stamp-sw.mjs writes a hash of the files below
const LIBS_VERSION = 'e4d1d4f0c255'; // the same, for vendor/ only: the big libraries are kept across app updates
const APP_CACHE = 'cg-app-' + VERSION;
const LIBS_CACHE = 'cg-libs-' + LIBS_VERSION;
const CORE = [
  './', 'index.html', 'manifest.webmanifest', 'css/app.css', 'apple-touch-icon.png', 'icon-192.png', 'icon-512.png', 'icon-512-maskable.png',
  'fonts/ibm-plex-sans-latin-400-normal.woff2', 'fonts/ibm-plex-sans-latin-500-normal.woff2', 'fonts/ibm-plex-sans-latin-600-normal.woff2',
  'fonts/ibm-plex-mono-latin-400-normal.woff2', 'fonts/ibm-plex-mono-latin-500-normal.woff2',
  'fonts/bricolage-grotesque-latin-500-normal.woff2', 'fonts/bricolage-grotesque-latin-700-normal.woff2',
  'js/main.js', 'js/util.js', 'js/store.js', 'js/migrate.js', 'js/sample.js', 'js/categories.js', 'js/classify.js', 'js/accounts.js',
  'js/dedup.js', 'js/refunds.js', 'js/import.js', 'js/review.js', 'js/bank.js', 'js/api.js', 'js/sync.js', 'js/backup.js',
  'js/invest.js', 'js/xirr.js', 'js/period.js', 'js/aggregate.js', 'js/lazy.js', 'js/budgets.js', 'js/recurring.js', 'js/insights.js', 'js/worth.js', 'js/rules.js', 'js/vault.js', 'js/keystore.js', 'js/lock.js', 'js/lock-boot.js', 'js/push.js',
  'js/parse/numbers.js', 'js/parse/csv.js', 'js/parse/tabular.js', 'js/parse/pdf-statement.js', 'js/parse/positions.js', 'js/parse/files.js', 'js/parse/xlsx-worker.js',
  'js/ui/dom.js', 'js/ui/state.js', 'js/ui/cats.js', 'js/ui/charts.js', 'js/ui/period-ui.js', 'js/ui/review-ui.js', 'js/ui/learn.js', 'js/ui/summary.js',
  'js/ui/home.js', 'js/ui/analysis.js', 'js/ui/moves.js', 'js/ui/invest-ui.js', 'js/ui/import-ui.js', 'js/ui/bank-ui.js', 'js/ui/accounts-ui.js',
  'js/ui/cats-ui.js', 'js/ui/backup-ui.js', 'js/ui/notices.js', 'js/ui/budgets-ui.js', 'js/ui/payday-ui.js', 'js/ui/insights-ui.js', 'js/ui/worth-ui.js', 'js/ui/vault-ui.js', 'js/ui/lock-ui.js', 'js/ui/push-ui.js',
];
const LIBS = ['vendor/chart.umd.js', 'vendor/xlsx.full.min.js', 'vendor/pdf.min.js', 'vendor/pdf.worker.min.js'];

const fresh = (u) => new Request(u, { cache: 'reload' });
self.addEventListener('install', (e) => {
  e.waitUntil(Promise.all([
    caches.open(APP_CACHE).then((c) => c.addAll(CORE.map(fresh))),
    caches.open(LIBS_CACHE).then(async (c) => { for (const u of LIBS) if (!(await c.match(u))) await c.add(fresh(u)); }),
  ]));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== APP_CACHE && k !== LIBS_CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('message', (e) => { if (e.data && e.data.type === 'skip-waiting') self.skipWaiting(); });

// Notifications from your server (servidor/worker.js): {title, body, url: '#screen', tag}.
self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (err) { d = { body: e.data ? e.data.text() : '' }; }
  e.waitUntil(self.registration.showNotification(d.title || 'Cuaderno de gastos', { body: d.body || '', tag: d.tag || undefined, icon: 'icon-192.png', data: { url: d.url || '#inicio' } }));
});
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const hash = (e.notification.data && e.notification.data.url) || '#inicio';
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
    const open = list.find((c) => c.url.startsWith(self.registration.scope));
    if (open) { open.postMessage({ type: 'open', hash }); return open.focus(); }
    return self.clients.openWindow(self.registration.scope + hash);
  }));
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return; // your bank server and anything else: always the network
  const scope = new URL(self.registration.scope).pathname;
  if (req.mode === 'navigate' && (url.pathname === scope || url.pathname === scope + 'index.html')) {
    // The app itself, whatever its query (e.g. ?code= coming back from the bank): never stored with it.
    e.respondWith(caches.match('index.html', { cacheName: APP_CACHE }).then((hit) => hit || fetch(req)));
    return;
  }
  if (req.mode === 'navigate') return; // other pages of the site (the guide, the server code) as usual
  e.respondWith(caches.match(req, { ignoreSearch: true }).then((hit) => hit || fetch(req)));
});
