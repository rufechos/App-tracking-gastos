// Runs before the page is drawn: with the lock on, the app starts hidden behind it until js/ui/lock-ui.js unlocks it.
try {
  if ((JSON.parse(localStorage.getItem('cuaderno-gastos-bloqueo')) || {}).on) document.documentElement.classList.add('locked');
} catch (e) { /* no storage: nothing to lock */ }
