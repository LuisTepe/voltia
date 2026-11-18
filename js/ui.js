// Utilidades compartidas: formato, fechas, tema y registro de gráficas.
import { fromStamp, toStamp } from './db.js';

export const TARIFA = 2.85;   // MXN por kWh (valor de ejemplo)
export const COLORS = ['#06b6d4', '#f59e0b', '#8b5cf6', '#10b981', '#ec4899', '#3b82f6', '#ef4444'];

export const $ = (s, root = document) => root.querySelector(s);
export const $$ = (s, root = document) => [...root.querySelectorAll(s)];
export const fmt = (n, d = 0) => Number(n || 0).toLocaleString('es-MX', { minimumFractionDigits: d, maximumFractionDigits: d });
export const money = n => `$${fmt(n, 2)}`;
export const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const cssVar = v => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
export const colorFor = id => COLORS[(id - 1) % COLORS.length];

const mobileMQ = matchMedia('(max-width: 720px)');
export const isMobile = () => mobileMQ.matches;
export const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ---------- Fechas ---------- */
export const dayOf = d => toStamp(d).slice(0, 10);
export const parseDay = s => fromStamp(`${s} 12:00`);
export const shiftDay = (s, n) => { const d = parseDay(s); d.setDate(d.getDate() + n); return dayOf(d); };
const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
const F_SHORT = new Intl.DateTimeFormat('es-MX', { weekday: 'short', day: 'numeric' });
const F_LONG = new Intl.DateTimeFormat('es-MX', { weekday: 'long', day: 'numeric', month: 'long' });
const F_DM = new Intl.DateTimeFormat('es-MX', { day: 'numeric', month: 'short' });
export const F_TIME = new Intl.DateTimeFormat('es-MX', { hour: '2-digit', minute: '2-digit' });
export const F_CLOCK = new Intl.DateTimeFormat('es-MX', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

/** 'Hoy', 'Ayer' o la fecha en formato corto ('Lun 16') / día-mes ('16 nov'). */
export function dayName(s, today, style = 'short') {
  if (s === today) return 'Hoy';
  if (s === shiftDay(today, -1)) return 'Ayer';
  const d = parseDay(s);
  return style === 'dm' ? F_DM.format(d) : cap(F_SHORT.format(d).replace('.', ''));
}
export const longDate = s => cap(F_LONG.format(parseDay(s)));
export const shortDate = s => F_DM.format(parseDay(s));

/* ---------- Animación de números ---------- */
export function countUp(el, to, decimals = 0, duration = 900) {
  if (!el) return;
  const from = parseFloat(el.dataset.v ?? '0');
  el.dataset.v = to;
  if (reduceMotion) { el.textContent = fmt(to, decimals); return; }
  const t0 = performance.now();
  const step = now => {
    const p = Math.min(1, (now - t0) / duration);
    el.textContent = fmt(from + (to - from) * (1 - Math.pow(1 - p, 3)), decimals);
    if (p < 1 && el.dataset.v == to) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

/* ---------- Gráficas y tema ---------- */
export const charts = {};
export function destroyCharts() {
  Object.keys(charts).forEach(k => { charts[k].destroy(); delete charts[k]; });
}

export const theme = {};
export function setupChartDefaults() {
  ['accent', 'muted', 'grid', 'surface', 'surface-2', 'text', 'border'].forEach(k => { theme[k] = cssVar(`--${k}`); });
  const d = Chart.defaults;
  d.font.family = 'Inter, system-ui, sans-serif';
  d.font.size = isMobile() ? 11 : 12;
  d.color = theme.muted;
  d.borderColor = theme.grid;
  d.maintainAspectRatio = false;
  Object.assign(d.plugins.tooltip, {
    backgroundColor: theme['surface-2'], titleColor: theme.text, bodyColor: theme.text,
    borderColor: theme.border, borderWidth: 1, padding: 10, cornerRadius: 10, displayColors: true,
  });
  if (reduceMotion) d.animation = false;
}

export function applyThemeToCharts() {
  setupChartDefaults();
  Object.values(charts).forEach(c => {
    Object.values(c.options.scales || {}).forEach(s => {
      if (s.ticks) s.ticks.color = theme.muted;
      if (s.grid) s.grid.color = theme.grid;
    });
    if (c.options.plugins?.legend?.labels) c.options.plugins.legend.labels.color = theme.muted;
    c.update('none');
  });
}

export function gradient(ctx, area, color, top = '99', bottom = '05') {
  const g = ctx.createLinearGradient(0, area.top, 0, area.bottom);
  g.addColorStop(0, color + top);
  g.addColorStop(1, color + bottom);
  return g;
}

/** Vuelve a reproducir la animación de entrada de una gráfica. */
export function replay(chart) {
  if (!chart || reduceMotion) return chart?.update();
  chart.$stagger = true;
  chart.reset();
  chart.update();
}
