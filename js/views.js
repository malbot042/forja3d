// Vista 3D independiente (una por panel cuando la pantalla se divide):
// cámara perspectiva/ortográfica propia, órbita propia, navegador de ejes y etiqueta.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { cssVar } from './theme.js';

const DEG = THREE.MathUtils.DEG2RAD;
const round = (v, d = 3) => Math.round(v * 10 ** d) / 10 ** d;

// Vistas predefinidas: dirección desde el objetivo hacia la cámara
export const VIEWS = {
  front:  { label: 'Alzado', dir: [0, 0, 1] },
  back:   { label: 'Posterior', dir: [0, 0, -1] },
  right:  { label: 'Perfil dcho.', dir: [1, 0, 0] },
  left:   { label: 'Perfil izq.', dir: [-1, 0, 0] },
  top:    { label: 'Planta', dir: [0, 1, 0.0001] },
  bottom: { label: 'Inferior', dir: [0, -1, 0.0001] },
  persp:  { label: 'Perspectiva', dir: [1, 0.8, 1.2] },
  free:   { label: 'Libre' },
};

// Composición de paneles y vista inicial de cada uno
export const LAYOUTS = {
  1: { label: '1 vista', views: ['persp'] },
  2: { label: '2 vistas', views: ['persp', 'front'] },
  3: { label: '3 vistas', views: ['persp', 'front', 'top'] },
  4: { label: '4 vistas', views: ['persp', 'top', 'front', 'right'] },
};

const NAV_AXES = [
  { v: [1, 0, 0], color: '#e5614f', label: 'X', view: 'right' },
  { v: [0, 1, 0], color: '#6fbf73', label: 'Y', view: 'top' },
  { v: [0, 0, 1], color: '#5b9bea', label: 'Z', view: 'front' },
  { v: [-1, 0, 0], color: '#e5614f', view: 'left' },
  { v: [0, -1, 0], color: '#6fbf73', view: 'bottom' },
  { v: [0, 0, -1], color: '#5b9bea', view: 'back' },
];

export class View {
  constructor(editor, index) {
    this.editor = editor;
    this.index = index;
    this.el = document.createElement('div');
    this.el.className = 'vp';
    this.el.tabIndex = -1;
    this.label = document.createElement('div');
    this.label.className = 'vp-label';
    this.nav = document.createElement('canvas');
    this.nav.className = 'nav-gizmo';
    this.nav.title = 'Clic en un eje para ver desde él';
    this.el.append(this.nav, this.label);

    this.persp = new THREE.PerspectiveCamera(50, 1, 0.01, 4000);
    this.persp.position.set(5, 4, 6);
    this.ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, -2000, 4000);
    this.camera = this.persp;
    this.projection = 'persp';
    this.currentView = 'persp';
    this.aspect = 1;

    this.orbit = new OrbitControls(this.persp, this.el);
    this.orbit.enableDamping = true;
    this.orbit.dampingFactor = 0.12;
    this.orbit.screenSpacePanning = true;
    let q0 = null;
    this.orbit.addEventListener('start', () => { q0 = this.camera.quaternion.clone(); });
    this.orbit.addEventListener('end', () => {
      if (q0 && !q0.equals(this.camera.quaternion) && this.currentView !== 'free') {
        this.currentView = 'free';
        this.updateLabel();
        this.editor._emitCamera(this);
      }
      this.editor.dispatchEvent(new CustomEvent('cameraend'));
    });

    // selección por clic y activación del panel
    let down = null;
    this.el.addEventListener('pointerdown', e => {
      down = { x: e.clientX, y: e.clientY };
      this.editor.setActiveView(this);
    });
    this.el.addEventListener('pointerup', e => {
      if (!down || e.button !== 0) return;
      const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
      down = null;
      if (moved <= 4) this.editor._pick(this, e);
    });
    this.el.addEventListener('pointerenter', () => this.editor._hoverView(this));

    // navegador de ejes
    this._hits = [];
    this._hover = null;
    const hitAt = e => {
      const r = this.nav.getBoundingClientRect();
      const x = e.clientX - r.left, y = e.clientY - r.top;
      return this._hits.find(p => Math.hypot(p.x - x, p.y - y) < p.r + 2);
    };
    this.nav.addEventListener('pointerdown', e => { e.stopPropagation(); this.editor.setActiveView(this); });
    this.nav.addEventListener('pointerup', e => e.stopPropagation());
    this.nav.addEventListener('pointermove', e => {
      const h = hitAt(e);
      this._hover = h?.view || null;
      this.nav.style.cursor = h ? 'pointer' : 'default';
    });
    this.nav.addEventListener('pointerleave', () => { this._hover = null; });
    this.nav.addEventListener('click', e => {
      const h = hitAt(e);
      if (h) { this.setView(h.view); this.editor.dispatchEvent(new CustomEvent('cameraend')); }
    });
    this.updateLabel();
  }

  get target() { return this.orbit.target; }

  /** Rectángulo del panel relativo al contenedor del visor. */
  rect() {
    return { x: this.el.offsetLeft, y: this.el.offsetTop, w: this.el.offsetWidth, h: this.el.offsetHeight };
  }

  setAspect(aspect) {
    if (!aspect || Math.abs(aspect - this.aspect) < 1e-4) return;
    this.aspect = aspect;
    this.persp.aspect = aspect;
    this.persp.updateProjectionMatrix();
    this.updateOrtho();
  }

  updateOrtho(halfH = this.ortho.top) {
    const a = this.aspect || 1;
    Object.assign(this.ortho, { top: halfH, bottom: -halfH, left: -halfH * a, right: halfH * a });
    this.ortho.updateProjectionMatrix();
  }

  _setCamera(cam) {
    this.camera = cam;
    this.orbit.object = cam;
    this.editor._cameraChanged(this);
  }

  /** Cambia entre perspectiva y ortográfica conservando el encuadre. */
  setProjection(mode) {
    if (mode === this.projection) return;
    const t = this.target;
    const tanHalf = Math.tan((this.persp.fov * DEG) / 2);
    if (mode === 'ortho') {
      const dist = this.camera.position.distanceTo(t);
      this.ortho.position.copy(this.camera.position);
      this.ortho.quaternion.copy(this.camera.quaternion);
      this.ortho.zoom = 1;
      this.updateOrtho(Math.max(dist * tanHalf, 0.05));
      this._setCamera(this.ortho);
    } else {
      const halfH = this.ortho.top / this.ortho.zoom;
      const dir = this.ortho.position.clone().sub(t).normalize();
      this.persp.position.copy(t).add(dir.multiplyScalar(halfH / tanHalf));
      this.persp.quaternion.copy(this.ortho.quaternion);
      this._setCamera(this.persp);
    }
    this.projection = mode;
    this.camera.lookAt(t);
    this.orbit.update();
    this.updateLabel();
    this.editor._emitCamera(this);
  }

  toggleProjection() { this.setProjection(this.projection === 'persp' ? 'ortho' : 'persp'); }

  setView(name) {
    const v = VIEWS[name];
    if (!v?.dir) return;
    this.setProjection(name === 'persp' ? 'persp' : 'ortho');
    const t = this.target;
    const dist = Math.max(this.camera.position.distanceTo(t), 2);
    this.camera.position.copy(t).add(new THREE.Vector3(...v.dir).normalize().multiplyScalar(dist));
    this.camera.lookAt(t);
    this.currentView = name;
    this.orbit.update();
    this.updateLabel();
    this.editor._emitCamera(this);
  }

  /** Encuadra una esfera (centro + radio). */
  frameSphere(sphere) {
    const r = Math.max(sphere.radius, 0.3);
    const dir = this.camera.position.clone().sub(this.target).normalize();
    this.target.copy(sphere.center);
    if (this.projection === 'ortho') {
      this.ortho.zoom = this.ortho.top / (r * 1.2);
      this.ortho.updateProjectionMatrix();
      this.camera.position.copy(sphere.center).add(dir.multiplyScalar(Math.max(r * 4, 10)));
    } else {
      const dist = r / Math.sin((this.persp.fov * DEG) / 2) * 1.15;
      this.camera.position.copy(sphere.center).add(dir.multiplyScalar(dist));
    }
    this.camera.lookAt(this.target);
  }

  getState() {
    return {
      position: this.camera.position.toArray().map(v => round(v)),
      target: this.target.toArray().map(v => round(v)),
      projection: this.projection,
      zoom: round(this.ortho.zoom, 4),
      halfHeight: round(this.ortho.top, 4),
      view: this.currentView,
    };
  }

  setState(s) {
    if (!s?.position || !s?.target) return;
    if (this.projection !== 'persp') this.setProjection('persp');
    this.target.fromArray(s.target);
    if (s.projection === 'ortho') {
      this.ortho.position.fromArray(s.position);
      this.ortho.zoom = s.zoom || 1;
      this.updateOrtho(s.halfHeight || 5);
      this.ortho.lookAt(this.target);
      this.projection = 'ortho';
      this._setCamera(this.ortho);
    } else {
      this.persp.position.fromArray(s.position);
      this.persp.lookAt(this.target);
    }
    this.currentView = s.view || (s.projection === 'ortho' ? 'free' : 'persp');
    this.orbit.update();
    this.updateLabel();
  }

  labelText() {
    const name = (this.currentView === 'persp' && this.projection === 'ortho') ? 'Libre' : (VIEWS[this.currentView]?.label || 'Libre');
    if (this.projection === 'ortho') return `${name} · ortográfica`;
    return name === 'Perspectiva' ? name : `${name} · perspectiva`;
  }

  updateLabel() { this.label.textContent = this.labelText(); }

  drawNav(small) {
    const c = this.nav, S = small ? 72 : 96, R = small ? 24 : 32;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (c.width !== S * dpr) { c.width = c.height = S * dpr; c.style.width = c.style.height = `${S}px`; }
    const ctx = c.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, S, S);
    const ed = this.editor;
    ctx.fillStyle = ed._navBg ??= cssVar('--cv-nav-bg');
    ctx.beginPath(); ctx.arc(S / 2, S / 2, S / 2 - 1, 0, Math.PI * 2); ctx.fill();
    const q = this.camera.quaternion.clone().invert();
    const axes = NAV_AXES.map(a => {
      const p = new THREE.Vector3(...a.v).applyQuaternion(q);
      return { ...a, x: S / 2 + p.x * R, y: S / 2 - p.y * R, z: p.z };
    }).sort((a, b) => a.z - b.z);
    this._hits = [];
    for (const a of axes) {
      const pos = !!a.label, hover = this._hover === a.view;
      if (pos) {
        ctx.strokeStyle = a.color; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(S / 2, S / 2); ctx.lineTo(a.x, a.y); ctx.stroke();
      }
      const r = (pos ? 9 : 7) * (small ? 0.85 : 1);
      ctx.fillStyle = pos ? a.color : (ed._navNeg ??= cssVar('--cv-nav-neg'));
      ctx.strokeStyle = a.color; ctx.lineWidth = 1.5;
      ctx.globalAlpha = a.z < -0.2 ? 0.75 : 1;
      ctx.beginPath(); ctx.arc(a.x, a.y, hover ? r + 2 : r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.globalAlpha = 1;
      if (pos) {
        ctx.fillStyle = '#121417'; ctx.font = `bold ${small ? 9 : 10}px system-ui, sans-serif`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(a.label, a.x, a.y + 0.5);
      }
      this._hits.push({ x: a.x, y: a.y, r, view: a.view, z: a.z });
    }
    this._hits.sort((a, b) => b.z - a.z);
  }

  dispose() {
    this.orbit.dispose();
    this.el.remove();
  }
}
