/* Parser de DTE (factura electrónica chilena, SII) para la carga de costos.
   Normaliza el XML a una estructura común, tolerante a las variaciones reales entre proveedores:
   - Unidades libres ("1", "ROLL", "ROL", "MT").
   - Tres mecánicas de descuento de línea: ninguna, DescuentoPct/DescuentoMonto, y SubDscto anidados.
   - Descuentos/recargos globales (DscRcgGlobal).
   No "decide" el costo: entrega el contexto crudo + sugerencias para que el usuario fije el costo efectivo.

   Uso (navegador): const dte = window.DTECIBSA.parseDTE(xmlString);
   Devuelve { ok, error, tipoDTE, folio, fecha, emisor, receptor, formaPago, items[], dsctosGlobales[], totales }. */
(function (global) {
  "use strict";

  function getParser() {
    if (typeof DOMParser !== "undefined") return new DOMParser();
    throw new Error("DOMParser no disponible en este entorno.");
  }

  // Texto del primer descendiente con ese nombre local (ignora prefijos de namespace).
  function txt(el, tag) {
    if (!el) return "";
    const n = el.getElementsByTagName(tag);
    return (n && n.length) ? (n[0].textContent || "").trim() : "";
  }
  // Igual pero buscando varios nombres alternativos (p. ej. GiroEmis / GiroEmisor).
  function txtAny(el, tags) {
    for (const t of tags) { const v = txt(el, t); if (v) return v; }
    return "";
  }
  function first(el, tag) { const n = el ? el.getElementsByTagName(tag) : null; return (n && n.length) ? n[0] : null; }

  // Número tolerante: "6008.000000" → 6008; "1.234,56" (cl) → 1234.56; "" → null.
  function num(s) {
    if (s == null) return null;
    let t = String(s).trim();
    if (t === "") return null;
    if (t.indexOf(",") !== -1 && t.indexOf(".") !== -1) t = t.replace(/\./g, "").replace(",", ".");
    else if (t.indexOf(",") !== -1) t = t.replace(",", ".");
    const v = parseFloat(t);
    return isNaN(v) ? null : v;
  }
  function round(v) { return Math.round((v + Number.EPSILON)); }

  function parseItem(det) {
    const cod = first(det, "CdgItem");
    const tpoCodigo = cod ? txt(cod, "TpoCodigo") : "";
    const vlrCodigo = cod ? txt(cod, "VlrCodigo") : "";
    const qty = num(txt(det, "QtyItem"));
    const precio = num(txt(det, "PrcItem"));
    const montoItem = num(txt(det, "MontoItem"));

    // Descuento/recargo de línea (mecánica A: DescuentoPct/DescuentoMonto, RecargoPct/RecargoMonto).
    const descPct = num(txt(det, "DescuentoPct"));
    const descMonto = num(txt(det, "DescuentoMonto"));
    const recPct = num(txt(det, "RecargoPct"));
    const recMonto = num(txt(det, "RecargoMonto"));

    // Mecánica B: SubDscto / SubRecargo anidados (varios), cada uno {tipo '%'|'$', valor}.
    const subs = [];
    ["SubDscto", "SubRecargo"].forEach((tag) => {
      const list = det.getElementsByTagName(tag);
      for (let i = 0; i < list.length; i++) {
        const tipo = txt(list[i], "TipoDscto") || txt(list[i], "TipoRecargo");
        const valor = num(txt(list[i], "ValorDscto") || txt(list[i], "ValorRecargo"));
        if (valor != null) subs.push({ clase: tag === "SubRecargo" ? "recargo" : "descuento", tipo: (tipo || "").trim(), valor: valor });
      }
    });

    const bruto = (qty != null && precio != null) ? round(qty * precio) : null;
    // Neto que declara la propia factura para la línea (puede NO coincidir con bruto−descuentos):
    const netoLinea = (montoItem != null) ? montoItem : bruto;
    const precioUnitNeto = (netoLinea != null && qty) ? netoLinea / qty : precio;

    return {
      nro: num(txt(det, "NroLinDet")),
      tpoCodigo: tpoCodigo,
      codigo: vlrCodigo || tpoCodigo,         // el código "real" vive en VlrCodigo
      nombre: txt(det, "NmbItem"),
      descripcion: txt(det, "DscItem"),
      qty: qty,
      unidadProveedor: txt(det, "UnmdItem"),  // libre: "1", "ROLL", "ROL", "MT"…
      precioLista: precio,
      descPct: descPct, descMonto: descMonto, recPct: recPct, recMonto: recMonto,
      subDsctos: subs,
      montoItem: montoItem,
      // Derivados (solo sugerencias; el usuario fija el costo efectivo):
      montoBruto: bruto,
      netoLinea: netoLinea,
      costoUnitSugerido: (precioUnitNeto != null) ? Math.round((precioUnitNeto + Number.EPSILON) * 100) / 100 : null,
    };
  }

  function parseDTE(xmlString) {
    let doc;
    try { doc = getParser().parseFromString(String(xmlString), "text/xml"); }
    catch (e) { return { ok: false, error: "No se pudo leer el XML: " + (e && e.message ? e.message : e) }; }
    if (!doc || doc.getElementsByTagName("parsererror").length) return { ok: false, error: "El archivo no es un XML válido." };

    const documento = first(doc, "Documento") || first(doc, "Liquidacion") || doc.documentElement;
    if (!documento) return { ok: false, error: "No se encontró el documento DTE." };
    const enc = first(documento, "Encabezado");
    const idDoc = enc ? first(enc, "IdDoc") : null;
    const emisorEl = enc ? first(enc, "Emisor") : null;
    const recepEl = enc ? first(enc, "Receptor") : null;
    const totEl = enc ? first(enc, "Totales") : null;

    const items = [];
    const dets = documento.getElementsByTagName("Detalle");
    for (let i = 0; i < dets.length; i++) items.push(parseItem(dets[i]));

    // Descuentos / recargos globales del documento.
    const globales = [];
    const dgs = documento.getElementsByTagName("DscRcgGlobal");
    for (let i = 0; i < dgs.length; i++) {
      globales.push({
        nro: num(txt(dgs[i], "NroLinDR")),
        movimiento: txt(dgs[i], "TpoMov"),            // D = descuento, R = recargo
        tipo: txt(dgs[i], "TpoValor"),                // % o $
        valor: num(txt(dgs[i], "ValorDR")),
        glosa: txt(dgs[i], "GlosaDR"),
      });
    }

    return {
      ok: true,
      tipoDTE: idDoc ? txt(idDoc, "TipoDTE") : "",
      folio: idDoc ? txt(idDoc, "Folio") : "",
      fecha: idDoc ? txt(idDoc, "FchEmis") : "",
      formaPago: idDoc ? txt(idDoc, "FmaPago") : "",
      emisor: {
        rut: emisorEl ? txt(emisorEl, "RUTEmisor") : "",
        razon: emisorEl ? txtAny(emisorEl, ["RznSoc", "RznSocEmisor"]) : "",
        giro: emisorEl ? txtAny(emisorEl, ["GiroEmis", "GiroEmisor"]) : "",
      },
      receptor: {
        rut: recepEl ? txt(recepEl, "RUTRecep") : "",
        razon: recepEl ? txt(recepEl, "RznSocRecep") : "",
      },
      items: items,
      dsctosGlobales: globales,
      totales: {
        neto: totEl ? num(txt(totEl, "MntNeto")) : null,
        exento: totEl ? num(txt(totEl, "MntExe")) : null,
        iva: totEl ? num(txt(totEl, "IVA")) : null,
        total: totEl ? num(txt(totEl, "MntTotal")) : null,
      },
    };
  }

  const API = { parseDTE: parseDTE };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  global.DTECIBSA = API;
})(typeof window !== "undefined" ? window : globalThis);
