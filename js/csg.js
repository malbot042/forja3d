// Geometría de objetos, incluidas las operaciones booleanas (CSG) con three-bvh-csg.
// Un objeto "boolean" guarda sus operandos (no destructivo): la malla se recalcula al cargar.
import * as THREE from 'three';
import { Brush, Evaluator, ADDITION, SUBTRACTION, INTERSECTION } from 'three-bvh-csg';
import { buildGeometry } from './primitives.js';
import { decodeGeometry } from './io.js';
import { sculptGeometry } from './sculpt.js';

const DEG = THREE.MathUtils.DEG2RAD;
const OPS = { union: ADDITION, subtract: SUBTRACTION, intersect: INTERSECTION };

const evaluator = new Evaluator();
evaluator.attributes = ['position', 'normal'];
evaluator.useGroups = false;

// Caché de resultados CSG (clave = definición JSON) para que deshacer/recargar sea rápido.
const cache = new Map();
const CACHE_MAX = 60;

function cacheGet(key) {
  const g = cache.get(key);
  if (!g) return null;
  cache.delete(key);
  cache.set(key, g);
  return g.clone();
}

export function cachePut(key, geom) {
  cache.set(key, geom.clone());
  while (cache.size > CACHE_MAX) {
    const first = cache.keys().next().value;
    cache.get(first).dispose();
    cache.delete(first);
  }
}

export const csgKey = data => JSON.stringify([data.params?.op, data.operands]);

/** Geometría para cualquier objeto serializado (primitiva, perfil o booleana). */
export function geometryFor(data) {
  if (data.type === 'mesh') return decodeGeometry(data.mesh);
  if (data.type === 'sculpt') return sculptGeometry(data.sculpt);
  if (data.type !== 'boolean') return buildGeometry(data.type, data.params, data.shape);
  const key = csgKey(data);
  const hit = cacheGet(key);
  if (hit) return hit;
  const g = evaluateBoolean(data.params.op, data.operands);
  cachePut(key, g);
  return g;
}

/** Prepara una geometría para CSG: sin índice y solo con posición y normal. */
function prepare(geom) {
  let g = geom.index ? geom.toNonIndexed() : geom;
  if (g !== geom) geom.dispose();
  for (const name of Object.keys(g.attributes)) if (name !== 'position' && name !== 'normal') g.deleteAttribute(name);
  if (!g.attributes.normal) g.computeVertexNormals();
  g.clearGroups();
  return g;
}

export function matrixOf(d) {
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(...(d.rotation || [0, 0, 0]).map(v => v * DEG)));
  return m.compose(new THREE.Vector3(...(d.position || [0, 0, 0])), q, new THREE.Vector3(...(d.scale || [1, 1, 1])));
}

function brushFor(d) {
  const b = new Brush(prepare(geometryFor(d)));
  b.applyMatrix4(matrixOf(d));
  b.updateMatrixWorld(true);
  return b;
}

/** Evalúa A op B op C… en el espacio local del objeto resultante. */
export function evaluateBoolean(op, operands) {
  const mode = OPS[op] ?? ADDITION;
  if (!operands?.length) return new THREE.BufferGeometry();
  let acc = brushFor(operands[0]);
  for (let i = 1; i < operands.length; i++) {
    const b = brushFor(operands[i]);
    const next = evaluator.evaluate(acc, b, mode);
    if (i > 1) acc.geometry.dispose();
    b.geometry.dispose();
    next.updateMatrixWorld(true);
    acc = next;
  }
  let g = acc.geometry;
  if (operands.length === 1) {
    g = g.clone().applyMatrix4(acc.matrixWorld);
  }
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return g;
}
