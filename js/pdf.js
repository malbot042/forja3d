// Generador mínimo de PDF (una página A4 con un título, un subtítulo y una imagen JPEG).
// Sin dependencias: escribe los objetos PDF a mano.

const A4 = [595.28, 841.89]; // puntos

/** Texto → bytes WinAnsi (Latin-1) escapados para un literal PDF. */
function pdfText(str) {
  let out = '';
  for (const ch of String(str)) {
    let c = ch.codePointAt(0);
    if (ch === '€') c = 0x80;
    else if (ch === '—' || ch === '–') c = 0x96;
    else if (c > 0xff) c = 0x3f; // '?'
    const s = String.fromCharCode(c);
    out += s === '(' || s === ')' || s === '\\' ? '\\' + s : s;
  }
  return out;
}

const enc = str => {
  const b = new Uint8Array(str.length);
  for (let i = 0; i < str.length; i++) b[i] = str.charCodeAt(i) & 0xff;
  return b;
};

/**
 * @param {object} o
 * @param {Uint8Array} o.jpeg   bytes JPEG
 * @param {number} o.width      ancho en píxeles de la imagen
 * @param {number} o.height     alto en píxeles de la imagen
 * @param {'auto'|'landscape'|'portrait'} [o.orientation]
 * @param {string} [o.title]
 * @param {string} [o.subtitle]
 * @returns {Uint8Array}
 */
export function makePdf({ jpeg, width, height, orientation = 'auto', title = '', subtitle = '' }) {
  const landscape = orientation === 'landscape' || (orientation === 'auto' && width >= height);
  const [PW, PH] = landscape ? [A4[1], A4[0]] : A4;
  const M = 36;
  const header = (title ? 26 : 0) + (subtitle ? 16 : 0) + (title || subtitle ? 10 : 0);
  const boxW = PW - 2 * M, boxH = PH - 2 * M - header;
  const k = Math.min(boxW / width, boxH / height);
  const iw = width * k, ih = height * k;
  const ix = (PW - iw) / 2, iy = M + (boxH - ih) / 2;

  let content = '';
  let y = PH - M;
  if (title) { y -= 18; content += `BT /F2 16 Tf ${M} ${y.toFixed(2)} Td (${pdfText(title)}) Tj ET\n`; y -= 8; }
  if (subtitle) { y -= 12; content += `0.4 0.42 0.46 rg BT /F1 10 Tf ${M} ${y.toFixed(2)} Td (${pdfText(subtitle)}) Tj ET 0 0 0 rg\n`; }
  content += `q ${iw.toFixed(2)} 0 0 ${ih.toFixed(2)} ${ix.toFixed(2)} ${iy.toFixed(2)} cm /Im0 Do Q\n`;

  const chunks = [];
  const offsets = [];
  let pos = 0;
  const push = b => { chunks.push(b); pos += b.length; };
  const obj = (n, body, stream) => {
    offsets[n] = pos;
    push(enc(`${n} 0 obj\n${body}\n`));
    if (stream) { push(enc('stream\n')); push(stream); push(enc('\nendstream\n')); }
    push(enc('endobj\n'));
  };

  push(enc('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n'));
  obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
  obj(2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
  obj(3, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PW.toFixed(2)} ${PH.toFixed(2)}] ` +
    '/Resources << /Font << /F1 5 0 R /F2 6 0 R >> /XObject << /Im0 7 0 R >> >> /Contents 4 0 R >>');
  const cbytes = enc(content);
  obj(4, `<< /Length ${cbytes.length} >>`, cbytes);
  obj(5, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  obj(6, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
  obj(7, `<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /DeviceRGB ` +
    `/BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>`, jpeg);
  const n = 8;
  offsets[n] = pos;
  const date = new Date();
  const d = `D:${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}` +
    `${String(date.getHours()).padStart(2, '0')}${String(date.getMinutes()).padStart(2, '0')}00`;
  push(enc(`${n} 0 obj\n<< /Title (${pdfText(title)}) /Producer (Forja 3D) /CreationDate (${d}) >>\nendobj\n`));
  const xref = pos;
  let x = `xref\n0 ${n + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= n; i++) x += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  x += `trailer\n<< /Size ${n + 1} /Root 1 0 R /Info ${n} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  push(enc(x));

  const out = new Uint8Array(pos);
  let o = 0;
  for (const c of chunks) { out.set(c, o); o += c.length; }
  return out;
}

/**
 * PDF vectorial de una o varias páginas (para imprimir las hojas del plano a escala real).
 * @param {object} o
 * @param {number} [o.width]   ancho de la página en puntos (una sola página)
 * @param {number} [o.height]  alto de la página en puntos
 * @param {string} [o.content] flujo de contenido PDF (operadores de trazado; /F1 = Helvetica)
 * @param {{width:number,height:number,content:string}[]} [o.pages] varias páginas, cada una con su tamaño
 * @param {string} [o.title]
 */
export function makeVectorPdf({ width, height, content, pages, title = '' }) {
  pages = pages?.length ? pages : [{ width, height, content }];
  const chunks = [];
  const offsets = [];
  let pos = 0;
  const push = b => { chunks.push(b); pos += b.length; };
  const obj = (n, body, stream) => {
    offsets[n] = pos;
    push(enc(`${n} 0 obj\n${body}\n`));
    if (stream) { push(enc('stream\n')); push(stream); push(enc('\nendstream\n')); }
    push(enc('endobj\n'));
  };
  // 1 catálogo · 2 páginas · 3 fuente · 4 info · 5.. página y contenido por parejas
  const n = pages.length, pageObj = i => 5 + 2 * i;
  push(enc('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n'));
  obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
  obj(2, `<< /Type /Pages /Kids [${pages.map((_, i) => `${pageObj(i)} 0 R`).join(' ')}] /Count ${n} >>`);
  obj(3, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  obj(4, `<< /Title (${pdfText(title)}) /Producer (Forja 3D) >>`);
  pages.forEach((pg, i) => {
    obj(pageObj(i), `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pg.width.toFixed(2)} ${pg.height.toFixed(2)}] /Resources << /Font << /F1 3 0 R >> >> /Contents ${pageObj(i) + 1} 0 R >>`);
    const cbytes = enc(pg.content);
    obj(pageObj(i) + 1, `<< /Length ${cbytes.length} >>`, cbytes);
  });
  const total = 5 + 2 * n;
  const xref = pos;
  let x = `xref\n0 ${total}\n0000000000 65535 f \n`;
  for (let i = 1; i < total; i++) x += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  x += `trailer\n<< /Size ${total} /Root 1 0 R /Info 4 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  push(enc(x));
  const out = new Uint8Array(pos);
  let o = 0;
  for (const c of chunks) { out.set(c, o); o += c.length; }
  return out;
}

export { pdfText };
