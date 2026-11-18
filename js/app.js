import * as DB from './db.js';

const TARIFA = 2.85;        // MXN por kWh (valor de ejemplo)
const TICK_MS = 1000;       // cada segundo llega una medición en vivo
const LIVE_STEP_MIN = 1;    // cada medición equivale a 1 minuto simulado
const LIVE_POINTS = 48;     // puntos visibles en la gráfica en vivo
const COLORS = ['#22d3ee', '#f59e0b', '#a78bfa', '#34d399', '#f472b6', '#60a5fa', '#f87171'];

const $ = s => document.querySelector(s);
const fmt = (n, d = 0) => Number(n || 0).toLocaleString('es-MX', { minimumFractionDigits: d, maximumFractionDigits: d });
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const cssVar = v => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
const colorFor = id => COLORS[(id - 1) % COLORS.length];
const DAY_FMT = new Intl.DateTimeFormat('es-MX', { weekday: 'short', day: 'numeric' });
const CLOCK_FMT = new Intl.DateTimeFormat('es-MX', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

const state = {
  running: false, timer: null,
  sort: 'fecha_hora', dir: 'DESC', page: 1, pageSize: 10, search: '',
  liveX: 0, liveLabels: new Map(),
};
const charts = {};

/**
 * Estado del modo "en vivo". Todo vive en memoria: la base SQLite solo se lee
 * al arrancar (línea base) y nunca se escribe desde aquí.
 */
const live = {
  time: null,          // reloj simulado
  power: {},           // W actuales por dispositivo
  extra: {},           // kWh acumulados en vivo por dispositivo
  extraByDay: {},      // kWh acumulados en vivo por día
  active: new Set(),   // dispositivos encendidos
  base: null,          // KPIs de la base al arrancar
  dailyBase: [],       // consumo diario de la base
  devBase: [],         // consumo por dispositivo de la base
  peak: { w: 0, t: '' },
  prevTotal: 0,
};

function initLive() {
  const k = DB.kpis();
  live.base = k;
  live.time = DB.fromStamp(k.clock);
  live.extra = {};
  live.extraByDay = {};
  live.dailyBase = DB.daily(7);
  live.devBase = DB.byDevice();
  live.active = new Set(live.devBase.filter(d => d.activo).map(d => d.id));
  live.power = {};
  DB.query(`SELECT dispositivo_id AS id, potencia_w AS w FROM lecturas
            WHERE fecha_hora = (SELECT MAX(fecha_hora) FROM lecturas)`)
    .forEach(r => { live.power[r.id] = r.w; });
  live.prevTotal = k.powerNow;
  live.peak = k.peak.t ? { w: k.peak.w, t: k.peak.t.slice(11) } : { w: 0, t: '' };
}

/* ------------------------------------------------------------------ */
/* Animación de números                                               */
/* ------------------------------------------------------------------ */
function countUp(el, to, decimals = 0, duration = 1000) {
  const from = parseFloat(el.dataset.v || '0');
  el.dataset.v = to;
  const t0 = performance.now();
  const step = now => {
    const p = Math.min(1, (now - t0) / duration);
    const eased = 1 - Math.pow(1 - p, 3);
    el.textContent = fmt(from + (to - from) * eased, decimals);
    if (p < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

function bump(el) {
  const card = el.closest('.kpi');
  card.classList.remove('bump');
  void card.offsetWidth;   // reinicia la animación
  card.classList.add('bump');
}

/* ------------------------------------------------------------------ */
/* KPIs                                                               */
/* ------------------------------------------------------------------ */
function renderKpis(animateBump = false) {
  const k = DB.kpis();
  countUp($('#kpiPower'), k.powerNow);
  countUp($('#kpiToday'), k.todayKwh, 2);
  countUp($('#kpiCost'), k.todayKwh * TARIFA, 2);
  countUp($('#kpiWeek'), k.weekKwh, 1);

  const delta = k.powerNow - k.powerPrev;
  $('#kpiPowerSub').innerHTML = k.powerPrev
    ? `<span style="color:${delta >= 0 ? 'var(--bad)' : 'var(--good)'}">${delta >= 0 ? '▲' : '▼'} ${fmt(Math.abs(delta))} W</span> vs. lectura anterior`
    : '&nbsp;';
  $('#kpiTodaySub').textContent = k.peak.t ? `Pico: ${fmt(k.peak.w)} W a las ${k.peak.t.slice(11)}` : '—';
  $('#kpiCostSub').textContent = `Tarifa de ejemplo: $${fmt(TARIFA, 2)} / kWh`;
  $('#kpiWeekSub').textContent = `Ayer: ${fmt(k.yesterdayKwh, 2)} kWh · ${fmt(k.readings)} lecturas`;
  $('#simClock').textContent = CLOCK_FMT.format(DB.fromStamp(k.clock));
  countUp($('#readCount'), k.readings, 0, 600);

  if (animateBump) ['#kpiPower', '#kpiToday', '#kpiCost'].forEach(s => bump($(s)));
}

/* ------------------------------------------------------------------ */
/* Gráficas                                                           */
/* ------------------------------------------------------------------ */
function verticalGradient(ctx, area, color) {
  const g = ctx.createLinearGradient(0, area.top, 0, area.bottom);
  g.addColorStop(0, color + '88');
  g.addColorStop(1, color + '00');
  return g;
}

/** Colores del tema actual (se leen de las variables CSS). */
const theme = {};
function readTheme() {
  ['accent', 'muted', 'grid', 'surface', 'surface-2', 'text', 'border'].forEach(k => { theme[k] = cssVar(`--${k}`); });
}

function setupChartDefaults() {
  readTheme();
  Chart.defaults.font.family = 'Inter, system-ui, sans-serif';
  Chart.defaults.font.size = 12;
  Chart.defaults.color = theme.muted;
  Chart.defaults.borderColor = theme.grid;
  Chart.defaults.plugins.tooltip.backgroundColor = theme['surface-2'];
  Chart.defaults.plugins.tooltip.titleColor = theme.text;
  Chart.defaults.plugins.tooltip.bodyColor = theme.text;
  Chart.defaults.plugins.tooltip.borderColor = theme.border;
  Chart.defaults.plugins.tooltip.borderWidth = 1;
  Chart.defaults.plugins.tooltip.padding = 10;
  Chart.defaults.plugins.tooltip.cornerRadius = 8;
}

/** Línea en vivo: al cargar se "dibuja" punto por punto y luego cada lectura sube suavemente. */
function createLiveChart() {
  const rows = DB.recentTotals(LIVE_POINTS);
  const data = rows.map((r, i) => {
    state.liveLabels.set(i, r.t);
    return { x: i, y: r.w };
  });
  state.liveX = data.length - 1;

  const INTRO = 1800;
  const stepDelay = INTRO / data.length;
  let intro = true;
  setTimeout(() => { intro = false; }, INTRO + 400);

  const previousY = ctx => ctx.index === 0
    ? ctx.chart.scales.y.getPixelForValue(0)
    : ctx.chart.getDatasetMeta(ctx.datasetIndex).data[ctx.index - 1].getProps(['y'], true).y;

  charts.live = new Chart($('#chartLive'), {
    type: 'line',
    data: {
      datasets: [{
        label: 'Potencia total',
        data,
        borderColor: () => theme.accent,
        borderWidth: 2.5,
        tension: 0.35,
        fill: true,
        backgroundColor: c => c.chart.chartArea ? verticalGradient(c.chart.ctx, c.chart.chartArea, theme.accent) : 'transparent',
        pointRadius: 0,
        pointHoverRadius: 5,
        pointBackgroundColor: () => theme.accent,
      }],
    },
    options: {
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      animation: {
        x: {
          type: 'number', easing: 'linear',
          duration: () => (intro ? stepDelay : 700),
          from: () => (intro ? NaN : undefined),
          delay: ctx => (intro && ctx.type === 'data' ? ctx.index * stepDelay : 0),
        },
        y: {
          type: 'number',
          easing: () => (intro ? 'linear' : 'easeOutCubic'),
          duration: () => (intro ? stepDelay : 800),
          from: ctx => (intro && ctx.type === 'data' ? previousY(ctx) : undefined),
          delay: ctx => (intro && ctx.type === 'data' ? ctx.index * stepDelay : 0),
        },
      },
      scales: {
        x: {
          type: 'linear',
          grid: { display: false },
          ticks: {
            maxTicksLimit: 8,
            callback: v => (Number.isInteger(v) && state.liveLabels.has(v) ? state.liveLabels.get(v).slice(5).replace('-', '/') : ''),
          },
        },
        y: { beginAtZero: true, ticks: { callback: v => `${fmt(v)} W` } },
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            title: items => state.liveLabels.get(items[0].raw.x) || '',
            label: item => ` ${fmt(item.raw.y)} W`,
          },
        },
      },
    },
  });
}

function pushLivePoint(stamp, watts) {
  const ds = charts.live.data.datasets[0].data;
  state.liveX += 1;
  state.liveLabels.set(state.liveX, stamp);
  ds.push({ x: state.liveX, y: watts });
  if (ds.length > LIVE_POINTS) {
    const removed = ds.shift();
    state.liveLabels.delete(removed.x);
  }
  charts.live.update();
}

function createDailyChart() {
  const rows = DB.daily(7);
  let delayed = false;
  charts.daily = new Chart($('#chartDaily'), {
    type: 'bar',
    data: {
      labels: rows.map(r => DAY_FMT.format(DB.fromStamp(r.dia + ' 00:00'))),
      datasets: [{
        label: 'kWh',
        data: rows.map(r => r.kwh),
        backgroundColor: c => {
          const last = c.dataIndex === c.dataset.data.length - 1;
          return last ? theme.accent : COLORS[5] + 'cc';
        },
        borderRadius: 8,
        maxBarThickness: 46,
      }],
    },
    options: {
      maintainAspectRatio: false,
      animation: {
        duration: 1100,
        easing: 'easeOutQuart',
        onComplete: () => { delayed = true; },
        delay: c => (c.type === 'data' && c.mode === 'default' && !delayed ? c.dataIndex * 140 + 300 : 0),
      },
      scales: {
        x: { grid: { display: false } },
        y: { beginAtZero: true, ticks: { callback: v => `${fmt(v)} kWh` } },
      },
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: i => ` ${fmt(i.raw, 2)} kWh · $${fmt(i.raw * TARIFA, 2)}` } },
      },
    },
  });
}

/** Barras diarias = base + lo acumulado en vivo (si cambia el día aparece una barra nueva). */
function updateDailyChart() {
  const byDay = new Map(live.dailyBase.map(r => [r.dia, r.kwh]));
  Object.entries(live.extraByDay).forEach(([d, k]) => byDay.set(d, (byDay.get(d) || 0) + k));
  const rows = [...byDay.entries()].sort((a, b) => a[0].localeCompare(b[0])).slice(-7);
  charts.daily.data.labels = rows.map(([d]) => DAY_FMT.format(DB.fromStamp(d + ' 00:00')));
  charts.daily.data.datasets[0].data = rows.map(([, k]) => k);
  charts.daily.update();
}

function createHourlyChart() {
  const rows = DB.hourly();
  let delayed = false;
  charts.hourly = new Chart($('#chartHourly'), {
    type: 'bar',
    data: {
      labels: rows.map(r => `${String(r.h).padStart(2, '0')}h`),
      datasets: [{
        data: rows.map(r => r.kwh),
        // la hora actual del reloj simulado se resalta
        backgroundColor: c => (live.time && c.dataIndex === live.time.getHours()
          ? theme.accent
          : c.chart.chartArea ? verticalGradient(c.chart.ctx, c.chart.chartArea, COLORS[2]) : COLORS[2]),
        borderColor: c => (live.time && c.dataIndex === live.time.getHours() ? theme.accent : COLORS[2]),
        borderWidth: { top: 2, left: 0, right: 0, bottom: 0 },
        borderRadius: 4,
        categoryPercentage: 0.9,
        barPercentage: 0.95,
      }],
    },
    options: {
      maintainAspectRatio: false,
      animation: {
        duration: 900,
        onComplete: () => { delayed = true; },
        delay: c => (c.type === 'data' && c.mode === 'default' && !delayed ? c.dataIndex * 40 + 500 : 0),
      },
      scales: {
        x: { grid: { display: false }, ticks: { maxTicksLimit: 8, maxRotation: 0 } },
        y: { beginAtZero: true, ticks: { callback: v => fmt(v, 1) } },
      },
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: i => ` ${fmt(i.raw, 3)} kWh promedio` } },
      },
    },
  });
}

function createDevicesChart() {
  const rows = DB.byDevice();
  charts.devices = new Chart($('#chartDevices'), {
    type: 'doughnut',
    data: {
      labels: rows.map(r => r.nombre),
      datasets: [{
        data: rows.map(r => r.kwh),
        backgroundColor: rows.map(r => colorFor(r.id)),
        borderColor: () => theme.surface,
        borderWidth: 3,
        hoverOffset: 8,
      }],
    },
    options: {
      maintainAspectRatio: false,
      cutout: '68%',
      layout: { padding: { bottom: 4 } },
      animation: { animateRotate: true, animateScale: true, duration: 1400, easing: 'easeOutQuart', delay: 300 },
      plugins: {
        legend: { position: 'bottom', labels: { usePointStyle: true, pointStyle: 'circle', boxWidth: 8, padding: 12 } },
        tooltip: {
          callbacks: {
            label: i => {
              const total = i.dataset.data.reduce((a, b) => a + b, 0);
              return ` ${fmt(i.raw, 2)} kWh (${fmt((i.raw / total) * 100, 1)}%)`;
            },
          },
        },
      },
    },
  });
  countUp($('#donutTotal'), rows.reduce((a, r) => a + r.kwh, 0), 1, 1600);
}

function updateDevicesChart(rows) {
  charts.devices.data.datasets[0].data = rows.map(r => r.kwh);
  charts.devices.update();
  countUp($('#donutTotal'), rows.reduce((a, r) => a + r.kwh, 0), 1, 800);
}

/* ------------------------------------------------------------------ */
/* Tabla de dispositivos                                              */
/* ------------------------------------------------------------------ */
/** Consumo por dispositivo = base de datos + acumulado en vivo. */
const liveDeviceRows = () => live.devBase.map(r => ({ ...r, kwh: r.kwh + (live.extra[r.id] || 0) }));

function renderDevices(first = false) {
  const rows = liveDeviceRows();
  const total = rows.reduce((a, r) => a + r.kwh, 0) || 1;
  const tbody = $('#tblDevices tbody');

  if (first) {
    tbody.innerHTML = rows.map((r, i) => `
      <tr class="row-in ${r.activo ? '' : 'off'}" data-id="${r.id}" style="animation-delay:${i * 60 + 200}ms">
        <td><span class="dot" style="background:${colorFor(r.id)}"></span>${esc(r.nombre)}</td>
        <td><span class="chip">${esc(r.categoria)}</span></td>
        <td class="num">${fmt(r.nominal)}</td>
        <td class="num now" data-k="now">${fmt(live.power[r.id] || 0)} W</td>
        <td class="num" data-k="kwh">${fmt(r.kwh, 2)}</td>
        <td><div class="share"><div class="bar-track"><span class="bar" data-k="bar" style="width:0;background:${colorFor(r.id)}"></span></div><span data-k="pct">0%</span></div></td>
        <td class="center"><label class="switch" title="Encender / apagar"><input type="checkbox" ${r.activo ? 'checked' : ''} aria-label="Activo ${esc(r.nombre)}"><span class="slider"></span></label></td>
      </tr>`).join('');
    tbody.querySelectorAll('input[type=checkbox]').forEach(cb => {
      cb.addEventListener('change', e => {
        const tr = e.target.closest('tr');
        const id = Number(tr.dataset.id);
        tr.classList.toggle('off', !e.target.checked);
        DB.setActive(id, e.target.checked);   // solo guarda la preferencia encendido/apagado
        if (e.target.checked) live.active.add(id); else live.active.delete(id);
      });
    });
    // deja que la fila aparezca y luego llena las barras
    setTimeout(() => updateDeviceCells(rows, total), 450);
    return rows;
  }
  updateDeviceCells(rows, total);
  return rows;
}

function updateDeviceCells(rows, total) {
  rows.forEach(r => {
    const tr = $(`#tblDevices tr[data-id="${r.id}"]`);
    if (!tr) return;
    const pct = (r.kwh / total) * 100;
    tr.querySelector('[data-k=kwh]').textContent = fmt(r.kwh, 2);
    tr.querySelector('[data-k=now]').textContent = `${fmt(live.power[r.id] || 0)} W`;
    tr.querySelector('[data-k=bar]').style.width = `${pct}%`;
    tr.querySelector('[data-k=pct]').textContent = `${fmt(pct, 1)}%`;
  });
}

/* ------------------------------------------------------------------ */
/* Tabla de lecturas (orden, búsqueda, paginación)                    */
/* ------------------------------------------------------------------ */
function renderReadings({ animate = true, newIds = [] } = {}) {
  const { rows, total } = DB.readings({
    search: state.search, sort: state.sort, dir: state.dir,
    limit: state.pageSize, offset: (state.page - 1) * state.pageSize,
  });
  const pages = Math.max(1, Math.ceil(total / state.pageSize));
  if (state.page > pages) { state.page = pages; return renderReadings({ animate }); }

  const fresh = new Set(newIds);
  const maxW = 1800;
  $('#tblReadings tbody').innerHTML = rows.length
    ? rows.map((r, i) => {
        const isNew = fresh.has(r.id);
        const cls = isNew ? 'row-in row-new' : animate ? 'row-in' : '';
        const delay = isNew ? i * 50 : i * 30;
        return `<tr class="${cls}" style="animation-delay:${cls ? delay : 0}ms">
          <td class="mono">#${r.id}</td>
          <td>${r.fecha_hora}</td>
          <td><span class="dot" style="background:${colorFor(r.dispositivo_id)}"></span>${esc(r.dispositivo)}</td>
          <td><span class="chip">${esc(r.categoria)}</span></td>
          <td class="num"><div class="bar-cell">
            <div class="bar-track"><span class="bar" style="--w:${Math.min(100, (r.potencia_w / maxW) * 100)}%;background:${colorFor(r.dispositivo_id)};${cls ? '' : 'animation:none;width:var(--w)'}"></span></div>
            <span>${fmt(r.potencia_w, 1)}</span></div></td>
          <td class="num">${fmt(r.energia_kwh, 3)}</td>
        </tr>`;
      }).join('')
    : `<tr><td colspan="6" class="center muted" style="padding:2rem">Sin resultados para “${esc(state.search)}”</td></tr>`;

  $('#pageInfo').textContent = `Página ${fmt(state.page)} de ${fmt(pages)} · ${fmt(total)} registros`;
  $('#prevPage').disabled = state.page <= 1;
  $('#nextPage').disabled = state.page >= pages;
  document.querySelectorAll('#tblReadings th[data-col]').forEach(th => {
    th.classList.toggle('asc', th.dataset.col === state.sort && state.dir === 'ASC');
    th.classList.toggle('desc', th.dataset.col === state.sort && state.dir === 'DESC');
  });
}

function bindReadingsControls() {
  document.querySelectorAll('#tblReadings th[data-col]').forEach(th => {
    th.addEventListener('click', () => {
      const col = th.dataset.col;
      if (state.sort === col) state.dir = state.dir === 'ASC' ? 'DESC' : 'ASC';
      else { state.sort = col; state.dir = ['fecha_hora', 'id', 'potencia_w', 'energia_kwh'].includes(col) ? 'DESC' : 'ASC'; }
      state.page = 1;
      renderReadings();
    });
  });
  let t;
  $('#search').addEventListener('input', e => {
    clearTimeout(t);
    t = setTimeout(() => { state.search = e.target.value.trim(); state.page = 1; renderReadings(); }, 220);
  });
  $('#pageSize').addEventListener('change', e => { state.pageSize = Number(e.target.value); state.page = 1; renderReadings(); });
  $('#prevPage').addEventListener('click', () => { state.page -= 1; renderReadings(); });
  $('#nextPage').addEventListener('click', () => { state.page += 1; renderReadings(); });
}

/* ------------------------------------------------------------------ */
/* Consola SQL                                                        */
/* ------------------------------------------------------------------ */
const SQL_EXAMPLES = [
  ['Consumo por dispositivo', `SELECT d.nombre, ROUND(SUM(l.energia_kwh), 2) AS kwh,
       ROUND(SUM(l.energia_kwh) * ${TARIFA}, 2) AS costo_mxn
FROM lecturas l JOIN dispositivos d ON d.id = l.dispositivo_id
GROUP BY d.nombre ORDER BY kwh DESC;`],
  ['Top 10 picos', `SELECT fecha_hora, ROUND(SUM(potencia_w)) AS watts_totales
FROM lecturas GROUP BY fecha_hora
ORDER BY watts_totales DESC LIMIT 10;`],
  ['Consumo por día', `SELECT substr(fecha_hora, 1, 10) AS dia, ROUND(SUM(energia_kwh), 2) AS kwh
FROM lecturas GROUP BY dia ORDER BY dia DESC;`],
  ['Esquema', `SELECT name, sql FROM sqlite_master WHERE type = 'table';`],
];

function bindSqlConsole() {
  const input = $('#sqlInput');
  input.value = SQL_EXAMPLES[0][1];
  $('#sqlExamples').innerHTML = SQL_EXAMPLES.map((e, i) => `<button data-i="${i}">${esc(e[0])}</button>`).join('');
  $('#sqlExamples').addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b) return;
    input.value = SQL_EXAMPLES[b.dataset.i][1];
    runSql();
  });
  $('#btnRunSql').addEventListener('click', runSql);
  input.addEventListener('keydown', e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); runSql(); } });
}

function runSql() {
  const status = $('#sqlStatus');
  const t0 = performance.now();
  try {
    const { result, changes } = DB.runSQL($('#sqlInput').value);
    const ms = (performance.now() - t0).toFixed(1);
    status.classList.remove('err');
    if (!result) {
      $('#tblSql thead').innerHTML = '';
      $('#tblSql tbody').innerHTML = '';
      status.textContent = `OK · ${changes} fila(s) modificadas · ${ms} ms`;
      if (changes) buildDashboard();   // la consola sí puede modificar la base
      return;
    }
    const rows = result.values.slice(0, 200);
    $('#tblSql thead').innerHTML = `<tr>${result.columns.map(c => `<th>${esc(c)}</th>`).join('')}</tr>`;
    $('#tblSql tbody').innerHTML = rows.map((r, i) =>
      `<tr class="row-in" style="animation-delay:${Math.min(i, 20) * 30}ms">${r.map(v =>
        `<td class="${typeof v === 'number' ? 'num' : ''}">${v === null ? '<span class="muted">NULL</span>' : esc(typeof v === 'number' && !Number.isInteger(v) ? fmt(v, 3) : v)}</td>`).join('')}</tr>`).join('');
    status.textContent = `${result.values.length} fila(s)${result.values.length > 200 ? ' (mostrando 200)' : ''} · ${ms} ms`;
  } catch (err) {
    status.classList.add('err');
    status.textContent = `Error: ${err.message}`;
  }
}

/* ------------------------------------------------------------------ */
/* Simulación                                                         */
/* ------------------------------------------------------------------ */
/* Simulación en tiempo real: solo memoria, la base de datos no se modifica. */
function tick() {
  live.time = new Date(live.time.getTime() + LIVE_STEP_MIN * 60e3);
  const stamp = DB.toStamp(live.time);
  const day = stamp.slice(0, 10);
  let total = 0;

  for (const d of DB.DEVICES) {
    const target = live.active.has(d.id) ? DB.simulatePower(d.id, live.time) : 0;
    const prev = live.power[d.id] ?? target;
    const w = prev + (target - prev) * 0.45;          // suaviza para que la curva fluya
    live.power[d.id] = w;
    total += w;
    const kwh = (w * LIVE_STEP_MIN) / 60 / 1000;
    live.extra[d.id] = (live.extra[d.id] || 0) + kwh;
    live.extraByDay[day] = (live.extraByDay[day] || 0) + kwh;
  }

  if (day !== live.base.clock.slice(0, 10) && live.peak.day !== day) live.peak = { w: 0, t: '', day };
  if (total > live.peak.w) live.peak = { w: total, t: stamp.slice(11), day };

  pushLivePoint(stamp, total);
  renderLiveKpis(total, day);
  updateDailyChart();
  charts.hourly.update();                               // mueve el resaltado de la hora actual
  const rows = renderDevices();
  updateDevicesChart(rows);
}

function renderLiveKpis(total, day) {
  const b = live.base;
  const today = (day === b.clock.slice(0, 10) ? b.todayKwh : 0) + (live.extraByDay[day] || 0);
  const week = b.weekKwh + Object.values(live.extraByDay).reduce((a, k) => a + k, 0);
  countUp($('#kpiPower'), total, 0, 800);
  countUp($('#kpiToday'), today, 2, 800);
  countUp($('#kpiCost'), today * TARIFA, 2, 800);
  countUp($('#kpiWeek'), week, 1, 800);

  const delta = total - live.prevTotal;
  live.prevTotal = total;
  $('#kpiPowerSub').innerHTML = `<span style="color:${delta >= 0 ? 'var(--bad)' : 'var(--good)'}">${delta >= 0 ? '▲' : '▼'} ${fmt(Math.abs(delta))} W</span> vs. hace 1 min`;
  $('#kpiTodaySub').textContent = live.peak.t ? `Pico: ${fmt(live.peak.w)} W a las ${live.peak.t}` : '—';
  $('#simClock').textContent = CLOCK_FMT.format(live.time);
}

function toggleSim(force) {
  state.running = force ?? !state.running;
  const btn = $('#btnSim');
  btn.textContent = state.running ? '⏸ Pausar en vivo' : '▶ Reanudar en vivo';
  btn.classList.toggle('running', state.running);
  $('#liveBadge').classList.toggle('on', state.running);
  $('#liveText').textContent = state.running ? 'en vivo · simulado, no se guarda' : 'en pausa';
  clearInterval(state.timer);
  if (state.running) { tick(); state.timer = setInterval(tick, TICK_MS); }
}

/* ------------------------------------------------------------------ */
/* Tema claro / oscuro                                                */
/* ------------------------------------------------------------------ */
function updateThemeButton() {
  const dark = document.documentElement.dataset.theme === 'dark';
  const label = dark ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro';
  $('#btnTheme').setAttribute('aria-label', label);
  $('#btnTheme').title = label;
}

function toggleTheme() {
  const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  try { localStorage.setItem('voltix.theme', next); } catch { /* sin almacenamiento */ }
  updateThemeButton();
  setupChartDefaults();           // vuelve a leer las variables CSS
  Object.values(charts).forEach(c => {
    // las escalas guardan los colores al crearse: se actualizan explícitamente
    Object.values(c.options.scales || {}).forEach(s => {
      if (s.ticks) s.ticks.color = theme.muted;
      if (s.grid) s.grid.color = theme.grid;
    });
    if (c.options.plugins?.legend?.labels) c.options.plugins.legend.labels.color = theme.muted;
    c.update('none');
  });
}

/* ------------------------------------------------------------------ */
/* Arranque                                                           */
/* ------------------------------------------------------------------ */
function buildDashboard() {
  Object.values(charts).forEach(c => c.destroy());
  state.liveLabels.clear();
  initLive();
  createLiveChart();
  createDailyChart();
  createHourlyChart();
  createDevicesChart();
  renderKpis();
  renderDevices(true);
  renderReadings();
}

async function main() {
  try {
    await DB.init();
  } catch (err) {
    $('#loader p').textContent = 'No se pudo cargar SQLite: ' + err.message;
    return;
  }
  setupChartDefaults();
  $('#loader').classList.add('hide');

  // tarjetas entran escalonadas
  document.querySelectorAll('.reveal').forEach((el, i) => {
    el.style.animationDelay = `${i * 70}ms`;
    el.classList.add('in');
  });

  buildDashboard();
  bindReadingsControls();
  bindSqlConsole();
  runSql();

  updateThemeButton();
  $('#btnTheme').addEventListener('click', toggleTheme);
  $('#btnSim').addEventListener('click', () => toggleSim());
  $('#btnExport').addEventListener('click', () => DB.exportFile());
  $('#btnReset').addEventListener('click', () => {
    if (!confirm('¿Borrar todas las lecturas y generar un historial nuevo?')) return;
    const wasRunning = state.running;
    toggleSim(false);
    DB.reset();
    state.page = 1;
    buildDashboard();
    runSql();
    if (wasRunning) setTimeout(() => toggleSim(true), 2400);
  });

  // arranca solo cuando termina la animación de entrada de la gráfica
  setTimeout(() => toggleSim(true), 2400);
}

main();
