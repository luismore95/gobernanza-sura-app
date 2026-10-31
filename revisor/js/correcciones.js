// Arma el Excel de correcciones con las mismas hojas de la revisión preliminar.
var Correcciones = (function () {
  var MAX_GRUPOS = 300;

  function armar(r, fecha) {
    var alta = r.hallazgos.filter(function (h) { return h.prioridad === 'Alta'; }).length + r.generales.filter(function (g) { return g.prioridad === 'Alta'; }).length;
    var media = r.hallazgos.length + r.generales.length - alta;
    var total = alta + media;
    var nFilas = r.hallazgos.length + 4, nGen = r.generales.length + 4;
    var corregidos = "COUNTIF('Hallazgos por fila'!L5:L" + nFilas + ',"Corregido")+COUNTIF(\'Puntos generales\'!F5:F' + nGen + ',"Corregido")';
    var archivos = r.archivos.map(function (a) { return a.archivo; }).join(', ');

    var resumen = [
      [],
      [{ v: 'Revisión de calidad de datos', s: 5 }],
      ['Gobernanza de datos · Mediciones de higiene ocupacional para ARL SURA'],
      ['Archivo revisado: ' + archivos + '  ·  Fecha de revisión: ' + fecha],
      [],
      [{ v: total, s: 7 }, { v: alta, s: 7 }, { v: media, s: 7 }, { v: 0, f: corregidos, s: 7 }],
      ['Puntos a revisar', 'Prioridad alta', 'Prioridad media', 'Ya corregidos'],
      [],
      [{ v: 'Por hoja', s: 1 }, { v: 'Prioridad alta', s: 1 }, { v: 'Prioridad media', s: 1 }, { v: 'Celdas por revisar', s: 1 }]
    ];
    var porHoja = {};
    function hoja(n) { return porHoja[n] = porHoja[n] || { alta: 0, media: 0, celdas: 0 }; }
    r.generales.forEach(function (g) { hoja(g.hoja)[g.prioridad === 'Alta' ? 'alta' : 'media']++; });
    r.hallazgos.forEach(function (h) { var e = hoja(h.hoja); e[h.prioridad === 'Alta' ? 'alta' : 'media']++; e.celdas += h.cantidad; });
    Object.keys(porHoja).forEach(function (n) { resumen.push([n, porHoja[n].alta, porHoja[n].media, porHoja[n].celdas]); });
    resumen.push([], ['NA significa "No aplica" y no se marca donde el dato puede no aplicar. NR significa "No reporta".'], ['A medida que corrijan, cambien la columna "Estado" a "Corregido". El resumen se actualiza solo.']);

    var generales = [[{ v: 'Puntos generales', s: 5 }], ['Cosas que aplican a toda una hoja (columnas que no existen, hojas vacías).'], [],
      ['N°', 'Prioridad', 'Hoja', 'Qué encontramos', 'Qué hay que hacer', 'Estado'].map(function (t) { return { v: t, s: 1 }; })];
    r.generales.forEach(function (g, i) {
      generales.push([i + 1, { v: g.prioridad, s: g.prioridad === 'Alta' ? 3 : 4 }, g.hoja, { v: g.que, s: 2 }, { v: g.corregir, s: 2 }, 'Pendiente']);
    });

    var filas = [[{ v: 'Hallazgos por fila', s: 5 }], ['Cada línea dice en qué hoja, columna y filas está el problema y qué hay que corregir.'], [],
      ['N°', 'Prioridad', 'Hoja', 'Empresa', 'Columna', 'Nombre de la columna', 'Qué encontramos', 'Ejemplo de lo que dice', 'Filas', 'Cantidad de filas', 'Qué hay que corregir', 'Estado'].map(function (t) { return { v: t, s: 1 }; })];
    r.hallazgos.forEach(function (h, i) {
      filas.push([i + 1, { v: h.prioridad, s: h.prioridad === 'Alta' ? 3 : 4 }, h.hoja, { v: h.empresa, s: 2 }, h.columna, { v: h.nombreColumna, s: 2 }, { v: h.que, s: 2 }, { v: h.ejemplos.join(', '), s: 2 }, { v: Auditoria.compactarFilas(h.filas, MAX_GRUPOS), s: 2 }, h.cantidad, { v: h.corregir, s: 2 }, 'Pendiente']);
    });

    var escala = [[{ v: 'Escala del grado de riesgo', s: 5 }], ['Valores que no están en la escala de cada agente. En la columna amarilla digan a qué equivale cada uno.'], [],
      ['Hoja', 'Valor que aparece', 'Cantidad de filas', '¿A qué equivale?'].map(function (t) { return { v: t, s: 1 }; })];
    r.escala.forEach(function (e) { escala.push([e.hoja, e.valor, e.filas, { v: '', s: 8 }]); });

    var nombresHoja = Object.keys(porHoja);
    var empresas = [[{ v: 'Celdas por revisar, por empresa', s: 5 }], ['Una misma fila puede tener problemas en varias columnas.'], [],
      ['Empresa'].concat(nombresHoja, ['Total']).map(function (t) { return { v: t, s: 1 }; })];
    r.empresas.forEach(function (e) {
      var total = 0, fila = [e.nombre];
      nombresHoja.forEach(function (n) {
        var c = r.hallazgos.filter(function (h) { return h.empresa === e.nombre && h.hoja === n; }).reduce(function (s, h) { return s + h.cantidad; }, 0);
        total += c; fila.push(c);
      });
      fila.push(total);
      empresas.push(fila);
    });

    return [
      { nombre: 'Resumen', filas: resumen, anchos: [26, 18, 18, 20], sinCuadricula: true },
      { nombre: 'Puntos generales', filas: generales, anchos: [6, 10, 18, 46, 60, 12], congelarFila: 4, filtro: 'A4:F' + nGen, validacion: { rango: 'F5:F' + nGen, opciones: 'Pendiente,Corregido' } },
      { nombre: 'Hallazgos por fila', filas: filas, anchos: [6, 10, 16, 30, 9, 26, 38, 30, 40, 10, 58, 12], congelarFila: 4, filtro: 'A4:L' + nFilas, validacion: { rango: 'L5:L' + nFilas, opciones: 'Pendiente,Corregido' } },
      { nombre: 'Escala de riesgo', filas: escala, anchos: [18, 20, 16, 22] },
      { nombre: 'Por empresa', filas: empresas, anchos: [46].concat(nombresHoja.map(function () { return 13; }), [11]) }
    ];
  }

  return { armar: armar };
})();
