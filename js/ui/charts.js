// Charts (Chart.js, loaded after the first paint). Without it the tables still show everything.
import { $, cssVar } from './dom.js';
import { fmt0, money, pct, mLabel, fmtD } from '../util.js';

const charts = {};
const C = () => window.Chart;

export function kill(k) { if (charts[k]) { charts[k].destroy(); delete charts[k]; } }
function base() {
  const ink = cssVar('--muted'), line = cssVar('--line');
  C().defaults.font.family = getComputedStyle(document.body).fontFamily;
  C().defaults.font.size = 12;
  C().defaults.color = ink;
  return { line, tooltip: { backgroundColor: cssVar('--surface'), titleColor: cssVar('--ink'), bodyColor: cssVar('--ink'), borderColor: line, borderWidth: 1, padding: 10, boxPadding: 4, usePointStyle: true } };
}
// Colours stay with a category across periods: the 7 biggest expenses overall get fixed slots, the rest is grey.
export const slotColor = (cmap, id) => (cmap[id] ? cssVar('--s' + cmap[id]) : cssVar('--rest'));

export function flowChart(months, inc, exp, highlight, onPick) {
  kill('flow');
  const el = $('cFlow');
  if (!C() || !el || !el.offsetParent) return;
  const o = base();
  const fade = (c, i) => (highlight(months[i]) ? c : c + '55');
  const ds = (label, data, color) => ({ label, data, backgroundColor: months.map((_, i) => fade(cssVar(color), i)), borderRadius: { topLeft: 4, topRight: 4 }, borderSkipped: 'bottom', maxBarThickness: 34, categoryPercentage: 0.7, barPercentage: 0.9 });
  charts.flow = new (C())(el, {
    type: 'bar',
    data: { labels: months.map(mLabel), datasets: [ds('Ingresos', inc, '--s1'), ds('Gastos', exp, '--s2')] },
    options: {
      responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
      onClick: (e, els) => { if (els.length) onPick(months[els[0].index]); },
      plugins: {
        legend: { display: false },
        tooltip: { ...o.tooltip, callbacks: { label: (c) => ' ' + c.dataset.label + ': ' + money(c.parsed.y), footer: (items) => { const i = items[0].dataIndex, b = inc[i] - exp[i]; return 'Ahorro: ' + (b >= 0 ? '+' : '−') + money(Math.abs(b)); } } },
      },
      scales: { x: { grid: { display: false }, border: { color: o.line } }, y: { beginAtZero: true, grid: { color: o.line }, border: { display: false }, ticks: { callback: (v) => fmt0.format(v) } } },
    },
  });
}

export function donutChart(slices, labels, colors, total) {
  kill('donut');
  const el = $('cDonut');
  if (!C() || !el || !el.offsetParent || !slices.length) return;
  const o = base();
  charts.donut = new (C())(el, {
    type: 'doughnut',
    data: { labels, datasets: [{ data: slices, backgroundColor: colors, borderColor: cssVar('--surface'), borderWidth: 2, hoverOffset: 4 }] },
    options: { responsive: true, maintainAspectRatio: false, cutout: '66%', plugins: { legend: { display: false }, tooltip: { ...o.tooltip, callbacks: { label: (c) => ' ' + c.label + ': ' + money(c.parsed) + ' (' + pct((c.parsed / total) * 100) + ')' } } } },
  });
}

export function shareChart(months, series) {
  kill('share');
  const el = $('cShare');
  if (!C() || !el || !el.offsetParent || !months.length) return;
  const o = base(), surf = cssVar('--surface');
  charts.share = new (C())(el, {
    type: 'bar',
    data: { labels: months.map(mLabel), datasets: series.map((s) => ({ label: s.name, data: s.data, abs: s.abs, backgroundColor: s.color, borderColor: surf, borderWidth: { top: 2 }, borderSkipped: false, maxBarThickness: 46 })) },
    options: {
      responsive: true, maintainAspectRatio: false, interaction: { mode: 'nearest', intersect: true },
      plugins: { legend: { display: false }, tooltip: { ...o.tooltip, callbacks: { label: (c) => ' ' + c.dataset.label + ': ' + pct(c.parsed.y) + ' · ' + money(c.dataset.abs[c.dataIndex]) } } },
      scales: { x: { stacked: true, grid: { display: false }, border: { color: o.line } }, y: { stacked: true, min: 0, max: 100, grid: { color: o.line }, border: { display: false }, ticks: { stepSize: 25, callback: (v) => v + ' %' } } },
    },
  });
}

export function invChart(history) {
  kill('inv');
  const el = $('cInv');
  if (!C() || !el || !el.offsetParent || history.length < 2) return;
  const o = base();
  charts.inv = new (C())(el, {
    type: 'line',
    data: {
      labels: history.map((x) => fmtD(x.d)),
      datasets: [
        { label: 'Valor', data: history.map((x) => x.v), borderColor: cssVar('--s1'), backgroundColor: cssVar('--s1') + '22', fill: true, borderWidth: 2, pointRadius: history.map((_, i) => (i === history.length - 1 ? 4 : 0)), tension: 0.25 },
        { label: 'Invertido', data: history.map((x) => x.c), borderColor: cssVar('--rest'), borderDash: [5, 4], borderWidth: 2, pointRadius: 0, fill: false, stepped: true },
      ],
    },
    options: {
      responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
      plugins: { legend: { display: true, position: 'top', align: 'end', labels: { boxWidth: 10, boxHeight: 10, useBorderRadius: true, borderRadius: 3 } }, tooltip: { ...o.tooltip, callbacks: { label: (c) => ' ' + c.dataset.label + ': ' + money(c.parsed.y) } } },
      scales: { x: { grid: { display: false }, border: { color: o.line }, ticks: { maxTicksLimit: 6 } }, y: { grid: { color: o.line }, border: { display: false }, ticks: { callback: (v) => fmt0.format(v) } } },
    },
  });
}

// One category month by month, the month you are looking at in full colour, and its average as a dashed line.
export function catChart(months, vals, avg, cur) {
  kill('cat');
  const el = $('cCat');
  if (!C() || !el || !el.offsetParent || !months.length) return;
  const o = base(), color = cssVar('--s2');
  charts.cat = new (C())(el, {
    type: 'bar',
    data: {
      labels: months.map(mLabel),
      datasets: [
        { type: 'bar', label: 'Gasto', data: vals, backgroundColor: months.map((m) => (!cur || m === cur ? color : color + '77')), borderRadius: { topLeft: 4, topRight: 4 }, borderSkipped: 'bottom', maxBarThickness: 34 },
        { type: 'line', label: 'Media', data: months.map(() => avg), borderColor: cssVar('--ink'), borderDash: [5, 4], borderWidth: 1.5, pointRadius: 0, fill: false },
      ],
    },
    options: {
      responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
      plugins: { legend: { display: false }, tooltip: { ...o.tooltip, callbacks: { label: (c) => ' ' + c.dataset.label + ': ' + money(c.parsed.y) } } },
      scales: { x: { grid: { display: false }, border: { color: o.line } }, y: { beginAtZero: true, grid: { color: o.line }, border: { display: false }, ticks: { callback: (v) => fmt0.format(v) } } },
    },
  });
}

// Net worth at the end of each month: money in your accounts and investments, stacked.
export function worthChart(series) {
  kill('worth');
  const el = $('cWorth');
  if (!C() || !el || !el.offsetParent || series.length < 2) return;
  const o = base();
  const ds = (label, data, color) => ({ label, data, backgroundColor: cssVar(color), borderRadius: 3, maxBarThickness: 34, stack: 'w' });
  charts.worth = new (C())(el, {
    type: 'bar',
    data: { labels: series.map((x) => mLabel(x.m)), datasets: [ds('Cuentas', series.map((x) => x.cash), '--s1'), ds('Inversiones', series.map((x) => x.inv || 0), '--s3')] },
    options: {
      responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: true, position: 'top', align: 'end', labels: { boxWidth: 10, boxHeight: 10, useBorderRadius: true, borderRadius: 3 } },
        tooltip: { ...o.tooltip, callbacks: { label: (c) => ' ' + c.dataset.label + ': ' + money(c.parsed.y), footer: (items) => 'Total: ' + money(series[items[0].dataIndex].total) } },
      },
      scales: { x: { stacked: true, grid: { display: false }, border: { color: o.line } }, y: { stacked: true, grid: { color: o.line }, border: { display: false }, ticks: { callback: (v) => fmt0.format(v) } } },
    },
  });
}
