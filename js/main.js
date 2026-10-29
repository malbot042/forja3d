// Punto de entrada: navegación entre pantallas, gestor de proyectos y paneles del editor.
import { Editor } from './editor.js';
import { PRIMITIVES, TOOLBAR_ORDER, PALETTE } from './primitives.js';
import * as store from './storage.js';

const $ = sel => document.querySelector(sel);
const h = (tag, attrs = {}, ...children) => {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (v === true) el.setAttribute(k, '');
    else if (v !== false && v != null) el.setAttribute(k, v);
  }
  for (const c of children.flat()) if (c != null) el.append(c);
  return el;
};

let editor = null;      // instancia única del editor (se crea al abrir el primer proyecto)
let project = null;     // proyecto abierto
let saveTimer = null;

// ===================================================================== toast
function toast(msg, error = false) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.toggle('error', error);
  t.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.remove('show'), 2400);
}

// ===================================================================== router
function route() {
  const m = location.hash.match(/^#\/p\/([\w-]+)/);
  if (m) openProject(m[1]);
  else showProjects();
}

// ======================================================= pantalla de proyectos
const fmtDate = ts => new Date(ts).toLocaleString('es-ES', { dateStyle: 'medium', timeStyle: 'short' });
const CUBE_SVG = '<svg viewBox="0 0 24 24"><path d="M12 3 20 7.5v9L12 21l-8-4.5v-9z"/><path d="M4 7.5 12 12l8-4.5M12 12v9"/></svg>';

function showProjects() {
  flushSave();
  project = null;
  $('#editor-screen').hidden = true;
  $('#projects-screen').hidden = false;
  document.title = 'Forja 3D · Proyectos';
  renderProjectList();
}

function renderProjectList() {
  const grid = $('#projects-grid');
  const list = store.listProjects();
  grid.replaceChildren();
  if (!list.length) {
    grid.append(h('div', { class: 'empty-projects' },
      h('strong', {}, 'Aún no hay proyectos'),
      'Crea uno nuevo o importa un archivo .json exportado previamente.'));
  }
  for (const p of list) {
    const thumb = h('button', { class: 'project-thumb', title: 'Abrir', onclick: () => (location.hash = `#/p/${p.id}`) });
    if (p.thumb) thumb.style.backgroundImage = `url(${p.thumb})`;
    else thumb.innerHTML = CUBE_SVG;
    grid.append(h('article', { class: 'project-card' },
      thumb,
      h('div', { class: 'project-meta' },
        h('h3', { title: p.name }, p.name),
        h('p', {}, `${p.count ?? 0} objeto${p.count === 1 ? '' : 's'} · ${fmtDate(p.updated)}`)),
      h('div', { class: 'project-tools' },
        h('button', { onclick: () => (location.hash = `#/p/${p.id}`) }, 'Abrir'),
        h('button', { onclick: () => {
          const name = prompt('Nuevo nombre del proyecto', p.name);
          if (name?.trim()) { store.renameProject(p.id, name.trim()); renderProjectList(); }
        } }, 'Renombrar'),
        h('button', { onclick: () => { store.duplicateProject(p.id); renderProjectList(); toast('Proyecto duplicado'); } }, 'Duplicar'),
        h('button', { onclick: () => exportProject(store.loadProject(p.id)) }, 'JSON'),
        h('button', { class: 'del', onclick: () => {
          if (confirm(`¿Eliminar «${p.name}»? Esta acción no se puede deshacer.`)) {
            store.deleteProject(p.id); renderProjectList(); toast('Proyecto eliminado');
          }
        } }, 'Eliminar'))));
  }
  const kb = store.storageUsage() / 1024;
  $('#storage-info').textContent =
    `${list.length} proyecto${list.length === 1 ? '' : 's'} · ${kb < 1024 ? kb.toFixed(0) + ' KB' : (kb / 1024).toFixed(2) + ' MB'} usados en el almacenamiento local (límite habitual ≈ 5 MB). ` +
    'Descarga copias en JSON de los proyectos importantes.';
}

function exportProject(p) {
  if (!p) return;
  store.downloadJSON(p, `${store.slug(p.name)}.forja3d.json`);
  toast('JSON descargado');
}

$('#btn-new-project').onclick = () => {
  const name = prompt('Nombre del nuevo proyecto', 'Proyecto sin título');
  if (name === null) return;
  const p = store.createProject(name.trim() || 'Proyecto sin título');
  location.hash = `#/p/${p.id}`;
};

$('#btn-export-all').onclick = () => {
  const projects = store.listProjects().map(p => store.loadProject(p.id)).filter(Boolean);
  if (!projects.length) return toast('No hay proyectos que exportar', true);
  store.downloadJSON({ format: 'forja3d-bundle', version: 1, exported: new Date().toISOString(), projects },
    `forja3d-todos-${new Date().toISOString().slice(0, 10)}.json`);
  toast(`${projects.length} proyectos exportados`);
};

$('#btn-import-project').onclick = () => $('#file-input').click();
$('#file-input').onchange = async e => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    const items = data.format === 'forja3d-bundle' ? data.projects : [data];
    let last = null;
    for (const item of items) last = store.importProjectData(item);
    toast(`${items.length} proyecto${items.length === 1 ? '' : 's'} importado${items.length === 1 ? '' : 's'}`);
    if (items.length === 1 && last) location.hash = `#/p/${last.id}`;
    else renderProjectList();
  } catch (err) {
    toast(`No se pudo importar: ${err.message}`, true);
  }
};

// ============================================================== editor: abrir
function openProject(id) {
  const p = store.loadProject(id);
  if (!p) {
    toast('Proyecto no encontrado', true);
    location.hash = '';
    return;
  }
  flushSave();
  project = p;
  $('#projects-screen').hidden = true;
  $('#editor-screen').hidden = false;
  if (!editor) initEditor();

  const skipped = editor.load(p.objects, p.camera);
  if (skipped.length) toast(`Se ignoraron tipos desconocidos: ${[...new Set(skipped)].join(', ')}`, true);
  editor.select(null);
  editor.resetHistory();

  const s = p.settings || {};
  setView(s.view || 'solid');
  $('#chk-grid').checked = s.grid !== false;
  editor.setGrid(s.grid !== false);
  $('#chk-snap').checked = !!s.snap;
  editor.setSnap(!!s.snap);

  $('#project-name').value = p.name;
  document.title = `${p.name} · Forja 3D`;
  setSaveState(false);
  $('#hint').hidden = p.objects.length > 0;
  refreshOutliner();
  refreshStatus();
  requestAnimationFrame(() => editor._resize());
}

// ============================================================ editor: guardado
function snapshotProject() {
  project.objects = editor.serialize();
  project.camera = editor.getCamera();
  project.settings = { view: editor.viewMode, grid: $('#chk-grid').checked, snap: $('#chk-snap').checked };
}

function scheduleSave() {
  if (!project) return;
  setSaveState(true);
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNow, 600);
}

function saveNow() {
  clearTimeout(saveTimer);
  saveTimer = null;
  if (!project || !editor) return;
  snapshotProject();
  const ok = store.saveProject(project, editor.thumbnail());
  if (ok) setSaveState(false);
  else { setSaveState(true, 'Sin espacio'); toast('No hay espacio en el almacenamiento local. Descarga el JSON.', true); }
}

function flushSave() { if (saveTimer) saveNow(); }

function setSaveState(dirty, label) {
  const el = $('#save-state');
  el.textContent = label || (dirty ? 'Guardando…' : 'Guardado');
  el.classList.toggle('dirty', dirty);
}

window.addEventListener('beforeunload', flushSave);
document.addEventListener('visibilitychange', () => { if (document.hidden) flushSave(); });

// ============================================================ editor: interfaz
function initEditor() {
  editor = new Editor($('#viewport'));

  // barra de primitivas
  const bar = $('#primitives');
  for (const type of TOOLBAR_ORDER) {
    if (type === '|') { bar.append(h('div', { class: 'tool-sep' })); continue; }
    const def = PRIMITIVES[type];
    const btn = h('button', { class: 'tool-btn', title: `Añadir ${def.label.toLowerCase()}`, onclick: () => {
      editor.addPrimitive(type);
      $('#hint').hidden = true;
    } });
    btn.innerHTML = `<svg viewBox="0 0 24 24">${def.icon}</svg>`;
    btn.append(def.label);
    bar.append(btn);
  }

  editor.addEventListener('change', () => { scheduleSave(); refreshStatus(); });
  editor.addEventListener('objects', () => { refreshOutliner(); refreshStatus(); });
  editor.addEventListener('select', () => { refreshOutliner(); renderProps(); refreshStatus(); });
  editor.addEventListener('transform', () => syncTransformFields());
  editor.addEventListener('history', e => {
    $('#btn-undo').disabled = !e.detail.canUndo;
    $('#btn-redo').disabled = !e.detail.canRedo;
  });
  editor.orbit.addEventListener('end', scheduleSave);

  // barra superior
  $('#btn-back').onclick = () => (location.hash = '');
  $('#btn-undo').onclick = () => editor.undo();
  $('#btn-redo').onclick = () => editor.redo();
  $('#btn-export').onclick = () => { snapshotProject(); saveNow(); exportProject(project); };
  $('#btn-duplicate').onclick = () => editor.duplicate();
  $('#btn-delete').onclick = () => editor.remove();
  $('#project-name').addEventListener('change', e => {
    project.name = e.target.value.trim() || 'Proyecto sin título';
    e.target.value = project.name;
    document.title = `${project.name} · Forja 3D`;
    scheduleSave();
  });
  $('#project-name').addEventListener('keydown', e => { if (e.key === 'Enter') e.target.blur(); });

  $('#transform-mode').onclick = e => { const b = e.target.closest('button'); if (b) setTransform(b.dataset.mode); };
  $('#view-mode').onclick = e => { const b = e.target.closest('button'); if (b) { setView(b.dataset.view); scheduleSave(); } };
  $('#chk-snap').onchange = e => { editor.setSnap(e.target.checked); scheduleSave(); refreshStatus(); };
  $('#chk-grid').onchange = e => { editor.setGrid(e.target.checked); scheduleSave(); };
  document.querySelector('.view-presets').onclick = e => {
    const b = e.target.closest('button'); if (b) editor.cameraPreset(b.dataset.cam);
  };

  document.addEventListener('keydown', onKey);
}

function setTransform(mode) {
  editor.setTransformMode(mode);
  for (const b of document.querySelectorAll('#transform-mode button')) b.classList.toggle('active', b.dataset.mode === mode);
}

const VIEW_LABEL = { solid: 'Sólido', wire: 'Alámbrico', both: 'Mixto' };
function setView(mode) {
  editor.setViewMode(mode);
  for (const b of document.querySelectorAll('#view-mode button')) b.classList.toggle('active', b.dataset.view === mode);
  refreshStatus();
}

function onKey(e) {
  if ($('#editor-screen').hidden) return;
  const typing = e.target.closest('input, textarea, select');
  const mod = e.ctrlKey || e.metaKey;
  if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); saveNow(); toast('Guardado'); return; }
  if (typing) return;
  const k = e.key.toLowerCase();
  if (mod && k === 'z' && !e.shiftKey) { e.preventDefault(); editor.undo(); }
  else if (mod && (k === 'y' || (k === 'z' && e.shiftKey))) { e.preventDefault(); editor.redo(); }
  else if (mod && k === 'd') { e.preventDefault(); editor.duplicate(); }
  else if (mod) return;
  else if (k === 'w') setTransform('translate');
  else if (k === 'e') setTransform('rotate');
  else if (k === 'r') setTransform('scale');
  else if (k === '1') setView('solid');
  else if (k === '2') setView('wire');
  else if (k === '3') setView('both');
  else if (k === 'f') editor.frame();
  else if (k === 'g') { const c = $('#chk-snap'); c.checked = !c.checked; c.dispatchEvent(new Event('change')); }
  else if (k === 'delete' || k === 'backspace') { e.preventDefault(); editor.remove(); }
  else if (k === 'escape') editor.select(null);
}

// ---------------------------------------------------------------- outliner
const EYE = '<svg viewBox="0 0 24 24"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>';
const EYE_OFF = '<svg viewBox="0 0 24 24"><path d="M3 3l18 18M10.6 5.1A10 10 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-3.2 4M6.6 6.6C3.8 8.4 2 12 2 12s3.6 7 10 7a9.6 9.6 0 0 0 5.4-1.6"/></svg>';

function refreshOutliner() {
  if (!editor) return;
  const ul = $('#outliner');
  const items = editor.serialize();
  $('#obj-count').textContent = items.length;
  ul.replaceChildren();
  if (!items.length) ul.append(h('li', { class: 'empty-row' }, 'Escena vacía'));
  for (const o of items) {
    const vis = h('button', { class: 'vis', title: o.visible ? 'Ocultar' : 'Mostrar', onclick: e => {
      e.stopPropagation();
      editor.update(o.id, { visible: !o.visible });
    } });
    vis.innerHTML = o.visible ? EYE : EYE_OFF;
    const sw = h('span', { class: 'swatch' });
    sw.style.background = o.material.color;
    ul.append(h('li', {
      class: [o.id === editor.selectedId && 'selected', !o.visible && 'hidden-obj'].filter(Boolean).join(' '),
      onclick: () => editor.select(o.id),
      ondblclick: () => { editor.select(o.id); editor.frame(); },
    }, sw, h('span', { class: 'name' }, o.name), h('span', { class: 'type' }, PRIMITIVES[o.type].label), vis));
  }
  const hasSel = !!editor.selectedId;
  $('#btn-duplicate').disabled = !hasSel;
  $('#btn-delete').disabled = !hasSel;
  ul.querySelector('.selected')?.scrollIntoView({ block: 'nearest' });
}

// --------------------------------------------------------------- statusbar
function refreshStatus() {
  if (!editor) return;
  const s = editor.stats();
  const sel = editor.getSelected();
  $('#statusbar').innerHTML =
    `<span>Objetos <b>${s.objects}</b></span><span>Triángulos <b>${s.tris.toLocaleString('es-ES')}</b></span>` +
    `<span>Vértices <b>${s.verts.toLocaleString('es-ES')}</b></span>` +
    `<span>Vista <b>${VIEW_LABEL[editor.viewMode]}</b></span><span>Snap <b>${editor.snap ? 'sí' : 'no'}</b></span>` +
    (sel ? `<span>Selección <b>${escapeHTML(sel.name)}</b></span>` : '');
}
const escapeHTML = s => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// -------------------------------------------------------------- propiedades
// Campo numérico con "scrub": arrastrar la etiqueta cambia el valor.
function numberField({ label, cls = '', value, step = 0.1, min = -Infinity, max = Infinity, int = false, onInput, onCommit }) {
  const clamp = v => { v = Math.min(max, Math.max(min, v)); return int ? Math.round(v) : v; };
  const fmt = v => (int ? String(v) : String(+v.toFixed(4)));
  const input = h('input', { type: 'number', step, value: fmt(value) });
  if (min > -Infinity) input.min = min;
  if (max < Infinity) input.max = max;
  const tag = h('span', { class: cls }, label);
  input.addEventListener('input', () => { const v = parseFloat(input.value); if (Number.isFinite(v)) onInput(clamp(v)); });
  input.addEventListener('change', () => {
    let v = parseFloat(input.value);
    v = Number.isFinite(v) ? clamp(v) : value;
    input.value = fmt(v);
    onCommit(v);
  });
  input.addEventListener('keydown', e => { if (e.key === 'Enter') input.blur(); });
  tag.addEventListener('pointerdown', e => {
    e.preventDefault();
    tag.setPointerCapture(e.pointerId);
    const startX = e.clientX, start = parseFloat(input.value) || 0;
    const move = ev => {
      const mult = ev.shiftKey ? 0.1 : 1;
      const v = clamp(start + Math.round((ev.clientX - startX) / 4) * step * mult);
      input.value = fmt(v);
      onInput(v);
    };
    const up = () => {
      tag.removeEventListener('pointermove', move);
      tag.removeEventListener('pointerup', up);
      onCommit(clamp(parseFloat(input.value)));
    };
    tag.addEventListener('pointermove', move);
    tag.addEventListener('pointerup', up);
  });
  const wrap = h('div', { class: 'num' }, tag, input);
  wrap.set = v => { if (document.activeElement !== input) input.value = fmt(v); };
  return wrap;
}

const row = (label, ...control) => h('div', { class: 'prop-row' }, h('label', {}, label), ...control);
let vecFields = {};

function vec3Row(label, key, values, step) {
  const fields = ['x', 'y', 'z'].map((axis, i) => numberField({
    label: axis.toUpperCase(), cls: axis, value: values[i], step,
    onInput: v => applyVec(key, i, v, false),
    onCommit: v => applyVec(key, i, v, true),
  }));
  vecFields[key] = fields;
  return row(label, h('div', { class: 'vec3' }, fields));
}

function applyVec(key, i, v, commit) {
  const sel = editor.getSelected();
  if (!sel) return;
  const arr = [...sel[key]];
  arr[i] = v;
  editor.update(sel.id, { [key]: arr }, commit);
}

function syncTransformFields() {
  const sel = editor.getSelected();
  if (!sel) return;
  for (const key of ['position', 'rotation', 'scale']) vecFields[key]?.forEach((f, i) => f.set(sel[key][i]));
}

function rangeRow(label, value, onInput, onCommit) {
  const out = h('output', {}, value.toFixed(2));
  const r = h('input', { type: 'range', min: 0, max: 1, step: 0.01, value });
  r.addEventListener('input', () => { out.textContent = (+r.value).toFixed(2); onInput(+r.value); });
  r.addEventListener('change', () => onCommit(+r.value));
  return row(label, h('div', { class: 'range-row' }, r, out));
}

function renderProps() {
  const box = $('#props');
  vecFields = {};
  const sel = editor.getSelected();
  if (!sel) {
    box.replaceChildren(h('p', { class: 'empty' }, 'Nada seleccionado. Haz clic en un objeto del visor o de la lista.'));
    return;
  }
  const def = PRIMITIVES[sel.type];
  const id = sel.id;
  const upd = (patch, commit) => editor.update(id, patch, commit);

  // objeto
  const name = h('input', { class: 'text-input', value: sel.name, spellcheck: 'false' });
  name.addEventListener('change', () => upd({ name: name.value.trim() || def.label }, true));
  name.addEventListener('keydown', e => { if (e.key === 'Enter') name.blur(); });

  // geometría
  const geo = def.params.map(p => row(p.label, numberField({
    label: '↔', value: sel.params[p.key] ?? p.def, step: p.step, min: p.min, max: p.max, int: p.int,
    onInput: v => upd({ params: { [p.key]: v } }, false),
    onCommit: v => upd({ params: { [p.key]: v } }, true),
  })));

  // material
  const m = sel.material;
  const color = h('input', { type: 'color', value: m.color });
  const code = h('code', {}, m.color);
  color.addEventListener('input', () => { code.textContent = color.value; upd({ material: { color: color.value } }, false); });
  color.addEventListener('change', () => upd({ material: { color: color.value } }, true));
  const palette = h('div', { class: 'palette' }, PALETTE.map(c => {
    const b = h('button', { title: c, onclick: () => { color.value = c; code.textContent = c; upd({ material: { color: c } }, true); } });
    b.style.background = c;
    return b;
  }));
  const flat = h('input', { type: 'checkbox' });
  flat.checked = !!m.flatShading;
  flat.onchange = () => upd({ material: { flatShading: flat.checked } }, true);

  box.replaceChildren(
    h('div', { class: 'prop-section' },
      h('h3', {}, 'Objeto'),
      row('Nombre', name),
      row('Tipo', h('span', {}, def.label))),
    h('div', { class: 'prop-section' },
      h('h3', {}, 'Transformación'),
      vec3Row('Posición', 'position', sel.position, 0.05),
      vec3Row('Rotación °', 'rotation', sel.rotation, 1),
      vec3Row('Escala', 'scale', sel.scale, 0.05)),
    h('div', { class: 'prop-section' }, h('h3', {}, 'Geometría'), geo),
    h('div', { class: 'prop-section' },
      h('h3', {}, 'Material'),
      row('Color', h('div', { class: 'color-input' }, color, code)),
      h('div', { class: 'prop-row' }, h('span'), palette),
      rangeRow('Metalizado', m.metalness, v => upd({ material: { metalness: v } }, false), v => upd({ material: { metalness: v } }, true)),
      rangeRow('Rugosidad', m.roughness, v => upd({ material: { roughness: v } }, false), v => upd({ material: { roughness: v } }, true)),
      rangeRow('Opacidad', m.opacity, v => upd({ material: { opacity: v } }, false), v => upd({ material: { opacity: v } }, true)),
      row('Facetado', h('label', { class: 'toggle' }, flat, h('span', {}, 'Sombreado plano')))),
  );
}

// ================================================================== arranque
window.addEventListener('hashchange', route);
route();
