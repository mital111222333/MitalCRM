// XL: real .xlsx files written in the browser, no libraries.
// Why not CSV: Excel with Russian settings expects a comma in numbers, so «3267.58» from a CSV became text (no totals),
// «31.8» became the date «31.авг», «6.46» became «июн.46» and phones turned into 9,99E+11.
// Here every number is a real number, dates are real dates, phones stay text, and each sheet is an Excel
// «Format as Table» table (blue header, banded rows, filters) with an optional totals row (SUBTOTAL, so it follows the filters).
const XL = {};
XL.esc = s => String(s).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
XL.col = i => { let s = ''; i++; while (i > 0) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; };
// 'YYYY-MM-DD' or 'DD.MM.YYYY' → Excel serial day number
XL.serial = d => {
  if (d instanceof Date) return Math.round((Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) - Date.UTC(1899, 11, 30)) / 864e5);
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(d); if (m) return Math.round((Date.UTC(+m[1], m[2] - 1, +m[3]) - Date.UTC(1899, 11, 30)) / 864e5);
  m = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(d); if (m) return Math.round((Date.UTC(+m[3], m[2] - 1, +m[1]) - Date.UTC(1899, 11, 30)) / 864e5);
  return null;
};
// style ids in styles.xml: 0 text, 1 money, 2 date, 3 integer
XL.ST = { s: 0, m: 1, d: 2, i: 3 };
XL.styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="2"><numFmt numFmtId="164" formatCode="#,##0.00;\\-#,##0.00;0"/><numFmt numFmtId="165" formatCode="dd\\.mm\\.yyyy"/></numFmts>
<fonts count="1"><font><sz val="11"/><color theme="1"/><name val="Calibri"/><family val="2"/><scheme val="minor"/></font></fonts>
<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>
<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="4"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="1" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs>
<cellStyles count="1"><cellStyle name="Обычный" xfId="0" builtinId="0"/></cellStyles>
<dxfs count="0"/><tableStyles count="0" defaultTableStyle="TableStyleMedium2" defaultPivotStyle="PivotStyleLight16"/>
</styleSheet>`;
// a stored (uncompressed) zip
XL.crcT = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
XL.crc = b => { let c = 0xFFFFFFFF; for (let i = 0; i < b.length; i++) c = XL.crcT[(c ^ b[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
XL.zip = files => {
  const te = new TextEncoder(), parts = [], cent = []; let off = 0;
  for (const [name, text] of files) {
    const nb = te.encode(name), db = te.encode(text), crc = XL.crc(db);
    const h = new DataView(new ArrayBuffer(30)); h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true); h.setUint16(8, 0, true); h.setUint32(14, crc, true); h.setUint32(18, db.length, true); h.setUint32(22, db.length, true); h.setUint16(26, nb.length, true);
    parts.push(new Uint8Array(h.buffer), nb, db);
    const c = new DataView(new ArrayBuffer(46)); c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true); c.setUint32(16, crc, true); c.setUint32(20, db.length, true); c.setUint32(24, db.length, true); c.setUint16(28, nb.length, true); c.setUint32(42, off, true);
    cent.push(new Uint8Array(c.buffer), nb); off += 30 + nb.length + db.length;
  }
  const csize = cent.reduce((a, b) => a + b.length, 0), e = new DataView(new ArrayBuffer(22));
  e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true); e.setUint32(12, csize, true); e.setUint32(16, off, true);
  return new Blob([...parts, ...cent, new Uint8Array(e.buffer)], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
};
// sheets: [{ name, cols: [{ h, w, t: 's'|'m'|'i'|'d', total: 'sum'|'label' }], rows: [[...]], totals: bool }]
XL.book = sheets => {
  const shared = [], sIdx = new Map(), str = s => { s = String(s); if (!sIdx.has(s)) { sIdx.set(s, shared.length); shared.push(s); } return sIdx.get(s); };
  const files = [], usedNames = new Set();
  sheets.forEach((sh, si) => {
    const n = si + 1, C = sh.cols, last = XL.col(C.length - 1);
    let name = String(sh.name || 'Лист' + n).replace(/[\[\]:*?/\\]/g, '-').slice(0, 31) || 'Лист' + n; while (usedNames.has(name)) name = name.slice(0, 28) + '_' + n; usedNames.add(name); sh.sheetName = name;
    // table column names must be unique and not empty
    const seen = new Set(), heads = C.map((c, i) => { let h = String(c.h ?? '').trim() || 'Столбец' + (i + 1), b = h, k = 2; while (seen.has(h.toLowerCase())) h = b + k++; seen.add(h.toLowerCase()); return h; });
    const R = sh.rows, first = 2, lastData = 1 + Math.max(R.length, 1), tot = !!sh.totals, tRow = lastData + 1;
    const xml = [`<row r="1">` + heads.map((h, i) => `<c r="${XL.col(i)}1" t="s"><v>${str(h)}</v></c>`).join('') + `</row>`];
    if (!R.length) xml.push(`<row r="2"/>`);
    R.forEach((row, ri) => {
      const r = ri + first;
      xml.push(`<row r="${r}">` + C.map((c, i) => {
        const v = row[i], ref = XL.col(i) + r; if (v === null || v === undefined || v === '') return '';
        if (typeof v === 'number' && Number.isFinite(v)) return `<c r="${ref}" s="${c.t === 'i' ? 3 : c.t === 'd' ? 2 : c.t === 's' ? 0 : 1}"><v>${v}</v></c>`;
        if (c.t === 'd') { const k = XL.serial(v); if (k !== null) return `<c r="${ref}" s="2"><v>${k}</v></c>`; }
        return `<c r="${ref}" t="s"><v>${str(v)}</v></c>`;
      }).join('') + `</row>`);
    });
    const qn = h => h.replace(/['#\[\]]/g, "'$&"), tname = 'Таблица' + n;
    if (tot) xml.push(`<row r="${tRow}">` + C.map((c, i) => {
      const ref = XL.col(i) + tRow;
      if (c.total === 'sum') { const v = Math.round(R.reduce((a, row) => a + (typeof row[i] === 'number' ? row[i] : 0), 0) * 100) / 100; return `<c r="${ref}" s="${c.t === 'i' ? 3 : 1}"><f>SUBTOTAL(109,${tname}[${qn(heads[i])}])</f><v>${v}</v></c>`; }
      if (c.total === 'label') return `<c r="${ref}" t="s"><v>${str(c.label || 'Итог')}</v></c>`;
      return '';
    }).join('') + `</row>`);
    const ref = `A1:${last}${tot ? tRow : lastData}`;
    files.push([`xl/worksheets/sheet${n}.xml`, `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<dimension ref="${ref}"/><sheetViews><sheetView workbookViewId="0"${si ? '' : ' tabSelected="1"'}><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A2" sqref="A2"/></sheetView></sheetViews>
<sheetFormatPr defaultRowHeight="15"/><cols>${C.map((c, i) => `<col min="${i + 1}" max="${i + 1}" width="${c.w || 12}" customWidth="1"/>`).join('')}</cols>
<sheetData>${xml.join('')}</sheetData><pageMargins left="0.7" right="0.7" top="0.75" bottom="0.75" header="0.3" footer="0.3"/><tableParts count="1"><tablePart r:id="rId1"/></tableParts></worksheet>`]);
    files.push([`xl/worksheets/_rels/sheet${n}.xml.rels`, `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/table" Target="../tables/table${n}.xml"/></Relationships>`]);
    files.push([`xl/tables/table${n}.xml`, `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<table xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" id="${n}" name="${tname}" displayName="${tname}" ref="${ref}"${tot ? ' totalsRowCount="1"' : ' totalsRowShown="0"'}><autoFilter ref="A1:${last}${lastData}"/>
<tableColumns count="${C.length}">${C.map((c, i) => `<tableColumn id="${i + 1}" name="${XL.esc(heads[i])}"${tot && c.total === 'sum' ? ' totalsRowFunction="sum"' : tot && c.total === 'label' ? ` totalsRowLabel="${XL.esc(c.label || 'Итог')}"` : ''}/>`).join('')}</tableColumns>
<tableStyleInfo name="${sh.style || 'TableStyleMedium2'}" showFirstColumn="0" showLastColumn="0" showRowStripes="1" showColumnStripes="0"/></table>`]);
  });
  const N = sheets.length, ov = [];
  for (let n = 1; n <= N; n++) ov.push(`<Override PartName="/xl/worksheets/sheet${n}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/tables/table${n}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.table+xml"/>`);
  files.unshift(
    ['[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${ov.join('')}<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/></Types>`],
    ['_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`],
    ['xl/workbook.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><bookViews><workbookView/></bookViews><sheets>${sheets.map((s, i) => `<sheet name="${XL.esc(s.sheetName)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets><calcPr calcId="191029" fullCalcOnLoad="1"/></workbook>`],
    ['xl/_rels/workbook.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((s, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${N + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rId${N + 2}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/></Relationships>`],
    ['xl/styles.xml', XL.styles]);
  files.push(['xl/sharedStrings.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${shared.length}" uniqueCount="${shared.length}">${shared.map(s => `<si><t xml:space="preserve">${XL.esc(s)}</t></si>`).join('')}</sst>`]);
  return XL.zip(files);
};
XL.save = (filename, blob) => {
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = filename; document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
};
XL.download = (filename, sheets) => XL.save(String(filename).replace(/\.(csv|xlsx)$/i, '') + '.xlsx', XL.book(Array.isArray(sheets) ? sheets : [sheets]));
// any table [[header…], [row…]…] → .xlsx; each column's type is guessed from its values (numbers stay numbers, the rest is text)
XL.fromRows = (filename, rows, name) => {
  const [head = [], ...body] = rows;
  const cols = head.map((h, i) => {
    const vals = body.map(r => r[i]).filter(v => v !== '' && v !== null && v !== undefined);
    const num = vals.length && vals.every(v => typeof v === 'number' && Number.isFinite(v));
    const len = Math.max(String(h).length + 3, ...vals.slice(0, 300).map(v => String(v).length));
    return { h, t: num ? (vals.every(Number.isInteger) ? 'i' : 'm') : 's', w: Math.min(45, Math.max(8, len + 2)) };
  });
  XL.download(filename, { name: name || String(filename).replace(/\.(csv|xlsx)$/i, ''), cols, rows: body });
};
