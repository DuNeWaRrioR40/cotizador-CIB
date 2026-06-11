/* Reglas de cálculo de la cotización CIBSA (puro, sin dependencias). */
(function (global) {
  const CFG = (typeof module !== "undefined" && module.exports)
    ? require("./config.js") : global.CONFIG;

  function money(n) {
    return "$" + Math.round(n).toLocaleString("es-CL");
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

    const panos = Math.ceil(ancho / anchoRollo);
    const panoLen = Math.round((largo + margen) * 100) / 100;
    const m2 = Math.round(panos * anchoRollo * panoLen * 100) / 100;
    const metroLineal = Math.round(anchoRollo * valorM2 * 100) / 100;
    const material = m2 * valorM2;

    const ojetillosValor = nOjetillos * valorOjetillo;
    const subtotal = material + ojetillosValor;
    const descuento = Math.round(subtotal * descuentoPct / 100);
    const netoConDescuento = subtotal - descuento;
    const iva = Math.round(netoConDescuento * ivaPct / 100);
    const total = netoConDescuento + iva;

    return {
      panos, panoLen, anchoRollo, m2, valorM2, metroLineal, material,
      nOjetillos, valorOjetillo, ojetillosValor, subtotal,
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

  const API = { money, calcular, calcularOrientaciones };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  global.CalcCIBSA = API;
})(typeof window !== "undefined" ? window : globalThis);
