// Editor 2D tipo CAD para Forja 3D.
// · Entidades: línea, polilínea (rectángulo), círculo, arco, texto y cotas (lineal, alineada, radio, diámetro, angular).
// · Referencias a objetos (final, medio, centro, cuadrante, intersección, cercano), orto y forzado a rejilla.
// · Línea de órdenes al estilo AutoCAD: alias (L, C, REC, M…), coordenadas absolutas (x,y), relativas (@x,y),
//   polares (d<ángulo) y distancia directa.
// · Edición: desplazar, copiar, girar, escala, simetría, desfase, recortar, descomponer, borrar y pinzamientos.
// · Capas con color y tipo de línea, deshacer/rehacer, DXF (exportar/importar) y SVG.
// Cada panel 2D es una CadView con su propio encuadre que dibuja el mismo plano (Cad).
import { cssVar } from './theme.js';
import { makeVectorPdf, pdfText } from './pdf.js';

const TAU = Math.PI * 2;
const DEG = 180 / Math.PI;
const FONT = '"Inter", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
const FS = 1.38;   // tamaño de fuente / altura de mayúsculas

// =================================================================== vectores
const add = (a, b) => [a[0] + b[0], a[1] + b[1]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
const mul = (a, s) => [a[0] * s, a[1] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1];
const len = a => Math.hypot(a[0], a[1]);
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const norm = a => { const l = len(a) || 1; return [a[0] / l, a[1] / l]; };
const perp = a => [-a[1], a[0]];
const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
const angOf = (a, b) => Math.atan2(b[1] - a[1], b[0] - a[0]);
const polar = (p, d, a) => [p[0] + Math.cos(a) * d, p[1] + Math.sin(a) * d];
const normA = a => ((a % TAU) + TAU) % TAU;
const sweepOf = (a0, a1) => { const s = normA(a1 - a0); return s < 1e-12 ? TAU : s; };
const inSweep = (t, a0, a1) => normA(t - a0) <= sweepOf(a0, a1) + 1e-9;
const signedA = a => { const n = normA(a); return n > Math.PI ? n - TAU : n; };
const flips = r => { const n = normA(r); return n > Math.PI / 2 + 1e-6 && n <= 1.5 * Math.PI + 1e-6; };
const rnd = v => Math.round(v * 1e6) / 1e6;
const P = p => [rnd(p[0]), rnd(p[1])];
const eid = () => Math.random().toString(36).slice(2, 10);
const rotP = (q, c, a) => {
  const x = q[0] - c[0], y = q[1] - c[1], co = Math.cos(a), si = Math.sin(a);
  return [c[0] + x * co - y * si, c[1] + x * si + y * co];
};
const reflect = (q, a, b) => {
  const d = norm(sub(b, a)), v = sub(q, a);
  return sub(add(a, mul(d, 2 * dot(v, d))), v);
};

/** Número escrito por el usuario (acepta coma o punto decimal). */
export function parseNum(s) {
  const t = String(s).trim();
  if (!/^[-+]?(\d+([.,]\d*)?|[.,]\d+)$/.test(t)) return null;
  return parseFloat(t.replace(',', '.'));
}

// =================================================================== documento
export const UNITS = {
  mm: { label: 'Milímetros (mm)', mm: 1, dxf: 4, per3D: 100 },
  cm: { label: 'Centímetros (cm)', mm: 10, dxf: 5, per3D: 10 },
  m: { label: 'Metros (m)', mm: 1000, dxf: 6, per3D: 0.1 },
  in: { label: 'Pulgadas (in)', mm: 25.4, dxf: 1, per3D: 4 },
  u: { label: 'Sin unidades', mm: 1, dxf: 0, per3D: 100 },
};

export const LINETYPES = {
  continuous: { label: 'Continua', dash: [], dxf: 'CONTINUOUS' },
  dashed: { label: 'Trazos', dash: [9, 5], dxf: 'DASHED' },
  hidden: { label: 'Oculta', dash: [4, 3], dxf: 'HIDDEN' },
  center: { label: 'Eje', dash: [16, 4, 3, 4], dxf: 'CENTER' },
  dotted: { label: 'Puntos', dash: [0.1, 4], dxf: 'DOT' },
  pencil: { label: 'Lápiz (a mano alzada)', dash: [], dxf: 'CONTINUOUS', sketch: true },
};

// ------------------------------------------------------------------ hoja (papel)
/** Formatos UNE-EN ISO 216, en mm (vertical). */
export const PAPERS = { A5: [148, 210], A4: [210, 297], A3: [297, 420], A2: [420, 594], A1: [594, 841], A0: [841, 1189] };
export const PAPER_SCALES = ['10:1', '5:1', '2:1', '1:1', '1:2', '1:5', '1:10', '1:20', '1:50', '1:100', '1:200', '1:500', '1:1000'];
const PAPER_MARGIN = 10;   // mm del recuadro al borde

/**
 * La hoja en coordenadas del plano, o null si no hay hoja.
 * k = unidades del dibujo por mm de papel (con la escala: a 1:2, 1 mm de papel son 2 mm reales).
 */
export function sheetOf(D) {
  const P = D.paper;
  if (!P?.size || !PAPERS[P.size]) return null;
  let [w, h] = PAPERS[P.size];
  if (P.landscape !== false) [w, h] = [h, w];
  const [a, b] = String(P.scale || '1:1').split(':').map(Number);
  const k = (b / a) / (UNITS[D.units]?.mm || 1);
  const x0 = P.ox ?? -PAPER_MARGIN * k, y0 = P.oy ?? -PAPER_MARGIN * k;
  return { x0, y0, x1: x0 + w * k, y1: y0 + h * k, w, h, k, size: P.size, landscape: P.landscape !== false, scale: P.scale || '1:1' };
}

/** Campos editables del cajetín (los que quedan vacíos usan un valor automático o no se muestran). */
export const BLOCK_FIELDS = [
  ['title', 'Título'], ['description', 'Descripción'], ['author', 'Dibujado por'],
  ['company', 'Empresa / centro'], ['number', 'Nº de plano'], ['date', 'Fecha'],
];

/** Fecha del cajetín: la elegida (AAAA-MM-DD) en formato dd/mm/aaaa, o la de hoy si no hay ninguna. */
export function blockDate(v) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v || '');
  if (m) return `${m[3]}/${m[2]}/${m[1]}`;
  return v || new Date().toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

/** Parte un texto en líneas que caben en `maxW` (mm) con altura `h` (mm); respeta los saltos de línea. */
function wrapText(str, h, maxW, maxLines = 8) {
  const out = [];
  for (const para of String(str).split(/\r?\n/)) {
    let line = '';
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const t = line ? `${line} ${word}` : word;
      if (textWidth(t, h) <= maxW || !line) line = t;
      else { out.push(line); line = word; }
    }
    out.push(line);
  }
  while (out.length && !out[out.length - 1]) out.pop();
  if (out.length > maxLines) { out.length = maxLines; out[maxLines - 1] += ' …'; }
  return out;
}

/** Recuadro y cajetín activados (por separado). Planos antiguos: «frame» controlaba los dos. */
const paperFlags = P => ({ frame: P.frame !== false, block: P.block ?? (P.frame !== false) });

/** Rectángulo del cajetín en mm de papel { x, y, w, h } y su contenido, o null. */
function blockLayout(D, S, title, sheetNo = '') {
  const P = D.paper;
  if (!paperFlags(P).block) return null;
  const F = P.fields || {};
  const m = PAPER_MARGIN;
  const bw = Math.min(S.w >= 420 ? 180 : 120, S.w - 2 * m);
  const lab = 1.6, val = 2.5, pad = 1.5;
  const desc = F.description ? wrapText(F.description, val, bw - 2 * pad) : [];
  const rows = [
    { h: 9, cells: [['Escala', S.scale], ['Nº de plano', F.number || ''], ...(sheetNo ? [['Hoja', sheetNo]] : [])] },
    { h: 9, cells: [['Dibujado por', F.author || ''], ['Empresa / centro', F.company || ''], ['Fecha', blockDate(F.date)]] },
  ];
  if (desc.length) rows.push({ h: 2 * pad + lab + 1.2 + val + (desc.length - 1) * val * 1.55 + 1.2, cells: [['Descripción', desc]] });
  rows.push({ h: 11, cells: [['Título', F.title || title || 'Sin título']], big: true });
  const bh = rows.reduce((a, r) => a + r.h, 0);
  return { x: S.w - m - bw, y: m, w: bw, h: bh, rows, lab, val, pad };
}

/** Rectángulo del cajetín en coordenadas del plano (para editarlo con doble clic). */
export function sheetBlockRect(D) {
  const S = sheetOf(D);
  const L = S && blockLayout(D, S, '');
  return L ? [S.x0 + L.x * S.k, S.y0 + L.y * S.k, S.x0 + (L.x + L.w) * S.k, S.y0 + (L.y + L.h) * S.k] : null;
}

/** Recuadro y cajetín de la hoja como objetos del plano (sin id: no se seleccionan ni se exportan a DXF). */
export function sheetDecor(D, title = '', sheetNo = '') {
  const S = sheetOf(D);
  if (!S) return [];
  const { k } = S;
  const at = (mx, my) => [S.x0 + mx * k, S.y0 + my * k];
  const m = PAPER_MARGIN, W = S.w, H = S.h;
  const rect = (x, y, w, h, lw) => ({ type: 'pline', closed: true, pts: [at(x, y), at(x + w, y), at(x + w, y + h), at(x, y + h)], lw });
  const out = [];
  if (paperFlags(D.paper).frame) out.push(rect(m, m, W - 2 * m, H - 2 * m, 'thick'));
  const L = blockLayout(D, S, title, sheetNo);
  if (!L) return out;
  const txt = (mx, my, text, hmm) => ({ type: 'text', p: at(mx, my), text, h: hmm * k });
  out.push(rect(L.x, L.y, L.w, L.h, 'thick'));
  let y = L.y;
  L.rows.forEach((r, ri) => {
    if (ri) out.push({ type: 'line', a: at(L.x, y), b: at(L.x + L.w, y) });
    const cw = L.w / r.cells.length;
    r.cells.forEach(([label, value], ci) => {
      const x = L.x + ci * cw;
      if (ci) out.push({ type: 'line', a: at(x, y), b: at(x, y + r.h) });
      out.push(txt(x + L.pad, y + r.h - L.pad - L.lab, label, L.lab));
      const lines = Array.isArray(value) ? value : [value];
      const vh = r.big ? 3.5 : L.val;
      lines.forEach((line, li) => {
        if (!line) return;
        const vy = Array.isArray(value) ? y + r.h - L.pad - L.lab - 1.2 - vh - li * vh * 1.55 : y + L.pad + 0.3;
        // el texto que no cabe en la celda se acorta
        let t = String(line);
        while (t.length > 1 && textWidth(t, vh) > cw - 2 * L.pad) t = t.slice(0, -2) + '…';
        out.push(txt(x + L.pad, vy, t, vh));
      });
    });
    y += r.h;
  });
  return out;
}

/** Tipo de línea efectivo: el del objeto si lo tiene, si no el de su capa. */
export const ltOf = (e, L) => (e.lt && LINETYPES[e.lt] ? e.lt : L?.lt) || 'continuous';

// ---------------------------------------------------------- trazo «a mano alzada»
// Solo cambia el dibujo: la geometría sigue siendo exacta (rejilla, referencias, cotas).
// Es determinista (semilla = id del objeto) para que el trazo no «tiemble» al redibujar.
function hashStr(str) {
  let h = 2166136261;
  for (const ch of String(str)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
function rand1(seed, i) {
  let x = Math.imul(seed ^ Math.imul(i + 1, 0x9E3779B1), 0x85EBCA6B);
  x ^= x >>> 13; x = Math.imul(x, 0xC2B2AE35); x ^= x >>> 16;
  return (x >>> 0) / 4294967296 * 2 - 1;
}
function noise1(seed, t) {
  const i = Math.floor(t), f = t - i, u = f * f * (3 - 2 * f);
  return rand1(seed, i) * (1 - u) + rand1(seed, i + 1) * u;
}

/** Trazos base (en coordenadas del plano) de un objeto: cada tramo recto por separado, curvas muestreadas. */
function sketchBase(e, seed, step) {
  const curve = (c, r, a0, sw) => {
    const n = Math.max(12, Math.ceil(Math.abs(sw) * r / step));
    return Array.from({ length: n + 1 }, (_, k) => polar(c, r, a0 + sw * k / n));
  };
  switch (e.type) {
    case 'line': return [{ pts: [e.a, e.b], open: true }];
    case 'pline': {
      const out = [];
      const n = e.pts.length;
      for (let i = 0; i < n - 1 + (e.closed ? 1 : 0); i++) out.push({ pts: [e.pts[i], e.pts[(i + 1) % n]], open: true });
      return out;
    }
    case 'circle': {
      // un círculo a mano empieza en cualquier sitio y se cierra pasándose un poco
      const a0 = (rand1(seed, 99) + 1) * Math.PI;
      return [{ pts: curve(e.c, e.r, a0, TAU + 0.18 + 0.12 * rand1(seed, 98)), open: false }];
    }
    case 'arc': return [{ pts: curve(e.c, e.r, e.a0, sweepOf(e.a0, e.a1)), open: true }];
    case 'ellipse': {
      const r = Math.max(Math.hypot(...e.U), Math.hypot(...e.V));
      const n = Math.max(16, Math.ceil(TAU * r / step));
      return [{ pts: ellPts(e, n, (rand1(seed, 99) + 1) * Math.PI, TAU + 0.18 + 0.12 * rand1(seed, 98)), open: false }];
    }
    default: return [];
  }
}

/**
 * Convierte trazos (ya en el espacio de dibujo: píxeles o unidades del SVG) en dos pasadas
 * temblorosas, con los extremos rectos pasados de largo como al dibujar con lápiz.
 * opts: { amp: desviación, step: separación entre puntos, over: cuánto se pasa en los extremos }
 */
export function sketchStrokes(strokes, seed, { amp, step, over, bowMax = 0 }) {
  const out = [];
  strokes.forEach((s, si) => {
    if (s.pts.length < 2) return;
    for (let pass = 0; pass < 2; pass++) {
      const sd = (seed + si * 7919 + pass * 104729) >>> 0;
      let pts = s.pts.map(p => [...p]);
      if (s.open && over > 0) {
        const d0 = norm(sub(pts[0], pts[1])), d1 = norm(sub(pts[pts.length - 1], pts[pts.length - 2]));
        pts[0] = add(pts[0], mul(d0, over * (0.35 + 0.65 * Math.abs(rand1(sd, 1)))));
        pts[pts.length - 1] = add(pts[pts.length - 1], mul(d1, over * (0.35 + 0.65 * Math.abs(rand1(sd, 2)))));
      }
      const bias = pass ? amp * 0.7 * rand1(sd, 3) : 0;
      // los trazos largos se curvan un poco, como cuando se dibuja sin regla
      let total = 0;
      for (let i = 0; i < pts.length - 1; i++) total += dist(pts[i], pts[i + 1]);
      const bow = s.open ? rand1(sd, 4) * Math.min(total * 0.012, bowMax) : 0;
      const res = [];
      let acc = 0;
      for (let i = 0; i < pts.length - 1; i++) {
        const a = pts[i], b = pts[i + 1], L = dist(a, b);
        if (L < 1e-12) continue;
        const n = perp(norm(sub(b, a)));
        const k = Math.max(1, Math.ceil(L / step));
        for (let j = i === 0 ? 0 : 1; j <= k; j++) {
          const t = j / k, sArc = acc + L * t;
          const off = bias + bow * Math.sin(Math.PI * Math.min(1, sArc / total)) + amp * (0.7 * noise1(sd, sArc / (step * 7)) + 0.3 * noise1(sd + 1, sArc / (step * 1.6)));
          res.push(add(lerp(a, b, t), mul(n, off)));
        }
        acc += L;
      }
      if (res.length > 1) out.push({ pts: res, pass });
    }
  });
  return out;
}

export const TYPE_LABELS = { line: 'Línea', pline: 'Polilínea', circle: 'Círculo', arc: 'Arco', ellipse: 'Elipse', text: 'Texto', dim: 'Cota' };
export const DIM_LABELS = { iso: 'Cota isométrica', horizontal: 'Cota horizontal', vertical: 'Cota vertical', aligned: 'Cota alineada', radius: 'Cota de radio', diameter: 'Cota de diámetro', angle: 'Cota angular' };

const LAYER_COLORS = ['#e5614f', '#f2a541', '#6fbf73', '#3fa7a0', '#5b9bea', '#7b6fd6', '#c56bd1'];

export function emptyDrawing() {
  return {
    version: 1, units: 'mm', precision: 2, decimal: ',', textH: 3.5, arrow: 2.5, per3D: 100,
    grid: true, current: 'Contorno',
    layers: [
      { name: 'Contorno', color: 'auto', lt: 'continuous', lw: 'thick', visible: true },
      { name: 'Ejes', color: '#e5614f', lt: 'center', lw: 'thin', visible: true },
      { name: 'Ocultas', color: '#5b9bea', lt: 'hidden', lw: 'thin', visible: true },
      { name: 'Cotas', color: '#3fa7a0', lt: 'continuous', lw: 'thin', visible: true },
      { name: 'Texto', color: '#f2a541', lt: 'continuous', lw: 'thin', visible: true },
      { name: 'Construcción', color: '#8c939d', lt: 'dashed', lw: 'thin', visible: true },
    ],
    entities: [],
  };
}

function normalizeDrawing(d) {
  const base = emptyDrawing();
  if (!d || typeof d !== 'object') return base;
  const out = { ...base, ...structuredClone(d) };
  if (!Array.isArray(out.layers) || !out.layers.length) out.layers = base.layers;
  if (!Array.isArray(out.entities)) out.entities = [];
  for (const e of out.entities) {
    e.id ||= eid();
    if (!e.layer) e.layer = out.layers[0].name;
    if (!out.layers.some(l => l.name === e.layer)) out.layers.push({ name: e.layer, color: 'auto', lt: 'continuous', lw: 'thin', visible: true });
  }
  if (!out.layers.some(l => l.name === out.current)) out.current = out.layers[0].name;
  return out;
}

export function fmtNum(v, D, prec = D.precision) {
  const p = Math.max(0, Math.min(6, prec | 0));
  let s = (Math.abs(v) < 0.5 * 10 ** -p ? 0 : v).toFixed(p);
  if (D.decimal === ',') s = s.replace('.', ',');
  return s;
}

// =================================================================== texto
const mctx = document.createElement('canvas').getContext('2d');
const twCache = new Map();
function textWidth(str, h) {
  let w = twCache.get(str);
  if (w === undefined) {
    mctx.font = `100px ${FONT}`;
    w = mctx.measureText(str).width / 100;
    if (twCache.size > 3000) twCache.clear();
    twCache.set(str, w);
  }
  return w * h * FS;
}

function textCorners(p, str, h, rot, align = 'left') {
  const w = textWidth(str, h);
  const x0 = align === 'center' ? -w / 2 : 0;
  const c = Math.cos(rot), s = Math.sin(rot);
  return [[x0, -h * 0.3], [x0 + w, -h * 0.3], [x0 + w, h * 1.05], [x0, h * 1.05]]
    .map(([x, y]) => [p[0] + x * c - y * s, p[1] + x * s + y * c]);
}

// =================================================================== geometría de entidades
function arcPts(c, r, a0, a1, n) {
  const sw = sweepOf(a0, a1);
  const k = Math.max(2, Math.ceil(n * sw / TAU));
  return Array.from({ length: k + 1 }, (_, i) => polar(c, r, a0 + sw * i / k));
}

/** Primitivas geométricas: segmentos ('s') y arcos/círculos ('c'). */
// ------------------------------------------------------------ elipses (círculos isométricos)
// Una elipse se guarda como centro + dos semidiámetros conjugados U y V: p(t) = c + U·cos t + V·sin t.
// Así cualquier transformación afín (mover, girar, escalar, simetría) es exacta: basta transformar c, c+U y c+V.
const cross2 = (a, b) => a[0] * b[1] - a[1] * b[0];
export function ellPts(e, n = 96, t0 = 0, sw = TAU) {
  return Array.from({ length: n + 1 }, (_, k) => {
    const t = t0 + sw * k / n;
    return add(e.c, add(mul(e.U, Math.cos(t)), mul(e.V, Math.sin(t))));
  });
}
/** Coordenadas (a, b) de un vector en la base U, V. */
function inBasis(d, U, V) {
  const det = cross2(U, V);
  if (Math.abs(det) < 1e-18) return [0, 0];
  return [cross2(d, V) / det, cross2(U, d) / det];
}
/** ¿Es un círculo isométrico (semidiámetros iguales a 120°)? */
export function isIsoCircle(e) {
  if (e.type !== 'ellipse') return false;
  const a = Math.hypot(...e.U), b = Math.hypot(...e.V);
  return Math.abs(a - b) < 1e-6 * Math.max(a, 1) && Math.abs(Math.abs(dot(e.U, e.V)) / (a * b) - 0.5) < 1e-6;
}

// Planos isométricos: los dos ejes (en grados) que forman cada cara del cubo
export const ISO_PLANES = {
  top: { label: 'Superior', axes: [30, 150] },
  right: { label: 'Derecha', axes: [30, 90] },
  left: { label: 'Izquierda', axes: [150, 90] },
};
export const isoAxes = V => (ISO_PLANES[V?.isoPlane] || ISO_PLANES.top).axes.map(a => [Math.cos(a * Math.PI / 180), Math.sin(a * Math.PI / 180)]);

function prims(e) {
  switch (e.type) {
    case 'line': return [{ k: 's', a: e.a, b: e.b }];
    case 'pline': {
      const out = [], n = e.pts.length;
      for (let i = 0; i < n - 1; i++) out.push({ k: 's', a: e.pts[i], b: e.pts[i + 1], i });
      if (e.closed && n > 2) out.push({ k: 's', a: e.pts[n - 1], b: e.pts[0], i: n - 1 });
      return out;
    }
    case 'circle': return [{ k: 'c', c: e.c, r: e.r, a0: 0, a1: TAU, full: true }];
    case 'arc': return [{ k: 'c', c: e.c, r: e.r, a0: e.a0, a1: e.a1 }];
    case 'ellipse': { const q = ellPts(e, 96); return q.slice(0, -1).map((a, i) => ({ k: 's', a, b: q[i + 1] })); }
    default: return [];
  }
}

function segDist(p, a, b) {
  const ab = sub(b, a), l2 = dot(ab, ab);
  let t = l2 ? dot(sub(p, a), ab) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  const q = lerp(a, b, t);
  return { d: dist(p, q), t, q };
}

function arcDist(p, pr) {
  const t = angOf(pr.c, p);
  if (pr.full || inSweep(t, pr.a0, pr.a1)) {
    const q = polar(pr.c, pr.r, t);
    return { d: Math.abs(dist(p, pr.c) - pr.r), t, q };
  }
  const s = polar(pr.c, pr.r, pr.a0), e = polar(pr.c, pr.r, pr.a1);
  const ds = dist(p, s), de = dist(p, e);
  return ds < de ? { d: ds, t: pr.a0, q: s } : { d: de, t: pr.a1, q: e };
}

const primDist = (p, pr) => (pr.k === 's' ? segDist(p, pr.a, pr.b) : arcDist(p, pr));

/**
 * Esquina redondeada (empalme, radio r) o achaflanada (distancia d) en el vértice V entre las direcciones hacia P1 y P2.
 * Devuelve { t1, t2, pts (de t1 a t2), arc? } o { error }.
 */
function cornerCut(V, P1, P2, size, chamfer) {
  const L1 = dist(V, P1), L2 = dist(V, P2);
  if (L1 < 1e-9 || L2 < 1e-9) return { error: 'Las líneas no forman esquina' };
  const u1 = mul(sub(P1, V), 1 / L1), u2 = mul(sub(P2, V), 1 / L2);
  const th = Math.acos(Math.max(-1, Math.min(1, dot(u1, u2))));
  if (th < 1e-6 || th > Math.PI - 1e-6) return { error: 'Las líneas son paralelas o están alineadas: no hay esquina' };
  const t = chamfer ? size : size / Math.tan(th / 2);
  if (t > L1 + 1e-9 || t > L2 + 1e-9) return { error: `${chamfer ? 'La distancia' : 'El radio'} es demasiado grande para estas líneas` };
  const t1 = add(V, mul(u1, t)), t2 = add(V, mul(u2, t));
  if (chamfer || size <= 0) return { t1, t2, pts: size <= 0 ? [V] : [t1, t2] };
  const c = add(V, mul(norm(add(u1, u2)), size / Math.sin(th / 2)));
  const a1 = angOf(c, t1), a2 = angOf(c, t2);
  const ccw = sweepOf(a1, a2) <= Math.PI;
  const sw = ccw ? sweepOf(a1, a2) : -sweepOf(a2, a1);
  const n = Math.max(4, Math.ceil(Math.abs(sw) / (4 * Math.PI / 180)));
  const pts = Array.from({ length: n + 1 }, (_, k) => polar(c, size, a1 + sw * k / n));
  return { t1, t2, pts, arc: { c, r: size, a0: ccw ? normA(a1) : normA(a2), a1: ccw ? normA(a2) : normA(a1) } };
}

/** Empalme / chaflán en un vértice (o en todos) de una polilínea. */
function cornerPline(e, idx, size, chamfer) {
  const n = e.pts.length;
  const ok = i => e.closed || (i > 0 && i < n - 1);
  const targets = idx === 'all' ? [...Array(n).keys()].filter(ok) : ok(idx) ? [idx] : [];
  if (!targets.length) return { error: 'Ese punto es un extremo de la polilínea: no es una esquina' };
  const out = [];
  let done = 0, err = null;
  for (let i = 0; i < n; i++) {
    if (!targets.includes(i)) { out.push([...e.pts[i]]); continue; }
    // con «todas», cada tramo solo puede gastar la mitad de su longitud en cada extremo
    const prev = e.pts[(i - 1 + n) % n], next = e.pts[(i + 1) % n];
    const half = idx === 'all';
    const r = cornerCut(e.pts[i], half ? lerp(e.pts[i], prev, 0.5) : prev, half ? lerp(e.pts[i], next, 0.5) : next, size, chamfer);
    if (r.error) { err = r.error; out.push([...e.pts[i]]); continue; }
    out.push(...r.pts.map(P));
    done++;
  }
  if (!done) return { error: err || 'No se pudo redondear' };
  return { ent: { ...e, pts: out }, done };
}

function lineLine(a, b, c, d) {
  const r = sub(b, a), s = sub(d, c);
  const den = r[0] * s[1] - r[1] * s[0];
  if (Math.abs(den) < 1e-12) return null;
  const ca = sub(c, a);
  const t = (ca[0] * s[1] - ca[1] * s[0]) / den;
  return add(a, mul(r, t));
}

function segSeg(a, b, c, d) {
  const r = sub(b, a), s = sub(d, c);
  const den = r[0] * s[1] - r[1] * s[0];
  if (Math.abs(den) < 1e-12) return null;
  const ca = sub(c, a);
  const t = (ca[0] * s[1] - ca[1] * s[0]) / den, u = (ca[0] * r[1] - ca[1] * r[0]) / den;
  if (t < -1e-9 || t > 1 + 1e-9 || u < -1e-9 || u > 1 + 1e-9) return null;
  return add(a, mul(r, t));
}

function lineCircleT(a, b, c, r) {
  const d = sub(b, a), f = sub(a, c);
  const A = dot(d, d), B = 2 * dot(f, d), C = dot(f, f) - r * r;
  const disc = B * B - 4 * A * C;
  if (A < 1e-18 || disc < 0) return [];
  const s = Math.sqrt(disc);
  return disc < 1e-12 ? [-B / (2 * A)] : [(-B - s) / (2 * A), (-B + s) / (2 * A)];
}

function segCirc(S, C) {
  return lineCircleT(S.a, S.b, C.c, C.r)
    .filter(t => t >= -1e-9 && t <= 1 + 1e-9)
    .map(t => lerp(S.a, S.b, t))
    .filter(p => C.full || inSweep(angOf(C.c, p), C.a0, C.a1));
}

function circCirc(A, B) {
  const d = dist(A.c, B.c);
  if (d < 1e-12 || d > A.r + B.r + 1e-9 || d < Math.abs(A.r - B.r) - 1e-9) return [];
  const a = (A.r * A.r - B.r * B.r + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(0, A.r * A.r - a * a));
  const u = norm(sub(B.c, A.c));
  const m = add(A.c, mul(u, a));
  const pts = h < 1e-9 ? [m] : [add(m, mul(perp(u), h)), add(m, mul(perp(u), -h))];
  return pts.filter(p => (A.full || inSweep(angOf(A.c, p), A.a0, A.a1)) && (B.full || inSweep(angOf(B.c, p), B.a0, B.a1)));
}

function interPrims(A, B) {
  if (A.k === 's' && B.k === 's') { const r = segSeg(A.a, A.b, B.a, B.b); return r ? [r] : []; }
  if (A.k === 's') return segCirc(A, B);
  if (B.k === 's') return segCirc(B, A);
  return circCirc(A, B);
}

function circumcenter(a, b, c) {
  const d = 2 * (a[0] * (b[1] - c[1]) + b[0] * (c[1] - a[1]) + c[0] * (a[1] - b[1]));
  if (Math.abs(d) < 1e-12) return null;
  const a2 = dot(a, a), b2 = dot(b, b), c2 = dot(c, c);
  return [(a2 * (b[1] - c[1]) + b2 * (c[1] - a[1]) + c2 * (a[1] - b[1])) / d,
    (a2 * (c[0] - b[0]) + b2 * (a[0] - c[0]) + c2 * (b[0] - a[0])) / d];
}

function polyArea(pts) {
  let s = 0;
  for (let i = 0; i < pts.length; i++) { const p = pts[i], q = pts[(i + 1) % pts.length]; s += p[0] * q[1] - q[0] * p[1]; }
  return s / 2;
}

function pointInPoly(p, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i], b = pts[j];
    if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}

// =================================================================== cotas
/** Geometría de una cota en unidades del plano: líneas, arcos, flechas y texto. */
export function dimGeom(e, D) {
  const g = { lines: [], arrows: [], arcs: [], text: null, value: 0 };
  const A = D.arrow, gap = A * 0.5, ext = A * 0.8, h = D.textH;
  const label = v => {
    const s = fmtNum(v, D);
    if (!e.text) return s;
    return e.text.includes('<>') ? e.text.replace('<>', s) : e.text;
  };
  if (e.kind === 'aligned' || e.kind === 'horizontal' || e.kind === 'vertical') {
    const { a, b, p } = e;
    let a2, b2;
    if (e.kind === 'horizontal') { a2 = [a[0], p[1]]; b2 = [b[0], p[1]]; g.value = Math.abs(b[0] - a[0]); }
    else if (e.kind === 'vertical') { a2 = [p[0], a[1]]; b2 = [p[0], b[1]]; g.value = Math.abs(b[1] - a[1]); }
    else {
      const n = perp(norm(sub(b, a)));
      const off = dot(sub(p, a), n);
      a2 = add(a, mul(n, off)); b2 = add(b, mul(n, off));
      g.value = dist(a, b);
    }
    for (const [P0, P1] of [[a, a2], [b, b2]]) {
      const v = sub(P1, P0), L = len(v);
      if (L > gap) { const u = mul(v, 1 / L); g.lines.push([add(P0, mul(u, gap)), add(P1, mul(u, ext))]); }
    }
    g.lines.push([a2, b2]);
    const L = dist(a2, b2);
    let rot = L > 1e-9 ? angOf(a2, b2) : 0;
    if (L > 1e-9) { const u = norm(sub(b2, a2)); g.arrows.push({ tip: a2, dir: mul(u, -1) }, { tip: b2, dir: u }); }
    if (flips(rot)) rot += Math.PI;
    rot = signedA(rot);
    const up = [-Math.sin(rot), Math.cos(rot)];
    g.text = { p: add(lerp(a2, b2, 0.5), mul(up, gap * 0.6)), rot, str: label(g.value), h, align: 'center' };
  } else if (e.kind === 'iso') {
    // cota isométrica: mide a lo largo de un eje isométrico (u); las líneas de referencia van por otro eje (w)
    const { a, b, p, u, w } = e;
    const [s1, t1] = inBasis(sub(b, a), u, w);
    const beta = inBasis(sub(p, a), u, w)[1];
    const a2 = add(a, mul(w, beta)), b2 = add(b, mul(w, beta - t1));
    g.value = Math.abs(s1);
    for (const [P0, P1] of [[a, a2], [b, b2]]) {
      const v = sub(P1, P0), L = len(v);
      if (L > gap) { const k = mul(v, 1 / L); g.lines.push([add(P0, mul(k, gap)), add(P1, mul(k, ext))]); }
    }
    g.lines.push([a2, b2]);
    if (dist(a2, b2) > 1e-9) { const k = norm(sub(b2, a2)); g.arrows.push({ tip: a2, dir: mul(k, -1) }, { tip: b2, dir: k }); }
    // texto apoyado en la cara: su base sigue u y sus verticales siguen w (texto oblicuo)
    let e1 = [...u];
    if (e1[0] < -1e-9 || (Math.abs(e1[0]) <= 1e-9 && e1[1] < 0)) e1 = mul(e1, -1);
    let e2 = [...w];
    if (cross2(e1, e2) < 0) e2 = mul(e2, -1);
    const str = (e.pre || '') + label(g.value);
    g.text = { p: add(lerp(a2, b2, 0.5), mul(e2, gap * 0.7)), rot: Math.atan2(e1[1], e1[0]), str, h, align: 'center', basis: [e1, e2] };
  } else if (e.kind === 'radius' || e.kind === 'diameter') {
    const { c, r, p } = e;
    const diam = e.kind === 'diameter';
    const u = dist(p, c) > 1e-9 ? norm(sub(p, c)) : [1, 0];
    const q = add(c, mul(u, r));
    const outside = dist(p, c) > r;
    g.value = diam ? 2 * r : r;
    const str = (diam ? 'Ø' : 'R') + label(g.value);
    if (diam) {
      const q2 = add(c, mul(u, -r));
      g.lines.push([q2, q]);
      g.arrows.push({ tip: q, dir: u }, { tip: q2, dir: mul(u, -1) });
      if (outside) g.lines.push([q, p]);
    } else if (outside) {
      g.lines.push([q, p]);
      g.arrows.push({ tip: q, dir: mul(u, -1) });
    } else {
      g.lines.push([c, q]);
      g.arrows.push({ tip: q, dir: u });
    }
    if (outside) {
      const side = u[0] >= 0 ? 1 : -1;
      const tw = textWidth(str, h);
      const land = add(p, [side * (tw + gap), 0]);
      g.lines.push([p, land]);
      g.text = { p: [(p[0] + land[0]) / 2, p[1] + gap * 0.5], rot: 0, str, h, align: 'center' };
    } else {
      let rot = Math.atan2(u[1], u[0]);
      if (flips(rot)) rot += Math.PI;
      rot = signedA(rot);
      const mid = diam ? lerp(c, q, 0.5) : lerp(c, q, 0.5);
      g.text = { p: add(mid, mul([-Math.sin(rot), Math.cos(rot)], gap * 0.6)), rot, str, h, align: 'center' };
    }
  } else if (e.kind === 'angle') {
    const { c, a1, a2, p } = e;
    const r = Math.max(dist(c, p), A);
    const sw = sweepOf(a1, a2);
    g.value = sw * DEG;
    g.arcs.push({ c, r, a0: a1, a1: a2 });
    g.arrows.push(
      { tip: polar(c, r, a1), dir: [Math.sin(a1), -Math.cos(a1)] },
      { tip: polar(c, r, a2), dir: [-Math.sin(a2), Math.cos(a2)] });
    for (const [ang, e0] of [[a1, e.e1 || 0], [a2, e.e2 || 0]]) {
      if (r > e0 + gap) g.lines.push([polar(c, e0 + gap, ang), polar(c, r + ext, ang)]);
    }
    const am = a1 + sw / 2;
    let rot = am - Math.PI / 2, pos = polar(c, r + gap * 0.6, am);
    if (flips(rot)) { rot += Math.PI; pos = polar(c, r + gap * 0.6 + h * 1.05, am); }
    const s = fmtNum(g.value, D, Math.min(D.precision, 2)) + '°';
    g.text = { p: pos, rot: signedA(rot), str: e.text ? (e.text.includes('<>') ? e.text.replace('<>', s) : e.text) : s, h, align: 'center' };
  }
  return g;
}

/** Contorno aproximado (segmentos) y cajas de texto de una entidad: selección, encuadre y ventanas. */
function shapeOf(e, D) {
  const segs = [], boxes = [];
  const poly = (pts, closed) => {
    for (let i = 0; i < pts.length - 1; i++) segs.push([pts[i], pts[i + 1]]);
    if (closed && pts.length > 2) segs.push([pts[pts.length - 1], pts[0]]);
  };
  switch (e.type) {
    case 'line': segs.push([e.a, e.b]); break;
    case 'pline': poly(e.pts, e.closed); break;
    case 'circle': poly(arcPts(e.c, e.r, 0, TAU, 64), false); break;
    case 'arc': poly(arcPts(e.c, e.r, e.a0, e.a1, 48), false); break;
    case 'ellipse': poly(ellPts(e, 64), false); break;
    case 'text': boxes.push(textCorners(e.p, e.text, e.h, e.rot || 0, 'left')); break;
    case 'dim': {
      const g = dimGeom(e, D);
      g.lines.forEach(l => segs.push(l));
      g.arcs.forEach(a => poly(arcPts(a.c, a.r, a.a0, a.a1, 32), false));
      if (g.text) boxes.push(textCorners(g.text.p, g.text.str, g.text.h, g.text.rot, g.text.align));
      break;
    }
  }
  for (const b of boxes) poly(b, true);
  return { segs, boxes };
}

function bboxOf(e, D) {
  const b = [Infinity, Infinity, -Infinity, -Infinity];
  const addP = p => { if (p[0] < b[0]) b[0] = p[0]; if (p[1] < b[1]) b[1] = p[1]; if (p[0] > b[2]) b[2] = p[0]; if (p[1] > b[3]) b[3] = p[1]; };
  if (e.type === 'circle') { addP([e.c[0] - e.r, e.c[1] - e.r]); addP([e.c[0] + e.r, e.c[1] + e.r]); return b; }
  if (e.type === 'ellipse') {
    const hx = Math.hypot(e.U[0], e.V[0]), hy = Math.hypot(e.U[1], e.V[1]);
    addP([e.c[0] - hx, e.c[1] - hy]); addP([e.c[0] + hx, e.c[1] + hy]);
    return b;
  }
  for (const [p, q] of shapeOf(e, D).segs) { addP(p); addP(q); }
  return b;
}

function pickDist(e, p, D) {
  if (['line', 'pline', 'circle', 'arc', 'ellipse'].includes(e.type)) {
    let d = Infinity;
    for (const pr of prims(e)) d = Math.min(d, primDist(p, pr).d);
    return d;
  }
  const { segs, boxes } = shapeOf(e, D);
  if (boxes.some(b => pointInPoly(p, b))) return 0;
  let d = Infinity;
  for (const [a, b] of segs) d = Math.min(d, segDist(p, a, b).d);
  return d;
}

function snapPts(e) {
  const out = [];
  switch (e.type) {
    case 'line': out.push({ p: e.a, k: 'end' }, { p: e.b, k: 'end' }, { p: lerp(e.a, e.b, 0.5), k: 'mid' }); break;
    case 'pline':
      e.pts.forEach(p => out.push({ p, k: 'end' }));
      prims(e).forEach(s => out.push({ p: lerp(s.a, s.b, 0.5), k: 'mid' }));
      break;
    case 'circle':
      out.push({ p: e.c, k: 'cen' });
      for (let i = 0; i < 4; i++) out.push({ p: polar(e.c, e.r, i * Math.PI / 2), k: 'quad' });
      break;
    case 'arc':
      out.push({ p: polar(e.c, e.r, e.a0), k: 'end' }, { p: polar(e.c, e.r, e.a1), k: 'end' },
        { p: polar(e.c, e.r, e.a0 + sweepOf(e.a0, e.a1) / 2), k: 'mid' }, { p: e.c, k: 'cen' });
      for (let i = 0; i < 4; i++) { const a = i * Math.PI / 2; if (inSweep(a, e.a0, e.a1)) out.push({ p: polar(e.c, e.r, a), k: 'quad' }); }
      break;
    case 'ellipse':
      // centro y los cuatro puntos donde toca el rombo isométrico que la inscribe
      out.push({ p: e.c, k: 'cen' }, { p: add(e.c, e.U), k: 'quad' }, { p: sub(e.c, e.U), k: 'quad' }, { p: add(e.c, e.V), k: 'quad' }, { p: sub(e.c, e.V), k: 'quad' });
      break;
    case 'text': out.push({ p: e.p, k: 'ins' }); break;
  }
  return out;
}

export function entityInfo(e, D) {
  switch (e.type) {
    case 'line': return { length: dist(e.a, e.b), angle: normA(angOf(e.a, e.b)) * DEG, dx: e.b[0] - e.a[0], dy: e.b[1] - e.a[1] };
    case 'pline': {
      let L = 0;
      for (const s of prims(e)) L += dist(s.a, s.b);
      return { length: L, area: e.closed ? Math.abs(polyArea(e.pts)) : null };
    }
    case 'circle': return { length: TAU * e.r, area: Math.PI * e.r * e.r };
    case 'arc': { const sw = sweepOf(e.a0, e.a1); return { length: e.r * sw, sweep: sw * DEG }; }
    case 'ellipse': {
      const q = ellPts(e, 360);
      let L = 0;
      for (let i = 0; i < q.length - 1; i++) L += dist(q[i], q[i + 1]);
      return { length: L, area: Math.PI * Math.abs(cross2(e.U, e.V)), r: Math.hypot(...e.U) };
    }
    case 'dim': return { value: dimGeom(e, D).value };
    default: return {};
  }
}

export function isRect(e) {
  if (e.type !== 'pline' || !e.closed || e.pts.length !== 4) return false;
  const [a, b, c, d] = e.pts;
  const h = (p, q) => Math.abs(p[1] - q[1]) < 1e-9, v = (p, q) => Math.abs(p[0] - q[0]) < 1e-9;
  return (h(a, b) && v(b, c) && h(c, d) && v(d, a)) || (v(a, b) && h(b, c) && v(c, d) && h(d, a));
}

// ------------------------------------------------------------ transformaciones
function xform(e, f, o = {}) {
  const n = structuredClone(e);
  const s = o.scale ?? 1;
  const mapAng = (c0, a) => angOf(f(c0), f(polar(c0, 1, a)));
  switch (e.type) {
    case 'line': n.a = P(f(e.a)); n.b = P(f(e.b)); break;
    case 'pline': n.pts = e.pts.map(q => P(f(q))); break;
    case 'circle': n.c = P(f(e.c)); n.r = rnd(e.r * s); break;
    case 'ellipse': { const c2 = f(e.c); n.c = P(c2); n.U = P(sub(f(add(e.c, e.U)), c2)); n.V = P(sub(f(add(e.c, e.V)), c2)); break; }
    case 'arc': {
      const a0 = mapAng(e.c, e.a0), a1 = mapAng(e.c, e.a1);
      n.c = P(f(e.c)); n.r = rnd(e.r * s);
      [n.a0, n.a1] = o.mirror ? [normA(a1), normA(a0)] : [normA(a0), normA(a1)];
      break;
    }
    case 'text': {
      let r = mapAng(e.p, e.rot || 0);
      if (flips(r)) r += Math.PI;
      n.p = P(f(e.p)); n.h = rnd(e.h * s); n.rot = rnd(signedA(r));
      break;
    }
    case 'dim': {
      for (const k of ['a', 'b', 'p', 'c']) if (e[k]) n[k] = P(f(e[k]));
      if (e.u && e.w) { const f0 = f(e.a); n.u = P(norm(sub(f(add(e.a, e.u)), f0))); n.w = P(norm(sub(f(add(e.a, e.w)), f0))); }
      if (e.r) n.r = rnd(e.r * s);
      if (e.kind === 'angle') {
        const A1 = mapAng(e.c, e.a1), A2 = mapAng(e.c, e.a2);
        if (o.mirror) { n.a1 = normA(A2); n.a2 = normA(A1); n.e1 = rnd((e.e2 || 0) * s); n.e2 = rnd((e.e1 || 0) * s); }
        else { n.a1 = normA(A1); n.a2 = normA(A2); n.e1 = rnd((e.e1 || 0) * s); n.e2 = rnd((e.e2 || 0) * s); }
      }
      if ((e.kind === 'horizontal' || e.kind === 'vertical') && o.rot) {
        const q = normA(o.rot) / (Math.PI / 2);
        if (Math.abs(q - Math.round(q)) > 1e-6) n.kind = 'aligned';
        else if (Math.round(q) % 2 === 1) n.kind = e.kind === 'horizontal' ? 'vertical' : 'horizontal';
      }
      break;
    }
  }
  return n;
}

function grips(e) {
  switch (e.type) {
    case 'line': return [e.a, e.b, lerp(e.a, e.b, 0.5)];
    case 'pline': return e.pts.slice();
    case 'circle': return [e.c, ...[0, 1, 2, 3].map(i => polar(e.c, e.r, i * Math.PI / 2))];
    case 'arc': return [e.c, polar(e.c, e.r, e.a0), polar(e.c, e.r, e.a1), polar(e.c, e.r, e.a0 + sweepOf(e.a0, e.a1) / 2)];
    case 'ellipse': return [e.c, add(e.c, e.U), add(e.c, e.V), sub(e.c, e.U), sub(e.c, e.V)];
    case 'text': return [e.p];
    case 'dim': return e.a ? [e.a, e.b, e.p] : [e.p];
    default: return [];
  }
}

/** Qué hace cada pinzamiento (para el rótulo junto al cursor). */
function gripLabel(e, i) {
  switch (e.type) {
    case 'line': return i < 2 ? 'Extremo · arrastra para estirar' : 'Punto medio · arrastra para mover la línea';
    case 'pline': return `Vértice ${i + 1} · arrastra para moverlo`;
    case 'circle': return i === 0 ? 'Centro · arrastra para mover' : 'Cuadrante · arrastra para cambiar el radio';
    case 'ellipse': return i === 0 ? 'Centro · arrastra para mover' : 'Punto de tangencia · arrastra para cambiar el tamaño';
    case 'arc': return ['Centro · arrastra para mover', 'Inicio del arco · arrastra', 'Final del arco · arrastra', 'Arco · arrastra para cambiar el radio'][i];
    case 'text': return 'Texto · arrastra para mover';
    case 'dim': return e.a && i < 2 ? 'Punto acotado · arrastra' : 'Cota · arrastra para colocar la línea y el texto';
    default: return 'Arrastra';
  }
}

function entLabel(e) { return e.type === 'dim' ? (DIM_LABELS[e.kind] || 'Cota') : isIsoCircle(e) ? 'Círculo isométrico' : TYPE_LABELS[e.type] || e.type; }

function applyGrip(e, i, p) {
  const n = structuredClone(e);
  switch (e.type) {
    case 'line':
      if (i === 0) n.a = P(p);
      else if (i === 1) n.b = P(p);
      else { const d = sub(p, lerp(e.a, e.b, 0.5)); n.a = P(add(e.a, d)); n.b = P(add(e.b, d)); }
      break;
    case 'pline': n.pts[i] = P(p); break;
    case 'circle': if (i === 0) n.c = P(p); else n.r = rnd(Math.max(1e-6, dist(e.c, p))); break;
    case 'arc':
      if (i === 0) n.c = P(p);
      else if (i === 1) n.a0 = normA(angOf(e.c, p));
      else if (i === 2) n.a1 = normA(angOf(e.c, p));
      else n.r = rnd(Math.max(1e-6, dist(e.c, p)));
      break;
    case 'ellipse':
      if (i === 0) n.c = P(p);
      else {
        // el tamaño cambia de forma proporcional, para que la elipse pase por el punto
        const k = Math.max(1e-6, Math.hypot(...inBasis(sub(p, e.c), e.U, e.V)));
        n.U = P(mul(e.U, k)); n.V = P(mul(e.V, k));
      }
      break;
    case 'text': n.p = P(p); break;
    case 'dim': if (e.a) n[['a', 'b', 'p'][i]] = P(p); else n.p = P(p); break;
  }
  return n;
}

function offsetEntity(e, d, side) {
  switch (e.type) {
    case 'line': {
      const n = perp(norm(sub(e.b, e.a)));
      const s = Math.sign(dot(sub(side, e.a), n)) || 1;
      return { type: 'line', a: P(add(e.a, mul(n, d * s))), b: P(add(e.b, mul(n, d * s))) };
    }
    case 'circle': case 'arc': {
      const r = e.r + (dist(side, e.c) > e.r ? d : -d);
      if (r <= 1e-9) return null;
      const n = structuredClone(e);
      delete n.id;
      n.r = rnd(r);
      return n;
    }
    case 'ellipse': {
      // círculo isométrico concéntrico (r ± d), que es lo que se espera al dibujar en isométrica
      const r = Math.hypot(...e.U), inside = Math.hypot(...inBasis(sub(side, e.c), e.U, e.V)) < 1;
      const r2 = r + (inside ? -d : d);
      if (r2 <= 1e-9) return null;
      return { type: 'ellipse', c: [...e.c], U: P(mul(e.U, r2 / r)), V: P(mul(e.V, r2 / r)) };
    }
    case 'pline': {
      const segs = prims(e);
      let k = 0, bd = Infinity;
      segs.forEach((s, i) => { const q = segDist(side, s.a, s.b).d; if (q < bd) { bd = q; k = i; } });
      const nk = perp(norm(sub(segs[k].b, segs[k].a)));
      const off = d * (Math.sign(dot(sub(side, segs[k].a), nk)) || 1);
      const sh = segs.map(s => { const n = perp(norm(sub(s.b, s.a))); return [add(s.a, mul(n, off)), add(s.b, mul(n, off))]; });
      const m = sh.length, pts = [];
      if (e.closed) {
        for (let i = 0; i < m; i++) { const pr = sh[(i - 1 + m) % m], cu = sh[i]; pts.push(lineLine(pr[0], pr[1], cu[0], cu[1]) || cu[0]); }
      } else {
        pts.push(sh[0][0]);
        for (let i = 1; i < m; i++) pts.push(lineLine(sh[i - 1][0], sh[i - 1][1], sh[i][0], sh[i][1]) || sh[i][0]);
        pts.push(sh[m - 1][1]);
      }
      return { type: 'pline', pts: pts.map(P), closed: !!e.closed };
    }
  }
  return null;
}

/** Calcula el recorte de `e` en el punto `click` usando `others` como aristas de corte. */
function trimCompute(e, click, others) {
  const cut = others.flatMap(o => prims(o));
  if (e.type === 'pline') {
    const segs = prims(e);
    let k = 0, bd = Infinity;
    segs.forEach((s, i) => { const q = segDist(click, s.a, s.b).d; if (q < bd) { bd = q; k = i; } });
    const lines = segs.map(s => ({ type: 'line', a: [...s.a], b: [...s.b], layer: e.layer }));
    const r = trimCompute(lines[k], click, [...others, ...lines.filter((_, i) => i !== k)]);
    if (!r) return null;
    return { pieces: [...lines.filter((_, i) => i !== k), ...r.pieces], removed: r.removed };
  }
  if (e.type === 'line') {
    const ab = sub(e.b, e.a), L2 = dot(ab, ab);
    if (L2 < 1e-18) return null;
    const S = { k: 's', a: e.a, b: e.b };
    const ts = [];
    for (const pr of cut) for (const q of interPrims(S, pr)) { const t = dot(sub(q, e.a), ab) / L2; if (t > 1e-7 && t < 1 - 1e-7) ts.push(+t.toFixed(9)); }
    const t = Math.max(0, Math.min(1, dot(sub(click, e.a), ab) / L2));
    const b = [0, ...[...new Set(ts)].sort((x, y) => x - y), 1];
    let i = 0;
    while (i < b.length - 2 && t > b[i + 1]) i++;
    const lo = b[i], hi = b[i + 1];
    const pieces = [];
    if (lo > 0) pieces.push({ type: 'line', layer: e.layer, a: [...e.a], b: P(lerp(e.a, e.b, lo)) });
    if (hi < 1) pieces.push({ type: 'line', layer: e.layer, a: P(lerp(e.a, e.b, hi)), b: [...e.b] });
    return { pieces, removed: [{ type: 'line', a: lerp(e.a, e.b, lo), b: lerp(e.a, e.b, hi) }] };
  }
  if (e.type === 'circle' || e.type === 'arc') {
    const C = prims(e)[0];
    const angs = [];
    for (const pr of cut) for (const q of interPrims(C, pr)) angs.push(normA(angOf(e.c, q)));
    const tc = normA(angOf(e.c, click));
    if (e.type === 'circle') {
      const u = [...new Set(angs.map(a => +a.toFixed(9)))].sort((x, y) => x - y);
      if (u.length < 2) return { pieces: [], removed: [{ type: 'circle', c: e.c, r: e.r }] };
      let lo = u[u.length - 1], hi = u[0];
      for (let i = 0; i < u.length; i++) {
        const a = u[i], b = u[(i + 1) % u.length];
        if (inSweep(tc, a, b)) { lo = a; hi = b; break; }
      }
      return {
        pieces: [{ type: 'arc', layer: e.layer, c: [...e.c], r: e.r, a0: hi, a1: lo }],
        removed: [{ type: 'arc', c: e.c, r: e.r, a0: lo, a1: hi }],
      };
    }
    const sw = sweepOf(e.a0, e.a1);
    const ss = [...new Set(angs.map(a => +normA(a - e.a0).toFixed(9)))].filter(s => s > 1e-7 && s < sw - 1e-7).sort((x, y) => x - y);
    const sc = Math.min(sw, normA(tc - e.a0));
    const b = [0, ...ss, sw];
    let i = 0;
    while (i < b.length - 2 && sc > b[i + 1]) i++;
    const lo = b[i], hi = b[i + 1];
    const pieces = [];
    if (lo > 1e-9) pieces.push({ type: 'arc', layer: e.layer, c: [...e.c], r: e.r, a0: e.a0, a1: normA(e.a0 + lo) });
    if (hi < sw - 1e-9) pieces.push({ type: 'arc', layer: e.layer, c: [...e.c], r: e.r, a0: normA(e.a0 + hi), a1: e.a1 });
    return { pieces, removed: [{ type: 'arc', c: e.c, r: e.r, a0: normA(e.a0 + lo), a1: normA(e.a0 + hi) }] };
  }
  return null;
}

// =================================================================== contornos para extruir
/**
 * Busca contornos cerrados (círculos, polilíneas cerradas y cadenas de líneas/arcos/polilíneas que se cierran)
 * y los anida: los contornos dentro de otro son huecos. Devuelve { shapes: [{points, holes}], open }.
 */
/** Une líneas, arcos y polilíneas abiertas que se tocan; devuelve contornos cerrados y trazos abiertos (en puntos). */
export function joinChains(ents) {
  const loops = [], chains = [];
  for (const e of ents) {
    if (e.type === 'circle') loops.push(arcPts(e.c, e.r, 0, TAU, 72).slice(0, -1));
    else if (e.type === 'ellipse') loops.push(ellPts(e, 96).slice(0, -1));
    else if (e.type === 'pline') (e.closed ? loops : chains).push(e.pts.map(p => [...p]));
    else if (e.type === 'line') chains.push([[...e.a], [...e.b]]);
    else if (e.type === 'arc') chains.push(arcPts(e.c, e.r, e.a0, e.a1, 48));
  }
  let size = 1;
  for (const c of [...loops, ...chains]) for (const p of c) size = Math.max(size, Math.abs(p[0]), Math.abs(p[1]));
  const tol = size * 1e-6 + 1e-6;
  const close = (a, b) => dist(a, b) <= tol;
  const opens = [];
  while (chains.length) {
    let ch = chains.pop();
    let changed = true;
    while (changed && !(ch.length > 2 && close(ch[0], ch[ch.length - 1]))) {
      changed = false;
      for (let i = 0; i < chains.length; i++) {
        const o = chains[i];
        let joined = null;
        if (close(ch[ch.length - 1], o[0])) joined = ch.concat(o.slice(1));
        else if (close(ch[ch.length - 1], o[o.length - 1])) joined = ch.concat(o.slice(0, -1).reverse());
        else if (close(ch[0], o[o.length - 1])) joined = o.concat(ch.slice(1));
        else if (close(ch[0], o[0])) joined = o.slice().reverse().concat(ch.slice(1));
        if (joined) { ch = joined; chains.splice(i, 1); changed = true; break; }
      }
    }
    if (ch.length > 3 && close(ch[0], ch[ch.length - 1])) loops.push(ch.slice(0, -1));
    else opens.push(ch);
  }
  return { loops, opens };
}

/** Capas que no forman parte del perfil (cotas, texto, ejes y construcción). */
const NON_PROFILE = new Set(['Cotas', 'Texto', 'Ejes', 'Construcción']);
export const profileEntities = ents => ents.filter(e => !NON_PROFILE.has(e.layer) && !['dim', 'text'].includes(e.type));

/**
 * Convierte un croquis (en unidades del plano) en el perfil de una pieza 3D.
 * kind 'extrude': contornos cerrados (los de dentro son huecos). kind 'lathe': medio perfil a la derecha del eje (x ≥ 0).
 * Devuelve { shape, info } o { error }.
 */
export function profileFromSketch(D, kind, plane = 'top') {
  const per3D = +D.per3D > 0 ? +D.per3D : (UNITS[D.units]?.per3D || 100);
  const k = 1 / per3D;
  const S = pts => pts.map(([x, y]) => [rnd(x * k), rnd(y * k)]);
  const hidden = new Set(D.layers.filter(l => l.visible === false).map(l => l.name));
  const ents = profileEntities(D.entities.filter(e => !hidden.has(e.layer)));
  if (kind === 'extrude') {
    const { shapes, open } = buildShapes(ents);
    if (!shapes.length) return { error: 'El croquis no tiene ningún contorno cerrado: dibuja rectángulos, círculos, polilíneas cerradas o líneas y arcos que se cierren.' };
    const sh = shapes.map(s => ({ points: S(s.points), holes: s.holes.map(S) }));
    const holes = sh.reduce((n, s) => n + s.holes.length, 0);
    return {
      shape: { smooth: false, points: sh[0].points, holes: sh[0].holes, shapes: sh.length > 1 ? sh : undefined, plane, per3D },
      info: `${sh.length} contorno${sh.length > 1 ? 's' : ''}${holes ? ` · ${holes} hueco${holes > 1 ? 's' : ''}` : ''}${open ? ` · ${open} trazo${open > 1 ? 's' : ''} abierto${open > 1 ? 's' : ''} ignorado${open > 1 ? 's' : ''}` : ''}`,
    };
  }
  const { loops, opens } = joinChains(ents);
  const len = c => c.reduce((a, p, i) => a + (i ? dist(c[i - 1], p) : 0), 0);
  let prof = null, closed = false;
  if (loops.length) { prof = loops.reduce((a, b) => (Math.abs(polyArea(b)) > Math.abs(polyArea(a)) ? b : a)); closed = true; }
  else if (opens.length) prof = opens.reduce((a, b) => (len(b) > len(a) ? b : a));
  if (!prof || prof.length < 2) return { error: 'Dibuja el medio perfil de la pieza a la derecha del eje (línea discontinua): una polilínea abierta o un contorno cerrado.' };
  const minX = Math.min(...prof.map(p => p[0]));
  if (minX < -1e-6 * per3D) return { error: `El perfil cruza el eje de revolución (llega a x = ${fmtNum(minX, D)}). Todo el perfil debe quedar a la derecha del eje (x ≥ 0).` };
  // los perfiles abiertos se ordenan de abajo arriba (las caras miran hacia fuera)
  if (!closed && prof[0][1] > prof[prof.length - 1][1]) prof = prof.slice().reverse();
  const pts = S(closed ? [...prof, prof[0]] : prof).map(([x, y]) => [Math.max(0, x), y]);
  const extra = loops.length + opens.length - 1;
  return {
    shape: { smooth: false, points: pts, per3D },
    info: `${closed ? 'Contorno cerrado → sólido' : 'Perfil abierto → superficie'} · ${prof.length} puntos${extra > 0 ? ` · ${extra} trazo${extra > 1 ? 's' : ''} más ignorado${extra > 1 ? 's' : ''} (se usa el mayor)` : ''}`,
  };
}

export function buildShapes(ents) {
  const loops = [], chains = [];
  for (const e of ents) {
    if (e.type === 'circle') loops.push(arcPts(e.c, e.r, 0, TAU, 72).slice(0, -1));
    else if (e.type === 'ellipse') loops.push(ellPts(e, 96).slice(0, -1));
    else if (e.type === 'pline') (e.closed ? loops : chains).push(e.pts.map(p => [...p]));
    else if (e.type === 'line') chains.push([[...e.a], [...e.b]]);
    else if (e.type === 'arc') chains.push(arcPts(e.c, e.r, e.a0, e.a1, 48));
  }
  let size = 1;
  for (const c of [...loops, ...chains]) for (const p of c) size = Math.max(size, Math.abs(p[0]), Math.abs(p[1]));
  const tol = size * 1e-6 + 1e-6;
  const close = (a, b) => dist(a, b) <= tol;
  let open = 0;
  while (chains.length) {
    let ch = chains.pop();
    let changed = true;
    while (changed && !(ch.length > 2 && close(ch[0], ch[ch.length - 1]))) {
      changed = false;
      for (let i = 0; i < chains.length; i++) {
        const o = chains[i];
        let joined = null;
        if (close(ch[ch.length - 1], o[0])) joined = ch.concat(o.slice(1));
        else if (close(ch[ch.length - 1], o[o.length - 1])) joined = ch.concat(o.slice(0, -1).reverse());
        else if (close(ch[0], o[o.length - 1])) joined = o.concat(ch.slice(1));
        else if (close(ch[0], o[0])) joined = o.slice().reverse().concat(ch.slice(1));
        if (joined) { ch = joined; chains.splice(i, 1); changed = true; break; }
      }
    }
    if (ch.length > 3 && close(ch[0], ch[ch.length - 1])) loops.push(ch.slice(0, -1));
    else open++;
  }
  const L = loops.filter(l => l.length >= 3 && Math.abs(polyArea(l)) > 1e-12)
    .map(pts => ({ pts, area: Math.abs(polyArea(pts)), parent: null, depth: 0 }))
    .sort((a, b) => b.area - a.area);
  for (let i = 0; i < L.length; i++) {
    for (let j = i - 1; j >= 0; j--) {
      if (pointInPoly(L[i].pts[0], L[j].pts)) { L[i].parent = L[j]; L[i].depth = L[j].depth + 1; break; }
    }
  }
  const shapes = L.filter(l => l.depth % 2 === 0).map(l => ({
    points: l.pts,
    holes: L.filter(h => h.parent === l && h.depth === l.depth + 1).map(h => h.pts),
  }));
  return { shapes, open };
}

// =================================================================== DXF y SVG
const ACI = { 1: '#ff0000', 2: '#ffff00', 3: '#00ff00', 4: '#00ffff', 5: '#0000ff', 6: '#ff00ff', 8: '#808080', 9: '#c0c0c0', 30: '#ff7f00' };

function hexToAci(hex) {
  if (!hex || hex === 'auto') return 7;
  const rgb = h => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
  const c = rgb(hex);
  let best = 7, bd = Infinity;
  for (const [k, v] of Object.entries(ACI)) {
    const q = rgb(v);
    const d = (c[0] - q[0]) ** 2 + (c[1] - q[1]) ** 2 + (c[2] - q[2]) ** 2;
    if (d < bd) { bd = d; best = +k; }
  }
  return best;
}

const dxfName = n => String(n).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9_$-]+/g, '_') || '0';
const dxfText = s => String(s)
  .replace(/Ø/g, '%%c').replace(/°/g, '%%d').replace(/±/g, '%%p')
  .replace(/[^\x20-\x7e]/g, ch => `\\U+${ch.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0')}`);
const num = v => String(rnd(v));

export function toDXF(D) {
  const out = [];
  const w = (c, v) => out.push(String(c), String(v));
  const mmU = 1 / (UNITS[D.units]?.mm || 1);
  w(0, 'SECTION'); w(2, 'HEADER');
  w(9, '$ACADVER'); w(1, 'AC1009');
  w(9, '$INSUNITS'); w(70, UNITS[D.units]?.dxf ?? 0);
  w(0, 'ENDSEC');
  w(0, 'SECTION'); w(2, 'TABLES');
  const lts = [['CONTINUOUS', 'Solid line', []], ['DASHED', 'Dashed __ __ __', [6, -3]], ['HIDDEN', 'Hidden _ _ _', [3, -1.5]], ['CENTER', 'Center ____ _ ____', [12, -3, 3, -3]], ['DOT', 'Dot . . . .', [0, -2]]];
  w(0, 'TABLE'); w(2, 'LTYPE'); w(70, lts.length);
  for (const [name, desc, pat] of lts) {
    w(0, 'LTYPE'); w(2, name); w(70, 0); w(3, desc); w(72, 65); w(73, pat.length);
    w(40, num(pat.reduce((s, v) => s + Math.abs(v), 0) * mmU));
    for (const v of pat) w(49, num(v * mmU));
  }
  w(0, 'ENDTAB');
  w(0, 'TABLE'); w(2, 'LAYER'); w(70, D.layers.length);
  for (const L of D.layers) {
    w(0, 'LAYER'); w(2, dxfName(L.name)); w(70, 0);
    w(62, (L.visible === false ? -1 : 1) * hexToAci(L.color));
    w(6, LINETYPES[L.lt]?.dxf || 'CONTINUOUS');
  }
  w(0, 'ENDTAB');
  w(0, 'ENDSEC');
  w(0, 'SECTION'); w(2, 'ENTITIES');
  const line = (l, a, b) => { w(0, 'LINE'); w(8, l); w(10, num(a[0])); w(20, num(a[1])); w(30, 0); w(11, num(b[0])); w(21, num(b[1])); w(31, 0); };
  const arc = (l, c, r, a0, a1) => { w(0, 'ARC'); w(8, l); w(10, num(c[0])); w(20, num(c[1])); w(30, 0); w(40, num(r)); w(50, num(normA(a0) * DEG)); w(51, num(normA(a1) * DEG)); };
  const text = (l, p, str, h, rot, center, basis) => {
    w(0, 'TEXT'); w(8, l); w(10, num(p[0])); w(20, num(p[1])); w(30, 0); w(40, num(h)); w(1, dxfText(str));
    if (rot) w(50, num(rot * DEG));
    // texto isométrico: ángulo oblicuo = 90° − ángulo entre la base y las verticales de las letras
    if (basis) { const th = Math.atan2(cross2(basis[0], basis[1]), dot(basis[0], basis[1])); w(51, num(90 - th * DEG)); }
    if (center) { w(72, 1); w(11, num(p[0])); w(21, num(p[1])); w(31, 0); }
  };
  const lyr = new Map(D.layers.map(L => [L.name, L]));
  for (const e of D.entities) {
    const l = dxfName(e.layer);
    const ov = e.lt && e.type !== 'dim' && e.type !== 'text' && LINETYPES[e.lt] && LINETYPES[e.lt].dxf !== (LINETYPES[lyr.get(e.layer)?.lt]?.dxf || 'CONTINUOUS') ? LINETYPES[e.lt].dxf : null;
    const at = out.length;
    switch (e.type) {
      case 'line': line(l, e.a, e.b); break;
      case 'pline':
        w(0, 'POLYLINE'); w(8, l); w(66, 1); w(70, e.closed ? 1 : 0); w(10, 0); w(20, 0); w(30, 0);
        for (const p of e.pts) { w(0, 'VERTEX'); w(8, l); w(10, num(p[0])); w(20, num(p[1])); w(30, 0); }
        w(0, 'SEQEND'); w(8, l);
        break;
      case 'circle': w(0, 'CIRCLE'); w(8, l); w(10, num(e.c[0])); w(20, num(e.c[1])); w(30, 0); w(40, num(e.r)); break;
      case 'ellipse':
        // DXF R12 no tiene ELLIPSE: se exporta como polilínea cerrada
        w(0, 'POLYLINE'); w(8, l); w(66, 1); w(70, 1); w(10, 0); w(20, 0); w(30, 0);
        for (const p of ellPts(e, 96).slice(0, -1)) { w(0, 'VERTEX'); w(8, l); w(10, num(p[0])); w(20, num(p[1])); w(30, 0); }
        w(0, 'SEQEND'); w(8, l);
        break;
      case 'arc': arc(l, e.c, e.r, e.a0, e.a1); break;
      case 'text': text(l, e.p, e.text, e.h, e.rot || 0, false); break;
      case 'dim': {
        const g = dimGeom(e, D);
        for (const [a, b] of g.lines) line(l, a, b);
        for (const a of g.arcs) arc(l, a.c, a.r, a.a0, a.a1);
        for (const ar of g.arrows) {
          const base = sub(ar.tip, mul(ar.dir, D.arrow)), n = mul(perp(ar.dir), D.arrow / 6);
          const p1 = add(base, n), p2 = sub(base, n);
          w(0, 'SOLID'); w(8, l);
          w(10, num(ar.tip[0])); w(20, num(ar.tip[1])); w(30, 0);
          w(11, num(p1[0])); w(21, num(p1[1])); w(31, 0);
          w(12, num(p2[0])); w(22, num(p2[1])); w(32, 0);
          w(13, num(p2[0])); w(23, num(p2[1])); w(33, 0);
        }
        if (g.text) text(l, g.text.p, g.text.str, g.text.h, g.text.rot, true, g.text.basis);
        break;
      }
    }
    if (ov) { let k = at; while (k < out.length && out[k] !== '8') k += 2; if (k < out.length) out.splice(k + 2, 0, '6', ov); }
  }
  w(0, 'ENDSEC'); w(0, 'EOF');
  return out.join('\r\n') + '\r\n';
}

const decodeDxfText = s => s
  .replace(/%%[cC]/g, 'Ø').replace(/%%[dD]/g, '°').replace(/%%[pP]/g, '±')
  .replace(/\\U\+([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));

function arcFromBulge(a, b, bulge) {
  const th = 4 * Math.atan(bulge);
  const chord = dist(a, b);
  if (chord < 1e-12 || Math.abs(th) < 1e-9) return null;
  const u = norm(sub(b, a));
  const hgt = (chord / 2) / Math.tan(th / 2);
  const c = add(lerp(a, b, 0.5), mul(perp(u), hgt));
  const r = dist(c, a);
  const [s, t] = th > 0 ? [a, b] : [b, a];
  return { type: 'arc', c: P(c), r: rnd(r), a0: normA(angOf(c, s)), a1: normA(angOf(c, t)) };
}

function vertsToEntities(verts, closed, layer) {
  if (verts.length < 2) return [];
  if (!verts.some(v => Math.abs(v.bulge || 0) > 1e-12)) {
    return [{ type: 'pline', pts: verts.map(v => P([v.x, v.y])), closed: !!closed, layer }];
  }
  const out = [];
  const n = verts.length;
  for (let i = 0; i < (closed ? n : n - 1); i++) {
    const a = [verts[i].x, verts[i].y], b = [verts[(i + 1) % n].x, verts[(i + 1) % n].y];
    const arc = Math.abs(verts[i].bulge || 0) > 1e-12 ? arcFromBulge(a, b, verts[i].bulge) : null;
    out.push(arc ? { ...arc, layer } : { type: 'line', a: P(a), b: P(b), layer });
  }
  return out;
}

const ltFromName = n => {
  const s = String(n || '').toUpperCase();
  if (s.startsWith('DOT')) return 'dotted';
  if (s.includes('CENTER') || s.includes('DASHDOT')) return 'center';
  if (s.includes('HIDDEN')) return 'hidden';
  if (s.includes('DASH')) return 'dashed';
  return 'continuous';
};

/** Lee un DXF ASCII: LINE, LWPOLYLINE, POLYLINE, CIRCLE, ARC, TEXT, MTEXT, SPLINE, ELLIPSE. */
export function parseDXF(text) {
  const L = text.split(/\r\n|\r|\n/);
  const pairs = [];
  for (let i = 0; i + 1 < L.length; i += 2) {
    const code = parseInt(L[i], 10);
    if (Number.isNaN(code)) { i--; continue; }
    pairs.push([code, L[i + 1]]);
  }
  const res = { units: null, layers: [], entities: [], skipped: {} };
  const readObj = i => {
    const obj = {}, list = [];
    while (i < pairs.length && pairs[i][0] !== 0) { const [c, v] = pairs[i]; (obj[c] ||= []).push(v); list.push([c, v]); i++; }
    return { obj, list, next: i };
  };
  const f = (o, c, d = 0) => (o[c] ? parseFloat(o[c][0]) : d);
  let i = 0, section = null;
  while (i < pairs.length) {
    const c = pairs[i][0], v = pairs[i][1].trim();
    if (c === 0 && v === 'SECTION') { section = pairs[i + 1]?.[0] === 2 ? pairs[i + 1][1].trim() : null; i += 2; continue; }
    if (c === 0 && v === 'ENDSEC') { section = null; i++; continue; }
    if (c === 0 && v === 'EOF') break;
    if (section === 'HEADER' && c === 9 && v === '$INSUNITS') { res.units = parseInt(pairs[i + 1]?.[1], 10); i += 2; continue; }
    if (section === 'TABLES' && c === 0 && v === 'LAYER') {
      const { obj, next } = readObj(i + 1);
      const col = parseInt(obj[62]?.[0] ?? '7', 10);
      if (obj[2]) res.layers.push({ name: obj[2][0].trim(), color: ACI[Math.abs(col)] || 'auto', lt: ltFromName(obj[6]?.[0]), visible: col >= 0 });
      i = next;
      continue;
    }
    if (section === 'ENTITIES' && c === 0) {
      const type = v;
      const { obj, list, next } = readObj(i + 1);
      i = next;
      const layer = (obj[8]?.[0] || '0').trim();
      const elt = obj[6]?.[0] && !/^BY(LAYER|BLOCK)$/i.test(obj[6][0].trim()) ? ltFromName(obj[6][0]) : null;
      const push = e => res.entities.push({ ...e, layer, ...(elt ? { lt: elt } : {}) });
      switch (type) {
        case 'LINE': push({ type: 'line', a: P([f(obj, 10), f(obj, 20)]), b: P([f(obj, 11), f(obj, 21)]) }); break;
        case 'CIRCLE': push({ type: 'circle', c: P([f(obj, 10), f(obj, 20)]), r: rnd(f(obj, 40)) }); break;
        case 'ARC': push({ type: 'arc', c: P([f(obj, 10), f(obj, 20)]), r: rnd(f(obj, 40)), a0: normA(f(obj, 50) / DEG), a1: normA(f(obj, 51) / DEG) }); break;
        case 'LWPOLYLINE': {
          const verts = [];
          for (const [cc, vv] of list) {
            if (cc === 10) verts.push({ x: parseFloat(vv), y: 0, bulge: 0 });
            else if (cc === 20 && verts.length) verts[verts.length - 1].y = parseFloat(vv);
            else if (cc === 42 && verts.length) verts[verts.length - 1].bulge = parseFloat(vv);
          }
          vertsToEntities(verts, (f(obj, 70) & 1) === 1, layer).forEach(e => res.entities.push(e));
          break;
        }
        case 'POLYLINE': {
          const flags = f(obj, 70);
          const verts = [];
          while (i < pairs.length && pairs[i][0] === 0 && pairs[i][1].trim() === 'VERTEX') {
            const r = readObj(i + 1);
            verts.push({ x: f(r.obj, 10), y: f(r.obj, 20), bulge: f(r.obj, 42) });
            i = r.next;
          }
          if (pairs[i] && pairs[i][1].trim() === 'SEQEND') i = readObj(i + 1).next;
          if (flags & (16 | 64)) { res.skipped['POLYLINE 3D'] = (res.skipped['POLYLINE 3D'] || 0) + 1; break; }
          vertsToEntities(verts, (flags & 1) === 1, layer).forEach(e => res.entities.push(e));
          break;
        }
        case 'TEXT': {
          const str = decodeDxfText(obj[1]?.[0] || '');
          if (str.trim()) push({ type: 'text', p: P([f(obj, 10), f(obj, 20)]), text: str, h: rnd(f(obj, 40, 2.5)), rot: rnd(f(obj, 50) / DEG) });
          break;
        }
        case 'MTEXT': {
          let str = (obj[3] || []).join('') + (obj[1]?.[0] || '');
          str = decodeDxfText(str).replace(/\\P/g, ' ').replace(/\\[A-Za-z][^;\\]*;/g, '').replace(/\\~/g, ' ').replace(/[{}]/g, '').trim();
          const h = f(obj, 40, 2.5);
          let rot = f(obj, 50) / DEG;
          if (obj[11]) rot = Math.atan2(f(obj, 21), f(obj, 11));
          if (str) push({ type: 'text', p: P([f(obj, 10), f(obj, 20) - h]), text: str, h: rnd(h), rot: rnd(rot) });
          break;
        }
        case 'SOLID': case 'TRACE': {
          const pts = [[f(obj, 10), f(obj, 20)], [f(obj, 11), f(obj, 21)], obj[13] ? [f(obj, 13), f(obj, 23)] : [f(obj, 12), f(obj, 22)], [f(obj, 12), f(obj, 22)]].map(P);
          const last = pts[3], prev = pts[2];
          if (Math.hypot(last[0] - prev[0], last[1] - prev[1]) < 1e-9) pts.splice(2, 1);
          push({ type: 'pline', pts, closed: true });
          break;
        }
        case 'SPLINE': {
          const fit = [], ctl = [];
          for (const [cc, vv] of list) {
            if (cc === 11) fit.push([parseFloat(vv), 0]); else if (cc === 21 && fit.length) fit[fit.length - 1][1] = parseFloat(vv);
            if (cc === 10) ctl.push([parseFloat(vv), 0]); else if (cc === 20 && ctl.length) ctl[ctl.length - 1][1] = parseFloat(vv);
          }
          const pts = (fit.length >= 2 ? fit : ctl).map(P);
          if (pts.length >= 2) push({ type: 'pline', pts, closed: (f(obj, 70) & 1) === 1 });
          break;
        }
        case 'ELLIPSE': {
          const c = [f(obj, 10), f(obj, 20)], M = [f(obj, 11), f(obj, 21)], ratio = f(obj, 40, 1);
          const t0 = f(obj, 41, 0), t1 = f(obj, 42, TAU);
          const m = mul(perp(M), ratio);
          const sw = sweepOf(t0, t1), n = Math.max(8, Math.ceil(64 * sw / TAU));
          const pts = Array.from({ length: n + 1 }, (_, k) => { const t = t0 + sw * k / n; return P(add(add(c, mul(M, Math.cos(t))), mul(m, Math.sin(t)))); });
          const full = sw > TAU - 1e-6;
          push({ type: 'pline', pts: full ? pts.slice(0, -1) : pts, closed: full });
          break;
        }
        default:
          if (type !== 'SEQEND' && type !== 'VERTEX' && type !== 'POINT') res.skipped[type] = (res.skipped[type] || 0) + 1;
      }
      continue;
    }
    i++;
  }
  return res;
}

const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

export function toSVG(D, entities = D.entities) {
  const vis = new Set(D.layers.filter(l => l.visible !== false).map(l => l.name));
  const ents = entities.filter(e => vis.has(e.layer));
  const bb = [Infinity, Infinity, -Infinity, -Infinity];
  for (const e of ents) { const b = bboxOf(e, D); bb[0] = Math.min(bb[0], b[0]); bb[1] = Math.min(bb[1], b[1]); bb[2] = Math.max(bb[2], b[2]); bb[3] = Math.max(bb[3], b[3]); }
  if (!Number.isFinite(bb[0])) { bb[0] = bb[1] = 0; bb[2] = bb[3] = 100; }
  const m = Math.max(bb[2] - bb[0], bb[3] - bb[1]) * 0.04 + D.textH;
  const W = rnd(bb[2] - bb[0] + 2 * m), H = rnd(bb[3] - bb[1] + 2 * m);
  const X = x => rnd(x - bb[0] + m), Y = y => rnd(bb[3] - y + m);
  const mmU = 1 / (UNITS[D.units]?.mm || 1);
  const suffix = ['mm', 'cm', 'in'].includes(D.units) ? D.units : '';
  const layers = new Map(D.layers.map(l => [l.name, l]));
  const out = [`<svg xmlns="http://www.w3.org/2000/svg" width="${W}${suffix}" height="${H}${suffix}" viewBox="0 0 ${W} ${H}">`,
    `<g fill="none" stroke-linecap="round" stroke-linejoin="round">`];
  const arcPath = (c, r, a0, a1) => {
    const sw = sweepOf(a0, a1);
    if (sw >= TAU - 1e-9) return `<circle cx="${X(c[0])}" cy="${Y(c[1])}" r="${rnd(r)}"`;
    const s = polar(c, r, a0), e = polar(c, r, a1);
    return `<path d="M${X(s[0])} ${Y(s[1])} A${rnd(r)} ${rnd(r)} 0 ${sw > Math.PI ? 1 : 0} 0 ${X(e[0])} ${Y(e[1])}"`;
  };
  const txt = (p, str, h, rot, anchor, col, basis) => basis
    ? `<text x="0" y="0" font-size="${rnd(h * FS)}" font-family="Inter, Arial, sans-serif" fill="${col}" stroke="none" text-anchor="${anchor}" transform="matrix(${[basis[0][0], -basis[0][1], -basis[1][0], basis[1][1]].map(rnd).join(' ')} ${X(p[0])} ${Y(p[1])})">${esc(str)}</text>`
    : `<text x="${X(p[0])}" y="${Y(p[1])}" font-size="${rnd(h * FS)}" font-family="Inter, Arial, sans-serif" fill="${col}" stroke="none" text-anchor="${anchor}"${rot ? ` transform="rotate(${rnd(-rot * DEG)} ${X(p[0])} ${Y(p[1])})"` : ''}>${esc(str)}</text>`;
  for (const e of ents) {
    const L = layers.get(e.layer) || {};
    const col = !L.color || L.color === 'auto' ? '#000000' : L.color;
    const sw = rnd((L.lw === 'thick' ? 0.5 : 0.25) * mmU);
    const LT = LINETYPES[ltOf(e, L)] || LINETYPES.continuous;
    const dash = LT.dash.map(v => rnd(v * 0.5 * mmU)).join(' ');
    const st = ` stroke="${col}" stroke-width="${sw}"${dash ? ` stroke-dasharray="${dash}"` : ''}/>`;
    if (LT.sketch && ['line', 'pline', 'circle', 'arc', 'ellipse'].includes(e.type)) {
      const seed = hashStr(e.id || e.type);
      const base = sketchBase(e, seed, 1.2 * mmU).map(s0 => ({ ...s0, pts: s0.pts.map(p => [X(p[0]), Y(p[1])]) }));
      for (const s0 of sketchStrokes(base, seed, { amp: 0.2 * mmU, step: 1.2 * mmU, over: 1 * mmU, bowMax: 0.7 * mmU })) {
        const r3 = x => Math.round(x * 1000) / 1000;
        const d = s0.pts.map((p, i) => `${i ? 'L' : 'M'}${r3(p[0])} ${r3(p[1])}`).join('');
        out.push(`<path d="${d}" stroke="${col}" stroke-width="${rnd(sw * (s0.pass ? 0.75 : 1.05))}"${s0.pass ? ' stroke-opacity="0.45"' : ''}/>`);
      }
      continue;
    }
    switch (e.type) {
      case 'line': out.push(`<line x1="${X(e.a[0])}" y1="${Y(e.a[1])}" x2="${X(e.b[0])}" y2="${Y(e.b[1])}"${st}`); break;
      case 'pline': out.push(`<${e.closed ? 'polygon' : 'polyline'} points="${e.pts.map(p => `${X(p[0])},${Y(p[1])}`).join(' ')}"${st}`); break;
      case 'circle': out.push(`<circle cx="${X(e.c[0])}" cy="${Y(e.c[1])}" r="${rnd(e.r)}"${st}`); break;
      case 'ellipse': out.push(`<polygon points="${ellPts(e, 96).slice(0, -1).map(p => `${X(p[0])},${Y(p[1])}`).join(' ')}"${st}`); break;
      case 'arc': out.push(arcPath(e.c, e.r, e.a0, e.a1) + st); break;
      case 'text': out.push(txt(e.p, e.text, e.h, e.rot || 0, 'start', col)); break;
      case 'dim': {
        const g = dimGeom(e, D);
        const thin = ` stroke="${col}" stroke-width="${rnd(0.18 * mmU)}"/>`;
        for (const [a, b] of g.lines) out.push(`<line x1="${X(a[0])}" y1="${Y(a[1])}" x2="${X(b[0])}" y2="${Y(b[1])}"${thin}`);
        for (const a of g.arcs) out.push(arcPath(a.c, a.r, a.a0, a.a1) + thin);
        for (const ar of g.arrows) {
          const base = sub(ar.tip, mul(ar.dir, D.arrow)), n = mul(perp(ar.dir), D.arrow / 6);
          const pts = [ar.tip, add(base, n), sub(base, n)];
          out.push(`<polygon points="${pts.map(p => `${X(p[0])},${Y(p[1])}`).join(' ')}" fill="${col}" stroke="none"/>`);
        }
        if (g.text) out.push(txt(g.text.p, g.text.str, g.text.h, g.text.rot, 'middle', col, g.text.basis));
        break;
      }
    }
  }
  out.push('</g>', '</svg>');
  return out.join('\n');
}

// =================================================================== PDF de la hoja
let _measureCtx = null;
/** Ancho de un texto en Helvetica, en las mismas unidades que `size`. */
function helvWidth(str, size) {
  _measureCtx ||= document.createElement('canvas').getContext('2d');
  _measureCtx.font = '100px Helvetica, Arial, sans-serif';
  return _measureCtx.measureText(str).width / 100 * size;
}

const hexRGB = hex => {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  if (!m) return [0, 0, 0];
  const n = parseInt(m[1], 16);
  return [(n >> 16) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
};

/**
 * La hoja en PDF vectorial a escala real: imprimiéndolo al 100 % las medidas en papel
 * son las del dibujo multiplicadas por la escala de la hoja.
 */
/** Página PDF de la hoja: { width, height, content } en puntos. */
function pdfPage(D, title, sheetNo) {
  const S = sheetOf(D);
  if (!S) throw new Error('el plano no tiene hoja');
  const PT = 72 / 25.4;                                   // puntos por mm
  const f = v => (Math.round(v * 100) / 100).toString();
  const X = x => (x - S.x0) / S.k * PT, Y = y => (y - S.y0) / S.k * PT;
  const out = ['1 J 1 j'];
  const stroke = (col, wmm, dashMM) => {
    const [r, g, b] = hexRGB(col);
    out.push(`${f(r)} ${f(g)} ${f(b)} RG ${f(r)} ${f(g)} ${f(b)} rg ${f(wmm * PT)} w [${dashMM.map(v => f(v * PT)).join(' ')}] 0 d`);
  };
  const poly = (pts, closed) => {
    if (pts.length < 2) return;
    out.push(pts.map((p, i) => `${f(X(p[0]))} ${f(Y(p[1]))} ${i ? 'l' : 'm'}`).join(' ') + (closed ? ' h S' : ' S'));
  };
  const curve = (c, r, a0, sw) => {
    const n = Math.max(16, Math.ceil(Math.abs(sw) / (2 * Math.PI / 180)));
    return Array.from({ length: n + 1 }, (_, i) => polar(c, r, a0 + sw * i / n));
  };
  const text = (p, str, h, rot, center, col, basis) => {
    const size = h * FS / S.k * PT;
    if (size < 0.5) return;
    const [r, g, b] = hexRGB(col);
    const c = Math.cos(rot || 0), sn = Math.sin(rot || 0);
    // matriz del texto: base (e1) y verticales (e2); en isométrico e2 no es perpendicular (texto oblicuo)
    const [e1, e2] = basis || [[c, sn], [-sn, c]];
    let x = X(p[0]), y = Y(p[1]);
    if (center) { const w = helvWidth(str, size) / 2; x -= e1[0] * w; y -= e1[1] * w; }
    out.push(`${f(r)} ${f(g)} ${f(b)} rg BT /F1 ${f(size)} Tf ${f(e1[0])} ${f(e1[1])} ${f(e2[0])} ${f(e2[1])} ${f(x)} ${f(y)} Tm (${pdfText(str)}) Tj ET`);
  };
  const entity = (e, col, wmm, LT) => {
    if (LT?.sketch && ['line', 'pline', 'circle', 'arc', 'ellipse'].includes(e.type)) {
      const seed = hashStr(e.id || e.type);
      const base = sketchBase(e, seed, 1.2 * S.k).map(s0 => ({ ...s0, pts: s0.pts.map(q => [(q[0] - S.x0) / S.k, (q[1] - S.y0) / S.k]) }));
      for (const s0 of sketchStrokes(base, seed, { amp: 0.2, step: 1.2, over: 1, bowMax: 0.7 })) {
        // segunda pasada más clara (PDF 1.4 sin transparencias: se mezcla con el blanco del papel)
        const lite = s0.pass ? '#' + hexRGB(col).map(v => Math.round((v * 0.45 + 0.55) * 255).toString(16).padStart(2, '0')).join('') : col;
        stroke(lite, wmm * (s0.pass ? 0.75 : 1.05), []);
        out.push(s0.pts.map((q, i) => `${f(q[0] * PT)} ${f(q[1] * PT)} ${i ? 'l' : 'm'}`).join(' ') + ' S');
      }
      return;
    }
    stroke(col, wmm, (LT?.dash || []).map(v => v * 0.5));
    switch (e.type) {
      case 'line': poly([e.a, e.b]); break;
      case 'pline': poly(e.pts, e.closed); break;
      case 'circle': poly(curve(e.c, e.r, 0, TAU), true); break;
      case 'ellipse': poly(ellPts(e, 120).slice(0, -1), true); break;
      case 'arc': poly(curve(e.c, e.r, e.a0, sweepOf(e.a0, e.a1))); break;
      case 'text': text(e.p, e.text, e.h, e.rot || 0, false, col); break;
      case 'dim': {
        const g = dimGeom(e, D);
        stroke(col, 0.18, []);
        for (const [a, b] of g.lines) poly([a, b]);
        for (const a of g.arcs) poly(curve(a.c, a.r, a.a0, sweepOf(a.a0, a.a1)));
        for (const ar of g.arrows) {
          const base = sub(ar.tip, mul(ar.dir, D.arrow)), n = mul(perp(ar.dir), D.arrow / 6);
          const t = [ar.tip, add(base, n), sub(base, n)];
          out.push(t.map((q, i) => `${f(X(q[0]))} ${f(Y(q[1]))} ${i ? 'l' : 'm'}`).join(' ') + ' h f');
        }
        if (g.text) text(g.text.p, g.text.str, g.text.h, g.text.rot, true, col, g.text.basis);
        break;
      }
    }
  };
  const layers = new Map(D.layers.map(l => [l.name, l]));
  for (const e of sheetDecor(D, title, sheetNo)) entity(e, '#000000', e.lw === 'thick' ? 0.5 : 0.25, LINETYPES.continuous);
  for (const e of D.entities) {
    const L = layers.get(e.layer) || {};
    if (L.visible === false) continue;
    const col = !L.color || L.color === 'auto' ? '#000000' : L.color;
    entity(e, col, L.lw === 'thick' ? 0.5 : 0.25, LINETYPES[ltOf(e, L)]);
  }
  return { width: S.w * PT, height: S.h * PT, content: out.join('\n') };
}

/** PDF vectorial de la hoja, a escala real. */
export function toPDF(D, { title = '', sheetNo = '' } = {}) {
  return makeVectorPdf({ ...pdfPage(D, title, sheetNo), title });
}

/** PDF de varias hojas, una por página (cada una con su tamaño de papel). sheets: [{ drawing, title, sheetNo }] */
export function toPDFMulti(sheets, { title = '' } = {}) {
  const pages = sheets.filter(s => sheetOf(s.drawing)).map(s => pdfPage(normalizeDrawing(s.drawing), s.title, s.sheetNo));
  if (!pages.length) throw new Error('ninguna hoja tiene formato de papel');
  return makeVectorPdf({ pages, title });
}

// =================================================================== órdenes y herramientas
export const CAD_TOOLS = {
  select: { label: 'Seleccionar', alias: [], icon: '<path d="M6 3l12 9-5.5 1.3L15 19l-2.5 1-2.6-5.7L6 18z"/>' },
  '|1': null,
  line: { label: 'Línea', alias: ['l', 'line', 'linea', 'línea'], icon: '<path d="M4 20L20 4"/><circle cx="4" cy="20" r="1.6"/><circle cx="20" cy="4" r="1.6"/>' },
  pline: { label: 'Polilínea', alias: ['pl', 'pline', 'polilinea', 'polilínea'], icon: '<path d="M3 18l5-9 5 6 8-11"/>' },
  rect: { label: 'Rectángulo', alias: ['rec', 'rect', 'rectang', 'rectangulo', 'rectángulo'], icon: '<rect x="4" y="6" width="16" height="12"/>' },
  circle: { label: 'Círculo', alias: ['c', 'ci', 'circle', 'circulo', 'círculo'], icon: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="1" fill="currentColor"/>' },
  arc: { label: 'Arco', alias: ['a', 'arc', 'arco'], icon: '<path d="M4 18a9 9 0 0 1 16 0"/>' },
  text: { label: 'Texto', alias: ['t', 'dt', 'text', 'texto'], icon: '<path d="M5 6h14M12 6v13M9 19h6"/>' },
  '|2': null,
  dimlin: { label: 'Cota lineal', alias: ['dli', 'dimlin', 'dimlinear', 'cota', 'acotar'], icon: '<path d="M4 6v12M20 6v12M4 12h16M7 10l-3 2 3 2M17 10l3 2-3 2"/>' },
  dimali: { label: 'Cota alineada', alias: ['dal', 'dimali', 'dimaligned'], icon: '<path d="M4 15L15 4M9 20L20 9M6 18L17 7"/><path d="M6 14l0 4 4 0M14 6l4 0 0 4"/>' },
  dimrad: { label: 'Cota de radio', alias: ['dra', 'dimrad', 'dimradius', 'radio'], icon: '<circle cx="11" cy="13" r="7"/><path d="M11 13l8-8"/><path d="M16 5h3v3"/>' },
  dimdia: { label: 'Cota de diámetro', alias: ['ddi', 'dimdia', 'dimdiameter', 'diametro', 'diámetro'], icon: '<circle cx="12" cy="12" r="8"/><path d="M6.3 17.7L17.7 6.3"/>' },
  dimang: { label: 'Cota angular', alias: ['dan', 'dimang', 'dimangular', 'angulo', 'ángulo'], icon: '<path d="M4 20h16M4 20L16 6"/><path d="M13 20a9 9 0 0 0-2.7-6.5"/>' },
  '|3': null,
  measure: { label: 'Medir', alias: ['di', 'dist', 'mea', 'medir', 'distancia'], icon: '<path d="M3 16L16 3l5 5L8 21z"/><path d="M7 12l2 2M10 9l2 2M13 6l2 2"/>' },
};

export const CAD_OPS = {
  move: { label: 'Desplazar', alias: ['m', 'move', 'mover', 'desplaza', 'desplazar'], icon: '<path d="M12 3v18M3 12h18M12 3l-3 3M12 3l3 3M12 21l-3-3M12 21l3-3M3 12l3-3M3 12l3 3M21 12l-3-3M21 12l-3 3"/>' },
  copy: { label: 'Copiar', alias: ['co', 'cp', 'copy', 'copiar', 'copia'], icon: '<rect x="8" y="8" width="12" height="12" rx="1"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/>' },
  rotate: { label: 'Girar', alias: ['ro', 'rotate', 'girar', 'rotar', 'gira'], icon: '<path d="M20 12a8 8 0 1 1-2.3-5.7"/><path d="M20 4v5h-5"/>' },
  scale: { label: 'Escala', alias: ['sc', 'scale', 'escala'], icon: '<rect x="4" y="13" width="7" height="7"/><path d="M10 14l9-9M14 5h5v5"/>' },
  mirror: { label: 'Simetría', alias: ['mi', 'mirror', 'simetria', 'simetría'], icon: '<path d="M12 3v18" stroke-dasharray="2 2"/><path d="M9 7L4 17h5zM15 7l5 10h-5z"/>' },
  offset: { label: 'Desfase', alias: ['o', 'of', 'offset', 'desfase', 'equidist', 'equidistancia'], icon: '<path d="M4 19c3-9 13-9 16 0"/><path d="M4 13c3-9 13-9 16 0" stroke-dasharray="3 2"/>' },
  trim: { label: 'Recortar', alias: ['tr', 'trim', 'recorta', 'recortar'], icon: '<circle cx="6" cy="6" r="2.5"/><circle cx="6" cy="18" r="2.5"/><path d="M8 7.5l12 9M8 16.5l12-9"/>' },
  fillet: { label: 'Empalme', alias: ['f', 'emp', 'fillet', 'empalme', 'redondear'], icon: '<path d="M4 20V11a7 7 0 0 1 7-7h9"/><path d="M4 4h3M4 4v3" stroke-dasharray="1.5 1.5"/>' },
  chamfer: { label: 'Chaflán', alias: ['cha', 'chaflan', 'chaflán', 'chamfer', 'bisel'], icon: '<path d="M4 20V10l6-6h10"/><path d="M4 4h3M4 4v3" stroke-dasharray="1.5 1.5"/>' },
  explode: { label: 'Descomponer', alias: ['x', 'explode', 'descomponer', 'desc'], icon: '<path d="M4 4l5 5M20 4l-5 5M4 20l5-5M20 20l-5-5M12 9v6M9 12h6"/>' },
  erase: { label: 'Borrar', alias: ['e', 'erase', 'borrar', 'borra', 'supr'], icon: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>' },
};

const SNAP_LABEL = { end: 'Punto final', mid: 'Punto medio', cen: 'Centro', quad: 'Cuadrante', int: 'Intersección', near: 'Cercano', ins: 'Inserción' };
export const OSNAP_LABELS = { end: 'Punto final', mid: 'Punto medio', cen: 'Centro', quad: 'Cuadrante', int: 'Intersección', ins: 'Inserción de texto', near: 'Cercano' };

const COS30 = Math.cos(Math.PI / 6);
const ISO_AXES = [30, 90, 150, 210, 270, 330].map(a => a * Math.PI / 180);
/** Punto de la red isométrica más cercano (nodos i·e1 + j·e2, con e1 a 30° y e2 a 150°). */
function isoSnap(p, st) {
  const w = st * COS30;
  const a = p[0] / w, b = 2 * p[1] / st;          // a = i − j, b = i + j
  const fi = (a + b) / 2, fj = (b - a) / 2;
  let best = null, bd = Infinity;
  for (const i of [Math.floor(fi), Math.ceil(fi)]) for (const j of [Math.floor(fj), Math.ceil(fj)]) {
    const q = [(i - j) * w, (i + j) * st / 2], d = dist(q, p);
    if (d < bd) { bd = d; best = q; }
  }
  return best.map(rnd);
}

const DRAW_TOOLS = new Set(['line', 'pline', 'rect', 'circle', 'arc']);

function aliasToCmd(s) {
  for (const [k, v] of Object.entries(CAD_TOOLS)) if (v && v.alias.includes(s)) return k;
  for (const [k, v] of Object.entries(CAD_OPS)) if (v.alias.includes(s)) return k;
  return null;
}

// Envoltorio para órdenes de modificación: primero se designan objetos (si no hay selección).
const modify = (title, impl) => cad => {
  const inner = impl(cad);
  const T = {
    selecting: cad.sel.size === 0,
    start() { if (!T.selecting) inner.begin?.(); },
    prompt: () => (T.selecting ? `${title} · Designa objetos (clic o ventana) y pulsa Intro` : inner.prompt()),
    last: () => (T.selecting ? null : inner.last?.() ?? null),
    point: (p, i) => inner.point?.(p, i),
    input: s => (T.selecting ? false : inner.input?.(s) ?? false),
    enter() {
      if (T.selecting) {
        if (!cad.sel.size) { cad.setTool('select'); return; }
        T.selecting = false;
        inner.begin?.();
        return;
      }
      inner.enter ? inner.enter() : cad.setTool('select');
    },
    preview: () => (T.selecting ? null : inner.preview?.() ?? null),
  };
  return T;
};

/** Ejes de una cota isométrica: u (por donde mide, el eje más parecido a a→b) y w (el de las líneas de referencia, hacia donde se lleva la cota). */
function isoDimAxes(a, b, p) {
  const d = sub(b, a);
  if (len(d) < 1e-12) return null;
  const axes = [30, 90, 150].map(g => [Math.cos(g * Math.PI / 180), Math.sin(g * Math.PI / 180)]);
  let u = axes.reduce((best, ax) => (Math.abs(dot(norm(d), ax)) > Math.abs(dot(norm(d), best)) ? ax : best));
  if (dot(d, u) < 0) u = mul(u, -1);
  const q = sub(p, lerp(a, b, 0.5));
  let w = null, bestAl = Infinity;
  for (const ax of axes) {
    if (ax === u || Math.abs(Math.abs(dot(ax, u)) - 1) < 1e-9) continue;
    const al = Math.abs(inBasis(q, u, ax)[0]);
    if (al < bestAl) { bestAl = al; w = ax; }
  }
  return { u: P(u), w: P(w) };
}

const dimLinear = (kind0, title) => cad => {
  const pts = [];
  const kindAt = p => {
    if (cad.isIso()) return 'iso';
    if (kind0 === 'aligned') return 'aligned';
    const [a, b] = pts;
    const dx = Math.abs(b[0] - a[0]), dy = Math.abs(b[1] - a[1]);
    if (dx < 1e-9) return 'vertical';
    if (dy < 1e-9) return 'horizontal';
    const inX = p[0] >= Math.min(a[0], b[0]) && p[0] <= Math.max(a[0], b[0]);
    const inY = p[1] >= Math.min(a[1], b[1]) && p[1] <= Math.max(a[1], b[1]);
    if (inX && !inY) return 'horizontal';
    if (inY && !inX) return 'vertical';
    const m = lerp(a, b, 0.5);
    return Math.abs(p[1] - m[1]) - dy / 2 >= Math.abs(p[0] - m[0]) - dx / 2 ? 'horizontal' : 'vertical';
  };
  const make = (p, kind) => {
    const e = { type: 'dim', kind, a: P(pts[0]), b: P(pts[1]), p: P(p) };
    if (kind === 'iso') { const ax = isoDimAxes(pts[0], pts[1], p); if (!ax) return null; Object.assign(e, ax); }
    return e;
  };
  const T = () => (cad.isIso() ? 'COTA ISOMÉTRICA' : title);
  return {
    prompt: () => [`${T()} · Origen de la primera línea de referencia`, `${T()} · Origen de la segunda línea de referencia`, `${T()} · Posición de la línea de cota${cad.isIso() ? ' (llévala en la dirección de un eje isométrico)' : ''}`][pts.length],
    last: () => (pts.length === 1 ? pts[0] : null),
    point(p) {
      if (pts.length < 2) { if (pts.length === 1 && dist(p, pts[0]) < 1e-9) return; pts.push(p); return; }
      const e = make(p, kindAt(p));
      if (!e) return;
      cad.add(e);
      cad.commit();
      cad.setTool('select');
    },
    preview() {
      if (!cad.cur) return null;
      if (pts.length === 1) return { guides: [[pts[0], cad.cur]] };
      if (pts.length === 2) { const e = make(cad.cur, kindAt(cad.cur)); return e ? { ents: [e] } : null; }
      return null;
    },
  };
};

/** Cota de radio o diámetro de un círculo isométrico: va por uno de sus dos ejes, con líneas de referencia por el otro. */
function isoCircDim(ent, kind, p) {
  const r = Math.hypot(...ent.U);
  const cands = [[ent.U, ent.V], [ent.V, ent.U]].map(([A, B]) => {
    const u = norm(A), w = norm(B), [al, be] = inBasis(sub(p, ent.c), u, w);
    return { u, w, al, be };
  });
  const k = Math.abs(cands[0].al) <= Math.abs(cands[1].al) ? cands[0] : cands[1];
  // diámetro: de lado a lado; radio: del centro hacia donde está el cursor
  const sgn = k.al >= 0 ? 1 : -1;
  const a = kind === 'diameter' ? sub(ent.c, mul(k.u, r)) : [...ent.c];
  const b = add(ent.c, mul(k.u, kind === 'diameter' ? r : r * sgn));
  return { type: 'dim', kind: 'iso', a: P(a), b: P(b), p: P(p), u: P(kind === 'diameter' ? k.u : mul(k.u, sgn)), w: P(k.w), pre: kind === 'diameter' ? 'Ø' : 'R' };
}

/** EMPALME / CHAFLÁN: entre dos líneas, en un vértice de polilínea o en todas sus esquinas (T). */
function cornerTool(cad, chamfer) {
  const T = chamfer ? 'CHAFLÁN' : 'EMPALME', what = chamfer ? 'Distancia' : 'Radio';
  const key = chamfer ? 'lastChamfer' : 'lastFillet';
  let size = null, first = null, all = false;
  const F = v => fmtNum(v, cad.drawing);
  const apply = fn => { const r = fn(); if (r?.error) cad.message(r.error); else { cad.commit(); cad.message(r?.msg || `${T.toLowerCase()} hecho`); } };
  const lineCorner = (A, B) => {
    const ea = A.e, eb = B.e;
    const V = lineLine(ea.a, ea.b, eb.a, eb.b);
    if (!V) return { error: 'Las líneas son paralelas: no tienen esquina' };
    // de cada línea se conserva el lado en el que se ha hecho clic
    const keep = (e, click) => {
      const d = norm(sub(e.b, e.a)), s = Math.sign(dot(sub(click, V), d)) || 1;
      return dot(sub(e.a, V), d) * s >= dot(sub(e.b, V), d) * s ? e.a : e.b;
    };
    const fa = keep(ea, A.raw), fb = keep(eb, B.raw);
    const r = cornerCut(V, fa, fb, size, chamfer);
    if (r.error) return r;
    const t1 = size > 0 ? r.t1 : V, t2 = size > 0 ? r.t2 : V;
    cad.updateEntity(ea.id, { a: P(fa), b: P(t1) }, false);
    cad.updateEntity(eb.id, { a: P(fb), b: P(t2) }, false);
    if (size > 0) {
      if (chamfer) cad.add({ type: 'line', a: P(r.t1), b: P(r.t2), layer: ea.layer, ...(ea.lt ? { lt: ea.lt } : {}) });
      else cad.add({ type: 'arc', c: P(r.arc.c), r: rnd(r.arc.r), a0: r.arc.a0, a1: r.arc.a1, layer: ea.layer, ...(ea.lt ? { lt: ea.lt } : {}) });
    }
    return { msg: size > 0 ? `${chamfer ? 'Chaflán' : 'Empalme'} de ${F(size)} entre las dos líneas` : 'Líneas recortadas / alargadas hasta su esquina' };
  };
  return {
    get pickMode() { return size !== null; },
    pickFilter: e => e.type === 'line' || e.type === 'pline',
    prompt: () => (size === null
      ? `${T} · ${what}${cad[key] != null ? ` (Intro: ${F(cad[key])})` : ''} · 0 = recortar las dos líneas hasta su esquina`
      : !first ? `${T} (${what.toLowerCase()} ${F(size)}${all ? ' · TODAS las esquinas' : ''}) · Designa la primera línea o una esquina de polilínea [T: todas las esquinas · ${what[0]}: cambiar ${what.toLowerCase()}] · Intro: terminar`
        : `${T} (${what.toLowerCase()} ${F(size)}) · Designa la segunda línea`),
    last: () => null,
    input(s) {
      if (size === null) { const v = parseNum(s); if (v === null || v < 0) return false; size = v; cad[key] = v; return true; }
      if (/^t$/i.test(s)) { all = !all; cad.message(all ? 'Se redondearán todas las esquinas de la polilínea que designes' : 'Solo la esquina designada'); return true; }
      if (new RegExp(`^${what[0]}$`, 'i').test(s)) { size = null; first = null; return true; }
      return false;
    },
    enter() { if (size === null && cad[key] != null) { size = cad[key]; return; } if (first) { first = null; return; } cad.setTool('select'); },
    pick(e, raw) {
      if (!e) { cad.message('Designa una línea o una polilínea'); return; }
      if (e.type === 'pline') {
        if (first) { cad.message('Designa otra línea (o Esc y designa la esquina de la polilínea)'); return; }
        let idx = 0, bd = Infinity;
        e.pts.forEach((p, i) => { const d = dist(p, raw); if (d < bd) { bd = d; idx = i; } });
        apply(() => {
          const r = cornerPline(e, all ? 'all' : idx, size, chamfer);
          if (r.error) return r;
          cad.updateEntity(e.id, { pts: r.ent.pts }, false);
          return { msg: `${chamfer ? 'Chaflán' : 'Empalme'} de ${F(size)} en ${r.done} esquina${r.done > 1 ? 's' : ''}` };
        });
        return;
      }
      if (!first) { first = { e, raw }; return; }
      if (e.id === first.e.id) { cad.message('Designa una línea distinta'); return; }
      const A = first;
      first = null;
      apply(() => lineCorner({ e: cad.byId(A.e.id), raw: A.raw }, { e, raw }));
    },
    preview() {
      if (size === null || !cad.hover || !cad.raw) return null;
      const h = cad.hover;
      if (h.type === 'pline' && !first) {
        let idx = 0, bd = Infinity;
        h.pts.forEach((p, i) => { const d = dist(p, cad.raw); if (d < bd) { bd = d; idx = i; } });
        const r = cornerPline(h, all ? 'all' : idx, size, chamfer);
        return r.error ? null : { ents: [{ ...r.ent, id: undefined }] };
      }
      return null;
    },
  };
}

const dimCirc = kind => cad => {
  let ent = null;
  return {
    get pickMode() { return !ent; },
    pickFilter: e => e.type === 'circle' || e.type === 'arc' || e.type === 'ellipse',
    prompt: () => (ent ? (ent.type === 'ellipse' ? 'COTA ISOMÉTRICA · Lleva la cota hacia donde quieras ponerla (va por uno de los ejes del círculo isométrico)' : 'COTA · Posición del texto')
      : `COTA DE ${kind === 'radius' ? 'RADIO' : 'DIÁMETRO'} · Designa un círculo, un arco o un círculo isométrico`),
    last: () => null,
    pick(e) { if (!e) { cad.message('Designa un círculo o un arco'); return; } ent = e; },
    point(p) {
      if (!ent) return;
      cad.add(ent.type === 'ellipse' ? isoCircDim(ent, kind, p) : { type: 'dim', kind, c: P(ent.c), r: ent.r, p: P(p) });
      cad.commit();
      cad.setTool('select');
    },
    preview: () => (ent && cad.cur ? { ents: [ent.type === 'ellipse' ? isoCircDim(ent, kind, cad.cur) : { type: 'dim', kind, c: ent.c, r: ent.r, p: cad.cur }] } : null),
  };
};

const TOOLS = {
  line: cad => {
    const pts = [], made = [];
    return {
      prompt: () => (pts.length ? 'LÍNEA · Siguiente punto [C: cerrar · H: deshacer · Intro: terminar]' : 'LÍNEA · Primer punto'),
      last: () => pts[pts.length - 1] || null,
      point(p) {
        if (pts.length) {
          if (dist(p, pts[pts.length - 1]) < 1e-9) return;
          made.push(cad.add({ type: 'line', a: P(pts[pts.length - 1]), b: P(p) }).id);
          cad.commit();
        }
        pts.push(p);
      },
      input(s) {
        const t = s.toLowerCase();
        if (t === 'c' && pts.length > 2) { cad.add({ type: 'line', a: P(pts[pts.length - 1]), b: P(pts[0]) }); cad.commit(); cad.setTool('select'); return true; }
        if ((t === 'h' || t === 'u' || t === 'd') && pts.length) {
          pts.pop();
          const id = made.pop();
          if (id) { cad.remove([id]); cad.commit(); }
          return true;
        }
        return false;
      },
      preview: () => (pts.length && cad.cur ? { ents: [{ type: 'line', a: pts[pts.length - 1], b: cad.cur }] } : null),
      extraSnaps: () => (pts.length > 2 ? [{ p: pts[0], k: 'end' }] : []),
    };
  },
  pline: cad => {
    const pts = [];
    const finish = closed => {
      if (pts.length >= (closed ? 3 : 2)) { cad.add({ type: 'pline', pts: pts.map(P), closed }); cad.commit(); }
      cad.setTool('select');
    };
    return {
      prompt: () => (pts.length ? `POLILÍNEA · Siguiente punto [C: cerrar · H: deshacer · Intro: terminar] · ${pts.length} puntos` : 'POLILÍNEA · Primer punto'),
      last: () => pts[pts.length - 1] || null,
      point(p) {
        if (pts.length > 2 && dist(p, pts[0]) < 1e-9) { finish(true); return; }
        if (pts.length && dist(p, pts[pts.length - 1]) < 1e-9) return;
        pts.push(p);
      },
      input(s) {
        const t = s.toLowerCase();
        if (t === 'c') { finish(true); return true; }
        if ((t === 'h' || t === 'u' || t === 'd') && pts.length) { pts.pop(); return true; }
        return false;
      },
      enter: () => finish(false),
      preview: () => (pts.length && cad.cur ? { ents: [{ type: 'pline', pts: [...pts, cad.cur], closed: false }] } : null),
      extraSnaps: () => (pts.length > 2 ? [{ p: pts[0], k: 'end' }] : []),
    };
  },
  rect: cad => {
    let a = null;
    // en modo isométrico el «rectángulo» es el paralelogramo de la cara activa (lados por sus dos ejes)
    const iso = () => cad.isIso();
    const corners = b => {
      if (!iso()) return [a, [b[0], a[1]], b, [a[0], b[1]]];
      const [u, v] = isoAxes(cad.isoV());
      const [s1, t1] = inBasis(sub(b, a), u, v);
      return [a, add(a, mul(u, s1)), b, add(a, mul(v, t1))];
    };
    const make = b => {
      const c = corners(b);
      if (dist(c[0], c[1]) < 1e-9 || dist(c[0], c[3]) < 1e-9) { cad.message('El rectángulo no puede tener un lado de longitud 0'); return; }
      cad.add({ type: 'pline', pts: c.map(P), closed: true });
      cad.commit();
      cad.setTool('select');
    };
    const title = () => (iso() ? `RECTÁNGULO ISOMÉTRICO (cara ${ISO_PLANES[cad.isoV()?.isoPlane || 'top'].label.toLowerCase()}, Tab cambia)` : 'RECTÁNGULO');
    return {
      prompt: () => (a ? `${title()} · Esquina opuesta (o ancho x alto, p. ej. 80x40${iso() ? ', medidos sobre los ejes isométricos' : ', o @80,40'})` : `${title()} · Primera esquina`),
      last: () => a,
      point(p) { if (!a) a = p; else make(p); },
      input(s) {
        const m = s.match(/^\s*(-?[\d.,]+)\s*[x×*]\s*(-?[\d.,]+)\s*$/i);
        if (m && a) {
          const w = parseNum(m[1]), h = parseNum(m[2]);
          if (w !== null && h !== null) {
            if (iso()) { const [u, v] = isoAxes(cad.isoV()); make(add(a, add(mul(u, w), mul(v, h)))); } else make(add(a, [w, h]));
            return true;
          }
        }
        return false;
      },
      preview: () => (a && cad.cur ? { ents: [{ type: 'pline', pts: corners(cad.cur), closed: true }] } : null),
    };
  },
  circle: cad => {
    let c = null;
    // en modo isométrico, el círculo de la cara activa se ve como una elipse (círculo isométrico)
    const iso = () => cad.isIso();
    const ent = r => {
      if (!iso()) return { type: 'circle', c: P(c), r: rnd(r) };
      const [u, v] = isoAxes(cad.isoV());
      return { type: 'ellipse', c: P(c), U: P(mul(u, r)), V: P(mul(v, r)) };
    };
    const radiusTo = p => (iso() ? Math.hypot(...inBasis(sub(p, c), ...isoAxes(cad.isoV()))) : dist(c, p));
    const make = r => {
      if (!(r > 0)) { cad.message('El radio debe ser mayor que 0'); return; }
      cad.add(ent(r));
      cad.commit();
      cad.setTool('select');
    };
    const title = () => (iso() ? `CÍRCULO ISOMÉTRICO (cara ${ISO_PLANES[cad.isoV()?.isoPlane || 'top'].label.toLowerCase()}, Tab cambia)` : 'CÍRCULO');
    return {
      prompt: () => (c ? `${title()} · Radio (número) o D y el diámetro (p. ej. D30)` : `${title()} · Centro`),
      last: () => c,
      point(p) { if (!c) c = p; else make(radiusTo(p)); },
      input(s) {
        if (!c) return false;
        const m = s.match(/^\s*[dDØø]\s*([\d.,]+)\s*$/);
        if (m) { make(parseNum(m[1]) / 2); return true; }
        const v = parseNum(s);
        if (v !== null) { make(v); return true; }
        return false;
      },
      preview: () => (c && cad.cur && radiusTo(cad.cur) > 1e-9 ? { ents: [ent(radiusTo(cad.cur))], guides: [[c, cad.cur]] } : null),
    };
  },
  arc: cad => {
    const pts = [];
    const build = (p1, p2, p3) => {
      const c = circumcenter(p1, p2, p3);
      if (!c) return null;
      let a0 = angOf(c, p1), a1 = angOf(c, p3);
      if (!inSweep(angOf(c, p2), a0, a1)) [a0, a1] = [a1, a0];
      return { type: 'arc', c, r: dist(c, p1), a0: normA(a0), a1: normA(a1) };
    };
    return {
      prompt: () => ['ARCO · Punto inicial', 'ARCO · Segundo punto (por donde pasa el arco)', 'ARCO · Punto final'][pts.length],
      last: () => pts[pts.length - 1] || null,
      point(p) {
        pts.push(p);
        if (pts.length < 3) return;
        const a = build(...pts);
        if (!a) { cad.message('Los tres puntos están alineados: no forman un arco'); pts.pop(); return; }
        a.c = P(a.c); a.r = rnd(a.r);
        cad.add(a);
        cad.commit();
        cad.setTool('select');
      },
      preview() {
        if (!cad.cur || !pts.length) return null;
        if (pts.length === 1) return { guides: [[pts[0], cad.cur]] };
        const a = build(pts[0], pts[1], cad.cur);
        return a ? { ents: [a] } : { guides: [[pts[0], cad.cur]] };
      },
    };
  },
  text: cad => {
    let p = null;
    return {
      prompt: () => (p ? 'TEXTO · Escribe el texto y pulsa Intro' : 'TEXTO · Punto de inserción (abajo a la izquierda del texto)'),
      last: () => null,
      textEntry: () => !!p,
      point(q) { if (!p) p = q; },
      input(s) {
        if (!p) return false;
        cad.add({ type: 'text', p: P(p), text: s, h: cad.drawing.textH, rot: 0 });
        cad.commit();
        cad.setTool('select');
        return true;
      },
      preview: () => (p ? { marker: p } : null),
    };
  },
  dimlin: dimLinear('linear', 'COTA LINEAL'),
  dimali: dimLinear('aligned', 'COTA ALINEADA'),
  dimrad: dimCirc('radius'),
  dimdia: dimCirc('diameter'),
  dimang: cad => {
    let s1 = null, s2 = null, c = null;
    const segOf = (e, raw) => {
      let best = null, bd = Infinity;
      for (const pr of prims(e)) if (pr.k === 's') { const d = segDist(raw, pr.a, pr.b).d; if (d < bd) { bd = d; best = pr; } }
      return best;
    };
    const far = s => (dist(s.a, c) > dist(s.b, c) ? s.a : s.b);
    const geom = p => {
      const d1 = norm(sub(far(s1), c)), d2 = norm(sub(far(s2), c));
      const cands = [];
      for (const [r1, sa] of [[d1, s1], [mul(d1, -1), s1]]) {
        for (const [r2, sb] of [[d2, s2], [mul(d2, -1), s2]]) {
          const A1 = Math.atan2(r1[1], r1[0]), A2 = Math.atan2(r2[1], r2[0]);
          for (const [x, y, sx, sy] of [[A1, A2, sa, sb], [A2, A1, sb, sa]]) {
            const sw = sweepOf(x, y);
            if (sw < Math.PI + 1e-9 && inSweep(angOf(c, p), x, y)) cands.push({ x, y, sw, sx, sy });
          }
        }
      }
      cands.sort((u, v) => u.sw - v.sw);
      const k = cands[0] || { x: Math.atan2(d1[1], d1[0]), y: Math.atan2(d2[1], d2[0]), sx: s1, sy: s2 };
      const ext = (s, ang) => { const u = [Math.cos(ang), Math.sin(ang)]; return Math.max(0, dot(sub(s.a, c), u), dot(sub(s.b, c), u)); };
      return { type: 'dim', kind: 'angle', c: P(c), a1: normA(k.x), a2: normA(k.y), p: P(p), e1: rnd(ext(k.sx, k.x)), e2: rnd(ext(k.sy, k.y)) };
    };
    return {
      get pickMode() { return !s2; },
      pickFilter: e => e.type === 'line' || e.type === 'pline',
      prompt: () => (!s1 ? 'COTA ANGULAR · Designa la primera línea' : !s2 ? 'COTA ANGULAR · Designa la segunda línea' : 'COTA ANGULAR · Posición del arco de cota'),
      last: () => null,
      pick(e, raw) {
        if (!e) { cad.message('Designa una línea o un tramo de polilínea'); return; }
        const s = segOf(e, raw);
        if (!s) return;
        if (!s1) { s1 = s; return; }
        const r = lineLine(s1.a, s1.b, s.a, s.b);
        if (!r) { cad.message('Las líneas son paralelas: no forman ángulo'); return; }
        s2 = s; c = r;
      },
      point(p) { if (!s2) return; cad.add(geom(p)); cad.commit(); cad.setTool('select'); },
      preview: () => (s2 && cad.cur ? { ents: [geom(cad.cur)] } : null),
    };
  },
  measure: cad => {
    let a = null;
    return {
      prompt: () => (a ? 'MEDIR · Segundo punto' : 'MEDIR · Primer punto (para longitudes y áreas, selecciona el objeto y mira sus propiedades)'),
      last: () => a,
      point(p) {
        if (!a) { a = p; cad.measure = null; return; }
        const D = cad.drawing, u = D.units === 'u' ? '' : ` ${D.units}`;
        const d = dist(a, p);
        cad.measure = { a, b: p };
        cad.message(`Distancia = ${fmtNum(d, D)}${u} · ΔX = ${fmtNum(p[0] - a[0], D)} · ΔY = ${fmtNum(p[1] - a[1], D)} · Ángulo = ${fmtNum(normA(angOf(a, p)) * DEG, D, 2)}°`);
        a = null;
      },
      preview: () => (a && cad.cur ? { guides: [[a, cad.cur]] } : null),
    };
  },
  move: modify('DESPLAZAR', cad => {
    let base = null;
    return {
      prompt: () => (base ? 'DESPLAZAR · Segundo punto (o @dx,dy)' : 'DESPLAZAR · Punto base'),
      last: () => base,
      point(p) {
        if (!base) { base = p; return; }
        const d = sub(p, base);
        cad.transformSel(q => add(q, d));
        cad.commit();
        cad.setTool('select');
      },
      preview: () => (base && cad.cur ? { ents: cad.selEnts().map(e => xform(e, q => add(q, sub(cad.cur, base)))), guides: [[base, cad.cur]] } : null),
    };
  }),
  copy: modify('COPIAR', cad => {
    let base = null, n = 0;
    return {
      prompt: () => (base ? `COPIAR · Segundo punto (Intro: terminar)${n ? ` · ${n} copia${n > 1 ? 's' : ''}` : ''}` : 'COPIAR · Punto base'),
      last: () => base,
      point(p) {
        if (!base) { base = p; return; }
        const d = sub(p, base);
        cad.transformSel(q => add(q, d), {}, true);
        n++;
        cad.commit();
      },
      preview: () => (base && cad.cur ? { ents: cad.selEnts().map(e => xform(e, q => add(q, sub(cad.cur, base)))), guides: [[base, cad.cur]] } : null),
    };
  }),
  rotate: modify('GIRAR', cad => {
    let base = null;
    const apply = ang => { cad.transformSel(q => rotP(q, base, ang), { rot: ang }); cad.commit(); cad.setTool('select'); };
    return {
      prompt: () => (base ? 'GIRAR · Ángulo en grados (positivo: antihorario) o señala un punto' : 'GIRAR · Punto base'),
      last: () => base,
      point(p) { if (!base) { base = p; return; } if (dist(base, p) > 1e-9) apply(angOf(base, p)); },
      input(s) { if (!base) return false; const v = parseNum(s); if (v === null) return false; apply(v / DEG); return true; },
      preview() {
        if (!base || !cad.cur || dist(base, cad.cur) < 1e-9) return null;
        const ang = angOf(base, cad.cur);
        return { ents: cad.selEnts().map(e => xform(e, q => rotP(q, base, ang), { rot: ang })), guides: [[base, cad.cur]] };
      },
    };
  }),
  scale: modify('ESCALA', cad => {
    let base = null, ref = null;
    const S = f => q => add(base, mul(sub(q, base), f));
    const apply = f => {
      if (!(f > 0)) { cad.message('El factor de escala debe ser mayor que 0'); return; }
      cad.transformSel(S(f), { scale: f });
      cad.commit();
      cad.setTool('select');
    };
    return {
      prompt: () => (!base ? 'ESCALA · Punto base' : !ref ? 'ESCALA · Factor (número, p. ej. 2 o 0,5) o señala un punto de referencia' : 'ESCALA · Nuevo punto (factor = nueva distancia ÷ distancia de referencia)'),
      last: () => base,
      point(p) {
        if (!base) { base = p; return; }
        if (!ref) { if (dist(p, base) > 1e-9) ref = p; return; }
        apply(dist(base, p) / dist(base, ref));
      },
      input(s) { if (!base) return false; const v = parseNum(s); if (v === null) return false; apply(v); return true; },
      preview() {
        if (!base || !ref || !cad.cur) return null;
        const f = dist(base, cad.cur) / dist(base, ref);
        return { ents: cad.selEnts().map(e => xform(e, S(f), { scale: f })), guides: [[base, cad.cur]] };
      },
    };
  }),
  mirror: modify('SIMETRÍA', cad => {
    let a = null, erase = false;
    return {
      prompt: () => (!a ? 'SIMETRÍA · Primer punto del eje' : `SIMETRÍA · Segundo punto del eje [B: ${erase ? 'conservar' : 'borrar'} los originales]`),
      last: () => a,
      point(p) {
        if (!a) { a = p; return; }
        if (dist(a, p) < 1e-9) return;
        cad.transformSel(q => reflect(q, a, p), { mirror: true }, !erase);
        cad.commit();
        cad.setTool('select');
      },
      input(s) { if (a && /^b$/i.test(s)) { erase = !erase; return true; } return false; },
      preview: () => (a && cad.cur && dist(a, cad.cur) > 1e-9
        ? { ents: cad.selEnts().map(e => xform(e, q => reflect(q, a, cad.cur), { mirror: true })), guides: [[a, cad.cur]] } : null),
    };
  }),
  offset: cad => {
    let d = null, target = null;
    return {
      get pickMode() { return d !== null && !target; },
      pickFilter: e => ['line', 'pline', 'circle', 'arc', 'ellipse'].includes(e.type),
      prompt: () => (d === null ? `DESFASE · Distancia${cad.lastOffset ? ` (Intro: ${fmtNum(cad.lastOffset, cad.drawing)})` : ''}`
        : !target ? `DESFASE (${fmtNum(d, cad.drawing)}) · Designa una línea, polilínea, círculo o arco (Intro: terminar)` : 'DESFASE · Señala hacia qué lado'),
      last: () => null,
      input(s) {
        if (d !== null) return false;
        const v = parseNum(s);
        if (v === null || !(v > 0)) return false;
        d = v; cad.lastOffset = v;
        return true;
      },
      enter() { if (d === null && cad.lastOffset) { d = cad.lastOffset; return; } cad.setTool('select'); },
      pick(e) { if (!e) { cad.message('Designa una línea, polilínea, círculo o arco'); return; } target = e; },
      point(p) {
        if (d === null) { cad.message('Escribe primero la distancia de desfase'); return; }
        if (!target) return;
        const r = offsetEntity(target, d, p);
        if (!r) cad.message('No se puede desfasar hacia ese lado (el radio sería negativo)');
        else { cad.add({ ...r, layer: target.layer, ...(target.lt ? { lt: target.lt } : {}) }); cad.commit(); }
        target = null;
      },
      preview() { if (!target || !cad.cur) return null; const r = offsetEntity(target, d, cad.cur); return r ? { ents: [r] } : null; },
    };
  },
  fillet: cad => cornerTool(cad, false),
  chamfer: cad => cornerTool(cad, true),
  trim: cad => ({
    pickMode: true,
    pickFilter: e => ['line', 'pline', 'circle', 'arc'].includes(e.type),
    prompt: () => 'RECORTAR · Designa la parte que quieres quitar (el resto de objetos cortan) · Intro: terminar',
    last: () => null,
    pick(e, raw) { if (e && cad.trimAt(e, raw)) cad.commit(); },
    preview() {
      const e = cad.hover;
      if (!e || !cad.raw) return null;
      const r = trimCompute(e, cad.raw, cad.others(e));
      return r ? { removed: r.removed } : null;
    },
  }),
  // Pegar lo copiado con Ctrl+C (o duplicar con Ctrl+D): los objetos siguen al cursor
  paste: cad => {
    const src = cad.clipboard || [];
    const bb = cad.extents(src) || [0, 0, 0, 0];
    const base = [bb[0], bb[1]];
    let n = 0;
    const at = p => src.map(e => xform(e, q => add(q, sub(p, base))));
    return {
      prompt: () => `PEGAR · Punto de inserción (esquina inferior izquierda de lo copiado)${n ? ` · ${n} vez${n > 1 ? 'es' : ''} · Intro o Esc: terminar` : ''}`,
      last: () => null,
      point(p) {
        const ids = at(p).map((e, k) => cad.add({ ...e, layer: src[k].layer }).id);
        n++;
        cad.commit();
        cad.sel = new Set(ids);
        cad.emit('select');
      },
      enter() { cad.setTool('select'); },
      preview: () => (cad.cur ? { ents: at(cad.cur) } : null),
    };
  },
  erase: modify('BORRAR', cad => ({ begin() { cad.eraseSel(); cad.setTool('select'); }, prompt: () => '' })),
  explode: modify('DESCOMPONER', cad => ({ begin() { cad.explodeSel(); cad.setTool('select'); }, prompt: () => '' })),
};

// =================================================================== controlador del plano
export class Cad extends EventTarget {
  constructor() {
    super();
    this.drawing = emptyDrawing();
    this.views = new Set();
    this.sel = new Set();
    this.toolName = 'select';
    this.T = null;
    this.osnapOn = true;
    this.osnap = { end: true, mid: true, cen: true, quad: true, int: true, ins: true, near: false };
    this.ortho = false;
    this.gridSnap = false;
    this.hist = [JSON.stringify(this.drawing)];
    this.hi = 0;
    this.cur = null; this.raw = null; this.snapHit = null; this.hover = null;
    this.win = null; this.drag = null; this.measure = null;
    this.lastCmd = null; this.lastOffset = null;
    this.activeView = null;
    this._raf = 0;
    try {
      const s = JSON.parse(localStorage.getItem('forja3d:cad') || '{}');
      if (s.osnap) Object.assign(this.osnap, s.osnap);
      if (s.osnapOn != null) this.osnapOn = s.osnapOn;
      if (s.ortho != null) this.ortho = s.ortho;
      if (s.gridSnap != null) this.gridSnap = s.gridSnap;
    } catch { /* sin preferencias */ }
  }

  emit(type, detail) { this.dispatchEvent(new CustomEvent(type, { detail })); }

  /** Panel cuyo modo (normal / isométrico) manda: donde está el ratón o, si no, el panel activo. */
  isoV() { return this.activeView || this.focusView || [...this.views].find(v => v.visible) || null; }
  isIso() { return !!this.isoV()?.iso; }

  savePrefs() {
    try { localStorage.setItem('forja3d:cad', JSON.stringify({ osnap: this.osnap, osnapOn: this.osnapOn, ortho: this.ortho, gridSnap: this.gridSnap })); } catch { /* nada */ }
  }

  // ------------------------------------------------------------- documento
  setDrawing(d) {
    this.cancel(true);
    this.drawing = normalizeDrawing(d);
    this.sel.clear();
    this.measure = null;
    this.hist = [JSON.stringify(this.drawing)];
    this.hi = 0;
    this.emitHistory();
    this.emit('select');
    this.emitPrompt();
    for (const v of this.views) v.fitted = false;
    this.redraw();
  }

  /**
   * Estado de trabajo del plano actual (dibujo, deshacer/rehacer, selección y encuadre de cada panel),
   * para cambiar de hoja y volver a ella tal como estaba.
   */
  stash() {
    this.cancel(true);
    return {
      drawing: this.drawing, hist: this.hist, hi: this.hi, sel: [...this.sel],
      views: new Map([...this.views].map(v => [v, { cx: v.cx, cy: v.cy, zoom: v.zoom, fitted: v.fitted }])),
    };
  }

  unstash(S) {
    this.cancel(true);
    this.drawing = S.drawing;
    this.hist = S.hist; this.hi = S.hi;
    this.sel = new Set(S.sel.filter(id => this.byId(id)));
    this.measure = null;
    for (const v of this.views) {
      const st = S.views?.get(v);
      if (st) Object.assign(v, st); else v.fitted = false;
    }
    this.emitHistory();
    this.emit('select');
    this.emitPrompt();
    this.redraw();
  }

  /** El plano del proyecto (durante un croquis, el plano guardado, no el croquis). */
  getDrawing() { return this._planSaved ? this._planSaved.drawing : this.drawing; }

  /**
   * Croquis: el editor 2D pasa a trabajar sobre `drawing` (el perfil de una pieza 3D).
   * El plano del proyecto, su historial y su selección se guardan y vuelven intactos con endSketch().
   * info: { kind: 'extrude' | 'lathe', name, plane }
   */
  beginSketch(drawing, info) {
    if (this._planSaved) this.endSketch();
    this.cancel(true);
    this._planSaved = { drawing: this.drawing, hist: this.hist, hi: this.hi, sel: [...this.sel] };
    this.sketch = info;
    this.setDrawing(drawing);
    this.emit('sketch', info);
  }

  endSketch() {
    const S = this._planSaved;
    if (!S) return;
    this.cancel(true);
    this._planSaved = null;
    this.sketch = null;
    this.drawing = S.drawing;
    this.hist = S.hist; this.hi = S.hi;
    this.sel = new Set(S.sel.filter(id => this.byId(id)));
    this.measure = null;
    this.emitHistory();
    this.emit('select');
    this.emitPrompt();
    this.emit('sketch', null);
    this.redraw();
  }
  isEmpty() { return !this.drawing.entities.length; }
  layer(name) { return this.drawing.layers.find(l => l.name === name); }
  byId(id) { return this.drawing.entities.find(e => e.id === id); }
  selEnts() { return this.drawing.entities.filter(e => this.sel.has(e.id)); }

  visibleEntities() {
    const hidden = new Set(this.drawing.layers.filter(l => l.visible === false).map(l => l.name));
    return this.drawing.entities.filter(e => !hidden.has(e.layer));
  }

  layerFor(type) {
    const D = this.drawing, cur = D.current;
    if (cur === D.layers[0]?.name) {
      if (type === 'dim' && this.layer('Cotas')) return 'Cotas';
      if (type === 'text' && this.layer('Texto')) return 'Texto';
    }
    return cur;
  }

  add(e) {
    const n = { ...e, id: eid() };
    if (!n.layer || !this.layer(n.layer)) n.layer = this.layerFor(n.type);
    // estilo de línea activo al dibujar (p. ej. Lápiz): solo para lo que se dibuja ahora, no para copias ni recortes
    if (!n.lt && this.drawing.curLt && DRAW_TOOLS.has(this.toolName) && ['line', 'pline', 'circle', 'arc', 'ellipse'].includes(n.type)) n.lt = this.drawing.curLt;
    this.drawing.entities.push(n);
    return n;
  }

  remove(ids) {
    const s = new Set(ids);
    this.drawing.entities = this.drawing.entities.filter(e => !s.has(e.id));
    for (const id of ids) this.sel.delete(id);
  }

  updateEntity(id, fn, commit = true) {
    const i = this.drawing.entities.findIndex(e => e.id === id);
    if (i < 0) return;
    const e = this.drawing.entities[i];
    const n = typeof fn === 'function' ? fn(structuredClone(e)) : { ...e, ...fn };
    n.id = e.id;
    this.drawing.entities[i] = n;
    if (commit) this.commit(); else this.redraw();
  }

  setSetting(key, value) { this.drawing[key] = value; this.commit(); }

  // ------------------------------------------------------------- capas
  setCurrentLayer(name) { if (this.layer(name)) { this.drawing.current = name; this.commit(); } }

  updateLayer(name, patch) {
    const L = this.layer(name);
    if (!L) return false;
    if (patch.name !== undefined && patch.name !== name) {
      const nn = patch.name.trim();
      if (!nn || this.layer(nn)) { this.message('Ya existe una capa con ese nombre'); return false; }
      for (const e of this.drawing.entities) if (e.layer === name) e.layer = nn;
      if (this.drawing.current === name) this.drawing.current = nn;
      patch = { ...patch, name: nn };
    }
    Object.assign(L, patch);
    this.commit();
    return true;
  }

  addLayer(name) {
    name = String(name || '').trim();
    if (!name) return false;
    if (this.layer(name)) { this.message('Ya existe una capa con ese nombre'); return false; }
    const color = LAYER_COLORS[this.drawing.layers.length % LAYER_COLORS.length];
    this.drawing.layers.push({ name, color, lt: 'continuous', lw: 'thin', visible: true });
    this.drawing.current = name;
    this.commit();
    return true;
  }

  removeLayer(name) {
    const D = this.drawing;
    if (D.layers.length <= 1) return false;
    const target = D.layers.find(l => l.name !== name).name;
    for (const e of D.entities) if (e.layer === name) e.layer = D.current === name ? target : D.current;
    D.layers = D.layers.filter(l => l.name !== name);
    if (D.current === name) D.current = target;
    this.commit();
    return true;
  }

  layerCount(name) { return this.drawing.entities.filter(e => e.layer === name).length; }

  // ------------------------------------------------------------- historial
  commit() {
    const s = JSON.stringify(this.drawing);
    if (s !== this.hist[this.hi]) {
      this.hist.length = this.hi + 1;
      this.hist.push(s);
      if (this.hist.length > 200) this.hist.shift();
      this.hi = this.hist.length - 1;
      this.emitHistory();
      this.emit('change');
    }
    this.redraw();
  }

  emitHistory() { this.emit('history', { canUndo: this.hi > 0, canRedo: this.hi < this.hist.length - 1 }); }

  _restore(i) {
    this.cancel(true);
    this.hi = i;
    this.drawing = JSON.parse(this.hist[i]);
    const ids = new Set(this.drawing.entities.map(e => e.id));
    for (const id of [...this.sel]) if (!ids.has(id)) this.sel.delete(id);
    this.emitHistory();
    this.emit('change');
    this.emit('select');
    this.emitPrompt();
    this.redraw();
  }

  undo() { if (this.hi > 0) this._restore(this.hi - 1); }
  redo() { if (this.hi < this.hist.length - 1) this._restore(this.hi + 1); }

  // ------------------------------------------------------------- selección
  setSel(ids) { this.sel = new Set(ids); this.emit('select'); this.emitPrompt(); this.redraw(); }
  selectAll() { this.setSel(this.visibleEntities().map(e => e.id)); }

  transformSel(f, o = {}, copy = false) {
    const ents = this.selEnts();
    for (const e of ents) {
      const n = xform(e, f, o);
      if (copy) this.add({ ...n, layer: e.layer });
      else this.drawing.entities[this.drawing.entities.indexOf(e)] = n;
    }
  }

  eraseSel() {
    if (!this.sel.size) return;
    const n = this.sel.size;
    this.remove([...this.sel]);
    this.commit();
    this.emit('select');
    this.message(`${n} objeto${n > 1 ? 's' : ''} borrado${n > 1 ? 's' : ''}`);
  }

  explodeSel() {
    let n = 0;
    for (const e of this.selEnts()) {
      if (e.type !== 'pline') continue;
      this.remove([e.id]);
      for (const s of prims(e)) this.add({ type: 'line', a: [...s.a], b: [...s.b], layer: e.layer, ...(e.lt ? { lt: e.lt } : {}) });
      n++;
    }
    this.sel.clear();
    if (n) this.commit();
    this.emit('select');
    this.message(n ? `${n} polilínea${n > 1 ? 's' : ''} descompuesta${n > 1 ? 's' : ''} en líneas` : 'Solo se pueden descomponer polilíneas y rectángulos');
  }

  others(e) {
    const b = bboxOf(e, this.drawing);
    return this.visibleEntities().filter(o => o !== e && ['line', 'pline', 'circle', 'arc', 'ellipse'].includes(o.type) && (() => {
      const q = bboxOf(o, this.drawing);
      return q[0] <= b[2] + 1e-9 && q[2] >= b[0] - 1e-9 && q[1] <= b[3] + 1e-9 && q[3] >= b[1] - 1e-9;
    })());
  }

  trimAt(e, raw) {
    const r = trimCompute(e, raw, this.others(e));
    if (!r) return false;
    this.remove([e.id]);
    for (const p of r.pieces) this.add({ ...p, layer: e.layer, ...(e.lt ? { lt: e.lt } : {}) });
    this.hover = null;
    return true;
  }

  // ------------------------------------------------------------- órdenes
  setTool(name) {
    this.cancel(true);
    if (name === 'select' || !TOOLS[name]) {
      this.T = null;
      this.toolName = 'select';
    } else {
      this.toolName = name;
      this.T = TOOLS[name](this);
      if (name !== 'paste') this.lastCmd = name;
      this.measure = null;
      this.T.start?.();
    }
    this.emit('tool', this.toolName);
    this.emitPrompt();
    this.redraw();
  }

  runOp(name) {
    if (name === 'erase' && this.sel.size) { this.eraseSel(); return; }
    if (name === 'explode' && this.sel.size) { this.explodeSel(); return; }
    this.setTool(name);
  }

  cancel(silent) {
    this.T?.cancel?.();
    this.T = null;
    this.toolName = 'select';
    this.win = null;
    if (this.drag) { this.drag = null; }
    if (!silent) { this.emit('tool', 'select'); this.emitPrompt(); this.redraw(); }
  }

  emitPrompt() {
    let p;
    if (this.T) p = this.T.prompt();
    else if (this.sel.size) p = `${this.sel.size} seleccionado${this.sel.size > 1 ? 's' : ''} · arrastra un pinzamiento ■ para editar o el objeto para moverlo · flechas: desplazar · < >: girar · Supr: borrar · Esc: deseleccionar · o escribe una orden (M, CO, RO…)`;
    else p = 'Seleccionar: clic en un objeto · arrastra en vacío para seleccionar por ventana · o escribe una orden (L, REC, C, DLI, M…)';
    this.emit('prompt', p);
  }

  message(text) { this.emit('message', text); }

  enter() {
    if (this.T) { if (this.T.enter) this.T.enter(); else this.setTool('select'); this.after(); return; }
    if (this.lastCmd) {
      if (CAD_OPS[this.lastCmd]) this.runOp(this.lastCmd); else this.setTool(this.lastCmd);
    }
  }

  after() { this.emitPrompt(); this.redraw(); }

  /** Texto escrito en la línea de órdenes. */
  input(str) {
    const s = String(str).trim();
    if (!s) { this.enter(); return; }
    if (!this.T) {
      const low = s.toLowerCase();
      const name = aliasToCmd(low);
      if (name) { if (CAD_OPS[name]) this.runOp(name); else this.setTool(name); return; }
      if (['z', 'zoom', 'encuadrar', 'ze'].includes(low)) { this.zoomExtents(); return; }
      if (['u', 'deshacer', 'undo'].includes(low)) { this.undo(); return; }
      if (['p', 'pan', 'mano', 'encuadre'].includes(low)) { this.emit('handrequest'); return; }
      this.message(`Orden desconocida: «${s}». Prueba L (línea), C (círculo), REC (rectángulo), DLI (cota), M (desplazar)…`);
      return;
    }
    const switchTo = () => {
      const name = aliasToCmd(s.toLowerCase());
      if (!name) return false;
      if (CAD_OPS[name]) this.runOp(name); else this.setTool(name);
      return true;
    };
    if (this.T.selecting) { if (!switchTo()) this.message('Designa objetos con el ratón y pulsa Intro'); return; }
    if (this.T.input && this.T.input(s)) { this.after(); return; }
    if (this.T.pickMode) { if (!switchTo()) this.message('Designa el objeto con el ratón'); return; }
    const pt = this.parsePoint(s);
    if (pt) { this.T.point(pt, { typed: true }); this.after(); return; }
    if (switchTo()) return;
    this.message(`Entrada no válida: «${s}». Usa x,y · @dx,dy · distancia<ángulo · o una distancia`);
  }

  parsePoint(str) {
    const n = '[-+]?(?:\\d+(?:\\.\\d*)?|\\.\\d+)';
    const last = this.T?.last?.();
    let m = str.match(new RegExp(`^(@)?\\s*(${n})\\s*[,;]\\s*(${n})$`));
    if (m) { const p = [parseFloat(m[2]), parseFloat(m[3])]; return m[1] ? (last ? add(last, p) : p) : p; }
    m = str.match(new RegExp(`^@?\\s*(${n}|${n.replace('\\.', '[.,]')})\\s*<\\s*(${n})$`));
    if (m) {
      if (!last) { this.message('Las coordenadas polares necesitan un punto anterior'); return null; }
      return polar(last, parseNum(m[1]), parseFloat(m[2]) / DEG);
    }
    const v = parseNum(str);
    if (v !== null && last) {
      const dirP = this.cur && dist(this.cur, last) > 1e-9 ? this.cur : add(last, [1, 0]);
      return polar(last, v, angOf(last, dirP));
    }
    return null;
  }

  // ------------------------------------------------------------- teclado
  /** Devuelve true si la tecla se ha usado. `inp` es la línea de órdenes. */
  handleKey(e, inp) {
    const k = e.key;
    const mod = e.ctrlKey || e.metaKey;
    // «escribiendo» solo si hay algo en la línea de órdenes: con ella vacía, las teclas actúan sobre el dibujo
    const typing = document.activeElement === inp && !!inp.value;
    if (k === 'Escape') {
      e.preventDefault();
      if (this.hand && !inp.value) { this.emit('handrequest', false); inp.blur(); return true; }
      if (inp.value) inp.value = '';
      else if (this.T) this.cancel();
      else if (this.sel.size) this.setSel([]);
      else { this.measure = null; this.redraw(); }
      inp.blur();
      return true;
    }
    if (k === 'Enter' || (k === ' ' && !this.T?.textEntry?.())) {
      e.preventDefault();
      const v = inp.value;
      inp.value = '';
      this.input(v);
      return true;
    }
    if (k === 'F3') { e.preventDefault(); this.toggle('osnapOn'); return true; }
    if (k === 'F8') { e.preventDefault(); this.toggle('ortho'); return true; }
    if (k === 'F9') { e.preventDefault(); this.toggle('gridSnap'); return true; }
    if (k === 'F7') { e.preventDefault(); this.toggle('grid'); return true; }
    // cambiar de cara isométrica: Tab (o Ctrl+E, como en AutoCAD); solo si el panel está en isométrico
    if ((k === 'Tab' && !e.shiftKey && !mod) || (mod && k.toLowerCase() === 'e')) {
      if (this.isIso()) { e.preventDefault(); this.toggle('isoplane'); return true; }
      if (mod) { e.preventDefault(); this.message('Ctrl+E / Tab cambian de cara isométrica: activa antes «Isométrica» en este panel'); return true; }
    }
    // < y > giran la selección alrededor de su centro (15°, con Ctrl 1°), si no se está escribiendo una orden
    if ((k === '<' || k === '>') && !this.T && this.sel.size && !inp.value) {
      e.preventDefault();
      const deg = (k === '<' ? 1 : -1) * (mod ? 1 : 15);
      const bb = this.extents(this.selEnts());
      const c = [(bb[0] + bb[2]) / 2, (bb[1] + bb[3]) / 2];
      const ang = deg / DEG;
      this.transformSel(q => rotP(q, c, ang), { rot: ang });
      this.commit();
      this.emit('select');
      this.message(`Girado ${deg > 0 ? '+' : ''}${deg}° alrededor del centro de la selección (< y >: 15° · con Ctrl: 1°)`);
      return true;
    }
    if (mod) {
      const l = k.toLowerCase();
      if (l === 'z' && !e.shiftKey) { e.preventDefault(); this.undo(); return true; }
      if (l === 'y' || (l === 'z' && e.shiftKey)) { e.preventDefault(); this.redo(); return true; }
      if (l === 'a' && !typing) { e.preventDefault(); this.selectAll(); return true; }
      if ((l === 'c' || l === 'x' || l === 'd') && !typing && !this.T) {
        e.preventDefault();
        if (!this.sel.size) { this.message('Selecciona primero los objetos'); return true; }
        this.clipboard = this.selEnts().map(x => structuredClone(x));
        const n = this.clipboard.length, s = n > 1 ? 's' : '';
        if (l === 'x') { this.eraseSel(); this.message(`${n} objeto${s} cortado${s}: Ctrl+V para pegar`); }
        else if (l === 'c') this.message(`${n} objeto${s} copiado${s}: Ctrl+V para pegar`);
        else this.setTool('paste');
        return true;
      }
      if (l === 'v' && !typing) {
        e.preventDefault();
        if (!this.clipboard?.length) { this.message('No hay nada copiado (selecciona y pulsa Ctrl+C)'); return true; }
        this.setTool('paste');
        return true;
      }
      return false;
    }
    if (k.startsWith('Arrow') && !typing && !this.T && this.sel.size) {
      e.preventDefault();
      const step = (this.activeView?.snapStep() || +this.drawing.snapStep || 1) * (e.shiftKey ? 10 : 1);
      const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] }[k];
      this.transformSel(q => add(q, d));
      this.commit();
      this.emit('select');
      this.message(`Desplazado ${fmtNum(step, this.drawing)} ${this.drawing.units === 'u' ? '' : this.drawing.units} (Mayús: ×10)`);
      return true;
    }
    if ((k === 'Delete' || (k === 'Backspace' && !inp.value)) && !this.T && this.sel.size) { e.preventDefault(); this.eraseSel(); return true; }
    if (k === '?' && !inp.value) return false;
    if (k.length === 1) {
      if (!typing) { e.preventDefault(); inp.focus(); inp.value += k; }
      this.redraw();
      return true;
    }
    if (k === 'Backspace' && !typing && inp.value) { e.preventDefault(); inp.value = inp.value.slice(0, -1); this.redraw(); return true; }
    return false;
  }

  toggle(key) {
    if (key === 'grid') { this.drawing.grid = !this.drawing.grid; this.commit(); this.message(`Rejilla ${this.drawing.grid ? 'visible' : 'oculta'}`); }
    else if (key === 'iso' || key === 'isoplane') {
      // el modo isométrico es de cada panel: así uno puede estar en alzado y otro en isométrica
      const v = this.focusView || this.isoV();   // el panel activo (resaltado)
      if (!v) return;
      if (key === 'iso') {
        v.iso = !v.iso;
        if (v.iso) {
          // como el modo isométrico de los programas de CAD: rejilla visible, forzado a sus nodos y orto por sus ejes
          this.drawing.grid = true;
          this.gridSnap = true;
          this.ortho = true;
          this.savePrefs();
        }
      } else {
        const order = ['top', 'right', 'left'];
        v.isoPlane = order[(order.indexOf(v.isoPlane || 'top') + 1) % 3];
        v.iso = true;
      }
      const P = ISO_PLANES[v.isoPlane || 'top'];
      this.message(!v.iso ? 'Este panel vuelve a la rejilla normal (los demás paneles conservan su modo)'
        : key === 'iso' ? `Este panel pasa a isométrico · cara ${P.label.toLowerCase()} (Tab cambia de cara). Círculos → elipses isométricas, rectángulos → paralelogramos y cotas sobre los ejes isométricos. Forzar y Orto activados (F8 para trazar libre).`
          : `Cara isométrica: ${P.label} (ejes a ${P.axes.join('° y ')}°). Los círculos, rectángulos y cotas se dibujan en esa cara.`);
      this.emit('viewchange');
      this.emitPrompt();
    }
    else if (key === 'pencil') {
      this.drawing.curLt = this.drawing.curLt === 'pencil' ? null : 'pencil';
      this.commit();
      this.message(this.drawing.curLt ? 'Lápiz activado: lo que dibujes ahora tendrá trazo a mano alzada (la geometría sigue siendo exacta). Para cambiar objetos ya dibujados, selecciónalos y elige el tipo de línea en Propiedades.' : 'Lápiz desactivado: se vuelve al tipo de línea de cada capa');
    }
    else {
      this[key] = !this[key];
      const names = { osnapOn: 'Referencias a objetos', ortho: 'Orto', gridSnap: 'Forzar a la rejilla' };
      this.message(`${names[key]}: ${this[key] ? 'activado' : 'desactivado'}`);
      this.savePrefs();
    }
    this.emit('settings');
    this.redraw();
  }

  // ------------------------------------------------------------- referencias y designación
  nearBox(e, p, tol) {
    const b = bboxOf(e, this.drawing);
    return p[0] >= b[0] - tol && p[0] <= b[2] + tol && p[1] >= b[1] - tol && p[1] <= b[3] + tol;
  }

  snap(view, raw, { exclude } = {}) {
    const tol = 12 / view.zoom;
    let best = null, bd = Infinity;
    const consider = (p, k, pri) => {
      const d = dist(p, raw);
      if (d <= tol) { const score = d + pri * tol * 0.35; if (score < bd) { bd = score; best = { p: [...p], k }; } }
    };
    if (this.osnapOn) {
      const near = [];
      for (const e of this.visibleEntities()) {
        if (exclude?.includes(e.id)) continue;
        if (this.nearBox(e, raw, tol)) near.push(e);
      }
      for (const e of near) for (const s of snapPts(e)) if (this.osnap[s.k] !== false) consider(s.p, s.k, s.k === 'end' || s.k === 'cen' || s.k === 'ins' ? 0 : 0.5);
      for (const s of this.T?.extraSnaps?.() || []) consider(s.p, s.k, 0);
      if (this.osnap.int) {
        const pr = near.flatMap(e => prims(e)).slice(0, 80);
        for (let i = 0; i < pr.length; i++) for (let j = i + 1; j < pr.length; j++) for (const q of interPrims(pr[i], pr[j])) consider(q, 'int', 0);
      }
      if (!best && this.osnap.near) for (const e of near) for (const pr of prims(e)) consider(primDist(raw, pr).q, 'near', 1);
    }
    if (best) return best;
    let p = raw;
    const iso = !!view.iso;
    if (this.gridSnap) {
      const st = view.snapStep();
      p = iso ? isoSnap(p, st) : [Math.round(p[0] / st) * st, Math.round(p[1] / st) * st].map(rnd);
    }
    const last = this.T?.last?.();
    if (this.ortho && last) {
      const d = sub(p, last);
      if (iso) {
        // Orto isométrico: solo en las direcciones de los ejes (30°, 90°, 150° y opuestas)
        let best = null, bd = -Infinity;
        for (const a of ISO_AXES) { const u = [Math.cos(a), Math.sin(a)], k = dot(d, u); if (k > bd) { bd = k; best = u; } }
        // con «Forzar», la longitud también va de nodo en nodo (los nodos están a un paso sobre cada eje)
        if (this.gridSnap) { const st = view.snapStep(); bd = Math.round(bd / st) * st; }
        p = add(last, mul(best, bd)).map(rnd);
      } else p = Math.abs(d[0]) >= Math.abs(d[1]) ? [p[0], last[1]] : [last[0], p[1]];
    }
    return { p, k: null };
  }

  pick(view, raw, filter) {
    const tol = 8 / view.zoom;
    let best = null, bd = tol;
    for (const e of this.visibleEntities()) {
      if (filter && !filter(e)) continue;
      if (!this.nearBox(e, raw, tol)) continue;
      const d = pickDist(e, raw, this.drawing);
      if (d < bd) { bd = d; best = e; }
    }
    return best;
  }

  gripAt(view, raw) {
    const tol = 7 / view.zoom;
    let best = null, bd = tol;
    for (const e of this.selEnts().slice(0, 200)) {
      grips(e).forEach((g, i) => { const d = dist(g, raw); if (d <= bd) { bd = d; best = { id: e.id, i, p: g }; } });
    }
    return best;
  }

  // ------------------------------------------------------------- ratón
  onMove(view, raw, e) {
    this.activeView = view;
    this.raw = raw;
    if (this.drag) { this._dragMove(view, raw); return; }
    if (this.win) { this.win.b = raw; this.redraw(); return; }
    const pointMode = this.T && !this.T.selecting && !this.T.pickMode;
    if (pointMode) {
      const s = this.snap(view, raw);
      this.snapHit = s.k ? s : null;
      this.cur = s.p;
      this.hover = null;
    } else {
      this.snapHit = null;
      this.cur = raw;
      this.hotGrip = !this.T && this.sel.size && !(e?.shiftKey || e?.ctrlKey || e?.metaKey) ? this.gripAt(view, raw) : null;
      this.hover = this.hotGrip ? null : this.pick(view, raw, this.T?.pickMode ? this.T.pickFilter : null);
    }
    this.emit('cursor', this.cur);
    this.redraw();
  }

  /** Rótulo que acompaña al cursor: qué pasará si haces clic o arrastras. */
  _hint() {
    const D = this.drawing, F = v => fmtNum(v, D);
    if (this.drag?.moved) return this.drag.info || null;
    if (this.win) return null;
    if (this.T) {
      const typed = this.inputEl?.value;
      let p = this.T.prompt() || '';
      if (p.length > 90) p = `${p.slice(0, 88)}…`;
      const lines = [p];
      if (this.T.selecting && this.hover) lines.push(this.sel.has(this.hover.id) ? `${entLabel(this.hover)} · ya seleccionado (Mayús+clic: quitar)` : `${entLabel(this.hover)} · clic: añadir`);
      if (this.T.pickMode && this.hover) lines.push(`${entLabel(this.hover)} · clic para designarlo`);
      if (typed) lines.push(`› ${typed}`);
      return lines;
    }
    if (this.hotGrip) {
      const e = this.byId(this.hotGrip.id);
      return e ? [gripLabel(e, this.hotGrip.i)] : null;
    }
    if (this.hover) {
      const e = this.hover, inf = entityInfo(e, D);
      const meas = e.type === 'circle' ? `Ø ${F(2 * e.r)}` : isIsoCircle(e) ? `Ø ${F(2 * Math.hypot(...e.U))} (isométrico)` : e.type === 'arc' ? `R ${F(e.r)}` : inf.length ? `L ${F(inf.length)}` : '';
      const head = `${entLabel(e)}${meas ? ` · ${meas}` : ''} · capa ${e.layer}`;
      return this.sel.has(e.id)
        ? [head, 'Arrastra para mover · doble clic: editar valores · Mayús+clic: quitar']
        : [head, 'Clic: seleccionar · Mayús+clic: añadir · arrastra: mover'];
    }
    return null;
  }

  _dragInfo(d, sn) {
    const D = this.drawing, F = v => fmtNum(v, D), A = (a, b) => `${F(normA(angOf(a, b)) * DEG)}°`;
    if (d.kind === 'move') return [`Mover · Δ ${F(dist(d.base, sn))} < ${A(d.base, sn)}`, `ΔX ${F(sn[0] - d.base[0])} · ΔY ${F(sn[1] - d.base[1])}`];
    const o = d.orig, g = grips(o)[d.i];
    if ((o.type === 'circle' && d.i > 0) || (o.type === 'arc' && d.i === 3)) return [`Radio ${F(dist(o.c, sn))} · Ø ${F(2 * dist(o.c, sn))}`];
    if (o.type === 'line' && d.i < 2) { const other = d.i === 0 ? o.b : o.a; return [`Longitud ${F(dist(other, sn))} < ${A(other, sn)}`]; }
    return [`Δ ${F(dist(g, sn))} · X ${F(sn[0])} · Y ${F(sn[1])}`];
  }

  onDown(view, raw, e) {
    this.activeView = view;
    this.raw = raw;
    if (this.T && !this.T.selecting) {
      if (this.T.pickMode) {
        const ent = this.pick(view, raw, this.T.pickFilter);
        this.T.pick(ent, raw, view);
        this.hover = null;
        this.after();
        return;
      }
      const s = this.snap(view, raw);
      this.T.point(s.p, { view, e });
      this.after();
      return;
    }
    const add = e.shiftKey || e.ctrlKey || e.metaKey;
    if (!this.T && this.sel.size && !add) {
      const g = this.gripAt(view, raw);
      if (g) {
        this.drag = { kind: 'grip', id: g.id, i: g.i, orig: structuredClone(this.byId(g.id)), downS: view.toScreen(raw), moved: false };
        return;
      }
    }
    const pk = this.pick(view, raw);
    if (pk) {
      if (this.T?.selecting) {
        if (e.shiftKey) this.sel.delete(pk.id); else this.sel.add(pk.id);
        this.emit('select');
        this.after();
        return;
      }
      if (add) {
        if (this.sel.has(pk.id)) this.sel.delete(pk.id); else this.sel.add(pk.id);
        this.emit('select');
        this.after();
        return;
      }
      const wasSel = this.sel.has(pk.id);
      if (!wasSel) this.setSel([pk.id]);
      const base = this.snap(view, raw, { exclude: [...this.sel] }).p;
      this.drag = { kind: 'move', base, orig: this.selEnts().map(x => structuredClone(x)), downS: view.toScreen(raw), moved: false, clicked: pk.id, wasSel };
      return;
    }
    this.win = { a: raw, b: raw, add: add || !!this.T?.selecting, view };
    this.redraw();
  }

  _dragMove(view, raw) {
    const d = this.drag;
    const s = view.toScreen(raw);
    if (!d.moved && Math.hypot(s[0] - d.downS[0], s[1] - d.downS[1]) < 4) return;
    d.moved = true;
    const exclude = d.kind === 'grip' ? [d.id] : d.orig.map(o => o.id);
    const sn = this.snap(view, raw, { exclude });
    this.snapHit = sn.k ? sn : null;
    this.cur = sn.p;
    d.info = this._dragInfo(d, sn.p);
    if (d.kind === 'grip') {
      const i = this.drawing.entities.findIndex(x => x.id === d.id);
      if (i >= 0) this.drawing.entities[i] = applyGrip(d.orig, d.i, sn.p);
    } else {
      const delta = sub(sn.p, d.base);
      for (const o of d.orig) {
        const i = this.drawing.entities.findIndex(x => x.id === o.id);
        if (i >= 0) this.drawing.entities[i] = xform(o, q => add(q, delta));
      }
    }
    this.emit('cursor', this.cur);
    this.redraw();
  }

  onUp(view, raw, e) {
    if (this.drag) {
      const d = this.drag;
      this.drag = null;
      this.snapHit = null;
      if (d.moved) { this.commit(); this.emit('select'); }
      else if (d.kind === 'move' && d.wasSel) this.setSel([d.clicked]);
      this.redraw();
      return;
    }
    if (this.win) {
      const w = this.win;
      this.win = null;
      const sa = view.toScreen(w.a), sb = view.toScreen(w.b);
      if (Math.hypot(sa[0] - sb[0], sa[1] - sb[1]) < 4) {
        if (!w.add) this.setSel([]);
        this.redraw();
        return;
      }
      const r = [Math.min(w.a[0], w.b[0]), Math.min(w.a[1], w.b[1]), Math.max(w.a[0], w.b[0]), Math.max(w.a[1], w.b[1])];
      const crossing = w.b[0] < w.a[0];
      const ids = this.visibleEntities().filter(ent => (crossing ? this._crosses(ent, r) : this._inside(ent, r))).map(ent => ent.id);
      if (w.add) ids.forEach(id => this.sel.add(id)); else this.sel = new Set(ids);
      this.emit('select');
      this.after();
    }
  }

  _inside(e, r) {
    const b = bboxOf(e, this.drawing);
    return b[0] >= r[0] && b[1] >= r[1] && b[2] <= r[2] && b[3] <= r[3];
  }

  _crosses(e, r) {
    const b = bboxOf(e, this.drawing);
    if (b[0] > r[2] || b[2] < r[0] || b[1] > r[3] || b[3] < r[1]) return false;
    const inR = p => p[0] >= r[0] && p[0] <= r[2] && p[1] >= r[1] && p[1] <= r[3];
    const edges = [[[r[0], r[1]], [r[2], r[1]]], [[r[2], r[1]], [r[2], r[3]]], [[r[2], r[3]], [r[0], r[3]]], [[r[0], r[3]], [r[0], r[1]]]];
    const { segs, boxes } = shapeOf(e, this.drawing);
    if (boxes.some(bx => pointInPoly([(r[0] + r[2]) / 2, (r[1] + r[3]) / 2], bx))) return true;
    for (const [a, b2] of segs) {
      if (inR(a) || inR(b2)) return true;
      for (const [c, d] of edges) if (segSeg(a, b2, c, d)) return true;
    }
    return false;
  }

  leave(view) {
    if (this.activeView === view && !this.drag && !this.win) {
      this.cur = null; this.snapHit = null; this.hover = null;
      this.redraw();
    }
  }

  dblClick(view, raw) {
    const e = this.pick(view, raw);
    const br = !e && sheetBlockRect(this.drawing);
    if (br && raw[0] >= br[0] && raw[0] <= br[2] && raw[1] >= br[1] && raw[1] <= br[3]) { this.setSel([]); this.emit('blockedit'); return; }
    if (!e) { this.zoomExtents(view); return; }
    this.setSel([e.id]);
    this.emit('editrequest', e.id);
  }

  // ------------------------------------------------------------- DXF
  importDXF(text) {
    const r = parseDXF(text);
    const D = this.drawing;
    if (!D.entities.length && r.units) {
      const u = Object.entries(UNITS).find(([k, x]) => x.dxf === r.units && k !== 'u')?.[0];
      if (u) D.units = u;
    }
    // DXF R12 no admite acentos en nombres de capa: «Construccion» vuelve a «Construcción»
    const fold = s => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
    const alias = new Map();
    for (const L of D.layers) alias.set(fold(L.name), L.name);
    for (const L of r.layers) {
      if (!L.name) continue;
      if (alias.has(fold(L.name))) continue;
      D.layers.push({ name: L.name, color: L.color, lt: L.lt, lw: 'thin', visible: L.visible });
      alias.set(fold(L.name), L.name);
    }
    const ids = [];
    for (const e of r.entities) {
      if (e.layer && alias.has(fold(e.layer))) e.layer = alias.get(fold(e.layer));
      if (!this.layer(e.layer)) D.layers.push({ name: e.layer, color: 'auto', lt: 'continuous', lw: 'thin', visible: true });
      ids.push(this.add(e).id);
    }
    this.sel = new Set(ids);
    this.commit();
    this.emit('select');
    this.zoomExtents();
    return { count: ids.length, skipped: r.skipped };
  }

  // ------------------------------------------------------------- encuadre
  extents(ents = this.visibleEntities()) {
    const bb = [Infinity, Infinity, -Infinity, -Infinity];
    for (const e of ents) { const b = bboxOf(e, this.drawing); bb[0] = Math.min(bb[0], b[0]); bb[1] = Math.min(bb[1], b[1]); bb[2] = Math.max(bb[2], b[2]); bb[3] = Math.max(bb[3], b[3]); }
    return Number.isFinite(bb[0]) ? bb : null;
  }

  /** Lo que muestra «Encuadrar»: el dibujo y, si la hay, la hoja entera. */
  fitBox() {
    const bb = this.extents(), S = sheetOf(this.drawing);
    if (!S) return bb;
    if (!bb) return [S.x0, S.y0, S.x1, S.y1];
    return [Math.min(bb[0], S.x0), Math.min(bb[1], S.y0), Math.max(bb[2], S.x1), Math.max(bb[3], S.y1)];
  }

  /** Paso de forzado a la rejilla (unidades del dibujo); 0 o vacío = automático según el zoom. */
  setSnapStep(v) {
    v = +v;
    if (v > 0) { this.drawing.snapStep = v; if (!this.gridSnap) { this.gridSnap = true; this.savePrefs(); } }
    else delete this.drawing.snapStep;
    this.commit();
    const u = this.drawing.units === 'u' ? '' : ` ${this.drawing.units}`;
    this.message(v > 0 ? `Forzado cada ${fmtNum(v, this.drawing, 4).replace(/[,.]?0+$/, '')}${u}: el cursor salta a esa rejilla (Forzar activado). La rejilla se dibuja a ese paso o a un múltiplo si estás muy lejos.` : 'Paso de forzado automático: sigue al zoom');
    this.emit('settings');
    this.redraw();
  }

  /** Cambia la hoja (tamaño, orientación, escala, recuadro). `null` la quita. */
  setPaper(patch) {
    const D = this.drawing;
    if (patch === null) delete D.paper;
    else D.paper = { landscape: true, scale: '1:1', frame: true, ...(D.paper || {}), ...patch };
    this.commit();
    this.zoomExtents();
  }

  /** Coloca la hoja centrada sobre lo dibujado. */
  centerPaper() {
    const S = sheetOf(this.drawing), bb = this.extents();
    if (!S || !bb) return;
    this.drawing.paper.ox = rnd((bb[0] + bb[2]) / 2 - (S.x1 - S.x0) / 2);
    this.drawing.paper.oy = rnd((bb[1] + bb[3]) / 2 - (S.y1 - S.y0) / 2);
    this.commit();
    this.zoomExtents();
  }

  zoomExtents(view) {
    for (const v of view ? [view] : this.views) if (v.visible) v.fit();
    this.redraw();
  }

  // ------------------------------------------------------------- dibujo
  redraw() {
    if (this._raf) return;
    this._raf = requestAnimationFrame(() => {
      this._raf = 0;
      for (const v of this.views) if (v.visible) v.draw();
    });
  }

  _colors(white) {
    const light = document.documentElement.dataset.theme === 'light';
    return white ? {
      bg: '#ffffff', fg: '#111111', grid: '#f0f0f0', major: '#dedede', sel: '#1f6fd1', accent: '#c8740c', axisX: 'rgba(229,97,79,.45)', axisY: 'rgba(63,160,80,.45)',
      hover: '#1f6fd1', muted: '#666666', desk: '#ffffff',
    } : {
      bg: cssVar('--cv-bg') || '#0f1114', fg: cssVar('--text') || '#e6e8eb', grid: cssVar('--cv-grid') || '#1a1d22', major: cssVar('--cv-grid-major') || '#2a2f36',
      sel: light ? '#1f6fd1' : '#5ab0ff', accent: cssVar('--accent') || '#f2a541', axisX: 'rgba(229,97,79,.4)', axisY: 'rgba(111,191,115,.4)',
      hover: light ? '#3d8bf0' : '#8cc8ff', muted: cssVar('--muted') || '#9aa0a8', desk: light ? '#cfccc5' : '#08090b',
    };
  }

  /**
   * Dibuja el plano en un contexto 2D con el encuadre de `view`.
   * opts: { print (sin ayudas interactivas), background: 'theme'|'white'|'transparent', grid }
   */
  render(view, ctx, W, H, opts = {}) {
    const D = this.drawing;
    const white = opts.background === 'white';
    const C = this._colors(white);
    if (opts.background === 'transparent') ctx.clearRect(0, 0, W, H);
    else { ctx.fillStyle = C.bg; ctx.fillRect(0, 0, W, H); }
    const sheet = sheetOf(D);
    let sr = null;
    if (sheet) {
      // la mesa alrededor y la hoja encima, con su sombra
      const a = view.toScreen([sheet.x0, sheet.y1]), b = view.toScreen([sheet.x1, sheet.y0]);
      sr = [a[0], a[1], b[0] - a[0], b[1] - a[1]];
      if (opts.background !== 'transparent') {
        ctx.fillStyle = C.desk; ctx.fillRect(0, 0, W, H);
        if (!white) { ctx.fillStyle = 'rgba(0,0,0,.28)'; ctx.fillRect(sr[0] + 4, sr[1] + 5, sr[2], sr[3]); }
        ctx.fillStyle = C.bg; ctx.fillRect(...sr);
      }
    }
    if (D.grid && opts.grid !== false) {
      ctx.save();
      if (sr) { ctx.beginPath(); ctx.rect(...sr); ctx.clip(); }
      this._grid(view, ctx, W, H, C);
      ctx.restore();
    }
    if (sheet) {
      ctx.strokeStyle = C.major; ctx.lineWidth = 1; ctx.setLineDash([]);
      ctx.strokeRect(Math.round(sr[0]) + 0.5, Math.round(sr[1]) + 0.5, Math.round(sr[2]), Math.round(sr[3]));
      for (const e of sheetDecor(D, this.title, this.sheetNo)) {
        ctx.globalAlpha = 0.8;
        drawEnt(ctx, view, e, D, { color: C.fg, dash: [], lw: e.lw === 'thick' ? 1.6 : 0.8 });
        ctx.globalAlpha = 1;
      }
      if (!opts.print && sr[1] > 22) {
        ctx.font = `11px ${FONT}`; ctx.fillStyle = C.muted; ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
        ctx.fillText(`Hoja ${sheet.size} ${sheet.landscape ? 'horizontal' : 'vertical'} · ${sheet.w} × ${sheet.h} mm · escala ${sheet.scale}`, sr[0], sr[1] - 8);
      }
    }
    if (this.sketch && !opts.print) this._sketchGuides(view, ctx, W, H, C);
    const layers = new Map(D.layers.map(l => [l.name, l]));
    const interactive = !opts.print;
    for (const e of D.entities) {
      const L = layers.get(e.layer) || D.layers[0];
      if (L.visible === false) continue;
      const LT = LINETYPES[ltOf(e, L)] || LINETYPES.continuous;
      const st = { color: !L.color || L.color === 'auto' ? C.fg : L.color, dash: LT.dash, lw: L.lw === 'thick' ? 1.8 : 1, sketch: !!LT.sketch };
      const hov = interactive && this.hover && this.hover.id === e.id;
      if (interactive && this.sel.has(e.id)) Object.assign(st, { color: C.sel, dash: [7, 4], lw: st.lw + (hov ? 1.8 : 0.6), sketch: false });
      else if (hov) Object.assign(st, { color: C.hover, lw: st.lw + 1.4 });
      drawEnt(ctx, view, e, D, st);
    }
    if (!interactive) return;
    // vista previa de la orden
    const pv = this.T?.preview?.();
    if (pv) {
      for (const e of pv.ents || []) drawEnt(ctx, view, e, D, { color: C.accent, dash: [], lw: 1.3 });
      for (const e of pv.removed || []) drawEnt(ctx, view, e, D, { color: '#e5614f', dash: [5, 4], lw: 2.6 });
      ctx.setLineDash([4, 4]);
      ctx.strokeStyle = C.fg; ctx.globalAlpha = 0.45; ctx.lineWidth = 1;
      for (const [a, b] of pv.guides || []) { const p = view.toScreen(a), q = view.toScreen(b); ctx.beginPath(); ctx.moveTo(p[0], p[1]); ctx.lineTo(q[0], q[1]); ctx.stroke(); }
      ctx.globalAlpha = 1; ctx.setLineDash([]);
      if (pv.marker) { const s = view.toScreen(pv.marker); ctx.strokeStyle = C.accent; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(s[0], s[1] - 12); ctx.lineTo(s[0], s[1] + 3); ctx.stroke(); }
    }
    // medición
    if (this.measure) {
      const { a, b } = this.measure;
      const p = view.toScreen(a), q = view.toScreen(b);
      ctx.strokeStyle = C.accent; ctx.lineWidth = 1.5; ctx.setLineDash([6, 3]);
      ctx.beginPath(); ctx.moveTo(p[0], p[1]); ctx.lineTo(q[0], q[1]); ctx.stroke(); ctx.setLineDash([]);
      for (const s of [p, q]) { ctx.beginPath(); ctx.arc(s[0], s[1], 3, 0, TAU); ctx.fillStyle = C.accent; ctx.fill(); }
      this._label(ctx, `${fmtNum(dist(a, b), D)}${D.units === 'u' ? '' : ' ' + D.units}`, (p[0] + q[0]) / 2, (p[1] + q[1]) / 2 - 10, C);
    }
    // pinzamientos
    if (!this.T && this.sel.size && this.sel.size <= 200) {
      const hg = this.drag?.kind === 'grip' ? this.drag : this.hotGrip;
      for (const e of this.selEnts()) grips(e).forEach((g, i) => {
        const s = view.toScreen(g);
        const hot = hg && hg.id === e.id && hg.i === i;
        const r = hot ? 6 : 4;
        ctx.fillStyle = hot ? '#e5614f' : '#2f6fff'; ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1;
        ctx.fillRect(s[0] - r, s[1] - r, 2 * r, 2 * r); ctx.strokeRect(s[0] - r, s[1] - r, 2 * r, 2 * r);
      });
    }
    // ventana de selección
    if (this.win && this.win.view === view) {
      const a = view.toScreen(this.win.a), b = view.toScreen(this.win.b);
      const crossing = b[0] < a[0];
      ctx.fillStyle = crossing ? 'rgba(80,200,120,.12)' : 'rgba(80,140,255,.12)';
      ctx.strokeStyle = crossing ? '#50c878' : '#508cff';
      ctx.setLineDash(crossing ? [6, 4] : []); ctx.lineWidth = 1;
      ctx.fillRect(Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1]));
      ctx.strokeRect(Math.min(a[0], b[0]) + 0.5, Math.min(a[1], b[1]) + 0.5, Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1]));
      ctx.setLineDash([]);
      if (Math.hypot(b[0] - a[0], b[1] - a[1]) > 6) {
        const n = this.visibleEntities().filter(ent => {
          const r = [Math.min(this.win.a[0], this.win.b[0]), Math.min(this.win.a[1], this.win.b[1]), Math.max(this.win.a[0], this.win.b[0]), Math.max(this.win.a[1], this.win.b[1])];
          return crossing ? this._crosses(ent, r) : this._inside(ent, r);
        }).length;
        this._tip(ctx, [crossing ? '← Captura: todo lo que toque el recuadro' : '→ Ventana: solo lo que quede dentro del todo', `${n} objeto${n === 1 ? '' : 's'}`], b[0] + 16, b[1] + 18, C, W, H);
      }
    }
    // cursor
    if (view === this.activeView && view.screenCursor && !this.hand) {
      const [sx, sy] = view.screenCursor;
      ctx.strokeStyle = C.fg; ctx.globalAlpha = 0.45; ctx.lineWidth = 1;
      ctx.beginPath();
      if (view.iso) {
        // cursor isométrico: sus dos brazos siguen los ejes de la cara activa
        const L = W + H;
        for (const [ux, uy] of isoAxes(view)) { ctx.moveTo(sx - ux * L, sy + uy * L); ctx.lineTo(sx + ux * L, sy - uy * L); }
      } else { ctx.moveTo(0, Math.round(sy) + 0.5); ctx.lineTo(W, Math.round(sy) + 0.5); ctx.moveTo(Math.round(sx) + 0.5, 0); ctx.lineTo(Math.round(sx) + 0.5, H); }
      ctx.stroke();
      ctx.globalAlpha = 0.9;
      if (!this.T || this.T.selecting || this.T.pickMode) ctx.strokeRect(Math.round(sx) - 4.5, Math.round(sy) - 4.5, 9, 9);
      ctx.globalAlpha = 1;
      if (this.snapHit) this._snapMarker(ctx, view.toScreen(this.snapHit.p), this.snapHit.k, C);
      const last = this.T?.last?.();
      const tip = this._hint() || [];
      if (last && this.cur && !this.T.selecting) {
        const d = dist(last, this.cur), a = normA(angOf(last, this.cur)) * DEG;
        tip.push(`${fmtNum(d, D)} < ${fmtNum(a, D, 1)}°`);
      }
      if (tip.length && !this.win) this._tip(ctx, tip, sx + 18, sy + 24, C, W, H);
    }
    // icono de ejes
    ctx.lineWidth = 1.6;
    const o = [22, H - 22];
    ctx.strokeStyle = '#e5614f'; ctx.fillStyle = '#e5614f';
    ctx.beginPath(); ctx.moveTo(o[0], o[1]); ctx.lineTo(o[0] + 32, o[1]); ctx.stroke();
    ctx.font = `600 10px ${FONT}`; ctx.fillText('X', o[0] + 36, o[1] + 4);
    ctx.strokeStyle = '#3fbf5f'; ctx.fillStyle = '#3fbf5f';
    ctx.beginPath(); ctx.moveTo(o[0], o[1]); ctx.lineTo(o[0], o[1] - 32); ctx.stroke();
    ctx.fillText('Y', o[0] - 3, o[1] - 37);
  }

  /** Croquis: eje de revolución (x = 0) o el origen de la pieza, con su rótulo. */
  _sketchGuides(v, ctx, W, H, C) {
    const o = v.toScreen([0, 0]);
    ctx.save();
    ctx.strokeStyle = C.accent; ctx.fillStyle = C.accent; ctx.lineWidth = 1.4;
    if (this.sketch.kind === 'lathe') {
      ctx.setLineDash([14, 4, 3, 4]);
      ctx.beginPath(); ctx.moveTo(Math.round(o[0]) + 0.5, 0); ctx.lineTo(Math.round(o[0]) + 0.5, H); ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 0.07; ctx.fillRect(0, 0, Math.max(0, o[0]), H); ctx.globalAlpha = 1;   // la zona prohibida (x < 0)
      ctx.font = `600 11px ${FONT}`; ctx.textAlign = 'left';
      ctx.fillText('Eje de revolución · dibuja el medio perfil a la derecha', o[0] + 8, 18);
    } else {
      ctx.setLineDash([]);
      ctx.beginPath(); ctx.arc(o[0], o[1], 5, 0, TAU); ctx.moveTo(o[0] - 10, o[1]); ctx.lineTo(o[0] + 10, o[1]); ctx.moveTo(o[0], o[1] - 10); ctx.lineTo(o[0], o[1] + 10); ctx.stroke();
    }
    ctx.restore();
  }

  _grid(v, ctx, W, H, C) {
    if (v.iso) { this._isoGrid(v, ctx, W, H, C); return; }
    const st = v.gridStep();
    const [x0, y1] = v.toWorld(0, 0), [x1, y0] = v.toWorld(W, H);
    if ((x1 - x0) / st > 700 || (y1 - y0) / st > 700) return;
    ctx.lineWidth = 1; ctx.setLineDash([]);
    for (const major of [false, true]) {
      ctx.strokeStyle = major ? C.major : C.grid;
      ctx.beginPath();
      for (let i = Math.ceil(x0 / st); i <= Math.floor(x1 / st); i++) {
        if ((i % 5 === 0) !== major) continue;
        const x = Math.round(v.toScreen([i * st, 0])[0]) + 0.5;
        ctx.moveTo(x, 0); ctx.lineTo(x, H);
      }
      for (let j = Math.ceil(y0 / st); j <= Math.floor(y1 / st); j++) {
        if ((j % 5 === 0) !== major) continue;
        const y = Math.round(v.toScreen([0, j * st])[1]) + 0.5;
        ctx.moveTo(0, y); ctx.lineTo(W, y);
      }
      ctx.stroke();
    }
    const o = v.toScreen([0, 0]);
    ctx.strokeStyle = C.axisX; ctx.beginPath(); ctx.moveTo(0, Math.round(o[1]) + 0.5); ctx.lineTo(W, Math.round(o[1]) + 0.5); ctx.stroke();
    ctx.strokeStyle = C.axisY; ctx.beginPath(); ctx.moveTo(Math.round(o[0]) + 0.5, 0); ctx.lineTo(Math.round(o[0]) + 0.5, H); ctx.stroke();
  }

  /** Rejilla isométrica: líneas verticales y a ±30° (los tres ejes de la perspectiva isométrica). */
  _isoGrid(v, ctx, W, H, C) {
    const st = v.gridStep(), w = st * COS30, t = Math.tan(Math.PI / 6);
    const [x0, y1] = v.toWorld(0, 0), [x1, y0] = v.toWorld(W, H);
    if ((x1 - x0) / w > 500 || (y1 - y0) / st > 500) return;
    ctx.lineWidth = 1; ctx.setLineDash([]);
    const seg = (a, b) => { const p = v.toScreen(a), q = v.toScreen(b); ctx.moveTo(p[0], p[1]); ctx.lineTo(q[0], q[1]); };
    for (const major of [false, true]) {
      ctx.strokeStyle = major ? C.major : C.grid;
      ctx.beginPath();
      for (let i = Math.ceil(x0 / w); i <= Math.floor(x1 / w); i++) if ((i % 5 === 0) === major) seg([i * w, y0], [i * w, y1]);
      // y = ±t·x + c, con c múltiplo del paso
      for (const sgn of [1, -1]) {
        const cs = [y0 - sgn * t * x0, y0 - sgn * t * x1, y1 - sgn * t * x0, y1 - sgn * t * x1];
        for (let j = Math.ceil(Math.min(...cs) / st); j <= Math.floor(Math.max(...cs) / st); j++) {
          if ((j % 5 === 0) !== major) continue;
          const c = j * st;
          seg([x0, sgn * t * x0 + c], [x1, sgn * t * x1 + c]);
        }
      }
      ctx.stroke();
    }
    const o = v.toScreen([0, 0]);
    ctx.strokeStyle = C.axisY; ctx.beginPath(); ctx.moveTo(Math.round(o[0]) + 0.5, 0); ctx.lineTo(Math.round(o[0]) + 0.5, H); ctx.stroke();
  }

  _label(ctx, text, x, y, C, align = 'center') {
    ctx.font = `11px ${FONT}`;
    const w = ctx.measureText(text).width + 10;
    const lx = align === 'center' ? x - w / 2 : x;
    ctx.fillStyle = C.bg; ctx.globalAlpha = 0.9;
    ctx.fillRect(lx, y - 14, w, 18);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = C.major; ctx.lineWidth = 1; ctx.strokeRect(lx + 0.5, y - 13.5, w - 1, 17);
    ctx.fillStyle = C.fg; ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    ctx.fillText(text, lx + 5, y);
  }

  /** Rótulo de varias líneas junto al cursor (se recoloca para no salirse del panel). */
  _tip(ctx, lines, x, y, C, W, H) {
    ctx.font = `11px ${FONT}`;
    const lh = 16, w = Math.max(...lines.map(t => ctx.measureText(t).width)) + 12, h = lines.length * lh + 6;
    if (x + w > W - 4) x = Math.max(4, x - w - 36);
    if (y + h > H - 4) y = Math.max(4, y - h - 40);
    ctx.globalAlpha = 0.94; ctx.fillStyle = C.bg; ctx.fillRect(x, y, w, h); ctx.globalAlpha = 1;
    ctx.strokeStyle = C.major; ctx.lineWidth = 1; ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    lines.forEach((t, i) => {
      ctx.fillStyle = i === 0 ? C.fg : C.muted;
      if (t.startsWith('›')) ctx.fillStyle = C.accent;
      ctx.fillText(t, x + 6, y + 15 + i * lh);
    });
  }

  _snapMarker(ctx, s, k, C) {
    const [x, y] = s, r = 6;
    ctx.strokeStyle = '#3fd16b'; ctx.lineWidth = 2; ctx.setLineDash([]);
    ctx.beginPath();
    if (k === 'end' || k === 'ins') ctx.rect(x - r, y - r, 2 * r, 2 * r);
    else if (k === 'mid') { ctx.moveTo(x, y - r); ctx.lineTo(x + r, y + r); ctx.lineTo(x - r, y + r); ctx.closePath(); }
    else if (k === 'cen') ctx.arc(x, y, r, 0, TAU);
    else if (k === 'quad') { ctx.moveTo(x, y - r); ctx.lineTo(x + r, y); ctx.lineTo(x, y + r); ctx.lineTo(x - r, y); ctx.closePath(); }
    else if (k === 'int') { ctx.moveTo(x - r, y - r); ctx.lineTo(x + r, y + r); ctx.moveTo(x + r, y - r); ctx.lineTo(x - r, y + r); }
    else { ctx.moveTo(x - r, y - r); ctx.lineTo(x + r, y - r); ctx.lineTo(x - r, y + r); ctx.lineTo(x + r, y + r); ctx.closePath(); }
    ctx.stroke();
    this._label(ctx, SNAP_LABEL[k] || k, x + 12, y + 22, C, 'left');
  }
}

function drawEnt(ctx, v, e, D, st) {
  const S = q => v.toScreen(q), z = v.zoom;
  ctx.strokeStyle = st.color; ctx.fillStyle = st.color; ctx.lineWidth = st.lw;
  ctx.setLineDash(st.dash); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  if (st.sketch && ['line', 'pline', 'circle', 'arc', 'ellipse'].includes(e.type)) { drawSketch(ctx, v, e, st); return; }
  switch (e.type) {
    case 'line': { const a = S(e.a), b = S(e.b); ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke(); break; }
    case 'pline': {
      ctx.beginPath();
      e.pts.forEach((p, i) => { const s = S(p); if (i) ctx.lineTo(s[0], s[1]); else ctx.moveTo(s[0], s[1]); });
      if (e.closed) ctx.closePath();
      ctx.stroke();
      break;
    }
    case 'circle': { const c = S(e.c); ctx.beginPath(); ctx.arc(c[0], c[1], Math.max(0.5, e.r * z), 0, TAU); ctx.stroke(); break; }
    case 'ellipse': {
      ctx.beginPath();
      ellPts(e, 96).forEach((q, i) => { const p = S(q); if (i) ctx.lineTo(p[0], p[1]); else ctx.moveTo(p[0], p[1]); });
      ctx.closePath();
      ctx.stroke();
      break;
    }
    case 'arc': { const c = S(e.c); ctx.beginPath(); ctx.arc(c[0], c[1], Math.max(0.5, e.r * z), -e.a0, -e.a0 - sweepOf(e.a0, e.a1), true); ctx.stroke(); break; }
    case 'text': drawText(ctx, v, e.p, e.text, e.h, e.rot || 0, 'left'); break;
    case 'dim': {
      const g = dimGeom(e, D);
      ctx.lineWidth = Math.min(st.lw, 1.2);
      ctx.beginPath();
      for (const [a, b] of g.lines) { const p = S(a), q = S(b); ctx.moveTo(p[0], p[1]); ctx.lineTo(q[0], q[1]); }
      ctx.stroke();
      for (const a of g.arcs) { const c = S(a.c); ctx.beginPath(); ctx.arc(c[0], c[1], a.r * z, -a.a0, -a.a0 - sweepOf(a.a0, a.a1), true); ctx.stroke(); }
      ctx.setLineDash([]);
      for (const ar of g.arrows) {
        const base = sub(ar.tip, mul(ar.dir, D.arrow)), n = mul(perp(ar.dir), D.arrow / 6);
        const p = S(ar.tip), q = S(add(base, n)), r = S(sub(base, n));
        ctx.beginPath(); ctx.moveTo(p[0], p[1]); ctx.lineTo(q[0], q[1]); ctx.lineTo(r[0], r[1]); ctx.closePath(); ctx.fill();
      }
      if (g.text) drawText(ctx, v, g.text.p, g.text.str, g.text.h, g.text.rot, 'center', g.text.basis);
      break;
    }
  }
}

/** Dibuja un objeto con trazo de lápiz (en píxeles de pantalla: el temblor no depende del zoom). */
function drawSketch(ctx, v, e, st) {
  const seed = hashStr(e.id || `${e.type}${JSON.stringify(e.a || e.c || e.pts?.[0])}`);
  const base = sketchBase(e, seed, 5 / v.zoom).map(s => ({ ...s, pts: s.pts.map(p => v.toScreen(p)) }));
  const strokes = sketchStrokes(base, seed, { amp: 0.9 + 0.35 * st.lw, step: 5, over: 3 + 1.5 * st.lw, bowMax: 3.5 });
  ctx.setLineDash([]);
  const a0 = ctx.globalAlpha;
  for (const s of strokes) {
    ctx.globalAlpha = a0 * (s.pass ? 0.45 : 0.92);
    ctx.lineWidth = st.lw * (s.pass ? 0.75 : 1.05);
    ctx.beginPath();
    s.pts.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])));
    ctx.stroke();
  }
  ctx.globalAlpha = a0;
}

function drawText(ctx, v, p, str, h, rot, align, basis) {
  const px = h * FS * v.zoom;
  if (px < 1.5) return;
  const s = v.toScreen(p);
  ctx.save();
  ctx.translate(s[0], s[1]);
  if (basis) { const [e1, e2] = basis; ctx.transform(e1[0], -e1[1], -e2[0], e2[1], 0, 0); }   // texto isométrico (oblicuo)
  else ctx.rotate(-rot);
  ctx.font = `${px}px ${FONT}`;
  ctx.textAlign = align;
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(str, 0, 0);
  ctx.restore();
}

// =================================================================== vista 2D (un panel)
export class CadView {
  constructor(cad, host) {
    this.cad = cad;
    this.host = host;
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'cad-canvas';
    host.el.append(this.canvas);
    this.cx = 50; this.cy = 30; this.zoom = 3;
    this.W = 1; this.H = 1; this.dpr = 1;
    this.fitted = false;
    this.iso = false;          // modo isométrico de este panel
    this.isoPlane = 'top';
    this.screenCursor = null;
    this.pan = null;
    this._lastMiddle = 0;
    const c = this.canvas;
    const local = e => { const r = c.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
    c.addEventListener('contextmenu', e => e.preventDefault());
    c.addEventListener('pointerdown', e => {
      if (!this.visible) return;
      const [sx, sy] = local(e);
      c.setPointerCapture?.(e.pointerId);
      if (e.button === 1 || e.button === 2 || (e.button === 0 && cad.hand)) {
        e.preventDefault();
        host.el.closest('#viewport')?.classList.add('panning');
        if (e.button === 1 && performance.now() - this._lastMiddle < 350) { this.fit(); cad.redraw(); }
        if (e.button === 1) this._lastMiddle = performance.now();
        this.pan = { sx, sy, cx: this.cx, cy: this.cy, button: e.button, moved: false };
        return;
      }
      if (e.button === 0) cad.onDown(this, this.toWorld(sx, sy), e);
    });
    c.addEventListener('pointermove', e => {
      if (!this.visible) return;
      const [sx, sy] = local(e);
      this.screenCursor = [sx, sy];
      if (this.pan) {
        if (Math.hypot(sx - this.pan.sx, sy - this.pan.sy) > 3) this.pan.moved = true;
        this.cx = this.pan.cx - (sx - this.pan.sx) / this.zoom;
        this.cy = this.pan.cy + (sy - this.pan.sy) / this.zoom;
        cad.redraw();
        return;
      }
      if (cad.hand) { cad.emit('cursor', this.toWorld(sx, sy)); cad.redraw(); return; }
      cad.onMove(this, this.toWorld(sx, sy), e);
    });
    c.addEventListener('pointerup', e => {
      const [sx, sy] = local(e);
      if (this.pan) {
        if (this.pan.button === 2 && !this.pan.moved) cad.enter();
        this.pan = null;
        host.el.closest('#viewport')?.classList.remove('panning');
        this.cad.emit('viewchange');
        return;
      }
      if (e.button === 0) cad.onUp(this, this.toWorld(sx, sy), e);
    });
    c.addEventListener('pointerleave', () => { this.screenCursor = null; cad.leave(this); });
    c.addEventListener('dblclick', e => { const [sx, sy] = local(e); cad.dblClick(this, this.toWorld(sx, sy)); });
    c.addEventListener('wheel', e => {
      e.preventDefault();
      const [sx, sy] = local(e);
      this.zoomAt(sx, sy, Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015)));
    }, { passive: false });
    cad.views.add(this);
  }

  get visible() { return !!this.host.showing; }

  resize() {
    const el = this.host.el;
    const W = el.clientWidth, H = el.clientHeight;
    if (!W || !H) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (W !== this.W || H !== this.H || dpr !== this.dpr) {
      this.canvas.width = Math.round(W * dpr);
      this.canvas.height = Math.round(H * dpr);
      this.W = W; this.H = H; this.dpr = dpr;
    }
    if (this.visible) {
      if (!this.fitted) this.fit();
      this.draw();
    }
  }

  toScreen(p) { return [this.W / 2 + (p[0] - this.cx) * this.zoom, this.H / 2 - (p[1] - this.cy) * this.zoom]; }
  toWorld(sx, sy) { return [this.cx + (sx - this.W / 2) / this.zoom, this.cy - (sy - this.H / 2) / this.zoom]; }

  /** Paso automático: el que da unos 12 px en pantalla (1, 2, 5 × 10ⁿ). */
  autoStep() {
    const target = 12 / this.zoom;
    const p = 10 ** Math.floor(Math.log10(target));
    for (const m of [1, 2, 5, 10]) if (p * m >= target) return p * m;
    return p * 10;
  }

  /** Paso de forzado: el fijado en el plano o, si no hay, el automático. */
  snapStep() { const v = +this.cad.drawing.snapStep; return v > 0 ? v : this.autoStep(); }

  /** Paso con el que se dibuja la rejilla: el de forzado, o un múltiplo suyo si quedaría demasiado denso. */
  gridStep() {
    const v = +this.cad.drawing.snapStep;
    if (!(v > 0)) return this.autoStep();
    for (const m of [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000]) if (v * m * this.zoom >= 7) return v * m;
    return v * 10000;
  }

  fit() {
    const bb = this.cad.fitBox();
    const W = this.W || 600, H = this.H || 400;
    if (!bb) { this.cx = 50; this.cy = 30; this.zoom = Math.max(0.01, W / 300); }
    else {
      const w = Math.max(bb[2] - bb[0], 1e-6), h = Math.max(bb[3] - bb[1], 1e-6);
      this.zoom = Math.max(1e-4, Math.min(1e5, Math.min(W / (w * 1.25), H / (h * 1.25))));
      if (!Number.isFinite(this.zoom)) this.zoom = 3;
      this.cx = (bb[0] + bb[2]) / 2; this.cy = (bb[1] + bb[3]) / 2;
    }
    this.fitted = true;
  }

  zoomAt(sx, sy, f) {
    const before = this.toWorld(sx, sy);
    this.zoom = Math.max(1e-4, Math.min(1e5, this.zoom * f));
    const after = this.toWorld(sx, sy);
    this.cx += before[0] - after[0];
    this.cy += before[1] - after[1];
    this.cad.redraw();
  }

  draw() {
    const ctx = this.canvas.getContext('2d');
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.cad.render(this, ctx, this.W, this.H, {});
  }

  getState() { return { cx: rnd(this.cx), cy: rnd(this.cy), zoom: rnd(this.zoom), iso: this.iso || undefined, isoPlane: this.iso ? this.isoPlane : undefined }; }
  setState(s) {
    if (!s) return;
    if (Number.isFinite(s.zoom)) { this.cx = s.cx; this.cy = s.cy; this.zoom = s.zoom; this.fitted = true; }
    this.iso = !!s.iso;
    this.isoPlane = ISO_PLANES[s.isoPlane] ? s.isoPlane : 'top';
  }

  dispose() { this.cad.views.delete(this); this.canvas.remove(); }
}

/** Encuadre «ver todo» fuera de pantalla (miniaturas): mismo interfaz que una CadView. */
export function fitView(cad, W, H) {
  const v = Object.create(CadView.prototype);
  Object.assign(v, { cad, W, H, dpr: 1, cx: 0, cy: 0, zoom: 1, screenCursor: null });
  v.fit();
  return v;
}
