/* Checkout CIBSA — página de pago que corre en el DISPOSITIVO DEL CLIENTE, dentro de la
   vista cliente remota (?vista=cliente&s=SID). La app del vendedor publica el payload `chk`
   (ítems, totales BRUTOS con IVA y datos de prellenado) por el mismo canal RTDB de la vista QR;
   aquí se muestra la oferta (barra inferior), el formulario de individualización (persona
   natural / empresa), la entrega (retiro o despacho por pagar), los términos y condiciones y
   el botón de pago que conecta con Webpay Plus (vía el backend WEBPAY_FN_URL, Fase 2).
   Look: fondo blanco, minimalista; los botones de pago son el protagonista. */
(function (global) {
  "use strict";
  const CFG = () => global.CONFIG || {};
  const money = (n) => "$" + Math.round(n || 0).toLocaleString("es-CL");
  const esc = (t) => String(t == null ? "" : t).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const RETIRO_DIR = "Santa Elena 2205, San Joaquín, Santiago";
  const RETIRO_HOR = "Lunes a viernes, 10:00 a 17:30 hrs";
  const COURIERS = ["Starken", "FedEx"];

  // ---------- RUT / RUN / CIE: dígito verificador módulo 11 (Registro Civil) ----------
  // Cuerpo por 2,3,4,5,6,7 cíclico desde la derecha; DV = 11 − (suma mod 11); 11→"0", 10→"K".
  // El RUN de la cédula de extranjeros (CIE) usa el mismo esquema.
  function rutLimpio(v) { return String(v || "").toUpperCase().replace(/[^0-9K]/g, ""); }
  function rutDV(cuerpo) {
    let s = 0, m = 2;
    for (let i = cuerpo.length - 1; i >= 0; i--) { s += parseInt(cuerpo.charAt(i), 10) * m; m = m === 7 ? 2 : m + 1; }
    const r = 11 - (s % 11);
    return r === 11 ? "0" : r === 10 ? "K" : String(r);
  }
  function rutValido(v) {
    const t = rutLimpio(v);
    if (t.length < 7 || t.length > 9) return false;
    const cuerpo = t.slice(0, -1), dv = t.slice(-1);
    if (!/^[0-9]+$/.test(cuerpo)) return false;
    return rutDV(cuerpo) === dv;
  }
  function rutFormato(v) {
    const t = rutLimpio(v);
    if (t.length < 2) return t;
    const cuerpo = t.slice(0, -1), dv = t.slice(-1);
    let out = "", c = 0;
    for (let i = cuerpo.length - 1; i >= 0; i--) { out = cuerpo.charAt(i) + out; if (++c % 3 === 0 && i > 0) out = "." + out; }
    return out + "-" + dv;
  }
  const emailValido = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(v || "").trim());
  const fonoValido = (v) => (String(v || "").replace(/\D/g, "").length >= 8);

  // ---------- Estado ----------
  let _chk = null, _sid = "", _abierto = false, _cache = null;
  // "Perdón" (apple-design): cerrar el checkout NO borra lo escrito — se captura todo y se
  // restaura al reabrir (incluido el tipo natural/empresa, la entrega y los checkboxes).
  function capturar() {
    const ov = document.getElementById("ckOv"); if (!ov) return _cache;
    const seg = ov.querySelector(".ck-seg .on");
    const vals = {};
    ov.querySelectorAll("input[id], select[id]").forEach((el) => { vals[el.id] = (el.type === "checkbox") ? el.checked : el.value; });
    return { emp: !!(seg && seg.getAttribute("data-t") === "empresa"), vals: vals, ent: (ov.querySelector('input[name="ckEnt"]:checked') || {}).value || "retiro" };
  }

  // ---------- Barra de oferta (vive en la vista cliente, bajo el plano) ----------
  function oferta(chk, sid) {
    _sid = sid || _sid;
    if (!_abierto) _chk = chk || null;
    let bar = document.getElementById("ckBar");
    if (!_chk) { if (bar) bar.remove(); return; }
    if (!bar) {
      bar = document.createElement("div"); bar.id = "ckBar"; bar.className = "ck-bar";
      document.body.appendChild(bar);
      bar.addEventListener("click", (e) => { if (e.target.closest("#ckIr")) abrir(); });
    }
    if (!bar.firstChild) {
      bar.innerHTML = '<div class="ck-bar-tot"><span>Total de la compra</span><b></b><span class="ck-iva">IVA incluido</span></div>' +
        '<button type="button" id="ckIr" class="ck-btn-pagar">Proceder al checkout</button>';
    }
    const tot = bar.querySelector(".ck-bar-tot b");
    if (tot && tot.textContent !== money(_chk.total)) tot.textContent = money(_chk.total);
  }

  // ---------- Formularios ----------
  const F_CONTACTO = [
    ["nombre", "Nombre"], ["apPat", "Apellido Paterno"], ["apMat", "Apellido Materno"],
    ["run", "RUN / CIE"], ["email", "Correo electrónico"], ["fono", "Teléfono"],
    ["dir", "Dirección"], ["comuna", "Comuna"],
  ];
  const F_EMPRESA = [
    ["rut", "RUT"], ["razon", "Razón Social"], ["giro", "Giro"], ["email", "Correo electrónico"],
    ["fono", "Teléfono"], ["dir", "Dirección"], ["comuna", "Comuna"],
  ];
  function campo(pref, k, lbl, val, tipo) {
    const esId = (k === "run" || k === "rut");
    return '<label class="ck-field" data-f="' + pref + k + '"><span>' + lbl + '</span>' +
      '<input id="ck_' + pref + k + '" type="' + (tipo || "text") + '" autocomplete="off" value="' + esc(val || "") + '"' +
      (esId ? ' inputmode="text" placeholder="12.345.678-9"' : "") + ' />' +
      (esId ? '<em class="ck-rutchk" id="ck_' + pref + k + '_ok"></em>' : "") + "</label>";
  }
  function formNatural(pre) {
    const p = pre || {};
    const v = { nombre: p.nombre, apPat: p.apellido, apMat: "", run: "", email: p.email, fono: p.fono, dir: p.dir, comuna: p.comuna };
    return '<div class="ck-grid">' + F_CONTACTO.map(([k, l]) => campo("n_", k, l, v[k], k === "email" ? "email" : k === "fono" ? "tel" : "text")).join("") + "</div>" +
      '<input type="hidden" id="ck_n_giro" value="Sin Giro Asociado" />';
  }
  function formEmpresa(pre) {
    const p = pre || {}, e = (p && p.emp) || {};
    const vc = { nombre: p.nombre, apPat: p.apellido, apMat: "", run: "", email: p.email, fono: p.fono, dir: p.dir, comuna: p.comuna };
    return '<h3 class="ck-h3">Persona de contacto</h3><div class="ck-grid">' +
      F_CONTACTO.map(([k, l]) => campo("c_", k, l, vc[k], k === "email" ? "email" : k === "fono" ? "tel" : "text")).join("") + "</div>" +
      '<h3 class="ck-h3">Empresa</h3>' +
      '<label class="ck-chk ck-mismo"><input id="ck_mismo" type="checkbox" /> <span>Usar la misma información de los datos de contacto (correo, teléfono, dirección y comuna — salvo el Giro)</span></label>' +
      '<div class="ck-grid">' + F_EMPRESA.map(([k, l]) => campo("e_", k, l, e[k], k === "email" ? "email" : k === "fono" ? "tel" : "text")).join("") + "</div>";
  }

  // ---------- Resumen de compra ----------
  function resumenHTML(chk) {
    const filas = (chk.items || []).map((it) =>
      '<tr><td class="ck-cant">' + esc(it.c) + '</td><td>' + esc(it.d) + '</td><td class="ck-val">' + money(it.t) + "</td></tr>").join("");
    const desc = chk.desc > 0 ? '<tr class="ck-desc"><td></td><td>Descuentos</td><td class="ck-val">−' + money(chk.desc) + "</td></tr>" : "";
    return '<table class="ck-tabla"><thead><tr><th>Cant.</th><th>Detalle</th><th>Valor bruto</th></tr></thead><tbody>' +
      filas + desc +
      '<tr class="ck-total"><td></td><td>TOTAL DE LA COMPRA</td><td class="ck-val">' + money(chk.total) + "</td></tr>" +
      '</tbody></table><p class="ck-nota">Valores brutos: incluyen IVA (' + (chk.iva || 19) + "%).</p>";
  }

  // ---------- Términos y condiciones (borrador — [REVISAR] marca los puntos a validar) ----------
  function datosForm() {
    const V = (id) => { const el = document.getElementById("ck_" + id); return el ? el.value.trim() : ""; };
    const tipo = document.querySelector(".ck-seg .on");
    const esEmp = tipo && tipo.getAttribute("data-t") === "empresa";
    if (!esEmp) {
      return { tipo: "natural", contacto: { nombre: V("n_nombre"), apPat: V("n_apPat"), apMat: V("n_apMat"), run: V("n_run"), email: V("n_email"), fono: V("n_fono"), dir: V("n_dir"), comuna: V("n_comuna"), giro: "Sin Giro Asociado" }, empresa: null };
    }
    return {
      tipo: "empresa",
      contacto: { nombre: V("c_nombre"), apPat: V("c_apPat"), apMat: V("c_apMat"), run: V("c_run"), email: V("c_email"), fono: V("c_fono"), dir: V("c_dir"), comuna: V("c_comuna") },
      empresa: { rut: V("e_rut"), razon: V("e_razon"), giro: V("e_giro"), email: V("e_email"), fono: V("e_fono"), dir: V("e_dir"), comuna: V("e_comuna") },
    };
  }
  function entregaForm() {
    const modo = (document.querySelector('input[name="ckEnt"]:checked') || {}).value || "retiro";
    const courier = (document.getElementById("ck_courier") || {}).value || "";
    return modo === "retiro"
      ? { modo: "retiro", dir: RETIRO_DIR, horario: RETIRO_HOR }
      : { modo: "despacho", courier: courier, flete: "por pagar" };
  }
  function tycTexto() {
    const d = datosForm(), ent = entregaForm(), chk = _chk || {};
    const comprador = d.tipo === "empresa"
      ? "<b>" + esc(d.empresa.razon || "________") + "</b>, RUT " + esc(d.empresa.rut || "________") + ", giro " + esc(d.empresa.giro || "________") +
        ", domiciliada en " + esc((d.empresa.dir || "________") + ", " + (d.empresa.comuna || "")) +
        ", representada para esta compra por " + esc([d.contacto.nombre, d.contacto.apPat, d.contacto.apMat].filter(Boolean).join(" ") || "________") +
        ", RUN " + esc(d.contacto.run || "________")
      : "<b>" + esc([d.contacto.nombre, d.contacto.apPat, d.contacto.apMat].filter(Boolean).join(" ") || "________") + "</b>, RUN/CIE " +
        esc(d.contacto.run || "________") + ", domiciliado(a) en " + esc((d.contacto.dir || "________") + ", " + (d.contacto.comuna || ""));
    const items = (chk.items || []).map((it) => "• " + esc(it.c) + " × " + esc(it.d) + " — " + money(it.t)).join("<br/>");
    const entTxt = ent.modo === "retiro"
      ? "retiro por el comprador en " + esc(RETIRO_DIR) + " (" + esc(RETIRO_HOR) + ")"
      : "despacho POR PAGAR vía " + esc(ent.courier || "courier a elección") + "; el costo del flete es de cargo exclusivo del comprador";
    return '<h3>Términos y Condiciones de Venta — CIBSA</h3>' +
      "<p><b>1. Las partes.</b> Vendedor: CIBSA <span class=\"ck-rev\">[REVISAR: razón social completa y RUT]</span>, domiciliada en " + esc(RETIRO_DIR) + ", correo contacto@cibsa.cl. Comprador: " + comprador + ".</p>" +
      "<p><b>2. Objeto.</b> Compraventa de los siguientes productos confeccionados a medida, según la cotización " +
      esc((chk.cot && (chk.cot.cliente + " · v" + chk.cot.version + (chk.cot.titulo ? " · " + chk.cot.titulo : ""))) || "") + ":<br/>" + items + "</p>" +
      "<p><b>3. Precio y pago.</b> Precio total <b>" + money(chk.total) + "</b> IVA incluido, pagadero íntegramente mediante Webpay Plus (Transbank) al aceptar estos términos. La compra se perfecciona con la confirmación del pago por Transbank.</p>" +
      "<p><b>4. Confección a medida.</b> Los productos se fabrican a medida conforme al plano y especificaciones de la cotización, con un margen de error de confección de aprox. ±4 cm. Por tratarse de bienes confeccionados a la medida del comprador, no procede el derecho a retracto <span class=\"ck-rev\">[REVISAR con abogado: art. 3° bis Ley 19.496]</span>.</p>" +
      "<p><b>5. Plazo.</b> El plazo de fabricación es el indicado en la cotización, contado en días hábiles desde la confirmación del pago.</p>" +
      "<p><b>6. Entrega.</b> " + entTxt + ".</p>" +
      "<p><b>7. Garantía.</b> Garantía legal conforme a la Ley 19.496 por defectos de confección o materiales. No cubre desgaste natural, mal uso, exposición a condiciones fuera de las especificadas en la ficha técnica ni instalaciones efectuadas por terceros.</p>" +
      "<p><b>8. Datos personales.</b> Los datos ingresados se utilizarán exclusivamente para individualizar esta compra, emitir los documentos tributarios, coordinar la entrega y respaldar la operación (con copia a contacto@cibsa.cl y al correo del comprador).</p>";
  }

  // ---------- Página de checkout ----------
  function abrir() {
    if (!_chk || _abierto) return;
    _abierto = true;
    const esEmp0 = !!(_cache && _cache.emp);
    const ov = document.createElement("div"); ov.className = "ck-ov"; ov.id = "ckOv";
    ov.innerHTML =
      '<div class="ck-page">' +
      '<header class="ck-head"><span class="ck-logo">CIBSA</span><span class="ck-tit">Checkout seguro</span>' +
      '<button type="button" class="ck-x" id="ckCerrar" aria-label="Volver al plano">✕</button></header>' +

      '<section class="ck-sec"><h2>Resumen de tu compra</h2>' + resumenHTML(_chk) + "</section>" +

      '<section class="ck-sec"><h2>Identificación</h2>' +
      '<div class="ck-seg" role="tablist">' +
      '<button type="button" class="' + (esEmp0 ? "" : "on") + '" data-t="natural">Persona natural</button>' +
      '<button type="button" class="' + (esEmp0 ? "on" : "") + '" data-t="empresa">Empresa</button></div>' +
      '<div id="ckForm">' + (esEmp0 ? formEmpresa(_chk.pre) : formNatural(_chk.pre)) + "</div></section>" +

      '<section class="ck-sec"><h2>Entrega</h2>' +
      '<label class="ck-chk"><input type="radio" name="ckEnt" value="retiro" checked /> <span>Retiro en tienda</span></label>' +
      '<div class="ck-ent" id="ckEntRetiro"><b>' + esc(RETIRO_DIR) + "</b><br/>Horario de atención: " + esc(RETIRO_HOR) + "</div>" +
      '<label class="ck-chk"><input type="radio" name="ckEnt" value="despacho" /> <span>Despacho <b>por pagar</b></span></label>' +
      '<div class="ck-ent hidden" id="ckEntDesp">Courier: <select id="ck_courier">' +
      COURIERS.map((c) => "<option>" + c + "</option>").join("") +
      '</select><p class="ck-nota">El flete se paga al recibir (por pagar). El costo lo define el courier según destino y volumen.</p></div></section>' +

      '<section class="ck-sec ck-tyc"><h2>Términos y condiciones</h2>' +
      '<label class="ck-chk ck-destacado" id="ckT1w"><input id="ckT1" type="checkbox" /> <span>He leído y <b>acepto los Términos y Condiciones</b> de esta compra. <button type="button" class="ck-link" id="ckVerTyc">Ver términos</button></span></label>' +
      '<label class="ck-chk ck-destacado" id="ckT2w"><input id="ckT2" type="checkbox" /> <span>Declaro que los <b>datos ingresados son verídicos</b> y autorizo su uso para emitir los documentos de esta compra y coordinar la entrega.</span></label>' +
      '<div class="ck-aviso hidden" id="ckAviso"></div>' +
      '<button type="button" class="ck-btn-pagar ck-pagar-final" id="ckPagar">Pagar ' + money(_chk.total) + " con Webpay</button>" +
      '<p class="ck-nota ck-center">Pago procesado por Transbank (Webpay Plus). CIBSA no almacena datos de tarjetas.</p></section>' +
      "</div>";
    document.body.appendChild(ov);
    document.body.classList.add("ck-abierto");

    // Selector natural/empresa
    ov.querySelectorAll(".ck-seg button").forEach((b) => b.addEventListener("click", () => {
      if (b.classList.contains("on")) return;
      ov.querySelectorAll(".ck-seg button").forEach((x) => x.classList.remove("on"));
      b.classList.add("on");
      const fm = document.getElementById("ckForm");
      fm.classList.add("ck-swap");
      setTimeout(() => {
        fm.innerHTML = b.getAttribute("data-t") === "empresa" ? formEmpresa(_chk.pre) : formNatural(_chk.pre);
        wireForm(ov);
        fm.classList.remove("ck-swap");
      }, 150);
    }));
    // Entrega
    ov.querySelectorAll('input[name="ckEnt"]').forEach((r) => r.addEventListener("change", () => {
      const desp = (document.querySelector('input[name="ckEnt"]:checked') || {}).value === "despacho";
      document.getElementById("ckEntRetiro").classList.toggle("hidden", desp);
      document.getElementById("ckEntDesp").classList.toggle("hidden", !desp);
    }));
    ov.querySelector("#ckCerrar").addEventListener("click", cerrar);
    ov.querySelector("#ckVerTyc").addEventListener("click", verTyc);
    ov.querySelector("#ckPagar").addEventListener("click", intentarPago);
    wireForm(ov);
    if (_cache) {
      Object.keys(_cache.vals || {}).forEach((id) => {
        const el = document.getElementById(id); if (!el) return;
        if (el.type === "checkbox") el.checked = !!_cache.vals[id]; else el.value = _cache.vals[id];
      });
      const r = ov.querySelector('input[name="ckEnt"][value="' + _cache.ent + '"]');
      if (r) { r.checked = true; r.dispatchEvent(new Event("change")); }
      const mm = document.getElementById("ck_mismo"); if (mm) mm.dispatchEvent(new Event("change"));
      ov.querySelectorAll("#ckForm input").forEach((el) => { if (/_(run|rut)$/.test(el.id)) el.dispatchEvent(new Event("input")); });
    }
    const esc9 = (e) => {
      if (e.key !== "Escape") return;
      const m = document.getElementById("ckTycModal");
      if (m) { m.classList.add("ck-out"); setTimeout(() => m.remove(), 160); return; }
      cerrar();
    };
    document.addEventListener("keydown", esc9);
    ov._esc9 = esc9;
  }
  function cerrar() {
    const ov = document.getElementById("ckOv");
    _cache = capturar();
    document.body.classList.remove("ck-abierto");
    _abierto = false;
    if (!ov) return;
    if (ov._esc9) document.removeEventListener("keydown", ov._esc9);
    ov.classList.add("ck-out");
    setTimeout(() => ov.remove(), 210);
  }

  // Validación en vivo: RUN/RUT (módulo 11 con ✓/✗ mientras escribe) + limpieza de errores.
  function wireForm(ov) {
    ov.querySelectorAll('#ckForm input[type="text"], #ckForm input[type="email"], #ckForm input[type="tel"]').forEach((inp) => {
      inp.addEventListener("input", () => {
        inp.closest(".ck-field").classList.remove("ck-bad");
        if (/_(run|rut)$/.test(inp.id)) {
          const t = rutLimpio(inp.value);
          inp.value = rutFormato(inp.value);
          const ok = document.getElementById(inp.id + "_ok");
          if (ok) {
            if (t.length < 7) { ok.textContent = ""; ok.className = "ck-rutchk"; }
            else if (rutValido(inp.value)) { ok.textContent = "✓ número de identificación válido"; ok.className = "ck-rutchk ok"; }
            else { ok.textContent = "✗ número de identificación NO válido"; ok.className = "ck-rutchk mal"; }
          }
        }
      });
    });
    const mismo = ov.querySelector("#ck_mismo");
    if (mismo) mismo.addEventListener("change", () => {
      ["email", "fono", "dir", "comuna"].forEach((k) => {
        const src = document.getElementById("ck_c_" + k), dst = document.getElementById("ck_e_" + k);
        if (!src || !dst) return;
        if (mismo.checked) { dst.value = src.value; dst.disabled = true; dst.closest(".ck-field").classList.remove("ck-bad"); }
        else dst.disabled = false;
      });
    });
  }

  function verTyc() {
    const m = document.createElement("div"); m.className = "ck-modal"; m.id = "ckTycModal";
    m.innerHTML = '<div class="ck-modal-card"><div class="ck-modal-body">' + tycTexto() + "</div>" +
      '<button type="button" class="ck-btn-pagar" id="ckTycOk">Entendido</button></div>';
    document.body.appendChild(m);
    const cierra = () => { m.classList.add("ck-out"); setTimeout(() => m.remove(), 160); };
    m.addEventListener("click", (e) => { if (e.target === m || e.target.id === "ckTycOk") cierra(); });
  }

  // ---------- Validación + tintineo + pago ----------
  function avisar(msg) {
    const av = document.getElementById("ckAviso"); if (!av) { alert(msg); return; }
    av.innerHTML = msg; av.classList.remove("hidden");
    av.classList.remove("ck-flash"); void av.offsetWidth; av.classList.add("ck-flash");
    av.scrollIntoView({ behavior: "smooth", block: "center" });
  }
  function tintinear(ids) {
    ids.forEach((id) => {
      const w = document.getElementById(id); if (!w) return;
      w.classList.remove("ck-tint"); void w.offsetWidth; w.classList.add("ck-tint");
    });
  }
  function validarCampos(d) {
    const malos = [];
    const req = (pref, k, cond) => { if (!cond) malos.push(pref + k); };
    const c = d.contacto, pref = d.tipo === "empresa" ? "c_" : "n_";
    req(pref, "nombre", !!c.nombre); req(pref, "apPat", !!c.apPat); req(pref, "apMat", !!c.apMat);
    req(pref, "run", rutValido(c.run));
    req(pref, "email", emailValido(c.email)); req(pref, "fono", fonoValido(c.fono));
    req(pref, "dir", !!c.dir); req(pref, "comuna", !!c.comuna);
    if (d.tipo === "empresa") {
      const e = d.empresa;
      req("e_", "rut", rutValido(e.rut)); req("e_", "razon", !!e.razon); req("e_", "giro", !!e.giro);
      req("e_", "email", emailValido(e.email)); req("e_", "fono", fonoValido(e.fono));
      req("e_", "dir", !!e.dir); req("e_", "comuna", !!e.comuna);
    }
    return malos;
  }
  function intentarPago() {
    const t1 = document.getElementById("ckT1"), t2 = document.getElementById("ckT2");
    const sinTyc = [];
    if (t1 && !t1.checked) sinTyc.push("ckT1w");
    if (t2 && !t2.checked) sinTyc.push("ckT2w");
    if (sinTyc.length) {
      tintinear(sinTyc);
      avisar("<b>Aún no puedes proceder al pago:</b> debes aceptar los Términos y Condiciones" +
        (sinTyc.length > 1 ? " y la declaración de veracidad de tus datos" : (sinTyc[0] === "ckT2w" ? "" : "")) +
        " marcando " + (sinTyc.length > 1 ? "las 2 casillas destacadas" : "la casilla destacada") + " más arriba.");
      return;
    }
    const d = datosForm();
    const malos = validarCampos(d);
    if (malos.length) {
      malos.forEach((id) => { const f = document.querySelector('.ck-field[data-f="' + id + '"]'); if (f) f.classList.add("ck-bad"); });
      const primero = document.querySelector(".ck-field.ck-bad");
      if (primero) primero.scrollIntoView({ behavior: "smooth", block: "center" });
      avisar("<b>Revisa los campos marcados en rojo:</b> faltan datos o tienen un formato inválido (el RUN/RUT debe ser un número de identificación válido).");
      return;
    }
    const reg = {
      ts: Date.now(), sid: _sid,
      cot: _chk.cot || null, items: _chk.items || [], desc: _chk.desc || 0, total: _chk.total || 0,
      comprador: d, entrega: entregaForm(),
      tyc: { aceptados: true, fecha: new Date().toISOString(), texto: tycTexto().replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim() },
    };
    pagar(reg);
  }
  function pagar(reg) {
    // Respaldo inmediato del checkout en RTDB (la app del vendedor lo recoge para el historial).
    const base = String(CFG().VC_FIREBASE_URL || "").replace(/\/+$/, "");
    if (base && _sid) {
      try { fetch(base + "/chk/" + encodeURIComponent(_sid) + ".json", { method: "PUT", body: JSON.stringify(reg) }).catch(() => {}); } catch (_) {}
    }
    const fn = String(CFG().WEBPAY_FN_URL || "").replace(/\/+$/, "");
    const btn = document.getElementById("ckPagar");
    if (!fn) {
      avisar("<b>El pago en línea aún no está habilitado.</b> Tu información quedó registrada correctamente; CIBSA te contactará para coordinar el pago. (Config.: falta WEBPAY_FN_URL.)");
      return;
    }
    if (btn) { btn.disabled = true; btn.textContent = "Conectando con Webpay…"; }
    fetch(fn + "/crear", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sid: _sid, registro: reg }) })
      .then((r) => r.json())
      .then((j) => {
        if (!j || !j.url || !j.token) throw new Error((j && j.error) || "respuesta inválida del servidor de pago");
        const f = document.createElement("form"); f.method = "POST"; f.action = j.url;
        const i = document.createElement("input"); i.type = "hidden"; i.name = "token_ws"; i.value = j.token;
        f.appendChild(i); document.body.appendChild(f); f.submit();
      })
      .catch((e) => {
        if (btn) { btn.disabled = false; btn.textContent = "Pagar " + money((_chk || {}).total) + " con Webpay"; }
        avisar("<b>No se pudo iniciar el pago:</b> " + esc(e.message || e) + ". Intenta nuevamente en unos segundos.");
      });
  }

  // ---------- Resultado del pago (?pago=ok|fail|abort|timeout&orden=...&s=SID) ----------
  // Momento raro y significativo: aquí sí cabe el deleite (entrada del ícono con
  // @starting-style). "fail/abort/timeout" ofrecen volver al plano para reintentar.
  function resultado(params) {
    const p = params || new URLSearchParams(location.search);
    const est = p.get("pago") || "", orden = p.get("orden") || "", sid = p.get("s") || "";
    document.title = "CIBSA — Pago";
    document.body.className = "ck-res-body";
    const volver = sid ? (location.pathname + "?vista=cliente&s=" + encodeURIComponent(sid)) : "";
    const M = {
      ok: ["✓", "¡Pago exitoso!", "Tu compra quedó registrada" + (orden ? " con la orden <b>" + esc(orden) + "</b>" : "") + ". Recibirás el comprobante y los documentos de tu compra por correo. ¡Gracias por preferir CIBSA!"],
      fail: ["✕", "El pago fue rechazado", "Tu banco o Webpay no autorizó el cargo y <b>no se realizó ningún cobro</b>. Puedes intentarlo nuevamente."],
      abort: ["✕", "Pago cancelado", "Anulaste el pago en Webpay; <b>no se realizó ningún cobro</b>."],
      timeout: ["⏱", "Tiempo agotado", "La sesión de pago expiró en Webpay; <b>no se realizó ningún cobro</b>."],
    };
    const m = M[est] || M.abort;
    document.body.innerHTML = '<div class="ck-res">' +
      '<div class="ck-res-ico ' + (est === "ok" ? "ok" : "mal") + '">' + m[0] + "</div>" +
      "<h2>" + m[1] + "</h2><p>" + m[2] + "</p>" +
      (volver && est !== "ok" ? '<a class="ck-btn-pagar ck-res-btn" href="' + volver + '">Volver al plano e intentar de nuevo</a>' : "") +
      '<p class="ck-nota">CIBSA · Santa Elena 2205, San Joaquín · contacto@cibsa.cl</p></div>';
  }

  global.CheckoutCIBSA = { oferta, abrir, cerrar, resultado, rutValido, rutFormato, rutDV };
})(window);
