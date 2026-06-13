/* Configuración de la app web Cotizador CIBSA.
   Edita aquí los datos de la empresa, el acceso y el origen de datos. */
(function (global) {
  const CONFIG = {
    // --- Google ---
    // Pega aquí el "ID de cliente" del cliente OAuth tipo WEB (lo creas en Google Cloud).
    GOOGLE_CLIENT_ID: "844999785397-fncjlgv5l9eqhp9f1mv98t6gcdo4l9nc.apps.googleusercontent.com",
    SHEET_ID: "1oB2Mbc3pgMMOGkWMXj2nTNEQox28sQcBkDYthDB9WU4",
    SCOPES: "https://www.googleapis.com/auth/spreadsheets.readonly",

    // --- Hoja RANGO (punteros) ---
    RANGO_LECTURA: "RANGO!A2:C",
    ID_TABLA_TELAS: "Telas",
    COL_NOMBRE_TELA: "TELA",
    COL_VALOR_M2: "PRECIO VENTA M2",
    COL_ANCHO_ROLLO: "FORMATO ROLLO (M)",
    COL_FICHA: "SPECS",

    // --- Tabla de vendedores (referenciada en RANGO con este ID) ---
    // El nombre que se muestra se compone de NOMBRE + APELLIDO PATERNO + APELLIDO MATERNO
    // (los apellidos en blanco se omiten). Se muestran solo los teléfonos no vacíos.
    ID_TABLA_VENDEDORES: "Vendedores",
    COL_VENDEDOR_NOMBRE: "NOMBRE",
    COL_VENDEDOR_APELLIDOS: ["APELLIDO PATERNO", "APELLIDO MATERNO"],
    COL_VENDEDOR_EMAIL: "EMAIL",
    COL_VENDEDOR_FONOS: ["TELEFONO 1", "TELEFONO 2", "TELEFONO 3"],

    // --- Control de acceso ---
    DOMINIO_PERMITIDO: "cibsa.cl",
    CORREOS_PERMITIDOS: ["contacto@cibsa.cl"],

    // --- Reglas de cálculo ---
    MARGEN_COSTURA_M: 0.10,
    IVA_PCT: 19,
    VALOR_OJETILLO_DEFAULT: 450,
    DIAS_ENTREGA_DEFAULT: 3,

    // --- Empresa / vendedor (página 2) ---
    EMPRESA: {
      razon_social: "Comercial Industrial Binghamton S.A",
      rut: "Rut: 96.612.980-8",
      cuenta: "Cuenta corriente: 169-07664-04",
      banco: "Banco de Chile",
      ciudad: "SANTIAGO",
      casa_matriz: "Casa matriz Santa Elena 2205, San Joaquín. Santiago",
    },
    VENDEDOR: { nombre: "Daniel Ventura", fono: "(+569) 4019 6779" },

    CONDICIONES: [
      "Para comenzar la fabricación, se solicita una transferencia del 50% del total de la compra. " +
        "A modo de referencia, el proceso de fabricación tarda aproximadamente {dias} días hábiles desde que " +
        "se realiza el primer depósito -por el 50% del total-, luego el producto estará disponible para " +
        "retiro o despacho –según corresponda- pagando el 50% restante.",
      "Para hacer efectiva la visita a terreno se debe depositar previamente el valor señalado.",
      "En caso de que su pedido se modifique, tanto en diseño como en unidades requeridas, tanto el valor " +
        "de su pedido como las condiciones de pago y fecha de entrega de su producto podrían cambiar, por lo " +
        "que este estimado queda sin efecto.",
      "Esta cotización se realiza según las indicaciones originales por parte del cliente y no contempla " +
        "indicaciones o modificaciones posteriores.",
      "Visitas a terreno y despachos se cobran por separado.",
      "La información respecto de las características de las telas se basa en test que otorgan promedios, " +
        "se asumen confiables pero no constituyen certificación técnica, salvo se indique lo contrario.",
      "Las dimensiones indicadas en este estimado poseen un margen de error de +/- 3cm tanto en tela, como " +
        "en colocación de ojetillos, a menos que expresamente se indique lo contrario por el cliente.",
    ],
  };

  if (typeof module !== "undefined" && module.exports) module.exports = CONFIG;
  global.CONFIG = CONFIG;
})(typeof window !== "undefined" ? window : globalThis);
