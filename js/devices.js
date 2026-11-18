// Pestaña "Dispositivos": tarjetas con consumo en vivo y encendido/apagado.
import { live, todayByDevice, setDeviceActive } from './live.js';
import { $, $$, fmt, esc, TARIFA, money, colorFor, countUp } from './ui.js';

function render() {
  const devs = todayByDevice();
  $('#deviceGrid').innerHTML = devs.map((d, i) => `
    <article class="device card row-in ${d.activo ? '' : 'off'}" data-id="${d.id}"
      style="--c:${colorFor(d.id)};animation-delay:${i * 60}ms">
      <div class="device-top">
        <span class="device-icon" aria-hidden="true">${d.icon}</span>
        <label class="switch" title="Encender / apagar">
          <input type="checkbox" ${d.activo ? 'checked' : ''} aria-label="Encender ${esc(d.nombre)}">
          <span class="slider"></span>
        </label>
      </div>
      <h3>${esc(d.nombre)}</h3>
      <p class="device-meta">${esc(d.categoria)} · ${fmt(d.nominal)} W nominal</p>
      <div class="device-now"><strong data-k="now">0</strong><small>W ahora</small></div>
      <div class="meter" aria-hidden="true"><span data-k="meter"></span></div>
      <div class="device-foot">
        <span>Hoy <strong data-k="today">0</strong> kWh</span>
        <span data-k="cost">$0.00</span>
      </div>
    </article>`).join('');
  update(devs);
}

function update(devs = todayByDevice()) {
  devs.forEach(d => {
    const card = $(`#deviceGrid .device[data-id="${d.id}"]`);
    if (!card) return;
    countUp(card.querySelector('[data-k=now]'), d.power, 0, 700);
    countUp(card.querySelector('[data-k=today]'), d.kwh, 2, 700);
    card.querySelector('[data-k=cost]').textContent = money(d.kwh * TARIFA);
    card.querySelector('[data-k=meter]').style.width = `${Math.min(100, (d.power / (d.nominal * 1.2)) * 100)}%`;
  });
  const on = devs.filter(d => d.activo).length;
  $('#devSummary').textContent = `${on} de ${devs.length} encendidos · ${fmt(devs.reduce((a, d) => a + d.power, 0))} W en total`;
}

export function build() {
  render();
  $('#deviceGrid').addEventListener('change', e => {
    if (!e.target.matches('input[type=checkbox]')) return;
    const card = e.target.closest('.device');
    card.classList.toggle('off', !e.target.checked);
    setDeviceActive(Number(card.dataset.id), e.target.checked);
  });
}

export function enter() { render(); }
export function tick() { update(); }
