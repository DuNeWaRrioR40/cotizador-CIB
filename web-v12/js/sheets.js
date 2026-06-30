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

  // Normaliza encabezados para comparar: quita acentos/diacríticos, colapsa espacios y baja a minúsculas.
  // Así "Unidad Mínima" calza con "Unidad Minima", "Categoría" con "Categoria", etc.
  function norm(s) { return String(s).normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim().toLowerCase(); }

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

  // Telas confeccionables: se leen del catálogo (VIGENTES, vía el puntero "Granel") las filas con
  // Categoria = Tela y Variedad = M.LINEAL. El valor por m² se deriva: Precio (por metro lineal) ÷
  // ancho de rollo (columna AnchoRollo, ya extraída del Formato). Nombre = Proveedor · Modelo · Formato.
  async function cargarTelas(token) {
    const punteros = await leerRango(token);
    const ptr = punteros.find((p) => p.id.toLowerCase() === CFG.ID_TABLA_GRANEL.toLowerCase());
    if (!ptr) throw new Error(`No se encontró en RANGO una fila con ID '${CFG.ID_TABLA_GRANEL}'.`);
    const { encabezados, registros } = await leerTabla(token, ptr.hoja, ptr.rango);
    const C = CFG.COL_GRANEL, idx = {};
    ["categoria", "variedad", "proveedor", "tipo", "modelo", "formato", "precio", "anchoRollo", "specs", "fav", "unidadMinima"].forEach((k) => { idx[k] = buscarColumna(encabezados, C[k]); });
    const get = (r, k) => { const i = idx[k]; return (i !== -1 ? (r[encabezados[i]] || "") : "").trim(); };
    const esTela = (s) => norm(s) === "tela";
    const esMLineal = (s) => /lineal/.test(norm(s));   // "M.LINEAL", "metro lineal", etc.
    // Una misma tela puede tener M.LINEAL en GRANEL (venta por metro) y en CONFECCION. El selector de
    // confección debe usar el precio de CONFECCION; si no existe, cae al M.LINEAL que haya. Dedup por
    // nombre prefiriendo CONFECCION.
    const mapa = {};
    for (const r of registros) {
      if (!esTela(get(r, "categoria")) || !esMLineal(get(r, "variedad"))) continue;
      const proveedor = get(r, "proveedor"), tipo = get(r, "tipo"), modelo = get(r, "modelo"), formato = get(r, "formato");
      // nombre: incluye el proveedor (USO INTERNO en la App). nombreCliente: SIN proveedor (es el que va al PDF).
      const nombre = [proveedor, tipo, modelo, formato].filter(Boolean).join(" · ");
      const nombreCliente = [tipo, modelo, formato].filter(Boolean).join(" · ");
      if (!nombre) continue;
      const precioML = parseNumero(get(r, "precio"));
      const ancho = parseNumero(get(r, "anchoRollo"));
      if (precioML == null || ancho == null || ancho <= 0) continue;   // sin precio o sin ancho de rollo: no se puede valorizar por m²
      const ficha = get(r, "specs").split(/[\r\n]+/).map((s) => s.trim()).filter(Boolean);
      const favCats = get(r, "fav").split("/").map((s) => s.trim()).filter(Boolean);
      const umin = norm(get(r, "unidadMinima")), esConf = (umin === "confeccion" || umin === "conf");
      const tela = { nombre, nombreCliente, valorM2: precioML / ancho, anchoRollo: ancho, ficha, proveedor, tipo, fav: favCats, unidadMinima: get(r, "unidadMinima") };
      const key = nombre.toLowerCase(), prev = mapa[key];
      if (!prev || (esConf && !prev.esConf)) mapa[key] = { tela: tela, esConf: esConf };   // CONFECCION gana
    }
    const telas = Object.keys(mapa).map((k) => mapa[k].tela);
    if (!telas.length) throw new Error("VIGENTES no tiene filas válidas Categoria=Tela y Variedad=M.LINEAL (con Precio y ancho de rollo). Encabezados: " + encabezados.join(" | "));
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

  // Productos a granel: lee la pestaña referenciada en RANGO con ID 'Granel'. No rompe si no existe.
  async function cargarGranel(token) {
    const punteros = await leerRango(token);
    const ptr = punteros.find((p) => p.id.toLowerCase() === CFG.ID_TABLA_GRANEL.toLowerCase());
    if (!ptr) return [];
    const { encabezados, registros } = await leerTabla(token, ptr.hoja, ptr.rango);
    const C = CFG.COL_GRANEL, idx = {};
    Object.keys(C).forEach((k) => { idx[k] = buscarColumna(encabezados, C[k]); });
    const get = (r, k) => { const i = idx[k]; return (i !== -1 ? (r[encabezados[i]] || "") : "").trim(); };
    const out = [];
    registros.forEach((r) => {
      const activo = get(r, "activo");
      if (activo && /^(no|0|false|inactivo)$/i.test(activo)) return;   // fila desactivada
      const categoria = get(r, "categoria");
      if (!categoria) return;   // mínimo: categoría
      out.push({
        categoria, proveedor: get(r, "proveedor"),                       // proveedor INTERNO
        tipo: get(r, "tipo"), variedad: get(r, "variedad"), modelo: get(r, "modelo"),
        equiv: get(r, "equiv"),                                          // clave de equivalencia (interna)
        unidad: get(r, "unidad") || "unidad",
        precio: parseNumero(get(r, "precio")),                           // venta neto; null si vacío
        anchoRollo: parseNumero(get(r, "anchoRollo")),                   // opcional, para $/m²
        specs: get(r, "specs"), nombreCliente: get(r, "nombreCliente"), notas: get(r, "notas"),
        sku: get(r, "sku"),                                              // llave única por fila (interna)
        precioBase: parseNumero(get(r, "precioBase")),                   // precio del primer registro (variación)
        fechaActualizacion: get(r, "fechaActualizacion"),               // dd/mm/aaaa (freshness)
        fechaBase: get(r, "fechaBase"),                                 // dd/mm/aaaa (origen de la variación)
        formato: get(r, "formato"),                                      // formato de venta (interno)
        peso: get(r, "peso"),                                            // peso/tamaño (interno, opcional)
        largo: get(r, "largo"),                                          // largo (p. ej. venta por metro)
        color: get(r, "color"), materialidad: get(r, "materialidad"),    // atributos descriptivos
        fav: get(r, "fav").split("/").map((s) => s.trim()).filter(Boolean), // categorías FAV (varias con "/")
        // divisible = GRANEL (acepta decimales); por defecto/UNITARIO = false (cantidad entera). Mín 1 siempre.
        divisible: /granel/i.test(get(r, "unidadMinima")),
        // Campos del modelo de costeo (para clonar productos/estados en el panel de facturas):
        unidadMinima: get(r, "unidadMinima"), parent: get(r, "parent"),
        rendimiento: parseNumero(get(r, "rendimiento")), codMaterialBase: get(r, "codMaterialBase"),
      });
    });
    return out;
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

  // --- Correlativo: marca de máximo histórico ("high-water-mark") ---
  // Vive en H1:I1 de la hoja HISTORIAL (H1 = rótulo, I1 = número), FUERA del rango de datos A:G,
  // por lo que NUNCA se altera al borrar filas del historial. Solo sube; sobrevive al borrado del
  // último registro y se concilia entre dispositivos. Best-effort: si la hoja aún no existe, devuelve 0.
  async function leerCorrelMax(token, hoja) {
    const rango = `'${hoja}'!I1`;
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${CFG.SHEET_ID}/values/` +
      `${encodeURIComponent(rango)}?valueRenderOption=UNFORMATTED_VALUE`;
    const r = await fetch(url, { headers: { Authorization: "Bearer " + token } });
    if (!r.ok) return 0; // 400 = hoja inexistente; cualquier otro error: tratamos como sin marca
    const data = await r.json();
    const v = data.values && data.values[0] && data.values[0][0];
    const n = parseInt(v, 10);
    return (n && n > 0) ? n : 0;
  }
  async function guardarCorrelMax(token, hoja, n) {
    n = parseInt(n, 10); if (!n || n <= 0) return false;
    const rango = `'${hoja}'!H1:I1`;
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${CFG.SHEET_ID}/values/` +
      `${encodeURIComponent(rango)}?valueInputOption=RAW`;
    const r = await fetch(url, {
      method: "PUT",
      headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
      body: JSON.stringify({ values: [["Correl.Máx", n]] }),
    });
    if (!r.ok) throw new Error("No se pudo guardar el correlativo máximo (código " + r.status + ").");
    return true;
  }

  // --- Carga de facturas: lectores de PROVEEDORES y FACTOR + append genérico ---
  async function cargarProveedores(token) {
    const hoja = CFG.HOJA_PROVEEDORES || "PROVEEDORES";
    let res; try { res = await leerTabla(token, hoja, "A:C"); } catch (e) { return []; }
    const { encabezados, registros } = res;
    const C = CFG.COL_PROVEEDOR, idx = {};
    Object.keys(C).forEach((k) => { idx[k] = buscarColumna(encabezados, C[k]); });
    const get = (r, k) => { const i = idx[k]; return (i !== -1 ? (r[encabezados[i]] || "") : "").trim(); };
    return registros.map((r) => ({ rut: get(r, "rut"), razon: get(r, "razon"), nombreCorto: get(r, "nombreCorto") }))
      .filter((p) => p.rut);
  }
  async function cargarFactores(token) {
    const hoja = CFG.HOJA_FACTOR || "FACTOR";
    let res; try { res = await leerTabla(token, hoja, "A:E"); } catch (e) { return []; }
    const { encabezados, registros } = res;
    const C = CFG.COL_FACTOR, idx = {};
    Object.keys(C).forEach((k) => { idx[k] = buscarColumna(encabezados, C[k]); });
    const get = (r, k) => { const i = idx[k]; return (i !== -1 ? (r[encabezados[i]] || "") : "").trim(); };
    return registros.map((r) => ({ categoria: get(r, "categoria"), variedad: get(r, "variedad"), unidadMinima: get(r, "unidadMinima"), factor: parseNumero(get(r, "factor")), tipo: get(r, "tipo") }))
      .filter((f) => f.categoria || f.variedad);
  }
  // Append genérico: agrega filas al final de la tabla de una hoja (cualquier ancho). No crea encabezados.
  async function anexarHoja(token, hoja, filas) {
    if (!filas || !filas.length) return;
    const rango = `'${hoja}'!A1`;
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${CFG.SHEET_ID}/values/` +
      `${encodeURIComponent(rango)}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`;
    const r = await fetch(url, {
      method: "POST",
      headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
      body: JSON.stringify({ values: filas }),
    });
    if (!r.ok) throw new Error("No se pudo escribir en " + hoja + " (código " + r.status + ").");
    return r.json();
  }

  // Append a GRANEL SIN tocar la columna de fórmula (PrecioCalc, a la derecha). En vez de values.append con
  // INSERT_ROWS (que inserta filas en blanco sin la fórmula arrastrada), calcula la primera fila libre
  // mirando la columna A y ESCRIBE el bloque A{n}:AE{n} con values.batchUpdate. No inserta ni desplaza,
  // así la fórmula de PrecioCalc (ya arrastrada hacia abajo) queda intacta y se calcula sola.
  async function anexarGranel(token, filas) {
    if (!filas || !filas.length) return;
    const hoja = CFG.HOJA_GRANEL_MAESTRO || "GRANEL";
    let colA = [];
    try { colA = await leerValores(token, `'${hoja}'!A:A`); } catch (e) { colA = []; }
    const nextRow = (colA ? colA.length : 0) + 1;   // values.get omite filas vacías al final → última con datos en A
    return actualizarCeldas(token, hoja, [{ rango: "A" + nextRow, valores: filas }]);
  }

  // Lista de UNIDADES de medida válidas (tabla FACTOR!G:I → Código · Nombre · Magnitud).
  async function cargarUnidades(token) {
    let res; try { res = await leerTabla(token, CFG.HOJA_FACTOR || "FACTOR", "G:I"); } catch (e) { return []; }
    const { encabezados, registros } = res;
    const iCod = buscarColumna(encabezados, "Código"), iNom = buscarColumna(encabezados, "Nombre");
    const get = (r, i) => (i !== -1 ? (r[encabezados[i]] || "") : "").trim();
    return registros.map((r) => ({ codigo: get(r, iCod), nombre: get(r, iNom) })).filter((u) => u.codigo);
  }

  // --- Fusión canónica (maestro): leer crudo con números de fila + actualizar celdas puntuales ---
  async function leerHojaRaw(token, hoja, rango) {
    try { return await leerValores(token, `'${hoja}'!${rango}`); } catch (e) { return []; }
  }
  // updates = [{ rango: "A5", valores: [["x"]] }, ...]; escribe celdas/rangos puntuales (batch).
  async function actualizarCeldas(token, hoja, updates) {
    if (!updates || !updates.length) return;
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${CFG.SHEET_ID}/values:batchUpdate`;
    const data = updates.map((u) => ({ range: `'${hoja}'!${u.rango}`, values: u.valores }));
    const r = await fetch(url, {
      method: "POST",
      headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
      body: JSON.stringify({ valueInputOption: "USER_ENTERED", data: data }),
    });
    if (!r.ok) throw new Error("No se pudieron actualizar celdas en " + hoja + " (código " + r.status + ").");
    return r.json();
  }

  global.SheetsCIBSA = { cargarTelas, cargarVendedores, cargarMateriales, cargarGranel, cargarWiki, leerHistorialRaw, escribirHistorial, borrarFilaHistorial, leerCorrelMax, guardarCorrelMax, cargarProveedores, cargarFactores, cargarUnidades, anexarHoja, anexarGranel, leerHojaRaw, actualizarCeldas, parseNumero };
})(typeof window !== "undefined" ? window : globalThis);
