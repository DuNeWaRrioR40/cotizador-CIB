/* Configuración de la app web Cotizador CIBSA.
   Edita aquí los datos de la empresa, el acceso y el origen de datos. */
(function (global) {
  const CONFIG = {
    // Versión visible del build (debe coincidir con el SW). Sirve para confirmar que cargó la última.
    APP_VERSION: "v16-6",
    // --- Vista cliente remota (compartir por QR) ---
    // URL de tu Firebase Realtime Database. Vacío = el botón QR queda deshabilitado (la vista
    // espejo local por monitor sigue funcionando igual). Ej: "https://cibsa-vc-default-rtdb.firebaseio.com"
    VC_FIREBASE_URL: "https://cibsa-vc-default-rtdb.firebaseio.com",
    // --- Google ---
    // Pega aquí el "ID de cliente" del cliente OAuth tipo WEB (lo creas en Google Cloud).
    GOOGLE_CLIENT_ID: "844999785397-fncjlgv5l9eqhp9f1mv98t6gcdo4l9nc.apps.googleusercontent.com",
    SHEET_ID: "1oB2Mbc3pgMMOGkWMXj2nTNEQox28sQcBkDYthDB9WU4",
    // Lectura + escritura: necesario para sincronizar el historial a la hoja HISTORIAL.
    SCOPES: "https://www.googleapis.com/auth/spreadsheets",

    // --- Hoja RANGO (punteros) ---
    RANGO_LECTURA: "RANGO!A2:C",
    ID_TABLA_TELAS: "Telas",
    COL_NOMBRE_TELA: "TELA",
    COL_VALOR_M2: "PRECIO VENTA M2",
    COL_ANCHO_ROLLO: "FORMATO ROLLO (M)",
    COL_FICHA: "SPECS",
    COL_PROVEEDOR_TELA: "PROVEEDOR",   // interno: se muestra en la App, NUNCA en el PDF
    COL_FAV_TELA: "FAV",               // categorías de la tela (varias separadas por "/"); para selección rápida por categoría

    // --- Tabla de Materiales (Insumo / Accesorio / Estructural) ---
    // Celdas en blanco no rompen la lectura; el mínimo para un ítem es CATEGORIA + ITEM.
    // PROVEEDOR es interno (se muestra en la App y ordena la lista; NUNCA va al PDF).
    ID_TABLA_MATERIALES: "Materiales",
    COL_MAT_CATEGORIA: "CATEGORIA",
    COL_MAT_ITEM: "ITEM",
    COL_MAT_MODELO: "MODELO",
    COL_MAT_COLOR: "COLOR",
    COL_MAT_PRECIO: "PRECIO VTA",
    COL_MAT_UNIDAD: "UNIDAD",
    COL_MAT_PROVEEDOR: "PROVEEDOR",
    // Categorías (de la tabla Materiales) cuyos ítems se comportan como CINTA/CIERRE (banda por arista) y por
    // tanto aparecen en los selectores de Cintas/Straps, agrupados por categoría. Deja la lista con los nombres
    // EXACTOS de tus categorías de cinta (p. ej. "Cinta", "Cierre", "Velcro"). Si la dejas vacía, la App cae a
    // un patrón /cinta|cierre/ sobre la categoría o el nombre del ítem (menos preciso, pero funciona de arranque).
    CATEGORIAS_CINTA: [],

    // --- Productos a granel (referenciada en RANGO con este ID) ---
    // Productos estándar que se venden sin transformación (a lo más, corte por metro).
    // Navegación: Categoria → Proveedor → Tipo → Variedad (niveles vacíos se saltan).
    // PROVEEDOR y EQUIV son INTERNOS (nunca van al PDF del cliente). El comparador (equivalentes
    // por la clave EQUIV) es una herramienta interna en pantalla; tampoco va al PDF.
    ID_TABLA_GRANEL: "Granel",
    COL_GRANEL: {
      categoria: "Categoria", proveedor: "Proveedor", tipo: "Tipo", variedad: "Variedad",
      // Rol (supra-categoría): INSUMO / ACCESORIO / ESTRUCTURAL (se llena a mano; en blanco para telas/granel).
      rol: "Rol",
      modelo: "Modelo", equiv: "Equiv", unidad: "Unidad", precio: "Precio",
      // Precio calculado por fórmula (costo × factor) que vive a la derecha en VIGENTES/GRANEL.
      // Para productos cargados por factura, "Precio" (manual) queda vacío y el valor real está aquí.
      precioCalc: "PrecioCalc",
      anchoRollo: "AnchoRollo", specs: "Specs", nombreCliente: "NombreCliente",
      activo: "Activo", notas: "Notas", vigentes: "Vigentes",
      // Internas / analíticas (opcionales): SKU (llave única por fila), Precio Base + Fecha Base
      // (para variación de precio) y Fecha Actualización (freshness / carga masiva). Fechas en dd/mm/aaaa.
      sku: "SKU", precioBase: "Precio Base", fechaActualizacion: "Fecha Actualización", fechaBase: "Fecha Base",
      // Fecha de la FACTURA (DTE) — opcional. Si la columna existe, manda sobre Fecha Actualización para
      // decidir cuál fila de un mismo material es la más reciente. Si no existe, se cae a Fecha Actualización.
      fechaFactura: "Fecha Factura",
      // Regla "gana lo más nuevo" (precio manual vs factura): FechaCosto = fecha de la última factura del
      // material (fórmula MAXIFS de COSTOS, en GRANEL); Fecha Precio = fecha del Precio manual (si está
      // vacía, se usa Fecha Actualización). Ambas opcionales; si faltan, el manual gana como antes.
      fechaCosto: "FechaCosto", fechaPrecio: "Fecha Precio",
      // UNIDAD MINIMA: "UNITARIO" (cantidad entera, mín 1) o "GRANEL" (mín 1, acepta decimales).
      // Vacío/desconocido = UNITARIO (más restrictivo). El mínimo de venta nunca es < 1.
      unidadMinima: "Unidad Minima", formato: "Formato", peso: "Peso",
      largo: "Largo", color: "Color", materialidad: "Materialidad",
      // FAV: una o más categorías (separadas por "/") para selección rápida de telas. Opcional.
      fav: "FAV",
      // Columnas de la reestructuración BD (carga de facturas → costo → precio):
      codMaterialBase: "CodMaterialBase",   // llave que une los estados de un material; link a COSTOS
      parent: "Parent (SKU rollo)",          // en hijos: SKU del rollo padre
      rendimiento: "Rendimiento",            // unidades de venta por 1 unidad comprada
      nombreProveedor: "NombreProveedor",    // nombre(s) tal cual la factura (alias con "/")
      unidadProveedor: "UnidadProveedor",    // unidad en que vende el proveedor
      proveedorRUT: "ProveedorRUT",          // RUT del proveedor (link a PROVEEDORES)
    },
    // Orden REAL de las columnas de la hoja GRANEL maestra (A→AF). Se usa para construir filas nuevas
    // al cargar facturas. "Rol" se insertó en la columna G (Insumo/Accesorio/Estructural; se llena a mano,
    // por eso se escribe en blanco). Una columna auxiliar (OK/DUP) va sin encabezado; luego el flag "Vigentes".
    GRANEL_ORDEN: [
      "Categoria", "Proveedor", "Tipo", "Variedad", "Formato", "Modelo", "Rol", "Color", "Largo",
      "Materialidad", "Peso", "Equiv", "Unidad", "Unidad Minima", "Precio", "Specs", "AnchoRollo",
      "NombreCliente", "Activo", "Notas", "Fecha Actualización", "Fecha Base", "SKU", "", "Vigentes",
      "FAV", "CodMaterialBase", "Parent (SKU rollo)", "Rendimiento", "NombreProveedor",
      "UnidadProveedor", "ProveedorRUT",
    ],
    // Fórmula que la carga de facturas ESCRIBE en la columna "Vigentes" de cada fila nueva (en vez de un 1
    // literal), para que la columna quede 100% fórmula y el dedup por SKU/fecha siempre se recalcule (evita
    // "vigentes zombis" al recargar un SKU). {FILA} se reemplaza por el número de fila real al escribir.
    // Debe ser IDÉNTICA a la que tienes arrastrada en GRANEL. Tras insertar "Rol" en G: SKU=col W, Fecha Actualización=col U.
    // Separador ";" (locale es-CL). Si cambias columnas o la fórmula del Sheet, actualiza también esto.
    VIGENTES_FORMULA_TPL:
      '=IF($W{FILA}="";"";IF(ROW()=MAX(FILTER(ROW($W$2:$W);$W$2:$W=$W{FILA};$U$2:$U=MAXIFS($U$2:$U;$W$2:$W;$W{FILA})));1;0))',
    // Fórmula que la carga ESCRIBE en la columna "Specs" (ficha técnica): la busca en la pestaña FICHAS por la
    // identidad del material (Proveedor + Tipo + Modelo, INDEPENDIENTE de Formato/Variedad). Así una sola ficha
    // cubre todos los formatos/estados de un material. En GRANEL (tras Rol en G): Proveedor=B, Tipo=C, Modelo=F.
    // FICHAS: A=Proveedor, B=Tipo, C=Modelo, D=Ficha. Si FICHAS no existe aún, IFERROR deja "" (no rompe).
    // Vacío ("") = no inyectar (deja el texto). Separador ";" (locale es-CL).
    SPECS_FORMULA_TPL:
      '=IFERROR(INDEX(FILTER(FICHAS!$D$2:$D;FICHAS!$A$2:$A=$B{FILA};FICHAS!$B$2:$B=$C{FILA};FICHAS!$C$2:$C=$F{FILA});1);"")',

    // --- Carga de facturas (DTE) → costos / proveedores ---
    HOJA_GRANEL_MAESTRO: "GRANEL",   // historial maestro (append de productos nuevos)
    HOJA_PROVEEDORES: "PROVEEDORES",
    COL_PROVEEDOR: { rut: "RUT", razon: "RazonSocial", nombreCorto: "NombreCorto" },
    HOJA_COSTOS: "COSTOS",
    COL_COSTOS: { llave: "Llave", fecha: "Fecha", costo: "Costo", unidadCompra: "UnidadCompra", proveedorRUT: "ProveedorRUT", numFactura: "NumFactura", nota: "Nota" },
    HOJA_FACTOR: "FACTOR",
    // TIPO (col E) opcional: en blanco aplica a todos los tipos; con valor es excepción para ese tipo.
    COL_FACTOR: { categoria: "CATEGORIA", variedad: "VARIEDAD", unidadMinima: "UNIDAD MINIMA", factor: "FACTOR", tipo: "TIPO" },
    RUT_EMPRESA: "96612980-8",   // RUT de CIBSA (receptor esperado en las facturas de compra)

    // --- Tabla de vendedores (referenciada en RANGO con este ID) ---
    // El nombre que se muestra se compone de NOMBRE + APELLIDO PATERNO + APELLIDO MATERNO
    // (los apellidos en blanco se omiten). Se muestran solo los teléfonos no vacíos.
    ID_TABLA_VENDEDORES: "Vendedores",
    COL_VENDEDOR_NOMBRE: "NOMBRE",
    COL_VENDEDOR_APELLIDOS: ["APELLIDO PATERNO", "APELLIDO MATERNO"],
    COL_VENDEDOR_EMAIL: "EMAIL",
    COL_VENDEDOR_FONOS: ["TELEFONO 1", "TELEFONO 2", "TELEFONO 3"],

    // --- Wiki de ayuda (referenciada en RANGO con este ID) ---
    // Hoja con dos columnas: A = Código del globo, B = Comentario aclaratorio.
    // Si un código tiene comentario, aparece dentro del globo de ayuda bajo el texto base.
    ID_TABLA_WIKI: "wiki",

    // --- Historial en la nube ---
    // La app crea y administra sola esta pestaña (append por cada cotización generada).
    HOJA_HISTORIAL: "HISTORIAL",

    // --- Control de acceso ---
    DOMINIO_PERMITIDO: "cibsa.cl",
    CORREOS_PERMITIDOS: ["contacto@cibsa.cl"],
    // Usuarios "maestros": pueden fusionar duplicados (función de administración del catálogo).
    // La sucesión se cubre por acceso a este correo (esposa / Jefa de Ventas).
    CORREOS_MAESTROS: ["contacto@cibsa.cl"],

    // --- Reglas de cálculo ---
    MARGEN_COSTURA_M: 0.10,
    IVA_PCT: 19,
    VALOR_OJETILLO_DEFAULT: 450,
    DIAS_ENTREGA_DEFAULT: 3,
    // Descuento por defecto de la venta a GRANEL de tela por metro (M.LINEAL): mismo material sin confección.
    // Se aplica como descuento editable en la línea del carrito. Solo Categoría=TELA + Variedad=M.LINEAL
    // (accesorios/insumos y ROLLO nacen en 0). El vendedor puede modificarlo (p. ej. subirlo por volumen).
    GRANEL_DESCUENTO_TELA_PCT: 25,
    // Correlativo de cotizaciones: parte cerca de este número y luego avanza con un SALTO ALEATORIO
    // (entre 1 y CORRELATIVO_SALTO_MAX) en cada nueva cotización, para que la competencia no pueda
    // inferir el volumen por la diferencia entre números. Estable por cotización (cliente+versión):
    // regenerar reutiliza el mismo número. Se guarda en el historial (snap) y nunca retrocede ni se repite.
    CORRELATIVO_INICIAL: 4200,
    CORRELATIVO_SALTO_MAX: 50,
    // Mínimo de producción de taller (neto), en UF. Si el neto de lo confeccionado (carpa, antes
    // del descuento) no lo alcanza, se agrega una línea "Mínimo de producción" para completarlo.
    // La UF del día se obtiene de mindicador.cl (con caché). No aplica a productos a granel.
    MIN_PRODUCCION_UF: 0.6,
    UF_API: "https://mindicador.cl/api/uf",
    // Descuento escalonado sobre el mínimo por posición de unidad: [2ª, 3ª, 4ª+]. La 1ª nunca se descuenta.
    // Piso de la unidad k = 0,6 UF × (1 − descuento). Se cobra el mayor entre ese piso y el valor real.
    MIN_PRODUCCION_DCTO: [0.30, 0.50, 0.75],

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
      "Las dimensiones indicadas en este estimado poseen un margen de error de +/- 4cm tanto en tela, como " +
        "en colocación de ojetillos, a menos que expresamente se indique lo contrario por el cliente.",
    ],
  };

  if (typeof module !== "undefined" && module.exports) module.exports = CONFIG;
  global.CONFIG = CONFIG;
})(typeof window !== "undefined" ? window : globalThis);
