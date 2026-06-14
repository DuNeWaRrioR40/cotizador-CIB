/* Controlador de la app web Cotizador CIBSA. */
(function () {
  const $ = (id) => document.getElementById(id);
  const CFG = window.CONFIG;
  const money = window.CalcCIBSA.money;

  const state = {
    telas: [], orientaciones: null, orientacionSel: "mayor", orientUnif: "largo",
    ojMode: "total", ojTotal: 8, ojSubstate: "count", ojAristasN: 4,
    ojAristas: [], ojError: "", ultimoPdf: null, progTimer: null, progVal: 0,
    docMode: "formal", prodMode: "uniforme", prelim: [], vendedores: [], materiales: [],
    piezas: [], compuesto: null, closeTimer: null, closeIntv: null, complementosUnif: [], cortesUnif: [],
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
    show("wProdToggle", f);
    show("wDimensiones", uni || p);
    show("wCantidad", uni);
    show("wTelaUnica", uni);
    show("telaMultiWrap", p);
    show("wPiezas", comp);
    show("wTitulo", f);
    show("wOjetillos", uni || p);
    show("wValorOj", uni || p || comp);
    show("wBordes", uni);
    show("wComplementosUnif", uni);
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
    renderComplementosUnif();
    // Vendedores (desde RANGO → tabla "Vendedores"; si no existe, usa el de config)
    let vendedores = [];
    try { vendedores = await window.SheetsCIBSA.cargarVendedores(token); }
    catch (e) { console.warn("CIBSA: no se pudieron cargar los vendedores —", e && e.message ? e.message : e); vendedores = []; }
    if (!vendedores || vendedores.length === 0) {
      vendedores = [{ nombre: CFG.VENDEDOR.nombre, email: CFG.VENDEDOR.email || "", fonos: [CFG.VENDEDOR.fono].filter(Boolean) }];
    }
    state.vendedores = vendedores;
    const vsel = $("f_vendedor");
    if (vsel) {
      vsel.innerHTML = "";
      vendedores.forEach((v) => {
        const o = document.createElement("option");
        o.value = v.nombre; o.textContent = v.nombre; vsel.appendChild(o);
      });
    }
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

  // ---------- Paños inscritos (ventanas) ----------
  let inscritoSeq = 0;
  function nuevaInscrito(base) {
    inscritoSeq += 1;
    const defB = () => ({ sup: { tipo: "borde", valor: "0.045", diam: "" }, inf: { tipo: "borde", valor: "0.045", diam: "" }, izq: { tipo: "borde", valor: "0.045", diam: "" }, der: { tipo: "borde", valor: "0.045", diam: "" } });
    const cpB = (b) => ({ sup: Object.assign({}, b.sup), inf: Object.assign({}, b.inf), izq: Object.assign({}, b.izq), der: Object.assign({}, b.der) });
    return {
      id: "ins" + inscritoSeq,
      forma: base ? base.forma : "rect",
      telaNombre: base ? base.telaNombre : ((state.telas[0] && state.telas[0].nombre) || ""),
      largo: base ? base.largo : "", ancho: base ? base.ancho : "",
      padSup: base ? base.padSup : "0.1", padInf: base ? base.padInf : "0.1",
      padIzq: base ? base.padIzq : "0.1", padDer: base ? base.padDer : "0.1",
      orient: base ? base.orient : "largo", union: base ? base.union : "0.045",
      bordeModo: base ? base.bordeModo : "uniforme", bordeValor: base ? base.bordeValor : "0.045",
      bordes: base ? cpB(base.bordes) : defB(),
    };
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
        defaults: BORDE_DEFAULTS, bordes: bordesDePieza(ins), ojetillos: 0, valorOjetillo: 0,
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
      return `Ventana en ${r.tela.nombre} ${dim} — ${money(r.o.subtotalLote / r.N)}/u`;
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
        lo.appendChild(selO); grid.appendChild(lo);
        card.appendChild(grid);
        // Posición — margen por arista. Al editar una, la opuesta se completa para que calce.
        const pcap = document.createElement("p"); pcap.className = "muted small"; pcap.textContent = "Posición — margen desde cada arista (m). Centrado por defecto; al editar una, la opuesta se ajusta."; card.appendChild(pcap);
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
        acc.appendChild(bCentrar); acc.appendChild(bLimpiar); card.appendChild(acc);
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
        if (esCirc) { const nc = document.createElement("p"); nc.className = "muted small"; nc.textContent = "El círculo se centra en el paño base; el padding lo desplaza (N/S/E/O). Puede exceder el paño: solo se dibuja lo que queda dentro."; card.appendChild(nc); }
        const pcap = document.createElement("p"); pcap.className = "muted small"; pcap.textContent = esCirc ? "Posición del centro — padding por punto cardinal (m)." : "Posición — margen desde cada arista (m). Si un margen es 0, ese lado coincide con el borde y el corte queda abierto ahí."; card.appendChild(pcap);
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
        acc.appendChild(bC); acc.appendChild(bL); card.appendChild(acc);
        // Aristas a dibujar (solo corte rectangular) — visible.
        if (!esCirc) {
          const lcap = document.createElement("p"); lcap.className = "muted small"; lcap.textContent = "Aristas a dibujar (apaga lados para un corte recto; deja una sola = una línea):"; card.appendChild(lcap);
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
          const acap = document.createElement("p"); acap.className = "muted small"; acap.textContent = "Ángulo y pivote (arrastra las barras; pivote 0–1: 0,0 = esquina sup-izq · 0.5,0.5 = centro):"; adv.appendChild(acap);
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
          const ocap = document.createElement("p"); ocap.className = "muted small"; ocap.textContent = "Ojetillos por arista del corte (solo van al dibujo de taller):"; adv.appendChild(ocap);
          const ogrid = document.createElement("div"); ogrid.className = "pieza-grid";
          [["sup", "Superior"], ["inf", "Inferior"], ["izq", "Izquierda"], ["der", "Derecha"]].forEach(([k, lab]) => {
            const l = document.createElement("label"); l.className = "field"; l.innerHTML = "<span>" + lab + "</span>";
            const inp = document.createElement("input"); inp.type = "text"; inp.inputMode = "numeric"; inp.value = (c.oj && c.oj[k]) || "0";
            inp.addEventListener("input", (e) => { c.oj[k] = e.target.value; refresh(); onChange(); });
            l.appendChild(inp); ogrid.appendChild(l);
          });
          adv.appendChild(ogrid);
        } else {
          const ocap = document.createElement("p"); ocap.className = "muted small"; ocap.textContent = "Ojetillos del corte (repartidos alrededor del círculo; solo al dibujo de taller):"; adv.appendChild(ocap);
          const ol = document.createElement("label"); ol.className = "field"; ol.innerHTML = "<span>Ojetillos (alrededor)</span>";
          const oi = document.createElement("input"); oi.type = "text"; oi.inputMode = "numeric"; oi.value = c.ojCirc || "0";
          oi.addEventListener("input", (e) => { c.ojCirc = e.target.value; refresh(); onChange(); });
          ol.appendChild(oi); adv.appendChild(ol);
        }
        const mcap = document.createElement("p"); mcap.className = "muted small"; mcap.textContent = "Materiales del corte (solo al dibujo de taller, no a la cotización):"; adv.appendChild(mcap);
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

  // ---------- Ojetillos ----------
  document.querySelectorAll('input[name="ojmode"]').forEach((r) =>
    r.addEventListener("change", (e) => {
      state.ojMode = e.target.value;
      if (state.ojMode === "arista" && state.ojAristas.length === 0) state.ojSubstate = "count";
      renderOjetillos(); recompute();
    }));

  function ojInt(v) {
    const r = window.CalcCIBSA.evalExpr(v);   // acepta expresiones aritméticas y coma
    return (r == null || isNaN(r)) ? 0 : Math.max(0, Math.round(r));
  }
  function nOjetillos() {
    if (state.ojMode === "total") return ojInt(state.ojTotal);
    return state.ojAristas.reduce((s, v) => s + ojInt(v), 0);
  }
  function ojDetalle() {
    const n = nOjetillos();
    if (state.ojMode === "total") return `${n} ojetillos en total.`;
    return `${n} ojetillos en total (por arista: ${state.ojAristas.map(ojInt).join(", ")}).`;
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
      return;
    }
    if (state.ojSubstate === "count") {
      const wrap = document.createElement("div");
      wrap.innerHTML = `<div class="oj-row">
        <input id="oj_aristas_in" type="text" inputmode="numeric" step="1" value="${state.ojAristasN}" />
        <button id="oj_confirm" class="btn-accent" type="button">Confirmar</button>
        <span class="muted small">Número de aristas (máx. 6)</span></div>`;
      c.appendChild(wrap);
      if (state.ojError) {
        const e = document.createElement("div"); e.className = "oj-err"; e.textContent = state.ojError; c.appendChild(e);
      }
      $("oj_aristas_in").addEventListener("input", (e) => { state.ojAristasN = e.target.value; });
      $("oj_aristas_in").addEventListener("blur", (e) => {
        const r = window.CalcCIBSA.evalExpr(e.target.value);
        if (r != null && !isNaN(r)) { state.ojAristasN = String(Math.max(0, Math.round(r))); e.target.value = state.ojAristasN; }
      });
      $("oj_confirm").addEventListener("click", confirmarAristas);
      return;
    }
    // substate fields
    const grid = document.createElement("div"); grid.className = "oj-grid";
    state.ojAristas.forEach((val, i) => {
      const cell = document.createElement("div"); cell.className = "oj-cell";
      cell.innerHTML = `<span class="x" data-i="${i}">✕</span><label>Arista ${i + 1}</label>
        <input type="text" inputmode="numeric" step="1" value="${val}" data-i="${i}" />`;
      grid.appendChild(cell);
    });
    c.appendChild(grid);
    grid.querySelectorAll("input").forEach((inp) => {
      inp.addEventListener("input", (e) => { state.ojAristas[+e.target.dataset.i] = e.target.value; actualizarTotalOj(); recompute(); });
      inp.addEventListener("blur", (e) => {
        const r = window.CalcCIBSA.evalExpr(e.target.value);
        if (r != null && !isNaN(r)) {
          const i = +e.target.dataset.i;
          state.ojAristas[i] = String(Math.max(0, Math.round(r)));
          e.target.value = state.ojAristas[i]; actualizarTotalOj(); recompute();
        }
      });
    });
    grid.querySelectorAll(".x").forEach((x) =>
      x.addEventListener("click", (e) => quitarArista(+e.target.dataset.i)));
    const bar = document.createElement("div"); bar.className = "oj-row"; bar.style.marginTop = "8px";
    bar.innerHTML = `<button id="oj_mod" class="btn-outline" type="button">Modificar</button>
      <span id="oj_total_lbl" class="oj-total">Total ojetillos: ${nOjetillos()}</span>`;
    c.appendChild(bar);
    $("oj_mod").addEventListener("click", () => { state.ojSubstate = "count"; state.ojError = ""; state.ojAristasN = state.ojAristas.length || 1; renderOjetillos(); });
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
    if (state.docMode === "preliminar") { recomputePrelim(); return; }
    if (state.docMode === "formal" && state.prodMode === "compuesto") { recomputeCompuesto(); return; }
    recomputeUniforme();
  }

  function recomputeUniforme() {
    telaInfo();
    const cont = $("cmpCards"); cont.innerHTML = ""; state.loteUnif = null;
    const avisos = $("avisosUnif"); if (avisos) avisos.innerHTML = "";
    const tela = telaActual();
    const largo = num("f_largo", null), ancho = num("f_ancho", null);
    const sk = $("sketchUnif");
    if (sk && window.SketchCIBSA) {
      sk.innerHTML = window.SketchCIBSA.sketchSVG({ ancho: ancho || 0, largo: largo || 0, ojTotal: nOjetillos(), ventanas: [], cortes: cortesSpec(state.cortesUnif), bolsillos: bolsillosDe(state.bordeModo, state.bordes) });
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
        union: num("f_union", 0.045), altura: alturaUnif(), defaults: BORDE_DEFAULTS, bordes: bordesActuales(),
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
  function ojTotalPieza(pz) {
    if (pz.ojMode === "arista") return (pz.ojAristas || []).reduce((s, v) => s + ojIntPz(v), 0);
    return ojIntPz(pz.ojetillos);
  }
  function ojetillosTxtPieza(pz) {
    const n = ojTotalPieza(pz);
    let t = n + " ojetillos c/u";
    if (pz.ojMode === "arista") t += " (por arista: " + (pz.ojAristas || []).map(ojIntPz).join(", ") + ")";
    return t;
  }
  // Spec del dibujo (sketch) de una pieza: dimensiones, ojetillos y ventanas inscritas.
  function sketchPieza(pz) {
    const ev = window.CalcCIBSA.evalExpr;
    const a = ev(pz.ancho), l = ev(pz.largo);
    const ventanas = (pz.inscritos || []).map((ins) => {
      const x = ev(ins.padIzq), y = ev(ins.padSup), w = ev(ins.ancho), h = ev(ins.largo);
      return (w > 0 && h > 0) ? { x: (x == null || isNaN(x)) ? 0 : x, y: (y == null || isNaN(y)) ? 0 : y, w: w, h: h, circ: ins.forma === "circ" } : null;
    }).filter(Boolean);
    return { ancho: a > 0 ? a : 0, largo: l > 0 ? l : 0, ojTotal: ojTotalPieza(pz), ventanas: ventanas, cortes: cortesSpec(pz.cortes), bolsillos: bolsillosDe(pz.bordeModo, pz.bordes) };
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
    } catch (e) { alert("Error al generar el dibujo:\n" + (e.message || e)); }
  }
  function nombreBaseArchivo() {
    const nombre = $("f_nombre").value.trim(), apellido = $("f_apellido").value.trim();
    if (!nombre || !apellido) return "Dibujo";
    return window.PDFCotizacion.nombreArchivo({ cliente: { nombre, apellido }, version: $("f_version").value.trim() || "01", fecha: new Date() });
  }
  async function descargarSketchUnif() {
    const largo = num("f_largo", null), ancho = num("f_ancho", null);
    if (largo == null || ancho == null || largo <= 0 || ancho <= 0) return alert("Ingresa largo y ancho para descargar el dibujo.");
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
      sketch: { ancho: ancho, largo: largo, ojTotal: nOjetillos(), ventanas: [], cortes: cortesSpec(state.cortesUnif), bolsillos: bolsillosDe(state.bordeModo, state.bordes) },
    });
  }
  async function descargarSketchPieza(pz) {
    const ev = window.CalcCIBSA.evalExpr, f = window.CalcCIBSA.fmtNum;
    const largo = ev(pz.largo), ancho = ev(pz.ancho);
    if (!(largo > 0) || !(ancho > 0)) return alert("Esta pieza necesita largo y ancho para el dibujo.");
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
      if (pz.ojMode === "arista" && (!pz.ojAristas || !pz.ojAristas.length)) {
        pz.ojAristasN = pz.ojAristasN || 4;
        pz.ojAristas = Array.from({ length: pz.ojAristasN }, () => "2");
      }
      renderPiezaOjetillos(container, pz); onChange();
    });
    lm.appendChild(sel); container.appendChild(lm);
    if ((pz.ojMode || "total") === "total") {
      const li = document.createElement("label"); li.className = "field";
      const s2 = document.createElement("span"); s2.textContent = "Cantidad total (c/u)"; li.appendChild(s2);
      const inp = document.createElement("input"); inp.type = "text"; inp.inputMode = "numeric"; inp.value = pz.ojetillos || "0";
      inp.addEventListener("input", (e) => { pz.ojetillos = e.target.value; onChange(); });
      inp.addEventListener("blur", (e) => { const r = window.CalcCIBSA.evalExpr(e.target.value); if (r != null && !isNaN(r)) { pz.ojetillos = String(Math.max(0, Math.round(r))); e.target.value = pz.ojetillos; onChange(); } });
      li.appendChild(inp); container.appendChild(li);
      return;
    }
    const ln = document.createElement("label"); ln.className = "field";
    const s3 = document.createElement("span"); s3.textContent = "Número de aristas (máx. 6)"; ln.appendChild(s3);
    const inpN = document.createElement("input"); inpN.type = "text"; inpN.inputMode = "numeric"; inpN.value = String(pz.ojAristasN || (pz.ojAristas ? pz.ojAristas.length : 4));
    inpN.addEventListener("change", (e) => {
      let n = parseInt(window.CalcCIBSA.evalExpr(e.target.value) || 0, 10) || 0; n = Math.max(1, Math.min(6, n));
      pz.ojAristasN = n;
      const cur = pz.ojAristas || []; const nuevas = [];
      for (let i = 0; i < n; i++) nuevas.push(i < cur.length ? cur[i] : "2");
      pz.ojAristas = nuevas; renderPiezaOjetillos(container, pz); onChange();
    });
    ln.appendChild(inpN); container.appendChild(ln);
    const grid = document.createElement("div"); grid.className = "oj-grid";
    (pz.ojAristas || []).forEach((val, i) => {
      const cell = document.createElement("div"); cell.className = "oj-cell";
      const lab = document.createElement("label"); lab.textContent = "Arista " + (i + 1); cell.appendChild(lab);
      const inp = document.createElement("input"); inp.type = "text"; inp.inputMode = "numeric"; inp.value = val;
      const refrescaTotal = () => { const tl = container.querySelector(".pz-oj-total"); if (tl) tl.textContent = "Total: " + ojTotalPieza(pz); };
      inp.addEventListener("input", (e) => { pz.ojAristas[i] = e.target.value; refrescaTotal(); onChange(); });
      inp.addEventListener("blur", (e) => { const r = window.CalcCIBSA.evalExpr(e.target.value); if (r != null && !isNaN(r)) { pz.ojAristas[i] = String(Math.max(0, Math.round(r))); e.target.value = pz.ojAristas[i]; refrescaTotal(); onChange(); } });
      cell.appendChild(inp); grid.appendChild(cell);
    });
    container.appendChild(grid);
    const tot = document.createElement("div"); tot.className = "oj-total pz-oj-total"; tot.textContent = "Total: " + ojTotalPieza(pz);
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
        <div class="pz-sketch sketch"></div>
        <div><button class="btn-outline pz-descargar" type="button">Descargar dibujo (PDF)</button></div>
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
        defaults: BORDE_DEFAULTS, bordes: bordesDePieza(pz),
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
      if (sketchBox && window.SketchCIBSA) {
        sketchBox.innerHTML = window.SketchCIBSA.sketchSVG(sketchPieza(pz));
      }
      const card = list ? list.querySelector('[data-id="' + pz.id + '"] .pieza-sub') : null;
      if (r) {
        const compUnit = compTotalUnit(pz.complementos);
        const insTot = inscritosTotal(pz);
        const piezaTotal = r.o.subtotalLote + compUnit * r.lote.N + insTot;
        r.compUnit = compUnit; r.insTot = insTot; r.piezaTotal = piezaTotal;
        subtotalGen += piezaTotal; calcs.push({ pz, r });
        if (card) {
          let s = `Subtotal: <b>${money(piezaTotal)}</b> · ${r.lote.N} u × (${r.largo}×${r.ancho} m) · ${r.o.panosUnit} paños/u`;
          s += ` · <span class="muted">tela: rollo ${r.tela.anchoRollo} m · m² ${money(r.tela.valorM2)}</span>`;
          if (compUnit > 0) s += ` · +${(pz.complementos || []).length} complemento(s)`;
          if ((pz.inscritos || []).length) s += ` · +${pz.inscritos.length} ventana(s)`;
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
    if (resumen) {
      if (!calcs.length) {
        resumen.innerHTML = '<p class="muted small">Agrega piezas con largo, ancho y tela para ver el total.</p>';
      } else {
        let h = '<div class="cmp-card"><div class="h">Resumen (' + calcs.length + ' pieza' + (calcs.length > 1 ? 's' : '') + ')</div>';
        h += `<div class="muted small">Subtotal neto: ${money(subtotalGen)}</div>`;
        if (desc > 0) { h += `<div class="muted small">Descuento ${desc}%: -${money(descuento)}</div>`; h += `<div class="muted small">Neto con descuento: ${money(neto)}</div>`; }
        h += `<div class="muted small">IVA ${CFG.IVA_PCT}%: ${money(iva)}</div>`;
        h += `<div class="total">${money(total)}</div></div>`;
        resumen.innerHTML = h;
      }
    }
    state.compuesto = { calcs, subtotalGen, desc, descuento, neto, iva, total };
  }

  // ---------- Limpiar ----------
  $("btnLimpiar").addEventListener("click", () => {
    ["f_nombre", "f_apellido", "f_email", "f_largo", "f_ancho", "f_titulo", "f_observaciones"].forEach((id) => ($(id).value = ""));
    $("f_cantidad").value = "1"; $("f_ojvalor").value = "450"; $("f_dias").value = "3"; $("f_descuento").value = "0"; $("f_version").value = "01";
    $("f_union").value = "0.045";
    $("f_usaAlto").checked = false; $("f_altura").value = ""; $("wAltura").classList.add("hidden");
    state.ojMode = "total"; state.ojTotal = 8; state.ojAristas = []; state.ojSubstate = "count"; state.ojAristasN = 4; state.ojError = "";
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
    renderPiezas(); renderBordes(); renderComplementosUnif(); renderCortesUnif(); aplicarVis();
    renderOjetillos(); recompute();
  });

  // ---------- Generar ----------
  $("btnGenerar").addEventListener("click", generar);
  { const b = $("btnDescargarSketch"); if (b) b.addEventListener("click", descargarSketchUnif); }

  async function generar() {
    if (state.docMode === "preliminar") return generarPrelim();
    if (state.docMode === "formal" && state.prodMode === "compuesto") return generarCompuesto();
    const nombre = $("f_nombre").value.trim(), apellido = $("f_apellido").value.trim();
    const largo = num("f_largo", null), ancho = num("f_ancho", null), tela = telaActual();
    if (!nombre || !apellido) return alert("Ingresa nombre y apellido del cliente.");
    if (!tela) return alert("Selecciona una tela.");
    if (largo == null || ancho == null || largo <= 0 || ancho <= 0) return alert("Largo y ancho deben ser mayores que 0.");
    recomputeUniforme();
    const lote = state.loteUnif;
    if (!lote) return alert("No se pudo calcular. Revisa los datos.");
    const o = state.orientUnif === "ancho" ? lote.oAncho : lote.oLargo;
    const N = lote.N;
    const desc = num("f_descuento", 0);
    const ojeTotal = lote.nOjetillos * lote.valorOjetillo * N;
    const compTotal = compTotalUnit(state.complementosUnif) * N;
    const subtotal = o.materialLote + ojeTotal + compTotal;
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
      sketch: { ancho: ancho, largo: largo, ojTotal: lote.nOjetillos, ventanas: [], cortes: cortesSpec(state.cortesUnif), bolsillos: bolsillosDe(state.bordeModo, state.bordes) },
    };

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
    return out;
  }

  // ---------- Generar cotización compuesta ----------
  async function generarCompuesto() {
    const nombre = $("f_nombre").value.trim(), apellido = $("f_apellido").value.trim();
    if (!nombre || !apellido) return alert("Ingresa nombre y apellido del cliente.");
    if (!state.piezas.length) return alert("Agrega al menos una pieza.");
    const dup = etiquetasDuplicadas();
    if (dup.length) return alert("Hay etiquetas de pieza repetidas: " + dup.join(", ") + ". Usa un nombre distinto para cada pieza.");
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
        inscritosLineas: inscritosLineasPDF(pz),
        sketch: sketchPieza(pz),
        valorUnitario: r.o.valorUnitario + (r.compUnit || 0) + ((r.insTot || 0) / r.lote.N),
        valorTotal: r.piezaTotal != null ? r.piezaTotal : r.o.subtotalLote,
      })),
    };

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
    const a = document.createElement("a");
    a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
  }

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
    aplicarVis();
    const s = window.AuthCIBSA.sesionGuardada();
    if (s) { cargarTelas().catch(() => mostrarLogin()); } else { mostrarLogin(); }
  })();
})();
