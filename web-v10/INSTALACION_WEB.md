# Cotizador CIBSA — versión web (PWA) para iPhone

Esta es la versión web de la app. Funciona en **iPhone, Android y computador** desde el
navegador, y se puede **agregar a la pantalla de inicio** del iPhone para usarla como una
app (con el ícono “C”). El PDF se genera dentro del navegador — no necesita LibreOffice.

Para ponerla en marcha hay **3 pasos** (una sola vez): publicarla en internet, crear un
“cliente web” en Google Cloud, y pegar ese dato en la app. Te guío.

---

## Paso 1 — Publicar la app con GitHub Pages (https gratis)

La app es la carpeta **`web/`**. Con GitHub Pages la publicas gratis y con https:

1. Crea una cuenta en **https://github.com** (si no tienes).
2. Crea un repositorio: botón **New** → nombre, por ejemplo `cibsa-cotizador` →
   marca **Public** → **Create repository**.
   (Público está bien: el código no tiene contraseñas; el ID de Google es público por diseño.)
3. Sube los archivos: en el repo, **Add file → Upload files**, y arrastra el
   **contenido de la carpeta `web`** (es decir: `index.html`, `styles.css`,
   `manifest.webmanifest`, `sw.js`, y las carpetas `js`, `icons`, `assets`).
   ⚠️ Arrastra lo que está **dentro** de `web`, no la carpeta `web` en sí, para que
   `index.html` quede en la raíz del repo. Luego **Commit changes**.
4. Activa Pages: **Settings → Pages** → en *Source* elige **Deploy from a branch** →
   Branch: **main**, carpeta **/ (root)** → **Save**.
5. Espera ~1 minuto y recarga; arriba aparecerá tu dirección, del tipo:
   **`https://TU_USUARIO.github.io/cibsa-cotizador/`**

Guarda esa dirección: la necesitas en el paso 2.

> Para actualizar la app más adelante, vuelve a **Add file → Upload files** y sube los
> archivos cambiados (por ejemplo `js/config.js`). GitHub republica solo.

(Otras opciones equivalentes con https: Netlify, Vercel, Firebase Hosting — cualquiera sirve.)

---

## Paso 2 — Crear el “cliente web” en Google Cloud

Usa el **mismo proyecto** de Google Cloud que ya creaste para la app de escritorio,
con la cuenta **contacto@cibsa.cl**.

1. Entra a **https://console.cloud.google.com** → menú ☰ → **APIs y servicios → Credenciales**.
2. **Crear credenciales → ID de cliente de OAuth**.
3. Tipo de aplicación: **Aplicación web**. Ponle un nombre (ej. “Cotizador web”).
4. En **Orígenes autorizados de JavaScript**, agrega **solo el dominio** de tu dirección,
   SIN la subcarpeta ni la barra final (Google no acepta rutas aquí). Con GitHub Pages,
   tu dirección es `https://TU_USUARIO.github.io/cibsa-cotizador/`, pero el **origen** que
   debes ingresar es:
   - `https://TU_USUARIO.github.io`
   - (opcional, para probar en tu computador) `http://localhost:8080`
   (Si usaras Netlify, el origen sí es la dirección completa, ej. `https://cibsa-cotizador.netlify.app`.)
5. Crea y **copia el “ID de cliente”** (termina en `.apps.googleusercontent.com`).
6. Verifica que la **Google Sheets API** esté habilitada (ya lo estaba para el escritorio).
7. Pantalla de consentimiento: si es **Internal** (Workspace de cibsa.cl), listo. Si es
   **External**, agrega como **usuarios de prueba** los correos que usarán la app.

---

## Paso 3 — Pegar el ID en la app y volver a publicar

1. Abre el archivo **`web/js/config.js`**.
2. En la línea `GOOGLE_CLIENT_ID`, reemplaza el texto de ejemplo por el ID que copiaste:
   ```js
   GOOGLE_CLIENT_ID: "TU_ID.apps.googleusercontent.com",
   ```
3. Vuelve a subir la carpeta `web` a Netlify (arrástrala de nuevo a la misma página, o
   en tu sitio: *Deploys → arrastra la carpeta*).

¡Listo! Abre la dirección en el navegador e inicia sesión con tu cuenta autorizada.

---

## Usarla en el iPhone (agregar a la pantalla de inicio)

1. Abre la dirección (ej. `https://cibsa-cotizador.netlify.app`) en **Safari**.
2. Toca el botón **Compartir** (cuadro con flecha hacia arriba).
3. Elige **“Agregar a inicio”**. Aparecerá el ícono **“C”** como una app.
4. Ábrela, inicia sesión con Google y genera cotizaciones. Para guardar/enviar el PDF,
   usa **“Compartir”** (lo manda a Mail, WhatsApp, Archivos, etc.) o **“Abrir / Descargar”**.

---

## Quién puede entrar y precios

- El control de acceso está en `web/js/config.js` (`DOMINIO_PERMITIDO` y
  `CORREOS_PERMITIDOS`), igual que en la app de escritorio. Cada usuario entra con su
  propia cuenta Google y el Sheet debe estar compartido con ese correo.
- Los precios y telas se leen del mismo Google Sheet y la misma hoja **`RANGO`**. Al
  actualizar el Sheet, la app web toma los cambios al iniciar sesión.

---

## Notas

- El “ID de cliente” es público (va en el navegador); es normal en apps web. La seguridad
  viene de los orígenes autorizados, la lista de correos permitidos y de con quién está
  compartido el Sheet.
- La sesión se recuerda mientras la pestaña/app esté abierta; al cerrarla del todo,
  vuelve a pedir login (los tokens web de Google duran ~1 hora).
