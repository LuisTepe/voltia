# ⚡ Voltix — prototipo de monitor de consumo eléctrico

Página estática (HTML + CSS + JS) que simula una app para medir el consumo de electricidad.
Los datos simulados se guardan en **SQLite**, que corre dentro del navegador gracias a
[sql.js](https://github.com/sql-js/sql.js) (SQLite compilado a WebAssembly).

## Cómo funciona el almacenamiento

- Al abrir la página por primera vez se crea una base SQLite con 7 días de lecturas por hora.
- Con **▶ Iniciar simulación** cada 2 s se insertan nuevas lecturas (1 por dispositivo, 15 min simulados).
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
index.html      → maquetación
css/styles.css  → estilos, tema claro/oscuro y animaciones
js/db.js        → SQLite: esquema, datos simulados, consultas y persistencia
js/app.js       → gráficas (Chart.js), tablas dinámicas, consola SQL y simulación
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

- Tarifa: `TARIFA` en `js/app.js` (MXN por kWh, valor de ejemplo).
- Velocidad de simulación: `TICK_MS` en `js/app.js`, `STEP_MINUTES` en `js/db.js`.
- Dispositivos y perfiles de consumo: `DEVICES` y `simulatePower()` en `js/db.js`.
  Después de cambiarlos usa **Reiniciar datos** (o cambia `STORAGE_KEY`) para regenerar la base.
