// DOM helpers shared by the screens.
export const $ = (id) => document.getElementById(id);
export { esc } from '../util.js';

let toastTimer = null;
// A short message at the bottom; with an action (e.g. «Deshacer») it stays a little longer.
export function toast(msg, action) {
  const el = $('toast');
  el.innerHTML = '';
  const span = document.createElement('span');
  span.textContent = msg;
  el.appendChild(span);
  if (action) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'btn link';
    b.style.color = 'inherit';
    b.style.textDecoration = 'underline';
    b.style.marginLeft = '10px';
    b.textContent = action.label;
    b.addEventListener('click', () => { el.hidden = true; action.run(); });
    el.appendChild(b);
  }
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, action ? 8000 : 4000);
}

export const cssVar = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
