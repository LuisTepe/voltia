# ⚡ Voltix — prototipo de monitor de consumo eléctrico

Página estática (HTML + CSS + JS) que simula una app para medir el consumo de electricidad.
Los datos simulados se guardan en **SQLite**, que corre dentro del navegador gracias a
[sql.js](https://github.com/sql-js/sql.js) (SQLite compilado a WebAssembly).

## Secciones

| Pestaña          | Qué muestra |
|------------------|-------------|
| **Inicio**       | Consumo en vivo (medidor, gráfica en tiempo real, reparto de hoy), resumen de los últimos 7 días y un consejo de ahorro. |
| **Historial**    | 7, 14 o 30 días: totales, gráfica apilada por dispositivo, lista de días comparada con el promedio y detalle por hora de cada día. |
| **Dispositivos** | Tarjetas con la potencia actual de cada aparato y un interruptor para encenderlo o apagarlo. |
| **Datos**        | Información de la base, lecturas con orden/búsqueda/paginación, consola SQL, exportar y regenerar. |

En celular la navegación es una barra inferior; en escritorio, pestañas en la barra superior.

## Cómo funciona el almacenamiento

- Al abrir la página se crea una base SQLite con **30 días de lecturas por hora que terminan hoy**.
  Si se vuelve otro día, el historial se regenera solo para seguir llegando a la fecha actual.
- El **modo en vivo** arranca solo: cada segundo simula 1 minuto de consumo y anima gráficas e indicadores.
  Todo ocurre en memoria; **no se escribe en la base** (se puede pausar con el botón).
- La base completa se serializa y se guarda en `localStorage`, así que sobrevive a recargas.
- **Exportar .sqlite** descarga el archivo real; puedes abrirlo con DB Browser for SQLite.
- Cada visitante tiene **su propia copia** de la base (GitHub Pages no tiene servidor, no se comparte).

### Tablas

| Tabla          | Columnas                                                        |
|----------------|-----------------------------------------------------------------|
| `dispositivos` | id, nombre, categoria, potencia_nominal_w, activo               |
| `lecturas`     | id, dispositivo_id, fecha_hora, potencia_w, energia_kwh         |
| `config`       | clave, valor (guarda el reloj de la simulación)                 |

## Estructura

```
index.html       → maquetación de las 4 pestañas
css/styles.css   → estilos (mobile-first), tema claro/oscuro y animaciones
js/db.js         → SQLite: esquema, historial simulado, consultas y persistencia
js/live.js       → simulación en tiempo real (solo memoria)
js/ui.js         → utilidades: formato, fechas, tema y gráficas
js/home.js       → pestaña Inicio
js/history.js    → pestaña Historial
js/devices.js    → pestaña Dispositivos
js/data.js       → pestaña Datos (tabla de lecturas y consola SQL)
js/app.js        → arranque, navegación por pestañas y reloj en vivo
```

## Probar en local

sql.js descarga un archivo `.wasm`, así que hay que servir la carpeta por HTTP (no abrir el HTML con doble clic):

```bash
python -m http.server 5173
```

Luego abre http://localhost:5173

## Deploy en GitHub Pages

1. Crea un repositorio en GitHub (por ejemplo `voltix`).
2. Sube estos archivos:
   ```bash
   git init
   git add .
   git commit -m "Prototipo Voltix"
   git branch -M main
   git remote add origin https://github.com/TU_USUARIO/voltix.git
   git push -u origin main
   ```
3. En el repo: **Settings → Pages → Build and deployment → Source: Deploy from a branch**,
   rama `main`, carpeta `/ (root)` → **Save**.
4. En 1–2 minutos estará en `https://TU_USUARIO.github.io/voltix/`.

El archivo `.nojekyll` evita que GitHub procese el sitio con Jekyll.

## Personalizar

- Tarifa: `TARIFA` en `js/ui.js` (MXN por kWh, valor de ejemplo).
- Velocidad del modo en vivo: `LIVE.TICK_MS` y `LIVE.STEP_MIN` en `js/live.js`.
- Días de historial: `SEED_DAYS` en `js/db.js`.
- Dispositivos y perfiles de consumo: `DEVICES` y `simulatePower()` en `js/db.js`.
  Después de cambiarlos usa **Regenerar historial** (pestaña Datos) o cambia `STORAGE_KEY`.
