// Configuración del Revisor. Si la plantilla de Janet cambia, normalmente basta con ajustar este archivo.
// Según TI: las columnas que empiezan con "_" (A a AA) son las que alimentan los tableros. Las demás son data cruda
// de HSE, así que aquí solo se revisan las "_" más Nombre del informe, Grado de riesgo, Departamento, NIT, Sector y CIIU.
var Reglas = {
  // Año en que empezó Conhintec, y año desde el que va el alcance acordado con Sura.
  anioInicio: 2008,
  anioAlcance: 2020,

  hojasPlantilla: ['MP+SiO2', 'Químicos', 'Ruido', 'Sonometría', 'Vibraciones CE', 'Vibraciones MB', 'Iluminación', 'Gases', 'EstresTCalor', 'EstresTFrío', 'Fibras', 'Confort Térmico', 'Temperatura'],

  // Hojas de control de TI: no traen mediciones, así que no se auditan.
  hojasDeControl: /^(bitácora|bitacora|trazabilidad)/i,

  // Escala del grado de riesgo por agente, según la respuesta de TI. Se compara sin importar mayúsculas.
  escalaGeneral: ['a', 'b', 'c', 'd', 'e'],
  escalasPorHoja: {
    // Yannet confirmó que Ruido llega hasta la F (negro). Sonometría también la trae en la base.
    'Ruido': ['a', 'b', 'c', 'd', 'e', 'f'],
    'Sonometría': ['a', 'b', 'c', 'd', 'e', 'f'],
    'Confort Térmico': ['confortable', 'no confortable'],
    'Iluminación': ['muy bajo', 'bajo', 'medio', 'alto', 'muy alto', 'cumple', 'no cumple']
  },
  // Grados en palabras: tienen la misma letra en todas las hojas, así que no son un error por corregir.
  palabrasGrado: ['muy bajo', 'bajo', 'baja', 'medio', 'media', 'alto', 'alta', 'muy alto', 'muy alta'],
  textoEscala: function (hoja) {
    if (hoja === 'Ruido' || hoja === 'Sonometría') return 'de A a F';
    if (hoja === 'Confort Térmico') return 'Confortable o No confortable';
    if (hoja === 'Iluminación') return 'de Muy bajo a Muy alto, o Cumple / No cumple';
    return 'de A a E';
  },

  // Cómo se reconoce cada columna. Se compara sin tildes, en minúsculas y sin el "_" inicial.
  columnas: {
    archivo: /^nombre archivo$/,
    consecutivo: /^consecutivo muestra$/,
    empresa: /^empresa$/,
    planta: /^planta\b/,
    area: /^area$/,
    codigoGes: /^codigo (de )?ges$/,
    fecha: /^fecha( de)?( medicion)?$/,
    anio: /^ano( de)?( medicion)?$/,
    variable: /^nombre de variable/,
    unidad: /^unidad de variable/,
    tlv: /^tlv de variable/,
    esLod: /^es lod/,
    valor: /^valor de variable/,
    ir: /^ir de variable/,
    informe: /^nombre del informe/,
    grado: /^grado de riesgo/,
    departamento: /departamento/,
    nit: /^nit\b/,
    sector: /^(sector( economico)?|actividad economica)$/,
    ciiu: /\bciiu\b/
  },

  // Columnas que deben existir. TI confirmó que estas se agregan al final de la consolidación.
  columnasFaltantes: [
    { rol: 'nit', nombre: 'NIT', prioridad: 'Alta', corregir: 'Agregar el NIT de cada empresa. TI lo agrega al final de la consolidación.' },
    { rol: 'sector', nombre: 'Sector económico', prioridad: 'Alta', corregir: 'Agregar el sector económico de cada empresa. TI lo agrega al final de la consolidación.' },
    { rol: 'ciiu', nombre: 'CIIU', prioridad: 'Alta', corregir: 'Agregar el código CIIU de cada empresa. TI lo agrega al final de la consolidación.' },
    { rol: 'grado', nombre: 'Grado de riesgo', prioridad: 'Alta', corregir: 'Agregar el grado de riesgo de cada medición.' },
    { rol: 'departamento', nombre: 'Departamento', prioridad: 'Media', corregir: 'Agregar el departamento donde se hizo la medición.' }
  ],

  // Columnas obligatorias. NA significa "No aplica" y NR "No reporta" (el dato debía venir y no llegó).
  // naValido: esa columna puede no aplicar a una medición, así que NA no es error.
  // exceptoHojas: hojas donde el dato no existe por naturaleza.
  obligatorias: [
    { rol: 'consecutivo', nombre: 'Consecutivo de muestra', prioridad: 'Alta', corregir: 'Escribir el consecutivo de la muestra.' },
    { rol: 'variable', nombre: 'Nombre de variable', prioridad: 'Alta', corregir: 'Escribir el agente de riesgo medido.' },
    { rol: 'unidad', nombre: 'Unidad', vacio: 'Unidad vacía', prioridad: 'Alta', corregir: 'Escribir la unidad de la medición.' },
    { rol: 'informe', nombre: 'Nombre del informe', prioridad: 'Media', corregir: 'Escribir el nombre del informe del que sale la medición (se necesita para contar informes).' },
    { rol: 'planta', nombre: 'Planta', vacio: 'Planta vacía', prioridad: 'Media', corregir: 'Escribir la planta, unidad, base o campo donde se hizo la medición.' },
    { rol: 'area', nombre: 'Área', vacio: 'Área vacía', prioridad: 'Media', naValido: true, corregir: 'Escribir el área donde se hizo la medición.' },
    { rol: 'codigoGes', nombre: 'Código de GES', prioridad: 'Media', naValido: true, exceptoHojas: ['Sonometría'], corregir: 'Escribir el código del GES. Si la medición es puntual o de área, dejar NA.' },
    { rol: 'departamento', nombre: 'Departamento', prioridad: 'Media', corregir: 'Escribir el departamento donde se hizo la medición.' },
    { rol: 'sector', nombre: 'Sector económico', prioridad: 'Alta', corregir: 'Escribir el sector económico de la empresa.' }
  ],

  // Valores posibles según la unidad. Lo que se salga se marca como escala rara.
  rangosPorUnidad: {
    dba: { valor: [20, 160], tlv: [70, 115] },
    lux: { valor: [0, 200000], tlvTexto: true },
    '°c': { valor: [-60, 70] }
  },

  // A partir de cuántas veces se sospecha un error de unidades.
  vecesValorSobreTlv: 1000,
  vecesEntreTlv: 100,
  vecesIr: 10,

  textosCorregir: {
    fecha: 'Escribir la fecha de la medición en formato fecha (dd/mm/aaaa).',
    fechaTexto: 'Cambiar a formato fecha (dd/mm/aaaa). Si son varios días, definir cuál fecha queda.',
    fechaAnio: 'Escribir la fecha completa de la medición (dd/mm/aaaa).',
    valor: 'Escribir el valor medido. Si de verdad no se registró en el informe, dejarlo así y confirmarlo.',
    tlv: 'Escribir el valor límite (TLV) con el que se comparó la medición. Si no aplica, dejar NA.',
    ir: 'Escribir el índice de riesgo (IR). Si no aplica, dejar NA.'
  }
};
