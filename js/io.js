// Exportación e importación de modelos 3D: glTF (.gltf), GLB, OBJ (+MTL) y STL.
// Los modelos importados se guardan como objetos «Malla importada» (geometría en base64).
import * as THREE from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { OBJExporter } from 'three/addons/exporters/OBJExporter.js';
import { STLExporter } from 'three/addons/exporters/STLExporter.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';

export const EXPORT_FORMATS = {
  glb:  { label: 'GLB', ext: 'glb', desc: 'glTF binario en un solo archivo. El más recomendable para Blender, Unity, Godot, visores web y AR.' },
  gltf: { label: 'glTF', ext: 'gltf', desc: 'glTF 2.0 en texto (JSON con los datos incrustados). Legible y compatible con casi todo.' },
  obj:  { label: 'OBJ', ext: 'obj', desc: 'Formato clásico de mallas. Se descarga también un .mtl con los colores.' },
  stl:  { label: 'STL', ext: 'stl', desc: 'Para impresión 3D y laminadores (Cura, PrusaSlicer…). Sin colores. 1 unidad = 1 mm en la mayoría de laminadores.' },
};

export const IMPORT_EXTENSIONS = ['glb', 'gltf', 'obj', 'stl'];

// ------------------------------------------------------------- utilidades
const slug = s => (s || 'modelo').normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() || 'modelo';

function download(data, filename, type) {
  const blob = data instanceof Blob ? data : new Blob([data], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function toBase64(typed) {
  const bytes = new Uint8Array(typed.buffer, typed.byteOffset, typed.byteLength);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

function fromBase64(b64, Type) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Type(bytes.buffer);
}

/** Geometría → datos serializables (posiciones, normales e índices en base64). */
export function encodeGeometry(geom, source) {
  const pos = geom.attributes.position.array;
  const out = {
    source,
    vertices: geom.attributes.position.count,
    positions: toBase64(pos instanceof Float32Array ? pos : new Float32Array(pos)),
  };
  if (geom.attributes.normal) {
    const n = geom.attributes.normal.array;
    out.normals = toBase64(n instanceof Float32Array ? n : new Float32Array(n));
  }
  if (geom.index) out.index = toBase64(new Uint32Array(geom.index.array));
  return out;
}

const decodeCache = new Map();
/** Datos serializados → BufferGeometry (con caché). */
export function decodeGeometry(mesh) {
  const key = `${mesh.vertices}:${mesh.positions.length}:${mesh.positions.slice(0, 48)}:${mesh.positions.slice(-48)}:${mesh.index?.length || 0}`;
  let g = decodeCache.get(key);
  if (!g) {
    g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(fromBase64(mesh.positions, Float32Array), 3));
    if (mesh.normals) g.setAttribute('normal', new THREE.BufferAttribute(fromBase64(mesh.normals, Float32Array), 3));
    if (mesh.index) g.setIndex(new THREE.BufferAttribute(fromBase64(mesh.index, Uint32Array), 1));
    if (!mesh.normals) g.computeVertexNormals();
    g.computeBoundingBox();
    g.computeBoundingSphere();
    decodeCache.set(key, g);
    if (decodeCache.size > 40) decodeCache.delete(decodeCache.keys().next().value);
  }
  return g.clone();
}

export const meshDataSize = m => (m.positions?.length || 0) + (m.normals?.length || 0) + (m.index?.length || 0);

// --------------------------------------------------------------- exportar
/** Construye una escena limpia (sin ayudas) con los objetos visibles del editor. */
function buildExportScene(editor, selectionOnly) {
  const scene = new THREE.Scene();
  const ids = selectionOnly ? editor.selection : [...editor.objects.keys()];
  for (const id of ids) {
    const src = editor.objects.get(id);
    if (!src || !src.visible) continue;
    const m = src.userData.material;
    const mat = new THREE.MeshStandardMaterial({
      name: `${src.userData.name} material`,
      color: new THREE.Color(m.color), metalness: m.metalness, roughness: m.roughness,
      transparent: m.opacity < 1, opacity: m.opacity, flatShading: !!m.flatShading,
      side: src.material.side,
    });
    const geom = src.geometry.clone();
    for (const name of Object.keys(geom.attributes)) if (name !== 'position' && name !== 'normal' && name !== 'uv') geom.deleteAttribute(name);
    const mesh = new THREE.Mesh(geom, mat);
    mesh.name = src.userData.name;
    mesh.position.copy(src.position);
    mesh.quaternion.copy(src.quaternion);
    mesh.scale.copy(src.scale);
    scene.add(mesh);
  }
  scene.updateMatrixWorld(true);
  return scene;
}

function dispose(scene) {
  scene.traverse(o => { if (o.isMesh) { o.geometry.dispose(); o.material.dispose(); } });
}

/** Exporta la escena (o la selección). Devuelve el número de objetos exportados. */
export async function exportModel(editor, format, { name = 'modelo', selectionOnly = false, withMtl = true } = {}) {
  const scene = buildExportScene(editor, selectionOnly);
  const count = scene.children.length;
  if (!count) throw new Error(selectionOnly ? 'No hay objetos visibles seleccionados' : 'La escena no tiene objetos visibles');
  const base = slug(name);
  try {
    if (format === 'glb' || format === 'gltf') {
      const result = await new GLTFExporter().parseAsync(scene, { binary: format === 'glb', onlyVisible: true });
      if (format === 'glb') download(new Blob([result], { type: 'model/gltf-binary' }), `${base}.glb`);
      else download(JSON.stringify(result, null, 1), `${base}.gltf`, 'model/gltf+json');
    } else if (format === 'obj') {
      // un material por objeto con nombre sin espacios (el exportador escribe «usemtl <nombre>»)
      const mats = scene.children.map((mesh, i) => {
        const id = `${slug(mesh.name).replace(/-/g, '_')}_${i + 1}`;
        mesh.material.name = id;
        const m = mesh.material;
        const c = m.color.clone().convertLinearToSRGB();
        const ks = (m.metalness * 0.5).toFixed(3);
        return `newmtl ${id}\nKd ${c.r.toFixed(4)} ${c.g.toFixed(4)} ${c.b.toFixed(4)}\nKa 0 0 0\nKs ${ks} ${ks} ${ks}\n` +
          `Ns ${Math.round((1 - m.roughness) * 200)}\nd ${m.opacity.toFixed(3)}\nillum 2\n`;
      });
      let obj = new OBJExporter().parse(scene);
      if (withMtl) {
        obj = `# Forja 3D\nmtllib ${base}.mtl\n${obj}`;
        download(obj, `${base}.obj`, 'text/plain');
        setTimeout(() => download(`# Forja 3D\n${mats.join('\n')}`, `${base}.mtl`, 'text/plain'), 400);
      } else {
        download(`# Forja 3D\n${obj}`, `${base}.obj`, 'text/plain');
      }
    } else if (format === 'stl') {
      const data = new STLExporter().parse(scene, { binary: true });
      download(new Blob([data], { type: 'model/stl' }), `${base}.stl`);
    } else {
      throw new Error(`Formato desconocido: ${format}`);
    }
  } finally {
    dispose(scene);
  }
  return count;
}

// --------------------------------------------------------------- importar
const read = (file, asText) => new Promise((res, rej) => {
  const r = new FileReader();
  r.onload = () => res(r.result);
  r.onerror = () => rej(new Error('No se pudo leer el archivo'));
  asText ? r.readAsText(file) : r.readAsArrayBuffer(file);
});

/**
 * Lee un archivo de modelo y devuelve sus mallas en coordenadas de mundo:
 * [{ name, geometry, matrix, material: {color, metalness, roughness, opacity} }]
 */
/** Lee los colores (Kd) y opacidad (d) de un archivo .mtl. */
function parseMtl(text) {
  const out = {};
  let cur = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    const [key, ...rest] = line.split(/\s+/);
    if (key === 'newmtl') { cur = rest.join(' '); out[cur] = {}; }
    else if (cur && key === 'Kd') out[cur].color = new THREE.Color().setRGB(+rest[0], +rest[1], +rest[2], THREE.SRGBColorSpace);
    else if (cur && key === 'd') out[cur].opacity = +rest[0];
    else if (cur && key === 'Tr') out[cur].opacity = 1 - +rest[0];
  }
  return out;
}

export async function loadModelFile(file, { mtlText } = {}) {
  const ext = file.name.split('.').pop().toLowerCase();
  let root;
  if (ext === 'glb' || ext === 'gltf') {
    const data = await read(file, ext === 'gltf');
    if (ext === 'gltf') {
      const json = JSON.parse(data);
      const external = (json.buffers || []).some(b => b.uri && !b.uri.startsWith('data:'));
      if (external) throw new Error('Este .gltf usa un archivo .bin externo. Expórtalo como .glb (o glTF incrustado) e impórtalo de nuevo.');
    }
    const gltf = await new Promise((res, rej) => new GLTFLoader().parse(data, '', res, err => rej(
      new Error(/draco|meshopt|KHR_draco|EXT_meshopt/i.test(String(err?.message || err))
        ? 'El archivo usa compresión Draco/Meshopt, que no está soportada. Expórtalo sin compresión.'
        : `glTF no válido: ${err?.message || err}`))));
    root = gltf.scene || gltf.scenes?.[0];
  } else if (ext === 'obj') {
    root = new OBJLoader().parse(await read(file, true));
    if (mtlText) {
      const lib = parseMtl(mtlText);
      root.traverse(o => {
        if (!o.isMesh) return;
        for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
          const def = lib[m.name];
          if (def?.color) m.color.copy(def.color);
          if (def?.opacity != null) m.opacity = def.opacity;
        }
      });
    }
  } else if (ext === 'stl') {
    const geom = new STLLoader().parse(await read(file, false));
    root = new THREE.Group();
    const color = geom.hasColors ? new THREE.Color(geom.userData?.defaultColor ?? 0xd9d4c7) : new THREE.Color(0xd9d4c7);
    root.add(new THREE.Mesh(geom, new THREE.MeshStandardMaterial({ color })));
  } else {
    throw new Error(`Formato no soportado: .${ext} (usa ${IMPORT_EXTENSIONS.map(e => '.' + e).join(', ')})`);
  }
  if (!root) throw new Error('El archivo no contiene ninguna escena');
  root.updateMatrixWorld(true);

  const baseName = file.name.replace(/\.[^.]+$/, '');
  const parts = [];
  root.traverse(o => {
    if (!o.isMesh || !o.geometry?.attributes?.position) return;
    let g = o.geometry.clone();
    for (const name of Object.keys(g.attributes)) if (name !== 'position' && name !== 'normal') g.deleteAttribute(name);
    g.morphAttributes = {};
    if (!g.attributes.normal) g.computeVertexNormals();
    const mat = Array.isArray(o.material) ? o.material[0] : o.material;
    parts.push({
      name: o.name || mat?.name || baseName,
      geometry: g,
      matrix: o.matrixWorld.clone(),
      material: {
        color: mat?.color ? `#${mat.color.getHexString()}` : '#d9d4c7',
        metalness: mat?.metalness ?? 0.05,
        roughness: mat?.roughness ?? 0.6,
        opacity: mat?.opacity ?? 1,
        flatShading: false,
      },
    });
  });
  if (!parts.length) throw new Error('No se encontraron mallas en el archivo');
  return parts;
}
