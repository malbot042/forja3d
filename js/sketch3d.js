// Vista «Lápiz» en 3D: los objetos se ven como dibujados a mano.
// Cada objeto conserva su malla (no se dibuja, pero sigue sirviendo para seleccionar y exportar);
// encima se dibuja, en una capa aparte que sigue su posición:
//   · relleno con el color asignado al objeto y sombreado a rayas del mismo color, más oscuro (trama cruzada según la luz),
//   · contorno tembloroso (casco invertido desplazado en pantalla, grosor variable),
//   · aristas vivas con dos pasadas temblorosas que se pasan un poco en los extremos.
// La geometría no cambia: selección, gizmo, snap, booleanas y exportaciones siguen igual.
import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';

// ruido determinista (semilla por objeto) para que el trazo no «tiemble» al redibujar
function hash(seed, i) {
  let x = Math.imul(seed ^ Math.imul(i + 1, 0x9E3779B1), 0x85EBCA6B);
  x ^= x >>> 13; x = Math.imul(x, 0xC2B2AE35); x ^= x >>> 16;
  return (x >>> 0) / 4294967296 * 2 - 1;
}
function noise(seed, t) {
  const i = Math.floor(t), f = t - i, u = f * f * (3 - 2 * f);
  return hash(seed, i) * (1 - u) + hash(seed, i + 1) * u;
}
const seedOf = str => { let h = 2166136261; for (const c of String(str)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; };

const MAX_EDGE_TRIS = 400000;   // por encima, solo contorno y sombreado (las aristas serían demasiadas)

export class SketchLayer {
  constructor(editor) {
    this.editor = editor;
    this.group = new THREE.Group();
    this.group.name = 'sketch-layer';
    editor.scene.add(this.group);
    this.items = new Map();          // id → { root, geom, version, at }
    // uniformes compartidos por todos los materiales del modo lápiz
    this.u = {
      paper: { value: new THREE.Color(0x0f1114) },
      ink: { value: new THREE.Color(0xd8d8d8) },
      res: { value: new THREE.Vector2(800, 600) },
      dpr: { value: 1 },
      outline: { value: 1.7 },
    };
    this.lineMats = [0.9, 0.42].map(op => new THREE.LineBasicMaterial({ color: 0xd8d8d8, transparent: true, opacity: op, depthWrite: false }));
    this.hullMat = new THREE.ShaderMaterial({
      uniforms: this.u,
      side: THREE.BackSide,
      vertexShader: /* glsl */`
        uniform vec2 res; uniform float outline;
        void main() {
          vec4 clip = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          vec3 nv = normalize(normalMatrix * normal);
          vec2 dir = length(nv.xy) > 1e-5 ? normalize(nv.xy) : vec2(0.0);
          // grosor que varía a lo largo del contorno, como la presión del lápiz
          float w = 0.55 + 0.45 * sin(dot(position, vec3(3.1, 4.7, 2.3)) * 5.0) * sin(dot(position, vec3(1.7, -2.9, 3.7)) * 3.0 + 1.3);
          clip.xy += dir * outline * (0.6 + w) * 2.0 / res * clip.w;
          gl_Position = clip;
        }`,
      fragmentShader: /* glsl */`
        uniform vec3 ink;
        void main() {
          gl_FragColor = vec4(ink, 1.0);
          #include <colorspace_fragment>
        }`,
    });
  }

  /** Material de relleno con trama (uno por objeto, por su color). */
  _fillMat(color) {
    return new THREE.ShaderMaterial({
      uniforms: { ...this.u, tint: { value: new THREE.Color(color) }, alpha: { value: 1 } },
      polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1,
      vertexShader: /* glsl */`
        varying vec3 vN;
        void main() { vN = normalize(normalMatrix * normal); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */`
        uniform vec3 paper, ink, tint; uniform float dpr, alpha;
        varying vec3 vN;
        float hatch(vec2 p, float spacing, float width) {
          float d = abs(fract(p.x / spacing) - 0.5) * spacing;
          return 1.0 - smoothstep(width * 0.5, width * 0.5 + 0.9, d);
        }
        void main() {
          vec3 n = normalize(vN);
          if (!gl_FrontFacing) n = -n;
          float light = clamp(dot(n, normalize(vec3(-0.45, 0.75, 0.55))) * 0.5 + 0.5, 0.0, 1.0);
          float shade = 1.0 - light;                    // 0 = iluminado, 1 = en sombra
          vec2 q = gl_FragCoord.xy / dpr;
          q += vec2(sin(q.y * 0.045), cos(q.x * 0.04)) * 1.4;   // las rayas no son perfectas
          float s = 0.0;
          if (shade > 0.30) s = max(s, hatch(vec2(q.x + q.y, 0.0), 6.5, 0.8) * smoothstep(0.30, 0.42, shade));
          if (shade > 0.52) s = max(s, hatch(vec2(q.x - q.y, 0.0), 6.5, 0.8) * smoothstep(0.52, 0.64, shade));
          if (shade > 0.72) s = max(s, hatch(vec2(q.x * 0.3 + q.y, 0.0), 4.2, 0.7) * smoothstep(0.72, 0.84, shade));
          // el color asignado al objeto, con un poco de volumen; las rayas, del mismo color más oscuro (como lápices de colores)
          vec3 base = tint * (0.8 + 0.2 * light);
          vec3 stroke = tint * 0.3;
          gl_FragColor = vec4(mix(base, stroke, s * 0.8), alpha);
          #include <colorspace_fragment>
        }`,
    });
  }

  setTheme(light, bg) {
    this.u.paper.value.copy(bg);
    this.u.ink.value.set(light ? 0x2a2b2e : 0xd8d8d8);
    for (const m of this.lineMats) m.color.copy(this.u.ink.value);
  }

  /** Tamaño en píxeles del panel que se va a dibujar (para el grosor del contorno). */
  setViewport(w, h, dpr) { this.u.res.value.set(w, h); this.u.dpr.value = dpr; }

  _build(mesh) {
    const g = mesh.geometry;
    const root = new THREE.Group();
    root.matrixAutoUpdate = false;
    const seed = seedOf(mesh.userData.id);
    // relleno
    const fill = new THREE.Mesh(g, this._fillMat(mesh.userData.material?.color || '#d9d4c7'));
    fill.raycast = () => {};
    root.add(fill);
    if (!g.boundingSphere) g.computeBoundingSphere();
    const R = Math.max(g.boundingSphere?.radius || 1, 1e-3);
    const tris = g.index ? g.index.count / 3 : g.attributes.position.count / 3;
    // contorno: casco con normales suaves (vértices soldados), dibujado por detrás
    try {
      let hg = new THREE.BufferGeometry();
      hg.setAttribute('position', g.attributes.position);
      if (g.index) hg.setIndex(g.index);
      hg = mergeVertices(hg, R * 1e-4);
      hg.computeVertexNormals();
      const hull = new THREE.Mesh(hg, this.hullMat);
      hull.raycast = () => {};
      root.add(hull);
    } catch { /* sin contorno */ }
    // aristas vivas temblorosas
    if (tris <= MAX_EDGE_TRIS) {
      const eg = new THREE.EdgesGeometry(g, 28);
      const p = eg.attributes.position.array;
      const nSeg = p.length / 6;
      const amp = R * 0.006, over = R * 0.03, step = R * 0.06;
      for (let pass = 0; pass < 2; pass++) {
        const out = [];
        const a = new THREE.Vector3(), b = new THREE.Vector3(), d = new THREE.Vector3(), n1 = new THREE.Vector3(), n2 = new THREE.Vector3(), tmp = new THREE.Vector3();
        for (let s = 0; s < nSeg; s++) {
          a.fromArray(p, s * 6); b.fromArray(p, s * 6 + 3);
          d.subVectors(b, a);
          const L = d.length();
          if (L < 1e-9) continue;
          d.divideScalar(L);
          // dos direcciones perpendiculares a la arista
          tmp.set(Math.abs(d.x) < 0.9 ? 1 : 0, Math.abs(d.x) < 0.9 ? 0 : 1, 0);
          n1.crossVectors(d, tmp).normalize(); n2.crossVectors(d, n1).normalize();
          const sd = (seed + s * 7919 + pass * 104729) >>> 0;
          // se pasa un poco de largo solo en aristas largas (en curvas finas se notaría demasiado)
          const ov = L > step * 1.5 ? over : 0;
          const e0 = ov * (0.3 + 0.7 * Math.abs(hash(sd, 1))), e1 = ov * (0.3 + 0.7 * Math.abs(hash(sd, 2)));
          const k = Math.max(1, Math.ceil(L / step));
          let prev = null;
          for (let j = 0; j <= k; j++) {
            const t = j / k, along = -e0 + (L + e0 + e1) * t;
            const off1 = amp * (0.7 * noise(sd, along / (step * 2.5)) + (pass ? 0.6 * hash(sd, 3) : 0));
            const off2 = amp * 0.7 * noise(sd + 1, along / (step * 2.5));
            const q = new THREE.Vector3().copy(a).addScaledVector(d, along).addScaledVector(n1, off1).addScaledVector(n2, off2);
            if (prev) out.push(prev.x, prev.y, prev.z, q.x, q.y, q.z);
            prev = q;
          }
        }
        eg.dispose();
        if (out.length) {
          const lg = new THREE.BufferGeometry();
          lg.setAttribute('position', new THREE.Float32BufferAttribute(out, 3));
          const lines = new THREE.LineSegments(lg, this.lineMats[pass]);
          lines.raycast = () => {};
          lines.renderOrder = 3;
          root.add(lines);
        }
      }
    }
    return root;
  }

  _dispose(item) {
    this.group.remove(item.root);
    item.root.traverse(o => {
      if (o.geometry && o.geometry !== item.geom) o.geometry.dispose();
      if (o.material && !this.lineMats.includes(o.material) && o.material !== this.hullMat) o.material.dispose();
    });
  }

  /** Pone al día la capa con los objetos del editor (se llama antes de dibujar cada fotograma). */
  sync() {
    const ed = this.editor, now = performance.now();
    const seen = new Set();
    for (const [id, mesh] of ed.objects) {
      seen.add(id);
      const g = mesh.geometry;
      const version = g.attributes.position?.version ?? 0;
      let it = this.items.get(id);
      const sculpting = ed.sculpt && ed.sculpt.mesh === mesh;
      // mientras se esculpe, el objeto se ve sólido (rehacer el dibujo en cada trazo sería lento)
      // la malla original no se dibuja (el relleno ocupa su sitio y tapa lo de detrás);
      // sigue ahí para seleccionar, el gizmo y las exportaciones. Mientras se esculpe, se ve sólida.
      mesh.material.visible = sculpting;
      if (sculpting) { if (it) it.root.visible = false; continue; }
      const stale = it && (it.geom !== g || (it.version !== version && now - it.at > 400));
      if (!it || stale) {
        if (it) this._dispose(it);
        it = { root: this._build(mesh), geom: g, version, at: now };
        this.group.add(it.root);
        this.items.set(id, it);
      }
      const fill = it.root.children[0];
      const M = mesh.userData.material || {};
      fill.material.uniforms.tint.value.set(M.color || '#d9d4c7');
      // la opacidad asignada también se respeta
      const alpha = M.opacity ?? 1;
      fill.material.uniforms.alpha.value = alpha;
      if (fill.material.transparent !== alpha < 1) { fill.material.transparent = alpha < 1; fill.material.depthWrite = alpha >= 1; fill.material.needsUpdate = true; }
      mesh.updateMatrixWorld();
      it.root.matrix.copy(mesh.matrixWorld);
      it.root.matrixWorldNeedsUpdate = true;
      it.root.visible = mesh.visible;
    }
    for (const [id, it] of this.items) if (!seen.has(id)) { this._dispose(it); this.items.delete(id); }
  }

  /** Sale del modo lápiz: borra la capa y vuelve a pintar las mallas. */
  clear() {
    for (const it of this.items.values()) this._dispose(it);
    this.items.clear();
    for (const m of this.editor.objects.values()) m.material.visible = true;
  }
}
