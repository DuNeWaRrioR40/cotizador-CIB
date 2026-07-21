/* Service worker: estrategia "red primero" para que las actualizaciones (por ejemplo
   config.js) se reflejen apenas estén en línea, y caché solo como respaldo offline.
   Las llamadas a Google/Sheets/pdf-lib pasan directo a la red. */
const CACHE = "cibsa-cotizador-v16-34";
const ASSETS = [
  "./", "./index.html", "./styles.css",
  "./js/config.js", "./js/logos.js", "./js/fonts.js", "./js/calc.js", "./js/sketch.js", "./js/auth.js",
  "./js/sheets.js", "./js/dte.js", "./js/factura.js", "./js/pdf.js", "./js/app.js",
  "./manifest.webmanifest",
  "./icons/apple-touch-icon.png", "./icons/icon-192.png", "./icons/icon-512.png",
];
// CDNs de librerías (pdf-lib, jsQR) que SÍ cacheamos aunque sean de otro origen, para que el
// lector de QR y el generador de PDF funcionen aunque la red falle puntualmente o sin conexión.
const CDN_HOSTS = ["cdnjs.cloudflare.com", "cdn.jsdelivr.net", "unpkg.com"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  const sameOrigin = url.origin === location.origin;
  const cdnLib = CDN_HOSTS.includes(url.hostname) && /\.js($|\?)/.test(url.pathname);
  if ((!sameOrigin && !cdnLib) || e.request.method !== "GET") return;
  e.respondWith(
    fetch(e.request)
      .then((resp) => {
        const copy = resp.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy)).catch(() => {});
        return resp;
      })
      .catch(() => caches.match(e.request))
  );
});
