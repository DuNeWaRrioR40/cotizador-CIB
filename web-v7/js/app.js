/* Controlador de la app web Cotizador CIBSA. */
(function () {
  const $ = (id) => document.getElementById(id);
  const CFG = window.CONFIG;
  const money = window.CalcCIBSA.money;

  const state = {
    telas: [], orientaciones: null, orientacionSel: "mayor", orientUnif: "largo",
    ojMode: "total", ojTotal: 8, ojSubstate: "count", ojAristasN: 4,
    ojAristas: [], ojEdges: null, ojParejo: false, ojError: "", trasUnif: false, ultimoPdf: null, progTimer: null, progVal: 0,
    docMode: "formal", prodMode: "uniforme", prelim: [], vendedores: [], materiales: [], wikiAyuda: {}, factorUnif: "1",
    piezas: [], compuesto: null, closeTimer: null, closeIntv: null, complementosUnif: [], cortesUnif: [],
    backCortesUnif: [], backComplementosUnif: [], aletasUnif: [], backAletasUnif: [], strapsUnif: [],
    // v4: bordes y unión (uniforme)
    bordeModo: "uniforme", bordeValor: "0.045",
    bordes: {
      sup: { tipo: "borde", valor: "0.045", diam: "" },
      inf: { tipo: "borde", valor: "0.045", diam: "" },
      izq: { tipo: "borde", valor: "0.045", diam: "" },
      der: { tipo: "borde", valor: "0.045", diam: "" },
    },
    loteUnif: null,
  };
  let piezaSeq = 0;
  const BORDE_DEFAULTS = { borde: 0.045, unionCierre: 0.045 };
  // Aviso si un Ø (bolsillo / borde+cuerda) parece estar en cm en vez de metros.
  const avisoDiamGrande = (valor) => {
    const d = window.CalcCIBSA.evalExpr(valor);
    return (d != null && !isNaN(d) && d >= 1)
      ? "⚠ Ø de " + d + " m es muy grande. ¿Lo pusiste en cm? En metros: 10 cm = 0,10."
      : "";
  };

  const esc = (s) => String(s).replace(/[&<>"]/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  // ---------- Visibilidad por modo (Formal-Uniforme / Formal-Compuesto / Preliminar) ----------
  function show(id, on) { const el = $(id); if (el) el.classList.toggle("hidden", !on); }
  function aplicarVis() {
    const f = state.docMode === "formal";
    const p = state.docMode === "preliminar";
    const uni = f && state.prodMode === "uniforme";
    const comp = f && state.prodMode === "compuesto";
    show("wCliente", f);
    show("wHistorial", f);
    show("wProdToggle", f);
    show("wDimensiones", uni || p);
    show("wCantidad", uni);
    show("wTelaUnica", uni);
    show("telaMultiWrap", p);
    show("wPiezas", comp);
    show("piezasResumenBottom", comp);
    show("wTitulo", f);
    show("wPlanoToggle", f);
    show("wOjetillos", uni || p);
    show("wValorOj", uni || p || comp);
    show("wBordes", uni);
    show("wComplementosUnif", uni);
    show("wAletasUnif", uni);
    show("wStrapsUnif", uni);
    show("wFactorTop", f); // acceso rápido al factor dentro de la sección Producto
    show("wFactorUnif", f); // factor único por producto: visible en uniforme y compuesto
    show("wCortesUnif", uni);
    show("wCondiciones", f);
    show("wObservaciones", f);
    show("wOrientFormal", uni);
    show("wSketchUnif", uni);
    show("prelimOrientWrap", p);
    show("prelimPreview", p);
    show("modePreliminarHint", p);
    $("btnGenerar").textContent = p ? "Generar Valor Preliminar (PDF)"
      : comp ? "Generar cotización compuesta (PDF)" : "Generar cotización (PDF)";
  }
  function aplicarModo(m) { state.docMode = m; aplicarVis(); recompute(); }
  function aplicarProd(m) {
    state.prodMode = m;
    if (m === "compuesto" && state.piezas.length === 0) addPieza();
    aplicarVis(); recompute();
  }
  document.querySelectorAll('input[name="docmode"]').forEach((r) =>
    r.addEventListener("change", (e) => aplicarModo(e.target.value)));
  document.querySelectorAll('input[name="prodmode"]').forEach((r) =>
    r.addEventListener("change", (e) => aplicarProd(e.target.value)));

  // ---------- Historial local de cotizaciones (localStorage, últimos 30 días) ----------
  const HIST_KEY = "cibsa_hist_v1", HIST_DIAS = 3650, HIST_MAX = 60; // 3650: con sincronización en la nube no se purga por tiempo
  const HIST_HOJA = (CFG.HOJA_HISTORIAL || "HISTORIAL");
  const HIST_ENC = ["Timestamp", "Nombre", "Apellido", "Tipo", "Version", "Fecha", "Datos(JSON)"];
  function entryToRow(e) { return [e.ts, e.nombre || "", e.apellido || "", e.tipo || "", parseInt(e.version, 10) || 1, e.fecha || "", JSON.stringify(e.snap || null)]; }
  function rowToEntry(r) {
    const ts = parseInt(r && r[0], 10) || 0; if (!ts) return null; // descarta encabezado / filas inválidas
    let snap = null; try { snap = r[6] ? JSON.parse(r[6]) : null; } catch (e) {}
    const est = (snap && snap.estado) || {};
    return { ts: ts, nombre: (r[1] || "").toString().trim(), apellido: (r[2] || "").toString().trim(), tipo: (r[3] || "").toString().trim(), version: parseInt(r[4], 10) || 1, fecha: (r[5] || "").toString().trim(), snap: snap, modo: est.docMode || "formal", prod: est.prodMode || "uniforme" };
  }
  // Une historial local + remoto (Sheet), deduplica por cliente+tipo (mayor versión / ts más reciente),
  // sube al Sheet las entradas locales que aún no estén allí (migración), y deja el resultado en localStorage.
  function sincronizarHistorial(token, remotas) {
    const locales = histLoad();
    const tsRemotos = new Set((remotas || []).map((e) => e.ts));
    const faltan = locales.filter((e) => e && e.ts && e.snap && !tsRemotos.has(e.ts));
    if (faltan.length && token) {
      window.SheetsCIBSA.escribirHistorial(token, HIST_HOJA, faltan.map(entryToRow), HIST_ENC)
        .catch((e) => console.warn("CIBSA: no se pudo migrar el historial local al Sheet —", e && e.message ? e.message : e));
    }
    const porClave = {};
    (remotas || []).concat(locales).forEach((e) => {
      if (!e || !e.ts) return;
      const k = (e.nombre || "").trim().toLowerCase() + "|" + (e.apellido || "").trim().toLowerCase() + "|" + e.tipo + "|" + (parseInt(e.version, 10) || 1);
      const prev = porClave[k];
      if (!prev || e.ts >= prev.ts) porClave[k] = e; // misma versión: conserva la generación más reciente
    });
    const merged = Object.keys(porClave).map((k) => porClave[k]).sort((a, b) => (b.ts || 0) - (a.ts || 0)).slice(0, HIST_MAX);
    histStore(merged);
  }
  function histLoad() { try { const a = JSON.parse(localStorage.getItem(HIST_KEY) || "[]"); return Array.isArray(a) ? a : []; } catch (e) { return []; } }
  function histStore(arr) {
    try { localStorage.setItem(HIST_KEY, JSON.stringify(arr)); return true; }
    catch (e) { // cuota excedida: recorta los más antiguos y reintenta
      let a = arr.slice();
      while (a.length > 1) { a = a.slice(0, Math.max(1, Math.floor(a.length / 2))); try { localStorage.setItem(HIST_KEY, JSON.stringify(a)); return true; } catch (e2) {} }
      return false;
    }
  }
  function histPrune(arr) { const lim = Date.now() - HIST_DIAS * 86400000; return arr.filter((e) => e && e.ts >= lim); }
  function histTipo() { return state.docMode === "preliminar" ? "Preliminar" : (state.prodMode === "compuesto" ? "Compuesto" : "Uniforme"); }
  function histFechaCorta(d) { return ("0" + d.getDate()).slice(-2) + "/" + ("0" + (d.getMonth() + 1)).slice(-2); }

  // --- Snapshot/restauración COMPLETA del diseño (memoria de la cotización) ---
  const SNAP_CAMPOS = ["f_nombre", "f_apellido", "f_email", "f_largo", "f_ancho", "f_titulo", "f_color", "f_observaciones", "f_cantidad", "f_ojvalor", "f_dias", "f_descuento", "f_union", "f_altura", "f_version"];
  const SNAP_STATE = ["orientacionSel", "orientUnif", "ojMode", "ojTotal", "ojSubstate", "ojAristasN", "ojAristas", "ojEdges", "ojParejo", "trasUnif", "docMode", "prodMode", "complementosUnif", "cortesUnif", "backCortesUnif", "backComplementosUnif", "aletasUnif", "backAletasUnif", "strapsUnif", "bordeModo", "bordeValor", "bordes", "piezas", "factorUnif"];
  function snapshotCotizacion() {
    const campos = {}; SNAP_CAMPOS.forEach((id) => { const el = $(id); if (el) campos[id] = el.value; });
    const st = {}; SNAP_STATE.forEach((k) => { st[k] = state[k]; });
    const snap = { campos: campos, usaAlto: $("f_usaAlto") ? $("f_usaAlto").checked : false, telaUnif: $("f_tela") ? $("f_tela").value : "", vendedor: $("f_vendedor") ? $("f_vendedor").value : "", estado: st };
    try { return JSON.parse(JSON.stringify(snap)); } catch (e) { return null; }
  }
  function setSelectIfOption(id, val) { const sel = $(id); if (!sel || val == null) return; if (Array.from(sel.options).some((o) => o.value === val)) sel.value = val; }
  function bumpSeqs() {
    const maxId = (arr, pref) => (arr || []).reduce((m, e) => { const n = parseInt(String((e && e.id) || "").replace(pref, ""), 10); return (n && n > m) ? n : m; }, 0);
    const P = state.piezas || []; let insM = 0, alM = 0, cutM = 0;
    let pzM = maxId(P, "pz");
    cutM = Math.max(maxId(state.cortesUnif, "cut"), maxId(state.backCortesUnif, "cut"));
    alM = Math.max(maxId(state.aletasUnif, "al"), maxId(state.backAletasUnif, "al"));
    P.forEach((p) => {
      insM = Math.max(insM, maxId(p.inscritos, "ins"));
      alM = Math.max(alM, maxId(p.aletas, "al"), maxId(p.backAletas, "al"));
      cutM = Math.max(cutM, maxId(p.cortes, "cut"), maxId(p.backCortes, "cut"));
    });
    piezaSeq = Math.max(piezaSeq, pzM); inscritoSeq = Math.max(inscritoSeq, insM);
    aletaSeq = Math.max(aletaSeq, alM); corteSeq = Math.max(corteSeq, cutM);
  }
  function restaurarCotizacion(snap) {
    if (!snap) return false;
    limpiarCampos(); // base limpia
    const st = snap.estado || {};
    SNAP_STATE.forEach((k) => { if (k in st) { try { state[k] = JSON.parse(JSON.stringify(st[k])); } catch (e) {} } });
    Object.keys(snap.campos || {}).forEach((id) => { const el = $(id); if (el) el.value = snap.campos[id]; });
    setSelectIfOption("f_tela", snap.telaUnif);
    setSelectIfOption("f_vendedor", snap.vendedor);
    if ($("f_usaAlto")) { $("f_usaAlto").checked = !!snap.usaAlto; if ($("wAltura")) $("wAltura").classList.toggle("hidden", !snap.usaAlto); }
    if ($("f_trasUnif")) $("f_trasUnif").checked = !!state.trasUnif;
    const setRadio = (name, val) => { const r = document.querySelector('input[name="' + name + '"][value="' + val + '"]'); if (r) r.checked = true; };
    setRadio("docmode", state.docMode); setRadio("prodmode", state.prodMode);
    setRadio("ojmode", state.ojMode); setRadio("bordemodo", state.bordeModo);
    bumpSeqs();
    renderPiezas(); renderBordes(); renderComplementosUnif(); renderCortesUnif(); renderAletasUnif(); renderStrapsUnif(); renderTraseraUnif();
    renderOjetillos(); setFactorUnifUI(); aplicarVis(); recompute();
    return true;
  }

  // --- Borrador automático (anti-pérdida de datos en iPhone al descargar un PDF) ---
  // iOS puede descartar de memoria la pestaña al abrir el PDF y recargarla al volver.
  // Guardamos el estado justo antes de descargar y lo reponemos al recargar (ventana corta, un solo uso).
  const BORR_KEY = "cibsa_borrador_v1", BORR_MAX_MS = 10 * 60 * 1000;
  function guardarBorrador() {
    try {
      const snap = snapshotCotizacion(); if (!snap) return;
      localStorage.setItem(BORR_KEY, JSON.stringify({ ts: Date.now(), snap: snap }));
    } catch (e) {}
  }
  function limpiarBorrador() { try { localStorage.removeItem(BORR_KEY); } catch (e) {} }
  function restaurarBorradorSiCorresponde() {
    let b = null;
    try { b = JSON.parse(localStorage.getItem(BORR_KEY) || "null"); } catch (e) {}
    limpiarBorrador(); // un solo uso, pase lo que pase
    if (b && b.snap && b.ts && (Date.now() - b.ts) < BORR_MAX_MS) {
      restaurarCotizacion(b.snap);
      return true;
    }
    return false;
  }

  function guardarHistorial(nombre, apellido, version) {
    const nom = (nombre || "").trim(), ape = (apellido || "").trim();
    if (!nom || !ape) return; // solo cotizaciones formales con cliente
    const tipo = histTipo(), vNum = parseInt(version, 10) || 1;
    const k = (s) => (s || "").trim().toLowerCase();
    let arr = histPrune(histLoad());
    const i = arr.findIndex((e) => k(e.nombre) === k(nom) && k(e.apellido) === k(ape) && e.tipo === tipo && (parseInt(e.version, 10) || 1) === vNum);
    const ent = { ts: Date.now(), fecha: histFechaCorta(new Date()), nombre: nom, apellido: ape, tipo: tipo, modo: state.docMode, prod: state.prodMode, version: vNum, snap: snapshotCotizacion() };
    if (i >= 0) arr.splice(i, 1); // reemplaza la MISMA versión; versiones distintas conviven como registros separados
    arr.unshift(ent);
    arr = arr.slice(0, HIST_MAX);
    histStore(arr);
    renderHistorial();
    // Sincroniza esta cotización a la hoja HISTORIAL del Sheet (mejor esfuerzo; no bloquea el PDF).
    const tok = (window.AuthCIBSA && window.AuthCIBSA.getToken) ? window.AuthCIBSA.getToken() : null;
    if (tok) {
      window.SheetsCIBSA.escribirHistorial(tok, HIST_HOJA, [entryToRow(ent)], HIST_ENC)
        .catch((e) => console.warn("CIBSA: no se pudo sincronizar el historial al Sheet —", e && e.message ? e.message : e));
    }
  }
  function aplicarHistorial(ent) {
    if (ent && ent.snap) { // memoria completa: reconstruye toda la cotización
      restaurarCotizacion(ent.snap);
    } else { // registros antiguos (solo cliente + tipo)
      limpiarCampos();
      $("f_nombre").value = (ent && ent.nombre) || "";
      $("f_apellido").value = (ent && ent.apellido) || "";
      if (ent && ent.modo === "preliminar") {
        const rb = document.querySelector('input[name="docmode"][value="preliminar"]'); if (rb) rb.checked = true;
        aplicarModo("preliminar");
      } else {
        const rb = document.querySelector('input[name="docmode"][value="formal"]'); if (rb) rb.checked = true;
        const prod = (ent && ent.prod === "compuesto") ? "compuesto" : "uniforme";
        const rp = document.querySelector('input[name="prodmode"][value="' + prod + '"]'); if (rp) rp.checked = true;
        aplicarModo("formal"); aplicarProd(prod);
      }
    }
    $("f_version").value = ("0" + ((parseInt(ent && ent.version, 10) || 1) + 1)).slice(-2);
    $("f_nombre").focus();
    recompute();
  }
  const histClave = (e) => (e.nombre || "").trim().toLowerCase() + "|" + (e.apellido || "").trim().toLowerCase() + "|" + e.tipo;
  function renderHistorial() {
    const cont = $("histList"); if (!cont) return;
    let arr = histPrune(histLoad());
    histStore(arr);
    // Orden: más reciente primero → la última versión de cada cotización queda arriba.
    arr = arr.slice().sort((a, b) => (b.ts || 0) - (a.ts || 0));
    // Versión máxima por cotización (cliente+tipo) para marcar la "última versión".
    const maxVer = {};
    arr.forEach((e) => { const k = histClave(e), v = parseInt(e.version, 10) || 1; if (!(k in maxVer) || v > maxVer[k]) maxVer[k] = v; });
    cont.innerHTML = "";
    if (!arr.length) { cont.innerHTML = '<p class="muted small">Aún no hay cotizaciones guardadas.</p>'; return; }
    arr.forEach((ent) => {
      const esUltima = (parseInt(ent.version, 10) || 1) === maxVer[histClave(ent)];
      const nom = ((ent.nombre || "") + " " + (ent.apellido || "")).trim();
      const vtxt = "v" + ("0" + (parseInt(ent.version, 10) || 1)).slice(-2);
      const card = document.createElement("div"); card.className = "hist-chip" + (esUltima ? " ultima" : "");
      const main = document.createElement("button"); main.type = "button"; main.className = "hist-main"; main.title = "Duplicar para editar (como versión siguiente)";
      main.innerHTML = '<span class="hist-fecha">' + esc(ent.fecha || "") + (esUltima ? ' · <span class="hist-badge">última versión</span>' : '') + '</span>' +
        '<span class="hist-nom">' + esc(nom) + '</span>' +
        '<span class="hist-tipo">' + esc(ent.tipo || "") + ' · ' + vtxt + '</span>';
      main.addEventListener("click", () => aplicarHistorial(ent));
      const acts = document.createElement("div"); acts.className = "hist-acts";
      const bDl = document.createElement("button"); bDl.type = "button"; bDl.className = "hist-act"; bDl.title = "Descargar respaldo (.json)"; bDl.textContent = "⬇";
      bDl.addEventListener("click", (e) => { e.stopPropagation(); descargarRegistro(ent); });
      const bDel = document.createElement("button"); bDel.type = "button"; bDel.className = "hist-act del"; bDel.title = "Borrar definitivamente"; bDel.textContent = "🗑";
      bDel.addEventListener("click", (e) => { e.stopPropagation(); borrarRegistro(ent); });
      acts.appendChild(bDl); acts.appendChild(bDel);
      card.appendChild(main); card.appendChild(acts);
      cont.appendChild(card);
    });
  }
  function nombreRegistro(ent) {
    const ini = (ent.nombre || "").trim().charAt(0).toUpperCase();
    const ape = (ent.apellido || "").trim().replace(/\s+/g, "");
    return "C." + ini + ape + ("0" + (parseInt(ent.version, 10) || 1)).slice(-2);
  }
  function descargarRegistro(ent) {
    const blob = new Blob([JSON.stringify(ent, null, 2)], { type: "application/json" });
    descargarBlob(blob, "Respaldo_" + nombreRegistro(ent) + "_" + (ent.tipo || "") + ".json");
  }
  async function borrarRegistro(ent) {
    const nom = ((ent.nombre || "") + " " + (ent.apellido || "")).trim();
    const vtxt = "v" + ("0" + (parseInt(ent.version, 10) || 1)).slice(-2);
    if (!confirm("¿Borrar el registro «" + nom + " · " + (ent.tipo || "") + " " + vtxt + "»?\n\nSe quitará del historial y de la nube. Si crees que podrías necesitarlo, descárgalo antes con el botón ⬇.")) return;
    if (!confirm("ÚLTIMA CONFIRMACIÓN: esta acción NO se puede deshacer.\n\n¿Borrar definitivamente «" + nom + " " + vtxt + "»?")) return;
    const tok = (window.AuthCIBSA && window.AuthCIBSA.getToken) ? window.AuthCIBSA.getToken() : null;
    if (tok) {
      try { await window.SheetsCIBSA.borrarFilaHistorial(tok, HIST_HOJA, ent.ts); }
      catch (e) { return alert("No se pudo borrar de la nube (" + (e.message || e) + ").\nEl registro NO se borró; inténtalo con conexión."); }
    }
    histStore(histLoad().filter((x) => x.ts !== ent.ts));
    renderHistorial();
  }
  function importarRegistro(file) {
    const reader = new FileReader();
    reader.onload = () => {
      let ent; try { ent = JSON.parse(reader.result); } catch (e) { return alert("El archivo no es un respaldo válido (.json)."); }
      if (!ent || !ent.ts || !ent.nombre) return alert("El archivo no parece un registro de cotización válido.");
      const arr = histLoad(); const k = (s) => (s || "").trim().toLowerCase();
      const i = arr.findIndex((e) => k(e.nombre) === k(ent.nombre) && k(e.apellido) === k(ent.apellido) && e.tipo === ent.tipo && (parseInt(e.version, 10) || 1) === (parseInt(ent.version, 10) || 1));
      if (i >= 0) arr.splice(i, 1);
      arr.unshift(ent); histStore(arr.slice(0, HIST_MAX)); renderHistorial();
      const tok = (window.AuthCIBSA && window.AuthCIBSA.getToken) ? window.AuthCIBSA.getToken() : null;
      if (tok) window.SheetsCIBSA.escribirHistorial(tok, HIST_HOJA, [entryToRow(ent)], HIST_ENC).catch(() => {});
      alert("Registro repuesto: " + ((ent.nombre || "") + " " + (ent.apellido || "")).trim());
    };
    reader.readAsText(file);
  }
  { const b = $("btnLimpiarHist"); if (b) b.addEventListener("click", () => { if (confirm("¿Borrar TODO el historial de este dispositivo? (No borra la hoja HISTORIAL del Sheet; se volverá a leer al reiniciar sesión.)")) { histStore([]); renderHistorial(); } }); }
  { const b = $("btnImportarHist"), inp = $("fileImportarHist");
    if (b && inp) { b.addEventListener("click", () => inp.click()); inp.addEventListener("change", (e) => { const f = e.target.files && e.target.files[0]; if (f) importarRegistro(f); e.target.value = ""; }); } }
  // ----- Exportar historial a CSV / Excel -----
  function histFechaLarga(ts) { const d = new Date(ts || Date.now()); return ("0" + d.getDate()).slice(-2) + "/" + ("0" + (d.getMonth() + 1)).slice(-2) + "/" + d.getFullYear(); }
  function histStamp() { const d = new Date(); return "" + d.getFullYear() + ("0" + (d.getMonth() + 1)).slice(-2) + ("0" + d.getDate()).slice(-2); }
  const HIST_COLS = ["Fecha", "Nombre", "Apellido", "Tipo", "Version"];
  function histRows() {
    return histPrune(histLoad()).map((e) => ({
      Fecha: histFechaLarga(e.ts), Nombre: e.nombre || "", Apellido: e.apellido || "",
      Tipo: e.tipo || "", Version: ("0" + (parseInt(e.version, 10) || 1)).slice(-2),
    }));
  }
  function descargarBlob(blob, filename) { const url = URL.createObjectURL(blob); descargar(url, filename); setTimeout(() => URL.revokeObjectURL(url), 4000); }
  function exportarHistCSV() {
    const rows = histRows();
    if (!rows.length) return alert("No hay cotizaciones en el historial para exportar.");
    const q = (v) => { v = String(v == null ? "" : v); return /[";\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
    const lines = [HIST_COLS.join(";")].concat(rows.map((r) => HIST_COLS.map((c) => q(r[c])).join(";")));
    const csv = "﻿" + lines.join("\r\n");
    descargarBlob(new Blob([csv], { type: "text/csv;charset=utf-8" }), "Historial_cotizaciones_" + histStamp() + ".csv");
  }
  let _xlsxPromise = null;
  function cargarXLSX() {
    if (window.XLSX) return Promise.resolve(window.XLSX);
    if (_xlsxPromise) return _xlsxPromise;
    _xlsxPromise = new Promise((res, rej) => {
      const s = document.createElement("script");
      s.src = "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js";
      s.onload = () => res(window.XLSX);
      s.onerror = () => { _xlsxPromise = null; rej(new Error("No se pudo cargar la librería de Excel. Revisa tu conexión.")); };
      document.head.appendChild(s);
    });
    return _xlsxPromise;
  }
  async function exportarHistXLSX() {
    const rows = histRows();
    if (!rows.length) return alert("No hay cotizaciones en el historial para exportar.");
    let XLSX;
    try { XLSX = await cargarXLSX(); } catch (e) { return alert(e.message || "No se pudo cargar Excel."); }
    const ws = XLSX.utils.json_to_sheet(rows, { header: HIST_COLS });
    ws["!cols"] = [{ wch: 12 }, { wch: 16 }, { wch: 16 }, { wch: 12 }, { wch: 9 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Historial");
    const out = XLSX.write(wb, { bookType: "xlsx", type: "array" });
    descargarBlob(new Blob([out], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), "Historial_cotizaciones_" + histStamp() + ".xlsx");
  }
  { const b = $("btnExportHistCsv"); if (b) b.addEventListener("click", exportarHistCSV); }
  { const b = $("btnExportHistXlsx"); if (b) b.addEventListener("click", exportarHistXLSX); }

  // ---------- Ayuda contextual ("?" + globo informativo) ----------
  const AYUDA = {
    f_vendedor: "Persona que emite la cotización; su nombre y fono salen en el PDF. La lista se carga desde la planilla.",
    f_nombre: "Nombre de pila del cliente. Se usa en el documento y en el nombre del archivo (la inicial, ej. 'D' de Daniel).",
    f_apellido: "Apellido del cliente. Va en el documento y en el nombre del archivo.",
    f_email: "Correo del cliente (opcional). Es solo referencia; no se envía nada automáticamente.",
    f_largo: "Largo del paño terminado, en metros. Acepta operaciones: ej. 240/100 o 2,4*2 (se calcula al salir del campo).",
    f_ancho: "Ancho del paño terminado, en metros. Acepta operaciones, igual que el largo.",
    f_usaAlto: "Márcalo si el producto es una caja/cubierta con altura: suma 2× el alto al largo y al ancho, y dibuja el cuboide 3D con su desarrollo.",
    f_altura: "Alto de la caja, en metros. Define el tamaño de los calados de esquina en el desarrollo.",
    f_cantidad: "Cuántas unidades idénticas cotizar. Si son iguales y de la misma tela, la app puede prorratear el paño extra.",
    f_tela: "Tela del producto; su valor por m² viene de la planilla. El proveedor nunca aparece en el PDF.",
    f_color: "Color del material (opcional). Solo es una nota para el plano de taller; no afecta el precio.",
    f_titulo: "Título que encabeza el producto en el PDF. Si lo dejas vacío, se genera automáticamente.",
    f_usarPlano: "Si está marcado, además de la cotización se genera el plano a escala como archivo aparte.",
    f_ojvalor: "Valor neto de cada ojetillo ($). Se multiplica por la cantidad de ojetillos del producto.",
    f_union: "Traslape de costura entre paños, en metros (típico 0,045). Debe ser menor que el ancho del rollo.",
    f_dias: "Días hábiles de entrega; aparece en las condiciones del documento.",
    f_descuento: "Descuento por pago contado, en %. Se aplica al subtotal neto, antes del IVA.",
    f_version: "Número de versión de la cotización (01, 02, …). Va en el nombre del archivo.",
    f_observaciones: "Notas importantes para el cliente que se imprimen en el documento.",
    f_trasUnif: "Agrega una vista trasera (espejo del frente) al plano. Sus calados/materiales son solo de taller y no afectan el precio.",
  };
  const AYUDA_SECCION = {
    "Datos del cliente": "Identifican al cliente en el documento y en el nombre del archivo.",
    "Cotizaciones recientes": "Memoria de tus cotizaciones, sincronizada con la hoja HISTORIAL del Google Sheet (sobrevive aunque borres datos del navegador). Se ordena con la más reciente arriba y marca la «última versión» de cada cotización. Toca una para duplicarla y editarla como versión siguiente; ⬇ descarga un respaldo; 🗑 la borra definitivamente (con doble confirmación). Puedes exportar todo a CSV/Excel o reponer un respaldo con «Importar respaldo».",
    "Producto": "Elige Uniforme (una sola pieza) o Compuesto (varias piezas distintas en un mismo documento).",
    "Telas recomendadas": "En modo preliminar, marca una o más telas para estimar el valor en cada una.",
    "Piezas del producto": "Cada pieza es un paño distinto con sus propias medidas, tela, ojetillos y terminaciones.",
    "Ojetillos": "Cantidad por unidad. 'Total' = un número; 'Por arista' = distanciamiento en metros por borde (esquinas siempre incluidas). Un calado que toca un borde lo secciona y reacomoda los ojetillos solo.",
    "Bordes y uniones": "Define el traslape entre paños y la terminación del perímetro (borde, bolsillo, etc.), igual en todo o por arista.",
    "Cortes / Calados": "Huecos o calados de diseño. Costo $0 y sin consumo de material; van solo al plano de taller.",
    "Complementos": "Materiales o accesorios extra (cinta, cuerda, etc.). Suman al precio según cantidad y valor.",
    "Aletas / Solapas / Faldón / Cenefa": "Paños anexos fusionados al paño base. SÍ consumen tela y suman al precio (en ambas caras).",
    "Condiciones": "Días de entrega, descuento y versión que aparecen en el documento.",
    "Orientación de uniones": "Sentido de los paños. La app marca la opción más económica.",
    "Vista del producto": "Plano a escala referencial: contorno, ojetillos, calados, aletas y cotas.",
    "Valores preliminares": "Estimación rápida del valor por tela, sin IVA ni descuentos.",
  };
  let helpPop = null;
  function ocultarHelp() { if (helpPop) { helpPop.classList.add("hidden"); helpPop._anchor = null; } }
  function mostrarHelp(anchor, text, code) {
    if (!helpPop) { helpPop = document.createElement("div"); helpPop.className = "help-pop hidden"; document.body.appendChild(helpPop); }
    if (helpPop._anchor === anchor && !helpPop.classList.contains("hidden")) { ocultarHelp(); return; }
    helpPop.innerHTML = "";
    const t = document.createElement("div"); t.textContent = text; helpPop.appendChild(t);
    const wk = (code && state.wikiAyuda) ? state.wikiAyuda[String(code).toLowerCase()] : null;
    if (wk) { const w = document.createElement("div"); w.className = "help-wiki"; w.textContent = wk; helpPop.appendChild(w); }
    if (code) { const c = document.createElement("div"); c.className = "help-cod"; c.innerHTML = "Código: <b>" + esc(code) + "</b>"; helpPop.appendChild(c); }
    helpPop._anchor = anchor; helpPop.classList.remove("hidden");
    const r = anchor.getBoundingClientRect();
    const pw = helpPop.offsetWidth, ph = helpPop.offsetHeight;
    let left = Math.min(Math.max(8, r.left), window.innerWidth - pw - 8);
    let top = r.bottom + 6; if (top + ph > window.innerHeight - 8) top = Math.max(8, r.top - ph - 6);
    helpPop.style.left = left + "px"; helpPop.style.top = top + "px";
  }
  function mkHelpIco(text, code) {
    const b = document.createElement("button");
    b.type = "button"; b.className = "help-ico"; b.textContent = "?"; b.setAttribute("aria-label", "Ayuda" + (code ? " (" + code + ")" : ""));
    b.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); mostrarHelp(b, text, code); });
    return b;
  }
  // Agrega un "?" (con código) a un <label> (o <p> de leyenda) ya creado. Devuelve el mismo elemento.
  function addHelpTo(el, text, code) {
    if (!el) return el;
    const span = el.querySelector("span") || el;
    if (!span.querySelector(".help-ico")) span.appendChild(mkHelpIco(text, code));
    return el;
  }
  function slugCod(s) { return String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "").toUpperCase(); }
  function aplicarAyudas() {
    Object.keys(AYUDA).forEach((id) => {
      const el = document.getElementById(id); if (!el) return;
      const label = el.closest("label"); if (!label) return;
      const span = label.querySelector("span") || label;
      if (span.querySelector(".help-ico")) return;
      span.appendChild(mkHelpIco(AYUDA[id], id)); // código = id del campo (estable)
    });
    document.querySelectorAll("h2.section").forEach((h) => {
      if (h.querySelector(".help-ico")) return;
      const t = (h.textContent || "").trim();
      const key = Object.keys(AYUDA_SECCION).find((k) => t.indexOf(k) === 0);
      if (key) h.appendChild(mkHelpIco(AYUDA_SECCION[key], "SEC-" + slugCod(key)));
    });
  }
  document.addEventListener("click", (e) => {
    if (helpPop && !helpPop.classList.contains("hidden") && e.target !== helpPop && !helpPop.contains(e.target) && !(e.target.classList && e.target.classList.contains("help-ico"))) ocultarHelp();
  });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") ocultarHelp(); });
  window.addEventListener("scroll", ocultarHelp, true);

  // ---------- Secciones colapsables ----------
  const COLAP_CERRADAS = ["wOjetillos", "wBordes", "wCortesUnif", "wComplementosUnif", "wAletasUnif", "wStrapsUnif", "wFactorUnif", "wCondiciones", "telaMultiWrap"];
  const COLAP_ABIERTAS = ["wCliente", "wPiezas", "wHistorial", "wSketchUnif", "wOrientFormal"];
  function seccionTieneDatos(sec) {
    const body = sec.querySelector(".colap-body"); if (!body) return false;
    if (body.querySelector(".pieza-card, .ins-card, .aleta-card, .cut-card, .comp-row, .hist-chip")) return true;
    const els = body.querySelectorAll("input, textarea");
    for (let i = 0; i < els.length; i++) {
      const el = els[i];
      if (el.type === "checkbox" || el.type === "radio") { if (el.checked && el.defaultChecked === false) return true; }
      else if (el.type === "range") { if (String(el.value) !== String(el.defaultValue)) return true; }
      else { const v = (el.value || "").trim(); if (v !== "" && v !== (el.defaultValue || "")) return true; }
    }
    return false;
  }
  function actualizarColapData(sec) {
    if (!sec || !sec.classList.contains("colap")) return;
    sec.classList.toggle("con-datos", sec.classList.contains("collapsed") && seccionTieneDatos(sec));
  }
  function actualizarColapDataPieza(card) {
    card.classList.toggle("con-datos", card.classList.contains("colap-cerrada") && seccionTieneDatos(card));
  }
  function actualizarColapsables() {
    document.querySelectorAll(".colap").forEach(actualizarColapData);
    document.querySelectorAll(".colap-pz").forEach(actualizarColapDataPieza);
  }
  // Sub-editor plegable dentro de una pieza (complementos / inscritos / cortes / aletas).
  // Inserta un encabezado hermano (sobrevive a los re-render internos del contenedor); estado en host[key].
  function aplicarSub(container, titulo, host, key, hasData) {
    const head = container._subHead; if (!head) return;
    const cerrado = !!host[key], datos = !!(hasData && hasData());
    container.style.display = cerrado ? "none" : "";
    head.innerHTML = (cerrado ? "▸ " : "▾ ") + titulo + (cerrado && datos ? ' <span class="subcolap-badge">● con datos</span>' : "");
    head.classList.toggle("con-datos", cerrado && datos);
  }
  // Hace plegable una ficha individual (Anexo, Corte/calado). Estado en obj._colap (persiste).
  function fichaColapsable(card, head, tt, obj) {
    const body = document.createElement("div"); body.className = "anexo-body";
    let nx = head.nextSibling; while (nx) { const s = nx.nextSibling; body.appendChild(nx); nx = s; }
    card.appendChild(body);
    const chev = document.createElement("button"); chev.type = "button"; chev.className = "anexo-colap";
    head.insertBefore(chev, head.firstChild);
    const apl = () => { body.style.display = obj._colap ? "none" : ""; chev.textContent = obj._colap ? "▸" : "▾"; card.classList.toggle("anexo-cerrado", !!obj._colap); };
    chev.addEventListener("click", () => { obj._colap = !obj._colap; apl(); });
    tt.style.cursor = "pointer"; tt.addEventListener("click", () => { obj._colap = !obj._colap; apl(); });
    apl();
  }
  function subColapsar(container, titulo, host, key, hasData) {
    if (!container) return;
    if (!container._subHead) {
      const head = document.createElement("button");
      head.type = "button"; head.className = "subcolap-h";
      container.parentNode.insertBefore(head, container);
      container._subHead = head;
      head.addEventListener("click", () => { host[key] = !host[key]; aplicarSub(container, titulo, host, key, hasData); });
    }
    aplicarSub(container, titulo, host, key, hasData);
  }
  // Cada tarjeta de pieza es plegable; el estado se guarda en pz._colap (persiste entre renders).
  function hacerColapsablePieza(card, pz) {
    const head = card.querySelector(".pieza-head"); if (!head) return;
    card.classList.add("colap-pz");
    const body = document.createElement("div"); body.className = "colap-body";
    let n = head.nextSibling; while (n) { const s = n.nextSibling; body.appendChild(n); n = s; }
    card.appendChild(body);
    const ind = document.createElement("button"); ind.type = "button"; ind.className = "colap-ind pz-colap-btn"; ind.textContent = pz._colap ? "▸" : "▾";
    head.insertBefore(ind, head.firstChild);
    if (pz._colap) card.classList.add("colap-cerrada");
    ind.addEventListener("click", (e) => {
      e.stopPropagation(); pz._colap = !pz._colap;
      card.classList.toggle("colap-cerrada", pz._colap); ind.textContent = pz._colap ? "▸" : "▾";
      actualizarColapDataPieza(card);
    });
    const num = head.querySelector(".pz-num"); if (num) { num.style.cursor = "pointer"; num.addEventListener("click", () => ind.click()); }
    actualizarColapDataPieza(card);
  }
  function toggleColap(sec) {
    sec.classList.toggle("collapsed");
    const ind = sec.querySelector(".colap-ind"); if (ind) ind.textContent = sec.classList.contains("collapsed") ? "▸" : "▾";
    actualizarColapData(sec);
  }
  function hacerColapsable(secId, cerrada) {
    const sec = $(secId); if (!sec || sec._colap) return;
    const h = sec.querySelector("h2.section"); if (!h) return;
    sec._colap = true; sec.classList.add("colap");
    let topChild = h; while (topChild.parentNode !== sec) topChild = topChild.parentNode; // contenedor directo que envuelve al h2
    const body = document.createElement("div"); body.className = "colap-body";
    let n = topChild.nextSibling; while (n) { const s = n.nextSibling; body.appendChild(n); n = s; }
    sec.appendChild(body);
    const ind = document.createElement("span"); ind.className = "colap-ind"; ind.textContent = cerrada ? "▸" : "▾";
    h.insertBefore(ind, h.firstChild); h.classList.add("colap-h");
    h.addEventListener("click", (e) => { if (e.target.closest && e.target.closest(".help-ico")) return; toggleColap(sec); });
    if (cerrada) sec.classList.add("collapsed");
    actualizarColapData(sec);
  }
  function initColapsables() {
    COLAP_CERRADAS.forEach((id) => hacerColapsable(id, true));
    COLAP_ABIERTAS.forEach((id) => hacerColapsable(id, false));
  }

  // ---------- Barra de navegación lateral ----------
  function expandirSiCerrada(sec) {
    if (!sec) return;
    if (sec.classList.contains("colap") && sec.classList.contains("collapsed")) {
      sec.classList.remove("collapsed");
      const ind = sec.querySelector(".colap-ind"); if (ind) ind.textContent = "▾";
      actualizarColapData(sec);
    }
    if (sec.classList.contains("colap-pz") && sec.classList.contains("colap-cerrada")) {
      sec.classList.remove("colap-cerrada");
      const pz = sec.querySelector(".pz-colap-btn"); if (pz) pz.textContent = "▾";
    }
  }
  function navCerrar() { const p = $("navPanel"), b = $("navBackdrop"); if (p) p.classList.remove("open"); if (b) b.classList.remove("open"); }
  function irANodo(target) {
    expandirSiCerrada(target);
    // si está dentro de una pieza plegada, ábrela también
    const pzCard = target.closest && target.closest(".colap-pz"); if (pzCard) expandirSiCerrada(pzCard);
    setTimeout(() => { (target.scrollIntoView ? target : target.parentElement).scrollIntoView({ behavior: "smooth", block: "start" }); }, 30);
    navCerrar();
  }
  function limpiarTitulo(t) { return (t || "").replace(/[▸▾✂☰✕]/g, "").replace(/●\s*con datos/gi, "").replace(/\s+/g, " ").trim(); }
  // ¿La sección/pieza tiene datos ingresados por el usuario? (ámbito propio, sin descender a otras secciones)
  function navTieneDatos(sec) {
    if (!sec || sec.id === "formView") return false;
    const body = sec.querySelector(":scope > .colap-body") || sec;
    if (body.querySelector(".pieza-card, .ins-card, .aleta-card, .cut-card, .comp-row, .hist-chip")) return true;
    const els = body.querySelectorAll("input, textarea, select");
    for (let i = 0; i < els.length; i++) {
      const el = els[i];
      if (el.type === "checkbox" || el.type === "radio") { if (el.checked && el.defaultChecked === false) return true; }
      else if (el.type === "range") { if (String(el.value) !== String(el.defaultValue)) return true; }
      else { const v = (el.value || "").trim(); if (v !== "" && v !== (el.defaultValue || "")) return true; }
    }
    return false;
  }
  function construirNav() {
    const cont = $("navList"); if (!cont) return;
    cont.innerHTML = "";
    // Recorre secciones (h2) y piezas en orden de aparición; solo lo visible.
    const nodos = document.querySelectorAll("#formView h2.section, #formView .pieza-head");
    nodos.forEach((nodo) => {
      if (nodo.offsetParent === null) return; // oculto
      const esPieza = nodo.classList.contains("pieza-head");
      const sec = esPieza ? (nodo.closest(".pieza-card") || nodo.parentElement) : (nodo.closest(".colap") || nodo.parentElement);
      let titulo;
      if (esPieza) {
        const numEl = nodo.querySelector(".pz-num"), etqEl = nodo.querySelector(".pz-etq");
        const etq = etqEl && etqEl.value ? (" — " + etqEl.value.trim()) : "";
        titulo = limpiarTitulo(numEl ? numEl.textContent : "Pieza") + etq;
      } else {
        titulo = limpiarTitulo(nodo.textContent);
      }
      if (!titulo) return;
      const b = document.createElement("button"); b.type = "button"; b.className = "nav-link" + (esPieza ? " nav-pieza" : "");
      if (navTieneDatos(sec)) b.classList.add("con-datos");
      b.textContent = (esPieza ? "• " : "") + titulo;
      b.addEventListener("click", () => irANodo(sec));
      cont.appendChild(b);
    });
    if (!cont.children.length) cont.innerHTML = '<p class="muted small">No hay secciones visibles.</p>';
  }
  function navAbrir() { construirNav(); const p = $("navPanel"), b = $("navBackdrop"); if (p) p.classList.add("open"); if (b) b.classList.add("open"); }
  function initNav() {
    const tab = $("navTab"), cls = $("navClose"), bd = $("navBackdrop");
    if (tab) tab.addEventListener("click", () => { const p = $("navPanel"); if (p && p.classList.contains("open")) navCerrar(); else navAbrir(); });
    if (cls) cls.addEventListener("click", navCerrar);
    if (bd) bd.addEventListener("click", navCerrar);
  }

  function telasMultiSel() {
    const cont = $("telaMulti");
    if (!cont) return [];
    const names = Array.from(cont.querySelectorAll("input:checked")).map((c) => c.value);
    return state.telas.filter((t) => names.includes(t.nombre));
  }

  // ---------- Tema ----------
  function aplicarTema(t) {
    document.body.setAttribute("data-theme", t);
    $("themeSelect").value = t; $("themeSelectLogin").value = t;
    try { localStorage.setItem("cibsa_tema", t); } catch (e) {}
  }
  $("themeSelect").addEventListener("change", (e) => aplicarTema(e.target.value));
  $("themeSelectLogin").addEventListener("change", (e) => aplicarTema(e.target.value));

  // ---------- Vistas ----------
  function mostrarLogin() {
    $("appHeader").classList.add("hidden");
    $("formView").classList.add("hidden");
    $("loginView").classList.remove("hidden");
  }
  function mostrarForm() {
    $("loginView").classList.add("hidden");
    $("appHeader").classList.remove("hidden");
    $("formView").classList.remove("hidden");
    $("userEmail").textContent = window.AuthCIBSA.getEmail() || "";
  }

  // ---------- Login ----------
  $("btnLogin").addEventListener("click", async () => {
    $("loginStatus").textContent = "Conectando con Google…";
    $("btnLogin").disabled = true;
    try {
      await window.AuthCIBSA.iniciarSesion();
      await cargarTelas();
    } catch (e) {
      $("loginStatus").textContent = e.message || "No se pudo iniciar sesión.";
    } finally { $("btnLogin").disabled = false; }
  });
  $("btnLogout").addEventListener("click", () => {
    window.AuthCIBSA.cerrarSesion();
    state.telas = []; mostrarLogin(); $("loginStatus").textContent = "";
  });

  async function cargarTelas() {
    $("loginStatus").textContent = "Cargando lista de precios…";
    const token = window.AuthCIBSA.getToken();
    const telas = await window.SheetsCIBSA.cargarTelas(token);
    state.telas = telas;
    const sel = $("f_tela");
    sel.innerHTML = "";
    telas.forEach((t) => {
      const o = document.createElement("option");
      o.value = t.nombre; o.textContent = t.nombre + (t.proveedor ? "  —  " + t.proveedor : "");
      sel.appendChild(o);
    });
    // Lista de selección múltiple (modo preliminar)
    const multi = $("telaMulti");
    if (multi) {
      multi.innerHTML = "";
      telas.forEach((t) => {
        const lab = document.createElement("label"); lab.className = "tela-chk";
        const cb = document.createElement("input"); cb.type = "checkbox"; cb.value = t.nombre;
        cb.addEventListener("change", recompute);
        const span = document.createElement("span");
        const nm = document.createElement("span"); nm.className = "nm"; nm.textContent = t.nombre;
        const mt = document.createElement("span"); mt.className = "mt";
        mt.textContent = `Valor m²: ${money(t.valorM2)} · Rollo: ${t.anchoRollo} m` + (t.proveedor ? ` · Proveedor: ${t.proveedor}` : "");
        span.appendChild(nm); span.appendChild(document.createElement("br")); span.appendChild(mt);
        lab.appendChild(cb); lab.appendChild(span);
        multi.appendChild(lab);
      });
    }
    // Materiales (desde RANGO → tabla "Materiales"; si no existe, queda vacío)
    try { state.materiales = await window.SheetsCIBSA.cargarMateriales(token); }
    catch (e) { console.warn("CIBSA: no se pudieron cargar los materiales —", e && e.message ? e.message : e); state.materiales = []; }
    // Re-dibuja los sub-editores que dependen de las telas/materiales recién cargadas
    // (de lo contrario sus botones "+ …" quedan deshabilitados desde el arranque sin telas).
    renderComplementosUnif(); renderAletasUnif(); renderStrapsUnif(); renderTraseraUnif(); renderPiezas();
    // Vendedores (desde RANGO → tabla "Vendedores"; si no existe, usa el de config)
    let vendedores = [];
    try { vendedores = await window.SheetsCIBSA.cargarVendedores(token); }
    catch (e) { console.warn("CIBSA: no se pudieron cargar los vendedores —", e && e.message ? e.message : e); vendedores = []; }
    if (!vendedores || vendedores.length === 0) {
      vendedores = [{ nombre: CFG.VENDEDOR.nombre, email: CFG.VENDEDOR.email || "", fonos: [CFG.VENDEDOR.fono].filter(Boolean) }];
    }
    state.vendedores = vendedores;
    // Wiki de ayuda (desde RANGO → id "wiki"; si no existe, queda vacío)
    try { state.wikiAyuda = await window.SheetsCIBSA.cargarWiki(token); }
    catch (e) { console.warn("CIBSA: no se pudo cargar el wiki de ayuda —", e && e.message ? e.message : e); state.wikiAyuda = {}; }
    const vsel = $("f_vendedor");
    if (vsel) {
      vsel.innerHTML = "";
      vendedores.forEach((v) => {
        const o = document.createElement("option");
        o.value = v.nombre; o.textContent = v.nombre; vsel.appendChild(o);
      });
    }
    // Historial en la nube: lee la hoja HISTORIAL, fusiona con lo local y sube lo que falte.
    try {
      const info = await window.SheetsCIBSA.leerHistorialRaw(token, HIST_HOJA);
      const remotas = (info && info.existe) ? (info.filas || []).map(rowToEntry).filter(Boolean) : [];
      sincronizarHistorial(token, remotas);
    } catch (e) { console.warn("CIBSA: no se pudo sincronizar el historial —", e && e.message ? e.message : e); }
    renderHistorial();
    restaurarBorradorSiCorresponde(); // iPhone: repone el estado si se recargó la pestaña tras descargar un PDF
    mostrarForm();
    renderOjetillos();
    recompute();
  }

  function vendedorSel() {
    const sel = $("f_vendedor");
    const v = sel ? state.vendedores.find((x) => x.nombre === sel.value) : null;
    return v || state.vendedores[0] || null;
  }

  // ---------- Helpers de lectura ----------
  function num(id, def) {
    const r = window.CalcCIBSA.evalExpr($(id).value);
    return (r == null || isNaN(r)) ? def : r;
  }
  function telaActual() {
    return state.telas.find((t) => t.nombre === $("f_tela").value) || null;
  }
  function telaInfo() {
    const t = telaActual();
    $("telaInfo").textContent = t
      ? `Valor m²: ${money(t.valorM2)}   ·   Ancho de rollo: ${t.anchoRollo} m` + (t.proveedor ? `   ·   Proveedor: ${t.proveedor}` : "") : "";
  }

  // ---------- Complementos (Materiales: Insumo / Accesorio / Estructural) ----------
  function materialesCategorias() {
    const out = []; state.materiales.forEach((m) => { if (out.indexOf(m.categoria) === -1) out.push(m.categoria); });
    return out;
  }
  function materialesDeCategoria(cat) {
    return state.materiales.map((m, i) => ({ m, i })).filter((x) => x.m.categoria === cat)
      .sort((a, b) => (a.m.proveedor || "").localeCompare(b.m.proveedor || "") || (a.m.item || "").localeCompare(b.m.item || ""));
  }
  function matLabel(m) {
    let s = m.item;
    const extra = [m.modelo, m.color].filter(Boolean).join(" ");
    if (extra) s += " · " + extra;
    if (m.proveedor) s += "  (" + m.proveedor + ")";
    return s;
  }
  function compMat(comp) { return (comp.matId != null && state.materiales[comp.matId]) || null; }
  function compPrecio(comp) { const r = window.CalcCIBSA.evalExpr(comp.precio); return (r == null || isNaN(r)) ? 0 : r; }
  function compNum(v) { const r = window.CalcCIBSA.evalExpr(v); return (r == null || isNaN(r)) ? 0 : r; }
  function compCant(comp) {
    if (comp.cantMode === "arista") return (comp.cantAristas || []).reduce((s, v) => s + compNum(v), 0);
    return compNum(comp.cantidad);
  }
  function compSubUnit(comp) { return compCant(comp) * compPrecio(comp); }
  function compTotalUnit(list) { return (list || []).reduce((s, c) => s + compSubUnit(c), 0); }
  // Líneas descriptivas (por unidad) para el PDF; NUNCA incluyen proveedor.
  function compLineasPDF(list) {
    return (list || []).map((c) => {
      const m = compMat(c); if (!m) return null;
      const extra = [m.modelo, m.color].filter(Boolean).join(" ");
      const nombre = m.item + (extra ? " " + extra : "");
      let cantTxt = compCant(c) + " " + m.unidad;
      if (c.cantMode === "arista") cantTxt += " (por arista: " + (c.cantAristas || []).map(compNum).join(", ") + ")";
      return `+ ${nombre} — ${cantTxt} x ${money(compPrecio(c))} = ${money(compSubUnit(c))}`;
    }).filter(Boolean);
  }

  // Renderiza la sub-lista de complementos sobre 'list' (array de {categoria,matId,cantidad,precio}).
  function renderComplementos(container, list, onChange) {
    container.innerHTML = "";
    const cats = materialesCategorias();
    const cab = document.createElement("p"); cab.className = "muted small";
    cab.textContent = state.materiales.length
      ? "Complementos (insumos / accesorios / estructurales):"
      : "Complementos: aún no hay tabla de Materiales en el Sheet.";
    container.appendChild(cab);
    const rows = document.createElement("div"); container.appendChild(rows);

    function pintar() {
      rows.innerHTML = "";
      list.forEach((comp, idx) => {
        const row = document.createElement("div"); row.className = "comp-row";
        const m = compMat(comp);
        const unidad = m ? m.unidad : "";
        const refrescaSub = () => { const s = row.querySelector(".comp-sub"); if (s) s.textContent = money(compSubUnit(comp)) + "/u"; };

        // --- Línea 1: categoría + ítem ---
        const selC = document.createElement("select"); selC.className = "comp-cat";
        const o0 = document.createElement("option"); o0.value = ""; o0.textContent = "Categoría…"; selC.appendChild(o0);
        cats.forEach((c) => { const o = document.createElement("option"); o.value = c; o.textContent = c; selC.appendChild(o); });
        selC.value = comp.categoria || "";
        const selI = document.createElement("select"); selI.className = "comp-item";
        const oi0 = document.createElement("option"); oi0.value = ""; oi0.textContent = "Ítem…"; selI.appendChild(oi0);
        materialesDeCategoria(comp.categoria || "").forEach(({ m, i }) => { const o = document.createElement("option"); o.value = String(i); o.textContent = matLabel(m); selI.appendChild(o); });
        selI.value = comp.matId != null ? String(comp.matId) : "";
        selC.addEventListener("change", (e) => { comp.categoria = e.target.value; comp.matId = null; comp.precio = ""; pintar(); onChange(); });
        selI.addEventListener("change", (e) => {
          comp.matId = e.target.value === "" ? null : parseInt(e.target.value, 10);
          const mm = compMat(comp); comp.precio = mm && mm.precio != null ? String(mm.precio) : "";
          pintar(); onChange();
        });
        const r1 = document.createElement("div"); r1.className = "comp-r1"; r1.appendChild(selC); r1.appendChild(selI);
        row.appendChild(r1);

        // --- Línea de cantidad: modo Total / Por arista ---
        const rC = document.createElement("div"); rC.className = "comp-r2";
        const selModo = document.createElement("select"); selModo.className = "comp-mode";
        [["total", "Total"], ["arista", "Por arista"]].forEach(([v, t]) => { const o = document.createElement("option"); o.value = v; o.textContent = t; selModo.appendChild(o); });
        selModo.value = comp.cantMode || "total";
        selModo.addEventListener("change", (e) => {
          comp.cantMode = e.target.value;
          if (comp.cantMode === "arista" && (!comp.cantAristas || !comp.cantAristas.length)) {
            comp.cantAristasN = comp.cantAristasN || 4;
            comp.cantAristas = Array.from({ length: comp.cantAristasN }, () => "1");
          }
          pintar(); onChange();
        });
        rC.appendChild(selModo);
        if ((comp.cantMode || "total") === "total") {
          const cwrap = document.createElement("div"); cwrap.className = "comp-cantwrap";
          const cant = document.createElement("input"); cant.type = "text"; cant.className = "comp-cant"; cant.inputMode = "decimal"; cant.value = comp.cantidad || ""; cant.placeholder = "Cant.";
          const uni = document.createElement("span"); uni.className = "comp-uni muted small"; uni.textContent = unidad || "";
          cant.addEventListener("input", (e) => { comp.cantidad = e.target.value; refrescaSub(); onChange(); });
          cwrap.appendChild(cant); cwrap.appendChild(uni); rC.appendChild(cwrap);
        } else {
          const uni = document.createElement("span"); uni.className = "comp-uni muted small"; uni.textContent = unidad ? "(" + unidad + ")" : "";
          rC.appendChild(uni);
        }
        row.appendChild(rC);

        // Sub-grilla por arista
        if ((comp.cantMode || "total") === "arista") {
          const rA = document.createElement("div");
          const ln = document.createElement("div"); ln.className = "oj-row";
          const inpN = document.createElement("input"); inpN.type = "text"; inpN.inputMode = "numeric"; inpN.style.width = "70px"; inpN.value = String(comp.cantAristasN || comp.cantAristas.length);
          const lblN = document.createElement("span"); lblN.className = "muted small"; lblN.textContent = "N° de aristas (máx. 6)";
          inpN.addEventListener("change", (e) => {
            let n = parseInt(window.CalcCIBSA.evalExpr(e.target.value) || 0, 10) || 0; n = Math.max(1, Math.min(6, n));
            comp.cantAristasN = n; const cur = comp.cantAristas || []; const nue = [];
            for (let i = 0; i < n; i++) nue.push(i < cur.length ? cur[i] : "1");
            comp.cantAristas = nue; pintar(); onChange();
          });
          ln.appendChild(inpN); ln.appendChild(lblN); rA.appendChild(ln);
          const grid = document.createElement("div"); grid.className = "oj-grid";
          (comp.cantAristas || []).forEach((val, i) => {
            const cell = document.createElement("div"); cell.className = "oj-cell";
            const lab = document.createElement("label"); lab.textContent = "Arista " + (i + 1); cell.appendChild(lab);
            const inp = document.createElement("input"); inp.type = "text"; inp.inputMode = "decimal"; inp.value = val;
            inp.addEventListener("input", (e) => { comp.cantAristas[i] = e.target.value; const tl = rA.querySelector(".comp-arista-total"); if (tl) tl.textContent = "Total: " + compCant(comp) + " " + unidad; refrescaSub(); onChange(); });
            cell.appendChild(inp); grid.appendChild(cell);
          });
          rA.appendChild(grid);
          const tot = document.createElement("div"); tot.className = "oj-total comp-arista-total"; tot.textContent = "Total: " + compCant(comp) + " " + unidad;
          rA.appendChild(tot); row.appendChild(rA);
        }

        // --- Línea final: precio + subtotal + quitar ---
        const r2 = document.createElement("div"); r2.className = "comp-r2";
        const prec = document.createElement("input"); prec.type = "text"; prec.className = "comp-prec"; prec.inputMode = "numeric"; prec.value = comp.precio || ""; prec.placeholder = "Precio";
        prec.addEventListener("input", (e) => { comp.precio = e.target.value; refrescaSub(); onChange(); });
        const sub = document.createElement("span"); sub.className = "comp-sub"; sub.textContent = money(compSubUnit(comp)) + "/u";
        const del = document.createElement("button"); del.type = "button"; del.className = "pz-btn del"; del.textContent = "✕";
        del.addEventListener("click", () => { list.splice(idx, 1); pintar(); onChange(); });
        const plbl = document.createElement("span"); plbl.className = "muted small"; plbl.textContent = "Precio:";
        r2.appendChild(plbl); r2.appendChild(prec); r2.appendChild(sub); r2.appendChild(del);
        row.appendChild(r2);

        rows.appendChild(row);
      });
    }
    pintar();
    const add = document.createElement("button"); add.type = "button"; add.className = "btn-outline"; add.textContent = "+ Agregar complemento";
    add.disabled = state.materiales.length === 0;
    add.addEventListener("click", () => { list.push({ categoria: "", matId: null, cantidad: "1", precio: "", cantMode: "total", cantAristas: [], cantAristasN: 4 }); pintar(); onChange(); });
    container.appendChild(add);
  }
  function renderComplementosUnif() { const cu = $("compUnif"); if (cu) renderComplementos(cu, state.complementosUnif, recompute); }
  function renderCortesUnif() { const cc = $("cortesUnif"); if (cc) renderCortes(cc, { cortes: state.cortesUnif, baseLargo: () => num("f_largo", null), baseAncho: () => num("f_ancho", null), onChange: recompute }); }
  function cantUnif() { return Math.max(1, parseInt(num("f_cantidad", 1), 10) || 1); }
  function valorOjUnif() { return num("f_ojvalor", CFG.VALOR_OJETILLO_DEFAULT); }
  function renderAletasUnif() {
    const c = $("aletasUnif"); if (c) renderAletas(c, { aletas: state.aletasUnif, cantidad: cantUnif, valorOj: valorOjUnif, factor: facUnif, onChange: recompute });
  }
  function renderBackAletasUnif() {
    const c = $("backAletasUnif"); if (c) renderAletas(c, { aletas: state.backAletasUnif, cantidad: cantUnif, valorOj: valorOjUnif, factor: facUnif, onChange: recompute });
  }
  function renderStrapsUnif() {
    const c = $("strapsUnif"); if (c) renderStraps(c, { straps: state.strapsUnif, cantidad: cantUnif, onChange: recompute });
  }
  // Diseño de la vista trasera (calados + materiales propios, $0). Genérico para uniforme/pieza.
  function renderTraseraDiseno(contCortes, contComp, getCortes, getComp, baseL, baseA, onChange) {
    if (contCortes) renderCortes(contCortes, { cortes: getCortes(), baseLargo: baseL, baseAncho: baseA, onChange: onChange });
    if (contComp) renderComplementos(contComp, getComp(), onChange);
  }
  function renderTraseraUnif() {
    renderTraseraDiseno($("backCortesUnif"), $("backCompUnif"), () => state.backCortesUnif, () => state.backComplementosUnif, () => num("f_largo", null), () => num("f_ancho", null), recompute);
    renderBackAletasUnif();
  }
  // Habilita/oculta la trasera del uniforme según haya diseño frontal (dimensiones).
  function actualizarTraseraUnif() {
    const ok = num("f_largo", null) > 0 && num("f_ancho", null) > 0;
    const tb = $("f_trasUnif"); if (tb) tb.disabled = !ok;
    const hint = $("trasUnifHint"); if (hint) hint.classList.toggle("hidden", ok);
    if (!ok && state.trasUnif) { state.trasUnif = false; if (tb) tb.checked = false; }
    const w = $("wTraseraUnif"); if (w) w.classList.toggle("hidden", !(ok && state.trasUnif));
  }

  // ---------- Paños inscritos (ventanas) ----------
  let inscritoSeq = 0;
  function nuevaInscrito(base) {
    inscritoSeq += 1;
    const defB = () => ({ sup: { tipo: "borde", valor: "0.045", diam: "" }, inf: { tipo: "borde", valor: "0.045", diam: "" }, izq: { tipo: "borde", valor: "0.045", diam: "" }, der: { tipo: "borde", valor: "0.045", diam: "" } });
    const cpB = (b) => ({ sup: Object.assign({}, b.sup), inf: Object.assign({}, b.inf), izq: Object.assign({}, b.izq), der: Object.assign({}, b.der) });
    return {
      id: "ins" + inscritoSeq,
      forma: base ? base.forma : "rect",
      legend: base ? base.legend : "Ventana",
      fusion: base ? Object.assign({}, base.fusion) : { sup: false, inf: false, izq: false, der: false },
      telaNombre: base ? base.telaNombre : ((state.telas[0] && state.telas[0].nombre) || ""),
      largo: base ? base.largo : "", ancho: base ? base.ancho : "",
      padSup: base ? base.padSup : "0.1", padInf: base ? base.padInf : "0.1",
      padIzq: base ? base.padIzq : "0.1", padDer: base ? base.padDer : "0.1",
      orient: base ? base.orient : "largo", union: base ? base.union : "0.045",
      bordeModo: base ? base.bordeModo : "uniforme", bordeValor: base ? base.bordeValor : "0.045",
      bordes: base ? cpB(base.bordes) : defB(),
    };
  }
  // ---------- Aletas / Solapas / Faldón / Cenefa (paños anexos fusionados; SÍ cotizan) ----------
  const ALETA_NOM = { aleta: "Aleta", solapa: "Solapa", faldon: "Faldón", cenefa: "Cenefa" };
  let aletaSeq = 0;
  function nuevaAleta(base) {
    aletaSeq += 1;
    const defB = () => ({ sup: { tipo: "borde", valor: "0.045", diam: "" }, inf: { tipo: "borde", valor: "0.045", diam: "" }, izq: { tipo: "borde", valor: "0.045", diam: "" }, der: { tipo: "borde", valor: "0.045", diam: "" } });
    return {
      id: "al" + aletaSeq,
      tipo: base ? base.tipo : "faldon", legend: base ? base.legend : "", descripcion: base ? base.descripcion : "",
      telaNombre: base ? base.telaNombre : ((state.telas[0] && state.telas[0].nombre) || ""),
      baseEdge: base ? base.baseEdge : "inf", dBorde: base ? base.dBorde : "0.045",
      largo: base ? base.largo : "", ancho: base ? base.ancho : "", offset: base ? base.offset : "0",
      orient: base ? base.orient : "largo", union: base ? base.union : "0.045",
      bordeModo: "uniforme", bordeValor: base ? base.bordeValor : "0.045", bordes: defB(),
      ojetillos: base ? base.ojetillos : "0",
      complementos: base ? (base.complementos || []).map((c) => Object.assign({}, c, { cantAristas: (c.cantAristas || []).slice() })) : [],
    };
  }
  // Factor de diseño (1..2): solo afecta el costo de tela (confección).
  function clampFactor(v) { const n = parseFloat(v); return (n >= 1 && n <= 2) ? n : (n > 2 ? 2 : 1); }
  function facUnif() { return clampFactor(state.factorUnif); }
  function facPz(pz) { return facUnif(); } // factor ÚNICO por producto: aplica igual a todas las piezas
  function infoFactorUnif() { const info = $("factorUnifInfo"); if (info) { const fv = facUnif(); info.textContent = fv > 1 ? ("Confección × " + fv + " (recargo por dificultad de diseño).") : "Sin recargo por diseño (×1)."; } }
  // Sincroniza TODOS los controles de factor (sección inferior + botón superior). 'except' = id que se está tipeando.
  function setFactorUnifUI(except) {
    const fv = facUnif();
    ["f_factor", "f_factor_num", "f_factor_top", "f_factor_top_num"].forEach((id) => { if (id !== except) { const el = $(id); if (el) el.value = String(fv); } });
    const tv = $("factorTopVal"); if (tv) tv.textContent = String(fv);
    const btn = $("btnFactorTop"); if (btn) btn.classList.toggle("activo", fv > 1);
    infoFactorUnif();
  }
  // El producto es "complejo" si es volumétrico o tiene ventanas/paños inscritos.
  function productoEsComplejo() {
    if (state.prodMode === "compuesto") return (state.piezas || []).some((pz) => pz.usaAlto || (pz.inscritos && pz.inscritos.length));
    return alturaUnif() > 0;
  }
  // Sugerencia de factor 1.4 al generar, si el producto es complejo y el factor (único) sigue en 1.
  function sugerirFactor() {
    if (facUnif() === 1 && productoEsComplejo()) {
      if (confirm("Este producto es volumétrico o tiene ventanas/paños inscritos y el factor de diseño está en 1 (sin recargo por dificultad de confección).\n\n¿Aplicar el factor sugerido 1.4? (solo afecta el valor de la tela)")) {
        state.factorUnif = "1.4"; setFactorUnifUI(); recompute();
      }
    }
  }
  // Controles de factor: 4 inputs (slider+número, abajo y arriba) sincronizados al mismo state.factorUnif.
  [["f_factor", false], ["f_factor_num", true], ["f_factor_top", false], ["f_factor_top_num", true]].forEach(([id, esNum]) => {
    const el = $(id); if (!el) return;
    el.addEventListener("input", (e) => { state.factorUnif = String(clampFactor(e.target.value)); setFactorUnifUI(id); recompute(); });
    if (esNum) el.addEventListener("blur", () => { el.value = String(facUnif()); });
  });
  { const b = $("btnFactorTop"); if (b) b.addEventListener("click", () => { const p = $("factorTopPanel"); if (p) p.classList.toggle("hidden"); }); }
  function calcAleta(a, cantidad, valorOj, factor) {
    const ev = window.CalcCIBSA.evalExpr;
    const al = ev(a.largo), aa = ev(a.ancho), tela = state.telas.find((t) => t.nombre === a.telaNombre), N = Math.max(1, cantidad || 1);
    if (!tela || al == null || aa == null || al <= 0 || aa <= 0) return null;
    const u = ev(a.union);
    let lote;
    try {
      lote = window.CalcCIBSA.calcularLote({ largo: al, ancho: aa, valorM2: tela.valorM2, anchoRollo: tela.anchoRollo, cantidad: N, union: (u == null || isNaN(u)) ? 0.045 : u, defaults: BORDE_DEFAULTS, bordes: bordesDePieza(a), ojetillos: ojIntPz(a.ojetillos), valorOjetillo: valorOj, factorTela: clampFactor(factor) });
    } catch (e) { return null; }
    const o = a.orient === "ancho" ? lote.oAncho : lote.oLargo;
    const compTot = compTotalUnit(a.complementos) * N;
    return { tela, al, aa, lote, o, N, subtotal: o.subtotalLote + compTot };
  }
  function aletasTotal(list, cantidad, valorOj, factor) {
    return (list || []).reduce((s, a) => { const r = calcAleta(a, cantidad, valorOj, factor); return s + (r ? r.subtotal : 0); }, 0);
  }
  function aletasSpec(list) {
    const ev = window.CalcCIBSA.evalExpr;
    return (list || []).map((a) => ({ tipo: a.tipo, baseEdge: a.baseEdge || "inf", dBorde: ev(a.dBorde) || 0, largo: ev(a.largo) || 0, ancho: ev(a.ancho) || 0, offset: ev(a.offset) || 0, ojetillos: ojIntPz(a.ojetillos), legend: a.legend || "" })).filter((a) => a.largo > 0 && a.ancho > 0);
  }
  function aletasLineasPDF(list, cantidad, valorOj, factor) {
    return (list || []).map((a) => {
      const r = calcAleta(a, cantidad, valorOj, factor); if (!r) return null;
      const nom = (a.legend && a.legend.trim()) ? a.legend.trim() : (ALETA_NOM[a.tipo] || "Aleta");
      let t = nom + " en " + r.tela.nombre + " " + window.CalcCIBSA.fmtNum(r.al) + "×" + window.CalcCIBSA.fmtNum(r.aa) + " m — " + money(r.subtotal / r.N) + "/u";
      if (a.descripcion && a.descripcion.trim()) t += " · " + a.descripcion.trim();
      return t;
    }).filter(Boolean);
  }
  // ---------- Straps (cintas/webbing): banda recta sobre el paño ----------
  function anchoCintaM(mat) { if (!mat) return 0; const v = parseFloat(String(mat.modelo == null ? "" : mat.modelo).replace(",", ".")); return (v > 0) ? v / 100 : 0; } // MODELO en cm → m
  function strapMat(s) { return (s && s.matId != null && state.materiales[s.matId]) || null; }
  function strapsSpec(list) {
    const ev = window.CalcCIBSA.evalExpr;
    return (list || []).map((s) => ({ ax: ev(s.ax) || 0, ay: ev(s.ay) || 0, angulo: ev(s.angulo) || 0, largo: ev(s.largo) || 0, ancho: anchoCintaM(strapMat(s)), legend: s.legend || "" })).filter((s) => s.largo > 0 && s.ancho > 0);
  }
  function strapsTotal(list, N) {
    const ev = window.CalcCIBSA.evalExpr, n = Math.max(1, N || 1);
    return (list || []).reduce((acc, s) => { const m = strapMat(s), largo = ev(s.largo) || 0; return acc + largo * (m && m.precio != null ? m.precio : 0) * n; }, 0);
  }
  function strapsLineasPDF(list) {
    const ev = window.CalcCIBSA.evalExpr;
    return (list || []).map((s) => { const m = strapMat(s); if (!m) return null; const largo = ev(s.largo) || 0, ancho = anchoCintaM(m); if (!(largo > 0) || !(ancho > 0)) return null; const nom = (s.legend && s.legend.trim()) ? s.legend.trim() : "Strap"; return nom + ": " + m.item + " " + window.CalcCIBSA.fmtNum(largo) + " m × " + window.CalcCIBSA.fmtNum(ancho * 100) + " cm — " + money(largo * (m.precio || 0)) + "/u"; }).filter(Boolean);
  }
  // Editor de straps. ctx: { straps, cantidad(), onChange }
  function renderStraps(container, ctx) {
    container.innerHTML = "";
    const onChange = ctx.onChange, ev = window.CalcCIBSA.evalExpr, f = window.CalcCIBSA.fmtNum;
    const esCinta = (m) => /cinta/i.test((m && m.item) || ""); // ITEM contiene "cinta"
    const hayCintas = state.materiales.some(esCinta);
    const cab = document.createElement("p"); cab.className = "muted small";
    cab.textContent = hayCintas ? "Straps (cintas/webbing) — banda recta; el ancho lo da la cinta:" : "Straps: no hay materiales tipo \"cinta\" en la tabla de Materiales.";
    container.appendChild(cab);
    const rows = document.createElement("div"); container.appendChild(rows);
    function pintar() {
      rows.innerHTML = "";
      (ctx.straps || []).forEach((s, idx) => {
        const card = document.createElement("div"); card.className = "ins-card strap-card";
        const head = document.createElement("div"); head.className = "ins-head";
        const nom0 = (s.legend && s.legend.trim()) ? s.legend.trim() : "Strap";
        const tt = document.createElement("span"); tt.className = "muted small"; tt.textContent = "Strap Nº" + (idx + 1) + " — " + nom0;
        const del = document.createElement("button"); del.type = "button"; del.className = "pz-btn del"; del.textContent = "✕";
        del.addEventListener("click", () => { ctx.straps.splice(idx, 1); pintar(); onChange(); });
        head.appendChild(tt); head.appendChild(del); card.appendChild(head);
        const lt = document.createElement("label"); lt.className = "field full"; lt.innerHTML = "<span>Cinta (material)</span>";
        const selT = document.createElement("select");
        const o0 = document.createElement("option"); o0.value = ""; o0.textContent = "— elegir cinta —"; selT.appendChild(o0);
        state.materiales.forEach((m, i) => { if (!esCinta(m)) return; const o = document.createElement("option"); o.value = String(i); o.textContent = matLabel(m); selT.appendChild(o); });
        selT.value = s.matId != null ? String(s.matId) : "";
        selT.addEventListener("change", (e) => { s.matId = e.target.value === "" ? null : parseInt(e.target.value, 10); refresh(); onChange(); });
        lt.appendChild(selT); addHelpTo(lt, "Cinta/webbing del strap. El ancho se toma de la columna MODELO (en cm) y el precio por metro de la columna de precio.", "STRAP-CINTA"); card.appendChild(lt);
        const grid = document.createElement("div"); grid.className = "pieza-grid";
        const numField = (lab, key, ph) => {
          const l = document.createElement("label"); l.className = "field"; l.innerHTML = "<span>" + lab + "</span>";
          const i = document.createElement("input"); i.type = "text"; i.inputMode = "decimal"; i.value = s[key] != null ? s[key] : ""; if (ph) i.placeholder = ph;
          i.addEventListener("input", (e) => { s[key] = e.target.value; refresh(); onChange(); });
          i.addEventListener("blur", (e) => { const r = ev(e.target.value); if (r != null && !isNaN(r)) { s[key] = f(r); e.target.value = s[key]; refresh(); onChange(); } });
          l.appendChild(i); agregarCalc(i); return l;
        };
        grid.appendChild(addHelpTo(numField("Largo (m)", "largo", "ej. 1.5"), "Largo total del strap, en metros. Puede exceder el paño (entra y sale).", "STRAP-LARGO"));
        grid.appendChild(addHelpTo(numField("Ángulo (°)", "angulo", "0"), "Inclinación: 0 = horizontal, 90 = vertical, 45 = diagonal. La banda es siempre recta.", "STRAP-ANG"));
        grid.appendChild(addHelpTo(numField("Inicio/pivote X (m)", "ax", "0"), "Punto de inicio/pivote en X (0 = borde izquierdo). Negativo para empezar fuera del paño.", "STRAP-AX"));
        grid.appendChild(addHelpTo(numField("Inicio/pivote Y (m)", "ay", "0"), "Punto de inicio/pivote en Y (0 = borde superior). Puede ser negativo o mayor que el largo.", "STRAP-AY"));
        card.appendChild(grid);
        const ln = document.createElement("label"); ln.className = "field full"; ln.innerHTML = "<span>Nombre / leyenda (plano)</span>";
        const ni = document.createElement("input"); ni.type = "text"; ni.value = s.legend || ""; ni.placeholder = "ej. Strap superior";
        ni.addEventListener("input", (e) => { s.legend = e.target.value; refresh(); onChange(); });
        ln.appendChild(ni); card.appendChild(ln);
        const dims = document.createElement("div"); dims.className = "muted small ins-dims"; card.appendChild(dims);
        function refresh() {
          const m = strapMat(s), largo = ev(s.largo), ancho = anchoCintaM(m);
          if (!m) { dims.textContent = "Elige la cinta para ver ancho y costo."; return; }
          if (!(largo > 0)) { dims.textContent = "Completa el largo del strap."; return; }
          const N = ctx.cantidad ? ctx.cantidad() : 1, pu = largo * (m.precio || 0), tot = pu * Math.max(1, N);
          let html = "Cinta <b>" + m.item + "</b> · ancho <b>" + (ancho > 0 ? f(ancho * 100) + " cm" : "?") + "</b> · " + money(pu) + "/u";
          if (N > 1) html += " · " + N + " u = <b>" + money(tot) + "</b>";
          if (!(ancho > 0)) html += " · <span style=\"color:#d8443a\">⚠ la cinta no tiene ancho (col. MODELO) en cm</span>";
          dims.innerHTML = html;
        }
        refresh();
        fichaColapsable(card, head, tt, s);
        rows.appendChild(card);
      });
    }
    pintar();
    const add = document.createElement("button"); add.type = "button"; add.className = "btn-outline"; add.textContent = "+ Strap (cinta)";
    add.disabled = !hayCintas;
    add.addEventListener("click", () => { ctx.straps.push({ matId: null, largo: "", angulo: "0", ax: "0", ay: "0", legend: "" }); pintar(); onChange(); });
    container.appendChild(add);
  }
  // Editor de aletas. ctx: { aletas, cantidad(), valorOj(), onChange }
  function renderAletas(container, ctx) {
    container.innerHTML = "";
    const onChange = ctx.onChange;
    const cab = document.createElement("p"); cab.className = "muted small"; cab.textContent = "Aletas / solapas / faldón / cenefa (paños anexos fusionados; SÍ suman al precio):";
    container.appendChild(cab);
    const rows = document.createElement("div"); container.appendChild(rows);
    function pintar() {
      rows.innerHTML = "";
      (ctx.aletas || []).forEach((a, idx) => {
        const card = document.createElement("div"); card.className = "ins-card aleta-card";
        const head = document.createElement("div"); head.className = "ins-head";
        const nomAnexo = (a.legend && a.legend.trim()) ? a.legend.trim() : (ALETA_NOM[a.tipo] || "");
        const tt = document.createElement("span"); tt.className = "muted small"; tt.textContent = "Anexo Nº" + (idx + 1) + (nomAnexo ? " — " + nomAnexo : "");
        const del = document.createElement("button"); del.type = "button"; del.className = "pz-btn del"; del.textContent = "✕";
        del.addEventListener("click", () => { ctx.aletas.splice(idx, 1); pintar(); onChange(); });
        head.appendChild(tt); head.appendChild(del); card.appendChild(head);
        const selField = (lab, opts, key, full) => {
          const l = document.createElement("label"); l.className = full ? "field full" : "field"; l.innerHTML = "<span>" + lab + "</span>";
          const s = document.createElement("select"); opts.forEach(([v, t]) => { const o = document.createElement("option"); o.value = v; o.textContent = t; s.appendChild(o); });
          s.value = a[key]; s.addEventListener("change", (e) => { a[key] = e.target.value; refresh(); onChange(); });
          l.appendChild(s); return l;
        };
        const txtField = (lab, key, ph, full, ta) => {
          const l = document.createElement("label"); l.className = full ? "field full" : "field"; l.innerHTML = "<span>" + lab + "</span>";
          const i = document.createElement(ta ? "textarea" : "input"); if (ta) i.rows = 2; else i.type = "text"; i.value = a[key] || ""; if (ph) i.placeholder = ph;
          i.addEventListener("input", (e) => { a[key] = e.target.value; if (!ta) refresh(); onChange(); });
          l.appendChild(i); return l;
        };
        const numField = (lab, key, ph) => {
          const l = document.createElement("label"); l.className = "field"; l.innerHTML = "<span>" + lab + "</span>";
          const i = document.createElement("input"); i.type = "text"; i.inputMode = "decimal"; i.value = a[key] || ""; if (ph) i.placeholder = ph;
          i.addEventListener("input", (e) => { a[key] = e.target.value; refresh(); onChange(); });
          i.addEventListener("blur", (e) => { const r = window.CalcCIBSA.evalExpr(e.target.value); if (r != null && !isNaN(r)) { a[key] = window.CalcCIBSA.fmtNum(r); e.target.value = a[key]; refresh(); onChange(); } });
          l.appendChild(i); return l;
        };
        if (!a.tipo) a.tipo = "faldon";
        card.appendChild(addHelpTo(selField("Tipo", [["aleta", "Aleta"], ["solapa", "Solapa"], ["faldon", "Faldón"], ["cenefa", "Cenefa"]], "tipo", true), "Tipo de anexo: Aleta, Solapa, Faldón (caída frontal) o Cenefa. Solo cambia el nombre por defecto en el plano.", "ALETA-TIPO"));
        card.appendChild(addHelpTo(txtField("Nombre / leyenda (plano)", "legend", "Ej. Faldón frontal", true), "Nombre del anexo que aparece en el plano y en la cotización. Si lo dejas vacío usa el tipo.", "ALETA-NOMBRE"));
        card.appendChild(addHelpTo(txtField("Descripción de diseño", "descripcion", "Detalle del faldón/cenefa", true, true), "Texto libre para detallar el diseño del faldón/cenefa (colores, leyendas, terminaciones). Aparece en la cotización.", "ALETA-DESC"));
        const lt = document.createElement("label"); lt.className = "field full"; lt.innerHTML = "<span>Tela</span>";
        const selT = document.createElement("select"); state.telas.forEach((t) => { const o = document.createElement("option"); o.value = t.nombre; o.textContent = t.nombre + (t.proveedor ? "  —  " + t.proveedor : ""); selT.appendChild(o); });
        selT.value = a.telaNombre || ((state.telas[0] && state.telas[0].nombre) || ""); a.telaNombre = selT.value;
        selT.addEventListener("change", (e) => { a.telaNombre = e.target.value; refresh(); onChange(); });
        lt.appendChild(selT); card.appendChild(lt);
        const grid = document.createElement("div"); grid.className = "pieza-grid";
        grid.appendChild(addHelpTo(selField("Cuelga del borde", [["inf", "Inferior"], ["sup", "Superior"], ["izq", "Izquierda"], ["der", "Derecha"]], "baseEdge"), "Borde del paño base del que se fusiona y cuelga el anexo (desde ahí se extiende hacia afuera).", "ALETA-BORDE-BASE"));
        grid.appendChild(addHelpTo(numField("Distancia al borde (m, ≥ unión)", "dBorde"), "A qué distancia del borde elegido se cose el anexo. Debe ser ≥ la unión (típico 0,045 m).", "ALETA-DIST"));
        grid.appendChild(addHelpTo(numField("Largo / caída (m)", "largo"), "Cuánto cae o sobresale el anexo desde su línea de fusión, en metros.", "ALETA-CAIDA"));
        grid.appendChild(addHelpTo(numField("Ancho (m)", "ancho"), "Ancho del anexo a lo largo del borde, en metros.", "ALETA-ANCHO"));
        grid.appendChild(addHelpTo(numField("Offset (m)", "offset"), "Desplazamiento del anexo a lo largo del borde, medido desde la esquina, en metros (0 = pegado a la esquina).", "ALETA-OFFSET"));
        grid.appendChild(addHelpTo(numField("Borde perimetral (m)", "bordeValor"), "Dobladillo de los bordes libres del anexo, en metros.", "ALETA-DOBLADILLO"));
        grid.appendChild(addHelpTo(numField("Ojetillos (hem libre)", "ojetillos"), "Cuántos ojetillos repartir en el borde libre del anexo.", "ALETA-OJET"));
        card.appendChild(grid);
        const mcap = document.createElement("p"); mcap.className = "muted small"; mcap.textContent = "Materiales de la aleta:"; card.appendChild(mcap);
        const mdiv = document.createElement("div"); card.appendChild(mdiv); renderComplementos(mdiv, a.complementos, onChange);
        const dims = document.createElement("div"); dims.className = "muted small ins-dims"; card.appendChild(dims);
        function refresh() {
          const r = calcAleta(a, ctx.cantidad(), ctx.valorOj(), ctx.factor ? ctx.factor() : 1);
          const ev = window.CalcCIBSA.evalExpr, f = window.CalcCIBSA.fmtNum, dB = ev(a.dBorde), un = ev(a.union) || 0.045;
          let html = r ? ("Aleta <b>" + f(r.al) + "×" + f(r.aa) + " m</b> · subtotal <b>" + money(r.subtotal) + "</b> (" + r.N + " u)") : "Completa tela, largo y ancho de la aleta.";
          if (dB != null && dB < un - 1e-9) html += " · <span style=\"color:#d8443a\">⚠ distancia (" + f(dB) + ") menor que la unión (" + f(un) + ")</span>";
          dims.innerHTML = html;
        }
        refresh();
        fichaColapsable(card, head, tt, a); // cada Anexo es plegable
        rows.appendChild(card);
      });
    }
    pintar();
    const add = document.createElement("button"); add.type = "button"; add.className = "btn-outline"; add.textContent = "+ Aleta / solapa / faldón / cenefa";
    add.disabled = state.telas.length === 0;
    add.addEventListener("click", () => { ctx.aletas.push(nuevaAleta()); pintar(); onChange(); });
    container.appendChild(add);
  }
  // Calcula un paño inscrito: dimensiones propias (las ingresa el usuario); se confecciona como pieza.
  function calcInscrito(pz, ins) {
    const winLargo = window.CalcCIBSA.evalExpr(ins.largo), winAncho = window.CalcCIBSA.evalExpr(ins.ancho);
    const tela = state.telas.find((t) => t.nombre === ins.telaNombre);
    const N = Math.max(1, parseInt(window.CalcCIBSA.evalExpr(pz.cantidad) || 1, 10) || 1);
    if (!tela || winLargo == null || winAncho == null || winLargo <= 0 || winAncho <= 0) return null;
    const u = window.CalcCIBSA.evalExpr(ins.union);
    let lote;
    try {
      lote = window.CalcCIBSA.calcularLote({
        largo: winLargo, ancho: winAncho, valorM2: tela.valorM2, anchoRollo: tela.anchoRollo,
        cantidad: N, union: (u == null || isNaN(u)) ? 0.045 : u,
        defaults: BORDE_DEFAULTS, bordes: bordesDePieza(ins), ojetillos: 0, valorOjetillo: 0, factorTela: facPz(pz),
      });
    } catch (e) { return null; }
    const o = ins.orient === "ancho" ? lote.oAncho : lote.oLargo;
    return { tela, winLargo, winAncho, lote, o, N };
  }
  // ¿La ventana + sus paddings caben dentro del paño base? (solo para advertir, no bloquea).
  // Considera la ventana en cualquiera de las dos orientaciones (puede ir rotada).
  function inscritoCabe(pz, ins) {
    const bl = window.CalcCIBSA.evalExpr(pz.largo), ba = window.CalcCIBSA.evalExpr(pz.ancho);
    const wl = window.CalcCIBSA.evalExpr(ins.largo), wa = window.CalcCIBSA.evalExpr(ins.ancho);
    if (bl == null || ba == null || wl == null || wa == null) return true;
    const padV = compNum(ins.padSup) + compNum(ins.padInf);
    const padH = compNum(ins.padIzq) + compNum(ins.padDer);
    const fit1 = (wl + padV <= bl + 1e-6) && (wa + padH <= ba + 1e-6);
    const fit2 = (wa + padV <= bl + 1e-6) && (wl + padH <= ba + 1e-6);
    return fit1 || fit2;
  }
  function inscritosTotal(pz) {
    return (pz.inscritos || []).reduce((s, ins) => { const r = calcInscrito(pz, ins); return s + (r && r.o ? r.o.subtotalLote : 0); }, 0);
  }
  function inscritosLineasPDF(pz) {
    return (pz.inscritos || []).map((ins) => {
      const r = calcInscrito(pz, ins); if (!r || !r.o) return null;
      const dim = ins.forma === "circ" ? `circular Ø${r.winAncho} m` : `${r.winLargo}×${r.winAncho} m`;
      const nom = (ins.legend && ins.legend.trim()) ? ins.legend.trim() : "Paño inscrito";
      return `${nom} en ${r.tela.nombre} ${dim} — ${money(r.o.subtotalLote / r.N)}/u`;
    }).filter(Boolean);
  }
  // Centra la ventana en el paño base: padding = (base − ventana)/2 por eje.
  function centrarInscrito(pz, ins) {
    const ev = window.CalcCIBSA.evalExpr;
    const bL = ev(pz.largo), wL = ev(ins.largo), bA = ev(pz.ancho), wA = ev(ins.ancho);
    if (bL != null && wL != null) { const m = String(Math.max(0, Math.round((bL - wL) / 2 * 1000) / 1000)); ins.padSup = m; ins.padInf = m; }
    if (bA != null && wA != null) { const m = String(Math.max(0, Math.round((bA - wA) / 2 * 1000) / 1000)); ins.padIzq = m; ins.padDer = m; }
  }
  // Rectángulo de la ventana dentro del base (x = padIzq, y = padSup, w = ancho, h = largo).
  function rectInscrito(ins) {
    const ev = window.CalcCIBSA.evalExpr;
    const w = ev(ins.ancho), h = ev(ins.largo);
    if (w == null || h == null || w <= 0 || h <= 0) return null;
    const x = ev(ins.padIzq), y = ev(ins.padSup);
    return { x: (x == null || isNaN(x)) ? 0 : x, y: (y == null || isNaN(y)) ? 0 : y, w, h };
  }
  function superposicionesInscritos(pz) {
    const rects = (pz.inscritos || []).map(rectInscrito);
    const pares = [];
    for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) {
      const a = rects[i], b = rects[j]; if (!a || !b) continue;
      if (a.x < b.x + b.w - 1e-6 && b.x < a.x + a.w - 1e-6 && a.y < b.y + b.h - 1e-6 && b.y < a.y + a.h - 1e-6) pares.push([i + 1, j + 1]);
    }
    return pares;
  }

  function renderInscritos(container, pz) {
    container.innerHTML = "";
    const onChange = recomputeCompuesto;
    const cab = document.createElement("p"); cab.className = "muted small"; cab.textContent = "Paños inscritos (ventanas) — por defecto centrados en el paño base:";
    container.appendChild(cab);
    const rows = document.createElement("div"); container.appendChild(rows);
    const avisoSuper = document.createElement("div"); container.appendChild(avisoSuper);
    function actualizarSuper() {
      const pares = superposicionesInscritos(pz);
      if (pares.length) { avisoSuper.className = "aviso warn"; avisoSuper.innerHTML = "⚠ Paños inscritos que se superponen: " + pares.map(([a, b]) => `Nº${a} ↔ Nº${b}`).join(", ") + "."; avisoSuper.style.display = ""; }
      else { avisoSuper.style.display = "none"; }
    }
    const opuesto = { padSup: "padInf", padInf: "padSup", padIzq: "padDer", padDer: "padIzq" };
    function pintar() {
      rows.innerHTML = "";
      (pz.inscritos || []).forEach((ins, idx) => {
        const card = document.createElement("div"); card.className = "ins-card";
        const padInputs = {};
        const setPad = () => { ["padSup", "padInf", "padIzq", "padDer"].forEach((k) => { if (padInputs[k]) padInputs[k].value = ins[k]; }); };
        const head = document.createElement("div"); head.className = "ins-head";
        const tt = document.createElement("span"); tt.className = "muted small"; tt.textContent = "Paño inscrito Nº" + (idx + 1);
        const del = document.createElement("button"); del.type = "button"; del.className = "pz-btn del"; del.textContent = "✕";
        del.addEventListener("click", () => { pz.inscritos.splice(idx, 1); pintar(); actualizarSuper(); onChange(); });
        head.appendChild(tt); head.appendChild(del); card.appendChild(head);
        // Nombre / leyenda del paño inscrito (no siempre es "ventana") — se muestra en el plano.
        const lleg = document.createElement("label"); lleg.className = "field full"; lleg.innerHTML = "<span>Nombre / leyenda (aparece en el plano)</span>";
        const ileg = document.createElement("input"); ileg.type = "text"; ileg.value = ins.legend || ""; ileg.placeholder = "Ventana, Visor, Acceso, Manga…";
        ileg.addEventListener("input", (e) => { ins.legend = e.target.value; onChange(); });
        lleg.appendChild(ileg); addHelpTo(lleg, "Nombre del paño inscrito que aparece en el plano (no siempre es una ventana: visor, acceso, manga…).", "INS-NOMBRE"); card.appendChild(lleg);
        // Forma + dimensiones. Al cambiar dimensiones, se re-centra.
        const fsel = document.createElement("label"); fsel.className = "field full"; fsel.innerHTML = "<span>Forma</span>";
        const fopt = document.createElement("select");
        [["rect", "Rectángulo"], ["circ", "Círculo"]].forEach(([v, t]) => { const o = document.createElement("option"); o.value = v; o.textContent = t; fopt.appendChild(o); });
        fopt.value = ins.forma || "rect"; fopt.addEventListener("change", (e) => { ins.forma = e.target.value; if (ins.forma === "circ") ins.ancho = ins.largo; centrarInscrito(pz, ins); pintar(); actualizarSuper(); onChange(); });
        fsel.appendChild(fopt); card.appendChild(fsel);
        const grid = document.createElement("div"); grid.className = "pieza-grid";
        if ((ins.forma || "rect") === "circ") {
          const l = document.createElement("label"); l.className = "field full"; l.innerHTML = "<span>Diámetro (m)</span>";
          const inp = document.createElement("input"); inp.type = "text"; inp.inputMode = "decimal"; inp.value = ins.largo || "";
          const setD = (val) => { ins.largo = val; ins.ancho = val; centrarInscrito(pz, ins); setPad(); refresh(); actualizarSuper(); onChange(); };
          inp.addEventListener("input", (e) => setD(e.target.value));
          inp.addEventListener("blur", (e) => { const rr = window.CalcCIBSA.evalExpr(e.target.value); if (rr != null && !isNaN(rr)) { const v = window.CalcCIBSA.fmtNum(rr); e.target.value = v; setD(v); } });
          l.appendChild(inp); grid.appendChild(l);
        } else {
          [["largo", "Largo ventana (m)"], ["ancho", "Ancho ventana (m)"]].forEach(([k, lab]) => {
            const l = document.createElement("label"); l.className = "field"; l.innerHTML = "<span>" + lab + "</span>";
            const inp = document.createElement("input"); inp.type = "text"; inp.inputMode = "decimal"; inp.value = ins[k] || "";
            inp.addEventListener("input", (e) => { ins[k] = e.target.value; centrarInscrito(pz, ins); setPad(); refresh(); actualizarSuper(); onChange(); });
            inp.addEventListener("blur", (e) => { const rr = window.CalcCIBSA.evalExpr(e.target.value); if (rr != null && !isNaN(rr)) { ins[k] = window.CalcCIBSA.fmtNum(rr); e.target.value = ins[k]; centrarInscrito(pz, ins); setPad(); refresh(); actualizarSuper(); onChange(); } });
            l.appendChild(inp); grid.appendChild(l);
          });
        }
        const lt = document.createElement("label"); lt.className = "field full"; lt.innerHTML = "<span>Tela de la ventana</span>";
        const selT = document.createElement("select"); state.telas.forEach((t) => { const o = document.createElement("option"); o.value = t.nombre; o.textContent = t.nombre + (t.proveedor ? "  —  " + t.proveedor : ""); selT.appendChild(o); });
        selT.value = ins.telaNombre || ((state.telas[0] && state.telas[0].nombre) || ""); ins.telaNombre = selT.value;
        selT.addEventListener("change", (e) => { ins.telaNombre = e.target.value; refresh(); onChange(); });
        lt.appendChild(selT); grid.appendChild(lt);
        const lo = document.createElement("label"); lo.className = "field full"; lo.innerHTML = "<span>Orientación de uniones</span>";
        const selO = document.createElement("select");[["largo", "Uniones a lo largo"], ["ancho", "Uniones a lo ancho"]].forEach(([v, t]) => { const o = document.createElement("option"); o.value = v; o.textContent = t; selO.appendChild(o); });
        selO.value = ins.orient || "largo"; selO.addEventListener("change", (e) => { ins.orient = e.target.value; refresh(); onChange(); });
        lo.appendChild(selO); addHelpTo(lo, "Sentido de las uniones de paños dentro de la ventana (a lo largo o a lo ancho). La app calcula el material según esto.", "INS-ORIENT"); grid.appendChild(lo);
        card.appendChild(grid);
        { const f2 = window.CalcCIBSA.fmtNum, ev2 = window.CalcCIBSA.evalExpr, bL = ev2(pz.largo), bA = ev2(pz.ancho);
          const bp = document.createElement("p"); bp.className = "muted small";
          bp.textContent = (bL > 0 && bA > 0) ? ("Paño base: " + f2(bL) + " × " + f2(bA) + " m (largo × ancho).") : "Define el largo y ancho del paño base para ver su medida aquí.";
          card.appendChild(bp); }
        // Posición — margen por arista. Al editar una, la opuesta se completa para que calce.
        const pcap = document.createElement("p"); pcap.className = "muted small"; pcap.textContent = "Posición — margen desde cada arista (m). Centrado por defecto; al editar una, la opuesta se ajusta."; card.appendChild(addHelpTo(pcap, "Margen desde cada arista del paño base hasta la ventana, en metros (define su ubicación). Al editar uno, el opuesto se completa solo para que calce.", "INS-POS"));
        const pgrid = document.createElement("div"); pgrid.className = "pieza-grid";
        const libreEje = (k) => {
          const ev = window.CalcCIBSA.evalExpr;
          if (k === "padSup" || k === "padInf") { const b = ev(pz.largo), w = ev(ins.largo); return (b != null && w != null) ? b - w : null; }
          const b = ev(pz.ancho), w = ev(ins.ancho); return (b != null && w != null) ? b - w : null;
        };
        const autocompletarOpuesto = (k) => {
          const libre = libreEje(k); if (libre == null) return;
          const este = window.CalcCIBSA.evalExpr(ins[k]); if (este == null || isNaN(este)) return;
          const op = opuesto[k]; ins[op] = String(Math.max(0, Math.round((libre - este) * 1000) / 1000));
          if (padInputs[op]) padInputs[op].value = ins[op];
        };
        [["padSup", "Superior"], ["padInf", "Inferior"], ["padIzq", "Izquierda"], ["padDer", "Derecha"]].forEach(([k, lab]) => {
          const l = document.createElement("label"); l.className = "field"; l.innerHTML = "<span>" + lab + "</span>";
          const inp = document.createElement("input"); inp.type = "text"; inp.inputMode = "decimal"; inp.value = ins[k] || "0";
          padInputs[k] = inp;
          inp.addEventListener("input", (e) => { ins[k] = e.target.value; autocompletarOpuesto(k); refresh(); actualizarSuper(); onChange(); });
          l.appendChild(inp); pgrid.appendChild(l);
        });
        card.appendChild(pgrid);
        const acc = document.createElement("div"); acc.className = "pz-actions"; acc.style.marginTop = "6px";
        const bCentrar = document.createElement("button"); bCentrar.type = "button"; bCentrar.className = "pz-btn"; bCentrar.textContent = "Centrar";
        bCentrar.addEventListener("click", () => { centrarInscrito(pz, ins); setPad(); refresh(); actualizarSuper(); onChange(); });
        const bLimpiar = document.createElement("button"); bLimpiar.type = "button"; bLimpiar.className = "pz-btn"; bLimpiar.textContent = "Limpiar márgenes";
        bLimpiar.addEventListener("click", () => { ["padSup", "padInf", "padIzq", "padDer"].forEach((k) => { ins[k] = "0"; }); setPad(); refresh(); actualizarSuper(); onChange(); });
        const bDupIns = document.createElement("button"); bDupIns.type = "button"; bDupIns.className = "pz-btn"; bDupIns.textContent = "Duplicar diseño";
        bDupIns.addEventListener("click", () => { const copy = nuevaInscrito(ins); centrarInscrito(pz, copy); pz.inscritos.push(copy); pintar(); actualizarSuper(); onChange(); });
        acc.appendChild(bCentrar); acc.appendChild(bLimpiar); acc.appendChild(bDupIns); card.appendChild(acc);
        // Fusión por arista (solo rectangular): se cose al paño base por esa arista.
        if ((ins.forma || "rect") !== "circ") {
          const fcap = document.createElement("p"); fcap.className = "muted small"; fcap.textContent = "Fusionado al paño base por arista (se marca con flechas rojas en el plano):"; card.appendChild(fcap);
          const frow = document.createElement("div"); frow.className = "radios";
          [["sup", "Superior"], ["inf", "Inferior"], ["izq", "Izquierda"], ["der", "Derecha"]].forEach(([k, lab]) => {
            const l = document.createElement("label"); const cb = document.createElement("input"); cb.type = "checkbox"; cb.checked = !!(ins.fusion && ins.fusion[k]);
            cb.addEventListener("change", (e) => { if (!ins.fusion) ins.fusion = { sup: false, inf: false, izq: false, der: false }; ins.fusion[k] = e.target.checked; onChange(); });
            l.appendChild(cb); l.appendChild(document.createTextNode(" " + lab)); frow.appendChild(l);
          });
          card.appendChild(frow);
        }
        // Replicar en esquinas (mismo diseño, posición espejo respecto del paño base).
        function setCornerIns(obj, corner, baseL, baseA, mV, mH, cV, cH) {
          const f = window.CalcCIBSA.fmtNum;
          const sup = (corner === "TL" || corner === "TR") ? mV : (baseL - cV - mV);
          const izq = (corner === "TL" || corner === "BL") ? mH : (baseA - cH - mH);
          obj.padSup = f(Math.max(0, sup)); obj.padInf = f(Math.max(0, baseL - cV - sup));
          obj.padIzq = f(Math.max(0, izq)); obj.padDer = f(Math.max(0, baseA - cH - izq));
        }
        // Copia espejo en esquinas — la ventana original SIEMPRE se mantiene; cada esquina agrega una ficha nueva.
        function crearInsEnEsquinas(corners) {
          const ev = window.CalcCIBSA.evalExpr;
          const baseL = ev(pz.largo), baseA = ev(pz.ancho), cV = ev(ins.largo), cH = ev(ins.ancho);
          if (baseL == null || baseA == null || !(cV > 0) || !(cH > 0)) { alert("Completa dimensiones de la ventana y del paño base."); return; }
          const mV = Math.min(ev(ins.padSup) || 0, ev(ins.padInf) || 0), mH = Math.min(ev(ins.padIzq) || 0, ev(ins.padDer) || 0);
          corners.forEach((corner) => { const copy = nuevaInscrito(ins); setCornerIns(copy, corner, baseL, baseA, mV, mH, cV, cH); pz.inscritos.push(copy); });
          pintar(); actualizarSuper(); onChange();
        }
        const rcap = document.createElement("p"); rcap.className = "muted small"; rcap.textContent = "Copia espejo en una esquina (agrega una ficha nueva; la ventana original NO se modifica):"; card.appendChild(rcap);
        const rrow = document.createElement("div"); rrow.className = "pz-actions"; rrow.style.flexWrap = "wrap";
        [["TL", "↖ Sup-Izq"], ["TR", "↗ Sup-Der"], ["BL", "↙ Inf-Izq"], ["BR", "↘ Inf-Der"]].forEach(([k, lab]) => {
          const b = document.createElement("button"); b.type = "button"; b.className = "pz-btn"; b.textContent = lab;
          b.addEventListener("click", () => crearInsEnEsquinas([k]));
          rrow.appendChild(b);
        });
        const b4Ins = document.createElement("button"); b4Ins.type = "button"; b4Ins.className = "pz-btn"; b4Ins.textContent = "⊞ Copia en las 4";
        b4Ins.addEventListener("click", () => crearInsEnEsquinas(["TL", "TR", "BL", "BR"]));
        rrow.appendChild(b4Ins); card.appendChild(rrow);
        // Dimensiones derivadas + subtotal
        const dims = document.createElement("div"); dims.className = "muted small ins-dims"; card.appendChild(dims);
        const bcap = document.createElement("p"); bcap.className = "muted small"; bcap.textContent = "Bordes y unión de la ventana:"; card.appendChild(bcap);
        const bdiv = document.createElement("div"); card.appendChild(bdiv);
        renderPiezaBordes(bdiv, ins);
        function refresh() {
          const r = calcInscrito(pz, ins);
          if (!r || !r.o) { dims.textContent = "Completa largo, ancho y tela de la ventana."; return; }
          let h = `Ventana <b>${r.winLargo}×${r.winAncho} m</b> · subtotal <b>${money(r.o.subtotalLote)}</b> (${r.N} u)`;
          if (!inscritoCabe(pz, ins)) h += ` <span style="color:#d8443a">· ⚠ la ventana + sus márgenes no caben en el paño base</span>`;
          dims.innerHTML = h;
        }
        refresh();
        fichaColapsable(card, head, tt, ins); // cada ventana/paño inscrito es plegable
        rows.appendChild(card);
      });
    }
    pintar();
    actualizarSuper();
    const add = document.createElement("button"); add.type = "button"; add.className = "btn-outline"; add.textContent = "+ Inscribir paño (ventana)";
    add.disabled = state.telas.length === 0;
    add.addEventListener("click", () => { const ins = nuevaInscrito(); centrarInscrito(pz, ins); pz.inscritos.push(ins); pintar(); actualizarSuper(); onChange(); });
    container.appendChild(add);
  }

  // ---------- Cortes / Calados (costo $0, solo diseño; no entran al cálculo ni a la cotización) ----------
  let corteSeq = 0;
  function nuevaCorte(base) {
    corteSeq += 1;
    return {
      id: "cut" + corteSeq,
      forma: base ? base.forma : "rect", ojCirc: base ? base.ojCirc : "0",
      largo: base ? base.largo : "", ancho: base ? base.ancho : "",
      padSup: base ? base.padSup : "0.1", padInf: base ? base.padInf : "0.1",
      padIzq: base ? base.padIzq : "0.1", padDer: base ? base.padDer : "0.1",
      lados: base ? Object.assign({}, base.lados) : { sup: true, inf: true, izq: true, der: true },
      angulo: base ? base.angulo : "0", pivX: base ? base.pivX : "0.5", pivY: base ? base.pivY : "0.5",
      oj: base ? Object.assign({}, base.oj) : { sup: "0", inf: "0", izq: "0", der: "0" },
      complementos: base ? (base.complementos || []).map((c) => Object.assign({}, c, { cantAristas: (c.cantAristas || []).slice() })) : [],
    };
  }
  function centrarCorte(baseL, baseA, c) {
    const ev = window.CalcCIBSA.evalExpr;
    const cL = ev(c.largo), cA = ev(c.ancho);
    // El círculo (corte) puede exceder el paño: se permite padding negativo para mantener el centro.
    const clamp = (c.forma === "circ") ? (n) => n : (n) => Math.max(0, n);
    if (baseL != null && cL != null) { const m = String(clamp(Math.round((baseL - cL) / 2 * 1000) / 1000)); c.padSup = m; c.padInf = m; }
    if (baseA != null && cA != null) { const m = String(clamp(Math.round((baseA - cA) / 2 * 1000) / 1000)); c.padIzq = m; c.padDer = m; }
  }
  function rectCorte(c) {
    const ev = window.CalcCIBSA.evalExpr;
    const w = ev(c.ancho), h = ev(c.largo); if (w == null || h == null || w <= 0 || h <= 0) return null;
    const x = ev(c.padIzq), y = ev(c.padSup);
    const num01 = (v, d) => { const r = window.CalcCIBSA.evalExpr(v); return (r == null || isNaN(r)) ? d : Math.max(0, Math.min(1, r)); };
    const L = c.lados || {};
    return {
      x: (x == null || isNaN(x)) ? 0 : x, y: (y == null || isNaN(y)) ? 0 : y, w: w, h: h,
      circ: c.forma === "circ", ojCirc: ojIntPz(c.ojCirc),
      oj: { sup: ojIntPz(c.oj.sup), inf: ojIntPz(c.oj.inf), izq: ojIntPz(c.oj.izq), der: ojIntPz(c.oj.der) },
      lados: { sup: L.sup !== false, inf: L.inf !== false, izq: L.izq !== false, der: L.der !== false },
      angulo: window.CalcCIBSA.evalExpr(c.angulo) || 0, pivX: num01(c.pivX, 0.5), pivY: num01(c.pivY, 0.5),
    };
  }
  function cortesSpec(list) { return (list || []).map(rectCorte).filter(Boolean); }
  function cortesTotalOj(list) { return (list || []).reduce((s, c) => s + (c.forma === "circ" ? ojIntPz(c.ojCirc) : (ojIntPz(c.oj.sup) + ojIntPz(c.oj.inf) + ojIntPz(c.oj.izq) + ojIntPz(c.oj.der))), 0); }
  function obsCortes(list) {
    const ev = window.CalcCIBSA.evalExpr, f = window.CalcCIBSA.fmtNum;
    const nm = { sup: "sup", inf: "inf", izq: "izq", der: "der" };
    return (list || []).map((c) => {
      const w = ev(c.ancho), h = ev(c.largo); if (!(w > 0 && h > 0)) return null;
      if (c.forma === "circ") {
        const ojc = ojIntPz(c.ojCirc);
        let t = "Calado circular Ø" + f(w) + " m (centro: padding izq " + f(ev(c.padIzq) || 0) + " / sup " + f(ev(c.padSup) || 0) + " m)";
        if (ojc > 0) t += ", ojetillos " + ojc + " (alrededor)";
        return t;
      }
      const oj = c.oj || {}, L = c.lados || {};
      const activos = ["sup", "inf", "izq", "der"].filter((k) => L[k] !== false);
      const ojs = ojIntPz(oj.sup) + ojIntPz(oj.inf) + ojIntPz(oj.izq) + ojIntPz(oj.der);
      const ang = ev(c.angulo) || 0;
      const tipo = activos.length === 1 ? "Corte recto" : "Corte/calado";
      let t = tipo + " " + f(h) + "x" + f(w) + " m (padding izq " + f(ev(c.padIzq) || 0) + " / sup " + f(ev(c.padSup) || 0) + " m)";
      if (activos.length < 4) t += ", aristas: " + activos.map((k) => nm[k]).join("/");
      if (Math.abs(ang) > 1e-6) t += ", ángulo " + f(ang) + "° (pivote " + f(ev(c.pivX) || 0.5) + "," + f(ev(c.pivY) || 0.5) + ")";
      if (ojs > 0) t += ", ojetillos " + ojIntPz(oj.sup) + "/" + ojIntPz(oj.inf) + "/" + ojIntPz(oj.izq) + "/" + ojIntPz(oj.der) + " (sup/inf/izq/der)";
      return t;
    }).filter(Boolean);
  }
  function materialesComplementos(list) {
    return (list || []).map((c) => { const m = compMat(c); if (!m) return null; const extra = [m.modelo, m.color].filter(Boolean).join(" "); return { nombre: m.item + (extra ? " " + extra : ""), cant: compCant(c) + " " + (m.unidad || "u") }; }).filter(Boolean);
  }
  function materialesTraseras(backCortes, backComp) {
    return materialesComplementos(backComp).concat(materialesCortes(backCortes));
  }
  function materialesCortes(list) {
    const out = []; const totalOj = cortesTotalOj(list);
    if (totalOj > 0) out.push({ nombre: "Ojetillos de cortes/calados", cant: String(totalOj) });
    (list || []).forEach((c) => {
      (c.complementos || []).forEach((cp) => {
        const m = compMat(cp); if (!m) return;
        const extra = [m.modelo, m.color].filter(Boolean).join(" ");
        out.push({ nombre: "(corte) " + m.item + (extra ? " " + extra : ""), cant: compCant(cp) + " " + (m.unidad || "u") });
      });
    });
    return out;
  }

  // Renderiza la sección de cortes. ctx: { cortes, baseLargo(), baseAncho(), onChange() }
  function renderCortes(container, ctx) {
    container.innerHTML = "";
    const onChange = ctx.onChange;
    const cab = document.createElement("p"); cab.className = "muted small";
    cab.textContent = "Cortes / calados (costo $0, solo diseño) — por defecto centrados:";
    container.appendChild(cab);
    const rows = document.createElement("div"); container.appendChild(rows);
    const opuesto = { padSup: "padInf", padInf: "padSup", padIzq: "padDer", padDer: "padIzq" };
    function pintar() {
      rows.innerHTML = "";
      (ctx.cortes || []).forEach((c, idx) => {
        const card = document.createElement("div"); card.className = "ins-card cut-card";
        const padInputs = {};
        const setPad = () => { ["padSup", "padInf", "padIzq", "padDer"].forEach((k) => { if (padInputs[k]) padInputs[k].value = c[k]; }); };
        const head = document.createElement("div"); head.className = "ins-head";
        const tt = document.createElement("span"); tt.className = "muted small"; tt.textContent = "✂ Corte/calado Nº" + (idx + 1);
        const del = document.createElement("button"); del.type = "button"; del.className = "pz-btn del"; del.textContent = "✕";
        del.addEventListener("click", () => { ctx.cortes.splice(idx, 1); pintar(); onChange(); });
        head.appendChild(tt); head.appendChild(del); card.appendChild(head);
        const esCirc = (c.forma || "rect") === "circ";
        const fsel = document.createElement("label"); fsel.className = "field full"; fsel.innerHTML = "<span>Forma</span>";
        const fopt = document.createElement("select");
        [["rect", "Rectángulo"], ["circ", "Círculo"]].forEach(([v, t]) => { const o = document.createElement("option"); o.value = v; o.textContent = t; fopt.appendChild(o); });
        fopt.value = c.forma || "rect"; fopt.addEventListener("change", (e) => { c.forma = e.target.value; if (c.forma === "circ") c.ancho = c.largo; centrarCorte(ctx.baseLargo(), ctx.baseAncho(), c); pintar(); onChange(); });
        fsel.appendChild(fopt); card.appendChild(fsel);
        const grid = document.createElement("div"); grid.className = "pieza-grid";
        if (esCirc) {
          const l = document.createElement("label"); l.className = "field full"; l.innerHTML = "<span>Diámetro (m)</span>";
          const inp = document.createElement("input"); inp.type = "text"; inp.inputMode = "decimal"; inp.value = c.largo || "";
          const setD = (val) => { c.largo = val; c.ancho = val; centrarCorte(ctx.baseLargo(), ctx.baseAncho(), c); setPad(); refresh(); onChange(); };
          inp.addEventListener("input", (e) => setD(e.target.value));
          inp.addEventListener("blur", (e) => { const rr = window.CalcCIBSA.evalExpr(e.target.value); if (rr != null && !isNaN(rr)) { const v = window.CalcCIBSA.fmtNum(rr); e.target.value = v; setD(v); } });
          l.appendChild(inp); grid.appendChild(l);
        } else {
          [["largo", "Largo corte (m)"], ["ancho", "Ancho corte (m)"]].forEach(([k, lab]) => {
            const l = document.createElement("label"); l.className = "field"; l.innerHTML = "<span>" + lab + "</span>";
            const inp = document.createElement("input"); inp.type = "text"; inp.inputMode = "decimal"; inp.value = c[k] || "";
            inp.addEventListener("input", (e) => { c[k] = e.target.value; centrarCorte(ctx.baseLargo(), ctx.baseAncho(), c); setPad(); refresh(); onChange(); });
            inp.addEventListener("blur", (e) => { const rr = window.CalcCIBSA.evalExpr(e.target.value); if (rr != null && !isNaN(rr)) { c[k] = window.CalcCIBSA.fmtNum(rr); e.target.value = c[k]; centrarCorte(ctx.baseLargo(), ctx.baseAncho(), c); setPad(); refresh(); onChange(); } });
            l.appendChild(inp); grid.appendChild(l);
          });
        }
        card.appendChild(grid);
        { const f2 = window.CalcCIBSA.fmtNum, bL = ctx.baseLargo(), bA = ctx.baseAncho();
          const bp = document.createElement("p"); bp.className = "muted small";
          bp.textContent = (bL > 0 && bA > 0) ? ("Paño base: " + f2(bL) + " × " + f2(bA) + " m (largo × ancho).") : "Define el largo y ancho del paño base para ver su medida aquí.";
          card.appendChild(bp); }
        if (esCirc) { const nc = document.createElement("p"); nc.className = "muted small"; nc.textContent = "El círculo se centra en el paño base; el padding lo desplaza (N/S/E/O). Puede exceder el paño: solo se dibuja lo que queda dentro."; card.appendChild(nc); }
        const pcap = document.createElement("p"); pcap.className = "muted small"; pcap.textContent = esCirc ? "Posición del centro — padding por punto cardinal (m)." : "Posición — margen desde cada arista (m). Si un margen es 0, ese lado coincide con el borde y el corte queda abierto ahí."; card.appendChild(addHelpTo(pcap, "Ubicación del calado dentro del paño: margen desde cada arista (o padding del centro si es círculo). Un margen 0 hace que ese lado coincida con el borde y el calado lo seccione.", "CORTE-POS"));
        const pgrid = document.createElement("div"); pgrid.className = "pieza-grid";
        const libreEje = (k) => { const ev = window.CalcCIBSA.evalExpr; if (k === "padSup" || k === "padInf") { const b = ctx.baseLargo(), w = ev(c.largo); return (b != null && w != null) ? b - w : null; } const b = ctx.baseAncho(), w = ev(c.ancho); return (b != null && w != null) ? b - w : null; };
        const autoOp = (k) => { const libre = libreEje(k); if (libre == null) return; const este = window.CalcCIBSA.evalExpr(c[k]); if (este == null || isNaN(este)) return; const op = opuesto[k]; c[op] = String(Math.max(0, Math.round((libre - este) * 1000) / 1000)); if (padInputs[op]) padInputs[op].value = c[op]; };
        [["padSup", "Superior"], ["padInf", "Inferior"], ["padIzq", "Izquierda"], ["padDer", "Derecha"]].forEach(([k, lab]) => {
          const l = document.createElement("label"); l.className = "field"; l.innerHTML = "<span>" + lab + "</span>";
          const inp = document.createElement("input"); inp.type = "text"; inp.inputMode = "decimal"; inp.value = c[k] || "0"; padInputs[k] = inp;
          inp.addEventListener("input", (e) => { c[k] = e.target.value; autoOp(k); refresh(); onChange(); });
          l.appendChild(inp); pgrid.appendChild(l);
        });
        card.appendChild(pgrid);
        const acc = document.createElement("div"); acc.className = "pz-actions"; acc.style.marginTop = "6px";
        const bC = document.createElement("button"); bC.type = "button"; bC.className = "pz-btn"; bC.textContent = "Centrar";
        bC.addEventListener("click", () => { centrarCorte(ctx.baseLargo(), ctx.baseAncho(), c); setPad(); refresh(); onChange(); });
        const bL = document.createElement("button"); bL.type = "button"; bL.className = "pz-btn"; bL.textContent = "Limpiar márgenes";
        bL.addEventListener("click", () => { ["padSup", "padInf", "padIzq", "padDer"].forEach((k) => { c[k] = "0"; }); setPad(); refresh(); onChange(); });
        const bDup = document.createElement("button"); bDup.type = "button"; bDup.className = "pz-btn"; bDup.textContent = "Duplicar diseño";
        bDup.addEventListener("click", () => { const copy = nuevaCorte(c); centrarCorte(ctx.baseLargo(), ctx.baseAncho(), copy); ctx.cortes.push(copy); pintar(); onChange(); });
        acc.appendChild(bC); acc.appendChild(bL); acc.appendChild(bDup); card.appendChild(acc);
        // Replicar en esquinas (mismo diseño, posición espejo desde la esquina).
        function setCorner(obj, corner, baseL, baseA, mV, mH, cV, cH) {
          const f = window.CalcCIBSA.fmtNum;
          const sup = (corner === "TL" || corner === "TR") ? mV : (baseL - cV - mV);
          const izq = (corner === "TL" || corner === "BL") ? mH : (baseA - cH - mH);
          obj.padSup = f(Math.max(0, sup)); obj.padInf = f(Math.max(0, baseL - cV - sup));
          obj.padIzq = f(Math.max(0, izq)); obj.padDer = f(Math.max(0, baseA - cH - izq));
        }
        // Crear copia espejo en esquinas — el calado original SIEMPRE se mantiene; cada esquina agrega una ficha nueva.
        function crearEnEsquinas(corners) {
          const ev = window.CalcCIBSA.evalExpr;
          const baseL = ctx.baseLargo(), baseA = ctx.baseAncho(), cV = ev(c.largo), cH = ev(c.ancho);
          if (baseL == null || baseA == null || !(cV > 0) || !(cH > 0)) { alert("Completa dimensiones del corte y del paño base."); return; }
          const mV = Math.min(ev(c.padSup) || 0, ev(c.padInf) || 0), mH = Math.min(ev(c.padIzq) || 0, ev(c.padDer) || 0);
          corners.forEach((corner) => { const copy = nuevaCorte(c); copy._colap = false; setCorner(copy, corner, baseL, baseA, mV, mH, cV, cH); ctx.cortes.push(copy); });
          pintar(); onChange();
        }
        const rcap = document.createElement("p"); rcap.className = "muted small"; rcap.textContent = "Copia espejo en una esquina (agrega una ficha nueva; el calado original NO se modifica):";
        card.appendChild(addHelpTo(rcap, "Crea una COPIA de este calado en la esquina elegida, en posición espejo respecto del paño base. El original se mantiene tal cual; se agrega una ficha nueva (como duplicar).", "CORTE-ESQUINAS"));
        const rrow = document.createElement("div"); rrow.className = "pz-actions"; rrow.style.flexWrap = "wrap";
        [["TL", "↖ Sup-Izq"], ["TR", "↗ Sup-Der"], ["BL", "↙ Inf-Izq"], ["BR", "↘ Inf-Der"]].forEach(([k, lab]) => {
          const b = document.createElement("button"); b.type = "button"; b.className = "pz-btn"; b.textContent = lab;
          b.addEventListener("click", () => crearEnEsquinas([k]));
          rrow.appendChild(b);
        });
        const b4 = document.createElement("button"); b4.type = "button"; b4.className = "pz-btn"; b4.textContent = "⊞ Copia en las 4";
        b4.addEventListener("click", () => crearEnEsquinas(["TL", "TR", "BL", "BR"]));
        rrow.appendChild(b4); card.appendChild(rrow);
        // Aristas a dibujar (solo corte rectangular) — visible.
        if (!esCirc) {
          const lcap = document.createElement("p"); lcap.className = "muted small"; lcap.textContent = "Aristas a dibujar (apaga lados para un corte recto; deja una sola = una línea):"; card.appendChild(addHelpTo(lcap, "Elige qué lados del calado se dibujan. Apaga lados para un corte recto; deja uno solo para una línea. No cambia el precio, solo el plano de taller.", "CORTE-ARISTAS"));
          const lrow = document.createElement("div"); lrow.className = "radios";
          [["sup", "Superior"], ["inf", "Inferior"], ["izq", "Izquierda"], ["der", "Derecha"]].forEach(([k, lab]) => {
            const l = document.createElement("label"); const cb = document.createElement("input"); cb.type = "checkbox"; cb.checked = (c.lados ? c.lados[k] !== false : true);
            cb.addEventListener("change", (e) => { if (!c.lados) c.lados = { sup: true, inf: true, izq: true, der: true }; c.lados[k] = e.target.checked; refresh(); onChange(); });
            l.appendChild(cb); l.appendChild(document.createTextNode(" " + lab)); lrow.appendChild(l);
          });
          card.appendChild(lrow);
        }
        // Opciones avanzadas (colapsable): ángulo/pivote + ojetillos + materiales.
        const advBtn = document.createElement("button"); advBtn.type = "button"; advBtn.className = "btn-outline adv-btn";
        const adv = document.createElement("div"); adv.className = "adv-panel";
        const setAdv = (open) => { c._advOpen = open; adv.style.display = open ? "" : "none"; advBtn.textContent = (open ? "▾ " : "▸ ") + "Opciones avanzadas"; };
        advBtn.addEventListener("click", () => setAdv(!c._advOpen));
        card.appendChild(advBtn); card.appendChild(adv);
        if (!esCirc) {
          const acap = document.createElement("p"); acap.className = "muted small"; acap.textContent = "Ángulo y pivote (arrastra las barras; pivote 0–1: 0,0 = esquina sup-izq · 0.5,0.5 = centro):"; adv.appendChild(addHelpTo(acap, "Gira el calado. El pivote (0–1) es el punto de giro: 0,0 = esquina superior-izquierda; 0.5,0.5 = centro. Un calado girado que toca un borde también lo secciona.", "CORTE-ANGULO"));
          const agrid = document.createElement("div");
          const sliderField = (key, lab, min, max, step, def, unit) => {
            const wrap = document.createElement("div"); wrap.style.margin = "6px 0";
            const cur = (c[key] != null && c[key] !== "") ? c[key] : def;
            const sp = document.createElement("div"); sp.className = "muted small"; sp.textContent = lab + ": " + cur + (unit || "");
            const row = document.createElement("div"); row.className = "slider-row";
            const rng = document.createElement("input"); rng.type = "range"; rng.min = String(min); rng.max = String(max); rng.step = String(step); rng.value = String(cur);
            const numi = document.createElement("input"); numi.type = "text"; numi.inputMode = "decimal"; numi.value = String(cur); numi.className = "slider-num";
            const apply = (v) => { c[key] = String(v); sp.textContent = lab + ": " + v + (unit || ""); refresh(); onChange(); };
            rng.addEventListener("input", (e) => { numi.value = e.target.value; apply(e.target.value); });
            numi.addEventListener("input", (e) => { const v = e.target.value; if (v !== "" && !isNaN(parseFloat(v))) rng.value = v; apply(v); });
            row.appendChild(rng); row.appendChild(numi); wrap.appendChild(sp); wrap.appendChild(row);
            return wrap;
          };
          agrid.appendChild(sliderField("angulo", "Ángulo", -180, 180, 1, "0", "°"));
          agrid.appendChild(sliderField("pivX", "Pivote X", 0, 1, 0.01, "0.5", ""));
          agrid.appendChild(sliderField("pivY", "Pivote Y", 0, 1, 0.01, "0.5", ""));
          adv.appendChild(agrid);
          const ocap = document.createElement("p"); ocap.className = "muted small"; ocap.textContent = "Ojetillos por arista del corte (solo van al plano de taller):"; adv.appendChild(addHelpTo(ocap, "Cantidad de ojetillos en cada lado del calado. Son solo del calado (van al plano de taller) y no afectan el precio.", "CORTE-OJET"));
          const ogrid = document.createElement("div"); ogrid.className = "pieza-grid";
          [["sup", "Superior"], ["inf", "Inferior"], ["izq", "Izquierda"], ["der", "Derecha"]].forEach(([k, lab]) => {
            const l = document.createElement("label"); l.className = "field"; l.innerHTML = "<span>" + lab + "</span>";
            const inp = document.createElement("input"); inp.type = "text"; inp.inputMode = "numeric"; inp.value = (c.oj && c.oj[k]) || "0";
            inp.addEventListener("input", (e) => { c.oj[k] = e.target.value; refresh(); onChange(); });
            l.appendChild(inp); ogrid.appendChild(l);
          });
          adv.appendChild(ogrid);
        } else {
          const ocap = document.createElement("p"); ocap.className = "muted small"; ocap.textContent = "Ojetillos del corte (repartidos alrededor del círculo; solo al plano de taller):"; adv.appendChild(ocap);
          const ol = document.createElement("label"); ol.className = "field"; ol.innerHTML = "<span>Ojetillos (alrededor)</span>";
          const oi = document.createElement("input"); oi.type = "text"; oi.inputMode = "numeric"; oi.value = c.ojCirc || "0";
          oi.addEventListener("input", (e) => { c.ojCirc = e.target.value; refresh(); onChange(); });
          ol.appendChild(oi); adv.appendChild(ol);
        }
        const mcap = document.createElement("p"); mcap.className = "muted small"; mcap.textContent = "Materiales del corte (solo al plano de taller, no a la cotización):"; adv.appendChild(mcap);
        const mdiv = document.createElement("div"); adv.appendChild(mdiv);
        renderComplementos(mdiv, c.complementos, onChange);
        setAdv(!!c._advOpen);
        const dims = document.createElement("div"); dims.className = "muted small ins-dims"; card.appendChild(dims);
        function refresh() {
          const ev = window.CalcCIBSA.evalExpr, w = ev(c.ancho), h = ev(c.largo);
          if (w == null || h == null || w <= 0 || h <= 0) { dims.textContent = esCirc ? "Completa el diámetro del corte." : "Completa largo y ancho del corte."; return; }
          const r = rectCorte(c);
          const baseA = ctx.baseAncho(), baseL = ctx.baseLargo();
          const sk = window.SketchCIBSA.construirSketch({ ancho: baseA || 0, largo: baseL || 0, ojTotal: 0, cortes: [r] });
          const cc = sk.cortes[0];
          if (esCirc) {
            const segN = cc ? cc.segments.length : 0;
            let html = "Corte circular <b>Ø" + window.CalcCIBSA.fmtNum(w) + " m</b> · costo $0";
            if (baseA != null && baseL != null && (w > baseA + 1e-9 || w > baseL + 1e-9)) html += " · <span style=\"color:#8e44ad\">excede el paño: se recorta a lo que queda dentro</span>";
            if (segN === 0) html += " · <span style=\"color:#d8443a\">queda completamente fuera del paño</span>";
            dims.innerHTML = html; return;
          }
          const segN = cc ? cc.segments.length : 0;
          let html = "Corte <b>" + window.CalcCIBSA.fmtNum(h) + "×" + window.CalcCIBSA.fmtNum(w) + " m</b> · costo $0 · <span style=\"color:#8e44ad\">" + segN + " línea(s) de corte" + (segN === 1 ? " (corte recto)" : "") + "</span>";
          if (cc && cc.rotated) html += " · ángulo " + window.CalcCIBSA.fmtNum(cc.angulo) + "°";
          if (segN === 0) html += " · <span style=\"color:#d8443a\">sin líneas: activa al menos una arista con margen &gt; 0</span>";
          dims.innerHTML = html;
        }
        refresh();
        fichaColapsable(card, head, tt, c); // cada Corte/calado es plegable
        rows.appendChild(card);
      });
    }
    pintar();
    const add = document.createElement("button"); add.type = "button"; add.className = "btn-outline"; add.textContent = "+ Corte / calado";
    add.addEventListener("click", () => { const c = nuevaCorte(); centrarCorte(ctx.baseLargo(), ctx.baseAncho(), c); ctx.cortes.push(c); pintar(); onChange(); });
    container.appendChild(add);
  }

  // Líneas de complementos del uniforme como filas para el PDF (cantidad total = por unidad × N).
  function complementosUnifPDF(N) {
    return state.complementosUnif.map((c) => {
      const m = compMat(c); if (!m) return null;
      const extra = [m.modelo, m.color].filter(Boolean).join(" ");
      let nombre = m.item + (extra ? " " + extra : "") + " (" + m.unidad + ")";
      if (c.cantMode === "arista") nombre += " · por arista: " + (c.cantAristas || []).map(compNum).join(", ");
      const cantU = compCant(c);
      return { cantidad: Math.round(cantU * N * 100) / 100, detalle: nombre, precio: compPrecio(c), totalNeto: cantU * compPrecio(c) * N };
    }).filter(Boolean);
  }

  // Aletas del uniforme como filas para el PDF (cantidad = N; precio unit = subtotal/N).
  function aletasUnifPDF(list, N) {
    const f = window.CalcCIBSA.fmtNum;
    return (list || []).map((a) => {
      const r = calcAleta(a, N, valorOjUnif(), facUnif()); if (!r) return null;
      const nom = (a.legend && a.legend.trim()) ? a.legend.trim() : (ALETA_NOM[a.tipo] || "Aleta");
      let det = nom + " en " + r.tela.nombre + " " + f(r.al) + "×" + f(r.aa) + " m";
      if (a.descripcion && a.descripcion.trim()) det += " · " + a.descripcion.trim();
      return { cantidad: r.N, detalle: det, precio: Math.round(r.subtotal / r.N), totalNeto: r.subtotal };
    }).filter(Boolean);
  }

  // ---------- Ojetillos ----------
  document.querySelectorAll('input[name="ojmode"]').forEach((r) =>
    r.addEventListener("change", (e) => {
      state.ojMode = e.target.value;
      if (state.ojMode === "arista" && !state.ojEdges) state.ojEdges = ojEdgesDefault();
      renderOjetillos(); recompute();
    }));

  function ojInt(v) {
    const r = window.CalcCIBSA.evalExpr(v);   // acepta expresiones aritméticas y coma
    return (r == null || isNaN(r)) ? 0 : Math.max(0, Math.round(r));
  }
  // Posiciones de ojetillos del uniforme (modo arista) según dimensiones del formulario.
  function ojetillosPosUnif() {
    const a = num("f_ancho", null), l = num("f_largo", null);
    if (!(a > 0) || !(l > 0)) return { pos: [], total: 0 };
    return ojetillosPosiciones(a, l, state.ojEdges, state.ojParejo, cortesSpec(state.cortesUnif));
  }
  function nOjetillos() {
    if (state.ojMode === "total") return ojInt(state.ojTotal);
    return ojetillosPosUnif().total;
  }
  // Campos de ojetillos para el spec del sketch del uniforme (posiciones explícitas si es por arista).
  function ojSpecUnif() {
    return state.ojMode === "arista" ? { ojetillosPos: ojetillosPosUnif().pos } : { ojTotal: nOjetillos() };
  }
  function ojDetalle() {
    const n = nOjetillos();
    if (state.ojMode === "total") return `${n} ojetillos en total.`;
    const ev = window.CalcCIBSA.evalExpr, e = state.ojEdges || {};
    const partes = ["sup", "inf", "izq", "der"].filter((k) => e[k] && e[k].on !== false && ev(e[k].d) > 0).map((k) => OJ_NOMBRE[k].slice(0, 3) + " @" + window.CalcCIBSA.fmtNum(ev(e[k].d)) + "m");
    return `${n} ojetillos en total (distanciamiento: ${partes.join(", ")}${state.ojParejo ? "; pareja" : ""}).`;
  }

  function renderOjetillos() {
    const c = $("ojDyn"); c.innerHTML = "";
    if (state.ojMode === "total") {
      c.innerHTML = `<label class="field"><span>Cantidad total</span>
        <input id="oj_total_in" type="text" inputmode="numeric" step="1" value="${state.ojTotal}" /></label>`;
      $("oj_total_in").addEventListener("input", (e) => { state.ojTotal = e.target.value; recompute(); });
      $("oj_total_in").addEventListener("blur", (e) => {
        const r = window.CalcCIBSA.evalExpr(e.target.value);
        if (r != null && !isNaN(r)) { state.ojTotal = String(Math.max(0, Math.round(r))); e.target.value = state.ojTotal; recompute(); }
      });
      agregarCalc($("oj_total_in"));
      return;
    }
    if (!state.ojEdges) state.ojEdges = ojEdgesDefault();
    renderOjetillosArista(c, state.ojEdges, state, () => num("f_ancho", null), () => num("f_largo", null), () => nOjetillos(), recompute, () => cortesSpec(state.cortesUnif));
  }
  function actualizarTotalOj() {
    const l = $("oj_total_lbl"); if (l) l.textContent = "Total ojetillos: " + nOjetillos();
  }
  function confirmarAristas() {
    const r = window.CalcCIBSA.evalExpr(state.ojAristasN);
    const n = (r == null || isNaN(r)) ? NaN : Math.round(r);
    if (isNaN(n) || n < 1) { state.ojError = "Ingresa un número de aristas entre 1 y 6."; renderOjetillos(); return; }
    if (n > 6) { state.ojError = "Excedió el número máximo de aristas."; renderOjetillos(); return; }
    state.ojError = "";
    const nuevas = [];
    for (let i = 0; i < n; i++) nuevas.push(i < state.ojAristas.length ? state.ojAristas[i] : "2");
    state.ojAristas = nuevas; state.ojSubstate = "fields";
    renderOjetillos(); recompute();
  }
  function quitarArista(i) {
    state.ojAristas.splice(i, 1);
    if (state.ojAristas.length === 0) state.ojSubstate = "count";
    renderOjetillos(); recompute();
  }

  // ---------- Bordes y unión (uniforme) ----------
  function bordesActuales() {
    if (state.bordeModo === "uniforme") {
      const b = { tipo: "borde", valor: state.bordeValor };
      return { sup: b, inf: b, izq: b, der: b };
    }
    return state.bordes;
  }
  function renderBordes() {
    const c = $("bordeDyn"); if (!c) return; c.innerHTML = "";
    if (state.bordeModo === "uniforme") {
      const lab = document.createElement("label"); lab.className = "field";
      const sp = document.createElement("span"); sp.textContent = "Borde por arista (m)"; lab.appendChild(sp);
      const inp = document.createElement("input"); inp.type = "text"; inp.value = state.bordeValor;
      inp.addEventListener("input", (e) => { state.bordeValor = e.target.value; recompute(); });
      inp.addEventListener("blur", (e) => { const r = window.CalcCIBSA.evalExpr(e.target.value); if (r != null && !isNaN(r)) { state.bordeValor = window.CalcCIBSA.fmtNum(r); e.target.value = state.bordeValor; recompute(); } });
      lab.appendChild(inp); c.appendChild(lab);
      const p = document.createElement("p"); p.className = "muted small"; p.textContent = "Se aplica a las 4 aristas (por defecto 0,045 m).";
      c.appendChild(p);
      return;
    }
    const aristas = [["sup", "Superior (suma al largo)"], ["inf", "Inferior (suma al largo)"], ["izq", "Izquierda (suma al ancho)"], ["der", "Derecha (suma al ancho)"]];
    aristas.forEach(([key, label]) => {
      const b = state.bordes[key];
      const row = document.createElement("div"); row.className = "borde-row";
      const head = document.createElement("div"); head.className = "muted small"; head.textContent = label; row.appendChild(head);
      const ctr = document.createElement("div"); ctr.className = "borde-ctrls";
      const sel = document.createElement("select");
      [["bruto", "Bruto (0)"], ["borde", "Borde (m)"], ["borde_cuerda", "Borde + cuerda Ø (m)"], ["bolsillo", "Bolsillo Ø (m)"]].forEach(([v, t]) => { const o = document.createElement("option"); o.value = v; o.textContent = t; sel.appendChild(o); });
      sel.value = b.tipo || "borde";
      const val = document.createElement("input"); val.type = "text";
      const esBorde = (b.tipo || "borde") === "borde";
      const esDiam = b.tipo === "borde_cuerda" || b.tipo === "bolsillo";
      val.value = b.tipo === "bruto" ? "" : (esBorde ? (b.valor || "0.045") : (b.diam || ""));
      val.placeholder = esBorde ? "m de borde" : (esDiam ? "Ø en m (ej. 0.10)" : "");
      val.disabled = b.tipo === "bruto";
      const warn = document.createElement("div"); warn.className = "oj-err"; warn.style.fontSize = "12px";
      const refWarn = () => { const t = (b.tipo === "borde_cuerda" || b.tipo === "bolsillo") ? avisoDiamGrande(b.diam) : ""; warn.textContent = t; warn.style.display = t ? "" : "none"; };
      sel.addEventListener("change", (e) => { state.bordes[key].tipo = e.target.value; renderBordes(); recompute(); });
      val.addEventListener("input", (e) => {
        if (state.bordes[key].tipo === "borde") state.bordes[key].valor = e.target.value;
        else state.bordes[key].diam = e.target.value;
        refWarn(); recompute();
      });
      ctr.appendChild(sel); ctr.appendChild(val); row.appendChild(ctr); row.appendChild(warn); c.appendChild(row);
      refWarn();
    });
  }
  document.querySelectorAll('input[name="bordemodo"]').forEach((r) =>
    r.addEventListener("change", (e) => { state.bordeModo = e.target.value; renderBordes(); recompute(); }));

  // ---------- Recompute (dispatcher) + comparación de orientaciones (uniforme, v4) ----------
  ["f_largo", "f_ancho", "f_cantidad", "f_descuento", "f_ojvalor", "f_union", "f_altura"].forEach((id) =>
    $(id).addEventListener("input", recompute));
  ["f_largo", "f_ancho"].forEach((id) => $(id).addEventListener("input", () => {
    const bl = num("f_largo", null), ba = num("f_ancho", null);
    (state.cortesUnif || []).forEach((c) => centrarCorte(bl, ba, c));
    if (state.cortesUnif && state.cortesUnif.length) renderCortesUnif();
  }));
  $("f_tela").addEventListener("change", recompute);
  ["f_largo", "f_ancho", "f_cantidad", "f_ojvalor", "f_descuento", "f_dias", "f_union", "f_altura"].forEach((id) =>
    $(id).addEventListener("blur", () => {
      const r = window.CalcCIBSA.evalExpr($(id).value);
      if (r != null && !isNaN(r)) { $(id).value = window.CalcCIBSA.fmtNum(r); recompute(); }
    }));
  // Producto volumétrico (alto) — uniforme
  $("f_usaAlto").addEventListener("change", (e) => { $("wAltura").classList.toggle("hidden", !e.target.checked); recompute(); });
  function alturaUnif() { return $("f_usaAlto").checked ? num("f_altura", 0) : 0; }

  function recompute() {
    if (state.docMode === "preliminar") recomputePrelim();
    else if (state.docMode === "formal" && state.prodMode === "compuesto") recomputeCompuesto();
    else recomputeUniforme();
    actualizarColapsables();
  }

  function recomputeUniforme() {
    telaInfo();
    const cont = $("cmpCards"); cont.innerHTML = ""; state.loteUnif = null;
    const avisos = $("avisosUnif"); if (avisos) avisos.innerHTML = "";
    const tela = telaActual();
    const largo = num("f_largo", null), ancho = num("f_ancho", null);
    actualizarTraseraUnif();
    const sk = $("sketchUnif");
    if (sk && window.SketchCIBSA && !document.body.classList.contains("no-plano")) {
      const especUnif = Object.assign({ ancho: ancho || 0, largo: largo || 0, ventanas: [], cortes: cortesSpec(state.cortesUnif), bolsillos: bolsillosDe(state.bordeModo, state.bordes), aletas: aletasSpec(state.aletasUnif), straps: strapsSpec(state.strapsUnif) }, ojSpecUnif());
      if (alturaUnif() > 0) especUnif.volumetrico = { alto: alturaUnif() };
      sk.innerHTML = sketchDualSVG(especUnif, state.trasUnif, cortesSpec(state.backCortesUnif), aletasSpec(state.backAletasUnif));
    }
    if (!tela || largo == null || ancho == null || largo <= 0 || ancho <= 0) {
      cont.innerHTML = '<p class="muted small">Ingresa largo, ancho y tela para ver los montos.</p>';
      return;
    }
    let lote;
    try {
      lote = window.CalcCIBSA.calcularLote({
        largo, ancho, valorM2: tela.valorM2, anchoRollo: tela.anchoRollo,
        cantidad: Math.max(1, parseInt(num("f_cantidad", 1), 10) || 1),
        union: num("f_union", 0.045), altura: alturaUnif(), defaults: BORDE_DEFAULTS, bordes: bordesActuales(), factorTela: facUnif(),
        ojetillos: nOjetillos(), valorOjetillo: num("f_ojvalor", CFG.VALOR_OJETILLO_DEFAULT),
      });
    } catch (e) { return; }
    state.loteUnif = lote;
    cardLote("largo", lote.oLargo, "Uniones a lo largo", lote);
    cardLote("ancho", lote.oAncho, "Uniones a lo ancho", lote);
    renderAvisosUnif(lote);
  }

  function cardLote(key, o, head, lote) {
    const sel = state.orientUnif === key;
    const el = document.createElement("div");
    el.className = "cmp-card" + (sel ? " sel" : "");
    const esEco = lote.recomendacion.masEconomica === key;
    const compTot = compTotalUnit(state.complementosUnif) * lote.N;
    let h = `<div class="h">${head}${sel ? " ✓" : ""}</div>`;
    h += `<div class="total">${money(o.subtotalLote + compTot)}</div>`;
    h += `<div class="muted small">${o.panosUnit} paños/u · ${o.uniones} uniones · ${o.m2Lote} m² (lote, neto)</div>`;
    if (o.prorrata) h += `<div class="muted small">Prorrata · ahorro ${money(o.ahorro)}</div>`;
    if (compTot > 0) h += `<div class="muted small">+ complementos ${money(compTot)}</div>`;
    if (esEco) h += `<div class="eco">Más económica</div>`;
    el.innerHTML = h;
    el.addEventListener("click", () => { state.orientUnif = key; recompute(); });
    $("cmpCards").appendChild(el);
  }

  function renderAvisosUnif(lote) {
    const cont = $("avisosUnif"); if (!cont) return; cont.innerHTML = "";
    const o = state.orientUnif === "ancho" ? lote.oAncho : lote.oLargo;
    if (lote.unionInvalida) {
      const d = document.createElement("div"); d.className = "aviso warn";
      d.innerHTML = `⚠ La <b>"Unión entre paños"</b> es mayor o igual al ancho del rollo (físicamente imposible). Revisa ese valor — debería ser ~0,045 m.`;
      cont.appendChild(d);
    }
    if (o.prorrata) {
      const d = document.createElement("div"); d.className = "aviso info";
      d.innerHTML = `Se <b>prorrateó el paño extra</b> entre las ${lote.N} unidades idénticas (ahorro ${money(o.ahorro)}). Alternativa: cobrar cada unidad completa y entregar el excedente al cliente.`;
      cont.appendChild(d);
    }
    if (o.faltanteParaBajar != null && o.faltanteParaBajar <= 0.05) {
      const cm = (o.faltanteParaBajar * 100).toFixed(1);
      const otra = state.orientUnif === "ancho" ? lote.oLargo : lote.oAncho;
      let txt = `Estás a <b>${cm} cm</b> de necesitar un paño menos en esta orientación (ese paño vale ${money(o.costoPano)}). Opciones: achicar ~${cm} cm la medida, `;
      txt += (otra.subtotalLote < o.subtotalLote) ? `usar la otra orientación (más barata), ` : ``;
      txt += `o cobrar el paño extra.`;
      const d = document.createElement("div"); d.className = "aviso warn"; d.innerHTML = txt;
      cont.appendChild(d);
    }
  }

  // ---------- Cálculo preliminar (multi-tela) ----------
  function orientacionTxt() {
    return state.orientacionSel === "menor" ? "paralelas al lado más corto" : "paralelas al lado más largo";
  }

  function renderPrelimOrient(mayor, menor) {
    const cont = $("prelimOrient"); if (!cont) return;
    cont.innerHTML = "";
    const opts = [
      ["mayor", "Uniones a lo largo", "Paralelas al lado más largo", mayor],
      ["menor", "Uniones a lo ancho", "Paralelas al lado más corto", menor],
    ];
    opts.forEach(([key, head, sub, lado]) => {
      const sel = state.orientacionSel === key;
      const el = document.createElement("div");
      el.className = "cmp-card" + (sel ? " sel" : "");
      el.innerHTML = `<div class="h">${head}${sel ? " ✓" : ""}</div>
        <div class="muted small">${sub} (${lado} m)</div>`;
      el.addEventListener("click", () => { state.orientacionSel = key; recomputePrelim(); });
      cont.appendChild(el);
    });
  }

  function recomputePrelim() {
    const cont = $("prelimCards"); if (cont) cont.innerHTML = "";
    const oc = $("prelimOrient"); if (oc) oc.innerHTML = "";
    state.prelim = [];
    const largo = num("f_largo", null), ancho = num("f_ancho", null);
    const telas = telasMultiSel();
    if (largo == null || ancho == null || largo <= 0 || ancho <= 0) {
      if (cont) cont.innerHTML = '<p class="muted small">Ingresa largo y ancho para elegir la orientación y ver los valores.</p>';
      return;
    }
    const mayor = Math.max(largo, ancho), menor = Math.min(largo, ancho);
    renderPrelimOrient(mayor, menor);
    if (telas.length === 0) {
      if (cont) cont.innerHTML = '<p class="muted small">Marca al menos una tela recomendada para ver los valores.</p>';
      return;
    }
    const usaMayor = state.orientacionSel !== "menor";
    const cLargo = usaMayor ? mayor : menor, cAncho = usaMayor ? menor : mayor;
    const nOj = nOjetillos(), valOj = num("f_ojvalor", CFG.VALOR_OJETILLO_DEFAULT);
    telas.forEach((tela) => {
      let res;
      try {
        res = window.CalcCIBSA.calcular({
          largo: cLargo, ancho: cAncho, valorM2: tela.valorM2, anchoRollo: tela.anchoRollo,
          nOjetillos: nOj, valorOjetillo: valOj, cantidad: 1, descuentoPct: 0,
        });
      } catch (e) { return; }
      state.prelim.push({ tela, res });
      if (!cont) return;
      const el = document.createElement("div"); el.className = "cmp-card";
      el.innerHTML = `<div class="h">${esc(tela.nombre)}</div>
        <div class="total">${money(res.subtotal)}</div>
        <div class="muted small">Material ${money(res.material)} + ${nOj} ojetillos ${money(res.ojetillosValor)} · neto, 1 unidad</div>
        <div class="muted small">${res.panos} paños · ${res.m2} m²</div>`;
      cont.appendChild(el);
    });
  }

  // ---------- Producto Compuesto (piezas) ----------
  function nuevaPieza(base) {
    piezaSeq += 1;
    const defBordes = () => ({
      sup: { tipo: "borde", valor: "0.045", diam: "" }, inf: { tipo: "borde", valor: "0.045", diam: "" },
      izq: { tipo: "borde", valor: "0.045", diam: "" }, der: { tipo: "borde", valor: "0.045", diam: "" },
    });
    const copBordes = (b) => ({
      sup: Object.assign({}, b.sup), inf: Object.assign({}, b.inf),
      izq: Object.assign({}, b.izq), der: Object.assign({}, b.der),
    });
    return {
      id: "pz" + piezaSeq,
      etiqueta: base ? (base.etiqueta ? base.etiqueta + " (copia)" : "") : "",
      largo: base ? base.largo : "",
      ancho: base ? base.ancho : "",
      cantidad: base ? base.cantidad : "1",
      ojetillos: base ? base.ojetillos : "0",
      telaNombre: base ? base.telaNombre : ((state.telas[0] && state.telas[0].nombre) || ""),
      orient: base ? base.orient : "largo",
      color: base ? base.color : "",
      usaAlto: base ? base.usaAlto : false, altura: base ? base.altura : "",
      ojMode: base ? base.ojMode : "total",
      ojAristasN: base ? base.ojAristasN : 4,
      ojAristas: base ? (base.ojAristas || []).slice() : [],
      ojEdges: base ? ojEdgesCopy(base.ojEdges) : ojEdgesDefault(),
      ojParejo: base ? !!base.ojParejo : false,
      trasera: base ? !!base.trasera : false,
      aletas: base ? (base.aletas || []).map((a) => nuevaAleta(a)) : [],
      backAletas: base ? (base.backAletas || []).map((a) => nuevaAleta(a)) : [],
      straps: base ? (base.straps || []).map((s) => Object.assign({}, s)) : [],
      backCortes: base ? (base.backCortes || []).map((c) => nuevaCorte(c)) : [],
      backComplementos: base ? (base.backComplementos || []).map((c) => Object.assign({}, c, { cantAristas: (c.cantAristas || []).slice() })) : [],
      union: base ? base.union : "0.045",
      bordeModo: base ? base.bordeModo : "uniforme",
      bordeValor: base ? base.bordeValor : "0.045",
      bordes: base ? copBordes(base.bordes) : defBordes(),
      complementos: base ? (base.complementos || []).map((c) => Object.assign({}, c, { cantAristas: (c.cantAristas || []).slice() })) : [],
      inscritos: base ? (base.inscritos || []).map((ins) => nuevaInscrito(ins)) : [],
      cortes: base ? (base.cortes || []).map((c) => nuevaCorte(c)) : [],
    };
  }
  function addPieza(base) { state.piezas.push(nuevaPieza(base)); renderPiezas(); recomputeCompuesto(); }
  function duplicarPieza(id) { const p = state.piezas.find((x) => x.id === id); if (p) addPieza(p); }
  function eliminarPieza(id) { state.piezas = state.piezas.filter((x) => x.id !== id); renderPiezas(); recomputeCompuesto(); }
  const btnAg = $("btnAgregarPieza");
  if (btnAg) btnAg.addEventListener("click", () => addPieza());

  // Controles de borde/unión de una pieza (se re-renderiza solo este bloque al cambiar tipo/modo).
  function renderPiezaBordes(container, pz) {
    container.innerHTML = "";
    const onChange = recomputeCompuesto;
    const lu = document.createElement("label"); lu.className = "field";
    const su = document.createElement("span"); su.textContent = "Unión entre paños (m)"; lu.appendChild(su);
    const iu = document.createElement("input"); iu.type = "text"; iu.value = pz.union != null ? pz.union : "0.045";
    iu.addEventListener("input", (e) => { pz.union = e.target.value; onChange(); });
    iu.addEventListener("blur", (e) => { const r = window.CalcCIBSA.evalExpr(e.target.value); if (r != null && !isNaN(r)) { pz.union = window.CalcCIBSA.fmtNum(r); e.target.value = pz.union; onChange(); } });
    lu.appendChild(iu); container.appendChild(lu);
    const lm = document.createElement("label"); lm.className = "field";
    const sm = document.createElement("span"); sm.textContent = "Bordes"; lm.appendChild(sm);
    const selM = document.createElement("select");
    [["uniforme", "Mismo borde en el perímetro"], ["arista", "Personalizar por arista"]].forEach(([v, t]) => { const o = document.createElement("option"); o.value = v; o.textContent = t; selM.appendChild(o); });
    selM.value = pz.bordeModo || "uniforme";
    selM.addEventListener("change", (e) => { pz.bordeModo = e.target.value; renderPiezaBordes(container, pz); onChange(); });
    lm.appendChild(selM); container.appendChild(lm);
    if ((pz.bordeModo || "uniforme") === "uniforme") {
      const lb = document.createElement("label"); lb.className = "field";
      const sb = document.createElement("span"); sb.textContent = "Borde por arista (m)"; lb.appendChild(sb);
      const ib = document.createElement("input"); ib.type = "text"; ib.value = pz.bordeValor != null ? pz.bordeValor : "0.045";
      ib.addEventListener("input", (e) => { pz.bordeValor = e.target.value; onChange(); });
      ib.addEventListener("blur", (e) => { const r = window.CalcCIBSA.evalExpr(e.target.value); if (r != null && !isNaN(r)) { pz.bordeValor = window.CalcCIBSA.fmtNum(r); e.target.value = pz.bordeValor; onChange(); } });
      lb.appendChild(ib); container.appendChild(lb);
    } else {
      const aristas = [["sup", "Superior (→ largo)"], ["inf", "Inferior (→ largo)"], ["izq", "Izquierda (→ ancho)"], ["der", "Derecha (→ ancho)"]];
      aristas.forEach(([key, label]) => {
        const b = pz.bordes[key];
        const row = document.createElement("div"); row.className = "borde-row";
        const h = document.createElement("div"); h.className = "muted small"; h.textContent = label; row.appendChild(h);
        const ctr = document.createElement("div"); ctr.className = "borde-ctrls";
        const sel = document.createElement("select");
        [["bruto", "Bruto (0)"], ["borde", "Borde (m)"], ["borde_cuerda", "Borde + cuerda Ø"], ["bolsillo", "Bolsillo Ø"]].forEach(([v, t]) => { const o = document.createElement("option"); o.value = v; o.textContent = t; sel.appendChild(o); });
        sel.value = b.tipo || "borde";
        const val = document.createElement("input"); val.type = "text";
        const esBorde = (b.tipo || "borde") === "borde"; const esDiam = b.tipo === "borde_cuerda" || b.tipo === "bolsillo";
        val.value = b.tipo === "bruto" ? "" : (esBorde ? (b.valor || "0.045") : (b.diam || ""));
        val.placeholder = esBorde ? "m" : (esDiam ? "Ø en m (ej. 0.10)" : ""); val.disabled = b.tipo === "bruto";
        const warn = document.createElement("div"); warn.className = "oj-err"; warn.style.fontSize = "12px";
        const refWarn = () => { const t = (b.tipo === "borde_cuerda" || b.tipo === "bolsillo") ? avisoDiamGrande(b.diam) : ""; warn.textContent = t; warn.style.display = t ? "" : "none"; };
        sel.addEventListener("change", (e) => { b.tipo = e.target.value; renderPiezaBordes(container, pz); onChange(); });
        val.addEventListener("input", (e) => { if (b.tipo === "borde") b.valor = e.target.value; else b.diam = e.target.value; refWarn(); onChange(); });
        ctr.appendChild(sel); ctr.appendChild(val); row.appendChild(ctr); row.appendChild(warn); container.appendChild(row);
        refWarn();
      });
    }
  }

  // Ojetillos de una pieza: total (sum si es por arista).
  function ojIntPz(v) { const r = window.CalcCIBSA.evalExpr(v); return (r == null || isNaN(r)) ? 0 : Math.max(0, Math.round(r)); }
  // ---------- Ojetillos por arista por distanciamiento (modelo compartido) ----------
  const OJ_NOMBRE = { sup: "Superior", inf: "Inferior", izq: "Izquierda", der: "Derecha" };
  const OJ_DIAM = 0.03; // diámetro del ojetillo (m): la 2da línea suprime 0/n si el inset es menor (se solapan)
  function defOjEdge() { return { on: true, d: "0.5", supr: "", linea2: { on: false, inset: "0.025", supr: "" } }; }
  function ojEdgesDefault() { return { sup: defOjEdge(), inf: defOjEdge(), izq: defOjEdge(), der: defOjEdge() }; }
  function ojEdgesCopy(e) { const c = {}; ["sup", "inf", "izq", "der"].forEach((k) => { const s = (e && e[k]) || {}; const l2 = s.linea2 || {}; c[k] = { on: s.on !== false, d: s.d != null ? s.d : "0.5", supr: s.supr || "", linea2: { on: !!l2.on, inset: l2.inset != null ? l2.inset : "0.025", supr: l2.supr || "" } }; }); return c; }
  function parseSupr(s) { return String(s || "").split(/[,/]/).map((x) => x.trim()).filter((x) => x !== "").map((x) => Math.round(Number(x))).filter((x) => !isNaN(x) && x >= 0); }
  // Devuelve { pos:[{x,y}], total, errores:[], detalle:{sup:{n,kept,d,esp}, ...} }
  // Posiciones de una arista, descontando las esquinas que ya colocan las aristas horizontales
  // (las verticales no repiten esquinas: así cada esquina se suprime con UNA sola supresión).
  function posicionesEdge(k, L, d, parejo, removed, edges) {
    const ev = window.CalcCIBSA.evalExpr;
    let full = window.SketchCIBSA.posicionesAristaSeg(L, d, !!parejo, removed);
    if (k === "izq" || k === "der") {
      const horizOn = (kk) => { const he = edges && edges[kk]; return !!(he && he.on !== false && ev(he.d) > 0); };
      const supOn = horizOn("sup"), infOn = horizOn("inf");
      full = full.filter((p) => !((p <= 1e-6 && supOn) || (p >= L - 1e-6 && infOn)));
    }
    return full;
  }
  function ojetillosPosiciones(ancho, largo, edges, parejo, cortes) {
    const SK = window.SketchCIBSA, ev = window.CalcCIBSA.evalExpr;
    const out = [], errs = [], detalle = {};
    const rem = SK.intervalosCalados(ancho, largo, cortes || []); // bordes seccionados por calados
    const proc = (k, L, removed, mapFn) => {
      const e = (edges && edges[k]) || {}, d = ev(e.d);
      detalle[k] = { n: 0, kept: 0, d: d > 0 ? d : 0, esp: 0, seccionada: (removed || []).length > 0 };
      if (e.on === false || !(d > 0) || !(L > 0)) return;
      const full = posicionesEdge(k, L, d, parejo, removed, edges), n = full.length;
      detalle[k].n = n; detalle[k].esp = n > 1 ? L / (n - 1) : 0;
      const supr = parseSupr(e.supr), suprSet = new Set(supr);
      supr.forEach((i) => { if (i >= n) errs.push(OJ_NOMBRE[k] + ": posición " + i + " supera el máximo (" + (n - 1) + ")"); });
      const kept = full.filter((_, i) => !suprSet.has(i));
      detalle[k].kept = kept.length;
      kept.forEach((p) => out.push(mapFn(p)));
      // 2da línea: paralela a la arista, hacia adentro (inset). 0 y n se suprimen solos si se solapan con el perímetro.
      const l2 = e.linea2;
      if (l2 && l2.on) {
        const ins0 = ev(l2.inset), ins = (ins0 != null && ins0 > 0) ? ins0 : 0.025;
        const off = (k === "sup") ? { x: 0, y: ins } : (k === "inf") ? { x: 0, y: -ins } : (k === "izq") ? { x: ins, y: 0 } : { x: -ins, y: 0 };
        const supr2 = new Set(parseSupr(l2.supr)), n2 = full.length, autoOv = ins < OJ_DIAM;
        let kept2 = 0;
        full.forEach((p, i) => {
          if (supr2.has(i)) return;
          const esCorner = (p <= 1e-6 || p >= L - 1e-6);
          if (autoOv && esCorner && (i === 0 || i === n2 - 1)) return; // endpoint en esquina se solapa con el perímetro
          const b = mapFn(p); out.push({ x: b.x + off.x, y: b.y + off.y }); kept2++;
        });
        detalle[k].l2 = { n: n2, kept: kept2 };
      }
    };
    proc("sup", ancho, rem.sup, (p) => ({ x: p, y: 0 }));
    proc("inf", ancho, rem.inf, (p) => ({ x: p, y: largo }));
    proc("izq", largo, rem.izq, (p) => ({ x: 0, y: p }));
    proc("der", largo, rem.der, (p) => ({ x: ancho, y: p }));
    const seen = new Set(), pos = [];
    out.forEach((p) => { const key = Math.round(p.x * 1000) + "_" + Math.round(p.y * 1000); if (!seen.has(key)) { seen.add(key); pos.push(p); } });
    return { pos: pos, total: pos.length, errores: errs, detalle: detalle };
  }
  function ojTotalPieza(pz) {
    if (pz.ojMode === "arista") {
      const ev = window.CalcCIBSA.evalExpr, a = ev(pz.ancho), l = ev(pz.largo);
      if (!(a > 0) || !(l > 0)) return 0;
      return ojetillosPosiciones(a, l, pz.ojEdges, pz.ojParejo, cortesSpec(pz.cortes)).total;
    }
    return ojIntPz(pz.ojetillos);
  }
  function ojetillosTxtPieza(pz) {
    const n = ojTotalPieza(pz);
    let t = n + " ojetillos c/u";
    if (pz.ojMode === "arista") {
      const ev = window.CalcCIBSA.evalExpr, e = pz.ojEdges || {};
      const partes = ["sup", "inf", "izq", "der"].filter((k) => e[k] && e[k].on !== false && ev(e[k].d) > 0).map((k) => OJ_NOMBRE[k].slice(0, 3) + " @" + window.CalcCIBSA.fmtNum(ev(e[k].d)) + "m");
      if (partes.length) t += " (distanciamiento: " + partes.join(", ") + (pz.ojParejo ? "; pareja" : "") + ")";
    }
    return t;
  }
  // Spec del dibujo (sketch) de una pieza: dimensiones, ojetillos y ventanas inscritas.
  function sketchPieza(pz) {
    const ev = window.CalcCIBSA.evalExpr;
    const a = ev(pz.ancho), l = ev(pz.largo);
    const ventanas = (pz.inscritos || []).map((ins) => {
      const x = ev(ins.padIzq), y = ev(ins.padSup), w = ev(ins.ancho), h = ev(ins.largo);
      return (w > 0 && h > 0) ? { x: (x == null || isNaN(x)) ? 0 : x, y: (y == null || isNaN(y)) ? 0 : y, w: w, h: h, circ: ins.forma === "circ", legend: ins.legend || "", fusion: ins.fusion || {} } : null;
    }).filter(Boolean);
    const spec = { ancho: a > 0 ? a : 0, largo: l > 0 ? l : 0, ventanas: ventanas, cortes: cortesSpec(pz.cortes), bolsillos: bolsillosDe(pz.bordeModo, pz.bordes), aletas: aletasSpec(pz.aletas), straps: strapsSpec(pz.straps) };
    if (pz.usaAlto) { const hh = ev(pz.altura); if (hh > 0) spec.volumetrico = { alto: hh }; }
    if (pz.ojMode === "arista") spec.ojetillosPos = ojetillosPosiciones(spec.ancho, spec.largo, pz.ojEdges, pz.ojParejo, cortesSpec(pz.cortes)).pos;
    else spec.ojTotal = ojIntPz(pz.ojetillos);
    return spec;
  }
  // SVG de vista previa: frontal y, si corresponde, trasera (espejo + calados propios) debajo.
  function sketchDualSVG(spec, trasera, backCortes, backAletas) {
    let html = window.SketchCIBSA.sketchSVG(spec);
    if (spec.volumetrico && (parseFloat(spec.volumetrico.alto) || 0) > 0) return html; // volumétrico: solo vista 3D + desplegado
    if (trasera) {
      const back = Object.assign({}, spec, { espejo: true, vista: "trasera", aletas: backAletas || [] });
      if (backCortes && backCortes.length) back.extraCortes = backCortes;
      html += '<div class="muted small" style="margin:8px 0 2px">Vista trasera (espejo · diseño trasero):</div>' + window.SketchCIBSA.sketchSVG(back);
    }
    return html;
  }
  // Bolsillos por arista (para el dibujo): solo en modo "por arista" y tipo bolsillo.
  function bolsillosDe(bordeModo, bordes) {
    if (bordeModo !== "arista" || !bordes) return [];
    const out = [];
    ["sup", "inf", "izq", "der"].forEach((k) => {
      const b = bordes[k];
      if (b && b.tipo === "bolsillo") { const d = window.CalcCIBSA.evalExpr(b.diam); out.push({ arista: k, diam: (d != null && !isNaN(d)) ? d : 0 }); }
    });
    return out;
  }

  // --- Datos para el dibujo descargable (observaciones y lista de materiales) ---
  function obsComplementos(list) {
    return (list || []).map((c) => {
      const m = compMat(c); if (!m) return null;
      const extra = [m.modelo, m.color].filter(Boolean).join(" ");
      return "Accesorio: " + m.item + (extra ? " " + extra : "") + " (" + compCant(c) + " " + (m.unidad || "u") + ")";
    }).filter(Boolean);
  }
  function obsVentanas(pz) {
    const ev = window.CalcCIBSA.evalExpr, f = window.CalcCIBSA.fmtNum;
    return (pz.inscritos || []).map((ins) => {
      const w = ev(ins.ancho), h = ev(ins.largo); if (!(w > 0 && h > 0)) return null;
      const pi = ev(ins.padIzq), ps = ev(ins.padSup);
      const dim = ins.forma === "circ" ? ("circular Ø" + f(w)) : (f(w) + "x" + f(h));
      return "Ventana inscrita " + dim + " m (padding izq " + f(pi || 0) + " / sup " + f(ps || 0) + " m)";
    }).filter(Boolean);
  }
  function materialesResumen(ojetillos, complementos, inscritos) {
    const out = [{ nombre: "Ojetillos", cant: String(ojetillos || 0) }];
    (complementos || []).forEach((c) => {
      const m = compMat(c); if (!m) return;
      const extra = [m.modelo, m.color].filter(Boolean).join(" ");
      out.push({ nombre: m.item + (extra ? " " + extra : ""), cant: compCant(c) + " " + (m.unidad || "u") });
    });
    const ev = window.CalcCIBSA.evalExpr, f = window.CalcCIBSA.fmtNum;
    (inscritos || []).forEach((ins) => {
      const w = ev(ins.ancho), h = ev(ins.largo);
      if (w > 0 && h > 0) out.push({ nombre: "Ventana inscrita " + (ins.forma === "circ" ? "circular Ø" + f(w) : f(w) + "x" + f(h)) + " m", cant: "1" });
    });
    return out;
  }
  async function descargarSketch(datos) {
    try {
      const { bytes, filename } = await window.PDFCotizacion.generarSketchPDF(datos);
      const url = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
      descargar(url, filename);
    } catch (e) { alert("Error al generar el plano:\n" + (e.message || e)); }
  }
  function nombreBaseArchivo() {
    const nombre = $("f_nombre").value.trim(), apellido = $("f_apellido").value.trim();
    if (!nombre || !apellido) return "Plano";
    return window.PDFCotizacion.nombreArchivo({ cliente: { nombre, apellido }, version: $("f_version").value.trim() || "01", fecha: new Date() });
  }
  async function descargarSketchUnif() {
    const largo = num("f_largo", null), ancho = num("f_ancho", null);
    if (largo == null || ancho == null || largo <= 0 || ancho <= 0) return alert("Ingresa largo y ancho para descargar el plano.");
    const tela = telaActual();
    const N = Math.max(1, parseInt(num("f_cantidad", 1), 10) || 1);
    await descargarSketch({
      filenameBase: nombreBaseArchivo(),
      titulo: $("f_titulo").value.trim() || ("Carpa " + (+largo) + "m x " + (+ancho) + "m"),
      tela: tela ? tela.nombre : "N/A",
      color: $("f_color").value.trim(),
      largo: largo, ancho: ancho,
      ojetillos: nOjetillos(), unidades: N,
      observaciones: terminacionesTexto(state.orientUnif).concat(obsComplementos(state.complementosUnif)).concat(obsCortes(state.cortesUnif)),
      materiales: materialesResumen(nOjetillos(), state.complementosUnif, []).concat(materialesCortes(state.cortesUnif)),
      sketch: Object.assign({ ancho: ancho, largo: largo, ventanas: [], cortes: cortesSpec(state.cortesUnif), bolsillos: bolsillosDe(state.bordeModo, state.bordes), aletas: aletasSpec(state.aletasUnif), straps: strapsSpec(state.strapsUnif) }, ojSpecUnif(), alturaUnif() > 0 ? { volumetrico: { alto: alturaUnif() } } : {}),
      trasera: state.trasUnif && !(alturaUnif() > 0),
      backExtra: { cortes: cortesSpec(state.backCortesUnif), aletas: aletasSpec(state.backAletasUnif) },
      materialesTrasera: materialesTraseras(state.backCortesUnif, state.backComplementosUnif),
    });
  }
  async function descargarSketchPieza(pz) {
    const ev = window.CalcCIBSA.evalExpr, f = window.CalcCIBSA.fmtNum;
    const largo = ev(pz.largo), ancho = ev(pz.ancho);
    if (!(largo > 0) || !(ancho > 0)) return alert("Esta pieza necesita largo y ancho para el plano.");
    const tela = state.telas.find((t) => t.nombre === pz.telaNombre);
    const N = Math.max(1, parseInt(ev(pz.cantidad) || 1, 10) || 1);
    const etq = (pz.etiqueta || "").trim();
    await descargarSketch({
      filenameBase: nombreBaseArchivo(),
      etiquetaArchivo: etq || null,
      titulo: (etq ? etq + " — " : "Pieza ") + f(largo) + "m x " + f(ancho) + "m",
      tela: tela ? tela.nombre : "N/A",
      color: pz.color || "",
      largo: largo, ancho: ancho,
      ojetillos: ojTotalPieza(pz), unidades: N,
      observaciones: terminacionesPieza(pz).concat(obsComplementos(pz.complementos)).concat(obsVentanas(pz)).concat(obsCortes(pz.cortes)),
      materiales: materialesResumen(ojTotalPieza(pz), pz.complementos, pz.inscritos).concat(materialesCortes(pz.cortes)),
      sketch: sketchPieza(pz),
      trasera: pz.trasera,
      backExtra: { cortes: cortesSpec(pz.backCortes), aletas: aletasSpec(pz.backAletas) },
      materialesTrasera: materialesTraseras(pz.backCortes, pz.backComplementos),
    });
  }

  // Controles de ojetillos de una pieza (total / por arista).
  function renderPiezaOjetillos(container, pz) {
    container.innerHTML = "";
    const onChange = recomputeCompuesto;
    const lm = document.createElement("label"); lm.className = "field";
    const sp = document.createElement("span"); sp.textContent = "Ojetillos (c/u)"; lm.appendChild(sp);
    const sel = document.createElement("select");
    [["total", "Total"], ["arista", "Por arista"]].forEach(([v, t]) => { const o = document.createElement("option"); o.value = v; o.textContent = t; sel.appendChild(o); });
    sel.value = pz.ojMode || "total";
    sel.addEventListener("change", (e) => {
      pz.ojMode = e.target.value;
      if (pz.ojMode === "arista" && !pz.ojEdges) pz.ojEdges = ojEdgesDefault();
      renderPiezaOjetillos(container, pz); onChange();
    });
    lm.appendChild(sel); container.appendChild(lm);
    if ((pz.ojMode || "total") === "total") {
      const li = document.createElement("label"); li.className = "field";
      const s2 = document.createElement("span"); s2.textContent = "Cantidad total (c/u)"; li.appendChild(s2);
      const inp = document.createElement("input"); inp.type = "text"; inp.inputMode = "numeric"; inp.value = pz.ojetillos || "0";
      inp.addEventListener("input", (e) => { pz.ojetillos = e.target.value; onChange(); });
      inp.addEventListener("blur", (e) => { const r = window.CalcCIBSA.evalExpr(e.target.value); if (r != null && !isNaN(r)) { pz.ojetillos = String(Math.max(0, Math.round(r))); e.target.value = pz.ojetillos; onChange(); } });
      li.appendChild(inp); agregarCalc(inp); container.appendChild(li);
      return;
    }
    if (!pz.ojEdges) pz.ojEdges = ojEdgesDefault();
    renderOjetillosArista(container, pz.ojEdges, pz, () => window.CalcCIBSA.evalExpr(pz.ancho), () => window.CalcCIBSA.evalExpr(pz.largo), () => ojTotalPieza(pz), onChange, () => cortesSpec(pz.cortes));
  }

  // UI compartida de ojetillos por arista (distanciamiento + supresión + pareja). host tiene .ojParejo.
  function renderOjetillosArista(container, edges, host, getAncho, getLargo, getTotal, onChange, getCortes) {
    container.innerHTML = ""; // evita apilar copias al repintar (toggle pareja / arista on-off)
    const ev = window.CalcCIBSA.evalExpr, f = window.CalcCIBSA.fmtNum;
    const repintar = () => renderOjetillosArista(container, edges, host, getAncho, getLargo, getTotal, onChange, getCortes);
    // Toggle distribución pareja (ideal)
    const lp = document.createElement("label"); lp.className = "chk";
    const cbp = document.createElement("input"); cbp.type = "checkbox"; cbp.checked = !!host.ojParejo;
    cbp.addEventListener("change", (e) => { host.ojParejo = e.target.checked; repintar(); onChange(); });
    const spp = document.createElement("span"); spp.textContent = "Distribución pareja (ideal, reparte exacto a la medida más cercana)";
    lp.appendChild(cbp); lp.appendChild(spp); addHelpTo(lp, "Reparte los ojetillos en tramos exactamente iguales, ajustando la cantidad a la medida más cercana a tu distanciamiento. Apagado: respeta el distanciamiento y agrega uno extra solo si el último tramo lo supera.", "OJ-PAREJA"); container.appendChild(lp);
    const cap = document.createElement("p"); cap.className = "muted small"; cap.textContent = "Distanciamiento (m) por arista. Las 4 esquinas las colocan las aristas Superior/Inferior (las laterales no las repiten), así cada esquina se cuenta y se suprime una sola vez. El extra se agrega solo si el tramo final supera el distanciamiento."; container.appendChild(cap);
    [["sup", "Superior", getAncho], ["inf", "Inferior", getAncho], ["izq", "Izquierda", getLargo], ["der", "Derecha", getLargo]].forEach(([k, lab, getL]) => {
      const e = edges[k] || (edges[k] = { on: true, d: "0.5", supr: "" });
      const card = document.createElement("div"); card.className = "oj-edge";
      const head = document.createElement("label"); head.className = "chk";
      const cbOn = document.createElement("input"); cbOn.type = "checkbox"; cbOn.checked = e.on !== false;
      cbOn.addEventListener("change", (ev2) => { e.on = ev2.target.checked; repintar(); onChange(); });
      const hs = document.createElement("span"); hs.innerHTML = "<b>" + lab + "</b>"; head.appendChild(cbOn); head.appendChild(hs); card.appendChild(head);
      if (e.on !== false) {
        const grid = document.createElement("div"); grid.className = "pieza-grid";
        const ld = document.createElement("label"); ld.className = "field"; ld.innerHTML = "<span>Distanciamiento (m)</span>";
        const id = document.createElement("input"); id.type = "text"; id.inputMode = "decimal"; id.value = e.d != null ? e.d : "0.5";
        id.addEventListener("input", (ev2) => { e.d = ev2.target.value; refrescar(); onChange(); });
        id.addEventListener("blur", (ev2) => { const r = ev(ev2.target.value); if (r != null && !isNaN(r)) { e.d = f(r); ev2.target.value = e.d; refrescar(); onChange(); } });
        ld.appendChild(id); agregarCalc(id); addHelpTo(ld, "Separación deseada entre ojetillos en esa arista, en metros. La app pone uno en cada esquina y reparte el resto; si el último tramo supera esta medida, agrega uno al medio.", "OJ-DIST"); grid.appendChild(ld);
        const ls = document.createElement("label"); ls.className = "field"; ls.innerHTML = "<span>Suprimir posiciones (0..n, sep. , o /)</span>";
        const is = document.createElement("input"); is.type = "text"; is.value = e.supr || ""; is.placeholder = "ej. 0, 3 / 5";
        is.addEventListener("input", (ev2) => { e.supr = ev2.target.value; refrescar(); onChange(); });
        ls.appendChild(is); addHelpTo(ls, "Quita ojetillos puntuales por su número de orden en la arista (empezando en 0 desde la esquina). Ej.: \"0, 3\" o \"2/5\".", "OJ-SUPR"); grid.appendChild(ls);
        card.appendChild(grid);
        // 2da línea de ojetillos (inset). Al activarse despliega un sub-menú plegable.
        if (!e.linea2) e.linea2 = { on: false, inset: "0.025", supr: "" };
        const l2lab = document.createElement("label"); l2lab.className = "chk";
        const l2cb = document.createElement("input"); l2cb.type = "checkbox"; l2cb.checked = !!e.linea2.on;
        l2cb.addEventListener("change", (ev2) => { e.linea2.on = ev2.target.checked; repintar(); onChange(); });
        const l2sp = document.createElement("span"); l2sp.textContent = "2da línea de ojetillos (paralela, con inset)";
        l2lab.appendChild(l2cb); l2lab.appendChild(l2sp);
        addHelpTo(l2lab, "Agrega una 2da fila de ojetillos paralela a esta arista, hacia adentro. Inset por defecto 0,025 m (½ ojetillo + 0,01). Los ojetillos 0 y n se suprimen solos si chocan con los del borde; puedes suprimir otros a mano.", "OJ-L2");
        card.appendChild(l2lab);
        if (e.linea2.on) {
          const panel = document.createElement("div"); panel.className = "oj-l2-panel";
          const g2 = document.createElement("div"); g2.className = "pieza-grid";
          const li = document.createElement("label"); li.className = "field"; li.innerHTML = "<span>Inset (m)</span>";
          const ii = document.createElement("input"); ii.type = "text"; ii.inputMode = "decimal"; ii.value = e.linea2.inset != null ? e.linea2.inset : "0.025";
          ii.addEventListener("input", (ev2) => { e.linea2.inset = ev2.target.value; refrescar(); onChange(); });
          ii.addEventListener("blur", (ev2) => { const r = ev(ev2.target.value); if (r != null && !isNaN(r)) { e.linea2.inset = f(r); ev2.target.value = e.linea2.inset; refrescar(); onChange(); } });
          li.appendChild(ii); agregarCalc(ii); addHelpTo(li, "Distancia de la 2da línea hacia adentro, en metros. Mínimo sugerido 0,025 m (½ ojetillo + 0,01).", "OJ-L2-INSET"); g2.appendChild(li);
          const ls2 = document.createElement("label"); ls2.className = "field"; ls2.innerHTML = "<span>Suprimir de la 2da línea (0..n)</span>";
          const is2 = document.createElement("input"); is2.type = "text"; is2.value = e.linea2.supr || ""; is2.placeholder = "ej. 2 / 4";
          is2.addEventListener("input", (ev2) => { e.linea2.supr = ev2.target.value; refrescar(); onChange(); });
          ls2.appendChild(is2); addHelpTo(ls2, "Quita ojetillos puntuales de la 2da línea por su número de orden (0 desde la esquina). Los 0 y n ya se suprimen solos si se solapan con el borde.", "OJ-L2-SUPR"); g2.appendChild(ls2);
          panel.appendChild(g2);
          card.appendChild(panel);
          subColapsar(panel, "2da línea — opciones", e.linea2, "_colap", () => true);
        }
        const info = document.createElement("div"); info.className = "muted small oj-edge-info"; card.appendChild(info);
        function refrescar() {
          const L = getL(), d = ev(e.d);
          const tl = container.querySelector(".pz-oj-total");
          if (!(L > 0) || !(d > 0)) { info.textContent = "Define dimensiones y distanciamiento."; if (tl) tl.textContent = "Total: " + getTotal(); return; }
          const removed = getCortes ? (window.SketchCIBSA.intervalosCalados(getAncho(), getLargo(), getCortes())[k] || []) : [];
          const full = posicionesEdge(k, L, d, host.ojParejo, removed, edges), n = full.length;
          const supr = parseSupr(e.supr), kept = n - supr.filter((i) => i < n).length;
          const sinEsq = (k === "izq" || k === "der") && n < window.SketchCIBSA.posicionesAristaSeg(L, d, !!host.ojParejo, removed).length;
          let html = n + " ojetillos (0.." + (n - 1) + ")";
          if (sinEsq) html += " · <span style=\"color:var(--accent)\">esquinas las pone la arista horizontal</span>";
          if (removed.length) {
            html += " · <span style=\"color:var(--accent)\">borde seccionado por calado (ojetillo en cada esquina nueva)</span>";
          } else {
            const esp = n > 1 ? L / (n - 1) : 0;
            html += " · espaciado " + f(esp) + "m";
            if (!host.ojParejo) { const nIdeal = Math.max(1, Math.round(L / d)), idealEsp = L / nIdeal; html += " · <span style=\"color:var(--accent)\">ideal pareja: " + f(idealEsp) + "m (" + (nIdeal + 1) + " oj)</span>"; }
          }
          if (supr.length) html += " · quedan " + kept;
          const malas = supr.filter((i) => i >= n);
          if (malas.length) html += " · <span style=\"color:#d8443a\">⚠ posición " + malas.join(", ") + " supera el máximo (" + (n - 1) + ")</span>";
          info.innerHTML = html;
          if (tl) tl.textContent = "Total: " + getTotal();
        }
        refrescar();
      }
      container.appendChild(card);
    });
    const tot = document.createElement("div"); tot.className = "oj-total pz-oj-total"; tot.textContent = "Total: " + getTotal();
    container.appendChild(tot);
  }

  function renderPiezas() {
    const list = $("piezasList"); if (!list) return;
    list.innerHTML = "";
    state.piezas.forEach((pz, idx) => {
      const card = document.createElement("div");
      card.className = "pieza-card"; card.dataset.id = pz.id;
      card.innerHTML =
        `<div class="pieza-head">
          <span class="pz-num">Pieza ${idx + 1}</span>
          <input class="pz-etq" type="text" placeholder="Etiqueta (ej. Techo, Lateral)" />
          <div class="pz-actions">
            <button class="pz-btn dup" type="button">Duplicar</button>
            <button class="pz-btn del" type="button">Eliminar</button>
          </div>
        </div>
        <div class="pieza-grid">
          <label class="field"><span>Largo (m)</span><input class="pz-largo" type="text" inputmode="text" /></label>
          <label class="field"><span>Ancho (m)</span><input class="pz-ancho" type="text" inputmode="text" /></label>
          <label class="field"><span>Cantidad</span><input class="pz-cant" type="text" inputmode="numeric" /></label>
          <label class="field"><span>Tela</span><select class="pz-tela"></select></label>
          <label class="field full"><span>Orientación de uniones</span><select class="pz-orient">
            <option value="largo">Uniones a lo largo</option>
            <option value="ancho">Uniones a lo ancho</option></select></label>
          <label class="field full"><span>Color (opcional)</span><input class="pz-color" type="text" placeholder="N/A · solo para el plano de taller" /></label>
        </div>
        <label class="chk"><input class="pz-usaAlto" type="checkbox" /> <span>Volumétrico (agregar alto)</span></label>
        <label class="field pz-alto-field hidden"><span>Alto (m)</span><input class="pz-alto" type="text" inputmode="text" placeholder="se suma 2× alto al largo y al ancho" /></label>
        <div class="pz-oj-wrap"></div>
        <div class="pz-borde"></div>
        <div class="pz-comp"></div>
        <div class="pz-ins"></div>
        <div class="pz-cortes"></div>
        <div class="pz-aletas"></div>
        <div class="pz-straps"></div>
        <label class="chk"><input class="pz-tras" type="checkbox" /> <span>Incluir vista trasera (espejo)</span></label>
        <p class="pz-tras-hint muted small hidden">Define primero largo y ancho de la pieza para habilitar la vista trasera.</p>
        <div class="pz-back trasera-box hidden"></div>
        <div class="pz-sketch sketch"></div>
        <div><button class="btn-outline pz-descargar" type="button">Descargar plano (PDF)</button></div>
        <div class="pieza-sub muted small"></div>`;
      list.appendChild(card);
      const q = (s) => card.querySelector(s);
      q(".pz-etq").value = pz.etiqueta || "";
      q(".pz-largo").value = pz.largo || "";
      q(".pz-ancho").value = pz.ancho || "";
      q(".pz-cant").value = pz.cantidad || "1";
      const tsel = q(".pz-tela");
      state.telas.forEach((t) => { const o = document.createElement("option"); o.value = t.nombre; o.textContent = t.nombre + (t.proveedor ? "  —  " + t.proveedor : ""); tsel.appendChild(o); });
      if (pz.telaNombre) tsel.value = pz.telaNombre; else pz.telaNombre = tsel.value;
      q(".pz-orient").value = pz.orient || "largo";
      q(".pz-color").value = pz.color || "";
      q(".pz-color").addEventListener("input", (e) => { pz.color = e.target.value; });
      // Volumétrico (alto) por pieza
      q(".pz-usaAlto").checked = !!pz.usaAlto;
      q(".pz-alto").value = pz.altura || "";
      q(".pz-alto-field").classList.toggle("hidden", !pz.usaAlto);
      q(".pz-usaAlto").addEventListener("change", (e) => { pz.usaAlto = e.target.checked; q(".pz-alto-field").classList.toggle("hidden", !pz.usaAlto); recomputeCompuesto(); });
      q(".pz-alto").addEventListener("input", (e) => { pz.altura = e.target.value; recomputeCompuesto(); });
      q(".pz-alto").addEventListener("blur", (e) => { const r = window.CalcCIBSA.evalExpr(e.target.value); if (r != null && !isNaN(r)) { pz.altura = window.CalcCIBSA.fmtNum(r); e.target.value = pz.altura; recomputeCompuesto(); } });
      renderPiezaOjetillos(q(".pz-oj-wrap"), pz);
      renderPiezaBordes(q(".pz-borde"), pz);
      renderComplementos(q(".pz-comp"), pz.complementos, recomputeCompuesto);
      renderInscritos(q(".pz-ins"), pz);
      renderCortes(q(".pz-cortes"), { cortes: pz.cortes, baseLargo: () => window.CalcCIBSA.evalExpr(pz.largo), baseAncho: () => window.CalcCIBSA.evalExpr(pz.ancho), onChange: recomputeCompuesto });
      renderAletas(q(".pz-aletas"), { aletas: pz.aletas, cantidad: () => Math.max(1, parseInt(window.CalcCIBSA.evalExpr(pz.cantidad) || 1, 10) || 1), valorOj: () => num("f_ojvalor", CFG.VALOR_OJETILLO_DEFAULT), factor: () => facPz(pz), onChange: recomputeCompuesto });
      renderStraps(q(".pz-straps"), { straps: pz.straps, cantidad: () => Math.max(1, parseInt(window.CalcCIBSA.evalExpr(pz.cantidad) || 1, 10) || 1), onChange: recomputeCompuesto });
      subColapsar(q(".pz-oj-wrap"), "Ojetillos", pz, "_cOj", () => (pz.ojMode === "arista") || (parseInt(pz.ojetillos || 0, 10) > 0));
      subColapsar(q(".pz-straps"), "Straps / cintas", pz, "_cStr", () => (pz.straps || []).length);
      subColapsar(q(".pz-borde"), "Bordes y uniones", pz, "_cBorde", () => false);
      subColapsar(q(".pz-comp"), "Complementos", pz, "_cComp", () => (pz.complementos || []).length);
      subColapsar(q(".pz-ins"), "Inscribir paños (ventanas)", pz, "_cIns", () => (pz.inscritos || []).length);
      subColapsar(q(".pz-cortes"), "Cortes / Calados", pz, "_cCut", () => (pz.cortes || []).length);
      subColapsar(q(".pz-aletas"), "Aletas / Solapas / Faldón / Cenefa", pz, "_cAle", () => (pz.aletas || []).length);

      const bindNum = (sel, prop) => {
        q(sel).addEventListener("input", (e) => { pz[prop] = e.target.value; recomputeCompuesto(); });
        q(sel).addEventListener("blur", (e) => {
          const r = window.CalcCIBSA.evalExpr(e.target.value);
          if (r != null && !isNaN(r)) { pz[prop] = window.CalcCIBSA.fmtNum(r); e.target.value = pz[prop]; recomputeCompuesto(); }
        });
      };
      q(".pz-etq").addEventListener("input", (e) => { pz.etiqueta = e.target.value; recomputeCompuesto(); });
      bindNum(".pz-largo", "largo");
      bindNum(".pz-ancho", "ancho");
      bindNum(".pz-cant", "cantidad");
      // Al cambiar las dimensiones del paño base, re-centra las ventanas inscritas.
      [".pz-largo", ".pz-ancho"].forEach((sel) => {
        q(sel).addEventListener("input", () => {
          (pz.inscritos || []).forEach((ins) => centrarInscrito(pz, ins)); if (pz.inscritos && pz.inscritos.length) renderInscritos(q(".pz-ins"), pz);
          const bl = window.CalcCIBSA.evalExpr(pz.largo), ba = window.CalcCIBSA.evalExpr(pz.ancho);
          (pz.cortes || []).forEach((c) => centrarCorte(bl, ba, c)); if (pz.cortes && pz.cortes.length) renderCortes(q(".pz-cortes"), { cortes: pz.cortes, baseLargo: () => window.CalcCIBSA.evalExpr(pz.largo), baseAncho: () => window.CalcCIBSA.evalExpr(pz.ancho), onChange: recomputeCompuesto });
        });
      });
      q(".pz-tela").addEventListener("change", (e) => { pz.telaNombre = e.target.value; recomputeCompuesto(); });
      q(".pz-orient").addEventListener("change", (e) => { pz.orient = e.target.value; recomputeCompuesto(); });
      q(".dup").addEventListener("click", () => duplicarPieza(pz.id));
      q(".del").addEventListener("click", () => eliminarPieza(pz.id));
      q(".pz-descargar").addEventListener("click", () => descargarSketchPieza(pz));
      {
        const backC = q(".pz-back"), trasHint = q(".pz-tras-hint"), trasCb = q(".pz-tras");
        backC.innerHTML = '<div class="pz-back-cortes"></div><div class="pz-back-aletas"></div><div class="pz-back-comp"></div>';
        renderTraseraDiseno(backC.querySelector(".pz-back-cortes"), backC.querySelector(".pz-back-comp"), () => pz.backCortes, () => pz.backComplementos, () => window.CalcCIBSA.evalExpr(pz.largo), () => window.CalcCIBSA.evalExpr(pz.ancho), recomputeCompuesto);
        renderAletas(backC.querySelector(".pz-back-aletas"), { aletas: pz.backAletas, cantidad: () => Math.max(1, parseInt(window.CalcCIBSA.evalExpr(pz.cantidad) || 1, 10) || 1), valorOj: () => num("f_ojvalor", CFG.VALOR_OJETILLO_DEFAULT), factor: () => facPz(pz), onChange: recomputeCompuesto });
        trasCb.checked = !!pz.trasera;
        const actualizarTrasPz = () => {
          const ok = window.CalcCIBSA.evalExpr(pz.largo) > 0 && window.CalcCIBSA.evalExpr(pz.ancho) > 0;
          trasCb.disabled = !ok; trasHint.classList.toggle("hidden", ok);
          if (!ok && pz.trasera) { pz.trasera = false; trasCb.checked = false; }
          backC.classList.toggle("hidden", !(ok && pz.trasera));
        };
        trasCb.addEventListener("change", (e) => { pz.trasera = e.target.checked; actualizarTrasPz(); recomputeCompuesto(); });
        q(".pz-largo").addEventListener("input", actualizarTrasPz);
        q(".pz-ancho").addEventListener("input", actualizarTrasPz);
        actualizarTrasPz();
      }
      hacerColapsablePieza(card, pz);
    });
  }

  function bordesDePieza(pz) {
    if (pz.bordeModo === "arista") return pz.bordes;
    const b = { tipo: "borde", valor: pz.bordeValor };
    return { sup: b, inf: b, izq: b, der: b };
  }
  function calcPieza(pz) {
    const tela = state.telas.find((t) => t.nombre === pz.telaNombre);
    const largo = window.CalcCIBSA.evalExpr(pz.largo);
    const ancho = window.CalcCIBSA.evalExpr(pz.ancho);
    if (!tela || largo == null || ancho == null || largo <= 0 || ancho <= 0) return null;
    const u = window.CalcCIBSA.evalExpr(pz.union);
    let lote;
    try {
      lote = window.CalcCIBSA.calcularLote({
        largo, ancho, valorM2: tela.valorM2, anchoRollo: tela.anchoRollo,
        cantidad: Math.max(1, parseInt(window.CalcCIBSA.evalExpr(pz.cantidad) || 1, 10) || 1),
        union: (u == null || isNaN(u)) ? 0.045 : u,
        altura: pz.usaAlto ? (window.CalcCIBSA.evalExpr(pz.altura) || 0) : 0,
        defaults: BORDE_DEFAULTS, bordes: bordesDePieza(pz), factorTela: facPz(pz),
        ojetillos: ojTotalPieza(pz),
        valorOjetillo: num("f_ojvalor", CFG.VALOR_OJETILLO_DEFAULT),
      });
    } catch (e) { return null; }
    const o = pz.orient === "ancho" ? lote.oAncho : lote.oLargo;
    return { tela, largo, ancho, lote, o };
  }
  function descBordePz(b) {
    if (!b || b.tipo === "bruto") return "bruto";
    if (b.tipo === "borde") return "borde " + (b.valor || "0.045") + " m";
    if (b.tipo === "borde_cuerda") return "borde+cuerda Ø" + (b.diam || "0") + " m";
    if (b.tipo === "bolsillo") return "bolsillo Ø" + (b.diam || "0") + " m";
    return "borde";
  }
  function terminacionesPieza(pz) {
    const out = [];
    const alt = pz.usaAlto ? (window.CalcCIBSA.evalExpr(pz.altura) || 0) : 0;
    if (alt > 0) out.push("Volumétrico: alto " + alt + " m (se sumó 2× alto al largo y ancho).");
    out.push("Unión: " + (pz.union || "0.045") + " m.");
    if (pz.bordeModo === "arista") {
      const nm = { sup: "Sup", inf: "Inf", izq: "Izq", der: "Der" };
      out.push("Bordes: " + ["sup", "inf", "izq", "der"].map((k) => nm[k] + " " + descBordePz(pz.bordes[k])).join(" · ") + ".");
    } else {
      out.push("Borde perimetral: " + (pz.bordeValor || "0.045") + " m.");
    }
    if (facUnif() > 1) out.push("ƒ(x) ; x= " + facUnif());
    return out;
  }

  function etiquetasDuplicadas() {
    const counts = {}, labelOf = {};
    state.piezas.forEach((pz) => {
      const raw = (pz.etiqueta || "").trim(); const k = raw.toLowerCase();
      if (!k) return; counts[k] = (counts[k] || 0) + 1; labelOf[k] = raw;
    });
    return Object.keys(counts).filter((k) => counts[k] > 1).map((k) => labelOf[k]);
  }

  function recomputeCompuesto() {
    const list = $("piezasList"), resumen = $("piezasResumen");
    let subtotalGen = 0; const calcs = [];
    state.piezas.forEach((pz) => {
      const r = calcPieza(pz);
      const sketchBox = list ? list.querySelector('[data-id="' + pz.id + '"] .pz-sketch') : null;
      if (sketchBox && window.SketchCIBSA && !document.body.classList.contains("no-plano")) {
        sketchBox.innerHTML = sketchDualSVG(sketchPieza(pz), pz.trasera, cortesSpec(pz.backCortes), aletasSpec(pz.backAletas));
      }
      const card = list ? list.querySelector('[data-id="' + pz.id + '"] .pieza-sub') : null;
      if (r) {
        const compUnit = compTotalUnit(pz.complementos);
        const insTot = inscritosTotal(pz);
        const valOjPz = num("f_ojvalor", CFG.VALOR_OJETILLO_DEFAULT);
        const aleTot = aletasTotal(pz.aletas, r.lote.N, valOjPz, facPz(pz)) + aletasTotal(pz.backAletas, r.lote.N, valOjPz, facPz(pz));
        const strapTot = strapsTotal(pz.straps, r.lote.N);
        const piezaTotal = r.o.subtotalLote + compUnit * r.lote.N + insTot + aleTot + strapTot;
        r.compUnit = compUnit; r.insTot = insTot; r.aleTot = aleTot; r.strapTot = strapTot; r.piezaTotal = piezaTotal;
        subtotalGen += piezaTotal; calcs.push({ pz, r });
        if (card) {
          let s = `Subtotal: <b>${money(piezaTotal)}</b> · ${r.lote.N} u × (${r.largo}×${r.ancho} m) · ${r.o.panosUnit} paños/u`;
          s += ` · <span class="muted">tela: rollo ${r.tela.anchoRollo} m · m² ${money(r.tela.valorM2)}</span>`;
          if (compUnit > 0) s += ` · +${(pz.complementos || []).length} complemento(s)`;
          if ((pz.inscritos || []).length) s += ` · +${pz.inscritos.length} ventana(s)`;
          { const na = (pz.aletas || []).length + (pz.backAletas || []).length; if (na) s += ` · +${na} aleta(s) ${money(aleTot)}`; }
          if (r.lote.unionInvalida) s += ` · <span style="color:#d8443a">⚠ unión ≥ ancho de rollo: revisa el valor de "Unión entre paños"</span>`;
          if (r.o.prorrata) s += ` · prorrata −${money(r.o.ahorro)}`;
          if (r.o.faltanteParaBajar != null && r.o.faltanteParaBajar <= 0.05) s += ` · a ${(r.o.faltanteParaBajar * 100).toFixed(1)} cm de bajar un paño`;
          card.innerHTML = s;
        }
      } else if (card) {
        card.innerHTML = '<span class="muted">Completa largo, ancho y tela para ver el subtotal.</span>';
      }
    });
    const dup = etiquetasDuplicadas();
    const err = $("piezasErr");
    if (err) {
      if (dup.length) { err.classList.remove("hidden"); err.textContent = "Etiquetas repetidas: " + dup.join(", ") + ". Usa un nombre distinto para cada pieza."; }
      else err.classList.add("hidden");
    }
    const desc = num("f_descuento", 0);
    const descuento = Math.round(subtotalGen * desc / 100);
    const neto = subtotalGen - descuento;
    const iva = Math.round(neto * CFG.IVA_PCT / 100);
    const total = neto + iva;
    let resumenHTML;
    if (!calcs.length) {
      resumenHTML = '<p class="muted small">Agrega piezas con largo, ancho y tela para ver el total.</p>';
    } else {
      let h = '<div class="cmp-card"><div class="h">Resumen (' + calcs.length + ' pieza' + (calcs.length > 1 ? 's' : '') + ')</div>';
      h += `<div class="muted small">Subtotal neto: ${money(subtotalGen)}</div>`;
      if (desc > 0) { h += `<div class="muted small">Descuento ${desc}%: -${money(descuento)}</div>`; h += `<div class="muted small">Neto con descuento: ${money(neto)}</div>`; }
      h += `<div class="muted small">IVA ${CFG.IVA_PCT}%: ${money(iva)}</div>`;
      h += `<div class="total">${money(total)}</div></div>`;
      resumenHTML = h;
    }
    if (resumen) resumen.innerHTML = resumenHTML;
    { const rb = $("piezasResumenBottom"); if (rb) rb.innerHTML = resumenHTML; }
    state.compuesto = { calcs, subtotalGen, desc, descuento, neto, iva, total };
  }

  // ---------- Limpiar todos los campos de la App ----------
  // Deja la App como recién abierta. NO toca el historial (que es persistente).
  // Se usa: botón "Limpiar", al abrir/reiniciar la App y antes de aplicar un registro del historial.
  function limpiarCampos() {
    ["f_nombre", "f_apellido", "f_email", "f_largo", "f_ancho", "f_titulo", "f_observaciones", "f_color"].forEach((id) => { const el = $(id); if (el) el.value = ""; });
    $("f_cantidad").value = "1"; $("f_ojvalor").value = "450"; $("f_dias").value = "3"; $("f_descuento").value = "0"; $("f_version").value = "01";
    $("f_union").value = "0.045";
    $("f_usaAlto").checked = false; $("f_altura").value = ""; $("wAltura").classList.add("hidden");
    state.ojMode = "total"; state.ojTotal = 8; state.ojAristas = []; state.ojEdges = null; state.ojParejo = false; state.trasUnif = false; state.ojSubstate = "count"; state.ojAristasN = 4; state.ojError = "";
    state.cortesUnif = []; state.backCortesUnif = []; state.backComplementosUnif = []; state.aletasUnif = []; state.backAletasUnif = []; state.strapsUnif = []; state.factorUnif = "1";
    { const t = $("f_trasUnif"); if (t) t.checked = false; }
    document.querySelector('input[name="ojmode"][value="total"]').checked = true;
    state.orientacionSel = "mayor"; state.orientUnif = "largo"; $("resultHolder").innerHTML = ""; $("formStatus").textContent = "";
    const multi = $("telaMulti"); if (multi) multi.querySelectorAll("input:checked").forEach((c) => (c.checked = false));
    $("telaMultiErr").classList.add("hidden"); state.prelim = [];
    // Reset bordes/unión → mismo borde 0.045
    state.bordeModo = "uniforme"; state.bordeValor = "0.045";
    state.bordes = { sup: { tipo: "borde", valor: "0.045", diam: "" }, inf: { tipo: "borde", valor: "0.045", diam: "" }, izq: { tipo: "borde", valor: "0.045", diam: "" }, der: { tipo: "borde", valor: "0.045", diam: "" } };
    const rb = document.querySelector('input[name="bordemodo"][value="uniforme"]'); if (rb) rb.checked = true;
    // Reset producto compuesto → vuelve a uniforme
    state.prodMode = "uniforme"; state.piezas = []; state.compuesto = null;
    state.complementosUnif = [];
    const ru = document.querySelector('input[name="prodmode"][value="uniforme"]'); if (ru) ru.checked = true;
    renderPiezas(); renderBordes(); renderComplementosUnif(); renderCortesUnif(); renderAletasUnif(); renderStrapsUnif(); renderTraseraUnif(); setFactorUnifUI(); aplicarVis();
    renderOjetillos(); recompute();
  }
  { const limpiarTodo = () => { limpiarBorrador(); limpiarCampos(); }; const b1 = $("btnLimpiar"); if (b1) b1.addEventListener("click", limpiarTodo); const b2 = $("btnLimpiarCliente"); if (b2) b2.addEventListener("click", limpiarTodo); }

  // ---------- Generar ----------
  $("btnGenerar").addEventListener("click", generar);
  { const b = $("btnDescargarSketch"); if (b) b.addEventListener("click", descargarSketchUnif); }
  { const t = $("f_trasUnif"); if (t) t.addEventListener("change", () => { state.trasUnif = t.checked; recompute(); }); }
  { const cb = $("f_usarPlano"); if (cb) cb.addEventListener("change", () => { document.body.classList.toggle("no-plano", !cb.checked); recompute(); }); }

  async function generar() {
    if (state.docMode === "preliminar") return generarPrelim();
    if (state.docMode === "formal" && state.prodMode === "compuesto") return generarCompuesto();
    const nombre = $("f_nombre").value.trim(), apellido = $("f_apellido").value.trim();
    const largo = num("f_largo", null), ancho = num("f_ancho", null), tela = telaActual();
    if (!nombre || !apellido) return alert("Ingresa nombre y apellido del cliente.");
    if (!tela) return alert("Selecciona una tela.");
    if (largo == null || ancho == null || largo <= 0 || ancho <= 0) return alert("Largo y ancho deben ser mayores que 0.");
    sugerirFactor();
    recomputeUniforme();
    const lote = state.loteUnif;
    if (!lote) return alert("No se pudo calcular. Revisa los datos.");
    const o = state.orientUnif === "ancho" ? lote.oAncho : lote.oLargo;
    const N = lote.N;
    const desc = num("f_descuento", 0);
    const ojeTotal = lote.nOjetillos * lote.valorOjetillo * N;
    const compTotal = compTotalUnit(state.complementosUnif) * N;
    const aleTotal = aletasTotal(state.aletasUnif, N, lote.valorOjetillo, facUnif()) + aletasTotal(state.backAletasUnif, N, lote.valorOjetillo, facUnif());
    const strapTotal = strapsTotal(state.strapsUnif, N);
    const subtotal = o.materialLote + ojeTotal + compTotal + aleTotal + strapTotal;
    const descuento = Math.round(subtotal * desc / 100);
    const neto = subtotal - descuento;
    const iva = Math.round(neto * CFG.IVA_PCT / 100);
    const total = neto + iva;
    const calc = {
      cantidad: N,
      material: o.materialLote / N, materialTotal: o.materialLote,
      nOjetillos: lote.nOjetillos, nOjetillosTotal: lote.nOjetillos * N,
      valorOjetillo: lote.valorOjetillo, ojetillosValor: lote.nOjetillos * lote.valorOjetillo,
      ojetillosValorTotal: ojeTotal,
      subtotal, descuentoPct: desc, descuento, netoConDescuento: neto,
      ivaPct: CFG.IVA_PCT, iva, total, panos: o.panosLote, m2: o.m2Lote,
    };
    const datos = {
      cliente: { nombre, apellido, email: $("f_email").value.trim() },
      version: $("f_version").value.trim() || "01", fecha: new Date(),
      largo, ancho, tela, calc,
      titulo: $("f_titulo").value.trim() || null,
      ojetillosDetalle: ojDetalle(),
      diasEntrega: parseInt(num("f_dias", CFG.DIAS_ENTREGA_DEFAULT), 10),
      descuentoLabel: desc > 0 ? `Descuento ${desc}% (pago contado)` : null,
      vendedor: vendedorSel(),
      observaciones: $("f_observaciones").value.trim() || null,
      detalleExtra: terminacionesTexto(state.orientUnif),
      complementos: complementosUnifPDF(N),
      aletas: aletasUnifPDF(state.aletasUnif, N).concat(aletasUnifPDF(state.backAletasUnif, N)).concat(strapsLineasPDF(state.strapsUnif)),
      sketch: { ancho: ancho, largo: largo, ojTotal: lote.nOjetillos, ventanas: [], cortes: cortesSpec(state.cortesUnif), bolsillos: bolsillosDe(state.bordeModo, state.bordes), aletas: aletasSpec(state.aletasUnif), straps: strapsSpec(state.strapsUnif) },
    };
    guardarHistorial(nombre, apellido, datos.version);

    abrirProgreso();
    try {
      const { bytes, filename } = await window.PDFCotizacion.generarCotizacion(datos);
      const blob = new Blob([bytes], { type: "application/pdf" });
      genListo(blob, filename, calc);
    } catch (e) {
      cerrarProgreso();
      alert("Error al generar el PDF:\n" + (e.message || e));
    }
  }

  function descBorde(b) {
    if (!b || b.tipo === "bruto") return "bruto (sin borde)";
    if (b.tipo === "borde") return "borde " + (b.valor || "0.045") + " m";
    if (b.tipo === "borde_cuerda") return "borde + cuerda Ø" + (b.diam || "0") + " m";
    if (b.tipo === "bolsillo") return "bolsillo Ø" + (b.diam || "0") + " m";
    return "borde";
  }
  function terminacionesTexto(orientKey) {
    const out = [];
    const alt = alturaUnif();
    if (alt > 0) out.push("Volumétrico: alto " + alt + " m (se sumó 2× alto al largo y al ancho).");
    out.push(orientKey === "ancho" ? "Uniones a lo ancho." : "Uniones a lo largo.");
    out.push("Unión entre paños: " + $("f_union").value + " m.");
    if (state.bordeModo === "uniforme") {
      out.push("Borde perimetral: " + state.bordeValor + " m en las 4 aristas.");
    } else {
      const nm = { sup: "Superior", inf: "Inferior", izq: "Izquierda", der: "Derecha" };
      ["sup", "inf", "izq", "der"].forEach((k) => out.push(nm[k] + ": " + descBorde(state.bordes[k]) + "."));
    }
    if (facUnif() > 1) out.push("ƒ(x) ; x= " + facUnif());
    return out;
  }

  // ---------- Generar cotización compuesta ----------
  async function generarCompuesto() {
    const nombre = $("f_nombre").value.trim(), apellido = $("f_apellido").value.trim();
    if (!nombre || !apellido) return alert("Ingresa nombre y apellido del cliente.");
    if (!state.piezas.length) return alert("Agrega al menos una pieza.");
    const dup = etiquetasDuplicadas();
    if (dup.length) return alert("Hay etiquetas de pieza repetidas: " + dup.join(", ") + ". Usa un nombre distinto para cada pieza.");
    sugerirFactor();
    recomputeCompuesto();
    const calcs = (state.compuesto && state.compuesto.calcs) || [];
    if (!calcs.length) return alert("Ninguna pieza tiene largo, ancho y tela válidos.");
    if (calcs.length !== state.piezas.length &&
        !confirm("Algunas piezas están incompletas y no se incluirán en el documento. ¿Continuar?")) return;

    const desc = num("f_descuento", 0);
    const datos = {
      cliente: { nombre, apellido, email: $("f_email").value.trim() },
      version: $("f_version").value.trim() || "01", fecha: new Date(),
      titulo: $("f_titulo").value.trim() || null,
      diasEntrega: parseInt(num("f_dias", CFG.DIAS_ENTREGA_DEFAULT), 10),
      descuentoPct: desc,
      descuentoLabel: desc > 0 ? `Descuento ${desc}% (pago contado)` : null,
      vendedor: vendedorSel(),
      observaciones: $("f_observaciones").value.trim() || null,
      piezas: calcs.map(({ pz, r }) => ({
        etiqueta: (pz.etiqueta || "").trim(),
        tela: r.tela, largo: r.largo, ancho: r.ancho,
        cantidad: r.lote.N, ojetillos: r.lote.nOjetillos, ojetillosTxt: ojetillosTxtPieza(pz),
        orientTxt: pz.orient === "ancho" ? "uniones a lo ancho" : "uniones a lo largo",
        terminaciones: terminacionesPieza(pz),
        complementosLineas: compLineasPDF(pz.complementos),
        inscritosLineas: inscritosLineasPDF(pz).concat(aletasLineasPDF(pz.aletas, r.lote.N, num("f_ojvalor", CFG.VALOR_OJETILLO_DEFAULT), facPz(pz))).concat(aletasLineasPDF(pz.backAletas, r.lote.N, num("f_ojvalor", CFG.VALOR_OJETILLO_DEFAULT), facPz(pz))).concat(strapsLineasPDF(pz.straps)),
        sketch: sketchPieza(pz),
        valorUnitario: r.o.valorUnitario + (r.compUnit || 0) + (((r.insTot || 0) + (r.aleTot || 0)) / r.lote.N),
        valorTotal: r.piezaTotal != null ? r.piezaTotal : r.o.subtotalLote,
      })),
    };
    guardarHistorial(nombre, apellido, datos.version);

    abrirProgreso();
    try {
      const { bytes, filename } = await window.PDFCotizacion.generarCotizacionCompuesta(datos);
      const blob = new Blob([bytes], { type: "application/pdf" });
      genListo(blob, filename, null);
    } catch (e) {
      cerrarProgreso();
      alert("Error al generar el PDF:\n" + (e.message || e));
    }
  }

  // ---------- Generar valor preliminar ----------
  async function generarPrelim() {
    const largo = num("f_largo", null), ancho = num("f_ancho", null);
    const telas = telasMultiSel();
    if (largo == null || ancho == null || largo <= 0 || ancho <= 0) return alert("Largo y ancho deben ser mayores que 0.");
    if (telas.length === 0) { $("telaMultiErr").classList.remove("hidden"); return alert("Marca al menos una tela recomendada."); }
    $("telaMultiErr").classList.add("hidden");
    recomputePrelim();
    if (!state.prelim.length) return alert("No se pudo calcular. Revisa los datos.");

    const datos = {
      fecha: new Date(),
      largo, ancho,
      ojetillosDetalle: ojDetalle(),
      orientacionTxt: orientacionTxt(),
      vendedor: vendedorSel(),
      items: state.prelim.map((p) => ({ tela: p.tela, calc: p.res })),
    };

    abrirProgreso();
    try {
      const { bytes, filename } = await window.PDFCotizacion.generarPreliminar(datos);
      const blob = new Blob([bytes], { type: "application/pdf" });
      genListo(blob, filename, null);
    } catch (e) {
      cerrarProgreso();
      alert("Error al generar el PDF:\n" + (e.message || e));
    }
  }

  // ---------- Modal de progreso ----------
  function abrirProgreso() {
    $("progressModal").classList.remove("hidden");
    $("progressDone").classList.add("hidden");
    $("progressMsg").classList.remove("hidden");
    $("progressFill").classList.remove("done");
    state.progVal = 0; $("progressFill").style.width = "0%"; $("progressPct").textContent = "0%";
    clearInterval(state.progTimer);
    state.progTimer = setInterval(() => {
      state.progVal = Math.min(0.92, state.progVal + 0.06);
      $("progressFill").style.width = Math.round(state.progVal * 100) + "%";
      $("progressPct").textContent = Math.round(state.progVal * 100) + "%";
    }, 110);
  }
  function cerrarProgreso() {
    clearInterval(state.progTimer); clearTimeout(state.closeTimer); clearInterval(state.closeIntv);
    $("progressModal").classList.add("hidden");
  }

  // Auto-cierre del modal: 6 s con cuenta regresiva + botones cerrar / no cerrar.
  function iniciarAutoCierre() {
    let seg = 6;
    const msg = $("autoCierreMsg");
    if (msg) { msg.classList.remove("hidden"); msg.innerHTML = 'Esta ventana se cerrará sola en <span id="autoCierreSeg">' + seg + '</span> s.'; }
    clearInterval(state.closeIntv); clearTimeout(state.closeTimer);
    state.closeIntv = setInterval(() => {
      seg -= 1;
      const segEl = $("autoCierreSeg"); if (segEl) segEl.textContent = String(Math.max(0, seg));
      if (seg <= 0) clearInterval(state.closeIntv);
    }, 1000);
    state.closeTimer = setTimeout(() => { clearInterval(state.closeIntv); cerrarProgreso(); }, 6000);
  }
  function cancelarAutoCierre() {
    clearTimeout(state.closeTimer); clearInterval(state.closeIntv);
    const msg = $("autoCierreMsg"); if (msg) msg.textContent = "Auto-cierre cancelado. Cierra la ventana cuando quieras.";
  }
  if ($("btnCerrarModal")) $("btnCerrarModal").addEventListener("click", cerrarProgreso);
  if ($("btnNoCerrar")) $("btnNoCerrar").addEventListener("click", cancelarAutoCierre);

  function genListo(blob, filename, res) {
    clearInterval(state.progTimer);
    $("progressFill").style.width = "100%"; $("progressFill").classList.add("done");
    $("progressPct").textContent = "100%";
    $("progressMsg").classList.add("hidden");
    $("doneFile").textContent = filename;
    $("progressDone").classList.remove("hidden");

    const file = new File([blob], filename, { type: "application/pdf" });
    const url = URL.createObjectURL(blob);

    const abrir = $("lnkAbrir");
    abrir.onclick = (e) => { e.preventDefault(); descargar(url, filename); };

    const comp = $("lnkCompartir");
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      comp.classList.remove("hidden");
      comp.onclick = async (e) => {
        e.preventDefault();
        try { await navigator.share({ files: [file], title: filename }); } catch (err) {}
      };
    } else { comp.classList.add("hidden"); }

    const wa = $("lnkWhatsapp");
    if (wa) {
      wa.onclick = async (e) => {
        e.preventDefault();
        const msg = "Hola, te comparto la cotización CIBSA: " + filename;
        if (navigator.canShare && navigator.canShare({ files: [file] })) {
          try { await navigator.share({ files: [file], title: filename, text: msg }); } catch (err) {}
        } else {
          descargar(url, filename);
          window.open("https://wa.me/?text=" + encodeURIComponent(msg + " (PDF descargado; adjúntalo aquí)"), "_blank");
        }
      };
    }

    // Resultado persistente en el formulario
    $("resultHolder").innerHTML = `<span class="ok">✓ Generado:</span> <span class="muted small">${filename}</span> `;
    const a = document.createElement("a"); a.href = "#"; a.textContent = "Abrir / Descargar";
    a.onclick = (e) => { e.preventDefault(); descargar(url, filename); };
    $("resultHolder").appendChild(a);

    iniciarAutoCierre();
  }

  function descargar(url, filename) {
    guardarBorrador(); // iPhone: si iOS recarga la pestaña al abrir el archivo, al volver se repone el estado
    const a = document.createElement("a");
    a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
  }

  // ---------- Calculadora emergente (campos que aceptan expresiones; útil en iPhone) ----------
  const calc = { input: null, expr: "" };
  function calcRender() { const d = $("calcDisp"); if (d) d.textContent = calc.expr || "0"; }
  function abrirCalc(input) { calc.input = input; calc.expr = String(input.value || "").trim(); calcRender(); $("calcModal").classList.remove("hidden"); }
  function cerrarCalc() { $("calcModal").classList.add("hidden"); calc.input = null; }
  function calcKey(k) {
    if (k === "C") calc.expr = "";
    else if (k === "back") calc.expr = calc.expr.slice(0, -1);
    else if (k === "eq") { const r = window.CalcCIBSA.evalExpr(calc.expr); if (r != null && !isNaN(r)) calc.expr = String(Math.round(r * 1000) / 1000); }
    else calc.expr += k;
    calcRender();
  }
  function agregarCalc(input) {
    if (!input || !input.parentNode) return;
    const wrap = document.createElement("div"); wrap.className = "calc-wrap";
    input.parentNode.insertBefore(wrap, input); wrap.appendChild(input);
    const b = document.createElement("button"); b.type = "button"; b.className = "calc-btn"; b.textContent = "🧮"; b.title = "Calculadora";
    b.addEventListener("click", () => abrirCalc(input));
    wrap.appendChild(b);
  }
  (function initCalc() {
    const m = $("calcModal"); if (!m) return;
    m.querySelectorAll("[data-k]").forEach((b) => b.addEventListener("click", () => calcKey(b.dataset.k)));
    $("calcUsar").addEventListener("click", () => {
      if (!calc.input) return cerrarCalc();
      const r = window.CalcCIBSA.evalExpr(calc.expr);
      calc.input.value = (r != null && !isNaN(r)) ? String(Math.round(r * 1000) / 1000) : calc.expr;
      calc.input.dispatchEvent(new Event("input", { bubbles: true }));
      calc.input.dispatchEvent(new Event("blur", { bubbles: true }));
      cerrarCalc();
    });
    $("calcCerrar").addEventListener("click", cerrarCalc);
    m.addEventListener("click", (e) => { if (e.target === m) cerrarCalc(); });
  })();

  // ---------- Inicio ----------
  (function init() {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("sw.js").catch(() => {});
    }
    let t = "A";
    try { t = localStorage.getItem("cibsa_tema") || "A"; } catch (e) {}
    aplicarTema(t);
    renderBordes();
    renderComplementosUnif();
    renderCortesUnif();
    renderAletasUnif(); renderStrapsUnif();
    renderTraseraUnif();
    renderHistorial();
    limpiarCampos(); // arranque/reinicio de sesión: App siempre comienza sin datos de cotizaciones previas
    aplicarAyudas();
    initColapsables();
    initNav();
    aplicarVis();
    const s = window.AuthCIBSA.sesionGuardada();
    if (s) { cargarTelas().catch(() => mostrarLogin()); } else { mostrarLogin(); }
  })();
})();
