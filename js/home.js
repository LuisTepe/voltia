// Pestaña "Inicio": consumo en tiempo real + resumen del historial.
import { live, LIVE, currentTotal, todayByDevice } from './live.js';
import { getDays } from './history.js';
import {
  $, fmt, money, esc, TARIFA, charts, theme, colorFor, gradient, replay, countUp,
  F_TIME, dayName, isMobile, reduceMotion,
} from './ui.js';

const GAUGE_C = 2 * Math.PI * 52;   // circunferencia del medidor (r = 52)

const TIPS = {
  1: 'Mantén la puerta cerrada y deja espacio detrás para que respire: ahorras hasta 10%.',
  2: 'Sube el termostato a 24–25 °C: cada grado menos de frío ahorra cerca de 7%.',
  3: 'Cambia a focos LED y apaga las luces de cuartos vacíos.',
  4: 'Lava con carga completa y agua fría para gastar menos energía por ciclo.',
  5: 'Activa la suspensión automática después de 10 minutos sin uso.',
  6: 'Desconéctala o usa un multicontacto con apagador para evitar el consumo en espera.',
  7: 'Duchas de 5 minutos y un temporizador en el calentador reducen mucho el gasto.',
};

/* ------------------------------------------------------------------ */
/* Hero: consumo actual                                               */
/* ------------------------------------------------------------------ */
function renderHero() {
  const total = currentTotal();
  countUp($('#heroPower'), total, 0, 800);

  const pct = Math.min(1, total / LIVE.GAUGE_MAX);
  const level = total < 600 ? ['bajo', 'good'] : total < 1800 ? ['moderado', 'warn'] : ['alto', 'bad'];
  const arc = $('#gaugeArc');
  arc.style.strokeDashoffset = GAUGE_C * (1 - pct);
  $('#hero').dataset.level = level[1];
  $('#heroStatus').textContent = `Consumo ${level[0]}`;
  $('#gaugePct').textContent = `${Math.round(pct * 100)}%`;

  const delta = total - live.prevTotal;
  $('#heroDelta').innerHTML = live.ticks
    ? `<span class="${delta >= 0 ? 'up' : 'down'}">${delta >= 0 ? '▲' : '▼'} ${fmt(Math.abs(delta))} W</span> vs. hace 1 min`
    : 'Midiendo…';

  const devs = todayByDevice();
  const kwh = devs.reduce((a, d) => a + d.kwh, 0);
  countUp($('#statToday'), kwh, 2, 800);
  countUp($('#statCost'), kwh * TARIFA, 2, 800);
  $('#statPeak').textContent = live.peak.t ? `${fmt(live.peak.w)} W` : '—';
  $('#statPeakTime').textContent = live.peak.t ? `a las ${live.peak.t}` : '';
  return devs;
}

/* ------------------------------------------------------------------ */
/* Gráfica en vivo                                                    */
/* ------------------------------------------------------------------ */
function createLiveChart() {
  const n = live.series.length;
  const INTRO = 1600;
  const step = INTRO / n;
  let intro = !reduceMotion;
  setTimeout(() => { intro = false; }, INTRO + 300);
  const previousY = ctx => (ctx.index === 0
    ? ctx.chart.scales.y.getPixelForValue(0)
    : ctx.chart.getDatasetMeta(ctx.datasetIndex).data[ctx.index - 1].getProps(['y'], true).y);

  charts.live = new Chart($('#chartLive'), {
    type: 'line',
    data: {
      datasets: [{
        data: live.series,
        borderColor: () => theme.accent, borderWidth: 3, tension: 0.4, fill: true,
        backgroundColor: c => (c.chart.chartArea ? gradient(c.chart.ctx, c.chart.chartArea, theme.accent, '80') : 'transparent'),
        pointRadius: c => (c.dataIndex === c.dataset.data.length - 1 ? 4 : 0),
        pointBackgroundColor: () => theme.accent, pointBorderColor: () => theme.surface, pointBorderWidth: 2,
        pointHoverRadius: 6,
      }],
    },
    options: {
      interaction: { mode: 'index', intersect: false },
      animation: {
        x: {
          type: 'number', easing: 'linear',
          duration: () => (intro ? step : 700),
          from: () => (intro ? NaN : undefined),
          delay: ctx => (intro && ctx.type === 'data' ? ctx.index * step : 0),
        },
        y: {
          type: 'number',
          easing: () => (intro ? 'linear' : 'easeOutCubic'),
          duration: () => (intro ? step : 800),
          from: ctx => (intro && ctx.type === 'data' ? previousY(ctx) : undefined),
          delay: ctx => (intro && ctx.type === 'data' ? ctx.index * step : 0),
        },
      },
      scales: {
        x: {
          type: 'linear', bounds: 'data', grid: { display: false },
          ticks: { maxTicksLimit: isMobile() ? 4 : 7, maxRotation: 0, callback: v => F_TIME.format(new Date(v * 60e3)) },
        },
        y: { beginAtZero: true, suggestedMax: 1500, ticks: { maxTicksLimit: 5, callback: v => (v >= 1000 ? `${fmt(v / 1000, 1)} kW` : `${fmt(v)} W`) } },
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          displayColors: false,
          callbacks: { title: i => F_TIME.format(new Date(i[0].raw.x * 60e3)), label: i => `${fmt(i.raw.y)} W` },
        },
      },
    },
  });
}

/* ------------------------------------------------------------------ */
/* ¿En qué se va hoy?                                                 */
/* ------------------------------------------------------------------ */
function createDonut(devs) {
  charts.donut = new Chart($('#chartDonut'), {
    type: 'doughnut',
    data: {
      labels: devs.map(d => d.nombre),
      datasets: [{
        data: devs.map(d => d.kwh),
        backgroundColor: devs.map(d => colorFor(d.id)),
        borderColor: () => theme.surface, borderWidth: 3, hoverOffset: 6, borderRadius: 4,
      }],
    },
    options: {
      cutout: '72%',
      animation: { animateRotate: true, animateScale: true, duration: 1300, easing: 'easeOutQuart' },
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: i => ` ${fmt(i.raw, 2)} kWh` } },
      },
    },
  });
}

function renderBreakdown(devs, animate = false) {
  const total = devs.reduce((a, d) => a + d.kwh, 0) || 1;
  charts.donut.data.datasets[0].data = devs.map(d => d.kwh);
  charts.donut.update();
  countUp($('#donutTotal'), total, 1, 800);
  const top = [...devs].sort((a, b) => b.kwh - a.kwh).slice(0, 4);
  $('#topList').innerHTML = top.map((d, i) => `
    <li class="${animate ? 'row-in' : ''}" style="animation-delay:${i * 80 + 300}ms">
      <span class="emoji">${d.icon}</span>
      <span class="top-name">${esc(d.nombre)}<span class="top-bar"><span class="${animate ? 'grow' : ''}"
        style="--w:${(d.kwh / total) * 100}%;background:${colorFor(d.id)}"></span></span></span>
      <strong>${fmt((d.kwh / total) * 100)}%</strong>
    </li>`).join('');
}

/* ------------------------------------------------------------------ */
/* Resumen del historial                                              */
/* ------------------------------------------------------------------ */
function createSummaryChart() {
  charts.summary = new Chart($('#chartSummary'), {
    type: 'bar',
    data: {
      labels: [],
      datasets: [{
        data: [],
        backgroundColor: c => (c.dataIndex === c.dataset.data.length - 1 ? theme.accent : theme.accent + '55'),
        borderRadius: 8, borderSkipped: false, maxBarThickness: 34,
      }],
    },
    options: {
      animation: {
        duration: 1000, easing: 'easeOutQuart',
        delay: c => (c.type === 'data' && c.chart.$stagger ? c.dataIndex * 110 + 200 : 0),
        onComplete: ({ chart }) => { chart.$stagger = false; },
      },
      scales: {
        x: { grid: { display: false }, ticks: { maxRotation: 0 } },
        y: { display: false, beginAtZero: true },
      },
      plugins: {
        legend: { display: false },
        tooltip: { displayColors: false, callbacks: { label: i => `${fmt(i.raw, 2)} kWh · ${money(i.raw * TARIFA)}` } },
      },
    },
  });
}

function renderSummary(animate = false) {
  const days = getDays(15);
  const t = days.at(-1).dia;
  const last7 = days.slice(-7);
  const prev7 = days.slice(0, 7);          // 7 días completos anteriores
  const done7 = days.slice(-8, -1);        // últimos 7 días completos (sin hoy)
  const sum = a => a.reduce((s, d) => s + d.total, 0);

  countUp($('#sumTotal'), sum(last7), 1);
  const avg = sum(done7) / 7;
  const diff = sum(prev7) ? (sum(done7) - sum(prev7)) / sum(prev7) : 0;
  const chip = $('#sumDelta');
  chip.className = `delta ${diff > 0 ? 'up' : 'down'}`;
  chip.textContent = `${diff > 0 ? '▲' : '▼'} ${fmt(Math.abs(diff) * 100)}% vs. semana anterior`;
  $('#sumAvg').textContent = `${fmt(avg, 1)} kWh`;
  const now = new Date();
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  $('#sumMonth').textContent = money(avg * daysInMonth * TARIFA);

  const c = charts.summary;
  c.data.labels = last7.map(d => dayName(d.dia, t).replace(/ \d+$/, ''));
  c.data.datasets[0].data = last7.map(d => d.total);
  if (animate) replay(c); else c.update();
}

function renderTip(devs) {
  const total = devs.reduce((a, d) => a + d.kwh, 0) || 1;
  const top = [...devs].sort((a, b) => b.kwh - a.kwh)[0];
  $('#tipTitle').innerHTML = `${top.icon} ${esc(top.nombre)} lleva el <strong>${fmt((top.kwh / total) * 100)}%</strong> de tu consumo de hoy`;
  $('#tipText').textContent = TIPS[top.id] || '';
}

/* ------------------------------------------------------------------ */
/* Ciclo de vida de la pestaña                                        */
/* ------------------------------------------------------------------ */
export function build() {
  const devs = renderHero();
  createLiveChart();
  createDonut(devs);
  createSummaryChart();
  renderBreakdown(devs, true);
  renderSummary(true);
  renderTip(devs);
}

export function enter() {
  const devs = renderHero();
  charts.live.update('none');
  renderBreakdown(devs, true);
  renderSummary(true);
  renderTip(devs);
}

export function tick() {
  const devs = renderHero();
  charts.live.update();
  renderBreakdown(devs);
  if (live.ticks % 5 === 0) renderSummary();
  if (live.ticks % 15 === 0) renderTip(devs);
}

export function setLiveBadge(running) {
  $('#liveBadge').classList.toggle('on', running);
  $('#liveText').textContent = running ? 'En vivo' : 'En pausa';
  const btn = $('#btnLive');
  btn.setAttribute('aria-pressed', running);
  btn.setAttribute('aria-label', running ? 'Pausar la simulación en vivo' : 'Reanudar la simulación en vivo');
  btn.querySelector('span').textContent = running ? 'Pausar' : 'Reanudar';
}
