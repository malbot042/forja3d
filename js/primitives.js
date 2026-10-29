// Catálogo de primitivas: parámetros editables + fábrica de geometría.
import * as THREE from 'three';

const P = (key, label, def, min, max, step = 0.1, int = false) => ({ key, label, def, min, max, step, int });
const SEG = (key, label, def, min = 3, max = 128) => P(key, label, def, min, max, 1, true);

export const PRIMITIVES = {
  box: {
    label: 'Cubo',
    icon: '<path d="M12 3 20 7.5v9L12 21l-8-4.5v-9z"/><path d="M4 7.5 12 12l8-4.5M12 12v9"/>',
    params: [P('width', 'Ancho', 1, 0.01, 10000), P('height', 'Alto', 1, 0.01, 10000), P('depth', 'Fondo', 1, 0.01, 10000),
             SEG('segments', 'Segmentos', 1, 1, 32)],
    geometry: p => new THREE.BoxGeometry(p.width, p.height, p.depth, p.segments, p.segments, p.segments),
  },
  sphere: {
    label: 'Esfera',
    icon: '<circle cx="12" cy="12" r="8.5"/><ellipse cx="12" cy="12" rx="8.5" ry="3.2"/><path d="M12 3.5v17"/>',
    params: [P('radius', 'Radio', 0.5, 0.01, 100), SEG('widthSegments', 'Seg. horiz.', 32), SEG('heightSegments', 'Seg. vert.', 16, 2)],
    geometry: p => new THREE.SphereGeometry(p.radius, p.widthSegments, p.heightSegments),
  },
  cylinder: {
    label: 'Cilindro',
    icon: '<ellipse cx="12" cy="5.5" rx="7" ry="2.5"/><path d="M5 5.5v13c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5v-13"/>',
    params: [P('radiusTop', 'Radio sup.', 0.5, 0, 100), P('radiusBottom', 'Radio inf.', 0.5, 0, 100),
             P('height', 'Altura', 1, 0.01, 100), SEG('radialSegments', 'Segmentos', 32)],
    geometry: p => new THREE.CylinderGeometry(p.radiusTop, p.radiusBottom, p.height, p.radialSegments),
  },
  cone: {
    label: 'Cono',
    icon: '<path d="M12 3 5 18.5"/><path d="M12 3l7 15.5"/><ellipse cx="12" cy="18.5" rx="7" ry="2.5"/>',
    params: [P('radius', 'Radio', 0.5, 0.01, 100), P('height', 'Altura', 1, 0.01, 100), SEG('radialSegments', 'Segmentos', 32)],
    geometry: p => new THREE.ConeGeometry(p.radius, p.height, p.radialSegments),
  },
  pyramid: {
    label: 'Pirámide',
    icon: '<path d="M12 3 3.5 17 12 21l8.5-4z"/><path d="M12 3v18"/>',
    params: [P('radius', 'Radio base', 0.7, 0.01, 100), P('height', 'Altura', 1, 0.01, 100), SEG('sides', 'Lados', 4, 3, 16)],
    geometry: p => new THREE.ConeGeometry(p.radius, p.height, p.sides, 1, false, Math.PI / p.sides),
  },
  torus: {
    label: 'Toro',
    icon: '<ellipse cx="12" cy="12" rx="9" ry="5.5"/><ellipse cx="12" cy="11.5" rx="3.6" ry="1.8"/>',
    params: [P('radius', 'Radio', 0.5, 0.01, 100), P('tube', 'Grosor', 0.2, 0.001, 50),
             SEG('radialSegments', 'Seg. tubo', 16), SEG('tubularSegments', 'Seg. anillo', 48)],
    geometry: p => new THREE.TorusGeometry(p.radius, p.tube, p.radialSegments, p.tubularSegments),
  },
  capsule: {
    label: 'Cápsula',
    icon: '<rect x="7" y="2.5" width="10" height="19" rx="5"/>',
    params: [P('radius', 'Radio', 0.35, 0.01, 100), P('length', 'Longitud', 0.8, 0, 100),
             SEG('capSegments', 'Seg. tapas', 8, 1, 64), SEG('radialSegments', 'Seg. radiales', 24)],
    geometry: p => new THREE.CapsuleGeometry(p.radius, p.length, p.capSegments, p.radialSegments),
  },
  plane: {
    label: 'Plano',
    icon: '<path d="M3 15.5 9 7.5h12l-6 8z"/>',
    params: [P('width', 'Ancho', 2, 0.01, 1000), P('height', 'Largo', 2, 0.01, 1000), SEG('segments', 'Segmentos', 1, 1, 64)],
    geometry: p => new THREE.PlaneGeometry(p.width, p.height, p.segments, p.segments),
  },
  ring: {
    label: 'Anillo',
    icon: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4"/>',
    params: [P('innerRadius', 'Radio int.', 0.3, 0, 100), P('outerRadius', 'Radio ext.', 0.6, 0.01, 100), SEG('thetaSegments', 'Segmentos', 32)],
    geometry: p => new THREE.RingGeometry(p.innerRadius, p.outerRadius, p.thetaSegments),
  },
  tetrahedron: {
    label: 'Tetraedro',
    icon: '<path d="M12 3 3.5 18.5h17z"/><path d="M12 3 14 18.5"/>',
    params: [P('radius', 'Radio', 0.6, 0.01, 100), SEG('detail', 'Detalle', 0, 0, 5)],
    geometry: p => new THREE.TetrahedronGeometry(p.radius, p.detail),
  },
  octahedron: {
    label: 'Octaedro',
    icon: '<path d="M12 2.5 20 12l-8 9.5L4 12z"/><path d="M4 12h16M12 2.5 9.5 12 12 21.5"/>',
    params: [P('radius', 'Radio', 0.6, 0.01, 100), SEG('detail', 'Detalle', 0, 0, 5)],
    geometry: p => new THREE.OctahedronGeometry(p.radius, p.detail),
  },
  dodecahedron: {
    label: 'Dodecaedro',
    icon: '<path d="M12 2.5l8.8 6.4-3.4 10.3H6.6L3.2 8.9z"/><path d="M12 7l4.3 3.1-1.6 5H9.3l-1.6-5z"/>',
    params: [P('radius', 'Radio', 0.6, 0.01, 100), SEG('detail', 'Detalle', 0, 0, 5)],
    geometry: p => new THREE.DodecahedronGeometry(p.radius, p.detail),
  },
  icosahedron: {
    label: 'Icosaedro',
    icon: '<path d="M12 2.5 20.5 7.5v9L12 21.5 3.5 16.5v-9z"/><path d="M12 2.5 7.5 15h9zM3.5 7.5 7.5 15 3.5 16.5M20.5 7.5 16.5 15l4 1.5M7.5 15 12 21.5 16.5 15"/>',
    params: [P('radius', 'Radio', 0.6, 0.01, 100), SEG('detail', 'Detalle', 0, 0, 5)],
    geometry: p => new THREE.IcosahedronGeometry(p.radius, p.detail),
  },
  torusKnot: {
    label: 'Nudo',
    icon: '<path d="M8 6c4-4 10 0 7 5s-9 4-7-1 9-5 9 2-7 8-10 4-1-8 1-10z"/>',
    params: [P('radius', 'Radio', 0.45, 0.01, 100), P('tube', 'Grosor', 0.14, 0.001, 50),
             SEG('tubularSegments', 'Seg. tubo', 96, 3, 512), SEG('radialSegments', 'Seg. radiales', 12),
             SEG('p', 'p', 2, 1, 20), SEG('q', 'q', 3, 1, 20)],
    geometry: p => new THREE.TorusKnotGeometry(p.radius, p.tube, p.tubularSegments, p.radialSegments, p.p, p.q),
  },

  // ---- Objetos basados en un perfil 2D (editable con el editor de perfiles)
  extrude: {
    label: 'Extrusión',
    usesShape: 'closed',
    icon: '<path d="M4 15.5 8 19h12l-4-3.5z"/><path d="M4 15.5V7l4 3.5V19M4 7h12l4 3.5H8M20 10.5V19M16 7v8.5"/>',
    params: [P('depth', 'Altura', 0.5, 0.001, 100, 0.05), P('bevel', 'Bisel', 0, 0, 2, 0.01),
             SEG('bevelSegments', 'Seg. bisel', 3, 1, 12), SEG('curveSegments', 'Seg. curva', 12, 1, 64)],
    geometry: (p, shape) => {
      const pts = shapePoints(shape, true).map(([x, y]) => new THREE.Vector2(x, y));
      if (pts.length < 3) return new THREE.BoxGeometry(0.01, 0.01, 0.01);
      const s = new THREE.Shape(pts);
      const g = new THREE.ExtrudeGeometry(s, {
        depth: p.depth, curveSegments: p.curveSegments,
        bevelEnabled: p.bevel > 0, bevelThickness: p.bevel, bevelSize: p.bevel * 0.7, bevelSegments: p.bevelSegments,
      });
      // perfil dibujado en planta (XZ) y extruido hacia arriba (+Y)
      g.rotateX(-Math.PI / 2);
      g.center();
      return g;
    },
  },
  lathe: {
    label: 'Revolución',
    usesShape: 'open',
    icon: '<path d="M12 2.5v19" stroke-dasharray="2 2"/><path d="M8 3.5c-2 3 2 5 0 8s-3 6-1 9h10c2-3 1-6-1-9s2-5 0-8"/>',
    params: [SEG('segments', 'Segmentos', 40, 3, 256), P('angle', 'Ángulo °', 360, 1, 360, 5)],
    geometry: (p, shape) => {
      const pts = shapePoints(shape, false).map(([x, y]) => new THREE.Vector2(Math.max(0, x), y));
      if (pts.length < 2) return new THREE.BoxGeometry(0.01, 0.01, 0.01);
      const g = new THREE.LatheGeometry(pts, p.segments, 0, p.angle * Math.PI / 180);
      g.center();
      return g;
    },
  },
};

/** Puntos de un perfil, interpolados con una curva suave si `shape.smooth`. */
export function shapePoints(shape, closed) {
  const pts = (shape?.points || []).filter(p => Array.isArray(p) && p.length >= 2).map(p => [+p[0] || 0, +p[1] || 0]);
  if (!shape?.smooth || pts.length < 3) return pts;
  const curve = new THREE.CatmullRomCurve3(pts.map(([x, y]) => new THREE.Vector3(x, y, 0)), closed, 'centripetal');
  return curve.getPoints(pts.length * 10).slice(0, closed ? -1 : undefined).map(v => [v.x, v.y]);
}

// Perfiles iniciales al crear una extrusión o una revolución
export const DEFAULT_SHAPES = {
  extrude: { smooth: false, points: [[-0.5, -0.5], [0.5, -0.5], [0.5, -0.2], [-0.2, -0.2], [-0.2, 0.5], [-0.5, 0.5]] },
  lathe: { smooth: true, points: [[0, 0], [0.4, 0], [0.45, 0.15], [0.3, 0.55], [0.22, 0.85], [0.35, 1.15], [0.3, 1.2], [0, 1.2]] },
};

// Orden y separadores en la barra de herramientas
export const TOOLBAR_ORDER = ['box', 'sphere', 'cylinder', 'cone', 'pyramid', 'torus', 'capsule', '|',
  'plane', 'ring', '|', 'tetrahedron', 'octahedron', 'dodecahedron', 'icosahedron', 'torusKnot', '|', 'extrude', 'lathe'];

export function defaultParams(type) {
  const out = {};
  for (const p of PRIMITIVES[type].params) out[p.key] = p.def;
  return out;
}

export function buildGeometry(type, params, shape) {
  const def = PRIMITIVES[type];
  if (!def) throw new Error(`Primitiva desconocida: ${type}`);
  const p = { ...defaultParams(type), ...params };
  for (const d of def.params) {
    let v = Number(p[d.key]);
    if (!Number.isFinite(v)) v = d.def;
    v = Math.min(d.max, Math.max(d.min, v));
    if (d.int) v = Math.round(v);
    p[d.key] = v;
  }
  return def.geometry(p, shape || DEFAULT_SHAPES[type]);
}

// Operaciones booleanas
export const BOOLEAN_OPS = {
  union: { label: 'Unión', symbol: '∪' },
  subtract: { label: 'Diferencia', symbol: '−' },
  intersect: { label: 'Intersección', symbol: '∩' },
  split: { label: 'Pieza', symbol: '/' },
};

export function typeLabel(data) {
  if (data.type === 'boolean') {
    if (data.operands?.some(o => o.helper)) return BOOLEAN_OPS.split.label;
    return BOOLEAN_OPS[data.params?.op]?.label || 'Booleana';
  }
  return PRIMITIVES[data.type]?.label || data.type;
}

// Paleta rápida de colores para materiales
export const PALETTE = ['#d9d4c7', '#8a8f98', '#3b3f45', '#e5614f', '#f2a541', '#f2d541',
  '#6fbf73', '#3fa7a0', '#5b9bea', '#7b6fd6', '#c56bd1', '#8b5a3c'];
