# Conectar tus bancos al Cuaderno de gastos

Con esto, la app descarga sola los movimientos de tus bancos cada vez que la abres. Se prepara una vez, en unos 20 minutos. Hazlo desde un ordenador, es más cómodo; solo el último paso se hace en el iPhone.

Necesitas dos cuentas gratuitas:

- **Cloudflare**: aloja un pequeño servidor tuyo que guarda la clave de Enable Banking y hace de puente con la app.
- **Enable Banking**: el intermediario autorizado (PSD2) que se conecta a los bancos.

Nadie más que tú tiene la clave. La app y el servidor solo pueden **leer** movimientos; no pueden mover dinero. El servidor no guarda tus movimientos: los pasa a la app y los olvida.

---

## 1. El servidor en Cloudflare

1. Crea una cuenta en https://dash.cloudflare.com/sign-up.
2. Ve a **Workers & Pages** → **Create application** → **Start with Hello World!**. Ponle de nombre `cuaderno-gastos` y pulsa **Deploy**.
3. Pulsa **Edit code**, borra todo lo que hay y pega el contenido de [`servidor/worker.js`](servidor/worker.js) (en esa página, el botón **Copy raw file** lo copia entero). Pulsa **Deploy**.
4. Apunta la dirección del Worker, del tipo `https://cuaderno-gastos.TU-USUARIO.workers.dev`. Tiene que acabar en `.workers.dev`: la app solo habla con direcciones así.
5. Crea el espacio donde el servidor guarda la vuelta del banco durante unos minutos: en el menú de la izquierda, **Storage & Databases** → **KV** → **Create a namespace**, con el nombre `cuaderno-gastos`.
6. Vuelve al Worker → **Settings** → **Bindings** → **Add binding** → **KV namespace**. En **Variable name** escribe `CG` (en mayúsculas) y elige el espacio `cuaderno-gastos`. Guarda.

Las variables del paso 3 de Enable Banking se añaden al final; de momento deja esta pestaña abierta.

## 2. Enable Banking

1. Regístrate en https://enablebanking.com y espera el correo de confirmación.
2. Entra en el **Control Panel** y ve a **API applications** → **Register new application**.
3. Rellena:
   - **Environment**: `Production`
   - **Application name**: `Cuaderno de gastos`
   - **Allowed redirect URLs**: estas dos, una por línea:
     - la dirección de tu Worker seguida de `/callback`, por ejemplo `https://cuaderno-gastos.TU-USUARIO.workers.dev/callback`
     - `https://rufechos.github.io/App-tracking-gastos/` (tal cual, con la barra final y la «A» mayúscula)
   - **Privacy policy / Terms of service URL**: `https://rufechos.github.io/App-tracking-gastos/`
   - Deja la opción de generar la clave en el navegador.
4. Al guardar se descarga un archivo **.pem**. Es tu clave privada: guárdalo bien y **no lo compartas con nadie, tampoco por chat**.
5. Copia el **Application ID** que aparece en la lista de aplicaciones.
6. En tu aplicación, pulsa **Link accounts** y conecta, uno por uno, tus bancos (ING, Bankinter, Trade Republic, Renta 4…). Esto activa el uso gratuito con tus propias cuentas. Es normal que la aplicación aparezca como *Restricted* y *Active*.

## 3. Las claves en el servidor

En Cloudflare, en tu Worker → **Settings** → **Variables and Secrets**, añade tres:

| Nombre | Tipo | Valor |
|---|---|---|
| `EB_APP_ID` | Text | el Application ID de Enable Banking |
| `EB_PRIVATE_KEY` | Secret | abre el archivo .pem con un editor de texto y pega **todo** su contenido |
| `SYNC_TOKEN` | Secret | una contraseña larga que te inventes (la escribirás también en la app) |

Pulsa **Deploy** si Cloudflare lo pide.

## 4. En el iPhone

Hazlo **desde la app instalada** (el icono de la pantalla de inicio), no desde Safari: Safari y la app instalada guardan sus datos por separado.

1. Abre **Ajustes** → **Bancos conectados** → **Ajustes de conexión**.
2. Pega la **dirección del servidor** y la **clave de acceso** (`SYNC_TOKEN`) y pulsa **Guardar y buscar bancos**.
3. Elige un banco y pulsa **Conectar banco**. Se abre la web de tu banco para que autorices el acceso.
4. Al terminar verás la página **Banco autorizado**. Ciérrala y vuelve a la app: la conexión aparece sola en unos segundos y se descarga todo el historial que dé el banco.
5. Repite los pasos 3 y 4 con cada banco. Trade Republic está en la lista de **Alemania**.

A partir de ahí la app se sincroniza sola al abrirla (cada banco, como mucho cada media hora). El botón **Sincronizar** de arriba fuerza una sincronización.

Los traspasos entre tus cuentas (el pago de la tarjeta, lo que mandas a Trade Republic o a Renta 4) no cuentan como gasto ni como ingreso. Revisa en **Ajustes** → **Mis cuentas** que están todas, y escribe tu nombre tal como aparece en las transferencias para reconocer las que te haces a ti mismo.

## Si algo no va

- **«Esperando la autorización»** se queda fijo: pulsa **Comprobar**. Si has cerrado el banco sin terminar, pulsa **Cancelar** y vuelve a conectarlo.
- **Al volver del banco ves un código**: tu servidor no tiene el espacio KV (paso 1.5 y 1.6). La app sigue funcionando: copia el código, abre la app desde la pantalla de inicio y pégalo en **Ajustes de conexión**.
- **«El banco pide esperar»**: algunos bancos solo permiten unas pocas consultas al día. La app lo vuelve a intentar sola pasadas 6 horas.
- **«La clave de acceso del servidor no es correcta»**: la clave de la app no coincide con `SYNC_TOKEN`.

## Renovar la autorización

Por ley, el permiso de lectura caduca cada 90 a 180 días según el banco (Trade Republic, a los 90). La app avisa una semana antes; pulsa **Renovar** y autoriza de nuevo. Los movimientos que ya tenías no se duplican.

## Si pierdes el móvil

Cambia `SYNC_TOKEN` en Cloudflare por otra contraseña. El móvil perdido deja de poder hablar con tu servidor y, con él, con tus bancos. En el móvil nuevo, restaura tu copia de seguridad y escribe la clave nueva.

## Actualizar el servidor

Cuando una versión nueva de la app necesite un servidor nuevo, la app te lo dirá. Vuelve a pegar el contenido de [`servidor/worker.js`](servidor/worker.js) en **Edit code** y pulsa **Deploy**; las variables y el espacio KV se conservan.

## Precios de tus inversiones

El mismo servidor actualiza los precios de la sección «Inversiones» a partir del ISIN de cada posición (datos de Yahoo Finance, convertidos a euros). No necesita nada más: la app actualiza los precios al abrirla si han pasado más de 6 horas. Si un fondo no tiene precio disponible, puedes ponerlo a mano con **Editar**.
