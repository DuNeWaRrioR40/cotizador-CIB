/* Sketch del producto: contorno (aristas), ojetillos (círculos), ventanas inscritas
   (rectángulos internos), cortes/calados (líneas de corte con tijeras) y cotas (líneas de
   dimensión, en rojo). Geometría reutilizable para la App (SVG) y el PDF. Cotas en metros.
   El corte NO afecta cálculo de valor ni material; un lado que coincide con el borde del
   paño base "desaparece" (queda calado abierto). */
(function (global) {
  const OFF_MIN0 = 16, OFF_STEP = 18, OFF_GAP = 20, TICK = 3, EXTGAP = 3, EPS = 0.001;
  // Registro de la decisión "auto" del rótulo-guía por id de elemento (true = el auto generó el
  // rótulo porque el título no cabía). Se rellena solo en render en vivo (opts.live) para que la UI
  // pueda deshabilitar el checkbox "Rótulo" cuando el auto ya lo está generando.
  const AUTOROT = {};

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
  // Distribución TRADICIONAL por distanciamiento d en una arista de largo L:
  // ojetillos en ambas esquinas + marcha al distanciamiento desde un extremo manteniéndose
  // a >= d del extremo opuesto; si el tramo final supera d, se agrega 1 ojetillo en su mitad.
  function distribuirArista(L, d) {
    if (!(L > 0)) return [];
    if (!(d > 0)) return [0, L];
    const pos = [0]; let x = d;
    while (x <= L - d + 1e-9) { pos.push(x); x += d; }
    const last = pos[pos.length - 1], gap = L - last;
    if (gap > d + 1e-9) pos.push(last + gap / 2);
    pos.push(L);
    return pos;
  }
  // Distribución PAREJA (ideal): n tramos iguales con n = redondeo(L/d). Espaciado = L/n.
  function distribuirParejo(L, d) {
    if (!(L > 0)) return [];
    const n = Math.max(1, Math.round(L / (d > 0 ? d : L)));
    const pos = []; for (let i = 0; i <= n; i++) pos.push(L * i / n);
    return pos;
  }
  function posicionesArista(L, d, parejo) { return parejo ? distribuirParejo(L, d) : distribuirArista(L, d); }

  // Intervalos de cada borde del paño removidos por calados que LO TOCAN (lo seccionan).
  // Devuelve { sup:[[a,b]...], inf, izq, der } en el eje del borde (x para sup/inf, y para izq/der).
  function intervalosCalados(ancho, largo, cortes) {
    const rem = { sup: [], inf: [], izq: [], der: [] };
    (cortes || []).forEach((c) => {
      if (!c) return;
      const x = c.x, y = c.y, w = c.w, h = c.h;
      if (!(w > 0) || !(h > 0)) return;
      const ang = parseFloat(c.angulo) || 0;
      if (c.circ) {
        const cx = x + w / 2, cy = y + h / 2, r = Math.min(w, h) / 2;
        const chord = (dist) => (Math.abs(dist) < r - 1e-9) ? Math.sqrt(r * r - dist * dist) : 0;
        let a;
        if (cy - r <= EPS) { a = chord(cy); if (a > 1e-6) rem.sup.push([cx - a, cx + a]); }
        if (cy + r >= largo - EPS) { a = chord(largo - cy); if (a > 1e-6) rem.inf.push([cx - a, cx + a]); }
        if (cx - r <= EPS) { a = chord(cx); if (a > 1e-6) rem.izq.push([cy - a, cy + a]); }
        if (cx + r >= ancho - EPS) { a = chord(ancho - cx); if (a > 1e-6) rem.der.push([cy - a, cy + a]); }
      } else if (Math.abs(ang) > 0.01) {
        // Calado rotado: se recorta cada arista del paño contra el cuadrilátero girado;
        // el tramo interior = pedazo de borde que el calado elimina (crea esquinas nuevas en diagonal).
        const rad = ang * Math.PI / 180, Px = x + (c.pivX != null ? c.pivX : 0.5) * w, Py = y + (c.pivY != null ? c.pivY : 0.5) * h, co = Math.cos(rad), si = Math.sin(rad);
        const rot = (px, py) => ({ x: Px + (px - Px) * co - (py - Py) * si, y: Py + (px - Px) * si + (py - Py) * co });
        const poly = [rot(x, y), rot(x + w, y), rot(x + w, y + h), rot(x, y + h)];
        const addClip = (kk, p0, p1, ax) => {
          const cl = clipSegPoligono(p0, p1, poly); if (!cl) return;
          const u = ax === "x" ? [cl.a.x, cl.b.x] : [cl.a.y, cl.b.y];
          const a = Math.min(u[0], u[1]), b = Math.max(u[0], u[1]);
          if (b - a > 1e-6) rem[kk].push([a, b]);
        };
        addClip("sup", { x: 0, y: 0 }, { x: ancho, y: 0 }, "x");
        addClip("inf", { x: 0, y: largo }, { x: ancho, y: largo }, "x");
        addClip("izq", { x: 0, y: 0 }, { x: 0, y: largo }, "y");
        addClip("der", { x: ancho, y: 0 }, { x: ancho, y: largo }, "y");
      } else {
        if (y <= EPS) rem.sup.push([x, x + w]);
        if (y + h >= largo - EPS) rem.inf.push([x, x + w]);
        if (x <= EPS) rem.izq.push([y, y + h]);
        if (x + w >= ancho - EPS) rem.der.push([y, y + h]);
      }
    });
    return rem;
  }
  // Segmentos sólidos de [0,L] tras restar los intervalos removidos (fusionados).
  function segmentosSolidos(L, removed) {
    let iv = (removed || []).map((it) => [Math.max(0, Math.min(it[0], it[1])), Math.min(L, Math.max(it[0], it[1]))]).filter((it) => it[1] - it[0] > 1e-6).sort((p, q) => p[0] - q[0]);
    const merged = [];
    iv.forEach((it) => { const last = merged[merged.length - 1]; if (last && it[0] <= last[1] + 1e-6) last[1] = Math.max(last[1], it[1]); else merged.push([it[0], it[1]]); });
    const segs = []; let cur = 0;
    merged.forEach((it) => { if (it[0] - cur > 1e-6) segs.push([cur, it[0]]); cur = Math.max(cur, it[1]); });
    if (L - cur > 1e-6) segs.push([cur, L]);
    return segs;
  }
  // Posiciones a lo largo de un borde de longitud L, seccionado por 'removed'. Cada segmento
  // resultante recibe la convención (esquinas + penúltimo/último), poniendo ojetillo en cada
  // esquina nueva creada por el calado. Sin calados → idéntico a posicionesArista.
  function posicionesAristaSeg(L, d, parejo, removed) {
    if (!removed || !removed.length) return posicionesArista(L, d, parejo);
    const segs = segmentosSolidos(L, removed);
    let out = [];
    segs.forEach((sg) => { const len = sg[1] - sg[0]; if (len <= 1e-6) return; posicionesArista(len, d, parejo).forEach((p) => out.push(sg[0] + p)); });
    out.sort((a, b) => a - b);
    const dd = []; out.forEach((p) => { if (!dd.length || p - dd[dd.length - 1] > 1e-6) dd.push(p); });
    return dd;
  }

  // Distribuye 'count' puntos a lo largo de un segmento p0→p1 (extremos incluidos si count>=2).
  function puntosArista(count, p0, p1) {
    const pts = []; const c = Math.max(0, Math.round(count || 0));
    if (c <= 0) return pts;
    if (c === 1) { pts.push({ x: (p0.x + p1.x) / 2, y: (p0.y + p1.y) / 2 }); return pts; }
    for (let i = 0; i < c; i++) { const t = i / (c - 1); pts.push({ x: p0.x + (p1.x - p0.x) * t, y: p0.y + (p1.y - p0.y) * t }); }
    return pts;
  }

  // Geometría del anexo (aleta/solapa/faldón/cenefa) en coordenadas del paño: rectángulo + arista fusionada.
  function aletaGeomRect(a, ancho, largo) {
    const dB = Math.max(0, parseFloat(a.dBorde) || 0), L = parseFloat(a.largo), W = parseFloat(a.ancho), off = parseFloat(a.offset) || 0;
    const be = a.baseEdge || "inf";
    if (be === "inf") return { x: off, y: largo - dB, w: W, h: L, fused: "t" };
    if (be === "sup") return { x: off, y: dB - L, w: W, h: L, fused: "b" };
    if (be === "izq") return { x: dB - L, y: off, w: L, h: W, fused: "r" };
    return { x: ancho - dB, y: off, w: L, h: W, fused: "l" };
  }
  // Ojetillos por arista del anexo: reparte en las 3 aristas LIBRES (todas menos la fusionada),
  // por distanciamiento (o parejo) con supresión por índice; NO coloca ojetillo en el punto de unión
  // (el extremo que toca la arista fusionada) y deduplica las esquinas compartidas entre aristas libres.
  function aletaOjArista(x, y, w, h, fused, ojEdges, parejo) {
    const E = {
      t: { a: { x: x, y: y }, b: { x: x + w, y: y }, L: w },
      b: { a: { x: x, y: y + h }, b: { x: x + w, y: y + h }, L: w },
      l: { a: { x: x, y: y }, b: { x: x, y: y + h }, L: h },
      r: { a: { x: x + w, y: y }, b: { x: x + w, y: y + h }, L: h },
    };
    const enFusion = (p) => fused === "t" ? Math.abs(p.y - y) < 1e-6 : fused === "b" ? Math.abs(p.y - (y + h)) < 1e-6 :
      fused === "l" ? Math.abs(p.x - x) < 1e-6 : Math.abs(p.x - (x + w)) < 1e-6;
    const raw = [];
    ["t", "b", "l", "r"].forEach((k) => {
      if (k === fused) return;
      const cfg = ojEdges && ojEdges[k];
      if (!cfg || cfg.on === false) return;
      const d = parseFloat(cfg.d); if (!(d > 0)) return;
      const seg = E[k], ux = (seg.b.x - seg.a.x) / seg.L, uy = (seg.b.y - seg.a.y) / seg.L;
      const supr = (cfg.supr instanceof Set) ? cfg.supr : new Set();
      posicionesArista(seg.L, d, parejo).forEach((t, i) => {
        if (supr.has(i)) return;
        const p = { x: seg.a.x + ux * t, y: seg.a.y + uy * t };
        if (enFusion(p)) return; // "hasta antes del punto de unión"
        raw.push(p);
      });
    });
    const out = [];
    raw.forEach((p) => { if (!out.some((q) => Math.abs(q.x - p.x) < 1e-4 && Math.abs(q.y - p.y) < 1e-4)) out.push(p); });
    return out;
  }
  // Puntos de ojetillos de un anexo según su modo: "arista" (por aristas libres) o simple (n en la arista libre opuesta).
  function aletaOjPuntos(a, ancho, largo) {
    if (!(parseFloat(a.largo) > 0) || !(parseFloat(a.ancho) > 0)) return [];
    const g = aletaGeomRect(a, ancho, largo);
    if (a.ojMode === "arista" && a.ojEdges) return aletaOjArista(g.x, g.y, g.w, g.h, g.fused, a.ojEdges, !!a.ojParejo);
    const nOj = Math.max(0, Math.round(parseFloat(a.ojetillos) || 0));
    if (nOj <= 0) return [];
    const x = g.x, y = g.y, w = g.w, h = g.h; let p0, p1;
    if (g.fused === "t") { p0 = { x: x, y: y + h }; p1 = { x: x + w, y: y + h }; }
    else if (g.fused === "b") { p0 = { x: x, y: y }; p1 = { x: x + w, y: y }; }
    else if (g.fused === "l") { p0 = { x: x + w, y: y }; p1 = { x: x + w, y: y + h }; }
    else { p0 = { x: x, y: y }; p1 = { x: x, y: y + h }; }
    return puntosArista(nOj, p0, p1);
  }

  // Recorta un segmento p0→p1 al rectángulo [xmin,xmax]×[ymin,ymax] (Liang–Barsky).
  function clipSeg(p0, p1, xmin, xmax, ymin, ymax) {
    let t0 = 0, t1 = 1; const dx = p1.x - p0.x, dy = p1.y - p0.y;
    const tests = [[-dx, p0.x - xmin], [dx, xmax - p0.x], [-dy, p0.y - ymin], [dy, ymax - p0.y]];
    for (let i = 0; i < tests.length; i++) {
      const p = tests[i][0], q = tests[i][1];
      if (Math.abs(p) < 1e-12) { if (q < 0) return null; }
      else { const t = q / p; if (p < 0) { if (t > t1) return null; if (t > t0) t0 = t; } else { if (t < t0) return null; if (t < t1) t1 = t; } }
    }
    return { a: { x: p0.x + t0 * dx, y: p0.y + t0 * dy }, b: { x: p0.x + t1 * dx, y: p0.y + t1 * dy } };
  }

  // Recorta el segmento p0→p1 al interior de un polígono CONVEXO (Cyrus–Beck). Devuelve {a,b} o null.
  function clipSegPoligono(p0, p1, poly) {
    const n = poly.length; if (n < 3) return null;
    let cx = 0, cy = 0; poly.forEach((p) => { cx += p.x; cy += p.y; }); cx /= n; cy /= n;
    const dx = p1.x - p0.x, dy = p1.y - p0.y; let tE = 0, tL = 1;
    for (let i = 0; i < n; i++) {
      const a = poly[i], b = poly[(i + 1) % n];
      let nx = -(b.y - a.y), ny = (b.x - a.x); // perpendicular a la arista
      if (nx * (cx - a.x) + ny * (cy - a.y) < 0) { nx = -nx; ny = -ny; } // orientar hacia el interior
      const num = nx * (p0.x - a.x) + ny * (p0.y - a.y), den = nx * dx + ny * dy;
      if (Math.abs(den) < 1e-12) { if (num < 0) return null; }
      else { const t = -num / den; if (den > 0) { if (t > tE) tE = t; } else { if (t < tL) tL = t; } }
      if (tE > tL) return null;
    }
    return { a: { x: p0.x + tE * dx, y: p0.y + tE * dy }, b: { x: p0.x + tL * dx, y: p0.y + tL * dy } };
  }

  // Recorta un polígono a un lado de la recta a→b (Sutherland-Hodgman de un solo plano).
  // keepNeg=true conserva el lado donde la "side" (normal · (p-a)) es negativa.
  function clipPolyHalfPlane(poly, ax, ay, bx, by, keepNeg) {
    const nx = -(by - ay), ny = (bx - ax);
    const side = (p) => nx * (p.x - ax) + ny * (p.y - ay);
    const inside = (p) => keepNeg ? (side(p) <= 1e-9) : (side(p) >= -1e-9);
    const out = [];
    for (let i = 0; i < poly.length; i++) {
      const A = poly[i], B = poly[(i + 1) % poly.length], inA = inside(A), inB = inside(B);
      if (inA) out.push(A);
      if (inA !== inB) { const sA = side(A), sB = side(B), t = sA / (sA - sB); out.push({ x: A.x + (B.x - A.x) * t, y: A.y + (B.y - A.y) * t }); }
    }
    return out;
  }
  // Etiqueta cardinal del lado hacia el que apunta la normal (coords pantalla, y hacia abajo).
  function cardinalLado(nx, ny) {
    if (Math.abs(nx) >= Math.abs(ny)) return nx >= 0 ? "Este (der.)" : "Oeste (izq.)";
    return ny >= 0 ? "Sur (abajo)" : "Norte (arriba)";
  }
  // Procesa una config de corte a su geometría dibujable (segmentos, ojetillos, achurado…).
  function procesarCorte(c, ancho, largo) {
      const x = c.x, y = c.y, w = c.w, h = c.h;
      // --- Corte (línea recta): un solo segmento de largo w (horizontal), rotado por ángulo/pivote. ---
      if (c.tipo === "corte") {
        let a = { x: x, y: y }, b = { x: x + w, y: y };
        const ang = (parseFloat(c.angulo) || 0) * Math.PI / 180, rotated = Math.abs(ang) > 1e-6;
        const Px = x + (c.pivX != null ? c.pivX : 0) * w, Py = y;
        if (rotated) { const co = Math.cos(ang), si = Math.sin(ang); const rot = (p) => ({ x: Px + (p.x - Px) * co - (p.y - Py) * si, y: Py + (p.x - Px) * si + (p.y - Py) * co }); a = rot(a); b = rot(b); }
        let fadePoly = null;
        if (c.fade === "A" || c.fade === "B") {
          const rect = [{ x: 0, y: 0 }, { x: ancho, y: 0 }, { x: ancho, y: largo }, { x: 0, y: largo }];
          fadePoly = clipPolyHalfPlane(rect, a.x, a.y, b.x, b.y, c.fade === "B");
        }
        // Ojetillos sobre una arista (lado A/B) del corte: repartidos a lo largo, con inset perpendicular.
        let aristaOje = [];
        const dd = parseFloat(c.ojAristaD) || 0;
        if ((c.ojAristaLado === "A" || c.ojAristaLado === "B") && dd > 0) {
          const Ls = Math.hypot(b.x - a.x, b.y - a.y);
          if (Ls > 0) {
            const ux = (b.x - a.x) / Ls, uy = (b.y - a.y) / Ls, inx = -uy, iny = ux;
            const ins = parseFloat(c.ojAristaInset) || 0, sgn = (c.ojAristaLado === "A") ? 1 : -1;
            const supr = new Set(Array.isArray(c.ojAristaSupr) ? c.ojAristaSupr : []);
            posicionesArista(Ls, dd, false).forEach((t, i) => { if (supr.has(i)) return; aristaOje.push({ x: a.x + ux * t + inx * ins * sgn, y: a.y + uy * t + iny * ins * sgn }); });
          }
        }
        return { x: x, y: y, w: w, h: 0, corte: true, sides: {}, segments: [{ a: a, b: b }], ojetillos: aristaOje, tijeras: null, hatch: [], pivote: { x: Px, y: Py }, rotated: rotated, angulo: parseFloat(c.angulo) || 0, fadePoly: fadePoly, strapAncho: parseFloat(c.strapAncho) || 0, strapPrecioM: parseFloat(c.strapPrecioM) || 0, strapLado: c.strapLado || "A", strapD: parseFloat(c.strapD) || 0, strapOffset: parseFloat(c.strapOffset) || 0, strapInset: parseFloat(c.strapInset) || 0, strapSupr: Array.isArray(c.strapSupr) ? c.strapSupr : [], strapNombre: c.strapNombre || "" };
      }
      // --- Corte circular: se recorta al paño base; lo que sale, desaparece. ---
      if (c.circ) {
        const cx = x + w / 2, cy = y + h / 2, rr = Math.min(w, h) / 2;
        const N = 96; const raw = [];
        for (let i = 0; i <= N; i++) { const t = 2 * Math.PI * i / N; raw.push({ x: cx + rr * Math.cos(t), y: cy + rr * Math.sin(t) }); }
        const segs = [];
        for (let i = 0; i < N; i++) { const cl = clipSeg(raw[i], raw[i + 1], 0, ancho, 0, largo); if (cl) segs.push(cl); }
        const dentro = (p) => p.x >= -1e-9 && p.x <= ancho + 1e-9 && p.y >= -1e-9 && p.y <= largo + 1e-9;
        const nOj = Math.max(0, Math.round(c.ojCirc || 0)); const pts = [];
        for (let k = 0; k < nOj; k++) { const t = 2 * Math.PI * k / nOj; const p = { x: cx + rr * Math.cos(t), y: cy + rr * Math.sin(t) }; if (dentro(p)) pts.push(p); }
        const tij = [];
        for (let k = 0; k < 8; k++) { const t = 2 * Math.PI * (k + 0.5) / 8; const p = { x: cx + rr * Math.cos(t), y: cy + rr * Math.sin(t) }; if (dentro(p)) tij.push(p); }
        return { x: x, y: y, w: w, h: h, circ: true, sides: {}, segments: segs, ojetillos: pts, tijeras: tij, hatch: [], pivote: { x: cx, y: cy }, rotated: false, angulo: 0 };
      }
      const lados = c.lados || { sup: true, inf: true, izq: true, der: true };
      const ang = (parseFloat(c.angulo) || 0) * Math.PI / 180;
      const rotated = Math.abs(ang) > 1e-6;
      const allOn = !!(lados.sup && lados.inf && lados.izq && lados.der);
      // La supresión por coincidir con el borde del paño aplica SOLO a un calado cerrado (4 aristas) y sin rotar:
      // ahí el contorno es el propio paño. Si el usuario apagó alguna arista (corte recto) o el calado está rotado,
      // se dibujan tal cual las aristas activas.
      const chkB = !rotated && allOn;
      const sides = {
        t: !!lados.sup && (!chkB || y > EPS), b: !!lados.inf && (!chkB || (y + h) < largo - EPS),
        l: !!lados.izq && (!chkB || x > EPS), r: !!lados.der && (!chkB || (x + w) < ancho - EPS),
      };
      const oj = c.oj || {};
      let segs = [], pts = [];
      if (sides.t) { segs.push({ a: { x: x, y: y }, b: { x: x + w, y: y } }); pts = pts.concat(puntosArista(oj.sup, { x: x, y: y }, { x: x + w, y: y })); }
      if (sides.b) { segs.push({ a: { x: x, y: y + h }, b: { x: x + w, y: y + h } }); pts = pts.concat(puntosArista(oj.inf, { x: x, y: y + h }, { x: x + w, y: y + h })); }
      if (sides.l) { segs.push({ a: { x: x, y: y }, b: { x: x, y: y + h } }); pts = pts.concat(puntosArista(oj.izq, { x: x, y: y }, { x: x, y: y + h })); }
      if (sides.r) { segs.push({ a: { x: x + w, y: y }, b: { x: x + w, y: y + h } }); pts = pts.concat(puntosArista(oj.der, { x: x + w, y: y }, { x: x + w, y: y + h })); }
      // Achurado suave: solo si el calado sigue cerrado (las 4 aristas activas = tiene "área").
      let hatch = [];
      const cerrado = !!(lados.sup && lados.inf && lados.izq && lados.der);
      if (cerrado) {
        const sp = Math.max(0.1, Math.min(w, h) / 5);
        for (let k = -h + sp; k < w - 1e-9; k += sp) {
          const px0 = Math.max(0, k), px1 = Math.min(w, k + h);
          if (px1 - px0 > 1e-6) hatch.push({ a: { x: x + px0, y: y + (px0 - k) }, b: { x: x + px1, y: y + (px1 - k) } });
        }
      }
      // Rotación opcional en torno a un pivote (fracción 0..1 del rectángulo del corte).
      const Px = x + (c.pivX != null ? c.pivX : 0.5) * w, Py = y + (c.pivY != null ? c.pivY : 0.5) * h;
      if (rotated) {
        const co = Math.cos(ang), si = Math.sin(ang);
        const rot = (p) => { const dx = p.x - Px, dy = p.y - Py; return { x: Px + dx * co - dy * si, y: Py + dx * si + dy * co }; };
        segs = segs.map((s) => ({ a: rot(s.a), b: rot(s.b) }));
        pts = pts.map(rot);
        hatch = hatch.map((s) => ({ a: rot(s.a), b: rot(s.b) }));
      }
      return { x: x, y: y, w: w, h: h, sides: sides, segments: segs, ojetillos: pts, hatch: hatch, pivote: { x: Px, y: Py }, rotated: rotated, angulo: parseFloat(c.angulo) || 0 };
  }

  // spec: { ancho, largo, ojTotal|ojetillosPos, ventanas, cortes, bolsillos, espejo, vista, extraCortes, extraVentanas }
  function construirSketch(spec) {
    const ancho = parseFloat(spec.ancho), largo = parseFloat(spec.largo);
    let cortes = (spec.cortes || []).filter((c) => c && c.w > 0 && (c.h > 0 || c.tipo === "corte")).map((c) => procesarCorte(c, ancho, largo));
    let ojetillos = Array.isArray(spec.ojetillosPos) ? spec.ojetillosPos : ojetillosPerimetro(spec.ojTotal, ancho, largo);
    let ventanas = (spec.ventanas || []).filter((v) => v && v.w > 0 && v.h > 0).map((v) => ({ x: v.x, y: v.y, w: v.w, h: v.h, circ: !!v.circ, legend: v.legend || "", fusion: v.fusion || {}, rotulo: !!v.rotulo, id: (v.id != null ? v.id : null) }));
    let bolsillos = (spec.bolsillos || []).filter((b) => b && (b.arista === "sup" || b.arista === "inf" || b.arista === "izq" || b.arista === "der"));
    // Espejo horizontal (vista trasera): atraviesan/voltean ojetillos, ventanas y calados; materiales NO van en el dibujo.
    if (spec.espejo && ancho > 0) {
      const A = ancho, mp = (p) => ({ x: A - p.x, y: p.y });
      const swapLR = (f) => ({ sup: !!(f && f.sup), inf: !!(f && f.inf), izq: !!(f && f.der), der: !!(f && f.izq) });
      const swapAr = (a) => (a === "izq" ? "der" : a === "der" ? "izq" : a);
      ojetillos = ojetillos.map(mp);
      ventanas = ventanas.map((v) => Object.assign({}, v, { x: A - (v.x + v.w), fusion: swapLR(v.fusion) }));
      bolsillos = bolsillos.map((b) => Object.assign({}, b, { arista: swapAr(b.arista) }));
      cortes = cortes.map((c) => Object.assign({}, c, {
        x: A - (c.x + c.w),
        segments: (c.segments || []).map((s) => ({ a: mp(s.a), b: mp(s.b) })),
        ojetillos: (c.ojetillos || []).map(mp),
        hatch: (c.hatch || []).map((s) => ({ a: mp(s.a), b: mp(s.b) })),
        tijeras: c.tijeras ? c.tijeras.map(mp) : c.tijeras,
        pivote: c.pivote ? mp(c.pivote) : c.pivote,
        sides: c.sides ? { t: c.sides.t, b: c.sides.b, l: c.sides.r, r: c.sides.l } : c.sides,
      }));
    }
    // Elementos propios de la vista trasera (NO se espejan: ya van en coordenadas de la trasera).
    if (spec.extraCortes && spec.extraCortes.length) {
      cortes = cortes.concat(spec.extraCortes.filter((c) => c && c.w > 0 && (c.h > 0 || c.tipo === "corte")).map((c) => procesarCorte(c, ancho, largo)));
    }
    if (spec.extraVentanas && spec.extraVentanas.length) {
      ventanas = ventanas.concat(spec.extraVentanas.filter((v) => v && v.w > 0 && v.h > 0).map((v) => ({ x: v.x, y: v.y, w: v.w, h: v.h, circ: !!v.circ, legend: v.legend || "", fusion: v.fusion || {} })));
    }
    // Aletas / solapas / faldón / cenefa: paño anexo que cuelga de un borde del base (puede extenderse fuera).
    const NOMARI = { aleta: "Aleta", solapa: "Solapa", faldon: "Faldón", cenefa: "Cenefa" };
    const aletas = (spec.aletas || []).filter((a) => a && a.largo > 0 && a.ancho > 0).map((a) => {
      const g = aletaGeomRect(a, ancho, largo);
      const pts = aletaOjPuntos(a, ancho, largo);
      const nom = (a.legend && a.legend.trim()) ? a.legend.trim() : (NOMARI[a.tipo] || "Aleta");
      return { x: g.x, y: g.y, w: g.w, h: g.h, fused: g.fused, tipo: a.tipo || "aleta", nombre: nom, ojetillos: pts, rotulo: !!a.rotulo, id: (a.id != null ? a.id : null), largo: parseFloat(a.largo) || 0, ancho: parseFloat(a.ancho) || 0, offset: parseFloat(a.offset) || 0, dBorde: parseFloat(a.dBorde) || 0 };
    });
    // Straps (cintas/webbing): banda RECTA de ancho fijo (del material) y largo del usuario, en cualquier
    // ángulo/posición. Puede iniciar fuera, cruzar y salir del paño. Remates = costuras perpendiculares en
    // los extremos (símbolo zigzag). No dobla: el pivote (ax,ay) es solo el punto de referencia/rotación.
    let straps = (spec.straps || []).filter((s) => s && parseFloat(s.ancho) > 0 && ((Math.max(0, parseFloat(s.offset) || 0)) + (Math.max(0, parseFloat(s.inset) || 0))) > 0).map((s) => {
      const th = (parseFloat(s.angulo) || 0) * Math.PI / 180;
      const dx = Math.cos(th), dy = Math.sin(th);
      const px = -dy, py = dx; // perpendicular unitaria
      const W = parseFloat(s.ancho), hw = W / 2;
      const off = Math.max(0, parseFloat(s.offset) || 0), ins = Math.max(0, parseFloat(s.inset) || 0), Ls = off + ins;
      const cx = parseFloat(s.cx) || 0, cy = parseFloat(s.cy) || 0; // punto central/pivote
      const ax = cx - dx * ins, ay = cy - dy * ins; // extremo "inset"
      const bx = cx + dx * off, by = cy + dy * off; // extremo "offset"
      const corners = [
        { x: ax + px * hw, y: ay + py * hw },
        { x: bx + px * hw, y: by + py * hw },
        { x: bx - px * hw, y: by - py * hw },
        { x: ax - px * hw, y: ay - py * hw },
      ];
      const rem0 = { a: { x: ax + px * hw, y: ay + py * hw }, b: { x: ax - px * hw, y: ay - py * hw } };
      const rem1 = { a: { x: bx + px * hw, y: by + py * hw }, b: { x: bx - px * hw, y: by - py * hw } };
      const nom = (s.legend && s.legend.trim()) ? s.legend.trim() : "Strap";
      return { corners: corners, rem0: rem0, rem1: rem1, a: { x: ax, y: ay }, b: { x: bx, y: by }, dir: { x: dx, y: dy }, perp: { x: px, y: py }, hw: hw, ancho: W, largo: Ls, nombre: nom, grupo: s.grupo || "Manual" };
    });
    // Straps anclados a la arista de un corte: cintas que CRUZAN el corte, repartidas a lo largo de él
    // (como los ojetillos por arista). Cada strap es perpendicular al corte; offset cruza hacia el lado
    // elegido e inset hacia el opuesto. Distanciamiento = separación; supresión por índice.
    (cortes || []).forEach((cc) => {
      if (!(cc.strapAncho > 0) || !cc.segments || !cc.segments[0]) return;
      const off = Math.max(0, cc.strapOffset || 0), ins = Math.max(0, cc.strapInset || 0);
      if (!(off + ins > 0)) return;
      const sa = cc.segments[0].a, sb = cc.segments[0].b, L = Math.hypot(sb.x - sa.x, sb.y - sa.y);
      if (!(L > 0)) return;
      const ux = (sb.x - sa.x) / L, uy = (sb.y - sa.y) / L, pxn = -uy, pyn = ux; // ux=along, pxn=perp(cruza)
      const W = cc.strapAncho, hw = W / 2, sgn = (cc.strapLado === "B") ? -1 : 1;
      const ldx = pxn * sgn, ldy = pyn * sgn; // eje largo del strap = perpendicular al corte, hacia lado del offset
      const d = cc.strapD || 0, supr = new Set(Array.isArray(cc.strapSupr) ? cc.strapSupr : []);
      const pts = (d > 0) ? posicionesArista(L, d, false) : [L / 2];
      pts.forEach((t, i) => {
        if (supr.has(i)) return;
        const Px = sa.x + ux * t, Py = sa.y + uy * t;
        const ax = Px - ldx * ins, ay = Py - ldy * ins; // extremo lado B
        const bx = Px + ldx * off, by = Py + ldy * off; // extremo lado A (offset)
        const corners = [{ x: ax + ux * hw, y: ay + uy * hw }, { x: bx + ux * hw, y: by + uy * hw }, { x: bx - ux * hw, y: by - uy * hw }, { x: ax - ux * hw, y: ay - uy * hw }];
        straps.push({ corners: corners, rem0: { a: corners[0], b: corners[3] }, rem1: { a: corners[1], b: corners[2] }, a: { x: ax, y: ay }, b: { x: bx, y: by }, dir: { x: ldx, y: ldy }, perp: { x: ux, y: uy }, hw: hw, ancho: W, largo: off + ins, nombre: cc.strapNombre || "Cinta", grupo: (cc.strapNombre && cc.strapNombre.trim()) ? cc.strapNombre.trim() : "Corte", origen: "corte", precioM: cc.strapPrecioM || 0 });
      });
    });
    return { ancho: ancho, largo: largo, ojetillos: ojetillos, ventanas: ventanas, cortes: cortes, bolsillos: bolsillos, aletas: aletas, straps: straps, bordesRot: spec.bordesRot || null, unionesRot: spec.unionesRot || null };
  }

  // Descriptores de cota (coordenadas del producto). axis "h" = arriba, "v" = izquierda.
  // Cotas con origen en el CENTRO del producto para la posición de los elementos (ventanas/calados),
  // tamaño de cada elemento, dimensiones base, y cotas de aletas (tamaño propio + total exterior).
  // Cada cota lleva 'side' (top/bottom/left/right) para ubicarse del lado correcto.
  function cotasDe(sk) {
    const out = [];
    const A = sk.ancho, L = sk.largo;
    if (!(A > 0) || !(L > 0)) return out;
    const cx = A / 2, cy = L / 2;
    const rects = (sk.ventanas || []).concat((sk.cortes || []).filter((c) => !c.rotated && !c.circ).map((c) => ({ x: c.x, y: c.y, w: c.w, h: c.h })));
    let minX = 0, maxX = A, minY = 0, maxY = L;
    (sk.aletas || []).forEach((a) => { minX = Math.min(minX, a.x); maxX = Math.max(maxX, a.x + a.w); minY = Math.min(minY, a.y); maxY = Math.max(maxY, a.y + a.h); });
    const baseOff = OFF_MIN0 + rects.length * OFF_STEP + OFF_GAP;
    const aletaOff = baseOff + OFF_STEP;
    const totalOff = baseOff + 2 * OFF_STEP + 4;
    // Base (general): ancho arriba, largo a la izquierda.
    out.push({ axis: "h", a: 0, b: A, off: baseOff, value: A, side: "top" });
    out.push({ axis: "v", a: 0, b: L, off: baseOff, value: L, side: "left" });
    // Elementos: tamaño + posición desde el centro (al borde que mira al centro).
    rects.forEach((v, i) => {
      const off = OFF_MIN0 + i * OFF_STEP;
      out.push({ axis: "h", a: v.x, b: v.x + v.w, off: off, value: v.w, side: "top" });
      out.push({ axis: "v", a: v.y, b: v.y + v.h, off: off, value: v.h, side: "left" });
      const nearX = (v.x + v.w / 2) <= cx ? (v.x + v.w) : v.x;
      if (Math.abs(cx - nearX) > EPS) out.push({ axis: "h", a: Math.min(cx, nearX), b: Math.max(cx, nearX), off: off, value: Math.abs(cx - nearX), side: "top", desdeCentro: true });
      const nearY = (v.y + v.h / 2) <= cy ? (v.y + v.h) : v.y;
      if (Math.abs(cy - nearY) > EPS) out.push({ axis: "v", a: Math.min(cy, nearY), b: Math.max(cy, nearY), off: off, value: Math.abs(cy - nearY), side: "left", desdeCentro: true });
    });
    // Aletas (opción A): ancho propio (lado exterior) + caída (apilada del lado de la base) + total exterior.
    (sk.aletas || []).forEach((a) => {
      const below = a.y >= L - EPS, above = (a.y + a.h) <= EPS;
      const right = a.x >= A - EPS;
      if (below || above) {
        out.push({ axis: "h", a: a.x, b: a.x + a.w, off: OFF_MIN0, value: a.w, side: below ? "bottom" : "top" });
        out.push({ axis: "v", a: a.y, b: a.y + a.h, off: aletaOff, value: a.h, side: "left" });
      } else { // izquierda o derecha
        out.push({ axis: "v", a: a.y, b: a.y + a.h, off: OFF_MIN0, value: a.h, side: right ? "right" : "left" });
        out.push({ axis: "h", a: a.x, b: a.x + a.w, off: aletaOff, value: a.w, side: "top" });
      }
    });
    // Total exterior (incluye aletas) solo si exceden el paño base.
    if (maxY > L + EPS || minY < -EPS) out.push({ axis: "v", a: minY, b: maxY, off: totalOff, value: maxY - minY, side: "left", total: true });
    if (maxX > A + EPS || minX < -EPS) out.push({ axis: "h", a: minX, b: maxX, off: totalOff, value: maxX - minX, side: "top", total: true });
    // Cortes / secciones: ubicar cada extremo del corte en las aristas LIBRES (X abajo desde la izq.,
    // Y a la derecha desde arriba). Se escalonan por encima de lo ya usado en esos lados.
    const cutPts = [];
    (sk.cortes || []).forEach((c) => { (c.segments || []).forEach((seg) => { if (seg && seg.a && seg.b) { cutPts.push(seg.a); cutPts.push(seg.b); } }); });
    if (cutPts.length) {
      const uniq = (vals, max) => {
        const set = [];
        vals.forEach((v) => { const r = Math.round(v * 1000) / 1000; if (r > EPS && r < max - EPS && !set.some((s) => Math.abs(s - r) < EPS)) set.push(r); });
        return set.sort((a, b) => a - b);
      };
      const xs = uniq(cutPts.map((p) => p.x), A);
      const ys = uniq(cutPts.map((p) => p.y), L);
      let bOff = OFF_MIN0, rOff = OFF_MIN0;
      out.forEach((c) => { if (c.side === "bottom" && c.off >= bOff) bOff = c.off + OFF_STEP; if (c.side === "right" && c.off >= rOff) rOff = c.off + OFF_STEP; });
      xs.forEach((x) => { out.push({ axis: "h", a: 0, b: x, off: bOff, value: x, side: "bottom", corte: true }); bOff += OFF_STEP; });
      ys.forEach((y) => { out.push({ axis: "v", a: 0, b: y, off: rOff, value: y, side: "right", corte: true }); rOff += OFF_STEP; });
    }
    return out;
  }
  function offsetCota(c) { return c.off; }
  // Margen necesario por lado (para que las cotas no se salgan del lienzo).
  function margenCotasLados(sk) {
    const m = { top: 0, bottom: 0, left: 0, right: 0 };
    cotasDe(sk).forEach((c) => { if (c.off > m[c.side]) m[c.side] = c.off; });
    ["top", "bottom", "left", "right"].forEach((k) => { if (m[k] > 0) m[k] += 14; });
    return m;
  }
  function margenCotas(sk) { const m = margenCotasLados(sk); return Math.max(m.top, m.bottom, m.left, m.right); }
  // Centro del producto (para dibujar el eje de referencia).
  function centroProducto(sk) { return { cx: (sk.ancho || 0) / 2, cy: (sk.largo || 0) / 2 }; }

  function fmt(n) { return (Math.round(n * 1000) / 1000).toString(); }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c])); }
  // Barbas de una flecha cuyo vértice está en (tx,ty) y apunta en (dx,dy). Dos segmentos.
  function flechaBarbas(tx, ty, dx, dy, size) {
    size = size || 5; const ang = Math.atan2(dy, dx);
    const a1 = ang + Math.PI - 0.45, a2 = ang + Math.PI + 0.45;
    return [
      { x1: tx, y1: ty, x2: tx + size * Math.cos(a1), y2: ty + size * Math.sin(a1) },
      { x1: tx, y1: ty, x2: tx + size * Math.cos(a2), y2: ty + size * Math.sin(a2) },
    ];
  }

  // Tijeras: lista de primitivas (circles + lines) en torno a (cx,cy), tamaño s. Sin rotación.
  function tijeraPrims(cx, cy, s) {
    s = s || 8;
    const lx = cx - s * 0.6, p = cx + s * 0.7;
    return {
      circles: [{ x: lx, y: cy - s * 0.34, r: s * 0.2 }, { x: lx, y: cy + s * 0.34, r: s * 0.2 }],
      lines: [
        { x1: lx, y1: cy - s * 0.34, x2: p, y2: cy + s * 0.16 },
        { x1: lx, y1: cy + s * 0.34, x2: p, y2: cy - s * 0.16 },
      ],
    };
  }
  // Posiciones de tijeras a lo largo de un segmento (en píxeles): 1 a 4 según el largo.
  function tijerasEn(x1, y1, x2, y2) {
    const L = Math.hypot(x2 - x1, y2 - y1);
    const n = Math.min(2, Math.max(1, Math.round(L / 120))); // 1–2 tijeras por línea, suficiente para entenderse
    const out = [];
    for (let k = 0; k < n; k++) { const t = (k + 0.5) / n; out.push({ x: x1 + (x2 - x1) * t, y: y1 + (y2 - y1) * t }); }
    return out;
  }

  // ¿El rótulo (texto) cabe dentro del elemento (en px)? Si no, se usa rótulo-guía (callout).
  function labelCabe(text, wpx, hpx, fs) { fs = fs || 6.5; const est = String(text || "").length * fs * 0.54; return (wpx - 4) >= est && hpx >= (fs + 3); }
  // Dibuja los elementos de un paño (aletas, ventanas, bolsillos, ojetillos, cortes) según una
  // transformación dada. t = { px, py, scale, r, ojeSVG, ox, oy, w, h, cb? }. Reusado por sketchSVG y volSVG.
  // Puntos de un zigzag de (x1,y1) a (x2,y2) (para remates de strap = costura perpendicular).
  function zigzagPts(x1, y1, x2, y2, amp, seg) {
    const dx = x2 - x1, dy = y2 - y1, len = Math.hypot(dx, dy) || 1;
    const pxp = -dy / len, pyp = dx / len, n = Math.max(3, Math.round(len / (seg || 4)));
    const pts = [{ x: x1, y: y1 }];
    for (let i = 1; i < n; i++) { const t = i / n, bx = x1 + dx * t, by = y1 + dy * t, sgn = (i % 2) ? 1 : -1; pts.push({ x: bx + pxp * amp * sgn, y: by + pyp * amp * sgn }); }
    pts.push({ x: x2, y: y2 });
    return pts;
  }
  function elementosSketch(sk, t) {
    const px = t.px, py = t.py, scale = t.scale, r = t.r, ojeSVG = t.ojeSVG;
    const ox = t.ox, oy = t.oy, w = t.w, h = t.h;
    const f1 = (n) => n.toFixed(1);
    let s = "";
    // Rótulo-guía (callout) estilo despiece: rótulos que no caben salen a la derecha, apilados,
    // con línea guía diagonal→horizontal y punta de flecha al título. cb = { x, y, dy, n }.
    const cb = t.cb;
    function callout(anchorX, anchorY, text, detail, obj) {
      if (!cb) return;
      const ly = cb.slots.get(obj); if (ly == null) { s += `<text class="callout-lbl" x="${f1(anchorX)}" y="${f1(anchorY)}" text-anchor="middle">${esc(text)}</text>`; return; }
      // Quiebre claramente diagonal (≠ cotas): tramo corto en diagonal desde el elemento y luego horizontal al título.
      const lx = cb.x, elbowX = anchorX + 16;
      s += `<circle class="callout-dot" cx="${f1(anchorX)}" cy="${f1(anchorY)}" r="1.3"/>`;
      s += `<polyline class="callout-line" points="${f1(anchorX)},${f1(anchorY)} ${f1(elbowX)},${f1(ly)} ${f1(lx - 4)},${f1(ly)}"/>`;
      s += `<polygon class="callout-arrow" points="${f1(lx - 1)},${f1(ly)} ${f1(lx - 6)},${f1(ly - 2.4)} ${f1(lx - 6)},${f1(ly + 2.4)}"/>`;
      s += `<text class="callout-lbl" x="${f1(lx)}" y="${f1(ly + (detail ? 0 : 2))}">${esc(text)}</text>`;
      if (detail) s += `<text class="callout-dim" x="${f1(lx)}" y="${f1(ly + 6)}">${esc(detail)}</text>`;
    }
    // Detalle técnico (dimensiones) de un anexo para el rótulo: ancho × caída + offset + ojetillos.
    function aletaDetalle(a) {
      const parts = [fmt(a.ancho || a.w) + "×" + fmt(a.largo || a.h) + " m"];
      if ((a.offset || 0) > 0) parts.push("offset " + fmt(a.offset));
      const n = (a.ojetillos || []).length; if (n > 0) parts.push(n + " ojet.");
      return parts.join(" · ");
    }
    // Uniones entre paños: líneas de costura (dashed) donde se unen los rollos, + etiqueta. Solo si el usuario lo activa.
    const ur = sk.unionesRot;
    if (ur && ur.mostrar && ur.anchoRollo > 0 && sk.ancho > 0 && sk.largo > 0) {
      const R = ur.anchoRollo, A = sk.ancho, L = sk.largo, dim = ur.orient === "ancho" ? L : A;
      const n = Math.ceil(dim / R - 1e-9);
      for (let i = 1; i < n; i++) {
        const d = i * R; if (d >= dim - 1e-9) break;
        if (ur.orient === "ancho") s += `<line class="union-seam" x1="${f1(px(0))}" y1="${f1(py(d))}" x2="${f1(px(A))}" y2="${f1(py(d))}"/>`;
        else s += `<line class="union-seam" x1="${f1(px(d))}" y1="${f1(py(0))}" x2="${f1(px(d))}" y2="${f1(py(L))}"/>`;
      }
      if (n > 1) {
        const ulbl = "Unión " + fmt(ur.valor) + " m";
        if (ur.orient === "ancho") s += `<text class="union-lbl" x="${f1(px(A) - 2)}" y="${f1(py(R) - 1.5)}" text-anchor="end">${esc(ulbl)}</text>`;
        else s += `<text class="union-lbl" x="${f1(px(R) + 1.5)}" y="${f1(py(0) + 7)}">${esc(ulbl)}</text>`;
      }
    }
    // Straps (cintas): banda recta + línea media + remates zigzag + etiqueta.
    (sk.straps || []).forEach((st) => {
      const poly = st.corners.map((c) => f1(px(c.x)) + "," + f1(py(c.y))).join(" ");
      s += `<polygon class="strap" points="${poly}"/>`;
      s += `<line class="strap-mid" x1="${f1(px(st.a.x))}" y1="${f1(py(st.a.y))}" x2="${f1(px(st.b.x))}" y2="${f1(py(st.b.y))}"/>`;
      [st.rem0, st.rem1].forEach((rm) => {
        const zz = zigzagPts(px(rm.a.x), py(rm.a.y), px(rm.b.x), py(rm.b.y), 2.2, 4);
        s += `<polyline class="strap-rem" points="${zz.map((p) => f1(p.x) + "," + f1(p.y)).join(" ")}"/>`;
      });
      const Mx = px((st.a.x + st.b.x) / 2), My = py((st.a.y + st.b.y) / 2), offpx = st.hw * scale + 8;
      const lbl = st.nombre + " " + fmt(st.largo) + " m";
      s += `<text class="strap-lbl" x="${f1(Mx + st.perp.x * offpx)}" y="${f1(My + st.perp.y * offpx)}" text-anchor="middle">${esc(lbl)}</text>`;
    });
    // Aletas / solapas / faldón / cenefa (paños anexos) — con su arista fusionada.
    (sk.aletas || []).forEach((a) => {
      const X = px(a.x), Y = py(a.y), Wp = a.w * scale, Hp = a.h * scale;
      s += `<rect class="aleta" x="${f1(X)}" y="${f1(Y)}" width="${f1(Wp)}" height="${f1(Hp)}"/>`;
      let fa, fb;
      if (a.fused === "t") { fa = { x: X, y: Y }; fb = { x: X + Wp, y: Y }; }
      else if (a.fused === "b") { fa = { x: X, y: Y + Hp }; fb = { x: X + Wp, y: Y + Hp }; }
      else if (a.fused === "l") { fa = { x: X, y: Y }; fb = { x: X, y: Y + Hp }; }
      else { fa = { x: X + Wp, y: Y }; fb = { x: X + Wp, y: Y + Hp }; }
      const dx = fb.x - fa.x, dy = fb.y - fa.y, Lf = Math.hypot(dx, dy) || 1;
      flechaBarbas(fa.x, fa.y, dx / Lf, dy / Lf, 5).concat(flechaBarbas(fb.x, fb.y, -dx / Lf, -dy / Lf, 5))
        .forEach((b) => { s += `<line class="fusion" x1="${f1(b.x1)}" y1="${f1(b.y1)}" x2="${f1(b.x2)}" y2="${f1(b.y2)}"/>`; });
      (a.ojetillos || []).forEach((p) => { s += ojeSVG(px(p.x), py(p.y), "oje"); });
      if (cb && cb.slots.has(a)) callout(X + Wp / 2, Y + Hp / 2, a.nombre, aletaDetalle(a), a);
      else s += `<text class="aleta-lbl" x="${f1(X + Wp / 2)}" y="${f1(Y + Hp / 2)}" text-anchor="middle">${esc(a.nombre)}</text>`;
    });
    // Ventanas / paños inscritos (rectangulares o circulares) + leyenda, medida y flechas de fusión.
    sk.ventanas.forEach((v) => {
      const cx = px(v.x + v.w / 2), cy = py(v.y + v.h / 2);
      if (v.circ) {
        s += `<circle class="win" cx="${f1(cx)}" cy="${f1(cy)}" r="${f1(Math.min(v.w, v.h) / 2 * scale)}"/>`;
      } else {
        s += `<rect class="win" x="${f1(px(v.x))}" y="${f1(py(v.y))}" width="${f1(v.w * scale)}" height="${f1(v.h * scale)}"/>`;
      }
      const med = v.circ ? ("Ø" + fmt(v.w) + "m") : (fmt(v.w) + "×" + fmt(v.h) + "m");
      if (v.legend && cb && cb.slots.has(v)) { callout(cx, cy, v.legend, med, v); }
      else { if (v.legend) s += `<text class="ins-lbl" x="${f1(cx)}" y="${f1(cy - 1)}" text-anchor="middle">${esc(v.legend)}</text>`; s += `<text class="ins-dim" x="${f1(cx)}" y="${f1(cy + 6)}" text-anchor="middle">${med}</text>`; }
      if (!v.circ && v.fusion) {
        const X = px(v.x), Y = py(v.y), X2 = px(v.x + v.w), Y2 = py(v.y + v.h);
        const edges = [];
        if (v.fusion.sup) edges.push([X, Y, X2, Y]);
        if (v.fusion.inf) edges.push([X, Y2, X2, Y2]);
        if (v.fusion.izq) edges.push([X, Y, X, Y2]);
        if (v.fusion.der) edges.push([X2, Y, X2, Y2]);
        edges.forEach((e) => {
          const dx = e[2] - e[0], dy = e[3] - e[1], L = Math.hypot(dx, dy) || 1;
          flechaBarbas(e[0], e[1], dx / L, dy / L, 5).concat(flechaBarbas(e[2], e[3], -dx / L, -dy / L, 5))
            .forEach((b) => { s += `<line class="fusion" x1="${f1(b.x1)}" y1="${f1(b.y1)}" x2="${f1(b.x2)}" y2="${f1(b.y2)}"/>`; });
        });
      }
    });
    // Bolsillos (pestañas cosidas en las aristas) — banda con doblez + costura + Ø.
    const bandW = Math.max(8, Math.min(18, Math.min(w, h) * 0.12)), stitch = 3;
    (sk.bolsillos || []).forEach((bo) => {
      const horiz = (bo.arista === "sup" || bo.arista === "inf");
      let bx, by, bw, bh;
      if (bo.arista === "sup") { bx = ox; by = oy; bw = w; bh = bandW; }
      else if (bo.arista === "inf") { bx = ox; by = oy + h - bandW; bw = w; bh = bandW; }
      else if (bo.arista === "izq") { bx = ox; by = oy; bw = bandW; bh = h; }
      else { bx = ox + w - bandW; by = oy; bw = bandW; bh = h; }
      s += `<rect class="pocket" x="${f1(bx)}" y="${f1(by)}" width="${f1(bw)}" height="${f1(bh)}" rx="2"/>`;
      let lx1, ly1, lx2, ly2;
      if (bo.arista === "sup") { lx1 = bx; ly1 = by + bh; lx2 = bx + bw; ly2 = by + bh; }
      else if (bo.arista === "inf") { lx1 = bx; ly1 = by; lx2 = bx + bw; ly2 = by; }
      else if (bo.arista === "izq") { lx1 = bx + bw; ly1 = by; lx2 = bx + bw; ly2 = by + bh; }
      else { lx1 = bx; ly1 = by; lx2 = bx; ly2 = by + bh; }
      s += `<line class="pocket-line" x1="${f1(lx1)}" y1="${f1(ly1)}" x2="${f1(lx2)}" y2="${f1(ly2)}"/>`;
      const len = horiz ? bw : bh, n = Math.max(2, Math.round(len / 12));
      for (let i = 0; i <= n; i++) {
        const tt = i / n;
        if (horiz) { const sx = lx1 + (lx2 - lx1) * tt; s += `<line class="pocket-stitch" x1="${f1(sx)}" y1="${f1(ly1 - stitch)}" x2="${f1(sx)}" y2="${f1(ly1 + stitch)}"/>`; }
        else { const sy = ly1 + (ly2 - ly1) * tt; s += `<line class="pocket-stitch" x1="${f1(lx1 - stitch)}" y1="${f1(sy)}" x2="${f1(lx1 + stitch)}" y2="${f1(sy)}"/>`; }
      }
      const lbl = `Bolsillo Ø${fmt(bo.diam)}m · L${fmt(horiz ? sk.ancho : sk.largo)}m`;
      if (horiz) s += `<text class="pocket-lbl" x="${f1(bx + bw / 2)}" y="${f1(by + bh / 2 + 2.5)}" text-anchor="middle">${lbl}</text>`;
      else { const mx = bx + bw / 2, my = by + bh / 2; s += `<text class="pocket-lbl" x="${f1(mx)}" y="${f1(my)}" text-anchor="middle" transform="rotate(-90 ${f1(mx)} ${f1(my)})">${lbl}</text>`; }
    });
    // Ojetillos del paño base — desplazados hacia adentro (≥1px desde la tangente).
    const inset = r + 1;
    sk.ojetillos.forEach((p) => {
      let cx = px(p.x), cy = py(p.y);
      if (p.x <= EPS) cx += inset; else if (p.x >= sk.ancho - EPS) cx -= inset;
      if (p.y <= EPS) cy += inset; else if (p.y >= sk.largo - EPS) cy -= inset;
      s += ojeSVG(cx, cy, "oje");
    });
    // Cortes / calados: líneas de corte (lados existentes) + tijeras + ojetillos del corte
    const tijeraSVG = (tx, ty) => {
      const tp = tijeraPrims(tx, ty, 8); let out = "";
      tp.circles.forEach((cc) => { out += `<circle class="scissor" cx="${f1(cc.x)}" cy="${f1(cc.y)}" r="${f1(cc.r)}"/>`; });
      tp.lines.forEach((ln) => { out += `<line class="scissor" x1="${f1(ln.x1)}" y1="${f1(ln.y1)}" x2="${f1(ln.x2)}" y2="${f1(ln.y2)}"/>`; });
      return out;
    };
    sk.cortes.forEach((c) => {
      if (c.fadePoly && c.fadePoly.length >= 3) {
        s += `<polygon class="cut-fade" points="${c.fadePoly.map((p) => f1(px(p.x)) + "," + f1(py(p.y))).join(" ")}"/>`;
      }
      (c.hatch || []).forEach((sg) => {
        s += `<line class="cut-hatch" x1="${f1(px(sg.a.x))}" y1="${f1(py(sg.a.y))}" x2="${f1(px(sg.b.x))}" y2="${f1(py(sg.b.y))}"/>`;
      });
      c.segments.forEach((sg) => {
        const a = px(sg.a.x), b = py(sg.a.y), d = px(sg.b.x), e = py(sg.b.y);
        s += `<line class="cut" x1="${f1(a)}" y1="${f1(b)}" x2="${f1(d)}" y2="${f1(e)}"/>`;
        if (!c.tijeras) tijerasEn(a, b, d, e).forEach((tp) => { s += tijeraSVG(tp.x, tp.y); });
      });
      if (c.tijeras) c.tijeras.forEach((tp) => { s += tijeraSVG(px(tp.x), py(tp.y)); });
      c.ojetillos.forEach((p) => { s += ojeSVG(px(p.x), py(p.y), "cut-oje"); });
      if (c.rotated && c.pivote) {
        const cx = px(c.pivote.x), cy = py(c.pivote.y);
        s += `<circle class="cut-piv" cx="${f1(cx)}" cy="${f1(cy)}" r="2.6"/>`;
        s += `<line class="cut-piv" x1="${f1(cx - 5)}" y1="${f1(cy)}" x2="${f1(cx + 5)}" y2="${f1(cy)}"/>`;
        s += `<line class="cut-piv" x1="${f1(cx)}" y1="${f1(cy - 5)}" x2="${f1(cx)}" y2="${f1(cy + 5)}"/>`;
      }
      if (c.rotated && c.segments.length) {
        const sg = c.segments[0], mx = px((sg.a.x + sg.b.x) / 2), my = py((sg.a.y + sg.b.y) / 2);
        s += `<text class="cut-lbl" x="${f1(mx + 4)}" y="${f1(my - 4)}">${fmt(c.angulo)}°</text>`;
      }
    });
    return s;
  }

  // ----- Simbología: qué símbolos están presentes en el plano (orden canónico) -----
  const SIMBOLOS = [
    { k: "oje", label: "Ojetillos" },
    { k: "win", label: "Paño inscrito / ventana" },
    { k: "aleta", label: "Aleta / faldón" },
    { k: "pocket", label: "Bolsillo" },
    { k: "cut", label: "Calado / corte" },
    { k: "fusion", label: "Fusión (unir paños)" },
    { k: "strap", label: "Strap / cinta (banda)" },
    { k: "piv", label: "Pivote de giro" },
  ];
  function simbologia(sk) {
    if (!sk) return [];
    const has = {};
    const ojeBase = (sk.ojetillos || []).length > 0;
    const ojeAle = (sk.aletas || []).some((a) => (a.ojetillos || []).length > 0);
    const ojeCut = (sk.cortes || []).some((c) => (c.ojetillos || []).length > 0);
    has.oje = ojeBase || ojeAle || ojeCut;
    has.win = (sk.ventanas || []).length > 0;
    has.aleta = (sk.aletas || []).length > 0;
    has.pocket = (sk.bolsillos || []).length > 0;
    has.cut = (sk.cortes || []).length > 0;
    // Fusión: las aletas siempre llevan arista fusionada; las ventanas, si tienen algún lado fusionado.
    has.fusion = has.aleta || (sk.ventanas || []).some((v) => v.fusion && (v.fusion.sup || v.fusion.inf || v.fusion.izq || v.fusion.der));
    has.piv = (sk.cortes || []).some((c) => c.rotated);
    has.strap = (sk.straps || []).length > 0;
    return SIMBOLOS.filter((s) => has[s.k]);
  }

  // Glifo SVG de un símbolo, centrado en (gx, gy). Reusa las clases del CSS para color.
  function glifoSVG(k, gx, gy, ojeSVG, r) {
    const f1 = (n) => n.toFixed(1), W = 6, Hh = 3.2;
    if (k === "oje") return ojeSVG(gx, gy, "oje");
    if (k === "win") return `<rect class="win" x="${f1(gx - W)}" y="${f1(gy - Hh)}" width="${f1(W * 2)}" height="${f1(Hh * 2)}"/>`;
    if (k === "aleta") return `<rect class="aleta" x="${f1(gx - W)}" y="${f1(gy - Hh)}" width="${f1(W * 2)}" height="${f1(Hh * 2)}"/>`;
    if (k === "pocket") {
      let o = `<rect class="pocket" x="${f1(gx - W)}" y="${f1(gy - Hh)}" width="${f1(W * 2)}" height="${f1(Hh * 2)}" rx="1.2"/>`;
      o += `<line class="pocket-line" x1="${f1(gx - W)}" y1="${f1(gy + Hh * 0.4)}" x2="${f1(gx + W)}" y2="${f1(gy + Hh * 0.4)}"/>`;
      for (let i = 0; i <= 3; i++) { const sx = gx - W + (2 * W) * i / 3; o += `<line class="pocket-stitch" x1="${f1(sx)}" y1="${f1(gy + Hh * 0.4 - 1.2)}" x2="${f1(sx)}" y2="${f1(gy + Hh * 0.4 + 1.2)}"/>`; }
      return o;
    }
    if (k === "cut") {
      let o = `<line class="cut" x1="${f1(gx - W)}" y1="${f1(gy)}" x2="${f1(gx + W)}" y2="${f1(gy)}"/>`;
      for (let i = 0; i < 3; i++) { const sx = gx - W * 0.6 + i * W * 0.6; o += `<line class="cut-hatch" x1="${f1(sx)}" y1="${f1(gy - 2)}" x2="${f1(sx + 1.6)}" y2="${f1(gy + 2)}"/>`; }
      return o;
    }
    if (k === "fusion") {
      let o = "";
      flechaBarbas(gx - W, gy, 1, 0, 4).concat(flechaBarbas(gx + W, gy, -1, 0, 4))
        .forEach((b) => { o += `<line class="fusion" x1="${f1(b.x1)}" y1="${f1(b.y1)}" x2="${f1(b.x2)}" y2="${f1(b.y2)}"/>`; });
      o += `<line class="fusion" x1="${f1(gx - W)}" y1="${f1(gy)}" x2="${f1(gx + W)}" y2="${f1(gy)}"/>`;
      return o;
    }
    if (k === "piv") {
      let o = `<circle class="cut-piv" cx="${f1(gx)}" cy="${f1(gy)}" r="2.2"/>`;
      o += `<line class="cut-piv" x1="${f1(gx - 5)}" y1="${f1(gy)}" x2="${f1(gx + 5)}" y2="${f1(gy)}"/>`;
      o += `<line class="cut-piv" x1="${f1(gx)}" y1="${f1(gy - 5)}" x2="${f1(gx)}" y2="${f1(gy + 5)}"/>`;
      return o;
    }
    return "";
  }
  // Bloque de leyenda SVG anclado con su esquina superior-izquierda en (x0, yTop).
  function leyendaSVG(items, x0, yTop, ojeSVG, r) {
    if (!items.length) return "";
    const f1 = (n) => n.toFixed(1), rowH = 11, titH = 11, boxW = 96;
    const boxH = titH + items.length * rowH + 4;
    let s = `<rect class="leyenda-bg" x="${f1(x0 - 4)}" y="${f1(yTop - 2)}" width="${f1(boxW)}" height="${f1(boxH)}" rx="3"/>`;
    s += `<text class="leyenda-tit" x="${f1(x0)}" y="${f1(yTop + 7)}">SIMBOLOGÍA</text>`;
    items.forEach((it, i) => {
      const yMid = yTop + titH + i * rowH + rowH / 2, gx = x0 + 7;
      s += glifoSVG(it.k, gx, yMid, ojeSVG, r);
      s += `<text class="leyenda-lbl" x="${f1(x0 + 18)}" y="${f1(yMid + 2.4)}">${esc(it.label)}</text>`;
    });
    return s;
  }
  // Resumen de straps agrupado por origen (arista/corte/manual) y por medida (largo × ancho).
  // Devuelve filas { grupo, largo, ancho, n } ordenadas por grupo y luego por medida.
  function strapsResumen(sk) {
    const map = new Map();
    (sk && sk.straps || []).forEach((st) => {
      const grupo = st.grupo || "Strap";
      const largo = Math.round((parseFloat(st.largo) || 0) * 1000) / 1000;
      const ancho = Math.round((parseFloat(st.ancho) || 0) * 1000) / 1000;
      const key = grupo + "|" + largo + "|" + ancho;
      const prev = map.get(key);
      if (prev) prev.n += 1; else map.set(key, { grupo: grupo, largo: largo, ancho: ancho, n: 1 });
    });
    return Array.from(map.values()).sort((a, b) => (a.grupo < b.grupo ? -1 : a.grupo > b.grupo ? 1 : a.largo - b.largo));
  }
  // Bloque SVG "STRAPS" (resumen) anclado en (x0, yTop). Mismas clases visuales que la leyenda.
  function resumenStrapsSVG(sk, x0, yTop) {
    const filas = strapsResumen(sk);
    if (!filas.length) return "";
    const f1 = (n) => n.toFixed(1), rowH = 9, titH = 11, boxW = 132;
    const total = filas.reduce((a, r) => a + r.n, 0);
    const boxH = titH + (filas.length + 1) * rowH + 4;
    let s = `<rect class="leyenda-bg" x="${f1(x0 - 4)}" y="${f1(yTop - 2)}" width="${f1(boxW)}" height="${f1(boxH)}" rx="3"/>`;
    s += `<text class="leyenda-tit" x="${f1(x0)}" y="${f1(yTop + 7)}">STRAPS POR ARISTA</text>`;
    filas.forEach((r, i) => {
      const y = yTop + titH + i * rowH + rowH / 2 + 1.4;
      const med = fmt(r.largo) + " m × " + fmt(Math.round(r.ancho * 100)) + " cm";
      s += `<text class="leyenda-lbl" x="${f1(x0)}" y="${f1(y)}">${esc(r.grupo)}</text>`;
      s += `<text class="leyenda-lbl" x="${f1(x0 + boxW - 8)}" y="${f1(y)}" text-anchor="end">${r.n} × ${esc(med)}</text>`;
    });
    const yT = yTop + titH + filas.length * rowH + rowH / 2 + 1.4;
    s += `<text class="leyenda-tit" x="${f1(x0)}" y="${f1(yT)}">TOTAL</text>`;
    s += `<text class="leyenda-tit" x="${f1(x0 + boxW - 8)}" y="${f1(yT)}" text-anchor="end">${total} cinta(s)</text>`;
    return s;
  }

  // SVG temático (clases coloreadas por el CSS de la App).
  // ----- Vista volumétrica: cuboide 3D + hoja de corte desplegada (calados en esquinas) -----
  function volSVG(spec, opts) {
    opts = opts || {};
    const A = parseFloat(spec.ancho) || 0, L = parseFloat(spec.largo) || 0, H = parseFloat(spec.volumetrico.alto) || 0;
    if (!(A > 0) || !(L > 0) || !(H > 0)) return '<p class="muted small">Ingresa largo, ancho y alto para ver la vista volumétrica.</p>';
    const conCotas = opts.cotas !== false;
    const f1 = (n) => n.toFixed(1);
    const VW = 380;
    // Simbología presente en la hoja desplegada (sin aletas: no aplican en volumétrico).
    const skVol = Object.assign({}, construirSketch(spec), { aletas: [], straps: [] });
    const simbVol = simbologia(skVol);
    const legH = simbVol.length ? (11 + simbVol.length * 11 + 8) : 0;
    const hCota = (xa, xb, y, val) => {
      let o = `<line class="cota" x1="${f1(xa)}" y1="${f1(y)}" x2="${f1(xb)}" y2="${f1(y)}"/>`;
      o += `<line class="cota-tick" x1="${f1(xa)}" y1="${f1(y - 2.5)}" x2="${f1(xa)}" y2="${f1(y + 2.5)}"/>`;
      o += `<line class="cota-tick" x1="${f1(xb)}" y1="${f1(y - 2.5)}" x2="${f1(xb)}" y2="${f1(y + 2.5)}"/>`;
      o += `<text class="cota-lbl" x="${f1((xa + xb) / 2)}" y="${f1(y - 2)}" text-anchor="middle">${fmt(val)}m</text>`;
      return o;
    };
    const vCota = (ya, yb, x, val) => {
      let o = `<line class="cota" x1="${f1(x)}" y1="${f1(ya)}" x2="${f1(x)}" y2="${f1(yb)}"/>`;
      o += `<line class="cota-tick" x1="${f1(x - 2.5)}" y1="${f1(ya)}" x2="${f1(x + 2.5)}" y2="${f1(ya)}"/>`;
      o += `<line class="cota-tick" x1="${f1(x - 2.5)}" y1="${f1(yb)}" x2="${f1(x + 2.5)}" y2="${f1(yb)}"/>`;
      const my = (ya + yb) / 2;
      o += `<text class="cota-lbl" x="${f1(x - 3)}" y="${f1(my)}" text-anchor="middle" transform="rotate(-90 ${f1(x - 3)} ${f1(my)})">${fmt(val)}m</text>`;
      return o;
    };
    const scSVG = (tx, ty) => {
      const tp = tijeraPrims(tx, ty, 6); let o = "";
      tp.circles.forEach((c) => { o += `<circle class="scissor" cx="${f1(c.x)}" cy="${f1(c.y)}" r="${f1(c.r)}"/>`; });
      tp.lines.forEach((ln) => { o += `<line class="scissor" x1="${f1(ln.x1)}" y1="${f1(ln.y1)}" x2="${f1(ln.x2)}" y2="${f1(ln.y2)}"/>`; });
      return o;
    };
    // -------- Panel A: cuboide 3D (proyección oblicua) --------
    const paTop = 14, paH = 150;
    const dep = 0.5, k = 0.707;
    const needW = A + L * dep * k, needH = H + L * dep * k;
    const sc3 = Math.min((VW - 90) / needW, (paH - 38) / needH);
    const wA = A * sc3, hH = H * sc3, dd = L * dep * k * sc3;
    const bbW = wA + dd, bbH = hH + dd;
    const x0 = (VW - bbW) / 2, y0 = paTop + (paH + bbH) / 2; // frente-inferior-izq (punto más bajo)
    const FBL = [x0, y0], FBR = [x0 + wA, y0], FTL = [x0, y0 - hH], FTR = [x0 + wA, y0 - hH];
    const BBL = [x0 + dd, y0 - dd], BBR = [x0 + wA + dd, y0 - dd], BTL = [x0 + dd, y0 - hH - dd], BTR = [x0 + wA + dd, y0 - hH - dd];
    const P = (p) => f1(p[0]) + "," + f1(p[1]);
    let s = `<svg class="sketch-svg" viewBox="0 0 ${VW} 0H" xmlns="http://www.w3.org/2000/svg">`;
    s += `<text class="vista-tit" x="${f1(VW / 2)}" y="10" text-anchor="middle">REPRESENTACIÓN 3D</text>`;
    // Caras (relleno suave para dar volumen)
    s += `<polygon points="${P(FTL)} ${P(FTR)} ${P(BTR)} ${P(BTL)}" fill="rgba(120,140,170,0.18)" stroke="none"/>`; // tapa
    s += `<polygon points="${P(FTR)} ${P(BTR)} ${P(BBR)} ${P(FBR)}" fill="rgba(120,140,170,0.10)" stroke="none"/>`; // lado der
    s += `<polygon points="${P(FTL)} ${P(FTR)} ${P(FBR)} ${P(FBL)}" fill="rgba(120,140,170,0.04)" stroke="none"/>`; // frente
    // Aristas ocultas (punteadas)
    [[BBL, BBR], [BBL, BTL], [BBL, FBL]].forEach((e) => { s += `<line class="vol-fold" x1="${f1(e[0][0])}" y1="${f1(e[0][1])}" x2="${f1(e[1][0])}" y2="${f1(e[1][1])}"/>`; });
    // Aristas visibles (sólidas)
    [[FTL, FTR], [FTR, FBR], [FBR, FBL], [FBL, FTL], [FTL, BTL], [FTR, BTR], [FBR, BBR], [BTL, BTR], [BTR, BBR]].forEach((e) => {
      s += `<line class="vol-edge" x1="${f1(e[0][0])}" y1="${f1(e[0][1])}" x2="${f1(e[1][0])}" y2="${f1(e[1][1])}"/>`;
    });
    if (conCotas) {
      s += `<text class="cota-lbl" x="${f1((FBL[0] + FBR[0]) / 2)}" y="${f1(y0 + 9)}" text-anchor="middle">ancho ${fmt(A)}m</text>`;
      s += `<text class="cota-lbl" x="${f1(x0 - 4)}" y="${f1((FTL[1] + FBL[1]) / 2)}" text-anchor="middle" transform="rotate(-90 ${f1(x0 - 4)} ${f1((FTL[1] + FBL[1]) / 2)})">alto ${fmt(H)}m</text>`;
      const mlx = (FTR[0] + BTR[0]) / 2 + 3, mly = (FTR[1] + BTR[1]) / 2 - 2;
      s += `<text class="cota-lbl" x="${f1(mlx)}" y="${f1(mly)}">largo ${fmt(L)}m</text>`;
    }
    // -------- Panel B: hoja de corte desplegada --------
    const pbTit = paTop + paH;
    const Wd = A + 2 * H, Ld = L + 2 * H;
    const scB = Math.min((VW - 96) / Wd, 230 / Ld);
    const pbx = 52, pby = pbTit + 24;
    const X = (x) => pbx + x * scB, Y = (y) => pby + y * scB;
    const sheetBot = pby + Ld * scB + 20;
    const totalH = sheetBot + legH;
    s = s.replace("0H", f1(totalH)); // fijar alto del viewBox
    s += `<text class="vista-tit" x="${f1(VW / 2)}" y="${f1(pbTit + 12)}" text-anchor="middle">PLANO DESPLEGADO (hoja de corte)</text>`;
    // Contorno en cruz (tapa central + 4 alas), sin las esquinas (calados)
    const cross = [[H, 0], [H + A, 0], [H + A, H], [Wd, H], [Wd, H + L], [H + A, H + L], [H + A, Ld], [H, Ld], [H, H + L], [0, H + L], [0, H], [H, H]];
    s += `<polygon class="edge" points="${cross.map((p) => f1(X(p[0])) + "," + f1(Y(p[1]))).join(" ")}" fill="rgba(120,140,170,0.06)"/>`;
    // Líneas de plegado (rectángulo interno = tapa)
    [[[H, H], [H + A, H]], [[H, H + L], [H + A, H + L]], [[H, H], [H, H + L]], [[H + A, H], [H + A, H + L]]].forEach((e) => {
      s += `<line class="vol-fold" x1="${f1(X(e[0][0]))}" y1="${f1(Y(e[0][1]))}" x2="${f1(X(e[1][0]))}" y2="${f1(Y(e[1][1]))}"/>`;
    });
    // Calados en las 4 esquinas (cuadrados H×H que se recortan)
    const notch = [[0, 0], [A + H, 0], [0, L + H], [A + H, L + H]];
    notch.forEach((n) => {
      s += `<rect class="cut" x="${f1(X(n[0]))}" y="${f1(Y(n[1]))}" width="${f1(H * scB)}" height="${f1(H * scB)}" fill="rgba(216,68,58,0.06)"/>`;
      s += scSVG(X(n[0] + H / 2), Y(n[1] + H / 2));
    });
    // Elementos del paño (ventanas, calados, bolsillos, ojetillos) sobre la tapa central, offset por el alto.
    const skT = skVol;
    const rT = Math.max(1.4, Math.min(2.6, scB * 0.022));
    const ojeT = (cx, cy, cls) => `<circle class="${cls}" cx="${f1(cx)}" cy="${f1(cy)}" r="${f1(rT)}"/><circle class="${cls}-in" cx="${f1(cx)}" cy="${f1(cy)}" r="${f1(rT * 0.42)}"/>`;
    s += elementosSketch(skT, { px: (x) => X(H + x), py: (y) => Y(H + y), scale: scB, r: rT, ojeSVG: ojeT, ox: X(H), oy: Y(H), w: A * scB, h: L * scB });
    // Etiqueta de la tapa (esquina sup-izq, para no chocar con los elementos).
    s += `<text class="ins-lbl" x="${f1(X(H) + 3)}" y="${f1(Y(H) + 8)}">TAPA ${fmt(L)}×${fmt(A)}m</text>`;
    if (conCotas) {
      s += hCota(X(0), X(Wd), pby - 10, Wd); // ancho total = A+2·alto
      s += vCota(Y(0), Y(Ld), pbx - 12, Ld); // largo total = L+2·alto
      s += vCota(Y(0), Y(H), X(H + A) + 12, H); // alto (ala) marcado en una esquina
      s += `<text class="cota-lbl" x="${f1(X(H / 2))}" y="${f1(Y(H + L / 2))}" text-anchor="middle" transform="rotate(-90 ${f1(X(H / 2))} ${f1(Y(H + L / 2))})">calado ${fmt(H)}m</text>`;
    }
    // Leyenda de simbología (parte inferior izquierda).
    if (legH) {
      const ojeLeg = (cx, cy, cls) => `<circle class="${cls}" cx="${f1(cx)}" cy="${f1(cy)}" r="2.2"/><circle class="${cls}-in" cx="${f1(cx)}" cy="${f1(cy)}" r="0.9"/>`;
      s += leyendaSVG(simbVol, 6, sheetBot + 2, ojeLeg, 2.2);
    }
    s += `</svg>`;
    return s;
  }

  function sketchSVG(spec, opts) {
    opts = opts || {};
    if (spec.volumetrico && (parseFloat(spec.volumetrico.alto) || 0) > 0) return volSVG(spec, opts);
    const conCotas = opts.cotas !== false;
    const maxW = opts.maxW || 360, maxH = opts.maxH || 300;
    const sk = construirSketch(spec);
    if (!(sk.ancho > 0) || !(sk.largo > 0)) {
      return '<p class="muted small">Ingresa largo y ancho para ver el plano del producto.</p>';
    }
    const ML = conCotas ? margenCotasLados(sk) : { top: 0, bottom: 0, left: 0, right: 0 };
    const mLeft = ML.left + 24, mTop = ML.top + 32, mRight = ML.right + 30, mBot = ML.bottom + 26; // + espacio para rótulos de orientación
    // Bounds del paño (base + aletas) — las cotas se anclan AQUÍ (los straps NO afectan las cotas).
    let pMinX = 0, pMaxX = sk.ancho, pMinY = 0, pMaxY = sk.largo;
    (sk.aletas || []).forEach((a) => { pMinX = Math.min(pMinX, a.x); pMaxX = Math.max(pMaxX, a.x + a.w); pMinY = Math.min(pMinY, a.y); pMaxY = Math.max(pMaxY, a.y + a.h); });
    // El dibujo se dimensiona SOLO por el paño (los straps no lo alteran: se dibujan encima).
    const minX = pMinX, maxX = pMaxX, minY = pMinY, maxY = pMaxY;
    const bw = maxX - minX, bh = maxY - minY;
    const scale = Math.min((maxW - mLeft - mRight) / bw, (maxH - mTop - mBot) / bh);
    const w = sk.ancho * scale, h = sk.largo * scale;
    const px = (sx) => mLeft + (sx - minX) * scale, py = (sy) => mTop + (sy - minY) * scale;
    const ox = px(0), oy = py(0);
    // Leyenda de simbología (parte inferior izquierda): reserva alto al final del lienzo.
    const simb = simbologia(sk);
    const legRowH = 11, legTitH = 11, legPad = 8;
    const legH = simb.length ? (legTitH + simb.length * legRowH + legPad) : 0;
    const resFilas = strapsResumen(sk);
    const resH = resFilas.length ? (11 + (resFilas.length + 1) * 9 + 4) : 0;
    const bottomH = Math.max(legH, resH);
    const boundsBot = mTop + bh * scale;
    let totalW = bw * scale + mLeft + mRight;
    if (resFilas.length) totalW = Math.max(totalW, 246);
    // Rótulos-guía (callouts): rótulos de aletas/ventanas que no caben → a la DERECHA, pero cada uno
    // a la ALTURA de su elemento (zona libre más cercana), para que la guía sea corta y no cruce el plano.
    const calloutEls = [];
    const live = !!(opts && opts.live);
    (sk.aletas || []).forEach((a) => {
      const fits = labelCabe(a.nombre, a.w * scale, a.h * scale);
      if (live && a.id != null) AUTOROT[a.id] = !fits;
      if (a.rotulo || !fits) calloutEls.push({ obj: a, ay: py(a.y + a.h / 2) });
    });
    (sk.ventanas || []).forEach((v) => {
      if (!v.legend) return;
      const fits = labelCabe(v.legend, v.w * scale, v.h * scale);
      if (live && v.id != null) AUTOROT[v.id] = !fits;
      if (v.rotulo || !fits) calloutEls.push({ obj: v, ay: py(v.y + v.h / 2) });
    });
    let totalH = boundsBot + mBot + bottomH;
    let cb = null;
    if (calloutEls.length) {
      const calloutW = 108; totalW += calloutW;
      calloutEls.sort((A, B) => A.ay - B.ay);
      const slots = new Map(); const dy = 16, y0 = mTop + 4, midY = mTop + bh * scale / 2; let last = -1e9;
      // Empuja el rótulo ~10px lejos del borde más cercano (arriba si está en la mitad baja, abajo si está arriba)
      // para forzar un primer tramo diagonal; luego se apila evitando solapes.
      calloutEls.forEach((e) => { const off = (e.ay < midY) ? 10 : -10; let ly = Math.max(y0, Math.min(boundsBot, e.ay + off)); if (ly < last + dy) ly = last + dy; last = ly; slots.set(e.obj, ly); });
      cb = { x: totalW - calloutW + 26, slots: slots };
      totalH = Math.max(totalH, last + 8);
    }
    const rLeg = Math.max(1.7, Math.min(3.0, scale * 0.022)); // tamaño para el recuadro de simbología
    const r = Math.max(0.9, rLeg - 0.9); // ojetillos del PLANO: ~2 puntos (diámetro) más chicos
    const f1 = (n) => n.toFixed(1);
    // Ojetillo = anillo + círculo concéntrico menor (borde fino). ojeSVG = dibujo (chico); ojeLeg = leyenda.
    const ojeSVG = (cx, cy, cls) => `<circle class="${cls}" cx="${f1(cx)}" cy="${f1(cy)}" r="${f1(r)}"/><circle class="${cls}-in" cx="${f1(cx)}" cy="${f1(cy)}" r="${f1(r * 0.42)}"/>`;
    const ojeLeg = (cx, cy, cls) => `<circle class="${cls}" cx="${f1(cx)}" cy="${f1(cy)}" r="${f1(rLeg)}"/><circle class="${cls}-in" cx="${f1(cx)}" cy="${f1(cy)}" r="${f1(rLeg * 0.42)}"/>`;
    let s = `<svg class="sketch-svg" viewBox="0 0 ${f1(totalW)} ${f1(totalH)}" xmlns="http://www.w3.org/2000/svg">`;
    // Contorno
    s += `<rect class="edge" x="${f1(ox)}" y="${f1(oy)}" width="${f1(w)}" height="${f1(h)}"/>`;
    // Elementos del paño (aletas, ventanas, bolsillos, ojetillos, cortes)
    s += elementosSketch(sk, { px: px, py: py, scale: scale, r: r, ojeSVG: ojeSVG, ox: ox, oy: oy, w: w, h: h, cb: cb });
    // Cotas (verde) — origen al centro para posición de elementos; 4 lados; eje de referencia.
    if (conCotas) {
      const bTop = py(pMinY), bBot = py(pMaxY), bLeft = px(pMinX), bRight = px(pMaxX);
      const ccx = px(sk.ancho / 2), ccy = py(sk.largo / 2);
      s += `<line class="cota-eje" x1="${f1(ccx)}" y1="${f1(bTop)}" x2="${f1(ccx)}" y2="${f1(bBot)}"/>`;
      s += `<line class="cota-eje" x1="${f1(bLeft)}" y1="${f1(ccy)}" x2="${f1(bRight)}" y2="${f1(ccy)}"/>`;
      cotasDe(sk).forEach((c) => {
        const off = offsetCota(c);
        if (c.axis === "h") {
          const xa = px(c.a), xb = px(c.b);
          const base = (c.side === "bottom") ? bBot : bTop, dir = (c.side === "bottom") ? 1 : -1;
          const dimY = base + dir * off, tEnd = dimY - dir * EXTGAP;
          s += `<line class="cota-ext" x1="${f1(xa)}" y1="${f1(base)}" x2="${f1(xa)}" y2="${f1(tEnd)}"/>`;
          s += `<line class="cota-ext" x1="${f1(xb)}" y1="${f1(base)}" x2="${f1(xb)}" y2="${f1(tEnd)}"/>`;
          s += `<line class="cota" x1="${f1(xa)}" y1="${f1(dimY)}" x2="${f1(xb)}" y2="${f1(dimY)}"/>`;
          s += `<line class="cota-tick" x1="${f1(xa)}" y1="${f1(dimY - TICK)}" x2="${f1(xa)}" y2="${f1(dimY + TICK)}"/>`;
          s += `<line class="cota-tick" x1="${f1(xb)}" y1="${f1(dimY - TICK)}" x2="${f1(xb)}" y2="${f1(dimY + TICK)}"/>`;
          const ty = (c.side === "bottom") ? dimY + 7 : dimY - 2;
          s += `<text class="cota-lbl" x="${f1((xa + xb) / 2)}" y="${f1(ty)}" text-anchor="middle">${fmt(c.value)}m</text>`;
        } else {
          const ya = py(c.a), yb = py(c.b);
          const base = (c.side === "right") ? bRight : bLeft, dir = (c.side === "right") ? 1 : -1;
          const dimX = base + dir * off, tEnd = dimX - dir * EXTGAP;
          s += `<line class="cota-ext" x1="${f1(base)}" y1="${f1(ya)}" x2="${f1(tEnd)}" y2="${f1(ya)}"/>`;
          s += `<line class="cota-ext" x1="${f1(base)}" y1="${f1(yb)}" x2="${f1(tEnd)}" y2="${f1(yb)}"/>`;
          s += `<line class="cota" x1="${f1(dimX)}" y1="${f1(ya)}" x2="${f1(dimX)}" y2="${f1(yb)}"/>`;
          s += `<line class="cota-tick" x1="${f1(dimX - TICK)}" y1="${f1(ya)}" x2="${f1(dimX + TICK)}" y2="${f1(ya)}"/>`;
          s += `<line class="cota-tick" x1="${f1(dimX - TICK)}" y1="${f1(yb)}" x2="${f1(dimX + TICK)}" y2="${f1(yb)}"/>`;
          const my = (ya + yb) / 2, tx = (c.side === "right") ? dimX + 3 : dimX - 3;
          s += `<text class="cota-lbl" x="${f1(tx)}" y="${f1(my)}" text-anchor="middle" transform="rotate(-90 ${f1(tx)} ${f1(my)})">${fmt(c.value)}m</text>`;
        }
      });
    }
    // Rótulos de orientación (vista frontal/trasera + lados).
    const esTras = spec.vista === "trasera";
    const cxA = mLeft + bw * scale / 2, lyA = mTop + bh * scale / 2;
    // Terminación de cada arista (Tipo + medida) anexada a su rótulo de orientación. En la trasera se
    // invierten izq/der (espejo). Se omite en modo "suprimir cotas" (plano de aprobación limpio).
    const br = sk.bordesRot || {};
    const brIzq = esTras ? (br.der || "") : (br.izq || ""), brDer = esTras ? (br.izq || "") : (br.der || "");
    const tsp = (txt) => txt ? `<tspan class="vista-borde"> · ${esc(txt)}</tspan>` : "";
    s += `<text class="vista-tit" x="${f1(cxA)}" y="10" text-anchor="middle">VISTA ${esTras ? "TRASERA" : "FRONTAL"}</text>`;
    s += `<text class="vista-lbl" x="${f1(cxA)}" y="20" text-anchor="middle">SUPERIOR${tsp(br.sup)}</text>`;
    s += `<text class="vista-lbl" x="${f1(cxA)}" y="${f1(boundsBot + mBot - 8)}" text-anchor="middle">INFERIOR${tsp(br.inf)}</text>`;
    s += `<text class="vista-lbl" x="10" y="${f1(lyA)}" text-anchor="middle" transform="rotate(-90 10 ${f1(lyA)})">LADO IZQUIERDO${tsp(brIzq)}</text>`;
    s += `<text class="vista-lbl" x="${f1(totalW - 9)}" y="${f1(lyA)}" text-anchor="middle" transform="rotate(-90 ${f1(totalW - 9)} ${f1(lyA)})">LADO DERECHO${tsp(brDer)}</text>`;
    if (esTras) {
      s += `<text class="vista-sub" x="19" y="${f1(lyA)}" text-anchor="middle" transform="rotate(-90 19 ${f1(lyA)})">(frontal: der.)</text>`;
      s += `<text class="vista-sub" x="${f1(totalW - 18)}" y="${f1(lyA)}" text-anchor="middle" transform="rotate(-90 ${f1(totalW - 18)} ${f1(lyA)})">(frontal: izq.)</text>`;
    }
    // Leyenda de simbología en la parte inferior izquierda + resumen de straps contiguo.
    if (legH) s += leyendaSVG(simb, 6, boundsBot + mBot + 2, ojeLeg, rLeg);
    s += resumenStrapsSVG(sk, 108, boundsBot + mBot + 2);
    s += `</svg>`;
    return s;
  }

  const API = {
    construirSketch, sketchSVG, volSVG, ojetillosPerimetro, puntosArista,
    cotasDe, offsetCota, margenCotas, margenCotasLados, centroProducto, fmt, esc, tijeraPrims, tijerasEn, flechaBarbas, zigzagPts,
    distribuirArista, distribuirParejo, posicionesArista,
    aletaGeomRect, aletaOjArista, aletaOjPuntos,
    intervalosCalados, segmentosSolidos, posicionesAristaSeg,
    simbologia, strapsResumen, resumenStrapsSVG,
    autoRotulo: AUTOROT,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  global.SketchCIBSA = API;
})(typeof window !== "undefined" ? window : globalThis);
