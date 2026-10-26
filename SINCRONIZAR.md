# Conectar tus bancos al Cuaderno de gastos

Con esto, la app descarga sola los movimientos de tus bancos cada vez que la abres. Se hace una vez y tarda unos 15 minutos. Hazlo desde un ordenador, es más cómodo.

Necesitas dos cuentas gratuitas:

- **Enable Banking**: el intermediario autorizado (PSD2) que se conecta a los bancos.
- **Cloudflare**: aloja un pequeño servidor tuyo que guarda la clave de Enable Banking y hace de puente con la app.

Nadie más que tú tiene acceso a la clave. La app y el servidor solo pueden **leer** movimientos; no pueden mover dinero.

---

## 1. Enable Banking

1. Regístrate en https://enablebanking.com y espera el correo de confirmación.
2. Entra en el **Control Panel** y ve a **API applications** → **Register new application**.
3. Rellena:
   - **Environment**: `Production`
   - **Application name**: `Cuaderno de gastos`
   - **Allowed redirect URLs**: `https://rufechos.github.io/App-tracking-gastos/` (tal cual, con la barra final y la «A» mayúscula)
   - **Privacy policy / Terms of service URL**: la misma dirección de arriba.
   - Deja la opción de generar la clave en el navegador.
4. Al guardar se descarga un archivo **.pem**. Guárdalo bien: es tu clave privada. **No lo compartas con nadie, tampoco por chat.**
5. Copia el **Application ID** que aparece en la lista de aplicaciones.
6. En tu aplicación, pulsa **Link accounts** y conecta, uno por uno, tus bancos (ING, Renta 4, Trade Republic, Bankinter…). Esto activa el modo gratuito para tus propias cuentas. Es normal que la aplicación aparezca como *Restricted* y *Active*.

## 2. Cloudflare

1. Crea una cuenta en https://dash.cloudflare.com/sign-up.
2. Ve a **Workers & Pages** → **Create** → **Create Worker** (plantilla «Hello World»). Ponle de nombre `cuaderno-gastos` y pulsa **Deploy**.
3. Pulsa **Edit code**, borra todo lo que hay y pega el contenido de [`servidor/worker.js`](servidor/worker.js). Pulsa **Deploy**.
4. Vuelve al Worker → **Settings** → **Variables and Secrets** y añade tres:

   | Nombre | Tipo | Valor |
   |---|---|---|
   | `EB_APP_ID` | Text | el Application ID de Enable Banking |
   | `EB_PRIVATE_KEY` | Secret | abre el archivo .pem con un editor de texto y pega **todo** su contenido |
   | `SYNC_TOKEN` | Secret | una contraseña larga que te inventes (la pondrás también en la app) |

5. Apunta la dirección del Worker, del tipo `https://cuaderno-gastos.TU-USUARIO.workers.dev`.

## 3. En la app

1. Abre la app y despliega **Ajustes de conexión** en «Bancos conectados».
2. Pega la **dirección del servidor** y la **clave de acceso** (`SYNC_TOKEN`) y pulsa **Guardar y buscar bancos**.
3. Elige un banco y pulsa **Conectar banco**. Te llevará a la web de tu banco para autorizar el acceso y luego volverá a la app.
4. Repite el paso 3 con cada banco.

A partir de ahí la app se sincroniza sola al abrirla. El botón **Sincronizar ahora** fuerza una sincronización.

### Si en el iPhone vuelves a otra ventana

Si después de autorizar en el banco la app se abre en Safari en lugar de en la app instalada, verás un **código** en «Ajustes de conexión». Cópialo, abre la app desde la pantalla de inicio y pégalo en el campo del código.

### Renovar la autorización

Por ley, el permiso de lectura caduca cada 90 a 180 días según el banco. Cuando pase, la app te avisará y solo tendrás que pulsar **Volver a autorizar**.
