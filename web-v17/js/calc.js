/* Reglas de cálculo de la cotización CIBSA (puro, sin dependencias). */
(function (global) {
  const CFG = (typeof module !== "undefined" && module.exports)
    ? require("./config.js") : global.CONFIG;

  function money(n) {
    return "$" + Math.round(n).toLocaleString("es-CL");
  }

  // Evalúa una expresión aritmética básica (+ - * / y paréntesis) de forma segura,
  // aceptando coma o punto como decimal. Devuelve número o null. Permite usar los
  // campos como calculadora (ej. "240/100" -> 2.4).
  function evalExpr(raw) {
    if (raw == null) return null;
    let s = String(raw).trim();
    if (s === "") return null;
    s = s.replace(/,/g, ".").replace(/×/g, "*").replace(/÷/g, "/").replace(/\s+/g, "");
    if (!/^[0-9.+\-*/()]+$/.test(s)) return null;
    let i = 0;
    const peek = () => (i < s.length ? s[i] : "");
    function parseExpr() {
      let v = parseTerm();
      while (peek() === "+" || peek() === "-") { const op = s[i++]; const t = parseTerm(); v = op === "+" ? v + t : v - t; }
      return v;
    }
    function parseTerm() {
      let v = parseFactor();
      while (peek() === "*" || peek() === "/") { const op = s[i++]; const f = parseFactor(); v = op === "*" ? v * f : (f !== 0 ? v / f : NaN); }
      return v;
    }
    function parseFactor() {
      if (peek() === "(") { i++; const v = parseExpr(); if (peek() === ")") i++; return v; }
      if (peek() === "+") { i++; return parseFactor(); }
      if (peek() === "-") { i++; return -parseFactor(); }
      let nums = "";
      while (i < s.length && /[0-9.]/.test(s[i])) nums += s[i++];
      return nums === "" ? NaN : parseFloat(nums);
    }
    let r;
    try { r = parseExpr(); } catch (e) { return null; }
    if (i !== s.length || r == null || isNaN(r) || !isFinite(r)) return null;
    return r;
  }

  function fmtNum(r) {
    if (r === Math.round(r)) return String(Math.round(r));
    return String(Math.round(r * 10000) / 10000);
  }

  function calcular(opts) {
    const largo = parseFloat(opts.largo);
    const ancho = parseFloat(opts.ancho);
    const valorM2 = parseFloat(opts.valorM2);
    const anchoRollo = parseFloat(opts.anchoRollo);
    if (!(anchoRollo > 0)) throw new Error("El ancho de rollo de la tela debe ser mayor que 0.");

    const valorOjetillo = opts.valorOjetillo != null ? parseFloat(opts.valorOjetillo) : CFG.VALOR_OJETILLO_DEFAULT;
    const descuentoPct = parseFloat(opts.descuentoPct || 0);
    const ivaPct = opts.ivaPct != null ? parseFloat(opts.ivaPct) : CFG.IVA_PCT;
    const margen = opts.margenCostura != null ? parseFloat(opts.margenCostura) : CFG.MARGEN_COSTURA_M;
    const nOjetillos = Math.max(0, parseInt(opts.nOjetillos != null ? opts.nOjetillos : 0, 10) || 0);
    const cantidad = Math.max(1, parseInt(opts.cantidad != null ? opts.cantidad : 1, 10) || 1);

    const panos = Math.ceil(ancho / anchoRollo);
    const panoLen = Math.round((largo + margen) * 100) / 100;
    const m2 = Math.round(panos * anchoRollo * panoLen * 100) / 100;
    const metroLineal = Math.round(anchoRollo * valorM2 * 100) / 100;
    const material = m2 * valorM2;                 // por unidad
    const ojetillosValor = nOjetillos * valorOjetillo; // por unidad

    // Cantidad de unidades: multiplica material y ojetillos.
    const materialTotal = material * cantidad;
    const nOjetillosTotal = nOjetillos * cantidad;
    const ojetillosValorTotal = ojetillosValor * cantidad;

    const subtotal = materialTotal + ojetillosValorTotal;
    const descuento = Math.round(subtotal * descuentoPct / 100);
    const netoConDescuento = subtotal - descuento;
    const iva = Math.round(netoConDescuento * ivaPct / 100);
    const total = netoConDescuento + iva;

    return {
      panos, panoLen, anchoRollo, m2, valorM2, metroLineal,
      material, materialTotal, nOjetillos, nOjetillosTotal,
      valorOjetillo, ojetillosValor, ojetillosValorTotal, cantidad, subtotal,
      descuentoPct, descuento, netoConDescuento, ivaPct, iva, total,
    };
  }

  function calcularOrientaciones(opts) {
    const L = parseFloat(opts.largo);
    const A = parseFloat(opts.ancho);
    const mayor = Math.max(L, A);
    const menor = Math.min(L, A);
    const base = Object.assign({}, opts);
    const resMayor = calcular(Object.assign({}, base, { largo: mayor, ancho: menor }));
    const resMenor = calcular(Object.assign({}, base, { largo: menor, ancho: mayor }));
    return {
      mayor: { lado: mayor, res: resMayor },
      menor: { lado: menor, res: resMenor },
    };
  }

  // =====================================================================
  // v4: bordes por arista, unión entre paños y prorrata por lote
  // =====================================================================
  const PI = Math.PI;
  function r2(n) { return Math.round(n * 100) / 100; }

  // Consumo lineal (m) de una arista según su terminación.
  //   borde = { tipo:'bruto'|'borde'|'borde_cuerda'|'bolsillo', valor, diam }
  //   defaults = { borde:0.045, unionCierre:0.045 }
  function allowanceArista(borde, defaults) {
    const d = defaults || {};
    const dBorde = d.borde != null ? parseFloat(d.borde) : 0.045;
    const dUnionCierre = d.unionCierre != null ? parseFloat(d.unionCierre) : 0.045;
    const tipo = (borde && borde.tipo) || "borde";
    const valor = (borde && borde.valor != null && borde.valor !== "") ? parseFloat(borde.valor) : dBorde;
    const diam = (borde && borde.diam != null && borde.diam !== "") ? parseFloat(borde.diam) : 0;
    if (tipo === "bruto") return 0;
    if (tipo === "borde") return valor;
    if (tipo === "borde_cuerda") return valor + PI * diam;      // borde base + π·Ø
    if (tipo === "bolsillo") return PI * diam + dUnionCierre;    // π·Ø + unión de cierre
    return valor;
  }

  // Paños para cubrir 'across' con paños de ancho 'rollo', traslapando 'union' por junta.
  // cobertura = panos·rollo − (panos−1)·union ≥ across.
  function panosPara(across, rollo, union) {
    if (!(rollo > 0)) throw new Error("El ancho de rollo debe ser mayor que 0.");
    let panos = Math.max(1, Math.ceil(across / rollo));
    for (let i = 0; i < 8; i++) {
      const src = across + (panos - 1) * union;
      const n = Math.max(1, Math.ceil(src / rollo));
      if (n === panos) break;
      panos = n;
    }
    const acrossSrc = across + (panos - 1) * union;
    const lastStrip = acrossSrc - (panos - 1) * rollo;   // ancho usado del último paño, (0, rollo]
    return { panos, acrossSrc, lastStrip };
  }

  // Prorrata por lote de N unidades idénticas: se comparten las tiras parciales.
  function prorratearPanos(panosUnit, lastStrip, rollo, N) {
    const completos = panosUnit - 1;
    let k = 1;
    if (lastStrip > 1e-9 && lastStrip < rollo - 1e-9) k = Math.max(1, Math.floor(rollo / lastStrip));
    const partial = (lastStrip >= rollo - 1e-9) ? N : Math.ceil(N / k);
    const panosLote = N * completos + partial;
    const panosFull = N * panosUnit;
    return { panosLote, panosFull, k, prorrata: panosLote < panosFull };
  }

  // Cobertura (m) de m paños traslapados.
  function cobertura(m, rollo, union) { return m <= 0 ? 0 : m * rollo - (m - 1) * union; }

  function loteOrient(panoLen, across, rollo, union, N, valorM2, factorTela) {
    const fT = (factorTela > 0) ? factorTela : 1;   // factor de diseño: solo afecta el costo de tela
    const { panos, lastStrip } = panosPara(across, rollo, union);
    const pr = prorratearPanos(panos, lastStrip, rollo, N);
    const m2Full = r2(pr.panosFull * rollo * panoLen);
    const m2Lote = r2(pr.panosLote * rollo * panoLen);
    // Asesor de paño marginal: cuánto habría que achicar 'across' para necesitar 1 paño menos.
    const faltanteParaBajar = panos > 1 ? Math.round((across - cobertura(panos - 1, rollo, union)) * 10000) / 10000 : null;
    const excedenteCobertura = r2(cobertura(panos, rollo, union) - across);
    const costoPano = r2(rollo * panoLen * valorM2 * fT);   // valor de 1 paño en esta orientación
    return {
      panoLen: r2(panoLen), across: r2(across), panosUnit: panos, uniones: panos - 1,
      lastStrip: r2(lastStrip), k: pr.k, panosLote: pr.panosLote, panosFull: pr.panosFull,
      prorrata: pr.prorrata, m2Full, m2Lote,
      materialFull: m2Full * valorM2 * fT, materialLote: m2Lote * valorM2 * fT,
      ahorro: r2((m2Full - m2Lote) * valorM2 * fT),
      valorM2: r2(valorM2), metroLineal: r2(rollo * valorM2),
      faltanteParaBajar, excedenteCobertura, costoPano,
    };
  }

  // Cálculo de una pieza para un lote de N unidades idénticas, con las 2 orientaciones de unión.
  function calcularLote(opts) {
    const largo = parseFloat(opts.largo), ancho = parseFloat(opts.ancho);
    const rollo = parseFloat(opts.anchoRollo);
    const valorM2 = parseFloat(opts.valorM2);
    // Tope de seguridad: la unión (traslape) no puede ser ≥ al ancho del rollo (físicamente imposible).
    const unionPedida = opts.union != null ? parseFloat(opts.union) : 0.045;
    const unionInvalida = rollo > 0 && unionPedida >= rollo;
    const union = unionInvalida ? Math.min(unionPedida, rollo * 0.9) : unionPedida;
    const N = Math.max(1, parseInt(opts.cantidad != null ? opts.cantidad : 1, 10) || 1);
    const d = opts.defaults || {};
    const a = (b) => allowanceArista(b, d);
    const bordes = opts.bordes || {};
    // Volumétrico: el alto se suma 2× a cada dimensión del paño (paredes que bajan por ambos lados).
    const alturaRaw = opts.altura != null ? parseFloat(opts.altura) : 0;
    const altura = isNaN(alturaRaw) ? 0 : Math.max(0, alturaRaw);
    // Altos POR LADO (volumétrico con alas disímiles o alas apagadas): la hoja real es
    // largo + hSup + hInf  ×  ancho + hIzq + hDer. Sin "altos", cae al clásico 2× alto.
    const altosO = opts.altos || null;
    const hN = (v) => { const r = parseFloat(v); return isNaN(r) ? 0 : Math.max(0, r); };
    const largoBase = largo + (altosO ? (hN(altosO.sup) + hN(altosO.inf)) : 2 * altura);
    const anchoBase = ancho + (altosO ? (hN(altosO.izq) + hN(altosO.der)) : 2 * altura);
    // Cabeceras (sup/inf) suman al largo; lados (izq/der) suman al ancho.
    const largoFuente = largoBase + a(bordes.sup) + a(bordes.inf);
    const anchoNeto = anchoBase + a(bordes.izq) + a(bordes.der);

    const nOj = Math.max(0, parseInt(opts.ojetillos != null ? opts.ojetillos : 0, 10) || 0);
    const valOj = opts.valorOjetillo != null ? parseFloat(opts.valorOjetillo) : 450;
    const ojeLote = nOj * valOj * N;

    // Factor de diseño (1..2): multiplica solo el costo de tela (confección), no ojetillos ni materiales.
    const fT = (opts.factorTela != null && parseFloat(opts.factorTela) > 0) ? parseFloat(opts.factorTela) : 1;
    // Dos direcciones de paño: a lo largo (paños ‖ al largo) y a lo ancho.
    const oLargo = loteOrient(largoFuente, anchoNeto, rollo, union, N, valorM2, fT); // paños a lo largo
    const oAncho = loteOrient(anchoNeto, largoFuente, rollo, union, N, valorM2, fT); // paños a lo ancho
    [oLargo, oAncho].forEach((o) => {
      o.ojetillosLote = ojeLote;
      o.subtotalLote = o.materialLote + ojeLote;        // neto del lote con prorrata
      o.subtotalLoteFull = o.materialFull + ojeLote;    // neto del lote sin prorrata
      o.valorUnitario = (o.materialLote + ojeLote) / N; // unitario prorrateado
    });
    // Recomendación: orientación más económica y ahorro vs. la otra.
    const masEconomica = oAncho.subtotalLote < oLargo.subtotalLote ? "ancho" : "largo";
    const cara = masEconomica === "ancho" ? oLargo : oAncho;
    const barata = masEconomica === "ancho" ? oAncho : oLargo;
    return {
      largoFuente: r2(largoFuente), anchoNeto: r2(anchoNeto), N, nOjetillos: nOj,
      valorOjetillo: valOj, union: union, unionInvalida: unionInvalida, altura: altura, factorTela: fT, oLargo, oAncho,
      recomendacion: {
        masEconomica,
        ahorroOrientacion: r2(cara.subtotalLote - barata.subtotalLote),
      },
    };
  }

  const API = {
    money, calcular, calcularOrientaciones, evalExpr, fmtNum,
    allowanceArista, panosPara, prorratearPanos, calcularLote,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  global.CalcCIBSA = API;
})(typeof window !== "undefined" ? window : globalThis);
