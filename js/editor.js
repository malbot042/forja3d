// Núcleo del editor: escena Three.js, selección (simple y múltiple), gizmos, cámaras
// perspectiva/ortográfica, modos de vista, operaciones booleanas, serialización e historial.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { PRIMITIVES, DEFAULT_SHAPES, BOOLEAN_OPS, defaultParams, typeLabel } from './primitives.js';
import { geometryFor, evaluateBoolean, cachePut, csgKey, matrixOf } from './csg.js';
import { uid } from './storage.js';

const DEG = THREE.MathUtils.DEG2RAD;
const RAD = THREE.MathUtils.RAD2DEG;
const round = (v, d = 4) => Math.round(v * 10 ** d) / 10 ** d;
const FLAT_TYPES = new Set(['plane', 'ring', 'circle2d', 'line2d']);
const DOUBLE_SIDED = new Set(['plane', 'ring', 'lathe', 'circle2d', 'line2d']);
const HALF_SPACE = 1000;

export const DEFAULT_MATERIAL = { color: '#d9d4c7', metalness: 0.05, roughness: 0.6, opacity: 1, flatShading: false };

// Vistas predefinidas: dirección desde el objetivo hacia la cámara
export const VIEWS = {
  front:  { label: 'Alzado (frontal)', dir: [0, 0, 1] },
  back:   { label: 'Posterior', dir: [0, 0, -1] },
  right:  { label: 'Perfil derecho', dir: [1, 0, 0] },
  left:   { label: 'Perfil izquierdo', dir: [-1, 0, 0] },
  top:    { label: 'Planta (superior)', dir: [0, 1, 0.0001] },
  bottom: { label: 'Inferior', dir: [0, -1, 0.0001] },
  persp:  { label: 'Perspectiva', dir: [1, 0.8, 1.2] },
};

function decompose(m) {
  const p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
  m.decompose(p, q, s);
  const e = new THREE.Euler().setFromQuaternion(q);
  return {
    position: p.toArray().map(v => round(v)),
    rotation: [e.x, e.y, e.z].map(v => round(v * RAD, 3)),
    scale: s.toArray().map(v => round(v)),
  };
}

export class Editor extends EventTarget {
  constructor(container) {
    super();
    this.container = container;
    this.objects = new Map();       // id -> Mesh
    this.selection = [];            // ids; el último es el principal (lleva el gizmo)
    this.viewMode = 'solid';
    this.projection = 'persp';
    this.currentView = 'persp';
    this.history = [];
    this.historyIndex = -1;

    // --- renderer / escena
    const renderer = this.renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    container.appendChild(renderer.domElement);
    renderer.domElement.tabIndex = 0;

    const scene = this.scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0f1114);

    // --- cámaras
    this.perspCam = new THREE.PerspectiveCamera(50, 1, 0.01, 4000);
    this.perspCam.position.set(5, 4, 6);
    this.orthoCam = new THREE.OrthographicCamera(-1, 1, 1, -1, -2000, 4000);
    this.camera = this.perspCam;

    // luces (con la cámara para que las vistas ortográficas también queden iluminadas)
    scene.add(new THREE.HemisphereLight(0xdfe8ff, 0x2a2420, 1.2));
    const key = new THREE.DirectionalLight(0xffffff, 2.2);
    key.position.set(6, 10, 7);
    scene.add(key);
    const rim = new THREE.DirectionalLight(0x9fb8ff, 0.7);
    rim.position.set(-8, 4, -6);
    scene.add(rim);
    this.headLight = new THREE.DirectionalLight(0xffffff, 0.6);
    scene.add(this.headLight, this.headLight.target);

    // ayudas: rejilla + ejes
    this.helpers = new THREE.Group();
    const grid = new THREE.GridHelper(40, 40, 0x3a4049, 0x23272d);
    grid.material.transparent = true;
    grid.material.opacity = 0.9;
    const fine = new THREE.GridHelper(40, 160, 0x1c1f24, 0x1c1f24);
    fine.position.y = -0.0005;
    const axes = new THREE.AxesHelper(1.2);
    axes.material.depthTest = false;
    axes.renderOrder = 2;
    this.helpers.add(fine, grid, axes);
    scene.add(this.helpers);

    // raíz de objetos del usuario
    this.root = new THREE.Group();
    this.root.name = 'root';
    scene.add(this.root);

    // cajas de selección
    this.selectionBoxes = new Map();

    // controles de órbita
    this.orbit = new OrbitControls(this.camera, renderer.domElement);
    this.orbit.enableDamping = true;
    this.orbit.dampingFactor = 0.12;
    this.orbit.screenSpacePanning = true;

    // gizmo de transformación (mueve también el resto de la selección)
    this.gizmo = new TransformControls(this.camera, renderer.domElement);
    this.gizmo.setSize(0.9);
    let start = null;
    this.gizmo.addEventListener('mouseDown', () => {
      const primary = this.objects.get(this.selectedId);
      if (!primary) return;
      primary.updateMatrix();
      start = {
        inv: primary.matrix.clone().invert(),
        others: this.selection.filter(id => id !== this.selectedId)
          .map(id => this.objects.get(id)).filter(Boolean)
          .map(m => { m.updateMatrix(); return [m, m.matrix.clone()]; }),
      };
    });
    this.gizmo.addEventListener('dragging-changed', e => {
      this.orbit.enabled = !e.value;
      if (!e.value) { start = null; this._commit(); }
    });
    this.gizmo.addEventListener('objectChange', () => {
      const primary = this.objects.get(this.selectedId);
      if (start && primary && start.others.length) {
        primary.updateMatrix();
        const delta = primary.matrix.clone().multiply(start.inv);
        for (const [m, m0] of start.others) {
          new THREE.Matrix4().multiplyMatrices(delta, m0).decompose(m.position, m.quaternion, m.scale);
        }
      }
      this._updateSelectionBoxes();
      this.dispatchEvent(new CustomEvent('transform', { detail: this.selectedId }));
    });
    this.gizmoHelper = this.gizmo.getHelper ? this.gizmo.getHelper() : this.gizmo;
    scene.add(this.gizmoHelper);

    this._initPicking();
    this._initNavigator();
    this._resize = this._resize.bind(this);
    new ResizeObserver(this._resize).observe(container);
    this._resize();

    const loop = () => {
      this.orbit.update();
      this.headLight.position.copy(this.camera.position);
      this.headLight.target.position.copy(this.orbit.target);
      renderer.render(scene, this.camera);
      this._drawNavigator();
      this._raf = requestAnimationFrame(loop);
    };
    loop();
  }

  get selectedId() { return this.selection[this.selection.length - 1] ?? null; }

  notice(msg, error = false) {
    this.dispatchEvent(new CustomEvent('notice', { detail: { msg, error } }));
  }

  // ---------------------------------------------------------------- picking
  _initPicking() {
    const ray = new THREE.Raycaster();
    const ndc = new THREE.Vector2();
    let down = null;
    const el = this.renderer.domElement;
    el.addEventListener('pointerdown', e => { down = { x: e.clientX, y: e.clientY }; });
    el.addEventListener('pointerup', e => {
      if (!down || e.button !== 0) return;
      const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
      down = null;
      if (moved > 4 || this.gizmo.dragging || this.gizmo.axis) return;
      const r = el.getBoundingClientRect();
      ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      ray.setFromCamera(ndc, this.camera);
      const meshes = [...this.objects.values()].filter(m => m.visible);
      const hit = ray.intersectObjects(meshes, false)[0];
      const id = hit ? hit.object.userData.id : null;
      if (e.shiftKey || e.ctrlKey || e.metaKey) { if (id) this.toggleSelect(id); }
      else this.select(id);
    });
  }

  _resize() {
    const w = this.container.clientWidth, h = this.container.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.perspCam.aspect = w / h;
    this.perspCam.updateProjectionMatrix();
    this._updateOrthoFrustum();
  }

  _updateOrthoFrustum(halfH = this.orthoCam.top) {
    const aspect = this.perspCam.aspect || 1;
    Object.assign(this.orthoCam, { top: halfH, bottom: -halfH, left: -halfH * aspect, right: halfH * aspect });
    this.orthoCam.updateProjectionMatrix();
  }

  // ---------------------------------------------------- navegador de ejes
  _initNavigator() {
    const c = this.navCanvas = document.createElement('canvas');
    c.className = 'nav-gizmo';
    c.title = 'Clic en un eje para ver desde él';
    this.container.appendChild(c);
    this._navHits = [];
    c.addEventListener('pointermove', e => {
      const r = c.getBoundingClientRect();
      const x = e.clientX - r.left, y = e.clientY - r.top;
      const h = this._navHits.find(p => Math.hypot(p.x - x, p.y - y) < p.r + 2);
      this._navHover = h?.view || null;
      c.style.cursor = h ? 'pointer' : 'default';
    });
    c.addEventListener('pointerleave', () => { this._navHover = null; });
    c.addEventListener('click', e => {
      const r = c.getBoundingClientRect();
      const x = e.clientX - r.left, y = e.clientY - r.top;
      const h = this._navHits.find(p => Math.hypot(p.x - x, p.y - y) < p.r + 2);
      if (h) this.setView(h.view);
    });
  }

  _drawNavigator() {
    const c = this.navCanvas, S = 96, dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (c.width !== S * dpr) { c.width = c.height = S * dpr; c.style.width = c.style.height = `${S}px`; }
    const ctx = c.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, S, S);
    ctx.fillStyle = 'rgba(24,27,31,.6)';
    ctx.beginPath(); ctx.arc(S / 2, S / 2, S / 2 - 1, 0, Math.PI * 2); ctx.fill();
    const q = this.camera.quaternion.clone().invert();
    const axes = [
      { v: [1, 0, 0], color: '#e5614f', label: 'X', view: 'right' },
      { v: [0, 1, 0], color: '#6fbf73', label: 'Y', view: 'top' },
      { v: [0, 0, 1], color: '#5b9bea', label: 'Z', view: 'front' },
      { v: [-1, 0, 0], color: '#e5614f', view: 'left' },
      { v: [0, -1, 0], color: '#6fbf73', view: 'bottom' },
      { v: [0, 0, -1], color: '#5b9bea', view: 'back' },
    ].map(a => {
      const p = new THREE.Vector3(...a.v).applyQuaternion(q);
      return { ...a, x: S / 2 + p.x * 32, y: S / 2 - p.y * 32, z: p.z };
    }).sort((a, b) => a.z - b.z);
    this._navHits = [];
    for (const a of axes) {
      const pos = !!a.label, hover = this._navHover === a.view;
      if (pos) {
        ctx.strokeStyle = a.color; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(S / 2, S / 2); ctx.lineTo(a.x, a.y); ctx.stroke();
      }
      const r = pos ? 9 : 7;
      ctx.fillStyle = pos ? a.color : 'rgba(24,27,31,.9)';
      ctx.strokeStyle = a.color; ctx.lineWidth = 1.5;
      ctx.globalAlpha = a.z < -0.2 ? 0.75 : 1;
      ctx.beginPath(); ctx.arc(a.x, a.y, hover ? r + 2 : r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.globalAlpha = 1;
      if (pos) {
        ctx.fillStyle = '#121417'; ctx.font = 'bold 10px system-ui, sans-serif';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(a.label, a.x, a.y + 0.5);
      }
      this._navHits.push({ x: a.x, y: a.y, r, view: a.view, z: a.z });
    }
    this._navHits.sort((a, b) => b.z - a.z);
  }

  // -------------------------------------------------------------- creación
  _makeMesh(data) {
    const mat = new THREE.MeshStandardMaterial({ side: DOUBLE_SIDED.has(data.type) ? THREE.DoubleSide : THREE.FrontSide });
    let geom;
    try {
      geom = geometryFor(data);
    } catch (err) {
      console.error(err);
      this.notice(`No se pudo generar «${data.name}»: ${err.message}`, true);
      geom = new THREE.BoxGeometry(0.2, 0.2, 0.2);
    }
    const mesh = new THREE.Mesh(geom, mat);
    const edges = new THREE.LineSegments(
      new THREE.EdgesGeometry(mesh.geometry, 25),
      new THREE.LineBasicMaterial({ color: 0x111316, transparent: true, opacity: 0.85 })
    );
    edges.name = '__edges';
    edges.raycast = () => {};
    mesh.add(edges);
    mesh.userData = {
      id: data.id, type: data.type, name: data.name,
      params: { ...data.params },
      material: { ...DEFAULT_MATERIAL, ...data.material },
    };
    if (data.shape) mesh.userData.shape = structuredClone(data.shape);
    if (data.operands) mesh.userData.operands = structuredClone(data.operands);
    this._applyTransform(mesh, data);
    this._applyMaterial(mesh);
    mesh.visible = data.visible !== false;
    return mesh;
  }

  _applyTransform(mesh, d) {
    if (d.position) mesh.position.fromArray(d.position);
    if (d.rotation) mesh.rotation.set(d.rotation[0] * DEG, d.rotation[1] * DEG, d.rotation[2] * DEG);
    if (d.scale) mesh.scale.fromArray(d.scale);
  }

  _applyMaterial(mesh) {
    const m = mesh.userData.material;
    const mat = mesh.material;
    mat.color.set(m.color);
    mat.metalness = m.metalness;
    mat.roughness = m.roughness;
    mat.opacity = m.opacity;
    mat.transparent = m.opacity < 1;
    mat.depthWrite = m.opacity >= 1;
    if (mat.flatShading !== !!m.flatShading) {
      mat.flatShading = !!m.flatShading;
      mat.needsUpdate = true;
    }
    this._applyViewToMesh(mesh);
  }

  _applyViewToMesh(mesh) {
    const edges = mesh.getObjectByName('__edges');
    const wire = this.viewMode === 'wire';
    if (mesh.material.wireframe !== wire) {
      mesh.material.wireframe = wire;
      mesh.material.needsUpdate = true;
    }
    edges.visible = this.viewMode === 'both';
  }

  _names() { return new Set([...this.objects.values()].map(m => m.userData.name)); }

  _nextName(label) {
    const names = this._names();
    let n = 1;
    while (names.has(`${label} ${n}`)) n++;
    return `${label} ${n}`;
  }

  _uniqueName(base) {
    const names = this._names();
    if (!names.has(base)) return base;
    let n = 2;
    while (names.has(`${base} ${n}`)) n++;
    return `${base} ${n}`;
  }

  _insert(data) {
    const mesh = this._makeMesh(data);
    this.root.add(mesh);
    this.objects.set(data.id, mesh);
    return mesh;
  }

  addPrimitive(type) {
    const data = {
      id: uid(), type, name: this._nextName(PRIMITIVES[type].label), params: defaultParams(type),
      position: [0, 0, 0], rotation: FLAT_TYPES.has(type) ? [-90, 0, 0] : [0, 0, 0], scale: [1, 1, 1],
      material: { ...DEFAULT_MATERIAL },
    };
    if (DEFAULT_SHAPES[type]) data.shape = structuredClone(DEFAULT_SHAPES[type]);
    const mesh = this._insert(data);
    // Apoyar el objeto sobre la rejilla (y=0), en el punto al que mira la cámara
    const target = this.orbit.target;
    mesh.position.x = this._snapVal(target.x);
    mesh.position.z = this._snapVal(target.z);
    if (FLAT_TYPES.has(type)) mesh.position.y = 0.001;
    else this._dropMesh(mesh);
    this.select(data.id);
    this._commit();
    return data.id;
  }

  _dropMesh(mesh) {
    mesh.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(mesh, true);
    if (!box.isEmpty()) mesh.position.y = round(mesh.position.y - box.min.y);
  }

  /** Apoya los objetos seleccionados sobre el suelo (y = 0). */
  dropToFloor(ids = this.selection) {
    for (const id of ids) { const m = this.objects.get(id); if (m) this._dropMesh(m); }
    this._updateSelectionBoxes();
    this._commit();
  }

  _snapVal(v) {
    return this.snap ? Math.round(v / 0.25) * 0.25 : round(v, 3);
  }

  duplicate(ids = this.selection) {
    const newIds = [];
    for (const id of ids) {
      const src = this.objects.get(id);
      if (!src) continue;
      const data = this._serializeMesh(src);
      data.id = uid();
      data.name = this._uniqueName(`${src.userData.name} copia`);
      data.position[0] = round(data.position[0] + 0.5);
      data.position[2] = round(data.position[2] + 0.5);
      this._insert(data);
      newIds.push(data.id);
    }
    if (!newIds.length) return;
    this.setSelection(newIds);
    this._commit();
  }

  /** Refleja la selección en un eje (escala negativa). */
  mirror(axis, ids = this.selection) {
    const i = { x: 0, y: 1, z: 2 }[axis];
    for (const id of ids) {
      const m = this.objects.get(id);
      if (m) m.scale.setComponent(i, -m.scale.getComponent(i));
    }
    this._updateSelectionBoxes();
    this._commit();
    this.dispatchEvent(new CustomEvent('select', { detail: this.selectedId }));
  }

  remove(ids = [...this.selection]) {
    if (!ids.length) return;
    this.setSelection(this.selection.filter(id => !ids.includes(id)));
    for (const id of ids) {
      const mesh = this.objects.get(id);
      if (!mesh) continue;
      this._disposeMesh(mesh);
      this.objects.delete(id);
    }
    this._commit();
  }

  _disposeMesh(mesh) {
    this.root.remove(mesh);
    mesh.geometry.dispose();
    mesh.material.dispose();
    const edges = mesh.getObjectByName('__edges');
    edges.geometry.dispose();
    edges.material.dispose();
  }

  clear() {
    this.setSelection([]);
    for (const m of this.objects.values()) this._disposeMesh(m);
    this.objects.clear();
  }

  // ---------------------------------------------------------- booleanas
  /** Crea un objeto booleano a partir de operandos en coordenadas de mundo. */
  _makeBoolean(op, operandsWorld, name, material) {
    const g = evaluateBoolean(op, operandsWorld);
    if (!g.attributes.position || g.attributes.position.count === 0) { g.dispose(); return null; }
    g.computeBoundingBox();
    const c = g.boundingBox.getCenter(new THREE.Vector3());
    c.set(round(c.x), round(c.y), round(c.z));
    g.translate(-c.x, -c.y, -c.z);
    g.computeBoundingBox();
    g.computeBoundingSphere();
    const operands = operandsWorld.map(o => ({
      ...o,
      position: [round(o.position[0] - c.x), round(o.position[1] - c.y), round(o.position[2] - c.z)],
    }));
    const data = {
      id: uid(), type: 'boolean', name, params: { op }, operands,
      position: c.toArray(), rotation: [0, 0, 0], scale: [1, 1, 1],
      material: { ...material }, visible: true,
    };
    cachePut(csgKey(data), g);
    g.dispose();
    this._insert(data);
    return data.id;
  }

  /** Unión / diferencia / intersección de la selección (el primero seleccionado es la base). */
  booleanOp(op) {
    const ids = this.selection.filter(id => this.objects.has(id));
    if (ids.length < 2) {
      this.notice('Selecciona al menos dos objetos (Mayús o Ctrl + clic). El primero es la base.', true);
      return;
    }
    const operands = ids.map(id => this._serializeMesh(this.objects.get(id)));
    const base = operands[0];
    let newId;
    try {
      newId = this._makeBoolean(op, operands, this._nextName(BOOLEAN_OPS[op].label), base.material);
    } catch (err) {
      console.error(err);
      this.notice(`La operación ha fallado: ${err.message}`, true);
      return;
    }
    if (!newId) {
      this.notice('El resultado está vacío (los objetos no se tocan). No se ha cambiado nada.', true);
      return;
    }
    this._removeSilently(ids);
    this.setSelection([newId]);
    this._commit();
    this.notice(`${BOOLEAN_OPS[op].label} creada con ${ids.length} objetos`);
  }

  /** Parte un objeto con un plano (otro objeto «Plano» seleccionado) o, si no hay, en horizontal por su centro. */
  split() {
    const meshes = this.selection.map(id => this.objects.get(id)).filter(Boolean);
    const cutter = meshes.find(m => m.userData.type === 'plane');
    const target = meshes.find(m => m !== cutter);
    if (!target || meshes.length > 2) {
      this.notice('Selecciona un objeto (y opcionalmente un Plano de corte) para partirlo.', true);
      return;
    }
    const pos = new THREE.Vector3(), quat = new THREE.Quaternion();
    if (cutter) {
      cutter.updateMatrixWorld(true);
      cutter.matrixWorld.decompose(pos, quat, new THREE.Vector3());
    } else {
      new THREE.Box3().setFromObject(target, true).getCenter(pos);
      quat.setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0));
    }
    // Semiespacio: cubo enorme cuya cara inferior coincide con el plano (normal +Z local del plano)
    const m = new THREE.Matrix4().compose(pos, quat, new THREE.Vector3(1, 1, 1))
      .multiply(new THREE.Matrix4().makeTranslation(0, 0, HALF_SPACE / 2));
    const half = {
      name: 'Semiespacio', type: 'box', helper: true,
      params: { width: HALF_SPACE, height: HALF_SPACE, depth: HALF_SPACE, segments: 1 },
      ...decompose(m), material: { ...DEFAULT_MATERIAL }, visible: true,
    };
    const src = this._serializeMesh(target);
    const created = [];
    try {
      for (const [op, suffix] of [['intersect', 'A'], ['subtract', 'B']]) {
        const id = this._makeBoolean(op, [src, half], this._uniqueName(`${src.name} ${suffix}`), src.material);
        if (id) created.push(id);
      }
    } catch (err) {
      console.error(err);
      for (const id of created) { this._disposeMesh(this.objects.get(id)); this.objects.delete(id); }
      this.notice(`No se pudo partir: ${err.message}`, true);
      return;
    }
    if (created.length < 2) {
      for (const id of created) { this._disposeMesh(this.objects.get(id)); this.objects.delete(id); }
      this.notice('El plano no atraviesa el objeto: no hay nada que partir.', true);
      return;
    }
    this._removeSilently([target.userData.id]);
    if (cutter) cutter.visible = false;
    this.setSelection(created);
    this._commit();
    this.notice(cutter ? 'Objeto partido con el plano (el plano se ha ocultado)' : 'Objeto partido en horizontal por su centro');
  }

  /** Deshace una operación booleana: devuelve sus piezas originales a la escena. */
  explode(ids = this.selection) {
    const booleans = ids.map(id => this.objects.get(id)).filter(m => m?.userData.type === 'boolean');
    if (!booleans.length) {
      this.notice('Selecciona un objeto creado con una operación booleana.', true);
      return;
    }
    const newIds = [];
    for (const mesh of booleans) {
      mesh.updateMatrix();
      for (const op of mesh.userData.operands || []) {
        if (op.helper) continue;
        const world = mesh.matrix.clone().multiply(matrixOf(op));
        const data = { ...structuredClone(op), ...decompose(world), id: uid() };
        data.name = this._uniqueName(op.name || typeLabel(op));
        this._insert(data);
        newIds.push(data.id);
      }
    }
    this._removeSilently(booleans.map(m => m.userData.id));
    this.setSelection(newIds);
    this._commit();
  }

  _removeSilently(ids) {
    for (const id of ids) {
      const mesh = this.objects.get(id);
      if (!mesh) continue;
      this._disposeMesh(mesh);
      this.objects.delete(id);
    }
    this.selection = this.selection.filter(id => this.objects.has(id));
  }

  // ------------------------------------------------------------ selección
  select(id) { this.setSelection(id ? [id] : []); }

  toggleSelect(id) {
    const sel = this.selection.includes(id) ? this.selection.filter(x => x !== id) : [...this.selection, id];
    this.setSelection(sel);
  }

  selectAll() { this.setSelection([...this.objects.keys()].filter(id => this.objects.get(id).visible)); }

  setSelection(ids) {
    this.selection = ids.filter(id => this.objects.has(id));
    const primary = this.objects.get(this.selectedId);
    if (primary && primary.visible) this.gizmo.attach(primary);
    else this.gizmo.detach();
    this._updateSelectionBoxes();
    this.dispatchEvent(new CustomEvent('select', { detail: this.selectedId }));
  }

  _updateSelectionBoxes() {
    for (const [id, box] of this.selectionBoxes) {
      if (!this.selection.includes(id) || !this.objects.get(id)?.visible) {
        this.scene.remove(box);
        box.geometry.dispose();
        box.material.dispose();
        this.selectionBoxes.delete(id);
      }
    }
    for (const id of this.selection) {
      const mesh = this.objects.get(id);
      if (!mesh?.visible) continue;
      let box = this.selectionBoxes.get(id);
      if (!box) {
        box = new THREE.BoxHelper(mesh, 0xf2a541);
        box.material.depthTest = false;
        box.material.transparent = true;
        box.renderOrder = 3;
        this.scene.add(box);
        this.selectionBoxes.set(id, box);
      }
      box.setFromObject(mesh);
      box.material.opacity = id === this.selectedId ? 1 : 0.45;
    }
  }

  getSelected() {
    const mesh = this.objects.get(this.selectedId);
    return mesh ? this._serializeMesh(mesh) : null;
  }

  /** Aplica cambios a un objeto. `commit=false` para cambios en vivo (arrastre). */
  update(id, patch, commit = true) {
    const mesh = this.objects.get(id);
    if (!mesh) return;
    const ud = mesh.userData;
    if (patch.name !== undefined) ud.name = patch.name;
    if (patch.params || patch.shape) {
      if (patch.params) ud.params = { ...ud.params, ...patch.params };
      if (patch.shape) ud.shape = structuredClone(patch.shape);
      try {
        const geom = geometryFor({ type: ud.type, params: ud.params, shape: ud.shape, operands: ud.operands });
        const old = mesh.geometry;
        mesh.geometry = geom;
        old.dispose();
        const edges = mesh.getObjectByName('__edges');
        edges.geometry.dispose();
        edges.geometry = new THREE.EdgesGeometry(mesh.geometry, 25);
      } catch (err) {
        console.error(err);
        this.notice(`No se pudo regenerar la geometría: ${err.message}`, true);
      }
    }
    this._applyTransform(mesh, patch);
    if (patch.material) {
      ud.material = { ...ud.material, ...patch.material };
      this._applyMaterial(mesh);
    }
    if (patch.visible !== undefined) {
      mesh.visible = patch.visible;
      if (this.selection.includes(id)) this.setSelection(this.selection);
    }
    this._updateSelectionBoxes();
    if (commit) this._commit();
    else this.dispatchEvent(new CustomEvent('objects'));
  }

  // ------------------------------------------------------------- vista
  setViewMode(mode) {
    this.viewMode = mode;
    for (const m of this.objects.values()) this._applyViewToMesh(m);
  }

  setTransformMode(mode) { this.gizmo.setMode(mode); }

  setSnap(on) {
    this.snap = on;
    this.gizmo.setTranslationSnap(on ? 0.25 : null);
    this.gizmo.setRotationSnap(on ? 15 * DEG : null);
    this.gizmo.setScaleSnap(on ? 0.1 : null);
  }

  setGrid(on) { this.helpers.visible = on; }

  /** Cambia entre cámara en perspectiva y ortográfica conservando el encuadre. */
  setProjection(mode) {
    if (mode === this.projection) return;
    const t = this.orbit.target;
    const from = this.camera;
    const tanHalf = Math.tan((this.perspCam.fov * DEG) / 2);
    if (mode === 'ortho') {
      const dist = from.position.distanceTo(t);
      const cam = this.orthoCam;
      cam.position.copy(from.position);
      cam.quaternion.copy(from.quaternion);
      cam.zoom = 1;
      this._updateOrthoFrustum(Math.max(dist * tanHalf, 0.05));
      this.camera = cam;
    } else {
      const ortho = this.orthoCam;
      const halfH = ortho.top / ortho.zoom;
      const dir = ortho.position.clone().sub(t).normalize();
      const cam = this.perspCam;
      cam.position.copy(t).add(dir.multiplyScalar(halfH / tanHalf));
      cam.quaternion.copy(ortho.quaternion);
      this.camera = cam;
    }
    this.projection = mode;
    this.orbit.object = this.camera;
    this.gizmo.camera = this.camera;
    this.camera.lookAt(t);
    this.orbit.update();
    this.dispatchEvent(new CustomEvent('camera', { detail: { projection: mode, view: this.currentView } }));
  }

  toggleProjection() { this.setProjection(this.projection === 'persp' ? 'ortho' : 'persp'); }

  /** Vistas rápidas: front (alzado), back, right/left (perfiles), top (planta), bottom, persp. */
  setView(name) {
    if (name === 'focus') return this.frame();
    const v = VIEWS[name];
    if (!v) return;
    this.setProjection(name === 'persp' ? 'persp' : 'ortho');
    const t = this.orbit.target;
    const dist = Math.max(this.camera.position.distanceTo(t), 2);
    this.camera.position.copy(t).add(new THREE.Vector3(...v.dir).normalize().multiplyScalar(dist));
    this.camera.lookAt(t);
    this.currentView = name;
    this.orbit.update();
    this.dispatchEvent(new CustomEvent('camera', { detail: { projection: this.projection, view: name } }));
  }

  /** Compatibilidad con versiones anteriores. */
  cameraPreset(name) { this.setView(name); }

  /** Encuadra la selección (o toda la escena). */
  frame() {
    const box = new THREE.Box3();
    const sel = this.selection.map(id => this.objects.get(id)).filter(m => m?.visible);
    const list = sel.length ? sel : [...this.objects.values()].filter(m => m.visible);
    for (const m of list) box.expandByObject(m, true);
    if (box.isEmpty()) box.set(new THREE.Vector3(-1, 0, -1), new THREE.Vector3(1, 1, 1));
    const sphere = box.getBoundingSphere(new THREE.Sphere());
    const r = Math.max(sphere.radius, 0.3);
    const dir = this.camera.position.clone().sub(this.orbit.target).normalize();
    this.orbit.target.copy(sphere.center);
    if (this.projection === 'ortho') {
      const halfH = this.orthoCam.top;
      this.orthoCam.zoom = halfH / (r * 1.2);
      this.orthoCam.updateProjectionMatrix();
      this.camera.position.copy(sphere.center).add(dir.multiplyScalar(Math.max(r * 4, 10)));
    } else {
      const dist = r / Math.sin((this.perspCam.fov * DEG) / 2) * 1.15;
      this.camera.position.copy(sphere.center).add(dir.multiplyScalar(dist));
    }
  }

  // -------------------------------------------------------- serialización
  _serializeMesh(mesh) {
    const ud = mesh.userData;
    const out = {
      id: ud.id,
      name: ud.name,
      type: ud.type,
      params: { ...ud.params },
      position: mesh.position.toArray().map(v => round(v)),
      rotation: [mesh.rotation.x, mesh.rotation.y, mesh.rotation.z].map(v => round(v * RAD, 3)),
      scale: mesh.scale.toArray().map(v => round(v)),
      material: { ...ud.material },
      visible: mesh.visible,
    };
    if (ud.shape) out.shape = structuredClone(ud.shape);
    if (ud.operands) out.operands = structuredClone(ud.operands);
    return out;
  }

  serialize() {
    return [...this.root.children].filter(m => m.userData.id).map(m => this._serializeMesh(m));
  }

  getCamera() {
    return {
      position: this.camera.position.toArray().map(v => round(v, 3)),
      target: this.orbit.target.toArray().map(v => round(v, 3)),
      projection: this.projection,
      zoom: round(this.orthoCam.zoom, 4),
      halfHeight: round(this.orthoCam.top, 4),
      view: this.currentView,
    };
  }

  /** Carga una lista de objetos (y cámara opcional). */
  load(objects, camera) {
    this.clear();
    const skipped = [];
    for (const d of objects || []) {
      if (d.type !== 'boolean' && !PRIMITIVES[d.type]) { skipped.push(d.type); continue; }
      const data = { ...d, id: d.id || uid(), name: d.name || typeLabel(d) };
      this._insert(data);
    }
    if (camera) {
      this.setProjection('persp');
      this.perspCam.position.fromArray(camera.position);
      this.orbit.target.fromArray(camera.target);
      this.perspCam.lookAt(this.orbit.target);
      this.currentView = camera.view || 'persp';
      if (camera.projection === 'ortho') {
        this.setProjection('ortho');
        this.orthoCam.position.fromArray(camera.position);
        if (camera.halfHeight) this._updateOrthoFrustum(camera.halfHeight);
        this.orthoCam.zoom = camera.zoom || 1;
        this.orthoCam.lookAt(this.orbit.target);
        this.orthoCam.updateProjectionMatrix();
      }
      this.dispatchEvent(new CustomEvent('camera', { detail: { projection: this.projection, view: this.currentView } }));
    }
    this.dispatchEvent(new CustomEvent('objects'));
    return skipped;
  }

  // ------------------------------------------------------------ historial
  resetHistory() {
    this.history = [JSON.stringify(this.serialize())];
    this.historyIndex = 0;
    this._emitHistory();
  }

  _commit() {
    const snap = JSON.stringify(this.serialize());
    if (snap !== this.history[this.historyIndex]) {
      this.history.length = this.historyIndex + 1;
      this.history.push(snap);
      if (this.history.length > 100) this.history.shift();
      this.historyIndex = this.history.length - 1;
      this._emitHistory();
    }
    this.dispatchEvent(new CustomEvent('objects'));
    this.dispatchEvent(new CustomEvent('change'));
  }

  _restore(i) {
    const sel = [...this.selection];
    this.historyIndex = i;
    const objects = JSON.parse(this.history[i]);
    this.clear();
    for (const d of objects) this._insert(d);
    this.setSelection(sel);
    this._emitHistory();
    this.dispatchEvent(new CustomEvent('objects'));
    this.dispatchEvent(new CustomEvent('change'));
  }

  undo() { if (this.historyIndex > 0) this._restore(this.historyIndex - 1); }
  redo() { if (this.historyIndex < this.history.length - 1) this._restore(this.historyIndex + 1); }

  _emitHistory() {
    this.dispatchEvent(new CustomEvent('history', {
      detail: { canUndo: this.historyIndex > 0, canRedo: this.historyIndex < this.history.length - 1 },
    }));
  }

  // --------------------------------------------------------------- utilidades
  stats() {
    let tris = 0, verts = 0;
    for (const m of this.objects.values()) {
      const g = m.geometry;
      if (!g.attributes.position) continue;
      const n = g.index ? g.index.count : g.attributes.position.count;
      tris += n / 3;
      verts += g.attributes.position.count;
    }
    return { objects: this.objects.size, tris: Math.round(tris), verts };
  }

  /** Miniatura JPEG del estado actual (sin ayudas ni gizmo). */
  thumbnail(w = 320, h = 200) {
    if (!this.objects.size) return null;
    const boxes = [...this.selectionBoxes.values()];
    const hidden = [this.helpers, this.gizmoHelper, ...boxes];
    const prev = hidden.map(o => o.visible);
    hidden.forEach(o => (o.visible = false));
    this.renderer.render(this.scene, this.camera);
    const src = this.renderer.domElement;
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const ctx = c.getContext('2d');
    const scale = Math.max(w / src.width, h / src.height);
    const sw = w / scale, sh = h / scale;
    ctx.drawImage(src, (src.width - sw) / 2, (src.height - sh) / 2, sw, sh, 0, 0, w, h);
    hidden.forEach((o, i) => (o.visible = prev[i]));
    return c.toDataURL('image/jpeg', 0.72);
  }
}
