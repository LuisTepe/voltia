// Capa de datos: SQLite en el navegador con sql.js (WebAssembly).
// La base se guarda en localStorage. El historial simulado siempre termina
// en la fecha actual: si la base guardada es de otro día, se regenera.

const SQLJS_CDN = 'https://cdn.jsdelivr.net/npm/sql.js@1.10.3/dist/';
const STORAGE_KEY = 'voltix.sqlite.v2';
const OLD_KEYS = ['voltix.sqlite.v1', 'voltia.sqlite.v1'];
export const SEED_DAYS = 30;        // días de historial simulado (incluye hoy)

let SQL;
let db;

export const DEVICES = [
  { id: 1, nombre: 'Refrigerador',       categoria: 'Cocina',          nominal: 150,  icon: '🧊' },
  { id: 2, nombre: 'Aire acondicionado', categoria: 'Climatización',   nominal: 1300, icon: '❄️' },
  { id: 3, nombre: 'Iluminación',        categoria: 'Iluminación',     nominal: 220,  icon: '💡' },
  { id: 4, nombre: 'Lavadora',           categoria: 'Lavandería',      nominal: 500,  icon: '🧺' },
  { id: 5, nombre: 'Computadora',        categoria: 'Oficina',         nominal: 180,  icon: '💻' },
  { id: 6, nombre: 'Televisión',         categoria: 'Entretenimiento', nominal: 110,  icon: '📺' },
  { id: 7, nombre: 'Calentador de agua', categoria: 'Baño',            nominal: 1500, icon: '🚿' },
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
  fecha_hora      TEXT NOT NULL,          -- 'YYYY-MM-DD HH:MM' (lectura de 1 hora)
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
  const [date, time = '00:00'] = s.split(' ');
  const [y, m, d] = date.split('-').map(Number);
  const [hh, mm] = time.split(':').map(Number);
  return new Date(y, m - 1, d, hh, mm);
};
const dayKey = d => toStamp(d).slice(0, 10);

function toBase64(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
function fromBase64(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Número pseudoaleatorio estable (0–1) a partir de un texto: el mismo día siempre da el mismo valor. */
function hash01(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return ((h >>> 0) % 10000) / 10000;
}

/** Perfil de consumo simulado (W) de cada dispositivo según la hora y el día. */
export function simulatePower(deviceId, date) {
  const h = date.getHours() + date.getMinutes() / 60;
  const r = Math.random();
  const key = dayKey(date);
  const weekend = [0, 6].includes(date.getDay());
  const heat = 0.6 + 0.8 * hash01(key + ':calor');          // días más calurosos = más aire acondicionado
  const laundryDay = weekend || hash01(key + ':lavado') > 0.6;
  switch (deviceId) {
    case 1: return (105 + r * 75) * (0.9 + heat * 0.15);
    case 2: return h >= 13 && h < 20 ? (750 + r * 450) * heat : (h >= 22 || h < 1) ? (200 + r * 200) * heat : 0;
    case 3: return h >= 18.5 && h < 23.5 ? 150 + r * 80 : h >= 6 && h < 7.5 ? 55 + r * 30 : 3 * r;
    case 4: return laundryDay && h >= 10 && h < 12.5 && r > 0.25 ? 400 + r * 150 : 0;
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
  try {
    OLD_KEYS.forEach(k => localStorage.removeItem(k));
    saved = localStorage.getItem(STORAGE_KEY);
  } catch { /* almacenamiento bloqueado: se trabaja solo en memoria */ }

  if (saved) {
    try {
      db = new SQL.Database(fromBase64(saved));
      if ((getClock() || '').slice(0, 10) === dayKey(new Date())) return;
      // la base es de otro día: se regenera para que el historial llegue a hoy
      const prefs = query('SELECT id, activo FROM dispositivos');
      db.close();
      createFresh(prefs);
      return;
    } catch (e) {
      console.warn('Base guardada inválida, se regenera.', e);
    }
  }
  createFresh();
}

function createFresh(prefs = []) {
  const activo = Object.fromEntries(prefs.map(p => [p.id, p.activo]));
  db = new SQL.Database();
  db.run(SCHEMA);
  const insDev = db.prepare('INSERT INTO dispositivos (id, nombre, categoria, potencia_nominal_w, activo) VALUES (?,?,?,?,?)');
  DEVICES.forEach(d => insDev.run([d.id, d.nombre, d.categoria, d.nominal, activo[d.id] ?? 1]));
  insDev.free();

  // Lecturas por hora desde hace SEED_DAYS días hasta la última hora completa de hoy
  const now = new Date();
  const end = new Date(now);
  end.setMinutes(0, 0, 0);
  end.setHours(end.getHours() - 1);
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (SEED_DAYS - 1), 0, 0);

  const ins = db.prepare('INSERT INTO lecturas (dispositivo_id, fecha_hora, potencia_w, energia_kwh) VALUES (?,?,?,?)');
  db.run('BEGIN');
  for (let t = new Date(start); t <= end; t = new Date(t.getFullYear(), t.getMonth(), t.getDate(), t.getHours() + 1)) {
    const stamp = toStamp(t);
    for (const d of DEVICES) {
      if (activo[d.id] === 0) continue;
      const w = simulatePower(d.id, t);
      ins.run([d.id, stamp, round(w, 1), round(w / 1000, 4)]);
    }
  }
  db.run('COMMIT');
  ins.free();
  db.run("INSERT INTO config VALUES ('reloj', ?)", [toStamp(now)]);
  persist();
}

export function persist() {
  try { localStorage.setItem(STORAGE_KEY, toBase64(db.export())); }
  catch (e) { console.warn('No se pudo guardar en localStorage', e); }
}

export function reset() {
  const prefs = query('SELECT id, activo FROM dispositivos');
  try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
  db.close();
  createFresh(prefs);
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
const dayRange = day => [`${day} 00:00`, `${day} 23:59`];

export const getClock = () => one("SELECT valor FROM config WHERE clave = 'reloj'").valor;

export const devices = () => query(`
  SELECT id, nombre, categoria, potencia_nominal_w AS nominal, activo FROM dispositivos ORDER BY id`)
  .map(d => ({ ...d, icon: DEVICES.find(x => x.id === d.id)?.icon || '🔌' }));

/** kWh por dispositivo en un día. */
export const dayByDevice = day => query(`
  SELECT dispositivo_id AS id, SUM(energia_kwh) AS kwh FROM lecturas
  WHERE fecha_hora BETWEEN ? AND ? GROUP BY dispositivo_id`, dayRange(day));

/** kWh por día y dispositivo desde una fecha. */
export const dailyByDevice = fromDay => query(`
  SELECT substr(fecha_hora,1,10) AS dia, dispositivo_id AS id, SUM(energia_kwh) AS kwh
  FROM lecturas WHERE fecha_hora >= ? GROUP BY dia, dispositivo_id ORDER BY dia`, [`${fromDay} 00:00`]);

/** kWh por hora de un día. */
export const dayHourly = day => query(`
  SELECT CAST(substr(fecha_hora,12,2) AS INTEGER) AS h, SUM(energia_kwh) AS kwh FROM lecturas
  WHERE fecha_hora BETWEEN ? AND ? GROUP BY h ORDER BY h`, dayRange(day));

/** Hora con mayor potencia total de un día. */
export const peakForDay = day => one(`
  SELECT fecha_hora AS t, SUM(potencia_w) AS w FROM lecturas
  WHERE fecha_hora BETWEEN ? AND ? GROUP BY fecha_hora ORDER BY w DESC LIMIT 1`, dayRange(day));

export const stats = () => one(`
  SELECT COUNT(*) AS n, MIN(fecha_hora) AS desde, MAX(fecha_hora) AS hasta FROM lecturas`);

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

/** Tamaño aproximado de la base en bytes. */
export const sizeBytes = () => db.export().length;
