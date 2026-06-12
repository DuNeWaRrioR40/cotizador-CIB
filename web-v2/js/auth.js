/* Login con Google (Google Identity Services) y control de acceso por correo.
   Sin un token válido y autorizado, no se consulta el Sheet. */
(function (global) {
  const CFG = global.CONFIG;
  const KEY = "cibsa_sesion";
  let tokenClient = null;
  let estado = { token: null, email: null, expira: 0 };

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
        return { token: s.token, email: s.email };
      }
    } catch (e) {}
    return null;
  }

  function cerrarSesion() {
    estado = { token: null, email: null, expira: 0 };
    try { sessionStorage.removeItem(KEY); } catch (e) {}
    if (global.google && estado.token) {
      try { google.accounts.oauth2.revoke(estado.token); } catch (e) {}
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
            };
            guardar();
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
