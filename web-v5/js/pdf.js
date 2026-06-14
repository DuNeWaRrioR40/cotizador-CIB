/* Generación de la cotización CIBSA en PDF dentro del navegador, con pdf-lib.
   Replica el formato corporativo de 2 páginas y la convención de nombre de archivo. */
(function (global) {
  const CFG = global.CONFIG;
  const LOGOS = global.LOGOS;

  const BLUE = () => PDFLib.rgb(0.18, 0.325, 0.549);     // #2E538C
  const HEADERBLUE = () => PDFLib.rgb(0.357, 0.482, 0.706); // #5B7BB4
  const WHITE = () => PDFLib.rgb(1, 1, 1);
  const BLACK = () => PDFLib.rgb(0.1, 0.1, 0.1);
  const YELLOW = () => PDFLib.rgb(1, 0.94, 0.30);
  const TOTALFILL = () => PDFLib.rgb(0.863, 0.902, 0.945); // #DCE6F1

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

  function b64ToBytes(dataURL) {
    const b64 = dataURL.split(",")[1];
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  }

  function nombreArchivo(datos) {
    const c = datos.cliente;
    const inicial = c.nombre.trim().charAt(0).toUpperCase();
    let ap = c.apellido.trim();
    ap = (ap.charAt(0).toUpperCase() + ap.slice(1)).replace(/\s+/g, "");
    const f = datos.fecha;
    const dd = String(f.getDate()).padStart(2, "0");
    const mm = String(f.getMonth() + 1).padStart(2, "0");
    return `C.${inicial}${ap}${datos.version}_${dd}${mm}${f.getFullYear()}`;
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
  function dibujarEncabezado(page, cibsa, kam, W, M, yTop) {
    const cW = 130, cH = cW * (cibsa.height / cibsa.width);
    page.drawImage(cibsa, { x: M, y: yTop - cH + 14, width: cW, height: cH });
    const kW = 64, kH = kW * (kam.height / kam.width);
    page.drawImage(kam, { x: W - M - kW, y: yTop - kH + 6, width: kW, height: kH });
    return yTop - 60;
  }
  function tituloCentrado(page, s, W, y, f, size, color) {
    const w = f.widthOfTextAtSize(san(s), size);
    page.drawText(san(s), { x: (W - w) / 2, y: y, size: size, font: f, color: color });
  }

  // Dibuja el sketch del producto (contorno, ojetillos, ventanas) a escala dentro de
  // una caja { x, top, w, h } (top = borde superior en coordenadas PDF).
  function dibujarSketchPDF(page, spec, box, font, opts) {
    opts = opts || {};
    if (!spec || !global.SketchCIBSA) return;
    const SK = global.SketchCIBSA;
    const sk = SK.construirSketch(spec);
    if (!(sk.ancho > 0) || !(sk.largo > 0)) return;
    const conCotas = opts.cotas !== false;
    const mTL = conCotas ? SK.margenCotas(sk) : 24, mBR = 18;
    const availW = box.w - mTL - mBR, availH = box.h - mTL - mBR;
    if (availW <= 0 || availH <= 0) return;
    const scale = Math.min(availW / sk.ancho, availH / sk.largo);
    const wpx = sk.ancho * scale, hpx = sk.largo * scale;
    const totalW = wpx + mTL + mBR, totalH = hpx + mTL + mBR;
    const x0 = box.x + (box.w - totalW) / 2 + mTL;
    const topRect = box.top - (box.h - totalH) / 2 - mTL;
    const px = (sx) => x0 + sx * scale;
    const py = (sy) => topRect - sy * scale;
    const GRAY = PDFLib.rgb(0.12, 0.12, 0.12);
    const ACC = BLUE();
    const RED = PDFLib.rgb(0.82, 0.23, 0.18);
    const TICK = 3, EXTGAP = 3;
    // Ventanas (rectangulares o circulares)
    sk.ventanas.forEach((v) => {
      if (v.circ) {
        page.drawEllipse({ x: px(v.x + v.w / 2), y: py(v.y + v.h / 2), xScale: Math.min(v.w, v.h) / 2 * scale, yScale: Math.min(v.w, v.h) / 2 * scale, borderColor: ACC, borderWidth: 0.9, borderDashArray: [3, 2] });
      } else {
        page.drawRectangle({ x: px(v.x), y: py(v.y + v.h), width: v.w * scale, height: v.h * scale, borderColor: ACC, borderWidth: 0.9, borderDashArray: [3, 2] });
      }
    });
    // Contorno
    page.drawRectangle({ x: x0, y: topRect - hpx, width: wpx, height: hpx, borderColor: GRAY, borderWidth: 1.3 });
    // Bolsillos (banda con doblez + costura + Ø)
    const TEAL = PDFLib.rgb(0.12, 0.62, 0.54);
    const bandW = Math.max(8, Math.min(18, Math.min(wpx, hpx) * 0.12)), stitch = 3;
    (sk.bolsillos || []).forEach((bo) => {
      const horiz = (bo.arista === "sup" || bo.arista === "inf");
      // En coords PDF: top del paño = topRect (y mayor), base = topRect - hpx.
      let rx, ry, rw, rh; // rect (esquina inferior-izq para drawRectangle)
      if (bo.arista === "sup") { rx = x0; ry = topRect - bandW; rw = wpx; rh = bandW; }
      else if (bo.arista === "inf") { rx = x0; ry = topRect - hpx; rw = wpx; rh = bandW; }
      else if (bo.arista === "izq") { rx = x0; ry = topRect - hpx; rw = bandW; rh = hpx; }
      else { rx = x0 + wpx - bandW; ry = topRect - hpx; rw = bandW; rh = hpx; }
      page.drawRectangle({ x: rx, y: ry, width: rw, height: rh, borderColor: TEAL, borderWidth: 0.8, color: TEAL, opacity: 0.12, borderOpacity: 1 });
      // línea de doblez (lado interior de la banda)
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
      const lbl = "Bolsillo " + String.fromCharCode(216) + SK.fmt(bo.diam) + "m";
      const cxp = rx + rw / 2, cyp = ry + rh / 2;
      if (horiz) page.drawText(lbl, { x: cxp - font.widthOfTextAtSize(lbl, 7) / 2, y: cyp - 2.5, size: 7, font: font, color: TEAL });
      else page.drawText(lbl, { x: cxp - 2.5, y: cyp - font.widthOfTextAtSize(lbl, 7) / 2, size: 7, font: font, color: TEAL, rotate: PDFLib.degrees(90) });
    });
    // Ojetillos = anillo + círculo concéntrico menor (borde fino), hacia adentro del paño.
    const r = Math.max(1.4, Math.min(2.6, scale * 0.022));
    const ojePDF = (cx, cy, col) => {
      page.drawCircle({ x: cx, y: cy, size: r, borderColor: col, borderWidth: 0.6, color: WHITE() });
      page.drawCircle({ x: cx, y: cy, size: r * 0.42, borderColor: col, borderWidth: 0.5 });
    };
    const insetOj = r + 1;
    sk.ojetillos.forEach((p) => {
      let cx = px(p.x), cy = py(p.y);
      if (p.x <= 0.001) cx += insetOj; else if (p.x >= sk.ancho - 0.001) cx -= insetOj;
      if (p.y <= 0.001) cy += insetOj; else if (p.y >= sk.largo - 0.001) cy -= insetOj;
      ojePDF(cx, cy, ACC);
    });
    // Cortes / calados: líneas de corte (lados existentes) + tijeras + ojetillos del corte
    const PURPLE = PDFLib.rgb(0.557, 0.267, 0.678);
    const tijeraPDF = (tx, ty) => {
      const tp = SK.tijeraPrims(tx, ty, 8);
      tp.circles.forEach((cc) => page.drawCircle({ x: cc.x, y: cc.y, size: cc.r, borderColor: PURPLE, borderWidth: 0.5 }));
      tp.lines.forEach((ln) => page.drawLine({ start: { x: ln.x1, y: ln.y1 }, end: { x: ln.x2, y: ln.y2 }, thickness: 0.5, color: PURPLE }));
    };
    (sk.cortes || []).forEach((c) => {
      (c.hatch || []).forEach((sg) => {
        page.drawLine({ start: { x: px(sg.a.x), y: py(sg.a.y) }, end: { x: px(sg.b.x), y: py(sg.b.y) }, thickness: 0.35, color: PURPLE, opacity: 0.32 });
      });
      (c.segments || []).forEach((sg) => {
        const a = px(sg.a.x), b = py(sg.a.y), d = px(sg.b.x), e = py(sg.b.y);
        page.drawLine({ start: { x: a, y: b }, end: { x: d, y: e }, thickness: 1, color: PURPLE, dashArray: [5, 3] });
        if (!c.tijeras) SK.tijerasEn(a, b, d, e).forEach((t) => tijeraPDF(t.x, t.y));
      });
      if (c.tijeras) c.tijeras.forEach((t) => tijeraPDF(px(t.x), py(t.y)));
      (c.ojetillos || []).forEach((p) => ojePDF(px(p.x), py(p.y), PURPLE));
      if (c.rotated && c.pivote) {
        const cx = px(c.pivote.x), cy = py(c.pivote.y);
        page.drawCircle({ x: cx, y: cy, size: 2.6, borderColor: PURPLE, borderWidth: 0.7 });
        page.drawLine({ start: { x: cx - 5, y: cy }, end: { x: cx + 5, y: cy }, thickness: 0.6, color: PURPLE });
        page.drawLine({ start: { x: cx, y: cy - 5 }, end: { x: cx, y: cy + 5 }, thickness: 0.6, color: PURPLE });
      }
      if (c.rotated && c.segments && c.segments.length) {
        const sg = c.segments[0], mx = px((sg.a.x + sg.b.x) / 2), my = py((sg.a.y + sg.b.y) / 2);
        page.drawText(SK.fmt(c.angulo) + "°", { x: mx + 4, y: my + 3, size: 8, font: font, color: PURPLE });
      }
    });
    // Cotas (rojo): mayor = paño base; menor = padding / ventanas
    if (conCotas) {
      const ln = (x1, y1, x2, y2, w) => page.drawLine({ start: { x: x1, y: y1 }, end: { x: x2, y: y2 }, thickness: w, color: RED });
      SK.cotasDe(sk).forEach((c) => {
        const off = SK.offsetCota(c);
        const lbl = SK.fmt(c.value) + "m";
        if (c.axis === "h") {
          const dimY = topRect + off, xa = px(c.a), xb = px(c.b);
          ln(xa, topRect, xa, dimY + EXTGAP, 0.4); ln(xb, topRect, xb, dimY + EXTGAP, 0.4);
          ln(xa, dimY, xb, dimY, 0.6);
          ln(xa, dimY - TICK, xa, dimY + TICK, 0.6); ln(xb, dimY - TICK, xb, dimY + TICK, 0.6);
          page.drawText(lbl, { x: (xa + xb) / 2 - font.widthOfTextAtSize(lbl, 7.5) / 2, y: dimY + 2, size: 7.5, font: font, color: RED });
        } else {
          const dimX = x0 - off, ya = py(c.a), yb = py(c.b);
          ln(x0, ya, dimX - EXTGAP, ya, 0.4); ln(x0, yb, dimX - EXTGAP, yb, 0.4);
          ln(dimX, ya, dimX, yb, 0.6);
          ln(dimX - TICK, ya, dimX + TICK, ya, 0.6); ln(dimX - TICK, yb, dimX + TICK, yb, 0.6);
          const my = (ya + yb) / 2;
          page.drawText(lbl, { x: dimX - 4, y: my - font.widthOfTextAtSize(lbl, 7.5) / 2, size: 7.5, font: font, color: RED, rotate: PDFLib.degrees(90) });
        }
      });
    }
  }

  async function generarCotizacion(datos) {
    const { PDFDocument, StandardFonts } = PDFLib;
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const bold = await doc.embedFont(StandardFonts.HelveticaBold);
    const cibsa = await doc.embedPng(b64ToBytes(LOGOS.cibsa));
    const kam = await doc.embedPng(b64ToBytes(LOGOS.kamanchaca));

    const W = 612, H = 792, M = 50;
    const page = doc.addPage([W, H]);
    let y = H - 40;

    const txt = (p, s, x, yy, { f = font, size = 11, color = BLUE() } = {}) =>
      p.drawText(san(s), { x, y: yy, size, font: f, color });

    // Encabezado: logos
    const cW = 130, cH = cW * (cibsa.height / cibsa.width);
    page.drawImage(cibsa, { x: M, y: y - cH + 14, width: cW, height: cH });
    const kW = 64, kH = kW * (kam.height / kam.width);
    page.drawImage(kam, { x: W - M - kW, y: y - kH + 6, width: kW, height: kH });
    y -= 60;

    const center = (s, size, f = bold) => {
      const w = f.widthOfTextAtSize(s, size);
      txt(page, s, (W - w) / 2, y, { f, size });
    };
    center("COTIZACIÓN FORMAL", 15); y -= 18;
    center("(válido por 15 días)", 11); y -= 26;

    const titulo = datos.titulo ||
      `Carpa rectangular ${(+datos.largo)}m x ${(+datos.ancho)}m`;
    txt(page, `"${titulo}"`, M, y, { f: bold, size: 15 }); y -= 24;

    txt(page, "Contacto: ", M, y, { f: bold });
    txt(page, `${datos.cliente.nombre} ${datos.cliente.apellido}.`,
      M + bold.widthOfTextAtSize("Contacto: ", 11), y); y -= 15;
    txt(page, "e-mail: ", M, y, { f: bold });
    txt(page, datos.cliente.email || "", M + bold.widthOfTextAtSize("e-mail: ", 11), y); y -= 22;

    txt(page, "PROPUESTA:", M, y, { f: bold }); y -= 15;
    const propuesta = datos.propuesta ||
      `Presupuesto en ${datos.tela.nombre} para carpa rectangular de ` +
      `${(+datos.largo)}m x ${(+datos.ancho)}m según diseño (incluye confección y refuerzos perimetrales).`;
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
        thickness: 0.5, color: PDFLib.rgb(0.6, 0.6, 0.6) });
    }
    function vlines(yTop, yBot) {
      [cols[0], cols[1], cols[2], cols[3], right].forEach((x) =>
        page.drawLine({ start: { x, y: yTop }, end: { x, y: yBot },
          thickness: 0.5, color: PDFLib.rgb(0.6, 0.6, 0.6) }));
    }

    // Cabecera
    const headH = 22;
    page.drawRectangle({ x: M, y: y - headH, width: right - M, height: headH, color: HEADERBLUE() });
    const headers = ["Cantidad", "Detalle", "Valor Unitario", "Valor Total Neto"];
    headers.forEach((h, i) => {
      const size = 10;
      let x = cols[i] + pad;
      if (i !== 1) { x = cols[i] + (colW[i] - bold.widthOfTextAtSize(h, size)) / 2; }
      txt(page, h, x, y - 15, { f: bold, size, color: WHITE() });
    });
    let yTop = y; y -= headH; hline(y);

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

    const detTela = [[datos.tela.nombre, true]].concat((datos.tela.ficha || []).map((s) => [s, false]));
    detTela.push(["", false, 0]);
    detTela.push(["Diseño aprobado", true, 11.5]);
    (datos.detalleExtra || []).forEach((s) => detTela.push([s, false]));
    detTela.push(["Valores aproximados. La confección tiene un margen de error de aprox. ±4 cm.", false, 8.5]);
    itemRow(String(c.cantidad), detTela, money(c.material), money(c.materialTotal));
    const ojBase = datos.ojetillosDetalle || `${c.nOjetillos} ojetillos en total.`;
    const ojTxt = ojBase + (c.cantidad > 1 ? ` (por unidad; ${c.cantidad} unidades).` : "");
    itemRow(String(c.nOjetillosTotal), [["Ojetillos", true], [ojTxt, false]],
      `${money(c.valorOjetillo)} c/u`, money(c.ojetillosValorTotal));
    // Complementos (insumos / accesorios / estructurales) — una fila por ítem
    (datos.complementos || []).forEach((cmp) => {
      itemRow(String(cmp.cantidad), [["Complemento", true], [cmp.detalle, false]],
        `${money(cmp.precio)} c/u`, money(cmp.totalNeto));
    });

    // Filas de totales
    function totalRow(label, value, fill) {
      const h = 20;
      if (fill) page.drawRectangle({ x: M, y: y - h, width: right - M, height: h, color: fill });
      txt(page, label, cols[3] - pad - bold.widthOfTextAtSize(label, 11), y - 14, { f: bold, color: BLACK() });
      txt(page, value, cols[3] + (colW[3] - bold.widthOfTextAtSize(value, 11)) / 2, y - 14, { f: bold, color: BLACK() });
      y -= h; hline(y);
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
    nota += c.descuentoPct > 0 ? ` y el ${c.descuentoPct}% de descuento por pago contado.` : ".";
    nota += " Productos sujetos a disponibilidad de stock.";
    const notaLines = wrap(nota, bold, 11, W - 2 * M - 8);
    page.drawRectangle({ x: M, y: y - notaLines.length * 13 - 4, width: right - M, height: notaLines.length * 13 + 6, color: YELLOW() });
    let ny = y - 12;
    notaLines.forEach((ln) => { txt(page, ln, M + 4, ny, { f: bold, color: BLACK() }); ny -= 13; });

    // Observaciones (si las hay)
    if (datos.observaciones) {
      let oy = ny - 18;
      txt(page, "OBSERVACIONES:", M, oy, { f: bold }); oy -= 14;
      String(datos.observaciones).split(/\r?\n/).forEach((par) => {
        wrap(par || " ", font, 10.5, W - 2 * M).forEach((ln) => { txt(page, ln, M, oy, { size: 10.5, color: BLACK() }); oy -= 13; });
      });
    }

    // --- Página de vista del producto (sketch a escala) ---
    if (datos.sketch && datos.sketch.ancho > 0 && datos.sketch.largo > 0) {
      const ps = doc.addPage([W, H]);
      let ysk = dibujarEncabezado(ps, cibsa, kam, W, M, H - 40);
      tituloCentrado(ps, "VISTA DEL PRODUCTO", W, ysk, bold, 15, BLUE()); ysk -= 18;
      tituloCentrado(ps, "(dibujo a escala · referencial)", W, ysk, font, 11, BLUE()); ysk -= 22;
      const tit = datos.titulo || `Carpa ${(+datos.largo)}m x ${(+datos.ancho)}m`;
      txt(ps, `"${tit}"`, M, ysk, { f: bold, size: 12 }); ysk -= 22;
      dibujarSketchPDF(ps, datos.sketch, { x: M, top: ysk, w: W - 2 * M, h: ysk - 70 }, font);
    }

    // --- Página 2 ---
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

    const bytes = await doc.save();
    return { bytes, filename: nombreArchivo(datos) + ".pdf" };
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
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const bold = await doc.embedFont(StandardFonts.HelveticaBold);
    const cibsa = await doc.embedPng(b64ToBytes(LOGOS.cibsa));
    const kam = await doc.embedPng(b64ToBytes(LOGOS.kamanchaca));

    const W = 612, H = 792, M = 50;
    const page = doc.addPage([W, H]);
    let y = H - 40;

    const txt = (p, s, x, yy, { f = font, size = 11, color = BLUE() } = {}) =>
      p.drawText(san(s), { x, y: yy, size, font: f, color });

    // Encabezado: logos
    const cW = 130, cH = cW * (cibsa.height / cibsa.width);
    page.drawImage(cibsa, { x: M, y: y - cH + 14, width: cW, height: cH });
    const kW = 64, kH = kW * (kam.height / kam.width);
    page.drawImage(kam, { x: W - M - kW, y: y - kH + 6, width: kW, height: kH });
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
        thickness: 0.5, color: PDFLib.rgb(0.6, 0.6, 0.6) });
    }
    function vlines(yTop, yBot) {
      [cols[0], cols[1], right].forEach((x) =>
        page.drawLine({ start: { x, y: yTop }, end: { x, y: yBot },
          thickness: 0.5, color: PDFLib.rgb(0.6, 0.6, 0.6) }));
    }

    // Cabecera
    const headH = 22;
    page.drawRectangle({ x: M, y: y - headH, width: right - M, height: headH, color: HEADERBLUE() });
    txt(page, "Detalle", cols[0] + pad, y - 15, { f: bold, size: 10, color: WHITE() });
    const h2lbl = "Valor Neto (1 unidad)";
    txt(page, h2lbl, cols[1] + (colW[1] - bold.widthOfTextAtSize(h2lbl, 9)) / 2, y - 15, { f: bold, size: 9, color: WHITE() });
    let yTop = y; y -= headH; hline(y);

    const oj = datos.ojetillosDetalle || "ojetillos según diseño";
    datos.items.forEach((item) => {
      const c = item.calc;
      const lines = [];
      [[item.tela.nombre, true]]
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
    page.drawRectangle({ x: M, y: y - notaLines.length * 13 - 4, width: right - M, height: notaLines.length * 13 + 6, color: YELLOW() });
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
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const bold = await doc.embedFont(StandardFonts.HelveticaBold);
    const cibsa = await doc.embedPng(b64ToBytes(LOGOS.cibsa));
    const kam = await doc.embedPng(b64ToBytes(LOGOS.kamanchaca));

    const W = 612, H = 792, M = 50;
    const GRAY = () => PDFLib.rgb(0.6, 0.6, 0.6);
    let page = doc.addPage([W, H]);
    let y = H - 40;

    const txt = (s, x, yy, { f = font, size = 11, color = BLUE() } = {}) =>
      page.drawText(san(s), { x, y: yy, size, font: f, color });

    // Encabezado: logos
    const cW = 130, cH = cW * (cibsa.height / cibsa.width);
    page.drawImage(cibsa, { x: M, y: y - cH + 14, width: cW, height: cH });
    const kW = 64, kH = kW * (kam.height / kam.width);
    page.drawImage(kam, { x: W - M - kW, y: y - kH + 6, width: kW, height: kH });
    y -= 60;

    const center = (s, size, f = bold) => { txt(s, (W - f.widthOfTextAtSize(s, size)) / 2, y, { f, size }); };
    center("COTIZACIÓN FORMAL", 15); y -= 18;
    center("(válido por 15 días)", 11); y -= 26;

    const titulo = datos.titulo || "Producto compuesto según detalle";
    txt(`"${titulo}"`, M, y, { f: bold, size: 15 }); y -= 24;

    txt("Contacto: ", M, y, { f: bold });
    txt(`${datos.cliente.nombre} ${datos.cliente.apellido}.`, M + bold.widthOfTextAtSize("Contacto: ", 11), y); y -= 15;
    txt("e-mail: ", M, y, { f: bold });
    txt(datos.cliente.email || "", M + bold.widthOfTextAtSize("e-mail: ", 11), y); y -= 22;

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
        txt(h, x, y - 15, { f: bold, size, color: WHITE() });
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
      const detail = [[etq || pz.tela.nombre, true]];
      if (etq) detail.push([pz.tela.nombre, false]);
      (pz.tela.ficha || []).forEach((s) => detail.push([s, false]));
      detail.push(["", false, 0]);
      detail.push(["Diseño aprobado", true, 11.5]);
      detail.push([`Formato ${pz.largo}×${pz.ancho} m · ${pz.ojetillosTxt || (pz.ojetillos + " ojetillos c/u")} · ${orientTxt}`, false]);
      (pz.terminaciones || []).forEach((s) => detail.push([s, false]));
      (pz.inscritosLineas || []).forEach((s) => detail.push([s, false]));
      (pz.complementosLineas || []).forEach((s) => detail.push([s, false]));
      detail.push(["Valores aproximados. La confección tiene un margen de error de aprox. ±4 cm.", false, 8.5]);
      itemRow(String(pz.cantidad), detail, money(pz.valorUnitario), money(pz.valorTotal));
    });

    // Totales
    const subtotal = datos.piezas.reduce((s, p) => s + p.valorTotal, 0);
    const descPct = datos.descuentoPct || 0;
    const descuento = Math.round(subtotal * descPct / 100);
    const neto = subtotal - descuento;
    const iva = Math.round(neto * CFG.IVA_PCT / 100);
    const total = neto + iva;

    function totalRow(label, value, fill) {
      const h = 20;
      asegurar(h);
      const top = y;
      if (fill) page.drawRectangle({ x: M, y: y - h, width: right - M, height: h, color: fill });
      txt(label, cols[3] - pad - bold.widthOfTextAtSize(label, 11), y - 14, { f: bold, color: BLACK() });
      txt(value, cols[3] + (colW[3] - bold.widthOfTextAtSize(value, 11)) / 2, y - 14, { f: bold, color: BLACK() });
      y -= h; hline(y); vsegs(top, y);
    }
    totalRow("Subtotal Neto", money(subtotal));
    if (descPct > 0) {
      totalRow(datos.descuentoLabel || `Descuento ${descPct}% (pago contado)`, "-" + money(descuento));
      totalRow("Neto con Descuento", money(neto));
    }
    totalRow(`IVA (${CFG.IVA_PCT}%)`, money(iva));
    totalRow("TOTAL", money(total), TOTALFILL());
    y -= 16;

    // Nota amarilla
    let nota = `NOTA: Valores netos. El TOTAL indicado ya incluye IVA (${CFG.IVA_PCT}%)`;
    nota += descPct > 0 ? ` y el ${descPct}% de descuento por pago contado.` : ".";
    nota += " Productos sujetos a disponibilidad de stock.";
    const notaLines = wrap(nota, bold, 11, W - 2 * M - 8);
    asegurar(notaLines.length * 13 + 10);
    page.drawRectangle({ x: M, y: y - notaLines.length * 13 - 4, width: right - M, height: notaLines.length * 13 + 6, color: YELLOW() });
    let ny = y - 12;
    notaLines.forEach((ln) => { txt(ln, M + 4, ny, { f: bold, color: BLACK() }); ny -= 13; });

    // Observaciones (si las hay), con salto de página si no caben
    if (datos.observaciones) {
      const obsParr = String(datos.observaciones).split(/\r?\n/);
      const obsLines = [];
      obsParr.forEach((par) => wrap(par || " ", font, 10.5, W - 2 * M).forEach((ln) => obsLines.push(ln)));
      let oy = ny - 18;
      if (oy - (obsLines.length * 13 + 16) < 60) { nuevaPagina(false); oy = y - 12; }
      txt("OBSERVACIONES:", M, oy, { f: bold }); oy -= 14;
      obsLines.forEach((ln) => { txt(ln, M, oy, { size: 10.5, color: BLACK() }); oy -= 13; });
    }

    // --- Páginas de vista de las piezas (sketch a escala, 2 por hoja) ---
    const pzsSk = (datos.piezas || []).filter((p) => p.sketch && p.sketch.ancho > 0 && p.sketch.largo > 0);
    if (pzsSk.length) {
      const perPage = 2;
      let ps = null, topZona = 0, bloqueH = 0;
      pzsSk.forEach((p, i) => {
        const slot = i % perPage;
        if (slot === 0) {
          ps = doc.addPage([W, H]);
          let yh = dibujarEncabezado(ps, cibsa, kam, W, M, H - 40);
          tituloCentrado(ps, "VISTA DE LAS PIEZAS", W, yh, bold, 15, BLUE()); yh -= 18;
          tituloCentrado(ps, "(dibujos a escala · referencial)", W, yh, font, 11, BLUE()); yh -= 18;
          topZona = yh;
          bloqueH = (topZona - 55) / perPage;
        }
        const bTop = topZona - slot * bloqueH;
        const etq = (p.etiqueta && p.etiqueta.trim()) ? p.etiqueta.trim() : ("Pieza " + (i + 1));
        ps.drawText(san(etq + "  —  " + p.largo + " x " + p.ancho + " m"), { x: M, y: bTop - 4, size: 11, font: bold, color: BLUE() });
        dibujarSketchPDF(ps, p.sketch, { x: M, top: bTop - 18, w: W - 2 * M, h: bloqueH - 30 }, font);
      });
    }

    // --- Página final: condiciones + empresa + vendedor ---
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

    const bytes = await doc.save();
    return { bytes, filename: nombreArchivo(datos) + ".pdf" };
  }

  // ---------- Dibujo del producto (PDF descargable de 1 hoja) ----------
  // datos: { filenameBase, etiquetaArchivo, titulo, tela, color, largo, ancho, ojetillos,
  //          unidades, observaciones:[], materiales:[{nombre,cant}], sketch }
  async function generarSketchPDF(datos) {
    const { PDFDocument, StandardFonts } = PDFLib;
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const bold = await doc.embedFont(StandardFonts.HelveticaBold);
    const cibsa = await doc.embedPng(b64ToBytes(LOGOS.cibsa));
    const kam = await doc.embedPng(b64ToBytes(LOGOS.kamanchaca));
    const W = 612, H = 792, M = 50;
    const page = doc.addPage([W, H]);
    const txt = (s, x, y, o) => page.drawText(san(s), { x, y, size: (o && o.size) || 11, font: (o && o.f) || font, color: (o && o.color) || BLUE() });
    const fmtN = (n) => (Math.round((+n) * 1000) / 1000).toString();

    let y = dibujarEncabezado(page, cibsa, kam, W, M, H - 40);
    tituloCentrado(page, "DIBUJO DEL PRODUCTO", W, y, bold, 15, BLUE()); y -= 15;
    tituloCentrado(page, "(plano referencial para taller)", W, y, font, 10, BLUE()); y -= 22;
    if (datos.titulo) { txt(`"${datos.titulo}"`, M, y, { f: bold, size: 12 }); y -= 18; }

    // Bloque de detalle (arriba-izquierda)
    const color = (datos.color && String(datos.color).trim()) ? datos.color : "N/A";
    const campos = [
      ["Tipo de Tela", datos.tela || "N/A"],
      ["Color", color],
      ["Dimensiones", fmtN(datos.largo) + "m x " + fmtN(datos.ancho) + "m"],
      ["Ojetillos", String(datos.ojetillos || 0)],
      ["Cantidad de Unidades", String(datos.unidades || 1)],
    ];
    campos.forEach(([k, v]) => {
      txt(k + ": ", M, y, { f: bold });
      txt(v, M + bold.widthOfTextAtSize(k + ": ", 11), y, { color: BLACK() });
      y -= 15;
    });
    txt("Observaciones: ", M, y, { f: bold });
    let oy = y - 14;
    const obs = (datos.observaciones && datos.observaciones.length) ? datos.observaciones : ["Sin observaciones."];
    obs.forEach((par) => {
      wrap("- " + par, font, 9.5, W - 2 * M).forEach((ln, i) => { txt(i === 0 ? ln : "  " + ln, M, oy, { size: 9.5, color: BLACK() }); oy -= 12; });
    });
    const detalleBottom = oy - 8;

    // Lista de materiales (abajo)
    const mats = datos.materiales || [];
    const matLineH = 12.5, bottomM = 52;
    const matBlockH = 18 + Math.max(1, mats.length) * matLineH + 4;
    let my = bottomM + matBlockH - 12;
    txt("Ojetillos & Materiales (resumen por unidad):", M, my, { f: bold, size: 11 }); my -= 16;
    if (mats.length) mats.forEach((m) => { txt("- " + m.nombre + ": " + m.cant, M, my, { size: 10, color: BLACK() }); my -= matLineH; });
    else txt("- Sin materiales adicionales.", M, my, { size: 10, color: BLACK() });
    const notaCotas = "Cotas en metros.";
    txt(notaCotas, W - M - font.widthOfTextAtSize(notaCotas, 8), bottomM + matBlockH + 4, { size: 8, color: PDFLib.rgb(0.82, 0.23, 0.18) });

    // Sketch entre el detalle y la lista de materiales
    const boxTop = detalleBottom, boxBottom = bottomM + matBlockH + 16;
    dibujarSketchPDF(page, datos.sketch, { x: M, top: boxTop, w: W - 2 * M, h: boxTop - boxBottom }, font, { cotas: true });

    const bytes = await doc.save();
    const base = datos.filenameBase || "Dibujo";
    const etq = datos.etiquetaArchivo ? "_" + String(datos.etiquetaArchivo).replace(/\s+/g, "") : "";
    return { bytes, filename: base + etq + "_dibujo.pdf" };
  }

  global.PDFCotizacion = {
    generarCotizacion, generarPreliminar, generarCotizacionCompuesta, generarSketchPDF,
    nombreArchivo, nombreArchivoPreliminar, money,
  };
})(typeof window !== "undefined" ? window : globalThis);
