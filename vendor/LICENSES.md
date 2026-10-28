# Librerías y fuentes incluidas

La app no descarga nada de otros sitios: estas librerías y fuentes van dentro del repositorio, sin modificar.
Cada una conserva su licencia; los textos completos están en [`licenses/`](licenses/).

| Archivo | Proyecto | Versión | Origen | Licencia |
|---|---|---|---|---|
| `vendor/chart.umd.js` | [Chart.js](https://www.chartjs.org/) | 4.4.1 | npm `chart.js` | MIT ([texto](licenses/chartjs-MIT.txt)) |
| `vendor/xlsx.full.min.js` | [SheetJS Community Edition](https://sheetjs.com/) | 0.20.3 | npm `@e965/xlsx`, que republica en npm las versiones de cdn.sheetjs.com (SheetJS dejó de publicar en npm en la 0.18.5, la que usaba la app y que tiene fallos de seguridad conocidos) | Apache 2.0 ([texto](licenses/sheetjs-Apache-2.0.txt)) |
| `vendor/pdf.min.js`, `vendor/pdf.worker.min.js` | [PDF.js](https://mozilla.github.io/pdf.js/) | 3.11.174 | npm `pdfjs-dist` | Apache 2.0 ([texto](licenses/pdfjs-Apache-2.0.txt)) |
| `fonts/ibm-plex-sans-*.woff2` | [IBM Plex Sans](https://github.com/IBM/plex) | Fontsource 5.3.0 | npm `@fontsource/ibm-plex-sans` | SIL OFL 1.1 ([texto](licenses/ibm-plex-sans-OFL-1.1.txt)) |
| `fonts/ibm-plex-mono-*.woff2` | [IBM Plex Mono](https://github.com/IBM/plex) | Fontsource 5.3.0 | npm `@fontsource/ibm-plex-mono` | SIL OFL 1.1 ([texto](licenses/ibm-plex-mono-OFL-1.1.txt)) |
| `fonts/bricolage-grotesque-*.woff2` | [Bricolage Grotesque](https://github.com/ateliertriay/bricolage) | Fontsource 5.3.0 | npm `@fontsource/bricolage-grotesque` | SIL OFL 1.1 ([texto](licenses/bricolage-grotesque-OFL-1.1.txt)) |

Para actualizar una librería, sustituye el archivo, actualiza esta tabla y ejecuta `npm run stamp`, que cambia la versión
del service worker para que los móviles descarguen la nueva.
