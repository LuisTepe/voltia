// Arranque, navegación por pestañas, tema y reloj de la simulación en vivo.
import * as DB from './db.js';
import { live, LIVE, initLive, advance } from './live.js';
import { $, $$, F_CLOCK, setupChartDefaults, applyThemeToCharts, destroyCharts } from './ui.js';
import * as Home from './home.js';
import * as History from './history.js';
import * as Devices from './devices.js';
import * as Data from './data.js';

const VIEWS = { inicio: Home, historial: History, dispositivos: Devices, datos: Data };
const built = new Set();
let current = null;
let timer = null;

/* ------------------------------------------------------------------ */
/* Pestañas                                                           */
/* ------------------------------------------------------------------ */
function showView(name, { scroll = true } = {}) {
  if (!VIEWS[name]) name = 'inicio';
  $$('.view').forEach(v => { v.hidden = v.dataset.view !== name; });
  $$('[data-tab]').forEach(a => {
    const on = a.dataset.tab === name;
    a.classList.toggle('active', on);
    if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  });

  const view = $(`.view[data-view="${name}"]`);
  view.classList.remove('enter');
  void view.offsetWidth;            // reinicia la animación de entrada
  view.classList.add('enter');

  if (!built.has(name)) { VIEWS[name].build(); built.add(name); }
  else if (current !== name) VIEWS[name].enter();

  current = name;
  if (location.hash.slice(1) !== name) history.replaceState(null, '', `#${name}`);
  if (scroll) window.scrollTo({ top: 0 });
}

/** Tras cambiar la base (regenerar o SQL), se recalculan la simulación y las gráficas. */
function rebuildAll() {
  const wasRunning = live.running;
  setRunning(false);
  destroyCharts();
  History.invalidate();
  [...built].forEach(v => { if (v !== 'datos') built.delete(v); });
  initLive();
  updateClock();
  const cur = current;
  current = null;
  showView(cur, { scroll: false });
  if (wasRunning) setTimeout(() => setRunning(true), 1900);
}

/* ------------------------------------------------------------------ */
/* Simulación en vivo                                                 */
/* ------------------------------------------------------------------ */
function updateClock() { $('#clock').textContent = F_CLOCK.format(live.time); }

function tick() {
  advance();
  updateClock();
  if (built.has(current)) VIEWS[current].tick();
}

function schedule() {
  clearInterval(timer);
  timer = null;
  // en segundo plano no se gasta batería
  if (live.running && !document.hidden) timer = setInterval(tick, LIVE.TICK_MS);
}

function setRunning(on) {
  live.running = on;
  Home.setLiveBadge(on);
  $('.clock-pill').classList.toggle('on', on);
  schedule();
}

/* ------------------------------------------------------------------ */
/* Tema                                                               */
/* ------------------------------------------------------------------ */
function syncThemeUI() {
  const dark = document.documentElement.dataset.theme === 'dark';
  const label = dark ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro';
  $('#btnTheme').setAttribute('aria-label', label);
  $('#btnTheme').title = label;
  $('meta[name="theme-color"]').setAttribute('content', dark ? '#0b1020' : '#f5f7fb');
}

function toggleTheme() {
  const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  try { localStorage.setItem('voltix.theme', next); } catch { /* sin almacenamiento */ }
  syncThemeUI();
  applyThemeToCharts();
}

/* ------------------------------------------------------------------ */
/* Arranque                                                           */
/* ------------------------------------------------------------------ */
async function main() {
  try {
    await DB.init();
  } catch (err) {
    $('#loader p').textContent = `No se pudo cargar SQLite: ${err.message}`;
    return;
  }
  setupChartDefaults();
  syncThemeUI();
  initLive();
  updateClock();
  Data.onChange(rebuildAll);

  $('#loader').classList.add('hide');
  showView(location.hash.slice(1) || 'inicio', { scroll: false });

  window.addEventListener('hashchange', () => showView(location.hash.slice(1)));
  document.addEventListener('visibilitychange', schedule);
  $('#btnTheme').addEventListener('click', toggleTheme);
  $('#btnLive').addEventListener('click', () => setRunning(!live.running));

  Home.setLiveBadge(false);
  setTimeout(() => setRunning(true), 1900);   // arranca al terminar la animación de entrada
}

main();
