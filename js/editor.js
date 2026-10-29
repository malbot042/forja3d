// Núcleo del editor: escena Three.js, selección (simple y múltiple), gizmos, cámaras
// perspectiva/ortográfica, modos de vista, operaciones booleanas, serialización e historial.
import * as THREE from 'three';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { PRIMITIVES, DEFAULT_SHAPES, BOOLEAN_OPS, defaultParams, typeLabel, profileFrom2D, profileCenterOffset } from './primitives.js';
import { geometryFor, evaluateBoolean, cachePut, csgKey, matrixOf } from './csg.js';
import { uid } from './storage.js';
import { encodeGeometry, meshDataSize } from './io.js';
import { createSculpt, SculptSession } from './sculpt.js';
import { cssVar, currentTheme } from './theme.js';
import { View, CadPanel, LAYOUTS } from './views.js';
import { Cad, fitView } from './cad2d.js';

const DEG = THREE.MathUtils.DEG2RAD;
const RAD = THREE.MathUtils.RAD2DEG;
const round = (v, d = 4) => Math.round(v * 10 ** d) / 10 ** d;
const FLAT_TYPES = new Set(['plane', 'ring', 'circle2d', 'line2d']);
const DOUBLE_SIDED = new Set(['plane', 'ring', 'lathe', 'circle2d', 'line2d', 'mesh']);
const HALF_SPACE = 1000;

export const DEFAULT_MATERIAL = { color: '#d9d4c7', metalness: 0.05, roughness: 0.6, opacity: 1, flatShading: false };

export { VIEWS, LAYOUTS } from './views.js';

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
    this.history = [];
    this.historyIndex = -1;
    this.views = [];
    this.layout = 1;
    this.cad = new Cad();          // plano 2D: espacio de trabajo independiente del 3D
    this.workspace = '3d';         // '3d' (escena) | '2d' (plano)
    this.cadPanels = [];
    this.cadLayout = 1;
    this.cadActive = null;

    // --- renderer / escena (un solo lienzo; cada panel se dibuja con viewport + scissor)
    const renderer = this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.domElement.classList.add('gl-canvas');
    container.appendChild(renderer.domElement);
    this.layoutEl = document.createElement('div');
    this.layoutEl.className = 'vp-layout';
    container.appendChild(this.layoutEl);
    this.cadLayoutEl = document.createElement('div');
    this.cadLayoutEl.className = 'vp-layout cad-layout';
    this.cadLayoutEl.hidden = true;
    container.appendChild(this.cadLayoutEl);

    const scene = this.scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0f1114);
    this.theme = 'dark';

    // luces (más una que acompaña a la cámara de cada panel)
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
    const axes = new THREE.AxesHelper(1.2);
    axes.material.depthTest = false;
    axes.renderOrder = 2;
    this.helpers.add(axes);
    scene.add(this.helpers);
    this.setTheme(currentTheme());
    document.addEventListener('themechange', e => { this._navBg = this._navNeg = null; this.setTheme(e.detail); });

    // raíz de objetos del usuario
    this.root = new THREE.Group();
    this.root.name = 'root';
    scene.add(this.root);

    // cajas de selección
    this.selectionBoxes = new Map();

    // gizmo de transformación (mueve también el resto de la selección); sigue al panel bajo el ratón
    this.gizmo = new TransformControls(new THREE.PerspectiveCamera(), null);
    this.gizmo.setSize(0.9);
    let start = null;
    this.gizmo.addEventListener('mouseDown', () => {
      const primary = this.objects.get(this.selectedId);
      if (!primary || this.subSel) { start = null; return; }
      primary.updateMatrix();
      start = {
        inv: primary.matrix.clone().invert(),
        others: this.selection.filter(id => id !== this.selectedId)
          .map(id => this.objects.get(id)).filter(Boolean)
          .map(m => { m.updateMatrix(); return [m, m.matrix.clone()]; }),
      };
    });
    this.gizmo.addEventListener('dragging-changed', e => {
      if (this.gizmoView) this.gizmoView.orbit.enabled = !e.value;
      if (!e.value) {
        start = null;
        if (this.subSel) this._rebuildRoot(this.subSel.rootId);
        this._commit();
      }
    });
    this.gizmo.addEventListener('objectChange', () => {
      if (this.subSel) { this._proxyMoved(); return; }
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

    this.setLayout(1);
    this.setCadLayout(1);
    this._resize = this._resize.bind(this);
    new ResizeObserver(this._resize).observe(container);
    this._resize();

    const loop = () => {
      if (this.workspace === '3d') this.renderViews();
      this._raf = requestAnimationFrame(loop);
    };
    loop();
  }

  // -------------------------------------------------------------- paneles
  get camera() { return this.active.camera; }
  get orbit() { return this.active.orbit; }
  get projection() { return this.active.projection; }
  get currentView() { return this.active.currentView; }
  set currentView(v) { this.active.currentView = v; this.active.updateLabel(); }

  /** Divide el visor en 1, 2, 3 o 4 paneles, cada uno con su propia cámara. */
  setLayout(layout, states) {
    const key = LAYOUTS[layout] ? String(layout) : '1';
    const L = LAYOUTS[key];
    const n = L.n ?? +key;
    const defaults = L.views;
    const prevTarget = this.views[0]?.target.clone();
    while (this.views.length > n) {
      const v = this.views.pop();
      if (this.gizmoView === v) this._detachGizmo();
      v.dispose();
    }
    while (this.views.length < n) {
      const v = new View(this, this.views.length);
      this.layoutEl.append(v.el);
      this.views.push(v);
      if (prevTarget) v.target.copy(prevTarget);
      v.persp.position.copy(v.target).add(new THREE.Vector3(5, 4, 6));
      v._isNew = true;
    }
    this.layout = +key;
    this.layoutEl.dataset.layout = n;
    this.layoutEl.classList.toggle('multi', n > 1);
    this._resize();
    this.views.forEach((v, i) => {
      if (states?.[i]) v.setState(states[i]);
      else {
        if (v._isNew && (defaults[i] !== 'persp' || i > 0)) v.setView(defaults[i]);
      }
      v._isNew = false;
    });
    if (!this.views.includes(this.active)) this.setActiveView(this.views[0]);
    this._syncGizmo();
    this._resize();
    this.dispatchEvent(new CustomEvent('layout', { detail: this.layout }));
  }

  setActiveView(view) {
    if (this.active === view) return;
    this.active = view;
    for (const v of this.views) v.el.classList.toggle('active', v === view);
    this._emitCamera(view);
  }

  // ------------------------------------------------------- espacio de trabajo 2D
  /** Cambia toda la pantalla entre la escena 3D y el plano 2D (cada uno conserva sus paneles). */
  setWorkspace(ws, force = false) {
    ws = ws === '2d' ? '2d' : '3d';
    if (ws === this.workspace && !force) return;
    if (ws === '2d' && this.sculpt) this.endSculpt();
    if (ws === '3d') this.cad.cancel(true);
    this.workspace = ws;
    this.container.classList.toggle('ws-2d', ws === '2d');
    this.layoutEl.hidden = ws === '2d';
    this.cadLayoutEl.hidden = ws !== '2d';
    this._syncGizmo();
    this._resize();
    if (ws === '3d') this.renderViews();
    this.dispatchEvent(new CustomEvent('workspace', { detail: ws }));
    this.dispatchEvent(new CustomEvent('layout', { detail: this.currentLayout }));
  }

  get currentLayout() { return this.workspace === '2d' ? this.cadLayout : this.layout; }
  /** Paneles a la vista (los del espacio de trabajo actual). */
  get shownPanels() { return this.workspace === '2d' ? this.cadPanels : this.views; }

  /** Divide el plano 2D en 1-4 paneles, cada uno con su propio encuadre. */
  setCadLayout(n, states) {
    n = Math.max(1, Math.min(4, +n || 1));
    while (this.cadPanels.length > n) this.cadPanels.pop().dispose();
    while (this.cadPanels.length < n) {
      const p = new CadPanel(this, this.cadPanels.length);
      this.cadLayoutEl.append(p.el);
      this.cadPanels.push(p);
      // un panel nuevo empieza con el mismo encuadre que el primero
      if (this.cadPanels[0] !== p && this.cadPanels[0].cadView.fitted) p.setState(this.cadPanels[0].getState());
    }
    this.cadLayout = n;
    this.cadLayoutEl.dataset.layout = n;
    this.cadLayoutEl.classList.toggle('multi', n > 1);
    this.cadPanels.forEach((p, i) => { if (states?.[i]) p.setState(states[i]); p.updateLabel(); });
    if (!this.cadPanels.includes(this.cadActive)) this.setCadActive(this.cadPanels[0]);
    this._resize();
    this.dispatchEvent(new CustomEvent('layout', { detail: this.currentLayout }));
  }

  setCadActive(panel) {
    if (!panel || this.cadActive === panel) return;
    this.cadActive = panel;
    for (const p of this.cadPanels) p.el.classList.toggle('active', p === panel);
  }

  _emitCamera(view) {
    if (view !== this.active) return;
    this.dispatchEvent(new CustomEvent('camera', { detail: { projection: view.projection, view: view.currentView } }));
  }

  /**
   * El gizmo 3D solo puede estar enganchado a un panel 3D: en un panel 2D capturaría
   * el puntero y el plano dejaría de recibir los arrastres.
   */
  _syncGizmo() {
    if (this.workspace === '2d') { this._detachGizmo(); return; }
    const g = this.gizmoView;
    if (g && this.views.includes(g)) return;
    this._detachGizmo();
    this._hoverView(this.views[0]);
  }

  _detachGizmo() {
    if (this.gizmo.domElement) this.gizmo.disconnect();
    this.gizmoView = null;
  }

  /** El gizmo trabaja en el panel que está bajo el ratón. */
  _hoverView(view) {
    if (!view || this.workspace === '2d' || this.gizmo.dragging || this.gizmoView === view) return;
    if (this.gizmo.domElement) this.gizmo.disconnect();
    this.gizmo.domElement = view.el;
    this.gizmo.connect();
    this.gizmo.camera = view.camera;
    this.gizmoView = view;
  }

  _cameraChanged(view) {
    if (this.gizmoView === view) this.gizmo.camera = view.camera;
  }

  /** Dibuja todos los paneles. `opts.only` limita a una vista; `opts.size` fuerza el tamaño total. */
  renderViews(opts = {}) {
    if (this.sculpt) this.sculpt.tick();
    const r = this.renderer;
    const W = this.container.clientWidth, H = this.container.clientHeight;
    if (!W || !H) return;
    r.setScissorTest(false);
    r.setClearColor(opts.sepColor ?? (this._sepColor ??= new THREE.Color(cssVar('--line') || '#2e333a')), opts.sepAlpha ?? 1);
    r.clear();
    for (const v of opts.only ? [opts.only] : this.views) {
      const rc = opts.only ? { x: 0, y: 0, w: W, h: H } : v.rect();
      if (rc.w < 2 || rc.h < 2) continue;
      if (!opts.only) v.setAspect(rc.w / rc.h);
      v.orbit.update();
      r.setViewport(rc.x, H - rc.y - rc.h, rc.w, rc.h);
      r.setScissor(rc.x, H - rc.y - rc.h, rc.w, rc.h);
      r.setScissorTest(true);
      this.headLight.position.copy(v.camera.position);
      this.headLight.target.position.copy(v.target);
      this.gizmo.camera = v.camera;
      r.render(this.scene, v.camera);
      if (!opts.noNav) v.drawNav(this.layout > 1);
    }
    r.setScissorTest(false);
    if (this.gizmoView) this.gizmo.camera = this.gizmoView.camera;
  }

    /** Colores de la escena según el tema ('dark' | 'light'). */
  setTheme(theme) {
    this.theme = theme;
    this._sepColor = null;
    const light = theme === 'light';
    this.scene.background = new THREE.Color(light ? 0xe7e6e2 : 0x0f1114);
    for (const g of this.grids || []) { this.helpers.remove(g); g.geometry.dispose(); g.material.dispose(); }
    const grid = new THREE.GridHelper(40, 40, light ? 0xa9a59c : 0x3a4049, light ? 0xc9c6bf : 0x23272d);
    grid.material.transparent = true;
    grid.material.opacity = 0.9;
    const fine = new THREE.GridHelper(40, 160, light ? 0xdcdad5 : 0x1c1f24, light ? 0xdcdad5 : 0x1c1f24);
    fine.position.y = -0.0005;
    this.grids = [fine, grid];
    this.helpers.add(fine, grid);
    const sel = light ? 0xc8740c : 0xf2a541;
    this.selectionColor = sel;
    for (const box of this.selectionBoxes?.values() || []) box.material.color.setHex(sel);
  }

  get selectedId() { return this.selection[this.selection.length - 1] ?? null; }

  notice(msg, error = false) {
    this.dispatchEvent(new CustomEvent('notice', { detail: { msg, error } }));
  }

  // ---------------------------------------------------------------- picking
  _pick(view, e) {
    if (this.sculpt) return;
    if (this.gizmo.dragging || this.gizmo.axis) return;
    const r = view.el.getBoundingClientRect();
    const ndc = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, view.camera);
    const meshes = [...this.objects.values()].filter(m => m.visible);
    const hit = ray.intersectObjects(meshes, false)[0];
    const id = hit ? hit.object.userData.id : null;
    if (e.shiftKey || e.ctrlKey || e.metaKey) { if (id) this.toggleSelect(id); }
    else this.select(id);
  }

  _resize() {
    const w = this.container.clientWidth, h = this.container.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    for (const v of this.views) {
      const rc = v.rect();
      if (rc.w && rc.h) v.setAspect(rc.w / rc.h);
    }
    for (const p of this.cadPanels) p.cadView.resize();
  }

  // -------------------------------------------------------------- creación
  _makeMesh(data) {
    const double = DOUBLE_SIDED.has(data.type) || (data.type === 'sculpt' && data.sculpt?.kind === 'mesh');
    const mat = new THREE.MeshStandardMaterial({ side: double ? THREE.DoubleSide : THREE.FrontSide });
    let geom;
    try {
      geom = geometryFor(data);
    } catch (err) {
      console.error(err);
      this.notice(`No se pudo generar «${data.name}»: ${err.message}`, true);
      geom = new THREE.BoxGeometry(0.2, 0.2, 0.2);
    }
    const mesh = new THREE.Mesh(geom, mat);
    mesh.userData = {
      id: data.id, type: data.type, name: data.name,
      params: { ...data.params },
      material: { ...DEFAULT_MATERIAL, ...data.material },
    };
    if (data.shape) mesh.userData.shape = structuredClone(data.shape);
    if (data.operands) mesh.userData.operands = structuredClone(data.operands);
    if (data.mesh) mesh.userData.mesh = { ...data.mesh };
    if (data.sculpt) mesh.userData.sculpt = data.sculpt;
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
    const wire = this.viewMode === 'wire';
    if (mesh.material.wireframe !== wire) {
      mesh.material.wireframe = wire;
      mesh.material.needsUpdate = true;
    }
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

  remove(ids) {
    if (!ids && this.subSel) return this.removeOperand(this.subSel.rootId, this.subSel.path);
    ids = ids || [...this.selection];
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

  /**
   * Añade mallas importadas (de loadModelFile). Se centran en el punto de la vista,
   * se apoyan en el suelo y, si son enormes o diminutas, se reescalan a ~2 unidades.
   */
  importParts(parts, source, { autoScale = true } = {}) {
    const box = new THREE.Box3();
    for (const p of parts) {
      p.geometry.applyMatrix4(p.matrix);
      p.geometry.computeBoundingBox();
      box.union(p.geometry.boundingBox);
    }
    const size = box.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z) || 1;
    let s = 1;
    if (autoScale && (maxDim > 200 || maxDim < 0.02)) s = 2 / maxDim;
    const c = box.getCenter(new THREE.Vector3());
    const t = this.orbit.target.clone();
    // si ya hay objetos, colocar el modelo a su derecha para que no se solapen
    const scene = new THREE.Box3();
    for (const m of this.objects.values()) if (m.visible) scene.expandByObject(m);
    if (!scene.isEmpty()) t.set(scene.max.x + 0.5 + (size.x * s) / 2, 0, (scene.min.z + scene.max.z) / 2);
    const T = new THREE.Matrix4().makeTranslation(t.x - c.x * s, -box.min.y * s, t.z - c.z * s)
      .multiply(new THREE.Matrix4().makeScale(s, s, s));
    const ids = [];
    let bytes = 0;
    for (const p of parts) {
      const g = p.geometry;
      const pc = g.boundingBox.getCenter(new THREE.Vector3());
      g.translate(-pc.x, -pc.y, -pc.z);
      const pos = pc.clone().applyMatrix4(T);
      const mesh = encodeGeometry(g, source);
      bytes += meshDataSize(mesh);
      g.dispose();
      const data = {
        id: uid(), type: 'mesh', name: this._uniqueName(p.name || 'Malla'), params: {}, mesh,
        position: pos.toArray().map(v => round(v)), rotation: [0, 0, 0], scale: [s, s, s].map(v => round(v, 6)),
        material: { ...DEFAULT_MATERIAL, ...p.material }, visible: true,
      };
      this._insert(data);
      ids.push(data.id);
    }
    this.setSelection(ids);
    this._commit();
    return { ids, scaled: s !== 1, scale: s, size: maxDim, bytes };
  }

  /**
   * Crea objetos «Extrusión» a partir de contornos del plano 2D.
   * shapes: [{points, holes}] en unidades del plano · depth: altura en unidades del plano
   * scale: unidades 3D por unidad del plano · center: centrar el conjunto en el origen
   */
  addExtrusions(shapes, { depth, scale, center = true, name = 'Pieza', material } = {}) {
    let ox = 0, oy = 0;
    if (center) {
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const s of shapes) for (const p of s.points) { x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]); x1 = Math.max(x1, p[0]); y1 = Math.max(y1, p[1]); }
      ox = (x0 + x1) / 2; oy = (y0 + y1) / 2;
    }
    const t = p => [round((p[0] - ox) * scale, 6), round((p[1] - oy) * scale, 6)];
    const ids = [];
    for (const s of shapes) {
      const shape = { smooth: false, points: s.points.map(t), holes: (s.holes || []).map(h => h.map(t)) };
      const params = { ...defaultParams('extrude'), depth: Math.min(100, Math.max(0.001, round(depth * scale, 6))) };
      const c = profileCenterOffset('extrude', params, shape);
      const data = {
        id: uid(), type: 'extrude', name: this._nextName(name), params, shape,
        position: [round(c.x), round(c.y), round(c.z)], rotation: [0, 0, 0], scale: [1, 1, 1],
        material: { ...DEFAULT_MATERIAL, ...material }, visible: true,
      };
      this._insert(data);
      ids.push(data.id);
    }
    this.setSelection(ids);
    this._commit();
    return ids;
  }

  /** Añade a la escena los objetos de otro proyecto (con ids y nombres nuevos). */
  mergeObjects(objects) {
    const ids = [];
    for (const d of objects || []) {
      if (!['boolean', 'mesh', 'sculpt'].includes(d.type) && !PRIMITIVES[d.type]) continue;
      const data = { ...d, id: uid(), name: this._uniqueName(d.name || typeLabel(d)) };
      this._insert(data);
      ids.push(data.id);
    }
    this.setSelection(ids);
    this._commit();
    return ids;
  }

  /**
   * Convierte un Círculo 2D o una Línea 2D en una Extrusión o una Revolución.
   * opts: { mode, thickness, depth, angle, segments, keep }
   */
  convert2D(id, kind, opts = {}) {
    const mesh = this.objects.get(id);
    if (!mesh || !['circle2d', 'line2d'].includes(mesh.userData.type)) {
      this.notice('Selecciona un Círculo 2D o una Línea 2D.', true);
      return null;
    }
    const src = this._serializeMesh(mesh);
    let shape;
    try {
      shape = profileFrom2D(src, kind, opts.mode, opts.thickness);
    } catch (err) {
      this.notice(err.message, true);
      return null;
    }
    const type = kind === 'extrude' ? 'extrude' : 'lathe';
    const params = type === 'extrude'
      ? { ...defaultParams('extrude'), depth: opts.depth ?? 0.5 }
      : { ...defaultParams('lathe'), angle: opts.angle ?? 360, segments: opts.segments ?? 48 };
    const c = profileCenterOffset(type, params, shape);
    mesh.updateMatrixWorld(true);
    let m;
    if (type === 'extrude') {
      // el perfil queda exactamente sobre el dibujo 2D y se extruye según su normal
      m = mesh.matrixWorld.clone()
        .multiply(new THREE.Matrix4().makeRotationX(Math.PI / 2))
        .multiply(new THREE.Matrix4().makeTranslation(c.x, c.y, c.z));
    } else {
      // revolución: eje vertical del mundo que pasa por el origen del elemento 2D
      const p = new THREE.Vector3().setFromMatrixPosition(mesh.matrixWorld);
      m = new THREE.Matrix4().makeTranslation(p.x + c.x, p.y + c.y, p.z + c.z);
    }
    const data = {
      id: uid(), type, params, shape,
      name: this._nextName(PRIMITIVES[type].label),
      ...decompose(m), material: { ...src.material }, visible: true,
    };
    const created = this._insert(data);
    if (type === 'lathe') this._dropMesh(created);
    if (!opts.keep) this._removeSilently([id]);
    else mesh.visible = false;
    this.setSelection([data.id]);
    this._commit();
    return data.id;
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

  setSelection(ids, { keepSub = false } = {}) {
    if (this.sculpt && !(ids.length === 1 && ids[0] === this.sculpt.mesh.userData.id)) this.endSculpt();
    this.selection = ids.filter(id => this.objects.has(id));
    if (!keepSub) this.subSel = null;
    this._refreshSub();
    const primary = this.objects.get(this.selectedId);
    if (this.sculpt) this.gizmo.detach();
    else if (this.subSel) this.gizmo.attach(this._proxy);
    else if (primary && primary.visible) this.gizmo.attach(primary);
    else this.gizmo.detach();
    this._updateSelectionBoxes();
    this.dispatchEvent(new CustomEvent('select', { detail: this.selectedId }));
  }

  _updateSelectionBoxes() {
    if (this.sculpt) {
      for (const box of this.selectionBoxes.values()) { this.scene.remove(box); box.geometry.dispose(); box.material.dispose(); }
      this.selectionBoxes.clear();
      return;
    }
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
        box = new THREE.BoxHelper(mesh, this.selectionColor ?? 0xf2a541);
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

  // ------------------------------------------- piezas dentro de operaciones
  /**
   * Localiza una pieza dentro de una operación booleana.
   * `path` son los índices de operandos desde la raíz (p. ej. [0, 1]).
   */
  _operandAt(rootId, path) {
    const root = this.objects.get(rootId);
    if (!root || root.userData.type !== 'boolean' || !path?.length) return null;
    root.updateMatrixWorld(true);
    let list = root.userData.operands;
    const parentWorld = root.matrixWorld.clone();
    let parent = null;
    for (let d = 0; d < path.length; d++) {
      const node = list?.[path[d]];
      if (!node) return null;
      if (d === path.length - 1) {
        return { root, node, list, index: path[d], parent, parentWorld, world: parentWorld.clone().multiply(matrixOf(node)) };
      }
      if (node.type !== 'boolean') return null;
      parentWorld.multiply(matrixOf(node));
      parent = node;
      list = node.operands;
    }
    return null;
  }

  /** Matriz «visible» de una pieza: para un plano de corte es el plano, no el centro del semiespacio. */
  _displayLocal(node) {
    const m = matrixOf(node);
    return node.helper ? m.multiply(new THREE.Matrix4().makeTranslation(0, 0, -HALF_SPACE / 2)) : m;
  }

  /** Inversa de _displayLocal: guarda en la pieza una matriz «visible». */
  _storeLocal(node, m) {
    const local = node.helper ? m.clone().multiply(new THREE.Matrix4().makeTranslation(0, 0, HALF_SPACE / 2)) : m;
    Object.assign(node, decompose(local));
  }

  /** Selecciona una pieza de una operación: se resalta en 3D y el gizmo la mueve. */
  selectOperand(rootId, path) {
    if (!this._operandAt(rootId, path)) return this.select(rootId);
    this.subSel = { rootId, path: [...path] };
    this.setSelection([rootId], { keepSub: true });
  }

  getSubSelected() {
    if (!this.subSel) return null;
    const at = this._operandAt(this.subSel.rootId, this.subSel.path);
    if (!at) return null;
    const out = { ...structuredClone(at.node), rootId: this.subSel.rootId, path: [...this.subSel.path], parentOp: at.parent ? at.parent.params?.op : at.root.userData.params.op };
    if (at.node.helper) Object.assign(out, decompose(this._displayLocal(at.node)));
    return out;
  }

  _refreshSub() {
    if (this._ghost) {
      this.scene.remove(this._ghost);
      this._ghost.geometry.dispose();
      this._ghost.material.dispose();
      this._ghost = null;
    }
    if (!this.subSel) return;
    const at = this._operandAt(this.subSel.rootId, this.subSel.path);
    if (!at) { this.subSel = null; return; }
    let edges;
    if (at.node.helper) {
      // plano de corte: un cuadrado sobre la cara del semiespacio
      at.root.geometry.computeBoundingSphere();
      const sz = Math.max(1, at.root.geometry.boundingSphere.radius * 2.6);
      const pg = new THREE.PlaneGeometry(sz, sz);
      edges = new THREE.EdgesGeometry(pg);
      pg.dispose();
    } else {
      const g = geometryFor(at.node);
      edges = new THREE.WireframeGeometry(g);
      g.dispose();
    }
    const ghost = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({
      color: this.theme === 'light' ? 0x1f6fd1 : 0x5ab0ff, transparent: true, opacity: at.node.helper ? 0.95 : 0.5, depthTest: false,
    }));
    const shown = at.parentWorld.clone().multiply(this._displayLocal(at.node));
    ghost.matrixAutoUpdate = false;
    ghost.matrix.copy(shown);
    ghost.matrixWorldNeedsUpdate = true;
    ghost.renderOrder = 4;
    ghost.raycast = () => {};
    this.scene.add(ghost);
    this._ghost = ghost;
    if (!this._proxy) { this._proxy = new THREE.Object3D(); this.scene.add(this._proxy); }
    shown.decompose(this._proxy.position, this._proxy.quaternion, this._proxy.scale);
    this._proxy.updateMatrixWorld(true);
  }

  /** El gizmo ha movido la pieza: actualizar sus datos y el resaltado (sin recalcular la operación). */
  _proxyMoved() {
    const at = this._operandAt(this.subSel.rootId, this.subSel.path);
    if (!at) return;
    this._proxy.updateMatrix();
    this._storeLocal(at.node, at.parentWorld.clone().invert().multiply(this._proxy.matrix));
    if (this._ghost) { this._ghost.matrix.copy(this._proxy.matrix); this._ghost.matrixWorldNeedsUpdate = true; }
    this.dispatchEvent(new CustomEvent('transform', { detail: this.selectedId }));
  }

  /** Recalcula la malla de una operación tras cambiar alguna de sus piezas. */
  _rebuildRoot(rootId) {
    const mesh = this.objects.get(rootId);
    if (!mesh) return;
    const ud = mesh.userData;
    try {
      const g = geometryFor({ type: 'boolean', params: ud.params, operands: ud.operands });
      const old = mesh.geometry;
      mesh.geometry = g;
      old.dispose();
    } catch (err) {
      console.error(err);
      this.notice(`No se pudo recalcular la operación: ${err.message}`, true);
    }
    this._updateSelectionBoxes();
  }

  /** Cambia una pieza (nombre, transformación, parámetros u operación). `commit=false` solo actualiza el resaltado. */
  updateOperand(rootId, path, patch, commit = true) {
    const at = this._operandAt(rootId, path);
    if (!at) return;
    const n = at.node;
    if (patch.name !== undefined) n.name = patch.name;
    if (patch.position || patch.rotation || patch.scale) {
      const cur = decompose(this._displayLocal(n));
      const next = { position: patch.position || cur.position, rotation: patch.rotation || cur.rotation, scale: patch.scale || cur.scale };
      this._storeLocal(n, matrixOf(next));
    }
    if (patch.params) n.params = { ...n.params, ...patch.params };
    if (commit) {
      this._rebuildRoot(rootId);
      this.subSel = { rootId, path: [...path] };
      this.setSelection([rootId], { keepSub: true });
      this._commit();
    } else if (patch.params) {
      this._refreshSub();
    } else if (this._ghost) {
      const w = at.parentWorld.clone().multiply(this._displayLocal(n));
      this._ghost.matrix.copy(w);
      this._ghost.matrixWorldNeedsUpdate = true;
      w.decompose(this._proxy.position, this._proxy.quaternion, this._proxy.scale);
    }
  }

  /**
   * Quita una pieza de su operación. Con `extract` la deja como objeto independiente en su sitio.
   * Si la operación queda con una sola pieza, la operación desaparece y queda esa pieza.
   */
  removeOperand(rootId, path, { extract = false } = {}) {
    const at = this._operandAt(rootId, path);
    if (!at) return;
    const { root, node, list, index, parent } = at;
    const newIds = [];
    if (extract && !node.helper) {
      const data = { ...structuredClone(node), ...decompose(at.world), id: uid(), name: this._uniqueName(node.name || typeLabel(node)) };
      delete data.helper;
      if (!data.material) data.material = { ...root.userData.material };
      this._insert(data);
      newIds.push(data.id);
    }
    list.splice(index, 1);
    let keepRoot = rootId;
    if (list.length === 1) {
      const rest = list[0];
      if (!parent) {
        // la operación raíz desaparece: queda la pieza restante (salvo que sea solo un plano de corte)
        root.updateMatrix();
        if (!rest.helper) {
          const data = {
            ...structuredClone(rest), ...decompose(root.matrix.clone().multiply(matrixOf(rest))),
            id: uid(), name: this._uniqueName(rest.name || typeLabel(rest)), material: { ...root.userData.material }, visible: true,
          };
          delete data.helper;
          this._insert(data);
          newIds.unshift(data.id);
        }
        this._removeSilently([rootId]);
        keepRoot = null;
      } else {
        // operación anidada: se sustituye por la pieza restante
        const merged = { ...structuredClone(rest), ...decompose(matrixOf(parent).multiply(matrixOf(rest))) };
        for (const k of Object.keys(parent)) delete parent[k];
        Object.assign(parent, merged);
      }
    }
    if (keepRoot) this._rebuildRoot(keepRoot);
    this.subSel = null;
    this.setSelection(newIds.length ? newIds : keepRoot ? [keepRoot] : []);
    this._commit();
    this.notice(extract ? 'Pieza extraída de la operación' : 'Pieza quitada de la operación');
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
    this.viewMode = mode === 'wire' ? 'wire' : 'solid';
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

  /** Proyección del panel activo. */
  setProjection(mode) { this.active.setProjection(mode); }
  toggleProjection() { this.active.toggleProjection(); }

  /** Vistas rápidas del panel activo: front (alzado), back, right/left (perfiles), top (planta), bottom, persp. */
  setView(name) {
    if (name === 'focus') return this.frame();
    this.active.setView(name);
  }

  /** Compatibilidad con versiones anteriores. */
  cameraPreset(name) { this.setView(name); }

  _frameSphere() {
    const box = new THREE.Box3();
    const sel = this.selection.map(id => this.objects.get(id)).filter(m => m?.visible);
    const list = sel.length ? sel : [...this.objects.values()].filter(m => m.visible);
    for (const m of list) box.expandByObject(m, true);
    if (box.isEmpty()) box.set(new THREE.Vector3(-1, 0, -1), new THREE.Vector3(1, 1, 1));
    return box.getBoundingSphere(new THREE.Sphere());
  }

  /** Encuadra la selección (o toda la escena) en el panel activo, o en todos con `all`. */
  frame(all = false) {
    const sphere = this._frameSphere();
    for (const v of all ? this.views : [this.active]) v.frameSphere(sphere);
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
    if (ud.mesh) out.mesh = ud.mesh;
    if (ud.sculpt) out.sculpt = ud.sculpt;
    return out;
  }

  serialize() {
    return [...this.root.children].filter(m => m.userData.id).map(m => this._serializeMesh(m));
  }

  getCamera() { return this.views[0].getState(); }

  /** Estado de los paneles para guardarlo en el proyecto. */
  getViewState() {
    return {
      workspace: this.workspace,
      layout: this.layout, views: this.views.map(v => v.getState()), active: this.views.indexOf(this.active),
      cad: { layout: this.cadLayout, views: this.cadPanels.map(p => p.getState()), active: this.cadPanels.indexOf(this.cadActive) },
    };
  }

  /** Carga una lista de objetos y el estado de cámara(s). */
  load(objects, camera, viewState) {
    this.clear();
    const skipped = [];
    for (const d of objects || []) {
      if (!['boolean', 'mesh', 'sculpt'].includes(d.type) && !PRIMITIVES[d.type]) { skipped.push(d.type); continue; }
      const data = { ...d, id: d.id || uid(), name: d.name || typeLabel(d) };
      this._insert(data);
    }
    // reiniciar paneles con el estado guardado
    while (this.views.length > 1) this.setLayout(1);
    let states = viewState?.views?.length ? viewState.views : camera ? [camera] : [];
    let layout = viewState?.layout || 1, active = viewState?.active ?? 0;
    let cad = viewState?.cad, ws = viewState?.workspace;
    // proyectos de la versión anterior: paneles 2D mezclados con los 3D
    if (layout === '2d3d' || states.some(st => st?.mode === '2d')) {
      const s2 = states.filter(st => st?.mode === '2d'), s3 = states.filter(st => st?.mode !== '2d');
      ws ??= states[active]?.mode === '2d' ? '2d' : '3d';
      cad ??= { layout: Math.max(1, s2.length), views: s2.map(st => st.cad) };
      states = s3;
      layout = Math.max(1, Math.min(4, s3.length));
      active = 0;
    }
    this.views[0].setState(states[0] || { position: [5, 4, 6], target: [0, 0, 0], projection: 'persp', view: 'persp' });
    this.setLayout(layout, states);
    this.active = null;
    this.setActiveView(this.views[active] || this.views[0]);
    while (this.cadPanels.length > 1) this.setCadLayout(1);
    this.cadPanels[0].cadView.fitted = false;
    this.setCadLayout(cad?.layout || 1, cad?.views);
    this.cadActive = null;
    this.setCadActive(this.cadPanels[cad?.active ?? 0] || this.cadPanels[0]);
    this.setWorkspace(ws || '3d', true);
    this.dispatchEvent(new CustomEvent('objects'));
    return skipped;
  }

  // ------------------------------------------------------------ historial
  _snapshot() {
    this._meshRefs ??= new Map();
    return JSON.stringify(this.serialize(), (k, v) => {
      if (k === 'mesh' && v && v.positions) {
        const ref = `${v.vertices}:${v.positions.length}:${v.positions.slice(0, 40)}:${v.positions.slice(-40)}`;
        this._meshRefs.set(ref, v);
        return { $ref: ref };
      }
      if (k === 'sculpt' && v && v.kind) {
        const ref = `s:${v.rev || (v.rle || '').slice(0, 60)}`;
        this._meshRefs.set(ref, v);
        return { $ref: ref };
      }
      return v;
    });
  }

  _unsnapshot(str) {
    return JSON.parse(str, (k, v) => ((k === 'mesh' || k === 'sculpt') && v && v.$ref ? this._meshRefs.get(v.$ref) : v));
  }

  resetHistory() {
    this.history = [this._snapshot()];
    this.historyIndex = 0;
    this._emitHistory();
  }

  _commit() {
    const snap = this._snapshot();
    if (snap !== this.history[this.historyIndex]) {
      this.history.length = this.historyIndex + 1;
      this.history.push(snap);
      if (this.history.length > 100) this.history.shift();
      this.historyIndex = this.history.length - 1;
      this._gcRefs();
      this._emitHistory();
    }
    this.dispatchEvent(new CustomEvent('objects'));
    this.dispatchEvent(new CustomEvent('change'));
  }

  /** Libera mallas/esculturas que ya no están en el historial y limita su memoria (~250 MB). */
  _gcRefs() {
    if (!this._meshRefs?.size) return;
    const collect = () => {
      const live = new Set();
      for (const h of this.history) for (const m of h.matchAll(/"\$ref":"([^"]+)"/g)) live.add(m[1]);
      for (const k of this._meshRefs.keys()) if (!live.has(k)) this._meshRefs.delete(k);
    };
    collect();
    const size = v => (v.positions?.length || 0) + (v.index?.length || 0) + (v.normals?.length || 0) + (v.rle?.length || 0) +
      (v.mesh ? size(v.mesh) : 0);
    let total = 0;
    for (const v of this._meshRefs.values()) total += size(v);
    while (total > 250e6 && this.history.length > 3 && this.historyIndex > 1) {
      this.history.shift();
      this.historyIndex--;
      collect();
      total = 0;
      for (const v of this._meshRefs.values()) total += size(v);
    }
  }

  // ----------------------------------------------------------- escultura
  /** Convierte un objeto en escultura ('mesh' = deformar, 'voxel' = tallar). */
  convertToSculpt(id, method, level = 'mid') {
    const mesh = this.objects.get(id);
    if (!mesh) return false;
    if (this.sculpt) this.endSculpt();
    const { sculpt, geometry } = createSculpt(mesh.geometry, method, level);
    const ud = mesh.userData;
    ud.type = 'sculpt';
    ud.params = { method, level };
    ud.sculpt = sculpt;
    delete ud.shape; delete ud.operands; delete ud.mesh;
    const old = mesh.geometry;
    mesh.geometry = geometry;
    old.dispose();
    mesh.material.side = method === 'mesh' ? THREE.DoubleSide : THREE.FrontSide;
    mesh.material.needsUpdate = true;
    this._commit();
    return true;
  }

  startSculpt(id) {
    const mesh = this.objects.get(id);
    if (!mesh || mesh.userData.type !== 'sculpt') return false;
    if (this.sculpt) this.endSculpt();
    this.setSelection([id]);
    mesh.visible = true;
    this.sculpt = new SculptSession(this, mesh, this._sculptPrefs);
    this.gizmo.detach();
    this._updateSelectionBoxes();
    this.dispatchEvent(new CustomEvent('sculpt', { detail: { active: true, method: this.sculpt.method } }));
    return true;
  }

  endSculpt() {
    if (!this.sculpt) return;
    const id = this.sculpt.mesh.userData.id;
    this._sculptPrefs = this.sculpt.prefs();
    this.sculpt.dispose();
    this.sculpt = null;
    this.setSelection(this.objects.has(id) ? [id] : []);
    this.dispatchEvent(new CustomEvent('sculpt', { detail: { active: false } }));
    this.dispatchEvent(new CustomEvent('objects'));
  }

  _restore(i) {
    // si se está esculpiendo, la sesión se reabre sobre el objeto restaurado
    const sculptId = this.sculpt?.mesh.userData.id;
    if (this.sculpt) {
      this._sculptPrefs = this.sculpt.prefs();
      this.sculpt.dispose();
      this.sculpt = null;
    }
    const sel = [...this.selection];
    this.historyIndex = i;
    const objects = this._unsnapshot(this.history[i]);
    const sub = this.subSel;
    this.clear();
    for (const d of objects) this._insert(d);
    this.setSelection(sel);
    if (sub && this._operandAt(sub.rootId, sub.path)) this.selectOperand(sub.rootId, sub.path);
    const sm = sculptId && this.objects.get(sculptId);
    if (sm && sm.userData.type === 'sculpt') {
      this.sculpt = new SculptSession(this, sm, this._sculptPrefs);
      this.gizmo.detach();
      this._updateSelectionBoxes();
    } else if (sculptId) {
      this.dispatchEvent(new CustomEvent('sculpt', { detail: { active: false } }));
    }
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
      const n = g.index ? g.index.count : Math.min(g.attributes.position.count, g.drawRange.count);
      tris += n / 3;
      verts += Math.min(g.attributes.position.count, g.drawRange.count);
    }
    return { objects: this.objects.size, tris: Math.round(tris), verts };
  }

  /** Oculta ayudas (rejilla, gizmo, cajas) mientras se ejecuta `fn`. */
  _withCleanScene(fn, { grid = false } = {}) {
    const boxes = [...this.selectionBoxes.values()];
    const hidden = [this.gizmoHelper, ...boxes];
    if (this.sculpt) hidden.push(this.sculpt.cursor);
    if (!grid) hidden.push(this.helpers);
    const prev = hidden.map(o => o.visible);
    hidden.forEach(o => (o.visible = false));
    try { return fn(); } finally { hidden.forEach((o, i) => (o.visible = prev[i])); }
  }

  /** Miniatura JPEG: el plano si se trabaja en 2D (o no hay escena), si no el primer panel 3D. */
  thumbnail(w = 320, h = 200) {
    if (!this.cad.isEmpty() && (this.workspace === '2d' || !this.objects.size)) {
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      this.cad.render(fitView(this.cad, w, h), c.getContext('2d'), w, h, { print: true, grid: false });
      return c.toDataURL('image/jpeg', 0.72);
    }
    if (!this.objects.size) return null;
    const v = this.views[0];
    const rc = v.rect();
    return this._withCleanScene(() => {
      this.renderViews({ only: v, noNav: true });
      const src = this.renderer.domElement;
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      const ctx = c.getContext('2d');
      const scale = Math.max(w / src.width, h / src.height);
      const sw = w / scale, sh = h / scale;
      ctx.drawImage(src, (src.width - sw) / 2, (src.height - sh) / 2, sw, sh, 0, 0, w, h);
      v.setAspect(rc.w / rc.h);
      return c.toDataURL('image/jpeg', 0.72);
    });
  }

  /**
   * Captura las vistas tal como se ven en pantalla.
   * opts: { scale, grid, labels, background: 'theme'|'white'|'transparent' }
   * Devuelve un <canvas> 2D.
   */
  capture({ scale = 1, grid = true, labels = true, background = 'theme' } = {}) {
    if (this.workspace === '2d') return this._capture2D({ scale, grid, labels, background });
    const r = this.renderer;
    const W = this.container.clientWidth, H = this.container.clientHeight;
    const basePR = r.getPixelRatio();
    // limitar a ~40 megapíxeles
    const maxScale = Math.sqrt(40e6 / (W * H)) / basePR;
    const pr = basePR * Math.max(0.25, Math.min(scale, maxScale));
    const prevBg = this.scene.background;
    if (background === 'white') this.scene.background = new THREE.Color(0xffffff);
    if (background === 'transparent') this.scene.background = null;
    r.setPixelRatio(pr);
    r.setSize(W, H, false);
    let out;
    try {
      out = this._withCleanScene(() => {
        this.renderViews({
          noNav: true,
          sepColor: background === 'white' ? new THREE.Color(0xdddddd) : undefined,
          sepAlpha: background === 'transparent' ? 0 : 1,
        });
        if (background === 'transparent') {
          // en modo transparente, cada panel limpia con alfa 0
        }
        const src = r.domElement;
        const c = document.createElement('canvas');
        c.width = src.width; c.height = src.height;
        const ctx = c.getContext('2d');
        ctx.drawImage(src, 0, 0);
        if (labels && this.views.length > 1) this._drawLabels(ctx, this.views, c.width / W, background);
        return c;
      }, { grid });
    } finally {
      this.scene.background = prevBg;
      r.setPixelRatio(basePR);
      r.setSize(W, H, false);
      this.renderViews();
    }
    return out;
  }

  /** Captura de los paneles del plano 2D tal como se ven. */
  _capture2D({ scale, grid, labels, background }) {
    const W = this.container.clientWidth, H = this.container.clientHeight;
    const k = Math.max(0.25, Math.min(scale * Math.min(window.devicePixelRatio || 1, 2), Math.sqrt(40e6 / (W * H))));
    const c = document.createElement('canvas');
    c.width = Math.round(W * k); c.height = Math.round(H * k);
    const ctx = c.getContext('2d');
    if (background !== 'transparent') { ctx.fillStyle = background === 'white' ? '#dddddd' : (cssVar('--line') || '#2e333a'); ctx.fillRect(0, 0, c.width, c.height); }
    for (const p of this.cadPanels) {
      const rc = p.rect();
      ctx.save();
      ctx.scale(k, k);
      ctx.translate(rc.x, rc.y);
      ctx.beginPath(); ctx.rect(0, 0, rc.w, rc.h); ctx.clip();
      this.cad.render(p.cadView, ctx, rc.w, rc.h, { print: true, grid, background });
      ctx.restore();
    }
    if (labels && this.cadPanels.length > 1) this._drawLabels(ctx, this.cadPanels, k, background);
    return c;
  }

  _drawLabels(ctx, panels, k, background) {
    const light = background === 'white' || this.theme === 'light';
    ctx.font = `${Math.round(12 * k)}px system-ui, sans-serif`;
    ctx.textBaseline = 'top';
    for (const v of panels) {
      const rc = v.rect();
      const text = v.labelText();
      const x = (rc.x + 10) * k, y = (rc.y + 8) * k;
      const tw = ctx.measureText(text).width;
      ctx.fillStyle = light ? 'rgba(255,255,255,.85)' : 'rgba(20,22,26,.75)';
      ctx.fillRect(x - 5 * k, y - 3 * k, tw + 10 * k, 20 * k);
      ctx.fillStyle = light ? '#1d1f23' : '#e6e8eb';
      ctx.fillText(text, x, y + 1 * k);
    }
  }
}
