/* Lógica de la carga de facturas (sin UI): match de proveedor/producto y construcción de las filas
   que se escribirán en el Sheet (PROVEEDORES, GRANEL, COSTOS, FACTOR). Pensado para ser testeable.

   Regla clave de escritura:
   - Producto YA existente (match) + costo nuevo → solo se agrega una fila a COSTOS (Llave = CodMaterialBase).
   - Producto NUEVO → fila(s) en GRANEL (rollo + estados hijos) con flag Vigentes=1, + su costo en COSTOS.
   - Proveedor no registrado (por RUT) → fila en PROVEEDORES.
   - Combinación Categoría×Variedad×Unidad Mínima sin factor → fila en FACTOR (el usuario fija el valor). */
(function (global) {
  "use strict";
  const CFG = (typeof CONFIG !== "undefined") ? CONFIG : (global.CONFIG || {});

  function norm(s) {
    return String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "")
      .replace(/[×✕*]/g, "x").replace(/\s+/g, " ").trim().toLowerCase();
  }
  function soloDigitosRUT(r) { return String(r || "").replace(/[^0-9kK]/g, "").toUpperCase(); }

  // ---- Match de proveedor por RUT ----
  function matchProveedor(rutEmisor, proveedores) {
    const r = soloDigitosRUT(rutEmisor);
    return (proveedores || []).find((p) => soloDigitosRUT(p.rut) === r) || null;
  }

  // ---- Similitud de nombres (Jaccard sobre tokens normalizados) ----
  function tokens(s) { return norm(s).split(/[^a-z0-9.]+/).filter((t) => t.length > 1); }
  function similitud(a, b) {
    const A = new Set(tokens(a)), B = new Set(tokens(b));
    if (!A.size || !B.size) return 0;
    let inter = 0; A.forEach((t) => { if (B.has(t)) inter++; });
    return inter / (A.size + B.size - inter);
  }
  // Nombre "buscable" de un producto del catálogo (lo que conoce la App vía VIGENTES).
  function nombreCatalogo(p) {
    return [p.nombreCliente, p.categoria, p.tipo, p.variedad, p.modelo, p.color, p.materialidad].filter(Boolean).join(" ");
  }
  // ---- Match de ítem de factura contra el catálogo ----
  // Prioriza: (1) alias exacto en NombreProveedor, (2) código exacto (equiv/sku/modelo), (3) nombre difuso.
  function matchItem(item, catalogo) {
    const cod = norm(item.codigo), nom = item.nombre;
    let exacto = null, mejor = null, mejorScore = 0;
    (catalogo || []).forEach((p) => {
      const alias = String(p.nombreProveedor || "").split("/").map(norm);
      if (alias.includes(norm(nom))) { exacto = exacto || { prod: p, score: 1, via: "alias" }; }
      if (cod && [p.equiv, p.sku, p.modelo, p.codMaterialBase].some((c) => norm(c) === cod)) {
        exacto = exacto || { prod: p, score: 1, via: "código" };
      }
      const s = similitud(nom, nombreCatalogo(p));
      if (s > mejorScore) { mejorScore = s; mejor = p; }
    });
    if (exacto) return exacto;
    if (mejor && mejorScore >= 0.34) return { prod: mejor, score: Math.round(mejorScore * 100) / 100, via: "nombre" };
    return null;   // sin match → producto nuevo
  }

  // ---- Factor: ¿existe la combinación? ----
  function factorBuscar(factores, categoria, variedad, unidadMinima) {
    const c = norm(categoria), v = norm(variedad), u = norm(unidadMinima);
    return (factores || []).find((f) => norm(f.categoria) === c && norm(f.variedad) === v &&
      (u === "" || norm(f.unidadMinima) === u || norm(f.unidadMinima) === "")) || null;
  }

  // ---- Sugerencias ----
  function abbr(s, n) { return norm(s).replace(/[^a-z0-9]/g, "").slice(0, n || 3).toUpperCase(); }
  function sugerirSKU(p) {
    return [abbr(p.categoria, 3), abbr(p.tipo, 2), abbr(p.variedad, 3), abbr(p.formato, 6), abbr(p.modelo, 6), abbr(p.proveedorCorto || p.proveedor, 3)]
      .filter(Boolean).join("-");
  }
  function sugerirCodMaterialBase(p) {
    return [abbr(p.proveedorCorto || p.proveedor, 3), abbr(p.modelo || p.formato, 6), abbr(p.formato, 6)].filter(Boolean).join("-");
  }
  function hoyCorta(d) { d = d || new Date(); const p = (x) => ("0" + x).slice(-2); return p(d.getDate()) + "/" + p(d.getMonth() + 1) + "/" + d.getFullYear(); }
  // "2026-04-30" (FchEmis ISO) → "30/04/2026"; si no parsea, hoy.
  function fechaFactura(iso) {
    const m = String(iso || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
    return m ? (m[3] + "/" + m[2] + "/" + m[1]) : hoyCorta();
  }

  // ---- Construcción de filas para el Sheet ----
  function filaProveedor(p) { return [p.rut || "", p.razon || "", p.nombreCorto || ""]; }
  function filaCosto(c) {
    const C = CFG.COL_COSTOS || {};
    return [c.llave || "", c.fecha || "", c.costo != null ? c.costo : "", c.unidadCompra || "", c.proveedorRUT || "", c.numFactura || "", c.nota || ""];
  }
  function filaFactor(f) { return [f.categoria || "", f.variedad || "", f.unidadMinima || "", f.factor != null ? f.factor : ""]; }
  // Fila GRANEL en el ORDEN REAL de la hoja (A→AE). Precio se deja vacío (pasará a fórmula). Vigentes=1.
  function filaGranel(p) {
    const orden = CFG.GRANEL_ORDEN || [];
    const map = {
      "Categoria": p.categoria, "Proveedor": p.proveedor || p.proveedorCorto, "Tipo": p.tipo, "Variedad": p.variedad,
      "Formato": p.formato, "Modelo": p.modelo, "Color": p.color, "Largo": p.largo, "Materialidad": p.materialidad,
      "Peso": p.peso, "Equiv": p.equiv, "Unidad": p.unidad, "Unidad Minima": p.unidadMinima, "Precio": "",
      "Specs": p.specs, "AnchoRollo": p.anchoRollo, "NombreCliente": p.nombreCliente, "Activo": p.activo || "SI",
      "Notas": p.notas, "Fecha Actualización": p.fecha || hoyCorta(), "Fecha Base": p.fechaBase || p.fecha || hoyCorta(),
      "SKU": p.sku, "": "", "Vigentes": 1, "FAV": p.fav, "CodMaterialBase": p.codMaterialBase,
      "Parent (SKU rollo)": p.parent, "Rendimiento": p.rendimiento, "NombreProveedor": p.nombreProveedor,
      "UnidadProveedor": p.unidadProveedor, "ProveedorRUT": p.proveedorRUT,
    };
    return orden.map((h) => { const v = map[h]; return (v === undefined || v === null) ? "" : v; });
  }

  const API = {
    norm, soloDigitosRUT, similitud, nombreCatalogo,
    matchProveedor, matchItem, factorBuscar,
    sugerirSKU, sugerirCodMaterialBase, hoyCorta, fechaFactura,
    filaProveedor, filaCosto, filaFactor, filaGranel,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  global.FacturaCIBSA = API;
})(typeof window !== "undefined" ? window : globalThis);
