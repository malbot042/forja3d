// Modo escultor con dos métodos:
//  · «mesh»  (Malla, deformar): el objeto se subdivide y los pinceles mueven sus vértices.
//  · «voxel» (Volumen, tallar): el objeto se convierte en una rejilla de densidad; las herramientas
//    quitan o añaden material y la superficie se reconstruye por bloques con marching cubes.
import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { edgeTable, triTable } from 'three/addons/objects/MarchingCubes.js';
import { MeshBVH, acceleratedRaycast } from 'three-mesh-bvh';
import { encodeGeometry, decodeGeometry } from './io.js';

export const SCULPT_METHODS = {
  mesh: {
    label: 'Malla (deformar)',
    desc: 'Subdivide el objeto y empuja, hunde, alisa o estira su superficie. Ideal para formas orgánicas suaves: caras, relieves, terreno.',
    levels: { low: 20000, mid: 60000, high: 150000 },
    tools: {
      draw:    { label: 'Dibujar', key: 'D', desc: 'Levanta la superficie (Ctrl: la hunde)' },
      inflate: { label: 'Inflar', key: 'I', desc: 'Hincha en todas direcciones (Ctrl: desinfla)' },
      smooth:  { label: 'Suavizar', key: 'S', desc: 'Alisa irregularidades' },
      flatten: { label: 'Aplanar', key: 'F', desc: 'Lleva la zona a un plano' },
      pinch:   { label: 'Pellizcar', key: 'P', desc: 'Junta los vértices para afilar aristas (Ctrl: separa)' },
      grab:    { label: 'Arrastrar', key: 'G', desc: 'Agarra y mueve una zona' },
    },
  },
  voxel: {
    label: 'Volumen (tallar)',
    desc: 'Convierte el objeto en un bloque de material y lo talla quitando o añadiendo materia. Permite agujeros y túneles, como un escultor real.',
    levels: { low: 64, mid: 112, high: 160 },
    tools: {
      chisel:  { label: 'Cincel', key: 'C', desc: 'Quita material (Ctrl: añade)' },
      gouge:   { label: 'Gubia', key: 'U', desc: 'Abre surcos al arrastrar' },
      clay:    { label: 'Arcilla', key: 'A', desc: 'Añade material (Ctrl: quita)' },
      smooth:  { label: 'Lima', key: 'S', desc: 'Suaviza las marcas' },
      flatten: { label: 'Aplanar', key: 'F', desc: 'Desbasta en plano, como un formón (Ctrl: rellena)' },
    },
  },
};

export const LEVEL_LABELS = { low: 'Baja', mid: 'Media', high: 'Alta' };

// ======================================================================
// Codificación de la rejilla (RLE + base64) — síncrona y muy compacta fuera de la superficie
function rleEncode(bytes) {
  const out = [];
  let i = 0;
  while (i < bytes.length) {
    const v = bytes[i];
    let n = 1;
    while (n < 255 && i + n < bytes.length && bytes[i + n] === v) n++;
    out.push(n, v);
    i += n;
  }
  return Uint8Array.from(out);
}

function rleDecode(rle, size) {
  const out = new Uint8Array(size);
  let o = 0;
  for (let i = 0; i < rle.length && o < size; i += 2) {
    out.fill(rle[i + 1], o, Math.min(size, o + rle[i]));
    o += rle[i];
  }
  return out;
}

function b64(u8) {
  let s = '';
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
  return btoa(s);
}

function unb64(str) {
  const bin = atob(str);
  const u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return u8;
}

const rev = () => Math.random().toString(36).slice(2, 10);

/** Solo posiciones e índices (las normales se recalculan al cargar): ocupa la mitad. */
function liteGeometry(g) {
  const lite = new THREE.BufferGeometry();
  lite.setAttribute('position', g.attributes.position);
  lite.setIndex(g.index);
  return lite;
}

// ======================================================================
// Rejilla de densidad
class Grid {
  constructor(dims, origin, cell, dens) {
    this.nx = dims[0]; this.ny = dims[1]; this.nz = dims[2];
    this.origin = new THREE.Vector3(...origin);
    this.h = cell;
    this.d = dens || new Float32Array(this.nx * this.ny * this.nz);
    this.C = 16;
    this.cx = Math.ceil((this.nx - 1) / this.C);
    this.cy = Math.ceil((this.ny - 1) / this.C);
    this.cz = Math.ceil((this.nz - 1) / this.C);
    this.chunks = new Map();
    this.dirty = new Set();
  }

  idx(i, j, k) { return i + this.nx * (j + this.ny * k); }

  static fromData(s) {
    const n = s.dims[0] * s.dims[1] * s.dims[2];
    const q = rleDecode(unb64(s.rle), n);
    const d = new Float32Array(n);
    for (let i = 0; i < n; i++) d[i] = q[i] / 255;
    return new Grid(s.dims, s.origin, s.cell, d);
  }

  toData() {
    const n = this.d.length;
    const q = new Uint8Array(n);
    for (let i = 0; i < n; i++) q[i] = Math.max(0, Math.min(255, Math.round(this.d[i] * 255)));
    return {
      kind: 'voxel', rev: rev(),
      dims: [this.nx, this.ny, this.nz], origin: this.origin.toArray(), cell: this.h,
      rle: b64(rleEncode(q)),
    };
  }

  /** Densidad interpolada (trilineal) en coordenadas locales. */
  sample(x, y, z) {
    const gx = (x - this.origin.x) / this.h, gy = (y - this.origin.y) / this.h, gz = (z - this.origin.z) / this.h;
    if (gx < 0 || gy < 0 || gz < 0 || gx >= this.nx - 1 || gy >= this.ny - 1 || gz >= this.nz - 1) return 0;
    const i = gx | 0, j = gy | 0, k = gz | 0;
    const fx = gx - i, fy = gy - j, fz = gz - k;
    const d = this.d, nx = this.nx, nxy = this.nx * this.ny;
    const o = i + nx * j + nxy * k;
    const c00 = d[o] * (1 - fx) + d[o + 1] * fx;
    const c10 = d[o + nx] * (1 - fx) + d[o + nx + 1] * fx;
    const c01 = d[o + nxy] * (1 - fx) + d[o + nxy + 1] * fx;
    const c11 = d[o + nxy + nx] * (1 - fx) + d[o + nxy + nx + 1] * fx;
    return (c00 * (1 - fy) + c10 * fy) * (1 - fz) + (c01 * (1 - fy) + c11 * fy) * fz;
  }

  gradientAt(x, y, z, out) {
    const e = this.h * 0.75;
    out.set(
      this.sample(x + e, y, z) - this.sample(x - e, y, z),
      this.sample(x, y + e, z) - this.sample(x, y - e, z),
      this.sample(x, y, z + e) - this.sample(x, y, z - e));
    return out;
  }

  /** Raycast (coordenadas locales) contra la isosuperficie 0,5. */
  raycast(ray) {
    const box = new THREE.Box3(this.origin.clone(),
      this.origin.clone().add(new THREE.Vector3(this.nx - 1, this.ny - 1, this.nz - 1).multiplyScalar(this.h)));
    const enter = ray.intersectBox(box, new THREE.Vector3());
    if (!enter && !box.containsPoint(ray.origin)) return null;
    const start = box.containsPoint(ray.origin) ? ray.origin.clone() : enter;
    const step = this.h * 0.5;
    const p = start.clone(), prev = start.clone();
    let prevV = this.sample(p.x, p.y, p.z);
    const maxSteps = Math.ceil(box.getSize(new THREE.Vector3()).length() / step) + 2;
    for (let s = 0; s < maxSteps; s++) {
      prev.copy(p);
      p.addScaledVector(ray.direction, step);
      const v = this.sample(p.x, p.y, p.z);
      if (v >= 0.5 && prevV < 0.5) {
        let a = prev.clone(), b = p.clone();
        for (let it = 0; it < 8; it++) {
          const m = a.clone().add(b).multiplyScalar(0.5);
          if (this.sample(m.x, m.y, m.z) >= 0.5) b.copy(m); else a.copy(m);
        }
        const n = this.gradientAt(b.x, b.y, b.z, new THREE.Vector3()).negate();
        if (n.lengthSq() < 1e-12) n.copy(ray.direction).negate();
        return { point: b, normal: n.normalize() };
      }
      prevV = v;
      if (!box.containsPoint(p)) break;
    }
    return null;
  }

  markDirtyBox(i0, j0, k0, i1, j1, k1) {
    const C = this.C;
    const a = [Math.max(0, Math.floor((i0 - 1) / C)), Math.max(0, Math.floor((j0 - 1) / C)), Math.max(0, Math.floor((k0 - 1) / C))];
    const b = [Math.min(this.cx - 1, Math.floor((i1 + 1) / C)), Math.min(this.cy - 1, Math.floor((j1 + 1) / C)), Math.min(this.cz - 1, Math.floor((k1 + 1) / C))];
    for (let z = a[2]; z <= b[2]; z++) for (let y = a[1]; y <= b[1]; y++) for (let x = a[0]; x <= b[0]; x++) {
      this.dirty.add(x + this.cx * (y + this.cy * z));
    }
  }

  markAllDirty() {
    this.chunks.clear();
    for (let c = 0; c < this.cx * this.cy * this.cz; c++) this.dirty.add(c);
  }

  /** Marching cubes de un bloque de C³ celdas. */
  meshChunk(c) {
    const C = this.C, cx = this.cx, cy = this.cy;
    const bx = (c % cx) * C, by = (Math.floor(c / cx) % cy) * C, bz = Math.floor(c / (cx * cy)) * C;
    const ex = Math.min(bx + C, this.nx - 1), ey = Math.min(by + C, this.ny - 1), ez = Math.min(bz + C, this.nz - 1);
    const d = this.d, nx = this.nx, nxy = this.nx * this.ny, h = this.h, ox = this.origin.x, oy = this.origin.y, oz = this.origin.z;
    const pos = [], nor = [];
    const vals = new Float32Array(8), cidx = new Int32Array(8);
    const ev = new Float32Array(36), en = new Float32Array(36);
    const CO = [0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0, 0, 0, 1, 1, 0, 1, 1, 1, 1, 0, 1, 1];
    const EA = [0, 1, 2, 3, 4, 5, 6, 7, 0, 1, 2, 3], EB = [1, 2, 3, 0, 5, 6, 7, 4, 4, 5, 6, 7];
    const grad = (i, j, k, out, o) => {
      const p = i + nx * j + nxy * k;
      out[o] = d[i < nx - 1 ? p + 1 : p] - d[i > 0 ? p - 1 : p];
      out[o + 1] = d[j < this.ny - 1 ? p + nx : p] - d[j > 0 ? p - nx : p];
      out[o + 2] = d[k < this.nz - 1 ? p + nxy : p] - d[k > 0 ? p - nxy : p];
    };
    const ga = new Float32Array(3), gb = new Float32Array(3);
    for (let k = bz; k < ez; k++) for (let j = by; j < ey; j++) for (let i = bx; i < ex; i++) {
      let ci = 0;
      for (let q = 0; q < 8; q++) {
        const p = (i + CO[q * 3]) + nx * (j + CO[q * 3 + 1]) + nxy * (k + CO[q * 3 + 2]);
        cidx[q] = p;
        vals[q] = d[p];
        if (vals[q] < 0.5) ci |= 1 << q;
      }
      const em = edgeTable[ci];
      if (!em) continue;
      for (let e = 0; e < 12; e++) {
        if (!(em & (1 << e))) continue;
        const a = EA[e], b = EB[e];
        const va = vals[a], vb = vals[b];
        const t = Math.abs(vb - va) < 1e-6 ? 0.5 : (0.5 - va) / (vb - va);
        const ia = i + CO[a * 3], ja = j + CO[a * 3 + 1], ka = k + CO[a * 3 + 2];
        const ib = i + CO[b * 3], jb = j + CO[b * 3 + 1], kb = k + CO[b * 3 + 2];
        ev[e * 3] = ox + (ia + (ib - ia) * t) * h;
        ev[e * 3 + 1] = oy + (ja + (jb - ja) * t) * h;
        ev[e * 3 + 2] = oz + (ka + (kb - ka) * t) * h;
        grad(ia, ja, ka, ga, 0); grad(ib, jb, kb, gb, 0);
        let gx = -(ga[0] + (gb[0] - ga[0]) * t), gy = -(ga[1] + (gb[1] - ga[1]) * t), gz = -(ga[2] + (gb[2] - ga[2]) * t);
        const l = Math.hypot(gx, gy, gz) || 1;
        en[e * 3] = gx / l; en[e * 3 + 1] = gy / l; en[e * 3 + 2] = gz / l;
      }
      const base = ci * 16;
      for (let t = 0; triTable[base + t] !== -1; t += 3) {
        for (let v = 0; v < 3; v++) {
          const e = triTable[base + t + v] * 3;
          pos.push(ev[e], ev[e + 1], ev[e + 2]);
          nor.push(en[e], en[e + 1], en[e + 2]);
        }
      }
    }
    return { pos: new Float32Array(pos), nor: new Float32Array(nor) };
  }

  /** Remalla los bloques sucios. Devuelve el número total de floats. */
  update() {
    for (const c of this.dirty) {
      const m = this.meshChunk(c);
      if (m.pos.length) this.chunks.set(c, m); else this.chunks.delete(c);
    }
    this.dirty.clear();
  }

  /** Une todos los bloques en una geometría (exacta, o reutilizando `into` con drawRange). */
  assemble(into) {
    let total = 0;
    for (const m of this.chunks.values()) total += m.pos.length;
    let g = into;
    if (!g || g.attributes.position.array.length < total) {
      const cap = into ? Math.ceil(total * 1.4) : total;
      g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(Math.max(cap, 9)), 3));
      g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(Math.max(cap, 9)), 3));
    }
    const P = g.attributes.position.array, N = g.attributes.normal.array;
    let o = 0;
    for (const m of this.chunks.values()) { P.set(m.pos, o); N.set(m.nor, o); o += m.pos.length; }
    g.setDrawRange(0, o / 3);
    g.attributes.position.needsUpdate = true;
    g.attributes.normal.needsUpdate = true;
    const max = this.origin.clone().add(new THREE.Vector3(this.nx - 1, this.ny - 1, this.nz - 1).multiplyScalar(this.h));
    g.boundingBox = new THREE.Box3(this.origin.clone(), max);
    g.boundingSphere = g.boundingBox.getBoundingSphere(new THREE.Sphere());
    return g;
  }

  /** Geometría exacta (sin espacio sobrante) para exportar, booleanas, etc. */
  exactGeometry() {
    if (this.dirty.size || !this.chunks.size) { if (!this.chunks.size) this.markAllDirty(); this.update(); }
    const g = this.assemble(null);
    const n = g.drawRange.count * 3;
    const out = new THREE.BufferGeometry();
    out.setAttribute('position', new THREE.BufferAttribute(g.attributes.position.array.slice(0, n), 3));
    out.setAttribute('normal', new THREE.BufferAttribute(g.attributes.normal.array.slice(0, n), 3));
    out.computeBoundingBox();
    out.computeBoundingSphere();
    return out;
  }
}

// ======================================================================
// Conversión de un objeto a escultura
/** Volumen: rejilla de densidad a partir de una malla (cerrada) mediante rayos por columnas. */
function voxelize(geometry, res) {
  const g = geometry.index ? geometry.toNonIndexed() : geometry.clone();
  for (const k of Object.keys(g.attributes)) if (k !== 'position') g.deleteAttribute(k);
  g.computeBoundingBox();
  const bb = g.boundingBox;
  const size = bb.getSize(new THREE.Vector3());
  const maxExt = Math.max(size.x, size.y, size.z, 1e-3);
  const h = maxExt * 1.36 / res;
  const margin = maxExt * 0.18 + 2 * h;
  const origin = bb.min.clone().subScalar(margin);
  const dims = [size.x, size.y, size.z].map(s => Math.ceil((s + 2 * margin) / h) + 1);
  const grid = new Grid(dims, origin.toArray(), h);
  const bvh = new MeshBVH(g);
  const ray = new THREE.Ray(new THREE.Vector3(), new THREE.Vector3(0, 1, 0));
  const { nx, ny, nz } = grid;
  const d = grid.d;
  const jitter = h * 1e-3;
  for (let k = 0; k < nz; k++) for (let i = 0; i < nx; i++) {
    ray.origin.set(origin.x + i * h + jitter, origin.y - h, origin.z + k * h + jitter * 1.7);
    const hits = bvh.raycast(ray, THREE.DoubleSide).map(r => r.distance).sort((a, b) => a - b);
    const ys = [];
    for (const t of hits) if (!ys.length || t - ys[ys.length - 1] > h * 1e-3) ys.push(t);
    if (ys.length < 2) continue;
    if (ys.length % 2) ys.pop();
    for (let s = 0; s < ys.length; s += 2) {
      const y0 = origin.y - h + ys[s], y1 = origin.y - h + ys[s + 1];
      const j0 = Math.max(0, Math.ceil((y0 - origin.y) / h)), j1 = Math.min(ny - 1, Math.floor((y1 - origin.y) / h));
      for (let j = j0; j <= j1; j++) d[i + nx * (j + ny * k)] = 1;
    }
  }
  // Cerca de la superficie, densidad a partir de la distancia exacta a la malla (superficie lisa, sin escalones)
  const inside = d.slice();
  const band = new Uint8Array(d.length);
  for (let k = 1; k < nz - 1; k++) for (let j = 1; j < ny - 1; j++) for (let i = 1; i < nx - 1; i++) {
    const q = i + nx * (j + ny * k);
    const v = inside[q];
    if (inside[q + 1] !== v || inside[q - 1] !== v || inside[q + nx] !== v || inside[q - nx] !== v ||
        inside[q + nx * ny] !== v || inside[q - nx * ny] !== v) {
      for (let dz = -1; dz <= 1; dz++) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) band[q + dx + nx * (dy + ny * dz)] = 1;
    }
  }
  const pt = new THREE.Vector3(), hit = {};
  for (let q = 0; q < d.length; q++) {
    if (!band[q]) continue;
    const i = q % nx, j = Math.floor(q / nx) % ny, k = Math.floor(q / (nx * ny));
    pt.set(origin.x + i * h, origin.y + j * h, origin.z + k * h);
    const r = bvh.closestPointToPoint(pt, hit);
    if (!r) continue;
    const sd = inside[q] ? -r.distance : r.distance;
    d[q] = Math.min(1, Math.max(0, 0.5 - sd / (2 * h)));
  }
  g.dispose();
  return grid;
}

/** Suavizado [1 2 1] separable en una región (también lo usa la «Lima» global). */
function blur(grid, i0, j0, k0, i1, j1, k1, amount) {
  const { nx, ny, nz } = grid;
  const d = grid.d;
  const strides = [1, nx, nx * ny];
  const lims = [[i0, i1, nx], [j0, j1, ny], [k0, k1, nz]];
  for (let ax = 0; ax < 3; ax++) {
    const st = strides[ax];
    const src = d.slice();
    for (let k = k0; k <= k1; k++) for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const c = [i, j, k][ax];
      const p = i + nx * (j + ny * k);
      const a = c > 0 ? src[p - st] : src[p], b = c < lims[ax][2] - 1 ? src[p + st] : src[p];
      const v = (a + 2 * src[p] + b) / 4;
      d[p] = src[p] + (v - src[p]) * amount;
    }
  }
}

/** Malla: soldar vértices y subdividir hasta tener suficientes triángulos. */
function subdivideForSculpt(geometry, targetTris) {
  let g = geometry.clone();
  for (const k of Object.keys(g.attributes)) if (k !== 'position') g.deleteAttribute(k);
  g = mergeVertices(g, 1e-5);
  let pos = Array.from(g.attributes.position.array);
  let idx = g.index ? Array.from(g.index.array) : [...Array(pos.length / 3).keys()];
  g.dispose();
  const maxTris = Math.max(targetTris * 1.7, 4000);
  while (idx.length / 3 < targetTris && (idx.length / 3) * 4 <= maxTris) {
    const mid = new Map();
    const nv0 = pos.length / 3;
    const midpoint = (a, b) => {
      const key = a < b ? a * nv0 + b : b * nv0 + a;
      let m = mid.get(key);
      if (m === undefined) {
        m = pos.length / 3;
        pos.push((pos[a * 3] + pos[b * 3]) / 2, (pos[a * 3 + 1] + pos[b * 3 + 1]) / 2, (pos[a * 3 + 2] + pos[b * 3 + 2]) / 2);
        mid.set(key, m);
      }
      return m;
    };
    const next = [];
    for (let t = 0; t < idx.length; t += 3) {
      const a = idx[t], b = idx[t + 1], c = idx[t + 2];
      const ab = midpoint(a, b), bc = midpoint(b, c), ca = midpoint(c, a);
      next.push(a, ab, ca, ab, b, bc, ca, bc, c, ab, bc, ca);
    }
    idx = next;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setIndex(idx);
  out.computeVertexNormals();
  out.computeBoundingBox();
  out.computeBoundingSphere();
  return out;
}

/** Crea los datos de escultura de un objeto. Devuelve { sculpt, geometry }. */
export function createSculpt(geometry, method, level = 'mid') {
  const lv = SCULPT_METHODS[method].levels[level] ?? SCULPT_METHODS[method].levels.mid;
  if (method === 'voxel') {
    const grid = voxelize(geometry, lv);
    const geom = grid.exactGeometry();
    if (!geom.attributes.position.count) throw new Error('No se pudo convertir en volumen: el objeto no es una malla cerrada (por ejemplo, un plano o una línea 2D).');
    return { sculpt: { ...grid.toData(), level }, geometry: geom, grid };
  }
  const geom = subdivideForSculpt(geometry, lv);
  return { sculpt: { kind: 'mesh', rev: rev(), level, mesh: encodeGeometry(liteGeometry(geom), 'escultura') }, geometry: geom };
}

const voxelCache = new Map();
/** Geometría de una escultura guardada. */
export function sculptGeometry(s) {
  if (s.kind === 'mesh') return decodeGeometry(s.mesh);
  const key = s.rev || s.rle.slice(0, 64);
  let g = voxelCache.get(key);
  if (!g) {
    g = Grid.fromData(s).exactGeometry();
    voxelCache.set(key, g);
    if (voxelCache.size > 12) voxelCache.delete(voxelCache.keys().next().value);
  }
  return g.clone();
}

// ======================================================================
// Sesión de escultura (interacción)
const hashKey = (x, y, z) => ((x + 4096) * 8192 + (y + 4096)) * 8192 + (z + 4096);
const falloff = t => (t >= 1 ? 0 : (1 - t * t) * (1 - t * t));

export class SculptSession {
  constructor(editor, mesh, prefs = {}) {
    this.editor = editor;
    this.mesh = mesh;
    const s = mesh.userData.sculpt;
    this.method = s.kind === 'voxel' ? 'voxel' : 'mesh';
    const tools = SCULPT_METHODS[this.method].tools;
    this.tool = prefs.tool && tools[prefs.tool] ? prefs.tool : Object.keys(tools)[0];
    this.size = prefs.size ?? 0.12;          // fracción del radio del objeto
    this.strength = prefs.strength ?? 0.5;
    this.sym = prefs.sym ?? { x: false, y: false, z: false };
    this.invert = false;

    mesh.updateMatrixWorld(true);
    if (this.method === 'voxel') {
      this.grid = Grid.fromData(s);
      this.grid.markAllDirty();
      this.grid.update();
      const old = mesh.geometry;
      mesh.geometry = this.grid.assemble(null);
      old.dispose();
      this.objRadius = mesh.geometry.boundingSphere.radius / 1.45;
    } else {
      const g = mesh.geometry;
      if (!g.index) throw new Error('La malla de la escultura no tiene índices');
      g.boundsTree = new MeshBVH(g);
      this._origRaycast = mesh.raycast;
      mesh.raycast = acceleratedRaycast;
      this._buildAdjacency();
      g.computeBoundingSphere();
      this.objRadius = g.boundingSphere.radius;
    }

    // cursor: anillo orientado a la normal
    const ring = new THREE.BufferGeometry().setFromPoints(
      Array.from({ length: 65 }, (_, i) => new THREE.Vector3(Math.cos(i / 64 * Math.PI * 2), Math.sin(i / 64 * Math.PI * 2), 0)));
    this.cursor = new THREE.Group();
    const lineMat = new THREE.LineBasicMaterial({ color: 0xffffff, depthTest: false, transparent: true, opacity: 0.9 });
    this.cursorRing = new THREE.Line(ring, lineMat);
    this.cursorInner = new THREE.Line(ring, new THREE.LineBasicMaterial({ color: 0xf2a541, depthTest: false, transparent: true, opacity: 0.8 }));
    this.cursorInner.scale.setScalar(0.5);
    this.cursorNormal = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(0, 0, 0.6)]), lineMat);
    this.cursor.add(this.cursorRing, this.cursorInner, this.cursorNormal);
    this.cursor.renderOrder = 10;
    this.cursor.traverse(o => { o.renderOrder = 10; });
    this.cursor.visible = false;
    editor.scene.add(this.cursor);

    this._down = this._down.bind(this);
    this._move = this._move.bind(this);
    this._up = this._up.bind(this);
    const el = editor.layoutEl;
    el.addEventListener('pointerdown', this._down, true);
    el.addEventListener('pointermove', this._move, true);
    window.addEventListener('pointerup', this._up, true);
    el.classList.add('sculpting');
    this.stroke = null;
    this.needsNormals = false;
    this.stroke_refits = 0;
  }

  get radiusLocal() { return this.size * this.objRadius; }

  _buildAdjacency() {
    const g = this.mesh.geometry;
    const idx = g.index.array, nv = g.attributes.position.count;
    const deg = new Uint32Array(nv);
    for (let t = 0; t < idx.length; t += 3) { deg[idx[t]] += 2; deg[idx[t + 1]] += 2; deg[idx[t + 2]] += 2; }
    const start = new Uint32Array(nv + 1);
    for (let i = 0; i < nv; i++) start[i + 1] = start[i] + deg[i];
    const nb = new Uint32Array(start[nv]);
    const fill = start.slice(0, nv);
    const add = (a, b) => { nb[fill[a]++] = b; };
    for (let t = 0; t < idx.length; t += 3) {
      const a = idx[t], b = idx[t + 1], c = idx[t + 2];
      add(a, b); add(a, c); add(b, a); add(b, c); add(c, a); add(c, b);
    }
    this.adjStart = start;
    this.adj = nb;
  }

  // ---------------------------------------------------------- utilidades
  _viewAt(e) {
    if (e.target.closest?.('.nav-gizmo')) return null;
    return this.editor.views.find(v => v.el === e.target || v.el.contains(e.target));
  }

  /** Raycast en coordenadas locales del objeto. */
  _hit(e) {
    const view = this._viewAt(e);
    if (!view) return null;
    const r = view.el.getBoundingClientRect();
    const ndc = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    const rc = new THREE.Raycaster();
    rc.setFromCamera(ndc, view.camera);
    const inv = this.mesh.matrixWorld.clone().invert();
    const localRay = rc.ray.clone().applyMatrix4(inv);
    localRay.direction.normalize();
    if (this.method === 'voxel') {
      const h = this.grid.raycast(localRay);
      return h ? { ...h, view, ray: localRay } : null;
    }
    rc.firstHitOnly = true;
    const hit = rc.intersectObject(this.mesh, false)[0];
    if (!hit) return null;
    const point = hit.point.clone().applyMatrix4(inv);
    const normal = hit.face.normal.clone();
    // con DoubleSide, orientar la normal hacia la cámara
    if (normal.dot(localRay.direction) > 0) normal.negate();
    return { point, normal, view, ray: localRay };
  }

  _placeCursor(hit) {
    if (!hit) { this.cursor.visible = false; return; }
    const w = hit.point.clone().applyMatrix4(this.mesh.matrixWorld);
    const nW = hit.normal.clone().transformDirection(this.mesh.matrixWorld);
    const sc = new THREE.Vector3().setFromMatrixScale(this.mesh.matrixWorld);
    const r = this.radiusLocal * (sc.x + sc.y + sc.z) / 3;
    this.cursor.position.copy(w).addScaledVector(nW, r * 0.02);
    this.cursor.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), nW);
    this.cursor.scale.setScalar(r);
    const sub = this.invert !== ['clay', 'draw', 'inflate'].includes(this.tool) ? 0xe5614f : 0x6fbf73;
    this.cursorInner.material.color.setHex(['smooth', 'flatten', 'grab'].includes(this.tool) ? 0x5ab0ff : sub);
    this.cursorInner.scale.setScalar(0.25 + this.strength * 0.6);
    this.cursor.visible = true;
  }

  /** Puntos de aplicación con simetría (en coordenadas locales). */
  _mirrors(p, n) {
    const out = [[p, n]];
    for (const ax of ['x', 'y', 'z']) {
      if (!this.sym[ax]) continue;
      for (const [q, m] of [...out]) {
        const q2 = q.clone(), m2 = m.clone();
        q2[ax] = -q2[ax]; m2[ax] = -m2[ax];
        out.push([q2, m2]);
      }
    }
    return out;
  }

  // ---------------------------------------------------------- eventos
  _down(e) {
    if (e.button !== 0 || this.editor.gizmo.dragging) return;
    const hit = this._hit(e);
    if (!hit) return;            // fuera del objeto: la vista orbita con normalidad
    e.stopPropagation();
    e.preventDefault();
    hit.view.el.setPointerCapture?.(e.pointerId);
    this.editor.setActiveView(hit.view);
    this.invert = e.ctrlKey || e.metaKey;
    this.stroke = { last: hit.point.clone(), view: hit.view, pressure: e.pointerType === 'pen' ? e.pressure || 0.5 : 1, dabs: 0 };
    if (this.method === 'mesh') this._buildHash();
    if (this.tool === 'grab') this._grabStart(hit);
    else this._dab(hit);
    this._placeCursor(hit);
  }

  _move(e) {
    if (this.stroke) {
      e.stopPropagation();
      this.invert = e.ctrlKey || e.metaKey;
      if (e.pointerType === 'pen') this.stroke.pressure = e.pressure || this.stroke.pressure;
      if (this.tool === 'grab') { this._grabMove(e); return; }
      const hit = this._hit(e);
      if (!hit) { this._placeCursor(null); return; }
      const spacing = this.radiusLocal * (this.method === 'voxel' ? 0.22 : 0.3);
      const dist = hit.point.distanceTo(this.stroke.last);
      if (dist >= spacing) {
        // rellenar el trazo con golpes intermedios para que sea continuo
        const steps = Math.min(12, Math.floor(dist / spacing));
        for (let s = 1; s <= steps; s++) {
          const p = this.stroke.last.clone().lerp(hit.point, s / steps);
          this._dab({ point: p, normal: hit.normal });
        }
        this.stroke.last.copy(hit.point);
      }
      this._placeCursor(hit);
      return;
    }
    this._placeCursor(this._hit(e));
  }

  _up() {
    if (!this.stroke) return;
    this.stroke = null;
    this.grab = null;
    if (this.method === 'mesh') {
      this.mesh.geometry.computeVertexNormals();
      this.mesh.geometry.boundsTree.refit();
      this.mesh.geometry.computeBoundingSphere();
    }
    this._commitData();
  }

  /** Guarda el estado en el objeto y crea un paso de historial. */
  _commitData() {
    const ud = this.mesh.userData;
    if (this.method === 'voxel') {
      ud.sculpt = { ...this.grid.toData(), level: ud.sculpt.level };
    } else {
      ud.sculpt = { kind: 'mesh', rev: rev(), level: ud.sculpt.level, mesh: encodeGeometry(liteGeometry(this.mesh.geometry), 'escultura') };
    }
    this.editor._commit();
  }

  /** Se llama una vez por fotograma antes de dibujar. */
  tick() {
    if (this.method === 'voxel') {
      if (this.grid.dirty.size) {
        this.grid.update();
        this.mesh.geometry = this.grid.assemble(this.mesh.geometry);
      }
    } else if (this.needsNormals) {
      this.mesh.geometry.computeVertexNormals();
      this.mesh.geometry.attributes.position.needsUpdate = true;
      this.needsNormals = false;
      if (++this.stroke_refits % 6 === 0) this.mesh.geometry.boundsTree?.refit();
    }
  }

  // ---------------------------------------------------------- golpe (dab)
  _dab(hit) {
    const strength = this.strength * (this.stroke?.pressure ?? 1);
    for (const [p, n] of this._mirrors(hit.point, hit.normal)) {
      if (this.method === 'voxel') this._voxelDab(p, n, strength);
      else this._meshDab(p, n, strength);
    }
    if (this.stroke) this.stroke.dabs++;
  }

  // ---- volumen
  _voxelDab(p, n, strength) {
    const g = this.grid, h = g.h, r = this.radiusLocal;
    const rr = r / h;
    const ci = (p.x - g.origin.x) / h, cj = (p.y - g.origin.y) / h, ck = (p.z - g.origin.z) / h;
    const i0 = Math.max(1, Math.floor(ci - rr)), i1 = Math.min(g.nx - 2, Math.ceil(ci + rr));
    const j0 = Math.max(1, Math.floor(cj - rr)), j1 = Math.min(g.ny - 2, Math.ceil(cj + rr));
    const k0 = Math.max(1, Math.floor(ck - rr)), k1 = Math.min(g.nz - 2, Math.ceil(ck + rr));
    if (i0 > i1 || j0 > j1 || k0 > k1) return;
    const d = g.d, nx = g.nx, nxy = g.nx * g.ny;
    let tool = this.tool, sign = this.invert ? -1 : 1;
    if (tool === 'clay') { tool = 'chisel'; sign = -sign; }
    if (tool === 'smooth') { blurSphere(g, ci, cj, ck, rr, strength); g.markDirtyBox(i0, j0, k0, i1, j1, k1); return; }
    for (let k = k0; k <= k1; k++) for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const dx = i - ci, dy = j - cj, dz = k - ck;
      const t = Math.sqrt(dx * dx + dy * dy + dz * dz) / rr;
      if (t >= 1) continue;
      const q = i + nx * j + nxy * k;
      if (tool === 'chisel') {
        const f = falloff(t);
        d[q] = Math.min(1, Math.max(0, d[q] - sign * strength * 0.3 * f));
      } else if (tool === 'gouge') {
        // surco: perfil duro y más profundo cerca del centro
        const f = t < 0.55 ? 1 : falloff((t - 0.55) / 0.45);
        d[q] = Math.min(1, Math.max(0, d[q] - sign * strength * 0.55 * f));
      } else if (tool === 'flatten') {
        const wx = g.origin.x + i * h - p.x, wy = g.origin.y + j * h - p.y, wz = g.origin.z + k * h - p.z;
        const sd = wx * n.x + wy * n.y + wz * n.z;             // >0 por encima del plano
        const target = Math.min(1, Math.max(0, 0.5 - sd / (2 * h)));
        const f = falloff(t) * strength;
        const v = sign > 0 ? Math.min(d[q], target) : Math.max(d[q], target);
        d[q] += (v - d[q]) * f;
      }
    }
    g.markDirtyBox(i0, j0, k0, i1, j1, k1);
  }

  // ---- malla
  _buildHash() {
    const pos = this.mesh.geometry.attributes.position.array;
    const cs = this.radiusLocal;
    const map = new Map();
    for (let v = 0, n = pos.length / 3; v < n; v++) {
      const key = hashKey(Math.floor(pos[v * 3] / cs), Math.floor(pos[v * 3 + 1] / cs), Math.floor(pos[v * 3 + 2] / cs));
      let a = map.get(key);
      if (!a) map.set(key, a = []);
      a.push(v);
    }
    this.hash = { map, cs };
  }

  _near(p, r) {
    const { map, cs } = this.hash;
    const pos = this.mesh.geometry.attributes.position.array;
    const out = [];
    const r2 = r * r;
    const x0 = Math.floor((p.x - r) / cs), x1 = Math.floor((p.x + r) / cs);
    const y0 = Math.floor((p.y - r) / cs), y1 = Math.floor((p.y + r) / cs);
    const z0 = Math.floor((p.z - r) / cs), z1 = Math.floor((p.z + r) / cs);
    for (let z = z0; z <= z1; z++) for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const a = map.get(hashKey(x, y, z));
      if (!a) continue;
      for (const v of a) {
        const dx = pos[v * 3] - p.x, dy = pos[v * 3 + 1] - p.y, dz = pos[v * 3 + 2] - p.z;
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 < r2) out.push(v, Math.sqrt(d2) / r);
      }
    }
    return out;
  }

  _meshDab(p, n, strength) {
    const g = this.mesh.geometry;
    const pos = g.attributes.position.array, nor = g.attributes.normal.array;
    const r = this.radiusLocal;
    const near = this._near(p, r);
    if (!near.length) return;
    const sign = this.invert ? -1 : 1;
    const amt = r * strength * 0.12;
    if (this.tool === 'draw') {
      for (let q = 0; q < near.length; q += 2) {
        const v = near[q] * 3, f = falloff(near[q + 1]) * amt * sign;
        pos[v] += n.x * f; pos[v + 1] += n.y * f; pos[v + 2] += n.z * f;
      }
    } else if (this.tool === 'inflate') {
      for (let q = 0; q < near.length; q += 2) {
        const v = near[q] * 3, f = falloff(near[q + 1]) * amt * sign;
        pos[v] += nor[v] * f; pos[v + 1] += nor[v + 1] * f; pos[v + 2] += nor[v + 2] * f;
      }
    } else if (this.tool === 'smooth') {
      const { adjStart: st, adj } = this;
      const upd = [];
      for (let q = 0; q < near.length; q += 2) {
        const v = near[q];
        let ax = 0, ay = 0, az = 0, c = 0;
        for (let e = st[v]; e < st[v + 1]; e++) { const u = adj[e] * 3; ax += pos[u]; ay += pos[u + 1]; az += pos[u + 2]; c++; }
        if (!c) continue;
        const f = falloff(near[q + 1]) * Math.min(1, strength * 1.2);
        upd.push(v * 3, pos[v * 3] + (ax / c - pos[v * 3]) * f, pos[v * 3 + 1] + (ay / c - pos[v * 3 + 1]) * f, pos[v * 3 + 2] + (az / c - pos[v * 3 + 2]) * f);
      }
      for (let q = 0; q < upd.length; q += 4) { pos[upd[q]] = upd[q + 1]; pos[upd[q] + 1] = upd[q + 2]; pos[upd[q] + 2] = upd[q + 3]; }
    } else if (this.tool === 'flatten') {
      // plano por el centro de los vértices afectados
      let cx = 0, cy = 0, cz = 0, c = 0;
      for (let q = 0; q < near.length; q += 2) { const v = near[q] * 3; cx += pos[v]; cy += pos[v + 1]; cz += pos[v + 2]; c++; }
      cx /= c; cy /= c; cz /= c;
      for (let q = 0; q < near.length; q += 2) {
        const v = near[q] * 3;
        const sd = (pos[v] - cx) * n.x + (pos[v + 1] - cy) * n.y + (pos[v + 2] - cz) * n.z;
        if (sign > 0 ? sd < 0 : sd > 0) continue;   // solo rebaja lo que sobresale (Ctrl: rellena huecos)
        const f = falloff(near[q + 1]) * Math.min(1, strength * 1.1);
        pos[v] -= n.x * sd * f; pos[v + 1] -= n.y * sd * f; pos[v + 2] -= n.z * sd * f;
      }
    } else if (this.tool === 'pinch') {
      for (let q = 0; q < near.length; q += 2) {
        const v = near[q] * 3;
        let dx = p.x - pos[v], dy = p.y - pos[v + 1], dz = p.z - pos[v + 2];
        const dn = dx * n.x + dy * n.y + dz * n.z;
        dx -= n.x * dn; dy -= n.y * dn; dz -= n.z * dn;          // solo en el plano tangente
        const f = falloff(near[q + 1]) * strength * 0.25 * sign;
        pos[v] += dx * f; pos[v + 1] += dy * f; pos[v + 2] += dz * f;
      }
    }
    g.attributes.position.needsUpdate = true;
    this.needsNormals = true;
    this.stroke_refits = this.stroke_refits || 0;
  }

  _grabStart(hit) {
    const pos = this.mesh.geometry.attributes.position.array;
    const sets = this._mirrors(hit.point, hit.normal).map(([p], m) => {
      const near = this._near(p, this.radiusLocal);
      const items = [];
      for (let q = 0; q < near.length; q += 2) {
        const v = near[q];
        items.push(v, falloff(near[q + 1]), pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2]);
      }
      return items;
    });
    // plano de arrastre: perpendicular a la vista, por el punto agarrado
    const camDir = new THREE.Vector3();
    hit.view.camera.getWorldDirection(camDir);
    const wp = hit.point.clone().applyMatrix4(this.mesh.matrixWorld);
    this.grab = { sets, plane: new THREE.Plane().setFromNormalAndCoplanarPoint(camDir, wp), start: wp.clone() };
  }

  _grabMove(e) {
    if (!this.grab) return;
    const view = this.stroke.view;
    const r = view.el.getBoundingClientRect();
    const rc = new THREE.Raycaster();
    rc.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), view.camera);
    const w = rc.ray.intersectPlane(this.grab.plane, new THREE.Vector3());
    if (!w) return;
    const inv = this.mesh.matrixWorld.clone().invert();
    const delta = w.clone().applyMatrix4(inv).sub(this.grab.start.clone().applyMatrix4(inv));
    const pos = this.mesh.geometry.attributes.position.array;
    const axes = ['x', 'y', 'z'].filter(a => this.sym[a]);
    this.grab.sets.forEach((items, m) => {
      // las copias simétricas reciben el desplazamiento reflejado
      const dd = delta.clone();
      let bit = 0;
      for (const a of axes) { if (m & (1 << bit)) dd[a] = -dd[a]; bit++; }
      const k = this.strength * 1.6;
      for (let q = 0; q < items.length; q += 5) {
        const v = items[q] * 3, f = Math.min(1, items[q + 1] * k);
        pos[v] = items[q + 2] + dd.x * f; pos[v + 1] = items[q + 3] + dd.y * f; pos[v + 2] = items[q + 4] + dd.z * f;
      }
    });
    this.mesh.geometry.attributes.position.needsUpdate = true;
    this.needsNormals = true;
  }

  // ---------------------------------------------------------- acciones globales
  /** Suaviza todo el objeto (Lima/Suavizar global). */
  smoothAll(amount = 0.6) {
    if (this.method === 'voxel') {
      const g = this.grid;
      blur(g, 1, 1, 1, g.nx - 2, g.ny - 2, g.nz - 2, amount);
      g.markAllDirty();
    } else {
      const g = this.mesh.geometry, pos = g.attributes.position.array;
      const { adjStart: st, adj } = this;
      const src = pos.slice();
      for (let v = 0, n = pos.length / 3; v < n; v++) {
        let ax = 0, ay = 0, az = 0, c = 0;
        for (let e = st[v]; e < st[v + 1]; e++) { const u = adj[e] * 3; ax += src[u]; ay += src[u + 1]; az += src[u + 2]; c++; }
        if (!c) continue;
        pos[v * 3] += (ax / c - src[v * 3]) * amount;
        pos[v * 3 + 1] += (ay / c - src[v * 3 + 1]) * amount;
        pos[v * 3 + 2] += (az / c - src[v * 3 + 2]) * amount;
      }
      g.attributes.position.needsUpdate = true;
      g.computeVertexNormals();
      g.boundsTree.refit();
    }
    this._commitData();
  }

  /** Termina la sesión. La geometría queda exacta (sin espacio de trabajo sobrante). */
  dispose() {
    const el = this.editor.layoutEl;
    el.removeEventListener('pointerdown', this._down, true);
    el.removeEventListener('pointermove', this._move, true);
    window.removeEventListener('pointerup', this._up, true);
    el.classList.remove('sculpting');
    this.editor.scene.remove(this.cursor);
    this.cursor.traverse(o => { o.geometry?.dispose(); o.material?.dispose(); });
    if (this.method === 'voxel') {
      const old = this.mesh.geometry;
      this.mesh.geometry = this.grid.exactGeometry();
      old.dispose();
    } else {
      this.mesh.raycast = this._origRaycast || THREE.Mesh.prototype.raycast;
      this.mesh.geometry.boundsTree = null;
    }
  }

  prefs() { return { tool: this.tool, size: this.size, strength: this.strength, sym: { ...this.sym } }; }
}

/** Lima: suavizado dentro de una esfera (coordenadas de rejilla). */
function blurSphere(g, ci, cj, ck, rr, strength) {
  const i0 = Math.max(1, Math.floor(ci - rr)), i1 = Math.min(g.nx - 2, Math.ceil(ci + rr));
  const j0 = Math.max(1, Math.floor(cj - rr)), j1 = Math.min(g.ny - 2, Math.ceil(cj + rr));
  const k0 = Math.max(1, Math.floor(ck - rr)), k1 = Math.min(g.nz - 2, Math.ceil(ck + rr));
  const d = g.d, nx = g.nx, nxy = g.nx * g.ny;
  const tmp = [];
  for (let k = k0; k <= k1; k++) for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
    const t = Math.hypot(i - ci, j - cj, k - ck) / rr;
    if (t >= 1) continue;
    const q = i + nx * j + nxy * k;
    const avg = (d[q - 1] + d[q + 1] + d[q - nx] + d[q + nx] + d[q - nxy] + d[q + nxy] + 2 * d[q]) / 8;
    tmp.push(q, d[q] + (avg - d[q]) * falloff(t) * Math.min(1, strength * 1.4));
  }
  for (let s = 0; s < tmp.length; s += 2) d[tmp[s]] = tmp[s + 1];
}
