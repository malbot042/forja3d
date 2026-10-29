// Núcleo del editor: escena Three.js, selección, gizmos, modos de vista,
// serialización e historial (deshacer/rehacer).
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { PRIMITIVES, buildGeometry, defaultParams } from './primitives.js';
import { uid } from './storage.js';

const DEG = THREE.MathUtils.DEG2RAD;
const RAD = THREE.MathUtils.RAD2DEG;
const round = (v, d = 4) => Math.round(v * 10 ** d) / 10 ** d;
const FLAT_TYPES = new Set(['plane', 'ring']);

export const DEFAULT_MATERIAL = { color: '#d9d4c7', metalness: 0.05, roughness: 0.6, opacity: 1, flatShading: false };

export class Editor extends EventTarget {
  constructor(container) {
    super();
    this.container = container;
    this.objects = new Map();       // id -> Mesh
    this.selectedId = null;
    this.viewMode = 'solid';
    this.history = [];
    this.historyIndex = -1;
    this._suspendHistory = false;

    // --- renderer / escena / cámara
    const renderer = this.renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    container.appendChild(renderer.domElement);
    renderer.domElement.tabIndex = 0;

    const scene = this.scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0f1114);

    this.camera = new THREE.PerspectiveCamera(50, 1, 0.01, 2000);
    this.camera.position.set(5, 4, 6);

    // luces
    scene.add(new THREE.HemisphereLight(0xdfe8ff, 0x2a2420, 1.2));
    const key = new THREE.DirectionalLight(0xffffff, 2.2);
    key.position.set(6, 10, 7);
    scene.add(key);
    const rim = new THREE.DirectionalLight(0x9fb8ff, 0.7);
    rim.position.set(-8, 4, -6);
    scene.add(rim);

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

    // caja de selección
    this.selectionBox = new THREE.BoxHelper(undefined, 0xf2a541);
    this.selectionBox.material.depthTest = false;
    this.selectionBox.material.transparent = true;
    this.selectionBox.renderOrder = 3;
    this.selectionBox.visible = false;
    scene.add(this.selectionBox);

    // controles de órbita
    this.orbit = new OrbitControls(this.camera, renderer.domElement);
    this.orbit.enableDamping = true;
    this.orbit.dampingFactor = 0.12;
    this.orbit.screenSpacePanning = true;

    // gizmo de transformación
    this.gizmo = new TransformControls(this.camera, renderer.domElement);
    this.gizmo.setSize(0.9);
    this.gizmo.addEventListener('dragging-changed', e => {
      this.orbit.enabled = !e.value;
      if (!e.value) this._commit();
    });
    this.gizmo.addEventListener('objectChange', () => {
      this.selectionBox.update();
      this.dispatchEvent(new CustomEvent('transform', { detail: this.selectedId }));
    });
    scene.add(this.gizmo.getHelper ? this.gizmo.getHelper() : this.gizmo);

    this._initPicking();
    this._resize = this._resize.bind(this);
    new ResizeObserver(this._resize).observe(container);
    this._resize();

    const loop = () => {
      this.orbit.update();
      renderer.render(scene, this.camera);
      this._raf = requestAnimationFrame(loop);
    };
    loop();
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
      this.select(hit ? hit.object.userData.id : null);
    });
  }

  _resize() {
    const w = this.container.clientWidth, h = this.container.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  // -------------------------------------------------------------- creación
  _makeMesh(data) {
    const mat = new THREE.MeshStandardMaterial({ side: FLAT_TYPES.has(data.type) ? THREE.DoubleSide : THREE.FrontSide });
    const mesh = new THREE.Mesh(buildGeometry(data.type, data.params), mat);
    const edges = new THREE.LineSegments(
      new THREE.EdgesGeometry(mesh.geometry, 25),
      new THREE.LineBasicMaterial({ color: 0x111316, transparent: true, opacity: 0.85 })
    );
    edges.name = '__edges';
    edges.raycast = () => {};
    mesh.add(edges);
    mesh.userData = { id: data.id, type: data.type, params: { ...data.params }, name: data.name, material: { ...DEFAULT_MATERIAL, ...data.material } };
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

  _nextName(type) {
    const label = PRIMITIVES[type].label;
    let n = 1;
    const names = new Set([...this.objects.values()].map(m => m.userData.name));
    while (names.has(`${label} ${n}`)) n++;
    return `${label} ${n}`;
  }

  addPrimitive(type) {
    const params = defaultParams(type);
    const data = {
      id: uid(), type, name: this._nextName(type), params,
      position: [0, 0, 0], rotation: FLAT_TYPES.has(type) ? [-90, 0, 0] : [0, 0, 0], scale: [1, 1, 1],
      material: { ...DEFAULT_MATERIAL },
    };
    const mesh = this._makeMesh(data);
    // Apoyar el objeto sobre la rejilla (y=0), delante de la cámara
    mesh.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(mesh);
    const target = this.orbit.target;
    mesh.position.x = this._snapVal(target.x);
    mesh.position.z = this._snapVal(target.z);
    mesh.position.y = FLAT_TYPES.has(type) ? 0.001 : round(-box.min.y);
    this.root.add(mesh);
    this.objects.set(data.id, mesh);
    this.select(data.id);
    this._commit();
    return data.id;
  }

  _snapVal(v) {
    return this.snap ? Math.round(v / 0.25) * 0.25 : round(v, 3);
  }

  duplicate(id = this.selectedId) {
    const src = this.objects.get(id);
    if (!src) return;
    const data = this._serializeMesh(src);
    data.id = uid();
    data.name = this._uniqueName(`${src.userData.name} copia`);
    data.position[0] = round(data.position[0] + 0.5);
    data.position[2] = round(data.position[2] + 0.5);
    const mesh = this._makeMesh(data);
    this.root.add(mesh);
    this.objects.set(data.id, mesh);
    this.select(data.id);
    this._commit();
  }

  _uniqueName(base) {
    const names = new Set([...this.objects.values()].map(m => m.userData.name));
    if (!names.has(base)) return base;
    let n = 2;
    while (names.has(`${base} ${n}`)) n++;
    return `${base} ${n}`;
  }

  remove(id = this.selectedId) {
    const mesh = this.objects.get(id);
    if (!mesh) return;
    if (this.selectedId === id) this.select(null);
    this._disposeMesh(mesh);
    this.objects.delete(id);
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
    this.select(null);
    for (const m of this.objects.values()) this._disposeMesh(m);
    this.objects.clear();
  }

  // ------------------------------------------------------------ selección
  select(id) {
    if (id && !this.objects.has(id)) id = null;
    this.selectedId = id;
    const mesh = id ? this.objects.get(id) : null;
    if (mesh && mesh.visible) {
      this.gizmo.attach(mesh);
      this.selectionBox.setFromObject(mesh);
      this.selectionBox.visible = true;
    } else {
      this.gizmo.detach();
      this.selectionBox.visible = false;
    }
    this.dispatchEvent(new CustomEvent('select', { detail: id }));
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
    if (patch.params) {
      ud.params = { ...ud.params, ...patch.params };
      const old = mesh.geometry;
      mesh.geometry = buildGeometry(ud.type, ud.params);
      old.dispose();
      const edges = mesh.getObjectByName('__edges');
      edges.geometry.dispose();
      edges.geometry = new THREE.EdgesGeometry(mesh.geometry, 25);
    }
    this._applyTransform(mesh, patch);
    if (patch.material) {
      ud.material = { ...ud.material, ...patch.material };
      this._applyMaterial(mesh);
    }
    if (patch.visible !== undefined) {
      mesh.visible = patch.visible;
      if (id === this.selectedId) this.select(id);
    }
    if (id === this.selectedId && mesh.visible) this.selectionBox.setFromObject(mesh);
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

  cameraPreset(name) {
    const t = this.orbit.target;
    const dist = Math.max(this.camera.position.distanceTo(t), 2);
    const dirs = {
      persp: new THREE.Vector3(1, 0.8, 1.2),
      front: new THREE.Vector3(0, 0, 1),
      right: new THREE.Vector3(1, 0, 0),
      top: new THREE.Vector3(0, 1, 0.0001),
    };
    if (name === 'focus') return this.frame();
    this.camera.position.copy(t).add(dirs[name].normalize().multiplyScalar(dist));
    this.camera.lookAt(t);
  }

  /** Encuadra la selección (o toda la escena). */
  frame() {
    const box = new THREE.Box3();
    const sel = this.objects.get(this.selectedId);
    if (sel) box.setFromObject(sel);
    else for (const m of this.objects.values()) if (m.visible) box.expandByObject(m);
    if (box.isEmpty()) box.set(new THREE.Vector3(-1, 0, -1), new THREE.Vector3(1, 1, 1));
    const sphere = box.getBoundingSphere(new THREE.Sphere());
    const dist = Math.max(sphere.radius, 0.3) / Math.sin((this.camera.fov * DEG) / 2) * 1.15;
    const dir = this.camera.position.clone().sub(this.orbit.target).normalize();
    this.orbit.target.copy(sphere.center);
    this.camera.position.copy(sphere.center).add(dir.multiplyScalar(dist));
  }

  // -------------------------------------------------------- serialización
  _serializeMesh(mesh) {
    const ud = mesh.userData;
    return {
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
  }

  serialize() {
    return [...this.root.children].filter(m => m.userData.id).map(m => this._serializeMesh(m));
  }

  getCamera() {
    return {
      position: this.camera.position.toArray().map(v => round(v, 3)),
      target: this.orbit.target.toArray().map(v => round(v, 3)),
    };
  }

  /** Carga una lista de objetos (y cámara opcional). */
  load(objects, camera) {
    this.clear();
    const skipped = [];
    for (const d of objects || []) {
      if (!PRIMITIVES[d.type]) { skipped.push(d.type); continue; }
      const data = { ...d, id: d.id || uid(), name: d.name || PRIMITIVES[d.type].label };
      const mesh = this._makeMesh(data);
      this.root.add(mesh);
      this.objects.set(data.id, mesh);
    }
    if (camera) {
      this.camera.position.fromArray(camera.position);
      this.orbit.target.fromArray(camera.target);
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
    const sel = this.selectedId;
    this.historyIndex = i;
    this.load(JSON.parse(this.history[i]));
    this.select(this.objects.has(sel) ? sel : null);
    this._emitHistory();
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
      const n = g.index ? g.index.count : g.attributes.position.count;
      tris += n / 3;
      verts += g.attributes.position.count;
    }
    return { objects: this.objects.size, tris: Math.round(tris), verts };
  }

  /** Miniatura JPEG del estado actual (sin ayudas ni gizmo). */
  thumbnail(w = 320, h = 200) {
    if (!this.objects.size) return null;
    const hidden = [this.helpers, this.selectionBox, this.gizmo.getHelper ? this.gizmo.getHelper() : this.gizmo];
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
