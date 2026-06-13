/* Sketch simple del producto: contorno (aristas), ojetillos (círculos) y ventanas
   inscritas (rectángulos internos). Geometría reutilizable para la App (SVG) y el PDF. */
(function (global) {
  // Distribuye n puntos uniformemente por el perímetro (sentido horario desde 0,0).
  function ojetillosPerimetro(n, ancho, largo) {
    const pts = []; n = Math.max(0, Math.round(n || 0));
    if (n <= 0 || !(ancho > 0) || !(largo > 0)) return pts;
    const P = 2 * (ancho + largo);
    for (let k = 0; k < n; k++) {
      let d = (k * P) / n, x, y;
      if (d <= ancho) { x = d; y = 0; }
      else if (d <= ancho + largo) { x = ancho; y = d - ancho; }
      else if (d <= 2 * ancho + largo) { x = ancho - (d - ancho - largo); y = largo; }
      else { x = 0; y = largo - (d - 2 * ancho - largo); }
      pts.push({ x: x, y: y });
    }
    return pts;
  }

  // spec: { ancho, largo, ojTotal, ventanas:[{x,y,w,h}] } (en metros; x=padIzq, y=padSup).
  function construirSketch(spec) {
    const ancho = parseFloat(spec.ancho), largo = parseFloat(spec.largo);
    return {
      ancho: ancho, largo: largo,
      ojetillos: ojetillosPerimetro(spec.ojTotal, ancho, largo),
      ventanas: (spec.ventanas || []).filter((v) => v && v.w > 0 && v.h > 0),
    };
  }

  function fmt(n) { return (Math.round(n * 1000) / 1000).toString().replace(".", ","); }

  // Devuelve un string SVG temático (usa clases; el color lo da el CSS de la App).
  function sketchSVG(spec, opts) {
    opts = opts || {};
    const maxW = opts.maxW || 340, maxH = opts.maxH || 270, margin = 28;
    const sk = construirSketch(spec);
    if (!(sk.ancho > 0) || !(sk.largo > 0)) {
      return '<p class="muted small">Ingresa largo y ancho para ver el dibujo del producto.</p>';
    }
    const scale = Math.min((maxW - 2 * margin) / sk.ancho, (maxH - 2 * margin) / sk.largo);
    const w = sk.ancho * scale, h = sk.largo * scale, ox = margin, oy = margin;
    const r = Math.max(2.2, Math.min(4.5, scale * 0.03));
    const f1 = (n) => n.toFixed(1);
    let s = `<svg class="sketch-svg" viewBox="0 0 ${f1(w + 2 * margin)} ${f1(h + 2 * margin)}" xmlns="http://www.w3.org/2000/svg">`;
    sk.ventanas.forEach((v) => {
      s += `<rect class="win" x="${f1(ox + v.x * scale)}" y="${f1(oy + v.y * scale)}" width="${f1(v.w * scale)}" height="${f1(v.h * scale)}"/>`;
    });
    s += `<rect class="edge" x="${f1(ox)}" y="${f1(oy)}" width="${f1(w)}" height="${f1(h)}"/>`;
    sk.ojetillos.forEach((p) => {
      s += `<circle class="oje" cx="${f1(ox + p.x * scale)}" cy="${f1(oy + p.y * scale)}" r="${f1(r)}"/>`;
    });
    s += `<text class="dim" x="${f1(ox + w / 2)}" y="${f1(oy - 9)}" text-anchor="middle">${fmt(sk.ancho)} m</text>`;
    const ly = oy + h / 2, lx = ox - 10;
    s += `<text class="dim" x="${f1(lx)}" y="${f1(ly)}" text-anchor="middle" transform="rotate(-90 ${f1(lx)} ${f1(ly)})">${fmt(sk.largo)} m</text>`;
    s += `</svg>`;
    return s;
  }

  const API = { construirSketch, sketchSVG, ojetillosPerimetro };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  global.SketchCIBSA = API;
})(typeof window !== "undefined" ? window : globalThis);
