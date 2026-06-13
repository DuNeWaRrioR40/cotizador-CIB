/* Sketch del producto: contorno (aristas), ojetillos (círculos), ventanas inscritas
   (rectángulos internos), cortes/calados (líneas de corte con tijeras) y cotas (líneas de
   dimensión, en rojo). Geometría reutilizable para la App (SVG) y el PDF. Cotas en metros.
   El corte NO afecta cálculo de valor ni material; un lado que coincide con el borde del
   paño base "desaparece" (queda calado abierto). */
(function (global) {
  const OFF_MAJOR = 34, OFF_MIN0 = 14, OFF_STEP = 13, TICK = 3, EXTGAP = 3, EPS = 0.001;

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
  // Distribuye 'count' puntos a lo largo de un segmento p0→p1 (extremos incluidos si count>=2).
  function puntosArista(count, p0, p1) {
    const pts = []; const c = Math.max(0, Math.round(count || 0));
    if (c <= 0) return pts;
    if (c === 1) { pts.push({ x: (p0.x + p1.x) / 2, y: (p0.y + p1.y) / 2 }); return pts; }
    for (let i = 0; i < c; i++) { const t = i / (c - 1); pts.push({ x: p0.x + (p1.x - p0.x) * t, y: p0.y + (p1.y - p0.y) * t }); }
    return pts;
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

  // spec: { ancho, largo, ojTotal, ventanas:[{x,y,w,h,circ}], cortes:[{x,y,w,h,circ,ojCirc,oj,...}] }
  function construirSketch(spec) {
    const ancho = parseFloat(spec.ancho), largo = parseFloat(spec.largo);
    const cortes = (spec.cortes || []).filter((c) => c && c.w > 0 && c.h > 0).map((c) => {
      const x = c.x, y = c.y, w = c.w, h = c.h;
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
      // Un lado se dibuja si el usuario lo dejó activo Y no coincide con el borde del paño base.
      const sides = {
        t: !!lados.sup && y > EPS, b: !!lados.inf && (y + h) < largo - EPS,
        l: !!lados.izq && x > EPS, r: !!lados.der && (x + w) < ancho - EPS,
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
      const ang = (parseFloat(c.angulo) || 0) * Math.PI / 180;
      const rotated = Math.abs(ang) > 1e-6;
      const Px = x + (c.pivX != null ? c.pivX : 0.5) * w, Py = y + (c.pivY != null ? c.pivY : 0.5) * h;
      if (rotated) {
        const co = Math.cos(ang), si = Math.sin(ang);
        const rot = (p) => { const dx = p.x - Px, dy = p.y - Py; return { x: Px + dx * co - dy * si, y: Py + dx * si + dy * co }; };
        segs = segs.map((s) => ({ a: rot(s.a), b: rot(s.b) }));
        pts = pts.map(rot);
        hatch = hatch.map((s) => ({ a: rot(s.a), b: rot(s.b) }));
      }
      return { x: x, y: y, w: w, h: h, sides: sides, segments: segs, ojetillos: pts, hatch: hatch, pivote: { x: Px, y: Py }, rotated: rotated, angulo: parseFloat(c.angulo) || 0 };
    });
    return {
      ancho: ancho, largo: largo,
      ojetillos: ojetillosPerimetro(spec.ojTotal, ancho, largo),
      ventanas: (spec.ventanas || []).filter((v) => v && v.w > 0 && v.h > 0).map((v) => ({ x: v.x, y: v.y, w: v.w, h: v.h, circ: !!v.circ })),
      cortes: cortes,
      bolsillos: (spec.bolsillos || []).filter((b) => b && (b.arista === "sup" || b.arista === "inf" || b.arista === "izq" || b.arista === "der")),
    };
  }

  // Descriptores de cota (coordenadas del producto). axis "h" = arriba, "v" = izquierda.
  function cotasDe(sk) {
    const out = [];
    if (!(sk.ancho > 0) || !(sk.largo > 0)) return out;
    out.push({ axis: "h", a: 0, b: sk.ancho, level: "major", slot: 0, value: sk.ancho });
    out.push({ axis: "v", a: 0, b: sk.largo, level: "major", slot: 0, value: sk.largo });
    const rects = (sk.ventanas || []).concat((sk.cortes || []).filter((c) => !c.rotated && !c.circ).map((c) => ({ x: c.x, y: c.y, w: c.w, h: c.h })));
    rects.forEach((v, i) => {
      if (v.x > EPS) out.push({ axis: "h", a: 0, b: v.x, level: "minor", slot: i, value: v.x });
      out.push({ axis: "h", a: v.x, b: v.x + v.w, level: "minor", slot: i, value: v.w });
      if (v.y > EPS) out.push({ axis: "v", a: 0, b: v.y, level: "minor", slot: i, value: v.y });
      out.push({ axis: "v", a: v.y, b: v.y + v.h, level: "minor", slot: i, value: v.h });
    });
    return out;
  }
  function offsetCota(c) { return c.level === "major" ? OFF_MAJOR : (OFF_MIN0 + c.slot * OFF_STEP); }
  function margenCotas(sk) {
    const nv = (sk.ventanas || []).length + (sk.cortes || []).filter((c) => !c.rotated && !c.circ).length;
    const minMax = nv > 0 ? (OFF_MIN0 + (nv - 1) * OFF_STEP) : 0;
    return Math.max(OFF_MAJOR, minMax) + 14;
  }

  function fmt(n) { return (Math.round(n * 1000) / 1000).toString(); }

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
    const n = Math.min(4, Math.max(1, Math.round(L / 45)));
    const out = [];
    for (let k = 0; k < n; k++) { const t = (k + 0.5) / n; out.push({ x: x1 + (x2 - x1) * t, y: y1 + (y2 - y1) * t }); }
    return out;
  }

  // SVG temático (clases coloreadas por el CSS de la App).
  function sketchSVG(spec, opts) {
    opts = opts || {};
    const conCotas = opts.cotas !== false;
    const maxW = opts.maxW || 360, maxH = opts.maxH || 300;
    const sk = construirSketch(spec);
    if (!(sk.ancho > 0) || !(sk.largo > 0)) {
      return '<p class="muted small">Ingresa largo y ancho para ver el dibujo del producto.</p>';
    }
    const mTL = conCotas ? margenCotas(sk) : 26, mBR = 18;
    const scale = Math.min((maxW - mTL - mBR) / sk.ancho, (maxH - mTL - mBR) / sk.largo);
    const w = sk.ancho * scale, h = sk.largo * scale, ox = mTL, oy = mTL;
    const r = Math.max(2.2, Math.min(4.5, scale * 0.03));
    const f1 = (n) => n.toFixed(1);
    const px = (sx) => ox + sx * scale, py = (sy) => oy + sy * scale;
    let s = `<svg class="sketch-svg" viewBox="0 0 ${f1(w + mTL + mBR)} ${f1(h + mTL + mBR)}" xmlns="http://www.w3.org/2000/svg">`;
    // Ventanas (rectangulares o circulares)
    sk.ventanas.forEach((v) => {
      if (v.circ) {
        s += `<circle class="win" cx="${f1(px(v.x + v.w / 2))}" cy="${f1(py(v.y + v.h / 2))}" r="${f1(Math.min(v.w, v.h) / 2 * scale)}"/>`;
      } else {
        s += `<rect class="win" x="${f1(px(v.x))}" y="${f1(py(v.y))}" width="${f1(v.w * scale)}" height="${f1(v.h * scale)}"/>`;
      }
    });
    // Contorno
    s += `<rect class="edge" x="${f1(ox)}" y="${f1(oy)}" width="${f1(w)}" height="${f1(h)}"/>`;
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
        const t = i / n;
        if (horiz) { const sx = lx1 + (lx2 - lx1) * t; s += `<line class="pocket-stitch" x1="${f1(sx)}" y1="${f1(ly1 - stitch)}" x2="${f1(sx)}" y2="${f1(ly1 + stitch)}"/>`; }
        else { const sy = ly1 + (ly2 - ly1) * t; s += `<line class="pocket-stitch" x1="${f1(lx1 - stitch)}" y1="${f1(sy)}" x2="${f1(lx1 + stitch)}" y2="${f1(sy)}"/>`; }
      }
      const lbl = `Bolsillo Ø${fmt(bo.diam)}m · L${fmt(horiz ? sk.ancho : sk.largo)}m`;
      if (horiz) s += `<text class="pocket-lbl" x="${f1(bx + bw / 2)}" y="${f1(by + bh / 2 + 2.5)}" text-anchor="middle">${lbl}</text>`;
      else { const mx = bx + bw / 2, my = by + bh / 2; s += `<text class="pocket-lbl" x="${f1(mx)}" y="${f1(my)}" text-anchor="middle" transform="rotate(-90 ${f1(mx)} ${f1(my)})">${lbl}</text>`; }
    });
    // Ojetillos del paño base
    sk.ojetillos.forEach((p) => { s += `<circle class="oje" cx="${f1(px(p.x))}" cy="${f1(py(p.y))}" r="${f1(r)}"/>`; });
    // Cortes / calados: líneas de corte (lados existentes) + tijeras + ojetillos del corte
    const tijeraSVG = (tx, ty) => {
      const tp = tijeraPrims(tx, ty, 8); let out = "";
      tp.circles.forEach((cc) => { out += `<circle class="scissor" cx="${f1(cc.x)}" cy="${f1(cc.y)}" r="${f1(cc.r)}"/>`; });
      tp.lines.forEach((ln) => { out += `<line class="scissor" x1="${f1(ln.x1)}" y1="${f1(ln.y1)}" x2="${f1(ln.x2)}" y2="${f1(ln.y2)}"/>`; });
      return out;
    };
    sk.cortes.forEach((c) => {
      (c.hatch || []).forEach((sg) => {
        s += `<line class="cut-hatch" x1="${f1(px(sg.a.x))}" y1="${f1(py(sg.a.y))}" x2="${f1(px(sg.b.x))}" y2="${f1(py(sg.b.y))}"/>`;
      });
      c.segments.forEach((sg) => {
        const a = px(sg.a.x), b = py(sg.a.y), d = px(sg.b.x), e = py(sg.b.y);
        s += `<line class="cut" x1="${f1(a)}" y1="${f1(b)}" x2="${f1(d)}" y2="${f1(e)}"/>`;
        if (!c.tijeras) tijerasEn(a, b, d, e).forEach((t) => { s += tijeraSVG(t.x, t.y); });
      });
      if (c.tijeras) c.tijeras.forEach((t) => { s += tijeraSVG(px(t.x), py(t.y)); });
      c.ojetillos.forEach((p) => { s += `<circle class="cut-oje" cx="${f1(px(p.x))}" cy="${f1(py(p.y))}" r="${f1(r)}"/>`; });
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
    // Cotas (rojo)
    if (conCotas) {
      cotasDe(sk).forEach((c) => {
        const off = offsetCota(c);
        if (c.axis === "h") {
          const dimY = oy - off, xa = px(c.a), xb = px(c.b);
          s += `<line class="cota-ext" x1="${f1(xa)}" y1="${f1(oy)}" x2="${f1(xa)}" y2="${f1(dimY - EXTGAP)}"/>`;
          s += `<line class="cota-ext" x1="${f1(xb)}" y1="${f1(oy)}" x2="${f1(xb)}" y2="${f1(dimY - EXTGAP)}"/>`;
          s += `<line class="cota" x1="${f1(xa)}" y1="${f1(dimY)}" x2="${f1(xb)}" y2="${f1(dimY)}"/>`;
          s += `<line class="cota-tick" x1="${f1(xa)}" y1="${f1(dimY - TICK)}" x2="${f1(xa)}" y2="${f1(dimY + TICK)}"/>`;
          s += `<line class="cota-tick" x1="${f1(xb)}" y1="${f1(dimY - TICK)}" x2="${f1(xb)}" y2="${f1(dimY + TICK)}"/>`;
          s += `<text class="cota-lbl" x="${f1((xa + xb) / 2)}" y="${f1(dimY - 2)}" text-anchor="middle">${fmt(c.value)}m</text>`;
        } else {
          const dimX = ox - off, ya = py(c.a), yb = py(c.b);
          s += `<line class="cota-ext" x1="${f1(ox)}" y1="${f1(ya)}" x2="${f1(dimX - EXTGAP)}" y2="${f1(ya)}"/>`;
          s += `<line class="cota-ext" x1="${f1(ox)}" y1="${f1(yb)}" x2="${f1(dimX - EXTGAP)}" y2="${f1(yb)}"/>`;
          s += `<line class="cota" x1="${f1(dimX)}" y1="${f1(ya)}" x2="${f1(dimX)}" y2="${f1(yb)}"/>`;
          s += `<line class="cota-tick" x1="${f1(dimX - TICK)}" y1="${f1(ya)}" x2="${f1(dimX + TICK)}" y2="${f1(ya)}"/>`;
          s += `<line class="cota-tick" x1="${f1(dimX - TICK)}" y1="${f1(yb)}" x2="${f1(dimX + TICK)}" y2="${f1(yb)}"/>`;
          const my = (ya + yb) / 2;
          s += `<text class="cota-lbl" x="${f1(dimX - 3)}" y="${f1(my)}" text-anchor="middle" transform="rotate(-90 ${f1(dimX - 3)} ${f1(my)})">${fmt(c.value)}m</text>`;
        }
      });
    }
    s += `</svg>`;
    return s;
  }

  const API = {
    construirSketch, sketchSVG, ojetillosPerimetro, puntosArista,
    cotasDe, offsetCota, margenCotas, fmt, tijeraPrims, tijerasEn,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  global.SketchCIBSA = API;
})(typeof window !== "undefined" ? window : globalThis);
