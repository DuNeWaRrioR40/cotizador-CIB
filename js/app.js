/* Controlador de la app web Cotizador CIBSA. */
(function () {
  const $ = (id) => document.getElementById(id);
  const CFG = window.CONFIG;
  const money = window.CalcCIBSA.money;

  const state = {
    telas: [], orientaciones: null, orientacionSel: "mayor",
    ojMode: "total", ojTotal: 8, ojSubstate: "count", ojAristasN: 4,
    ojAristas: [], ojError: "", ultimoPdf: null, progTimer: null, progVal: 0,
  };

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
      o.value = t.nombre; o.textContent = t.nombre; sel.appendChild(o);
    });
    mostrarForm();
    renderOjetillos();
    recompute();
  }

  // ---------- Helpers de lectura ----------
  function num(id, def) {
    const v = parseFloat(String($(id).value).replace(",", "."));
    return isNaN(v) ? def : v;
  }
  function telaActual() {
    return state.telas.find((t) => t.nombre === $("f_tela").value) || null;
  }
  function telaInfo() {
    const t = telaActual();
    $("telaInfo").textContent = t
      ? `Valor m²: ${money(t.valorM2)}   ·   Ancho de rollo: ${t.anchoRollo} m` : "";
  }

  // ---------- Ojetillos ----------
  document.querySelectorAll('input[name="ojmode"]').forEach((r) =>
    r.addEventListener("change", (e) => {
      state.ojMode = e.target.value;
      if (state.ojMode === "arista" && state.ojAristas.length === 0) state.ojSubstate = "count";
      renderOjetillos(); recompute();
    }));

  function nOjetillos() {
    if (state.ojMode === "total") return Math.max(0, parseInt(state.ojTotal, 10) || 0);
    return state.ojAristas.reduce((s, v) => s + (parseInt(v, 10) || 0), 0);
  }
  function ojDetalle() {
    const n = nOjetillos();
    if (state.ojMode === "total") return `${n} ojetillos en total.`;
    return `${n} ojetillos en total (por arista: ${state.ojAristas.map((v) => parseInt(v, 10) || 0).join(", ")}).`;
  }

  function renderOjetillos() {
    const c = $("ojDyn"); c.innerHTML = "";
    if (state.ojMode === "total") {
      c.innerHTML = `<label class="field"><span>Cantidad total</span>
        <input id="oj_total_in" type="number" inputmode="numeric" step="1" value="${state.ojTotal}" /></label>`;
      $("oj_total_in").addEventListener("input", (e) => { state.ojTotal = e.target.value; recompute(); });
      return;
    }
    if (state.ojSubstate === "count") {
      const wrap = document.createElement("div");
      wrap.innerHTML = `<div class="oj-row">
        <input id="oj_aristas_in" type="number" inputmode="numeric" step="1" value="${state.ojAristasN}" />
        <button id="oj_confirm" class="btn-accent" type="button">Confirmar</button>
        <span class="muted small">Número de aristas (máx. 6)</span></div>`;
      c.appendChild(wrap);
      if (state.ojError) {
        const e = document.createElement("div"); e.className = "oj-err"; e.textContent = state.ojError; c.appendChild(e);
      }
      $("oj_aristas_in").addEventListener("input", (e) => { state.ojAristasN = e.target.value; });
      $("oj_confirm").addEventListener("click", confirmarAristas);
      return;
    }
    // substate fields
    const grid = document.createElement("div"); grid.className = "oj-grid";
    state.ojAristas.forEach((val, i) => {
      const cell = document.createElement("div"); cell.className = "oj-cell";
      cell.innerHTML = `<span class="x" data-i="${i}">✕</span><label>Arista ${i + 1}</label>
        <input type="number" inputmode="numeric" step="1" value="${val}" data-i="${i}" />`;
      grid.appendChild(cell);
    });
    c.appendChild(grid);
    grid.querySelectorAll("input").forEach((inp) =>
      inp.addEventListener("input", (e) => { state.ojAristas[+e.target.dataset.i] = e.target.value; actualizarTotalOj(); recompute(); }));
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
    const n = parseInt(state.ojAristasN, 10);
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

  // ---------- Comparación de costuras ----------
  ["f_largo", "f_ancho", "f_descuento", "f_ojvalor"].forEach((id) =>
    $(id).addEventListener("input", recompute));
  $("f_tela").addEventListener("change", recompute);

  function recompute() {
    telaInfo();
    const cont = $("cmpCards"); cont.innerHTML = ""; state.orientaciones = null;
    const tela = telaActual();
    const largo = num("f_largo", null), ancho = num("f_ancho", null);
    if (!tela || largo == null || ancho == null || largo <= 0 || ancho <= 0) {
      cont.innerHTML = '<p class="muted small">Ingresa largo, ancho y tela para ver los montos.</p>';
      return;
    }
    try {
      state.orientaciones = window.CalcCIBSA.calcularOrientaciones({
        largo, ancho, valorM2: tela.valorM2, anchoRollo: tela.anchoRollo,
        nOjetillos: nOjetillos(), valorOjetillo: num("f_ojvalor", CFG.VALOR_OJETILLO_DEFAULT),
        descuentoPct: num("f_descuento", 0),
      });
    } catch (e) { return; }
    cardOrient("mayor", "Paralelas al lado más largo", "Costuras a lo largo");
    cardOrient("menor", "Paralelas al lado más corto", "Costuras a lo ancho");
  }
  function cardOrient(key, sub, head) {
    const d = state.orientaciones[key], r = d.res, sel = state.orientacionSel === key;
    const el = document.createElement("div");
    el.className = "cmp-card" + (sel ? " sel" : "");
    el.innerHTML = `<div class="h">${head}${sel ? " ✓" : ""}</div>
      <div class="muted small">${sub} (${d.lado} m)</div>
      <div class="total">${money(r.total)}</div>
      <div class="muted small">${r.panos} paños · ${r.m2} m² · IVA incl.</div>
      <div class="muted small">Material neto ${money(r.material)}</div>`;
    el.addEventListener("click", () => { state.orientacionSel = key; recompute(); });
    $("cmpCards").appendChild(el);
  }

  // ---------- Limpiar ----------
  $("btnLimpiar").addEventListener("click", () => {
    ["f_nombre", "f_apellido", "f_email", "f_largo", "f_ancho", "f_titulo"].forEach((id) => ($(id).value = ""));
    $("f_ojvalor").value = "450"; $("f_dias").value = "3"; $("f_descuento").value = "0"; $("f_version").value = "01";
    state.ojMode = "total"; state.ojTotal = 8; state.ojAristas = []; state.ojSubstate = "count"; state.ojAristasN = 4; state.ojError = "";
    document.querySelector('input[name="ojmode"][value="total"]').checked = true;
    state.orientacionSel = "mayor"; $("resultHolder").innerHTML = ""; $("formStatus").textContent = "";
    renderOjetillos(); recompute();
  });

  // ---------- Generar ----------
  $("btnGenerar").addEventListener("click", generar);

  async function generar() {
    const nombre = $("f_nombre").value.trim(), apellido = $("f_apellido").value.trim();
    const largo = num("f_largo", null), ancho = num("f_ancho", null), tela = telaActual();
    if (!nombre || !apellido) return alert("Ingresa nombre y apellido del cliente.");
    if (!tela) return alert("Selecciona una tela.");
    if (largo == null || ancho == null || largo <= 0 || ancho <= 0) return alert("Largo y ancho deben ser mayores que 0.");
    if (!state.orientaciones) return alert("No se pudo calcular. Revisa los datos.");

    const res = state.orientaciones[state.orientacionSel].res;
    const desc = num("f_descuento", 0);
    const datos = {
      cliente: { nombre, apellido, email: $("f_email").value.trim() },
      version: $("f_version").value.trim() || "01", fecha: new Date(),
      largo, ancho, tela, calc: res,
      titulo: $("f_titulo").value.trim() || null,
      ojetillosDetalle: ojDetalle(),
      diasEntrega: parseInt(num("f_dias", CFG.DIAS_ENTREGA_DEFAULT), 10),
      descuentoLabel: desc > 0 ? `Descuento ${desc}% (pago contado)` : null,
    };

    abrirProgreso();
    try {
      const { bytes, filename } = await window.PDFCotizacion.generarCotizacion(datos);
      const blob = new Blob([bytes], { type: "application/pdf" });
      genListo(blob, filename, res);
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
  function cerrarProgreso() { clearInterval(state.progTimer); $("progressModal").classList.add("hidden"); }

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

    // Resultado persistente en el formulario
    $("resultHolder").innerHTML = `<span class="ok">✓ Generado:</span> <span class="muted small">${filename}</span> `;
    const a = document.createElement("a"); a.href = "#"; a.textContent = "Abrir / Descargar";
    a.onclick = (e) => { e.preventDefault(); descargar(url, filename); };
    $("resultHolder").appendChild(a);

    setTimeout(cerrarProgreso, 2000);
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
    const s = window.AuthCIBSA.sesionGuardada();
    if (s) { cargarTelas().catch(() => mostrarLogin()); } else { mostrarLogin(); }
  })();
})();
