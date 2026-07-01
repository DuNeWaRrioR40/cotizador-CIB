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
  // Prioriza: (1) alias exacto en NombreProveedor (guarda nombres Y códigos del proveedor),
  // (2) código contra equiv/sku/modelo, (3) nombre difuso. El alias mezcla nombres y códigos con "/".
  function aliasLista(p) { return String(p.nombreProveedor || "").split("/").map((s) => norm(s)).filter(Boolean); }
  // Mejor similitud del nombre contra el nombre del catálogo Y contra cada alias guardado (toma el mayor).
  function simProd(nom, p) {
    let m = similitud(nom, nombreCatalogo(p));
    aliasLista(p).forEach((a) => { const s = similitud(nom, a); if (s > m) m = s; });
    return m;
  }
  function matchItem(item, catalogo) {
    const cod = norm(item.codigo), nom = item.nombre;
    let exacto = null, mejor = null, mejorScore = 0;
    (catalogo || []).forEach((p) => {
      const alias = aliasLista(p);
      if (nom && alias.includes(norm(nom))) { exacto = exacto || { prod: p, score: 1, via: "alias" }; }
      if (cod && (alias.includes(cod) || [p.equiv, p.sku, p.modelo, p.codMaterialBase].some((c) => norm(c) === cod))) {
        exacto = exacto || { prod: p, score: 1, via: "código" };
      }
      const s = simProd(nom, p);
      if (s > mejorScore) { mejorScore = s; mejor = p; }
    });
    if (exacto) return exacto;
    if (mejor && mejorScore >= 0.34) return { prod: mejor, score: Math.round(mejorScore * 100) / 100, via: "nombre" };
    return null;   // sin match → producto nuevo
  }
  // Posibles coincidencias para el anti-duplicados al crear: candidatos por nombre/alias/código,
  // umbral más bajo, ordenados por score. Devuelve [{prod, score, via}] (máx `max`).
  function candidatos(item, catalogo, max) {
    const cod = norm(item.codigo), nom = item.nombre, out = [];
    (catalogo || []).forEach((p) => {
      const alias = aliasLista(p);
      let score = simProd(nom, p), via = "nombre";
      if (cod && (alias.includes(cod) || [p.equiv, p.sku, p.modelo].some((c) => norm(c) === cod))) { score = 1; via = "código"; }
      else if (nom && alias.includes(norm(nom))) { score = 1; via = "alias"; }
      if (score >= 0.2) out.push({ prod: p, score: Math.round(score * 100) / 100, via: via });
    });
    out.sort((a, b) => b.score - a.score);
    return out.slice(0, max || 5);
  }
  // Alias inicial al crear: nombre + código del proveedor (lo que vino en la factura), unidos con " / ".
  function aliasInicial(nombre, codigo) { return [String(nombre || "").trim(), String(codigo || "").trim()].filter(Boolean).join(" / "); }

  // ---- Factor: ¿existe la combinación? (Categoría × Tipo × Variedad × Unidad Mínima) ----
  // Tipo opcional: una fila con Tipo específico GANA; si no hay, vale la general (Tipo en blanco).
  // "CONF" y "CONFECCION" son el mismo concepto: se canonizan para que el factor calce escriban lo que escriban.
  function umNorm(s) { const n = norm(s); return (n === "conf" || n === "confeccion") ? "confeccion" : n; }
  function factorBuscar(factores, categoria, tipo, variedad, unidadMinima) {
    const c = norm(categoria), t = norm(tipo), v = umNorm(variedad), u = umNorm(unidadMinima);
    let general = null, especifico = null;
    (factores || []).forEach((f) => {
      if (norm(f.categoria) !== c || umNorm(f.variedad) !== v) return;
      if (u !== "" && umNorm(f.unidadMinima) !== "" && umNorm(f.unidadMinima) !== u) return;
      const ft = norm(f.tipo);
      if (ft === "") { general = general || f; }
      else if (ft === t) { especifico = especifico || f; }
    });
    return especifico || general || null;
  }

  // ---- Sugerencias ----
  function abbr(s, n) { return norm(s).replace(/[^a-z0-9]/g, "").slice(0, n || 3).toUpperCase(); }
  // ¿El color trae varios valores ("NEGRO / BLANCO", "AZUL, ROJO", "X Y Z")? Entonces es un producto
  // multicolor al MISMO precio → el color NO entra al SKU (un solo SKU, un solo costo).
  function colorMulti(c) { return /[\/,;]| y /i.test(String(c || "")); }
  // Incluye el COLOR en el SKU SOLO si es un único color (caso en que el color cambia el precio: cada color
  // queda con su propio SKU y su propio costo, sin chocar). Si hay varios colores (mismo precio), se omite.
  function sugerirSKU(p) {
    const col = colorMulti(p.color) ? "" : abbr(p.color, 4);
    return [abbr(p.categoria, 3), abbr(p.tipo, 2), abbr(p.variedad, 3), abbr(p.formato, 6), abbr(p.modelo, 6), col, abbr(p.proveedorCorto || p.proveedor, 3)]
      .filter(Boolean).join("-");
  }
  // Une colores en una lista " / " sin duplicar (acento-insensible). unirColores("NEGRO", "negro", "BLANCO") → "NEGRO / BLANCO".
  function unirColores() {
    const out = [], vistos = {};
    for (let i = 0; i < arguments.length; i++) {
      String(arguments[i] || "").split(/[\/,;]| y /i).forEach((c) => {
        const t = c.trim(); if (!t) return; const k = norm(t);
        if (!vistos[k]) { vistos[k] = 1; out.push(t); }
      });
    }
    return out.join(" / ");
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
  // FACTOR: A=CATEGORIA, B=VARIEDAD, C=UNIDAD MINIMA, D=FACTOR, E=TIPO (Tipo en blanco = general).
  function filaFactor(f) { return [f.categoria || "", f.variedad || "", f.unidadMinima || "", f.factor != null ? f.factor : "", f.tipo || ""]; }
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

  // ---- Fusión canónica (maestro) ----
  function colLetter(n) { let s = ""; n = Math.floor(n); while (n >= 0) { s = String.fromCharCode(65 + (n % 26)) + s; n = Math.floor(n / 26) - 1; } return s; }
  function esMaestro(email, lista) { const e = String(email || "").trim().toLowerCase(); return (lista || []).some((m) => String(m || "").trim().toLowerCase() === e); }
  // Construye el plan de fusión: repunta COSTOS.Llave y GRANEL.Parent del dup → canónico, marca el dup
  // (Activo=No + Notas "FUSIONADO→canon") y fusiona el alias en la fila canónica. NO borra filas.
  // o = { dupSKU, canonSKU, granel:[filas con header], costos:[filas con header], gIdx, cIdx }.
  function planFusion(o) {
    const dup = String(o.dupSKU || "").trim(), canon = String(o.canonSKU || "").trim();
    const g = o.granel || [], c = o.costos || [], gi = o.gIdx, ci = o.cIdx;
    const updCostos = [], updGranel = [];
    let costosRepunt = 0, parentsRepunt = 0, dupRowNum = null, canonRowNum = null, aliasNuevo = "", dupNombreProv = "";
    for (let i = 1; i < c.length; i++) {
      const row = c[i] || [];
      if (String(row[ci.llave] || "").trim() === dup) { updCostos.push({ rango: colLetter(ci.llave) + (i + 1), valores: [[canon]] }); costosRepunt++; }
    }
    for (let i = 1; i < g.length; i++) {
      const row = g[i] || [], sku = String(row[gi.sku] || "").trim();
      if (String(row[gi.parent] || "").trim() === dup) { updGranel.push({ rango: colLetter(gi.parent) + (i + 1), valores: [[canon]] }); parentsRepunt++; }
      if (sku === dup) {
        dupRowNum = i + 1; dupNombreProv = String(row[gi.nombreProv] || "").trim();
        updGranel.push({ rango: colLetter(gi.activo) + (i + 1), valores: [["No"]] });
        const notas = String(row[gi.notas] || "").trim();
        updGranel.push({ rango: colLetter(gi.notas) + (i + 1), valores: [[(notas ? notas + " | " : "") + "FUSIONADO→" + canon]] });
      }
      if (sku === canon) canonRowNum = i + 1;
    }
    if (canonRowNum != null && dupNombreProv) {
      const canonRow = g[canonRowNum - 1] || [], canonAlias = String(canonRow[gi.nombreProv] || "").trim();
      const set = {}; canonAlias.split("/").map((s) => s.trim()).filter(Boolean).forEach((s) => { set[s.toLowerCase()] = 1; });
      const add = dupNombreProv.split("/").map((s) => s.trim()).filter(Boolean).filter((s) => !set[s.toLowerCase()]);
      if (add.length) { aliasNuevo = (canonAlias ? canonAlias + " / " : "") + add.join(" / "); updGranel.push({ rango: colLetter(gi.nombreProv) + canonRowNum, valores: [[aliasNuevo]] }); }
    }
    return { costos: updCostos, granel: updGranel, resumen: { dup: dup, canon: canon, costosRepunt: costosRepunt, parentsRepunt: parentsRepunt, dupRowNum: dupRowNum, canonRowNum: canonRowNum, aliasNuevo: aliasNuevo } };
  }

  const API = {
    norm, soloDigitosRUT, similitud, nombreCatalogo, aliasLista, colLetter, esMaestro, planFusion,
    matchProveedor, matchItem, candidatos, aliasInicial, factorBuscar,
    sugerirSKU, sugerirCodMaterialBase, colorMulti, unirColores, hoyCorta, fechaFactura, abbr,
    filaProveedor, filaCosto, filaFactor, filaGranel,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  global.FacturaCIBSA = API;
})(typeof window !== "undefined" ? window : globalThis);
