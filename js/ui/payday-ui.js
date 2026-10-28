// Ajustes › Mes de la nómina: a salary paid at the end of the month counts as the next month's income.
import { app, save } from '../store.js';
import { $, esc, toast } from './dom.js';
import { DEFAULT_PAYDAY, ownMonth } from '../aggregate.js';
import { mLong, dShort, plural } from '../util.js';

const conf = () => app.state.settings.payday || (app.state.settings.payday = { ...DEFAULT_PAYDAY });

export function renderPayday() {
  const box = $('paydayBody');
  if (box.contains(document.activeElement) && document.activeElement.id === 'pdDay') return; // typing the day
  const p = conf(), s = app.state;
  const cats = s.cats.filter((c) => c.kind === 'ingreso');
  const moved = s.tx.filter((t) => !t.mm && ownMonth(t) !== t.date.slice(0, 7)).sort((a, b) => b.date.localeCompare(a.date));
  const byHand = s.tx.filter((t) => t.mm).length;
  const last = moved[0];
  box.innerHTML = `<form class="form" id="paydayForm">
      <label class="check"><input type="checkbox" id="pdOn"${p.on ? ' checked' : ''}> Contar la nómina en el mes siguiente si llega a partir del día</label>
      <div class="tools"><input type="text" id="pdDay" inputmode="numeric" value="${p.day}" aria-label="Día del mes" style="width:70px"${p.on ? '' : ' disabled'}><span class="muted small">(si llega antes, cuenta en su mes)</span></div>
      <label>Qué cuenta como nómina</label>
      <div class="pd-cats">${cats.map((c) => `<label class="check"><input type="checkbox" data-pdcat="${c.id}"${p.cats.includes(c.id) ? ' checked' : ''}${p.on ? '' : ' disabled'}> ${esc(c.name)}</label>`).join('')}</div>
    </form>
    <p class="muted small" style="margin-top:8px">${p.on && last ? `${plural(moved.length, 'ingreso cuenta', 'ingresos cuentan')} en el mes siguiente; el último, el del ${dShort(last.date)}, en ${mLong(ownMonth(last))}.` : p.on ? 'Ahora mismo ningún ingreso pasa al mes siguiente.' : 'Cada ingreso cuenta en el mes de su fecha.'}
    ${byHand ? ` ${plural(byHand, 'movimiento lo has', 'movimientos los has')} cambiado de mes a mano en «Movimientos». <button class="btn link small" type="button" id="pdReset">Quitar esos cambios</button>` : ' También puedes cambiar de mes un ingreso concreto en «Movimientos».'}</p>`;
}

function read() {
  const p = conf(), day = parseInt($('pdDay').value, 10);
  p.on = $('pdOn').checked;
  if (day >= 1 && day <= 31) p.day = day;
  p.cats = [...$('paydayBody').querySelectorAll('input[data-pdcat]:checked')].map((i) => i.dataset.pdcat);
}

export function bindPayday() {
  const box = $('paydayBody');
  box.addEventListener('change', () => { read(); save(); app.render(); });
  box.addEventListener('submit', (e) => { e.preventDefault(); document.activeElement.blur(); read(); save(); app.render(); });
  box.addEventListener('click', (e) => {
    if (e.target.id !== 'pdReset') return;
    const back = app.state.tx.filter((t) => t.mm).map((t) => [t, t.mm]);
    for (const [t] of back) delete t.mm;
    save(); app.render();
    toast(plural(back.length, 'movimiento vuelve', 'movimientos vuelven') + ' a su mes.', { label: 'Deshacer', run: () => { for (const [t, m] of back) t.mm = m; save(); app.render(); } });
  });
}
