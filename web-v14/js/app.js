/* Controlador de la app web Cotizador CIBSA. */
(function () {
  const $ = (id) => document.getElementById(id);
  const CFG = window.CONFIG;
  const money = window.CalcCIBSA.money;

  const state = {
    telas: [], orientaciones: null, orientacionSel: "mayor", orientUnif: "largo",
    ojMode: "total", ojTotal: 8, ojSubstate: "count", ojAristasN: 4,
    ojAristas: [], ojEdges: null, ojParejo: false, ojNumerar: false, cotasOcultas: {}, rotDrag: {}, rotColapsar: false, rotReubicar: false, ojError: "", trasUnif: false, ultimoPdf: null, progTimer: null, progVal: 0,
    docMode: "formal", prodMode: "uniforme", prelim: [], vendedores: [], materiales: [], granel: [], granelLineas: [], wikiAyuda: {}, factorUnif: "1",
    piezas: [], compuesto: null, closeTimer: null, closeIntv: null, complementosUnif: [], cortesUnif: [],
    backCortesUnif: [], backComplementosUnif: [], aletasUnif: [], backAletasUnif: [], strapsUnif: [], cintasUnif: [],
    // v4: bordes y unión (uniforme)
    bordeModo: "uniforme", bordeValor: "0.045", bordeRotUnif: false, unionRot: false,
    bordes: {
      sup: { tipo: "borde", valor: "0.045", diam: "" },
      inf: { tipo: "borde", valor: "0.045", diam: "" },
      izq: { tipo: "borde", valor: "0.045", diam: "" },
      der: { tipo: "borde", valor: "0.045", diam: "" },
    },
    loteUnif: null,
    ufValor: 0, // valor de la UF del día (mindicador.cl); 0 = aún no cargada → mínimo de producción inactivo
  };
  let piezaSeq = 0;
  const BORDE_DEFAULTS = { borde: 0.045, unionCierre: 0.045 };

  // ---------- UF del día (mínimo de producción) ----------
  // Trae la UF de mindicador.cl con caché por día en localStorage. Si la red falla, usa el último
  // valor cacheado (aunque sea de otro día). Si nunca se obtuvo, ufValor=0 → mínimo inactivo.
  const UF_KEY = "cibsa_uf";
  async function cargarUF() {
    const hoy = new Date().toISOString().slice(0, 10);
    try { const c = JSON.parse(localStorage.getItem(UF_KEY) || "null"); if (c && c.valor > 0) { state.ufValor = c.valor; if (c.fecha === hoy) return; } } catch (e) {}
    try {
      const r = await fetch(CFG.UF_API, { cache: "no-store" });
      const j = await r.json();
      const v = (j && j.serie && j.serie[0] && j.serie[0].valor) || (j && j.uf && j.uf.valor) || 0;
      if (v > 0) {
        state.ufValor = v;
        try { localStorage.setItem(UF_KEY, JSON.stringify({ valor: v, fecha: hoy })); } catch (e) {}
        if (typeof recompute === "function") recompute();
      }
    } catch (e) { console.warn("CIBSA: no se pudo obtener la UF —", e && e.message ? e.message : e); }
  }
  // Mínimo de producción en pesos (0,6 UF) con la UF actual; 0 si no hay UF cargada.
  function minProduccionPesos() { return state.ufValor > 0 ? Math.round((CFG.MIN_PRODUCCION_UF || 0) * state.ufValor) : 0; }
  // Descuento sobre el mínimo según la posición de la unidad (1ª = 0; 2ª/3ª/4ª+ = config).
  function minProdDctoPos(pos) {
    if (pos <= 1) return 0;
    const arr = CFG.MIN_PRODUCCION_DCTO || [];
    return arr.length ? (pos - 2 < arr.length ? arr[pos - 2] : arr[arr.length - 1]) : 0;
  }
  // Recargo TOTAL por mínimo de producción, escalonado por unidad. unitNets = netos por unidad
  // (carpa, antes del descuento). El piso de la unidad k = 0,6 UF × (1 − dcto_k); se cobra el mayor
  // entre ese piso y el valor real (recargo = piso − neto si el neto no llega). 1ª unidad sin descuento.
  // Se ordenan de mayor a menor neto: las unidades baratas caen en posiciones con más descuento.
  function minProduccionEscalonado(unitNets) {
    const base = state.ufValor > 0 ? (CFG.MIN_PRODUCCION_UF || 0) * state.ufValor : 0;
    if (base <= 0 || !unitNets || !unitNets.length) return 0;
    const sorted = unitNets.slice().sort((a, b) => b - a);
    let total = 0;
    sorted.forEach((net, i) => { const piso = base * (1 - minProdDctoPos(i + 1)); if (net < piso) total += (piso - net); });
    return Math.round(total);
  }
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
    show("wGranel", f);
    show("wFactura", f);
    show("wProdToggle", f);
    show("wDimensiones", uni || p);
    show("wCantidad", uni);
    show("wTelaUnica", uni);
    show("telaMultiWrap", p);
    show("wPiezas", comp);
    show("wPreviewCompuesto", comp);
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
  const CORREL_KEY = "cibsa_correl_max_v1"; // marca de máximo histórico del correlativo (solo sube; sobrevive al borrado)
  const HIST_HOJA = (CFG.HOJA_HISTORIAL || "HISTORIAL");
  const HIST_ENC = ["Timestamp", "Nombre", "Apellido", "Tipo", "Version", "Fecha", "Datos(JSON)"];
  function entryToRow(e) { return [e.ts, e.nombre || "", e.apellido || "", e.tipo || "", parseInt(e.version, 10) || 1, e.fecha || "", JSON.stringify(e.snap || null)]; }
  function rowToEntry(r) {
    const ts = parseInt(r && r[0], 10) || 0; if (!ts) return null; // descarta encabezado / filas inválidas
    let snap = null; try { snap = r[6] ? JSON.parse(r[6]) : null; } catch (e) {}
    const est = (snap && snap.estado) || {};
    return { ts: ts, nombre: (r[1] || "").toString().trim(), apellido: (r[2] || "").toString().trim(), tipo: (r[3] || "").toString().trim(), version: parseInt(r[4], 10) || 1, fecha: (r[5] || "").toString().trim(), editado: (snap && snap.editado) || "", snap: snap, modo: est.docMode || "formal", prod: est.prodMode || "uniforme" };
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
  const SNAP_CAMPOS = ["f_nombre", "f_apellido", "f_email", "f_largo", "f_ancho", "f_titulo", "f_color", "f_observaciones", "f_cantidad", "f_ojvalor", "f_dias", "f_descuento", "f_union", "f_altura", "f_version", "f_dir_cliente", "f_comuna_cliente", "f_emp_rut", "f_emp_razon", "f_emp_giro", "f_emp_dir", "f_emp_comuna", "f_emp_email"];
  const SNAP_STATE = ["orientacionSel", "orientUnif", "ojMode", "ojTotal", "ojSubstate", "ojAristasN", "ojAristas", "ojEdges", "ojParejo", "ojNumerar", "cotasOcultas", "rotDrag", "trasUnif", "docMode", "prodMode", "complementosUnif", "cortesUnif", "backCortesUnif", "backComplementosUnif", "aletasUnif", "backAletasUnif", "strapsUnif", "cintasUnif", "bordeModo", "bordeValor", "bordeRotUnif", "unionRot", "bordes", "piezas", "factorUnif", "granelLineas"];
  function snapshotCotizacion() {
    const campos = {}; SNAP_CAMPOS.forEach((id) => { const el = $(id); if (el) campos[id] = el.value; });
    const st = {}; SNAP_STATE.forEach((k) => { st[k] = state[k]; });
    // Telas adicionales marcadas (multi-tela uniforme) + categoría FAV activa, para reponer la selección completa.
    const telaOpc = []; { const cont = $("telaOpcList"); if (cont) cont.querySelectorAll('input[type="checkbox"]:checked').forEach((cb) => telaOpc.push(cb.value)); }
    const snap = { campos: campos, usaAlto: $("f_usaAlto") ? $("f_usaAlto").checked : false, empresaOn: $("f_empresaOn") ? $("f_empresaOn").checked : false, descMonto: $("f_descMonto") ? $("f_descMonto").checked : false, telaUnif: $("f_tela") ? $("f_tela").value : "", telaOpc: telaOpc, favCat: (typeof favCatActiva !== "undefined" ? favCatActiva : null), vendedor: $("f_vendedor") ? $("f_vendedor").value : "", estado: st };
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
    // Repone la selección multi-tela (telas adicionales marcadas) y la categoría FAV activa.
    { const cont = $("telaOpcList"); if (cont) { const sel = new Set(snap.telaOpc || []); cont.querySelectorAll('input[type="checkbox"]').forEach((cb) => { cb.checked = sel.has(cb.value); }); } }
    favCatActiva = snap.favCat || null; renderCategoriasFav();
    if ($("f_usaAlto")) { $("f_usaAlto").checked = !!snap.usaAlto; if ($("wAltura")) $("wAltura").classList.toggle("hidden", !snap.usaAlto); }
    if ($("f_empresaOn")) { $("f_empresaOn").checked = !!snap.empresaOn; toggleEmpresa(); }
    if ($("f_descMonto")) { $("f_descMonto").checked = !!snap.descMonto; actualizarDescSuffix(); }
    if ($("f_trasUnif")) $("f_trasUnif").checked = !!state.trasUnif;
    const setRadio = (name, val) => { const r = document.querySelector('input[name="' + name + '"][value="' + val + '"]'); if (r) r.checked = true; };
    setRadio("docmode", state.docMode); setRadio("prodmode", state.prodMode);
    setRadio("ojmode", state.ojMode); setRadio("bordemodo", state.bordeModo);
    bumpSeqs();
    renderPiezas(); renderBordes(); renderComplementosUnif(); renderCortesUnif(); renderAletasUnif(); renderStrapsUnif(); renderCintasUnif(); renderTraseraUnif();
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

  // ---------- Datos Empresa (e-RUT + escaneo QR) ----------
  function empresaActiva() { const c = $("f_empresaOn"); return !!(c && c.checked); }
  function empVal(id) { const e = $(id); return e ? e.value.trim() : ""; }
  // Empresa si la sección está activa y tiene al menos razón social; si no, null.
  function empresaDatos() {
    if (!empresaActiva()) return null;
    const razon = empVal("f_emp_razon"); if (!razon) return null;
    return { rut: empVal("f_emp_rut"), razon: razon, giro: empVal("f_emp_giro"), dir: empVal("f_emp_dir"), comuna: empVal("f_emp_comuna"), email: empVal("f_emp_email") };
  }
  // Abreviatura de la razón social para el nombre de archivo.
  function empresaAbrev(razon) {
    const ws = String(razon || "").replace(/[^A-Za-z0-9 ]/g, "").trim().split(/\s+/).filter(Boolean);
    const ab = ws.slice(0, 3).map((w) => w.charAt(0).toUpperCase() + w.slice(1, 4).toLowerCase()).join("");
    return ab.slice(0, 16) || "Empresa";
  }
  function toggleEmpresa() { const w = $("wEmpresa"); if (w) w.classList.toggle("hidden", !empresaActiva()); }
  // --- Escaneo QR del e-RUT (JSON: {rut, dv, razonSocial, direccion, ...}) ---
  let qrStream = null, qrRAF = null;
  // Carga una librería bajo demanda probando varios CDN espejo, por si el <script> del HTML no alcanzó a
  // cargar (red intermitente, caché del PWA en iPhone, etc.). Resuelve cuando window[globalName] existe.
  function ensureLib(globalName, urls) {
    if (typeof window[globalName] !== "undefined") return Promise.resolve();
    return new Promise((resolve, reject) => {
      let i = 0;
      const tryNext = () => {
        if (typeof window[globalName] !== "undefined") return resolve();
        if (i >= urls.length) return reject(new Error("No se pudo cargar " + globalName));
        const s = document.createElement("script");
        s.src = urls[i++]; s.async = true;
        s.onload = () => { (typeof window[globalName] !== "undefined") ? resolve() : tryNext(); };
        s.onerror = tryNext;
        document.head.appendChild(s);
      };
      tryNext();
    });
  }
  const JSQR_CDNS = [
    "https://cdnjs.cloudflare.com/ajax/libs/jsQR/1.4.0/jsQR.min.js",
    "https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.js",
    "https://unpkg.com/jsqr@1.4.0/dist/jsQR.js",
  ];
  async function abrirQR() {
    const modal = $("qrModal"), video = $("qrVideo"), status = $("qrStatus");
    if (!modal || !video) return;
    modal.classList.remove("hidden"); status.textContent = "Cargando lector…";
    // 1) Asegura jsQR (reintenta desde CDN espejo si el <script> del HTML no cargó).
    if (typeof jsQR === "undefined") {
      try { await ensureLib("jsQR", JSQR_CDNS); }
      catch (e) { cerrarQR(); return alert("No se pudo cargar el lector de QR. Verifica tu conexión a internet e inténtalo nuevamente."); }
    }
    // 2) Verifica que el dispositivo permita usar la cámara (requiere HTTPS / contexto seguro).
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      cerrarQR();
      return alert("Este dispositivo o navegador no permite usar la cámara aquí. En iPhone, ábrela en Safari (no como app instalada) y asegúrate de que el sitio use HTTPS.");
    }
    status.textContent = "Iniciando cámara…";
    try {
      // En teléfonos pide la cámara trasera ("environment"); en laptop/PC (solo cámara frontal)
      // ese intento puede no devolver dispositivo, así que caemos a cualquier cámara disponible.
      try {
        qrStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } } });
      } catch (e1) {
        if (e1 && (e1.name === "NotAllowedError" || e1.name === "SecurityError")) throw e1;
        qrStream = await navigator.mediaDevices.getUserMedia({ video: true });
      }
      video.srcObject = qrStream; await video.play();
      status.textContent = "Apunta al QR del e-RUT…"; escanearQR();
    } catch (e) {
      const msg = (e && (e.name === "NotAllowedError" || e.name === "SecurityError"))
        ? "Permiso de cámara denegado. Habilítalo en el navegador (en iPhone: Ajustes › Safari › Cámara; en PC: el ícono de cámara/candado de la barra de direcciones)."
        : (e && e.name === "NotFoundError")
        ? "No se encontró ninguna cámara en este dispositivo."
        : "No se pudo abrir la cámara: " + (e && (e.message || e.name) || e);
      status.textContent = msg;
    }
  }
  function escanearQR() {
    const video = $("qrVideo"), canvas = $("qrCanvas"), status = $("qrStatus");
    if (!video || !canvas) return;
    const loop = () => {
      if (!qrStream) return;
      if (video.readyState === video.HAVE_ENOUGH_DATA) {
        canvas.width = video.videoWidth; canvas.height = video.videoHeight;
        const ctx = canvas.getContext("2d"); ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const code = jsQR(img.data, img.width, img.height, { inversionAttempts: "attemptBoth" });
        if (code && code.data && poblarDesdeQR(code.data)) { if (status) status.textContent = "✓ Datos cargados."; cerrarQR(); return; }
      }
      qrRAF = requestAnimationFrame(loop);
    };
    qrRAF = requestAnimationFrame(loop);
  }
  function cerrarQR() {
    if (qrRAF) { cancelAnimationFrame(qrRAF); qrRAF = null; }
    if (qrStream) { qrStream.getTracks().forEach((t) => t.stop()); qrStream = null; }
    const m = $("qrModal"); if (m) m.classList.add("hidden");
  }
  // Separa la "direccion" del e-RUT en Calle+Número (Dirección) y Comuna.
  // Convención del e-RUT: "<CALLE> <NÚMERO> <COMUNA>" → todo hasta el número (inclusive) es Dirección;
  // lo que sigue es Comuna. Usa el ÚLTIMO grupo de dígitos como numeración (robusto p. ej. "5 NORTE 460 VIÑA").
  function partirDireccionERut(raw) {
    const s = String(raw || "").replace(/\s+/g, " ").trim();
    if (!s) return { dir: "", comuna: "" };
    const re = /\d+/g; let m, last = null;
    while ((m = re.exec(s)) !== null) last = m;
    if (!last) return { dir: s, comuna: "" }; // sin número: no se puede separar la comuna
    const end = last.index + last[0].length;
    return { dir: s.slice(0, end).trim(), comuna: s.slice(end).trim() };
  }
  // Parsea el e-RUT (JSON) y puebla RUT, Razón Social, Dirección y Comuna. Devuelve true si pobló algo.
  function poblarDesdeQR(raw) {
    let j = null; try { j = JSON.parse(raw); } catch (e) { j = null; }
    if (!j) { const m = String(raw).match(/(\d{7,8})-?([\dkK])/); if (m) { $("f_emp_rut").value = m[1] + "-" + m[2].toUpperCase(); } else { alert("El QR no tiene el formato del e-RUT (se esperaba JSON con rut/razonSocial)."); return false; } }
    else {
      if (j.rut) $("f_emp_rut").value = j.rut + (j.dv ? "-" + String(j.dv).toUpperCase() : "");
      if (j.razonSocial) $("f_emp_razon").value = j.razonSocial;
      if (j.direccion) { const d = partirDireccionERut(j.direccion); $("f_emp_dir").value = d.dir; if (d.comuna) $("f_emp_comuna").value = d.comuna; }
    }
    if (!empresaActiva()) { const c = $("f_empresaOn"); if (c) { c.checked = true; toggleEmpresa(); } }
    recompute();
    return true;
  }

  // Correlativo de la cotización (cliente + tipo + versión). Estable: si la cotización ya existe en el
  // historial, reutiliza su número; si no, asigna el siguiente (piso CFG.CORRELATIVO_INICIAL). Se guarda
  // dentro del snap del historial (se sincroniza al Sheet sin cambiar el esquema de columnas).
  function correlSnap(e) { const c = e && e.snap && parseInt(e.snap.correlativo, 10); return (c && c > 0) ? c : null; }
  function correlativoExistente(nombre, apellido, version) {
    const tipo = histTipo(), vNum = parseInt(version, 10) || 1, k = (s) => (s || "").trim().toLowerCase();
    const found = histLoad().find((e) => k(e.nombre) === k(nombre) && k(e.apellido) === k(apellido) && e.tipo === tipo && (parseInt(e.version, 10) || 1) === vNum);
    return found ? correlSnap(found) : null;
  }
  // Marca de máximo histórico ("high-water-mark"): el mayor correlativo jamás asignado. SOLO sube,
  // así que borrar el último registro NO la hace retroceder y el correlativo nunca se reutiliza.
  function correlMaxLocal() { const n = parseInt(localStorage.getItem(CORREL_KEY), 10); return (n && n > 0) ? n : 0; }
  function correlMaxBump(n, subirNube) {
    n = parseInt(n, 10); if (!n || n <= 0) return;
    if (n <= correlMaxLocal()) return;                // la marca solo crece
    try { localStorage.setItem(CORREL_KEY, String(n)); } catch (e) {}
    if (subirNube === false) return;                  // concilia desde la nube sin reescribirla
    const tok = (window.AuthCIBSA && window.AuthCIBSA.getToken) ? window.AuthCIBSA.getToken() : null;
    if (tok) window.SheetsCIBSA.guardarCorrelMax(tok, HIST_HOJA, n).catch(() => {});
  }
  // Salto aleatorio entre números (1..N). Despista a la competencia: el delta entre correlativos
  // ya no revela cuántas cotizaciones se emitieron. Mínimo 1, así nunca se repite ni retrocede.
  function correlSalto() { const n = parseInt(CFG.CORRELATIVO_SALTO_MAX, 10) || 1; return 1 + Math.floor(Math.random() * Math.max(1, n)); }
  function correlativoDe(nombre, apellido, version) {
    const existe = correlativoExistente(nombre, apellido, version);
    if (existe) return existe;
    let max = (CFG.CORRELATIVO_INICIAL || 1) - 1;
    histLoad().forEach((e) => { const c = correlSnap(e); if (c && c > max) max = c; });
    const wm = correlMaxLocal(); if (wm > max) max = wm; // la marca asegura que no se reutilicen números borrados
    return max + correlSalto();
  }
  // Decisión de historial para ESTA generación: _histSkip = no guardar; _histReplace = sobrescribir la versión
  // actual (en vez de crear un registro nuevo). Por defecto: guardar como registro nuevo (no sobrescribir).
  let _histSkip = false, _histReplace = false, _editHist = null, _forzarNueva = false;   // _editHist: registro que se está editando (por ts); _forzarNueva: "nueva versión desde un registro" (no volver a preguntar)
  function noGuardarHist() { const c = $("f_noHist"); return !!(c && c.checked); }
  function edFechaHora(d) { return ("0" + d.getDate()).slice(-2) + "/" + ("0" + (d.getMonth() + 1)).slice(-2) + "/" + d.getFullYear(); }
  function ocultarEdicionBanner() { const b = $("editHistBanner"); if (b) { b.classList.add("hidden"); b.innerHTML = ""; } }
  function mostrarEdicionBanner(ent) {
    const b = $("editHistBanner"); if (!b) return; b.innerHTML = "";
    const who = ((ent.nombre || "") + " " + (ent.apellido || "")).trim() || (ent.razonSocial || "esta cotización");
    const sp = document.createElement("span"); sp.innerHTML = "✏️ Editando <b>" + esc(who) + "</b> v" + ("0" + (parseInt(ent.version, 10) || 1)).slice(-2) + ". Al generar, se <b>actualiza ese registro</b> (quedará marcado como «editado»).";
    const btn = document.createElement("button"); btn.type = "button"; btn.className = "btn-outline edit-hist-cancel"; btn.textContent = "Cancelar edición";
    btn.addEventListener("click", () => { _editHist = null; ocultarEdicionBanner(); });
    b.appendChild(sp); b.appendChild(btn); b.classList.remove("hidden");
  }
  // Diálogo del lápiz: ¿nueva versión desde estos datos o sobrescribir la versión guardada?
  // Devuelve "nueva" | "sobrescribir" | null (cancelar).
  function preguntarEditar(ent, nextVer) {
    return new Promise((resolve) => {
      const pad = (n) => String(n).padStart(2, "0");
      const v = parseInt(ent && ent.version, 10) || 1;
      const ov = document.createElement("div"); ov.className = "hist-ask-ov";
      const box = document.createElement("div"); box.className = "hist-ask";
      const tit = document.createElement("div"); tit.className = "hist-ask-tit"; tit.textContent = "Editar cotización v" + pad(v);
      const p = document.createElement("p"); p.className = "muted small"; p.textContent = "¿Partir una versión NUEVA desde estos datos (con la fecha de hoy) o sobrescribir esta misma versión guardada (queda marcada como «editado»)?";
      const row = document.createElement("div"); row.className = "hist-ask-row";
      const done = (r) => { ov.remove(); resolve(r); };
      const bN = document.createElement("button"); bN.type = "button"; bN.className = "btn-outline hist-ask-new"; bN.textContent = "Nueva versión (v" + pad(nextVer) + ")";
      const bO = document.createElement("button"); bO.type = "button"; bO.className = "btn-outline"; bO.textContent = "Sobrescribir v" + pad(v);
      const bC = document.createElement("button"); bC.type = "button"; bC.className = "btn-outline"; bC.textContent = "Cancelar";
      bN.addEventListener("click", () => done("nueva")); bO.addEventListener("click", () => done("sobrescribir")); bC.addEventListener("click", () => done(null));
      ov.addEventListener("click", (e) => { if (e.target === ov) done(null); });
      row.appendChild(bN); row.appendChild(bO); row.appendChild(bC);
      box.appendChild(tit); box.appendChild(p); box.appendChild(row); ov.appendChild(box); document.body.appendChild(ov);
    });
  }
  // Máxima versión existente para el mismo cliente + tipo del registro dado.
  function histMaxVerDe(ent) {
    const k = (s) => (s || "").trim().toLowerCase();
    return histPrune(histLoad())
      .filter((e) => k(e.nombre) === k(ent.nombre) && k(e.apellido) === k(ent.apellido) && e.tipo === ent.tipo)
      .reduce((m, e) => Math.max(m, parseInt(e.version, 10) || 1), parseInt(ent.version, 10) || 1);
  }
  // Editar un registro EXISTENTE: el lápiz ofrece "nueva versión desde estos datos" o "sobrescribir esta versión".
  async function editarHistorial(ent) {
    const nextVer = histMaxVerDe(ent) + 1;
    const modo = await preguntarEditar(ent, nextVer);
    if (modo === null) return;   // cancelar
    // Carga el diseño guardado en ambos casos.
    _editHist = null; ocultarEdicionBanner(); _forzarNueva = false;
    if (ent && ent.snap) restaurarCotizacion(ent.snap);
    else { aplicarHistorial(ent); }   // registros antiguos sin snap: cae al flujo de duplicar
    if (modo === "nueva") {
      // Parte una versión NUEVA con los datos guardados → se guarda como registro nuevo con la fecha de hoy.
      _forzarNueva = true;
      $("f_version").value = String(nextVer).padStart(2, "0");
      ocultarEdicionBanner();
    } else {
      // Sobrescribir la versión guardada → modo edición (misma versión, misma fecha, marca «editado»).
      _editHist = { ts: ent.ts, fecha: ent.fecha, version: parseInt(ent.version, 10) || 1 };
      $("f_version").value = ("0" + _editHist.version).slice(-2);   // MISMA versión (no +1)
      mostrarEdicionBanner(ent);
    }
    recompute();
    try { $("f_nombre").focus(); } catch (e) {}
    try { $("editHistBanner").scrollIntoView({ behavior: "smooth", block: "center" }); } catch (e) {}
  }
  // Diálogo: ¿versión nueva (v+1) o sobrescribir la actual? Devuelve "nueva" | "sobrescribir" | null (cancelar).
  function preguntarVersion(maxVer) {
    return new Promise((resolve) => {
      const pad = (n) => String(n).padStart(2, "0");
      const ov = document.createElement("div"); ov.className = "hist-ask-ov";
      const box = document.createElement("div"); box.className = "hist-ask";
      const tit = document.createElement("div"); tit.className = "hist-ask-tit"; tit.textContent = "Ya existe una cotización de este cliente (v" + pad(maxVer) + ").";
      const p = document.createElement("p"); p.className = "muted small"; p.textContent = "¿Guardar esta como una versión NUEVA o sobrescribir la actual?";
      const row = document.createElement("div"); row.className = "hist-ask-row";
      const done = (v) => { ov.remove(); resolve(v); };
      const bN = document.createElement("button"); bN.type = "button"; bN.className = "btn-outline hist-ask-new"; bN.textContent = "Nueva versión (v" + pad(maxVer + 1) + ")";
      const bO = document.createElement("button"); bO.type = "button"; bO.className = "btn-outline"; bO.textContent = "Sobrescribir v" + pad(maxVer);
      const bC = document.createElement("button"); bC.type = "button"; bC.className = "btn-outline"; bC.textContent = "Cancelar";
      bN.addEventListener("click", () => done("nueva")); bO.addEventListener("click", () => done("sobrescribir")); bC.addEventListener("click", () => done(null));
      ov.addEventListener("click", (e) => { if (e.target === ov) done(null); });
      row.appendChild(bN); row.appendChild(bO); row.appendChild(bC);
      box.appendChild(tit); box.appendChild(p); box.appendChild(row); ov.appendChild(box); document.body.appendChild(ov);
    });
  }
  // Resuelve la decisión ANTES de construir el PDF (ajusta f_version si hace falta). Devuelve false si el usuario
  // canceló la generación. Debe llamarse al inicio de cada flujo de "Generar".
  async function prepararVersionHistorial(nombre, apellido) {
    _histSkip = false; _histReplace = false;
    if (_editHist) { _histReplace = true; return true; }   // editando un registro → actualiza ESE registro (sin diálogo)
    if (noGuardarHist()) { _histSkip = true; return true; }
    if (_forzarNueva) { _histReplace = false; return true; }   // "nueva versión desde un registro": f_version ya fijado, guarda como registro nuevo (sin diálogo)
    const nom = (nombre || "").trim(), ape = (apellido || "").trim();
    if (!nom || !ape) return true;   // sin cliente: guardarHistorial no guarda igual
    const tipo = histTipo(), k = (s) => (s || "").trim().toLowerCase();
    const mismos = histPrune(histLoad()).filter((e) => k(e.nombre) === k(nom) && k(e.apellido) === k(ape) && e.tipo === tipo);
    if (!mismos.length) return true;   // primera cotización de este cliente/tipo → se guarda tal cual
    const maxVer = mismos.reduce((m, e) => Math.max(m, parseInt(e.version, 10) || 1), 0);
    const ch = await preguntarVersion(maxVer);
    if (ch === null) return false;   // cancelar toda la generación
    if (ch === "nueva") { $("f_version").value = String(maxVer + 1).padStart(2, "0"); _histReplace = false; }
    else { $("f_version").value = String(maxVer).padStart(2, "0"); _histReplace = true; }
    return true;
  }
  function guardarHistorial(nombre, apellido, version) {
    _forzarNueva = false;   // consumido en prepararVersionHistorial; se limpia siempre
    const nom = (nombre || "").trim(), ape = (apellido || "").trim();
    if (!nom || !ape) return; // solo cotizaciones formales con cliente
    if (_histSkip) return null;   // borrador / reimpresión: NO guarda en el historial y NO genera número de cotización
    const tipo = histTipo(), vNum = parseInt(version, 10) || 1;
    const k = (s) => (s || "").trim().toLowerCase();
    const corr = correlativoDe(nom, ape, version);
    correlMaxBump(corr); // avanza la marca de máximo histórico (dispositivo + nube), salvo que reuse un número ya existente
    let arr = histPrune(histLoad());
    const i = arr.findIndex((e) => k(e.nombre) === k(nom) && k(e.apellido) === k(ape) && e.tipo === tipo && (parseInt(e.version, 10) || 1) === vNum);
    const emp = empresaDatos();
    const editando = !!_editHist;
    const ent = { ts: editando ? _editHist.ts : Date.now(), fecha: editando ? _editHist.fecha : histFechaCorta(new Date()), nombre: nom, apellido: ape, razonSocial: emp ? emp.razon : "", tipo: tipo, modo: state.docMode, prod: state.prodMode, version: vNum, snap: snapshotCotizacion() };
    if (ent.snap) ent.snap.correlativo = corr;
    if (editando) { ent.editado = edFechaHora(new Date()); if (ent.snap) ent.snap.editado = ent.editado; }   // marca "editado" (se persiste en el snap → al Sheet)
    if (i >= 0 && _histReplace) arr.splice(i, 1); // sobrescribir SOLO si se eligió (o se está editando); si no, se guarda como registro nuevo
    // Si edito pero la versión cambió y no calzó por versión, quita también por ts para no duplicar.
    if (editando) { const j = arr.findIndex((e) => e.ts === _editHist.ts); if (j >= 0) arr.splice(j, 1); }
    arr.unshift(ent);
    arr = arr.slice(0, HIST_MAX);
    histStore(arr);
    renderHistorial();
    if (editando) { _editHist = null; ocultarEdicionBanner(); }   // fin del modo edición
    // Sincroniza esta cotización a la hoja HISTORIAL del Sheet (mejor esfuerzo; no bloquea el PDF).
    const tok = (window.AuthCIBSA && window.AuthCIBSA.getToken) ? window.AuthCIBSA.getToken() : null;
    if (tok) {
      const p = _histReplace
        ? window.SheetsCIBSA.reemplazarHistorial(tok, HIST_HOJA, ent, entryToRow(ent), HIST_ENC)   // sobrescribe (borra misma clave + anexa)
        : window.SheetsCIBSA.escribirHistorial(tok, HIST_HOJA, [entryToRow(ent)], HIST_ENC);        // registro nuevo (solo anexa)
      p.catch((e) => console.warn("CIBSA: no se pudo sincronizar el historial al Sheet —", e && e.message ? e.message : e));
    }
    return corr;
  }
  function aplicarHistorial(ent) {
    _editHist = null; ocultarEdicionBanner();   // cargar un registro (no editar) cancela cualquier edición en curso
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
  const HIST_GAL_DIAS = 7;
  // Lista (prune + orden: más reciente primero) usada por galería y lista filtrada.
  function histArr() { return histPrune(histLoad()).slice().sort((a, b) => (b.ts || 0) - (a.ts || 0)); }
  // Versión máxima por cotización (cliente+tipo) para marcar la "última versión".
  function histMaxVer(arr) { const m = {}; arr.forEach((e) => { const k = histClave(e), v = parseInt(e.version, 10) || 1; if (!(k in m) || v > m[k]) m[k] = v; }); return m; }
  // Construye una tarjeta (chip) reutilizable para galería y lista.
  // ¿El registro incluyó productos a granel (líneas con cantidad y precio en su snapshot)?
  function entTieneGranel(ent) {
    const ls = ent && ent.snap && ent.snap.estado && ent.snap.estado.granelLineas;
    if (!Array.isArray(ls)) return false;
    return ls.some((l) => { const c = window.CalcCIBSA.evalExpr(l && l.cantidad); return c > 0 && l && l.precio != null; });
  }
  function histChip(ent, esUltima) {
    const contacto = ((ent.nombre || "") + " " + (ent.apellido || "")).trim();
    const razon = (ent.razonSocial || "").trim();
    // Con empresa: razón social arriba (truncada por CSS) + contacto debajo, en tamaño de la versión.
    const tituloHtml = razon
      ? '<span class="hist-nom hist-razon">' + esc(razon) + '</span><span class="hist-contacto">' + esc(contacto) + '</span>'
      : '<span class="hist-nom">' + esc(contacto) + '</span>';
    const vtxt = "v" + ("0" + (parseInt(ent.version, 10) || 1)).slice(-2);
    const granelPref = entTieneGranel(ent) ? '<span class="hist-granel">Granel/</span>' : "";
    const editado = (ent.editado || (ent.snap && ent.snap.editado) || "");
    const badge = editado ? ' · <span class="hist-badge editado">editado ' + esc(editado) + '</span>' : (esUltima ? ' · <span class="hist-badge">última versión</span>' : '');
    const card = document.createElement("div"); card.className = "hist-chip" + (esUltima ? " ultima" : "") + (editado ? " editado" : "");
    const main = document.createElement("button"); main.type = "button"; main.className = "hist-main"; main.title = "Duplicar para editar (como versión siguiente)";
    main.innerHTML = '<span class="hist-fecha">' + esc(ent.fecha || "") + badge + '</span>' +
      tituloHtml +
      '<span class="hist-tipo">' + granelPref + esc(ent.tipo || "") + ' · ' + vtxt + '</span>';
    main.addEventListener("click", () => aplicarHistorial(ent));
    const acts = document.createElement("div"); acts.className = "hist-acts";
    const bDl = document.createElement("button"); bDl.type = "button"; bDl.className = "hist-act"; bDl.title = "Descargar respaldo (.json)"; bDl.textContent = "⬇";
    bDl.addEventListener("click", (e) => { e.stopPropagation(); descargarRegistro(ent); });
    const bEd = document.createElement("button"); bEd.type = "button"; bEd.className = "hist-act edit"; bEd.title = "Editar este registro (se marcará como «editado»)"; bEd.textContent = "✏️";
    bEd.addEventListener("click", (e) => { e.stopPropagation(); editarHistorial(ent); });
    const bDel = document.createElement("button"); bDel.type = "button"; bDel.className = "hist-act del"; bDel.title = "Borrar definitivamente"; bDel.textContent = "🗑";
    bDel.addEventListener("click", (e) => { e.stopPropagation(); borrarRegistro(ent); });
    acts.appendChild(bDl); acts.appendChild(bEd); acts.appendChild(bDel);
    card.appendChild(main); card.appendChild(acts);
    return card;
  }
  function renderHistorial() {
    histStore(histPrune(histLoad())); // persiste el prune
    renderGaleria();
    renderListaFiltrada();
  }
  // Galería = carrusel: cotizaciones de los últimos 7 días en una fila desplazable (swipe en móvil,
  // flechas en escritorio); si no hay de la semana, cae a las más recientes del historial.
  function renderGaleria() {
    const track = $("histGalTrack"); if (!track) return;
    const empty = $("histGalEmpty"), prev = $("histGalPrev"), next = $("histGalNext");
    const arr = histArr(), maxVer = histMaxVer(arr);
    const lim = Date.now() - HIST_GAL_DIAS * 86400000;
    const semana = arr.filter((e) => e && e.ts >= lim);
    const fallback = semana.length === 0;
    const pool = fallback ? arr : semana;
    track.innerHTML = "";
    if (!pool.length) {
      if (empty) { empty.textContent = "Aún no hay cotizaciones guardadas."; empty.classList.remove("hidden"); }
      [prev, next].forEach((b) => { if (b) b.classList.add("hidden"); });
      return;
    }
    if (empty) {
      if (fallback) { empty.textContent = "Sin cotizaciones en los últimos 7 días — mostrando las más recientes."; empty.classList.remove("hidden"); }
      else empty.classList.add("hidden");
    }
    pool.forEach((ent) => track.appendChild(histChip(ent, (parseInt(ent.version, 10) || 1) === maxVer[histClave(ent)])));
    track.scrollLeft = 0;
    actualizarFlechasGal();
  }
  // Estado de las flechas del carrusel: visibles solo si hay desborde; deshabilitadas en los extremos.
  function actualizarFlechasGal() {
    const track = $("histGalTrack"), prev = $("histGalPrev"), next = $("histGalNext"); if (!track) return;
    const overflow = track.scrollWidth - track.clientWidth > 4;
    const atStart = track.scrollLeft <= 2, atEnd = track.scrollLeft >= (track.scrollWidth - track.clientWidth - 2);
    if (prev) { prev.classList.toggle("hidden", !overflow); prev.disabled = atStart; }
    if (next) { next.classList.toggle("hidden", !overflow); next.disabled = atEnd; }
  }
  // Filtros activos de la lista (nombre, rango de fechas, tipo).
  function histFiltros() {
    const g = (id) => { const el = $(id); return el ? el.value : ""; };
    const nom = (g("histFNombre") || "").trim().toLowerCase();
    const correl = (g("histFCorrel") || "").replace(/[^0-9]/g, ""); // solo dígitos del N° de cotización
    const tipo = g("histFTipo") || "";
    const dv = g("histFDesde"), hv = g("histFHasta");
    const desde = dv ? new Date(dv + "T00:00:00").getTime() : null;
    const hasta = hv ? new Date(hv + "T23:59:59").getTime() : null;
    return { nom, correl, tipo, desde, hasta, activo: !!(nom || correl || tipo || desde != null || hasta != null) };
  }
  // Lista filtrada: sin filtros NO muestra nada (ni los de la semana); con filtros muestra todo lo que coincida.
  function renderListaFiltrada() {
    const cont = $("histList"); if (!cont) return;
    cont.innerHTML = "";
    const f = histFiltros();
    if (!f.activo) { cont.innerHTML = '<p class="muted small">Aplica un filtro (nombre de cliente, N° de cotización, rango de fechas o tipo de producto) para ver el resto de los registros.</p>'; return; }
    const arr = histArr(), maxVer = histMaxVer(arr);
    const res = arr.filter((e) => {
      if (f.nom && !(((e.nombre || "") + " " + (e.apellido || "")).trim().toLowerCase().includes(f.nom))) return false;
      if (f.correl) { const c = correlSnap(e); if (!c || !String(c).includes(f.correl)) return false; }
      if (f.tipo && (e.tipo || "") !== f.tipo) return false;
      if (f.desde != null && (e.ts || 0) < f.desde) return false;
      if (f.hasta != null && (e.ts || 0) > f.hasta) return false;
      return true;
    });
    if (!res.length) { cont.innerHTML = '<p class="muted small">Ningún registro coincide con los filtros.</p>'; return; }
    res.forEach((ent) => cont.appendChild(histChip(ent, (parseInt(ent.version, 10) || 1) === maxVer[histClave(ent)])));
  }

  // ---------- Productos a granel: catálogo (drill-down) + comparador interno ----------
  const GRANEL_LEVELS = ["categoria", "variedad", "proveedor", "tipo"];
  let granelNav = {}, granelSel = null;
  function granelActivos() { return (state.granel || []).filter((p) => p && p.categoria); }
  function granelNombre(p) {
    if (p.nombreCliente && p.nombreCliente.trim()) return p.nombreCliente.trim();
    return [p.categoria, p.tipo, p.variedad, p.modelo].filter(Boolean).join(" ");
  }
  // Unidad de VENTA (en qué medida está el precio). Se deriva de la VARIEDAD (col D), NO de la columna
  // "Unidad" (esa es el peso equivalente del proveedor: K/m², K/m, K/cc…). "" = genérico (sin sufijo).
  function granelUnidadVenta(variedad) {
    const v = String(variedad || "").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim().toLowerCase();
    if (!v) return "";
    if (/lineal/.test(v)) return "m lineal";
    if (/m2|m²|mt2|metro2/.test(v)) return "m²";
    if (/rollo/.test(v)) return "rollo";
    if (/^u\.?$|^un\.?$|unidad/.test(v)) return "";   // unitario genérico: solo el número
    return String(variedad).trim();                   // otras variedades: se muestran tal cual
  }
  // $/m² de referencia (solo interno): si vende por metro lineal y trae ancho de rollo, o ya es m².
  // La medida del precio se determina por la VARIEDAD (no por la columna "Unidad", que es peso).
  function granelPrecioM2(p) {
    if (p.precio == null) return null;
    const v = String(p.variedad || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
    if (/m2|mt2|metro2|m²/.test(v)) return p.precio;
    if (/lineal/.test(v) && p.anchoRollo > 0) return p.precio / p.anchoRollo;
    return null;
  }
  // Variación de precio (%) desde el Precio Base. + = subió, − = bajó. null si no hay base.
  function granelVarPct(p) {
    if (p.precio == null || !(p.precioBase > 0)) return null;
    return Math.round((p.precio - p.precioBase) / p.precioBase * 100);
  }
  // "dd/mm/aaaa" → "dd/mm" (o "mm/aaaa" con conAnio). "" si no parsea.
  function granelFechaCorta(s, conAnio) {
    const m = String(s || "").trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
    if (!m) return "";
    return conAnio ? (m[2].padStart(2, "0") + "/" + m[3]) : (m[1].padStart(2, "0") + "/" + m[2].padStart(2, "0"));
  }
  // 2ª línea de meta (interna): "act. dd/mm · +8% desde mm/aaaa". "" si no hay datos.
  function granelMetaExtra(p) {
    const out = [];
    if (p.fechaActualizacion) { const fa = granelFechaCorta(p.fechaActualizacion); if (fa) out.push("act. " + esc(fa)); }
    const vp = granelVarPct(p);
    if (vp != null) {
      const cls = vp > 0 ? "granel-var-up" : (vp < 0 ? "granel-var-down" : "granel-var-eq");
      const base = p.fechaBase ? (granelFechaCorta(p.fechaBase, true)) : "";
      out.push('<span class="' + cls + '">' + (vp > 0 ? "+" : "") + vp + "%</span>" + (base ? (" desde " + esc(base)) : ""));
    }
    return out.length ? '<div class="granel-prod-meta2">' + out.join(" · ") + "</div>" : "";
  }
  function granelVarChip(p) {
    const vp = granelVarPct(p);
    if (vp == null) return "";
    const cls = vp > 0 ? "granel-var-up" : (vp < 0 ? "granel-var-down" : "granel-var-eq");
    return ' <span class="' + cls + '">' + (vp > 0 ? "+" : "") + vp + "%</span>";
  }
  function granelDistinct(arr) { const seen = new Set(), out = []; arr.forEach((v) => { const k = v || ""; if (!seen.has(k)) { seen.add(k); out.push(v); } }); return out; }
  function granelFiltrado() {
    let sel = granelActivos();
    GRANEL_LEVELS.forEach((k) => { if (granelNav[k]) sel = sel.filter((p) => p[k] === granelNav[k]); });
    return sel;
  }
  // Próximo nivel a elegir: salta los niveles que están vacíos para todos los productos del filtro.
  function granelNextLevel(sel) {
    for (const k of GRANEL_LEVELS) {
      if (granelNav[k] != null) continue;                 // ya elegido o saltado ("")
      const vals = granelDistinct(sel.map((p) => p[k]).filter(Boolean));
      if (vals.length) return { key: k, vals };
      granelNav[k] = "";                                  // nivel vacío → saltar
    }
    return null;                                          // no quedan niveles → listar productos
  }
  function renderGranel() {
    const crumbEl = $("granelNavCrumb"), levelEl = $("granelLevel"), cmpEl = $("granelCompare");
    if (!levelEl) return;
    renderGranelLineas();   // carrito siempre visible (independiente del drill-down)
    levelEl.innerHTML = ""; if (crumbEl) crumbEl.innerHTML = ""; if (cmpEl) cmpEl.innerHTML = "";
    const prods = granelActivos();
    if (!prods.length) { levelEl.innerHTML = '<p class="muted small">No hay productos a granel cargados. Crea la pestaña <b>GRANEL</b> en tu Sheet y agrégala en <b>RANGO</b> (ID «Granel»); luego reinicia sesión.</p>'; return; }
    // Migas de pan
    const LBL = { categoria: "Categoría", variedad: "Variedad", proveedor: "Proveedor", tipo: "Tipo" };
    const crumb = document.createElement("div"); crumb.className = "granel-crumb-row";
    const home = document.createElement("button"); home.type = "button"; home.className = "granel-bc"; home.textContent = "Categorías";
    home.addEventListener("click", () => { granelNav = {}; granelSel = null; renderGranel(); });
    crumb.appendChild(home);
    GRANEL_LEVELS.forEach((k) => {
      if (!granelNav[k]) return;
      const sep = document.createElement("span"); sep.className = "granel-bc-sep"; sep.textContent = "›"; crumb.appendChild(sep);
      const b = document.createElement("button"); b.type = "button"; b.className = "granel-bc"; b.textContent = granelNav[k];
      b.addEventListener("click", () => { let after = false; GRANEL_LEVELS.forEach((kk) => { if (after) delete granelNav[kk]; if (kk === k) after = true; }); granelSel = null; renderGranel(); });
      crumb.appendChild(b);
    });
    if (crumbEl) crumbEl.appendChild(crumb);
    const sel = granelFiltrado();
    const next = granelNextLevel(sel);
    if (next) {
      const cap = document.createElement("p"); cap.className = "muted small"; cap.textContent = "Elige " + (LBL[next.key] || next.key).toLowerCase() + ":";
      levelEl.appendChild(cap);
      const grid = document.createElement("div"); grid.className = "granel-grid";
      next.vals.sort((a, b) => String(a).localeCompare(String(b))).forEach((v) => {
        const n = sel.filter((p) => p[next.key] === v).length;
        const btn = document.createElement("button"); btn.type = "button"; btn.className = "granel-cat";
        btn.innerHTML = '<span class="granel-cat-nom">' + esc(v) + '</span><span class="granel-cat-n">' + n + '</span>';
        btn.addEventListener("click", () => { granelNav[next.key] = v; granelSel = null; renderGranel(); });
        grid.appendChild(btn);
      });
      levelEl.appendChild(grid);
      return;
    }
    // Listado de productos hoja AGRUPADO por identidad base (mismo modelo/formato/materialidad/largo). Los
    // colores —de filas separadas (distinto precio/SKU) o de una fila multicolor— se eligen en un desplegable
    // por tarjeta: una tarjeta por producto, sin repetir; al cambiar el color se actualiza precio y SKU.
    const gnorm = (s) => String(s == null ? "" : s).normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toLowerCase();
    const grupos = [], gmap = {};
    sel.slice().sort((a, b) => (a.modelo || "").localeCompare(b.modelo || "") || (a.formato || "").localeCompare(b.formato || "")).forEach((p) => {
      const k = [gnorm(p.modelo), gnorm(p.formato), gnorm(p.materialidad), gnorm(p.largo)].join("|");
      let g = gmap[k]; if (!g) { g = gmap[k] = { rep: p, colores: [] }; grupos.push(g); }
      // Separa varios colores por ","  ";"  o " / " (con espacios, como los une "adicionar"). NO parte un
      // color bicolor escrito sin espacios (p. ej. "AZUL/SILVER" queda como un solo color).
      const cs = (p.color || "").split(/\s*[,;]\s*|\s+\/\s+/).map((s) => s.trim()).filter(Boolean);
      if (!cs.length) cs.push("");   // producto sin color → una opción "—"
      cs.forEach((c) => { if (!g.colores.some((x) => gnorm(x.color) === gnorm(c))) g.colores.push({ color: c, prod: p }); });
    });
    const cap = document.createElement("p"); cap.className = "muted small"; cap.textContent = grupos.length + " producto(s):";
    levelEl.appendChild(cap);
    const ul = document.createElement("div"); ul.className = "granel-prods";
    grupos.forEach((g) => {
      let cur = g.colores[0].prod, colorSel = g.colores[0].color;
      const card = document.createElement("div"); card.className = "granel-prod" + (cur === granelSel ? " sel" : "");
      const info = document.createElement("button"); info.type = "button"; info.className = "granel-prod-info";
      const top = document.createElement("div"); top.className = "granel-prod-top";
      const nomS = document.createElement("span"); nomS.className = "granel-prod-nom"; nomS.textContent = granelNombre(g.rep);
      const preS = document.createElement("span"); preS.className = "granel-prod-precio";
      top.appendChild(nomS); top.appendChild(preS); info.appendChild(top);
      if (g.rep.specs) { const sp = document.createElement("div"); sp.className = "granel-prod-specs"; sp.textContent = g.rep.specs; info.appendChild(sp); }
      const attrs = [g.rep.materialidad].filter(Boolean); if (g.rep.largo) attrs.push("largo " + g.rep.largo + " m");
      if (attrs.length) { const at = document.createElement("div"); at.className = "granel-prod-attr"; at.textContent = attrs.join(" · "); info.appendChild(at); }
      const meta = document.createElement("div"); meta.className = "granel-prod-meta"; info.appendChild(meta);
      info.addEventListener("click", () => { granelSel = (granelSel === cur ? null : cur); renderGranel(); });
      card.appendChild(info);
      const skuD = document.createElement("div"); skuD.className = "granel-prod-sku"; card.appendChild(skuD);
      const addRow = document.createElement("div"); addRow.className = "granel-add";
      // Pinta precio/SKU/m²/meta y reconstruye la fila de "agregar" según el color seleccionado (cur).
      const pintar = () => {
        preS.textContent = (cur.precio != null ? money(cur.precio) + " / " + cur.unidad : "s/precio");
        skuD.textContent = cur.sku || "";
        const m2 = granelPrecioM2(cur);
        meta.innerHTML = (m2 != null ? "≈ " + money(Math.round(m2)) + "/m² · " : "") + '<span class="granel-prov">prov.: ' + esc(cur.proveedor || "—") + '</span> · <span class="granel-prod-hint">toca para comparar</span>' + granelMetaExtra(cur);
        addRow.innerHTML = "";
        if (cur.precio == null) { const w = document.createElement("span"); w.className = "muted small"; w.textContent = "Sin precio en el Sheet: no se puede cotizar."; addRow.appendChild(w); return; }
        const inp = document.createElement("input"); inp.type = "text"; inp.inputMode = cur.divisible ? "decimal" : "numeric"; inp.className = "granel-cant";
        const uv = granelUnidadVenta(cur.variedad); inp.placeholder = "cant." + (uv ? " (" + uv + ")" : ""); inp.title = cur.divisible ? "Mínimo 1; acepta decimales." : "Producto unitario: cantidad entera, mínimo 1.";
        agregarCalc(inp);
        const btn = document.createElement("button"); btn.type = "button"; btn.className = "btn-outline small"; btn.textContent = "+ Agregar a la cotización";
        const add = () => { let c = window.CalcCIBSA.evalExpr(inp.value); if (c == null || isNaN(c) || c <= 0) { inp.focus(); return; } c = granelClampCant(cur.divisible, c); granelAgregar(cur, c, colorSel); };
        btn.addEventListener("click", add);
        inp.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); add(); } });
        addRow.appendChild(inp); addRow.appendChild(btn);
      };
      // Desplegable de color (si hay color o varias filas de color).
      if (g.colores.some((x) => x.color) || g.colores.length > 1) {
        const cRow = document.createElement("div"); cRow.className = "granel-color-row";
        const lbl = document.createElement("span"); lbl.className = "granel-color-lbl"; lbl.textContent = "Color:";
        const selc = document.createElement("select"); selc.className = "granel-color-sel";
        g.colores.forEach((x, i) => { const o = document.createElement("option"); o.value = String(i); o.textContent = x.color || "—"; selc.appendChild(o); });
        selc.addEventListener("change", (e) => { const i = parseInt(e.target.value, 10) || 0; cur = g.colores[i].prod; colorSel = g.colores[i].color; pintar(); });
        cRow.appendChild(lbl); cRow.appendChild(selc); card.appendChild(cRow);
      }
      card.appendChild(addRow);
      pintar();
      ul.appendChild(card);
    });
    levelEl.appendChild(ul);
    renderGranelComparador();
  }
  let granelSeq = 0;
  function granelNombreL(l) { return (l.nombreCliente && l.nombreCliente.trim()) ? l.nombreCliente.trim() : [l.categoria, l.tipo, l.variedad, l.modelo].filter(Boolean).join(" "); }
  // Ajusta la cantidad al mínimo de venta: nunca < 1; si NO es divisible (unitario) la fuerza a entero.
  function granelClampCant(divisible, c) {
    if (c == null || isNaN(c)) return null;
    let v = divisible ? c : Math.round(c);
    if (v < 1) v = 1;
    return v;
  }
  // Descuento con que NACE una línea de granel. Tela vendida por metro (Categoría=TELA + Variedad=M.LINEAL)
  // = mismo material sin confección → descuento por defecto (config, 25%). Rollo, accesorios e insumos → 0.
  // Es solo el valor INICIAL; el vendedor lo edita en el carrito (p. ej. subirlo por volumen).
  function granelDescInicial(p) {
    const N = (window.FacturaCIBSA && window.FacturaCIBSA.norm) ? window.FacturaCIBSA.norm : (s) => String(s || "").trim().toLowerCase();
    const esTelaMetro = N(p.categoria) === "tela" && /lineal/.test(N(p.variedad));
    const pct = (CFG.GRANEL_DESCUENTO_TELA_PCT != null) ? CFG.GRANEL_DESCUENTO_TELA_PCT : 0;
    return esTelaMetro ? String(pct) : "0";
  }
  function granelAgregar(p, cant, colorElegido) {
    const color = (colorElegido != null && colorElegido !== "") ? colorElegido : (p.color || "");
    state.granelLineas.push({ id: "gl" + (++granelSeq), categoria: p.categoria, tipo: p.tipo, variedad: p.variedad, modelo: p.modelo, specs: p.specs, unidad: p.unidad, formato: p.formato, precio: p.precio, nombreCliente: p.nombreCliente, sku: p.sku, divisible: !!p.divisible, color: color, materialidad: p.materialidad, largo: p.largo, cantidad: String(cant), descPct: granelDescInicial(p), descMonto: false });
    granelSel = p; // el comparador interno sigue al último producto agregado
    renderGranelLineas(); renderGranel(); recompute();
  }
  // Números de una línea a granel: cantidad, descuento propio (% o monto $), bruto, descuento y neto.
  // descPct guarda el valor escrito; descMonto define si ese valor es un % o un monto fijo.
  function granelLineaCalc(l) {
    const ev = window.CalcCIBSA.evalExpr;
    const c = ev(l.cantidad), cant = (c != null && c > 0) ? c : 0;
    const bruto = Math.round((l.precio || 0) * cant);
    const esMonto = !!l.descMonto;
    let desc;
    if (esMonto) { let m = ev(l.descPct); m = (m != null && m > 0) ? Math.round(m) : 0; desc = Math.min(m, bruto); }
    else { let dp = ev(l.descPct); dp = (dp != null && dp > 0) ? dp : 0; if (dp > 100) dp = 100; desc = Math.round(bruto * dp / 100); }
    const dp = bruto > 0 ? (desc / bruto * 100) : 0;
    return { cant: cant, dp: dp, bruto: bruto, desc: desc, neto: bruto - desc, esMonto: esMonto };
  }
  function granelSubtotal() {
    return (state.granelLineas || []).reduce((s, l) => s + granelLineaCalc(l).neto, 0);
  }
  // Líneas a granel para el PDF (sin proveedor). El descuento es PROPIO de cada línea
  // (no recibe el descuento global de la cotización). total = neto ya con su descuento.
  // { cantidad, detalle, precioU, bruto, descPct, descuento, total }.
  function granelLineasPDF() {
    const ev = window.CalcCIBSA.evalExpr, f = window.CalcCIBSA.fmtNum;
    return (state.granelLineas || []).map((l) => {
      const k = granelLineaCalc(l);
      if (!(k.cant > 0) || l.precio == null) return null;
      const attrs = [l.color, l.materialidad].filter(Boolean);
      let detalle = granelNombreL(l) + (attrs.length ? " · " + attrs.join(" · ") : "") + (l.specs ? " · " + l.specs : "");
      // Formato del rollo: útil en productos vendidos por rollo o por metro lineal (ancho × largo del rollo).
      const fmt = (l.formato || "").trim(), vNorm = String(l.variedad || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
      if (fmt && /(lineal|rollo)/.test(vNorm)) detalle += " · Formato " + fmt;
      if (k.desc > 0) detalle += k.esMonto ? " · Desc. " + money(k.desc) : " · Desc. " + f(k.dp) + "%";
      // En el PDF, Cantidad y Valor unitario van SOLO con el número (sin unidad de medida); la unidad/
      // formato se entiende por el Detalle (y la Variedad). La unidad se sigue mostrando en pantalla.
      return { cantidad: f(k.cant), detalle: detalle, precioU: money(l.precio), bruto: k.bruto, descPct: k.dp, descuento: k.desc, total: k.neto };
    }).filter(Boolean);
  }
  function granelTotalPDF() { return granelLineasPDF().reduce((s, g) => s + g.total, 0); }
  // Revalidación de una línea del carrito contra el catálogo VIGENTE del Sheet (state.granel).
  // El precio de la línea se congela al agregarla; si en el Sheet ese SKU cambió, perdió el precio
  // o desapareció, hay que avisar en vez de arrastrar el valor viejo en silencio.
  function granelVigenteDeLinea(l) {
    if (!l || !l.sku) return { validable: false };                    // líneas antiguas sin SKU: no se pueden validar
    const skuN = String(l.sku).trim().toLowerCase();
    const cat = (state.granel || []).find((p) => p.sku && String(p.sku).trim().toLowerCase() === skuN);
    if (!cat) return { validable: true, hallado: false, precioVig: null };
    return { validable: true, hallado: true, precioVig: (cat.precio != null ? cat.precio : null) };
  }
  // Devuelve null si la línea está al día, o { motivo, precioVig? } si está desfasada.
  function granelLineaDesfasada(l) {
    const v = granelVigenteDeLinea(l);
    if (!v.validable) return null;
    if (!v.hallado) return { motivo: "no-esta" };                                  // el SKU ya no está en el catálogo
    if (v.precioVig == null) return { motivo: "sin-precio" };                       // el producto perdió el precio en el Sheet
    if (l.precio == null) return { motivo: "recuperable", precioVig: v.precioVig }; // la línea no traía precio, pero el Sheet ahora sí
    if (Math.round(v.precioVig) !== Math.round(l.precio)) return { motivo: "cambio", precioVig: v.precioVig };
    return null;
  }
  // Carrito de líneas a granel agregadas a la cotización (cantidad editable + subtotal neto).
  function renderGranelLineas() {
    const cont = $("granelLineas"); if (!cont) return;
    cont.innerHTML = "";
    const ls = state.granelLineas || [];
    if (!ls.length) return;
    const box = document.createElement("div"); box.className = "granel-cart";
    const cap = document.createElement("div"); cap.className = "granel-cart-cap"; cap.textContent = "Productos a granel en esta cotización:";
    box.appendChild(cap);
    // Subtotal del carrito + recalculadora en vivo (sin reconstruir, para no perder el foco al escribir).
    const subEl = document.createElement("div"); subEl.className = "granel-cart-sub";
    function recalcSub() {
      let s = 0, d = 0;
      (state.granelLineas || []).forEach((ln) => { const kk = granelLineaCalc(ln); s += kk.neto; d += kk.desc; });
      subEl.innerHTML = (d > 0 ? "Descuentos a granel: <b>-" + money(Math.round(d)) + "</b><br>" : "") +
        "Subtotal a granel (neto): <b>" + money(Math.round(s)) + "</b>";
    }
    ls.forEach((l, i) => {
      if (l.descPct == null) l.descPct = "0";
      const k = granelLineaCalc(l);
      const item = document.createElement("div"); item.className = "granel-cart-item";
      // Fila 1: nombre + total neto + quitar
      const r1 = document.createElement("div"); r1.className = "granel-cart-r1";
      const nom = document.createElement("span"); nom.className = "granel-cart-nom"; nom.textContent = granelNombreL(l) + (l.color ? " · " + l.color : "");
      const tt = document.createElement("span"); tt.className = "granel-cart-tot"; tt.textContent = money(k.neto);
      const del = document.createElement("button"); del.type = "button"; del.className = "granel-cart-del"; del.title = "Quitar"; del.textContent = "✕";
      del.addEventListener("click", () => { state.granelLineas.splice(i, 1); renderGranelLineas(); recompute(); });
      r1.appendChild(nom); r1.appendChild(tt); r1.appendChild(del);
      // Refresca en vivo el total de ESTA línea + el subtotal del carrito + totales generales.
      const refrescarLinea = () => { tt.textContent = money(granelLineaCalc(l).neto); recalcSub(); recompute(); };
      // Fila 2: [SKU/cantidad] × precio · descuento propio
      const r2 = document.createElement("div"); r2.className = "granel-cart-r2";
      const ci = document.createElement("input"); ci.type = "text"; ci.inputMode = l.divisible ? "decimal" : "numeric"; ci.className = "granel-cart-cant"; ci.value = l.cantidad;
      ci.title = l.divisible ? "Mínimo 1; acepta decimales." : "Producto unitario: cantidad entera, mínimo 1.";
      agregarCalc(ci);
      ci.addEventListener("input", (e) => { l.cantidad = e.target.value; refrescarLinea(); });
      // Al salir del campo: ajusta al mínimo de venta (≥1; entero si es unitario).
      ci.addEventListener("blur", (e) => { let c = window.CalcCIBSA.evalExpr(e.target.value); if (c == null || isNaN(c) || c <= 0) return; const v = granelClampCant(l.divisible, c); if (String(v) !== String(window.CalcCIBSA.evalExpr(l.cantidad))) { l.cantidad = window.CalcCIBSA.fmtNum(v); renderGranelLineas(); recompute(); } });
      const cw = document.createElement("div"); cw.className = "granel-cart-cantwrap";
      if (l.sku) { const sk = document.createElement("span"); sk.className = "granel-cart-sku"; sk.textContent = l.sku; cw.appendChild(sk); }
      cw.appendChild(ci);
      const u = document.createElement("span"); u.className = "granel-cart-u"; u.textContent = (granelUnidadVenta(l.variedad) || "u") + " × " + money(l.precio || 0);
      const dl = document.createElement("label"); dl.className = "granel-cart-dlbl"; dl.textContent = "dcto";
      const di = document.createElement("input"); di.type = "text"; di.inputMode = "decimal"; di.className = "granel-cart-desc"; di.value = l.descPct;
      di.title = l.descMonto ? "Descuento de este producto en monto $" : "Descuento de este producto (%)";
      agregarCalc(di);
      di.addEventListener("input", (e) => { l.descPct = e.target.value; refrescarLinea(); });
      // Botón %/$ : alterna el modo del descuento de ESTA línea (resetea el valor para evitar confundir % con monto).
      const pct = document.createElement("button"); pct.type = "button"; pct.className = "granel-cart-pct" + (l.descMonto ? " monto" : "");
      pct.textContent = l.descMonto ? "$" : "%"; pct.title = "Cambiar entre % y monto $";
      pct.addEventListener("click", () => {
        l.descMonto = !l.descMonto; l.descPct = "0"; di.value = "0";
        pct.textContent = l.descMonto ? "$" : "%"; pct.classList.toggle("monto", l.descMonto);
        di.title = l.descMonto ? "Descuento de este producto en monto $" : "Descuento de este producto (%)";
        refrescarLinea();
      });
      r2.appendChild(cw); r2.appendChild(u); r2.appendChild(dl); r2.appendChild(di); r2.appendChild(pct);
      item.appendChild(r1); item.appendChild(r2);
      // Revalidación contra el Sheet: si la línea quedó desfasada, avisar (rojo) en vez de arrastrar el precio viejo.
      const df = granelLineaDesfasada(l);
      if (df) {
        item.classList.add("desfasada");
        const w = document.createElement("div"); w.className = "granel-cart-warn";
        const msg = document.createElement("span");
        if (df.motivo === "no-esta") msg.textContent = "⚠ Este producto ya no está en el catálogo del Sheet — verificar.";
        else if (df.motivo === "sin-precio") msg.textContent = "⚠ El producto ya no tiene precio en el Sheet — verificar antes de cotizar.";
        else if (df.motivo === "cambio") msg.textContent = "⚠ Precio desactualizado: en el Sheet ahora es " + money(df.precioVig) + " (esta línea usa " + money(l.precio || 0) + ").";
        else if (df.motivo === "recuperable") msg.textContent = "⚠ Esta línea no tenía precio; en el Sheet ahora hay " + money(df.precioVig) + ".";
        w.appendChild(msg);
        if (df.precioVig != null) {
          const fix = document.createElement("button"); fix.type = "button"; fix.className = "granel-cart-fix";
          fix.textContent = "Actualizar a " + money(df.precioVig);
          fix.addEventListener("click", () => { l.precio = df.precioVig; renderGranelLineas(); recompute(); });
          w.appendChild(fix);
        }
        item.appendChild(w);
      }
      box.appendChild(item);
    });
    recalcSub();
    box.appendChild(subEl);
    cont.appendChild(box);
  }
  // Comparador (INTERNO, nunca al PDF): equivalentes por clave EQUIV, ordenados por precio.
  function renderGranelComparador() {
    const cmpEl = $("granelCompare"); if (!cmpEl) return;
    cmpEl.innerHTML = "";
    if (!granelSel) return;
    // Clave(s) de equivalencia normalizadas: ignora mayúsculas/minúsculas, espacios, acentos y el símbolo de
    // multiplicación (×, *). Una celda puede traer VARIAS claves separadas por "/" (comparar por más de un
    // criterio): agrupa si CUALQUIERA coincide. Cualquier texto sirve como clave.
    const eqKey = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[×✕*]/g, "x").replace(/\s+/g, "").toUpperCase();
    const eqKeys = (s) => String(s || "").split("/").map(eqKey).filter(Boolean);
    const selKeys = eqKeys(granelSel.equiv);
    const box = document.createElement("div"); box.className = "granel-cmp-box";
    const head = document.createElement("div"); head.className = "granel-cmp-head";
    head.innerHTML = 'Comparador — equivalentes de <b>' + esc(granelNombre(granelSel)) + '</b> <span class="granel-cmp-int">(uso interno · no va al PDF)</span>';
    box.appendChild(head);
    let equivs = selKeys.length ? granelActivos().filter((p) => eqKeys(p.equiv).some((k) => selKeys.indexOf(k) !== -1)) : [granelSel];
    if (!selKeys.length) { const n = document.createElement("p"); n.className = "muted small"; n.textContent = "Este producto no tiene clave de equivalencia (Equiv); no hay con qué compararlo."; box.appendChild(n); cmpEl.appendChild(box); return; }
    equivs = equivs.slice().sort((a, b) => (a.precio == null ? Infinity : a.precio) - (b.precio == null ? Infinity : b.precio));
    const minP = equivs.reduce((m, p) => (p.precio != null && p.precio < m ? p.precio : m), Infinity);
    const tbl = document.createElement("div"); tbl.className = "granel-cmp-list";
    equivs.forEach((p) => {
      const m2 = granelPrecioM2(p), barato = (p.precio != null && p.precio === minP);
      const row = document.createElement("div"); row.className = "granel-cmp-row" + (p === granelSel ? " sel" : "") + (barato ? " barato" : "");
      row.innerHTML = '<span class="granel-cmp-prov">' + esc(p.proveedor || "—") + (p.modelo ? ' · ' + esc(p.modelo) : '') + '</span>' +
        '<span class="granel-cmp-precio">' + (p.precio != null ? money(p.precio) + "/" + esc(p.unidad) : "s/precio") + (m2 != null ? ' <span class="granel-cmp-m2">(' + money(Math.round(m2)) + '/m²)</span>' : '') + granelVarChip(p) + (barato ? ' <span class="granel-cmp-tag">más barato</span>' : '') + '</span>';
      tbl.appendChild(row);
    });
    box.appendChild(tbl);
    cmpEl.appendChild(box);
  }
  // 2º menú lateral (otro color): ir directo a productos a granel.
  { const b = $("navTabGranel"); if (b) b.addEventListener("click", () => { const sec = $("wGranel"); if (!sec) return; if (sec.classList.contains("colap") && sec.classList.contains("collapsed") && typeof toggleColap === "function") toggleColap(sec); try { sec.scrollIntoView({ behavior: "smooth", block: "start" }); } catch (_) { sec.scrollIntoView(); } if (typeof flashTitulo === "function") flashTitulo(sec.querySelector("h2.section")); }); }
  // Botón "Facturas" del header: abre y desplaza al cargador de facturas (asegura modo formal donde vive).
  { const b = $("btnFacturas"); if (b) b.addEventListener("click", () => {
    const sec = $("wFactura"); if (!sec) return;
    if (sec.classList.contains("hidden")) { const r = document.querySelector('input[name="docmode"][value="formal"]'); if (r) r.checked = true; aplicarModo("formal"); }
    if (sec.classList.contains("colap") && sec.classList.contains("collapsed") && typeof toggleColap === "function") toggleColap(sec);
    try { sec.scrollIntoView({ behavior: "smooth", block: "start" }); } catch (_) { sec.scrollIntoView(); }
    if (typeof flashTitulo === "function") flashTitulo(sec.querySelector("h2.section"));
  }); }

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
      // Borra TODAS las filas de esta cotización en la nube (no solo el ts visible): cada generación apendía
      // una fila, y borrar solo una dejaba duplicados que reaparecían al sincronizar.
      try { await window.SheetsCIBSA.borrarFilasHistorialClave(tok, HIST_HOJA, ent); }
      catch (e) { return alert("No se pudo borrar de la nube (" + (e.message || e) + ").\nEl registro NO se borró; inténtalo con conexión."); }
    }
    const k = (s) => (s || "").trim().toLowerCase(), ver = (v) => parseInt(v, 10) || 1;
    histStore(histLoad().filter((x) => !(k(x.nombre) === k(ent.nombre) && k(x.apellido) === k(ent.apellido) && k(x.tipo) === k(ent.tipo) && ver(x.version) === ver(ent.version))));
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
  // Carrusel: las flechas desplazan la fila ~un ancho visible; el swipe táctil funciona nativo.
  function galScroll(dir) { const t = $("histGalTrack"); if (t) t.scrollBy({ left: dir * Math.max(160, t.clientWidth * 0.8), behavior: "smooth" }); }
  { const p = $("histGalPrev"); if (p) p.addEventListener("click", () => galScroll(-1)); }
  { const n = $("histGalNext"); if (n) n.addEventListener("click", () => galScroll(1)); }
  { const t = $("histGalTrack"); if (t) t.addEventListener("scroll", () => { if (t._galRaf) return; t._galRaf = requestAnimationFrame(() => { t._galRaf = 0; actualizarFlechasGal(); }); }); }
  // Filtros de la lista: re-renderizan al cambiar (la lista solo aparece con algún filtro activo).
  ["histFNombre", "histFCorrel", "histFDesde", "histFHasta", "histFTipo"].forEach((id) => { const el = $(id); if (el) ["input", "change"].forEach((ev) => el.addEventListener(ev, renderListaFiltrada)); });
  { const b = $("histFLimpiar"); if (b) b.addEventListener("click", () => { ["histFNombre", "histFCorrel", "histFDesde", "histFHasta"].forEach((id) => { const e = $(id); if (e) e.value = ""; }); const t = $("histFTipo"); if (t) t.value = ""; renderListaFiltrada(); }); }
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
  const COLAP_CERRADAS = ["wGranel", "wFactura", "wOjetillos", "wBordes", "wCortesUnif", "wComplementosUnif", "wAletasUnif", "wStrapsUnif", "wFactorUnif", "wCondiciones", "telaMultiWrap"];
  const COLAP_ABIERTAS = ["wCliente", "wPiezas", "wHistorial", "wSketchUnif", "wOrientFormal", "wPreviewCompuesto"];
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
    card._abrir = () => { obj._colap = false; apl(); }; // usado por la navegación entre fichas
    apl();
  }
  // Tira de enlaces a las fichas hermanas, al nivel del título y desplazada a la derecha.
  // infos: [{ titulo, nombre }] en el mismo orden que las tarjetas .ins-card de `rows`.
  function navFichas(rows, infos) {
    if (!rows) return;
    const cards = Array.from(rows.children).filter((c) => c.classList && c.classList.contains("ins-card"));
    cards.forEach((c) => { const o = c.querySelector(".ficha-nav"); if (o) o.remove(); });
    if (!cards.length) return;
    cards.forEach((card, i) => {
      const head = card.querySelector(".ins-head"); if (!head) return;
      const nav = document.createElement("div"); nav.className = "ficha-nav";
      infos.forEach((info, j) => {
        if (j === i) return; // solo enlaces a OTRAS fichas
        const a = document.createElement("a"); a.className = "ficha-nav-item" + (info.oculto ? " oculta" : ""); a.href = "#";
        a.appendChild(document.createTextNode(info.titulo || ("Nº" + (j + 1))));
        if (info.nombre && String(info.nombre).trim()) { const it = document.createElement("i"); it.className = "ficha-nav-sub"; it.textContent = " • " + String(info.nombre).trim(); a.appendChild(it); }
        a.addEventListener("click", (e) => {
          e.preventDefault();
          const t = cards[j]; if (!t) return;
          if (typeof t._abrir === "function") t._abrir();
          try { t.scrollIntoView({ behavior: "smooth", block: "center" }); } catch (_) { t.scrollIntoView(); }
        });
        nav.appendChild(a);
      });
      // Último ítem (siempre): enlace al plano que esta edición afecta, con estilo distinto.
      const pl = document.createElement("a"); pl.className = "ficha-nav-item ficha-nav-plano"; pl.href = "#";
      pl.textContent = "▣ Ver en el plano";
      pl.addEventListener("click", (e) => { e.preventDefault(); irAlPlano(); });
      nav.appendChild(pl);
      const del = head.querySelector(".pz-btn.del");
      if (del) head.insertBefore(nav, del); else head.appendChild(nav);
    });
  }
  // Tira de navegación INTERNA de una ficha: enlaces a sus sub-bloques (datos, dimensiones, materiales…).
  // items: [{ label, el }]. Se inserta bajo el encabezado de la ficha. No usa la clase ".ficha-nav"
  // (que navFichas elimina), sino ".ficha-subnav".
  function subnavFicha(card, head, items) {
    if (!card || !head) return;
    const old = card.querySelector(":scope > .ficha-subnav"); if (old) old.remove();
    const valid = (items || []).filter((it) => it && it.el);
    if (valid.length < 2) return;
    const nav = document.createElement("div"); nav.className = "ficha-subnav";
    valid.forEach((it) => {
      it.el.classList.add("ficha-bloque-anchor");
      const a = document.createElement("a"); a.className = "ficha-nav-item ficha-subnav-item"; a.href = "#"; a.textContent = it.label;
      a.addEventListener("click", (e) => { e.preventDefault(); const el = it.el; try { el.scrollIntoView({ behavior: "smooth", block: "start" }); } catch (_) { el.scrollIntoView(); } flashTitulo(el); });
      nav.appendChild(a);
    });
    head.insertAdjacentElement("afterend", nav);
  }
  // Desplaza a la sección del plano del producto (uniforme o compuesto), abriéndola si está colapsada.
  function irAlPlano() {
    const t = (state.prodMode === "compuesto") ? $("wPreviewCompuesto") : $("wSketchUnif");
    if (!t) return;
    if (t.classList.contains("colap") && t.classList.contains("collapsed") && typeof toggleColap === "function") toggleColap(t);
    try { t.scrollIntoView({ behavior: "smooth", block: "start" }); } catch (_) { t.scrollIntoView(); }
    flashTitulo(tituloDestacable(t));
  }
  // Identificador estable de ficha (para enlazar el menú del plano con la tarjeta de edición).
  let fidSeq = 0;
  function fidDe(o) { if (!o.id) o.id = "f" + (++fidSeq); return o.id; }
  // Al navegar desde un plano a una ficha: colapsa TODOS los sub-menús salvo el que contiene esa ficha,
  // para dejar la vista enfocada en el sub-menú y la ficha pinchados.
  function colapsarSubmenusExcepto(card) {
    if (!card) return;
    const anc = new Set(); let p = card; while (p && p !== document.body) { anc.add(p); p = p.parentElement; }
    // Sub-menús de Producto Uniforme (secciones .colap editoras).
    ["wOjetillos", "wBordes", "wCortesUnif", "wComplementosUnif", "wAletasUnif", "wStrapsUnif", "wFactorUnif"].forEach((id) => {
      const sec = $(id);
      if (!sec || !sec.classList.contains("colap") || anc.has(sec)) return;
      if (!sec.classList.contains("collapsed")) toggleColap(sec);
    });
    // Sub-menús dentro de piezas (compuesto): wrappers plegables con _subHead.
    document.querySelectorAll(".pz-oj-wrap, .pz-straps, .pz-borde, .pz-comp, .pz-ins, .pz-cortes, .pz-aletas").forEach((cont) => {
      if (!cont._subHead || anc.has(cont) || cont.style.display === "none") return;
      cont._subHead.click(); // colapsa este sub-menú (no es el de la ficha pinchada)
    });
  }
  // Lleva a la tarjeta de edición de una ficha: abre su sección/ficha y desplaza la vista.
  function irAFicha(fid) {
    const card = document.querySelector('[data-fid="' + fid + '"]'); if (!card) return;
    colapsarSubmenusExcepto(card); // enfoca: cierra los demás sub-menús
    let p = card.parentElement;
    while (p && p !== document.body) {
      if (p.classList) {
        if (p.classList.contains("colap") && p.classList.contains("collapsed") && typeof toggleColap === "function") toggleColap(p);
        if (p.classList.contains("colap-cerrada")) { const ind = p.querySelector(".pz-colap-btn"); if (ind) ind.click(); }
        if (p._subHead && p.style.display === "none") p._subHead.click();
      }
      p = p.parentElement;
    }
    if (typeof card._abrir === "function") card._abrir();
    // Deja la ficha cerca del borde superior (con margen via CSS scroll-margin-top), no centrada.
    setTimeout(() => { try { card.scrollIntoView({ behavior: "smooth", block: "start" }); } catch (_) { card.scrollIntoView(); } }, 30);
    flashTitulo(card.querySelector(".ins-head") || card);
    const f1 = card.querySelector(".field"); if (f1) flashTitulo(f1); // primer campo (ej. "Tipo" del anexo)
  }
  // Menú "de capas" bajo un plano: lista los elementos que lo afectan, con enlace a su ficha
  // y un checkbox "ocultar" para excluirlo sin volver al editor. grupos: [{label, items:[{obj,titulo}]}].
  // Contraparte en el plano para los rótulos de borde activos: aparece solo si hay alguno activo,
  // con un checkbox por arista para desmarcarlo (quitar el rótulo) desde el plano. host = state | pieza.
  function menuBordesRot(container, host, onToggle, navTarget, ojGoto) {
    if (!container || !host) return;
    const NOM = { sup: "Superior", inf: "Inferior", izq: "Izquierda", der: "Derecha" };
    // goto por defecto (borde/unión): va al editor de bordes (navTarget).
    const gotoBorde = () => { const t = (typeof navTarget === "function") ? navTarget() : null; if (t) irAElemento(t, t); };
    const rows = [];
    if (host.bordeModo !== "arista") {
      if (host.bordeRotUnif) rows.push({ label: "Borde (4 aristas)", off: () => { host.bordeRotUnif = false; } });
    } else {
      ["sup", "inf", "izq", "der"].forEach((k) => {
        const b = host.bordes && host.bordes[k];
        if (b && b.mostrarRot) rows.push({ label: NOM[k], off: () => { b.mostrarRot = false; } });
      });
    }
    if (host.unionRot) rows.push({ label: "Uniones entre paños", off: () => { host.unionRot = false; } });
    // Rótulos de SETS activos (ojetillos y straps) — contraparte para quitarlos desde el plano.
    // Cada SET enlaza a SU PROPIA ficha (no al editor de bordes): los ojetillos al editor de
    // ojetillos; los straps a la tarjeta del strap correspondiente.
    const ojE = (host.ojMode === "arista") ? host.ojEdges : null;
    if (ojE) ["sup", "inf", "izq", "der"].forEach((k) => {
      const e = ojE[k]; if (!e) return;
      (e.sets || []).forEach((st) => { if (st.rotulo) rows.push({ label: (st.nombre || "Set ojetillos") + " · " + NOM[k], off: () => { st.rotulo = false; }, goto: (typeof ojGoto === "function") ? ojGoto : gotoBorde }); });
    });
    (host.straps || host.strapsUnif || []).forEach((s) => {
      if (s.modo !== "arista") return;
      (s.sets || []).forEach((st) => { if (st.rotulo) rows.push({ label: (st.nombre || "Set straps") + " · " + NOM[s.arista || "sup"], off: () => { st.rotulo = false; }, goto: () => irAFicha(fidDe(s)) }); });
    });
    if (!rows.length) return;
    const box = document.createElement("div"); box.className = "plano-menu plano-bordes-rot";
    const cap = document.createElement("div"); cap.className = "plano-menu-cap"; cap.textContent = "Rótulos de borde / unión / sets en el plano (desmarcar para quitar):";
    box.appendChild(cap);
    rows.forEach((r) => {
      const row = document.createElement("div"); row.className = "plano-menu-row";
      const sp = document.createElement("a"); sp.className = "plano-menu-link"; sp.href = "#"; sp.textContent = r.label;
      sp.addEventListener("click", (e) => { e.preventDefault(); (typeof r.goto === "function" ? r.goto : gotoBorde)(); });
      const lab = document.createElement("label"); lab.className = "plano-menu-oc";
      const cb = document.createElement("input"); cb.type = "checkbox"; cb.checked = true;
      cb.addEventListener("change", () => { if (!cb.checked) { r.off(); if (onToggle) onToggle(); } });
      lab.appendChild(cb); lab.appendChild(document.createTextNode("rótulo"));
      row.appendChild(sp); row.appendChild(lab); box.appendChild(row);
    });
    container.appendChild(box);
  }
  // Etiqueta legible de una cota a partir de su clave estable + valor.
  function cotaLabel(c) {
    const v = window.CalcCIBSA.fmtNum(c.value) + " m", k = c.key || "";
    if (k === "base-anc") return "Ancho base (" + v + ")";
    if (k === "base-lar") return "Largo base (" + v + ")";
    if (k === "tot-h") return "Total exterior ancho (" + v + ")";
    if (k === "tot-v") return "Total exterior alto (" + v + ")";
    let m;
    if ((m = k.match(/^el(\d+)-(w|h|mx|my)$/))) {
      const nom = { w: "ancho", h: "alto", mx: "margen horiz.", my: "margen vert." }[m[2]];
      return "Elemento " + ((+m[1]) + 1) + " " + nom + " (" + v + ")";
    }
    if ((m = k.match(/^al(\d+)-(w|h)$/))) return "Anexo " + ((+m[1]) + 1) + " " + (m[2] === "w" ? "ancho" : "caída") + " (" + v + ")";
    if (/^cut-x/.test(k)) return "Corte · X (" + v + ")";
    if (/^cut-y/.test(k)) return "Corte · Y (" + v + ")";
    return "Cota (" + v + ")";
  }
  // Lista de cotas (clave única + etiqueta) de un spec de plano, para el submenú "Cotas".
  function cotasDeSpec(spec) {
    if (!window.SketchCIBSA) return [];
    const cs = window.SketchCIBSA.cotasDe(window.SketchCIBSA.construirSketch(spec)) || [];
    const out = [], vistos = new Set();
    cs.forEach((c) => { if (c.key && !vistos.has(c.key)) { vistos.add(c.key); out.push({ key: c.key, label: cotaLabel(c) }); } });
    return out;
  }
  let cotasPanelOpen = false; // estado (colapsado/expandido) del submenú "Cotas", compartido entre planos
  function menuPlano(container, grupos, onToggle, cotasCtl, numOjCtl) {
    if (!container) return;
    const filas = grupos.map((g) => ({ label: g.label, rotulo: !!g.rotulo, items: (g.items || []).filter((it) => it && it.obj) })).filter((g) => g.items.length);
    const tieneCotas = !!(cotasCtl && cotasCtl.cotas && cotasCtl.cotas.length);
    if (!filas.length && !tieneCotas && !numOjCtl) return;
    const box = document.createElement("div"); box.className = "plano-menu";
    const cap = document.createElement("div"); cap.className = "plano-menu-cap"; cap.textContent = "Elementos en este plano (ir a editar · ocultar · rótulo):";
    box.appendChild(cap);
    // Chip rápido "NumOj.": activa/desactiva la numeración de ojetillos (1er/último por arista) en el plano.
    if (numOjCtl) {
      const chip = document.createElement("button"); chip.type = "button";
      chip.className = "plano-menu-numoj" + (numOjCtl.on ? " on" : "");
      chip.textContent = (numOjCtl.on ? "✓ " : "") + "NumOj.";
      chip.title = "Mostrar numeración del 1er y último ojetillo por arista (con flecha)";
      chip.addEventListener("click", () => { if (numOjCtl.toggle) numOjCtl.toggle(); });
      box.appendChild(chip);
    }
    filas.forEach((g) => {
      g.items.forEach((it) => {
        const row = document.createElement("div"); row.className = "plano-menu-row" + (it.obj._oculto ? " oculta" : "");
        const a = document.createElement("a"); a.className = "plano-menu-link"; a.href = "#"; a.textContent = (g.tag ? g.tag + " " : "") + it.titulo;
        a.addEventListener("click", (e) => { e.preventDefault(); irAFicha(fidDe(it.obj)); });
        const ctrls = document.createElement("div"); ctrls.className = "plano-menu-ctrls";
        const lab = document.createElement("label"); lab.className = "plano-menu-oc"; lab.title = "Ocultar del plano y la cotización";
        const cb = document.createElement("input"); cb.type = "checkbox"; cb.checked = !!it.obj._oculto;
        cb.addEventListener("change", () => { it.obj._oculto = cb.checked; if (onToggle) onToggle(); });
        lab.appendChild(cb); lab.appendChild(document.createTextNode("ocultar"));
        ctrls.appendChild(lab);
        // Checkbox "rótulo" (solo aletas / paños inscritos): fuerza el rótulo-guía aunque el título quepa.
        // Inactivo y marcado cuando el auto ya lo está generando (el título no cabe).
        if (g.rotulo) {
          const labR = document.createElement("label"); labR.className = "plano-menu-rot"; labR.title = "Forzar rótulo (título afuera con flecha)";
          const cbR = document.createElement("input"); cbR.type = "checkbox"; cbR.className = "rotulo-chk";
          cbR.dataset.rid = rotId(it.obj); cbR._obj = it.obj; cbR.checked = !!it.obj.rotulo;
          cbR.addEventListener("change", () => { it.obj.rotulo = cbR.checked; if (onToggle) onToggle(); });
          labR.appendChild(cbR); labR.appendChild(document.createTextNode("rótulo"));
          const auto = window.SketchCIBSA && window.SketchCIBSA.autoRotulo;
          if (auto && auto[cbR.dataset.rid]) { cbR.disabled = true; cbR.checked = true; labR.classList.add("auto-on"); }
          ctrls.appendChild(labR);
        }
        row.appendChild(a); row.appendChild(ctrls); box.appendChild(row);
      });
    });
    // --- Submenú colapsable "Cotas": ocultar (✕ rojo) / activar (✓ verde) cada cota del plano ---
    if (tieneCotas) {
      const ocultas = cotasCtl.ocultas || {};
      const nOc = cotasCtl.cotas.filter((c) => ocultas[c.key]).length;
      const sec = document.createElement("div"); sec.className = "plano-menu-cotas";
      const hdr = document.createElement("button"); hdr.type = "button"; hdr.className = "plano-menu-cotas-hdr";
      hdr.textContent = (cotasPanelOpen ? "▾ " : "▸ ") + "Cotas (" + cotasCtl.cotas.length + (nOc ? " · " + nOc + " ocultas" : "") + ")";
      hdr.addEventListener("click", () => { cotasPanelOpen = !cotasPanelOpen; if (cotasCtl.onChange) cotasCtl.onChange(); });
      sec.appendChild(hdr);
      if (cotasPanelOpen) {
        const lst = document.createElement("div"); lst.className = "plano-menu-cotas-lst";
        // Fila "Todas": ocultar o activar TODAS las cotas de golpe.
        {
          const todasOcultas = cotasCtl.cotas.every((c) => ocultas[c.key]);
          const rowA = document.createElement("div"); rowA.className = "plano-menu-cota todas" + (todasOcultas ? " oculta" : "");
          const lbA = document.createElement("span"); lbA.className = "plano-menu-cota-lbl"; lbA.innerHTML = "<b>Todas</b>";
          const btnA = document.createElement("button"); btnA.type = "button";
          btnA.className = "plano-menu-cota-btn " + (todasOcultas ? "show" : "hide");
          btnA.textContent = todasOcultas ? "✓" : "✕";
          btnA.title = todasOcultas ? "Mostrar todas las cotas" : "Ocultar todas las cotas";
          btnA.addEventListener("click", () => {
            if (todasOcultas) cotasCtl.cotas.forEach((c) => { delete ocultas[c.key]; });
            else cotasCtl.cotas.forEach((c) => { ocultas[c.key] = true; });
            if (cotasCtl.onChange) cotasCtl.onChange();
          });
          rowA.appendChild(lbA); rowA.appendChild(btnA); lst.appendChild(rowA);
        }
        cotasCtl.cotas.forEach((c) => {
          const oculta = !!ocultas[c.key];
          const row = document.createElement("div"); row.className = "plano-menu-cota" + (oculta ? " oculta" : "");
          const lb = document.createElement("span"); lb.className = "plano-menu-cota-lbl"; lb.textContent = c.label;
          const btn = document.createElement("button"); btn.type = "button";
          btn.className = "plano-menu-cota-btn " + (oculta ? "show" : "hide");
          btn.textContent = oculta ? "✓" : "✕"; btn.title = oculta ? "Mostrar esta cota" : "Ocultar esta cota";
          btn.addEventListener("click", () => { if (oculta) delete ocultas[c.key]; else ocultas[c.key] = true; if (cotasCtl.onChange) cotasCtl.onChange(); });
          // Hover: resalta en el plano la cota que corresponde a este vínculo (y viceversa el color del vínculo).
          const resaltar = (on) => { const svg = container.querySelector(".sketch-svg"); if (!svg) return; svg.querySelectorAll(".cota-g").forEach((g) => { if (g.dataset.ck === c.key) g.classList.toggle("cota-hl", on); }); row.classList.toggle("hl", on); };
          row.addEventListener("mouseenter", () => resaltar(true));
          row.addEventListener("mouseleave", () => resaltar(false));
          row.appendChild(lb); row.appendChild(btn); lst.appendChild(row);
        });
        sec.appendChild(lst);
      }
      box.appendChild(sec);
    }
    container.appendChild(box);
  }
  // Control "Ocultar": excluye la ficha del plano y la cotización; marca la tarjeta en violeta.
  function ocultarFichaCtl(card, obj, rerender, onChange) {
    if (obj) card.dataset.fid = fidDe(obj);
    card.classList.toggle("ficha-oculta", !!obj._oculto);
    const lab = document.createElement("label"); lab.className = "chk ficha-ocultar-chk";
    const cb = document.createElement("input"); cb.type = "checkbox"; cb.checked = !!obj._oculto;
    const sp = document.createElement("span"); sp.textContent = "Ocultar del plano y la cotización";
    cb.addEventListener("change", () => { obj._oculto = cb.checked; if (rerender) rerender(); if (onChange) onChange(); });
    lab.appendChild(cb); lab.appendChild(sp); card.appendChild(lab);
  }
  // Checkbox "Rótulo": fuerza el rótulo-guía (título afuera con flecha) aunque el auto haya
  // determinado que el título cabía dentro. Queda deshabilitado (y marcado) cuando el auto ya
  // está generando el rótulo porque el título no cabe. Por defecto desmarcado = automático.
  function rotuloFichaCtl(card, obj, onChange) {
    const lab = document.createElement("label"); lab.className = "chk ficha-rotulo-chk";
    const cb = document.createElement("input"); cb.type = "checkbox"; cb.className = "rotulo-chk";
    cb.dataset.rid = rotId(obj); cb._obj = obj; cb.checked = !!obj.rotulo;
    const sp = document.createElement("span"); sp.textContent = "Rótulo (mostrar título afuera)";
    cb.addEventListener("change", () => { obj.rotulo = cb.checked; if (onChange) onChange(); });
    lab.appendChild(cb); lab.appendChild(sp); card.appendChild(lab);
    // Estado inicial según la última decisión del auto.
    const auto = window.SketchCIBSA && window.SketchCIBSA.autoRotulo;
    if (auto && auto[cb.dataset.rid]) { cb.disabled = true; cb.checked = true; lab.classList.add("auto-on"); }
  }
  // Sincroniza el estado deshabilitado/marcado de los checkboxes "Rótulo" tras cada render del plano.
  function refreshRotuloChks() {
    const auto = (window.SketchCIBSA && window.SketchCIBSA.autoRotulo) || {};
    document.querySelectorAll("input.rotulo-chk[data-rid]").forEach((cb) => {
      const on = !!auto[cb.dataset.rid];
      cb.disabled = on;
      cb.checked = on || !!(cb._obj && cb._obj.rotulo);
      const lab = cb.closest("label"); if (lab) lab.classList.toggle("auto-on", on);
    });
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
  function irANodo(target, tituloEl) {
    expandirSiCerrada(target);
    // si está dentro de una pieza plegada, ábrela también
    const pzCard = target.closest && target.closest(".colap-pz"); if (pzCard) expandirSiCerrada(pzCard);
    // Desplaza al TÍTULO de la sección (no al contenedor): secciones con <h2> "pelado" (ej. "Producto")
    // antes hacían scroll al tope del formulario (= Vendedor) porque su contenedor era #formView.
    const scEl = (tituloEl && tituloEl.scrollIntoView) ? tituloEl : target;
    setTimeout(() => { (scEl.scrollIntoView ? scEl : scEl.parentElement).scrollIntoView({ behavior: "smooth", block: "start" }); }, 30);
    flashTitulo(tituloEl || tituloDestacable(target));
    navCerrar();
  }
  // Devuelve el elemento "título" de una sección/pieza (para resaltarlo al navegar).
  function tituloDestacable(target) {
    if (!target) return null;
    if (target.matches && target.matches("h2.section, .pieza-head")) return target;
    return target.querySelector(":scope > h2.section") || target.querySelector(":scope > .pieza-head") ||
      target.querySelector("h2.section, .pieza-head") || target;
  }
  // Hace "brillar y apagarse" el título de destino durante ~4 s (reinicia si ya estaba activo).
  function flashTitulo(el) {
    if (!el || !el.classList) return;
    el.classList.remove("nav-flash"); void el.offsetWidth; // fuerza reinicio de la animación
    el.classList.add("nav-flash");
    if (el._flashT) clearTimeout(el._flashT);
    el._flashT = setTimeout(() => { el.classList.remove("nav-flash"); el._flashT = null; }, 4300);
  }
  // Navega a un elemento puntual (no sección): abre sus ancestros plegados, desplaza y lo resalta.
  function irAElemento(el, flashEl) {
    if (!el) return;
    let p = el.parentElement;
    while (p && p !== document.body) {
      if (p.classList) {
        if (p.classList.contains("colap") && p.classList.contains("collapsed") && typeof toggleColap === "function") toggleColap(p);
        if (p.classList.contains("colap-cerrada")) { const ind = p.querySelector(".pz-colap-btn"); if (ind) ind.click(); }
        if (p._subHead && p.style.display === "none") p._subHead.click();
      }
      p = p.parentElement;
    }
    setTimeout(() => { try { el.scrollIntoView({ behavior: "smooth", block: "start" }); } catch (_) { el.scrollIntoView(); } }, 30);
    flashTitulo(flashEl || el);
    navCerrar();
  }
  function limpiarTitulo(t) { return (t || "").replace(/[▸▾✂☰✕?]/g, "").replace(/●\s*con datos/gi, "").replace(/\s+/g, " ").trim(); }
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
    let telaLinkDone = false;
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
        const ov = nodo.getAttribute("data-nav"); // etiqueta de navegación unificada (independiente del título en pantalla)
        titulo = ov ? ov : limpiarTitulo(nodo.textContent);
      }
      if (!titulo) return;
      const b = document.createElement("button"); b.type = "button"; b.className = "nav-link" + (esPieza ? " nav-pieza" : "");
      if (sec && (sec.id === "wSketchUnif" || sec.id === "wPreviewCompuesto")) b.classList.add("nav-plano"); // vínculo a la vista previa: verde
      if (navTieneDatos(sec)) b.classList.add("con-datos");
      b.textContent = (esPieza ? "• " : "") + titulo;
      b.addEventListener("click", () => {
        // En compuesto, "Producto" lleva al inicio de la 1ª pieza (no al encabezado del modo).
        if (!esPieza && titulo === "Producto" && state.prodMode === "compuesto") {
          const ph = document.querySelector("#wPiezas .pieza-head");
          if (ph) { irANodo(ph.closest(".pieza-card") || ph.parentElement, ph); return; }
          const wp = $("wPiezas"); if (wp) { irANodo(wp, wp.querySelector("h2.section")); return; }
        }
        irANodo(sec, nodo);
      });
      cont.appendChild(b);
      if (esPieza && sec) {
        // Sub-botón al selector de tela de la pieza.
        const pzTela = sec.querySelector(".pz-tela");
        if (pzTela) {
          const bt = document.createElement("button"); bt.type = "button"; bt.className = "nav-link nav-pieza nav-tela-sub";
          bt.textContent = "• 🧵 Tela";
          bt.addEventListener("click", () => irAElemento(pzTela, pzTela.closest(".field") || pzTela));
          cont.appendChild(bt);
        }
        // Sub-botón a "Generar plano" de la pieza (debajo del de tela).
        const pzPlano = sec.querySelector(".pz-descargar");
        if (pzPlano) {
          const bp = document.createElement("button"); bp.type = "button"; bp.className = "nav-link nav-pieza nav-genplano-sub";
          bp.textContent = "• 📄 Generar plano";
          bp.addEventListener("click", () => irAElemento(pzPlano, pzPlano));
          cont.appendChild(bp);
        }
      } else if (!esPieza && sec && !telaLinkDone) {
        // Vínculo destacado (azul) al selector de telas del producto uniforme (una sola vez).
        const telaUnif = $("wTelaUnica");
        if (telaUnif && sec.contains(telaUnif) && telaUnif.offsetParent !== null) {
          const bt = document.createElement("button"); bt.type = "button"; bt.className = "nav-link nav-tela";
          bt.textContent = "🧵 Selector de telas";
          bt.addEventListener("click", () => irAElemento(telaUnif));
          cont.appendChild(bt);
          telaLinkDone = true;
        }
      }
    });
    // Penúltimo (uniforme): vínculo a "Generar plano" del producto, destacado en blanco.
    { const bSketch = $("btnDescargarSketch");
      if (bSketch && bSketch.offsetParent !== null) {
        const bp = document.createElement("button"); bp.type = "button"; bp.className = "nav-link nav-genplano";
        bp.textContent = "📄 Generar plano";
        bp.addEventListener("click", () => irAElemento(bSketch, bSketch));
        cont.appendChild(bp);
      } }
    // Último (siempre): vínculo a "Generar cotización", destacado en silver.
    { const bGen = $("btnGenerar");
      if (bGen && bGen.offsetParent !== null) {
        const bc = document.createElement("button"); bc.type = "button"; bc.className = "nav-link nav-cotizar";
        bc.textContent = "🧾 Generar cotización";
        bc.addEventListener("click", () => irAElemento(bGen, bGen));
        cont.appendChild(bc);
      } }
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
      o.value = t.nombre; o.textContent = t.nombre; // el nombre ya incluye Proveedor · Modelo · Formato
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
    renderTelaOpc(); renderCategoriasFav(); renderTelaGlobal();
    // Productos a granel (desde RANGO → tabla "Granel"/VIGENTES; si no existe, queda vacío). Se carga PRIMERO
    // porque los materiales (Insumo/Accesorio/Estructural) ahora se derivan de aquí por su Rol.
    try { state.granel = await window.SheetsCIBSA.cargarGranel(token); }
    catch (e) { console.warn("CIBSA: no se pudieron cargar los productos a granel —", e && e.message ? e.message : e); state.granel = []; }
    // Materiales UNIFICADOS: se derivan de GRANEL por su Rol (Insumo/Accesorio/Estructural). El Panel alimenta todo.
    // Durante la transición, si aún no hay filas con Rol en GRANEL, cae a la tabla "Materiales".
    state.materiales = window.SheetsCIBSA.materialesDesdeGranel(state.granel);
    if (!state.materiales.length) {
      try { state.materiales = await window.SheetsCIBSA.cargarMateriales(token); }
      catch (e) { console.warn("CIBSA: no se pudieron cargar los materiales —", e && e.message ? e.message : e); state.materiales = []; }
    }
    renderGranel();
    cargarUF(); // UF del día para el mínimo de producción (no bloquea la carga)
    // Re-dibuja los sub-editores que dependen de las telas/materiales recién cargadas
    // (de lo contrario sus botones "+ …" quedan deshabilitados desde el arranque sin telas).
    renderComplementosUnif(); renderAletasUnif(); renderStrapsUnif(); renderCintasUnif(); renderTraseraUnif(); renderPiezas();
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
    // Correlativo: concilia la marca de máximo histórico. Baja la celda durable del Sheet al dispositivo,
    // la siembra desde cualquier correlativo del historial (primera vez tras la actualización) y, si lo
    // local quedó más alto, repara la celda. Así borrar el último registro nunca reutiliza un número.
    try {
      const wmNube = await window.SheetsCIBSA.leerCorrelMax(token, HIST_HOJA);
      if (wmNube) correlMaxBump(wmNube, false);
      histLoad().forEach((e) => { const c = correlSnap(e); if (c) correlMaxBump(c, false); });
      if (correlMaxLocal() > (wmNube || 0)) window.SheetsCIBSA.guardarCorrelMax(token, HIST_HOJA, correlMaxLocal()).catch(() => {});
    } catch (e) { console.warn("CIBSA: no se pudo conciliar el correlativo máximo —", e && e.message ? e.message : e); }
    renderHistorial();
    if (typeof renderFacturaMerge === "function") renderFacturaMerge(); // herramienta de fusión (solo maestro)
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
  // Nombre de la tela PARA EL CLIENTE (sin proveedor). El proveedor es interno y NUNCA va al PDF/plano.
  function telaCli(t) {
    if (!t) return "";
    if (typeof t === "string") return t;   // ya es texto cliente (modo preliminar / plano)
    if (t.nombreCliente && String(t.nombreCliente).trim()) return String(t.nombreCliente).trim();
    let n = String(t.nombre || "");
    const prov = String(t.proveedor || "").trim();
    if (prov && n.toUpperCase().indexOf(prov.toUpperCase()) === 0) n = n.slice(prov.length).replace(/^\s*·\s*/, "");
    return n;
  }
  // Checkboxes de telas adicionales para cotizar (uniforme). La tela del selector es la principal.
  function renderTelaOpc() {
    const cont = $("telaOpcList"); if (!cont) return;
    cont.innerHTML = "";
    state.telas.forEach((t) => {
      const lab = document.createElement("label"); lab.className = "tela-chk";
      const cb = document.createElement("input"); cb.type = "checkbox"; cb.value = t.nombre; cb.dataset.telaopc = "1";
      cb.addEventListener("change", recompute);
      const span = document.createElement("span");
      const nm = document.createElement("span"); nm.className = "nm"; nm.textContent = t.nombre;
      const mt = document.createElement("span"); mt.className = "mt"; mt.textContent = `Valor m²: ${money(t.valorM2)} · Rollo: ${t.anchoRollo} m`;
      span.appendChild(nm); span.appendChild(document.createElement("br")); span.appendChild(mt);
      lab.appendChild(cb); lab.appendChild(span); cont.appendChild(lab);
    });
  }
  // Selector GLOBAL de tela (compuesto): override que reemplaza la tela del paño base y de los anexos
  // de TODAS las piezas para comparar el total en varias telas. Los paños inscritos conservan su tela.
  function renderTelaGlobal() {
    const cont = $("telaGlobalList"); if (!cont) return;
    const sel = new Set(); cont.querySelectorAll('input[type="checkbox"]:checked').forEach((cb) => sel.add(cb.value));
    cont.innerHTML = "";
    state.telas.forEach((t) => {
      const lab = document.createElement("label"); lab.className = "tela-chk";
      const cb = document.createElement("input"); cb.type = "checkbox"; cb.value = t.nombre; cb.dataset.telaglobal = "1";
      if (sel.has(t.nombre)) cb.checked = true;
      const span = document.createElement("span");
      const nm = document.createElement("span"); nm.className = "nm"; nm.textContent = t.nombre;
      const mt = document.createElement("span"); mt.className = "mt";
      mt.textContent = `Valor m²: ${money(t.valorM2)} · Rollo: ${t.anchoRollo} m` + (t.proveedor ? ` · Proveedor: ${t.proveedor}` : "");
      span.appendChild(nm); span.appendChild(document.createElement("br")); span.appendChild(mt);
      lab.appendChild(cb); lab.appendChild(span); cont.appendChild(lab);
    });
  }
  function toggleTelaGlobal() {
    const on = $("f_telaGlobalOn") && $("f_telaGlobalOn").checked;
    const body = $("telaGlobalBody"); if (body) body.classList.toggle("hidden", !on);
    if (on) renderTelaGlobal();
  }
  // Telas globales marcadas (solo si el selector está activo). [] => flujo normal por pieza.
  function telasGlobalCompuesto() {
    if (!$("f_telaGlobalOn") || !$("f_telaGlobalOn").checked) return [];
    const cont = $("telaGlobalList"); if (!cont) return [];
    const out = [];
    cont.querySelectorAll('input[type="checkbox"]:checked').forEach((cb) => {
      if (out.some((t) => t.nombre === cb.value)) return;
      const t = state.telas.find((x) => x.nombre === cb.value); if (t) out.push(t);
    });
    return out;
  }
  // Categorías FAV (selección rápida). Botones excluyentes bajo el selector de Tela.
  let favCatActiva = null;
  function categoriasFav() {
    const seen = [], out = [];
    state.telas.forEach((t) => (t.fav || []).forEach((c) => { const k = c.toLowerCase(); if (!seen.includes(k)) { seen.push(k); out.push(c); } }));
    return out;
  }
  function setChecksTelaOpc(filtro) {
    const cont = $("telaOpcList"); if (!cont) return;
    cont.querySelectorAll('input[type="checkbox"]').forEach((cb) => {
      const t = state.telas.find((x) => x.nombre === cb.value);
      cb.checked = !!(t && filtro(t));
    });
  }
  function aplicarCategoriaFav(cat) {
    if (favCatActiva && favCatActiva.toLowerCase() === cat.toLowerCase()) { // toggle off
      favCatActiva = null; setChecksTelaOpc(() => false);
    } else {
      favCatActiva = cat;
      const enCat = (t) => (t.fav || []).some((c) => c.toLowerCase() === cat.toLowerCase());
      const primera = state.telas.find(enCat);
      if (primera) setSelectIfOption("f_tela", primera.nombre);
      setChecksTelaOpc(enCat);
    }
    renderCategoriasFav(); recompute();
  }
  function renderCategoriasFav() {
    const wrap = $("favWrap"), cont = $("favBtns"); if (!wrap || !cont) return;
    const cats = categoriasFav();
    wrap.classList.toggle("hidden", cats.length === 0);
    cont.innerHTML = "";
    cats.forEach((cat) => {
      const b = document.createElement("button"); b.type = "button";
      b.className = "fav-btn" + (favCatActiva && favCatActiva.toLowerCase() === cat.toLowerCase() ? " active" : "");
      const n = state.telas.filter((t) => (t.fav || []).some((c) => c.toLowerCase() === cat.toLowerCase())).length;
      b.textContent = cat + " (" + n + ")";
      b.addEventListener("click", () => aplicarCategoriaFav(cat));
      cont.appendChild(b);
    });
  }
  // Telas a cotizar (uniforme): la principal (selector) + las marcadas como adicionales, sin repetir.
  function telasParaCotizar() {
    const principal = telaActual();
    const out = principal ? [principal] : [];
    const cont = $("telaOpcList");
    if (cont) cont.querySelectorAll('input[type="checkbox"]:checked').forEach((cb) => {
      if (out.some((t) => t.nombre === cb.value)) return;
      const t = state.telas.find((x) => x.nombre === cb.value); if (t) out.push(t);
    });
    return out;
  }
  function telasConsideradasTxt(telas) { return (telas || []).map((t) => telaCli(t)).join(" o "); }
  // Lote (motor v4) para una tela arbitraria con los mismos parámetros del formulario uniforme.
  function loteParaTela(tela, largo, ancho) {
    return window.CalcCIBSA.calcularLote({
      largo, ancho, valorM2: tela.valorM2, anchoRollo: tela.anchoRollo,
      cantidad: Math.max(1, parseInt(num("f_cantidad", 1), 10) || 1),
      union: num("f_union", 0.045), altura: alturaUnif(), defaults: BORDE_DEFAULTS,
      bordes: bordesActuales(), factorTela: facUnif(),
      ojetillos: nOjetillos(), valorOjetillo: num("f_ojvalor", CFG.VALOR_OJETILLO_DEFAULT),
    });
  }
  // Orientación de costuras por GRUPO de ancho de rollo: las telas que comparten rollo comparten elección.
  const orientByRollo = {};
  function rolloKey(ancho) { return String(Math.round((ancho || 0) * 1000)); }
  function orientDeTela(tela) { return (tela && orientByRollo[rolloKey(tela.anchoRollo)]) || state.orientUnif; }
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
  // ¿Este material se comporta como cinta/cierre (banda por arista)? Se identifica por CATEGORÍA (no por el
  // nombre del ítem, que era frágil). Si CONFIG.CATEGORIAS_CINTA está definido, usa esa lista (exacta,
  // normalizada); si no, cae a un patrón /cinta|cierre/ sobre la categoría o el ítem (compatibilidad).
  function esCintaMat(m) {
    if (!m) return false;
    const nm = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toLowerCase();
    const lista = CFG.CATEGORIAS_CINTA;
    if (Array.isArray(lista) && lista.length) return lista.some((c) => nm(c) === nm(m.categoria));
    return /cinta|cierre/i.test(m.categoria || "") || /cinta|cierre/i.test(m.item || "");
  }
  // Llena un <select> con los materiales tipo cinta AGRUPADOS por categoría (<optgroup>). Conserva la opción
  // "— elegir —" que ya tenga el select; solo agrega los grupos. Ordena categorías e ítems alfabéticamente.
  function opcionesCintaEn(sel) {
    const cats = [];
    state.materiales.forEach((m) => { if (esCintaMat(m)) { const c = m.categoria || ""; if (cats.indexOf(c) === -1) cats.push(c); } });
    cats.sort((a, b) => a.localeCompare(b));
    cats.forEach((cat) => {
      const og = document.createElement("optgroup"); og.label = cat || "(sin categoría)";
      state.materiales.map((m, i) => ({ m, i })).filter((x) => esCintaMat(x.m) && (x.m.categoria || "") === cat)
        .sort((a, b) => (a.m.item || "").localeCompare(b.m.item || ""))
        .forEach((x) => { const o = document.createElement("option"); o.value = String(x.i); o.textContent = matLabel(x.m); og.appendChild(o); });
      sel.appendChild(og);
    });
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
    const c = $("aletasUnif"); if (c) renderAletas(c, { aletas: state.aletasUnif, cantidad: cantUnif, valorOj: valorOjUnif, factor: facUnif, onChange: recompute, telaBase: () => $("f_tela").value, baseListo: () => (num("f_largo", null) > 0 && num("f_ancho", null) > 0 && !!$("f_tela").value) });
  }
  function renderBackAletasUnif() {
    const c = $("backAletasUnif"); if (c) renderAletas(c, { aletas: state.backAletasUnif, cantidad: cantUnif, valorOj: valorOjUnif, factor: facUnif, onChange: recompute, telaBase: () => $("f_tela").value, baseListo: () => (num("f_largo", null) > 0 && num("f_ancho", null) > 0 && !!$("f_tela").value) });
  }
  function renderStrapsUnif() {
    const c = $("strapsUnif"); if (c) renderStraps(c, { straps: state.strapsUnif, cantidad: cantUnif, getAncho: () => num("f_ancho", null), getLargo: () => num("f_largo", null), onChange: recompute });
  }
  function renderCintasUnif() {
    const c = $("cintasUnif"); if (c) renderCintas(c, { cintas: state.cintasUnif, getAncho: () => num("f_ancho", null), getLargo: () => num("f_largo", null), onChange: recompute });
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
      rotulo: base ? !!base.rotulo : false,
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
      ojMode: base ? (base.ojMode || "simple") : "simple",
      ojParejo: base ? !!base.ojParejo : false,
      ojEdges: base && base.ojEdges ? aletaOjEdgesCopy(base.ojEdges) : aletaOjEdgesDefault(),
      complementos: base ? (base.complementos || []).map((c) => Object.assign({}, c, { cantAristas: (c.cantAristas || []).slice() })) : [],
      rotulo: base ? !!base.rotulo : false,
    };
  }
  function aletaOjEdgesDefault() { return { t: defAletaEdge(), b: defAletaEdge(), l: defAletaEdge(), r: defAletaEdge() }; }
  function defAletaEdge() { return { on: true, d: "0.2", supr: "" }; }
  function aletaOjEdgesCopy(e) { const c = {}; ["t", "b", "l", "r"].forEach((k) => { const s = (e && e[k]) || {}; c[k] = { on: s.on !== false, d: s.d != null ? s.d : "0.2", supr: s.supr || "" }; }); return c; }
  // Letra de la arista fusionada según el borde base (inf→t, sup→b, izq→r, der→l).
  const ALETA_FUSED = { inf: "t", sup: "b", izq: "r", der: "l" };
  const ALETA_EDGE_NOM = { t: "Arista superior", b: "Arista inferior", l: "Arista izquierda", r: "Arista derecha" };
  // Factor de diseño (1..2): solo afecta el costo de tela (confección).
  function clampFactor(v) { const n = parseFloat(v); return (n >= 1 && n <= 5) ? n : (n > 5 ? 5 : 1); }
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
  // Config por arista del anexo → spec para sketch (distancia + supresión como Set). Solo aristas libres.
  function aletaOjEdgesSpec(e) {
    const out = {}; ["t", "b", "l", "r"].forEach((k) => { const s = (e && e[k]) || {}; out[k] = { on: s.on !== false, d: (s.d != null && s.d !== "") ? s.d : "0.4", supr: parseSupr(s.supr) }; });
    return out;
  }
  // Nº de ojetillos del anexo: por arista (si ojMode="arista") o el campo rápido "hem libre".
  function aletaOjN(a, al, aa) {
    if (a.ojMode === "arista" && a.ojEdges && window.SketchCIBSA && window.SketchCIBSA.aletaOjPuntos) {
      const ev = window.CalcCIBSA.evalExpr;
      const spec = { baseEdge: a.baseEdge || "inf", dBorde: ev(a.dBorde) || 0, largo: al, ancho: aa, offset: ev(a.offset) || 0, ojMode: "arista", ojParejo: !!a.ojParejo, ojEdges: aletaOjEdgesSpec(a.ojEdges) };
      return window.SketchCIBSA.aletaOjPuntos(spec, 0, 0).length;
    }
    return ojIntPz(a.ojetillos);
  }
  function calcAleta(a, cantidad, valorOj, factor) {
    const ev = window.CalcCIBSA.evalExpr;
    const al = ev(a.largo), aa = ev(a.ancho), tela = state.telas.find((t) => t.nombre === a.telaNombre), N = Math.max(1, cantidad || 1);
    if (!tela || al == null || aa == null || al <= 0 || aa <= 0) return null;
    const u = ev(a.union);
    let lote;
    try {
      lote = window.CalcCIBSA.calcularLote({ largo: al, ancho: aa, valorM2: tela.valorM2, anchoRollo: tela.anchoRollo, cantidad: N, union: (u == null || isNaN(u)) ? 0.045 : u, defaults: BORDE_DEFAULTS, bordes: bordesDePieza(a), ojetillos: aletaOjN(a, al, aa), valorOjetillo: valorOj, factorTela: clampFactor(factor) });
    } catch (e) { return null; }
    // Consumo real del anexo (aleta/faldón/cenefa): se corta del rollo en la orientación MÁS BARATA
    // (seccionar a lo ancho del rollo suele ganar para piezas largas y angostas). Es el mismo motor
    // de consumo del paño base, eligiendo el menor de las dos orientaciones.
    const o = (lote.oAncho.subtotalLote <= lote.oLargo.subtotalLote) ? lote.oAncho : lote.oLargo;
    const compTot = compTotalUnit(a.complementos) * N;
    return { tela, al, aa, lote, o, N, subtotal: o.subtotalLote + compTot };
  }
  // Las fichas marcadas con _oculto se excluyen por completo (plano + costo + detalle).
  function visibles(list) { return (list || []).filter((x) => !x._oculto); }
  function aletasTotal(list, cantidad, valorOj, factor) {
    return visibles(list).reduce((s, a) => { const r = calcAleta(a, cantidad, valorOj, factor); return s + (r ? r.subtotal : 0); }, 0);
  }
  let ROTSEQ = 0;
  function rotId(o) { if (o._rid == null) o._rid = ++ROTSEQ; return o._rid; }
  function aletasSpec(list) {
    const ev = window.CalcCIBSA.evalExpr;
    return visibles(list).map((a) => ({ tipo: a.tipo, baseEdge: a.baseEdge || "inf", dBorde: ev(a.dBorde) || 0, largo: ev(a.largo) || 0, ancho: ev(a.ancho) || 0, offset: ev(a.offset) || 0, ojetillos: ojIntPz(a.ojetillos), ojMode: a.ojMode || "simple", ojParejo: !!a.ojParejo, ojEdges: (a.ojMode === "arista" && a.ojEdges) ? aletaOjEdgesSpec(a.ojEdges) : null, legend: a.legend || "", rotulo: !!a.rotulo, id: rotId(a) })).filter((a) => a.largo > 0 && a.ancho > 0);
  }
  function aletasLineasPDF(list, cantidad, valorOj, factor) {
    return visibles(list).map((a) => {
      const r = calcAleta(a, cantidad, valorOj, factor); if (!r) return null;
      const nom = (a.legend && a.legend.trim()) ? a.legend.trim() : (ALETA_NOM[a.tipo] || "Aleta");
      let t = nom + " en " + telaCli(r.tela) + " " + window.CalcCIBSA.fmtNum(r.al) + "×" + window.CalcCIBSA.fmtNum(r.aa) + " m — " + money(r.subtotal / r.N) + "/u";
      if (a.descripcion && a.descripcion.trim()) t += " · " + a.descripcion.trim();
      return t;
    }).filter(Boolean);
  }
  // ---------- Straps (cintas/webbing): banda recta sobre el paño ----------
  function anchoCintaM(mat) { if (!mat) return 0; const v = parseFloat(String(mat.modelo == null ? "" : mat.modelo).replace(",", ".")); return (v > 0) ? v / 100 : 0; } // MODELO en cm → m
  function strapMat(s) { return (s && s.matId != null && state.materiales[s.matId]) || null; }
  function strapLargo(s) { const ev = window.CalcCIBSA.evalExpr; return Math.max(0, ev(s.offset) || 0) + Math.max(0, ev(s.inset) || 0); }
  // Arista del perímetro: endpoints + ángulo de la perpendicular hacia AFUERA + largo de la arista.
  function strapAristaEdge(arista, ctx) {
    const A = (ctx && ctx.ancho) || 0, L = (ctx && ctx.largo) || 0;
    if (!(A > 0) || !(L > 0)) return null;
    if (arista === "sup") return { ax: 0, ay: 0, bx: A, by: 0, outAng: 270, len: A };
    if (arista === "inf") return { ax: 0, ay: L, bx: A, by: L, outAng: 90, len: A };
    if (arista === "izq") return { ax: 0, ay: 0, bx: 0, by: L, outAng: 180, len: L };
    if (arista === "der") return { ax: A, ay: 0, bx: A, by: L, outAng: 0, len: L };
    return null;
  }
  // Cuántos straps quedan al propagar por la arista (posiciones - suprimidas). Manual = 1.
  function strapInstancias(s, ctx) {
    if (s.modo !== "arista") return 1;
    const ev = window.CalcCIBSA.evalExpr, e = strapAristaEdge(s.arista || "sup", ctx || {});
    if (!e) return 0;
    const d = ev(s.d) || 0;
    let inst = 0;
    if (d > 0) { const n = window.SketchCIBSA.posicionesArista(e.len, d, false).length; inst += Math.max(0, n - parseSupr(s.supr).filter((i) => i < n).length); }
    // Sets de straps: cada set aporta sus puntos válidos a lo largo de la arista.
    (s.sets || []).forEach((st) => {
      const cnt = ev(st.n); if (!(cnt >= 2)) return;
      const so = ev(st.off) || 0, se = ev(st.esp) || 0, esqFin = setEsqFin(s.arista || "sup", st.esq || setEsqDefault(s.arista || "sup"));
      inst += setPosiciones(e.len, cnt, so, se, esqFin).length;
    });
    return inst;
  }
  function strapsSpec(list, ctx) {
    ctx = ctx || {};
    const ev = window.CalcCIBSA.evalExpr, out = [];
    visibles(list).forEach((s) => {
      const ancho = anchoCintaM(strapMat(s)), off = Math.max(0, ev(s.offset) || 0), ins = Math.max(0, ev(s.inset) || 0);
      // El strap procede si tiene crecimiento ↑/↓ propio, o si algún SET tiene su propio crecimiento.
      const haySetCross = (s.modo === "arista") && (s.sets || []).some((st) => { const c = setCross(st, off, ins); return ev(st.n) >= 2 && (c.up + c.down) > 0; });
      if (!(ancho > 0) || (!(off + ins > 0) && !haySetCross)) return;
      const nom = s.legend || "";
      // "offset borde": corre el punto de unión hacia ADENTRO del paño (contra el sentido de crecimiento ↑/offset).
      const B = Math.max(0, ev(s.offBorde) != null && !isNaN(ev(s.offBorde)) ? ev(s.offBorde) : 0.01);
      const EDGELBL = { sup: "Superior", inf: "Inferior", izq: "Izquierda", der: "Derecha" };
      if (s.modo === "arista") {
        const e = strapAristaEdge(s.arista || "sup", ctx), d = ev(s.d) || 0;
        const haySets = (s.sets || []).some((st) => ev(st.n) >= 2);
        if (!e || (!(d > 0) && !haySets)) return;
        const grp = EDGELBL[s.arista || "sup"] || "Arista";
        const ux = (e.bx - e.ax) / e.len, uy = (e.by - e.ay) / e.len, supr = new Set(parseSupr(s.supr));
        const ar = e.outAng * Math.PI / 180, sdx = Math.cos(ar), sdy = Math.sin(ar); // dir de crecimiento (hacia afuera)
        if (d > 0) window.SketchCIBSA.posicionesArista(e.len, d, false).forEach((t, i) => { if (supr.has(i)) return; out.push({ cx: e.ax + ux * t - sdx * B, cy: e.ay + uy * t - sdy * B, angulo: e.outAng, offset: off, inset: ins, ancho: ancho, legend: nom, grupo: grp, set: true }); });
        // Sets de straps: grupos (≥2) desde una esquina, con offset, espaciado, inset (= offBorde extra) y ↑/↓ PROPIOS.
        (s.sets || []).forEach((st) => {
          const cnt = ev(st.n); if (!(cnt >= 2)) return;
          const so = ev(st.off) || 0, se = ev(st.esp) || 0, siRaw = ev(st.inset), si2 = (siRaw != null && siRaw > 0) ? siRaw : 0;
          const c = setCross(st, off, ins); if (c.up + c.down <= 0) return;
          const Bs = B + si2, esqFin = setEsqFin(s.arista || "sup", st.esq || setEsqDefault(s.arista || "sup"));
          setPosiciones(e.len, cnt, so, se, esqFin).forEach((t) => { out.push({ cx: e.ax + ux * t - sdx * Bs, cy: e.ay + uy * t - sdy * Bs, angulo: e.outAng, offset: c.up, inset: c.down, ancho: ancho, legend: nom, grupo: grp, set: true }); });
        });
      } else {
        const ang = ev(s.angulo) || 0, ar = ang * Math.PI / 180;
        out.push({ cx: (ev(s.cx) || 0) - Math.cos(ar) * B, cy: (ev(s.cy) || 0) - Math.sin(ar) * B, angulo: ang, offset: off, inset: ins, ancho: ancho, legend: nom, grupo: "Manual" });
      }
    });
    return out;
  }
  // ===== Cintas / cierres =====
  // Banda CONTINUA paralela a una arista (con offset hacia adentro), recorrido = span [desde, hasta] (o toda la
  // arista), con pivote/ángulo opcional. El campo "edicion" define los tramos (parser en sketch.js): "-" bolsillo
  // (con Ø), "!" costura de seguridad, "x" hueco. Devuelve la geometría en metros para que sketch.js la dibuje.
  // Recorridos (runs) de UNA cinta: modo "arista" → 1 recorrido pegado a una arista; modo "patron" → N
  // recorridos paralelos que cruzan el paño (distribución "fija" con espaciado, o "entre" dos aristas uniforme).
  function cintaRuns(c, ctx) {
    ctx = ctx || {}; const ev = window.CalcCIBSA.evalExpr, SK = window.SketchCIBSA;
    const A = ctx.ancho || 0, Lp = ctx.largo || 0; if (!(A > 0) || !(Lp > 0)) return [];
    const ancho = anchoCintaM(strapMat(c)) || 0.02;
    const mk = (ax, ay, ux, uy, inX, inY, Lc, arista) => {
      if (!(Lc > 0)) return null;
      const tramos = SK.parseCintaTramos(c.edicion, Lc), seg = SK.cintaSegmentos(Lc, tramos);
      return { arista: arista, ax: ax, ay: ay, ux: ux, uy: uy, nx: -uy, ny: ux, inX: inX, inY: inY, L: Lc,
        tramos: tramos, seg: seg, zoomTramos: SK.parseZoomRanges(c.zoomDetalle, Lc), ancho: ancho, tipo: c.tipo || "cinta", legend: c.legend || "", rotulo: !!c.rotulo, id: rotId(c) };
    };
    if (c.modo === "perimetro") {
      const off = Math.max(0, ev(c.offset) || 0), runs = [];
      ["sup", "der", "inf", "izq"].forEach((ar) => {
        const e = strapAristaEdge(ar, { ancho: A, largo: Lp }); if (!e) return;
        const ux = (e.bx - e.ax) / e.len, uy = (e.by - e.ay) / e.len;
        const arr = e.outAng * Math.PI / 180, inX = -Math.cos(arr), inY = -Math.sin(arr);
        const r = mk(e.ax + inX * off, e.ay + inY * off, ux, uy, inX, inY, e.len, "Perímetro");
        if (r) { r.perim = true; runs.push(r); }
      });
      return runs;   // un solo objeto cinta (mismo id) → una ficha / un rótulo, dibujado en las 4 aristas
    }
    if (c.modo === "patron") {
      const n = Math.max(1, Math.round(ev(c.nPat) || 1));
      const ext = Math.max(0, ev(c.extremos) || 0), pos1 = Math.max(0, ev(c.pos1) || 0);
      const vertical = (c.orient || "vertical") === "vertical";       // vertical: corren sup→inf, se distribuyen izq→der
      const D = vertical ? A : Lp;                                     // eje de distribución
      const Lc = (vertical ? Lp : A) - 2 * ext;                        // largo de cada recorrido (con offset de extremos)
      const pos = [];
      if (c.distMode === "entre" && n > 1) {                            // uniforme entre dos aristas (como ojetillos)
        const pf = (ev(c.posFin) != null && !isNaN(ev(c.posFin))) ? Math.max(0, ev(c.posFin)) : pos1;
        const step = Math.max(0, D - pos1 - pf) / (n - 1);
        for (let k = 0; k < n; k++) pos.push(pos1 + k * step);
      } else {                                                          // espaciado fijo desde la 1ª
        const esp = Math.max(0, ev(c.esp) || 0);
        for (let k = 0; k < n; k++) pos.push(pos1 + k * esp);
      }
      return pos.filter((p) => p >= -1e-6 && p <= D + 1e-6)
        .map((p) => vertical ? mk(p, ext, 0, 1, 1, 0, Lc, "patrón") : mk(ext, p, 1, 0, 0, 1, Lc, "patrón"))
        .filter(Boolean);
    }
    // modo "arista"
    const e = strapAristaEdge(c.arista || "sup", { ancho: A, largo: Lp }); if (!e) return [];
    let ux = (e.bx - e.ax) / e.len, uy = (e.by - e.ay) / e.len;
    const ar = e.outAng * Math.PI / 180, ox = Math.cos(ar), oy = Math.sin(ar), inX = -ox, inY = -oy;
    const off = Math.max(0, ev(c.offset) || 0), desde = Math.max(0, ev(c.desde) || 0);
    let hasta = ev(c.hasta); if (hasta == null || isNaN(hasta) || hasta <= 0) hasta = e.len; hasta = Math.min(hasta, e.len);
    const Lc = Math.max(0, hasta - desde);
    const axp = e.ax + ux * desde + inX * off, ayp = e.ay + uy * desde + inY * off;
    const ang = (c.pivote && ev(c.angulo)) ? (ev(c.angulo) || 0) : 0;
    if (ang) { const g = ang * Math.PI / 180, cs = Math.cos(g), sn = Math.sin(g); const rx = ux * cs - uy * sn, ry = ux * sn + uy * cs; ux = rx; uy = ry; }
    const r = mk(axp, ayp, ux, uy, inX, inY, Lc, c.arista || "sup"); return r ? [r] : [];
  }
  function cintasSpec(list, ctx) {
    ctx = ctx || {}; const A = ctx.ancho || 0, Lp = ctx.largo || 0; if (!(A > 0) || !(Lp > 0)) return [];
    const out = []; visibles(list).forEach((c) => cintaRuns(c, ctx).forEach((r) => out.push(r))); return out;
  }
  // Metros lineales totales de cinta de un strap (reparto normal con ↑/↓ del padre + cada SET con sus ↑/↓ propios).
  function strapMetros(s, ctx) {
    const ev = window.CalcCIBSA.evalExpr;
    const off = Math.max(0, ev(s.offset) || 0), ins = Math.max(0, ev(s.inset) || 0);
    if (s.modo !== "arista") return off + ins;
    const e = strapAristaEdge(s.arista || "sup", ctx || {}); if (!e) return 0;
    let m = 0;
    const d = ev(s.d) || 0;
    if (d > 0 && (off + ins) > 0) {
      const n = window.SketchCIBSA.posicionesArista(e.len, d, false).length;
      const kept = Math.max(0, n - parseSupr(s.supr).filter((i) => i < n).length);
      m += kept * (off + ins);
    }
    (s.sets || []).forEach((st) => {
      const cnt = ev(st.n); if (!(cnt >= 2)) return;
      const c = setCross(st, off, ins), len = c.up + c.down; if (len <= 0) return;
      const pts = setPosiciones(e.len, cnt, ev(st.off) || 0, ev(st.esp) || 0, setEsqFin(s.arista || "sup", st.esq || setEsqDefault(s.arista || "sup"))).length;
      m += pts * len;
    });
    return m;
  }
  function strapsTotal(list, N, ctx) {
    const n = Math.max(1, N || 1);
    return visibles(list).reduce((acc, s) => { const m = strapMat(s); return acc + strapMetros(s, ctx) * (m && m.precio != null ? m.precio : 0) * n; }, 0);
  }
  function strapsLineasPDF(list, ctx) {
    return visibles(list).map((s) => { const m = strapMat(s); if (!m) return null; const metros = strapMetros(s, ctx), ancho = anchoCintaM(m), inst = strapInstancias(s, ctx); if (!(metros > 0) || !(ancho > 0) || inst <= 0) return null; const nom = (s.legend && s.legend.trim()) ? s.legend.trim() : "Cinta"; const cant = (s.modo === "arista") ? (inst + "× ") : ""; return nom + ": " + cant + m.item + " — " + window.CalcCIBSA.fmtNum(metros) + " m totales × " + window.CalcCIBSA.fmtNum(ancho * 100) + " cm — " + money(metros * (m.precio || 0)) + "/u"; }).filter(Boolean);
  }
  // ---- Costeo de cintas / cierres (por metro lineal de MATERIAL = total − huecos), sumando todos los recorridos ----
  function cintaLc(c, ctx) {   // largo del recorrido en modo "arista" (para el texto de ayuda)
    const ev = window.CalcCIBSA.evalExpr, e = strapAristaEdge(c.arista || "sup", ctx); if (!e) return 0;
    const d = Math.max(0, ev(c.desde) || 0); let h = ev(c.hasta); if (h == null || isNaN(h) || h <= 0) h = e.len; h = Math.min(h, e.len);
    return Math.max(0, h - d);
  }
  function cintaMatMetros(c, ctx) { return cintaRuns(c, ctx).reduce((s, r) => s + (r.seg.mMaterial || 0), 0); }
  function cintasTotal(list, N, ctx) {
    const n = Math.max(1, N || 1);
    return visibles(list).reduce((acc, c) => { const m = strapMat(c); if (!m) return acc; return acc + cintaMatMetros(c, ctx) * (m.precio != null ? m.precio : 0) * n; }, 0);
  }
  function cintasUnifPDF(list, ctx, N) {
    const f = window.CalcCIBSA.fmtNum, n = Math.max(1, N || 1);
    return visibles(list).map((c) => {
      const m = strapMat(c); if (!m) return null;
      const runs = cintaRuns(c, ctx); if (!runs.length) return null;
      const mat = runs.reduce((s, r) => s + (r.seg.mMaterial || 0), 0); if (!(mat > 0)) return null;
      const nOpen = runs.reduce((s, r) => s + (r.seg.opens || []).length, 0), nGap = runs.reduce((s, r) => s + (r.seg.gaps || []).length, 0), mSaf = runs.reduce((s, r) => s + (r.seg.mSafety || 0), 0);
      const ancho = anchoCintaM(m), esCierre = c.tipo === "cierre";
      const nom = (c.legend && c.legend.trim()) ? c.legend.trim() : (esCierre ? "Cierre" : "Cinta");
      const cant = runs.length > 1 ? (runs.length + "× ") : "";
      const extra = []; if (nOpen) extra.push(nOpen + " bolsillo(s)"); if (mSaf > 0) extra.push("seguridad " + f(mSaf) + " m"); if (nGap) extra.push(nGap + " hueco(s)");
      const det = nom + ": " + cant + m.item + " " + f(mat) + " m × " + (ancho > 0 ? f(ancho * 100) + " cm" : "?") + (extra.length ? " (" + extra.join(", ") + ")" : "");
      const unit = mat * (m.precio || 0);
      return { cantidad: n, detalle: det, precio: Math.round(unit), totalNeto: Math.round(unit * n), cat: esCierre ? "Cierre" : "Cinta" };
    }).filter(Boolean);
  }
  function cintasLineasPDF(list, ctx) {
    const f = window.CalcCIBSA.fmtNum;
    return visibles(list).map((c) => {
      const m = strapMat(c); if (!m) return null;
      const runs = cintaRuns(c, ctx); if (!runs.length) return null;
      const mat = runs.reduce((s, r) => s + (r.seg.mMaterial || 0), 0); if (!(mat > 0)) return null;
      const nom = (c.legend && c.legend.trim()) ? c.legend.trim() : (c.tipo === "cierre" ? "Cierre" : "Cinta");
      const cant = runs.length > 1 ? (runs.length + "× ") : "";
      return nom + ": " + cant + m.item + " — " + f(mat) + " m totales × " + f(anchoCintaM(m) * 100) + " cm — " + money(mat * (m.precio || 0)) + "/u";
    }).filter(Boolean);
  }
  // Editor de straps. ctx: { straps, cantidad(), onChange }
  function renderStraps(container, ctx) {
    container.innerHTML = "";
    const onChange = ctx.onChange, ev = window.CalcCIBSA.evalExpr, f = window.CalcCIBSA.fmtNum;
    const hayCintas = state.materiales.some(esCintaMat);
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
        opcionesCintaEn(selT);
        selT.value = s.matId != null ? String(s.matId) : "";
        selT.addEventListener("change", (e) => { s.matId = e.target.value === "" ? null : parseInt(e.target.value, 10); refresh(); onChange(); });
        lt.appendChild(selT); addHelpTo(lt, "Cinta/webbing del strap. El ancho se toma de la columna MODELO (en cm) y el precio por metro de la columna de precio.", "STRAP-CINTA"); card.appendChild(lt);
        const numField = (lab, key, ph, min0) => {
          const l = document.createElement("label"); l.className = "field"; l.innerHTML = "<span>" + lab + "</span>";
          const i = document.createElement("input"); i.type = "text"; i.inputMode = "decimal"; i.value = s[key] != null ? s[key] : ""; if (ph) i.placeholder = ph;
          i.addEventListener("input", (e) => { s[key] = e.target.value; refresh(); onChange(); });
          i.addEventListener("blur", (e) => { let r = ev(e.target.value); if (r != null && !isNaN(r)) { if (min0) r = Math.max(0, r); s[key] = f(r); e.target.value = s[key]; refresh(); onChange(); } });
          l.appendChild(i); agregarCalc(i); return l;
        };
        const A = ctx.getAncho ? ctx.getAncho() : null, L = ctx.getLargo ? ctx.getLargo() : null;
        // Distribución: única (manual) o por arista (propaga como los ojetillos).
        const md = document.createElement("label"); md.className = "field full"; md.innerHTML = "<span>Distribución</span>";
        const selM = document.createElement("select");
        [["unica", "Única (manual)"], ["arista", "Por arista (propaga)"]].forEach(([v, t]) => { const o = document.createElement("option"); o.value = v; o.textContent = t; selM.appendChild(o); });
        selM.value = s.modo === "arista" ? "arista" : "unica";
        selM.addEventListener("change", (e) => { s.modo = e.target.value; pintar(); onChange(); });
        md.appendChild(selM); addHelpTo(md, "Única: ubicas un solo strap por su centro y ángulo. Por arista: el strap se propaga a lo largo de una arista del paño (como los ojetillos), perpendicular a ella, con distanciamiento y supresión.", "STRAP-MODO"); card.appendChild(md);
        if (s.modo === "arista") {
          const le = document.createElement("label"); le.className = "field full"; le.innerHTML = "<span>Arista</span>";
          const selE = document.createElement("select");
          [["sup", "Superior"], ["inf", "Inferior"], ["izq", "Izquierda"], ["der", "Derecha"]].forEach(([v, t]) => { const o = document.createElement("option"); o.value = v; o.textContent = t; selE.appendChild(o); });
          selE.value = s.arista || "sup";
          selE.addEventListener("change", (e) => { s.arista = e.target.value; refresh(); onChange(); });
          le.appendChild(selE); addHelpTo(le, "Arista del paño por la que se reparten los straps. Cada strap queda perpendicular a esta arista.", "STRAP-EDGE"); card.appendChild(le);
          const grid = document.createElement("div"); grid.className = "pieza-grid";
          grid.appendChild(addHelpTo(numField("Distanciamiento (m)", "d", "0.5", true), "Separación entre straps repartidos a lo largo de la arista. Déjalo en 0 o vacío para NO repartir straps sueltos y usar solo los SETS (grupos independientes) de abajo.", "STRAP-DIST"));
          grid.appendChild(addHelpTo(numField("↑ (m)", "offset", "0", true), "Cuánto crece cada cinta desde el punto de unión hacia AFUERA del paño (cruza la arista). Solo ≥ 0.", "STRAP-OFFSET"));
          grid.appendChild(addHelpTo(numField("↓ (m)", "inset", "0", true), "Cuánto crece cada cinta desde el punto de unión hacia ADENTRO del paño. Solo ≥ 0.", "STRAP-INSET"));
          grid.appendChild(addHelpTo(numField("Offset borde (m) / d.remate costura", "offBorde", "0.01", true), "Corre el PUNTO DE UNIÓN hacia adentro del paño, medido desde la arista (mín. 0.01 m). Desde ahí la cinta crece ↑ y ↓.", "STRAP-OFFBORDE"));
          card.appendChild(grid);
          const ls = document.createElement("label"); ls.className = "field full"; ls.innerHTML = "<span>Suprimir posiciones (ej. 1, 3, 5-8)</span>";
          const si = document.createElement("input"); si.type = "text"; si.value = s.supr || ""; si.placeholder = "ej. 1, 3, 5-8";
          si.addEventListener("input", (e) => { s.supr = e.target.value; refresh(); onChange(); });
          ls.appendChild(si); addHelpTo(ls, "Quita straps puntuales de la propagación por su índice (desde 0). Acepta unidades sueltas y rangos con guión, ej. \"1, 3, 5-8\" (= 1,3,5,6,7,8).", "STRAP-SUPR"); card.appendChild(ls);
          // "+SETS": grupos de straps (≥2) desde una esquina de la arista, con offset, espaciado e inset.
          renderSetsEditor(card, s, s.arista || "sup", "straps", pintar, onChange);
          const dimInfo = document.createElement("p"); dimInfo.className = "muted small";
          const e = strapAristaEdge(s.arista || "sup", { ancho: A, largo: L });
          if (e && (ev(s.d) || 0) > 0) { const inst = strapInstancias(s, { ancho: A, largo: L }); dimInfo.innerHTML = "Arista de <b>" + f(e.len) + " m</b> → <b>" + inst + "</b> strap(s) cada " + f(ev(s.d) || 0) + " m, perpendicular a la arista."; }
          else dimInfo.textContent = "Define el distanciamiento y el tamaño del paño base para propagar.";
          card.appendChild(dimInfo);
        } else {
          const grid = document.createElement("div"); grid.className = "pieza-grid";
          grid.appendChild(addHelpTo(numField("Centro X (m)", "cx", "0"), "Punto central/pivote en X (0 = borde izquierdo). Desde aquí el strap crece a cada lado. Puede ser negativo.", "STRAP-CX"));
          grid.appendChild(addHelpTo(numField("Centro Y (m)", "cy", "0"), "Punto central/pivote en Y (0 = borde superior). Desde aquí el strap crece a cada lado. Puede ser negativo.", "STRAP-CY"));
          grid.appendChild(addHelpTo(numField("Ángulo (°)", "angulo", "0"), "Inclinación: 0 = horizontal, 90 = vertical, 45 = diagonal. La banda es siempre recta.", "STRAP-ANG"));
          grid.appendChild(addHelpTo(numField("↑ (m)", "offset", "0", true), "Cuánto crece la cinta hacia un lado del punto de unión (sentido del ángulo). Solo ≥ 0.", "STRAP-OFFSET"));
          grid.appendChild(addHelpTo(numField("↓ (m)", "inset", "0", true), "Cuánto crece la cinta hacia el otro lado del punto de unión. Solo ≥ 0. Va en sentido opuesto a ↑.", "STRAP-INSET"));
          grid.appendChild(addHelpTo(numField("Offset borde (m) / d.remate costura", "offBorde", "0.01", true), "Corre el PUNTO DE UNIÓN hacia adentro (en sentido opuesto a ↑), medido desde el centro indicado (mín. 0.01 m).", "STRAP-OFFBORDE"));
          card.appendChild(grid);
          const dimInfo = document.createElement("p"); dimInfo.className = "muted small";
          dimInfo.innerHTML = (A > 0 && L > 0) ? ("Paño base: <b>largo " + f(L) + " m × ancho " + f(A) + " m</b> · X de 0 a " + f(A) + " · Y de 0 a " + f(L)) : "Define largo y ancho del paño base para ubicar el strap.";
          card.appendChild(dimInfo);
          if (A > 0 && L > 0) {
            const acap = document.createElement("p"); acap.className = "muted small"; acap.textContent = "Alinear el centro a 0,01 m de una arista (offset crece hacia afuera; inset hacia adentro):";
            card.appendChild(addHelpTo(acap, "Coloca el centro del strap a 1 cm por dentro de la arista elegida y orienta el ángulo para que 'offset' salga del paño e 'inset' entre. Luego puedes mover el centro a lo largo de esa arista.", "STRAP-ARISTA"));
            const arow = document.createElement("div"); arow.className = "pz-actions"; arow.style.flexWrap = "wrap";
            const snap = (axis, val, ang) => { if (axis === "y") s.cy = f(val); else s.cx = f(val); s.angulo = String(ang); pintar(); onChange(); };
            [["↑ Superior", () => snap("y", 0.01, 270)], ["↓ Inferior", () => snap("y", L - 0.01, 90)], ["← Izquierda", () => snap("x", 0.01, 180)], ["→ Derecha", () => snap("x", A - 0.01, 0)]].forEach(([lab, fn]) => {
              const b = document.createElement("button"); b.type = "button"; b.className = "pz-btn"; b.textContent = lab; b.addEventListener("click", fn); arow.appendChild(b);
            });
            card.appendChild(arow);
          }
        }
        const ln = document.createElement("label"); ln.className = "field full"; ln.innerHTML = "<span>Nombre / leyenda (plano)</span>";
        const ni = document.createElement("input"); ni.type = "text"; ni.value = s.legend || ""; ni.placeholder = "ej. Strap superior";
        ni.addEventListener("input", (e) => { s.legend = e.target.value; refresh(); onChange(); });
        ln.appendChild(ni); card.appendChild(ln);
        const dims = document.createElement("div"); dims.className = "muted small ins-dims"; card.appendChild(dims);
        function refresh() {
          const m = strapMat(s), largo = strapLargo(s), ancho = anchoCintaM(m);
          if (!m) { dims.textContent = "Elige la cinta para ver ancho y costo."; return; }
          if (!(largo > 0)) { dims.textContent = "Define offset y/o inset (> 0)."; return; }
          const inst = strapInstancias(s, { ancho: A, largo: L });
          const N = ctx.cantidad ? ctx.cantidad() : 1, pu = largo * (m.precio || 0), tot = pu * inst * Math.max(1, N);
          let html = "Cinta <b>" + m.item + "</b> · largo <b>" + f(largo) + " m</b> · ancho <b>" + (ancho > 0 ? f(ancho * 100) + " cm" : "?") + "</b> · " + money(pu) + "/u";
          if (s.modo === "arista") html += " · <b>" + inst + "</b> strap(s)";
          if (inst * Math.max(1, N) > 1) html += " · total <b>" + money(tot) + "</b>";
          if (!(ancho > 0)) html += " · <span style=\"color:#d8443a\">⚠ la cinta no tiene ancho (col. MODELO) en cm</span>";
          dims.innerHTML = html;
        }
        refresh();
        ocultarFichaCtl(card, s, pintar, onChange);
        fichaColapsable(card, head, tt, s);
        rows.appendChild(card);
      });
      navFichas(rows, (ctx.straps || []).map((s, i) => ({ titulo: "Strap " + (i + 1), nombre: s.legend || "", oculto: !!s._oculto })));
    }
    pintar();
    const add = document.createElement("button"); add.type = "button"; add.className = "btn-outline"; add.textContent = "+ Strap (cinta)";
    add.disabled = !hayCintas;
    add.addEventListener("click", () => { ctx.straps.push({ matId: null, modo: "unica", arista: "sup", d: "0.5", supr: "", cx: "", cy: "", angulo: "0", offset: "", inset: "0", offBorde: "0.01", legend: "", sets: [] }); pintar(); onChange(); });
    container.appendChild(add);
  }
  // ---------- Cintas / cierres ----------
  function nuevaCinta(base) {
    base = base || {};
    return { matId: base.matId != null ? base.matId : null, tipo: base.tipo || "cinta", modo: base.modo || "arista", arista: base.arista || "sup",
      offset: base.offset != null ? base.offset : "0.02", desde: base.desde != null ? base.desde : "0", hasta: base.hasta || "",
      pivote: !!base.pivote, angulo: base.angulo || "0",
      // Patrón de cintas paralelas: orient (vertical=corren sup→inf, se distribuyen izq→der), nº, distribución
      // ("fijo" espaciado / "entre" uniforme entre 2 aristas), espaciado, posición de la 1ª y offset de extremos.
      orient: base.orient || "vertical", nPat: base.nPat != null ? base.nPat : "3", distMode: base.distMode || "fijo",
      esp: base.esp != null ? base.esp : "0.5", pos1: base.pos1 != null ? base.pos1 : "0.5", posFin: base.posFin || "", extremos: base.extremos != null ? base.extremos : "0",
      edicion: base.edicion || "", zoomDetalle: base.zoomDetalle || "", legend: base.legend || "", rotulo: base.rotulo != null ? !!base.rotulo : true };
  }
  const CINTA_GLOBO = "Cinta/cierre continua paralela a la arista. En «Edición» defines los tramos separados por coma, medidos a lo largo de la cinta: " +
    "a-b = sin costura / bolsillo (Ø opcional, ej. 2-4Ø0.05) → se marca con Ω; a!b = costura de seguridad (refuerzo) → recuadro con diagonales; " +
    "a x b = hueco / sin cinta → achurado con cota ✕. Lo NO listado va cosido continuo. Ejemplo: 2-4Ø0.05, 5.5!7, 7x9.";
  // ctx: { cintas, getAncho(), getLargo(), onChange }
  function renderCintas(container, ctx) {
    container.innerHTML = "";
    const onChange = ctx.onChange, ev = window.CalcCIBSA.evalExpr, f = window.CalcCIBSA.fmtNum;
    const cab = document.createElement("p"); cab.className = "muted small";
    cab.textContent = "Cintas / cierres: banda continua paralela a una arista, con tramos de bolsillo (Ω), seguridad (!) y huecos (✕).";
    container.appendChild(cab);
    const rows = document.createElement("div"); container.appendChild(rows);
    function pintar() {
      rows.innerHTML = "";
      (ctx.cintas || []).forEach((c, idx) => {
        const A = ctx.getAncho ? ctx.getAncho() : null, L = ctx.getLargo ? ctx.getLargo() : null;
        const card = document.createElement("div"); card.className = "ins-card strap-card";
        const head = document.createElement("div"); head.className = "ins-head";
        const nom0 = (c.legend && c.legend.trim()) ? c.legend.trim() : (c.tipo === "cierre" ? "Cierre" : "Cinta");
        const tt = document.createElement("span"); tt.className = "muted small"; tt.textContent = "Cinta Nº" + (idx + 1) + " — " + nom0;
        const del = document.createElement("button"); del.type = "button"; del.className = "pz-btn del"; del.textContent = "✕";
        del.addEventListener("click", () => { ctx.cintas.splice(idx, 1); pintar(); onChange(); });
        head.appendChild(tt); head.appendChild(del); card.appendChild(head);
        const numField = (lab, key, ph) => {
          const l = document.createElement("label"); l.className = "field"; l.innerHTML = "<span>" + lab + "</span>";
          const i = document.createElement("input"); i.type = "text"; i.inputMode = "decimal"; i.value = c[key] != null ? c[key] : ""; if (ph) i.placeholder = ph;
          i.addEventListener("input", (e) => { c[key] = e.target.value; refresh(); onChange(); });
          i.addEventListener("blur", (e) => { const r = ev(e.target.value); if (r != null && !isNaN(r)) { c[key] = f(r); e.target.value = c[key]; refresh(); onChange(); } });
          l.appendChild(i); agregarCalc(i); return l;
        };
        const lt = document.createElement("label"); lt.className = "field"; lt.innerHTML = "<span>Tipo</span>";
        const selT = document.createElement("select");
        [["cinta", "Cinta"], ["cierre", "Cierre"]].forEach(([v, t]) => { const o = document.createElement("option"); o.value = v; o.textContent = t; selT.appendChild(o); });
        selT.value = c.tipo || "cinta"; selT.addEventListener("change", (e) => { c.tipo = e.target.value; refresh(); onChange(); });
        lt.appendChild(selT); card.appendChild(lt);
        const lm = document.createElement("label"); lm.className = "field full"; lm.innerHTML = "<span>Cinta / cierre (material)</span>";
        const selM = document.createElement("select");
        const o0 = document.createElement("option"); o0.value = ""; o0.textContent = "— elegir material —"; selM.appendChild(o0);
        opcionesCintaEn(selM);
        selM.value = c.matId != null ? String(c.matId) : "";
        selM.addEventListener("change", (e) => { c.matId = e.target.value === "" ? null : parseInt(e.target.value, 10); refresh(); onChange(); });
        lm.appendChild(selM); addHelpTo(lm, "Material de la cinta/cierre. El ANCHO se toma de la columna MODELO (cm); el precio por metro de la columna de precio.", "CINTA-MAT"); card.appendChild(lm);
        const selBox = (lab, key, opts, help, code, onSel) => {
          const l = document.createElement("label"); l.className = "field"; l.innerHTML = "<span>" + lab + "</span>";
          const s = document.createElement("select");
          opts.forEach(([v, t]) => { const o = document.createElement("option"); o.value = v; o.textContent = t; s.appendChild(o); });
          s.value = c[key] || opts[0][0]; s.addEventListener("change", (e) => { c[key] = e.target.value; (onSel || refresh)(); onChange(); });
          l.appendChild(s); if (help) addHelpTo(l, help, code); card.appendChild(l);
        };
        if (c.modo === "perimetro") {
          const gi = document.createElement("div"); gi.className = "pieza-grid";
          gi.appendChild(addHelpTo(numField("Inset (m)", "offset", "0"), "Separación de la cinta respecto del borde, hacia adentro del paño, igual en todo el perímetro. 0 = pegada al borde.", "CINTA-INSET"));
          card.appendChild(gi);
          const np = document.createElement("p"); np.className = "muted small"; np.textContent = "Cinta cosida continua en las 4 aristas del cobertor. Sin tramos: o va, o no va (elimínala con la ✕).";
          card.appendChild(np);
        } else {
        selBox("Modo", "modo", [["arista", "Pegada a una arista"], ["patron", "Patrón de cintas paralelas"]],
          "«Pegada a una arista»: corre paralela a un borde. «Patrón»: varias cintas paralelas que cruzan el paño, con espaciado fijo o repartidas uniformemente entre dos aristas.", "CINTA-MODO", pintar);
        if (c.modo === "patron") {
          selBox("Orientación", "orient", [["vertical", "Verticales (↕, se reparten ↔)"], ["horizontal", "Horizontales (↔, se reparten ↕)"]],
            "Verticales: cada cinta corre de la arista superior a la inferior y se reparten de izquierda a derecha. Horizontales: al revés.", "CINTA-ORIENT");
          selBox("Distribución", "distMode", [["fijo", "Espaciado fijo"], ["entre", "Uniforme entre dos aristas"]],
            "Espaciado fijo: N cintas separadas por la misma distancia desde la 1ª. Uniforme entre aristas: N cintas repartidas parejo entre la posición de la 1ª y el margen final.", "CINTA-DIST", pintar);
          const grid = document.createElement("div"); grid.className = "pieza-grid";
          grid.appendChild(addHelpTo(numField("Cantidad (N)", "nPat", "3"), "Número de cintas paralelas del patrón.", "CINTA-N"));
          grid.appendChild(addHelpTo(numField("Posición 1ª (m)", "pos1", "0.5"), "Distancia de la primera cinta a la arista de referencia (izquierda si son verticales, superior si horizontales).", "CINTA-POS1"));
          if (c.distMode === "entre") grid.appendChild(addHelpTo(numField("Margen final (m)", "posFin", "(=1ª)"), "Distancia de la última cinta a la arista opuesta. Vacío = mismo margen que la primera.", "CINTA-POSFIN"));
          else grid.appendChild(addHelpTo(numField("Espaciado (m)", "esp", "0.5"), "Distancia fija entre cintas consecutivas.", "CINTA-ESP"));
          grid.appendChild(addHelpTo(numField("Offset extremos (m)", "extremos", "0"), "Cuánto se retrae cada cinta de los dos bordes perpendiculares (para que no lleguen al borde). 0 = de lado a lado.", "CINTA-EXT"));
          card.appendChild(grid);
        } else {
          const le = document.createElement("label"); le.className = "field"; le.innerHTML = "<span>Arista</span>";
          const selE = document.createElement("select");
          [["sup", "Superior"], ["inf", "Inferior"], ["izq", "Izquierda"], ["der", "Derecha"]].forEach(([v, t]) => { const o = document.createElement("option"); o.value = v; o.textContent = t; selE.appendChild(o); });
          selE.value = c.arista || "sup"; selE.addEventListener("change", (e) => { c.arista = e.target.value; refresh(); onChange(); });
          le.appendChild(selE); addHelpTo(le, "Arista del paño por la que corre la cinta (paralela). El recorrido = el largo de esa arista, salvo que lo acotes con Desde/Hasta.", "CINTA-EDGE"); card.appendChild(le);
          const grid = document.createElement("div"); grid.className = "pieza-grid";
          grid.appendChild(addHelpTo(numField("Offset (m)", "offset", "0.02"), "Separación de la cinta respecto de la arista, hacia adentro del paño. 0 = pegada al borde.", "CINTA-OFFSET"));
          grid.appendChild(addHelpTo(numField("Desde (m)", "desde", "0"), "Inicio del recorrido medido sobre la arista desde su origen. 0 = desde el comienzo. Es también el punto de anclaje del pivote.", "CINTA-DESDE"));
          grid.appendChild(addHelpTo(numField("Hasta (m)", "hasta", "(fin)"), "Fin del recorrido sobre la arista. Vacío = hasta el final de la arista.", "CINTA-HASTA"));
          card.appendChild(grid);
          const lp = document.createElement("label"); lp.className = "chk"; const pc = document.createElement("input"); pc.type = "checkbox"; pc.checked = !!c.pivote;
          pc.addEventListener("change", (e) => { c.pivote = e.target.checked; pintar(); onChange(); });
          lp.appendChild(pc); lp.appendChild(document.createTextNode(" Pivote (dirigir en ángulo)")); card.appendChild(lp);
          if (c.pivote) { const ga = document.createElement("div"); ga.className = "pieza-grid"; ga.appendChild(addHelpTo(numField("Ángulo (°)", "angulo", "0"), "Gira la cinta alrededor del punto de anclaje (Desde) respecto de la arista. 0 = paralela.", "CINTA-ANG")); card.appendChild(ga); }
        }
        const led = document.createElement("label"); led.className = "field full"; led.innerHTML = "<span>Edición (tramos)</span>";
        const ied = document.createElement("input"); ied.type = "text"; ied.value = c.edicion || ""; ied.placeholder = "ej. 2-4Ø0.05, 5.5!7, 7x9";
        ied.addEventListener("input", (e) => { c.edicion = e.target.value; refresh(); onChange(); });
        led.appendChild(ied); addHelpTo(led, CINTA_GLOBO, "CINTA-EDICION"); card.appendChild(led);
        const lz = document.createElement("label"); lz.className = "field full"; lz.innerHTML = "<span>Zoom detalle (secciones a ampliar)</span>";
        const iz = document.createElement("input"); iz.type = "text"; iz.value = c.zoomDetalle || ""; iz.placeholder = "ej. 0.51-1, 9.9-9.95";
        iz.addEventListener("input", (e) => { c.zoomDetalle = e.target.value; refresh(); onChange(); });
        lz.appendChild(iz); addHelpTo(lz, "Rangos «desde-hasta» separados por coma (sobre el recorrido de la cinta). Cada rango genera una barra de detalle AMPLIADA numerada, debajo del detalle general, para que el taller vea el tramo en grande. Ej.: 0.51-1, 9.9-9.95.", "CINTA-ZOOM"); card.appendChild(lz);
        }
        const ayuda = document.createElement("p"); ayuda.className = "muted small"; card.appendChild(ayuda);
        const ln = document.createElement("label"); ln.className = "field full"; ln.innerHTML = "<span>Nombre / leyenda (plano)</span>";
        const ni = document.createElement("input"); ni.type = "text"; ni.value = c.legend || ""; ni.placeholder = "ej. Cinta superior";
        ni.addEventListener("input", (e) => { c.legend = e.target.value; refresh(); onChange(); });
        ln.appendChild(ni); card.appendChild(ln);
        const dims = document.createElement("div"); dims.className = "muted small ins-dims"; card.appendChild(dims);
        function refresh() {
          const ctx = { ancho: A, largo: L }, m = strapMat(c), ancho = anchoCintaM(m);
          if (!(A > 0) || !(L > 0)) { ayuda.textContent = "Define largo y ancho del paño base para ubicar la cinta."; }
          else if (c.modo === "perimetro") {
            ayuda.innerHTML = "Perímetro del cobertor: <b>" + f(2 * (A + L)) + " m</b> (paño " + f(L) + " × " + f(A) + " m). Cinta cosida continua en las 4 aristas.";
          }
          else if (c.modo === "patron") {
            const vertical = (c.orient || "vertical") === "vertical", D = vertical ? A : L, Lrun = vertical ? L : A;
            ayuda.innerHTML = "Paño base <b>" + f(L) + " × " + f(A) + " m</b>. Patrón " + (vertical ? "vertical" : "horizontal") + ": se reparten a lo largo de <b>" + f(D) + " m</b> y cada cinta corre <b>" + f(Lrun) + " m</b> (menos offset de extremos). Los tramos se miden sobre ese recorrido.";
          } else {
            const e = strapAristaEdge(c.arista || "sup", ctx), nm = { sup: "superior", inf: "inferior", izq: "izquierda", der: "derecha" }[c.arista || "sup"], Lc = cintaLc(c, ctx);
            ayuda.innerHTML = "Arista " + nm + ": <b>" + f(e ? e.len : 0) + " m</b> · paño base <b>" + f(L) + " × " + f(A) + " m</b>. Recorrido de la cinta: <b>" + f(Lc) + " m</b> (los tramos se miden en 0…" + f(Lc) + ").";
          }
          if (!m) { dims.textContent = "Elige el material para ver el ancho de la cinta."; return; }
          const runs = cintaRuns(c, ctx);
          const mat = runs.reduce((s, r) => s + (r.seg.mMaterial || 0), 0), cos = runs.reduce((s, r) => s + (r.seg.mCostura || 0), 0);
          const nOpen = runs.reduce((s, r) => s + (r.seg.opens || []).length, 0), nGap = runs.reduce((s, r) => s + (r.seg.gaps || []).length, 0), mSaf = runs.reduce((s, r) => s + (r.seg.mSafety || 0), 0);
          let html = "Ancho cinta <b>" + (ancho > 0 ? f(ancho * 100) + " cm" : "?") + "</b>" + (runs.length > 1 ? " · <b>" + runs.length + "</b> cintas" : "") + " · material <b>" + f(mat) + " m</b> · costura <b>" + f(cos) + " m</b>";
          if (mSaf > 0) html += " (seguridad " + f(mSaf) + " m)";
          if (nOpen) html += " · " + nOpen + " bolsillo(s)";
          if (nGap) html += " · " + nGap + " hueco(s)";
          dims.innerHTML = html;
        }
        refresh();
        ocultarFichaCtl(card, c, pintar, onChange);
        fichaColapsable(card, head, tt, c);
        rows.appendChild(card);
      });
      navFichas(rows, (ctx.cintas || []).map((c, i) => ({ titulo: "Cinta " + (i + 1), nombre: c.legend || "", oculto: !!c._oculto })));
    }
    pintar();
    const actions = document.createElement("div"); actions.className = "pz-actions"; actions.style.flexWrap = "wrap";
    const add = document.createElement("button"); add.type = "button"; add.className = "btn-outline"; add.textContent = "+ Cinta / cierre";
    add.addEventListener("click", () => { ctx.cintas.push(nuevaCinta()); pintar(); onChange(); });
    const perim = document.createElement("button"); perim.type = "button"; perim.className = "btn-outline cinta-perim-btn"; perim.textContent = "↻ Cinta cosida en TODO el perímetro (4 aristas)";
    perim.title = "Instala de una vez una cinta cosida continua en las 4 aristas del cobertor";
    perim.addEventListener("click", () => { ctx.cintas.push(nuevaCinta({ modo: "perimetro", legend: "" })); pintar(); onChange(); });
    actions.appendChild(add); actions.appendChild(perim); container.appendChild(actions);
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
        const selField = (lab, opts, key, full, cb) => {
          const l = document.createElement("label"); l.className = full ? "field full" : "field"; l.innerHTML = "<span>" + lab + "</span>";
          const s = document.createElement("select"); opts.forEach(([v, t]) => { const o = document.createElement("option"); o.value = v; o.textContent = t; s.appendChild(o); });
          s.value = a[key]; s.addEventListener("change", (e) => { a[key] = e.target.value; if (cb) cb(); refresh(); onChange(); });
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
        const selT = document.createElement("select"); state.telas.forEach((t) => { const o = document.createElement("option"); o.value = t.nombre; o.textContent = t.nombre; selT.appendChild(o); }); // el nombre ya incluye Proveedor · Modelo · Formato
        selT.value = a.telaNombre || (ctx.telaBase && ctx.telaBase()) || ((state.telas[0] && state.telas[0].nombre) || ""); a.telaNombre = selT.value;
        selT.addEventListener("change", (e) => { a.telaNombre = e.target.value; refresh(); onChange(); });
        lt.appendChild(selT); card.appendChild(addHelpTo(lt, "Tela del anexo. Por defecto es la del paño base; puedes cambiarla. En cotización multi-tela, si mantienes la del paño base, el anexo sigue a cada tela; si eliges otra distinta, se conserva fija en todas las variantes.", "ALETA-TELA"));
        const grid = document.createElement("div"); grid.className = "pieza-grid";
        grid.appendChild(addHelpTo(selField("Cuelga del borde", [["inf", "Inferior"], ["sup", "Superior"], ["izq", "Izquierda"], ["der", "Derecha"]], "baseEdge", false, () => pintarOjArista()), "Borde del paño base del que se fusiona y cuelga el anexo (desde ahí se extiende hacia afuera).", "ALETA-BORDE-BASE"));
        grid.appendChild(addHelpTo(numField("Distancia al borde (m, ≥ unión)", "dBorde"), "A qué distancia del borde elegido se cose el anexo. Debe ser ≥ la unión (típico 0,045 m).", "ALETA-DIST"));
        grid.appendChild(addHelpTo(numField("Largo / caída (m)", "largo"), "Cuánto cae o sobresale el anexo desde su línea de fusión, en metros.", "ALETA-CAIDA"));
        grid.appendChild(addHelpTo(numField("Ancho (m)", "ancho"), "Ancho del anexo a lo largo del borde, en metros.", "ALETA-ANCHO"));
        grid.appendChild(addHelpTo(numField("Offset (m)", "offset"), "Desplazamiento del anexo a lo largo del borde, medido desde la esquina, en metros (0 = pegado a la esquina).", "ALETA-OFFSET"));
        grid.appendChild(addHelpTo(numField("Borde perimetral (m)", "bordeValor"), "Dobladillo de los bordes libres del anexo, en metros.", "ALETA-DOBLADILLO"));
        grid.appendChild(addHelpTo(numField("Ojetillos (hem libre)", "ojetillos"), "Cuántos ojetillos repartir en el borde libre del anexo. Se ignora si activas \"ojetillos por arista\".", "ALETA-OJET"));
        card.appendChild(grid);
        // "+ opciones": ojetillos por arista del anexo (3 aristas libres, sin el punto de unión).
        const ojWrap = document.createElement("div"); card.appendChild(ojWrap);
        function pintarOjArista() {
          ojWrap.innerHTML = "";
          const arista = a.ojMode === "arista";
          const btn = document.createElement("button"); btn.type = "button"; btn.className = "btn-outline small aleta-oj-toggle";
          btn.textContent = arista ? "▾ Ojetillos por arista (activo)" : "+ opciones: ojetillos por arista";
          btn.addEventListener("click", () => { a.ojMode = arista ? "simple" : "arista"; if (a.ojMode === "arista" && !a.ojEdges) a.ojEdges = aletaOjEdgesDefault(); pintarOjArista(); refresh(); onChange(); });
          ojWrap.appendChild(btn);
          if (!arista) return;
          if (!a.ojEdges) a.ojEdges = aletaOjEdgesDefault();
          const panel = document.createElement("div"); panel.className = "aleta-oj-panel";
          const cap = document.createElement("p"); cap.className = "muted small"; cap.textContent = "Ojetillos por las aristas libres del anexo (no en la unión con el paño). Mientras esté activo, se ignora el campo \"hem libre\".";
          panel.appendChild(cap);
          const fused = ALETA_FUSED[a.baseEdge || "inf"];
          ["t", "b", "l", "r"].filter((k) => k !== fused).forEach((k) => {
            const e = a.ojEdges[k] || (a.ojEdges[k] = defAletaEdge());
            const row = document.createElement("div"); row.className = "aleta-oj-row";
            const lab = document.createElement("label"); lab.className = "chk aleta-oj-on";
            const cb = document.createElement("input"); cb.type = "checkbox"; cb.checked = e.on !== false;
            cb.addEventListener("change", () => { e.on = cb.checked; refresh(); onChange(); });
            const sp = document.createElement("span"); sp.textContent = ALETA_EDGE_NOM[k];
            lab.appendChild(cb); lab.appendChild(sp); row.appendChild(lab);
            const dl = document.createElement("label"); dl.className = "field aleta-oj-f"; dl.innerHTML = "<span>cada (m)</span>";
            const di = document.createElement("input"); di.type = "text"; di.inputMode = "decimal"; di.value = e.d != null ? e.d : "0.2";
            di.addEventListener("input", () => { e.d = di.value; refresh(); onChange(); });
            dl.appendChild(di); row.appendChild(dl);
            const sl = document.createElement("label"); sl.className = "field aleta-oj-f"; sl.innerHTML = "<span>suprimir</span>";
            const si = document.createElement("input"); si.type = "text"; si.value = e.supr || ""; si.placeholder = "ej. 0, 2-4";
            si.addEventListener("input", () => { e.supr = si.value; refresh(); onChange(); });
            sl.appendChild(si); row.appendChild(addHelpTo(sl, "Quita ojetillos por su número de orden en la arista (0 desde la esquina). Acepta sueltos y rangos con guión inclusivos, ej. \"0, 2-4\".", "ALETA-OJ-SUPR"));
            panel.appendChild(row);
          });
          const pl = document.createElement("label"); pl.className = "chk aleta-oj-parejo";
          const pcb = document.createElement("input"); pcb.type = "checkbox"; pcb.checked = !!a.ojParejo;
          pcb.addEventListener("change", () => { a.ojParejo = pcb.checked; refresh(); onChange(); });
          const psp = document.createElement("span"); psp.textContent = "Reparto parejo (espaciado uniforme)";
          pl.appendChild(pcb); pl.appendChild(psp); panel.appendChild(pl);
          ojWrap.appendChild(panel);
        }
        pintarOjArista();
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
        subnavFicha(card, head, [
          { label: "Datos", el: card.querySelector(".field") },
          { label: "Dimensiones", el: grid },
          { label: "Ojetillos", el: ojWrap },
          { label: "Materiales", el: mcap },
        ]);
        ocultarFichaCtl(card, a, pintar, onChange);
        rotuloFichaCtl(card, a, onChange);
        fichaColapsable(card, head, tt, a); // cada Anexo es plegable
        rows.appendChild(card);
      });
      navFichas(rows, (ctx.aletas || []).map((a, i) => ({ titulo: "Anexo " + (i + 1), nombre: a.legend || "", oculto: !!a._oculto })));
    }
    pintar();
    // No se puede diseñar anexos antes de definir el paño base (tela + largo + ancho).
    const baseOK = !ctx.baseListo || ctx.baseListo();
    const add = document.createElement("button"); add.type = "button"; add.className = "btn-outline"; add.textContent = "+ Aleta / solapa / faldón / cenefa";
    add.disabled = state.telas.length === 0 || !baseOK;
    add.addEventListener("click", () => {
      const a = nuevaAleta();
      const tb = ctx.telaBase && ctx.telaBase(); if (tb) a.telaNombre = tb; // por defecto: la tela del paño base
      ctx.aletas.push(a); pintar(); onChange();
    });
    container.appendChild(add);
    if (!baseOK) { const h = document.createElement("p"); h.className = "muted small"; h.textContent = "Define primero el paño base (tela, largo y ancho) para diseñar anexos."; container.appendChild(h); }
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
    return visibles(pz.inscritos).reduce((s, ins) => { const r = calcInscrito(pz, ins); return s + (r && r.o ? r.o.subtotalLote : 0); }, 0);
  }
  function inscritosLineasPDF(pz) {
    return visibles(pz.inscritos).map((ins) => {
      const r = calcInscrito(pz, ins); if (!r || !r.o) return null;
      const dim = ins.forma === "circ" ? `circular Ø${r.winAncho} m` : `${r.winLargo}×${r.winAncho} m`;
      const nom = (ins.legend && ins.legend.trim()) ? ins.legend.trim() : "Paño inscrito";
      return `${nom} en ${telaCli(r.tela)} ${dim} — ${money(r.o.subtotalLote / r.N)}/u`;
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
        const selT = document.createElement("select"); state.telas.forEach((t) => { const o = document.createElement("option"); o.value = t.nombre; o.textContent = t.nombre; selT.appendChild(o); }); // el nombre ya incluye Proveedor · Modelo · Formato
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
        ocultarFichaCtl(card, ins, pintar, onChange);
        rotuloFichaCtl(card, ins, onChange);
        fichaColapsable(card, head, tt, ins); // cada ventana/paño inscrito es plegable
        rows.appendChild(card);
      });
      navFichas(rows, (pz.inscritos || []).map((ins, i) => ({ titulo: "Paño " + (i + 1), nombre: ins.legend || "", oculto: !!ins._oculto })));
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
      legend: base ? (base.legend || "") : "",
      tipo: base ? (base.tipo || "corte") : "corte", fade: base ? (base.fade || "") : "", fadeKill: base ? !!base.fadeKill : false,
      ojAristaLado: base ? (base.ojAristaLado || "") : "", ojAristaD: base ? (base.ojAristaD || "0.2") : "0.2", ojAristaInset: base ? (base.ojAristaInset || "0.025") : "0.025", ojAristaSupr: base ? (base.ojAristaSupr || "") : "",
      strapMatId: base ? (base.strapMatId != null ? base.strapMatId : null) : null, strapLado: base ? (base.strapLado || "A") : "A", strapD: base ? (base.strapD || "0.3") : "0.3", strapOffset: base ? (base.strapOffset || "0.1") : "0.1", strapInset: base ? (base.strapInset || "0.1") : "0.1", strapSupr: base ? (base.strapSupr || "") : "", strapNombre: base ? (base.strapNombre || "") : "",
      secEsq: base ? (base.secEsq || "") : "", secArista: base ? (base.secArista || "") : "", secDist: base ? (base.secDist || "") : "",
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
    if (c.tipo === "corte" || c.tipo === "guia") { // línea: centra a lo ancho según su largo; al medio en vertical
      const Ln = ev(c.largo);
      if (baseA != null && Ln != null) { const m = String(Math.max(0, Math.round((baseA - Ln) / 2 * 1000) / 1000)); c.padIzq = m; c.padDer = m; }
      if (baseL != null) { const m = String(Math.round(baseL / 2 * 1000) / 1000); c.padSup = m; c.padInf = m; }
      return;
    }
    const cL = ev(c.largo), cA = ev(c.ancho);
    // El círculo (corte) puede exceder el paño: se permite padding negativo para mantener el centro.
    const clamp = (c.forma === "circ") ? (n) => n : (n) => Math.max(0, n);
    if (baseL != null && cL != null) { const m = String(clamp(Math.round((baseL - cL) / 2 * 1000) / 1000)); c.padSup = m; c.padInf = m; }
    if (baseA != null && cA != null) { const m = String(clamp(Math.round((baseA - cA) / 2 * 1000) / 1000)); c.padIzq = m; c.padDer = m; }
  }
  // Configurador "Sección de paño": corte desde una esquina hasta la arista opuesta, cuyo otro
  // extremo queda a 'secDist' del borde de referencia. Escribe x/y(largo de inicio), largo y ángulo.
  const SEC_OPUESTAS = { TL: ["inf", "der"], TR: ["inf", "izq"], BL: ["sup", "der"], BR: ["sup", "izq"] };
  function aplicarSeccion(c, A, L) {
    const f = window.CalcCIBSA.fmtNum, ev = window.CalcCIBSA.evalExpr;
    if (!(A > 0) || !(L > 0) || !c.secEsq) return;
    const corner = { TL: [0, 0], TR: [A, 0], BL: [0, L], BR: [A, L] }[c.secEsq]; if (!corner) return;
    const D = ev(c.secDist); if (D == null || isNaN(D)) return;
    const edge = c.secArista || SEC_OPUESTAS[c.secEsq][0];
    let ex, ey;
    if (edge === "sup") { ex = D; ey = 0; } else if (edge === "inf") { ex = D; ey = L; }
    else if (edge === "izq") { ex = 0; ey = D; } else { ex = A; ey = D; }
    const cx = corner[0], cy = corner[1], len = Math.hypot(ex - cx, ey - cy);
    if (!(len > 0)) return;
    c.padIzq = f(cx); c.padSup = f(cy); c.largo = f(len); c.angulo = f(Math.atan2(ey - cy, ex - cx) * 180 / Math.PI); c.pivX = "0";
  }
  function rectCorte(c) {
    const ev = window.CalcCIBSA.evalExpr;
    const num01 = (v, d) => { const r = window.CalcCIBSA.evalExpr(v); return (r == null || isNaN(r)) ? d : Math.max(0, Math.min(1, r)); };
    if (c.tipo === "corte" || c.tipo === "guia") { // línea recta: largo = longitud de la línea (horizontal), x/y = inicio
      const esGuia = c.tipo === "guia";            // guía = línea de construcción: NO secciona el paño
      const Ln = ev(c.largo); if (Ln == null || Ln <= 0) return null;
      const x = ev(c.padIzq), y = ev(c.padSup);
      return { tipo: c.tipo, guia: esGuia, x: (x == null || isNaN(x)) ? 0 : x, y: (y == null || isNaN(y)) ? 0 : y, w: Ln, h: 0, circ: false, ojCirc: 0, oj: { sup: 0, inf: 0, izq: 0, der: 0 }, lados: {}, angulo: ev(c.angulo) || 0, pivX: num01(c.pivX, 0), pivY: 0, fade: esGuia ? "" : (c.fade || ""), fadeKill: !esGuia && !!c.fadeKill, ojAristaLado: c.ojAristaLado || "", ojAristaD: ev(c.ojAristaD) || 0, ojAristaInset: ev(c.ojAristaInset) || 0, ojAristaSupr: parseSupr(c.ojAristaSupr), strapAncho: anchoCintaM((c.strapMatId != null && state.materiales[c.strapMatId]) || null), strapPrecioM: ((c.strapMatId != null && state.materiales[c.strapMatId] && state.materiales[c.strapMatId].precio) || 0), strapLado: c.strapLado || "A", strapD: ev(c.strapD) || 0, strapOffset: ev(c.strapOffset) || 0, strapInset: ev(c.strapInset) || 0, strapSupr: parseSupr(c.strapSupr), strapNombre: (c.strapNombre || "").trim() };
    }
    const w = ev(c.ancho), h = ev(c.largo); if (w == null || h == null || w <= 0 || h <= 0) return null;
    const x = ev(c.padIzq), y = ev(c.padSup);
    const L = c.lados || {};
    return {
      x: (x == null || isNaN(x)) ? 0 : x, y: (y == null || isNaN(y)) ? 0 : y, w: w, h: h,
      circ: c.forma === "circ", ojCirc: ojIntPz(c.ojCirc),
      oj: { sup: ojIntPz(c.oj.sup), inf: ojIntPz(c.oj.inf), izq: ojIntPz(c.oj.izq), der: ojIntPz(c.oj.der) },
      lados: { sup: L.sup !== false, inf: L.inf !== false, izq: L.izq !== false, der: L.der !== false },
      angulo: window.CalcCIBSA.evalExpr(c.angulo) || 0, pivX: num01(c.pivX, 0.5), pivY: num01(c.pivY, 0.5),
    };
  }
  function cortesSpec(list) { return visibles(list).map(rectCorte).filter(Boolean); }
  // ¿Hay algún corte/guía con ojetillos en su arista (del lado que QUEDA)? Para mostrar el chip "NumOj."
  // aunque los ojetillos base estén en modo "total".
  function hayOjEnCortes(list) {
    return (list || []).some((c) => c && (c.tipo === "corte" || c.tipo === "guia") &&
      (c.ojAristaLado === "A" || c.ojAristaLado === "B") && c.ojAristaLado !== c.fade &&
      (window.CalcCIBSA.evalExpr(c.ojAristaD) || 0) > 0);
  }
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
    cab.textContent = "Cortes / calados / guías (costo $0, solo diseño) — por defecto centrados:";
    container.appendChild(cab);
    const rows = document.createElement("div"); container.appendChild(rows);
    const opuesto = { padSup: "padInf", padInf: "padSup", padIzq: "padDer", padDer: "padIzq" };
    function pintar() {
      rows.innerHTML = "";
      (ctx.cortes || []).forEach((c, idx) => {
        const card = document.createElement("div"); card.className = "ins-card cut-card";
        const padInputs = {};
        const setPad = () => { ["padSup", "padInf", "padIzq", "padDer"].forEach((k) => { if (padInputs[k]) padInputs[k].value = c[k]; }); };
        // Tipo del ítem: calado (área), corte (línea que secciona) o guía (línea de construcción que NO secciona).
        const esCorte = (c.tipo === "corte");
        const esGuia = (c.tipo === "guia");
        const esLinea = esCorte || esGuia;            // ambas son una sola línea recta posicionable
        const esCirc = !esLinea && (c.forma || "rect") === "circ";
        const headBase = (esGuia ? "┄ Guía Nº" : "✂ Corte/calado Nº") + (idx + 1);
        const head = document.createElement("div"); head.className = "ins-head";
        const tt = document.createElement("span"); tt.className = "muted small"; tt.textContent = headBase + ((c.legend && c.legend.trim()) ? " — " + c.legend.trim() : "");
        const del = document.createElement("button"); del.type = "button"; del.className = "pz-btn del"; del.textContent = "✕";
        del.addEventListener("click", () => { ctx.cortes.splice(idx, 1); pintar(); onChange(); });
        head.appendChild(tt); head.appendChild(del); card.appendChild(head);
        // Nombre / referencia (para identificar el corte en la navegación y el título)
        const nmL = document.createElement("label"); nmL.className = "field full"; nmL.innerHTML = "<span>Nombre / referencia</span>";
        const nmI = document.createElement("input"); nmI.type = "text"; nmI.value = c.legend || ""; nmI.placeholder = "ej. puerta, costado derecho";
        nmI.addEventListener("input", (e) => { c.legend = e.target.value; tt.textContent = headBase + (e.target.value.trim() ? " — " + e.target.value.trim() : ""); onChange(); });
        nmL.appendChild(nmI); card.appendChild(nmL);
        // Tipo: calado (área) o corte (línea recta)
        const tsel = document.createElement("label"); tsel.className = "field full"; tsel.innerHTML = "<span>Tipo</span>";
        const topt = document.createElement("select");
        [["calado", "Calado (área)"], ["corte", "Corte (línea recta)"], ["guia", "Guía (construcción)"]].forEach(([v, t]) => { const o = document.createElement("option"); o.value = v; o.textContent = t; topt.appendChild(o); });
        topt.value = c.tipo || "corte"; topt.addEventListener("change", (e) => { c.tipo = e.target.value; pintar(); onChange(); });
        tsel.appendChild(topt); card.appendChild(addHelpTo(tsel, "Calado: hueco con área (rectángulo o círculo). Corte: línea recta que SECCIONA el paño. Guía: línea de construcción que NO corta — solo sirve de referencia para ubicar ojetillos, straps y cortes (mismos parámetros de posición que el corte).", "CORTE-TIPO"));
        if (!esLinea) {
          const fsel = document.createElement("label"); fsel.className = "field full"; fsel.innerHTML = "<span>Forma</span>";
          const fopt = document.createElement("select");
          [["rect", "Rectángulo"], ["circ", "Círculo"]].forEach(([v, t]) => { const o = document.createElement("option"); o.value = v; o.textContent = t; fopt.appendChild(o); });
          fopt.value = c.forma || "rect"; fopt.addEventListener("change", (e) => { c.forma = e.target.value; if (c.forma === "circ") c.ancho = c.largo; centrarCorte(ctx.baseLargo(), ctx.baseAncho(), c); pintar(); onChange(); });
          fsel.appendChild(fopt); card.appendChild(fsel);
        }
        const grid = document.createElement("div"); grid.className = "pieza-grid";
        if (esLinea) {
          const l = document.createElement("label"); l.className = "field full"; l.innerHTML = "<span>" + (esGuia ? "Largo de la guía (m)" : "Largo del corte (m)") + "</span>";
          const inp = document.createElement("input"); inp.type = "text"; inp.inputMode = "decimal"; inp.value = c.largo || "";
          inp.addEventListener("input", (e) => { c.largo = e.target.value; refresh(); onChange(); });
          inp.addEventListener("blur", (e) => { const rr = window.CalcCIBSA.evalExpr(e.target.value); if (rr != null && !isNaN(rr)) { c.largo = window.CalcCIBSA.fmtNum(rr); e.target.value = c.largo; refresh(); onChange(); } });
          l.appendChild(inp); agregarCalc(inp); addHelpTo(l, "Longitud de la línea (en metros). Se dibuja horizontal desde la posición X/Y y se inclina con el ángulo.", "CORTE-LINEA-LARGO");
          { const bL = ctx.baseLargo(), bA = ctx.baseAncho(), fN = window.CalcCIBSA.fmtNum;
            const note = document.createElement("span"); note.className = "muted small"; note.style.display = "block"; note.style.marginTop = "2px";
            note.textContent = (bL > 0 && bA > 0) ? ("Paño base: " + fN(bL) + " × " + fN(bA) + " m (largo × ancho).") : "Define el largo y ancho del paño base para ver su medida.";
            l.appendChild(note); }
          grid.appendChild(l);
        } else if (esCirc) {
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
        if (esLinea) {
          // Configurador "Sección de paño": define el corte desde una esquina hacia una arista opuesta.
          {
            const A = ctx.baseAncho(), L = ctx.baseLargo();
            const secWrap = document.createElement("div");
            const grpC = document.createElement("label"); grpC.className = "field full"; grpC.innerHTML = "<span>Sección de paño — esquina de inicio</span>";
            const cSel = document.createElement("select");
            [["", "— manual (no usar) —"], ["TL", "↖ Sup-Izq"], ["TR", "↗ Sup-Der"], ["BL", "↙ Inf-Izq"], ["BR", "↘ Inf-Der"]].forEach(([v, t]) => { const o = document.createElement("option"); o.value = v; o.textContent = t; cSel.appendChild(o); });
            cSel.value = c.secEsq || "";
            cSel.addEventListener("change", (e) => { c.secEsq = e.target.value; if (c.secEsq && !c.secArista) c.secArista = SEC_OPUESTAS[c.secEsq][0]; aplicarSeccion(c, A, L); pintar(); onChange(); });
            grpC.appendChild(cSel); secWrap.appendChild(addHelpTo(grpC, "Configura un corte que secciona el paño desde una esquina hasta la arista opuesta. Define largo, ángulo y posición automáticamente. Deja 'manual' para configurarlo a mano.", "CORTE-SECCION"));
            if (c.secEsq) {
              const opp = SEC_OPUESTAS[c.secEsq], NOM = { sup: "Superior", inf: "Inferior", izq: "Izquierda", der: "Derecha" };
              const g = document.createElement("div"); g.className = "pieza-grid";
              const eSel = document.createElement("label"); eSel.className = "field"; eSel.innerHTML = "<span>Termina en arista</span>";
              const es = document.createElement("select");
              opp.forEach((k) => { const o = document.createElement("option"); o.value = k; o.textContent = NOM[k]; es.appendChild(o); });
              es.value = c.secArista || opp[0];
              es.addEventListener("change", (e) => { c.secArista = e.target.value; aplicarSeccion(c, A, L); pintar(); onChange(); });
              eSel.appendChild(es); g.appendChild(eSel);
              const horiz = (c.secArista === "sup" || c.secArista === "inf");
              const dl = document.createElement("label"); dl.className = "field"; dl.innerHTML = "<span>" + (horiz ? "Distancia desde borde izquierdo (m)" : "Distancia desde borde superior (m)") + "</span>";
              const di = document.createElement("input"); di.type = "text"; di.inputMode = "decimal"; di.value = c.secDist || "";
              di.addEventListener("input", (e) => { c.secDist = e.target.value; aplicarSeccion(c, A, L); refresh(); onChange(); });
              di.addEventListener("blur", (e) => { const r = window.CalcCIBSA.evalExpr(e.target.value); if (r != null && !isNaN(r)) { c.secDist = window.CalcCIBSA.fmtNum(r); e.target.value = c.secDist; aplicarSeccion(c, A, L); refresh(); onChange(); } });
              dl.appendChild(di); agregarCalc(di); g.appendChild(dl);
              secWrap.appendChild(g);
              const note = document.createElement("p"); note.className = "muted small"; note.textContent = "El corte va desde la esquina hasta esa arista; su otro extremo queda a esa distancia del borde de referencia.";
              secWrap.appendChild(note);
            }
            card.appendChild(secWrap);
            subColapsar(secWrap, "Sección de paño (desde esquina)", c, "_colapSec", () => !!c.secEsq);
          }
          // Difuminar el lado que se separa (opción b): se nombra por cardinalidad según el ángulo.
          const aa = (window.CalcCIBSA.evalExpr(c.angulo) || 0) * Math.PI / 180;
          const pnx = -Math.sin(aa), pny = Math.cos(aa);
          const cardi = (nx, ny) => (Math.abs(nx) >= Math.abs(ny)) ? (nx >= 0 ? "Este (der.)" : "Oeste (izq.)") : (ny >= 0 ? "Sur (abajo)" : "Norte (arriba)");
          if (esCorte) {   // La guía NO secciona el paño: no tiene "difuminar".
            const fsel = document.createElement("label"); fsel.className = "field full"; fsel.innerHTML = "<span>Difuminar parte separada</span>";
            const fopt = document.createElement("select");
            [["", "No difuminar"], ["A", "Lado A — " + cardi(pnx, pny)], ["B", "Lado B — " + cardi(-pnx, -pny)]].forEach(([v, t]) => { const o = document.createElement("option"); o.value = v; o.textContent = t; fopt.appendChild(o); });
            fopt.value = c.fade || ""; fopt.addEventListener("change", (e) => { c.fade = e.target.value; pintar(); onChange(); });
            fsel.appendChild(fopt); card.appendChild(addHelpTo(fsel, "Si el corte separa el paño, difumina la parte que se va (la del lado elegido). El rectángulo base se mantiene. El lado se nombra por su orientación (cardinalidad), según el ángulo del corte.", "CORTE-FADE"));
            if (c.fade === "A" || c.fade === "B") {
              const kwrap = document.createElement("div"); kwrap.className = "radios";
              const kl = document.createElement("label");
              const kb = document.createElement("input"); kb.type = "checkbox"; kb.checked = !!c.fadeKill;
              kb.addEventListener("change", (e) => { c.fadeKill = e.target.checked; refresh(); onChange(); });
              kl.appendChild(kb); kl.appendChild(document.createTextNode(" Eliminar la parte separada (en vez de solo difuminarla)"));
              kwrap.appendChild(kl); card.appendChild(addHelpTo(kwrap, "Si está marcado, la parte que se separa se QUITA del plano (queda en blanco), en vez de solo atenuarse. El rectángulo base y el precio no cambian.", "CORTE-FADE-KILL"));
            }
          }
          // Ojetillos sobre la arista del corte. Si el corte difumina/elimina un lado (c.fade), ese lado se
          // SEPARA del paño: no tiene sentido poner ojetillos ahí. Solo se ofrece el lado que QUEDA.
          const ladoFuera = (c.fade === "A" || c.fade === "B") ? c.fade : null;
          if (ladoFuera && c.ojAristaLado === ladoFuera) c.ojAristaLado = ""; // selección inválida → limpiar
          const osel = document.createElement("label"); osel.className = "field full"; osel.innerHTML = "<span>Ojetillos en la arista</span>";
          const oopt = document.createElement("select");
          [["", "Ninguno"], ["A", "Lado A — " + cardi(pnx, pny)], ["B", "Lado B — " + cardi(-pnx, -pny)]]
            .filter(([v]) => v !== ladoFuera)
            .forEach(([v, t]) => { const o = document.createElement("option"); o.value = v; o.textContent = t; oopt.appendChild(o); });
          oopt.value = c.ojAristaLado || ""; oopt.addEventListener("change", (e) => { c.ojAristaLado = e.target.value; pintar(); onChange(); });
          osel.appendChild(oopt); card.appendChild(addHelpTo(osel, "Coloca ojetillos a lo largo de la arista del corte, del lado que QUEDA. Si el corte difumina/elimina un lado, ese lado no se ofrece (se separa del paño). Configura distanciamiento e inset.", "CORTE-OJ-ARISTA"));
          if (c.ojAristaLado === "A" || c.ojAristaLado === "B") {
            const og = document.createElement("div"); og.className = "pieza-grid";
            const mk = (lab, key, ph) => { const l = document.createElement("label"); l.className = "field"; l.innerHTML = "<span>" + lab + "</span>"; const i = document.createElement("input"); i.type = "text"; i.inputMode = "decimal"; i.value = c[key] != null ? c[key] : ""; if (ph) i.placeholder = ph; i.addEventListener("input", (e) => { c[key] = e.target.value; refresh(); onChange(); }); i.addEventListener("blur", (e) => { const r = window.CalcCIBSA.evalExpr(e.target.value); if (r != null && !isNaN(r)) { c[key] = window.CalcCIBSA.fmtNum(r); e.target.value = c[key]; refresh(); onChange(); } }); l.appendChild(i); agregarCalc(i); return l; };
            og.appendChild(mk("Distanciamiento (m)", "ojAristaD", "0.2"));
            og.appendChild(mk("Inset (m)", "ojAristaInset", "0.025"));
            card.appendChild(og);
            const sl = document.createElement("label"); sl.className = "field full"; sl.innerHTML = "<span>Suprimir posiciones (ej. 1, 3, 5-8)</span>";
            const si = document.createElement("input"); si.type = "text"; si.value = c.ojAristaSupr || ""; si.placeholder = "ej. 1, 3, 5-8";
            si.addEventListener("input", (e) => { c.ojAristaSupr = e.target.value; refresh(); onChange(); });
            sl.appendChild(si); card.appendChild(addHelpTo(sl, "Quita ojetillos puntuales de la línea de corte por su número de orden (0 desde el inicio del corte). Acepta unidades sueltas y rangos con guión (inclusivos). Ej.: \"0, 3\", \"2/5\" o \"5-8\" (= 5,6,7,8).", "CORTE-OJ-SUPR"));
          }
          // Strap (cinta) a lo largo de la arista del corte.
          const ssel = document.createElement("label"); ssel.className = "field full"; ssel.innerHTML = "<span>Strap (cinta) en la arista</span>";
          const sopt = document.createElement("select");
          const so0 = document.createElement("option"); so0.value = ""; so0.textContent = "— sin strap —"; sopt.appendChild(so0);
          opcionesCintaEn(sopt);
          sopt.value = c.strapMatId != null ? String(c.strapMatId) : "";
          sopt.addEventListener("change", (e) => { c.strapMatId = e.target.value === "" ? null : parseInt(e.target.value, 10); if (c.strapMatId != null && !c.strapLado) c.strapLado = "A"; pintar(); onChange(); });
          ssel.appendChild(sopt); card.appendChild(addHelpTo(ssel, "Coloca cintas (straps) que cruzan la arista del corte, repartidas a lo largo de ella (como los ojetillos): distanciamiento, cuánto cruza a cada lado y supresión.", "CORTE-STRAP"));
          if (c.strapMatId != null) {
            const mk = (lab, key, ph) => { const l = document.createElement("label"); l.className = "field"; l.innerHTML = "<span>" + lab + "</span>"; const i = document.createElement("input"); i.type = "text"; i.inputMode = "decimal"; i.value = c[key] != null ? c[key] : ""; if (ph) i.placeholder = ph; i.addEventListener("input", (e) => { c[key] = e.target.value; refresh(); onChange(); }); i.addEventListener("blur", (e) => { const r = window.CalcCIBSA.evalExpr(e.target.value); if (r != null && !isNaN(r)) { c[key] = window.CalcCIBSA.fmtNum(r); e.target.value = c[key]; refresh(); onChange(); } }); l.appendChild(i); agregarCalc(i); return l; };
            const lsel = document.createElement("label"); lsel.className = "field full"; lsel.innerHTML = "<span>Lado del offset (hacia dónde cruza más)</span>";
            const lopt = document.createElement("select");
            [["A", "Lado A — " + cardi(pnx, pny)], ["B", "Lado B — " + cardi(-pnx, -pny)]].forEach(([v, t]) => { const o = document.createElement("option"); o.value = v; o.textContent = t; lopt.appendChild(o); });
            lopt.value = c.strapLado || "A"; lopt.addEventListener("change", (e) => { c.strapLado = e.target.value; refresh(); onChange(); });
            lsel.appendChild(lopt); card.appendChild(addHelpTo(lsel, "Cada strap cruza el corte perpendicularmente. \"Offset\" sale hacia el lado elegido; \"Inset\" hacia el lado opuesto.", "CORTE-STRAP-LADO"));
            const sg = document.createElement("div"); sg.className = "pieza-grid";
            sg.appendChild(addHelpTo(mk("Distanciamiento (m)", "strapD", "0.3"), "Separación entre straps a lo largo de la arista del corte. Vacío o 0 = una sola cinta al centro.", "CORTE-STRAP-D"));
            sg.appendChild(addHelpTo(mk("Cruza lado A — offset (m)", "strapOffset", "0.1"), "Cuánto cruza cada strap hacia el lado del offset.", "CORTE-STRAP-OFF"));
            sg.appendChild(addHelpTo(mk("Cruza lado B — inset (m)", "strapInset", "0.1"), "Cuánto cruza cada strap hacia el lado opuesto.", "CORTE-STRAP-INS"));
            card.appendChild(sg);
            const sl = document.createElement("label"); sl.className = "field full"; sl.innerHTML = "<span>Suprimir posiciones (ej. 1, 3, 5-8)</span>";
            const si = document.createElement("input"); si.type = "text"; si.value = c.strapSupr || ""; si.placeholder = "ej. 1, 3, 5-8";
            si.addEventListener("input", (e) => { c.strapSupr = e.target.value; refresh(); onChange(); });
            sl.appendChild(si); card.appendChild(addHelpTo(sl, "Quita straps puntuales de la línea de corte por su número de orden (0 desde el inicio del corte). Acepta unidades sueltas y rangos con guión (inclusivos). Ej.: \"0, 3\", \"2/5\" o \"5-8\" (= 5,6,7,8).", "CORTE-STRAP-SUPR"));
          }
        }
        { const f2 = window.CalcCIBSA.fmtNum, bL = ctx.baseLargo(), bA = ctx.baseAncho();
          const bp = document.createElement("p"); bp.className = "muted small";
          bp.textContent = (bL > 0 && bA > 0) ? ("Paño base: " + f2(bL) + " × " + f2(bA) + " m (largo × ancho).") : "Define el largo y ancho del paño base para ver su medida aquí.";
          card.appendChild(bp); }
        if (esCirc) { const nc = document.createElement("p"); nc.className = "muted small"; nc.textContent = "El círculo se centra en el paño base; el padding lo desplaza (N/S/E/O). Puede exceder el paño: solo se dibuja lo que queda dentro."; card.appendChild(nc); }
        const pcap = document.createElement("p"); pcap.className = "muted small"; pcap.textContent = esCirc ? "Posición del centro — padding por punto cardinal (m)." : "Posición — margen desde cada arista (m). Si un margen es 0, ese lado coincide con el borde y el corte queda abierto ahí."; card.appendChild(addHelpTo(pcap, "Ubicación del calado dentro del paño: margen desde cada arista (o padding del centro si es círculo). Un margen 0 hace que ese lado coincida con el borde y el calado lo seccione.", "CORTE-POS"));
        const pgrid = document.createElement("div"); pgrid.className = "pieza-grid";
        const libreEje = (k) => { const ev = window.CalcCIBSA.evalExpr; if (k === "padSup" || k === "padInf") { const b = ctx.baseLargo(), w = esLinea ? 0 : ev(c.largo); return (b != null && w != null) ? b - w : null; } const b = ctx.baseAncho(), w = esLinea ? ev(c.largo) : ev(c.ancho); return (b != null && w != null) ? b - w : null; };
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
        if (!esLinea) {
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
        }
        // Aristas a dibujar (solo calado rectangular) — visible.
        if (!esCirc && !esLinea) {
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
          if (!esLinea) {
            const ocap = document.createElement("p"); ocap.className = "muted small"; ocap.textContent = "Ojetillos por arista del corte (solo van al plano de taller):"; adv.appendChild(addHelpTo(ocap, "Cantidad de ojetillos en cada lado del calado. Son solo del calado (van al plano de taller) y no afectan el precio.", "CORTE-OJET"));
            const ogrid = document.createElement("div"); ogrid.className = "pieza-grid";
            [["sup", "Superior"], ["inf", "Inferior"], ["izq", "Izquierda"], ["der", "Derecha"]].forEach(([k, lab]) => {
              const l = document.createElement("label"); l.className = "field"; l.innerHTML = "<span>" + lab + "</span>";
              const inp = document.createElement("input"); inp.type = "text"; inp.inputMode = "numeric"; inp.value = (c.oj && c.oj[k]) || "0";
              inp.addEventListener("input", (e) => { c.oj[k] = e.target.value; refresh(); onChange(); });
              l.appendChild(inp); ogrid.appendChild(l);
            });
            adv.appendChild(ogrid);
          }
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
          if (esLinea) {
            if (h == null || h <= 0) { dims.textContent = esGuia ? "Completa el largo de la guía." : "Completa el largo del corte."; return; }
            let html = (esGuia ? "Guía (construcción) <b>" : "Corte (línea) <b>") + window.CalcCIBSA.fmtNum(h) + " m</b> · costo $0" + (esGuia ? " · no secciona" : "");
            const aa = ev(c.angulo) || 0; if (Math.abs(aa) > 1e-6) html += " · ángulo " + window.CalcCIBSA.fmtNum(aa) + "°";
            dims.innerHTML = html; return;
          }
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
        ocultarFichaCtl(card, c, pintar, onChange);
        fichaColapsable(card, head, tt, c); // cada Corte/calado es plegable
        rows.appendChild(card);
      });
      navFichas(rows, (ctx.cortes || []).map((c, i) => ({ titulo: ((c.tipo === "guia") ? "Guía " : (c.tipo === "corte") ? "Corte " : "Calado ") + (i + 1), nombre: c.legend || "", oculto: !!c._oculto })));
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
    return visibles(list).map((a) => {
      const r = calcAleta(a, N, valorOjUnif(), facUnif()); if (!r) return null;
      const nom = (a.legend && a.legend.trim()) ? a.legend.trim() : (ALETA_NOM[a.tipo] || "Aleta");
      let det = nom + " en " + telaCli(r.tela) + " " + f(r.al) + "×" + f(r.aa) + " m";
      if (a.descripcion && a.descripcion.trim()) det += " · " + a.descripcion.trim();
      return { cantidad: r.N, detalle: det, precio: Math.round(r.subtotal / r.N), totalNeto: r.subtotal };
    }).filter(Boolean);
  }

  // Straps del uniforme como filas-objeto para el PDF (mismo formato que aletasUnifPDF).
  function strapsUnifPDF(list, ctx, N) {
    const f = window.CalcCIBSA.fmtNum, n = Math.max(1, N || 1);
    return visibles(list).map((s) => {
      const m = strapMat(s); if (!m) return null;
      const largo = strapLargo(s), ancho = anchoCintaM(m), inst = strapInstancias(s, ctx);
      if (!(largo > 0) || !(ancho > 0) || inst <= 0) return null;
      const nom = (s.legend && s.legend.trim()) ? s.legend.trim() : "Cinta";
      const cant = (s.modo === "arista") ? (inst + "× ") : "";
      const det = nom + ": " + cant + m.item + " " + f(largo) + " m × " + f(ancho * 100) + " cm";
      const unit = inst * largo * (m.precio || 0);
      return { cantidad: n, detalle: det, precio: Math.round(unit), totalNeto: Math.round(unit * n), cat: "Refuerzo" };
    }).filter(Boolean);
  }
  // Cortes/calados del uniforme (ojetillos y cintas sobre la línea de corte) como filas-objeto.
  function cortesUnifPDF(spec, valorOj, N) {
    if (!window.SketchCIBSA) return [];
    let sk; try { sk = window.SketchCIBSA.construirSketch(spec); } catch (e) { return []; }
    const n = Math.max(1, N || 1), out = [];
    let nOj = 0; (sk.cortes || []).forEach((c) => { nOj += (c.ojetillos || []).length; });
    if (nOj > 0) out.push({ cantidad: nOj * n, detalle: "Ojetillos sobre cortes/calados", precio: valorOj || 0, totalNeto: nOj * (valorOj || 0) * n, cat: "Ojetillos" });
    const cs = (sk.straps || []).filter((s) => s.origen === "corte");
    if (cs.length) {
      const tot = cs.reduce((a, s) => a + (s.largo || 0) * (s.precioM || 0), 0);
      out.push({ cantidad: cs.length * n, detalle: "Cintas sobre cortes (refuerzo)", precio: Math.round(tot / cs.length), totalNeto: Math.round(tot * n), cat: "Refuerzo" });
    }
    return out;
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
    if (!(a > 0) || !(l > 0)) return { pos: [], total: 0, numeros: [] };
    return ojetillosPosiciones(a, l, state.ojEdges, state.ojParejo, cortesSpec(state.cortesUnif), !!state.ojNumerar);
  }
  function nOjetillos() {
    if (state.ojMode === "total") return ojInt(state.ojTotal);
    return ojetillosPosUnif().total;
  }
  // Campos de ojetillos para el spec del sketch del uniforme (posiciones explícitas si es por arista).
  function ojSpecUnif() {
    // ojNumeros != null activa la numeración (NumOj): en "arista" trae los marcadores del perímetro; en
    // "total" va vacío pero deja que se sumen los de las aristas de cortes/guías (que existen en cualquier modo).
    if (state.ojMode !== "arista") return { ojTotal: nOjetillos(), ojNumeros: state.ojNumerar ? [] : null };
    const r = ojetillosPosUnif();
    return { ojetillosPos: r.pos, ojNumeros: state.ojNumerar ? (r.numeros || []) : null };
  }
  function ojDetalle() {
    const n = nOjetillos();
    if (state.ojMode === "total") return `${n} ojetillos en total.`;
    const ev = window.CalcCIBSA.evalExpr, e = state.ojEdges || {};
    const partes = ["sup", "inf", "izq", "der"].filter((k) => e[k] && e[k].on !== false && ev(e[k].d) > 0).map((k) => OJ_NOMBRE[k].slice(0, 3) + " @" + window.CalcCIBSA.fmtNum(ev(e[k].d)) + "m");
    return `${n} ojetillos en total (distanciamiento: ${partes.join(", ")}${state.ojParejo ? "; pareja" : ""}).`;
  }
  // Detalle por arista para el plano de taller: cantidad instalada + espaciado real entre ojetillos.
  // (Las esquinas se cuentan en las aristas horizontales, para que la suma sea el total sin duplicar.)
  function ojDetalleAristas(ancho, largo, edges, parejo, cortes) {
    if (!window.SketchCIBSA || !(ancho > 0) || !(largo > 0)) return [];
    const r = ojetillosPosiciones(ancho, largo, edges, parejo, cortes);
    const f = window.CalcCIBSA.fmtNum, out = [];
    ["sup", "inf", "izq", "der"].forEach((k) => {
      const d = r.detalle && r.detalle[k]; if (!d) return;
      const cnt = d.kept || 0; if (cnt <= 0) return;
      let s = OJ_NOMBRE[k] + ": " + cnt + " ojetillo" + (cnt === 1 ? "" : "s");
      if (d.esp > 0 && cnt > 1) s += " · cada " + f(d.esp) + " m";
      if (d.seccionada) s += " (arista seccionada por corte)";
      out.push(s);
    });
    return out;
  }
  // Detalle de straps por arista para el plano de taller: cantidad de cintas + espaciado entre ellas.
  function strapsDetalleAristas(list, ctx) {
    const ev = window.CalcCIBSA.evalExpr, f = window.CalcCIBSA.fmtNum, out = [];
    const EDGELBL = { sup: "Superior", inf: "Inferior", izq: "Izquierda", der: "Derecha" };
    visibles(list || []).forEach((s, idx) => {
      if (s.modo !== "arista") return;
      const e = strapAristaEdge(s.arista || "sup", ctx || {}); if (!e) return;
      const inst = strapInstancias(s, ctx || {}); if (inst <= 0) return;
      const nom = (s.legend && s.legend.trim()) ? s.legend.trim() : ("Strap " + (idx + 1));
      let line = nom + " (" + (EDGELBL[s.arista || "sup"] || "Arista") + "): " + inst + " cinta" + (inst === 1 ? "" : "s");
      const d = ev(s.d) || 0;
      if (d > 0 && inst > 1 && window.SketchCIBSA) {
        const n = window.SketchCIBSA.posicionesArista(e.len, d, false).length;
        const esp = n > 1 ? e.len / (n - 1) : 0;
        if (esp > 0) line += " · cada " + f(esp) + " m";
      }
      out.push(line);
    });
    return out;
  }

  function renderOjetillos() {
    const c = $("ojDyn"); c.innerHTML = "";
    if (state.ojMode === "total") {
      const bL = num("f_largo", null), bA = num("f_ancho", null), fN = window.CalcCIBSA.fmtNum;
      const nota = (bL > 0 && bA > 0) ? ("Paño base: " + fN(bL) + " × " + fN(bA) + " m (largo × ancho).") : "Define el largo y ancho del paño base.";
      c.innerHTML = `<label class="field"><span>Cantidad total</span>
        <input id="oj_total_in" type="text" inputmode="numeric" step="1" value="${state.ojTotal}" />
        <span class="muted small" style="display:block;margin-top:2px">${nota}</span></label>`;
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
    { const chk = document.createElement("label"); chk.className = "chk borde-rot-chk";
      const cb = document.createElement("input"); cb.type = "checkbox"; cb.checked = !!state.unionRot;
      cb.addEventListener("change", () => { state.unionRot = cb.checked; recompute(); });
      chk.appendChild(cb); chk.appendChild(document.createTextNode("Rotular las uniones entre paños en el plano"));
      c.appendChild(chk); }
    if (state.bordeModo === "uniforme") {
      const lab = document.createElement("label"); lab.className = "field";
      const sp = document.createElement("span"); sp.textContent = "Borde por arista (m)"; lab.appendChild(sp);
      const inp = document.createElement("input"); inp.type = "text"; inp.value = state.bordeValor;
      inp.addEventListener("input", (e) => { state.bordeValor = e.target.value; recompute(); });
      inp.addEventListener("blur", (e) => { const r = window.CalcCIBSA.evalExpr(e.target.value); if (r != null && !isNaN(r)) { state.bordeValor = window.CalcCIBSA.fmtNum(r); e.target.value = state.bordeValor; recompute(); } });
      lab.appendChild(inp); c.appendChild(lab);
      const p = document.createElement("p"); p.className = "muted small"; p.textContent = "Se aplica a las 4 aristas (por defecto 0,045 m).";
      c.appendChild(p);
      const chk = document.createElement("label"); chk.className = "chk borde-rot-chk";
      const cb = document.createElement("input"); cb.type = "checkbox"; cb.checked = !!state.bordeRotUnif;
      cb.addEventListener("change", () => { state.bordeRotUnif = cb.checked; recompute(); });
      chk.appendChild(cb); chk.appendChild(document.createTextNode("Rotular el borde en el plano (las 4 aristas)"));
      c.appendChild(chk);
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
      ctr.appendChild(sel); ctr.appendChild(val); row.appendChild(ctr); row.appendChild(warn);
      const chk = document.createElement("label"); chk.className = "chk borde-rot-chk";
      const cbR = document.createElement("input"); cbR.type = "checkbox"; cbR.checked = !!b.mostrarRot;
      cbR.addEventListener("change", () => { state.bordes[key].mostrarRot = cbR.checked; recompute(); });
      chk.appendChild(cbR); chk.appendChild(document.createTextNode("Rotular en el plano"));
      row.appendChild(chk);
      c.appendChild(row);
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
    refreshRotuloChks();
    addZoomBtns();
    actualizarColapsables();
  }

  function recomputeUniforme() {
    telaInfo();
    const cont = $("cmpCards"); cont.innerHTML = ""; state.loteUnif = null;
    { const rt = $("resumenTelas"); if (rt) rt.innerHTML = ""; }
    const avisos = $("avisosUnif"); if (avisos) avisos.innerHTML = "";
    const tela = telaActual();
    const largo = num("f_largo", null), ancho = num("f_ancho", null);
    actualizarTraseraUnif();
    const sk = $("sketchUnif");
    if (sk && window.SketchCIBSA && !document.body.classList.contains("no-plano")) {
      const especUnif = Object.assign({ ancho: ancho || 0, largo: largo || 0, ventanas: [], cortes: cortesSpec(state.cortesUnif), bolsillos: bolsillosDe(state.bordeModo, state.bordes), bordesRot: bordesRotuloDe(state.bordeModo, state.bordes, state.bordeValor, state.bordeRotUnif), unionesRot: unionesRotObj(state.unionRot, num("f_union", 0.045), state.orientUnif, (telaActual() || {}).anchoRollo), setsRot: setsRotuloDe(ancho || 0, largo || 0, state.ojMode === "arista" ? state.ojEdges : null, state.strapsUnif, { ancho: ancho || 0, largo: largo || 0 }), aletas: aletasSpec(state.aletasUnif), straps: strapsSpec(state.strapsUnif, { ancho: ancho || 0, largo: largo || 0 }), cintas: cintasSpec(state.cintasUnif, { ancho: ancho || 0, largo: largo || 0 }), cotasOcultas: state.cotasOcultas, rotDrag: state.rotDrag, rotColapsar: state.rotColapsar }, ojSpecUnif());
      if (alturaUnif() > 0) especUnif.volumetrico = { alto: alturaUnif() };
      sk.innerHTML = sketchDualSVG(especUnif, state.trasUnif, cortesSpec(state.backCortesUnif), aletasSpec(state.backAletasUnif));
      activarArrastreCallouts(sk);
      const refrescarOcUnif = () => { renderCortesUnif(); renderAletasUnif(); renderStrapsUnif(); renderCintasUnif(); recompute(); };
      menuPlano(sk, [
        { label: "Cortes / Calados", items: (state.cortesUnif || []).map((c, i) => ({ obj: c, titulo: ((c.tipo === "guia") ? "Guía " : (c.tipo === "corte") ? "Corte " : "Calado ") + (i + 1) + (c.legend && c.legend.trim() ? " — " + c.legend.trim() : "") })) },
        { label: "Aletas / Anexos", rotulo: true, items: (state.aletasUnif || []).map((a, i) => ({ obj: a, titulo: "Anexo " + (i + 1) + (a.legend && a.legend.trim() ? " — " + a.legend.trim() : "") })) },
        { label: "Straps / cintas", items: (state.strapsUnif || []).map((s, i) => ({ obj: s, titulo: "Strap " + (i + 1) + (s.legend && s.legend.trim() ? " — " + s.legend.trim() : "") })) },
        { label: "Cintas / cierres", rotulo: true, items: (state.cintasUnif || []).map((c, i) => ({ obj: c, titulo: "Cinta " + (i + 1) + (c.legend && c.legend.trim() ? " — " + c.legend.trim() : "") })) },
      ], refrescarOcUnif, { cotas: cotasDeSpec(especUnif), ocultas: state.cotasOcultas, onChange: refrescarOcUnif },
        (state.ojMode === "arista" || hayOjEnCortes(state.cortesUnif)) ? { on: !!state.ojNumerar, toggle: () => { state.ojNumerar = !state.ojNumerar; refrescarOcUnif(); } } : null);
      menuBordesRot(sk, state, () => { renderBordes(); recompute(); }, () => $("bordeDyn"), () => irANodo($("wOjetillos")));
    }
    if (!tela || largo == null || ancho == null || largo <= 0 || ancho <= 0) {
      cont.innerHTML = '<p class="muted small">Ingresa largo, ancho y tela para ver los montos.</p>';
      setSubtotalUnifHint(null);
      return;
    }
    let lotePrimary;
    try { lotePrimary = loteParaTela(tela, largo, ancho); } catch (e) { setSubtotalUnifHint(null); return; }
    state.loteUnif = lotePrimary;

    // Telas a cotizar agrupadas por ancho de rollo (geometría idéntica dentro del grupo).
    const telas = telasParaCotizar();
    const grupos = [];
    telas.forEach((t) => {
      const k = rolloKey(t.anchoRollo);
      let g = grupos.find((x) => x.key === k);
      if (!g) { g = { key: k, ancho: t.anchoRollo, telas: [] }; grupos.push(g); }
      g.telas.push(t);
    });
    const multiGrupo = grupos.length > 1;
    const mostrarLbl = multiGrupo || telas.length > 1;
    grupos.forEach((g) => {
      let lote; try { lote = loteParaTela(g.telas[0], largo, ancho); } catch (e) { return; }
      const cur = orientByRollo[g.key] || state.orientUnif;
      const gEl = document.createElement("div"); gEl.className = "cmp-group";
      if (mostrarLbl) {
        const lbl = document.createElement("p"); lbl.className = "muted small cmp-grouplbl";
        lbl.innerHTML = "<b>Rollo " + window.CalcCIBSA.fmtNum(g.ancho) + " m</b> — " + g.telas.map((t) => t.nombre).join(", ");
        gEl.appendChild(lbl);
      }
      const row = document.createElement("div"); row.className = "cmp"; gEl.appendChild(row);
      cardLoteGrupo(g.key, "largo", lote.oLargo, "Uniones a lo largo", lote, cur, row);
      cardLoteGrupo(g.key, "ancho", lote.oAncho, "Uniones a lo ancho", lote, cur, row);
      cont.appendChild(gEl);
    });

    if (telas.length > 1) renderResumenTelas(telas, largo, ancho);
    renderAvisosUnif(lotePrimary);
    setSubtotalUnifHint({ neto: subtotalUnifNeto(lotePrimary, tela, ancho, largo), N: lotePrimary.N });
  }
  // Subtotal NETO del producto (tela primaria), igual fórmula que construirDatosUnif: tela + ojetillos
  // + complementos + aletas + straps + ojetillos/cintas de cortes. Refleja en vivo "ocultar"/editar.
  function subtotalUnifNeto(lote, tela, ancho, largo) {
    const orientKey = orientDeTela(tela);
    const o = orientKey === "ancho" ? lote.oAncho : lote.oLargo;
    const N = lote.N;
    const ojeTotal = lote.nOjetillos * lote.valorOjetillo * N;
    const compTotal = compTotalUnit(state.complementosUnif) * N;
    const aleTotal = aletasTotal(state.aletasUnif, N, lote.valorOjetillo, facUnif()) + aletasTotal(state.backAletasUnif, N, lote.valorOjetillo, facUnif());
    const strapTotal = strapsTotal(state.strapsUnif, N, { ancho: ancho || 0, largo: largo || 0 });
    const skSpec = { ancho: ancho, largo: largo, ojTotal: lote.nOjetillos, ventanas: [], cortes: cortesSpec(state.cortesUnif), bolsillos: bolsillosDe(state.bordeModo, state.bordes), bordesRot: bordesRotuloDe(state.bordeModo, state.bordes, state.bordeValor, state.bordeRotUnif), unionesRot: unionesRotObj(state.unionRot, num("f_union", 0.045), state.orientUnif, (telaActual() || {}).anchoRollo), aletas: aletasSpec(state.aletasUnif), straps: strapsSpec(state.strapsUnif, { ancho: ancho || 0, largo: largo || 0 }), cotasOcultas: state.cotasOcultas, rotDrag: state.rotDrag };
    const corteTotal = costoCortesUnit(skSpec, lote.valorOjetillo) * N;
    const cintaTotal = cintasTotal(state.cintasUnif, N, { ancho: ancho || 0, largo: largo || 0 });
    return o.materialLote + ojeTotal + compTotal + aleTotal + strapTotal + corteTotal + cintaTotal;
  }
  function setSubtotalUnifHint(info) {
    const el = $("subtotalUnifHint"); if (!el) return;
    if (!info || !(info.neto > 0)) { el.innerHTML = ""; return; }
    const uds = info.N > 1 ? (" · " + info.N + " uds.") : "";
    el.innerHTML = "Subtotal del producto: <b>" + money(info.neto) + "</b>" +
      "<span class=\"sh-cap\">neto, sin IVA" + uds + " · se actualiza al ocultar o editar elementos</span>";
  }

  // ---------- Lupa: ampliar el plano a pantalla completa ----------
  // Coloca un botón "🔍+" en cada contenedor de plano que tenga un SVG (se re-coloca tras cada render).
  function addZoomBtns() {
    document.querySelectorAll(".sketch, .pz-sketch").forEach((cont) => {
      const svg = cont.querySelector(".sketch-svg");
      const prev = cont.querySelector(":scope > .sketch-zoom-btn");
      if (!svg) { if (prev) prev.remove(); const rc = cont.querySelector(":scope > .sketch-rotctrls"); if (rc) rc.remove(); return; }
      if (!prev) {
        const b = document.createElement("button");
        b.type = "button"; b.className = "sketch-zoom-btn"; b.title = "Ampliar plano"; b.textContent = "🔍+";
        cont.appendChild(b);
      }
      if (cont.id === "sketchUnif") montarRotCtrls(cont, svg);
    });
  }
  // Controles del plano en vivo (arriba a la izquierda): colapsar rótulos, modo reubicar (congela scroll),
  // y reset de posiciones. Solo cuando el plano tiene callouts arrastrables (o está colapsado).
  function montarRotCtrls(cont, svg) {
    document.body.classList.toggle("rot-colapsar", !!state.rotColapsar); // oculta también el panel-lista de rótulos
    const hasRot = state.rotColapsar || svg.querySelector(".callout-drag");
    let box = cont.querySelector(":scope > .sketch-rotctrls");
    if (!hasRot) { if (box) box.remove(); return; }
    if (!box) {
      box = document.createElement("div"); box.className = "sketch-rotctrls";
      box.innerHTML =
        '<button type="button" class="sketch-ctrl-btn sketch-rot-btn" title="Colapsar / mostrar rótulos">☰</button>' +
        '<button type="button" class="sketch-ctrl-btn sketch-lock-btn" title="Modo reubicar: congela el scroll para arrastrar los rótulos">🔓</button>' +
        '<button type="button" class="sketch-ctrl-btn sketch-reset-btn" title="Devolver los rótulos a su posición automática">↺</button>';
      cont.appendChild(box);
    }
    const rotB = box.querySelector(".sketch-rot-btn"), lockB = box.querySelector(".sketch-lock-btn"), resB = box.querySelector(".sketch-reset-btn");
    if (rotB) rotB.classList.toggle("active", !!state.rotColapsar);
    if (lockB) { lockB.classList.toggle("active", !!state.rotReubicar); lockB.textContent = state.rotReubicar ? "🔒" : "🔓"; }
    if (resB) resB.style.display = Object.keys(state.rotDrag || {}).length ? "" : "none";
  }
  function openPlanoZoom(svg) {
    const ov = $("planoZoom"), body = $("planoZoomBody"); if (!ov || !body || !svg) return;
    const source = svg.closest && svg.closest(".sketch, .pz-sketch");   // contenedor origen (para re-render y store de arrastre)
    // iOS Safari colapsa un SVG con width/height auto → fijamos tamaño en px según el viewBox.
    const sizeClone = (cl, srcSvg) => {
      const vb = (srcSvg.getAttribute("viewBox") || "").split(/[\s,]+/).map(parseFloat);
      const vbw = (vb[2] > 0 ? vb[2] : (srcSvg.clientWidth || 700)), vbh = (vb[3] > 0 ? vb[3] : (srcSvg.clientHeight || 500));
      const aspect = vbw / vbh, availW = window.innerWidth * 0.94, availH = window.innerHeight * 0.88;
      let w, h; if (availW / availH > aspect) { h = availH; w = h * aspect; } else { w = availW; h = w / aspect; }
      cl.removeAttribute("width"); cl.removeAttribute("height");
      cl.style.cssText = "width:" + Math.round(w) + "px;height:" + Math.round(h) + "px;max-width:none;max-height:none;background:#fff;border-radius:8px;display:block;";
    };
    // Clona el SVG vigente del origen y ata el arrastre de rótulos; al soltar, re-renderiza el plano
    // (con el store del origen) y vuelve a clonar el zoom, así se puede reubicar CON la lupa activa.
    const render = () => {
      // Si el re-render reconstruyó el contenedor (preview del compuesto), lo re-ubicamos por su id estable.
      const src = (source && source.id && document.getElementById(source.id)) || source;
      const srcSvg = src ? src.querySelector(".sketch-svg") : svg; if (!srcSvg) return;
      const ctx = src && src._dragCtx;
      body.innerHTML = "";
      const cl = srcSvg.cloneNode(true); sizeClone(cl, srcSvg); body.appendChild(cl);
      activarArrastreCallouts(body, ctx ? ctx.store : undefined, () => { if (ctx && ctx.onChange) ctx.onChange(); render(); });
    };
    render();
    ov.classList.remove("hidden");
  }
  function closePlanoZoom() { const ov = $("planoZoom"); if (ov) ov.classList.add("hidden"); const body = $("planoZoomBody"); if (body) body.innerHTML = ""; }
  document.addEventListener("click", (e) => {
    const zb = e.target.closest && e.target.closest(".sketch-zoom-btn");
    if (zb) { e.preventDefault(); const cont = zb.closest(".sketch, .pz-sketch"); const svg = cont && cont.querySelector(".sketch-svg"); if (svg) openPlanoZoom(svg); return; }
    if (e.target.closest && e.target.closest(".sketch-rot-btn")) { e.preventDefault(); state.rotColapsar = !state.rotColapsar; recompute(); return; }
    if (e.target.closest && e.target.closest(".sketch-lock-btn")) { e.preventDefault(); state.rotReubicar = !state.rotReubicar; document.body.classList.toggle("rot-reubicar", state.rotReubicar); addZoomBtns(); return; }
    if (e.target.closest && e.target.closest(".sketch-reset-btn")) { e.preventDefault(); state.rotDrag = {}; recompute(); return; }
    // Cerrar la lupa SOLO con el botón ✕ o al tocar el fondo (overlay o su padding), no al interactuar con el SVG/rótulos.
    if (e.target && (e.target.id === "planoZoom" || e.target.id === "planoZoomBody" || (e.target.closest && e.target.closest("#planoZoomClose")))) closePlanoZoom();
  });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closePlanoZoom(); });
  // Auto-reparación: cualquier re-render de un plano (cambiar tela, ocultar, rótulos, etc.) reescribe
  // su innerHTML y borra la "🔍+". Un observador repone el botón en el siguiente frame, así nunca se
  // queda sin lupa sin depender de que cada handler llame a addZoomBtns(). Debounced con rAF.
  let _zoomRaf = 0;
  function scheduleZoomBtns() { if (_zoomRaf) return; _zoomRaf = (window.requestAnimationFrame || window.setTimeout)(() => { _zoomRaf = 0; addZoomBtns(); }, 0); }
  try { new MutationObserver(scheduleZoomBtns).observe(document.body, { childList: true, subtree: true }); } catch (e) {}

  // Tarjeta de orientación para un grupo de ancho de rollo. Al elegir, se replica a todo el grupo.
  function cardLoteGrupo(groupKey, key, o, head, lote, cur, parent) {
    const sel = cur === key;
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
    el.addEventListener("click", () => {
      orientByRollo[groupKey] = key;
      const tp = telaActual(); if (tp && rolloKey(tp.anchoRollo) === groupKey) state.orientUnif = key;
      recompute();
    });
    (parent || $("cmpCards")).appendChild(el);
  }

  // Mini-resumen: subtotal estimado de cada tela seleccionada (con la orientación de su grupo de rollo).
  function renderResumenTelas(telas, largo, ancho) {
    const cont = $("resumenTelas"); if (!cont) return; cont.innerHTML = "";
    const box = document.createElement("div"); box.className = "resumen-telas";
    const head = document.createElement("div"); head.className = "rt-row head";
    head.innerHTML = "<span>Tela · subtotal estimado (neto)</span><span>Orientación</span>";
    box.appendChild(head);
    telas.forEach((t) => {
      let lote; try { lote = loteParaTela(t, largo, ancho); } catch (e) { return; }
      const orientKey = orientDeTela(t);
      const calc = construirDatosUnif(t, lote, "01").calc;
      const row = document.createElement("div"); row.className = "rt-row";
      row.innerHTML = `<span><span class="rt-nm">${t.nombre}</span><br><span class="rt-sub">${lote.N > 1 ? lote.N + " u · " : ""}rollo ${window.CalcCIBSA.fmtNum(t.anchoRollo)} m</span></span>` +
        `<span style="text-align:right"><b>${money(calc.subtotal)}</b><br><span class="rt-sub">${orientKey === "ancho" ? "a lo ancho" : "a lo largo"}</span></span>`;
      box.appendChild(row);
    });
    cont.appendChild(box);
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
      ojNumerar: base ? !!base.ojNumerar : false,
      cotasOcultas: base ? Object.assign({}, base.cotasOcultas) : {},
      trasera: base ? !!base.trasera : false,
      aletas: base ? (base.aletas || []).map((a) => nuevaAleta(a)) : [],
      backAletas: base ? (base.backAletas || []).map((a) => nuevaAleta(a)) : [],
      straps: base ? (base.straps || []).map((s) => Object.assign({}, s)) : [],
      cintas: base ? (base.cintas || []).map((c) => Object.assign({}, c)) : [],
      backCortes: base ? (base.backCortes || []).map((c) => nuevaCorte(c)) : [],
      backComplementos: base ? (base.backComplementos || []).map((c) => Object.assign({}, c, { cantAristas: (c.cantAristas || []).slice() })) : [],
      union: base ? base.union : "0.045",
      bordeModo: base ? base.bordeModo : "uniforme",
      bordeValor: base ? base.bordeValor : "0.045",
      bordeRotUnif: base ? !!base.bordeRotUnif : false,
      unionRot: base ? !!base.unionRot : false,
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
    { const chk = document.createElement("label"); chk.className = "chk borde-rot-chk";
      const cb = document.createElement("input"); cb.type = "checkbox"; cb.checked = !!pz.unionRot;
      cb.addEventListener("change", () => { pz.unionRot = cb.checked; onChange(); });
      chk.appendChild(cb); chk.appendChild(document.createTextNode("Rotular las uniones entre paños en el plano"));
      container.appendChild(chk); }
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
      const chk = document.createElement("label"); chk.className = "chk borde-rot-chk";
      const cb = document.createElement("input"); cb.type = "checkbox"; cb.checked = !!pz.bordeRotUnif;
      cb.addEventListener("change", () => { pz.bordeRotUnif = cb.checked; onChange(); });
      chk.appendChild(cb); chk.appendChild(document.createTextNode("Rotular el borde en el plano (las 4 aristas)"));
      container.appendChild(chk);
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
        ctr.appendChild(sel); ctr.appendChild(val); row.appendChild(ctr); row.appendChild(warn);
        const chkR = document.createElement("label"); chkR.className = "chk borde-rot-chk";
        const cbR = document.createElement("input"); cbR.type = "checkbox"; cbR.checked = !!b.mostrarRot;
        cbR.addEventListener("change", () => { b.mostrarRot = cbR.checked; onChange(); });
        chkR.appendChild(cbR); chkR.appendChild(document.createTextNode("Rotular en el plano"));
        row.appendChild(chkR); container.appendChild(row);
        refWarn();
      });
    }
  }

  // Ojetillos de una pieza: total (sum si es por arista).
  function ojIntPz(v) { const r = window.CalcCIBSA.evalExpr(v); return (r == null || isNaN(r)) ? 0 : Math.max(0, Math.round(r)); }
  // ---------- Ojetillos por arista por distanciamiento (modelo compartido) ----------
  const OJ_NOMBRE = { sup: "Superior", inf: "Inferior", izq: "Izquierda", der: "Derecha" };
  const OJ_DIAM = 0.03; // diámetro del ojetillo (m): la 2da línea suprime 0/n si el inset es menor (se solapan)
  function defOjEdge() { return { on: true, d: "0.5", supr: "", linea2: { on: false, inset: "0.025", supr: "" }, sets: [] }; }
  // Set de ojetillos/straps: copia normalizada de los parámetros del usuario.
  function setCopy(st) { st = st || {}; return { n: st.n != null ? st.n : "2", esq: st.esq || "", off: st.off != null ? st.off : "0.1", esp: st.esp != null ? st.esp : "0.1", inset: st.inset != null ? st.inset : "0", angulo: st.angulo != null ? st.angulo : "0", up: st.up != null ? st.up : "", down: st.down != null ? st.down : "", rotulo: !!st.rotulo, nombre: st.nombre || "" }; }
  function setsCopy(arr) { return (arr || []).map(setCopy); }
  function nuevoSet() { return { n: "2", esq: "", off: "0.1", esp: "0.1", inset: "0", angulo: "0", up: "", down: "", rotulo: false, nombre: "" }; }
  // ↑/↓ propios del set (cuánto cruza la cinta a cada lado). Vacío = hereda el ↑/↓ del strap padre.
  function setCross(st, pOff, pIns) {
    const ev = window.CalcCIBSA.evalExpr;
    const val = (v, fb) => { if (v == null || v === "") return fb; const r = ev(v); return (r != null && !isNaN(r)) ? Math.max(0, r) : fb; };
    return { up: val(st.up, pOff), down: val(st.down, pIns) };
  }
  // Etiqueta de la esquina de referencia de un set (para el rótulo).
  function setEsqLabel(k, esq) {
    const e = esq || setEsqDefault(k);
    return (k === "sup" || k === "inf") ? (e === "der" ? "der." : "izq.") : (e === "inf" ? "abajo" : "arriba");
  }
  // ¿Desde qué extremo se mide el set? Aristas horizontales: izq=inicio, der=fin. Verticales: sup=inicio, inf=fin.
  function setEsqFin(k, esq) { return (k === "sup" || k === "inf") ? (esq === "der") : (esq === "inf"); }
  function setEsqDefault(k) { return (k === "sup" || k === "inf") ? "izq" : "sup"; }
  // Posiciones escalares (t en 0..L) de un set: N puntos desde la esquina elegida, con offset y espaciado.
  function setPosiciones(L, n, off, esp, esqFin) {
    const N = Math.max(2, Math.round(n || 0)), out = [];
    for (let i = 0; i < N; i++) {
      const c = (off || 0) + i * (esp || 0);
      let t = esqFin ? (L - c) : c;
      if (t >= -1e-6 && t <= L + 1e-6) out.push(Math.min(L, Math.max(0, t)));
    }
    return out;
  }
  // Gira un SET de ojetillos en bloque usando el 1er ojetillo como pivote. angDeg: 0° = sobre la arista,
  // positivo = hacia adentro del paño. Si el set se saldría del paño, recorta el ángulo al máximo que lo
  // mantiene dentro (el ojetillo más lejano define el tope; los demás quedan en el segmento, así que basta).
  function rotarSetPts(pts, k, angDeg, ancho, largo) {
    const ang = parseFloat(angDeg) || 0;
    if (!ang || !pts || pts.length < 2) return pts;
    const P0 = pts[0];
    const nrm = (k === "sup") ? { x: 0, y: 1 } : (k === "inf") ? { x: 0, y: -1 } : (k === "izq") ? { x: 1, y: 0 } : { x: -1, y: 0 };
    const last = pts[pts.length - 1];
    const dx = last.x - P0.x, dy = last.y - P0.y, len = Math.hypot(dx, dy);
    if (len < 1e-9) return pts;
    const dHat = { x: dx / len, y: dy / len };
    const dist = pts.map((p) => Math.hypot(p.x - P0.x, p.y - P0.y));
    const aMax = dist[dist.length - 1];
    const dentro = (th) => {
      const c = Math.cos(th), s = Math.sin(th);
      const fx = P0.x + aMax * (dHat.x * c + nrm.x * s), fy = P0.y + aMax * (dHat.y * c + nrm.y * s);
      return fx >= -1e-9 && fx <= ancho + 1e-9 && fy >= -1e-9 && fy <= largo + 1e-9;
    };
    let th = ang * Math.PI / 180;
    if (!dentro(th)) { let lo = 0, hi = th; for (let it = 0; it < 40; it++) { const mid = (lo + hi) / 2; if (dentro(mid)) lo = mid; else hi = mid; } th = lo; }
    const c = Math.cos(th), s = Math.sin(th);
    return pts.map((p, i) => ({ x: P0.x + dist[i] * (dHat.x * c + nrm.x * s), y: P0.y + dist[i] * (dHat.y * c + nrm.y * s) }));
  }
  // Puntos {x,y} (coords del paño, m) de un SET de ojetillos sobre la arista k, ya con inset y giro aplicados.
  function ojSetPuntos(k, st, ancho, largo) {
    const ev = window.CalcCIBSA.evalExpr;
    const cnt = ev(st.n); if (!(cnt >= 2)) return [];
    const L = (k === "sup" || k === "inf") ? ancho : largo;
    const off = ev(st.off) || 0, esp = ev(st.esp) || 0, insRaw = ev(st.inset), ins = (insRaw != null && insRaw > 0) ? insRaw : 0;
    const insVec = (i) => (k === "sup") ? { x: 0, y: i } : (k === "inf") ? { x: 0, y: -i } : (k === "izq") ? { x: i, y: 0 } : { x: -i, y: 0 };
    const mapFn = (t) => (k === "sup") ? { x: t, y: 0 } : (k === "inf") ? { x: t, y: largo } : (k === "izq") ? { x: 0, y: t } : { x: ancho, y: t };
    const offV = insVec(ins), esqFin = setEsqFin(k, st.esq || setEsqDefault(k));
    let pts = setPosiciones(L, cnt, off, esp, esqFin).map((t) => { const b = mapFn(t); return { x: b.x + offV.x, y: b.y + offV.y }; });
    const ang = ev(st.angulo) || 0;
    if (ang) pts = rotarSetPts(pts, k, ang, ancho, largo);
    return pts;
  }
  // Editor "+SETS" reutilizable (ojetillos y straps). host = arista de ojetillos | strap; lleva host.sets[] y host._setsOpen.
  // k = arista ("sup"/"inf"/"izq"/"der") para etiquetar la esquina de referencia. repintar() re-renderiza el editor.
  function renderSetsEditor(container, host, k, tipo, repintar, onChange) {
    const ev = window.CalcCIBSA.evalExpr, f = window.CalcCIBSA.fmtNum;
    if (!host.sets) host.sets = [];
    const nSets = host.sets.length, esStrap = (tipo === "straps");
    const wrap = document.createElement("div"); wrap.className = "oj-sets";
    const link = document.createElement("button"); link.type = "button"; link.className = "oj-sets-link";
    link.textContent = (host._setsOpen ? "▾ SETS" : "+SETS") + (nSets ? " (" + nSets + ")" : "");
    link.addEventListener("click", () => { host._setsOpen = !host._setsOpen; repintar(); });
    wrap.appendChild(link);
    if (host._setsOpen) {
      const panel = document.createElement("div"); panel.className = "oj-sets-panel";
      const cap = document.createElement("p"); cap.className = "muted small";
      cap.textContent = "Grupos de " + (esStrap ? "straps" : "ojetillos") + " (≥2) ubicados desde una esquina, con distancia a la esquina, espaciado constante e inset hacia adentro. Se suman a la distribución normal.";
      panel.appendChild(cap);
      const cornerOpts = (k === "sup" || k === "inf") ? [["izq", "Desde la izquierda"], ["der", "Desde la derecha"]] : [["sup", "Desde arriba"], ["inf", "Desde abajo"]];
      host.sets.forEach((st, i) => {
        const row = document.createElement("div"); row.className = "oj-set-row";
        const tt = document.createElement("div"); tt.className = "oj-set-tt"; tt.innerHTML = "<b>Set " + (i + 1) + "</b>";
        const del = document.createElement("button"); del.type = "button"; del.className = "oj-set-del"; del.textContent = "✕"; del.title = "Quitar set";
        del.addEventListener("click", () => { host.sets.splice(i, 1); repintar(); onChange(); });
        tt.appendChild(del); row.appendChild(tt);
        const grid = document.createElement("div"); grid.className = "pieza-grid";
        // Cantidad (entero ≥ 2)
        { const lab = document.createElement("label"); lab.className = "field"; lab.innerHTML = "<span>Cantidad (≥2)</span>";
          const inp = document.createElement("input"); inp.type = "text"; inp.inputMode = "numeric"; inp.value = st.n != null ? st.n : "2";
          inp.addEventListener("input", (e2) => { st.n = e2.target.value; onChange(); });
          inp.addEventListener("blur", (e2) => { const r = ev(e2.target.value); st.n = (r != null && !isNaN(r) && r >= 2) ? String(Math.round(r)) : "2"; e2.target.value = st.n; onChange(); });
          lab.appendChild(inp); agregarCalc(inp); grid.appendChild(lab); }
        // Esquina de referencia
        { const lab = document.createElement("label"); lab.className = "field"; lab.innerHTML = "<span>Esquina de referencia</span>";
          const sel = document.createElement("select");
          cornerOpts.forEach(([v, t]) => { const o = document.createElement("option"); o.value = v; o.textContent = t; sel.appendChild(o); });
          sel.value = st.esq || setEsqDefault(k); st.esq = sel.value;
          sel.addEventListener("change", (e2) => { st.esq = e2.target.value; onChange(); });
          lab.appendChild(sel); grid.appendChild(lab); }
        // off / esp / inset
        const mkNum = (label, key, def, ph) => {
          const lab = document.createElement("label"); lab.className = "field"; lab.innerHTML = "<span>" + label + "</span>";
          const inp = document.createElement("input"); inp.type = "text"; inp.inputMode = "decimal"; inp.value = st[key] != null ? st[key] : def; if (ph) inp.placeholder = ph;
          inp.addEventListener("input", (e2) => { st[key] = e2.target.value; onChange(); });
          inp.addEventListener("blur", (e2) => { const r = ev(e2.target.value); if (r != null && !isNaN(r)) { st[key] = f(r); e2.target.value = st[key]; onChange(); } });
          lab.appendChild(inp); agregarCalc(inp); grid.appendChild(lab);
        };
        mkNum("Distancia a la esquina (m)", "off", "0.1");
        mkNum("Espaciado (m)", "esp", "0.1");
        mkNum("Inset (m)", "inset", "0");
        // Giro del set en bloque (solo ojetillos): pivote = 1er ojetillo. 0° = sobre la arista, + hacia adentro.
        if (!esStrap) mkNum("Giro del set (°)", "angulo", "0", "0 = sobre la arista, + hacia adentro");
        if (esStrap) { mkNum("↑ del set (m)", "up", "", "hereda del strap"); mkNum("↓ del set (m)", "down", "", "hereda del strap"); }
        row.appendChild(grid);
        // Rótulo del set en el plano (opt-in): nombre + 2ª línea técnica (cantidad · espaciado · esquina · inset).
        const rl = document.createElement("label"); rl.className = "chk";
        const rc = document.createElement("input"); rc.type = "checkbox"; rc.checked = !!st.rotulo;
        rc.addEventListener("change", () => { st.rotulo = rc.checked; repintar(); onChange(); });
        rl.appendChild(rc); rl.appendChild(document.createTextNode("Rótulo en el plano (nombre + datos)"));
        row.appendChild(rl);
        if (st.rotulo) {
          const nl = document.createElement("label"); nl.className = "field full"; nl.innerHTML = "<span>Nombre del set (rótulo)</span>";
          const ni = document.createElement("input"); ni.type = "text"; ni.value = st.nombre || ""; ni.placeholder = "ej. Set refuerzo";
          ni.addEventListener("input", (e2) => { st.nombre = e2.target.value; onChange(); });
          nl.appendChild(ni); row.appendChild(nl);
        }
        panel.appendChild(row);
      });
      const add = document.createElement("button"); add.type = "button"; add.className = "btn-outline small"; add.textContent = "+ agregar set";
      add.addEventListener("click", () => { host.sets.push(nuevoSet()); host._setsOpen = true; repintar(); onChange(); });
      panel.appendChild(add);
      wrap.appendChild(panel);
    }
    container.appendChild(wrap);
  }
  function ojEdgesDefault() { return { sup: defOjEdge(), inf: defOjEdge(), izq: defOjEdge(), der: defOjEdge() }; }
  function ojEdgesCopy(e) { const c = {}; ["sup", "inf", "izq", "der"].forEach((k) => { const s = (e && e[k]) || {}; const l2 = s.linea2 || {}; c[k] = { on: s.on !== false, d: s.d != null ? s.d : "0.5", n: s.n != null ? s.n : "", supr: s.supr || "", linea2: { on: !!l2.on, inset: l2.inset != null ? l2.inset : "0.025", supr: l2.supr || "" }, sets: setsCopy(s.sets) }; }); return c; }
  // Parsea posiciones a suprimir. Acepta enteros sueltos y RANGOS con guión inclusivos.
  // Separadores: "," o "/". Ej.: "4-10" => 4,5,6,7,8,9,10 ; "1,2,5-8,22" => 1,2,5,6,7,8,22.
  function parseSupr(s) {
    const out = [];
    String(s || "").split(/[,/;]/).map((x) => x.trim()).filter((x) => x !== "").forEach((tok) => {
      const m = tok.match(/^(\d+)\s*-\s*(\d+)$/);
      if (m) {
        let a = parseInt(m[1], 10), b = parseInt(m[2], 10);
        if (a > b) { const t = a; a = b; b = t; }
        if (b - a > 9999) b = a + 9999; // guarda contra rangos absurdos
        for (let i = a; i <= b; i++) out.push(i);
      } else {
        const n = Math.round(Number(tok));
        if (!isNaN(n) && n >= 0) out.push(n);
      }
    });
    return Array.from(new Set(out)).sort((a, b) => a - b);
  }
  // Rótulos de sets (ojetillos y straps con rotulo=true) → [{x,y,text,detail}] en coords del paño (m).
  // Ancla en el punto medio del set; el detalle resume cantidad · espaciado · esquina · inset.
  function setsRotuloDe(ancho, largo, ojEdges, straps, ctx) {
    const ev = window.CalcCIBSA.evalExpr, f = window.CalcCIBSA.fmtNum, out = [];
    if (ojEdges) ["sup", "inf", "izq", "der"].forEach((k) => {
      const e = ojEdges[k]; if (!e) return;
      const Ldim = (k === "sup" || k === "inf") ? ancho : largo;
      (e.sets || []).forEach((st) => {
        if (!st.rotulo) return;
        const cnt = ev(st.n); if (!(cnt >= 2)) return;
        const esp = ev(st.esp) || 0, insR = ev(st.inset), ins = (insR != null && insR > 0) ? insR : 0, giro = ev(st.angulo) || 0;
        const pts = ojSetPuntos(k, st, ancho, largo);
        if (!pts.length) return;
        const tm = pts[Math.floor(pts.length / 2)];
        // Solo lo que interesa al taller: distanciamiento entre ojetillos, distancia a la arista y giro del set.
        const det = "espaciado " + f(esp) + "m · a " + f(ins) + "m de la arista" + (giro ? " · giro " + f(giro) + "°" : "");
        out.push({ x: tm.x, y: tm.y, text: st.nombre || "Set ojetillos", detail: det });
      });
    });
    (straps || []).forEach((s) => {
      if (s.modo !== "arista") return;
      const e = strapAristaEdge(s.arista || "sup", { ancho: ancho, largo: largo }); if (!e) return;
      const ux = (e.bx - e.ax) / e.len, uy = (e.by - e.ay) / e.len;
      const ar = e.outAng * Math.PI / 180, sdx = Math.cos(ar), sdy = Math.sin(ar);
      const bRaw = ev(s.offBorde), B = Math.max(0, (bRaw != null && !isNaN(bRaw)) ? bRaw : 0.01);
      const pOff = Math.max(0, ev(s.offset) || 0), pIns = Math.max(0, ev(s.inset) || 0);
      (s.sets || []).forEach((st) => {
        if (!st.rotulo) return;
        const cnt = ev(st.n); if (!(cnt >= 2)) return;
        const off = ev(st.off) || 0, esp = ev(st.esp) || 0, insR = ev(st.inset), ins = (insR != null && insR > 0) ? insR : 0;
        const pts = setPosiciones(e.len, cnt, off, esp, setEsqFin(s.arista || "sup", st.esq || setEsqDefault(s.arista || "sup")));
        if (!pts.length) return;
        const tm = pts[Math.floor(pts.length / 2)], Bs = B + ins;
        const x = e.ax + ux * tm - sdx * Bs, y = e.ay + uy * tm - sdy * Bs;
        const c = setCross(st, pOff, pIns), largo = c.up + c.down;
        // Info de taller: largo total de la cinta + distancia del punto de remate/costura a la arista (= offBorde + inset).
        const det = Math.round(cnt) + " cintas · largo " + f(largo) + "m · remate a " + f(Bs) + "m de arista · @" + f(esp) + "m · ↑" + f(c.up) + " ↓" + f(c.down);
        out.push({ x: x, y: y, text: st.nombre || "Set straps", detail: det });
      });
    });
    return out;
  }
  // Devuelve { pos:[{x,y}], total, errores:[], detalle:{sup:{n,kept,d,esp}, ...} }
  // Posiciones de una arista, descontando las esquinas que ya colocan las aristas horizontales
  // (las verticales no repiten esquinas: así cada esquina se suprime con UNA sola supresión).
  function posicionesEdge(k, L, d, parejo, removed, edges, nTot, splits) {
    const ev = window.CalcCIBSA.evalExpr;
    let full;
    if (nTot != null && nTot >= 2) {
      const N = Math.max(2, Math.round(nTot));
      if ((removed && removed.length) || (splits && splits.length)) {
        // Arista seccionada por un corte o dividida por una guía/corte-línea: el "número" no se mantiene
        // fijo; se respeta el DISTANCIAMIENTO que ese número implica (d = L/(N-1)) y se redistribuye sobre
        // los tramos resultantes, poniendo ojetillo en cada esquina nueva.
        const dImp = L / (N - 1);
        full = window.SketchCIBSA.posicionesAristaSeg(L, dImp, !!parejo, removed, splits);
      } else {
        // Sin seccionar ni dividir: N ojetillos repartidos parejo en toda la arista (incluye las 2 esquinas).
        full = []; for (let i = 0; i < N; i++) full.push(L * i / (N - 1));
      }
    } else {
      full = window.SketchCIBSA.posicionesAristaSeg(L, d, !!parejo, removed, splits);
    }
    if (k === "izq" || k === "der") {
      const horizOn = (kk) => { const he = edges && edges[kk]; return !!(he && he.on !== false && ev(he.d) > 0); };
      const supOn = horizOn("sup"), infOn = horizOn("inf");
      full = full.filter((p) => !((p <= 1e-6 && supOn) || (p >= L - 1e-6 && infOn)));
    }
    return full;
  }
  function ojetillosPosiciones(ancho, largo, edges, parejo, cortes, numerar) {
    const SK = window.SketchCIBSA, ev = window.CalcCIBSA.evalExpr;
    const out = [], errs = [], detalle = {}, numeros = [];
    const rem = SK.intervalosCalados(ancho, largo, cortes || []); // bordes seccionados por calados
    const spl = SK.puntosSplitAristas(ancho, largo, cortes || []); // esquinas nuevas por guía / corte-línea
    const proc = (k, L, removed, splits, mapFn) => {
      const e = (edges && edges[k]) || {}, d = ev(e.d), nTot = ev(e.n);
      const usaTotal = (nTot != null && nTot >= 2);
      detalle[k] = { n: 0, kept: 0, d: d > 0 ? d : 0, esp: 0, seccionada: (removed || []).length > 0 || (splits || []).length > 0, total: usaTotal };
      if (!(L > 0)) return;
      // Vector de inset perpendicular hacia adentro del paño, según la arista.
      const insVec = (ins) => (k === "sup") ? { x: 0, y: ins } : (k === "inf") ? { x: 0, y: -ins } : (k === "izq") ? { x: ins, y: 0 } : { x: -ins, y: 0 };
      // Distribución normal: SOLO si la arista está activa y tiene distanciamiento/total. Los sets son independientes.
      if (e.on !== false && (usaTotal || d > 0)) {
        const full = posicionesEdge(k, L, d, parejo, removed, edges, usaTotal ? nTot : null, splits), n = full.length;
        detalle[k].n = n; // el espaciado real (esp) se calcula abajo desde las posiciones instaladas
        // Marcadores de numeración (1er y último ojetillo de la arista) con flecha hacia donde crece
        // el conjunto. Índices 0..n-1 sobre la distribución COMPLETA (los que usa "Suprimir posiciones").
        if (numerar && n >= 1) {
          const dir = (k === "sup" || k === "inf") ? { x: 1, y: 0 } : { x: 0, y: 1 };
          const nrm = k === "sup" ? { x: 0, y: -1 } : k === "inf" ? { x: 0, y: 1 } : k === "izq" ? { x: -1, y: 0 } : { x: 1, y: 0 };
          const p0 = mapFn(full[0]); numeros.push({ x: p0.x, y: p0.y, text: "0", dx: dir.x, dy: dir.y, nx: nrm.x, ny: nrm.y });
          if (n > 1) { const pN = mapFn(full[n - 1]); numeros.push({ x: pN.x, y: pN.y, text: String(n - 1), dx: dir.x, dy: dir.y, nx: nrm.x, ny: nrm.y }); }
        }
        const supr = parseSupr(e.supr), suprSet = new Set(supr);
        supr.forEach((i) => { if (i >= n) errs.push(OJ_NOMBRE[k] + ": posición " + i + " supera el máximo (" + (n - 1) + ")"); });
        const kept = full.filter((_, i) => !suprSet.has(i));
        detalle[k].kept = kept.length;
        // Espaciado REAL = mediana de las separaciones entre ojetillos instalados (en metros a lo largo de
        // la arista). Robusto a secciones/divisiones/supresión; antes usaba L/(n-1) con el largo COMPLETO,
        // lo que inflaba el valor cuando la arista estaba seccionada (ej. 0,91 en vez de 0,50).
        if (kept.length > 1) {
          const gaps = []; for (let i = 1; i < kept.length; i++) gaps.push(kept[i] - kept[i - 1]);
          gaps.sort((a, b) => a - b); detalle[k].esp = gaps[Math.floor(gaps.length / 2)];
        }
        kept.forEach((p) => out.push(mapFn(p)));
        // 2da línea: paralela a la arista, hacia adentro (inset). 0 y n se suprimen solos si se solapan con el perímetro.
        const l2 = e.linea2;
        if (l2 && l2.on) {
          const ins0 = ev(l2.inset), ins = (ins0 != null && ins0 > 0) ? ins0 : 0.025;
          const off = insVec(ins);
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
      }
      // Sets de ojetillos: grupos de N (≥2) desde una esquina, con offset, espaciado, inset y giro opcional (pivote = 1er ojetillo). Conviven con lo anterior.
      let setsN = 0;
      (e.sets || []).forEach((st) => { ojSetPuntos(k, st, ancho, largo).forEach((p) => { out.push(p); setsN++; }); });
      if (setsN) detalle[k].sets = setsN;
    };
    proc("sup", ancho, rem.sup, spl.sup, (p) => ({ x: p, y: 0 }));
    proc("inf", ancho, rem.inf, spl.inf, (p) => ({ x: p, y: largo }));
    proc("izq", largo, rem.izq, spl.izq, (p) => ({ x: 0, y: p }));
    proc("der", largo, rem.der, spl.der, (p) => ({ x: ancho, y: p }));
    const seen = new Set(), pos = [];
    out.forEach((p) => { const key = Math.round(p.x * 1000) + "_" + Math.round(p.y * 1000); if (!seen.has(key)) { seen.add(key); pos.push(p); } });
    return { pos: pos, total: pos.length, errores: errs, detalle: detalle, numeros: numeros };
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
    if (!pz.rotDrag) pz.rotDrag = {};   // offsets manuales de los rótulos de esta pieza (persisten en el snapshot)
    const a = ev(pz.ancho), l = ev(pz.largo);
    const ventanas = visibles(pz.inscritos).map((ins) => {
      const x = ev(ins.padIzq), y = ev(ins.padSup), w = ev(ins.ancho), h = ev(ins.largo);
      return (w > 0 && h > 0) ? { x: (x == null || isNaN(x)) ? 0 : x, y: (y == null || isNaN(y)) ? 0 : y, w: w, h: h, circ: ins.forma === "circ", legend: ins.legend || "", fusion: ins.fusion || {}, rotulo: !!ins.rotulo, id: rotId(ins) } : null;
    }).filter(Boolean);
    const spec = { ancho: a > 0 ? a : 0, largo: l > 0 ? l : 0, ventanas: ventanas, cortes: cortesSpec(pz.cortes), bolsillos: bolsillosDe(pz.bordeModo, pz.bordes), bordesRot: bordesRotuloDe(pz.bordeModo, pz.bordes, pz.bordeValor, pz.bordeRotUnif), unionesRot: unionesRotObj(pz.unionRot, pz.union, pz.orient, ((state.telas.find((t) => t.nombre === pz.telaNombre)) || {}).anchoRollo), setsRot: setsRotuloDe(a > 0 ? a : 0, l > 0 ? l : 0, pz.ojMode === "arista" ? pz.ojEdges : null, pz.straps, { ancho: a > 0 ? a : 0, largo: l > 0 ? l : 0 }), aletas: aletasSpec(pz.aletas), straps: strapsSpec(pz.straps, { ancho: a > 0 ? a : 0, largo: l > 0 ? l : 0 }), cintas: cintasSpec(pz.cintas || [], { ancho: a > 0 ? a : 0, largo: l > 0 ? l : 0 }), cotasOcultas: pz.cotasOcultas, rotDrag: pz.rotDrag };
    if (pz.usaAlto) { const hh = ev(pz.altura); if (hh > 0) spec.volumetrico = { alto: hh }; }
    if (pz.ojMode === "arista") {
      const r = ojetillosPosiciones(spec.ancho, spec.largo, pz.ojEdges, pz.ojParejo, cortesSpec(pz.cortes), !!pz.ojNumerar);
      spec.ojetillosPos = r.pos;
      if (pz.ojNumerar) spec.ojNumeros = r.numeros;
    } else { spec.ojTotal = ojIntPz(pz.ojetillos); if (pz.ojNumerar) spec.ojNumeros = []; }
    return spec;
  }
  // SVG de vista previa: frontal y, si corresponde, trasera (espejo + calados propios) debajo.
  // Hace arrastrables los rótulos-flecha (callouts) del plano en vivo: al soltar, guarda el desplazamiento
  // en state.rotDrag[clave] y re-renderiza (la flecha se redibuja al destino). Se re-cablea en cada render.
  function activarArrastreCallouts(container, store, onChange) {
    store = store || state.rotDrag; onChange = onChange || recompute;   // store: dónde se guardan los offsets (uniforme = state.rotDrag; pieza = pz.rotDrag)
    if (container) container._dragCtx = { store: store, onChange: onChange };   // lo usa la lupa para arrastrar dentro del zoom
    const svg = container && container.querySelector("svg.sketch-svg"); if (!svg || !svg.getScreenCTM) return;
    const mscale = parseFloat(svg.dataset.mscale) || 1; // unidades del viewBox por metro (para guardar en metros)
    const toVB = (cx, cy) => { const m = svg.getScreenCTM(); if (!m) return null; const pt = svg.createSVGPoint(); pt.x = cx; pt.y = cy; return pt.matrixTransform(m.inverse()); };
    container.querySelectorAll(".callout-drag").forEach((g) => {
      // Doble-clic: vuelve el rótulo a su posición automática.
      g.addEventListener("dblclick", (e) => { const rk = g.dataset.rk; if (rk && store[rk]) { e.preventDefault(); e.stopPropagation(); delete store[rk]; onChange(); } });
      g.addEventListener("pointerdown", (e) => {
        const rk = g.dataset.rk; if (!rk) return;
        e.preventDefault(); e.stopPropagation();
        const p0 = toVB(e.clientX, e.clientY); if (!p0) return;
        let last = { dx: 0, dy: 0 };
        try { g.setPointerCapture(e.pointerId); } catch (_) {}
        g.classList.add("dragging");
        // Mientras se arrastra, congela el scroll de la página (iPhone) para no mover el plano bajo el dedo.
        const noScroll = (ev) => ev.preventDefault();
        document.addEventListener("touchmove", noScroll, { passive: false });
        const move = (ev) => { const p = toVB(ev.clientX, ev.clientY); if (!p) return; last = { dx: p.x - p0.x, dy: p.y - p0.y }; g.setAttribute("transform", "translate(" + last.dx.toFixed(1) + "," + last.dy.toFixed(1) + ")"); };
        const up = () => {
          g.removeEventListener("pointermove", move); g.removeEventListener("pointerup", up); g.removeEventListener("pointercancel", up);
          document.removeEventListener("touchmove", noScroll, { passive: false });
          g.classList.remove("dragging");
          if (Math.abs(last.dx) > 0.5 || Math.abs(last.dy) > 0.5) {
            // Clamp: que el rótulo no se salga del lienzo (si no, no se puede volver a seleccionar).
            let dx = last.dx, dy = last.dy;
            try {
              const vb = svg.viewBox && svg.viewBox.baseVal, bb = g.getBBox(); const M = 6;
              if (vb && bb && bb.width) {
                dx = Math.max(M - bb.x, Math.min((vb.width - M) - (bb.x + bb.width), dx));
                dy = Math.max(M - bb.y, Math.min((vb.height - M) - (bb.y + bb.height), dy));
              }
            } catch (_) {}
            const cur = store[rk] || { dx: 0, dy: 0 };   // acumulado en METROS (independiente de escala)
            store[rk] = { dx: (cur.dx || 0) + dx / mscale, dy: (cur.dy || 0) + dy / mscale };
            onChange();
          } else { g.removeAttribute("transform"); }
        };
        g.addEventListener("pointermove", move); g.addEventListener("pointerup", up); g.addEventListener("pointercancel", up);
      });
    });
  }
  function sketchDualSVG(spec, trasera, backCortes, backAletas) {
    let html = window.SketchCIBSA.sketchSVG(spec, { live: true });
    if (spec.volumetrico && (parseFloat(spec.volumetrico.alto) || 0) > 0) return html; // volumétrico: solo vista 3D + desplegado
    if (trasera) {
      const back = Object.assign({}, spec, { espejo: true, vista: "trasera", aletas: backAletas || [] });
      if (backCortes && backCortes.length) back.extraCortes = backCortes;
      html += '<div class="muted small" style="margin:8px 0 2px">Vista trasera (espejo · diseño trasero):</div>' + window.SketchCIBSA.sketchSVG(back);
    }
    return html;
  }
  // Bolsillos por arista (para el dibujo): solo en modo "por arista" y tipo bolsillo.
  // Etiqueta de terminación por arista para rotular en el plano: { sup, inf, izq, der }.
  // Solo se incluye la arista cuyo rótulo el usuario activó (mostrarRot por arista, o rotUnif en modo uniforme).
  function bordesRotuloDe(bordeModo, bordes, bordeValor, rotUnif) {
    const ev = window.CalcCIBSA.evalExpr, f = window.CalcCIBSA.fmtNum;
    const lbl = (b) => {
      if (!b) return "";
      if (b.tipo === "bruto") return "Bruto";
      if (b.tipo === "borde_cuerda") { const d = ev(b.diam); return "Borde + cuerda Ø " + (d > 0 ? f(d) + " m" : "?"); }
      if (b.tipo === "bolsillo") { const d = ev(b.diam); return "Bolsillo Ø " + (d > 0 ? f(d) + " m" : "?"); }
      const v = ev(b.valor); return "Borde " + (v != null && !isNaN(v) ? f(v) : "0,045") + " m";
    };
    if (bordeModo !== "arista" || !bordes) {
      if (!rotUnif) return { sup: "", inf: "", izq: "", der: "" };
      const v = ev(bordeValor); const s = "Borde " + (v != null && !isNaN(v) ? f(v) : "0,045") + " m";
      return { sup: s, inf: s, izq: s, der: s };
    }
    // Los BOLSILLOS no van al rótulo de orientación del lado (se amontonaba en el extremo, rotado);
    // su leyenda sale con flecha/callout (como las aletas), gestionada en el dibujo del bolsillo.
    const pick = (b) => (b && b.mostrarRot && b.tipo !== "bolsillo") ? lbl(b) : "";
    return { sup: pick(bordes.sup), inf: pick(bordes.inf), izq: pick(bordes.izq), der: pick(bordes.der) };
  }
  // Rótulo de uniones entre paños: dibuja las líneas de costura + etiqueta cuando el usuario lo activa.
  function unionesRotObj(mostrar, valor, orient, anchoRollo) {
    const ev = window.CalcCIBSA.evalExpr;
    const v = ev(valor), R = parseFloat(anchoRollo);
    return { mostrar: !!mostrar, valor: (v != null && !isNaN(v)) ? v : 0.045, orient: orient === "ancho" ? "ancho" : "largo", anchoRollo: (R > 0) ? R : 0 };
  }
  function bolsillosDe(bordeModo, bordes) {
    if (bordeModo !== "arista" || !bordes) return [];
    const out = [];
    ["sup", "inf", "izq", "der"].forEach((k) => {
      const b = bordes[k];
      if (b && b.tipo === "bolsillo") { const d = window.CalcCIBSA.evalExpr(b.diam); out.push({ arista: k, diam: (d != null && !isNaN(d)) ? d : 0, rotulo: !!b.mostrarRot }); }
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
  // Checkbox global: plano/cotización "de aprobación" (sin cotas ni datos de taller).
  function suprimeCotas() { const a = $("f_suprimirCotas"), b = $("f_suprimirCotas2"); return !!((a && a.checked) || (b && b.checked)); }
  async function descargarSketch(datos) {
    try {
      datos.suprimirCotas = suprimeCotas();
      // El correlativo se estampa en el plano SOLO si esta cotización ya fue generada (existe en el historial).
      if (datos.correlativo == null) datos.correlativo = correlativoExistente($("f_nombre").value.trim(), $("f_apellido").value.trim(), $("f_version").value.trim() || "01");
      const { bytes, filename } = await window.PDFCotizacion.generarSketchPDF(datos);
      const url = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
      descargar(url, filename);
    } catch (e) { alert("Error al generar el plano:\n" + (e.message || e)); }
  }
  function nombreBaseArchivo() {
    const nombre = $("f_nombre").value.trim(), apellido = $("f_apellido").value.trim(), emp = empresaDatos();
    if ((!nombre || !apellido) && !emp) return "Plano";
    return window.PDFCotizacion.nombreArchivo({ cliente: { nombre, apellido }, empresa: emp, version: $("f_version").value.trim() || "01", fecha: new Date() });
  }
  async function descargarSketchUnif() {
    const largo = num("f_largo", null), ancho = num("f_ancho", null);
    if (largo == null || ancho == null || largo <= 0 || ancho <= 0) return alert("Ingresa largo y ancho para descargar el plano.");
    const telasC = telasParaCotizar();
    const tela = telaActual();
    const telaPlano = telasC.length > 1 ? telasConsideradasTxt(telasC) : (tela ? telaCli(tela) : "N/A");
    const N = Math.max(1, parseInt(num("f_cantidad", 1), 10) || 1);
    await descargarSketch({
      filenameBase: nombreBaseArchivo(),
      titulo: tituloConMedidas() || ("Carpa " + (+largo) + "m x " + (+ancho) + "m"),
      tela: telaPlano,
      color: $("f_color").value.trim(),
      largo: largo, ancho: ancho,
      ojetillos: nOjetillos(), unidades: N,
      ojetillosAristas: state.ojMode === "arista" ? ojDetalleAristas(ancho, largo, state.ojEdges, state.ojParejo, cortesSpec(state.cortesUnif)) : [],
      strapsAristas: strapsDetalleAristas(state.strapsUnif, { ancho: ancho || 0, largo: largo || 0 }),
      observaciones: terminacionesTexto(state.orientUnif).concat(obsComplementos(state.complementosUnif)).concat(obsCortes(state.cortesUnif)),
      materiales: materialesResumen(nOjetillos(), state.complementosUnif, []).concat(materialesCortes(state.cortesUnif)),
      sketch: Object.assign({ ancho: ancho, largo: largo, ventanas: [], cortes: cortesSpec(state.cortesUnif), bolsillos: bolsillosDe(state.bordeModo, state.bordes), bordesRot: bordesRotuloDe(state.bordeModo, state.bordes, state.bordeValor, state.bordeRotUnif), unionesRot: unionesRotObj(state.unionRot, num("f_union", 0.045), state.orientUnif, (telaActual() || {}).anchoRollo), setsRot: setsRotuloDe(ancho || 0, largo || 0, state.ojMode === "arista" ? state.ojEdges : null, state.strapsUnif, { ancho: ancho || 0, largo: largo || 0 }), aletas: aletasSpec(state.aletasUnif), straps: strapsSpec(state.strapsUnif, { ancho: ancho || 0, largo: largo || 0 }), cintas: cintasSpec(state.cintasUnif, { ancho: ancho || 0, largo: largo || 0 }), cotasOcultas: state.cotasOcultas, rotDrag: state.rotDrag }, ojSpecUnif(), alturaUnif() > 0 ? { volumetrico: { alto: alturaUnif() } } : {}),
      trasera: state.trasUnif && !(alturaUnif() > 0),
      backExtra: { cortes: cortesSpec(state.backCortesUnif), aletas: aletasSpec(state.backAletasUnif) },
      materialesTrasera: materialesTraseras(state.backCortesUnif, state.backComplementosUnif),
    });
  }
  // ---------- Plano de corte de taller ----------
  // Describe el layout de corte de una pieza confeccionada en su orientación elegida.
  function cortePiezaDesc(nombre, tela, o, N, dimL, dimA) {
    return {
      nombre: nombre, tela: tela.nombre, rollo: tela.anchoRollo,
      dimL: dimL, dimA: dimA, N: N,
      panosUnit: o.panosUnit, panoLen: o.panoLen, across: o.across, lastStrip: o.lastStrip,
      uniones: o.uniones, panosLote: o.panosLote, m2Lote: o.m2Lote,
      linealLote: Math.round(o.panosLote * o.panoLen * 100) / 100, // m lineales de rollo (lote)
    };
  }
  // Reúne todas las piezas confeccionadas del uniforme (paño base + anexos) con su corte.
  function planoCorteDatos() {
    const piezas = [];
    const tela = telaActual();
    const largo = num("f_largo", null), ancho = num("f_ancho", null);
    const N = Math.max(1, parseInt(num("f_cantidad", 1), 10) || 1);
    if (tela && largo > 0 && ancho > 0) {
      let lote = state.loteUnif; try { if (!lote) lote = loteParaTela(tela, largo, ancho); } catch (e) { lote = null; }
      if (lote) {
        const o = orientDeTela(tela) === "ancho" ? lote.oAncho : lote.oLargo;
        piezas.push(cortePiezaDesc("Paño base", tela, o, N, largo, ancho));
      }
      visibles(state.aletasUnif).forEach((a, i) => {
        const r = calcAleta(a, N, valorOjUnif(), facUnif());
        if (r) piezas.push(cortePiezaDesc((a.legend && a.legend.trim()) ? a.legend.trim() : ((ALETA_NOM[a.tipo] || "Anexo") + " " + (i + 1)), r.tela, r.o, r.N, r.al, r.aa));
      });
    }
    return piezas;
  }
  async function descargarCorte() {
    const piezas = planoCorteDatos();
    if (!piezas.length) return alert("Ingresa largo, ancho y tela del producto para el plano de corte.");
    try {
      const { bytes, filename } = await window.PDFCotizacion.generarPlanoCorte({
        filenameBase: nombreBaseArchivo(),
        titulo: $("f_titulo").value.trim() || null,
        piezas: piezas,
        correlativo: correlativoExistente($("f_nombre").value.trim(), $("f_apellido").value.trim(), $("f_version").value.trim() || "01"),
      });
      descargar(URL.createObjectURL(new Blob([bytes], { type: "application/pdf" })), filename);
    } catch (e) { alert("Error al generar el plano de corte:\n" + (e.message || e)); }
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
      tela: tela ? telaCli(tela) : "N/A",
      color: pz.color || "",
      largo: largo, ancho: ancho,
      ojetillos: ojTotalPieza(pz), unidades: N,
      ojetillosAristas: pz.ojMode === "arista" ? ojDetalleAristas(window.CalcCIBSA.evalExpr(pz.ancho), window.CalcCIBSA.evalExpr(pz.largo), pz.ojEdges, pz.ojParejo, cortesSpec(pz.cortes)) : [],
      strapsAristas: strapsDetalleAristas(pz.straps, { ancho: window.CalcCIBSA.evalExpr(pz.ancho) || 0, largo: window.CalcCIBSA.evalExpr(pz.largo) || 0 }),
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
    // Toggle numeración: muestra en el plano el índice del 1er y último ojetillo de cada arista, con una
    // flecha hacia donde crece la numeración. Ayuda a saber qué posición suprimir (solo en el plano de la app).
    const ln = document.createElement("label"); ln.className = "chk";
    const cbn = document.createElement("input"); cbn.type = "checkbox"; cbn.checked = !!host.ojNumerar;
    cbn.addEventListener("change", (e) => { host.ojNumerar = e.target.checked; onChange(); });
    const spn = document.createElement("span"); spn.textContent = "Mostrar numeración (1er y último ojetillo por arista, con flecha)";
    ln.appendChild(cbn); ln.appendChild(spn); addHelpTo(ln, "Dibuja en el plano el número de posición del primer ojetillo (0) y del último de cada arista, con una flecha hacia donde crece la numeración. Sirve para saber qué posición estás suprimiendo. Solo se ve en el plano de la app, no en el PDF.", "OJ-NUMERAR"); container.appendChild(ln);
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
        ld.appendChild(id); agregarCalc(id); addHelpTo(ld, "Separación deseada entre ojetillos en esa arista, en metros. La app pone uno en cada esquina y reparte el resto; si el último tramo supera esta medida, agrega uno al medio.", "OJ-DIST");
        { const Lar = getL(), fN = window.CalcCIBSA.fmtNum;
          const note = document.createElement("span"); note.className = "muted small"; note.style.display = "block"; note.style.marginTop = "2px";
          note.textContent = (Lar > 0) ? ("Largo de esta arista: " + fN(Lar) + " m.") : "Define las dimensiones del paño base.";
          ld.appendChild(note); }
        grid.appendChild(ld);
        // Alternativa: total uniforme por arista (≥ 2). Si se define, manda sobre el distanciamiento.
        const lt = document.createElement("label"); lt.className = "field"; lt.innerHTML = "<span>o Total uniforme (≥ 2)</span>";
        const it = document.createElement("input"); it.type = "text"; it.inputMode = "numeric"; it.value = e.n != null ? e.n : ""; it.placeholder = "opcional";
        if (ev(e.n) >= 2) id.disabled = true;
        it.addEventListener("input", (ev2) => { e.n = ev2.target.value; refrescar(); onChange(); });
        it.addEventListener("blur", (ev2) => { const r = ev(ev2.target.value); if (r != null && !isNaN(r) && r >= 2) { e.n = String(Math.round(r)); ev2.target.value = e.n; } else { e.n = ""; ev2.target.value = ""; } repintar(); onChange(); });
        lt.appendChild(it); agregarCalc(it); addHelpTo(lt, "Alternativa al distanciamiento: cuántos ojetillos repartir UNIFORMEMENTE en esta arista. Mínimo 2 (solo las esquinas); 3 o más agregan interiores parejos. Si lo defines, manda sobre el distanciamiento; déjalo vacío para volver al distanciamiento.", "OJ-TOTAL"); grid.appendChild(lt);
        const ls = document.createElement("label"); ls.className = "field"; ls.innerHTML = "<span>Suprimir posiciones (ej. 1, 3, 5-8)</span>";
        const is = document.createElement("input"); is.type = "text"; is.value = e.supr || ""; is.placeholder = "ej. 1, 3, 5-8";
        is.addEventListener("input", (ev2) => { e.supr = ev2.target.value; refrescar(); onChange(); });
        ls.appendChild(is); addHelpTo(ls, "Quita ojetillos puntuales por su número de orden en la arista (empezando en 0 desde la esquina). Acepta unidades sueltas y rangos con guión (inclusivos), ej. \"0, 3\", \"2/5\" o \"5-8\" (= 5,6,7,8).", "OJ-SUPR"); grid.appendChild(ls);
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
          const ls2 = document.createElement("label"); ls2.className = "field"; ls2.innerHTML = "<span>Suprimir de la 2da línea (ej. 1, 3, 5-8)</span>";
          const is2 = document.createElement("input"); is2.type = "text"; is2.value = e.linea2.supr || ""; is2.placeholder = "ej. 2, 4-6";
          is2.addEventListener("input", (ev2) => { e.linea2.supr = ev2.target.value; refrescar(); onChange(); });
          ls2.appendChild(is2); addHelpTo(ls2, "Quita ojetillos puntuales de la 2da línea por su número de orden (0 desde la esquina). Los 0 y n ya se suprimen solos si se solapan con el borde.", "OJ-L2-SUPR"); g2.appendChild(ls2);
          panel.appendChild(g2);
          card.appendChild(panel);
          subColapsar(panel, "2da línea — opciones", e.linea2, "_colap", () => true);
        }
        const info = document.createElement("div"); info.className = "muted small oj-edge-info"; card.appendChild(info);
        function refrescar() {
          const L = getL(), d = ev(e.d), nTot = ev(e.n), usaTotal = (nTot != null && nTot >= 2);
          const tl = container.querySelector(".pz-oj-total");
          if (!(L > 0) || (!usaTotal && !(d > 0))) { info.textContent = "Define dimensiones y distanciamiento (o total uniforme)."; if (tl) tl.textContent = "Total: " + getTotal(); return; }
          const removed = getCortes ? (window.SketchCIBSA.intervalosCalados(getAncho(), getLargo(), getCortes())[k] || []) : [];
          const splits = getCortes ? (window.SketchCIBSA.puntosSplitAristas(getAncho(), getLargo(), getCortes())[k] || []) : [];
          const full = posicionesEdge(k, L, d, host.ojParejo, removed, edges, usaTotal ? nTot : null, splits), n = full.length;
          const supr = parseSupr(e.supr), kept = n - supr.filter((i) => i < n).length;
          const sinEsq = (k === "izq" || k === "der") && n < window.SketchCIBSA.posicionesAristaSeg(L, d, !!host.ojParejo, removed, splits).length;
          let html = n + " ojetillos (0.." + (n - 1) + ")";
          if (sinEsq) html += " · <span style=\"color:var(--accent)\">esquinas las pone la arista horizontal</span>";
          if (removed.length) {
            html += " · <span style=\"color:var(--accent)\">borde seccionado por calado (ojetillo en cada esquina nueva)</span>";
          } else if (splits.length) {
            html += " · <span style=\"color:var(--accent)\">arista dividida por guía/corte (ojetillo en cada esquina nueva)</span>";
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
      } else {
        const off = document.createElement("p"); off.className = "muted small"; off.textContent = "Arista sin distribución (0 ojetillos). Puedes agregar SETS independientes abajo.";
        card.appendChild(off);
      }
      // "+SETS": grupos de ojetillos (≥2) desde una esquina, INDEPENDIENTES de la distribución normal.
      // Disponibles aunque la arista esté en 0 / desactivada: así puedes tener solo sets sin ojetillos sueltos.
      renderSetsEditor(card, e, k, "ojetillos", repintar, onChange);
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
        <div class="pz-cintas"></div>
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
      state.telas.forEach((t) => { const o = document.createElement("option"); o.value = t.nombre; o.textContent = t.nombre; tsel.appendChild(o); }); // el nombre ya incluye Proveedor · Modelo · Formato
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
      renderAletas(q(".pz-aletas"), { aletas: pz.aletas, cantidad: () => Math.max(1, parseInt(window.CalcCIBSA.evalExpr(pz.cantidad) || 1, 10) || 1), valorOj: () => num("f_ojvalor", CFG.VALOR_OJETILLO_DEFAULT), factor: () => facPz(pz), onChange: recomputeCompuesto, telaBase: () => pz.telaNombre, baseListo: () => (window.CalcCIBSA.evalExpr(pz.largo) > 0 && window.CalcCIBSA.evalExpr(pz.ancho) > 0 && !!pz.telaNombre) });
      renderStraps(q(".pz-straps"), { straps: (pz.straps || (pz.straps = [])), cantidad: () => Math.max(1, parseInt(window.CalcCIBSA.evalExpr(pz.cantidad) || 1, 10) || 1), getAncho: () => window.CalcCIBSA.evalExpr(pz.ancho), getLargo: () => window.CalcCIBSA.evalExpr(pz.largo), onChange: recomputeCompuesto });
      renderCintas(q(".pz-cintas"), { cintas: (pz.cintas || (pz.cintas = [])), getAncho: () => window.CalcCIBSA.evalExpr(pz.ancho), getLargo: () => window.CalcCIBSA.evalExpr(pz.largo), onChange: recomputeCompuesto });
      subColapsar(q(".pz-oj-wrap"), "Ojetillos", pz, "_cOj", () => (pz.ojMode === "arista") || (parseInt(pz.ojetillos || 0, 10) > 0));
      subColapsar(q(".pz-straps"), "Straps / cintas", pz, "_cStr", () => (pz.straps || []).length);
      subColapsar(q(".pz-cintas"), "Cintas / cierres", pz, "_cCin", () => (pz.cintas || []).length);
      subColapsar(q(".pz-borde"), "Bordes y uniones", pz, "_cBorde", () => false);
      subColapsar(q(".pz-comp"), "Complementos", pz, "_cComp", () => (pz.complementos || []).length);
      subColapsar(q(".pz-ins"), "Inscribir paños (ventanas)", pz, "_cIns", () => (pz.inscritos || []).length);
      subColapsar(q(".pz-cortes"), "Cortes / Calados", pz, "_cCut", () => (pz.cortes || []).length);
      subColapsar(q(".pz-aletas"), "Aletas / Solapas / Faldón / Cenefa", pz, "_cAle", () => (pz.aletas || []).length);
      // Navegación de sub-menús de la pieza (mismo estilo que la nav de fichas), bajo el título.
      {
        const subs = [
          [".pz-oj-wrap", "Ojetillos", "_cOj"], [".pz-borde", "Bordes y uniones", "_cBorde"],
          [".pz-comp", "Complementos", "_cComp"], [".pz-ins", "Paños inscritos", "_cIns"],
          [".pz-cortes", "Cortes / Calados", "_cCut"], [".pz-aletas", "Aletas / Anexos", "_cAle"],
          [".pz-straps", "Straps / cintas", "_cStr"],
        ];
        const navS = document.createElement("div"); navS.className = "ficha-nav pieza-submenu-nav";
        subs.forEach(([sel, titulo, key]) => {
          const cont = q(sel); if (!cont || !cont._subHead) return;
          const a = document.createElement("a"); a.className = "ficha-nav-item"; a.href = "#"; a.textContent = titulo;
          a.addEventListener("click", (e) => { e.preventDefault(); if (pz[key]) cont._subHead.click(); try { cont._subHead.scrollIntoView({ behavior: "smooth", block: "center" }); } catch (_) { cont._subHead.scrollIntoView(); } });
          navS.appendChild(a);
        });
        // Último vínculo (siempre): "Ver plano" de la pieza, en verde destacado.
        const pl = document.createElement("a"); pl.className = "ficha-nav-item ficha-nav-plano"; pl.href = "#";
        pl.textContent = "▣ Ver plano";
        pl.addEventListener("click", (e) => { e.preventDefault(); const sk = q(".pz-sketch"); if (sk) { try { sk.scrollIntoView({ behavior: "smooth", block: "center" }); } catch (_) { sk.scrollIntoView(); } flashTitulo(sk); } });
        navS.appendChild(pl);
        const ph = q(".pieza-head");
        if (ph && navS.children.length) ph.insertAdjacentElement("afterend", navS);
      }

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
        renderAletas(backC.querySelector(".pz-back-aletas"), { aletas: pz.backAletas, cantidad: () => Math.max(1, parseInt(window.CalcCIBSA.evalExpr(pz.cantidad) || 1, 10) || 1), valorOj: () => num("f_ojvalor", CFG.VALOR_OJETILLO_DEFAULT), factor: () => facPz(pz), onChange: recomputeCompuesto, telaBase: () => pz.telaNombre, baseListo: () => (window.CalcCIBSA.evalExpr(pz.largo) > 0 && window.CalcCIBSA.evalExpr(pz.ancho) > 0 && !!pz.telaNombre) });
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
  // Paños inscritos que ATRAVIESAN la pieza (su medida iguala la de la pieza en un eje): dejan de ser
  // "ventana" y pasan a componer el paño. En ese caso el material base solo cubre el remanente, así que
  // se descuenta su ancho/largo del paño base (el inscrito ya se cobra aparte en su propia tela).
  function inscritosThrough(pz, A, L) {
    const ev = window.CalcCIBSA.evalExpr; let dAncho = 0, dLargo = 0;
    visibles(pz.inscritos).forEach((ins) => {
      const w = ev(ins.ancho), h = ev(ins.largo);
      if (!(w > 0) || !(h > 0)) return;
      if (Math.abs(h - L) < 1e-6) dAncho += w;        // franja a lo largo → reduce el ancho del base
      else if (Math.abs(w - A) < 1e-6) dLargo += h;   // franja a lo ancho → reduce el largo del base
    });
    return { dAncho, dLargo };
  }
  function calcPieza(pz) {
    const tela = state.telas.find((t) => t.nombre === pz.telaNombre);
    const largo = window.CalcCIBSA.evalExpr(pz.largo);
    const ancho = window.CalcCIBSA.evalExpr(pz.ancho);
    if (!tela || largo == null || ancho == null || largo <= 0 || ancho <= 0) return null;
    const u = window.CalcCIBSA.evalExpr(pz.union);
    // Reduce el paño base por las franjas inscritas que atraviesan (degenerado: si el remanente queda en 0, no reduce).
    const thr = inscritosThrough(pz, ancho, largo);
    let anchoB = ancho - thr.dAncho, largoB = largo - thr.dLargo;
    if (anchoB < 1e-6 || largoB < 1e-6) { anchoB = ancho; largoB = largo; }
    let lote;
    try {
      lote = window.CalcCIBSA.calcularLote({
        largo: largoB, ancho: anchoB, valorM2: tela.valorM2, anchoRollo: tela.anchoRollo,
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

  // Descuento de "Condiciones": por defecto en % (sobre el subtotal de carpa). Si el checkbox "monto"
  // está marcado, el campo es un monto fijo en $. Devuelve pct equivalente, monto, etiqueta y flag.
  function descMontoOn() { const c = $("f_descMonto"); return !!(c && c.checked); }
  function actualizarDescSuffix() { const s = $("descSuffix"); if (s) s.textContent = descMontoOn() ? "$" : "%"; }
  function descuentoInfo(subtotal) {
    const sub = Math.max(0, subtotal || 0), raw = num("f_descuento", 0) || 0;
    if (descMontoOn()) {
      const monto = Math.min(Math.max(0, Math.round(raw)), sub);
      const pct = sub > 0 ? (monto / sub * 100) : 0;
      return { esMonto: true, pct, monto, label: monto > 0 ? `Descuento ${money(monto)} (pago contado)` : null };
    }
    let pct = raw > 0 ? raw : 0; if (pct > 100) pct = 100;
    const monto = Math.round(sub * pct / 100);
    return { esMonto: false, pct, monto, label: pct > 0 ? `Descuento ${window.CalcCIBSA.fmtNum(pct)}% (pago contado)` : null };
  }
  function recomputeCompuesto() {
    const list = $("piezasList"), resumen = $("piezasResumen");
    let subtotalGen = 0; const calcs = [];
    state.piezas.forEach((pz) => {
      const r = calcPieza(pz);
      const sketchBox = list ? list.querySelector('[data-id="' + pz.id + '"] .pz-sketch') : null;
      if (sketchBox && window.SketchCIBSA && !document.body.classList.contains("no-plano")) {
        sketchBox.innerHTML = sketchDualSVG(sketchPieza(pz), pz.trasera, cortesSpec(pz.backCortes), aletasSpec(pz.backAletas));
        activarArrastreCallouts(sketchBox, pz.rotDrag, recomputeCompuesto);
        const refrescarOcPz = () => { renderPiezas(); recompute(); };
        menuPlano(sketchBox, [
          { label: "Cortes / Calados", items: (pz.cortes || []).map((c, i) => ({ obj: c, titulo: ((c.tipo === "guia") ? "Guía " : (c.tipo === "corte") ? "Corte " : "Calado ") + (i + 1) + (c.legend && c.legend.trim() ? " — " + c.legend.trim() : "") })) },
          { label: "Paños inscritos", rotulo: true, items: (pz.inscritos || []).map((ins, i) => ({ obj: ins, titulo: "Paño " + (i + 1) + (ins.legend && ins.legend.trim() ? " — " + ins.legend.trim() : "") })) },
          { label: "Aletas / Anexos", rotulo: true, items: (pz.aletas || []).map((a, i) => ({ obj: a, titulo: "Anexo " + (i + 1) + (a.legend && a.legend.trim() ? " — " + a.legend.trim() : "") })) },
          { label: "Straps / cintas", items: (pz.straps || []).map((s, i) => ({ obj: s, titulo: "Strap " + (i + 1) + (s.legend && s.legend.trim() ? " — " + s.legend.trim() : "") })) },
          { label: "Cintas / cierres", rotulo: true, items: (pz.cintas || []).map((c, i) => ({ obj: c, titulo: "Cinta " + (i + 1) + (c.legend && c.legend.trim() ? " — " + c.legend.trim() : "") })) },
        ], refrescarOcPz, { cotas: cotasDeSpec(sketchPieza(pz)), ocultas: pz.cotasOcultas, onChange: refrescarOcPz },
          (pz.ojMode === "arista" || hayOjEnCortes(pz.cortes)) ? { on: !!pz.ojNumerar, toggle: () => { pz.ojNumerar = !pz.ojNumerar; refrescarOcPz(); } } : null);
        menuBordesRot(sketchBox, pz, () => { const bc = document.querySelector('[data-id="' + pz.id + '"] .pz-borde'); if (bc) renderPiezaBordes(bc, pz); recomputeCompuesto(); }, () => document.querySelector('[data-id="' + pz.id + '"] .pz-borde'), () => { const w = document.querySelector('[data-id="' + pz.id + '"] .pz-oj-wrap'); if (!w) return; if (w._subHead && w.style.display === "none") w._subHead.click(); irAElemento(w._subHead || w, w._subHead || w); });
      }
      const card = list ? list.querySelector('[data-id="' + pz.id + '"] .pieza-sub') : null;
      if (r) {
        const compUnit = compTotalUnit(pz.complementos);
        const insTot = inscritosTotal(pz);
        const valOjPz = num("f_ojvalor", CFG.VALOR_OJETILLO_DEFAULT);
        const aleTot = aletasTotal(pz.aletas, r.lote.N, valOjPz, facPz(pz)) + aletasTotal(pz.backAletas, r.lote.N, valOjPz, facPz(pz));
        const strapTot = strapsTotal(pz.straps, r.lote.N, { ancho: window.CalcCIBSA.evalExpr(pz.ancho) || 0, largo: window.CalcCIBSA.evalExpr(pz.largo) || 0 });
        const cintaTot = cintasTotal(pz.cintas || [], r.lote.N, { ancho: window.CalcCIBSA.evalExpr(pz.ancho) || 0, largo: window.CalcCIBSA.evalExpr(pz.largo) || 0 });
        const corteTot = costoCortesUnit(sketchPieza(pz), valOjPz) * r.lote.N;
        const piezaTotal = r.o.subtotalLote + compUnit * r.lote.N + insTot + aleTot + strapTot + cintaTot + corteTot;
        r.compUnit = compUnit; r.insTot = insTot; r.aleTot = aleTot; r.strapTot = strapTot; r.cintaTot = cintaTot; r.corteTot = corteTot; r.piezaTotal = piezaTotal;
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
    const dI = descuentoInfo(subtotalGen);
    const desc = dI.pct, descuento = dI.monto;
    const neto = subtotalGen - descuento;
    const iva = Math.round(neto * CFG.IVA_PCT / 100);
    const total = neto + iva;
    let resumenHTML;
    if (!calcs.length) {
      resumenHTML = '<p class="muted small">Agrega piezas con largo, ancho y tela para ver el total.</p>';
    } else {
      let h = '<div class="cmp-card"><div class="h">Resumen (' + calcs.length + ' pieza' + (calcs.length > 1 ? 's' : '') + ')</div>';
      h += `<div class="muted small">Subtotal neto: ${money(subtotalGen)}</div>`;
      if (descuento > 0) { h += `<div class="muted small">${dI.esMonto ? "Descuento (monto)" : "Descuento " + window.CalcCIBSA.fmtNum(desc) + "%"}: -${money(descuento)}</div>`; h += `<div class="muted small">Neto con descuento: ${money(neto)}</div>`; }
      h += `<div class="muted small">IVA ${CFG.IVA_PCT}%: ${money(iva)}</div>`;
      h += `<div class="total">${money(total)}</div></div>`;
      resumenHTML = h;
    }
    if (resumen) resumen.innerHTML = resumenHTML;
    { const rb = $("piezasResumenBottom"); if (rb) rb.innerHTML = resumenHTML; }
    state.compuesto = { calcs, subtotalGen, desc, descuento, neto, iva, total };
    renderPreviewCompuesto();
  }

  // Vista previa consolidada de los planos de todas las piezas (compuesto): cada plano plegable + descarga.
  function renderPreviewCompuesto() {
    const cont = $("previewCompuesto"); if (!cont) return;
    cont.innerHTML = "";
    const ev = window.CalcCIBSA.evalExpr;
    if (!state.piezas.length) { cont.innerHTML = '<p class="muted small">Agrega piezas para ver sus planos aquí.</p>'; return; }
    state.piezas.forEach((pz, idx) => {
      const a = ev(pz.ancho), l = ev(pz.largo);
      const etq = (pz.etiqueta && pz.etiqueta.trim()) ? " — " + pz.etiqueta.trim() : "";
      const titulo = "Pieza " + (idx + 1) + etq;
      const block = document.createElement("div"); block.className = "prev-block";
      const head = document.createElement("button"); head.type = "button"; head.className = "prev-head";
      const body = document.createElement("div"); body.className = "prev-body";
      const aplic = () => { const c = !!pz._cPrev; body.style.display = c ? "none" : ""; head.textContent = (c ? "▸ " : "▾ ") + titulo; };
      head.addEventListener("click", () => { pz._cPrev = !pz._cPrev; aplic(); });
      block.appendChild(head); block.appendChild(body);
      if (!(a > 0) || !(l > 0)) {
        body.innerHTML = '<p class="muted small">Completa largo y ancho de esta pieza.</p>';
      } else {
        const sk = document.createElement("div"); sk.className = "sketch"; sk.id = "prevsk_" + pz.id;
        if (window.SketchCIBSA && !document.body.classList.contains("no-plano")) { sk.innerHTML = sketchDualSVG(sketchPieza(pz), pz.trasera, cortesSpec(pz.backCortes), aletasSpec(pz.backAletas)); activarArrastreCallouts(sk, pz.rotDrag, recomputeCompuesto); }
        body.appendChild(sk);
        const dl = document.createElement("button"); dl.type = "button"; dl.className = "btn-outline"; dl.textContent = "Descargar plano (PDF)";
        dl.addEventListener("click", () => descargarSketchPieza(pz));
        body.appendChild(dl);
        const refrescarOcPz = () => { renderPiezas(); recompute(); };
        menuPlano(body, [
          { label: "Cortes / Calados", items: (pz.cortes || []).map((c, i) => ({ obj: c, titulo: ((c.tipo === "guia") ? "Guía " : (c.tipo === "corte") ? "Corte " : "Calado ") + (i + 1) + (c.legend && c.legend.trim() ? " — " + c.legend.trim() : "") })) },
          { label: "Paños inscritos", rotulo: true, items: (pz.inscritos || []).map((ins, i) => ({ obj: ins, titulo: "Paño " + (i + 1) + (ins.legend && ins.legend.trim() ? " — " + ins.legend.trim() : "") })) },
          { label: "Aletas / Anexos", rotulo: true, items: (pz.aletas || []).map((a, i) => ({ obj: a, titulo: "Anexo " + (i + 1) + (a.legend && a.legend.trim() ? " — " + a.legend.trim() : "") })) },
          { label: "Straps / cintas", items: (pz.straps || []).map((s, i) => ({ obj: s, titulo: "Strap " + (i + 1) + (s.legend && s.legend.trim() ? " — " + s.legend.trim() : "") })) },
          { label: "Cintas / cierres", rotulo: true, items: (pz.cintas || []).map((c, i) => ({ obj: c, titulo: "Cinta " + (i + 1) + (c.legend && c.legend.trim() ? " — " + c.legend.trim() : "") })) },
        ], refrescarOcPz, { cotas: cotasDeSpec(sketchPieza(pz)), ocultas: pz.cotasOcultas, onChange: refrescarOcPz },
          (pz.ojMode === "arista" || hayOjEnCortes(pz.cortes)) ? { on: !!pz.ojNumerar, toggle: () => { pz.ojNumerar = !pz.ojNumerar; refrescarOcPz(); } } : null);
        menuBordesRot(body, pz, () => { const bc = document.querySelector('[data-id="' + pz.id + '"] .pz-borde'); if (bc) renderPiezaBordes(bc, pz); recomputeCompuesto(); }, () => document.querySelector('[data-id="' + pz.id + '"] .pz-borde'), () => { const w = document.querySelector('[data-id="' + pz.id + '"] .pz-oj-wrap'); if (!w) return; if (w._subHead && w.style.display === "none") w._subHead.click(); irAElemento(w._subHead || w, w._subHead || w); });
      }
      aplic();
      cont.appendChild(block);
    });
  }

  // ---------- Limpiar todos los campos de la App ----------
  // Deja la App como recién abierta. NO toca el historial (que es persistente).
  // Se usa: botón "Limpiar", al abrir/reiniciar la App y antes de aplicar un registro del historial.
  // mantenerCliente=true: borra toda la cotización pero conserva los datos del cliente (nombre, apellido,
  // correo, dirección, comuna y los datos de empresa). false: limpia todo, incluido el cliente.
  function limpiarCampos(mantenerCliente) {
    ["f_largo", "f_ancho", "f_titulo", "f_observaciones", "f_color"].forEach((id) => { const el = $(id); if (el) el.value = ""; });
    if (!mantenerCliente) {
      ["f_nombre", "f_apellido", "f_email", "f_dir_cliente", "f_comuna_cliente",
       "f_emp_rut", "f_emp_razon", "f_emp_giro", "f_emp_dir", "f_emp_comuna", "f_emp_email"].forEach((id) => { const el = $(id); if (el) el.value = ""; });
      const eo = $("f_empresaOn"); if (eo) eo.checked = false; if (typeof toggleEmpresa === "function") toggleEmpresa();
    }
    // El carro a granel es parte de la cotización: se borra en ambos casos.
    state.granelLineas = []; granelSel = null;
    $("f_cantidad").value = "1"; $("f_ojvalor").value = "450"; $("f_dias").value = "3"; $("f_descuento").value = "0"; $("f_version").value = "01";
    { const dm = $("f_descMonto"); if (dm) dm.checked = false; actualizarDescSuffix(); }
    $("f_union").value = "0.045";
    $("f_usaAlto").checked = false; $("f_altura").value = ""; $("wAltura").classList.add("hidden");
    state.ojMode = "total"; state.ojTotal = 8; state.ojAristas = []; state.ojEdges = null; state.ojParejo = false; state.trasUnif = false; state.ojSubstate = "count"; state.ojAristasN = 4; state.ojError = "";
    state.cortesUnif = []; state.backCortesUnif = []; state.backComplementosUnif = []; state.aletasUnif = []; state.backAletasUnif = []; state.strapsUnif = []; state.cintasUnif = []; state.factorUnif = "1";
    { const t = $("f_trasUnif"); if (t) t.checked = false; }
    document.querySelector('input[name="ojmode"][value="total"]').checked = true;
    state.orientacionSel = "mayor"; state.orientUnif = "largo"; $("resultHolder").innerHTML = ""; $("formStatus").textContent = "";
    const multi = $("telaMulti"); if (multi) multi.querySelectorAll("input:checked").forEach((c) => (c.checked = false));
    { const to = $("telaOpcList"); if (to) to.querySelectorAll("input:checked").forEach((c) => (c.checked = false)); }
    { const tg = $("f_telaGlobalOn"); if (tg) tg.checked = false; const tgl = $("telaGlobalList"); if (tgl) tgl.querySelectorAll("input:checked").forEach((c) => (c.checked = false)); const tgb = $("telaGlobalBody"); if (tgb) tgb.classList.add("hidden"); }
    favCatActiva = null; renderCategoriasFav();
    { const sc = $("f_suprimirCotas"); if (sc) sc.checked = false; const sc2 = $("f_suprimirCotas2"); if (sc2) sc2.checked = false; const nh = $("f_noHist"); if (nh) nh.checked = false; }
    _editHist = null; ocultarEdicionBanner();   // limpiar cancela cualquier edición de registro en curso
    $("telaMultiErr").classList.add("hidden"); state.prelim = [];
    // Reset bordes/unión → mismo borde 0.045
    state.bordeModo = "uniforme"; state.bordeValor = "0.045";
    state.bordes = { sup: { tipo: "borde", valor: "0.045", diam: "" }, inf: { tipo: "borde", valor: "0.045", diam: "" }, izq: { tipo: "borde", valor: "0.045", diam: "" }, der: { tipo: "borde", valor: "0.045", diam: "" } };
    const rb = document.querySelector('input[name="bordemodo"][value="uniforme"]'); if (rb) rb.checked = true;
    // Reset producto compuesto → vuelve a uniforme
    state.prodMode = "uniforme"; state.piezas = []; state.compuesto = null;
    state.complementosUnif = [];
    const ru = document.querySelector('input[name="prodmode"][value="uniforme"]'); if (ru) ru.checked = true;
    renderPiezas(); renderBordes(); renderComplementosUnif(); renderCortesUnif(); renderAletasUnif(); renderStrapsUnif(); renderCintasUnif(); renderTraseraUnif(); setFactorUnifUI(); aplicarVis();
    renderGranelLineas(); renderGranel(); renderOjetillos(); recompute();
  }
  // "Limpiar" (junto a Generar) borra TODO; "Limpiar (mantener cliente)" en Datos del cliente conserva al cliente.
  { const full = () => { limpiarBorrador(); limpiarCampos(false); };
    const b1 = $("btnLimpiar"); if (b1) b1.addEventListener("click", full);
    const bc = $("btnLimpiarCotiz"); if (bc) bc.addEventListener("click", () => { limpiarBorrador(); limpiarCampos(true); }); }
  { const c = $("f_empresaOn"); if (c) c.addEventListener("change", toggleEmpresa); }
  { const c = $("f_telaGlobalOn"); if (c) c.addEventListener("change", toggleTelaGlobal); }
  { const c = $("f_descMonto"); if (c) c.addEventListener("change", () => { actualizarDescSuffix(); recompute(); }); actualizarDescSuffix(); }
  { const b = $("btnEscanearQR"); if (b) b.addEventListener("click", abrirQR); }
  { const b = $("qrCerrar"); if (b) b.addEventListener("click", cerrarQR); }

  // ---------- Generar ----------
  // Mantiene sincronizados los dos checkboxes de "Suprimir cotas" (arriba y bajo el botón Generar).
  { const a = $("f_suprimirCotas"), b = $("f_suprimirCotas2");
    if (a && b) { a.addEventListener("change", () => { b.checked = a.checked; }); b.addEventListener("change", () => { a.checked = b.checked; }); } }
  $("btnGenerar").addEventListener("click", generar);
  { const b = $("btnDescargarSketch"); if (b) b.addEventListener("click", descargarSketchUnif); }
  { const b = $("btnDescargarCorte"); if (b) b.addEventListener("click", descargarCorte); }
  { const t = $("f_trasUnif"); if (t) t.addEventListener("change", () => { state.trasUnif = t.checked; recompute(); }); }
  { const cb = $("f_usarPlano"); if (cb) cb.addEventListener("change", () => { document.body.classList.toggle("no-plano", !cb.checked); recompute(); }); }

  async function generar() {
    if (state.docMode === "preliminar") return generarPrelim();
    if (state.docMode === "formal" && state.prodMode === "compuesto") return generarCompuesto();
    const nombre = $("f_nombre").value.trim(), apellido = $("f_apellido").value.trim();
    const largo = num("f_largo", null), ancho = num("f_ancho", null), tela = telaActual();
    // Basta con identificar al destinatario: el contacto (nombre+apellido) O la empresa (razón social).
    if ((!nombre || !apellido) && !empresaDatos()) return alert("Ingresa el nombre y apellido del cliente, o al menos la razón social de la empresa.");
    if (!(await prepararVersionHistorial(nombre, apellido))) return;   // pregunta nueva versión / sobrescribir (o cancela)
    // Sin carpa válida: si hay productos a granel, se genera una cotización SOLO de granel.
    const hayCarpa = !!tela && largo != null && ancho != null && largo > 0 && ancho > 0;
    if (!hayCarpa) {
      if (granelLineasPDF().length) return generarGranelSolo(nombre, apellido);
      if (!tela) return alert("Selecciona una tela (o agrega productos a granel).");
      return alert("Largo y ancho deben ser mayores que 0 (o agrega productos a granel).");
    }
    sugerirFactor();
    recomputeUniforme();
    const lote = state.loteUnif;
    if (!lote) return alert("No se pudo calcular. Revisa los datos.");
    const telas = telasParaCotizar();
    const baseV = parseInt(($("f_version").value.trim() || "01"), 10) || 1;
    const pad = (n) => String(n).padStart(2, "0");

    // Una sola tela → cotización individual (comportamiento de siempre).
    if (telas.length <= 1) {
      const { datos, calc } = construirDatosUnif(tela, lote, $("f_version").value.trim() || "01");
      datos.correlativo = guardarHistorial(nombre, apellido, datos.version);
      abrirProgreso();
      try {
        const { bytes, filename } = await window.PDFCotizacion.generarCotizacion(datos);
        genListo(new Blob([bytes], { type: "application/pdf" }), filename, calc);
        if ($("f_planoTaller") && $("f_planoTaller").checked) descargarCorte();
      } catch (e) { cerrarProgreso(); alert("Error al generar el PDF:\n" + (e.message || e)); }
      return;
    }
    // Varias telas → una cotización por cada una (versión correlativa) en un único PDF combinado.
    const datosList = telas.map((t, i) => construirDatosUnif(t, (i === 0 ? lote : loteParaTela(t, largo, ancho)), pad(baseV + i)).datos);
    { const corr = guardarHistorial(nombre, apellido, datosList[0].version + "-" + datosList[datosList.length - 1].version); datosList.forEach((d) => { d.correlativo = corr; }); }
    abrirProgreso();
    try {
      const { bytes, filename } = await window.PDFCotizacion.generarCotizacionCombinada(datosList);
      genListo(new Blob([bytes], { type: "application/pdf" }), filename, null);
    } catch (e) { cerrarProgreso(); alert("Error al generar el PDF:\n" + (e.message || e)); }
  }

  // Cotización SOLO de productos a granel (sin carpa): reusa generarCotizacion con flag soloGranel.
  async function generarGranelSolo(nombre, apellido) {
    const granelLineas = granelLineasPDF();
    if (!granelLineas.length) return alert("Agrega al menos un producto a granel con cantidad.");
    // Solo-granel: el descuento global no aplica; cada línea ya trae su propio descuento.
    const subtotal = granelLineas.reduce((s, g) => s + g.total, 0);
    const neto = subtotal;
    const iva = Math.round(neto * CFG.IVA_PCT / 100);
    const total = neto + iva;
    const calc = { subtotal, descuentoPct: 0, descuento: 0, netoConDescuento: neto, ivaPct: CFG.IVA_PCT, iva, total };
    const datos = {
      soloGranel: true,
      cliente: { nombre, apellido, email: $("f_email").value.trim(), dir: empVal("f_dir_cliente"), comuna: empVal("f_comuna_cliente") }, empresa: empresaDatos(),
      version: $("f_version").value.trim() || "01", fecha: new Date(),
      titulo: $("f_titulo").value.trim() || null,
      diasEntrega: parseInt(num("f_dias", CFG.DIAS_ENTREGA_DEFAULT), 10),
      descuentoLabel: null,
      vendedor: vendedorSel(),
      observaciones: $("f_observaciones").value.trim() || null,
      complementos: [], aletas: [], granel: granelLineas, calc: calc,
    };
    datos.correlativo = guardarHistorial(nombre, apellido, datos.version);
    abrirProgreso();
    try {
      const { bytes, filename } = await window.PDFCotizacion.generarCotizacion(datos);
      genListo(new Blob([bytes], { type: "application/pdf" }), filename, null);
    } catch (e) { cerrarProgreso(); alert("Error al generar el PDF:\n" + (e.message || e)); }
  }

  // Costeo de elementos sobre cortes/calados: ojetillos (línea de corte + bordes de calado) y cut-straps.
  // Usa la geometría (construirSketch) como fuente única, así coincide exactamente con el plano.
  function costoCortesUnit(spec, valorOj) {
    if (!window.SketchCIBSA) return 0;
    let sk; try { sk = window.SketchCIBSA.construirSketch(spec); } catch (e) { return 0; }
    let nOj = 0, strap = 0;
    (sk.cortes || []).forEach((c) => { nOj += (c.ojetillos || []).length; });
    (sk.straps || []).forEach((s) => { if (s.origen === "corte") strap += (s.largo || 0) * (s.precioM || 0); });
    return nOj * (valorOj || 0) + strap;
  }
  function cortesLineasPDF(spec, valorOj, N) {
    if (!window.SketchCIBSA) return [];
    let sk; try { sk = window.SketchCIBSA.construirSketch(spec); } catch (e) { return []; }
    const n = Math.max(1, N || 1), out = [];
    let nOj = 0; (sk.cortes || []).forEach((c) => { nOj += (c.ojetillos || []).length; });
    if (nOj > 0) out.push("Ojetillos en cortes/calados: " + nOj + " u × " + money(valorOj) + " = " + money(nOj * (valorOj || 0) * n));
    const cs = (sk.straps || []).filter((s) => s.origen === "corte");
    if (cs.length) {
      const tot = cs.reduce((a, s) => a + (s.largo || 0) * (s.precioM || 0), 0);
      out.push("Cintas en cortes: " + cs.length + " u — " + money(tot * n));
    }
    return out;
  }
  // Arma el objeto `datos` (y `calc`) de una cotización uniforme para una tela y versión dadas.
  // Anexos (aletas/solapas/faldón/cenefa) con la tela EFECTIVA de la variante: los anexos que usan la tela
  // del paño base (la principal, f_tela) siguen a la tela de esta variante; los que tienen tela propia
  // distinta la conservan. En la variante principal (o tela igual) no cambia nada.
  function aletasEfectivas(list, telaVariante) {
    const principal = $("f_tela") ? $("f_tela").value : "";
    if (!telaVariante || telaVariante === principal) return list || [];
    return (list || []).map((a) => (a.telaNombre === principal) ? Object.assign({}, a, { telaNombre: telaVariante }) : a);
  }
  // Título con las medidas SIEMPRE incluidas: "<título> Largo M x Ancho M [x Alto M]". Si es volumétrico
  // (hay alto), se agrega la tercera medida antecedida de " x ". Sin dimensiones válidas: solo el título.
  function tituloConMedidas() {
    const fN = window.CalcCIBSA.fmtNum;
    const largo = num("f_largo", null), ancho = num("f_ancho", null), alto = alturaUnif();
    const tit = $("f_titulo").value.trim();
    const dims = (largo > 0 && ancho > 0) ? (fN(largo) + "M x " + fN(ancho) + "M" + (alto > 0 ? " x " + fN(alto) + "M" : "")) : "";
    if (!dims) return tit || null;
    return (tit ? tit + " " : "") + dims;
  }
  function construirDatosUnif(tela, lote, versionStr) {
    const nombre = $("f_nombre").value.trim(), apellido = $("f_apellido").value.trim();
    const largo = num("f_largo", null), ancho = num("f_ancho", null);
    const orientKey = orientDeTela(tela);
    const o = orientKey === "ancho" ? lote.oAncho : lote.oLargo;
    const N = lote.N;
    const aletasEf = aletasEfectivas(state.aletasUnif, tela && tela.nombre), backAletasEf = aletasEfectivas(state.backAletasUnif, tela && tela.nombre);
    const skSpec = { ancho: ancho, largo: largo, ojTotal: lote.nOjetillos, ventanas: [], cortes: cortesSpec(state.cortesUnif), bolsillos: bolsillosDe(state.bordeModo, state.bordes), bordesRot: bordesRotuloDe(state.bordeModo, state.bordes, state.bordeValor, state.bordeRotUnif), unionesRot: unionesRotObj(state.unionRot, num("f_union", 0.045), state.orientUnif, (telaActual() || {}).anchoRollo), aletas: aletasSpec(aletasEf), straps: strapsSpec(state.strapsUnif, { ancho: ancho || 0, largo: largo || 0 }), cintas: cintasSpec(state.cintasUnif, { ancho: ancho || 0, largo: largo || 0 }), cotasOcultas: state.cotasOcultas, rotDrag: state.rotDrag };
    const ojeTotal = lote.nOjetillos * lote.valorOjetillo * N;
    const compTotal = compTotalUnit(state.complementosUnif) * N;
    const aleTotal = aletasTotal(aletasEf, N, lote.valorOjetillo, facUnif()) + aletasTotal(backAletasEf, N, lote.valorOjetillo, facUnif());
    const strapTotal = strapsTotal(state.strapsUnif, N, { ancho: ancho || 0, largo: largo || 0 });
    const corteTotal = costoCortesUnit(skSpec, lote.valorOjetillo) * N;
    const cintaTotal = cintasTotal(state.cintasUnif, N, { ancho: ancho || 0, largo: largo || 0 });
    const granelLineas = granelLineasPDF(), granelNeto = granelLineas.reduce((s, g) => s + g.total, 0);
    // El descuento global (pago contado) aplica SOLO a la carpa. El granel ya viene neto
    // con su propio descuento por línea y no recibe el descuento global.
    const carpaSub0 = o.materialLote + ojeTotal + compTotal + aleTotal + strapTotal + corteTotal + cintaTotal;
    // Mínimo de producción de taller (0,6 UF neto POR UNIDAD), con descuento escalonado por unidad,
    // sobre el neto de carpa ANTES del descuento. N unidades idénticas → neto/u = carpaSub0/N.
    const nU = Math.max(1, N), minProd = minProduccionEscalonado(Array(nU).fill(carpaSub0 / nU));
    const carpaSub = carpaSub0 + minProd;
    const dI = descuentoInfo(carpaSub);
    const descuento = dI.monto;
    const subtotal = carpaSub + granelNeto;
    const neto = subtotal - descuento;
    const iva = Math.round(neto * CFG.IVA_PCT / 100);
    const total = neto + iva;
    const calc = {
      cantidad: N,
      material: o.materialLote / N, materialTotal: o.materialLote,
      nOjetillos: lote.nOjetillos, nOjetillosTotal: lote.nOjetillos * N,
      valorOjetillo: lote.valorOjetillo, ojetillosValor: lote.nOjetillos * lote.valorOjetillo,
      ojetillosValorTotal: ojeTotal,
      minProduccion: minProd,
      subtotal, descuentoPct: dI.pct, descuento, netoConDescuento: neto, descuentoEsMonto: dI.esMonto,
      ivaPct: CFG.IVA_PCT, iva, total, panos: o.panosLote, m2: o.m2Lote,
    };
    const datos = {
      cliente: { nombre, apellido, email: $("f_email").value.trim(), dir: empVal("f_dir_cliente"), comuna: empVal("f_comuna_cliente") }, empresa: empresaDatos(),
      version: versionStr, fecha: new Date(), suprimirCotas: suprimeCotas(),
      largo, ancho, tela, calc,
      titulo: tituloConMedidas(),
      ojetillosDetalle: ojDetalle(),
      diasEntrega: parseInt(num("f_dias", CFG.DIAS_ENTREGA_DEFAULT), 10),
      descuentoLabel: dI.label,
      vendedor: vendedorSel(),
      observaciones: $("f_observaciones").value.trim() || null,
      detalleExtra: terminacionesTexto(state.orientUnif),
      complementos: complementosUnifPDF(N),
      aletas: aletasUnifPDF(aletasEf, N).concat(aletasUnifPDF(backAletasEf, N)).concat(strapsUnifPDF(state.strapsUnif, { ancho: ancho || 0, largo: largo || 0 }, N)).concat(cintasUnifPDF(state.cintasUnif, { ancho: ancho || 0, largo: largo || 0 }, N)).concat(cortesUnifPDF(skSpec, lote.valorOjetillo, N)),
      granel: granelLineas,
      minProduccion: minProd, minProdUF: CFG.MIN_PRODUCCION_UF, ufValor: state.ufValor,
      sketch: skSpec,
    };
    return { datos, calc };
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
  // Construye el objeto `datos` del documento compuesto para una versión dada.
  // Recalcula las piezas (respetando cualquier override de tela ya aplicado en state) y arma las filas.
  function construirDatosCompuesto(versionStr, cliente) {
    recomputeCompuesto();
    const calcs = (state.compuesto && state.compuesto.calcs) || [];
    if (!calcs.length) return null;
    const dI = descuentoInfo((state.compuesto && state.compuesto.subtotalGen) || 0);
    const datos = {
      cliente: { nombre: cliente.nombre, apellido: cliente.apellido, email: $("f_email").value.trim(), dir: empVal("f_dir_cliente"), comuna: empVal("f_comuna_cliente") }, empresa: empresaDatos(),
      version: versionStr, fecha: new Date(), suprimirCotas: suprimeCotas(),
      titulo: $("f_titulo").value.trim() || null,
      diasEntrega: parseInt(num("f_dias", CFG.DIAS_ENTREGA_DEFAULT), 10),
      descuentoPct: dI.pct, descuentoEsMonto: dI.esMonto, descuento: dI.monto,
      descuentoLabel: dI.label,
      minProdUF: CFG.MIN_PRODUCCION_UF, ufValor: state.ufValor,
      vendedor: vendedorSel(),
      observaciones: $("f_observaciones").value.trim() || null,
      piezas: calcs.map(({ pz, r }) => ({
        etiqueta: (pz.etiqueta || "").trim(),
        tela: r.tela, largo: r.largo, ancho: r.ancho,
        cantidad: r.lote.N, ojetillos: r.lote.nOjetillos, ojetillosTxt: ojetillosTxtPieza(pz),
        orientTxt: pz.orient === "ancho" ? "uniones a lo ancho" : "uniones a lo largo",
        terminaciones: terminacionesPieza(pz),
        complementosLineas: compLineasPDF(pz.complementos),
        inscritosLineas: inscritosLineasPDF(pz).concat(aletasLineasPDF(pz.aletas, r.lote.N, num("f_ojvalor", CFG.VALOR_OJETILLO_DEFAULT), facPz(pz))).concat(aletasLineasPDF(pz.backAletas, r.lote.N, num("f_ojvalor", CFG.VALOR_OJETILLO_DEFAULT), facPz(pz))).concat(strapsLineasPDF(pz.straps, { ancho: window.CalcCIBSA.evalExpr(pz.ancho) || 0, largo: window.CalcCIBSA.evalExpr(pz.largo) || 0 })).concat(cintasLineasPDF(pz.cintas || [], { ancho: window.CalcCIBSA.evalExpr(pz.ancho) || 0, largo: window.CalcCIBSA.evalExpr(pz.largo) || 0 })).concat(cortesLineasPDF(sketchPieza(pz), num("f_ojvalor", CFG.VALOR_OJETILLO_DEFAULT), r.lote.N)),
        sketch: sketchPieza(pz),
        valorUnitario: r.o.valorUnitario + (r.compUnit || 0) + (((r.insTot || 0) + (r.aleTot || 0) + (r.strapTot || 0) + (r.corteTot || 0)) / r.lote.N),
        valorTotal: r.piezaTotal != null ? r.piezaTotal : r.o.subtotalLote,
      })),
      granel: granelLineasPDF(),
    };
    // Mínimo de producción escalonado: TODA la orden en una secuencia (cada unidad de cada pieza).
    { const unitNets = []; datos.piezas.forEach((p) => { const nP = Math.max(1, p.cantidad), per = (p.valorTotal || 0) / nP; for (let k = 0; k < nP; k++) unitNets.push(per); });
      datos.minProduccion = minProduccionEscalonado(unitNets); }
    return datos;
  }

  // Aplica/restaura un override de tela global sobre el paño base y los anexos de todas las piezas
  // (NO toca los paños inscritos). Devuelve un snapshot para restaurar luego.
  function snapshotTelasPiezas() {
    return state.piezas.map((pz) => ({
      base: pz.telaNombre,
      aletas: (pz.aletas || []).map((a) => a.telaNombre),
      backAletas: (pz.backAletas || []).map((a) => a.telaNombre),
    }));
  }
  function aplicarTelaGlobal(nombreTela) {
    state.piezas.forEach((pz) => {
      pz.telaNombre = nombreTela;
      (pz.aletas || []).forEach((a) => { a.telaNombre = nombreTela; });
      (pz.backAletas || []).forEach((a) => { a.telaNombre = nombreTela; });
    });
  }
  function restaurarTelasPiezas(snap) {
    state.piezas.forEach((pz, i) => {
      const s = snap[i]; if (!s) return;
      pz.telaNombre = s.base;
      (pz.aletas || []).forEach((a, j) => { a.telaNombre = s.aletas[j]; });
      (pz.backAletas || []).forEach((a, j) => { a.telaNombre = s.backAletas[j]; });
    });
  }

  async function generarCompuesto() {
    const nombre = $("f_nombre").value.trim(), apellido = $("f_apellido").value.trim();
    if ((!nombre || !apellido) && !empresaDatos()) return alert("Ingresa el nombre y apellido del cliente, o al menos la razón social de la empresa.");
    if (!(await prepararVersionHistorial(nombre, apellido))) return;   // pregunta nueva versión / sobrescribir (o cancela)
    if (!state.piezas.length) {
      if (granelLineasPDF().length) return generarGranelSolo(nombre, apellido);
      return alert("Agrega al menos una pieza (o productos a granel).");
    }
    const dup = etiquetasDuplicadas();
    if (dup.length) return alert("Hay etiquetas de pieza repetidas: " + dup.join(", ") + ". Usa un nombre distinto para cada pieza.");
    sugerirFactor();
    recomputeCompuesto();
    const calcs0 = (state.compuesto && state.compuesto.calcs) || [];
    if (!calcs0.length) return alert("Ninguna pieza tiene largo, ancho y tela válidos.");
    if (calcs0.length !== state.piezas.length &&
        !confirm("Algunas piezas están incompletas y no se incluirán en el documento. ¿Continuar?")) return;

    // ----- Selector global de tela: una cotización por tela marcada (versiones correlativas) -----
    const globales = telasGlobalCompuesto();
    if (globales.length) {
      const baseV = parseInt(($("f_version").value.trim() || "01"), 10) || 1;
      const pad = (n) => String(n).padStart(2, "0");
      const snap = snapshotTelasPiezas();
      const datosList = [];
      try {
        globales.forEach((tela, i) => {
          aplicarTelaGlobal(tela.nombre);
          const d = construirDatosCompuesto(pad(baseV + i), { nombre, apellido });
          if (d) datosList.push(d);
        });
      } finally {
        restaurarTelasPiezas(snap);
        recomputeCompuesto();
      }
      if (!datosList.length) return alert("Ninguna pieza quedó válida con las telas globales elegidas.");
      { const corr = guardarHistorial(nombre, apellido, datosList.length > 1 ? (datosList[0].version + "-" + datosList[datosList.length - 1].version) : datosList[0].version); datosList.forEach((d) => { d.correlativo = corr; }); }
      abrirProgreso();
      try {
        const { bytes, filename } = datosList.length > 1
          ? await window.PDFCotizacion.generarCotizacionCompuestaCombinada(datosList)
          : await window.PDFCotizacion.generarCotizacionCompuesta(datosList[0]);
        genListo(new Blob([bytes], { type: "application/pdf" }), filename, null);
      } catch (e) { cerrarProgreso(); alert("Error al generar el PDF:\n" + (e.message || e)); }
      return;
    }

    // ----- Flujo normal: una sola cotización con la tela elegida pieza por pieza -----
    const datos = construirDatosCompuesto($("f_version").value.trim() || "01", { nombre, apellido });
    if (!datos) return alert("Ninguna pieza tiene largo, ancho y tela válidos.");
    datos.correlativo = guardarHistorial(nombre, apellido, datos.version);
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

  // ---------- Carga de facturas (DTE) → costos / proveedores / productos ----------
  const FC = { prov: [], fact: [], unid: [], loaded: false, ctx: null };
  function fe(tag, cls, txt) { const e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; }
  function fnum(v) { const r = window.CalcCIBSA ? window.CalcCIBSA.evalExpr(v) : parseFloat(v); return (r != null && !isNaN(r)) ? r : null; }
  function facturaMsg(t, err) { const m = $("facturaMsg"); if (m) { m.textContent = t || ""; m.style.color = err ? "var(--danger,#c0392b)" : ""; } }
  async function facturaEnsure(forzar) {
    const tok = window.AuthCIBSA && window.AuthCIBSA.getToken ? window.AuthCIBSA.getToken() : null;
    if (!tok) return;
    // Recarga el catálogo si: nunca se cargó, cambió el token (re-login → datos nuevos en el Sheet), o se fuerza.
    // Evita usar el catálogo viejo en memoria cuando el navegador mantiene la página viva entre sesiones.
    if (FC.loaded && FC.tokenAtLoad === tok && !forzar) return;
    try { FC.prov = await window.SheetsCIBSA.cargarProveedores(tok); } catch (e) { FC.prov = []; }
    try { FC.fact = await window.SheetsCIBSA.cargarFactores(tok); } catch (e) { FC.fact = []; }
    try { FC.unid = await window.SheetsCIBSA.cargarUnidades(tok); } catch (e) { FC.unid = []; }
    // Claves de COSTOS ya cargados: detecta facturas/productos ya ingresados (RUT proveedor + folio [+ SKU]).
    // costoUlt: último costo registrado por SKU (mayor fecha de factura) → para ver el precio anterior al clonar.
    FC.costoSet = {}; FC.facturaSet = {}; FC.costoFactura = {}; FC.costoUlt = {};
    try {
      const F = window.FacturaCIBSA;
      const filas = await window.SheetsCIBSA.leerHojaRaw(tok, CFG.HOJA_COSTOS, "A:G");
      (filas || []).slice(1).forEach((r) => {  // [0]=Llave,[1]=Fecha,[2]=Costo,[4]=ProveedorRUT,[5]=NumFactura,[6]=Nota
        const llaveRaw = String(r[0] || "").trim(), llave = F.norm(llaveRaw);
        const fechaTxt = String(r[1] || "").trim(), costo = fnum(r[2]);
        const rut = F.soloDigitosRUT(r[4] || ""), folio = String(r[5] || "").trim(), nota = String(r[6] || "").trim();
        // último costo por SKU (no depende de rut/folio): se queda con la mayor fecha de factura.
        if (llave) { const fv = facturaFechaVal(fechaTxt); const prev = FC.costoUlt[llave]; if (!prev || fv >= prev.fv) FC.costoUlt[llave] = { costo: costo, fecha: fechaTxt, folio: folio, fv: fv }; }
        if (!rut || !folio) return;
        const k = rut + "|" + folio;
        FC.facturaSet[k] = true;
        if (llave) FC.costoSet[k + "|" + llave] = true;
        (FC.costoFactura[k] = FC.costoFactura[k] || []).push({ llave: llaveRaw, nota: nota });
      });
    } catch (e) { FC.costoSet = {}; FC.facturaSet = {}; FC.costoFactura = {}; FC.costoUlt = {}; }
    FC.tokenAtLoad = tok; FC.loaded = true;
  }
  // "dd/mm/aaaa" → número comparable aaaammdd (0 si no parsea). Para elegir el costo más reciente por SKU.
  function facturaFechaVal(s) { const m = String(s || "").match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})/); if (!m) return 0; let a = parseInt(m[3], 10); if (a < 100) a += 2000; return a * 10000 + parseInt(m[2], 10) * 100 + parseInt(m[1], 10); }

  // ---------- Visor / editor de productos (BD GRANEL, edición in place) ----------
  const VS = { headers: null, colIdx: null, rows: null };
  function visorColLetter(i) { let s = "", n = i + 1; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; }
  function vsVal(row, k) { const i = VS.colIdx[k]; return String((i != null && i !== -1 && row.cells[i] != null ? row.cells[i] : "") || "").trim(); }
  async function visorCargar() {
    const tok = window.AuthCIBSA && window.AuthCIBSA.getToken ? window.AuthCIBSA.getToken() : null;
    if (!tok) throw new Error("Inicia sesión (Google) para usar el Visor.");
    const raw = await window.SheetsCIBSA.leerHojaRaw(tok, CFG.HOJA_GRANEL_MAESTRO || "GRANEL", "A1:AF");
    if (!raw || raw.length < 2) throw new Error("La hoja GRANEL no tiene datos.");
    const headers = raw[0].map((h) => String(h || "").trim());
    const C = CFG.COL_GRANEL, colIdx = {};
    Object.keys(C).forEach((k) => { colIdx[k] = headers.findIndex((h) => h.toLowerCase() === String(C[k]).toLowerCase()); });
    const rows = [];
    for (let i = 1; i < raw.length; i++) { const r = raw[i] || []; const cat = String((r[colIdx.categoria] != null ? r[colIdx.categoria] : "") || "").trim(); if (!cat) continue; rows.push({ _row: i + 1, cells: r.slice() }); }
    VS.headers = headers; VS.colIdx = colIdx; VS.rows = rows;
  }
  async function abrirVisor() {
    const cont = $("facturaPanel"); if (!cont) return;
    facturaMsg("Cargando BD para el Visor…", false);
    try { await facturaEnsure(false); await visorCargar(); } catch (e) { facturaMsg("Visor: " + (e && e.message ? e.message : e), true); return; }
    facturaMsg("", false); renderVisor(cont);
  }
  function renderVisor(cont) {
    cont.innerHTML = "";
    const box = fe("div", "visor-box");
    const head = fe("div", "visor-head");
    head.appendChild(fe("b", null, "Visor de productos (BD)"));
    const close = fe("button", "btn-outline visor-close", "✕ Cerrar"); close.type = "button";
    close.addEventListener("click", () => { cont.innerHTML = ""; if (FC.ctx) renderFactura(); });
    head.appendChild(close); box.appendChild(head);
    box.appendChild(fe("p", "muted small", "Busca por tipo, variedad, modelo, color o categoría. Se edita el ÚLTIMO registro (fecha más reciente) en la hoja GRANEL, todo salvo SKU y Parent."));
    const search = fe("input", "visor-search"); search.type = "text"; search.placeholder = "Buscar producto…"; box.appendChild(search);
    const results = fe("div", "visor-results"); box.appendChild(results);
    const editor = fe("div", "visor-editor"); box.appendChild(editor);
    const doSearch = () => {
      editor.innerHTML = ""; results.innerHTML = "";
      const q = search.value.trim().toLowerCase();
      if (q.length < 2) { results.appendChild(fe("p", "muted small", "Escribe al menos 2 caracteres.")); return; }
      const campos = ["tipo", "variedad", "modelo", "color", "categoria"];
      const match = VS.rows.filter((row) => campos.some((k) => VS.colIdx[k] !== -1 && vsVal(row, k).toLowerCase().includes(q)));
      const groups = new Map();
      match.forEach((row) => { const cod = vsVal(row, "codMaterialBase") || ("sku:" + vsVal(row, "sku")); let g = groups.get(cod); if (!g) { g = []; groups.set(cod, g); } g.push(row); });
      const prods = [];
      groups.forEach((g) => { g.sort((a, b) => { const fa = facturaFechaVal(vsVal(a, "fechaActualizacion")), fb = facturaFechaVal(vsVal(b, "fechaActualizacion")); return fb - fa || b._row - a._row; }); prods.push({ last: g[0], n: g.length }); });
      if (!prods.length) { results.appendChild(fe("p", "muted small", "Sin coincidencias.")); return; }
      prods.slice(0, 40).forEach((pr) => {
        const row = pr.last;
        const lbl = [vsVal(row, "categoria"), vsVal(row, "tipo"), vsVal(row, "variedad"), vsVal(row, "modelo"), vsVal(row, "color")].filter(Boolean).join(" · ");
        const item = fe("button", "visor-item"); item.type = "button";
        item.appendChild(fe("span", null, lbl || "(sin nombre)"));
        item.appendChild(fe("small", "muted", "SKU " + (vsVal(row, "sku") || "—") + (pr.n > 1 ? " · " + pr.n + " estados" : "")));
        item.addEventListener("click", () => { results.querySelectorAll(".visor-item").forEach((x) => x.classList.remove("sel")); item.classList.add("sel"); renderVisorEditor(editor, row); });
        results.appendChild(item);
      });
      if (prods.length > 40) results.appendChild(fe("p", "muted small", prods.length + " productos; se muestran 40. Afina la búsqueda."));
    };
    search.addEventListener("input", doSearch);
    cont.appendChild(box); try { search.focus(); } catch (e) {}
  }
  function renderVisorEditor(editor, row) {
    editor.innerHTML = "";
    const NOEDIT = {}; NOEDIT[CFG.COL_GRANEL.sku] = 1; NOEDIT[CFG.COL_GRANEL.parent] = 1;   // SKU y Parent (SKU rollo): no editables
    if (CFG.COL_GRANEL.vigentes) NOEDIT[CFG.COL_GRANEL.vigentes] = 1;   // Vigentes es una fórmula: no editable (evita pisarla)
    editor.appendChild(fe("div", "visor-ed-tit", "Editar último registro — fila " + row._row + " · SKU " + (vsVal(row, "sku") || "—")));
    const grid = fe("div", "visor-grid"), edits = {};
    const UMIN_H = (CFG.COL_GRANEL && CFG.COL_GRANEL.unidadMinima) || "Unidad Minima";
    const umNorm = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toLowerCase();
    VS.headers.forEach((h, i) => {
      if (!h) return;   // columna auxiliar sin encabezado
      const l = fe("label", "field visor-field"); l.appendChild(fe("span", null, h + (NOEDIT[h] ? " (no editable)" : "")));
      const val0 = String((row.cells[i] != null ? row.cells[i] : "")).trim();
      // Unidad Mínima: solo GRANEL / UNITARIO (un solo significado, sin CONF). Legacy CONFECCION/CONF se muestra como GRANEL.
      if (!NOEDIT[h] && umNorm(h) === umNorm(UMIN_H)) {
        const sel = fe("select"); sel.className = "visor-sel";
        [["GRANEL", "GRANEL"], ["UNITARIO", "UNITARIO"]].forEach(([v, t]) => { const o = fe("option"); o.value = v; o.textContent = t; sel.appendChild(o); });
        const legacyConf = /^(conf|confeccion)$/i.test(val0);
        sel.value = legacyConf ? "GRANEL" : (val0 === "UNITARIO" ? "UNITARIO" : "GRANEL");
        if (sel.value !== val0) edits[i] = sel.value;   // homologa legacy en el próximo guardado
        sel.addEventListener("change", () => { edits[i] = sel.value; });
        l.appendChild(sel); grid.appendChild(l); return;
      }
      const inp = fe("input"); inp.type = "text"; inp.value = val0;
      if (NOEDIT[h]) { inp.readOnly = true; inp.className = "visor-ro"; }
      else inp.addEventListener("input", () => { edits[i] = inp.value; });
      l.appendChild(inp); grid.appendChild(l);
    });
    editor.appendChild(grid);
    // N° de factura de este producto → para re-ingresarla por «Cargar facturas» y crear un estado que falte (p. ej. M.LINEAL).
    { const F = window.FacturaCIBSA; const costKey = vsVal(row, "parent") || vsVal(row, "sku");
      const cu = (costKey && FC.costoUlt) ? FC.costoUlt[F.norm(costKey)] : null;
      const t = cu && cu.folio
        ? "¿Falta un estado (p. ej. la variante M.LINEAL para confección)? Vuelve a ingresar por «Cargar facturas» la factura N° " + cu.folio + (cu.fecha ? " (" + cu.fecha + ")" : "") + " de este producto y agrégalo ahí."
        : "¿Falta un estado? Créalo por «Cargar facturas». (No encontré la factura de este producto en COSTOS vía Parent/SKU.)";
      editor.appendChild(fe("p", "muted small visor-factura-info", t)); }
    const act = fe("div", "pz-actions");
    const save = fe("button", "btn-outline visor-save", "Guardar cambios"); save.type = "button";
    save.addEventListener("click", () => visorConfirmar(row, edits, editor));
    const cancel = fe("button", "btn-outline", "Cancelar"); cancel.type = "button";
    cancel.addEventListener("click", () => { editor.innerHTML = ""; const s = document.querySelector(".visor-item.sel"); if (s) s.classList.remove("sel"); });
    act.appendChild(save); act.appendChild(cancel); editor.appendChild(act);
    editor.appendChild(fe("p", "muted small visor-ed-msg"));
  }
  function visorConfirmar(row, edits, editor) {
    const msg = editor.querySelector(".visor-ed-msg"); if (msg) { msg.textContent = ""; msg.style.color = ""; }
    const diffs = [];
    Object.keys(edits).forEach((iStr) => { const i = parseInt(iStr, 10); const old = String((row.cells[i] != null ? row.cells[i] : "")).trim(), nu = String(edits[i]).trim(); if (nu !== old) diffs.push({ i: i, h: VS.headers[i], old: old, nu: nu }); });
    if (!diffs.length) { if (msg) msg.textContent = "No hay cambios que guardar."; return; }
    const cf = fe("div", "visor-confirm");
    cf.appendChild(fe("div", "visor-confirm-tit", "Se escribirán estos cambios en GRANEL (fila " + row._row + "):"));
    diffs.forEach((d) => { const r = fe("div", "visor-diff"); r.appendChild(fe("b", null, d.h + ": ")); r.appendChild(fe("span", "visor-old", (d.old || "(vacío)"))); r.appendChild(fe("span", null, " → ")); r.appendChild(fe("span", "visor-new", (d.nu || "(vacío)"))); cf.appendChild(r); });
    const ac = fe("div", "pz-actions");
    const ok = fe("button", "btn-outline visor-save", "✓ Confirmar y guardar"); ok.type = "button";
    const no = fe("button", "btn-outline", "Cancelar"); no.type = "button";
    ok.addEventListener("click", () => { cf.remove(); visorEscribir(row, diffs, editor); });
    no.addEventListener("click", () => cf.remove());
    ac.appendChild(ok); ac.appendChild(no); cf.appendChild(ac); editor.appendChild(cf);
  }
  function visorEscribir(row, diffs, editor) {
    const msg = editor.querySelector(".visor-ed-msg");
    const tok = window.AuthCIBSA && window.AuthCIBSA.getToken ? window.AuthCIBSA.getToken() : null;
    if (!tok) { if (msg) { msg.textContent = "Sesión expirada. Vuelve a iniciar sesión."; msg.style.color = "var(--danger,#c0392b)"; } return; }
    const updates = diffs.map((d) => ({ rango: visorColLetter(d.i) + row._row, valores: [[d.nu]] }));
    if (msg) { msg.textContent = "Guardando…"; msg.style.color = ""; }
    window.SheetsCIBSA.actualizarCeldas(tok, CFG.HOJA_GRANEL_MAESTRO || "GRANEL", updates)
      .then(() => { diffs.forEach((d) => { row.cells[d.i] = d.nu; }); if (msg) { msg.textContent = "✓ Guardado (" + diffs.length + " campo(s)). Recuerda «↻ Actualizar catálogo» para reflejarlo en la App."; msg.style.color = "#1e8a4c"; } })
      .catch((e) => { if (msg) { msg.textContent = "Error al guardar: " + (e && e.message ? e.message : e); msg.style.color = "var(--danger,#c0392b)"; } });
  }
  // Marca en el contexto los productos de esta factura que YA están en COSTOS (mismo RUT+folio+SKU): los deja
  // en "Omitir" para que recargar el XML y registrar el RESTO no duplique lo ya cargado. No bloquea nada.
  function facturaMarcarYaCargados(ctx) {
    if (!ctx || ctx.manual) return;
    const F = window.FacturaCIBSA;
    const rut = F.soloDigitosRUT(ctx.proveedor.rut || ""), folio = String(ctx.folio || "").trim();
    const k = rut + "|" + folio;
    ctx.facturaYaVista = !!(rut && folio && FC.facturaSet && FC.facturaSet[k]);
    ctx.yaCargados = 0;
    if (!rut || !folio) return;
    const enFactura = (FC.costoFactura && FC.costoFactura[k]) || [];
    (ctx.items || []).forEach((it) => {
      // 1) por SKU si el ítem calzó con un producto del catálogo
      const sku = it.llaveExistente || (it.match && it.match.prod ? it.match.prod.sku : "");
      let ya = !!(sku && FC.costoSet && FC.costoSet[k + "|" + F.norm(sku)]);
      // 2) si no, por el NOMBRE del DTE contra la Nota guardada en COSTOS de esta misma factura. Umbral alto
      // (coincidencia casi exacta) para NO confundir el mismo producto en otro color (NEGRO vs ROJO).
      if (!ya && it.nombre) {
        const nIt = F.norm(it.nombre);
        const m = enFactura.find((e) => e.nota && (F.norm(e.nota) === nIt || F.similitud(it.nombre, e.nota) >= 0.85));
        if (m) { ya = true; it.llaveCargada = m.llave; }
      }
      if (ya) { it.yaCargado = true; it.modo = "omitir"; ctx.yaCargados++; }
    });
  }
  function facturaItemInit(src) {
    const F = window.FacturaCIBSA;
    const m = F.matchItem(src, granelActivos());
    return {
      nombre: src.nombre || "", codigo: src.codigo || "", qty: src.qty != null ? src.qty : 1,
      unidadProveedor: src.unidadProveedor || "", precioLista: src.precioLista, montoItem: src.montoItem,
      subDsctos: src.subDsctos || [], descPct: src.descPct, descMonto: src.descMonto,
      costoSugerido: (src.costoUnitSugerido != null) ? src.costoUnitSugerido : (src.precioLista || 0),
      match: m, modo: m ? "existente" : "nuevo",
      costo: (src.costoUnitSugerido != null) ? src.costoUnitSugerido : (src.precioLista || 0),
      existenteSel: m ? (m.prod.sku || granelNombre(m.prod)) : "",
      llaveExistente: m ? (m.prod.sku || "") : "",   // llave del costo = SKU del producto
      prod: {
        categoria: "", tipo: "", variedad: "", formato: "", modelo: "", color: "", materialidad: "",
        unidad: "", unidadMinima: "UNITARIO", anchoRollo: "", rendimiento: 1, fav: "",
        sku: "", codMaterialBase: "",
      },
      estados: [],
      absorbidos: [],   // otras líneas de la MISMA factura (mismo producto, otro color/precio igual) fundidas aquí
      absorbidoEn: null, // si esta línea fue fundida en otra, índice de la línea destino
    };
  }
  // Color efectivo del producto = color propio + colores de las líneas absorbidas (sin duplicar).
  function facturaColorEfectivo(it) {
    const cols = [it.prod ? it.prod.color : ""].concat((it.absorbidos || []).map((a) => a.color));
    return window.FacturaCIBSA.unirColores.apply(null, cols);
  }
  // Copia a `dst` los atributos de `src` que en `dst` estén vacíos (no toca el color). Para que, al "Sumar
  // aquí", el producto sobreviviente conserve la ficha completa aunque hayas sumado desde la tarjeta vacía.
  function facturaHeredarAtributos(dst, src) {
    if (!dst || !src) return;
    ["categoria", "tipo", "variedad", "formato", "modelo", "materialidad", "unidad", "unidadMinima", "anchoRollo", "fav"].forEach((k) => {
      const vac = dst[k] == null || dst[k] === "" || (k === "unidadMinima" && dst[k] === "UNITARIO");
      if (vac && src[k] != null && src[k] !== "") dst[k] = src[k];
    });
    if ((dst.rendimiento == null || dst.rendimiento === "" || Number(dst.rendimiento) === 1) && src.rendimiento != null && src.rendimiento !== "") dst.rendimiento = src.rendimiento;
  }
  // El usuario escribe/elige "CONF" (cómodo) pero en el Sheet se guarda "CONFECCION", que es lo que la
  // fórmula de PrecioCalc y la tabla FACTOR esperan (evita que el factor no calce y PrecioCalc dé 0).
  function expandConf(s) { return (window.FacturaCIBSA.norm(s) === "conf") ? "CONFECCION" : s; }
  // Detecta si un SKU ya existe (duplicado exacto) o es MUY parecido a otros del catálogo (mismo producto con
  // 1–2 tokens distintos: color/formato/proveedor) → para avisar antes de crear un "nuevo" que ya existe.
  function facturaSkuChequeo(sku, prods) {
    const F = window.FacturaCIBSA, tk = (s) => F.norm(s).split(/[^a-z0-9]+/).filter(Boolean);
    const a = tk(sku), an = F.norm(sku); if (!a.length) return { exacto: null, similares: [] };
    let exacto = null; const sims = [];
    (prods || []).forEach((p) => {
      if (!p.sku) return;
      if (F.norm(p.sku) === an) { exacto = p; return; }
      const b = tk(p.sku), setB = {}; b.forEach((t) => setB[t] = 1);
      const comunes = a.filter((t) => setB[t]).length, dif = Math.max(a.length, b.length) - comunes;
      if (comunes >= 2 && dif >= 1 && dif <= 2) sims.push({ prod: p, dif: dif, comunes: comunes });
    });
    sims.sort((x, y) => x.dif - y.dif || y.comunes - x.comunes);
    return { exacto: exacto, similares: sims.slice(0, 4) };
  }
  // Actualización rápida: clona un producto del catálogo en el ítem `it` (mismo producto, otro color).
  // Copia todos los atributos MENOS el color, y replica sus estados derivados (M.LINEAL/CONF, etc.).
  function facturaClonar(it, prod) {
    const F = window.FacturaCIBSA;
    // si nos pasan un ESTADO (tiene Parent), subimos a su producto base (mismo CodMaterialBase, sin Parent).
    let base = prod;
    if (prod.parent && prod.codMaterialBase) {
      const b = granelActivos().find((p) => p.codMaterialBase === prod.codMaterialBase && !p.parent);
      if (b) base = b;
    }
    const P = it.prod;
    ["categoria", "tipo", "variedad", "formato", "modelo", "materialidad", "unidad"].forEach((k) => { if (base[k] != null && base[k] !== "") P[k] = base[k]; });
    if (base.anchoRollo != null && base.anchoRollo !== "") P.anchoRollo = base.anchoRollo;
    P.unidadMinima = base.unidadMinima || "UNITARIO";
    if (base.rendimiento != null && base.rendimiento !== "") P.rendimiento = base.rendimiento;
    P.fav = (base.fav && base.fav.join) ? base.fav.join("/") : (base.fav || "");
    // estados derivados: filas del catálogo vinculadas a la base por Parent (= SKU base) o por CodMaterialBase,
    // con variedad ≠ a la base (las bases de otros colores comparten variedad y se excluyen), sin repetir.
    it.estados = [];
    const vistos = {};
    granelActivos().forEach((h) => {
      const porParent = base.sku && h.parent && h.parent === base.sku;
      const porCMB = base.codMaterialBase && h.codMaterialBase && h.codMaterialBase === base.codMaterialBase;
      if (!porParent && !porCMB) return;
      if (F.norm(h.variedad) === F.norm(base.variedad)) return;   // es otra base/color, no un estado derivado
      const key = F.norm(h.variedad) + "|" + F.norm(h.unidadMinima);
      if (vistos[key]) return; vistos[key] = 1;
      it.estados.push({ variedad: h.variedad, unidad: h.unidad, unidadMinima: h.unidadMinima, rendimiento: h.rendimiento });
    });
    it.estadosClonados = it.estados.length;
    // el color NO se copia: queda el que tenga el ítem (para que pongas el nuevo). SKU se re-derivará.
    P.skuManual = false; P.cmbManual = false; P.sku = ""; P.codMaterialBase = "";
    it.clonadoDe = base.sku || base.codMaterialBase || "";
    // Último costo registrado del producto base (para chequear que solo cambia el color y no el precio).
    it.costoUltBase = (FC.costoUlt && base.sku) ? (FC.costoUlt[F.norm(base.sku)] || null) : null;
  }
  // Nombre corto del proveedor del contexto de la factura (para el último token del SKU: SAV, TEX, …).
  function facturaProvCorto() {
    const p = FC.ctx && FC.ctx.proveedor; if (!p) return "";
    return p.nombreCorto || (p.match ? p.match.nombreCorto : "") || "";
  }
  function facturaCtxDeDTE(dte) {
    const F = window.FacturaCIBSA;
    const prov = F.matchProveedor(dte.emisor.rut, FC.prov);
    return {
      manual: false, dte: dte, folio: dte.folio, fecha: F.fechaFactura(dte.fecha),
      emisor: dte.emisor, receptor: dte.receptor,
      proveedor: { match: prov, crear: !prov, rut: dte.emisor.rut, razon: dte.emisor.razon, nombreCorto: prov ? prov.nombreCorto : "" },
      items: (dte.items || []).map(facturaItemInit),
    };
  }
  function facturaCtxManual() {
    return {
      manual: true, dte: null, folio: "", fecha: window.FacturaCIBSA.hoyCorta(),
      emisor: { rut: "", razon: "", giro: "" }, receptor: { rut: CFG.RUT_EMPRESA, razon: "" },
      proveedor: { match: null, crear: true, rut: "", razon: "", nombreCorto: "" },
      items: [facturaItemInit({ nombre: "", qty: 1 })],
    };
  }
  function facturaLeerBuffer(f) { return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(r.error || new Error("no se pudo leer")); r.readAsArrayBuffer(f); }); }
  // Lee N archivos XML, decodifica y parsea cada uno, y arma la COLA con su estado. 1 archivo → abre directo.
  async function facturaDesdeArchivos(files) {
    await facturaEnsure();
    const lista = [];
    for (let i = 0; i < files.length; i++) {
      const f = files[i]; let dte = null, err = null;
      try { const buf = await facturaLeerBuffer(f); const dd = window.DTECIBSA.parseDTE(facturaDecodificar(buf)); if (dd.ok) dte = dd; else err = dd.error || "XML inválido"; }
      catch (e) { err = (e && e.message) ? e.message : "no se pudo leer"; }
      lista.push({ name: f.name, dte: dte, error: err, done: false });
    }
    FC.cola = lista; FC.colaActual = null;
    if (lista.length === 1 && lista[0].dte) facturaAbrirCola(0);
    else { facturaMsg(lista.length + " archivo(s) en cola.", false); renderFacturaCola(); }
  }
  // Estado de un ítem de la cola: inválido / ya procesado en esta tanda / ya en la base (RUT+folio) / nuevo.
  function facturaEstadoCola(item) {
    if (!item.dte) return { txt: "⚠ inválida", cls: "factura-warn" };
    if (item.done) return { txt: "✅ procesada", cls: "factura-cola-ok" };
    const F = window.FacturaCIBSA;
    const rut = F.soloDigitosRUT(item.dte.emisor.rut || ""), folio = String(item.dte.folio || "").trim();
    if (rut && folio && FC.facturaSet && FC.facturaSet[rut + "|" + folio]) return { txt: "✓ ya en base", cls: "factura-cola-ok" };
    return { txt: "🆕 nueva", cls: "factura-new" };
  }
  function renderFacturaCola() {
    const cont = $("facturaPanel"), res = $("facturaResumen"); if (res) res.innerHTML = "";
    if (!cont) return; cont.innerHTML = "";
    const cola = FC.cola || []; if (!cola.length) return;
    const pend = cola.filter((x) => x.dte && !x.done && facturaEstadoCola(x).txt === "🆕 nueva").length;
    const box = fe("div", "factura-card");
    box.appendChild(fe("h3", "factura-h", "Cola de facturas (" + cola.length + " · " + pend + " nueva(s))"));
    box.appendChild(fe("p", "muted small", "Procesa las pendientes. 🆕 = nueva · ✓ ya en base · ✅ procesada ahora · ⚠ inválida."));
    cola.forEach((item, i) => {
      const row = fe("div", "factura-cola-row");
      const st = facturaEstadoCola(item);
      row.appendChild(fe("span", "factura-cola-st " + st.cls, st.txt));
      const tx = fe("div", "factura-cola-tx");
      tx.appendChild(fe("div", "factura-cola-nom", item.name));
      const info = item.dte ? ((item.dte.emisor.razon || item.dte.emisor.rut || "") + " · folio " + (item.dte.folio || "—") + (item.dte.totales && item.dte.totales.mntTotal != null ? " · " + money(item.dte.totales.mntTotal) : "")) : (item.error || "no válida");
      tx.appendChild(fe("div", "muted small", info));
      row.appendChild(tx);
      if (item.dte) { const b = fe("button", "btn-outline small", item.done ? "Ver" : "Procesar"); b.type = "button"; b.addEventListener("click", () => facturaAbrirCola(i)); row.appendChild(b); }
      box.appendChild(row);
    });
    const vac = fe("button", "btn-outline small", "✕ Vaciar cola"); vac.type = "button";
    vac.addEventListener("click", () => { FC.cola = []; FC.colaActual = null; cont.innerHTML = ""; facturaMsg("Cola vaciada.", false); });
    box.appendChild(vac);
    cont.appendChild(box);
    try { box.scrollIntoView({ behavior: "smooth", block: "start" }); } catch (_) {}
  }
  function facturaAbrirCola(i) {
    const item = (FC.cola || [])[i]; if (!item || !item.dte) return;
    FC.colaActual = i;
    const dte = item.dte;
    if (dte.tipoDTE && dte.tipoDTE !== "33" && dte.tipoDTE !== "34") facturaMsg("Aviso: TipoDTE " + dte.tipoDTE + " (se esperaba 33/34). Se carga igual.", false);
    else if (dte.receptor.rut && window.FacturaCIBSA.soloDigitosRUT(dte.receptor.rut) !== window.FacturaCIBSA.soloDigitosRUT(CFG.RUT_EMPRESA)) facturaMsg("Aviso: el receptor no es CIBSA (" + dte.receptor.rut + ").", false);
    else facturaMsg("Factura: folio " + dte.folio + " · " + dte.emisor.razon, false);
    FC.ctx = facturaCtxDeDTE(dte);
    facturaMarcarYaCargados(FC.ctx);
    renderFactura();
  }
  function facturaInput(labelTxt, value, on, attrs) {
    const w = fe("label", "factura-f"); w.appendChild(fe("span", null, labelTxt));
    const i = document.createElement("input"); i.type = "text"; i.value = (value != null ? value : "");
    if (attrs && attrs.inputmode) i.inputMode = attrs.inputmode;
    if (attrs && attrs.ph) i.placeholder = attrs.ph;
    if (attrs && attrs.ej) i.title = "Ejemplos: " + attrs.ej;
    i.addEventListener("input", (e) => on(e.target.value));
    w.appendChild(i);
    if (attrs && attrs.ej) w.appendChild(fe("span", "factura-ej", "ej.: " + attrs.ej));   // ejemplos bajo el campo
    return w;
  }
  function facturaSelect(labelTxt, opts, value, on) {
    const w = fe("label", "factura-f"); w.appendChild(fe("span", null, labelTxt));
    const s = document.createElement("select");
    opts.forEach(([v, t]) => { const o = document.createElement("option"); o.value = v; o.textContent = t; if (v === value) o.selected = true; s.appendChild(o); });
    s.addEventListener("change", (e) => on(e.target.value));
    w.appendChild(s); return w;
  }
  // Unidad RESTRINGIDA a la lista UNIDADES (FACTOR!G:I). Si la lista no cargó, cae a texto con ejemplos.
  function facturaSelectUnidad(label, value, on) {
    const lista = FC.unid || [];
    if (!lista.length) return facturaInput(label, value, on, { ej: "m · m2 · kg · gal · un (deben estar en la lista UNIDADES)" });
    const opts = [["", "— (sin unidad) —"]].concat(lista.map((u) => [u.codigo, u.codigo + (u.nombre ? " · " + u.nombre : "")]));
    return facturaSelect(label, opts, value, on);
  }
  function renderFactura() {
    const cont = $("facturaPanel"), res = $("facturaResumen");
    if (res) res.innerHTML = "";
    if (!cont) return; cont.innerHTML = "";
    const ctx = FC.ctx; if (!ctx) return;

    // --- Proveedor ---
    const pv = fe("div", "factura-card"); pv.appendChild(fe("h3", "factura-h", "Proveedor"));
    if (ctx.proveedor.match) {
      pv.appendChild(fe("p", "muted small", "Registrado: " + ctx.proveedor.match.razon + " · " + ctx.proveedor.rut + (ctx.proveedor.match.nombreCorto ? " (" + ctx.proveedor.match.nombreCorto + ")" : "")));
    } else {
      pv.appendChild(fe("p", "factura-new", "Proveedor NUEVO — se creará en PROVEEDORES."));
      const g = fe("div", "factura-grid");
      g.appendChild(facturaInput("RUT", ctx.proveedor.rut, (v) => ctx.proveedor.rut = v));
      g.appendChild(facturaInput("Razón Social", ctx.proveedor.razon, (v) => ctx.proveedor.razon = v));
      g.appendChild(facturaInput("Nombre corto", ctx.proveedor.nombreCorto, (v) => ctx.proveedor.nombreCorto = v, { ph: "ej. IGENAR" }));
      pv.appendChild(g);
    }
    cont.appendChild(pv);

    // Aviso: esta factura (RUT proveedor + folio) ya fue cargada antes. No bloquea: deja en "Omitir" lo ya
    // registrado para que puedas agregar solo lo que falta sin duplicar.
    if (ctx.facturaYaVista) {
      const av = fe("div", "factura-warn-box");
      av.appendChild(fe("p", "factura-warn", "⚠ Esta factura (folio " + (ctx.folio || "—") + " de " + (ctx.proveedor.razon || ctx.proveedor.rut || "este proveedor") + ") ya fue cargada antes."));
      av.appendChild(fe("p", "muted small", ctx.yaCargados ? ("Dejé en «Omitir» " + ctx.yaCargados + " producto(s) ya registrado(s). Revisa/agrega solo los que falten; si necesitas recargar un costo, cámbialo a «Producto…».") : "No detecté qué productos ya están cargados (quizás se cargaron con otra llave). Revisa para no duplicar."));
      cont.appendChild(av);
    }

    // --- Ítems ---
    ctx.items.forEach((it, i) => cont.appendChild(renderFacturaItem(it, i)));

    if (ctx.manual) {
      const add = fe("button", "btn-outline small", "+ Agregar ítem"); add.type = "button";
      add.addEventListener("click", () => { ctx.items.push(facturaItemInit({ nombre: "", qty: 1 })); renderFactura(); });
      cont.appendChild(add);
    }
    const acc = fe("div", "factura-acciones");
    const rev = fe("button", "btn-primary factura-rev", "Revisar y confirmar →"); rev.type = "button";
    rev.addEventListener("click", renderFacturaResumen);
    const canc = fe("button", "btn-outline", "✕ Cancelar"); canc.type = "button";
    canc.addEventListener("click", () => { if (confirm("¿Cancelar esta carga? Se descarta lo no confirmado.")) facturaCancelar(); });
    acc.appendChild(rev); acc.appendChild(canc);
    // Si venimos de una cola de varios archivos, botón para volver al listado sin perder la cola.
    if (FC.cola && FC.cola.length > 1) {
      const vol = fe("button", "btn-outline", "← Volver a la cola"); vol.type = "button";
      vol.addEventListener("click", () => { FC.ctx = null; FC.colaActual = null; renderFacturaCola(); });
      acc.appendChild(vol);
    }
    cont.appendChild(acc);
  }
  // Descarta la carga actual. Si hay cola de varios, vuelve a la cola; si no, al estado inicial.
  function facturaCancelar() {
    FC.ctx = null;
    if (FC.cola && FC.cola.length > 1) { FC.colaActual = null; renderFacturaCola(); facturaMsg("Carga cancelada.", false); return; }
    const p = $("facturaPanel"); if (p) p.innerHTML = "";
    const r = $("facturaResumen"); if (r) r.innerHTML = "";
    facturaMsg("Carga cancelada.", false);
  }
  function renderFacturaItem(it, idx) {
    const card = fe("div", "factura-card factura-item");
    const head = fe("div", "factura-item-head");
    head.appendChild(fe("b", null, "Ítem " + (idx + 1) + (it.nombre ? ": " + it.nombre : "")));
    card.appendChild(head);
    const ctxLine = "código " + (it.codigo || "—") + " · " + (it.qty != null ? it.qty : "?") + " " + (it.unidadProveedor || "") +
      " · lista " + (it.precioLista != null ? money(it.precioLista) : "—") +
      (it.descPct != null ? " · desc " + it.descPct + "%" : "") +
      (it.subDsctos && it.subDsctos.length ? " · subdsctos " + it.subDsctos.map((s) => s.tipo + s.valor).join(",") : "") +
      " · monto " + (it.montoItem != null ? money(it.montoItem) : "—");
    card.appendChild(fe("p", "muted small", ctxLine));

    const modos = [["existente", "Actualizar producto existente"], ["nuevo", "Producto NUEVO (no existe)"], ["omitir", "Omitir"]];
    const msel = facturaSelect("¿Qué es este ítem?", modos, it.modo, (v) => { it.modo = v; renderFactura(); });
    card.appendChild(msel);
    if (it.modo === "existente") card.appendChild(fe("p", "muted small", "Ya está en el catálogo. Si solo cambia el PRECIO, deja el producto elegido (escribe el costo). Si cambió el COLOR / FORMATO u otra variable, usa «crear variante» (abajo) — queda con SKU propio heredando el resto." + (it.match ? " · Sugerido por " + it.match.via + (it.match.score < 1 ? " (" + Math.round(it.match.score * 100) + "%)" : "") + " → " + granelNombre(it.match.prod) : "")));

    if (it.modo === "omitir") {
      if (it.absorbidoEn != null) {
        const nota = fe("p", "muted small", "↳ Sumado como color del Ítem " + (it.absorbidoEn + 1) + " (mismo producto). ");
        const und = fe("button", "btn-outline small", "Separar"); und.type = "button"; und.title = "Volver a tratarlo como ítem propio";
        und.addEventListener("click", () => {
          const dst = FC.ctx.items[it.absorbidoEn];
          if (dst && dst.absorbidos) dst.absorbidos = dst.absorbidos.filter((a) => a.idx !== idx);
          it.absorbidoEn = null; it.modo = it.match ? "existente" : "nuevo"; renderFactura();
        });
        nota.appendChild(und); card.appendChild(nota);
      } else if (it.yaCargado) {
        const nota = fe("p", "muted small", "↳ Ya cargado de esta factura" + (it.llaveCargada ? " (SKU: " + it.llaveCargada + ")" : "") + " — no se vuelve a escribir. ");
        const und = fe("button", "btn-outline small", "Cargar igual"); und.type = "button"; und.title = "Forzar: vuelve a registrar el costo de este producto";
        und.addEventListener("click", () => { it.yaCargado = false; it.modo = it.match ? "existente" : "nuevo"; renderFactura(); });
        nota.appendChild(und); card.appendChild(nota);
      }
      return card;
    }

    if (it.modo === "existente") {
      // Filtros del catálogo: por PROVEEDOR (el último token del SKU es su código, ej. "…-AIM") y por texto
      // en TIPO y VARIEDAD (subcadena, sin distinguir mayúsculas). Se combinan (AND). Refrescan el
      // desplegable SIN re-render, para no perder el foco al escribir en los campos de texto.
      // El último token del SKU es abbr(proveedorCorto || proveedor, 3) = las 3 primeras letras. Hay que
      // comparar con el MISMO criterio (antes se comparaba el nombre completo → nunca calzaba, lista vacía).
      const provFuente = facturaProvCorto() || (FC.ctx && FC.ctx.proveedor && FC.ctx.proveedor.razon) || "";
      const provCorto = (window.FacturaCIBSA && window.FacturaCIBSA.abbr) ? window.FacturaCIBSA.abbr(provFuente, 3) : provFuente.replace(/[^a-zA-Z0-9]/g, "").slice(0, 3).toUpperCase();
      if (it.filtProv == null) it.filtProv = !!provCorto; // por defecto filtra si hay código de proveedor
      const skuProv = (sku) => { const s = String(sku || ""); const i = s.lastIndexOf("-"); return (i >= 0 ? s.slice(i + 1) : s).toUpperCase(); };
      const catFiltrado = () => {
        let c = granelActivos();
        if (it.filtProv && provCorto) c = c.filter((p) => skuProv(p.sku) === provCorto);
        const tf = (it.filtTipo || "").trim().toLowerCase(); if (tf) c = c.filter((p) => String(p.tipo || "").toLowerCase().indexOf(tf) >= 0);
        const vf = (it.filtVariedad || "").trim().toLowerCase(); if (vf) c = c.filter((p) => String(p.variedad || "").toLowerCase().indexOf(vf) >= 0);
        return c;
      };
      const selWrap = fe("label", "factura-f"); selWrap.appendChild(fe("span", null, "Producto del catálogo"));
      const selEl = document.createElement("select");
      selEl.addEventListener("change", (e) => { it.existenteSel = e.target.value; const p = granelActivos().find((x) => (x.sku || granelNombre(x)) === e.target.value); it.llaveExistente = p ? (p.sku || it.llaveExistente) : it.llaveExistente; renderFactura(); });
      selWrap.appendChild(selEl); card.appendChild(selWrap);
      const cnt = fe("p", "muted small", "");
      const rellenar = () => {
        const cat = catFiltrado(); selEl.innerHTML = "";
        cat.forEach((p) => { const o = document.createElement("option"); o.value = p.sku || granelNombre(p); o.textContent = granelNombre(p) + (p.sku ? " · " + p.sku : ""); if (o.value === it.existenteSel) o.selected = true; selEl.appendChild(o); });
        // Sincroniza el estado con la opción que el select realmente MUESTRA: si estaba vacío o la selección
        // previa quedó fuera del filtro, el navegador muestra la 1ª opción pero no dispara "change". Sin esto,
        // "crear variante" no encontraba el producto y no hacía nada.
        const enLista = cat.some((p) => (p.sku || granelNombre(p)) === it.existenteSel);
        if (cat.length && !enLista) {
          it.existenteSel = selEl.value;
          const p = granelActivos().find((x) => (x.sku || granelNombre(x)) === it.existenteSel);
          if (p) it.llaveExistente = p.sku || it.llaveExistente;
        }
        cnt.textContent = cat.length + " producto(s)" + (cat.length ? "" : " · afloja los filtros para ver más");
      };
      rellenar();
      const fRow = fe("div", "factura-filtros");
      if (provCorto) {
        const fl = fe("label", "factura-chk"); const cb = document.createElement("input"); cb.type = "checkbox"; cb.checked = !!it.filtProv;
        cb.addEventListener("change", () => { it.filtProv = cb.checked; rellenar(); });
        fl.appendChild(cb); fl.appendChild(fe("span", null, " Solo " + provCorto)); fRow.appendChild(fl);
      }
      const mkFiltro = (ph, key) => { const i = document.createElement("input"); i.type = "text"; i.placeholder = ph; i.value = it[key] || ""; i.className = "factura-filtro-in"; i.addEventListener("input", () => { it[key] = i.value; rellenar(); }); return i; };
      fRow.appendChild(mkFiltro("Tipo…", "filtTipo"));
      fRow.appendChild(mkFiltro("Variedad…", "filtVariedad"));
      card.appendChild(fRow); card.appendChild(cnt);
      card.appendChild(facturaInput("Llave de costo (SKU)", it.llaveExistente, (v) => it.llaveExistente = v, { ph: "SKU del producto" }));
      // Puente: el producto cambió en una variable (color/formato…) → crear VARIANTE (clona del elegido).
      const variante = fe("button", "btn-outline small", "Cambió color/formato/otra variable → crear variante"); variante.type = "button";
      variante.addEventListener("click", () => {
        const val = it.existenteSel || selEl.value; // respaldo: la opción visible del desplegable
        const p = granelActivos().find((x) => (x.sku || granelNombre(x)) === val);
        if (!p) { facturaMsg("Elige primero el producto del catálogo.", true); return; }
        it.existenteSel = val; it.modo = "nuevo"; facturaClonar(it, p); renderFactura();
      });
      card.appendChild(variante);
    } else { // nuevo
      // Anti-duplicados: muestra posibles coincidencias existentes antes de crear uno nuevo.
      const cand = window.FacturaCIBSA.candidatos({ nombre: it.nombre, codigo: it.codigo }, granelActivos(), 4)
        .filter((c) => c.score >= 0.34);
      if (cand.length) {
        const dup = fe("div", "factura-dup");
        dup.appendChild(fe("p", "factura-dup-h", "⚠ ¿No será uno de estos que ya existe? «Es este» = mismo producto (solo agrega costo). «Clonar» = producto nuevo que HEREDA todo (atributos + estados) menos el color → actualización rápida para un color nuevo."));
        cand.forEach((c) => {
          const row = fe("div", "factura-dup-row");
          row.appendChild(fe("span", null, granelNombre(c.prod) + (c.prod.sku ? " · " + c.prod.sku : "") + "  (" + c.via + (c.score < 1 ? " " + Math.round(c.score * 100) + "%" : "") + ")"));
          const use = fe("button", "btn-outline small", "Es este"); use.type = "button";
          use.addEventListener("click", () => { it.modo = "existente"; it.existenteSel = c.prod.sku || granelNombre(c.prod); it.llaveExistente = c.prod.sku || ""; renderFactura(); });
          row.appendChild(use);
          const clo = fe("button", "btn-outline small", "Clonar (otro color)"); clo.type = "button";
          clo.addEventListener("click", () => { facturaClonar(it, c.prod); setSug(); renderFactura(); });
          row.appendChild(clo);
          dup.appendChild(row);
        });
        card.appendChild(dup);
      }
      // Mismo producto en OTRA línea de esta misma factura (p. ej. mismo velcro, distinto color).
      const Fz = window.FacturaCIBSA;
      const hermanos = (FC.ctx.items || []).map((o, oi) => ({ o: o, oi: oi }))
        .filter((x) => x.oi !== idx && x.o.modo !== "omitir" && it.nombre && Fz.similitud(it.nombre, x.o.nombre) >= 0.5);
      if (hermanos.length) {
        const dup2 = fe("div", "factura-dup");
        dup2.appendChild(fe("p", "factura-dup-h", "↔ Hay otras líneas de esta factura que parecen el MISMO producto (p. ej. el mismo velcro en otro color). Mismo precio → puedes SUMARLAS aquí (un solo SKU, colores combinados). Precio distinto → el panel te avisa y debes dejarlas SEPARADAS (cada color su propio SKU)."));
        const precioDe = (o) => (o.costoSugerido != null ? o.costoSugerido : o.precioLista);
        const pBase = precioDe(it);
        hermanos.forEach((x) => {
          const row = fe("div", "factura-dup-row");
          const pHer = precioDe(x.o);
          // Mismo precio (±1) → se pueden sumar (mismo producto, otro color). Precio distinto → NO sumar.
          const mismoPrecio = (pBase != null && pHer != null && Math.abs(Number(pBase) - Number(pHer)) <= 1);
          row.appendChild(fe("span", null, "Ítem " + (x.oi + 1) + ": " + x.o.nombre + (pHer != null ? " · " + money(Math.round(pHer)) : "")));
          if (mismoPrecio) {
            const sum = fe("button", "btn-outline small", "➕ Sumar aquí (mismo precio)"); sum.type = "button";
            sum.addEventListener("click", () => {
              // El sobreviviente HEREDA los atributos del hermano que sí estén llenos (mismo producto, otro
              // color): así da igual sobre qué tarjeta sumes; nunca se pierde la base por sumar al revés.
              facturaHeredarAtributos(it.prod, x.o.prod);
              it.absorbidos.push({ idx: x.oi, nombre: x.o.nombre, color: (x.o.prod && x.o.prod.color) || "" });
              x.o.modo = "omitir"; x.o.absorbidoEn = idx; setSug(); renderFactura();
            });
            row.appendChild(sum);
          } else {
            row.appendChild(fe("span", "factura-warn", "⚠ PRECIO DISTINTO (" + money(Math.round(pBase || 0)) + " vs " + money(Math.round(pHer || 0)) + ") → déjalos SEPARADOS: cada color su propio SKU. NO sumar."));
          }
          dup2.appendChild(row);
        });
        card.appendChild(dup2);
      }
      // Actualización rápida: clonar de CUALQUIER producto del catálogo (hereda atributos + estados, no el color).
      {
        const bases = granelActivos().filter((p) => !p.parent);
        if (bases.length) {
          const cw2 = fe("div", "factura-clone");
          const opts = [["", "— Clonar de un producto existente (otro color) —"]]
            .concat(bases.map((p) => [p.sku || granelNombre(p), granelNombre(p) + (p.sku ? " · " + p.sku : "")]));
          cw2.appendChild(facturaSelect("Actualización rápida", opts, "", (v) => {
            if (!v) return; const p = granelActivos().find((x) => (x.sku || granelNombre(x)) === v);
            if (p) { facturaClonar(it, p); setSug(); renderFactura(); }
          }));
          if (it.clonadoDe) cw2.appendChild(fe("p", "muted small", "↳ Clonado de " + it.clonadoDe + " · " + (it.estadosClonados || 0) + " estado(s) derivado(s). Cambia solo el COLOR (y revisa el costo); el SKU se re-deriva con el nuevo color." + (it.estadosClonados ? "" : " (Si esperabas estados M.LINEAL/CONF y no aparecen, las filas del producto original no están vinculadas por Parent/CodMaterialBase — agrégalos abajo a mano.)")));
          // Último costo registrado del producto base vs el costo de esta factura: detecta subidas de precio.
          if (it.clonadoDe && it.costoUltBase && it.costoUltBase.costo != null) {
            const ub = it.costoUltBase, nuevo = (it.costo != null ? it.costo : it.costoSugerido);
            const dif = (nuevo != null && ub.costo > 0) ? (nuevo - ub.costo) : 0;
            const pct = (nuevo != null && ub.costo > 0) ? Math.round((nuevo / ub.costo - 1) * 100) : 0;
            const linea = "Último costo del producto base: " + money(Math.round(ub.costo)) + (ub.fecha ? " (" + ub.fecha + (ub.folio ? ", fact. " + ub.folio : "") + ")" : "") + " · costo de esta factura: " + (nuevo != null ? money(Math.round(nuevo)) : "—");
            const cambia = (nuevo != null && Math.abs(dif) > 1);
            const pc = fe("p", cambia ? "factura-warn small" : "muted small", (cambia ? "⚠ " : "") + linea + (cambia ? "  → DIFIERE " + (dif > 0 ? "+" : "") + money(Math.round(dif)) + " (" + (pct > 0 ? "+" : "") + pct + "%). ¿Es solo color o también subió el precio? Revisa antes de confirmar." : "  → igual: es solo un color nuevo."));
            cw2.appendChild(pc);
          } else if (it.clonadoDe) {
            cw2.appendChild(fe("p", "muted small", "Sin costo previo registrado para el producto base (no se puede comparar)."));
          }
          card.appendChild(cw2);
        }
      }
      const g = fe("div", "factura-grid");
      const P = it.prod;
      const setSug = () => { const eff = Object.assign({}, P, { color: facturaColorEfectivo(it), proveedorCorto: facturaProvCorto() }); P.sku = window.FacturaCIBSA.sugerirSKU(eff); P.codMaterialBase = window.FacturaCIBSA.sugerirCodMaterialBase(eff); };
      g.appendChild(facturaInput("Categoría", P.categoria, (v) => P.categoria = v, { ph: "TELA / CARPA…", ej: "TELA · CARPA · PEGAMENTO · ACCESORIO · CINTA" }));
      g.appendChild(facturaInput("Tipo", P.tipo, (v) => P.tipo = v, { ph: "PVC / PE…", ej: "PVC · PE · HDPE · NYLON" }));
      g.appendChild(facturaInput("Variedad (estado comprado)", P.variedad, (v) => P.variedad = v, { ph: "ROLLO / DIMENSIONADA…", ej: "ROLLO · M.LINEAL · DIMENSIONADA · TARRO · UNIDAD" }));
      g.appendChild(facturaInput("Formato", P.formato, (v) => P.formato = v, { ph: "M2X50…", ej: "M2X50 (2m×50m) · M1,52X50 · GAL025 (1/4 galón)" }));
      g.appendChild(facturaInput("Modelo", P.modelo, (v) => P.modelo = v, { ej: "G200 · COBKK10000 · NAUTICO600 · MEISTER" }));
      g.appendChild(facturaInput("Color", P.color, (v) => P.color = v, { ej: "AZUL MARINO · BLANCO · varios: NEGRO / BLANCO", title: "Si hay varios colores al MISMO precio, sepáralos con / (no entran al SKU). Si el color cambia el precio, deja UN color (sí entra al SKU)." }));
      g.appendChild(facturaSelectUnidad("Unidad (medida del proveedor, de la lista)", P.unidad, (v) => P.unidad = v));
      g.appendChild(facturaSelect("Unidad mínima", [["GRANEL", "GRANEL"], ["UNITARIO", "UNITARIO"]], (/^(conf|confeccion)$/i.test(String(P.unidadMinima || "").trim()) ? "GRANEL" : P.unidadMinima), (v) => P.unidadMinima = v));
      g.appendChild(facturaInput("Ancho rollo (m)", P.anchoRollo, (v) => P.anchoRollo = v, { inputmode: "decimal", ej: "2 · 1,52 · 3 (en metros)" }));
      g.appendChild(facturaInput("Rendimiento (estado comprado)", P.rendimiento, (v) => P.rendimiento = fnum(v), { inputmode: "decimal", ej: "1 (se vende entero) · 50 (m por rollo) · 100" }));
      card.appendChild(g);
      // Colores adicionales: líneas de la misma factura sumadas a este producto (mismo precio → un solo SKU).
      if (it.absorbidos && it.absorbidos.length) {
        const ac = fe("div", "factura-colores");
        ac.appendChild(fe("p", "factura-sub", "Colores adicionales (otras líneas de esta factura, mismo producto y precio). Se adicionan como colores; NO entran al SKU. Color combinado: " + (facturaColorEfectivo(it) || "—")));
        it.absorbidos.forEach((a, ai) => {
          const row = fe("div", "factura-grid factura-estado");
          row.appendChild(facturaInput("Color (Ítem " + (a.idx + 1) + ")", a.color, (v) => { a.color = v; setSug(); }, { ej: "BLANCO · GRIS", title: a.nombre }));
          const del = fe("button", "factura-estado-del", "✕"); del.type = "button"; del.title = "Separar: volver a tratarla como ítem propio";
          del.addEventListener("click", () => {
            const orig = FC.ctx.items[a.idx];
            if (orig) { orig.modo = orig.match ? "existente" : "nuevo"; orig.absorbidoEn = null; }
            it.absorbidos.splice(ai, 1); setSug(); renderFactura();
          });
          row.appendChild(del);
          ac.appendChild(row);
        });
        card.appendChild(ac);
      }
      const sug = fe("button", "btn-outline small", "Sugerir SKU / CodMaterialBase"); sug.type = "button";
      sug.addEventListener("click", () => { setSug(); renderFactura(); });
      card.appendChild(sug);
      const g2 = fe("div", "factura-grid");
      g2.appendChild(facturaInput("SKU", P.sku, (v) => { P.sku = v; P.skuManual = true; }, { ej: "TEL-PVC-ROL-COBKK10000 · PEG-PVC-TAR-GAL025-MEISTER-MAD" }));
      g2.appendChild(facturaInput("CodMaterialBase", P.codMaterialBase, (v) => { P.codMaterialBase = v; P.cmbManual = true; }, { ej: "informativo (la llave del costo es el SKU)" }));
      card.appendChild(g2);
      // Chequeo de SKU: ¿duplicado exacto o muy parecido a uno existente? (avisa que quizá NO es nuevo).
      {
        const skuAct = P.sku || window.FacturaCIBSA.sugerirSKU(Object.assign({}, P, { color: facturaColorEfectivo(it), proveedorCorto: facturaProvCorto() }));
        const chk = facturaSkuChequeo(skuAct, granelActivos());
        if (chk.exacto) {
          const box = fe("div", "factura-warn-box");
          box.appendChild(fe("p", "factura-warn", "⛔ Este SKU YA EXISTE en el catálogo: " + (chk.exacto.sku || "") + " (" + granelNombre(chk.exacto) + "). Crearlo como NUEVO lo duplicaría."));
          const b = fe("button", "btn-outline small", "Es este → Actualizar existente"); b.type = "button";
          b.addEventListener("click", () => { it.modo = "existente"; it.existenteSel = chk.exacto.sku || granelNombre(chk.exacto); it.llaveExistente = chk.exacto.sku || ""; renderFactura(); });
          box.appendChild(b); card.appendChild(box);
        } else if (chk.similares.length) {
          const box = fe("div", "factura-warn-box");
          box.appendChild(fe("p", "factura-warn", "⚠ SKU muy parecido a producto(s) existente(s) (quizá es el mismo en otro color/formato → conviene «crear variante» o «actualizar», no «nuevo»):"));
          chk.similares.forEach((s) => {
            const row = fe("div", "factura-dup-row");
            row.appendChild(fe("span", null, granelNombre(s.prod) + " · " + (s.prod.sku || "") + "  (difiere en " + s.dif + " parte" + (s.dif > 1 ? "s" : "") + ")"));
            const bv = fe("button", "btn-outline small", "Crear variante de este"); bv.type = "button";
            bv.addEventListener("click", () => { facturaClonar(it, s.prod); setSug(); renderFactura(); });
            row.appendChild(bv);
            const be = fe("button", "btn-outline small", "Es este (actualizar)"); be.type = "button";
            be.addEventListener("click", () => { it.modo = "existente"; it.existenteSel = s.prod.sku || granelNombre(s.prod); it.llaveExistente = s.prod.sku || ""; renderFactura(); });
            row.appendChild(be);
            box.appendChild(row);
          });
          card.appendChild(box);
        }
      }

      // Estados de venta (hijos) que derivan del comprado
      const estWrap = fe("div", "factura-estados");
      estWrap.appendChild(fe("p", "factura-sub", "Estados de venta DERIVADOS (distintos al comprado de arriba). Aquí va lo que se fracciona: p. ej. M.LINEAL para vender por metro (U.mín GRANEL). La confección NO es un estado aparte: usa esa misma fila M.LINEAL a precio de lista, y el granel aplica su descuento en el carrito. Cada estado deriva del costo del comprado vía Parent, con su propio rendimiento. NO repitas aquí la variedad comprada."));
      it.estados.forEach((es, ei) => {
        const row = fe("div", "factura-grid factura-estado");
        row.appendChild(facturaInput("Variedad", es.variedad, (v) => es.variedad = v, { ph: "M.LINEAL…", ej: "M.LINEAL · SALDO (≠ a la comprada)" }));
        if (es.variedad && window.FacturaCIBSA.norm(es.variedad) === window.FacturaCIBSA.norm(P.variedad)) row.appendChild(fe("span", "factura-warn", "⚠ repite la variedad comprada"));
        row.appendChild(facturaSelectUnidad("Unidad", es.unidad, (v) => es.unidad = v));
        row.appendChild(facturaSelect("U. mínima", [["GRANEL", "GRANEL"], ["UNITARIO", "UNITARIO"]], (/^(conf|confeccion)$/i.test(String(es.unidadMinima || "").trim()) ? "GRANEL" : es.unidadMinima), (v) => es.unidadMinima = v));
        row.appendChild(facturaInput("Rendimiento", es.rendimiento, (v) => es.rendimiento = fnum(v), { inputmode: "decimal", ej: "metros por rollo (50 · 100)" }));
        const del = fe("button", "factura-estado-del", "✕"); del.type = "button"; del.title = "Quitar estado";
        del.addEventListener("click", () => { it.estados.splice(ei, 1); renderFactura(); });
        row.appendChild(del);
        estWrap.appendChild(row);
      });
      const addEs = fe("button", "btn-outline small", "+ Estado de venta"); addEs.type = "button";
      addEs.addEventListener("click", () => { it.estados.push({ variedad: "", unidad: "", unidadMinima: "GRANEL", rendimiento: null }); renderFactura(); });
      estWrap.appendChild(addEs);
      card.appendChild(estWrap);
    }

    // Costo efectivo (lo fija el usuario; default = neto unitario de la factura)
    const cw = fe("div", "factura-costo");
    cw.appendChild(facturaInput("Costo efectivo (por 1 unidad comprada)", it.costo, (v) => it.costo = fnum(v), { inputmode: "decimal" }));
    cw.appendChild(fe("span", "muted small", "Sugerido: " + (it.costoSugerido != null ? money(Math.round(it.costoSugerido)) : "—") + " (neto unitario de la factura)"));
    // Producto EXISTENTE: muestra el último costo registrado de ese SKU para ver si esta factura sube el precio.
    if (it.modo === "existente" && it.llaveExistente && FC.costoUlt) {
      const ub = FC.costoUlt[window.FacturaCIBSA.norm(it.llaveExistente)];
      if (ub && ub.costo != null) {
        const nuevo = (it.costo != null ? it.costo : it.costoSugerido), dif = (nuevo != null && ub.costo > 0) ? (nuevo - ub.costo) : 0;
        const pct = (nuevo != null && ub.costo > 0) ? Math.round((nuevo / ub.costo - 1) * 100) : 0, cambia = (nuevo != null && Math.abs(dif) > 1);
        cw.appendChild(fe("p", cambia ? "factura-warn small" : "muted small", (cambia ? "⚠ " : "") + "Último costo registrado: " + money(Math.round(ub.costo)) + (ub.fecha ? " (" + ub.fecha + (ub.folio ? ", fact. " + ub.folio : "") + ")" : "") + (cambia ? "  → vs el costo del campo: " + (dif > 0 ? "SUBE " : "BAJA ") + money(Math.abs(Math.round(dif))) + " (" + (pct > 0 ? "+" : "") + pct + "%)" : "  → sin cambio de precio")));
        // Diferencia enorme (típico de unidad mal puesta: per-metro vs rollo entero). Avisa y guía al botón.
        if (Math.abs(pct) >= 60) cw.appendChild(fe("p", "factura-warn small", "↳ Diferencia muy grande: probablemente el costo del campo está en otra unidad (p. ej. POR METRO en vez del ROLLO entero). Si la factura tarifa por metro y el producto es 1 rollo, usa el botón «Usar este costo (línea ÷ N)» de abajo con N = nº de rollos."));
      }
    }
    // Aviso de unidad: la factura tarifa por fracción (Qty>1, p. ej. metros) pero la base es un PACK (rollo).
    // El costo de 1 pack = total de la línea ÷ N packs; el rendimiento del estado que fracciona = Qty ÷ N.
    // (N=1 → línea = 1 rollo. N=3 → la línea trae 3 rollos.)
    // Vale para producto NUEVO y EXISTENTE: en existente, p. ej. actualizar el costo de un ROLLO cuya factura
    // viene por metro → el costo debe ser el del rollo entero, no el del metro.
    const qty = (it.qty != null && !isNaN(it.qty)) ? Number(it.qty) : null;
    const hayEstados = (it.estados && it.estados.length > 0);
    if (qty && qty > 1 && it.costoSugerido != null && (it.modo === "nuevo" || it.modo === "existente")) {
      const neto = it.costoSugerido, lineaTotal = Math.round(neto * qty);
      const av = fe("div", "factura-costo-aviso");
      av.appendChild(fe("p", "muted small", "Línea: " + qty + " " + (it.unidadProveedor || "u") + " × " + money(Math.round(neto)) + " = " + money(lineaTotal) + " (total de la línea, neto)."));
      av.appendChild(fe("p", "muted small", "Si el producto es un PACK (rollo) y la línea trae VARIOS, indica cuántas unidades compradas trae: costo de 1 unidad = total ÷ N" + (hayEstados ? ", y rendimiento del estado que fracciona = " + qty + " ÷ N" : "") + "."));
      const nrow = fe("div", "factura-grid factura-estado");
      nrow.appendChild(fe("span", "factura-fk", "Unidades compradas (rollos/packs) en esta línea:"));
      const nInp = document.createElement("input"); nInp.type = "text"; nInp.inputMode = "numeric"; nInp.value = "1"; nInp.className = "factura-fnum";
      nrow.appendChild(nInp); av.appendChild(nrow);
      const prev = fe("p", "muted small", "");
      const calcPrev = () => { const N = Math.max(1, Math.round(fnum(nInp.value) || 1)); prev.textContent = "→ 1 unidad: costo " + money(Math.round(lineaTotal / N)) + (hayEstados ? " · rendimiento del estado que fracciona = " + (qty / N) : ""); };
      nInp.addEventListener("input", calcPrev); calcPrev();
      av.appendChild(prev);
      const apply = fe("button", "btn-outline small", hayEstados ? "Aplicar costo por unidad + rendimiento" : "Usar este costo (línea ÷ N)"); apply.type = "button";
      apply.addEventListener("click", () => {
        const N = Math.max(1, Math.round(fnum(nInp.value) || 1));
        it.costo = Math.round(lineaTotal / N);
        const rendUnidad = qty / N;
        (it.estados || []).forEach((es) => {
          const frac = es.variedad && window.FacturaCIBSA.norm(es.variedad) !== window.FacturaCIBSA.norm(it.prod.variedad);
          if (frac && (es.rendimiento == null || es.rendimiento === "" || Number(es.rendimiento) === 1)) es.rendimiento = rendUnidad;
        });
        renderFactura();
      });
      av.appendChild(apply);
      cw.appendChild(av);
    }
    card.appendChild(cw);
    return card;
  }
  // Construye el plan de escritura + detecta factores faltantes. Devuelve {prov, granel, costos, factorReq}.
  function facturaPlan() {
    const F = window.FacturaCIBSA, ctx = FC.ctx;
    const plan = { prov: [], granel: [], costos: [], factorReq: [], notas: [], faltan: [] };
    if (ctx.proveedor.crear && ctx.proveedor.rut) plan.prov.push({ rut: ctx.proveedor.rut, razon: ctx.proveedor.razon, nombreCorto: ctx.proveedor.nombreCorto });
    const provRUT = ctx.proveedor.rut, provCorto = ctx.proveedor.nombreCorto || (ctx.proveedor.match ? ctx.proveedor.match.nombreCorto : "");
    const factorKey = (c, t, v, u) => F.norm(c) + "|" + F.norm(t) + "|" + F.norm(v) + "|" + F.norm(u);
    const reqVistos = {};
    const pedirFactor = (cat, tipo, vari, umin) => {
      if (F.factorBuscar(FC.fact, cat, tipo, vari, umin)) return;   // ya existe (específico o general)
      const k = factorKey(cat, tipo, vari, umin); if (reqVistos[k]) return; reqVistos[k] = true;
      plan.factorReq.push({ categoria: cat, tipo: tipo, variedad: vari, unidadMinima: umin });
    };
    ctx.items.forEach((it) => {
      if (it.modo === "omitir") return;
      if (it.modo === "existente") {
        // La llave del costo es el SKU del producto del catálogo (modelo nuevo).
        plan.costos.push({ llave: it.llaveExistente, fecha: ctx.fecha, costo: it.costo, unidadCompra: it.unidadProveedor, proveedorRUT: provRUT, numFactura: ctx.folio, nota: it.nombre });
        return;
      }
      // Guarda: un producto nuevo SIN Categoría/Tipo/Variedad escribiría una fila basura (SKU truncado,
      // columnas en blanco). Lo registramos como faltante para bloquear el commit con un aviso claro.
      {
        const Pp = it.prod || {}, falt = [];
        if (!Pp.categoria) falt.push("Categoría");
        if (!Pp.tipo) falt.push("Tipo");
        if (!Pp.variedad) falt.push("Variedad");
        if (falt.length) plan.faltan.push({ nombre: it.nombre || "(sin nombre)", campos: falt });
      }
      // nuevo: el COSTO se cuelga del SKU; el alias guarda nombre + código del proveedor.
      // Color efectivo = color propio + colores de las líneas absorbidas; los nombres de esas líneas
      // se suman como alias para que futuras facturas calcen con cualquiera de ellos.
      const P = it.prod, colorEff = facturaColorEfectivo(it);
      // SKU/CodMaterialBase SIEMPRE re-derivados de los campos actuales (+color efectivo +proveedor), salvo que
      // el usuario los haya editado a mano. Evita el SKU "pegado" (stale) que truncaba a "COLOR-PROV".
      const eff = Object.assign({}, P, { color: colorEff, proveedorCorto: provCorto });
      const skuFinal = (P.skuManual && P.sku) ? P.sku : F.sugerirSKU(eff);
      const cmbFinal = (P.cmbManual && P.codMaterialBase) ? P.codMaterialBase : (F.sugerirCodMaterialBase(eff) || skuFinal);
      const skuCosto = skuFinal || it.nombre, cmb = cmbFinal || skuFinal || it.nombre;
      const aliasAbs = (it.absorbidos || []).map((a) => a.nombre).filter(Boolean);
      const alias = [F.aliasInicial(it.nombre, it.codigo)].concat(aliasAbs).join(" | ");
      const base = Object.assign({}, P, {
        sku: skuFinal, color: colorEff, codMaterialBase: cmb, parent: "", proveedor: provCorto, proveedorCorto: provCorto, proveedorRUT: provRUT,
        variedad: expandConf(P.variedad), unidadMinima: expandConf(P.unidadMinima),
        nombreProveedor: alias, unidadProveedor: it.unidadProveedor, fecha: ctx.fecha,
      });
      plan.granel.push(F.filaGranel(base));
      pedirFactor(P.categoria, P.tipo, expandConf(P.variedad), expandConf(P.unidadMinima));
      it.estados.forEach((es) => {
        // estado que fracciona: NO recibe costo propio, deriva del padre (Parent = SKU del comprado).
        // "CONF" se expande a "CONFECCION" al escribir (lo que la fórmula/FACTOR del Sheet esperan).
        const esVar = expandConf(es.variedad), esUm = expandConf(es.unidadMinima);
        const hijo = Object.assign({}, base, {
          variedad: esVar, unidad: es.unidad, unidadMinima: esUm, rendimiento: es.rendimiento,
          parent: skuFinal, sku: (skuFinal || cmb) + "-" + F.norm(es.variedad).replace(/[^a-z0-9]/g, "").toUpperCase().slice(0, 4),
        });
        plan.granel.push(F.filaGranel(hijo));
        pedirFactor(P.categoria, P.tipo, esVar, esUm);
      });
      plan.costos.push({ llave: skuCosto, fecha: ctx.fecha, costo: it.costo, unidadCompra: it.unidadProveedor, proveedorRUT: provRUT, numFactura: ctx.folio, nota: it.nombre });
    });
    return plan;
  }
  function renderFacturaResumen() {
    const res = $("facturaResumen"); if (!res) return; res.innerHTML = "";
    const F = window.FacturaCIBSA, plan = facturaPlan();
    const box = fe("div", "factura-card factura-resumen");
    box.appendChild(fe("h3", "factura-h", "Resumen — revisa antes de fijar"));

    const linea = (t) => box.appendChild(fe("p", "factura-res-l", t));
    if (plan.prov.length) linea("Proveedor nuevo → PROVEEDORES: " + plan.prov.map((p) => p.razon + " (" + p.rut + ")").join("; "));
    if (plan.granel.length) linea("Productos/estados nuevos → GRANEL: " + plan.granel.length + " fila(s).");
    linea("Costos → COSTOS: " + plan.costos.length + " fila(s).");
    // Muestra las llaves (SKU) que se escribirán + avisa si alguna YA existe en COSTOS (mismo RUT+folio+SKU).
    if (plan.costos.length) {
      const ctx = FC.ctx || {};
      const rutK = F.soloDigitosRUT(ctx.proveedor ? ctx.proveedor.rut : ""), folioK = String(ctx.folio || "").trim();
      let dups = 0;
      const lk = fe("div", "factura-llaves");
      lk.appendChild(fe("p", "factura-sub", "Llaves (SKU) que se escribirán en COSTOS — revísalas:"));
      plan.costos.forEach((c) => {
        const yaEsta = !!(rutK && folioK && c.llave && FC.costoSet && FC.costoSet[rutK + "|" + folioK + "|" + F.norm(c.llave)]);
        if (yaEsta) dups++;
        const p = fe("p", yaEsta ? "factura-warn small" : "muted small", "• " + (c.llave || "(vacía)") + "  →  " + money(Math.round(c.costo || 0)) + (c.nota ? "  · " + c.nota : "") + (yaEsta ? "   ⚠ YA EXISTE en COSTOS (duplicado)" : ""));
        lk.appendChild(p);
      });
      if (dups) {
        const w = fe("p", "factura-warn", "⚠ " + dups + " costo(s) ya están en COSTOS para esta factura (RUT+folio+SKU). Si confirmas, se ESCRIBIRÁN DUPLICADOS. Para no duplicar, vuelve atrás y deja esos ítems en «Omitir».");
        lk.insertBefore(w, lk.firstChild.nextSibling);
      }
      box.appendChild(lk);
    }

    // Factores faltantes: input por combinación (el usuario fija el valor; default 1)
    const factorInputs = [];
    if (plan.factorReq.length) {
      const fwrap = fe("div", "factura-factores");
      fwrap.appendChild(fe("p", "factura-sub", "Factores nuevos (margen) que faltan en FACTOR — fija cada uno (default 1):"));
      plan.factorReq.forEach((fr) => {
        const row = fe("div", "factura-grid factura-estado");
        row.appendChild(fe("span", "factura-fk", fr.categoria + " · " + fr.variedad + " · " + fr.unidadMinima));
        const inp = document.createElement("input"); inp.type = "text"; inp.inputMode = "decimal"; inp.value = "1"; inp.className = "factura-fnum";
        row.appendChild(inp); fwrap.appendChild(row);
        factorInputs.push({ fr: fr, inp: inp });
      });
      box.appendChild(fwrap);
    }

    // Bloqueo: productos nuevos sin Categoría/Tipo/Variedad → no se puede escribir (evita filas basura).
    if (plan.faltan && plan.faltan.length) {
      const warn = fe("div", "factura-warn-box");
      warn.appendChild(fe("p", "factura-warn", "⚠ No se puede escribir: hay productos nuevos sin datos obligatorios. Vuelve atrás y complétalos:"));
      plan.faltan.forEach((f) => warn.appendChild(fe("p", "muted small", "• " + f.nombre + " → falta: " + f.campos.join(", "))));
      box.appendChild(warn);
    }
    const msg = fe("p", "factura-res-msg muted small", "");
    const confirm = fe("button", "btn-primary", "✓ Confirmar y escribir en la base"); confirm.type = "button";
    if (plan.faltan && plan.faltan.length) confirm.disabled = true;
    confirm.addEventListener("click", async () => {
      confirm.disabled = true; msg.textContent = "Escribiendo…"; msg.style.color = "";
      const factores = factorInputs.map((x) => ({ categoria: x.fr.categoria, variedad: x.fr.variedad, unidadMinima: x.fr.unidadMinima, factor: (fnum(x.inp.value) != null ? fnum(x.inp.value) : 1) }));
      try {
        const ctxRut = (FC.ctx && FC.ctx.proveedor) ? F.soloDigitosRUT(FC.ctx.proveedor.rut || "") : "";
        const ctxFolio = FC.ctx ? String(FC.ctx.folio || "").trim() : "";
        await facturaCommit(plan, factores);
        // Marca esta factura como ya-en-base (para la cola y futuras detecciones) sin recargar todo.
        if (ctxRut && ctxFolio) { FC.facturaSet = FC.facturaSet || {}; FC.facturaSet[ctxRut + "|" + ctxFolio] = true; }
        // Agrega el/los proveedor(es) recién creado(s) al catálogo EN MEMORIA, para que las siguientes
        // facturas de la cola NO lo propongan de nuevo como "nuevo" (y no se dupliquen en PROVEEDORES).
        (plan.prov || []).forEach((p) => {
          FC.prov = FC.prov || [];
          if (!FC.prov.some((x) => F.soloDigitosRUT(x.rut) === F.soloDigitosRUT(p.rut))) FC.prov.push({ rut: p.rut, razon: p.razon, nombreCorto: p.nombreCorto });
        });
        if (FC.cola && FC.cola.length > 1 && FC.colaActual != null && FC.cola[FC.colaActual]) {
          // Venimos de una cola: marca el ítem como procesado y vuelve al listado.
          FC.cola[FC.colaActual].done = true; FC.colaActual = null; FC.ctx = null;
          const pend = FC.cola.filter((x) => x.dte && !x.done && facturaEstadoCola(x).txt === "🆕 nueva").length;
          facturaMsg("✓ Factura escrita. Quedan " + pend + " nueva(s) en la cola.", false);
          renderFacturaCola();
        } else {
          msg.style.color = ""; msg.textContent = "✓ Listo. Se escribió en el Sheet. Recuerda que el precio se calculará por fórmula cuando esté esa fase activa.";
          FC.ctx = null; const p = $("facturaPanel"); if (p) p.innerHTML = ""; FC.loaded = false;
        }
      } catch (e) { confirm.disabled = false; msg.style.color = "var(--danger,#c0392b)"; msg.textContent = "Error al escribir: " + (e && e.message ? e.message : e); }
    });
    const volver = fe("button", "btn-outline", "← Retroceder"); volver.type = "button";
    volver.addEventListener("click", () => { res.innerHTML = ""; });   // vuelve a la edición de ítems
    const canc = fe("button", "btn-outline", "✕ Cancelar"); canc.type = "button";
    canc.addEventListener("click", () => { if (confirm("¿Cancelar esta carga? Se descarta lo no confirmado.")) facturaCancelar(); });
    box.appendChild(confirm); box.appendChild(volver); box.appendChild(canc); box.appendChild(msg);
    res.appendChild(box);
    try { box.scrollIntoView({ behavior: "smooth", block: "start" }); } catch (_) {}
  }
  async function facturaCommit(plan, factores) {
    const tok = window.AuthCIBSA && window.AuthCIBSA.getToken ? window.AuthCIBSA.getToken() : null;
    if (!tok) throw new Error("Sesión expirada. Inicia sesión de nuevo.");
    const F = window.FacturaCIBSA, S = window.SheetsCIBSA;
    if (plan.prov.length) await S.anexarHoja(tok, CFG.HOJA_PROVEEDORES, plan.prov.map(F.filaProveedor));
    if (plan.granel.length) await S.anexarGranel(tok, plan.granel);   // escribe sin tocar la fórmula PrecioCalc
    if (factores && factores.length) await S.anexarHoja(tok, CFG.HOJA_FACTOR, factores.map(F.filaFactor));
    if (plan.costos.length) await S.anexarHoja(tok, CFG.HOJA_COSTOS, plan.costos.map(F.filaCosto));
  }
  // Decodifica el XML respetando la codificación declarada (DTE del SII suele venir en ISO-8859-1, no UTF-8),
  // así no se rompen "ñ" y tildes. Lee bytes y los decodifica con la codificación correcta.
  function facturaDecodificar(buf) {
    const bytes = new Uint8Array(buf);
    let head = ""; for (let i = 0; i < Math.min(bytes.length, 250); i++) head += String.fromCharCode(bytes[i]);
    const m = head.match(/encoding=["']([\w-]+)["']/i);
    let enc = (m ? m[1] : "utf-8").toLowerCase();
    if (enc === "latin1" || enc === "iso8859-1") enc = "iso-8859-1";
    try { return new TextDecoder(enc).decode(buf); }
    catch (e) { try { return new TextDecoder("iso-8859-1").decode(buf); } catch (e2) { return new TextDecoder("utf-8").decode(buf); } }
  }
  { const fi = $("facturaFile"); if (fi) fi.addEventListener("change", (e) => { const fs = e.target.files; if (!fs || !fs.length) return; facturaDesdeArchivos(Array.prototype.slice.call(fs)); e.target.value = ""; }); }
  { const bm = $("facturaManual"); if (bm) bm.addEventListener("click", async () => { await facturaEnsure(); FC.ctx = facturaCtxManual(); facturaMsg("Carga manual.", false); renderFactura(); }); }
  { const br = $("facturaRefrescar"); if (br) br.addEventListener("click", async () => { facturaMsg("Actualizando catálogo…", false); try { await facturaEnsure(true); facturaMsg("Catálogo actualizado (PROVEEDORES, COSTOS, FACTOR).", false); if (FC.ctx) renderFactura(); else if (FC.cola && FC.cola.length) renderFacturaCola(); } catch (e) { facturaMsg("No se pudo actualizar: " + (e && e.message ? e.message : e), true); } }); }
  { const bv = $("facturaVisor"); if (bv) bv.addEventListener("click", () => { abrirVisor(); }); }

  // ---------- Fusión canónica de duplicados (solo usuario maestro) ----------
  function facturaEsMaestro() {
    const email = (window.AuthCIBSA && window.AuthCIBSA.getEmail) ? window.AuthCIBSA.getEmail() : "";
    return window.FacturaCIBSA.esMaestro(email, CFG.CORREOS_MAESTROS || []);
  }
  const GIDX_FUSION = { sku: 21, parent: 26, activo: 17, notas: 18, nombreProv: 28 }; // V, AA, R, S, AC (0-based)
  async function facturaMergePlan(dupSKU, canonSKU) {
    const tok = window.AuthCIBSA.getToken(), S = window.SheetsCIBSA, F = window.FacturaCIBSA;
    const granel = await S.leerHojaRaw(tok, CFG.HOJA_GRANEL_MAESTRO, "A:AF");
    const costos = await S.leerHojaRaw(tok, CFG.HOJA_COSTOS, "A:G");
    return F.planFusion({ dupSKU: dupSKU, canonSKU: canonSKU, granel: granel, costos: costos, gIdx: GIDX_FUSION, cIdx: { llave: 0 } });
  }
  async function facturaMergeCommit(plan) {
    const tok = window.AuthCIBSA.getToken(), S = window.SheetsCIBSA;
    if (plan.granel && plan.granel.length) await S.actualizarCeldas(tok, CFG.HOJA_GRANEL_MAESTRO, plan.granel);
    if (plan.costos && plan.costos.length) await S.actualizarCeldas(tok, CFG.HOJA_COSTOS, plan.costos);
  }
  function renderFacturaMerge() {
    const cont = $("facturaMerge"); if (!cont) return; cont.innerHTML = "";
    if (!facturaEsMaestro()) return;   // solo maestro
    const box = fe("div", "factura-card factura-merge");
    box.appendChild(fe("h3", "factura-h", "Fusionar duplicados (maestro)"));
    box.appendChild(fe("p", "muted small", "Si dos SKU son el mismo producto, fusiónalos. El canónico sobrevive; el duplicado queda inactivo (no se borra). Se repuntan costos, alias y Parent."));
    const g = fe("div", "factura-grid");
    const st = { dup: "", canon: "" };
    g.appendChild(facturaInput("SKU duplicado (queda inactivo)", "", (v) => st.dup = v.trim()));
    g.appendChild(facturaInput("SKU canónico (sobrevive)", "", (v) => st.canon = v.trim()));
    box.appendChild(g);
    const msg = fe("p", "factura-res-msg muted small", ""), out = fe("div", "factura-merge-out");
    const setErr = (t) => { msg.style.color = "var(--danger,#c0392b)"; msg.textContent = t; };
    const prev = fe("button", "btn-outline", "Vista previa"); prev.type = "button";
    prev.addEventListener("click", async () => {
      out.innerHTML = ""; msg.style.color = ""; msg.textContent = "";
      if (!st.dup || !st.canon) return setErr("Indica ambos SKU.");
      if (st.dup === st.canon) return setErr("Los SKU deben ser distintos.");
      msg.textContent = "Leyendo…";
      try {
        const plan = await facturaMergePlan(st.dup, st.canon), r = plan.resumen;
        msg.textContent = "";
        if (r.dupRowNum == null) return setErr("No encontré el SKU duplicado en GRANEL.");
        if (r.canonRowNum == null) return setErr("No encontré el SKU canónico en GRANEL.");
        out.appendChild(fe("p", "factura-res-l", "Costos a repuntar (Llave → canónico): " + r.costosRepunt));
        out.appendChild(fe("p", "factura-res-l", "Hijos (Parent) a repuntar: " + r.parentsRepunt));
        out.appendChild(fe("p", "factura-res-l", "Duplicado: fila " + r.dupRowNum + " → Activo=No + nota «FUSIONADO»."));
        if (r.aliasNuevo) out.appendChild(fe("p", "factura-res-l", "Alias del canónico quedará: " + r.aliasNuevo));
        const conf = fe("button", "btn-primary", "✓ Confirmar fusión"); conf.type = "button";
        conf.addEventListener("click", async () => {
          conf.disabled = true; msg.style.color = ""; msg.textContent = "Fusionando…";
          try { await facturaMergeCommit(plan); msg.textContent = "✓ Fusionado. Recarga para ver el catálogo actualizado."; out.innerHTML = ""; FC.loaded = false; }
          catch (e) { conf.disabled = false; setErr("Error: " + (e && e.message ? e.message : e)); }
        });
        out.appendChild(conf);
      } catch (e) { setErr("Error al leer: " + (e && e.message ? e.message : e)); }
    });
    box.appendChild(prev); box.appendChild(msg); box.appendChild(out);
    cont.appendChild(box);
  }

  // ---------- Inicio ----------
  (function init() {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("sw.js").catch(() => {});
    }
    try { const av = $("appVersion"); if (av) av.textContent = (CFG.APP_VERSION || ""); } catch (e) {}
    let t = "A";
    try { t = localStorage.getItem("cibsa_tema") || "A"; } catch (e) {}
    aplicarTema(t);
    renderBordes();
    renderComplementosUnif();
    renderCortesUnif();
    renderAletasUnif(); renderStrapsUnif(); renderCintasUnif();
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
