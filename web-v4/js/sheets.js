/* Lectura del Google Sheet (hoja RANGO + tabla de telas) vía Sheets API REST. */
(function (global) {
  const CFG = global.CONFIG;

  function parseNumero(txt) {
    if (txt == null) return null;
    let s = String(txt).trim();
    if (s === "") return null;
    s = s.replace(/\$/g, "").replace(/\s/g, "");
    s = s.replace(/\./g, "").replace(/,/g, ".");   // '.' miles, ',' decimal
    const n = parseFloat(s);
    return isNaN(n) ? null : n;
  }

  async function leerValores(token, rango) {
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${CFG.SHEET_ID}/values/` +
      `${encodeURIComponent(rango)}?valueRenderOption=FORMATTED_VALUE`;
    const r = await fetch(url, { headers: { Authorization: "Bearer " + token } });
    if (r.status === 401) throw new Error("La sesión expiró. Inicia sesión de nuevo.");
    if (!r.ok) {
      let msg = "No se pudo leer el Sheet (código " + r.status + ").";
      try { const j = await r.json(); if (j.error && j.error.message) msg += " " + j.error.message; } catch (e) {}
      throw new Error(msg);
    }
    const data = await r.json();
    return data.values || [];
  }

  async function leerRango(token) {
    const filas = await leerValores(token, CFG.RANGO_LECTURA);
    const punteros = [];
    for (const f of filas) {
      const hoja = (f[0] || "").trim();
      const rango = (f[1] || "").trim();
      const id = (f[2] || "").trim();
      if (hoja && rango) punteros.push({ hoja, rango, id });
    }
    if (!punteros.length) {
      throw new Error("La hoja RANGO no existe, está vacía o no tiene filas válidas (Hoja | Rango | ID).");
    }
    return punteros;
  }

  function norm(s) { return String(s).replace(/\s+/g, " ").trim().toLowerCase(); }

  function buscarColumna(encabezados, objetivo) {
    const o = norm(objetivo);
    let idx = encabezados.findIndex((h) => norm(h) === o);
    if (idx === -1) idx = encabezados.findIndex((h) => norm(h).includes(o));
    return idx;
  }

  async function leerTabla(token, hoja, rango) {
    const filas = await leerValores(token, `'${hoja}'!${rango}`);
    if (!filas.length) throw new Error(`El rango ${hoja}!${rango} no devolvió datos.`);
    const encabezados = filas[0].map((h) => (h || "").trim());
    const registros = [];
    for (let i = 1; i < filas.length; i++) {
      const f = filas[i];
      const nombre = (f[0] || "").trim();
      if (!nombre) continue;       // ignora filas sin nombre
      const fila = {};
      encabezados.forEach((h, j) => { fila[h] = (f[j] != null ? String(f[j]).trim() : ""); });
      registros.push(fila);
    }
    return { encabezados, registros };
  }

  async function cargarTelas(token) {
    const punteros = await leerRango(token);
    const ptr = punteros.find((p) => p.id.toLowerCase() === CFG.ID_TABLA_TELAS.toLowerCase());
    if (!ptr) throw new Error(`No se encontró en RANGO una fila con ID '${CFG.ID_TABLA_TELAS}'.`);

    const { encabezados, registros } = await leerTabla(token, ptr.hoja, ptr.rango);
    const iNom = buscarColumna(encabezados, CFG.COL_NOMBRE_TELA);
    const iM2 = buscarColumna(encabezados, CFG.COL_VALOR_M2);
    const iAncho = buscarColumna(encabezados, CFG.COL_ANCHO_ROLLO);
    const iFicha = buscarColumna(encabezados, CFG.COL_FICHA);

    const faltan = [];
    if (iNom === -1) faltan.push(CFG.COL_NOMBRE_TELA);
    if (iM2 === -1) faltan.push(CFG.COL_VALOR_M2);
    if (iAncho === -1) faltan.push(CFG.COL_ANCHO_ROLLO);
    if (faltan.length) {
      throw new Error("Faltan columnas en la tabla de telas: " + faltan.join(", ") +
        ". Encabezados: " + encabezados.join(" | "));
    }
    const cNom = encabezados[iNom], cM2 = encabezados[iM2], cAncho = encabezados[iAncho];
    const cFicha = iFicha !== -1 ? encabezados[iFicha] : null;

    const telas = [];
    for (const r of registros) {
      const nombre = (r[cNom] || "").trim();
      const valorM2 = parseNumero(r[cM2]);
      const ancho = parseNumero(r[cAncho]);
      if (!nombre || valorM2 == null || ancho == null || ancho <= 0) continue;
      const fichaRaw = cFicha ? (r[cFicha] || "") : "";
      const ficha = fichaRaw.split(/[\r\n]+/).map((s) => s.trim()).filter(Boolean);
      telas.push({ nombre, valorM2, anchoRollo: ancho, ficha });
    }
    if (!telas.length) throw new Error("La tabla de telas no contiene filas válidas.");
    return telas;
  }

  async function cargarVendedores(token) {
    const punteros = await leerRango(token);
    const ptr = punteros.find((p) => p.id.toLowerCase() === CFG.ID_TABLA_VENDEDORES.toLowerCase());
    if (!ptr) return [];   // aún no se ha creado la tabla de vendedores en RANGO: no romper

    // Lectura directa (no asume que el nombre esté en la columna A): ubica cada
    // columna por su encabezado y descarta filas solo cuando el NOMBRE está vacío.
    const filas = await leerValores(token, `'${ptr.hoja}'!${ptr.rango}`);
    if (!filas.length) return [];
    const encabezados = filas[0].map((h) => (h || "").trim());
    const cell = (f, i) => (i !== -1 && f[i] != null ? String(f[i]) : "").trim();
    const iNom = buscarColumna(encabezados, CFG.COL_VENDEDOR_NOMBRE);
    const idxApellidos = (CFG.COL_VENDEDOR_APELLIDOS || [])
      .map((c) => buscarColumna(encabezados, c)).filter((i) => i !== -1);
    const iEmail = buscarColumna(encabezados, CFG.COL_VENDEDOR_EMAIL);
    const idxFonos = (CFG.COL_VENDEDOR_FONOS || [])
      .map((c) => buscarColumna(encabezados, c)).filter((i) => i !== -1);
    if (iNom === -1) {
      throw new Error("La tabla de vendedores no tiene la columna '" + CFG.COL_VENDEDOR_NOMBRE +
        "'. Encabezados encontrados: " + encabezados.join(" | "));
    }

    const vendedores = [];
    for (let i = 1; i < filas.length; i++) {
      const f = filas[i] || [];
      const base = cell(f, iNom);
      if (!base) continue;
      const apellidos = idxApellidos.map((j) => cell(f, j)).filter(Boolean);
      const nombre = [base].concat(apellidos).join(" ");
      const email = cell(f, iEmail);
      const fonos = idxFonos.map((j) => cell(f, j)).filter(Boolean);
      vendedores.push({ nombre, email, fonos });
    }
    return vendedores;
  }

  global.SheetsCIBSA = { cargarTelas, cargarVendedores, parseNumero };
})(typeof window !== "undefined" ? window : globalThis);
