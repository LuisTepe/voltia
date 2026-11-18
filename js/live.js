// Simulación de consumo en tiempo real. Todo vive en memoria:
// la base SQLite solo se lee para tener el historial; nunca se escribe desde aquí.
import * as DB from './db.js';
import { dayOf } from './ui.js';

export const LIVE = { TICK_MS: 1000, STEP_MIN: 1, POINTS: 40, GAUGE_MAX: 3500 };

export const live = {
  time: null, running: false, ticks: 0,
  devices: [], active: new Set(), power: {},
  baseDay: '', baseToday: {},
  extra: {},       // { 'YYYY-MM-DD': { idDispositivo: kWh } } acumulado en vivo
  extraHour: {},   // { 'YYYY-MM-DD': { hora: kWh } }
  peak: { w: 0, t: '', day: '' },
  prevTotal: 0,
  series: [],      // puntos {x: minuto, y: W} de la gráfica en vivo
};

export const today = () => dayOf(live.time);
export const currentTotal = () => live.series.at(-1)?.y ?? 0;

/** Calcula la potencia de cada dispositivo para un instante (suavizada para que la curva fluya). */
function stepPower(t) {
  let total = 0;
  for (const d of live.devices) {
    const on = live.active.has(d.id);
    const target = on ? DB.simulatePower(d.id, t) : 0;
    const prev = live.power[d.id] ?? target;
    const w = prev + (target - prev) * (on ? 0.45 : 0.85);   // al apagar, cae rápido
    live.power[d.id] = w;
    total += w;
  }
  return total;
}

export function initLive() {
  const now = new Date();
  now.setSeconds(0, 0);
  live.devices = DB.devices();
  live.active = new Set(live.devices.filter(d => d.activo).map(d => d.id));
  live.power = {};
  live.extra = {};
  live.extraHour = {};
  live.series = [];
  // "calienta" la gráfica con los minutos previos (sin sumar energía: ya está en la base)
  for (let i = LIVE.POINTS; i > 0; i--) {
    const t = new Date(now.getTime() - i * 60e3);
    live.series.push({ x: t.getTime() / 60e3, y: stepPower(t) });
  }
  live.time = now;
  live.baseDay = dayOf(now);
  live.baseToday = Object.fromEntries(DB.dayByDevice(live.baseDay).map(r => [r.id, r.kwh]));
  const p = DB.peakForDay(live.baseDay);
  live.peak = { w: p.w || 0, t: p.t ? p.t.slice(11) : '', day: live.baseDay };
  live.prevTotal = currentTotal();
  live.ticks = 0;
}

/** Avanza un paso (1 minuto simulado). */
export function advance() {
  live.prevTotal = currentTotal();
  live.time = new Date(live.time.getTime() + LIVE.STEP_MIN * 60e3);
  const total = stepPower(live.time);
  const day = today();
  const hour = live.time.getHours();
  const byDev = (live.extra[day] ||= {});
  const byHour = (live.extraHour[day] ||= {});
  for (const d of live.devices) {
    const kwh = (live.power[d.id] * LIVE.STEP_MIN) / 60 / 1000;
    byDev[d.id] = (byDev[d.id] || 0) + kwh;
    byHour[hour] = (byHour[hour] || 0) + kwh;
  }
  if (live.peak.day !== day) live.peak = { w: 0, t: '', day };
  if (total > live.peak.w) live.peak = { w: total, t: DB.toStamp(live.time).slice(11), day };
  live.series.push({ x: live.time.getTime() / 60e3, y: total });
  if (live.series.length > LIVE.POINTS) live.series.shift();
  live.ticks += 1;
  return total;
}

/** Consumo de hoy por dispositivo = base de datos + acumulado en vivo. */
export function todayByDevice(day = today()) {
  const base = day === live.baseDay ? live.baseToday : {};
  const extra = live.extra[day] || {};
  return live.devices.map(d => ({ ...d, kwh: (base[d.id] || 0) + (extra[d.id] || 0), power: live.power[d.id] || 0 }));
}
export const todayTotal = () => todayByDevice().reduce((a, d) => a + d.kwh, 0);

export function setDeviceActive(id, on) {
  DB.setActive(id, on);                // solo guarda la preferencia encendido/apagado
  if (on) live.active.add(id); else live.active.delete(id);
  const d = live.devices.find(x => x.id === id);
  if (d) d.activo = on ? 1 : 0;
}
