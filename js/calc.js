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

  const API = { money, calcular, calcularOrientaciones, evalExpr, fmtNum };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  global.CalcCIBSA = API;
})(typeof window !== "undefined" ? window : globalThis);
