# Cuaderno de gastos

App web instalable para controlar ingresos y gastos a partir de los extractos del banco (CSV, Excel o PDF) o de la sincronización con tus bancos. Agrupa los movimientos por categorías, separa los traspasos entre tus propias cuentas y sigue tu cartera de inversión.

Los extractos se leen dentro del dispositivo y los datos se guardan solo en él. Si conectas tus bancos, los movimientos pasan por tu propio servidor de Cloudflare, que no los guarda. Solo si los activas, guarda una copia cifrada que únicamente puedes abrir tú y lo mínimo para los avisos (fecha e importe de los gastos de los últimos días); lo detalla [SINCRONIZAR.md](SINCRONIZAR.md).

## Instalar en el iPhone

1. Abre la web de la app en Safari: https://rufechos.github.io/App-tracking-gastos/
2. Pulsa Compartir.
3. Elige «Añadir a pantalla de inicio».

Usa siempre la app desde ese icono: Safari y la app instalada guardan sus datos por separado.

## Qué hace

- **Inicio**: el mes en curso, lo que queda **por revisar** (movimientos sin categoría clara, posibles duplicados, devoluciones y traspasos dudosos), cómo vas con tus **presupuestos** y la evolución de los últimos meses.
- **Movimientos**: búsqueda por concepto o importe y filtros por categoría y cuenta. Al cambiar la categoría de un movimiento, la app aprende el nombre para los siguientes.
- **Análisis**: el reparto del gasto y de los ingresos por categoría en un mes, un año, los últimos 12 meses o todo; cada categoría comparada con tu media y su evolución, tus **gastos fijos y suscripciones** (con las subidas de precio) y el resumen de cada año.
- **Inversiones**: tu **patrimonio** (saldos de tus cuentas más la cartera) y tus posiciones en Renta 4, Trade Republic u otros brókers, con precios por ISIN, los gastos del fondo y de la plataforma, el valor neto, la rentabilidad anual (TIR) y el reparto por plataforma y tipo.
- **Ajustes**: importar extractos, bancos conectados, **Mis cuentas**, categorías y reglas (con vista previa de lo que cambian), presupuestos, avisos en el iPhone, bloqueo con Face ID y la copia de seguridad.

**Mis cuentas** es la lista de tus cuentas, tarjetas y brókers. Con ella, el pago mensual de la tarjeta, lo que mandas a Trade Republic o lo que te transfieres a ti mismo no cuenta como gasto ni como ingreso. Las devoluciones restan del gasto de la compra que anulan.

## Conectar tus bancos

Para que los movimientos lleguen solos, sigue la guía [SINCRONIZAR.md](SINCRONIZAR.md).

## Copia de seguridad

**Ajustes › Copia de seguridad › Exportar copia** guarda todo (menos la clave del servidor) en un archivo que puedes llevar a Archivos o iCloud Drive. La app te lo recuerda cada 30 días.

Con tu servidor conectado, la app puede guardar además una **copia cifrada** cada día con una frase que solo sabes tú (ver [SINCRONIZAR.md](SINCRONIZAR.md#copia-cifrada)).

## Para desarrollar

No hay paso de compilación: son módulos de JavaScript que el navegador carga tal cual.

```
npm install          # solo para las pruebas
npm start            # la app en http://127.0.0.1:8080/
npm test             # pruebas de la lógica y del servidor
npm run test:e2e     # la app completa en Chromium, a tamaño iPhone
npm run stamp        # tras cambiar cualquier archivo: nueva versión del service worker
```

- `js/` la lógica (lectura de extractos en `js/parse/`, categorías, cuentas, duplicados, sincronización, presupuestos, gastos fijos, patrimonio, costes de inversión, copia cifrada, bloqueo y avisos) y `js/ui/` las pantallas.
- `servidor/worker.js` el servidor de Cloudflare: habla con Enable Banking, busca precios, guarda la copia cifrada y envía los avisos.
- `vendor/` y `fonts/` las librerías y fuentes, incluidas en el repositorio ([licencias](vendor/LICENSES.md)).
- `tests/` las pruebas; GitHub las pasa en cada pull request.
