// Pestaña "Historial": consumo de días anteriores (base SQLite) + lo que va de hoy (en vivo).
import * as DB from './db.js';
import { live, today } from './live.js';
import {
  $, $$, fmt, money, esc, TARIFA, charts, theme, colorFor, gradient, replay, countUp,
  shiftDay, dayName, longDate, shortDate, isMobile,
} from './ui.js';

const hs = { range: 7, selected: null };
let dbCache = null;

export function invalidate() { dbCache = null; }

function dbRows() {
  if (!dbCache) dbCache = DB.dailyByDevice(shiftDay(today(), -(DB.SEED_DAYS + 5)));
  return dbCache;
}

/** Últimos n días (incluye hoy) con kWh por dispositivo y total. */
export function getDays(n) {
  const t = today();
  const from = shiftDay(t, -(n - 1));
  const map = new Map();
  for (let i = 0; i < n; i++) {
    const d = shiftDay(from, i);
    map.set(d, { dia: d, byDev: {}, total: 0 });
  }
  const add = (d, id, k) => {
    const e = map.get(d);
    if (!e) return;
    e.byDev[id] = (e.byDev[id] || 0) + k;
    e.total += k;
  };
  dbRows().forEach(r => add(r.dia, r.id, r.kwh));
  Object.entries(live.extra).forEach(([d, devs]) => Object.entries(devs).forEach(([id, k]) => add(d, Number(id), k)));
  return [...map.values()];
}

/** kWh por hora (0–23) de un día: base + en vivo. */
function hourlyOf(day) {
  const hours = Array(24).fill(0);
  DB.dayHourly(day).forEach(r => { hours[r.h] += r.kwh; });
  Object.entries(live.extraHour[day] || {}).forEach(([h, k]) => { hours[h] += k; });
  // hoy: las horas que aún no pasan se dejan vacías en lugar de mostrarse como cero
  if (day === today()) return hours.map((k, h) => (h <= live.time.getHours() ? k : null));
  return hours;
}

/* ------------------------------------------------------------------ */
/* Gráficas                                                           */
/* ------------------------------------------------------------------ */
function staggerDelay(per, max = 900) {
  return ctx => {
    if (ctx.type !== 'data' || !ctx.chart.$stagger) return 0;
    const n = ctx.chart.data.labels.length || 1;
    return Math.min(max, (ctx.dataIndex * max) / n) + ctx.datasetIndex * per;
  };
}

function createHistoryChart() {
  charts.history = new Chart($('#chartHistory'), {
    type: 'bar',
    data: {
      labels: [],
      datasets: live.devices.map(d => ({
        label: d.nombre, devId: d.id, data: [],
        backgroundColor: colorFor(d.id), borderRadius: 3, borderSkipped: false,
        borderColor: () => theme.surface, borderWidth: { top: 1 },
        maxBarThickness: 38,
      })),
    },
    options: {
      animation: {
        duration: 900, easing: 'easeOutQuart', delay: staggerDelay(60),
        onComplete: ({ chart }) => { chart.$stagger = false; },
      },
      interaction: { mode: 'index', intersect: false },
      scales: {
        x: { stacked: true, grid: { display: false }, ticks: { maxRotation: 0, autoSkipPadding: 6 } },
        y: { stacked: true, beginAtZero: true, ticks: { maxTicksLimit: 5, callback: v => `${fmt(v)} kWh` } },
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          itemSort: (a, b) => b.raw - a.raw,
          filter: i => i.raw > 0.005,
          callbacks: {
            title: items => longDate(charts.history.$days[items[0].dataIndex].dia),
            label: i => ` ${i.dataset.label}: ${fmt(i.raw, 2)} kWh`,
            footer: items => {
              const day = charts.history.$days[items[0].dataIndex];
              return `Total: ${fmt(day.total, 2)} kWh · ${money(day.total * TARIFA)}`;
            },
          },
        },
      },
      onClick: (_e, els) => { if (els[0]) select(charts.history.$days[els[0].index].dia, true); },
      onHover: (e, els) => { e.native.target.style.cursor = els.length ? 'pointer' : 'default'; },
    },
  });
}

function createDayChart() {
  charts.day = new Chart($('#chartDay'), {
    type: 'line',
    data: {
      labels: Array.from({ length: 24 }, (_, h) => `${String(h).padStart(2, '0')}h`),
      datasets: [{
        data: Array(24).fill(0),
        borderColor: () => theme.accent, borderWidth: 2.5, tension: 0.4, fill: true,
        backgroundColor: c => (c.chart.chartArea ? gradient(c.chart.ctx, c.chart.chartArea, theme.accent) : 'transparent'),
        pointRadius: 0, pointHoverRadius: 5, pointBackgroundColor: () => theme.accent,
      }],
    },
    options: {
      animation: { duration: 900, easing: 'easeOutQuart', delay: staggerDelay(0, 500), onComplete: ({ chart }) => { chart.$stagger = false; } },
      interaction: { mode: 'index', intersect: false },
      scales: {
        x: { grid: { display: false }, ticks: { maxTicksLimit: isMobile() ? 6 : 12, maxRotation: 0 } },
        y: { beginAtZero: true, ticks: { maxTicksLimit: 4, callback: v => fmt(v, 1) } },
      },
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: i => ` ${fmt(i.raw, 3)} kWh` } } },
    },
  });
}

/* ------------------------------------------------------------------ */
/* Render                                                             */
/* ------------------------------------------------------------------ */
function render({ animate = false } = {}) {
  const t = today();
  const days = getDays(hs.range);
  const complete = days.filter(d => d.dia !== t);
  const total = days.reduce((a, d) => a + d.total, 0);
  const avg = complete.length ? complete.reduce((a, d) => a + d.total, 0) / complete.length : 0;
  const max = days.reduce((m, d) => (d.total > m.total ? d : m), days[0]);

  countUp($('#histTotal'), total, 1);
  countUp($('#histCost'), total * TARIFA, 2);
  countUp($('#histAvg'), avg, 2);
  $('#histMax').textContent = `${fmt(max.total, 1)} kWh`;
  $('#histMaxDay').textContent = dayName(max.dia, t, 'dm');
  $('#histRangeLabel').textContent = `${shortDate(days[0].dia)} – ${shortDate(t)}`;

  // gráfica apilada
  const c = charts.history;
  c.$days = days;
  c.data.labels = days.map(d => dayName(d.dia, t, hs.range > 7 ? 'dm' : 'short'));
  c.data.datasets.forEach(ds => { ds.data = days.map(d => d.byDev[ds.devId] || 0); });
  if (animate) replay(c); else c.update();

  // lista de días (más reciente primero)
  const top = Math.max(...days.map(d => d.total), 0.001);
  $('#dayList').innerHTML = [...days].reverse().map((d, i) => {
    const isToday = d.dia === t;
    const diff = avg ? (d.total - avg) / avg : 0;
    const chip = isToday
      ? '<span class="delta live-chip">en curso</span>'
      : `<span class="delta ${diff > 0 ? 'up' : 'down'}">${diff > 0 ? '+' : '−'}${fmt(Math.abs(diff) * 100)}%</span>`;
    return `<li><button class="day-row ${animate ? 'row-in' : ''} ${d.dia === hs.selected ? 'selected' : ''}"
        data-day="${d.dia}" style="animation-delay:${Math.min(i, 14) * 35}ms" aria-pressed="${d.dia === hs.selected}">
      <span class="day-name"><strong>${esc(dayName(d.dia, t))}</strong><small>${esc(shortDate(d.dia))}</small></span>
      <span class="day-bar"><span class="${animate ? 'grow' : ''}" style="--w:${(d.total / top) * 100}%"></span></span>
      <span class="day-val"><strong>${fmt(d.total, 1)} kWh</strong><small>${money(d.total * TARIFA)}</small></span>
      ${chip}
    </button></li>`;
  }).join('');

  if (!days.some(d => d.dia === hs.selected)) hs.selected = t;
  renderDetail(days.find(d => d.dia === hs.selected), animate);
}

function renderDetail(day, animate) {
  const t = today();
  $('#dayTitle').textContent = day.dia === t ? 'Hoy' : longDate(day.dia);
  $('#daySub').textContent = day.dia === t ? `${longDate(day.dia)} · en curso` : 'Consumo por hora';
  countUp($('#dayTotal'), day.total, 2, 600);
  $('#dayCost').textContent = money(day.total * TARIFA);

  charts.day.data.datasets[0].data = hourlyOf(day.dia);
  if (animate) replay(charts.day); else charts.day.update();

  const rows = live.devices
    .map(d => ({ ...d, kwh: day.byDev[d.id] || 0 }))
    .sort((a, b) => b.kwh - a.kwh);
  const top = Math.max(rows[0]?.kwh || 0, 0.001);
  $('#dayDevices').innerHTML = rows.map(r => `
    <li>
      <span class="dev-name"><span class="emoji">${r.icon}</span>${esc(r.nombre)}</span>
      <span class="dev-bar"><span class="${animate ? 'grow' : ''}" style="--w:${(r.kwh / top) * 100}%;background:${colorFor(r.id)}"></span></span>
      <span class="dev-val">${fmt(r.kwh, 2)} <small>kWh</small></span>
    </li>`).join('');
}

function select(day, scroll) {
  hs.selected = day;
  $$('#dayList .day-row').forEach(b => {
    const on = b.dataset.day === day;
    b.classList.toggle('selected', on);
    b.setAttribute('aria-pressed', on);
  });
  renderDetail(getDays(hs.range).find(d => d.dia === day), true);
  if (scroll && isMobile()) $('#dayDetail').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function renderLegend() {
  $('#histLegend').innerHTML = live.devices.map(d =>
    `<span class="legend-item"><span class="dot" style="background:${colorFor(d.id)}"></span>${esc(d.nombre)}</span>`).join('');
}

/* ------------------------------------------------------------------ */
/* Ciclo de vida de la pestaña                                        */
/* ------------------------------------------------------------------ */
export function build() {
  hs.selected = today();
  createHistoryChart();
  createDayChart();
  renderLegend();
  $$('#rangeSeg button').forEach(b => {
    b.onclick = () => {
      hs.range = Number(b.dataset.range);
      $$('#rangeSeg button').forEach(x => x.setAttribute('aria-pressed', x === b));
      render({ animate: true });
    };
  });
  $('#dayList').onclick = e => {
    const row = e.target.closest('.day-row');
    if (row) select(row.dataset.day, true);
  };
  render({ animate: true });
}

export function enter() { render({ animate: true }); }

export function tick() {
  if (live.ticks % 5 === 0) render();
}
