// Capa de datos: SQLite en el navegador con sql.js (WebAssembly).
// La base se guarda en localStorage para que sobreviva a recargas de página.

const SQLJS_CDN = 'https://cdn.jsdelivr.net/npm/sql.js@1.10.3/dist/';
const STORAGE_KEY = 'voltix.sqlite.v1';
const STEP_MINUTES = 15;          // cada "tick" de la simulación avanza 15 min
const SEED_DAYS = 7;              // días de historial inicial

let SQL;
let db;

export const DEVICES = [
  { id: 1, nombre: 'Refrigerador',        categoria: 'Cocina',          nominal: 150 },
  { id: 2, nombre: 'Aire acondicionado',  categoria: 'Climatización',   nominal: 1300 },
  { id: 3, nombre: 'Iluminación',         categoria: 'Iluminación',     nominal: 220 },
  { id: 4, nombre: 'Lavadora',            categoria: 'Lavandería',      nominal: 500 },
  { id: 5, nombre: 'Computadora',         categoria: 'Oficina',         nominal: 180 },
  { id: 6, nombre: 'Televisión',          categoria: 'Entretenimiento', nominal: 110 },
  { id: 7, nombre: 'Calentador de agua',  categoria: 'Baño',            nominal: 1500 },
];

const SCHEMA = `
CREATE TABLE dispositivos (
  id                  INTEGER PRIMARY KEY,
  nombre              TEXT NOT NULL,
  categoria           TEXT NOT NULL,
  potencia_nominal_w  REAL NOT NULL,
  activo              INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE lecturas (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  dispositivo_id  INTEGER NOT NULL REFERENCES dispositivos(id),
  fecha_hora      TEXT NOT NULL,          -- 'YYYY-MM-DD HH:MM'
  potencia_w      REAL NOT NULL,
  energia_kwh     REAL NOT NULL
);
CREATE INDEX idx_lecturas_fecha ON lecturas(fecha_hora);
CREATE INDEX idx_lecturas_disp  ON lecturas(dispositivo_id);
CREATE TABLE config (clave TEXT PRIMARY KEY, valor TEXT);
`;

/* ------------------------------------------------------------------ */
/* Utilidades                                                         */
/* ------------------------------------------------------------------ */
const pad = n => String(n).padStart(2, '0');
export const toStamp = d =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
export const fromStamp = s => {
  const [date, time] = s.split(' ');
  const [y, m, d] = date.split('-').map(Number);
  const [hh, mm] = time.split(':').map(Number);
  return new Date(y, m - 1, d, hh, mm);
};

function toBase64(bytes) {
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}
function fromBase64(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Perfil de consumo simulado (W) de cada dispositivo según la hora. */
function simulatePower(deviceId, date) {
  const h = date.getHours() + date.getMinutes() / 60;
  const r = Math.random();
  const weekend = [0, 6].includes(date.getDay());
  switch (deviceId) {
    case 1: return 105 + r * 75;                                             // ciclos del compresor
    case 2: return h >= 13 && h < 20 ? 850 + r * 500 : (h >= 22 || h < 1) ? 250 + r * 200 : 0;
    case 3: return h >= 18.5 && h < 23.5 ? 150 + r * 80 : h >= 6 && h < 7.5 ? 55 + r * 30 : 3 * r;
    case 4: return (weekend ? h >= 9 && h < 13 : h >= 10 && h < 11.5) && r > 0.45 ? 400 + r * 150 : 0;
    case 5: return !weekend && h >= 9 && h < 18 ? 115 + r * 75 : 6 + r * 4;
    case 6: return h >= 19 && h < 24 ? 80 + r * 35 : weekend && h >= 11 && h < 15 ? 90 + r * 20 : 1.5;
    case 7: return h >= 6 && h < 8 ? 1250 + r * 300 : 0;
    default: return 0;
  }
}

const round = (n, d) => Math.round(n * 10 ** d) / 10 ** d;

/* ------------------------------------------------------------------ */
/* Inicialización y persistencia                                      */
/* ------------------------------------------------------------------ */
export async function init() {
  SQL = await window.initSqlJs({ locateFile: f => SQLJS_CDN + f });
  let saved = null;
  try { saved = localStorage.getItem(STORAGE_KEY); } catch { /* almacenamiento bloqueado */ }
  if (saved) {
    try { db = new SQL.Database(fromBase64(saved)); return; }
    catch (e) { console.warn('Base guardada corrupta, se regenera.', e); }
  }
  createFresh();
}

function createFresh() {
  db = new SQL.Database();
  db.run(SCHEMA);
  const insDev = db.prepare('INSERT INTO dispositivos (id, nombre, categoria, potencia_nominal_w) VALUES (?,?,?,?)');
  DEVICES.forEach(d => insDev.run([d.id, d.nombre, d.categoria, d.nominal]));
  insDev.free();

  // Historial: lecturas cada hora durante los últimos SEED_DAYS días
  const end = new Date();
  end.setMinutes(0, 0, 0);
  const start = new Date(end.getTime() - (SEED_DAYS * 24 - 1) * 3600e3);
  start.setHours(0);           // empezar a medianoche para tener días completos
  const ins = db.prepare('INSERT INTO lecturas (dispositivo_id, fecha_hora, potencia_w, energia_kwh) VALUES (?,?,?,?)');
  db.run('BEGIN');
  for (let t = new Date(start); t <= end; t = new Date(t.getTime() + 3600e3)) {
    const stamp = toStamp(t);
    for (const d of DEVICES) {
      const w = simulatePower(d.id, t);
      ins.run([d.id, stamp, round(w, 1), round(w / 1000, 4)]);   // 1 h de lectura
    }
  }
  db.run('COMMIT');
  ins.free();
  db.run("INSERT INTO config VALUES ('reloj', ?)", [toStamp(end)]);
  persist();
}

export function persist() {
  try { localStorage.setItem(STORAGE_KEY, toBase64(db.export())); }
  catch (e) { console.warn('No se pudo guardar en localStorage', e); }
}

export function reset() {
  try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
  db.close();
  createFresh();
}

export function exportFile() {
  const blob = new Blob([db.export()], { type: 'application/vnd.sqlite3' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'voltix.sqlite';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/* ------------------------------------------------------------------ */
/* Consultas                                                          */
/* ------------------------------------------------------------------ */
export function query(sql, params = []) {
  const st = db.prepare(sql);
  st.bind(params);
  const rows = [];
  while (st.step()) rows.push(st.getAsObject());
  st.free();
  return rows;
}
const one = (sql, params) => query(sql, params)[0] || {};

export const getClock = () => one("SELECT valor FROM config WHERE clave = 'reloj'").valor;

/** Avanza la simulación: inserta una lectura por dispositivo activo. */
export function tick() {
  const next = new Date(fromStamp(getClock()).getTime() + STEP_MINUTES * 60e3);
  const stamp = toStamp(next);
  const active = query('SELECT id FROM dispositivos WHERE activo = 1');
  const ins = db.prepare('INSERT INTO lecturas (dispositivo_id, fecha_hora, potencia_w, energia_kwh) VALUES (?,?,?,?)');
  const ids = [];
  for (const { id } of active) {
    const w = simulatePower(id, next);
    ins.run([id, stamp, round(w, 1), round(w * (STEP_MINUTES / 60) / 1000, 4)]);
    ids.push(one('SELECT last_insert_rowid() AS id').id);
  }
  ins.free();
  db.run("UPDATE config SET valor = ? WHERE clave = 'reloj'", [stamp]);
  return { stamp, ids };
}

export function kpis() {
  const clock = getClock();
  const today = clock.slice(0, 10);
  const last = one('SELECT MAX(fecha_hora) AS t FROM lecturas').t;
  const prev = one('SELECT MAX(fecha_hora) AS t FROM lecturas WHERE fecha_hora < ?', [last]).t;
  const powerAt = t => one('SELECT COALESCE(SUM(potencia_w),0) AS w FROM lecturas WHERE fecha_hora = ?', [t]).w || 0;
  const peak = one(`SELECT fecha_hora AS t, SUM(potencia_w) AS w FROM lecturas
                    WHERE substr(fecha_hora,1,10) = ? GROUP BY fecha_hora ORDER BY w DESC LIMIT 1`, [today]);
  const yesterday = one(`SELECT COALESCE(SUM(energia_kwh),0) AS k FROM lecturas
                         WHERE substr(fecha_hora,1,10) = date(?, '-1 day')`, [today]).k;
  return {
    clock,
    powerNow: powerAt(last),
    powerPrev: prev ? powerAt(prev) : 0,
    todayKwh: one('SELECT COALESCE(SUM(energia_kwh),0) AS k FROM lecturas WHERE substr(fecha_hora,1,10) = ?', [today]).k,
    yesterdayKwh: yesterday,
    weekKwh: one(`SELECT COALESCE(SUM(energia_kwh),0) AS k FROM lecturas
                  WHERE substr(fecha_hora,1,10) >= date(?, '-6 day')`, [today]).k,
    peak,
    readings: one('SELECT COUNT(*) AS n FROM lecturas').n,
  };
}

export const recentTotals = n => query(`
  SELECT fecha_hora AS t, SUM(potencia_w) AS w FROM lecturas
  GROUP BY fecha_hora ORDER BY fecha_hora DESC LIMIT ?`, [n]).reverse();

export const daily = (n = 7) => query(`
  SELECT substr(fecha_hora,1,10) AS dia, SUM(energia_kwh) AS kwh FROM lecturas
  GROUP BY dia ORDER BY dia DESC LIMIT ?`, [n]).reverse();

export const hourly = () => query(`
  SELECT CAST(substr(fecha_hora,12,2) AS INTEGER) AS h,
         SUM(energia_kwh) / COUNT(DISTINCT substr(fecha_hora,1,10)) AS kwh
  FROM lecturas GROUP BY h ORDER BY h`);

export const byDevice = () => query(`
  SELECT d.id, d.nombre, d.categoria, d.potencia_nominal_w AS nominal, d.activo,
         COALESCE(SUM(l.energia_kwh),0) AS kwh
  FROM dispositivos d LEFT JOIN lecturas l ON l.dispositivo_id = d.id
  GROUP BY d.id ORDER BY d.id`);

export function setActive(id, active) {
  db.run('UPDATE dispositivos SET activo = ? WHERE id = ?', [active ? 1 : 0, id]);
  persist();
}

const SORT_COLUMNS = {
  id: 'l.id', fecha_hora: 'l.fecha_hora', dispositivo: 'd.nombre',
  categoria: 'd.categoria', potencia_w: 'l.potencia_w', energia_kwh: 'l.energia_kwh',
};

export function readings({ search = '', sort = 'fecha_hora', dir = 'DESC', limit = 10, offset = 0 }) {
  const col = SORT_COLUMNS[sort] || 'l.fecha_hora';
  const order = dir === 'ASC' ? 'ASC' : 'DESC';
  const like = `%${search}%`;
  const where = 'WHERE d.nombre LIKE ? OR d.categoria LIKE ? OR l.fecha_hora LIKE ?';
  const rows = query(`
    SELECT l.id, l.fecha_hora, l.dispositivo_id, d.nombre AS dispositivo, d.categoria,
           l.potencia_w, l.energia_kwh
    FROM lecturas l JOIN dispositivos d ON d.id = l.dispositivo_id
    ${where} ORDER BY ${col} ${order}, l.id DESC LIMIT ? OFFSET ?`,
    [like, like, like, limit, offset]);
  const total = one(`SELECT COUNT(*) AS n FROM lecturas l JOIN dispositivos d ON d.id = l.dispositivo_id ${where}`,
    [like, like, like]).n;
  return { rows, total };
}

/** Ejecuta SQL libre desde la consola. Devuelve el último resultado. */
export function runSQL(sql) {
  const results = db.exec(sql);
  const changes = db.getRowsModified();
  if (changes) persist();
  return { result: results[results.length - 1] || null, changes };
}
