// Motor de la auditoría: recibe los libros ya leídos y devuelve los puntos por corregir.
// Solo mira las columnas de la configuración: nunca revisa ni copia cédulas o nombres de empleados.
var Auditoria = (function () {
  function sinTildes(s) { return s.normalize('NFD').replace(/[̀-ͯ]/g, ''); }

  function normalizarEncabezado(s) {
    return sinTildes(String(s)).toLowerCase().replace(/^_+/, '').replace(/\s+/g, ' ').trim();
  }

  function esVacio(v) { return v === undefined || v === null || String(v).trim() === ''; }

  // NR = No reporta (el dato debía venir). NA = No aplica (válido donde la regla lo permita).
  function esNR(v) { return typeof v === 'string' && /^n\.?r\.?$/i.test(v.trim()); }

  function esNA(v) { return typeof v === 'string' && /^(n\.?a\.?|n\/a)$/i.test(v.trim()); }

  function esNoRegistrado(v) { return esNR(v) || esNA(v); }

  function esBajoLimite(v) { return typeof v === 'string' && /^<?\s*(loq|lod)$/i.test(v.trim()); }

  function numeroConComa(v) {
    var s = typeof v === 'string' ? v.replace(/_x000D_/g, '').trim() : '';
    return /^-?\d+,\d+$/.test(s) ? Number(s.replace(',', '.')) : null;
  }

  function normalizarUnidad(v) {
    return sinTildes(String(v)).toLowerCase().replace(/[\s()]/g, '').replace('³', '3').replace('db(a)', 'dba').replace(/^ºc$/, '°c');
  }

  function comoNumero(v) {
    if (typeof v === 'number') return v;
    if (typeof v === 'string') v = v.replace(/_x000D_/g, '');
    if (typeof v === 'string' && /^\s*-?\d+(\.\d+)?\s*$/.test(v)) return Number(v);
    return null;
  }

  // ---------- Fechas ----------
  function leerFecha(v, base1904) {
    if (esVacio(v)) return { tipo: 'vacia' };
    if (esNoRegistrado(v)) return { tipo: 'nr', texto: String(v).trim() };
    if (typeof v === 'number') {
      if (v >= 1900 && v <= 2100 && v === Math.floor(v)) return { tipo: 'soloAnio', y: v };
      if (v < 1 || v >= 80000) return { tipo: 'texto' };
      var f = new Date(Date.UTC(1899, 11, 30) + (v + (base1904 ? 1462 : 0)) * 864e5);
      return { tipo: 'ok', y: f.getUTCFullYear(), m: f.getUTCMonth() + 1, d: f.getUTCDate() };
    }
    var s = v.trim();
    var anios = s.match(/(?:^|\D)((?:19|20)\d{2})(?!\d)/g);
    var y = anios ? Number(anios[anios.length - 1].replace(/\D/g, '')) : null;
    return { tipo: 'texto', y: y };
  }

  // ---------- NIT ----------
  function digitoVerificacion(base) {
    var pesos = [3, 7, 13, 17, 19, 23, 29, 37, 41, 43, 47, 53, 59, 67, 71], suma = 0;
    for (var i = 0; i < base.length; i++) suma += Number(base[base.length - 1 - i]) * pesos[i];
    var r = suma % 11;
    return r > 1 ? 11 - r : r;
  }

  function revisarNit(v) {
    var s = String(v).trim();
    var m = /^(\d{8,10})(?:-(\d))?$/.exec(s);
    if (!m) {
      if (/^\d[\d-]{7,}\d$/.test(s)) return 'extranjero';
      return /^[\d.\s-]+$/.test(s) && s.replace(/\D/g, '').length >= 8 ? 'formato' : 'invalido';
    }
    if (m[2] === undefined) return 'sinDv';
    return digitoVerificacion(m[1]) === Number(m[2]) ? 'ok' : 'dv';
  }

  // El mismo NIT puede venir con o sin puntos y dígito de verificación: se compara solo la parte base.
  function baseNit(v) {
    var d = String(v).split('-')[0].replace(/\D/g, '');
    return d.length === 10 && String(v).indexOf('-') < 0 ? d.slice(0, 9) : d || String(v).trim();
  }

  // ---------- Nombres de empresa ----------
  function claveEmpresa(v) {
    return sinTildes(String(v)).toUpperCase()
      .replace(/\(.*?\)/g, ' ')
      .replace(/\b(S\s*\.?\s*A\s*\.?\s*S\.?|S\.\s*A\.?|SA|LTDA\.?|E\.?\s*S\.?\s*P\.?|INC\.?|SUCURSAL COLOMBIA|COLOMBIA)(?=\s|$|[.,])/g, ' ')
      .replace(/[^A-Z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
  }

  function distancia(a, b) {
    if (Math.abs(a.length - b.length) > 2) return 3;
    var prev = [];
    for (var j = 0; j <= b.length; j++) prev[j] = j;
    for (var i = 1; i <= a.length; i++) {
      var act = [i];
      for (j = 1; j <= b.length; j++) act[j] = Math.min(prev[j] + 1, act[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = act;
    }
    return prev[b.length];
  }

  function esMismaEmpresa(a, b) {
    if (a === b) return true;
    var pa = a.split(' ')[0];
    var corto = a.length < b.length ? a : b, largo = a.length < b.length ? b : a;
    if (corto.length >= 5 && largo.indexOf(corto + ' ') === 0) return true;
    return pa.length >= 3 && a.length >= 8 && b.length >= 8 && distancia(a, b) <= 2;
  }

  // Agrupa todas las formas de escribir cada empresa. Devuelve clave → nombre oficial (el más usado).
  // Dos nombres con NIT distinto son empresas distintas, aunque se parezcan (ej.: las filiales de un grupo).
  function unificarEmpresas(conteo, clavesPorArchivo, nitPorClave) {
    var claves = Object.keys(conteo), padre = {}, nitsDeGrupo = {};
    function chocan(a, b) {
      var na = Object.keys(nitsDeGrupo[a] || {}), nb = nitsDeGrupo[b] || {};
      return na.length > 0 && Object.keys(nb).length > 0 && !na.some(function (n) { return nb[n]; });
    }
    function unir(a, b) {
      var ra = raiz(a), rb = raiz(b);
      if (ra === rb || chocan(ra, rb)) return;
      padre[ra] = rb;
      nitsDeGrupo[rb] = nitsDeGrupo[rb] || {};
      for (var n in nitsDeGrupo[ra] || {}) nitsDeGrupo[rb][n] = 1;
    }
    function raiz(k) { while (padre[k] !== k) { padre[k] = padre[padre[k]]; k = padre[k]; } return k; }
    claves.forEach(function (k) {
      padre[k] = k;
      nitsDeGrupo[k] = {};
      for (var n in nitPorClave[k] || {}) nitsDeGrupo[k][n] = 1;
    });
    for (var i = 0; i < claves.length; i++) {
      for (var j = i + 1; j < claves.length; j++) {
        if (esMismaEmpresa(claves[i], claves[j])) unir(claves[i], claves[j]);
      }
    }
    Object.keys(clavesPorArchivo).forEach(function (a) {
      var lista = Object.keys(clavesPorArchivo[a]);
      lista.slice(1).forEach(function (k) {
        // Si solo uno de los dos trae NIT, puede ser otra empresa del mismo archivo: no se asume.
        var conNit = function (x) { return Object.keys(nitsDeGrupo[raiz(x)] || {}).length > 0; };
        if (conNit(k) === conNit(lista[0])) unir(k, lista[0]);
      });
    });
    var grupos = {};
    claves.forEach(function (k) {
      var r = raiz(k);
      grupos[r] = grupos[r] || {};
      for (var nombre in conteo[k]) grupos[r][nombre] = (grupos[r][nombre] || 0) + conteo[k][nombre];
    });
    var oficial = {};
    claves.forEach(function (k) {
      var g = grupos[raiz(k)];
      oficial[k] = Object.keys(g).sort(function (a, b) {
        var la = /S\.?\s?A\.?\s?S\.?$|LTDA\.?$|S\.A\.?$/i.test(a) ? a.length : 0, lb = /S\.?\s?A\.?\s?S\.?$|LTDA\.?$|S\.A\.?$/i.test(b) ? b.length : 0;
        return lb - la || g[b] - g[a] || b.length - a.length;
      })[0].replace(/\s+/g, ' ').trim();
    });
    return oficial;
  }

  // ---------- Hojas ----------
  function mapearColumnas(encabezados) {
    var roles = {}, porNombre = {};
    encabezados.forEach(function (h, i) {
      if (esVacio(h)) return;
      var n = normalizarEncabezado(h);
      if (porNombre[n] === undefined) porNombre[n] = i;
      for (var rol in Reglas.columnas) {
        if (roles[rol] === undefined && Reglas.columnas[rol].test(n)) roles[rol] = i;
      }
    });
    return { roles: roles, porNombre: porNombre };
  }

  function esFilaEncabezado(celdas, encabezados) {
    var llenas = 0, iguales = 0;
    celdas.forEach(function (v, i) {
      if (esVacio(v)) return;
      llenas++;
      if (!esVacio(encabezados[i]) && normalizarEncabezado(v) === normalizarEncabezado(encabezados[i])) iguales++;
    });
    return llenas >= 2 && iguales / llenas >= 0.6;
  }

  function encontrarEncabezado(filas) {
    for (var i = 0; i < Math.min(filas.length, 15); i++) {
      var m = mapearColumnas(filas[i].celdas);
      if (m.roles.empresa !== undefined || m.roles.fecha !== undefined) return i;
    }
    return filas.length ? 0 : -1;
  }

  // Une filas consecutivas: [2,3,4,9] → "2–4, 9"
  function compactarFilas(filas, maxGrupos) {
    var grupos = [], ini = null, ant = null;
    filas.forEach(function (f) {
      if (ini === null) { ini = ant = f; return; }
      if (f === ant + 1) { ant = f; return; }
      grupos.push(ini === ant ? String(ini) : ini + '–' + ant);
      ini = ant = f;
    });
    if (ini !== null) grupos.push(ini === ant ? String(ini) : ini + '–' + ant);
    if (maxGrupos && grupos.length > maxGrupos) return grupos.slice(0, maxGrupos).join(', ') + ' … y ' + (grupos.length - maxGrupos) + ' grupos más';
    return grupos.join(', ');
  }

  function auditar(libros, hoy) {
    hoy = hoy || new Date();
    var hoyNum = hoy.getFullYear() * 10000 + (hoy.getMonth() + 1) * 100 + hoy.getDate();
    var hallazgos = {}, generales = [], escala = {}, arreglos = {}, filasListas = 0;
    var resumenArchivos = [], totalFilas = 0;

    // Lo obvio no es un error: se cuenta aparte y se arregla solo al cargar.
    function agregar(p) {
      if (p.auto) {
        var ar = arreglos[p.autoTipo || p.tipo || p.que] = arreglos[p.autoTipo || p.tipo || p.que] || { tipo: p.autoTipo || p.tipo || p.que, cantidad: 0 };
        ar.cantidad++;
        return;
      }
      var clave = [p.archivo, p.hoja, p.empresa, p.columna, p.que].join('|');
      var h = hallazgos[clave];
      if (!h) {
        h = hallazgos[clave] = { prioridad: p.prioridad, archivo: p.archivo, hoja: p.hoja, empresa: p.empresa, columna: p.columna, nombreColumna: p.nombreColumna, que: p.que, tipo: p.tipo || p.que, ejemplos: [], filas: [], corregir: p.corregir };
      }
      h.filas.push(p.fila);
      if (p.ejemplo !== undefined && h.ejemplos.length < 3 && h.ejemplos.indexOf(p.ejemplo) < 0) h.ejemplos.push(p.ejemplo);
    }

    function general(p) { generales.push(p); }

    // Primera pasada: leer hojas y contar nombres de empresa.
    var hojas = [], conteo = {}, nitPorClave = {}, clavesPorArchivo = {};
    libros.forEach(function (libro) {
      var hojasMedicion = libro.hojas.filter(function (h) { return !Reglas.hojasDeControl.test(h.nombre); });
      var nombresHojas = hojasMedicion.map(function (h) { return h.nombre; });
      resumenArchivos.push({ archivo: libro.archivo, filas: 0, hojas: hojasMedicion.length, puntos: 0 });
      hojasMedicion.forEach(function (h) {
        var iEnc = encontrarEncabezado(h.filas);
        if (iEnc < 0 || h.filas.length <= iEnc + 1) {
          general({ prioridad: 'Alta', archivo: libro.archivo, hoja: h.nombre, tipo: 'Hoja vacía', que: 'La hoja viene vacía, sin ninguna medición.', corregir: 'Confirmar si no hay mediciones de este factor o si faltan por cargar (TI espera que aparezcan en las empresas pendientes).' });
          return;
        }
        var enc = h.filas[iEnc].celdas, mapa = mapearColumnas(enc);
        hojas.push({ libro: libro, hoja: h, enc: enc, mapa: mapa, datos: h.filas.slice(iEnc + 1) });
        if (mapa.roles.empresa === undefined) return;
        var colE = mapa.roles.empresa, colN = mapa.roles.nit, colA = mapa.roles.archivo;
        h.filas.slice(iEnc + 1).forEach(function (f) {
          var v = f.celdas[colE];
          if (esVacio(v) || esNoRegistrado(v) || esFilaEncabezado(f.celdas, enc)) return;
          var k = claveEmpresa(v), texto = String(v).trim().replace(/\s+/g, ' ');
          conteo[k] = conteo[k] || {};
          conteo[k][texto] = (conteo[k][texto] || 0) + 1;
          if (colA !== undefined && !esVacio(f.celdas[colA])) {
            var origen = String(f.celdas[colA]).trim();
            clavesPorArchivo[origen] = clavesPorArchivo[origen] || {};
            clavesPorArchivo[origen][k] = 1;
          }
          var nit = colN !== undefined ? f.celdas[colN] : undefined;
          if (!esVacio(nit) && !esNoRegistrado(nit) && String(nit).replace(/\D/g, "").length >= 8) {
            nitPorClave[k] = nitPorClave[k] || {};
            nitPorClave[k][baseNit(nit)] = 1;
          }
        });
      });
      Reglas.hojasPlantilla.forEach(function (n) {
        if (nombresHojas.indexOf(n) < 0 && libro.hojas.length > 1) general({ prioridad: 'Media', archivo: libro.archivo, hoja: n, tipo: 'Hoja de la plantilla que falta', que: 'Esta hoja de la plantilla no viene en el archivo.', corregir: 'Confirmar si no hay mediciones de este factor o si falta incluirla.' });
      });
      nombresHojas.forEach(function (n) {
        if (Reglas.hojasPlantilla.indexOf(n) < 0 && libro.hojas.length > 1) general({ prioridad: 'Media', archivo: libro.archivo, hoja: n, tipo: 'Hoja fuera de la plantilla', que: 'Esta hoja no está en la plantilla que pidió Sura.', corregir: 'Confirmar si este factor se incluye en el tablero.' });
      });
    });

    var oficial = unificarEmpresas(conteo, clavesPorArchivo, nitPorClave);
    var clavesPorNit = {};
    Object.keys(nitPorClave).forEach(function (k) {
      Object.keys(nitPorClave[k]).forEach(function (n) {
        clavesPorNit[n] = clavesPorNit[n] || {};
        clavesPorNit[n][oficial[k]] = 1;
      });
    });
    var nitsPorEmpresa = {};
    Object.keys(nitPorClave).forEach(function (k) {
      var o = oficial[k];
      nitsPorEmpresa[o] = nitsPorEmpresa[o] || {};
      for (var n in nitPorClave[k]) nitsPorEmpresa[o][n] = 1;
    });

    // Segunda pasada: revisar cada fila.
    hojas.forEach(function (ctx) {
      var archivo = ctx.libro.archivo, hoja = ctx.hoja.nombre, enc = ctx.enc, roles = ctx.mapa.roles;
      var resumen = resumenArchivos.filter(function (r) { return r.archivo === archivo; })[0];

      Reglas.columnasFaltantes.forEach(function (c) {
        if (roles[c.rol] === undefined) general({ prioridad: c.prioridad, archivo: archivo, hoja: hoja, tipo: 'Columna que no existe', que: 'No existe la columna "' + c.nombre + '".', corregir: c.corregir });
      });

      if (roles.esLod !== undefined && !ctx.datos.some(function (f) { return !esVacio(f.celdas[roles.esLod]) && !esFilaEncabezado(f.celdas, enc); })) {
        general({ prioridad: 'Media', archivo: archivo, hoja: hoja, tipo: 'Columna vacía', que: 'La columna "Es LOD?" viene vacía en toda la hoja.', corregir: 'Llenar si la medición está bajo el límite de detección (Si / No).' });
      }
      function nombreCol(c) { return String(enc[c]).replace(/\s+/g, ' ').trim(); }
      function letra(c) { return Excel.indiceALetra(c); }

      var vistos = {};
      var tlvPorGrupo = {}, unidades = {};

      function base(empresa, fila, c) {
        return { archivo: archivo, hoja: hoja, empresa: empresa, columna: letra(c), nombreColumna: nombreCol(c), fila: fila };
      }
      function con(b, extra) { for (var k in extra) b[k] = extra[k]; return b; }
      function nitUnico(e) { return !!nitsPorEmpresa[e] && Object.keys(nitsPorEmpresa[e]).length === 1; }

      ctx.datos.forEach(function (f) {
        var c = f.celdas, fila = f.fila;
        if (esFilaEncabezado(c, enc)) {
          agregar({ prioridad: 'Alta', archivo: archivo, hoja: hoja, empresa: '-', columna: 'A:' + letra(enc.length - 1), nombreColumna: '(toda la fila)', fila: fila, que: 'Fila de encabezados repetida', corregir: 'Borrar esta fila: repite los títulos de las columnas en medio de los datos.' });
          return;
        }
        resumen.filas++; totalFilas++;

        // Empresa
        var empresa = 'Sin empresa';
        if (roles.empresa !== undefined) {
          var ce = roles.empresa, vE = c[ce];
          if (esVacio(vE) || esNoRegistrado(vE)) {
            agregar(con(base('Sin empresa', fila, ce), { prioridad: 'Alta', que: 'Empresa vacía o NR/NA', ejemplo: esVacio(vE) ? undefined : String(vE).trim(), corregir: 'Escribir el nombre de la empresa.' }));
          } else {
            var txt = String(vE), limpio = txt.trim().replace(/\s+/g, ' ');
            empresa = oficial[claveEmpresa(vE)] || limpio;
            if (limpio !== empresa) {
              agregar(con(base(empresa, fila, ce), { auto: nitUnico(empresa), autoTipo: 'Nombres de empresa unificados', prioridad: 'Alta', tipo: 'Nombre de empresa escrito distinto', que: 'Nombre de empresa escrito distinto: "' + limpio + '"', ejemplo: limpio, corregir: 'Confirmar si es la misma empresa que "' + empresa + '". Si lo es, escribirla igual en todas las filas; si es otra empresa, dejarla y avisar.' }));
            }
            if (txt !== limpio) {
              agregar(con(base(empresa, fila, ce), { auto: true, autoTipo: 'Espacios de más quitados', prioridad: 'Alta', que: 'Nombre de empresa con espacios de más', ejemplo: txt, corregir: 'Quitar los espacios sobrantes: "' + limpio + '".' }));
            }
          }
        }

        // NIT
        if (roles.nit !== undefined) {
          var cn = roles.nit, vN = c[cn];
          if (esVacio(vN) || esNoRegistrado(vN)) {
            agregar(con(base(empresa, fila, cn), { auto: nitUnico(empresa), autoTipo: 'NIT completado con el de la misma empresa', prioridad: 'Alta', que: 'NIT vacío o NR/NA', ejemplo: esVacio(vN) ? undefined : String(vN).trim(), corregir: 'Escribir el NIT de la empresa.' }));
          } else {
            var estadoNit = revisarNit(vN), tN = String(vN).trim();
            if (estadoNit === 'invalido' || estadoNit === 'formato') {
              agregar(con(base(empresa, fila, cn), { prioridad: 'Alta', tipo: 'NIT mal escrito', que: 'NIT mal escrito', ejemplo: tN, corregir: 'Escribirlo como 800123456-7, sin puntos ni espacios.' }));
            } else if (estadoNit === 'dv') {
              agregar(con(base(empresa, fila, cn), { prioridad: 'Media', que: 'Dígito de verificación del NIT no cuadra', ejemplo: tN, corregir: 'Revisar el NIT contra el RUT de la empresa.' }));
            }
            if (nitsPorEmpresa[empresa] && Object.keys(nitsPorEmpresa[empresa]).length > 1) {
              agregar(con(base(empresa, fila, cn), { prioridad: 'Alta', que: 'La empresa aparece con varios NIT', ejemplo: tN, corregir: 'Dejar un solo NIT para la empresa o confirmar si son empresas distintas.' }));
            }
            if (clavesPorNit[baseNit(vN)] && Object.keys(clavesPorNit[baseNit(vN)]).length > 1) {
              agregar(con(base(empresa, fila, cn), { prioridad: 'Alta', que: 'El mismo NIT aparece en varias empresas', ejemplo: tN, corregir: 'Revisar a cuál empresa pertenece este NIT.' }));
            }
          }
        }

        // CIIU
        if (roles.ciiu !== undefined) {
          var cc = roles.ciiu, vC = c[cc];
          if (esVacio(vC) || esNoRegistrado(vC)) {
            agregar(con(base(empresa, fila, cc), { prioridad: 'Alta', que: 'CIIU vacío o NR/NA', ejemplo: esVacio(vC) ? undefined : String(vC).trim(), corregir: 'Escribir el código CIIU de la empresa.' }));
          } else if (!/^[A-Za-z]?\d{4}$/.test(String(vC).trim())) {
            agregar(con(base(empresa, fila, cc), { prioridad: 'Alta', que: 'CIIU mal escrito', ejemplo: String(vC).trim(), corregir: 'El CIIU son 4 dígitos, por ejemplo 0610.' }));
          }
        }

        // Obligatorias
        Reglas.obligatorias.forEach(function (o) {
          var col = roles[o.rol];
          if (col === undefined || (o.exceptoHojas && o.exceptoHojas.indexOf(hoja) >= 0)) return;
          var v = c[col];
          if (o.naValido && esNA(v)) return;
          if (esVacio(v)) agregar(con(base(empresa, fila, col), { prioridad: o.prioridad, tipo: o.nombre + ' vacío o NR', que: o.vacio || o.nombre + ' vacío', corregir: o.corregir }));
          else if (esNoRegistrado(v)) agregar(con(base(empresa, fila, col), { prioridad: o.prioridad, tipo: o.nombre + ' vacío o NR', que: o.nombre + ' dice "' + String(v).trim() + '"', corregir: o.corregir }));
        });

        // Fecha y año
        var fecha = null;
        if (roles.fecha !== undefined) {
          var cf = roles.fecha, vF = c[cf];
          fecha = leerFecha(vF, ctx.libro.base1904);
          var bf = function (extra) { agregar(con(base(empresa, fila, cf), extra)); };
          if (fecha.tipo === 'vacia') bf({ prioridad: 'Alta', que: 'Fecha de medición vacía', corregir: Reglas.textosCorregir.fecha });
          else if (fecha.tipo === 'nr') bf({ prioridad: 'Alta', tipo: 'Fecha dice NR', que: 'Fecha dice "' + fecha.texto + '"', corregir: Reglas.textosCorregir.fecha });
          else if (fecha.tipo === 'soloAnio') bf({ prioridad: 'Alta', que: 'La fecha tiene solo el año', ejemplo: 'Dice ' + vF + ' (Excel la muestra en 1905)', corregir: Reglas.textosCorregir.fechaAnio });
          else if (fecha.tipo === 'texto') bf({ prioridad: 'Alta', que: 'Fecha escrita como texto o incompleta', ejemplo: vF === 0 ? '"00:00:00"' : '"' + String(vF).trim() + '"', corregir: Reglas.textosCorregir.fechaTexto });
          else if (fecha.tipo === 'ok') {
            if (fecha.y * 10000 + fecha.m * 100 + fecha.d > hoyNum) bf({ prioridad: 'Alta', que: 'Fecha en el futuro', ejemplo: fecha.d + '/' + fecha.m + '/' + fecha.y, corregir: 'Revisar la fecha: todavía no ha pasado.' });
          }
        }
        var anioFila = null;
        if (roles.anio !== undefined) {
          var ca = roles.anio, vA = c[ca], nA = comoNumero(vA);
          if (esVacio(vA) || esNoRegistrado(vA)) agregar(con(base(empresa, fila, ca), { prioridad: 'Alta', que: 'Año vacío o NR/NA', corregir: 'Escribir el año de la medición.' }));
          else if (nA === null || nA !== Math.floor(nA)) agregar(con(base(empresa, fila, ca), { prioridad: 'Alta', que: 'Año no es un número', ejemplo: String(vA), corregir: 'Escribir el año con 4 dígitos.' }));
          else anioFila = nA;
        }
        var anioRef = anioFila !== null ? anioFila : (fecha && fecha.y) || null;
        if (anioRef !== null) {
          var colRango = anioFila !== null ? roles.anio : roles.fecha;
          if (anioRef < Reglas.anioInicio || anioRef > hoy.getFullYear()) {
            agregar(con(base(empresa, fila, colRango), { prioridad: 'Alta', que: 'Año fuera de rango', ejemplo: String(anioRef), corregir: 'Revisar el año: debe estar entre ' + Reglas.anioInicio + ' y ' + hoy.getFullYear() + '. Si es correcto, confirmar si se incluye.' }));
          } else if (anioRef < Reglas.anioAlcance) {
            agregar(con(base(empresa, fila, colRango), { prioridad: 'Media', que: 'Medición anterior a ' + Reglas.anioAlcance, tipo: 'Medición anterior a 2020', ejemplo: String(anioRef), corregir: 'Confirmar si estas mediciones se incluyen en el tablero.' }));
          }
        }
        if (anioFila !== null && fecha && fecha.y && fecha.y !== anioFila) {
          agregar(con(base(empresa, fila, roles.anio), { prioridad: 'Alta', que: 'El año no coincide con la fecha', ejemplo: 'Año ' + anioFila + ' / fecha ' + (fecha.tipo === 'ok' ? fecha.d + '/' + fecha.m + '/' : '') + fecha.y, corregir: 'Revisar cuál es el correcto y corregir el otro.' }));
        }

        // Grado de riesgo
        if (roles.grado !== undefined) {
          var cg = roles.grado, vG = c[cg];
          if (esVacio(vG)) agregar(con(base(empresa, fila, cg), { prioridad: 'Alta', que: 'Grado de riesgo vacío', corregir: 'Escribir el grado de riesgo: ' + Reglas.textoEscala(hoja) + '.' }));
          else {
            var g = String(vG).trim(), validos = Reglas.escalasPorHoja[hoja] || Reglas.escalaGeneral;
            if (validos.indexOf(g.toLowerCase()) < 0 && Reglas.palabrasGrado.indexOf(sinTildes(g).toLowerCase()) >= 0) {
              agregar(con(base(empresa, fila, cg), { auto: true, autoTipo: 'Grados en palabras pasados a letra', que: 'Grado en palabras' }));
            } else if (validos.indexOf(g.toLowerCase()) < 0) {
              agregar(con(base(empresa, fila, cg), { prioridad: 'Alta', tipo: 'Grado de riesgo con otra escala', que: 'Grado de riesgo con otra escala: "' + g + '"', ejemplo: '"' + g + '"', corregir: 'Esta hoja usa ' + Reglas.textoEscala(hoja) + '. Decir a qué equivale este valor.' }));
              var ke = hoja + '|' + g;
              escala[ke] = escala[ke] || { hoja: hoja, valor: g, filas: 0 };
              escala[ke].filas++;
            }
          }
        }

        // Medición: valor, TLV e IR, según la unidad de la fila.
        var unidadTxt = roles.unidad !== undefined ? c[roles.unidad] : undefined;
        var unidad = esVacio(unidadTxt) ? '' : normalizarUnidad(unidadTxt);
        var rango = Reglas.rangosPorUnidad[unidad] || {};
        if (unidad) {
          unidades[unidad] = unidades[unidad] || {};
          var crudo = String(unidadTxt).trim();
          (unidades[unidad][crudo] = unidades[unidad][crudo] || []).push({ empresa: empresa, fila: fila });
        }

        var valNum = null;
        if (roles.valor !== undefined) {
          var cv = roles.valor, vV = c[cv];
          if (esVacio(vV)) agregar(con(base(empresa, fila, cv), { prioridad: 'Alta', tipo: 'Valor medido vacío o NR', que: 'Valor medido vacío', corregir: 'Escribir el valor medido.' }));
          else if (esNoRegistrado(vV)) agregar(con(base(empresa, fila, cv), { prioridad: 'Alta', tipo: 'Valor medido vacío o NR', que: 'Valor medido dice "' + String(vV).trim() + '"', corregir: Reglas.textosCorregir.valor }));
          else if (!esBajoLimite(vV)) {
            valNum = comoNumero(vV);
            if (valNum === null && numeroConComa(vV) !== null) {
              valNum = numeroConComa(vV);
              agregar(con(base(empresa, fila, cv), { auto: true, autoTipo: 'Números con coma corregidos', que: 'Número con coma' }));
            }
            if (valNum === null) agregar(con(base(empresa, fila, cv), { prioridad: 'Alta', que: 'Valor medido no es un número', ejemplo: '"' + String(vV).trim() + '"', corregir: 'Escribir solo el número, con punto decimal y sin unidades.' }));
            else if (valNum < 0 && !(rango.valor && rango.valor[0] < 0)) agregar(con(base(empresa, fila, cv), { prioridad: 'Alta', que: 'Valor medido negativo', ejemplo: String(valNum), corregir: 'Una concentración no puede ser negativa. Revisar qué significa este valor y corregirlo.' }));
            else if (rango.valor && (valNum < rango.valor[0] || valNum > rango.valor[1])) agregar(con(base(empresa, fila, cv), { prioridad: 'Alta', tipo: 'Unidad o escala rara', que: 'Valor fuera de lo posible para ' + String(unidadTxt).trim(), ejemplo: String(valNum), corregir: 'Revisar la unidad: debería estar entre ' + rango.valor[0] + ' y ' + rango.valor[1] + '.' }));
          }
        }

        var tlvNum = null;
        if (roles.tlv !== undefined) {
          var ct = roles.tlv, vT = c[ct];
          if (esVacio(vT)) agregar(con(base(empresa, fila, ct), { prioridad: 'Media', tipo: 'TLV vacío o NR', que: 'TLV vacío', corregir: Reglas.textosCorregir.tlv }));
          else if (esNR(vT)) agregar(con(base(empresa, fila, ct), { prioridad: 'Media', tipo: 'TLV vacío o NR', que: 'TLV dice "' + String(vT).trim() + '"', corregir: Reglas.textosCorregir.tlv }));
          else if (!esNA(vT)) {
            tlvNum = comoNumero(vT);
            if (tlvNum === null) {
              if (!(rango.tlvTexto && /^\d+(\s*[-–—]+\s*\d+)*\s*$/.test(String(vT).trim()))) agregar(con(base(empresa, fila, ct), { prioridad: 'Media', que: 'TLV no es un número', ejemplo: '"' + String(vT).trim() + '"', corregir: 'Escribir solo el número, sin símbolos ni unidades.' }));
            } else if (tlvNum <= 0) {
              agregar(con(base(empresa, fila, ct), { prioridad: 'Alta', tipo: 'Unidad o escala rara', que: 'TLV en cero o negativo', ejemplo: String(tlvNum), corregir: 'Revisar el TLV: debe ser mayor que cero. Si no aplica, dejar NA.' }));
              tlvNum = null;
            } else if (rango.tlv && (tlvNum < rango.tlv[0] || tlvNum > rango.tlv[1])) {
              agregar(con(base(empresa, fila, ct), { prioridad: 'Alta', tipo: 'Unidad o escala rara', que: 'TLV fuera de lo posible para ' + String(unidadTxt).trim(), ejemplo: String(tlvNum), corregir: 'Revisar la unidad: debería estar entre ' + rango.tlv[0] + ' y ' + rango.tlv[1] + '.' }));
            } else if (roles.variable !== undefined && !esVacio(c[roles.variable])) {
              var kv = normalizarEncabezado(c[roles.variable]) + ' ' + unidad;
              var gr = tlvPorGrupo[kv] = tlvPorGrupo[kv] || {};
              (gr[tlvNum] = gr[tlvNum] || []).push({ empresa: empresa, fila: fila });
            }
          }
        }

        if (valNum !== null && tlvNum !== null && valNum / tlvNum >= Reglas.vecesValorSobreTlv) {
          agregar(con(base(empresa, fila, roles.valor), { prioridad: 'Alta', tipo: 'Unidad o escala rara', que: 'Valor ' + Reglas.vecesValorSobreTlv + ' veces o más sobre el TLV', ejemplo: valNum + ' contra TLV ' + tlvNum, corregir: 'Revisar si valor y TLV están en la misma unidad (ej.: µg/m3 contra mg/m3).' }));
        }

        if (roles.ir !== undefined) {
          var ci = roles.ir, vI = c[ci];
          if (esVacio(vI)) agregar(con(base(empresa, fila, ci), { prioridad: 'Alta', tipo: 'IR vacío o NR', que: 'IR vacío', corregir: Reglas.textosCorregir.ir }));
          else if (esNR(vI)) agregar(con(base(empresa, fila, ci), { prioridad: 'Alta', tipo: 'IR vacío o NR', que: 'IR dice "' + String(vI).trim() + '"', corregir: Reglas.textosCorregir.ir }));
          else if (!esNA(vI) && !esBajoLimite(vI)) {
            var irNum = comoNumero(vI);
            if (irNum === null && numeroConComa(vI) !== null) {
              irNum = numeroConComa(vI);
              agregar(con(base(empresa, fila, ci), { auto: true, autoTipo: 'Números con coma corregidos', que: 'Número con coma' }));
            }
            if (irNum === null) agregar(con(base(empresa, fila, ci), { prioridad: 'Media', que: 'IR no es un número', ejemplo: '"' + String(vI).trim() + '"', corregir: 'Escribir solo el número, sin el símbolo %.' }));
            else if (unidad !== 'dba' && valNum !== null && tlvNum !== null && valNum > 0 && irNum > 0) {
              // El IR puede venir como fracción o como porcentaje: se acepta cualquiera de los dos.
              var r = valNum / tlvNum, d1 = Math.max(irNum, r) / Math.min(irNum, r), d2 = Math.max(irNum, r * 100) / Math.min(irNum, r * 100);
              if (Math.min(d1, d2) >= Reglas.vecesIr) agregar(con(base(empresa, fila, ci), { prioridad: 'Media', tipo: 'Unidad o escala rara', que: 'IR no cuadra con valor y TLV', ejemplo: 'IR ' + irNum + ', valor ' + valNum + ', TLV ' + tlvNum, corregir: 'Revisar si valor, TLV e IR están en la misma escala.' }));
            }
          }
        }

        // Lista para cargar: tiene empresa, NIT, año y valor.
        var vEm = roles.empresa !== undefined ? c[roles.empresa] : undefined, vNi = roles.nit !== undefined ? c[roles.nit] : undefined;
        var nitOk = (!esVacio(vNi) && !esNoRegistrado(vNi)) || nitUnico(empresa);
        if (!esVacio(vEm) && !esNoRegistrado(vEm) && nitOk && anioFila !== null && (valNum !== null || esBajoLimite(c[roles.valor]))) filasListas++;

        // Duplicadas: la fila completa es igual a otra.
        var huella = [];
        for (var i = 0; i < c.length; i++) huella.push(c[i] === undefined ? '' : c[i]);
        var clave = huella.join('\u0001');
        if (vistos[clave]) {
          agregar({ prioridad: 'Media', archivo: archivo, hoja: hoja, empresa: empresa, columna: 'A:' + letra(enc.length - 1), nombreColumna: '(toda la fila)', fila: fila, que: 'Fila duplicada', ejemplo: 'Igual a la fila ' + vistos[clave], corregir: 'Borrar la fila repetida o confirmar que son mediciones distintas.' });
        } else vistos[clave] = fila;
      });

      // TLV del mismo agente y unidad con escalas muy distintas: se marca el que se aparta del más usado.
      Object.keys(tlvPorGrupo).forEach(function (kv) {
        var gr = tlvPorGrupo[kv], valores = Object.keys(gr).map(Number);
        if (valores.length < 2) return;
        var comun = valores.sort(function (a, b) { return gr[b].length - gr[a].length; })[0];
        valores.slice(1).forEach(function (v) {
          if (Math.max(v, comun) / Math.min(v, comun) < Reglas.vecesEntreTlv) return;
          gr[v].forEach(function (r) {
            agregar(con(base(r.empresa, r.fila, roles.tlv), { prioridad: 'Alta', tipo: 'Unidad o escala rara', que: 'TLV muy distinto al del mismo agente', ejemplo: 'TLV ' + v + ' contra ' + comun, corregir: 'Revisar la unidad del TLV: este agente suele venir con ' + comun + '.' }));
          });
        });
      });

      // Una misma unidad escrita de varias formas: se deja la más usada.
      Object.keys(unidades).forEach(function (u) {
        var formas = Object.keys(unidades[u]).sort(function (a, b) { return unidades[u][b].length - unidades[u][a].length; });
        formas.slice(1).forEach(function (forma) {
          unidades[u][forma].forEach(function (r) {
            agregar(con(base(r.empresa, r.fila, roles.unidad), { auto: true, autoTipo: 'Unidades escritas igual', prioridad: 'Media', tipo: 'Unidad escrita distinto', que: 'Unidad escrita distinto: "' + forma + '"', ejemplo: '"' + forma + '"', corregir: 'Escribirla igual en toda la hoja: "' + formas[0] + '".' }));
          });
        });
      });
    });

    var lista = Object.keys(hallazgos).map(function (k) {
      var h = hallazgos[k];
      h.filas.sort(function (a, b) { return a - b; });
      h.cantidad = h.filas.length;
      return h;
    });
    function peso(p) { return p === 'Alta' ? 0 : 1; }
    lista.sort(function (a, b) { return peso(a.prioridad) - peso(b.prioridad) || b.cantidad - a.cantidad; });
    generales.sort(function (a, b) { return peso(a.prioridad) - peso(b.prioridad); });

    lista.forEach(function (h) {
      resumenArchivos.forEach(function (r) { if (r.archivo === h.archivo) r.puntos++; });
    });
    generales.forEach(function (g) {
      resumenArchivos.forEach(function (r) { if (r.archivo === g.archivo) r.puntos++; });
    });

    var empresas = {};
    lista.forEach(function (h) {
      if (h.empresa === '-') return;
      var e = empresas[h.empresa] = empresas[h.empresa] || { nombre: h.empresa, puntos: 0, alta: 0, celdas: 0, archivos: {} };
      e.puntos++; e.celdas += h.cantidad; e.archivos[h.archivo] = 1;
      if (h.prioridad === 'Alta') e.alta++;
    });

    return {
      hallazgos: lista, generales: generales,
      arreglos: Object.keys(arreglos).map(function (k) { return arreglos[k]; }).sort(function (a, b) { return b.cantidad - a.cantidad; }),
      filasListas: filasListas,
      archivos: resumenArchivos, totalFilas: totalFilas,
      empresas: Object.keys(empresas).map(function (k) { return empresas[k]; }).sort(function (a, b) { return a.nombre.localeCompare(b.nombre, 'es'); }),
      escala: Object.keys(escala).map(function (k) { return escala[k]; }).sort(function (a, b) { return (a.hoja + a.valor).localeCompare(b.hoja + b.valor, 'es'); })
    };
  }

  return { auditar: auditar, compactarFilas: compactarFilas };
})();
