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

    // Filas de ítems
    function itemRow(cantidad, detail, vu, vt) {
      const lines = [];
      detail.forEach(([s, b]) => wrap(s, b ? bold : font, 10.5, colW[1] - 2 * pad)
        .forEach((ln) => lines.push([ln, b])));
      const h = rowHeight(lines);
      const cy = y - 14;
      // cantidad centrada
      txt(page, String(cantidad), cols[0] + (colW[0] - font.widthOfTextAtSize(String(cantidad), 11)) / 2, cy, { color: BLACK() });
      // detalle multilínea
      let dy = y - 13;
      lines.forEach(([ln, b]) => { txt(page, ln, cols[1] + pad, dy, { f: b ? bold : font, size: 10.5, color: BLACK() }); dy -= 12; });
      // valores centrados
      txt(page, vu, cols[2] + (colW[2] - font.widthOfTextAtSize(vu, 11)) / 2, cy, { color: BLACK() });
      txt(page, vt, cols[3] + (colW[3] - bold.widthOfTextAtSize(vt, 11)) / 2, cy, { f: bold, color: BLACK() });
      y -= h; hline(y);
    }

    const detTela = [[datos.tela.nombre, true]].concat((datos.tela.ficha || []).map((s) => [s, false]));
    itemRow(String(c.cantidad), detTela, money(c.material), money(c.materialTotal));
    const ojBase = datos.ojetillosDetalle || `${c.nOjetillos} ojetillos en total.`;
    const ojTxt = ojBase + (c.cantidad > 1 ? ` (por unidad; ${c.cantidad} unidades).` : "");
    itemRow(String(c.nOjetillosTotal), [["Ojetillos", true], [ojTxt, false]],
      `${money(c.valorOjetillo)} c/u`, money(c.ojetillosValorTotal));

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
    [CFG.VENDEDOR.nombre, CFG.VENDEDOR.fono, e.casa_matriz].forEach((l) => { t2(l, M, y2, { size: 11, color: BLACK() }); y2 -= 14; });

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

    // El documento preliminar es de una sola página: no incluye la página de
    // Condiciones Generales ni datos de empresa (no son necesarios para un estimado).

    const bytes = await doc.save();
    return { bytes, filename: nombreArchivoPreliminar(datos) + ".pdf" };
  }

  global.PDFCotizacion = { generarCotizacion, generarPreliminar, nombreArchivo, nombreArchivoPreliminar, money };
})(typeof window !== "undefined" ? window : globalThis);
