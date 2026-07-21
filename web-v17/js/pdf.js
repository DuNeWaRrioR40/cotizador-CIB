/* Generación de la cotización CIBSA en PDF dentro del navegador, con pdf-lib.
   Replica el formato corporativo de 2 páginas y la convención de nombre de archivo. */
(function (global) {
  const CFG = global.CONFIG;
  const LOGOS = global.LOGOS;

  // Nombre de tela para el CLIENTE: NUNCA incluye el proveedor. Usa nombreCliente si existe; si no, quita el
  // proveedor del nombre interno ("PROV · tipo · modelo · formato" → "tipo · modelo · formato").
  function telaCli(t) {
    if (!t) return "";
    if (typeof t === "string") return t;   // ya es texto cliente (modo preliminar / plano)
    if (t.nombreCliente && String(t.nombreCliente).trim()) return String(t.nombreCliente).trim();
    let n = String(t.nombre || "");
    const prov = String(t.proveedor || "").trim();
    if (prov && n.toUpperCase().indexOf(prov.toUpperCase()) === 0) n = n.slice(prov.length).replace(/^\s*·\s*/, "");
    return n;
  }
  // v15: paleta del documento corporativo — tinta #111 + amarillo CIBSA #FFDF26
  const BLUE = () => PDFLib.rgb(0.067, 0.067, 0.067);      // tinta (antes azul corporativo)
  const HEADERBLUE = () => PDFLib.rgb(0.067, 0.067, 0.067); // cabecera de tabla: negro
  const WHITE = () => PDFLib.rgb(1, 1, 1);
  const BLACK = () => PDFLib.rgb(0.1, 0.1, 0.1);
  const BRAND = () => PDFLib.rgb(1, 0.875, 0.149);         // #FFDF26 amarillo CIBSA
  const GRAYBOX = () => PDFLib.rgb(0.955, 0.955, 0.945);   // gris tarjeta del documento
  const YELLOW = () => GRAYBOX();                          // caja de nota: gris + barra amarilla
  const TOTALFILL = () => BRAND();                         // fila TOTAL: amarillo como "Total con IVA"

  const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio",
    "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

  function money(n) { return "$" + Math.round(n).toLocaleString("es-CL"); }

  // Sanea texto para la codificación WinAnsi de pdf-lib (evita que falle con
  // caracteres no soportados que vengan de las fichas del Sheet).
  const WIN_OK = "‘’“”–—•…€™" +
    "ŒœŠšŸŽžƒˆ˜";
  function san(s) {
    let out = "";
    for (const ch of String(s)) {
      if (ch.codePointAt(0) <= 0xff || WIN_OK.indexOf(ch) >= 0) out += ch;
    }
    return out;
  }

  // Tipografía de los PDF: Poppins (≈ DM Sans del documento de referencia) embebida vía fontkit.
  // Si fontkit o las fuentes no cargaron (offline con caché vieja), cae a Helvetica sin romper nada.
  async function embedFonts(doc) {
    try {
      if (global.fontkit && global.FONTSCIBSA) {
        doc.registerFontkit(global.fontkit);
        const font = await doc.embedFont(b64ToBytes(global.FONTSCIBSA.regular), { subset: true });
        const bold = await doc.embedFont(b64ToBytes(global.FONTSCIBSA.bold), { subset: true });
        return { font: font, bold: bold };
      }
    } catch (e) { /* cae a Helvetica */ }
    const SF = PDFLib.StandardFonts;
    return { font: await doc.embedFont(SF.Helvetica), bold: await doc.embedFont(SF.HelveticaBold) };
  }
  // pdf-lib interpreta drawSvgPath con eje Y HACIA ABAJO desde el ancla {x,y}. Nuestros puntos van
  // en coordenadas de página (Y hacia arriba): este helper convierte y ancla en el tope de la hoja.
  function drawPolyPDF(page, pts, opts) {
    if (!pts || pts.length < 3) return;
    const Hp = page.getHeight();
    const d = "M " + pts.map((p) => p.x + " " + (Hp - p.y)).join(" L ") + " Z";
    page.drawSvgPath(d, Object.assign({ x: 0, y: Hp }, opts));
  }
  function b64ToBytes(dataURL) {
    const b64 = dataURL.split(",")[1];
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  }

  function nombreArchivo(datos) {
    const f = datos.fecha;
    const dd = String(f.getDate()).padStart(2, "0");
    const mm = String(f.getMonth() + 1).padStart(2, "0");
    let etiqueta;
    if (datos.empresa && datos.empresa.razon) {
      const ws = String(datos.empresa.razon).replace(/[^A-Za-z0-9 ]/g, "").trim().split(/\s+/).filter(Boolean);
      etiqueta = ws.slice(0, 3).map((w) => w.charAt(0).toUpperCase() + w.slice(1, 4).toLowerCase()).join("").slice(0, 16) || "Empresa";
    } else {
      const c = datos.cliente;
      const inicial = c.nombre.trim().charAt(0).toUpperCase();
      let ap = c.apellido.trim(); ap = (ap.charAt(0).toUpperCase() + ap.slice(1)).replace(/\s+/g, "");
      etiqueta = inicial + ap;
    }
    return `C.${etiqueta}${datos.version}_${dd}${mm}${f.getFullYear()}`;
  }

  function wrap(text, font, size, maxWidth) {
    const words = san(text).split(/\s+/);
    const lines = [];
    let cur = "";
    for (const w of words) {
      const test = cur ? cur + " " + w : w;
      if (font.widthOfTextAtSize(test, size) > maxWidth && cur) {
        lines.push(cur); cur = w;
      } else { cur = test; }
    }
    if (cur) lines.push(cur);
    return lines;
  }

  // Encabezado con logos (reutilizable). Devuelve la y debajo del bloque.
  function dibujarEncabezado(page, cibsa, _kam, W, M, yTop) {
    // v15: wordmark CIBSA amarillo centrado; el escudo derecho se eliminó.
    const cW = 150, cH = cW * (cibsa.height / cibsa.width);
    page.drawImage(cibsa, { x: (W - cW) / 2, y: yTop - cH + 14, width: cW, height: cH });
    return yTop - 60;
  }
  // v15: banda amarilla de pie de página con el eslogan del documento.
  function pieBanda(page, bold, W, fecha) {
    page.drawRectangle({ x: 0, y: 0, width: W, height: 30, color: BRAND() });
    page.drawText("FABRICAMOS SOLUCIONES A SU MEDIDA", { x: 50, y: 11, size: 9.5, font: bold, color: BLACK() });
    if (fecha) {
      const s = `${fecha.getDate()} de ${MESES[fecha.getMonth()]} de ${fecha.getFullYear()}`;
      page.drawText(san(s), { x: W - 50 - bold.widthOfTextAtSize(san(s), 8.5), y: 11.5, size: 8.5, font: bold, color: BLACK() });
    }
  }
  function tituloCentrado(page, s, W, y, f, size, color) {
    const w = f.widthOfTextAtSize(san(s), size);
    page.drawText(san(s), { x: (W - w) / 2, y: y, size: size, font: f, color: color });
  }

  // Dibuja el sketch del producto (contorno, ojetillos, ventanas) a escala dentro de
  // una caja { x, top, w, h } (top = borde superior en coordenadas PDF).
  // Dibuja los elementos de un paño (ventanas, bolsillos, ojetillos, aletas, cortes) en PDF según
  // T = { px, py, scale, x0, topRect, wpx, hpx, r }. Reusado por dibujarSketchPDF y dibujarVolPDF.
  // Notas del usuario (callout de texto libre): flecha + etiqueta, con los offsets arrastrados
  // en la app (rotDrag["nota:id"], en metros y con y hacia abajo → en PDF se invierte).
  function notasPDF(page, notas, PXf, PYf, scale, rotDrag, font) {
    const NEGRO = PDFLib.rgb(0.42, 0.3, 0.05), LIN = PDFLib.rgb(0.55, 0.45, 0.2);
    (notas || []).forEach((nt) => {
      if (!nt || !nt.texto || !isFinite(nt.x) || !isFinite(nt.y)) return;
      const off = rotDrag && rotDrag["nota:" + nt.id];
      const ax = PXf(nt.x), ay = PYf(nt.y);
      const lx = ax + (off ? off.dx * scale : 30), ly = ay - (off ? off.dy * scale : -26);
      const palabras = String(nt.texto).split(/\s+/), lineas = []; let cur = "";
      palabras.forEach((w) => { if ((cur + " " + w).trim().length > 22 && cur) { lineas.push(cur); cur = w; } else cur = (cur ? cur + " " : "") + w; });
      if (cur) lineas.push(cur);
      page.drawLine({ start: { x: lx, y: ly - 2 }, end: { x: ax, y: ay }, thickness: 0.7, color: LIN });
      page.drawCircle({ x: ax, y: ay, size: 1.6, color: LIN });
      lineas.slice(0, 5).forEach((ln2, i, arr) => {
        const t = san(ln2), wT = font.widthOfTextAtSize(t, 7.5);
        page.drawText(t, { x: lx - wT / 2, y: ly + (arr.length - 1 - i) * 9, size: 7.5, font: font, color: NEGRO });
      });
    });
  }
  function elementosPDF(page, sk, T, font) {
    const px = T.px, py = T.py, scale = T.scale, x0 = T.x0, topRect = T.topRect, wpx = T.wpx, hpx = T.hpx, r = T.r;
    const SK = global.SketchCIBSA;
    const ACC = BLUE(), FUS = PDFLib.rgb(0.82, 0.23, 0.18), TEAL = PDFLib.rgb(0.12, 0.62, 0.54);
    const AMBER = PDFLib.rgb(0.753, 0.475, 0.122), PURPLE = PDFLib.rgb(0.557, 0.267, 0.678);
    const STRAP = PDFLib.rgb(0.847, 0.267, 0.227), STRAPF = PDFLib.rgb(0.847, 0.267, 0.227);
    const ojePDF = (cx, cy, col) => {
      page.drawCircle({ x: cx, y: cy, size: r, borderColor: col, borderWidth: 0.4, color: WHITE() });
      page.drawCircle({ x: cx, y: cy, size: r * 0.42, borderColor: col, borderWidth: 0.35 });
    };
    // Rótulo-guía (callout) estilo despiece: tramo diagonal desde el elemento + horizontal con flecha al título.
    const cb = T.cb, SLATE = PDFLib.rgb(0.27, 0.35, 0.39);
    function wrapLinesP(str, maxChars) {
      const words = String(str == null ? "" : str).split(/\s+/).filter(Boolean), out = []; let cur = "";
      words.forEach((w) => { if (!cur) cur = w; else if ((cur + " " + w).length <= maxChars) cur += " " + w; else { out.push(cur); cur = w; } });
      if (cur) out.push(cur);
      return out.length ? out : [""];
    }
    function callout(ax, ay, text, detail, obj, key) {
      if (!cb || !cb.slots.has(obj)) return false;
      const ly0 = cb.slots.get(obj);
      // Desplazamiento manual del rótulo (en METROS, guardado desde el preview): se multiplica por la escala.
      // En PDF el eje Y va hacia ARRIBA, por eso off.dy se resta (arrastrar hacia abajo baja la etiqueta).
      const off = (key && sk.rotDrag && sk.rotDrag[key]) || { dx: 0, dy: 0 }, SC = scale || 1;
      const ly = ly0 - (off.dy || 0) * SC;
      // Flecha corta: el texto arranca pegado al borde derecho del paño y usa el ancho disponible.
      const panelR = px(sk.ancho), tx = Math.max(panelR + 10, ax + 22) + (off.dx || 0) * SC, elbowX = Math.min(ax + 16, tx - 6);
      page.drawCircle({ x: ax, y: ay, size: 1.3, color: SLATE });
      page.drawLine({ start: { x: ax, y: ay }, end: { x: elbowX, y: ly }, thickness: 0.55, color: SLATE });
      page.drawLine({ start: { x: elbowX, y: ly }, end: { x: tx - 4, y: ly }, thickness: 0.55, color: SLATE });
      page.drawLine({ start: { x: tx - 1, y: ly }, end: { x: tx - 6, y: ly - 2.4 }, thickness: 0.6, color: SLATE });
      page.drawLine({ start: { x: tx - 1, y: ly }, end: { x: tx - 6, y: ly + 2.4 }, thickness: 0.6, color: SLATE });
      const DIM = PDFLib.rgb(0.38, 0.49, 0.55), avail = Math.max(56, cb.rightEdge - tx);
      const nameLines = wrapLinesP(text, Math.max(6, Math.floor(avail / 3.0)));
      const y0 = ly + (detail ? 1 : -2);
      nameLines.forEach((ln, i) => page.drawText(san(ln), { x: tx, y: y0 - i * 5.4, size: 5.5, font: font, color: SLATE }));
      if (detail) {
        const dy0 = y0 - nameLines.length * 5.4 - 0.6;
        wrapLinesP(detail, Math.max(8, Math.floor(avail / 2.5))).forEach((ln, i) => page.drawText(san(ln), { x: tx, y: dy0 - i * 5.2, size: 5, font: font, color: DIM }));
      }
      return true;
    }
    const calloutKey = (obj, pre) => { const id = (obj && obj.id != null) ? obj.id : (obj && obj.arista) || ""; return id === "" ? "" : (pre + ":" + id); };
    function aletaDetalle(a) {
      const f = SK.fmt; const parts = [f(a.ancho || a.w) + "x" + f(a.largo || a.h) + " m"];
      if ((a.offset || 0) > 0) parts.push("offset " + f(a.offset));
      const n = (a.ojetillos || []).length; if (n > 0) parts.push(n + " ojet.");
      return parts.join(" · ");
    }
    // Uniones entre paños: líneas de costura (dashed) donde se unen los rollos, + etiqueta. Solo si se activó.
    const ur = sk.unionesRot;
    if (ur && ur.mostrar && ur.anchoRollo > 0 && sk.ancho > 0 && sk.largo > 0) {
      const TEAL = PDFLib.rgb(0.12, 0.62, 0.54);
      const R = ur.anchoRollo, A = sk.ancho, L = sk.largo, dim = ur.orient === "ancho" ? L : A;
      const n = Math.ceil(dim / R - 1e-9);
      for (let i = 1; i < n; i++) {
        const d = i * R; if (d >= dim - 1e-9) break;
        if (ur.orient === "ancho") page.drawLine({ start: { x: px(0), y: py(d) }, end: { x: px(A), y: py(d) }, thickness: 0.5, color: TEAL, dashArray: [2.5, 1.5], opacity: 0.7 });
        else page.drawLine({ start: { x: px(d), y: py(0) }, end: { x: px(d), y: py(L) }, thickness: 0.5, color: TEAL, dashArray: [2.5, 1.5], opacity: 0.7 });
      }
      if (n > 1) {
        const ulbl = san("Unión " + SK.fmt(ur.valor) + " m");
        if (ur.orient === "ancho") page.drawText(ulbl, { x: px(A) - 2 - font.widthOfTextAtSize(ulbl, 5), y: py(R) - 5, size: 5, font: font, color: TEAL });
        else page.drawText(ulbl, { x: px(R) + 1.5, y: py(0) - 6, size: 5, font: font, color: TEAL });
      }
    }
    // Straps (cintas): banda con relleno suave translúcido + borde fino rojo + línea media + remates + etiqueta.
    (sk.straps || []).forEach((st) => {
      drawPolyPDF(page, st.corners.map((p) => ({ x: px(p.x), y: py(p.y) })), { color: STRAP, opacity: 0.10, borderColor: STRAP, borderWidth: 0.5, borderOpacity: 1 });
      page.drawLine({ start: { x: px(st.a.x), y: py(st.a.y) }, end: { x: px(st.b.x), y: py(st.b.y) }, thickness: 0.4, color: STRAPF, dashArray: [4, 3], opacity: 0.45 });
      [st.rem0, st.rem1].forEach((rm) => {
        const zz = SK.zigzagPts(px(rm.a.x), py(rm.a.y), px(rm.b.x), py(rm.b.y), 2.2, 4);
        for (let i = 0; i < zz.length - 1; i++) page.drawLine({ start: { x: zz[i].x, y: zz[i].y }, end: { x: zz[i + 1].x, y: zz[i + 1].y }, thickness: 0.6, color: STRAP });
      });
      if (!st.set) { // las cintas de SET no rotulan inline (se enciman); su rótulo va por el callout del set
        const offpx = st.hw * scale + 8;
        const lx = px((st.a.x + st.b.x) / 2) + st.perp.x * offpx, ly = py((st.a.y + st.b.y) / 2) - st.perp.y * offpx; // py invertido en PDF
        const lbl = (st.nombre || "Cinta") + " " + SK.fmt(st.largo) + " m";
        page.drawText(lbl, { x: lx - font.widthOfTextAtSize(lbl, 6) / 2, y: ly - 2, size: 6, font: font, color: STRAP });
      }
    });
    // ===== Cintas / cierres: banda continua con 4 estados (cosida · ! seguridad box-X · Ø bolsillo · hueco achurado) =====
    // Nota: la fuente estándar (WinAnsi) no tiene Ω ni ✕; en el PDF el bolsillo se marca con un pequeño círculo + Ø,
    // y el hueco con achurado + topes + "sin cinta N m".
    const CRED = PDFLib.rgb(0.753, 0.224, 0.169), HATCH = PDFLib.rgb(0.541, 0.58, 0.627), OD = String.fromCharCode(216);
    const cintaLblDone = {};
    (sk.cintas || []).forEach((c) => {
      const halfW = Math.max(0.006, (c.ancho || 0.02) / 2), seg = c.seg || {};
      const PXx = (tm, wm) => px(c.ax + c.ux * tm + c.nx * wm);
      const PYy = (tm, wm) => py(c.ay + c.uy * tm + c.ny * wm);
      const LXx = (tm, dd) => px(c.ax + c.ux * tm + c.inX * dd);
      const LYy = (tm, dd) => py(c.ay + c.uy * tm + c.inY * dd);
      const ln = (t1, w1, t2, w2, col, th) => page.drawLine({ start: { x: PXx(t1, w1), y: PYy(t1, w1) }, end: { x: PXx(t2, w2), y: PYy(t2, w2) }, thickness: th || 0.6, color: col });
      const ctr = (lbl, X, Y, size, col) => page.drawText(lbl, { x: X - font.widthOfTextAtSize(lbl, size) / 2, y: Y - size * 0.35, size: size, font: font, color: col });
      (seg.material || []).forEach((m) => { ln(m.a, halfW, m.b, halfW, ACC, 0.7); ln(m.a, -halfW, m.b, -halfW, ACC, 0.7); ln(m.a, halfW, m.a, -halfW, ACC, 0.6); ln(m.b, halfW, m.b, -halfW, ACC, 0.6); });
      (seg.stitch || []).forEach((m) => page.drawLine({ start: { x: PXx(m.a, 0), y: PYy(m.a, 0) }, end: { x: PXx(m.b, 0), y: PYy(m.b, 0) }, thickness: 0.5, color: ACC, dashArray: [2.5, 1.8], opacity: 0.7 }));
      (seg.safety || []).forEach((m) => { ln(m.a, halfW, m.b, halfW, CRED, 0.7); ln(m.a, -halfW, m.b, -halfW, CRED, 0.7); ln(m.a, halfW, m.a, -halfW, CRED, 0.7); ln(m.b, halfW, m.b, -halfW, CRED, 0.7); ln(m.a, halfW, m.b, -halfW, CRED, 0.7); ln(m.a, -halfW, m.b, halfW, CRED, 0.7); });
      (seg.opens || []).forEach((m) => { const tm = (m.a + m.b) / 2; page.drawCircle({ x: PXx(tm, 0), y: PYy(tm, 0), size: halfW * scale * 0.7, borderColor: ACC, borderWidth: 0.7 }); if (m.dia > 0) ctr(OD + SK.fmt(m.dia), LXx(tm, halfW + 0.05), LYy(tm, halfW + 0.05), 5.5, ACC); });
      (seg.gaps || []).forEach((m) => {
        for (let ti = m.a; ti + 2 * halfW <= m.b + 1e-9; ti += 0.07) page.drawLine({ start: { x: PXx(ti, -halfW), y: PYy(ti, -halfW) }, end: { x: PXx(ti + 2 * halfW, halfW), y: PYy(ti + 2 * halfW, halfW) }, thickness: 0.5, color: HATCH });
        ln(m.a, halfW * 1.35, m.a, -halfW * 1.35, HATCH, 0.7); ln(m.b, halfW * 1.35, m.b, -halfW * 1.35, HATCH, 0.7);
        const tm = (m.a + m.b) / 2; ctr("sin cinta " + SK.fmt(m.b - m.a) + " m", LXx(tm, halfW + 0.07), LYy(tm, halfW + 0.07), 5.5, CRED);
      });
      if (c.rotulo && ((c.legend && c.legend.trim()) || c.perim) && !cintaLblDone[c.id]) { cintaLblDone[c.id] = true; const lbl = ((c.perim ? "perim. " : "") + (c.legend || "").trim()).trim(); if (lbl) ctr(lbl, LXx(c.L / 2, halfW + 0.05), LYy(c.L / 2, halfW + 0.05), 6, BLACK()); }
    });
    const tijeraPDF = (tx, ty) => {
      const tp = SK.tijeraPrims(tx, ty, 6);   // 25% más chicas
      tp.circles.forEach((cc) => page.drawCircle({ x: cc.x, y: cc.y, size: cc.r, borderColor: PURPLE, borderWidth: 0.5 }));
      tp.lines.forEach((ln) => page.drawLine({ start: { x: ln.x1, y: ln.y1 }, end: { x: ln.x2, y: ln.y2 }, thickness: 0.5, color: PURPLE }));
    };
    // Ventanas / paños inscritos + leyenda, medida y flechas de fusión.
    sk.ventanas.forEach((v) => {
      const cx = px(v.x + v.w / 2), cy = py(v.y + v.h / 2);
      if (v.circ) {
        page.drawEllipse({ x: cx, y: cy, xScale: Math.min(v.w, v.h) / 2 * scale, yScale: Math.min(v.w, v.h) / 2 * scale, borderColor: ACC, borderWidth: 0.9, borderDashArray: [3, 2] });
      } else {
        page.drawRectangle({ x: px(v.x), y: py(v.y + v.h), width: v.w * scale, height: v.h * scale, borderColor: ACC, borderWidth: 0.9, borderDashArray: [3, 2] });
      }
      const med = v.circ ? (String.fromCharCode(216) + SK.fmt(v.w) + "m") : (SK.fmt(v.w) + "x" + SK.fmt(v.h) + "m");
      if (v.legend && cb && cb.slots.has(v)) { callout(cx, cy, v.legend, med, v, calloutKey(v, "win")); }
      else {
        if (v.legend) page.drawText(san(v.legend), { x: cx - font.widthOfTextAtSize(san(v.legend), 6.5) / 2, y: cy + 1, size: 6.5, font: font, color: BLACK() });
        page.drawText(med, { x: cx - font.widthOfTextAtSize(med, 5.5) / 2, y: cy - 6, size: 5.5, font: font, color: PDFLib.rgb(0.42, 0.42, 0.42) });
      }
      if (!v.circ && v.fusion) {
        const X = px(v.x), Y = py(v.y), X2 = px(v.x + v.w), Y2 = py(v.y + v.h);
        const edges = [];
        if (v.fusion.sup) edges.push([X, Y, X2, Y]);
        if (v.fusion.inf) edges.push([X, Y2, X2, Y2]);
        if (v.fusion.izq) edges.push([X, Y, X, Y2]);
        if (v.fusion.der) edges.push([X2, Y, X2, Y2]);
        edges.forEach((e) => {
          const dx = e[2] - e[0], dy = e[3] - e[1], L = Math.hypot(dx, dy) || 1;
          SK.flechaBarbas(e[0], e[1], dx / L, dy / L, 5).concat(SK.flechaBarbas(e[2], e[3], -dx / L, -dy / L, 5))
            .forEach((b) => page.drawLine({ start: { x: b.x1, y: b.y1 }, end: { x: b.x2, y: b.y2 }, thickness: 0.9, color: FUS }));
        });
      }
    });
    // Bolsillos (banda con doblez + costura + Ø)
    const bandW = Math.max(8, Math.min(18, Math.min(wpx, hpx) * 0.12)), stitch = 3;
    (sk.bolsillos || []).forEach((bo) => {
      const horiz = (bo.arista === "sup" || bo.arista === "inf");
      const ro = (T.rimOut && T.rimOut[bo.arista]) || 0;   // volumétrico: bolsillo en el rim del ala
      let rx, ry, rw, rh;
      if (bo.arista === "sup") { rx = x0; ry = topRect + ro - bandW; rw = wpx; rh = bandW; }
      else if (bo.arista === "inf") { rx = x0; ry = topRect - hpx - ro; rw = wpx; rh = bandW; }
      else if (bo.arista === "izq") { rx = x0 - ro; ry = topRect - hpx; rw = bandW; rh = hpx; }
      else { rx = x0 + wpx + ro - bandW; ry = topRect - hpx; rw = bandW; rh = hpx; }
      page.drawRectangle({ x: rx, y: ry, width: rw, height: rh, borderColor: TEAL, borderWidth: 0.8, color: TEAL, opacity: 0.12, borderOpacity: 1 });
      let a, b, d, e;
      if (bo.arista === "sup") { a = rx; b = ry; d = rx + rw; e = ry; }
      else if (bo.arista === "inf") { a = rx; b = ry + rh; d = rx + rw; e = ry + rh; }
      else if (bo.arista === "izq") { a = rx + rw; b = ry; d = rx + rw; e = ry + rh; }
      else { a = rx; b = ry; d = rx; e = ry + rh; }
      page.drawLine({ start: { x: a, y: b }, end: { x: d, y: e }, thickness: 0.8, color: TEAL });
      const len = horiz ? rw : rh, n = Math.max(2, Math.round(len / 12));
      for (let i = 0; i <= n; i++) {
        const t = i / n;
        if (horiz) { const sx = a + (d - a) * t; page.drawLine({ start: { x: sx, y: b - stitch }, end: { x: sx, y: b + stitch }, thickness: 0.5, color: TEAL }); }
        else { const sy = b + (e - b) * t; page.drawLine({ start: { x: a - stitch, y: sy }, end: { x: a + stitch, y: sy }, thickness: 0.5, color: TEAL }); }
      }
      const diamTxt = "Bolsillo " + String.fromCharCode(216) + SK.fmt(bo.diam) + "m";
      if (bo.rotulo && cb && cb.slots.has(bo)) {
        // Leyenda "sacada": flecha desde un extremo del bolsillo (abajo para izq/der, izquierda para sup/inf).
        const ax = horiz ? (rx + 6) : (rx + rw / 2), ay = horiz ? (ry + rh / 2) : (ry + 4);
        callout(ax, ay, diamTxt, "L" + SK.fmt(horiz ? sk.ancho : sk.largo) + "m", bo, calloutKey(bo, "pk"));
      } else {
        const cxp = rx + rw / 2, cyp = ry + rh / 2;
        if (horiz) page.drawText(diamTxt, { x: cxp - font.widthOfTextAtSize(diamTxt, 7) / 2, y: cyp - 2.5, size: 7, font: font, color: TEAL });
        else page.drawText(diamTxt, { x: cxp - 2.5, y: cyp - font.widthOfTextAtSize(diamTxt, 7) / 2, size: 7, font: font, color: TEAL, rotate: PDFLib.degrees(90) });
      }
    });
    // Ojetillos
    const insetOj = r + 1;
    sk.ojetillos.forEach((p) => {
      let cx = px(p.x), cy = py(p.y);
      if (p.x <= 0.001) cx += insetOj; else if (p.x >= sk.ancho - 0.001) cx -= insetOj;
      if (p.y <= 0.001) cy -= insetOj; else if (p.y >= sk.largo - 0.001) cy += insetOj;
      ojePDF(cx, cy, ACC);
    });
    // Aletas / solapas / faldón / cenefa
    (sk.aletas || []).forEach((a) => {
      const X = px(a.x), Wp = a.w * scale, Hp = a.h * scale, Ytop = py(a.y), Ybot = py(a.y + a.h);
      page.drawRectangle({ x: X, y: Ybot, width: Wp, height: Hp, borderColor: AMBER, borderWidth: 1, color: AMBER, opacity: 0.1, borderOpacity: 1 });
      let fa, fb;
      if (a.fused === "t") { fa = { x: X, y: Ytop }; fb = { x: X + Wp, y: Ytop }; }
      else if (a.fused === "b") { fa = { x: X, y: Ybot }; fb = { x: X + Wp, y: Ybot }; }
      else if (a.fused === "l") { fa = { x: X, y: Ytop }; fb = { x: X, y: Ybot }; }
      else { fa = { x: X + Wp, y: Ytop }; fb = { x: X + Wp, y: Ybot }; }
      const dx = fb.x - fa.x, dy = fb.y - fa.y, Lf = Math.hypot(dx, dy) || 1;
      SK.flechaBarbas(fa.x, fa.y, dx / Lf, dy / Lf, 5).concat(SK.flechaBarbas(fb.x, fb.y, -dx / Lf, -dy / Lf, 5))
        .forEach((b) => page.drawLine({ start: { x: b.x1, y: b.y1 }, end: { x: b.x2, y: b.y2 }, thickness: 0.9, color: FUS }));
      (a.ojetillos || []).forEach((p) => ojePDF(px(p.x), py(p.y), ACC));
      const lbl = a.nombre || "Aleta";
      if (cb && cb.slots.has(a)) callout(X + Wp / 2, py(a.y + a.h / 2), lbl, aletaDetalle(a), a, calloutKey(a, "al"));
      else page.drawText(san(lbl), { x: X + Wp / 2 - font.widthOfTextAtSize(san(lbl), 6.5) / 2, y: py(a.y + a.h / 2), size: 6.5, font: font, color: PDFLib.rgb(0.54, 0.34, 0.06) });
    });
    // Rótulos de sets (ojetillos/straps): callout con nombre + datos técnicos.
    (sk.setsRot || []).forEach((sr) => { callout(px(sr.x), py(sr.y), sr.text, sr.detail, sr); });
    // Cortes / calados
    (sk.cortes || []).forEach((c) => {
      // Tapa / solapa de cobertura: polígono naranjo muy translúcido + aristas según su estado.
      if (c.tapa && c.tapa.poly && c.tapa.poly.length >= 3) {
        const NAR = PDFLib.rgb(0.91, 0.35, 0.05);
        drawPolyPDF(page, c.tapa.poly.map((p) => ({ x: px(p.x), y: py(p.y) })), { color: NAR, opacity: 0.09, borderColor: NAR, borderWidth: 0.7, borderDashArray: [4, 2.5], borderOpacity: 0.9 });
        (c.tapa.edges || []).forEach((e) => {
          page.drawLine({ start: { x: px(e.a.x), y: py(e.a.y) }, end: { x: px(e.b.x), y: py(e.b.y) },
            thickness: e.fus ? 1.2 : 0.5, color: NAR, dashArray: e.fus ? undefined : [1.6, 1.6] });
          (e.oj || []).forEach((p) => {
            page.drawCircle({ x: px(p.x), y: py(p.y), size: r, borderColor: NAR, borderWidth: 0.4, color: WHITE() });
            page.drawCircle({ x: px(p.x), y: py(p.y), size: r * 0.42, borderColor: NAR, borderWidth: 0.35 });
          });
        });
        const cxT = c.tapa.poly.reduce((m, p) => m + p.x, 0) / c.tapa.poly.length;
        const cyT = c.tapa.poly.reduce((m, p) => m + p.y, 0) / c.tapa.poly.length;
        const lbl = san(c.tapa.nombre || "Tapa");
        page.drawText(lbl, { x: px(cxT) - font.widthOfTextAtSize(lbl, 6) / 2, y: py(cyT) - 2, size: 6, font: font, color: NAR });
      }
      // Difuminar: gris visible. Eliminar: la parte se va del CONTORNO (no se rellena ni se dibuja su línea).
      if (c.fadePoly && c.fadePoly.length >= 3 && !c.fadeKill) {
        drawPolyPDF(page, c.fadePoly.map((p) => ({ x: px(p.x), y: py(p.y) })), { color: PDFLib.rgb(0.42, 0.46, 0.52), opacity: 0.5, borderWidth: 0 });
      }
      if (c.fadePoly && c.fadePoly.length >= 3 && c.fadeKill && (c.fadeZona || "tapa") !== "tapa") {
        // Zona ELIMINADA (calado poligonal / recorte sobre ala): marca roja suave, como en la app.
        drawPolyPDF(page, c.fadePoly.map((p) => ({ x: px(p.x), y: py(p.y) })), { color: PDFLib.rgb(0.85, 0.27, 0.23), opacity: 0.10, borderWidth: 0 });
      }
      (c.hatch || []).forEach((sg) => {
        page.drawLine({ start: { x: px(sg.a.x), y: py(sg.a.y) }, end: { x: px(sg.b.x), y: py(sg.b.y) }, thickness: 0.35, color: PURPLE, opacity: 0.32 });
      });
      if (!c.fadeKill) {   // en "Eliminar", la línea del corte es el nuevo borde (lo pinta el contorno del paño)
        (c.segments || []).forEach((sg) => {
          const a = px(sg.a.x), b = py(sg.a.y), d = px(sg.b.x), e = py(sg.b.y);
          if (c.guia) {
            page.drawLine({ start: { x: a, y: b }, end: { x: d, y: e }, thickness: 0.8, color: TEAL, dashArray: [2, 2] });
          } else {
            page.drawLine({ start: { x: a, y: b }, end: { x: d, y: e }, thickness: 1, color: PURPLE, dashArray: [5, 3] });
            if (!c.tijeras) SK.tijerasEn(a, b, d, e).forEach((t) => tijeraPDF(t.x, t.y));
          }
        });
        if (c.tijeras) c.tijeras.forEach((t) => tijeraPDF(px(t.x), py(t.y)));
      }
      (c.ojetillos || []).forEach((p) => ojePDF(px(p.x), py(p.y), PURPLE));
      if (!c.fadeKill && c.rotated && c.pivote) {
        const cx = px(c.pivote.x), cy = py(c.pivote.y);
        page.drawCircle({ x: cx, y: cy, size: 2.6, borderColor: PURPLE, borderWidth: 0.7 });
        page.drawLine({ start: { x: cx - 5, y: cy }, end: { x: cx + 5, y: cy }, thickness: 0.6, color: PURPLE });
        page.drawLine({ start: { x: cx, y: cy - 5 }, end: { x: cx, y: cy + 5 }, thickness: 0.6, color: PURPLE });
      }
      if (!c.fadeKill && c.rotated && c.segments && c.segments.length) {
        const sg = c.segments[0], mx = px((sg.a.x + sg.b.x) / 2), my = py((sg.a.y + sg.b.y) / 2);
        page.drawText(SK.fmt(c.angulo) + "°", { x: mx + 4, y: my + 3, size: 8, font: font, color: PURPLE });
      }
    });
  }

  // Vista volumétrica en PDF: cuboide 3D + hoja de corte desplegada (calados en esquinas).
  function dibujarVolPDF(page, spec, box, font, opts) {
    opts = opts || {};
    const SK = global.SketchCIBSA; if (!SK) return;
    const A = parseFloat(spec.ancho) || 0, L = parseFloat(spec.largo) || 0, H = parseFloat(spec.volumetrico.alto) || 0;
    if (!(A > 0) || !(L > 0) || !(H > 0)) return;
    const alasV = spec.volumetrico.alas || null, va = (k) => !alasV || alasV[k] !== false;
    const altosV = spec.volumetrico.altos || null;
    const hDe = (k) => { if (!va(k)) return 0; const v = altosV ? parseFloat(altosV[k]) : NaN; return isNaN(v) ? H : Math.max(0, v); };
    const hs = hDe("sup"), hi = hDe("inf"), hz = hDe("izq"), hd = hDe("der");
    const conCotas = opts.cotas !== false, fmt = SK.fmt;
    // Simbología presente (hoja desplegada, sin aletas): reserva alto para la leyenda.
    const sk0 = SK.construirSketch(spec);
    const aletasV = (sk0.aletas || []).map((a) => {
      const adx = a.fused === "r" ? -hDe("izq") : a.fused === "l" ? hDe("der") : 0;
      const ady = a.fused === "t" ? hDe("inf") : a.fused === "b" ? -hDe("sup") : 0;
      return Object.assign({}, a, { x: a.x + adx, y: a.y + ady, ojetillos: (a.ojetillos || []).map((p) => ({ x: p.x + adx, y: p.y + ady })) });
    });
    const skVol = Object.assign({}, sk0, { aletas: aletasV, straps: [] });
    if ((spec.volumetrico.ojEn || "externo") === "externo" && SK.ojetillosVolExterno) skVol.ojetillos = SK.ojetillosVolExterno(skVol.ojetillos, A, L, H, alasV, altosV);
    const simb = SK.simbologia(skVol);
    const legH = simb.length ? (9 + simb.length * 9 + 6) : 0;
    const EDGE = PDFLib.rgb(0.12, 0.12, 0.12), FOLD = PDFLib.rgb(0.54, 0.63, 0.72), CUT = PDFLib.rgb(0.557, 0.267, 0.678);
    const GREEN = PDFLib.rgb(0.106, 0.369, 0.125), INK = PDFLib.rgb(0.12, 0.12, 0.12), MUT = PDFLib.rgb(0.42, 0.42, 0.42);
    const VW = box.w;
    const PX = (x) => box.x + x, PY = (y) => box.top - y; // y hacia abajo en "pantalla"
    const dl = (x1, y1, x2, y2, c, th, dash) => page.drawLine({ start: { x: PX(x1), y: PY(y1) }, end: { x: PX(x2), y: PY(y2) }, thickness: th || 0.8, color: c || EDGE, dashArray: dash });
    const dtC = (t, x, y, sz, c) => page.drawText(String(t), { x: PX(x) - font.widthOfTextAtSize(String(t), sz) / 2, y: PY(y) - sz * 0.34, size: sz, font: font, color: c || INK });
    const dtL = (t, x, y, sz, c) => page.drawText(String(t), { x: PX(x), y: PY(y) - sz * 0.34, size: sz, font: font, color: c || INK });
    const hCota = (xa, xb, y, val) => { dl(xa, y, xb, y, GREEN, 0.6); dl(xa, y - 2.5, xa, y + 2.5, GREEN, 0.6); dl(xb, y - 2.5, xb, y + 2.5, GREEN, 0.6); dtC(fmt(val) + "m", (xa + xb) / 2, y - 4, 7, GREEN); };
    const vCota = (ya, yb, x, val) => { dl(x, ya, x, yb, GREEN, 0.6); dl(x - 2.5, ya, x + 2.5, ya, GREEN, 0.6); dl(x - 2.5, yb, x + 2.5, yb, GREEN, 0.6); dtL(fmt(val) + "m", x - 26, (ya + yb) / 2, 7, GREEN); };
    // ----- Panel A: cuboide 3D (se omite con soloDesplegado: vista interior/espejo) -----
    const soloDesp = !!opts.soloDesplegado;
    const panelAH = soloDesp ? 4 : Math.min(box.h * 0.44, 250);
    if (!soloDesp) {
      const dep = 0.5, k = 0.707, needW = A + L * dep * k, needH = H + L * dep * k;
      const sc3 = Math.min((VW - 120) / needW, (panelAH - 46) / needH);
      const wA = A * sc3, hH = H * sc3, dd = L * dep * k * sc3, bbW = wA + dd, bbH = hH + dd;
      const x0 = (VW - bbW) / 2, y0 = 16 + (panelAH + bbH) / 2;
      const FBL = [x0, y0], FBR = [x0 + wA, y0], FTL = [x0, y0 - hH], FTR = [x0 + wA, y0 - hH];
      const BBL = [x0 + dd, y0 - dd], BBR = [x0 + wA + dd, y0 - dd], BTL = [x0 + dd, y0 - hH - dd], BTR = [x0 + wA + dd, y0 - hH - dd];
      dtC("REPRESENTACION 3D", VW / 2, 12, 8.5, INK);
      [[BBL, BBR], [BBL, BTL], [BBL, FBL]].forEach((e) => dl(e[0][0], e[0][1], e[1][0], e[1][1], FOLD, 0.6, [3, 2]));
      [[FTL, FTR], [FTR, FBR], [FBR, FBL], [FBL, FTL], [FTL, BTL], [FTR, BTR], [FBR, BBR], [BTL, BTR], [BTR, BBR]].forEach((e) => dl(e[0][0], e[0][1], e[1][0], e[1][1], EDGE, 1));
      if (conCotas) {
        dtC("ancho " + fmt(A) + "m", (FBL[0] + FBR[0]) / 2, y0 + 10, 7, MUT);
        dtL("alto " + fmt(H) + "m", x0 - 34, (FTL[1] + FBL[1]) / 2, 7, MUT);
        dtL("largo " + fmt(L) + "m", (FTR[0] + BTR[0]) / 2 + 3, (FTR[1] + BTR[1]) / 2 - 2, 7, MUT);
      }
    }
    // ----- Panel B: hoja desplegada -----
    const Wd = A + hz + hd, Ld = L + hs + hi;
    let extL = 0, extR = 0, extT = 0, extB = 0;
    aletasV.forEach((a) => {
      extL = Math.max(extL, -hz - a.x); extR = Math.max(extR, (a.x + a.w) - (A + hd));
      extT = Math.max(extT, -hs - a.y); extB = Math.max(extB, (a.y + a.h) - (L + hi));
    });
    extL = Math.max(0, extL); extR = Math.max(0, extR); extT = Math.max(0, extT); extB = Math.max(0, extB);
    const Wd2 = Wd + extL + extR, Ld2 = Ld + extT + extB;
    const pbx = 60, pbyTit = panelAH + 12, pby = panelAH + 30;
    const scB = Math.min((VW - 120) / Wd2, (box.h - pby - 40 - legH) / Ld2);
    const X = (x) => pbx + (extL + x) * scB, Y = (y) => pby + (extT + y) * scB;
    dtC(spec.vista === "trasera" ? "PLANO DESPLEGADO - VISTA INTERIOR (espejo)" : "PLANO DESPLEGADO (hoja de corte)", VW / 2, pbyTit, 8.5, INK);
    const cross = [[hz, 0], [hz + A, 0], [hz + A, hs], [Wd, hs], [Wd, hs + L], [hz + A, hs + L], [hz + A, Ld], [hz, Ld], [hz, hs + L], [0, hs + L], [0, hs], [hz, hs]];
    for (let i = 0; i < cross.length; i++) { const a = cross[i], b = cross[(i + 1) % cross.length]; if (Math.abs(a[0] - b[0]) > 1e-9 || Math.abs(a[1] - b[1]) > 1e-9) dl(X(a[0]), Y(a[1]), X(b[0]), Y(b[1]), EDGE, 1); }
    const foldsV = [];
    if (hs) foldsV.push([[hz, hs], [hz + A, hs]]);
    if (hi) foldsV.push([[hz, hs + L], [hz + A, hs + L]]);
    if (hz) foldsV.push([[hz, hs], [hz, hs + L]]);
    if (hd) foldsV.push([[hz + A, hs], [hz + A, hs + L]]);
    foldsV.forEach((e) => dl(X(e[0][0]), Y(e[0][1]), X(e[1][0]), Y(e[1][1]), FOLD, 0.7, [4, 3]));
    const notch = [];
    if (hs && hz) notch.push([0, 0, hz, hs]); if (hs && hd) notch.push([hz + A, 0, hd, hs]);
    if (hi && hz) notch.push([0, hs + L, hz, hi]); if (hi && hd) notch.push([hz + A, hs + L, hd, hi]);
    notch.forEach((n) => {
      page.drawRectangle({ x: PX(X(n[0])), y: PY(Y(n[1] + n[3])), width: n[2] * scB, height: n[3] * scB, borderColor: CUT, borderWidth: 1.1, borderDashArray: [4, 2] });
      dtC(fmt(n[2]) + "x" + fmt(n[3]), X(n[0] + n[2] / 2), Y(n[1] + n[3] / 2) + 2, 5.5, CUT);
    });
    // Elementos del paño (ventanas, calados, bolsillos, ojetillos) sobre la tapa central, offset por el alto.
    const skT = skVol;
    const rT = Math.max(1.4, Math.min(2.6, scB * 0.022));
    const rimOutP = spec.volumetrico.bordesEnPliegue ? null : { sup: hs * scB, inf: hi * scB, izq: hz * scB, der: hd * scB };
    elementosPDF(page, skT, { px: (ex) => box.x + X(hz + ex), py: (ey) => box.top - Y(hs + ey), scale: scB, x0: box.x + X(hz), topRect: box.top - Y(hs), wpx: A * scB, hpx: L * scB, r: rT, rimOut: rimOutP }, font);
    dtL("TAPA " + fmt(L) + "x" + fmt(A) + "m", X(hz) + 3, Y(hs) + 9, 6.5, INK);
    notasPDF(page, skVol.notas, (mx) => PX(X(hz + mx)), (my) => PY(Y(hs + my)), scB, spec.rotDrag, font);
    if (conCotas) {
      hCota(X(0), X(Wd), pby - 12, Wd);
      vCota(Y(0), Y(Ld), pbx - 14, Ld);
      if (hs) vCota(Y(0), Y(hs), X(hz + A) + 14, hs);
      else if (hi) vCota(Y(hs + L), Y(Ld), X(hz + A) + 14, hi);
      if (hi && hs && Math.abs(hi - hs) > 1e-9) vCota(Y(hs + L), Y(Ld), X(hz) - 16, hi);
    }
    // Leyenda de simbología en el borde inferior izquierdo.
    if (legH) leyendaPDF(page, simb, box.x + 3, box.top - box.h + legH, font);
  }

  // Leyenda de simbología en PDF (anclada por su esquina superior-izquierda en x,yTop; y crece hacia abajo).
  function leyendaPDF(page, items, xLeft, yTop, font) {
    if (!items.length) return;
    const SK = global.SketchCIBSA;
    const ACC = BLUE(), FUS = PDFLib.rgb(0.82, 0.23, 0.18), TEAL = PDFLib.rgb(0.12, 0.62, 0.54);
    const AMBER = PDFLib.rgb(0.753, 0.475, 0.122), PURPLE = PDFLib.rgb(0.557, 0.267, 0.678);
    const GRAY = PDFLib.rgb(0.6, 0.65, 0.7), TXT = PDFLib.rgb(0.12, 0.12, 0.12);
    const titH = 9, rowH = 9, boxW = 96, W = 5, Hh = 2.8, rr = 1.8;
    const boxH = titH + items.length * rowH + 3;
    page.drawRectangle({ x: xLeft - 3, y: yTop - boxH, width: boxW, height: boxH, color: WHITE(), opacity: 0.9, borderColor: GRAY, borderWidth: 0.5, borderOpacity: 1 });
    page.drawText("SIMBOLOGÍA", { x: xLeft, y: yTop - 7, size: 6, font: font, color: TXT });
    const ojeG = (cx, cy) => { page.drawCircle({ x: cx, y: cy, size: rr, borderColor: ACC, borderWidth: 0.4, color: WHITE() }); page.drawCircle({ x: cx, y: cy, size: rr * 0.42, borderColor: ACC, borderWidth: 0.35 }); };
    items.forEach((it, i) => {
      const yMid = yTop - titH - i * rowH - rowH / 2, gx = xLeft + 7;
      const k = it.k;
      if (k === "oje") ojeG(gx, yMid);
      else if (k === "win") page.drawRectangle({ x: gx - W, y: yMid - Hh, width: W * 2, height: Hh * 2, borderColor: ACC, borderWidth: 0.8, borderDashArray: [2, 1.5] });
      else if (k === "aleta") page.drawRectangle({ x: gx - W, y: yMid - Hh, width: W * 2, height: Hh * 2, borderColor: AMBER, borderWidth: 0.9, color: AMBER, opacity: 0.1, borderOpacity: 1 });
      else if (k === "pocket") {
        page.drawRectangle({ x: gx - W, y: yMid - Hh, width: W * 2, height: Hh * 2, borderColor: TEAL, borderWidth: 0.7, color: TEAL, opacity: 0.12, borderOpacity: 1 });
        page.drawLine({ start: { x: gx - W, y: yMid - Hh * 0.4 }, end: { x: gx + W, y: yMid - Hh * 0.4 }, thickness: 0.8, color: TEAL });
        for (let j = 0; j <= 3; j++) { const sx = gx - W + (2 * W) * j / 3; page.drawLine({ start: { x: sx, y: yMid - Hh * 0.4 - 1 }, end: { x: sx, y: yMid - Hh * 0.4 + 1 }, thickness: 0.45, color: TEAL }); }
      } else if (k === "cut") {
        page.drawLine({ start: { x: gx - W, y: yMid }, end: { x: gx + W, y: yMid }, thickness: 1, color: PURPLE, dashArray: [3, 2] });
        for (let j = 0; j < 3; j++) { const sx = gx - W * 0.6 + j * W * 0.6; page.drawLine({ start: { x: sx, y: yMid - 1.8 }, end: { x: sx + 1.4, y: yMid + 1.8 }, thickness: 0.35, color: PURPLE, opacity: 0.4 }); }
      } else if (k === "guia") {
        page.drawLine({ start: { x: gx - W, y: yMid }, end: { x: gx + W, y: yMid }, thickness: 0.8, color: TEAL, dashArray: [2, 2] });
      } else if (k === "fusion") {
        page.drawLine({ start: { x: gx - W, y: yMid }, end: { x: gx + W, y: yMid }, thickness: 0.9, color: FUS });
        SK.flechaBarbas(gx - W, yMid, 1, 0, 3.5).concat(SK.flechaBarbas(gx + W, yMid, -1, 0, 3.5))
          .forEach((b) => page.drawLine({ start: { x: b.x1, y: b.y1 }, end: { x: b.x2, y: b.y2 }, thickness: 0.9, color: FUS }));
      } else if (k === "piv") {
        page.drawCircle({ x: gx, y: yMid, size: 2, borderColor: PURPLE, borderWidth: 0.6 });
        page.drawLine({ start: { x: gx - 4.5, y: yMid }, end: { x: gx + 4.5, y: yMid }, thickness: 0.5, color: PURPLE });
        page.drawLine({ start: { x: gx, y: yMid - 4.5 }, end: { x: gx, y: yMid + 4.5 }, thickness: 0.5, color: PURPLE });
      }
      page.drawText(it.label, { x: xLeft + 16, y: yMid - 2, size: 5.5, font: font, color: TXT });
    });
  }
  // Resumen de straps agrupado por arista/origen y medida, contiguo a la leyenda.
  function resumenStrapsPDF(page, sk, xLeft, yTop, font) {
    const SK = global.SketchCIBSA;
    const filas = SK.strapsResumen(sk);
    if (!filas.length) return;
    const GRAY = PDFLib.rgb(0.6, 0.65, 0.7), TXT = PDFLib.rgb(0.12, 0.12, 0.12);
    const titH = 9, rowH = 8, boxW = 150;
    const total = filas.reduce((a, r) => a + r.n, 0);
    const boxH = titH + (filas.length + 1) * rowH + 4;
    page.drawRectangle({ x: xLeft - 3, y: yTop - boxH, width: boxW, height: boxH, color: WHITE(), opacity: 0.9, borderColor: GRAY, borderWidth: 0.5, borderOpacity: 1 });
    page.drawText("STRAPS POR ARISTA", { x: xLeft, y: yTop - 7, size: 6, font: font, color: TXT });
    filas.forEach((r, i) => {
      const y = yTop - titH - i * rowH - rowH / 2 - 2;
      const med = r.n + " × " + SK.fmt(r.largo) + " m × " + SK.fmt(Math.round(r.ancho * 100)) + " cm";
      page.drawText(r.grupo, { x: xLeft, y: y, size: 5.5, font: font, color: TXT });
      page.drawText(med, { x: xLeft + boxW - 6 - font.widthOfTextAtSize(med, 5.5), y: y, size: 5.5, font: font, color: TXT });
    });
    const yT = yTop - titH - filas.length * rowH - rowH / 2 - 2;
    page.drawText("TOTAL", { x: xLeft, y: yT, size: 6, font: font, color: TXT });
    const tot = total + " cinta(s)";
    page.drawText(tot, { x: xLeft + boxW - 6 - font.widthOfTextAtSize(tot, 6), y: yT, size: 6, font: font, color: TXT });
  }
  // Resumen "CINTAS POR ARISTA" (una fila por cinta; patrón de N recorridos = una fila con ×N).
  function resumenCintasPDF(page, sk, xLeft, yTop, font) {
    const SK = global.SketchCIBSA, gs = SK.cintasResumen(sk); if (!gs.length) return;
    const GRAY = PDFLib.rgb(0.6, 0.65, 0.7), TXT = PDFLib.rgb(0.12, 0.12, 0.12);
    const titH = 9, rowH = 8, boxW = 168, nm = { sup: "Sup", inf: "Inf", izq: "Izq", der: "Der", "patrón": "Patron" };
    const boxH = titH + gs.length * rowH + 4;
    page.drawRectangle({ x: xLeft - 3, y: yTop - boxH, width: boxW, height: boxH, color: WHITE(), opacity: 0.9, borderColor: GRAY, borderWidth: 0.5, borderOpacity: 1 });
    page.drawText("CINTAS POR ARISTA", { x: xLeft, y: yTop - 7, size: 6, font: font, color: TXT });
    gs.forEach((g, i) => {
      const y = yTop - titH - i * rowH - rowH / 2 - 2;
      const lbl = (g.n > 1 ? g.n + "x " : "") + (nm[g.arista] || g.arista || "") + (g.tipo === "cierre" ? " cierre" : "") + (g.legend && g.legend.trim() ? " " + g.legend.trim() : "");
      const info = "mat " + SK.fmt(g.mMat) + " / cos " + SK.fmt(g.mCos) + " m" + (g.nOpen ? " b" + g.nOpen : "") + (g.nGap ? " h" + g.nGap : "");
      page.drawText(lbl, { x: xLeft, y: y, size: 5.5, font: font, color: TXT });
      page.drawText(info, { x: xLeft + boxW - 6 - font.widthOfTextAtSize(info, 5.5), y: y, size: 5.5, font: font, color: TXT });
    });
  }

  function dibujarSketchPDF(page, spec, box, font, opts) {
    opts = opts || {};
    if (!spec || !global.SketchCIBSA) return;
    if (spec.volumetrico && (parseFloat(spec.volumetrico.alto) || 0) > 0) return dibujarVolPDF(page, spec, box, font, opts);
    const SK = global.SketchCIBSA;
    const sk = SK.construirSketch(spec);
    if (!(sk.ancho > 0) || !(sk.largo > 0)) return;
    const conCotas = opts.cotas !== false;
    // Margen extra para los rótulos de orientación: los aleja de las cotas y achica un poco la imagen.
    const LBL = 22;
    // Márgenes por lado: espacio de cotas (por lado) + rótulos de orientación.
    const ML = conCotas ? SK.margenCotasLados(sk) : { top: 0, bottom: 0, left: 0, right: 0 };
    const simb = SK.simbologia(sk);
    const legH = simb.length ? (9 + simb.length * 9 + 6) : 0;
    const resFilas = SK.strapsResumen(sk);
    const resH = resFilas.length ? (9 + (resFilas.length + 1) * 8 + 4) : 0;
    const cintaGrp = SK.cintasResumen(sk).length;
    const cintaResH = cintaGrp ? (9 + cintaGrp * 8 + 4) : 0;
    const bottomH = Math.max(legH, resH + (cintaResH ? (resH ? 5 : 0) + cintaResH : 0));
    const mTop = ML.top + LBL, mLeft = ML.left + LBL;
    const mBot = ML.bottom + 18 + LBL + bottomH;
    let mRight = ML.right + 18 + LBL;
    // Bounds del paño (base + aletas) — las cotas se anclan AQUÍ (los straps NO afectan las cotas).
    let pMinX = 0, pMaxX = sk.ancho, pMinY = 0, pMaxY = sk.largo;
    (sk.aletas || []).forEach((a) => { pMinX = Math.min(pMinX, a.x); pMaxX = Math.max(pMaxX, a.x + a.w); pMinY = Math.min(pMinY, a.y); pMaxY = Math.max(pMaxY, a.y + a.h); });
    const minX = pMinX, maxX = pMaxX, minY = pMinY, maxY = pMaxY; // straps no alteran el tamaño del dibujo
    const bw = maxX - minX, bh = maxY - minY;
    const geomFor = (mR) => {
      const aW = box.w - mLeft - mR, aH = box.h - mTop - mBot;
      if (aW <= 0 || aH <= 0) return null;
      const sc = Math.min(aW / bw, aH / bh);
      const tW = bw * sc + mLeft + mR, tH = bh * sc + mTop + mBot;
      const x0r = box.x + (box.w - tW) / 2 + mLeft, tpr = box.top - (box.h - tH) / 2 - mTop;
      return { sc: sc, x0: x0r - minX * sc, topRect: tpr + minY * sc };
    };
    let g = geomFor(mRight); if (!g) return;
    // Rótulos-guía: detectar los que no caben con la escala actual; reservar franja derecha y re-escalar.
    const cFits = (text, wpx2, hpx2) => { const est = font.widthOfTextAtSize(san(text || ""), 6.5); return (wpx2 - 4) >= est && hpx2 >= 9.5; };
    const calloutEls = [];
    (sk.aletas || []).forEach((a) => { if (a.rotulo || !cFits(a.nombre, a.w * g.sc, a.h * g.sc)) calloutEls.push({ obj: a, sy: a.y + a.h / 2 }); });
    (sk.ventanas || []).forEach((v) => { if (v.legend && (v.rotulo || !cFits(v.legend, v.w * g.sc, v.h * g.sc))) calloutEls.push({ obj: v, sy: v.y + v.h / 2 }); });
    (sk.setsRot || []).forEach((sr) => { calloutEls.push({ obj: sr, sy: sr.y }); });
    (sk.bolsillos || []).forEach((bo) => { if (bo.rotulo) calloutEls.push({ obj: bo, sy: (bo.arista === "sup") ? 0 : sk.largo }); });
    if (calloutEls.length) { const g2 = geomFor(mRight + 130); if (g2) { mRight += 130; g = g2; } }
    const scale = g.sc, x0 = g.x0, topRect = g.topRect;
    const wpx = sk.ancho * scale, hpx = sk.largo * scale;
    const px = (sx) => x0 + sx * scale;
    const py = (sy) => topRect - sy * scale;
    let cb = null;
    if (calloutEls.length) {
      const midY = topRect - bh * scale / 2;
      calloutEls.sort((A, B) => py(B.sy) - py(A.sy));
      const slots = new Map(); const dy = 19; let last = Infinity;
      calloutEls.forEach((e) => { const ay = py(e.sy); const off = (ay > midY) ? -10 : 10; let ly = ay + off; if (ly > last - dy) ly = last - dy; last = ly; slots.set(e.obj, ly); });
      cb = { x: px(maxX) + 16, slots: slots, rightEdge: px(maxX) + 118 };
    }
    const GRAY = PDFLib.rgb(0.12, 0.12, 0.12);
    const ACC = BLUE();
    const RED = PDFLib.rgb(0.106, 0.369, 0.125); // verde pino
    const TICK = 3, EXTGAP = 3;
    // Contorno del paño: rectángulo, o el polígono recortado si hay cortes "Eliminar" (la parte se va).
    if (sk.panoPoly && sk.panoPoly.length >= 3) {
      for (let i = 0; i < sk.panoPoly.length; i++) {
        const pa = sk.panoPoly[i], pb = sk.panoPoly[(i + 1) % sk.panoPoly.length];
        page.drawLine({ start: { x: px(pa.x), y: py(pa.y) }, end: { x: px(pb.x), y: py(pb.y) }, thickness: 1.3, color: GRAY });
      }
    } else {
      page.drawRectangle({ x: x0, y: topRect - hpx, width: wpx, height: hpx, borderColor: GRAY, borderWidth: 1.3 });
    }
    // Elementos del paño (ventanas, bolsillos, ojetillos, aletas, cortes)
    const r = Math.max(0.8, Math.max(1.4, Math.min(2.6, scale * 0.022)) - 0.9); // ojetillos del plano: ~2 puntos más chicos (la leyenda usa su propio radio fijo)
    elementosPDF(page, sk, { px: px, py: py, scale: scale, x0: x0, topRect: topRect, wpx: wpx, hpx: hpx, r: r, cb: cb }, font);
    notasPDF(page, sk.notas, px, py, scale, spec.rotDrag, font);
    // Cotas (rojo): mayor = paño base; menor = padding / ventanas
    if (conCotas) {
      const ln = (x1, y1, x2, y2, w) => page.drawLine({ start: { x: x1, y: y1 }, end: { x: x2, y: y2 }, thickness: w, color: RED });
      // Líneas de extensión (perpendiculares a la arista): finas, discontinuas y translúcidas.
      const lnExt = (x1, y1, x2, y2) => page.drawLine({ start: { x: x1, y: y1 }, end: { x: x2, y: y2 }, thickness: 0.18, color: RED, dashArray: [1.6, 1.6], opacity: 0.45 });
      const bTopY = py(pMinY), bBotY = py(pMaxY), bLeftX = px(pMinX), bRightX = px(pMaxX);
      SK.cotasDe(sk).forEach((c) => {
        if (sk.cotasOcultas && c.key && sk.cotasOcultas[c.key]) return; // cota ocultada por el usuario
        const off = SK.offsetCota(c), lbl = SK.fmt(c.value) + "m";
        // Offsets del usuario (arrastre de cotas en la App): d acerca la cota a su arista; t desliza la etiqueta.
        const cpo = (sk.cotasPos && c.key && sk.cotasPos[c.key]) || null;
        const dSh = cpo ? (cpo.d || 0) * scale : 0, tSh = cpo ? (cpo.t || 0) * scale : 0;
        if (c.axis === "h") {
          const xa = px(c.a), xb = px(c.b);
          const base = (c.side === "bottom") ? bBotY : bTopY, dir = (c.side === "bottom") ? -1 : 1;
          const dimY = base + dir * (off - dSh), tEnd = dimY - dir * EXTGAP;
          const eB = (c.ref != null) ? py(c.ref) : base;   // la auxiliar llega HASTA el elemento inscrito
          lnExt(xa, eB, xa, tEnd); lnExt(xb, eB, xb, tEnd);
          ln(xa, dimY, xb, dimY, 0.4);
          ln(xa, dimY - TICK, xa, dimY + TICK, 0.4); ln(xb, dimY - TICK, xb, dimY + TICK, 0.4);
          const ty = (c.side === "bottom") ? dimY - 6 : dimY + 2;
          page.drawText(lbl, { x: (xa + xb) / 2 + tSh - font.widthOfTextAtSize(lbl, 5.5) / 2, y: ty, size: 5.5, font: font, color: RED });
        } else {
          const ya = py(c.a), yb = py(c.b);
          const base = (c.side === "right") ? bRightX : bLeftX, dir = (c.side === "right") ? 1 : -1;
          const dimX = base + dir * (off - dSh), tEnd = dimX - dir * EXTGAP;
          const eB = (c.ref != null) ? px(c.ref) : base;   // la auxiliar llega HASTA el elemento inscrito
          lnExt(eB, ya, tEnd, ya); lnExt(eB, yb, tEnd, yb);
          ln(dimX, ya, dimX, yb, 0.4);
          ln(dimX - TICK, ya, dimX + TICK, ya, 0.4); ln(dimX - TICK, yb, dimX + TICK, yb, 0.4);
          // rotate(90): los glifos se extienden ~6pt hacia -x desde el origen → a la DERECHA el
          // origen debe correrse ese alto de glifo para que el texto quede fuera de la línea.
          const my = (ya + yb) / 2 - tSh, tx = (c.side === "right") ? dimX + 8 : dimX - 4;
          page.drawText(lbl, { x: tx, y: my - font.widthOfTextAtSize(lbl, 5.5) / 2, size: 5.5, font: font, color: RED, rotate: PDFLib.degrees(90) });
        }
      });
    }
    // Rótulos de orientación (frontal/trasera + lados).
    const esTras = spec.vista === "trasera";
    const MUT = PDFLib.rgb(0.42, 0.42, 0.42);
    const cxA = (px(minX) + px(maxX)) / 2, cyA = (py(minY) + py(maxY)) / 2;
    const ctr = (s, x, y, sz, col) => page.drawText(s, { x: x - font.widthOfTextAtSize(s, sz) / 2, y: y, size: sz, font: font, color: col });
    // Alineado a la IZQUIERDA del dibujo (no centrado): así no se acopla con el rótulo
    // "SUPERIOR" ni con las etiquetas de las cotas superiores, que van centradas.
    page.drawText("VISTA " + (esTras ? "TRASERA" : "FRONTAL"), { x: px(minX), y: py(minY) + ML.top + LBL - 6, size: 7, font: font, color: ACC });
    // Terminación de cada arista anexada a su rótulo de orientación (swap izq/der en trasera; oculto si suprime cotas).
    const br = sk.bordesRot || {};
    const brIzq = esTras ? (br.der || "") : (br.izq || ""), brDer = esTras ? (br.izq || "") : (br.der || "");
    const bsuf = (txt) => txt ? " · " + san(txt) : "";
    ctr("SUPERIOR" + bsuf(br.sup), cxA, py(minY) + ML.top + 6, 5.5, MUT);
    ctr("INFERIOR" + bsuf(br.inf), cxA, py(maxY) - ML.bottom - 9, 5.5, MUT);
    const vlbl = (s, x, sz, col) => page.drawText(s, { x: x, y: cyA - font.widthOfTextAtSize(s, sz) / 2, size: sz, font: font, color: col, rotate: PDFLib.degrees(90) });
    vlbl("LADO IZQUIERDO" + bsuf(brIzq), px(minX) - ML.left - 6, 5.5, MUT);
    vlbl("LADO DERECHO" + bsuf(brDer), px(maxX) + ML.right + 14, 5.5, MUT);
    if (esTras) {
      vlbl("(frontal: der.)", px(minX) - ML.left + 1, 4.2, MUT);
      vlbl("(frontal: izq.)", px(maxX) + ML.right + 8, 4.2, MUT);
    }
    // Leyenda de simbología + resumen de straps en el borde inferior del recuadro.
    const legTop = box.top - box.h + bottomH;
    if (legH) leyendaPDF(page, simb, box.x + 3, legTop, font);
    resumenStrapsPDF(page, sk, box.x + 3 + 99, legTop, font);
    const rH2 = (SK.strapsResumen(sk).length) ? (9 + (SK.strapsResumen(sk).length + 1) * 8 + 4 + 5) : 0;
    resumenCintasPDF(page, sk, box.x + 3 + 99, legTop - rH2, font);
  }

  // Estampa "Cotización N° X" centrado (correlativo). Devuelve la y debajo; sin correlativo no consume espacio.
  function stampCorrelativo(page, datos, W, y, bold) {
    if (!datos || datos.correlativo == null || datos.correlativo === "") return y;
    const s = "Cotización N° " + datos.correlativo;
    page.drawText(san(s), { x: (W - bold.widthOfTextAtSize(s, 12)) / 2, y: y, size: 12, font: bold, color: BLACK() });
    return y - 18;
  }
  async function generarCotizacion(datos) {
    const { PDFDocument, StandardFonts } = PDFLib;
    const doc = await PDFDocument.create();
    const { font, bold } = await embedFonts(doc);
    const cibsa = await doc.embedPng(b64ToBytes(LOGOS.cibsa));

    const W = 612, H = 792, M = 50;
    let page = doc.addPage([W, H]);
    let y = H - 40;

    const txt = (p, s, x, yy, { f = font, size = 11, color = BLUE() } = {}) =>
      p.drawText(san(s), { x, y: yy, size, font: f, color });

    // Encabezado: logos
    const cW = 150, cH = cW * (cibsa.height / cibsa.width);
    page.drawImage(cibsa, { x: (W - cW) / 2, y: y - cH + 14, width: cW, height: cH });
    y -= 60;

    const center = (s, size, f = bold) => {
      const w = f.widthOfTextAtSize(s, size);
      txt(page, s, (W - w) / 2, y, { f, size });
    };
    center("COTIZACIÓN FORMAL", 13); y -= 18;
    center("(válido por 15 días)", 11, font); y -= 16;
    y = stampCorrelativo(page, datos, W, y, bold); y -= 8;

    // Solo-granel: sin título (puede haber muchos productos distintos), salvo que el usuario escriba uno.
    const titulo = datos.titulo ||
      (datos.soloGranel ? "" : `Carpa rectangular ${(+datos.largo)}m x ${(+datos.ancho)}m`);
    if (titulo) { txt(page, `"${titulo}"`, M, y, { f: bold, size: 15 }); y -= 24; }

    // Si hay datos de empresa, la cotización va dirigida a la empresa (prioridad sobre el contacto).
    if (datos.empresa && datos.empresa.razon) {
      const e = datos.empresa, lab = (k) => bold.widthOfTextAtSize(k, 11);
      txt(page, "Empresa: ", M, y, { f: bold }); txt(page, e.razon, M + lab("Empresa: "), y, { f: bold }); y -= 15;
      if (e.rut) { txt(page, "RUT: ", M, y, { f: bold }); txt(page, e.rut, M + lab("RUT: "), y); y -= 15; }
      if (e.giro) { txt(page, "Giro: ", M, y, { f: bold }); wrap(e.giro, font, 11, W - 2 * M - lab("Giro: ")).forEach((ln, i) => { txt(page, ln, M + (i === 0 ? lab("Giro: ") : 0), y); y -= 13; }); y -= 2; }
      const dirCom = [e.dir, e.comuna].filter(Boolean).join(", ");
      if (dirCom) { txt(page, "Dirección: ", M, y, { f: bold }); txt(page, dirCom, M + lab("Dirección: "), y); y -= 15; }
      if (e.email) { txt(page, "e-mail: ", M, y, { f: bold }); txt(page, e.email, M + lab("e-mail: "), y); y -= 15; }
      { const fns = (e.fonos || []).filter(Boolean).join(" · "); if (fns) { txt(page, "Teléfono: ", M, y, { f: bold }); txt(page, fns, M + lab("Teléfono: "), y); y -= 15; } }
    }
    const cNom = `${datos.cliente.nombre || ""} ${datos.cliente.apellido || ""}`.trim();
    if (cNom) { txt(page, "Contacto: ", M, y, { f: bold }); txt(page, cNom + ".", M + bold.widthOfTextAtSize("Contacto: ", 11), y); y -= 15; }
    { const cdir = [datos.cliente.dir, datos.cliente.comuna].filter(Boolean).join(", ");
      if (!datos.empresa && cdir) { txt(page, "Dirección: ", M, y, { f: bold }); txt(page, cdir, M + bold.widthOfTextAtSize("Dirección: ", 11), y); y -= 15; } }
    if (datos.cliente.email) { txt(page, "e-mail: ", M, y, { f: bold }); txt(page, datos.cliente.email, M + bold.widthOfTextAtSize("e-mail: ", 11), y); y -= 15; }
    { const fns = ((datos.cliente && datos.cliente.fonos) || []).filter(Boolean).join(" · ");
      if (fns) { txt(page, "Teléfono: ", M, y, { f: bold }); txt(page, fns, M + bold.widthOfTextAtSize("Teléfono: ", 11), y); y -= 15; } }
    y -= 7;

    txt(page, "PROPUESTA:", M, y, { f: bold }); y -= 15;
    const propuesta = datos.propuesta || (datos.soloGranel
      ? "Presupuesto de productos a granel según el detalle (venta por metro/unidad; corte de tela por metro cuando aplica)."
      : `Presupuesto en ${telaCli(datos.tela)} para carpa rectangular de ` +
        `${(+datos.largo)}m x ${(+datos.ancho)}m según diseño (incluye confección y refuerzos perimetrales).`);
    for (const ln of wrap(propuesta, font, 11, W - 2 * M)) { txt(page, ln, M, y); y -= 14; }
    y -= 6;
    txt(page, "NOTA: CARGOS POR DESPACHO SE COBRAN POR SEPARADO.", M, y, { f: bold }); y -= 22;

    // --- Tabla ---
    const c = datos.calc;
    const cols = [M, M + 70, M + 70 + 252, M + 70 + 252 + 95]; // x de cada columna
    const right = W - M;
    const colW = [70, 252, 95, right - cols[3]];
    const pad = 5;

    function rowHeight(detailLines) {
      return Math.max(22, 8 + detailLines.length * 12);
    }
    function hline(yy) {
      page.drawLine({ start: { x: M, y: yy }, end: { x: right, y: yy },
        thickness: 0.5, color: PDFLib.rgb(0.84, 0.84, 0.82) });
    }
    function vlines(yTop, yBot) {
      [cols[0], cols[1], cols[2], cols[3], right].forEach((x) =>
        page.drawLine({ start: { x, y: yTop }, end: { x, y: yBot },
          thickness: 0.5, color: PDFLib.rgb(0.84, 0.84, 0.82) }));
    }

    // Cabecera de tabla (repetible al paginar) + paginación de filas
    const headH = 22, BOTTOM = 70;
    let yTop = y;
    function dibujarCabecera() {
      page.drawRectangle({ x: M, y: y - headH, width: right - M, height: headH, color: HEADERBLUE() });
      const headers = ["Cantidad", "Detalle", "Valor Unitario", "Valor Total Neto"];
      headers.forEach((h, i) => {
        const size = 10;
        let x = cols[i] + pad;
        if (i !== 1) { x = cols[i] + (colW[i] - bold.widthOfTextAtSize(h, size)) / 2; }
        txt(page, h, x, y - 15, { f: bold, size, color: BRAND() });
      });
      yTop = y; y -= headH; hline(y);
    }
    function asegurar(h) {
      if (y - h >= BOTTOM) return;
      vlines(yTop, y);
      page = doc.addPage([W, H]); y = H - 50;
      dibujarCabecera();
    }
    dibujarCabecera();

    // Filas de ítems. Cada entrada de 'detail' = [texto, negrita, tamaño?]; "" o tamaño 0 = espaciador.
    const lineH = (sz) => Math.round(sz + 2.5);
    function itemRow(cantidad, detail, vu, vt) {
      const lines = [];
      detail.forEach((d) => {
        const s = d[0], b = !!d[1], size = d[2] != null ? d[2] : 10.5;
        if (s === "" || size === 0) { lines.push({ ln: "", b: false, size: 0 }); return; }
        wrap(s, b ? bold : font, size, colW[1] - 2 * pad).forEach((ln) => lines.push({ ln, b, size }));
      });
      let alto = 8; lines.forEach((L) => { alto += (L.size === 0 ? 6 : lineH(L.size)); });
      const h = Math.max(22, alto);
      asegurar(h);
      const cy = y - 14;
      txt(page, String(cantidad), cols[0] + (colW[0] - font.widthOfTextAtSize(String(cantidad), 11)) / 2, cy, { color: BLACK() });
      let dy = y - 13;
      lines.forEach((L) => {
        if (L.size === 0) { dy -= 6; return; }
        txt(page, L.ln, cols[1] + pad, dy, { f: L.b ? bold : font, size: L.size, color: BLACK() });
        dy -= lineH(L.size);
      });
      txt(page, vu, cols[2] + (colW[2] - font.widthOfTextAtSize(vu, 11)) / 2, cy, { color: BLACK() });
      txt(page, vt, cols[3] + (colW[3] - bold.widthOfTextAtSize(vt, 11)) / 2, cy, { f: bold, color: BLACK() });
      y -= h; hline(y);
    }

    // Filas de la carpa (tela + ojetillos). En cotización SOLO de granel no van.
    if (!datos.soloGranel) {
      const detTela = [[telaCli(datos.tela), true]].concat((datos.tela.ficha || []).map((s) => [s, false]));
      if (!datos.suprimirCotas) {
        detTela.push(["", false, 0]);
        detTela.push(["Diseño aprobado", true, 11.5]);
        (datos.detalleExtra || []).forEach((s) => detTela.push([s, false]));
      }
      detTela.push(["Valores aproximados. La confección tiene un margen de error de aprox. ±4 cm.", false, 8.5]);
      itemRow(String(c.cantidad), detTela, money(c.material), money(c.materialTotal));
      if (c.nOjetillosTotal > 0) { // sin ojetillos de arista (p. ej. aristas eliminadas por cortes): no imprimir fila en $0
        const ojBase = datos.ojetillosDetalle || `${c.nOjetillos} ojetillos en total.`;
        const ojTxt = ojBase + (c.cantidad > 1 ? ` (por unidad; ${c.cantidad} unidades).` : "");
        itemRow(String(c.nOjetillosTotal), [["Ojetillos", true], [ojTxt, false]],
          `${money(c.valorOjetillo)} c/u`, money(c.ojetillosValorTotal));
      }
    }
    // Complementos (insumos / accesorios / estructurales) — una fila por ítem
    (datos.complementos || []).forEach((cmp) => {
      itemRow(String(cmp.cantidad), [["Complemento", true], [cmp.detalle, false]],
        `${money(cmp.precio)} c/u`, money(cmp.totalNeto));
    });
    // Aletas / solapas / faldón / cenefa — paños anexos confeccionados (SÍ cotizan)
    (datos.aletas || []).forEach((a) => {
      itemRow(String(a.cantidad), [[a.cat || "Anexo", true], [a.detalle, false]],
        `${money(a.precio)} c/u`, money(a.totalNeto));
    });
    // Resumen GLOBAL de ojetillos (informativo, sin montos): el cliente ve el total del producto
    // y DÓNDE está cobrado cada grupo (fila propia vs. incluido en el valor de cada anexo).
    if (datos.ojetillosNota) {
      itemRow("", [["Ojetillos — resumen", true], [datos.ojetillosNota, false]], "", "");
    }
    // Productos a granel (sin proveedor) — una fila por línea. Si la línea tiene descuento
    // propio, va como línea aparte EN NEGRITA para que el cliente lo vea con su monto.
    (datos.granel || []).forEach((g) => {
      const det = [];
      if (g.detalleTit) { det.push([g.detalleTit, true, 12]); if (g.detalleResto) det.push([g.detalleResto, false]); }
      else det.push([g.detalle, false]);
      if (g.descuentoTxt) { det.push(["", false, 0]); det.push([g.descuentoTxt, true]); }
      itemRow(String(g.cantidad), det, g.precioU, money(g.total));
    });
    // Ítems discrecionales de Condiciones (Visita a Terreno / Despacho): fila propia, sin descuento.
    (datos.extras || []).forEach((ex) => {
      itemRow("", [[ex.titulo, true]], "", money(ex.neto));
    });
    // Mínimo de producción de taller (escalonado por unidad): completa el neto confeccionado.
    if (datos.minProduccion > 0) {
      const ufTxt = datos.minProdUF ? `${String(datos.minProdUF).replace(".", ",")} UF/u` : "mínimo de taller";
      itemRow("", [["Mínimo de producción", true], ["Completa el neto de lo confeccionado al mínimo de taller (" + ufTxt + ", con descuento escalonado en unidades adicionales).", false]], "", money(datos.minProduccion));
    }

    // Filas de totales
    function totalRow(label, value, fill) {
      const h = 20;
      asegurar(h);
      page.drawRectangle({ x: M, y: y - h, width: right - M, height: h, color: fill || GRAYBOX() });
      txt(page, label, cols[3] - pad - bold.widthOfTextAtSize(label, 11), y - 14, { f: bold, color: BLACK() });
      txt(page, value, cols[3] + (colW[3] - bold.widthOfTextAtSize(value, 11)) / 2, y - 14, { f: bold, color: BLACK() });
      y -= h; hline(y);
    }
    // Si hubo descuentos por línea en granel, se desglosan: lista → descuento → subtotal neto.
    const granelDescT = (datos.granel || []).reduce((s, g) => s + (g.descuento || 0), 0);
    if (granelDescT > 0) {
      totalRow("Subtotal (precios de lista)", money(c.subtotal + granelDescT));
      totalRow("Total Descuentos", "-" + money(granelDescT));
    }
    totalRow("Subtotal Neto", money(c.subtotal));
    if (c.descuentoPct > 0) {
      totalRow(datos.descuentoLabel || `Descuento ${c.descuentoPct}% (pago contado)`, "-" + money(c.descuento));
      totalRow("Neto con Descuento", money(c.netoConDescuento));
    }
    totalRow(`IVA (${c.ivaPct}%)`, money(c.iva));
    totalRow("TOTAL", money(c.total), TOTALFILL());
    vlines(yTop, y);
    y -= 16;

    // Nota amarilla
    let nota = `NOTA: Valores netos. El TOTAL indicado ya incluye IVA (${c.ivaPct}%)`;
    nota += c.descuentoPct > 0 ? (c.descuentoEsMonto ? " y el descuento por pago contado." : ` y el ${c.descuentoPct}% de descuento por pago contado.`) : ".";
    nota += " Productos sujetos a disponibilidad de stock.";
    const notaLines = wrap(nota, bold, 11, W - 2 * M - 8);
    if (y - (notaLines.length * 13 + 10) < 40) { page = doc.addPage([W, H]); y = H - 50; }
    page.drawRectangle({ x: M, y: y - notaLines.length * 13 - 4, width: right - M, height: notaLines.length * 13 + 6, color: GRAYBOX() });
    page.drawRectangle({ x: M, y: y - notaLines.length * 13 - 4, width: 4, height: notaLines.length * 13 + 6, color: BRAND() });
    let ny = y - 12;
    notaLines.forEach((ln) => { txt(page, ln, M + 4, ny, { f: bold, color: BLACK() }); ny -= 13; });

    // Observaciones (si las hay) — paginan si no caben: se agrega hoja antes de la de Condiciones.
    if (datos.observaciones) {
      const BOT = 54;
      let obsPage = page, oy = ny - 18;
      const ensure = () => { if (oy < BOT) { obsPage = doc.addPage([W, H]); oy = H - 50; } };
      ensure();
      txt(obsPage, "OBSERVACIONES:", M, oy, { f: bold }); oy -= 14;
      String(datos.observaciones).split(/\r?\n/).forEach((par) => {
        wrap(par || " ", font, 10.5, W - 2 * M).forEach((ln) => { ensure(); txt(obsPage, ln, M, oy, { size: 10.5, color: BLACK() }); oy -= 13; });
      });
    }

    // (La representación gráfica / plano se entrega como archivo aparte, no va en la cotización.)

    // --- Página 2 (condiciones) — en cotizaciones multi-tela solo va UNA vez, al final del PDF ---
    if (!datos.sinCondiciones) {
    const p2 = doc.addPage([W, H]);
    let y2 = H - 50;
    const t2 = (s, x, yy, o) => txt(p2, s, x, yy, o);
    t2("CONDICIONES GENERALES Y FORMA DE PAGO:", M, y2, { f: bold, size: 12 }); y2 -= 20;
    const dias = datos.diasEntrega != null ? datos.diasEntrega : CFG.DIAS_ENTREGA_DEFAULT;
    CFG.CONDICIONES.forEach((cond) => {
      const texto = cond.replace("{dias}", String(dias));
      const lines = wrap("•  " + texto, font, 10.5, W - 2 * M);
      lines.forEach((ln, i) => { t2(i === 0 ? ln : "   " + ln, M, y2, { size: 10.5, color: BLACK() }); y2 -= 13; });
      y2 -= 4;
    });
    y2 -= 8;
    const e = CFG.EMPRESA;
    t2("DATOS DE LA EMPRESA:", M, y2, { f: bold, size: 12 }); y2 -= 16;
    [e.razon_social, e.rut, e.cuenta, e.banco].forEach((l) => { t2(l, M, y2, { size: 11, color: BLACK() }); y2 -= 14; });
    y2 -= 10;
    const f = datos.fecha;
    t2(`${e.ciudad}, ${f.getDate()} de ${MESES[f.getMonth()]} de ${f.getFullYear()}`, M, y2, { size: 11, color: BLACK() }); y2 -= 16;
    t2("Vendedor:", M, y2, { f: bold, size: 11, color: BLACK() }); y2 -= 14;
    const vend = datos.vendedor ||
      { nombre: CFG.VENDEDOR.nombre, email: CFG.VENDEDOR.email || "", fonos: [CFG.VENDEDOR.fono].filter(Boolean) };
    const vendLineas = [vend.nombre]
      .concat(vend.email ? [vend.email] : [])
      .concat((vend.fonos || []).filter(Boolean))
      .concat([e.casa_matriz]);
    vendLineas.forEach((l) => { t2(l, M, y2, { size: 11, color: BLACK() }); y2 -= 14; });
    pieBanda(p2, bold, W, datos.fecha);
    }

    const bytes = await doc.save();
    return { bytes, filename: nombreArchivo(datos) + ".pdf" };
  }

  // ---------- Cotización combinada (varias telas: 1 cotización por tela en un solo PDF) ----------
  // Nombre con rango de versiones: C.{Inicial}{Apellido}{primera}-{última}_{ddmmaaaa}.pdf
  function nombreArchivoCombinada(datosList) {
    const d0 = datosList[0], c = d0.cliente;
    const inicial = c.nombre.trim().charAt(0).toUpperCase();
    let ap = c.apellido.trim();
    ap = (ap.charAt(0).toUpperCase() + ap.slice(1)).replace(/\s+/g, "");
    const f = d0.fecha;
    const dd = String(f.getDate()).padStart(2, "0"), mm = String(f.getMonth() + 1).padStart(2, "0");
    const vIni = datosList[0].version, vFin = datosList[datosList.length - 1].version;
    const rango = (datosList.length > 1 && vIni !== vFin) ? (vIni + "-" + vFin) : vIni;
    return `C.${inicial}${ap}${rango}_${dd}${mm}${f.getFullYear()}`;
  }
  async function generarCotizacionCombinada(datosList) {
    const { PDFDocument } = PDFLib;
    if (!datosList || !datosList.length) throw new Error("Sin telas para cotizar.");
    const master = await PDFDocument.create();
    for (let i = 0; i < datosList.length; i++) {
      const { bytes } = await generarCotizacion(Object.assign({}, datosList[i], { sinCondiciones: i < datosList.length - 1 }));
      const sub = await PDFDocument.load(bytes);
      const pages = await master.copyPages(sub, sub.getPageIndices());
      pages.forEach((p) => master.addPage(p));
    }
    const bytes = await master.save();
    return { bytes, filename: nombreArchivoCombinada(datosList) + ".pdf" };
  }

  // Varias telas globales (compuesto): una cotización compuesta por tela, unidas en un solo PDF.
  function nombreArchivoCompuestaCombinada(datosList) {
    const base = nombreArchivo(datosList[0]); // C.<etiqueta><vIni>_<fecha>
    const vIni = datosList[0].version, vFin = datosList[datosList.length - 1].version;
    // Reemplaza la versión inicial por el rango "vIni-vFin" (justo antes del "_<fecha>").
    if (datosList.length > 1 && vIni !== vFin) return base.replace(vIni + "_", (vIni + "-" + vFin) + "_");
    return base;
  }
  async function generarCotizacionCompuestaCombinada(datosList) {
    const { PDFDocument } = PDFLib;
    if (!datosList || !datosList.length) throw new Error("Sin telas para cotizar.");
    const master = await PDFDocument.create();
    for (let i = 0; i < datosList.length; i++) {
      const { bytes } = await generarCotizacionCompuesta(Object.assign({}, datosList[i], { sinCondiciones: i < datosList.length - 1 }));
      const sub = await PDFDocument.load(bytes);
      const pages = await master.copyPages(sub, sub.getPageIndices());
      pages.forEach((p) => master.addPage(p));
    }
    const bytes = await master.save();
    return { bytes, filename: nombreArchivoCompuestaCombinada(datosList) + ".pdf" };
  }

  // ---------- Documento "Valor Preliminar (Estimado)" ----------
  function nombreArchivoPreliminar(datos) {
    const f = datos.fecha;
    const dd = String(f.getDate()).padStart(2, "0");
    const mm = String(f.getMonth() + 1).padStart(2, "0");
    return `VP_${dd}${mm}${f.getFullYear()}`;
  }

  async function generarPreliminar(datos) {
    const { PDFDocument, StandardFonts } = PDFLib;
    const doc = await PDFDocument.create();
    const { font, bold } = await embedFonts(doc);
    const cibsa = await doc.embedPng(b64ToBytes(LOGOS.cibsa));

    const W = 612, H = 792, M = 50;
    const page = doc.addPage([W, H]);
    let y = H - 40;

    const txt = (p, s, x, yy, { f = font, size = 11, color = BLUE() } = {}) =>
      p.drawText(san(s), { x, y: yy, size, font: f, color });

    // Encabezado: logos
    const cW = 150, cH = cW * (cibsa.height / cibsa.width);
    page.drawImage(cibsa, { x: (W - cW) / 2, y: y - cH + 14, width: cW, height: cH });
    y -= 60;

    const center = (s, size, f = bold) => {
      const w = f.widthOfTextAtSize(s, size);
      txt(page, s, (W - w) / 2, y, { f, size });
    };
    center("VALOR PRELIMINAR (ESTIMADO)", 15); y -= 18;
    center("Valor referencial — no constituye cotización formal (válido por 15 días)", 9.5, font); y -= 26;

    const titulo = datos.titulo ||
      `Carpa rectangular ${(+datos.largo)}m x ${(+datos.ancho)}m`;
    txt(page, `"${titulo}"`, M, y, { f: bold, size: 15 }); y -= 24;

    txt(page, "PROPUESTA:", M, y, { f: bold }); y -= 15;
    const orientFrase = datos.orientacionTxt ? ` Costuras ${datos.orientacionTxt}.` : "";
    const propuesta = datos.propuesta ||
      `Valores preliminares referenciales para una carpa rectangular de ` +
      `${(+datos.largo)}m x ${(+datos.ancho)}m (1 unidad) en las telas recomendadas a continuación. ` +
      `Incluye confección, refuerzos perimetrales y ojetillos.` + orientFrase;
    for (const ln of wrap(propuesta, font, 11, W - 2 * M)) { txt(page, ln, M, y); y -= 14; }
    y -= 6;
    txt(page, "NOTA: CARGOS POR DESPACHO SE COBRAN POR SEPARADO.", M, y, { f: bold }); y -= 22;

    // --- Tabla: una fila por tela (sin total, sin IVA, sin descuento) ---
    const cols = [M, M + 372];                 // Detalle | Valor Neto
    const right = W - M;
    const colW = [cols[1] - cols[0], right - cols[1]];
    const pad = 5;

    function hline(yy) {
      page.drawLine({ start: { x: M, y: yy }, end: { x: right, y: yy },
        thickness: 0.5, color: PDFLib.rgb(0.84, 0.84, 0.82) });
    }
    function vlines(yTop, yBot) {
      [cols[0], cols[1], right].forEach((x) =>
        page.drawLine({ start: { x, y: yTop }, end: { x, y: yBot },
          thickness: 0.5, color: PDFLib.rgb(0.84, 0.84, 0.82) }));
    }

    // Cabecera
    const headH = 22;
    page.drawRectangle({ x: M, y: y - headH, width: right - M, height: headH, color: HEADERBLUE() });
    txt(page, "Detalle", cols[0] + pad, y - 15, { f: bold, size: 10, color: BRAND() });
    const h2lbl = "Valor Neto (1 unidad)";
    txt(page, h2lbl, cols[1] + (colW[1] - bold.widthOfTextAtSize(h2lbl, 9)) / 2, y - 15, { f: bold, size: 9, color: BRAND() });
    let yTop = y; y -= headH; hline(y);

    const oj = datos.ojetillosDetalle || "ojetillos según diseño";
    datos.items.forEach((item) => {
      const c = item.calc;
      const lines = [];
      [[telaCli(item.tela), true]]
        .concat((item.tela.ficha || []).map((s) => [s, false]))
        .concat([[`Incluye material + ${oj}`, false]])
        .forEach(([s, b]) => wrap(s, b ? bold : font, 10.5, colW[0] - 2 * pad)
          .forEach((ln) => lines.push([ln, b])));
      const h = Math.max(24, 10 + lines.length * 12);
      // Detalle multilínea
      let dy = y - 14;
      lines.forEach(([ln, b]) => { txt(page, ln, cols[0] + pad, dy, { f: b ? bold : font, size: 10.5, color: BLACK() }); dy -= 12; });
      // Valor neto centrado verticalmente
      const vt = money(c.subtotal);
      txt(page, vt, cols[1] + (colW[1] - bold.widthOfTextAtSize(vt, 12)) / 2, y - h / 2 - 4, { f: bold, size: 12, color: BLACK() });
      y -= h; hline(y);
    });
    vlines(yTop, y);
    y -= 16;

    // Nota amarilla
    const nota = "NOTA: Valores netos referenciales (no incluyen IVA), por 1 unidad. No incluye descuentos ni " +
      "despacho. Este valor preliminar no constituye una cotización formal y queda sujeto a confirmación y a " +
      "disponibilidad de stock.";
    const notaLines = wrap(nota, bold, 11, W - 2 * M - 8);
    page.drawRectangle({ x: M, y: y - notaLines.length * 13 - 4, width: right - M, height: notaLines.length * 13 + 6, color: GRAYBOX() });
    page.drawRectangle({ x: M, y: y - notaLines.length * 13 - 4, width: 4, height: notaLines.length * 13 + 6, color: BRAND() });
    let ny = y - 12;
    notaLines.forEach((ln) => { txt(page, ln, M + 4, ny, { f: bold, color: BLACK() }); ny -= 13; });
    y = ny - 16;

    // Línea de contacto del vendedor al pie (sin reponer la página de condiciones)
    if (datos.vendedor) {
      const v = datos.vendedor;
      const partes = [v.nombre]
        .concat(v.email ? [v.email] : [])
        .concat((v.fonos || []).filter(Boolean));
      txt(page, "Vendedor: ", M, y, { f: bold, size: 11 });
      txt(page, partes.join("  ·  "), M + bold.widthOfTextAtSize("Vendedor: ", 11), y, { size: 11 });
      y -= 16;
    }

    // El documento preliminar es de una sola página: no incluye la página de
    // Condiciones Generales ni datos de empresa (no son necesarios para un estimado).

    const bytes = await doc.save();
    return { bytes, filename: nombreArchivoPreliminar(datos) + ".pdf" };
  }

  // ---------- Cotización formal de Producto Compuesto (varias piezas, con paginación) ----------
  async function generarCotizacionCompuesta(datos) {
    const { PDFDocument, StandardFonts } = PDFLib;
    const doc = await PDFDocument.create();
    const { font, bold } = await embedFonts(doc);
    const cibsa = await doc.embedPng(b64ToBytes(LOGOS.cibsa));

    const W = 612, H = 792, M = 50;
    const GRAY = () => PDFLib.rgb(0.84, 0.84, 0.82);
    let page = doc.addPage([W, H]);
    let y = H - 40;

    const txt = (s, x, yy, { f = font, size = 11, color = BLUE() } = {}) =>
      page.drawText(san(s), { x, y: yy, size, font: f, color });

    // Encabezado: logos
    const cW = 150, cH = cW * (cibsa.height / cibsa.width);
    page.drawImage(cibsa, { x: (W - cW) / 2, y: y - cH + 14, width: cW, height: cH });
    y -= 60;

    const center = (s, size, f = bold) => { txt(s, (W - f.widthOfTextAtSize(s, size)) / 2, y, { f, size }); };
    center("COTIZACIÓN FORMAL", 13); y -= 18;
    center("(válido por 15 días)", 11, font); y -= 16;
    y = stampCorrelativo(page, datos, W, y, bold); y -= 8;

    const titulo = datos.titulo || "Producto compuesto según detalle";
    txt(`"${titulo}"`, M, y, { f: bold, size: 15 }); y -= 24;

    if (datos.empresa && datos.empresa.razon) {
      const e = datos.empresa, lab = (k) => bold.widthOfTextAtSize(k, 11);
      txt("Empresa: ", M, y, { f: bold }); txt(e.razon, M + lab("Empresa: "), y, { f: bold }); y -= 15;
      if (e.rut) { txt("RUT: ", M, y, { f: bold }); txt(e.rut, M + lab("RUT: "), y); y -= 15; }
      if (e.giro) { txt("Giro: ", M, y, { f: bold }); wrap(e.giro, font, 11, W - 2 * M - lab("Giro: ")).forEach((ln, i) => { txt(ln, M + (i === 0 ? lab("Giro: ") : 0), y); y -= 13; }); y -= 2; }
      const dirCom = [e.dir, e.comuna].filter(Boolean).join(", ");
      if (dirCom) { txt("Dirección: ", M, y, { f: bold }); txt(dirCom, M + lab("Dirección: "), y); y -= 15; }
      if (e.email) { txt("e-mail: ", M, y, { f: bold }); txt(e.email, M + lab("e-mail: "), y); y -= 15; }
      { const fns = (e.fonos || []).filter(Boolean).join(" · "); if (fns) { txt("Teléfono: ", M, y, { f: bold }); txt(fns, M + lab("Teléfono: "), y); y -= 15; } }
    }
    const cNomC = `${datos.cliente.nombre || ""} ${datos.cliente.apellido || ""}`.trim();
    if (cNomC) { txt("Contacto: ", M, y, { f: bold }); txt(cNomC + ".", M + bold.widthOfTextAtSize("Contacto: ", 11), y); y -= 15; }
    { const cdir = [datos.cliente.dir, datos.cliente.comuna].filter(Boolean).join(", ");
      if (!datos.empresa && cdir) { txt("Dirección: ", M, y, { f: bold }); txt(cdir, M + bold.widthOfTextAtSize("Dirección: ", 11), y); y -= 15; } }
    if (datos.cliente.email) { txt("e-mail: ", M, y, { f: bold }); txt(datos.cliente.email, M + bold.widthOfTextAtSize("e-mail: ", 11), y); y -= 15; }
    { const fns = ((datos.cliente && datos.cliente.fonos) || []).filter(Boolean).join(" · ");
      if (fns) { txt("Teléfono: ", M, y, { f: bold }); txt(fns, M + bold.widthOfTextAtSize("Teléfono: ", 11), y); y -= 15; } }
    y -= 7;

    txt("PROPUESTA:", M, y, { f: bold }); y -= 15;
    const propuesta = datos.propuesta ||
      "Presupuesto según el detalle de piezas a continuación (incluye confección, refuerzos perimetrales y ojetillos por pieza).";
    for (const ln of wrap(propuesta, font, 11, W - 2 * M)) { txt(ln, M, y); y -= 14; }
    y -= 6;
    txt("NOTA: CARGOS POR DESPACHO SE COBRAN POR SEPARADO.", M, y, { f: bold }); y -= 22;

    // --- Tabla paginada ---
    const cols = [M, M + 70, M + 70 + 252, M + 70 + 252 + 95];
    const right = W - M;
    const colW = [70, 252, 95, right - cols[3]];
    const pad = 5;
    const BOTTOM = 95;   // margen inferior; bajo esto, nueva página

    function hline(yy) { page.drawLine({ start: { x: M, y: yy }, end: { x: right, y: yy }, thickness: 0.5, color: GRAY() }); }
    function vsegs(yTop, yBot) {
      [cols[0], cols[1], cols[2], cols[3], right].forEach((x) =>
        page.drawLine({ start: { x, y: yTop }, end: { x, y: yBot }, thickness: 0.5, color: GRAY() }));
    }
    function drawHeader() {
      const headH = 22;
      page.drawRectangle({ x: M, y: y - headH, width: right - M, height: headH, color: HEADERBLUE() });
      const headers = ["Cantidad", "Detalle", "Valor Unitario", "Valor Total Neto"];
      headers.forEach((h, i) => {
        const size = 10;
        let x = cols[i] + pad;
        if (i !== 1) x = cols[i] + (colW[i] - bold.widthOfTextAtSize(h, size)) / 2;
        txt(h, x, y - 15, { f: bold, size, color: BRAND() });
      });
      hline(y); vsegs(y, y - headH); hline(y - headH);
      y -= headH;
    }
    function nuevaPagina(conHeader) {
      page = doc.addPage([W, H]); y = H - 50;
      if (conHeader) drawHeader();
    }
    function asegurar(h) { if (y - h < BOTTOM) nuevaPagina(true); }

    drawHeader();

    const lineH = (sz) => Math.round(sz + 2.5);
    function itemRow(cantidad, detail, vu, vt) {
      const lines = [];
      detail.forEach((d) => {
        const s = d[0], b = !!d[1], size = d[2] != null ? d[2] : 10.5;
        if (s === "" || size === 0) { lines.push({ ln: "", b: false, size: 0 }); return; }
        wrap(s, b ? bold : font, size, colW[1] - 2 * pad).forEach((ln) => lines.push({ ln, b, size }));
      });
      let alto = 8; lines.forEach((L) => { alto += (L.size === 0 ? 6 : lineH(L.size)); });
      const h = Math.max(22, alto);
      asegurar(h);
      const top = y, cy = y - 14;
      txt(String(cantidad), cols[0] + (colW[0] - font.widthOfTextAtSize(String(cantidad), 11)) / 2, cy, { color: BLACK() });
      let dy = y - 13;
      lines.forEach((L) => {
        if (L.size === 0) { dy -= 6; return; }
        txt(L.ln, cols[1] + pad, dy, { f: L.b ? bold : font, size: L.size, color: BLACK() });
        dy -= lineH(L.size);
      });
      txt(vu, cols[2] + (colW[2] - font.widthOfTextAtSize(vu, 11)) / 2, cy, { color: BLACK() });
      txt(vt, cols[3] + (colW[3] - bold.widthOfTextAtSize(vt, 11)) / 2, cy, { f: bold, color: BLACK() });
      y -= h; hline(y); vsegs(top, y);
    }

    // Una fila por pieza
    datos.piezas.forEach((pz) => {
      const etq = (pz.etiqueta || "").trim();
      const orientTxt = pz.orientTxt || "uniones a lo largo";
      const detail = [[etq || telaCli(pz.tela), true]];
      if (etq) detail.push([telaCli(pz.tela), false]);
      (pz.tela.ficha || []).forEach((s) => detail.push([s, false]));
      if (!datos.suprimirCotas) {
        detail.push(["", false, 0]);
        detail.push(["Diseño aprobado", true, 11.5]);
        detail.push([`Formato ${pz.largo}×${pz.ancho} m · ${pz.ojetillosTxt || (pz.ojetillos + " ojetillos c/u")} · ${orientTxt}`, false]);
        (pz.terminaciones || []).forEach((s) => detail.push([s, false]));
      }
      (pz.inscritosLineas || []).forEach((s) => detail.push([s, false]));
      (pz.complementosLineas || []).forEach((s) => detail.push([s, false]));
      detail.push(["Valores aproximados. La confección tiene un margen de error de aprox. ±4 cm.", false, 8.5]);
      itemRow(String(pz.cantidad), detail, money(pz.valorUnitario), money(pz.valorTotal));
    });
    // Productos a granel (sin proveedor). El descuento propio de la línea va aparte y EN
    // NEGRITA para que el cliente lo vea con su monto.
    (datos.granel || []).forEach((g) => {
      const det = [];
      if (g.detalleTit) { det.push([g.detalleTit, true, 12]); if (g.detalleResto) det.push([g.detalleResto, false]); }
      else det.push([g.detalle, false]);
      if (g.descuentoTxt) { det.push(["", false, 0]); det.push([g.descuentoTxt, true]); }
      itemRow(String(g.cantidad), det, g.precioU, money(g.total));
    });
    // Ítems discrecionales de Condiciones (Visita a Terreno / Despacho): fila propia, sin descuento.
    (datos.extras || []).forEach((ex) => {
      itemRow("", [[ex.titulo, true]], "", money(ex.neto));
    });
    // Mínimo de producción (escalonado por unidad): el monto ya viene calculado desde la app.
    const granelT = (datos.granel || []).reduce((s, g) => s + g.total, 0);
    const extrasT = (datos.extras || []).reduce((s, e) => s + (e.neto || 0), 0);
    const carpaSub0 = datos.piezas.reduce((s, p) => s + p.valorTotal, 0);
    const minProd = datos.minProduccion || 0;
    if (minProd > 0) {
      const ufTxt = datos.minProdUF ? ` (${String(datos.minProdUF).replace(".", ",")} UF neto de taller)` : "";
      itemRow("", [["Mínimo de producción", true], ["Completa el valor neto del producto confeccionado al mínimo de taller" + ufTxt + ".", false]], "", money(minProd));
    }

    // Totales. El descuento global (pago contado) aplica SOLO a las piezas de carpa.
    // El producto a granel ya viene neto con su propio descuento por línea.
    const carpaSub = carpaSub0 + minProd;
    const subtotal = carpaSub + granelT + extrasT;
    const descPct = datos.descuentoPct || 0;
    const descEsMonto = !!datos.descuentoEsMonto;
    const descuento = descEsMonto ? Math.min(Math.max(0, datos.descuento || 0), carpaSub) : Math.round(carpaSub * descPct / 100);
    const neto = subtotal - descuento;
    const iva = Math.round(neto * CFG.IVA_PCT / 100);
    const total = neto + iva;

    function totalRow(label, value, fill) {
      const h = 20;
      asegurar(h);
      const top = y;
      page.drawRectangle({ x: M, y: y - h, width: right - M, height: h, color: fill || GRAYBOX() });
      txt(label, cols[3] - pad - bold.widthOfTextAtSize(label, 11), y - 14, { f: bold, color: BLACK() });
      txt(value, cols[3] + (colW[3] - bold.widthOfTextAtSize(value, 11)) / 2, y - 14, { f: bold, color: BLACK() });
      y -= h; hline(y); vsegs(top, y);
    }
    // Si hubo descuentos por línea en granel, se desglosan: lista → descuento → subtotal neto.
    const granelDescT = (datos.granel || []).reduce((s, g) => s + (g.descuento || 0), 0);
    if (granelDescT > 0) {
      totalRow("Subtotal (precios de lista)", money(subtotal + granelDescT));
      totalRow("Total Descuentos", "-" + money(granelDescT));
    }
    totalRow("Subtotal Neto", money(subtotal));
    if (descuento > 0) {
      totalRow(datos.descuentoLabel || `Descuento ${descPct}% (pago contado)`, "-" + money(descuento));
      totalRow("Neto con Descuento", money(neto));
    }
    totalRow(`IVA (${CFG.IVA_PCT}%)`, money(iva));
    totalRow("TOTAL", money(total), TOTALFILL());
    y -= 16;

    // Nota amarilla
    let nota = `NOTA: Valores netos. El TOTAL indicado ya incluye IVA (${CFG.IVA_PCT}%)`;
    nota += descuento > 0 ? (descEsMonto ? " y el descuento por pago contado." : ` y el ${descPct}% de descuento por pago contado.`) : ".";
    nota += " Productos sujetos a disponibilidad de stock.";
    const notaLines = wrap(nota, bold, 11, W - 2 * M - 8);
    asegurar(notaLines.length * 13 + 10);
    page.drawRectangle({ x: M, y: y - notaLines.length * 13 - 4, width: right - M, height: notaLines.length * 13 + 6, color: GRAYBOX() });
    page.drawRectangle({ x: M, y: y - notaLines.length * 13 - 4, width: 4, height: notaLines.length * 13 + 6, color: BRAND() });
    let ny = y - 12;
    notaLines.forEach((ln) => { txt(ln, M + 4, ny, { f: bold, color: BLACK() }); ny -= 13; });

    // Observaciones (si las hay) — paginan línea a línea si no caben (incluso si superan una página).
    if (datos.observaciones) {
      let oy = ny - 18;
      const ensure = () => { if (oy < 54) { nuevaPagina(false); oy = y - 12; } };
      ensure();
      txt("OBSERVACIONES:", M, oy, { f: bold }); oy -= 14;
      String(datos.observaciones).split(/\r?\n/).forEach((par) => {
        wrap(par || " ", font, 10.5, W - 2 * M).forEach((ln) => { ensure(); txt(ln, M, oy, { size: 10.5, color: BLACK() }); oy -= 13; });
      });
    }

    // (La representación gráfica / plano de las piezas se entrega como archivo aparte, no va en la cotización.)

    // --- Página final: condiciones + empresa + vendedor (multi-tela: solo una vez, al final) ---
    if (!datos.sinCondiciones) {
    const p2 = doc.addPage([W, H]);
    let y2 = H - 50;
    const t2 = (s, x, yy, o) => p2.drawText(san(s), { x, y: yy, size: (o && o.size) || 11, font: (o && o.f) || font, color: (o && o.color) || BLUE() });
    t2("CONDICIONES GENERALES Y FORMA DE PAGO:", M, y2, { f: bold, size: 12 }); y2 -= 20;
    const dias = datos.diasEntrega != null ? datos.diasEntrega : CFG.DIAS_ENTREGA_DEFAULT;
    CFG.CONDICIONES.forEach((cond) => {
      const texto = cond.replace("{dias}", String(dias));
      const lines = wrap("•  " + texto, font, 10.5, W - 2 * M);
      lines.forEach((ln, i) => { t2(i === 0 ? ln : "   " + ln, M, y2, { size: 10.5, color: BLACK() }); y2 -= 13; });
      y2 -= 4;
    });
    y2 -= 8;
    const e = CFG.EMPRESA;
    t2("DATOS DE LA EMPRESA:", M, y2, { f: bold, size: 12 }); y2 -= 16;
    [e.razon_social, e.rut, e.cuenta, e.banco].forEach((l) => { t2(l, M, y2, { size: 11, color: BLACK() }); y2 -= 14; });
    y2 -= 10;
    const f = datos.fecha;
    t2(`${e.ciudad}, ${f.getDate()} de ${MESES[f.getMonth()]} de ${f.getFullYear()}`, M, y2, { size: 11, color: BLACK() }); y2 -= 16;
    t2("Vendedor:", M, y2, { f: bold, size: 11, color: BLACK() }); y2 -= 14;
    const vend = datos.vendedor ||
      { nombre: CFG.VENDEDOR.nombre, email: CFG.VENDEDOR.email || "", fonos: [CFG.VENDEDOR.fono].filter(Boolean) };
    [vend.nombre].concat(vend.email ? [vend.email] : []).concat((vend.fonos || []).filter(Boolean)).concat([e.casa_matriz])
      .forEach((l) => { t2(l, M, y2, { size: 11, color: BLACK() }); y2 -= 14; });
    pieBanda(p2, bold, W, datos.fecha);
    }

    const bytes = await doc.save();
    return { bytes, filename: nombreArchivo(datos) + ".pdf" };
  }

  // ---------- Dibujo del producto (PDF descargable de 1 hoja) ----------
  // datos: { filenameBase, etiquetaArchivo, titulo, tela, color, largo, ancho, ojetillos,
  //          unidades, observaciones:[], materiales:[{nombre,cant}], sketch }
  async function generarSketchPDF(datos) {
    const { PDFDocument, StandardFonts } = PDFLib;
    const doc = await PDFDocument.create();
    const { font, bold } = await embedFonts(doc);
    const cibsa = await doc.embedPng(b64ToBytes(LOGOS.cibsa));
    const W = 612, H = 792, M = 50;
    const page = doc.addPage([W, H]);
    const txt = (s, x, y, o) => page.drawText(san(s), { x, y, size: (o && o.size) || 11, font: (o && o.f) || font, color: (o && o.color) || BLUE() });
    const fmtN = (n) => (Math.round((+n) * 1000) / 1000).toString();

    let y = dibujarEncabezado(page, cibsa, null, W, M, H - 40);
    tituloCentrado(page, "PLANO DEL PRODUCTO", W, y, bold, 15, BLUE()); y -= 15;
    tituloCentrado(page, "(plano referencial para taller)", W, y, font, 10, BLUE()); y -= 14;
    y = stampCorrelativo(page, datos, W, y, bold); y -= 8;
    if (datos.titulo) { txt(`"${datos.titulo}"`, M, y, { f: bold, size: 12 }); y -= 18; }

    // Modo "de aprobación": sin cotas, sin Ojetillos, sin Observaciones ni cuadro de materiales.
    const limpio = !!datos.suprimirCotas;
    // Bloque de detalle (arriba-izquierda)
    const color = (datos.color && String(datos.color).trim()) ? datos.color : "N/A";
    const campos = [
      ["Tipo de Tela", datos.tela || "N/A"],
      ["Color", color],
      ["Dimensiones", fmtN(datos.largo) + "m x " + fmtN(datos.ancho) + "m"],
    ].concat(limpio ? [] : [["Ojetillos", String(datos.ojetillos || 0) + (datos.ojetillosDesglose2 ? " " + datos.ojetillosDesglose2 : "")]])
      .concat([["Cantidad de Unidades", String(datos.unidades || 1)]]);
    campos.forEach(([k, v]) => {
      txt(k + ": ", M, y, { f: bold });
      txt(v, M + bold.widthOfTextAtSize(k + ": ", 11), y, { color: BLACK() });
      y -= 15;
    });
    // Detalle de ojetillos por arista (cantidad instalada + espaciado) — solo plano de taller.
    if (!limpio && datos.ojetillosAristas && datos.ojetillosAristas.length) {
      txt("Ojetillos por arista:", M, y, { f: bold }); y -= 13;
      datos.ojetillosAristas.forEach((ln) => { txt("- " + ln, M + 6, y, { size: 9.5, color: BLACK() }); y -= 12; });
      y -= 4;
    }
    // Detalle de straps por arista (cantidad de cintas + espaciado) — solo plano de taller.
    if (!limpio && datos.strapsAristas && datos.strapsAristas.length) {
      txt("Straps por arista:", M, y, { f: bold }); y -= 13;
      datos.strapsAristas.forEach((ln) => { txt("- " + ln, M + 6, y, { size: 9.5, color: BLACK() }); y -= 12; });
      y -= 4;
    }
    let detalleBottom;
    if (limpio) {
      detalleBottom = y - 8;
    } else {
      txt("Observaciones: ", M, y, { f: bold });
      let oy = y - 14;
      const obs = (datos.observaciones && datos.observaciones.length) ? datos.observaciones : ["Sin observaciones."];
      obs.forEach((par) => {
        wrap("- " + par, font, 9.5, W - 2 * M).forEach((ln, i) => { txt(i === 0 ? ln : "  " + ln, M, oy, { size: 9.5, color: BLACK() }); oy -= 12; });
      });
      detalleBottom = oy - 8;
    }

    // Lista de materiales (abajo) — se omite en modo de aprobación.
    const bottomM = 52;
    let matBlockH = 0;
    if (!limpio) {
      const mats = datos.materiales || [];
      const matLineH = 12.5;
      matBlockH = 18 + Math.max(1, mats.length) * matLineH + 4;
      let my = bottomM + matBlockH - 12;
      txt("Ojetillos & Materiales (resumen por unidad):", M, my, { f: bold, size: 11 }); my -= 16;
      if (mats.length) mats.forEach((m) => { txt("- " + m.nombre + ": " + m.cant, M, my, { size: 10, color: BLACK() }); my -= matLineH; });
      else txt("- Sin materiales adicionales.", M, my, { size: 10, color: BLACK() });
      const notaCotas = "Cotas en metros.";
      txt(notaCotas, W - M - font.widthOfTextAtSize(notaCotas, 8), bottomM + matBlockH + 4, { size: 8, color: PDFLib.rgb(0.82, 0.23, 0.18) });
    }

    // Sketch entre el detalle y la lista de materiales. Si el texto (observaciones largas, pasos
    // del volumétrico, ojetillos por arista) dejó POCO alto, el dibujo pasa COMPLETO a una página
    // nueva con toda la altura — nunca se achica a estampilla. El volumétrico exige más alto
    // porque dibuja dos paneles (representación 3D + hoja desplegada).
    const boxTop = detalleBottom, boxBottom = bottomM + matBlockH + 16;
    const esVol = !!(datos.sketch && datos.sketch.volumetrico && (parseFloat(datos.sketch.volumetrico.alto) || 0) > 0);
    const minAltoPlano = esVol ? 460 : 340;
    let pgSk = page, skTop = boxTop, skBottom = boxBottom;
    if (boxTop - boxBottom < minAltoPlano) {
      pgSk = doc.addPage([W, H]);
      let ys = dibujarEncabezado(pgSk, cibsa, null, W, M, H - 40);
      tituloCentrado(pgSk, "PLANO DEL PRODUCTO", W, ys, bold, 13, BLUE()); ys -= 16;
      if (datos.titulo) { pgSk.drawText(san('"' + datos.titulo + '"'), { x: M, y: ys, size: 12, font: bold, color: BLUE() }); ys -= 18; }
      skTop = ys; skBottom = 52;
    }
    dibujarSketchPDF(pgSk, datos.sketch, { x: M, top: skTop, w: W - 2 * M, h: skTop - skBottom }, font, { cotas: !limpio });

    // Página ADICIONAL con la vista 3D elegida en el visor (complementa el plano, no lo sustituye).
    if (datos.vista3D && datos.sketch && datos.sketch.volumetrico) {
      try {
        const img3d = await doc.embedPng(b64ToBytes(datos.vista3D));
        const p3 = doc.addPage([W, H]);
        let y3 = dibujarEncabezado(p3, cibsa, null, W, M, H - 40);
        tituloCentrado(p3, "VISTA 3D ELEGIDA", W, y3, bold, 15, BLUE()); y3 -= 15;
        tituloCentrado(p3, "Representación referencial del producto (vista seleccionada en el visor 3D).", W, y3, font, 9, BLUE()); y3 -= 18;
        if (datos.titulo) { p3.drawText(san('"' + datos.titulo + '"'), { x: M, y: y3, size: 12, font: bold, color: BLUE() }); y3 -= 20; }
        const availW = W - 2 * M, availH3 = y3 - 60;
        const esc = Math.min(availW / img3d.width, availH3 / img3d.height);
        const iw = img3d.width * esc, ih = img3d.height * esc;
        p3.drawImage(img3d, { x: (W - iw) / 2, y: y3 - ih, width: iw, height: ih });
      } catch (e) { /* si la imagen falla, el plano queda igual que siempre */ }
    }

    // Página de vista trasera (espejo + diseño trasero $0), si corresponde.
    if (datos.trasera && datos.sketch) {
      const p2 = doc.addPage([W, H]);
      let yb = dibujarEncabezado(p2, cibsa, null, W, M, H - 40);
      tituloCentrado(p2, "VISTA TRASERA (espejo)", W, yb, bold, 15, BLUE()); yb -= 15;
      tituloCentrado(p2, "Diseño trasero referencial de taller · costo $0 (no afecta la cotización).", W, yb, font, 9, BLUE()); yb -= 18;
      if (datos.titulo) { p2.drawText(san('"' + datos.titulo + '"'), { x: M, y: yb, size: 12, font: bold, color: BLUE() }); yb -= 20; }
      const matT = datos.materialesTrasera || [];
      const matLineH = 12.5, bottomM = 52;
      const matBlockH = matT.length ? (18 + matT.length * matLineH + 4) : 0;
      if (matT.length) {
        let my = bottomM + matBlockH - 12;
        p2.drawText("Materiales de la vista trasera (taller, $0):", { x: M, y: my, size: 11, font: bold, color: BLUE() }); my -= 16;
        matT.forEach((m) => { p2.drawText(san("- " + m.nombre + ": " + m.cant), { x: M, y: my, size: 10, font: font, color: BLACK() }); my -= matLineH; });
      }
      const espejoSpec = Object.assign({}, datos.sketch, { espejo: true, vista: "trasera", extraCortes: (datos.backExtra && datos.backExtra.cortes) || [], aletas: (datos.backExtra && datos.backExtra.aletas) || [] });
      dibujarSketchPDF(p2, espejoSpec, { x: M, top: yb, w: W - 2 * M, h: yb - (bottomM + matBlockH + 16) }, font, { cotas: true, soloDesplegado: true });
    }

    const bytes = await doc.save();
    const base = datos.filenameBase || "Plano";
    const etq = datos.etiquetaArchivo ? "_" + String(datos.etiquetaArchivo).replace(/\s+/g, "") : "";
    return { bytes, filename: base + etq + "_plano.pdf" };
  }

  // ---------- Plano de corte de taller ----------
  // Por cada pieza confeccionada (paño base + anexos): cómo se corta del rollo (tiras de ancho de
  // rollo × largo de tira, uniones, metros lineales del lote) + un esquema simple del corte.
  async function generarPlanoCorte(datos) {
    const { PDFDocument, StandardFonts, rgb } = PDFLib;
    const doc = await PDFDocument.create();
    const { font, bold } = await embedFonts(doc);
    const cibsa = await doc.embedPng(b64ToBytes(LOGOS.cibsa));
    const W = 612, H = 792, M = 50;
    const f = (n) => (Math.round((+n) * 1000) / 1000).toString().replace(".", ",");
    const gris = rgb(0.42, 0.42, 0.42), verde = rgb(0.06, 0.43, 0.34);
    let page = doc.addPage([W, H]);
    let y = dibujarEncabezado(page, cibsa, null, W, M, H - 40);
    tituloCentrado(page, "PLANO DE CORTE (TALLER)", W, y, bold, 15, BLUE()); y -= 15;
    tituloCentrado(page, "Layout de corte sobre el rollo · uso interno de taller", W, y, font, 9, BLUE()); y -= 14;
    y = stampCorrelativo(page, datos, W, y, bold); y -= 6;
    if (datos.titulo) { page.drawText(san('"' + datos.titulo + '"'), { x: M, y: y, size: 12, font: bold, color: BLUE() }); y -= 18; }
    const T = (s, x, yy, o) => page.drawText(san(s), { x: x, y: yy, size: (o && o.size) || 11, font: (o && o.f) || font, color: (o && o.color) || BLACK() });

    (datos.piezas || []).forEach((p) => {
      if (y < 175) { page = doc.addPage([W, H]); y = dibujarEncabezado(page, cibsa, null, W, M, H - 40) - 8; }
      T(p.nombre + " — " + p.tela, M, y, { f: bold, size: 12, color: BLUE() }); y -= 15;
      T("Rollo (ancho): " + f(p.rollo) + " m   ·   Pieza: " + f(p.dimL) + " × " + f(p.dimA) + " m   ·   " + p.N + " u", M, y, { size: 10 }); y -= 13;
      T(p.panosUnit + " tira(s)/u de " + f(p.rollo) + " × " + f(p.panoLen) + " m   ·   " + p.uniones + " unión(es)   ·   lote: " + f(p.linealLote) + " m lineales (" + f(p.m2Lote) + " m²)", M, y, { size: 10 }); y -= 16;
      const maxW = W - 2 * M - 40, maxH = 88;
      const across = (p.across > 0) ? p.across : (p.panosUnit * p.rollo), len = (p.panoLen > 0) ? p.panoLen : 1;
      const sc = Math.min(maxW / across, maxH / len);
      const wpx = across * sc, hpx = len * sc, x0 = M, yTop = y;
      page.drawRectangle({ x: x0, y: yTop - hpx, width: wpx, height: hpx, borderColor: BLACK(), borderWidth: 1, color: rgb(0.94, 0.97, 0.95) });
      for (let i = 1; i < p.panosUnit; i++) {
        const xx = x0 + Math.min(across, i * p.rollo) * sc;
        page.drawLine({ start: { x: xx, y: yTop }, end: { x: xx, y: yTop - hpx }, color: verde, thickness: 1 });
      }
      T(f(across) + " m", x0, yTop + 3, { size: 8, color: gris });
      T(f(len) + " m", x0 + wpx + 4, yTop - hpx / 2, { size: 8, color: gris });
      T("(tiras = ancho de rollo · línea verde = unión)", x0, yTop - hpx - 11, { size: 8, color: gris });
      y = yTop - hpx - 26;
    });

    const bytes = await doc.save();
    const base = datos.filenameBase || "Plano";
    return { bytes, filename: base + "_corte_taller.pdf" };
  }

  global.PDFCotizacion = {
    generarCotizacion, generarCotizacionCombinada, generarPreliminar, generarCotizacionCompuesta, generarCotizacionCompuestaCombinada, generarSketchPDF,
    generarPlanoCorte,
    nombreArchivo, nombreArchivoPreliminar, money,
  };
})(typeof window !== "undefined" ? window : globalThis);
