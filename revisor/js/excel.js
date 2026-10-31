// Lee y escribe archivos .xlsx sin librerías externas. Todo ocurre en el navegador.
// Un .xlsx es un .zip con archivos XML adentro: aquí se abre ese zip y se leen los XML.
var Excel = (function () {
  var ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

  function desescapar(s) {
    if (s.indexOf('&') < 0) return s;
    return s.replace(/&(#x?[0-9a-fA-F]+|\w+);/g, function (m, c) {
      if (c[0] !== '#') return ENT[c] !== undefined ? ENT[c] : m;
      var n = c[1] === 'x' ? parseInt(c.slice(2), 16) : parseInt(c.slice(1), 10);
      return String.fromCodePoint(n);
    });
  }

  function escapar(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    }).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
  }

  function letraAIndice(letras) {
    var n = 0;
    for (var i = 0; i < letras.length; i++) n = n * 26 + letras.charCodeAt(i) - 64;
    return n - 1;
  }

  function indiceALetra(i) {
    var s = '';
    for (i = i + 1; i > 0; i = Math.floor((i - 1) / 26)) s = String.fromCharCode(65 + (i - 1) % 26) + s;
    return s;
  }

  function atributo(attrs, nombre) {
    var m = new RegExp('(?:^|\\s)' + nombre + '="([^"]*)"').exec(attrs);
    return m ? desescapar(m[1]) : null;
  }

  function textoDe(xml) {
    var limpio = xml.replace(/<rPh\b[\s\S]*?<\/rPh>/g, '');
    var re = /<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g, m, out = '';
    while ((m = re.exec(limpio))) out += m[1];
    return desescapar(out);
  }

  function leerCompartidos(xml) {
    if (!xml) return [];
    var re = /<si>([\s\S]*?)<\/si>|<si\s*\/>/g, m, out = [];
    while ((m = re.exec(xml))) out.push(m[1] ? textoDe(m[1]) : '');
    return out;
  }

  // Devuelve [{fila, celdas}], donde celdas[índice de columna] es texto o número.
  function leerHoja(xml, compartidos) {
    var filas = [], reFila = /<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g, mf, siguiente = 1;
    while ((mf = reFila.exec(xml))) {
      var num = parseInt(atributo(mf[1], 'r'), 10) || siguiente;
      siguiente = num + 1;
      if (!mf[2]) continue;
      var celdas = [], reC = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g, mc, col = 0;
      while ((mc = reC.exec(mf[2]))) {
        var ref = atributo(mc[1], 'r');
        if (ref) col = letraAIndice(ref.replace(/\d+/g, ''));
        var cuerpo = mc[2];
        if (cuerpo) {
          var t = atributo(mc[1], 't'), mv = /<v(?:\s[^>]*)?>([\s\S]*?)<\/v>/.exec(cuerpo), v = null;
          if (t === 'inlineStr') v = textoDe(cuerpo);
          else if (mv && t === 's') v = compartidos[parseInt(mv[1], 10)];
          else if (mv && (t === 'str' || t === 'e')) v = desescapar(mv[1]);
          else if (mv && t === 'b') v = mv[1] === '1' ? 'VERDADERO' : 'FALSO';
          else if (mv) { v = Number(mv[1]); if (isNaN(v)) v = desescapar(mv[1]); }
          if (v !== null && v !== undefined && v !== '') celdas[col] = v;
        }
        col++;
      }
      if (celdas.length) filas.push({ fila: num, celdas: celdas });
    }
    return filas;
  }

  // Arma el libro a partir de los XML ya extraídos del zip.
  function armarLibro(partes) {
    var compartidos = leerCompartidos(partes('xl/sharedStrings.xml'));
    var wb = partes('xl/workbook.xml'), rels = partes('xl/_rels/workbook.xml.rels');
    if (!wb || !rels) throw new Error('El archivo no tiene la estructura de un Excel.');
    var destinos = {}, m, reRel = /<Relationship\b([^>]*?)\/?>/g;
    while ((m = reRel.exec(rels))) destinos[atributo(m[1], 'Id')] = atributo(m[1], 'Target');
    var hojas = [], reSheet = /<sheet\b([^>]*?)\/?>/g;
    while ((m = reSheet.exec(wb))) {
      var destino = destinos[atributo(m[1], 'r:id')];
      if (!destino) continue;
      var ruta = destino[0] === '/' ? destino.slice(1) : 'xl/' + destino;
      var xml = partes(ruta);
      hojas.push({ nombre: atributo(m[1], 'name'), filas: xml ? leerHoja(xml, compartidos) : [] });
    }
    return { base1904: /date1904="(1|true)"/.test(wb), hojas: hojas };
  }

  function leerEntradasZip(u8) {
    var dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength), fin = -1;
    for (var i = u8.length - 22; i >= 0 && i > u8.length - 66000; i--) {
      if (dv.getUint32(i, true) === 0x06054b50) { fin = i; break; }
    }
    if (fin < 0) throw new Error('El archivo no es un Excel .xlsx válido.');
    var total = dv.getUint16(fin + 10, true), p = dv.getUint32(fin + 16, true), out = {};
    var dec = new TextDecoder();
    for (var n = 0; n < total; n++) {
      var metodo = dv.getUint16(p + 10, true), tam = dv.getUint32(p + 20, true);
      var lnom = dv.getUint16(p + 28, true), lext = dv.getUint16(p + 30, true), lcom = dv.getUint16(p + 32, true);
      var local = dv.getUint32(p + 42, true);
      var nombre = dec.decode(u8.subarray(p + 46, p + 46 + lnom));
      var inicio = local + 30 + dv.getUint16(local + 26, true) + dv.getUint16(local + 28, true);
      out[nombre] = { metodo: metodo, datos: u8.subarray(inicio, inicio + tam) };
      p += 46 + lnom + lext + lcom;
    }
    return out;
  }

  async function descomprimir(e) {
    if (e.metodo === 0) return e.datos;
    var flujo = new Blob([e.datos]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return new Uint8Array(await new Response(flujo).arrayBuffer());
  }

  async function leer(arrayBuffer) {
    var u8 = new Uint8Array(arrayBuffer);
    if (u8[0] === 0xD0 && u8[1] === 0xCF) throw new Error('Es un .xls antiguo o tiene contraseña. Guárdalo como .xlsx sin contraseña.');
    if (u8[0] !== 0x50 || u8[1] !== 0x4B) throw new Error('El archivo no es un Excel .xlsx válido.');
    var entradas = leerEntradasZip(u8), textos = {}, dec = new TextDecoder();
    for (var nombre in entradas) {
      if (/\.(xml|rels)$/.test(nombre) && /^xl\//.test(nombre) && !/drawings|theme|styles/.test(nombre)) {
        textos[nombre] = dec.decode(await descomprimir(entradas[nombre]));
      }
    }
    return armarLibro(function (r) { return textos[r]; });
  }

  // ---------- Escritura ----------
  var TABLA_CRC = (function () {
    var t = [];
    for (var n = 0; n < 256; n++) {
      var c = n;
      for (var k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })();

  function crc32(u8) {
    var c = 0xFFFFFFFF;
    for (var i = 0; i < u8.length; i++) c = TABLA_CRC[(c ^ u8[i]) & 255] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }

  function crearZip(archivos) {
    var enc = new TextEncoder(), trozos = [], central = [], pos = 0;
    function u16(v) { return [v & 255, v >>> 8 & 255]; }
    function u32(v) { return [v & 255, v >>> 8 & 255, v >>> 16 & 255, v >>> 24 & 255]; }
    archivos.forEach(function (a) {
      var nombre = enc.encode(a.ruta), datos = enc.encode(a.xml), crc = crc32(datos);
      var comun = [].concat(u16(20), u16(0x0800), u16(0), u16(0), u16(0x5A21), u32(crc), u32(datos.length), u32(datos.length), u16(nombre.length), u16(0));
      var cab = new Uint8Array([0x50, 0x4B, 3, 4].concat(comun));
      trozos.push(cab, nombre, datos);
      central.push({ cab: new Uint8Array([0x50, 0x4B, 1, 2].concat(u16(20), comun, u16(0), u16(0), u16(0), u32(0), u32(pos))), nombre: nombre });
      pos += cab.length + nombre.length + datos.length;
    });
    var inicioCentral = pos, tamCentral = 0;
    central.forEach(function (c) { trozos.push(c.cab, c.nombre); tamCentral += c.cab.length + c.nombre.length; });
    trozos.push(new Uint8Array([0x50, 0x4B, 5, 6, 0, 0, 0, 0].concat(u16(archivos.length), u16(archivos.length), u32(tamCentral), u32(inicioCentral), u16(0))));
    var total = trozos.reduce(function (s, t) { return s + t.length; }, 0), out = new Uint8Array(total), p = 0;
    trozos.forEach(function (t) { out.set(t, p); p += t.length; });
    return out;
  }

  // Estilos: 0 normal, 1 encabezado, 2 texto ajustado, 3 alta, 4 media, 5 título, 6 subtítulo, 7 número grande, 8 celda amarilla
  var ESTILOS = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    '<fonts count="6"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FFA93226"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FFB9770E"/><name val="Calibri"/></font><font><b/><sz val="18"/><color rgb="FF0D2B5E"/><name val="Calibri"/></font><font><b/><sz val="20"/><color rgb="FF1F5FBF"/><name val="Calibri"/></font></fonts>' +
    '<fills count="4"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF0D2B5E"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFFFF2CC"/></patternFill></fill></fills>' +
    '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
    '<cellXfs count="9"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
    '<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>' +
    '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>' +
    '<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment vertical="top"/></xf>' +
    '<xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment vertical="top"/></xf>' +
    '<xf numFmtId="0" fontId="4" fillId="0" borderId="0" xfId="0" applyFont="1"/>' +
    '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment wrapText="1"/></xf>' +
    '<xf numFmtId="3" fontId="5" fillId="0" borderId="0" xfId="0" applyFont="1" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="left"/></xf>' +
    '<xf numFmtId="0" fontId="0" fillId="3" borderId="0" xfId="0" applyFill="1"/></cellXfs></styleSheet>';

  function celdaXml(valor, col, fila) {
    var c = valor !== null && typeof valor === 'object' ? valor : { v: valor };
    var ref = indiceALetra(col) + fila, s = c.s ? ' s="' + c.s + '"' : '';
    if (c.f) return '<c r="' + ref + '"' + s + '><f>' + escapar(c.f) + '</f><v>' + escapar(c.v) + '</v></c>';
    if (c.v === null || c.v === undefined || c.v === '') return c.s ? '<c r="' + ref + '"' + s + '/>' : '';
    if (typeof c.v === 'number') return '<c r="' + ref + '"' + s + '><v>' + c.v + '</v></c>';
    return '<c r="' + ref + '"' + s + ' t="inlineStr"><is><t xml:space="preserve">' + escapar(c.v) + '</t></is></c>';
  }

  function hojaXml(h) {
    var x = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">';
    x += '<sheetViews><sheetView workbookViewId="0"' + (h.sinCuadricula ? ' showGridLines="0"' : '') + '>';
    if (h.congelarFila) x += '<pane ySplit="' + h.congelarFila + '" topLeftCell="A' + (h.congelarFila + 1) + '" activePane="bottomLeft" state="frozen"/>';
    x += '</sheetView></sheetViews>';
    if (h.anchos) x += '<cols>' + h.anchos.map(function (a, i) { return '<col min="' + (i + 1) + '" max="' + (i + 1) + '" width="' + a + '" customWidth="1"/>'; }).join('') + '</cols>';
    x += '<sheetData>' + h.filas.map(function (f, i) {
      return f && f.length ? '<row r="' + (i + 1) + '">' + f.map(function (v, c) { return celdaXml(v, c, i + 1); }).join('') + '</row>' : '';
    }).join('') + '</sheetData>';
    if (h.filtro) x += '<autoFilter ref="' + h.filtro + '"/>';
    if (h.validacion) x += '<dataValidations count="1"><dataValidation type="list" allowBlank="1" sqref="' + h.validacion.rango + '"><formula1>"' + h.validacion.opciones + '"</formula1></dataValidation></dataValidations>';
    return x + '</worksheet>';
  }

  // hojas: [{nombre, filas:[[valor|{v,s,f}]], anchos, filtro, congelarFila, validacion, sinCuadricula}]
  function escribir(hojas) {
    var ns = 'http://schemas.openxmlformats.org/', hoja = 'application/vnd.openxmlformats-officedocument.spreadsheetml.';
    var cab = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
    var filtros = hojas.map(function (h, i) {
      return h.filtro ? '<definedName name="_xlnm._FilterDatabase" localSheetId="' + i + '" hidden="1">\'' + h.nombre + '\'!' + h.filtro.replace(/([A-Z]+)(\d+)/g, '$$$1$$$2') + '</definedName>' : '';
    }).join('');
    var archivos = [
      { ruta: '[Content_Types].xml', xml: cab + '<Types xmlns="' + ns + 'package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="' + hoja + 'sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="' + hoja + 'styles+xml"/>' + hojas.map(function (h, i) { return '<Override PartName="/xl/worksheets/sheet' + (i + 1) + '.xml" ContentType="' + hoja + 'worksheet+xml"/>'; }).join('') + '</Types>' },
      { ruta: '_rels/.rels', xml: cab + '<Relationships xmlns="' + ns + 'package/2006/relationships"><Relationship Id="rId1" Type="' + ns + 'officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>' },
      { ruta: 'xl/workbook.xml', xml: cab + '<workbook xmlns="' + ns + 'spreadsheetml/2006/main" xmlns:r="' + ns + 'officeDocument/2006/relationships"><sheets>' + hojas.map(function (h, i) { return '<sheet name="' + escapar(h.nombre) + '" sheetId="' + (i + 1) + '" r:id="rId' + (i + 1) + '"/>'; }).join('') + '</sheets>' + (filtros ? '<definedNames>' + filtros + '</definedNames>' : '') + '<calcPr fullCalcOnLoad="1"/></workbook>' },
      { ruta: 'xl/_rels/workbook.xml.rels', xml: cab + '<Relationships xmlns="' + ns + 'package/2006/relationships">' + hojas.map(function (h, i) { return '<Relationship Id="rId' + (i + 1) + '" Type="' + ns + 'officeDocument/2006/relationships/worksheet" Target="worksheets/sheet' + (i + 1) + '.xml"/>'; }).join('') + '<Relationship Id="rId' + (hojas.length + 1) + '" Type="' + ns + 'officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>' },
      { ruta: 'xl/styles.xml', xml: ESTILOS }
    ];
    hojas.forEach(function (h, i) { archivos.push({ ruta: 'xl/worksheets/sheet' + (i + 1) + '.xml', xml: hojaXml(h) }); });
    return crearZip(archivos);
  }

  return { leer: leer, armarLibro: armarLibro, escribir: escribir, indiceALetra: indiceALetra };
})();
