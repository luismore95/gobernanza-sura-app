// Pantalla del Revisor: recibe los archivos, corre la auditoría y muestra los puntos por corregir.
(function () {
  var POR_PAGINA = 40;
  var estado = { archivos: [], resultado: null, anterior: null, prioridad: '', hoja: '', tipo: '', empresas: {}, soloArchivo: '', mostrar: POR_PAGINA };

  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; });
  }
  function miles(n) { return n.toLocaleString('es-CO'); }
  function aviso(texto, esError) {
    var a = $('aviso');
    a.hidden = !texto;
    a.textContent = texto || '';
    a.className = 'aviso' + (esError ? ' error' : '');
  }
  function totalPuntos(r) { return r.hallazgos.length + r.generales.length; }

  async function procesar() {
    var libros = [], errores = [];
    if (typeof DecompressionStream === 'undefined') {
      aviso('Este navegador es muy antiguo para abrir Excel. Actualízalo o usa Chrome.', true);
      return;
    }
    $('btnRevisar').disabled = $('btnExcel').disabled = true;
    for (var i = 0; i < estado.archivos.length; i++) {
      var f = estado.archivos[i];
      aviso('Revisando ' + f.name + '…');
      await new Promise(function (ok) { setTimeout(ok, 30); });
      try {
        var libro = await Excel.leer(await f.arrayBuffer());
        libro.archivo = f.name;
        libros.push(libro);
      } catch (e) {
        var cambio = e && (e.name === 'NotReadableError' || e.name === 'NotFoundError');
        errores.push(f.name + ': ' + (cambio ? 'el archivo cambió. Arrástralo otra vez para revisarlo.' : e.message));
      }
    }
    $('btnRevisar').disabled = $('btnExcel').disabled = false;
    if (!libros.length) {
      estado.resultado = null;
      pintar();
      aviso(errores.join(' · '), true);
      return;
    }
    estado.anterior = estado.resultado;
    estado.resultado = Auditoria.auditar(libros, new Date());
    estado.mostrar = POR_PAGINA;
    var nombres = estado.resultado.empresas.map(function (e) { return e.nombre; });
    Object.keys(estado.empresas).forEach(function (n) { if (nombres.indexOf(n) < 0) delete estado.empresas[n]; });
    pintar();
    if (errores.length) aviso(errores.join(' · '), true);
    else if (estado.anterior) {
      var antes = totalPuntos(estado.anterior), ahora = totalPuntos(estado.resultado);
      aviso(ahora < antes ? 'Antes había ' + miles(antes) + ' puntos, ahora ' + miles(ahora) + '.' : ahora > antes ? 'Ahora hay ' + miles(ahora) + ' puntos, antes ' + miles(antes) + '.' : 'Revisado de nuevo: siguen ' + miles(ahora) + ' puntos.');
    } else aviso('');
  }

  function agregarArchivos(lista) {
    var nuevos = Array.prototype.slice.call(lista);
    var validos = nuevos.filter(function (f) { return /\.xlsx$/i.test(f.name); });
    if (!validos.length) { aviso('Solo se pueden revisar archivos .xlsx.', true); return; }
    validos.forEach(function (f) {
      estado.archivos = estado.archivos.filter(function (a) { return a.name !== f.name; });
      estado.archivos.push(f);
    });
    estado.anterior = null;
    estado.resultado = null;
    procesar();
  }

  // Lo que queda después de aplicar los filtros. Los puntos generales no son de una empresa.
  function visibles() {
    var r = estado.resultado, hayEmpresa = Object.keys(estado.empresas).length > 0;
    function pasa(p) {
      return (!estado.prioridad || p.prioridad === estado.prioridad) && (!estado.hoja || p.hoja === estado.hoja) &&
        (!estado.tipo || p.tipo === estado.tipo) && (!estado.soloArchivo || p.archivo === estado.soloArchivo);
    }
    var gen = hayEmpresa ? [] : r.generales.filter(pasa);
    return gen.concat(r.hallazgos.filter(function (h) { return pasa(h) && (!hayEmpresa || estado.empresas[h.empresa]); }));
  }

  function llenarSelect(sel, valores, actual, todas) {
    sel.innerHTML = '<option value="">' + todas + '</option>' + valores.map(function (v) {
      return '<option value="' + esc(v) + '"' + (v === actual ? ' selected' : '') + '>' + esc(v) + '</option>';
    }).join('');
  }

  function pintarLateral() {
    var r = estado.resultado;
    $('listaArchivos').innerHTML = r.archivos.map(function (a) {
      return '<li><button type="button" class="fila-lista" data-archivo="' + esc(a.archivo) + '" aria-pressed="' + (estado.soloArchivo === a.archivo) + '"><span class="nom">' + esc(a.archivo) +
        '<span class="detalle tab">' + a.hojas + ' hojas · ' + miles(a.filas) + ' filas</span></span><span class="cifra tab">' + miles(a.puntos) + '</span></button>' +
        '<button type="button" class="quitar" data-quitar="' + esc(a.archivo) + '" aria-label="Quitar ' + esc(a.archivo) + '">×</button></li>';
    }).join('');
    $('listaEmpresas').innerHTML = r.empresas.map(function (e) {
      return '<li><button type="button" class="fila-lista" data-empresa="' + esc(e.nombre) + '" aria-pressed="' + !!estado.empresas[e.nombre] + '"><span class="nom">' + esc(e.nombre) + '</span><span class="cifra tab">' + miles(e.puntos) + '</span></button></li>';
    }).join('') || '<li class="mut">Sin empresas con puntos.</li>';
    $('btnLimpiar').hidden = !Object.keys(estado.empresas).length;
  }

  function tarjeta(p, i) {
    var general = p.cantidad === undefined;
    var meta = general ? esc(p.hoja) + ' · Toda la hoja' : esc(p.hoja) + ' · ' + esc(p.empresa);
    var datos = '';
    if (!general) {
      datos += '<dt>Columna</dt><dd>' + esc(p.columna) + ' · ' + esc(p.nombreColumna) + '</dd>';
      datos += '<dt>Filas</dt><dd class="tab">' + esc(Auditoria.compactarFilas(p.filas, 12)) + ' <span class="mut">(' + miles(p.cantidad) + ')</span></dd>';
      if (p.ejemplos.length) datos += '<dt>Dice</dt><dd>' + esc(p.ejemplos.join(', ')) + '</dd>';
    }
    datos += '<dt>Corregir</dt><dd>' + esc(p.corregir) + '</dd>';
    return '<article class="glass punto"><div class="cab"><h3>' + esc(p.que) + '</h3><span class="pri-tag ' + p.prioridad + '">' + p.prioridad + '</span></div>' +
      '<p class="meta">' + meta + '</p><dl class="datos">' + datos + '</dl>' +
      (general ? '' : '<div class="pie"><button type="button" class="mini" data-copiar="' + i + '">Copiar filas</button></div>') + '</article>';
  }

  function pintarPuntos() {
    var lista = visibles(), cuantos = Math.min(estado.mostrar, lista.length);
    estado.lista = lista;
    $('conteo').textContent = miles(lista.length) + (lista.length === 1 ? ' punto por corregir' : ' puntos por corregir');
    $('puntos').innerHTML = lista.length ? lista.slice(0, cuantos).map(tarjeta).join('') : '<div class="glass vacio">Nada por corregir con estos filtros.</div>';
    $('btnMas').hidden = cuantos >= lista.length;
  }

  function pintar() {
    var r = estado.resultado, hay = !!r;
    $('resultado').hidden = !hay;
    $('acciones').hidden = !estado.archivos.length;
    $('btnExcel').hidden = !hay;
    $('zona').classList.toggle('compacta', estado.archivos.length > 0);
    $('zonaTitulo').textContent = estado.archivos.length ? 'Agregar más Excel' : 'Arrastra aquí tus Excel';
    $('zonaTexto').hidden = estado.archivos.length > 0;
    if (!hay) return;
    var alta = r.hallazgos.concat(r.generales).filter(function (p) { return p.prioridad === 'Alta'; }).length;
    $('kAlta').textContent = miles(alta);
    $('kMedia').textContent = miles(totalPuntos(r) - alta);
    $('kFilas').textContent = miles(r.totalFilas);
    var todos = r.generales.concat(r.hallazgos);
    function unicos(campo) {
      return todos.map(function (p) { return p[campo]; }).filter(function (v, i, a) { return a.indexOf(v) === i; }).sort(function (a, b) { return a.localeCompare(b, 'es'); });
    }
    var hojas = unicos('hoja'), tipos = unicos('tipo');
    if (hojas.indexOf(estado.hoja) < 0) estado.hoja = '';
    if (tipos.indexOf(estado.tipo) < 0) estado.tipo = '';
    llenarSelect($('filtroHoja'), hojas, estado.hoja, 'Todas las hojas');
    llenarSelect($('filtroTipo'), tipos, estado.tipo, 'Todos los problemas');
    pintarLateral();
    pintarPuntos();
  }

  function generarExcel() {
    var hoy = new Date();
    var bytes = Excel.escribir(Correcciones.armar(estado.resultado, hoy.toLocaleDateString('es-CO', { day: 'numeric', month: 'long', year: 'numeric' })));
    var url = URL.createObjectURL(new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
    var a = document.createElement('a');
    var mes = String(hoy.getMonth() + 1).padStart(2, '0'), dia = String(hoy.getDate()).padStart(2, '0');
    a.href = url;
    a.download = 'Correcciones_' + hoy.getFullYear() + '-' + mes + '-' + dia + '.xlsx';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
    aviso('Listo: el Excel de correcciones quedó en tus descargas.');
  }

  function filtrar() { estado.mostrar = POR_PAGINA; pintarLateral(); pintarPuntos(); }

  $('selector').addEventListener('change', function (e) { if (e.target.files.length) agregarArchivos(e.target.files); e.target.value = ''; });
  $('btnRevisar').addEventListener('click', procesar);
  $('btnExcel').addEventListener('click', generarExcel);
  $('btnMas').addEventListener('click', function () { estado.mostrar += POR_PAGINA; pintarPuntos(); });
  $('btnLimpiar').addEventListener('click', function () { estado.empresas = {}; filtrar(); });
  $('filtroHoja').addEventListener('change', function (e) { estado.hoja = e.target.value; filtrar(); });
  $('filtroTipo').addEventListener('change', function (e) { estado.tipo = e.target.value; filtrar(); });
  $('chips').addEventListener('click', function (e) {
    var b = e.target.closest('.chip');
    if (!b) return;
    estado.prioridad = b.getAttribute('data-p');
    Array.prototype.forEach.call(this.children, function (c) { c.classList.toggle('on', c === b); });
    filtrar();
  });
  $('listaEmpresas').addEventListener('click', function (e) {
    var b = e.target.closest('[data-empresa]');
    if (!b) return;
    var n = b.getAttribute('data-empresa');
    if (estado.empresas[n]) delete estado.empresas[n]; else estado.empresas[n] = true;
    filtrar();
  });
  $('listaArchivos').addEventListener('click', function (e) {
    var q = e.target.closest('[data-quitar]');
    if (q) {
      var n = q.getAttribute('data-quitar');
      estado.archivos = estado.archivos.filter(function (a) { return a.name !== n; });
      if (estado.soloArchivo === n) estado.soloArchivo = '';
      estado.resultado = estado.anterior = null;
      if (estado.archivos.length) procesar(); else { pintar(); aviso(''); }
      return;
    }
    var b = e.target.closest('[data-archivo]');
    if (b) {
      var a = b.getAttribute('data-archivo');
      estado.soloArchivo = estado.soloArchivo === a ? '' : a;
      filtrar();
    }
  });
  $('puntos').addEventListener('click', function (e) {
    var b = e.target.closest('[data-copiar]');
    if (!b) return;
    var texto = Auditoria.compactarFilas(estado.lista[Number(b.getAttribute('data-copiar'))].filas);
    function hecho() { b.textContent = 'Copiado'; setTimeout(function () { b.textContent = 'Copiar filas'; }, 1500); }
    if (navigator.clipboard) navigator.clipboard.writeText(texto).then(hecho, function () { aviso('No se pudo copiar. Filas: ' + texto.slice(0, 300)); });
    else aviso('Filas: ' + texto.slice(0, 300));
  });

  var capas = 0;
  window.addEventListener('dragenter', function (e) { e.preventDefault(); capas++; $('velo').hidden = false; });
  window.addEventListener('dragover', function (e) { e.preventDefault(); });
  window.addEventListener('dragleave', function () { if (--capas <= 0) { capas = 0; $('velo').hidden = true; } });
  window.addEventListener('drop', function (e) {
    e.preventDefault();
    capas = 0;
    $('velo').hidden = true;
    if (e.dataTransfer.files.length) agregarArchivos(e.dataTransfer.files);
  });

  pintar();
})();
