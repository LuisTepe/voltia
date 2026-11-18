// Pestaña "Datos": la base SQLite (lecturas, consola SQL, exportar y regenerar).
import * as DB from './db.js';
import { $, $$, fmt, esc, TARIFA, colorFor, countUp, shortDate } from './ui.js';

const state = { sort: 'fecha_hora', dir: 'DESC', page: 1, pageSize: 10, search: '' };
let onDataChanged = () => {};
export function onChange(fn) { onDataChanged = fn; }

/* ---------- Información de la base ---------- */
function renderInfo() {
  const s = DB.stats();
  countUp($('#dbRows'), s.n, 0, 700);
  $('#dbFrom').textContent = s.desde ? shortDate(s.desde.slice(0, 10)) : '—';
  $('#dbTo').textContent = s.hasta ? shortDate(s.hasta.slice(0, 10)) : '—';
  $('#dbSize').textContent = `${fmt(DB.sizeBytes() / 1024)} KB`;
}

/* ---------- Tabla de lecturas ---------- */
function renderReadings(animate = true) {
  const { rows, total } = DB.readings({
    search: state.search, sort: state.sort, dir: state.dir,
    limit: state.pageSize, offset: (state.page - 1) * state.pageSize,
  });
  const pages = Math.max(1, Math.ceil(total / state.pageSize));
  if (state.page > pages) { state.page = pages; return renderReadings(animate); }

  $('#tblReadings tbody').innerHTML = rows.length
    ? rows.map((r, i) => `
      <tr class="${animate ? 'row-in' : ''}" style="animation-delay:${i * 25}ms">
        <td class="mono hide-sm">#${r.id}</td>
        <td>${r.fecha_hora}</td>
        <td><span class="dot" style="background:${colorFor(r.dispositivo_id)}"></span>${esc(r.dispositivo)}</td>
        <td class="hide-sm"><span class="chip">${esc(r.categoria)}</span></td>
        <td class="num">${fmt(r.potencia_w, 1)}</td>
        <td class="num">${fmt(r.energia_kwh, 3)}</td>
      </tr>`).join('')
    : `<tr><td colspan="6" class="empty">Sin resultados para “${esc(state.search)}”</td></tr>`;

  $('#pageInfo').textContent = `${fmt(state.page)} / ${fmt(pages)} · ${fmt(total)} registros`;
  $('#prevPage').disabled = state.page <= 1;
  $('#nextPage').disabled = state.page >= pages;
  $$('#tblReadings th[data-col]').forEach(th => {
    th.classList.toggle('asc', th.dataset.col === state.sort && state.dir === 'ASC');
    th.classList.toggle('desc', th.dataset.col === state.sort && state.dir === 'DESC');
    th.setAttribute('aria-sort', th.dataset.col === state.sort ? (state.dir === 'ASC' ? 'ascending' : 'descending') : 'none');
  });
}

function bindReadings() {
  $$('#tblReadings th[data-col]').forEach(th => {
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

/* ---------- Consola SQL ---------- */
const SQL_EXAMPLES = [
  ['Consumo por dispositivo', `SELECT d.nombre, ROUND(SUM(l.energia_kwh), 2) AS kwh,
       ROUND(SUM(l.energia_kwh) * ${TARIFA}, 2) AS costo_mxn
FROM lecturas l JOIN dispositivos d ON d.id = l.dispositivo_id
GROUP BY d.nombre ORDER BY kwh DESC;`],
  ['Consumo por día', `SELECT substr(fecha_hora, 1, 10) AS dia, ROUND(SUM(energia_kwh), 2) AS kwh
FROM lecturas GROUP BY dia ORDER BY dia DESC;`],
  ['Top 10 picos', `SELECT fecha_hora, ROUND(SUM(potencia_w)) AS watts_totales
FROM lecturas GROUP BY fecha_hora
ORDER BY watts_totales DESC LIMIT 10;`],
  ['Esquema', `SELECT name, sql FROM sqlite_master WHERE type = 'table';`],
];

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
      if (changes) { onDataChanged(); renderInfo(); renderReadings(false); }
      return;
    }
    const rows = result.values.slice(0, 200);
    $('#tblSql thead').innerHTML = `<tr>${result.columns.map(c => `<th>${esc(c)}</th>`).join('')}</tr>`;
    $('#tblSql tbody').innerHTML = rows.map((r, i) =>
      `<tr class="row-in" style="animation-delay:${Math.min(i, 20) * 25}ms">${r.map(v =>
        `<td class="${typeof v === 'number' ? 'num' : ''}">${v === null ? '<span class="muted">NULL</span>' : esc(typeof v === 'number' && !Number.isInteger(v) ? fmt(v, 3) : v)}</td>`).join('')}</tr>`).join('');
    status.textContent = `${result.values.length} fila(s)${result.values.length > 200 ? ' (mostrando 200)' : ''} · ${ms} ms`;
  } catch (err) {
    status.classList.add('err');
    status.textContent = `Error: ${err.message}`;
  }
}

function bindSql() {
  const input = $('#sqlInput');
  input.value = SQL_EXAMPLES[0][1];
  $('#sqlExamples').innerHTML = SQL_EXAMPLES.map((e, i) => `<button type="button" data-i="${i}">${esc(e[0])}</button>`).join('');
  $('#sqlExamples').addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b) return;
    input.value = SQL_EXAMPLES[b.dataset.i][1];
    runSql();
  });
  $('#btnRunSql').addEventListener('click', runSql);
  input.addEventListener('keydown', e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); runSql(); } });
}

/* ---------- Ciclo de vida ---------- */
export function build() {
  bindReadings();
  bindSql();
  $('#btnExport').addEventListener('click', () => DB.exportFile());
  $('#btnReset').addEventListener('click', () => {
    if (!confirm('¿Generar un historial simulado nuevo? Se reemplazarán todas las lecturas.')) return;
    DB.reset();
    state.page = 1;
    onDataChanged();
    renderInfo();
    renderReadings();
  });
  renderInfo();
  renderReadings();
  runSql();
}

export function enter() { renderInfo(); renderReadings(); }
export function tick() {}
