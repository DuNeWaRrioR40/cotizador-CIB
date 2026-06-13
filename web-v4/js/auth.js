/* Login con Google (Google Identity Services) y control de acceso por correo.
   Sin un token válido y autorizado, no se consulta el Sheet. */
(function (global) {
  const CFG = global.CONFIG;
  const KEY = "cibsa_sesion";
  const MIN_SESION_MS = 3 * 60 * 60 * 1000;   // objetivo: la sesión vive al menos ~3 h
  const MARGEN_REFRESCO_MS = 5 * 60 * 1000;    // renovar 5 min antes de expirar
  let tokenClient = null;
  let refrescoTimer = null;
  let estado = { token: null, email: null, expira: 0, inicio: 0 };

  function correoAutorizado(email) {
    email = (email || "").trim().toLowerCase();
    if (!email) return false;
    if (CFG.CORREOS_PERMITIDOS.map((c) => c.toLowerCase()).includes(email)) return true;
    const dom = (CFG.DOMINIO_PERMITIDO || "").trim().toLowerCase();
    return !!dom && email.endsWith("@" + dom);
  }

  function scopeCompleto() {
    return "https://www.googleapis.com/auth/userinfo.email " + CFG.SCOPES;
  }

  function tieneScopeSheets(resp) {
    if (global.google && google.accounts.oauth2 && google.accounts.oauth2.hasGrantedAllScopes) {
      return google.accounts.oauth2.hasGrantedAllScopes(resp, CFG.SCOPES);
    }
    return (resp.scope || "").split(" ").indexOf(CFG.SCOPES) >= 0;
  }

  async function emailDe(token) {
    const r = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
      headers: { Authorization: "Bearer " + token },
    });
    if (!r.ok) throw new Error("No se pudo obtener el correo del usuario.");
    const info = await r.json();
    return info.email;
  }

  function guardar() {
    try { sessionStorage.setItem(KEY, JSON.stringify(estado)); } catch (e) {}
  }

  function sesionGuardada() {
    try {
      const s = JSON.parse(sessionStorage.getItem(KEY) || "null");
      if (s && s.token && s.email && s.expira > Date.now() + 60000 && correoAutorizado(s.email)) {
        estado = s;
        if (!estado.inicio) estado.inicio = Date.now();
        programarRefresco();   // reanuda la renovación tras recargar la página
        return { token: s.token, email: s.email };
      }
    } catch (e) {}
    return null;
  }

  // --- Renovación silenciosa del token para sostener la sesión ~3 h ---
  function programarRefresco() {
    if (refrescoTimer) { clearTimeout(refrescoTimer); refrescoTimer = null; }
    if (!estado.token) return;
    let delay = estado.expira - Date.now() - MARGEN_REFRESCO_MS;
    if (delay < 1000) delay = 1000;
    refrescoTimer = setTimeout(function () {
      refrescarSilencioso().catch(function () { /* si falla, la sesión expirará normalmente */ });
    }, delay);
  }

  function refrescarSilencioso() {
    return new Promise(function (resolve, reject) {
      // Mantener la sesión solo mientras no se supere el objetivo de duración.
      const inicio = estado.inicio || Date.now();
      if (Date.now() - inicio > MIN_SESION_MS && estado.expira <= Date.now() + MARGEN_REFRESCO_MS) {
        // Ya pasamos las ~3 h y el token está por vencer: dejamos que expire.
        return reject(new Error("sesion-objetivo-cumplido"));
      }
      if (!global.google || !google.accounts || !google.accounts.oauth2) {
        return reject(new Error("GIS no disponible"));
      }
      const tc = google.accounts.oauth2.initTokenClient({
        client_id: CFG.GOOGLE_CLIENT_ID,
        scope: scopeCompleto(),
        prompt: "",   // silencioso: sin UI si el usuario ya dio consentimiento
        callback: function (resp) {
          if (resp.error || !resp.access_token) return reject(new Error("No se pudo renovar la sesión."));
          estado.token = resp.access_token;
          estado.expira = Date.now() + (parseInt(resp.expires_in, 10) || 3600) * 1000;
          guardar();
          programarRefresco();
          resolve(estado.token);
        },
        error_callback: function (err) { reject(err || new Error("Renovación cancelada.")); },
      });
      try { tc.requestAccessToken({ prompt: "" }); } catch (e) { reject(e); }
    });
  }

  function cerrarSesion() {
    if (refrescoTimer) { clearTimeout(refrescoTimer); refrescoTimer = null; }
    const tokenPrevio = estado.token;
    estado = { token: null, email: null, expira: 0, inicio: 0 };
    try { sessionStorage.removeItem(KEY); } catch (e) {}
    if (global.google && tokenPrevio) {
      try { google.accounts.oauth2.revoke(tokenPrevio); } catch (e) {}
    }
  }

  function getToken() { return estado.token; }
  function getEmail() { return estado.email; }

  function iniciarSesion() {
    return new Promise((resolve, reject) => {
      if (!global.google || !google.accounts || !google.accounts.oauth2) {
        return reject(new Error("No se cargó Google Identity Services. Revisa tu conexión."));
      }
      if (!CFG.GOOGLE_CLIENT_ID || CFG.GOOGLE_CLIENT_ID.indexOf("PEGA_AQUI") === 0) {
        return reject(new Error("Falta configurar el ID de cliente de Google (config.js)."));
      }
      tokenClient = google.accounts.oauth2.initTokenClient({
        client_id: CFG.GOOGLE_CLIENT_ID,
        scope: scopeCompleto(),
        prompt: "consent",
        callback: async (resp) => {
          if (resp.error) return reject(new Error("No se completó el inicio de sesión."));
          if (!tieneScopeSheets(resp)) {
            return reject(new Error(
              "Falta permitir el acceso a Google Sheets. Inicia sesión de nuevo y " +
              "marca/permite la casilla “Ver todas tus hojas de cálculo de Google Sheets”."));
          }
          try {
            const email = await emailDe(resp.access_token);
            if (!correoAutorizado(email)) {
              return reject(new Error(`El correo ${email} no está autorizado para usar esta App.`));
            }
            estado = {
              token: resp.access_token,
              email,
              expira: Date.now() + (parseInt(resp.expires_in, 10) || 3600) * 1000,
              inicio: Date.now(),
            };
            guardar();
            programarRefresco();
            resolve({ token: estado.token, email });
          } catch (e) { reject(e); }
        },
      });
      tokenClient.requestAccessToken();
    });
  }

  global.AuthCIBSA = {
    iniciarSesion, cerrarSesion, sesionGuardada, getToken, getEmail, correoAutorizado,
  };
})(typeof window !== "undefined" ? window : globalThis);
