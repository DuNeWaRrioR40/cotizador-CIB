/* Lectura del Google Sheet (hoja RANGO + tabla de telas) vía Sheets API REST. */
(function (global) {
  const CFG = global.CONFIG;

  // Lector de números robusto: entiende coma o punto como decimal, con o sin separador
  // de miles. Reglas: si hay ambos separadores, el ÚLTIMO es el decimal. Si hay uno solo,
  // se trata como decimal salvo que tenga exactamente 3 dígitos detrás (grupo de miles).
  function parseNumero(txt) {
    if (txt == null) return null;
    let s = String(txt).trim();
    if (s === "") return null;
    s = s.replace(/\$/g, "").replace(/\s/g, "").replace(/%/g, "");
    if (s === "") return null;
    const tienePunto = s.indexOf(".") >= 0, tieneComa = s.indexOf(",") >= 0;
    if (tienePunto && tieneComa) {
      if (s.lastIndexOf(",") > s.lastIndexOf(".")) s = s.replace(/\./g, "").replace(",", ".");  // coma decimal
      else s = s.replace(/,/g, "");                                                              // punto decimal
    } else if (tieneComa) {
      const p = s.split(",");
      s = (p.length === 2 && p[1].length !== 3) ? p[0] + "." + p[1] : s.replace(/,/g, "");
    } else if (tienePunto) {
      const p = s.split(".");
      s = (p.length === 2 && p[1].length !== 3) ? p[0] + "." + p[1] : s.replace(/\./g, "");
    }
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
      const f = filas[i] || [];
      // Ignora solo filas totalmente vacías (no depende de cuál sea la primera columna).
      if (!f.some((c) => c != null && String(c).trim() !== "")) continue;
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
    const iProv = buscarColumna(encabezados, CFG.COL_PROVEEDOR_TELA);
    const iFav = buscarColumna(encabezados, CFG.COL_FAV_TELA);

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
    const cProv = iProv !== -1 ? encabezados[iProv] : null;
    const cFav = iFav !== -1 ? encabezados[iFav] : null;

    const telas = [];
    for (const r of registros) {
      const nombre = (r[cNom] || "").trim();
      const valorM2 = parseNumero(r[cM2]);
      const ancho = parseNumero(r[cAncho]);
      if (!nombre || valorM2 == null || ancho == null || ancho <= 0) continue;
      const fichaRaw = cFicha ? (r[cFicha] || "") : "";
      const ficha = fichaRaw.split(/[\r\n]+/).map((s) => s.trim()).filter(Boolean);
      const proveedor = cProv ? (r[cProv] || "").trim() : "";   // interno (no va al PDF)
      // FAV: una o más categorías separadas por "/" (p.ej. "Premium / Económica"). Para selección rápida.
      const favCats = cFav ? String(r[cFav] || "").split("/").map((s) => s.trim()).filter(Boolean) : [];
      telas.push({ nombre, valorM2, anchoRollo: ancho, ficha, proveedor, fav: favCats });
    }
    if (!telas.length) throw new Error("La tabla de telas no contiene filas válidas.");
    return telas;
  }

  async function cargarMateriales(token) {
    const punteros = await leerRango(token);
    const ptr = punteros.find((p) => p.id.toLowerCase() === CFG.ID_TABLA_MATERIALES.toLowerCase());
    if (!ptr) return [];   // aún no existe la tabla de materiales en RANGO: no romper

    const filas = await leerValores(token, `'${ptr.hoja}'!${ptr.rango}`);
    if (!filas.length) return [];
    const enc = filas[0].map((h) => (h || "").trim());
    const cell = (f, i) => (i !== -1 && f[i] != null ? String(f[i]) : "").trim();
    const iCat = buscarColumna(enc, CFG.COL_MAT_CATEGORIA);
    const iItem = buscarColumna(enc, CFG.COL_MAT_ITEM);
    const iMod = buscarColumna(enc, CFG.COL_MAT_MODELO);
    const iCol = buscarColumna(enc, CFG.COL_MAT_COLOR);
    const iPre = buscarColumna(enc, CFG.COL_MAT_PRECIO);
    const iUni = buscarColumna(enc, CFG.COL_MAT_UNIDAD);
    const iProv = buscarColumna(enc, CFG.COL_MAT_PROVEEDOR);
    if (iCat === -1 || iItem === -1) {
      throw new Error("La tabla de materiales requiere las columnas '" + CFG.COL_MAT_CATEGORIA +
        "' e '" + CFG.COL_MAT_ITEM + "'. Encabezados: " + enc.join(" | "));
    }
    const materiales = [];
    for (let i = 1; i < filas.length; i++) {
      const f = filas[i] || [];
      const categoria = cell(f, iCat);
      const item = cell(f, iItem);
      if (!categoria || !item) continue;   // mínimo CATEGORIA + ITEM
      materiales.push({
        categoria, item,
        modelo: cell(f, iMod), color: cell(f, iCol),
        precio: parseNumero(cell(f, iPre)),   // null si está en blanco
        unidad: cell(f, iUni) || "unidad",
        proveedor: cell(f, iProv),            // interno: NUNCA al PDF
      });
    }
    return materiales;
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

  // Wiki de ayuda: mapa { código(min.) → comentario }. Hoja con 2 columnas (A=Código, B=Comentario).
  async function cargarWiki(token) {
    const punteros = await leerRango(token);
    const ptr = punteros.find((p) => p.id.toLowerCase() === (CFG.ID_TABLA_WIKI || "wiki").toLowerCase());
    if (!ptr) return {};
    const filas = await leerValores(token, `'${ptr.hoja}'!${ptr.rango}`);
    const mapa = {};
    const esEncabezado = (s) => { const x = norm(s); return x === "codigo" || x === "código" || x === "id" || x === "code"; };
    filas.forEach((f, i) => {
      const cod = (f[0] || "").trim();
      const com = (f[1] != null ? String(f[1]) : "").trim();
      if (!cod) return;
      if (i === 0 && esEncabezado(cod)) return; // omite fila de encabezado si la hay
      if (com) mapa[cod.toLowerCase()] = com;
    });
    return mapa;
  }

  // --- Historial en la nube (hoja administrada por la app) ---
  // Lee la hoja. Devuelve { existe, filas }. existe=false si la pestaña aún no se ha creado.
  async function leerHistorialRaw(token, hoja) {
    const rango = `'${hoja}'!A:G`;
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${CFG.SHEET_ID}/values/` +
      `${encodeURIComponent(rango)}?valueRenderOption=UNFORMATTED_VALUE`;
    const r = await fetch(url, { headers: { Authorization: "Bearer " + token } });
    if (r.status === 400) return { existe: false, filas: [] };   // la hoja no existe todavía
    if (r.status === 401) throw new Error("La sesión expiró. Inicia sesión de nuevo.");
    if (!r.ok) throw new Error("No se pudo leer el historial (código " + r.status + ").");
    const data = await r.json();
    return { existe: true, filas: data.values || [] };
  }
  async function crearHoja(token, hoja) {
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${CFG.SHEET_ID}:batchUpdate`;
    const r = await fetch(url, {
      method: "POST",
      headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
      body: JSON.stringify({ requests: [{ addSheet: { properties: { title: hoja } } }] }),
    });
    if (!r.ok) {
      const t = await r.text().catch(() => "");
      if (/already exists/i.test(t)) return;   // ya existe: no es error
      throw new Error("No se pudo crear la hoja " + hoja + " (código " + r.status + ").");
    }
    return r.json();
  }
  async function anexarFilas(token, hoja, filas) {
    if (!filas || !filas.length) return;
    const rango = `'${hoja}'!A:G`;
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${CFG.SHEET_ID}/values/` +
      `${encodeURIComponent(rango)}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`;
    const r = await fetch(url, {
      method: "POST",
      headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
      body: JSON.stringify({ values: filas }),
    });
    if (!r.ok) throw new Error("No se pudo escribir el historial (código " + r.status + ").");
    return r.json();
  }
  // Crea la hoja + encabezados si falta, y anexa las filas dadas.
  async function escribirHistorial(token, hoja, filas, encabezados) {
    const info = await leerHistorialRaw(token, hoja);
    if (!info.existe) { await crearHoja(token, hoja); await anexarFilas(token, hoja, [encabezados]); }
    else if (!info.filas.length) { await anexarFilas(token, hoja, [encabezados]); }
    await anexarFilas(token, hoja, filas);
  }

  // Id numérico (gid) de una pestaña por su nombre. Necesario para eliminar filas.
  async function obtenerSheetId(token, hoja) {
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${CFG.SHEET_ID}?fields=sheets(properties(sheetId,title))`;
    const r = await fetch(url, { headers: { Authorization: "Bearer " + token } });
    if (!r.ok) throw new Error("No se pudo leer la estructura del Sheet (código " + r.status + ").");
    const data = await r.json();
    const s = (data.sheets || []).find((x) => x.properties && x.properties.title === hoja);
    return s ? s.properties.sheetId : null;
  }
  // Elimina por completo la fila cuyo Timestamp (col A) coincide con ts (deleteDimension: corre el resto hacia arriba).
  async function borrarFilaHistorial(token, hoja, ts) {
    const info = await leerHistorialRaw(token, hoja);
    if (!info.existe) return false;
    const filas = info.filas || [];
    let idx = -1;
    for (let i = 0; i < filas.length; i++) {
      if (String((filas[i] || [])[0]).trim() === String(ts).trim()) { idx = i; break; }
    }
    if (idx < 0) return false; // ya no está
    const sheetId = await obtenerSheetId(token, hoja);
    if (sheetId == null) return false;
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${CFG.SHEET_ID}:batchUpdate`;
    const body = { requests: [{ deleteDimension: { range: { sheetId: sheetId, dimension: "ROWS", startIndex: idx, endIndex: idx + 1 } } }] };
    const r = await fetch(url, { method: "POST", headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (!r.ok) throw new Error("No se pudo eliminar la fila del historial (código " + r.status + ").");
    return true;
  }

  global.SheetsCIBSA = { cargarTelas, cargarVendedores, cargarMateriales, cargarWiki, leerHistorialRaw, escribirHistorial, borrarFilaHistorial, parseNumero };
})(typeof window !== "undefined" ? window : globalThis);
