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

  // dd/mm/aaaa (o con - .) → entero comparable aaaammdd (0 si vacía/ilegible).
  function fechaVal(s) {
    const m = String(s || "").trim().match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/);
    if (!m) return 0;
    const y = m[3].length === 2 ? "20" + m[3] : m[3];
    return parseInt(y, 10) * 10000 + parseInt(m[2], 10) * 100 + parseInt(m[1], 10);
  }
  // Precio efectivo — "la factura manda si existe": si hay PrecioCalc con valor (> 0, = costo desde
  // COSTOS/factura), gana la factura; si viene vacío o 0, se usa el Precio manual (setup / productos sin
  // compra). El manual es un placeholder que la primera factura del material reemplaza, sin importar fechas.
  function precioEfectivo(manual, calc) {
    return (calc != null && calc > 0) ? calc : manual;
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
    ["categoria", "variedad", "proveedor", "tipo", "modelo", "formato", "precio", "precioCalc", "anchoRollo", "specs", "fav", "unidadMinima", "vigentes", "fechaActualizacion", "fechaFactura", "fechaCosto", "fechaPrecio"].forEach((k) => { idx[k] = buscarColumna(encabezados, C[k]); });
    const get = (r, k) => { const i = idx[k]; return (i !== -1 ? (r[encabezados[i]] || "") : "").trim(); };
    const esTela = (s) => norm(s) === "tela";
    const esMLineal = (s) => /lineal/.test(norm(s));   // "M.LINEAL", "metro lineal", etc.
    // Confección y metro comparten el MISMO precio de lista (costo × factor): una tela = un precio.
    // La diferencia "vender sin confección" es un descuento de canal (carrito de granel), no un precio aparte.
    // Por eso ya no hay preferencia por CONFECCION: se toma la fila M.LINEAL del material (dedup por nombre,
    // primera que aparezca; los precios de las filas de un mismo material están homologados en el Sheet).
    const mapa = {};
    for (const r of registros) {
      if (!esTela(get(r, "categoria")) || !esMLineal(get(r, "variedad"))) continue;
      // Respeta el flag Vigentes de GRANEL: descarta las filas marcadas 0 (no vigentes).
      // Conserva 1 y las legacy en blanco (telas viejas sin SKU/flag).
      if (String(get(r, "vigentes")).trim() === "0") continue;
      const proveedor = get(r, "proveedor"), tipo = get(r, "tipo"), modelo = get(r, "modelo"), formato = get(r, "formato");
      // nombre: incluye el proveedor (USO INTERNO en la App). nombreCliente: SIN proveedor (es el que va al PDF).
      const nombre = [proveedor, tipo, modelo, formato].filter(Boolean).join(" · ");
      const nombreCliente = [tipo, modelo, formato].filter(Boolean).join(" · ");
      if (!nombre) continue;
      // Precio efectivo por m lineal — "la factura manda si existe": si hay PrecioCalc (costo de factura),
      // gana la factura; si no hay factura, se usa el Precio manual (placeholder del setup).
      const precioML = precioEfectivo(parseNumero(get(r, "precio")), parseNumero(get(r, "precioCalc")));
      const ancho = parseNumero(get(r, "anchoRollo"));
      if (precioML == null || ancho == null || ancho <= 0) continue;   // sin precio o sin ancho de rollo: no se puede valorizar por m²
      const ficha = get(r, "specs").split(/[\r\n]+/).map((s) => s.trim()).filter(Boolean);
      const favCats = get(r, "fav").split("/").map((s) => s.trim()).filter(Boolean);
      const tela = { nombre, nombreCliente, valorM2: precioML / ancho, anchoRollo: ancho, ficha, proveedor, tipo, fav: favCats, unidadMinima: get(r, "unidadMinima") };
      // Recencia de FILA (dedup por Vigentes): fecha de FACTURA si existe, si no Fecha Actualización. Ante
      // varias filas del mismo material (misma llave = nombre), gana la MÁS RECIENTE, no la primera.
      const fecha = fechaVal(get(r, "fechaFactura")) || fechaVal(get(r, "fechaActualizacion"));
      const key = nombre.toLowerCase();
      const prev = mapa[key];
      if (!prev || fecha > prev.fecha) mapa[key] = { tela: tela, fecha: fecha };   // última versión por material
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
        rol: get(r, "rol"),                                              // supra-categoría: INSUMO/ACCESORIO/ESTRUCTURAL (aún no enruta; se lee para la reestructuración)
        tipo: get(r, "tipo"), variedad: get(r, "variedad"), modelo: get(r, "modelo"),
        equiv: get(r, "equiv"),                                          // clave de equivalencia (interna)
        unidad: get(r, "unidad") || "unidad",
        // Precio efectivo — "la factura manda si existe": PrecioCalc (factura) si existe, si no el manual.
        precio: precioEfectivo(parseNumero(get(r, "precio")), parseNumero(get(r, "precioCalc"))),
        precioManual: parseNumero(get(r, "precio")),                     // solo el Precio escrito a mano (Visor/depuración)
        precioCalc: parseNumero(get(r, "precioCalc")),                   // solo la fórmula (Visor/depuración)
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
        // divisible = GRANEL o CONFECCION/CONF (aceptan decimales; material vendido por medida); UNITARIO = false (entero). Mín 1 siempre.
        divisible: /granel|conf/i.test(get(r, "unidadMinima")),
        // Campos del modelo de costeo (para clonar productos/estados en el panel de facturas):
        unidadMinima: get(r, "unidadMinima"), parent: get(r, "parent"),
        rendimiento: parseNumero(get(r, "rendimiento")), codMaterialBase: get(r, "codMaterialBase"),
      });
    });
    return out;
  }

  // Deriva la lista de "materiales" (Insumo / Accesorio / Estructural) desde los productos de GRANEL, usando la
  // columna Rol. Fuente UNIFICADA: el Panel (carga de facturas) alimenta GRANEL, y estos ítems aparecen en los
  // selectores de complementos y de cintas/straps. Mapa acordado: item←Tipo, ancho(cm)←Modelo, precio←p.precio
  // (que ya es PrecioCalc cuando el Precio manual está vacío), agrupación←Categoria. proveedor es INTERNO.
  function materialesDesdeGranel(granel) {
    const roles = { insumo: 1, accesorio: 1, estructural: 1 };
    const out = [];
    (granel || []).forEach((p) => {
      if (!p || !roles[norm(p.rol)]) return;   // solo filas con Rol Insumo/Accesorio/Estructural (telas y granel puro tienen Rol vacío)
      if (/rollo/i.test(p.variedad || "")) return;   // el ROLLO completo no alimenta confección (sí se vende en "venta a granel", que lee state.granel directo)
      out.push({
        categoria: p.categoria, item: p.tipo || p.modelo || p.categoria, modelo: p.modelo, color: p.color,
        precio: (p.precio != null ? p.precio : null), unidad: p.unidad || "unidad", proveedor: p.proveedor, rol: p.rol,
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
  // Borra TODAS las filas cuyo cliente+apellido+tipo+versión coincidan con `ent` (no solo un ts).
  // Necesario porque cada generación APENDE una fila: una misma cotización puede tener varias filas.
  // Devuelve cuántas borró. Elimina de mayor a menor índice para no desplazar las anteriores.
  async function borrarFilasHistorialClave(token, hoja, ent) {
    const info = await leerHistorialRaw(token, hoja);
    if (!info.existe) return 0;
    const filas = info.filas || [];
    const norm = (s) => (s == null ? "" : String(s)).trim().toLowerCase();
    const ver = (v) => parseInt(v, 10) || 1;
    const idxs = [];
    for (let i = 0; i < filas.length; i++) {
      const r = filas[i] || [];
      if (r[0] == null || isNaN(parseInt(r[0], 10))) continue; // salta encabezado / filas vacías
      if (norm(r[1]) === norm(ent.nombre) && norm(r[2]) === norm(ent.apellido) &&
          norm(r[3]) === norm(ent.tipo) && ver(r[4]) === ver(ent.version)) idxs.push(i);
    }
    if (!idxs.length) return 0;
    const sheetId = await obtenerSheetId(token, hoja);
    if (sheetId == null) return 0;
    const requests = idxs.sort((a, b) => b - a).map((i) => ({ deleteDimension: { range: { sheetId: sheetId, dimension: "ROWS", startIndex: i, endIndex: i + 1 } } }));
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${CFG.SHEET_ID}:batchUpdate`;
    const r = await fetch(url, { method: "POST", headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" }, body: JSON.stringify({ requests: requests }) });
    if (!r.ok) throw new Error("No se pudo eliminar del historial (código " + r.status + ").");
    return idxs.length;
  }
  // "Reemplaza" en el Sheet: borra las filas de la misma clave de `ent` y anexa la fila nueva.
  // Así el historial en la nube guarda UNA fila por cotización (cliente+tipo+versión), sin acumular.
  async function reemplazarHistorial(token, hoja, ent, filaRow, encabezados) {
    try { await borrarFilasHistorialClave(token, hoja, ent); } catch (e) { /* best-effort: si falla, igual anexa */ }
    return escribirHistorial(token, hoja, [filaRow], encabezados);
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
  // mirando la columna A y ESCRIBE el bloque A{n}:AF{n} con values.batchUpdate. No inserta ni desplaza,
  // así la fórmula de PrecioCalc (ya arrastrada hacia abajo) queda intacta y se calcula sola.
  async function anexarGranel(token, filas) {
    if (!filas || !filas.length) return;
    const hoja = CFG.HOJA_GRANEL_MAESTRO || "GRANEL";
    let colA = [];
    try { colA = await leerValores(token, `'${hoja}'!A:A`); } catch (e) { colA = []; }
    const nextRow = (colA ? colA.length : 0) + 1;   // values.get omite filas vacías al final → última con datos en A
    // Columnas que se escriben como FÓRMULA por fila (no como texto/literal), para que queden 100% fórmula:
    //  - Vigentes: dedup por SKU/fecha (evita "zombis" al recargar un SKU).
    //  - Specs: ficha técnica desde la pestaña FICHAS por Proveedor+Tipo+Modelo (una ficha por material).
    const orden = CFG.GRANEL_ORDEN || [];
    const inyecciones = [{ col: "Vigentes", tpl: CFG.VIGENTES_FORMULA_TPL }, { col: "Specs", tpl: CFG.SPECS_FORMULA_TPL }]
      .map((x) => ({ idx: orden.indexOf(x.col), tpl: x.tpl })).filter((x) => x.tpl && x.idx !== -1);
    if (inyecciones.length) {
      filas = filas.map((row, i) => { const r = row.slice(), fila = String(nextRow + i); inyecciones.forEach((x) => { r[x.idx] = x.tpl.replace(/\{FILA\}/g, fila); }); return r; });
    }
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

  global.SheetsCIBSA = { cargarTelas, cargarVendedores, cargarMateriales, materialesDesdeGranel, cargarGranel, cargarWiki, leerHistorialRaw, escribirHistorial, borrarFilaHistorial, borrarFilasHistorialClave, reemplazarHistorial, leerCorrelMax, guardarCorrelMax, cargarProveedores, cargarFactores, cargarUnidades, anexarHoja, anexarGranel, leerHojaRaw, actualizarCeldas, parseNumero };
})(typeof window !== "undefined" ? window : globalThis);
