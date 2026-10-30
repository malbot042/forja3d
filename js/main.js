// Punto de entrada: navegación entre pantallas, gestor de proyectos y paneles del editor.
import { Editor } from './editor.js';
import { PRIMITIVES, TOOLBAR_ORDER, PALETTE, BOOLEAN_OPS, typeLabel, conversionModes } from './primitives.js';
import { editShape } from './sketch.js';
import { openHelp, EXAMPLES, createExampleProject } from './help.js';
import * as store from './storage.js';
import { toggleTheme } from './theme.js';
import { EXPORT_FORMATS, IMPORT_EXTENSIONS, exportModel, loadModelFile } from './io.js';
import { makePdf } from './pdf.js';
import { SCULPT_METHODS, LEVEL_LABELS } from './sculpt.js';
import { blockDate, BLOCK_FIELDS, ISO_PLANES, isIsoCircle, PAPERS, PAPER_SCALES, sheetOf, toPDF, CAD_TOOLS, CAD_OPS, UNITS, LINETYPES, TYPE_LABELS, DIM_LABELS, OSNAP_LABELS, fmtNum, entityInfo, isRect, buildShapes, toDXF, toSVG } from './cad2d.js';

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
  const ms = typeof error === 'number' ? error : 2400;
  if (typeof error === 'number') error = false;
  t.textContent = msg;
  t.classList.toggle('error', error);
  t.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.remove('show'), ms);
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
  if (project && editor) { editor.endSculpt?.(); saveNow({ thumb: true }); }
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
      h('p', {}, 'Crea uno nuevo, importa un archivo .json o empieza por un ejemplo terminado:'),
      h('div', { class: 'example-chips' }, EXAMPLES.map(ex => h('button', { class: 'btn sm', title: ex.summary, onclick: () => {
        const p = createExampleProject(ex.key);
        if (p) location.hash = `#/p/${p.id}`;
      } }, ex.name))),
      h('p', {}, h('a', { href: '#', onclick: e => { e.preventDefault(); showHelp(); } }, 'Abrir la guía de uso'))));
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
          if (name?.trim()) store.renameProject(p.id, name.trim()).then(renderProjectList);
        } }, 'Renombrar'),
        h('button', { onclick: async () => { await store.duplicateProject(p.id); renderProjectList(); toast('Proyecto duplicado'); } }, 'Duplicar'),
        h('button', { onclick: async () => exportProject(await store.loadProject(p.id)) }, 'JSON'),
        h('button', { class: 'del', onclick: () => {
          if (confirm(`¿Eliminar «${p.name}»? Esta acción no se puede deshacer.`)) {
            store.deleteProject(p.id).then(renderProjectList); toast('Proyecto eliminado');
          }
        } }, 'Eliminar'))));
  }
  const info = $('#storage-info');
  info.textContent = `${list.length} proyecto${list.length === 1 ? '' : 's'}`;
  store.storageInfo().then(st => {
    const parts = [`${list.length} proyecto${list.length === 1 ? '' : 's'}`];
    if (st.usage || st.quota) parts.push(`${fmtBytes(st.usage)} usados de ${fmtBytes(st.quota)} disponibles para este sitio (${st.backend})`);
    parts.push(st.persisted ? 'almacenamiento persistente: el navegador no lo borrará por falta de espacio' : 'el navegador podría borrar los datos si se queda sin espacio');
    info.textContent = parts.join(' · ') + '. Descarga copias en JSON de los proyectos importantes.';
  });
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

function showHelp(section) {
  openHelp(section, { onExample: p => { flushSave(); location.hash = `#/p/${p.id}`; toast(`Ejemplo «${p.name.replace('Ejemplo · ', '')}» abierto como proyecto nuevo`); } });
}
$('#btn-help-home').onclick = () => showHelp();
for (const b of document.querySelectorAll('[data-theme-toggle]')) {
  b.addEventListener('click', () => {
    toast(toggleTheme() === 'light' ? 'Modo claro' : 'Modo oscuro');
    if (editor?.cad) { editor.cad.redraw(); if (is2D()) renderLayers(); }
  });
}
document.addEventListener('keydown', e => {
  if (document.querySelector('.modal-backdrop') || e.target.closest('input, textarea, select')) return;
  if (e.key === 'F1' || (e.key === '?' && !e.ctrlKey && !e.metaKey)) { e.preventDefault(); showHelp(); }
});

$('#btn-export-all').onclick = async () => {
  const projects = (await Promise.all(store.listProjects().map(p => store.loadProject(p.id)))).filter(Boolean);
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
  const ext = file.name.split('.').pop().toLowerCase();
  if (IMPORT_EXTENSIONS.includes(ext) || ext === 'dxf') {
    // modelo 3D o plano DXF: proyecto nuevo con el nombre del archivo y el contenido dentro
    const p = store.createProject(file.name.replace(/\.[^.]+$/, ''));
    pendingImport = [file];
    location.hash = `#/p/${p.id}`;
    return;
  }
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

// ============================================================== importar / exportar
let pendingImport = null;   // archivos a importar al abrir el siguiente proyecto

function fmtBytes(b) {
  if (b >= 1024 ** 3) return `${(b / 1024 ** 3).toFixed(1)} GB`;
  return b < 1024 * 1024 ? `${Math.round(b / 1024)} KB` : `${(b / 1024 / 1024).toFixed(1)} MB`;
}

/** Importa archivos (modelos o proyectos .json) en la escena abierta. */
async function importFiles(files) {
  // un .mtl que acompañe a un .obj aporta los colores
  const mtl = files.find(f => f.name.toLowerCase().endsWith('.mtl'));
  const mtlText = mtl ? await mtl.text() : null;
  files = files.filter(f => f !== mtl);
  if (!files.length && mtl) return toast('Un .mtl solo contiene colores: impórtalo junto con su .obj (selecciona los dos archivos).', true);
  for (const file of files) {
    const ext = file.name.split('.').pop().toLowerCase();
    try {
      if (ext === 'dxf') {
        const r = editor.cad.importDXF(await file.text());
        ensure2D();
        editor.cad.zoomExtents();
        const sk = Object.entries(r.skipped).map(([k, v]) => `${v} ${k}`).join(', ');
        toast(`«${file.name}»: ${r.count} objetos importados al plano 2D${sk ? ` · ignorados: ${sk}` : ''}`);
        continue;
      }
      if (ext === 'json') {
        const data = JSON.parse(await file.text());
        const objects = data.format === 'forja3d-bundle' ? data.projects.flatMap(p => p.objects || []) : data.objects;
        if (!Array.isArray(objects)) throw new Error('no es un proyecto de Forja 3D');
        const ids = editor.mergeObjects(objects);
        toast(`${ids.length} objetos añadidos desde «${file.name}»`);
      } else if (IMPORT_EXTENSIONS.includes(ext)) {
        toast(`Importando «${file.name}»…`);
        const parts = await loadModelFile(file, { mtlText: ext === 'obj' ? mtlText : null });
        const r = editor.importParts(parts, file.name);
        $('#hint').hidden = true;
        let msg = `«${file.name}» importado: ${r.ids.length} pieza${r.ids.length === 1 ? '' : 's'}`;
        if (r.scaled) msg += ` · escalado ×${+r.scale.toPrecision(3)} (medía ${+r.size.toPrecision(3)} unidades)`;
        toast(msg);
        if (r.bytes > 20 * 1024 * 1024) {
          setTimeout(() => toast(`Modelo grande (${fmtBytes(r.bytes)}): se guarda sin problema, pero conviene descargar una copia en JSON.`), 2600);
        }
        editor.frame();
      } else {
        throw new Error(`formato no soportado (.${ext})`);
      }
    } catch (err) {
      console.error(err);
      toast(`No se pudo importar «${file.name}»: ${err.message}`, true);
    }
  }
}

function exportDialog() {
  const nSel = editor.selection.filter(id => editor.objects.get(id)?.visible).length;
  const cadFormats = editor.cad.isEmpty() ? [] : [
    ['dxf', { label: 'Plano 2D · DXF', ext: 'dxf', desc: 'Para AutoCAD, LibreCAD, FreeCAD, QCAD, DraftSight o corte láser/CNC. Conserva capas, colores y tipos de línea; las cotas se exportan como líneas y texto.' }],
    ['svg', { label: 'Plano 2D · SVG', ext: 'svg', desc: 'Dibujo vectorial a escala real para Inkscape, Illustrator, la web o el corte láser.' }],
    ...(sheetOf(editor.cad.drawing) ? [['pdf', { label: `Hoja ${editor.cad.drawing.paper.size} · PDF a escala`, ext: 'pdf', desc: 'La hoja con su recuadro y cajetín, en PDF vectorial del tamaño del papel. Imprímela al 100 % para que las medidas sean exactas.' }]] : [])];
  const formats = [['json', { label: 'Proyecto Forja 3D', ext: 'json', desc: 'Todo el proyecto, editable: primitivas, perfiles, booleanas y el plano 2D. Para copias de seguridad o compartir con otro usuario de Forja 3D.' }],
    ...(is2D() ? [...cadFormats, ...Object.entries(EXPORT_FORMATS)] : [...Object.entries(EXPORT_FORMATS), ...cadFormats])];
  const wrap = h('div', { class: 'modal-backdrop' });
  const choices = formats.map(([key, f], i) => h('label', { class: 'format-card' },
    h('input', { type: 'radio', name: 'fmt', value: key, checked: i === 1 }),
    h('div', {}, h('b', {}, `${f.label} `, h('code', {}, `.${f.ext}`)), h('span', {}, f.desc))));
  const selOnly = h('input', { type: 'checkbox', disabled: !nSel });
  const mtl = h('input', { type: 'checkbox', checked: true });
  const mtlRow = h('label', { class: 'toggle' }, mtl, h('span', {}, 'Descargar también el .mtl con los colores'));
  const selRow = h('label', { class: 'toggle' }, selOnly, h('span', {}, nSel ? `Solo la selección (${nSel} objeto${nSel === 1 ? '' : 's'})` : 'Solo la selección (no hay nada seleccionado)'));
  const fmt = () => wrap.querySelector('input[name=fmt]:checked').value;
  const sync = () => { mtlRow.hidden = fmt() !== 'obj'; selRow.hidden = ['json', 'dxf', 'svg', 'pdf'].includes(fmt()); };
  const close = () => { document.removeEventListener('keydown', onKey, true); wrap.remove(); };
  const go = async () => {
    const f = fmt();
    close();
    if (f === 'json') { snapshotProject(); saveNow(); exportProject(project); return; }
    if (f === 'dxf' || f === 'svg' || f === 'pdf') { exportCad(f); return; }
    try {
      const n = await exportModel(editor, f, { name: project.name, selectionOnly: selOnly.checked, withMtl: mtl.checked });
      toast(`${EXPORT_FORMATS[f].label} exportado (${n} objeto${n === 1 ? '' : 's'})`);
    } catch (err) {
      console.error(err);
      toast(`No se pudo exportar: ${err.message}`, true);
    }
  };
  const onKey = e => {
    if (e.key === 'Escape') { e.stopPropagation(); close(); }
    else if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); go(); }
    else e.stopPropagation();
  };
  document.addEventListener('keydown', onKey, true);
  wrap.append(h('div', { class: 'modal export', role: 'dialog', 'aria-modal': 'true' },
    h('header', { class: 'modal-head' }, h('h2', {}, 'Exportar'),
      h('span', { class: 'muted' }, 'Elige el formato. Los objetos ocultos no se exportan.')),
    h('div', { class: 'export-body', onchange: sync }, choices,
      h('div', { class: 'export-opts' }, selRow, mtlRow),
      h('p', { class: 'note' }, h('b', {}, 'Blender: '), 'Archivo → Importar → glTF 2.0 (.glb/.gltf), Wavefront (.obj) o STL. ',
        'Para traer modelos de Blender, expórtalos como glTF 2.0 (.glb) y usa «Importar». El formato .blend no se puede generar desde el navegador.')),
    h('footer', { class: 'modal-foot' },
      h('button', { class: 'btn', onclick: close }, 'Cancelar'),
      h('button', { class: 'btn btn-primary', onclick: go }, 'Descargar'))));
  wrap.addEventListener('pointerdown', e => { if (e.target === wrap) close(); });
  document.body.append(wrap);
  sync();
}

// ============================================================== editor: abrir
async function openProject(id) {
  const p = await store.loadProject(id);
  if (location.hash !== `#/p/${id}`) return;   // el usuario ya ha navegado a otro sitio
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

  editor.cad.setDrawing(p.drawing);
  editor.cad.title = p.name;
  const skipped = editor.load(p.objects, p.camera, p.settings?.viewports);
  refreshLayoutButtons();
  if (skipped.length) toast(`Se ignoraron tipos desconocidos: ${[...new Set(skipped)].join(', ')}`, true);
  editor.select(null);
  editor.resetHistory();

  const s = p.settings || {};
  setView(s.view || 'solid');
  $('#chk-grid').checked = s.grid !== false;
  editor.setGrid(s.grid !== false);
  $('#chk-snap').checked = !!s.snap;
  editor.setSnapSizes(s.snapSizes);
  editor.setSnap(!!s.snap);
  refreshSnapSizeBtn();

  $('#project-name').value = p.name;
  document.title = `${p.name} · Forja 3D`;
  setSaveState(false);
  $('#hint').hidden = p.objects.length > 0;
  refreshOutliner();
  refreshStatus();
  requestAnimationFrame(() => editor._resize());
  applyMode();
  if (pendingImport) {
    const files = pendingImport;
    pendingImport = null;
    importFiles(files).then(() => { editor.resetHistory(); $('#hint').hidden = true; });
  }
}

// ============================================================ editor: guardado
function snapshotProject() {
  project.objects = editor.serialize();
  project.camera = editor.getCamera();
  project.settings = { view: editor.viewMode, grid: $('#chk-grid').checked, snap: $('#chk-snap').checked, snapSizes: editor.snapSizes, viewports: editor.getViewState() };
  project.drawing = editor.cad.getDrawing();
}

function scheduleSave() {
  if (!project) return;
  setSaveState(true);
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNow, 600);
}

let lastThumb = 0;
/** Guarda ya. La miniatura se regenera como mucho cada 20 s (o al salir del proyecto), porque leer el lienzo 3D es costoso. */
function saveNow({ thumb = false } = {}) {
  clearTimeout(saveTimer);
  saveTimer = null;
  if (!project || !editor) return;
  snapshotProject();
  const saving = project;
  const now = Date.now();
  let t;
  if (thumb || now - lastThumb > 20000) { t = editor.thumbnail(); lastThumb = now; }
  store.saveProject(project, t).then(ok => {
    if (saving !== project) return;
    if (ok) { if (!saveTimer) setSaveState(false); }
    else { setSaveState(true, 'Error al guardar'); toast('No se pudo guardar en el navegador (¿sin espacio?). Descarga el proyecto en JSON.', true); }
  });
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

  window.forja = { editor };   // acceso desde la consola del navegador (depuración)
  renderToolbar();
  initCadUI();

  editor.addEventListener('change', () => { scheduleSave(); refreshStatus(); });
  editor.addEventListener('objects', () => { refreshOutliner(); refreshStatus(); refreshOps(); });
  editor.addEventListener('select', () => { refreshOutliner(); renderProps(); refreshStatus(); refreshOps(); });
  editor.addEventListener('transform', () => syncTransformFields());
  editor.addEventListener('notice', e => toast(e.detail.msg, e.detail.error));
  editor.addEventListener('sculpt', e => { renderSculptBar(); renderProps(); refreshOps(); refreshStatus(); });
  editor.addEventListener('camera', e => refreshCamera(e.detail));
  editor.addEventListener('history', e => {
    if (is2D()) return;
    $('#btn-undo').disabled = !e.detail.canUndo;
    $('#btn-redo').disabled = !e.detail.canRedo;
  });
  editor.addEventListener('workspace', applyMode);
  editor.addEventListener('cameraend', scheduleSave);
  editor.addEventListener('layout', () => { refreshLayoutButtons(); scheduleSave(); });

  // barra superior
  $('#btn-back').onclick = () => (location.hash = '');
  $('#btn-help').onclick = () => showHelp();
  $('#btn-undo').onclick = () => (is2D() ? editor.cad.undo() : editor.undo());
  $('#btn-redo').onclick = () => (is2D() ? editor.cad.redo() : editor.redo());
  $('#btn-export').onclick = () => exportDialog();
  $('#btn-import').onclick = () => $('#model-input').click();
  $('#model-input').onchange = e => { const files = [...e.target.files]; e.target.value = ''; importFiles(files); };
  // arrastrar y soltar archivos sobre el editor
  const screen = $('#editor-screen');
  let dragDepth = 0;
  screen.addEventListener('dragenter', e => { if (e.dataTransfer?.types?.includes('Files')) { dragDepth++; $('#drop-hint').hidden = false; } });
  screen.addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; $('#drop-hint').hidden = true; } });
  screen.addEventListener('dragover', e => e.preventDefault());
  screen.addEventListener('drop', e => {
    e.preventDefault();
    dragDepth = 0;
    $('#drop-hint').hidden = true;
    const files = [...(e.dataTransfer?.files || [])];
    if (files.length) importFiles(files);
  });
  $('#btn-duplicate').onclick = () => editor.duplicate();
  $('#btn-delete').onclick = () => editor.remove();
  $('#project-name').addEventListener('change', e => {
    project.name = e.target.value.trim() || 'Proyecto sin título';
    editor.cad.title = project.name;
    editor.cad.redraw();
    e.target.value = project.name;
    document.title = `${project.name} · Forja 3D`;
    scheduleSave();
  });
  $('#project-name').addEventListener('keydown', e => { if (e.key === 'Enter') e.target.blur(); });

  $('#transform-mode').onclick = e => { const b = e.target.closest('button'); if (b) setTransform(b.dataset.mode); };
  $('#view-mode').onclick = e => { const b = e.target.closest('button'); if (b) { setView(b.dataset.view); scheduleSave(); } };
  $('#chk-snap').onchange = e => { editor.setSnap(e.target.checked); scheduleSave(); refreshStatus(); refreshSnapSizeBtn(); };
  $('#btn-snap-size').onclick = e => { e.stopPropagation(); snapSizePopover(); };
  $('#chk-grid').onchange = e => { editor.setGrid(e.target.checked); scheduleSave(); };

  // vistas y operaciones
  $('#view-bar').onclick = e => {
    const b = e.target.closest('button[data-cam]');
    if (!b) return;
    if (is2D()) { if (b.dataset.cam === 'focus') editor.cad.zoomExtents(editor.cadActive?.cadView); scheduleSave(); return; }
    editor.setView(b.dataset.cam);
    scheduleSave();
  };
  $('#btn-proj').onclick = () => { editor.toggleProjection(); scheduleSave(); };
  for (const b of document.querySelectorAll('button[data-layout]')) {
    b.addEventListener('click', () => {
      if (is2D()) editor.setCadLayout(+b.dataset.layout);
      else { editor.setLayout(+b.dataset.layout); editor.frame(true); }
    });
  }
  $('#btn-capture').onclick = () => captureDialog();
  $('#btn-pan').onclick = () => editor.setHand(!editor.hand);
  editor.addEventListener('hand', e => {
    $('#btn-pan').classList.toggle('active', e.detail);
    if (e.detail) toast(is2D() ? 'Mano: arrastra para desplazarte por la hoja · rueda: zoom · Esc o el botón Mano para salir' : 'Mano: arrastra para desplazar la vista · rueda: zoom · H o el botón Mano para salir');
  });
  $('#btn-side').onclick = () => toggleSidebar();
  $('#btn-tree-open').onclick = () => setTreeOpen(true);
  $('#btn-tree-close').onclick = () => setTreeOpen(false);
  initSidebarResize();
  $('#ops-bar').onclick = e => {
    const b = e.target.closest('button[data-op]');
    if (b) runOp(b.dataset.op);
  };

  document.addEventListener('keydown', onKey);
}

function runOp(op) {
  if (op === 'union' || op === 'subtract' || op === 'intersect') editor.booleanOp(op);
  else if (op === 'split') editor.split();
  else if (op === 'explode') editor.explode();
  else if (op === 'drop') editor.dropToFloor();
  else if (op === 'extrude2d') convert2DDialog('extrude');
  else if (op === 'lathe2d') convert2DDialog('lathe');
  else if (op === 'sculpt') sculptCommand();
}

/** Diálogo para extruir o revolucionar el elemento 2D seleccionado. */
function convert2DDialog(kind) {
  const sel = editor.getSelected();
  if (!sel || !['line2d', 'circle2d'].includes(sel.type) || editor.selection.length !== 1) {
    toast('Selecciona una sola Línea 2D o un Círculo 2D', true);
    return;
  }
  const modes = conversionModes(sel)[kind];
  const isExtrude = kind === 'extrude';
  const thick = sel.params.thickness ?? 0.03;
  const wrap = h('div', { class: 'modal-backdrop' });
  const field = (label, input, hint) => h('label', { class: 'field' }, h('span', {}, label), input, hint ? h('small', { class: 'muted' }, hint) : null);
  const num = (value, step, min, max) => h('input', { type: 'number', class: 'text-input', value, step, min, max });
  const modeSel = h('select', { class: 'select-input' }, modes.map(([v, l]) => h('option', { value: v }, l)));
  const depth = num(0.5, 0.05, 0.001, 100);
  const angle = num(360, 15, 1, 360);
  const segs = num(48, 1, 3, 256);
  const thickness = num(Math.max(thick, 0.01), 0.01, 0.001, 10);
  const keep = h('input', { type: 'checkbox' });
  const thickField = field('Grosor de pared', thickness, 'Por defecto, el grosor de la línea 2D.');
  const syncMode = () => { thickField.hidden = modeSel.value !== 'wall'; };
  modeSel.onchange = syncMode;
  syncMode();
  const close = () => { document.removeEventListener('keydown', onKey, true); wrap.remove(); };
  const apply = () => {
    const opts = {
      mode: modeSel.value, thickness: +thickness.value || thick, keep: keep.checked,
      depth: +depth.value || 0.5, angle: Math.min(360, Math.max(1, +angle.value || 360)), segments: Math.round(+segs.value || 48),
    };
    close();
    if (editor.convert2D(sel.id, kind, opts)) toast(`«${sel.name}» ${isExtrude ? 'extruido' : 'revolucionado'}. Puedes cambiar el perfil con «Editar perfil…»`);
  };
  const onKey = e => {
    if (e.key === 'Escape') { e.stopPropagation(); close(); }
    else if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); apply(); }
    else e.stopPropagation();
  };
  document.addEventListener('keydown', onKey, true);
  wrap.append(h('div', { class: 'modal convert', role: 'dialog', 'aria-modal': 'true' },
    h('header', { class: 'modal-head' },
      h('h2', {}, `${isExtrude ? 'Extruir' : 'Revolución de'} «${sel.name}»`),
      h('span', { class: 'muted' }, isExtrude
        ? 'Levanta el dibujo 2D en la dirección de su normal (hacia arriba si está en el suelo).'
        : 'Gira el trazado alrededor de su eje vertical (x = 0 en el editor de trazados), que pasa por el origen del elemento.')),
    h('div', { class: 'convert-body' },
      field('Forma', modeSel),
      isExtrude ? field('Altura', depth) : [field('Ángulo de giro (°)', angle), field('Segmentos', segs)],
      thickField,
      h('label', { class: 'toggle' }, keep, h('span', {}, 'Conservar el elemento 2D (quedará oculto)'))),
    h('footer', { class: 'modal-foot' },
      h('button', { class: 'btn', onclick: close }, 'Cancelar'),
      h('button', { class: 'btn btn-primary', onclick: apply }, isExtrude ? 'Extruir' : 'Crear revolución'))));
  wrap.addEventListener('pointerdown', e => { if (e.target === wrap) close(); });
  document.body.append(wrap);
  modeSel.focus();
}

// ============================================================== modo escultor
function sculptCommand() {
  const sel = editor.getSelected();
  if (!sel || editor.selection.length !== 1) return toast('Selecciona un objeto para esculpirlo', true);
  if (sel.type === 'sculpt') editor.startSculpt(sel.id);
  else sculptDialog();
}

/** Diálogo para convertir el objeto seleccionado en escultura (malla o volumen). */
function sculptDialog(preferred) {
  const sel = editor.getSelected();
  if (!sel) return;
  const flat = ['plane', 'ring', 'circle2d', 'line2d'].includes(sel.type);
  let method = preferred || (flat ? 'mesh' : 'voxel');
  let level = 'mid';
  const wrap = h('div', { class: 'modal-backdrop' });
  const cards = Object.entries(SCULPT_METHODS).map(([key, m]) => h('label', { class: 'format-card' },
    h('input', { type: 'radio', name: 'sm', value: key, checked: key === method, disabled: key === 'voxel' && flat }),
    h('div', {}, h('b', {}, m.label), h('span', {}, m.desc),
      h('span', { class: 'tool-list' }, Object.values(m.tools).map(t => t.label).join(' · ')),
      key === 'voxel' && flat ? h('span', { class: 'warn' }, 'No disponible: este objeto es plano (no tiene volumen).') : null)));
  const detail = h('div', { class: 'seg cap-seg' });
  const syncDetail = () => {
    const lv = SCULPT_METHODS[method].levels;
    detail.replaceChildren(...Object.keys(lv).map(k => h('button', { type: 'button', class: k === level ? 'active' : '', onclick: () => { level = k; syncDetail(); } },
      `${LEVEL_LABELS[k]} · ${method === 'voxel' ? `${lv[k]}³` : `~${Math.round(lv[k] / 1000)}k △`}`)));
  };
  syncDetail();
  const close = () => { document.removeEventListener('keydown', onKey2, true); wrap.remove(); };
  const go = () => {
    close();
    toast('Preparando la escultura…');
    setTimeout(() => {
      try {
        const t0 = performance.now();
        editor.convertToSculpt(sel.id, method, level);
        editor.startSculpt(sel.id);
        toast(`Listo (${Math.round(performance.now() - t0)} ms). Arrastra sobre el objeto para esculpir; fuera de él, la vista gira.`);
      } catch (err) {
        console.error(err);
        toast(err.message, true);
      }
    }, 30);
  };
  const onKey2 = e => {
    if (e.key === 'Escape') { e.stopPropagation(); close(); }
    else if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); go(); }
    else e.stopPropagation();
  };
  document.addEventListener('keydown', onKey2, true);
  wrap.append(h('div', { class: 'modal export', role: 'dialog', 'aria-modal': 'true' },
    h('header', { class: 'modal-head' }, h('h2', {}, `Esculpir «${sel.name}»`),
      h('span', { class: 'muted' }, 'El objeto se convierte en escultura (se puede deshacer con Ctrl+Z). Elige el método; puedes probar el otro más tarde.')),
    h('div', { class: 'export-body', onchange: e => { if (e.target.name === 'sm') { method = e.target.value; syncDetail(); } } },
      cards,
      h('div', { class: 'cap-row' }, h('span', { class: 'cap-label' }, 'Detalle'), detail),
      h('p', { class: 'note' }, 'Más detalle permite marcas más finas, pero cada trazo tarda más y el proyecto ocupa más. «Media» va bien en casi todos los equipos.')),
    h('footer', { class: 'modal-foot' },
      h('button', { class: 'btn', onclick: close }, 'Cancelar'),
      h('button', { class: 'btn btn-primary', onclick: go }, 'Convertir y esculpir'))));
  wrap.addEventListener('pointerdown', e => { if (e.target === wrap) close(); });
  document.body.append(wrap);
}

const TOOL_ICONS = {
  draw: '<path d="M4 18c3-6 6-9 8-9s3 4 8 4"/><path d="M4 20h16"/>',
  inflate: '<circle cx="12" cy="12" r="7"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>',
  smooth: '<path d="M3 14c3-3 5 2 9-1s6 1 9-1"/><path d="M3 18h18"/>',
  flatten: '<path d="M3 15h18"/><path d="M6 15l2-6h8l2 6"/>',
  pinch: '<path d="M5 6l7 6 7-6M5 18l7-6 7 6"/>',
  grab: '<path d="M8 13V6a1.5 1.5 0 0 1 3 0v6M11 11V4.5a1.5 1.5 0 0 1 3 0V11M14 11V6a1.5 1.5 0 0 1 3 0v8c0 4-2.5 6-6 6s-5-2-7-5l-1.5-3a1.5 1.5 0 0 1 2.6-1.4L8 13"/>',
  chisel: '<path d="M14 3l7 7-3 3-7-7z"/><path d="M11 6 4 13l-1 7 7-1 7-7"/>',
  gouge: '<path d="M4 20c4-1 6-6 8-10s5-6 8-6"/><path d="M6 21c4-1 7-6 9-10"/>',
  clay: '<path d="M5 17c0-5 3-9 7-9s7 4 7 9z"/><path d="M3 17h18"/>',
};

/** Barra de herramientas del modo escultor. */
function renderSculptBar() {
  const bar = $('#sculpt-bar');
  const ses = editor.sculpt;
  $('#ops-bar').hidden = !!ses || is2D();
  bar.hidden = !ses;
  $('#viewport').classList.toggle('is-sculpting', !!ses);
  if (!ses) { bar.replaceChildren(); return; }
  const M = SCULPT_METHODS[ses.method];
  const tools = Object.entries(M.tools).map(([key, t]) => {
    const b = h('button', { class: `sc-tool${ses.tool === key ? ' active' : ''}`, title: `${t.label} (${t.key}) · ${t.desc}`, onclick: () => { ses.tool = key; renderSculptBar(); } });
    b.innerHTML = `<svg viewBox="0 0 24 24">${TOOL_ICONS[key] || TOOL_ICONS.draw}</svg><span>${t.label}</span>`;
    return b;
  });
  const slider = (label, min, max, step, value, onInput, fmt) => {
    const out = h('output', {}, fmt(value));
    const r = h('input', { type: 'range', min, max, step, value });
    r.addEventListener('input', () => { onInput(+r.value); out.textContent = fmt(+r.value); });
    r.addEventListener('change', () => r.blur());
    return h('label', { class: 'sc-slider' }, h('span', {}, label), r, out);
  };
  const symBtn = ax => h('button', { class: `sc-sym${ses.sym[ax] ? ' active' : ''}`, title: `Simetría en ${ax.toUpperCase()}`, onclick: () => { ses.sym[ax] = !ses.sym[ax]; renderSculptBar(); } }, ax.toUpperCase());
  bar.replaceChildren(
    h('div', { class: 'sc-head' },
      h('b', {}, `Esculpir · ${M.label}`),
      h('button', { class: 'btn sm btn-primary', title: 'Terminar (Intro o Esc)', onclick: () => editor.endSculpt() }, 'Terminar')),
    h('div', { class: 'sc-tools' }, tools),
    slider('Tamaño', 0.02, 0.6, 0.01, ses.size, v => { ses.size = v; }, v => `${Math.round(v * 100)}%`),
    slider('Fuerza', 0.05, 1, 0.05, ses.strength, v => { ses.strength = v; }, v => `${Math.round(v * 100)}%`),
    h('div', { class: 'sc-row' }, h('span', {}, 'Simetría'), symBtn('x'), symBtn('y'), symBtn('z'),
      h('button', { class: 'btn sm', style: 'margin-left:auto', title: 'Suaviza todo el objeto un poco', onclick: () => ses.smoothAll() }, 'Suavizar todo')),
    h('p', { class: 'sc-hint' }, h('b', {}, 'Ctrl'), ' invierte · ', h('b', {}, '[ ]'), ' tamaño · ', h('b', {}, 'Mayús + [ ]'), ' fuerza · arrastra fuera del objeto para girar la vista'));
}

/** Atajos del modo escultor. Devuelve true si la tecla se ha usado. */
function sculptKey(e) {
  const ses = editor.sculpt;
  if (e.key === 'Escape' || e.key === 'Enter') { editor.endSculpt(); return true; }
  if (e.code === 'BracketLeft' || e.code === 'BracketRight') {
    const up = e.code === 'BracketRight';
    if (e.shiftKey) ses.strength = Math.min(1, Math.max(0.05, +(ses.strength + (up ? 0.05 : -0.05)).toFixed(2)));
    else ses.size = Math.min(0.6, Math.max(0.02, ses.size * (up ? 1.15 : 1 / 1.15)));
    renderSculptBar();
    return true;
  }
  const entry = Object.entries(SCULPT_METHODS[ses.method].tools).find(([, t]) => t.key.toLowerCase() === e.key.toLowerCase());
  if (entry) { ses.tool = entry[0]; renderSculptBar(); return true; }
  return ['w', 'e', 'r', 'delete', 'backspace'].includes(e.key.toLowerCase());
}

async function editProfile(id) {
  const sel = editor.objects.get(id);
  if (!sel) return;
  const ud = sel.userData;
  const def = PRIMITIVES[ud.type];
  const title = def.usesShape === 'path' ? `Trazado de «${ud.name}»` : `Perfil de «${ud.name}»`;
  const shape = await editShape(ud.shape, def.usesShape, title, { closedPath: !!ud.params.closed });
  if (shape) {
    editor.update(id, { shape: { ...ud.shape, ...shape } });
    if (def.usesShape === 'open' || ud.type === 'extrude') editor.dropToFloor([id]);
    renderProps();
  }
}

/** Activa/desactiva los botones de operación según la selección. */
function refreshOps() {
  if (!editor) return;
  const sel = editor.selection.map(id => editor.objects.get(id)).filter(Boolean);
  const types = sel.map(m => m.userData.type);
  const two = sel.length >= 2;
  const planes = types.filter(t => t === 'plane').length;
  const canSplit = (sel.length === 1 && types[0] !== 'plane') || (sel.length === 2 && planes === 1);
  const set = (op, on) => { const b = document.querySelector(`#ops-bar [data-op="${op}"]`); if (b) b.disabled = !on; };
  set('union', two); set('subtract', two); set('intersect', two);
  set('split', canSplit);
  set('explode', types.includes('boolean'));
  const is2D = sel.length === 1 && (types[0] === 'line2d' || types[0] === 'circle2d');
  set('extrude2d', is2D); set('lathe2d', is2D);
  set('sculpt', sel.length === 1 && !editor.sculpt);
  set('drop', sel.length > 0);
}

const VIEW_NAMES = { iso: 'Isométrica', front: 'Alzado', back: 'Posterior', right: 'Perfil dcho.', left: 'Perfil izq.', top: 'Planta', bottom: 'Inferior', persp: 'Perspectiva', free: 'Libre' };
function refreshCamera({ projection, view }) {
  for (const b of document.querySelectorAll('#view-bar [data-cam]')) b.classList.toggle('active', b.dataset.cam === view);
  const proj = $('#btn-proj');
  proj.classList.toggle('active', projection === 'ortho');
  proj.textContent = projection === 'ortho' ? 'Orto ✓' : 'Orto';
  const name = view === 'persp' && projection === 'ortho' ? 'Libre' : VIEW_NAMES[view] || 'Libre';
}

// ============================================================== editor 2D (CAD)
const is2D = () => editor?.workspace === '2d';
const SHORT = { select: 'Selecc.', pline: 'Polilín.', rect: 'Rectáng.', dimlin: 'Lineal', dimali: 'Alineada', dimrad: 'Radio', dimdia: 'Diám.', dimang: 'Ángulo' };

function renderToolbar() {
  const bar = $('#primitives');
  bar.replaceChildren();
  if (is2D()) {
    const cad = editor.cad;
    for (const [key, def] of Object.entries(CAD_TOOLS)) {
      if (!def) { bar.append(h('div', { class: 'tool-sep' })); continue; }
      const btn = h('button', {
        class: `tool-btn${cad.toolName === key ? ' active' : ''}`, 'data-cad': key,
        title: `${def.label}${def.alias[0] ? ` · escribe ${def.alias[0].toUpperCase()} e Intro` : ' (Esc)'}`,
        onclick: () => cad.setTool(key),
      });
      btn.innerHTML = `<svg viewBox="0 0 24 24">${def.icon}</svg>`;
      btn.append(SHORT[key] || def.label);
      bar.append(btn);
    }
    return;
  }
  for (const type of TOOLBAR_ORDER) {
    if (type === '|') { bar.append(h('div', { class: 'tool-sep' })); continue; }
    const def = PRIMITIVES[type];
    const btn = h('button', { class: 'tool-btn', title: `Añadir ${def.label.toLowerCase()}`, onclick: async () => {
      const id = editor.addPrimitive(type);
      $('#hint').hidden = true;
      if (def.usesShape) await editProfile(id);
    } });
    btn.innerHTML = `<svg viewBox="0 0 24 24">${def.icon}</svg>`;
    btn.append(def.label);
    bar.append(btn);
  }
}

function renderCadBar() {
  const cad = editor.cad;
  const mk = (key, def, onclick) => {
    const b = h('button', { 'data-cadop': key, class: cad.toolName === key ? 'active' : '', title: def.title || `${def.label} · escribe ${def.alias?.[0]?.toUpperCase() || ''} e Intro`, onclick });
    b.innerHTML = `<svg viewBox="0 0 24 24">${def.icon}</svg>`;
    b.append(def.label);
    return b;
  };
  $('#cad-bar').replaceChildren(
    ...Object.entries(CAD_OPS).map(([k, d]) => mk(k, d, () => cad.runOp(k))),
    h('span', { class: 'ops-sep' }),
    mk('extrude3d', { label: 'Extruir a 3D', title: 'Convierte los contornos cerrados (o la selección) en piezas 3D', icon: '<path d="M4 19h12l4-3.5H8z" class="fill"/><path d="M4 19h12l4-3.5H8zM12 13V4M9 7l3-3 3 3"/>' }, () => extrude2DDialog()));
}

function refreshCadTool() {
  const t = editor.cad.toolName;
  for (const b of document.querySelectorAll('#primitives [data-cad]')) b.classList.toggle('active', b.dataset.cad === t);
  for (const b of document.querySelectorAll('#cad-bar [data-cadop]')) b.classList.toggle('active', b.dataset.cadop === t);
}

const SNAP_PRESETS = [0.1, 0.25, 0.5, 1, 2, 2.5, 5, 10, 20, 25, 50, 100];
function refreshSnapSelect() {
  const D = editor.cad.drawing, cur = +D.snapStep || 0;
  const sel = $('#snap-step');
  const u = D.units === 'u' ? '' : ` ${D.units}`;
  const label = v => `${String(v).replace('.', ',')}${u}`;
  const vals = cur && !SNAP_PRESETS.includes(cur) ? [...SNAP_PRESETS, cur].sort((a, b) => a - b) : SNAP_PRESETS;
  sel.replaceChildren(h('option', { value: 'auto' }, 'Paso: auto'), ...vals.map(v => h('option', { value: String(v) }, `Paso: ${label(v)}`)), h('option', { value: 'other' }, 'Otro…'));
  sel.value = cur ? String(cur) : 'auto';
  sel.classList.toggle('on', !!cur);
}

const fmtN = v => String(+(+v).toFixed(4)).replace('.', ',');
function refreshSnapSizeBtn() {
  const s = editor.snapSizes, b = $('#btn-snap-size');
  b.textContent = `${fmtN(s.move)} · ${fmtN(s.rot)}° · ×${fmtN(s.scale)}`;
  b.classList.toggle('on', !!editor.snap);
}

/** Ventanita para elegir el paso del snap 3D (mover, girar, escalar). */
function snapSizePopover() {
  document.querySelector('.snap-pop')?.remove();
  const btn = $('#btn-snap-size'), r = btn.getBoundingClientRect();
  const s = editor.snapSizes;
  const pop = h('div', { class: 'snap-pop', role: 'dialog', 'aria-label': 'Tamaño del snap' });
  const field = (key, label, unit, presets) => {
    const inp = h('input', { type: 'number', class: 'text-input', min: 0, step: 'any' });
    inp.value = s[key];
    const apply = v => {
      if (!(+v > 0)) return;
      editor.setSnapSizes({ ...editor.snapSizes, [key]: +v });
      if (!editor.snap) { $('#chk-snap').checked = true; editor.setSnap(true); }
      inp.value = editor.snapSizes[key];
      refreshSnapSizeBtn(); refreshStatus(); scheduleSave();
    };
    inp.onchange = () => apply(String(inp.value).replace(',', '.'));
    inp.onkeydown = ev => { if (ev.key === 'Enter') inp.blur(); if (ev.key === 'Escape') pop.remove(); ev.stopPropagation(); };
    return h('div', { class: 'snap-pop-row' }, h('label', {}, label),
      h('div', { class: 'snap-pop-in' }, inp, h('span', { class: 'muted' }, unit)),
      h('div', { class: 'snap-pop-presets' }, presets.map(v => h('button', { class: 'btn sm', onclick: () => apply(v) }, fmtN(v)))));
  };
  pop.append(
    h('h4', {}, 'Tamaño del snap'),
    field('move', 'Mover', 'unidades', [0.05, 0.1, 0.25, 0.5, 1]),
    field('rot', 'Girar', 'grados', [5, 15, 30, 45, 90]),
    field('scale', 'Escalar', 'paso', [0.05, 0.1, 0.25, 0.5]),
    h('p', { class: 'muted small' }, 'Se aplica al mover, girar y escalar con el gizmo cuando el snap está activo (G). Se guarda con el proyecto.'));
  document.body.append(pop);
  pop.style.top = `${r.bottom + 6}px`;
  pop.style.left = `${Math.max(8, Math.min(window.innerWidth - pop.offsetWidth - 8, r.right - pop.offsetWidth))}px`;
  const close = ev => { if (!pop.contains(ev.target) && ev.target !== btn) { pop.remove(); document.removeEventListener('pointerdown', close, true); } };
  document.addEventListener('pointerdown', close, true);
  pop.querySelector('input').focus();
}

function refreshCadToggles() {
  const c = editor.cad;
  refreshSnapSelect();
  for (const b of document.querySelectorAll('[data-cadt]')) {
    const k = b.dataset.cadt;
    const v = editor.cadActive?.cadView;
    if (k === 'isoplane') {
      b.style.display = v?.iso ? '' : 'none';
      b.textContent = `Cara: ${ISO_PLANES[v?.isoPlane || 'top'].label}`;
      continue;
    }
    const on = k === 'grid' ? !!c.drawing.grid : k === 'pencil' ? c.drawing.curLt === 'pencil' : k === 'iso' ? !!v?.iso : !!c[k];
    b.classList.toggle(b.closest('#view-bar') ? 'active' : 'on', on);
  }
}

function refreshHistoryButtons() {
  const c = editor.cad;
  const [u, r] = is2D() ? [c.hi > 0, c.hi < c.hist.length - 1] : [editor.historyIndex > 0, editor.historyIndex < editor.history.length - 1];
  $('#btn-undo').disabled = !u;
  $('#btn-redo').disabled = !r;
}

/** Ajusta toda la interfaz al tipo (2D o 3D) del panel activo. */
function applyMode() {
  if (!editor) return;
  const two = is2D();
  if (two && editor.sculpt) editor.endSculpt();
  $('#editor-screen').classList.toggle('mode-2d', two);
  for (const b of document.querySelectorAll('#mode-seg button')) b.classList.toggle('active', b.dataset.m === (two ? '2d' : '3d'));
  $('#ops-bar').hidden = two || !!editor.sculpt;
  $('#cad-bar').hidden = !two;
  $('#status-3d').hidden = two;
  $('#status-2d').hidden = !two;
  $('#scene-panel').hidden = two;
  $('#layers-panel').hidden = !two;
  renderToolbar();
  if (two) { renderCadBar(); renderLayers(); refreshCadToggles(); editor.cad.emitPrompt(); }
  else {
    editor.cad.cancel(true);
    $('#cmd-input').value = '';
    if (document.activeElement === $('#cmd-input')) $('#cmd-input').blur();
  }
  renderProps();
  refreshStatus();
  refreshHistoryButtons();
  refreshLayoutButtons();
}

/** Pasa al espacio de trabajo 2D. */
function ensure2D() { editor.setWorkspace('2d'); }

function initCadUI() {
  const cad = editor.cad;
  cad.addEventListener('change', () => { scheduleSave(); if (is2D()) { renderLayers(); renderProps(); refreshCadToggles(); } });
  cad.addEventListener('select', () => { if (is2D()) renderProps(); });
  cad.addEventListener('tool', refreshCadTool);
  cad.addEventListener('prompt', e => { $('#cmd-prompt').textContent = e.detail; $('#cmd-prompt').title = e.detail; });
  cad.addEventListener('message', e => { const m = $('#cmd-msg'); m.textContent = e.detail; m.title = e.detail; });
  cad.addEventListener('cursor', e => {
    if (e.detail) $('#cmd-coords').textContent = `X ${fmtNum(e.detail[0], cad.drawing)}   Y ${fmtNum(e.detail[1], cad.drawing)}`;
  });
  cad.addEventListener('history', () => { if (is2D()) refreshHistoryButtons(); });
  cad.addEventListener('settings', () => { refreshCadToggles(); editor.cadPanels.forEach(p => p.updateLabel()); });
  editor.addEventListener('cadactive', () => { if (is2D()) refreshCadToggles(); });
  cad.addEventListener('handrequest', e => editor.setHand(e.detail ?? !editor.hand));
  cad.addEventListener('viewchange', scheduleSave);
  cad.addEventListener('editrequest', () => setTimeout(() => $('#props .cad-text')?.focus(), 40));
  cad.addEventListener('blockedit', () => {
    if ($('#editor-screen').classList.contains('side-hidden')) toggleSidebar(false);
    setTimeout(() => { const t = $('#props .block-title'); if (t) { t.scrollIntoView({ block: 'center', behavior: 'smooth' }); t.focus(); t.select(); } }, 60);
  });
  for (const b of document.querySelectorAll('[data-cadt]')) b.addEventListener('click', () => cad.toggle(b.dataset.cadt));
  $('#snap-step').addEventListener('change', e => {
    const v = e.target.value;
    if (v === 'other') {
      const u = cad.drawing.units === 'u' ? '' : ` (${cad.drawing.units})`;
      const r = prompt(`Paso del forzado${u}:`, String(cad.drawing.snapStep || 1).replace('.', ','));
      const n = r == null ? NaN : parseFloat(r.replace(',', '.'));
      if (n > 0) cad.setSnapStep(n); else refreshCadToggles();
    } else cad.setSnapStep(v === 'auto' ? 0 : +v);
  });
  cad.inputEl = $('#cmd-input');
  $('#cmd-input').addEventListener('input', () => cad.redraw());
  $('#mode-seg').addEventListener('click', e => {
    const b = e.target.closest('button[data-m]');
    if (!b) return;
    editor.setWorkspace(b.dataset.m);
    scheduleSave();
  });
  $('#btn-layer-add').onclick = () => {
    const n = prompt('Nombre de la nueva capa', `Capa ${cad.drawing.layers.length + 1}`);
    if (n) cad.addLayer(n);
  };
  $('#btn-cad-extrude').onclick = () => extrude2DDialog();
}

function renderLayers() {
  const cad = editor.cad, D = cad.drawing;
  const ul = $('#layers-list');
  ul.replaceChildren();
  $('#layer-count').textContent = D.layers.length;
  const autoColor = document.documentElement.dataset.theme === 'light' ? '#111111' : '#e6e8eb';
  for (const L of D.layers) {
    const radio = h('input', { type: 'radio', name: 'cur-layer', class: 'lay-radio', title: 'Capa actual: los objetos nuevos se dibujan en ella' });
    radio.checked = D.current === L.name;
    radio.onchange = () => cad.setCurrentLayer(L.name);
    const col = h('input', { type: 'color', title: L.color === 'auto' ? 'Color automático (blanco/negro según el fondo) · clic para elegir' : 'Color de la capa', value: L.color === 'auto' ? autoColor : L.color });
    col.onchange = () => cad.updateLayer(L.name, { color: col.value });
    const name = h('span', { class: 'lay-name', title: `${L.name} · doble clic para renombrar` }, L.name);
    name.ondblclick = () => { const n = prompt('Nombre de la capa', L.name); if (n && n.trim()) cad.updateLayer(L.name, { name: n.trim() }); };
    const lt = h('select', { title: 'Tipo de línea' }, Object.entries(LINETYPES).map(([k, v]) => {
      const o = h('option', { value: k }, v.label);
      if (k === L.lt) o.selected = true;
      return o;
    }));
    lt.onchange = () => cad.updateLayer(L.name, { lt: lt.value });
    const lw = h('button', { class: 'lay-btn', title: L.lw === 'thick' ? 'Línea gruesa (clic: fina)' : 'Línea fina (clic: gruesa)', onclick: () => cad.updateLayer(L.name, { lw: L.lw === 'thick' ? 'thin' : 'thick' }) });
    lw.innerHTML = `<svg viewBox="0 0 24 24"><path d="M4 12h16" stroke-width="${L.lw === 'thick' ? 4 : 1.5}"/></svg>`;
    const vis = h('button', { class: 'lay-btn', title: L.visible === false ? 'Mostrar la capa' : 'Ocultar la capa', onclick: () => cad.updateLayer(L.name, { visible: L.visible === false }) });
    vis.innerHTML = L.visible === false ? EYE_OFF : EYE;
    const del = h('button', { class: 'lay-btn', title: 'Eliminar la capa', onclick: () => {
      if (D.layers.length <= 1) { toast('Debe quedar al menos una capa', true); return; }
      const n = cad.layerCount(L.name);
      if (n && !confirm(`La capa «${L.name}» tiene ${n} objeto${n > 1 ? 's' : ''}. Se moverán a la capa actual. ¿Eliminarla?`)) return;
      cad.removeLayer(L.name);
    } });
    del.innerHTML = '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg>';
    ul.append(h('li', { class: [D.current === L.name && 'current', L.visible === false && 'hidden-layer'].filter(Boolean).join(' ') },
      radio, col, name, h('span', { class: 'lay-count', title: 'Objetos en la capa' }, cad.layerCount(L.name)), lt, lw, vis, del));
  }
}

const DEGR = 180 / Math.PI;

/** Propiedades en modo 2D: ajustes del plano, una entidad o varias. */
/** Sección «Hoja»: formato A5-A0, orientación, escala, recuadro y PDF a escala. */
function paperSection(cad, D, { select, btn, info }) {
  const P = D.paper, S = sheetOf(D);
  const sec = h('div', { class: 'prop-section' }, h('h3', {}, 'Hoja (papel)'),
    row('Formato', select([['', 'Sin hoja'], ...Object.entries(PAPERS).map(([k, [w, hh]]) => [k, `${k} · ${w} × ${hh} mm`])], P?.size || '',
      v => cad.setPaper(v ? { size: v } : null))));
  if (!S) {
    sec.append(h('p', { class: 'muted small cad-hint' }, 'Elige un formato para ver la hoja con su recuadro y cajetín, dibujar dentro de ella y sacar un PDF a escala real.'));
    return sec;
  }
  const flags = { frame: P.frame !== false, block: P.block ?? (P.frame !== false) };
  const toggle = (key, label) => {
    const c = h('input', { type: 'checkbox' });
    c.checked = flags[key];
    c.onchange = () => cad.setPaper({ ...flags, [key]: c.checked });
    return h('label', { class: 'toggle' }, c, h('span', {}, label));
  };
  const u = D.units === 'u' ? 'unidades' : D.units;
  const F = v => fmtNum(v, D);
  sec.append(
    row('Orientación', select([['h', 'Horizontal'], ['v', 'Vertical']], S.landscape ? 'h' : 'v', v => cad.setPaper({ landscape: v === 'h' }))),
    row('Escala', select(PAPER_SCALES.map(k => [k, k === '1:1' ? '1:1 (tamaño real)' : k]), S.scale, v => cad.setPaper({ scale: v }))),
    h('div', { class: 'paper-toggles' }, toggle('frame', 'Recuadro'), toggle('block', 'Cajetín')),
    info([['Área útil', `${F((S.w - 20) * S.k)} × ${F((S.h - 20) * S.k)} ${u} del dibujo`]]),
    h('div', { class: 'btn-row' },
      btn('Ver la hoja', () => cad.zoomExtents()),
      btn('Centrar en el dibujo', () => cad.centerPaper()),
      btn('PDF a escala', () => exportCad('pdf'), 'btn-primary')));
  if (flags.block) sec.append(blockFields(cad, D));
  return sec;
}

/** Campos del cajetín: título, descripción (texto libre), autor, empresa, nº de plano y fecha. */
function blockFields(cad, D) {
  const F = D.paper.fields || {};
  const set = (key, value) => {
    const fields = { ...(D.paper.fields || {}) };
    if (value.trim()) fields[key] = value.replace(/\s+$/, ''); else delete fields[key];
    cad.setPaper({ fields });
  };
  const ph = { title: project?.name || 'Sin título', description: 'Texto libre: qué es la pieza, material, acabado, notas… (Intro = nueva línea)' };
  const box = h('div', { class: 'block-fields' }, h('h4', {}, 'Cajetín'));
  for (const [key, label] of BLOCK_FIELDS) {
    if (key === 'date') {
      // selector de fecha; vacío = la fecha de hoy (se actualiza sola)
      const inp = h('input', { type: 'date', class: 'text-input block-date' });
      inp.value = /^\d{4}-\d{2}-\d{2}$/.test(F.date || '') ? F.date : '';
      inp.onchange = () => set('date', inp.value);
      const today = h('button', { class: `btn sm${F.date ? '' : ' active'}`, title: 'Usar siempre la fecha del día en que se imprime', onclick: () => set('date', '') }, 'Hoy');
      box.append(row(label, h('div', { class: 'date-row' }, inp, today)),
        h('p', { class: 'muted small cad-hint' }, F.date ? `En el cajetín: ${blockDate(F.date)}` : `Sin fecha elegida: se pone la de hoy (${blockDate('')}).`));
      continue;
    }
    const multi = key === 'description';
    const inp = h(multi ? 'textarea' : 'input', { class: `text-input block-${key}`, placeholder: ph[key] || '', spellcheck: multi ? 'true' : 'false', rows: multi ? 3 : null });
    inp.value = F[key] || '';
    inp.onchange = () => set(key, inp.value);
    if (!multi) inp.onkeydown = ev => { if (ev.key === 'Enter') inp.blur(); };
    box.append(multi ? h('label', { class: 'field block-desc' }, h('span', {}, label), inp) : row(label, inp));
  }
  box.append(h('p', { class: 'muted small cad-hint' }, 'La escala se rellena sola. Si dejas el título vacío se usa el nombre del proyecto; los demás campos vacíos se quedan en blanco. Doble clic en el cajetín del plano para editarlo.'));
  return box;
}

function renderCadProps(box) {
  const cad = editor.cad, D = cad.drawing;
  const ents = cad.selEnts();
  const F = v => fmtNum(v, D);
  const U = D.units === 'u' ? '' : ` ${D.units}`;
  const info = pairs => h('div', { class: 'info-grid' }, pairs.filter(Boolean).flatMap(([k, v]) => [h('span', {}, k), h('span', {}, v)]));
  const select = (options, value, onchange) => {
    const s = h('select', { class: 'select-input' }, options.map(([v, l]) => { const o = h('option', { value: v }, l); if (String(v) === String(value)) o.selected = true; return o; }));
    s.onchange = () => onchange(s.value);
    return s;
  };
  const num = (label, value, onCommit, o = {}) => row(label, numberField({
    label: '↔', value, step: o.step ?? 0.5, min: o.min ?? -1e9, max: o.max ?? 1e9,
    onInput: o.onInput || (() => {}), onCommit,
  }));
  const xy = (label, p, set) => row(label, h('div', { class: 'vec2' }, [0, 1].map(i => numberField({
    label: 'XY'[i], cls: 'xy'[i], value: p[i], step: 0.5,
    onInput: v => { const q = [...p]; q[i] = v; set(q, false); },
    onCommit: v => { const q = [...p]; q[i] = v; set(q, true); },
  }))));
  const layerSel = (value, onchange) => select(D.layers.map(l => [l.name, l.name]), value, onchange);
  const btn = (label, onclick, cls = '') => h('button', { class: `btn sm ${cls}`, onclick }, label);
  // '' = el de la capa; '-' = varios distintos (selección múltiple)
  const ltSel = (value, layerLt, onchange) => select([
    ...(value === '-' ? [['-', 'Varios']] : []),
    ['', `Por capa${layerLt ? ` (${LINETYPES[layerLt]?.label || layerLt})` : ''}`],
    ...Object.entries(LINETYPES).map(([k, v]) => [k, v.label])], value, v => { if (v !== '-') onchange(v); });

  if (!ents.length) {
    const osnaps = Object.entries(OSNAP_LABELS).map(([k, l]) => {
      const c = h('input', { type: 'checkbox' });
      c.checked = cad.osnap[k] !== false;
      c.onchange = () => { cad.osnap[k] = c.checked; cad.savePrefs(); };
      return h('label', { class: 'toggle' }, c, h('span', {}, l));
    });
    box.replaceChildren(
      h('div', { class: 'prop-section' },
        h('h3', {}, 'Plano 2D'),
        info([['Objetos', String(D.entities.length)], ['Capa actual', D.current]]),
        row('Unidades', select(Object.entries(UNITS).map(([k, u]) => [k, u.label]), D.units, v => cad.setSetting('units', v))),
        row('Decimales', select([0, 1, 2, 3, 4].map(n => [n, n]), D.precision, v => cad.setSetting('precision', +v))),
        row('Separador', select([[',', 'Coma (12,50)'], ['.', 'Punto (12.50)']], D.decimal, v => cad.setSetting('decimal', v))),
        num('Altura texto', D.textH, v => { if (v > 0) cad.setSetting('textH', v); }, { min: 0.01 }),
        num('Flechas', D.arrow, v => { if (v > 0) cad.setSetting('arrow', v); }, { min: 0.01, step: 0.25 }),
        (() => {
          const inp = h('input', { type: 'number', class: 'text-input', min: 0, step: 'any', placeholder: 'Automático (según el zoom)' });
          inp.value = D.snapStep || '';
          inp.onchange = () => cad.setSnapStep(parseFloat(String(inp.value).replace(',', '.')) || 0);
          inp.onkeydown = ev => { if (ev.key === 'Enter') inp.blur(); };
          return row('Paso forzado', inp);
        })()),
      paperSection(cad, D, { select, btn, info }),
      h('div', { class: 'prop-section' },
        h('h3', {}, 'Referencias a objetos'),
        h('div', { class: 'cap-checks-list' }, osnaps)),
      h('div', { class: 'prop-section' },
        h('h3', {}, 'Acciones'),
        h('div', { class: 'btn-row' },
          btn('Encuadrar todo', () => cad.zoomExtents()),
          btn('Extruir a 3D…', () => extrude2DDialog(), 'btn-primary')),
        h('div', { class: 'btn-row', style: 'margin-top:4px' },
          btn('Exportar DXF', () => exportCad('dxf')),
          btn('Exportar SVG', () => exportCad('svg')),
          btn('Importar DXF', () => $('#model-input').click()))),
      h('div', { class: 'prop-section' },
        h('h3', {}, 'Cómo dibujar'),
        (() => {
          const ul = h('ul', { class: 'kbd-list' });
          ul.innerHTML = [
            '<b>L</b> línea · <b>PL</b> polilínea · <b>REC</b> rectángulo · <b>C</b> círculo · <b>A</b> arco · <b>T</b> texto',
            '<b>DLI</b> cota · <b>DAL</b> alineada · <b>DRA</b>/<b>DDI</b> radio/diámetro · <b>DAN</b> ángulo · <b>DI</b> medir',
            '<b>M</b> desplazar · <b>CO</b> copiar · <b>RO</b> girar · <b>SC</b> escala · <b>MI</b> simetría · <b>O</b> desfase · <b>TR</b> recortar',
            'Coordenadas: <b>x,y</b> · <b>@dx,dy</b> · <b>dist&lt;ángulo</b> · o una distancia',
            '<b>Intro</b>, <b>Espacio</b> o clic derecho: terminar / repetir · <b>Esc</b>: cancelar',
            'Rueda: zoom · botón central o derecho: desplazar · doble clic central: encuadrar',
          ].map(t => `<li>${t}</li>`).join('');
          return ul;
        })()),
      h('div', { class: 'prop-section' },
        h('h3', {}, 'Seleccionar y editar'),
        (() => {
          const ul = h('ul', { class: 'kbd-list' });
          ul.innerHTML = [
            '<b>Clic</b> en un objeto: seleccionarlo · <b>Mayús+clic</b>: añadir o quitar · <b>Esc</b>: deseleccionar',
            'Arrastrar en vacío <b>→</b> (azul): solo lo que queda dentro · <b>←</b> (verde): todo lo que toca',
            'Seleccionado: arrastra un <b>pinzamiento ■</b> para estirar, cambiar el radio o mover un vértice; arrastra la línea para mover el objeto',
            'Valores exactos: edítalos aquí, en Propiedades (doble clic en el objeto)',
            '<b>Flechas</b>: desplazar (Mayús ×10) · <b>Ctrl+C / Ctrl+V</b>: copiar y pegar · <b>Ctrl+D</b>: duplicar · <b>Supr</b>: borrar',
          ].map(t => `<li>${t}</li>`).join('');
          return ul;
        })()),
    );
    return;
  }

  if (ents.length > 1) {
    const byType = {};
    let length = 0;
    for (const e of ents) {
      const k = e.type === 'dim' ? 'Cota' : TYPE_LABELS[e.type];
      byType[k] = (byType[k] || 0) + 1;
      length += entityInfo(e, D).length || 0;
    }
    box.replaceChildren(
      h('div', { class: 'prop-section' },
        h('h3', {}, `${ents.length} objetos seleccionados`),
        h('p', { class: 'muted small cad-hint' }, 'Arrastra cualquiera de ellos para mover el grupo · flechas: desplazar · Ctrl+D: duplicar · Supr: borrar · Esc: deseleccionar'),
        info([...Object.entries(byType).map(([k, n]) => [k, String(n)]), length ? ['Longitud total', `${F(length)}${U}`] : null]),
        row('Capa', layerSel(ents.every(e => e.layer === ents[0].layer) ? ents[0].layer : '', v => {
          for (const e of ents) e.layer = v;
          cad.commit();
        })),
        row('Tipo de línea', ltSel(ents.every(e => (e.lt || '') === (ents[0].lt || '')) ? ents[0].lt || '' : '-', null, v => {
          for (const e of ents) if (v) e.lt = v; else delete e.lt;
          cad.commit();
        }))),
      h('div', { class: 'prop-section' },
        h('h3', {}, 'Acciones'),
        h('div', { class: 'btn-row' },
          btn('Desplazar', () => cad.runOp('move')), btn('Copiar', () => cad.runOp('copy')), btn('Girar', () => cad.runOp('rotate'))),
        h('div', { class: 'btn-row', style: 'margin-top:4px' },
          btn('Extruir a 3D…', () => extrude2DDialog(), 'btn-primary'), btn('Borrar', () => cad.eraseSel(), 'danger'))),
    );
    return;
  }

  const e = ents[0], id = e.id;
  const upd = (patch, commit = true) => cad.updateEntity(id, patch, commit);
  const inf = entityInfo(e, D);
  const geo = [];
  switch (e.type) {
    case 'line': {
      const setLen = v => upd(x => { const dx = x.b[0] - x.a[0], dy = x.b[1] - x.a[1], L = Math.hypot(dx, dy) || 1; x.b = [x.a[0] + dx / L * v, x.a[1] + dy / L * v]; return x; });
      const setAng = v => upd(x => { const L = Math.hypot(x.b[0] - x.a[0], x.b[1] - x.a[1]); x.b = [x.a[0] + Math.cos(v / DEGR) * L, x.a[1] + Math.sin(v / DEGR) * L]; return x; });
      geo.push(xy('Inicio', e.a, (q, c) => upd({ a: q }, c)), xy('Fin', e.b, (q, c) => upd({ b: q }, c)),
        num('Longitud', inf.length, v => { if (v > 0) setLen(v); }, { min: 0 }),
        num('Ángulo °', inf.angle, setAng, { step: 1 }),
        info([['ΔX', F(inf.dx)], ['ΔY', F(inf.dy)]]));
      break;
    }
    case 'pline': {
      if (isRect(e)) {
        const xs = e.pts.map(p => p[0]), ys = e.pts.map(p => p[1]);
        const x0 = Math.min(...xs), y0 = Math.min(...ys), w = Math.max(...xs) - x0, hh = Math.max(...ys) - y0;
        const rect = (W, H, X = x0, Y = y0) => upd({ pts: [[X, Y], [X + W, Y], [X + W, Y + H], [X, Y + H]] });
        geo.push(xy('Esquina', [x0, y0], (q, c) => { if (c) rect(w, hh, q[0], q[1]); }),
          num('Ancho', w, v => { if (v > 0) rect(v, hh); }, { min: 0 }),
          num('Alto', hh, v => { if (v > 0) rect(w, v); }, { min: 0 }));
      } else {
        e.pts.slice(0, 24).forEach((p, i) => geo.push(xy(`Vértice ${i + 1}`, p, (q, c) => upd(x => { x.pts[i] = q; return x; }, c))));
        if (e.pts.length > 24) geo.push(h('p', { class: 'note' }, `… y ${e.pts.length - 24} vértices más (edítalos con los pinzamientos).`));
      }
      const chk = h('input', { type: 'checkbox' });
      chk.checked = !!e.closed;
      chk.onchange = () => upd({ closed: chk.checked });
      geo.push(row('Cerrada', h('label', { class: 'toggle' }, chk, h('span', {}, chk.checked ? 'Sí' : 'No'))),
        info([['Vértices', String(e.pts.length)], ['Longitud', `${F(inf.length)}${U}`], inf.area != null ? ['Área', `${F(inf.area)}${U ? `${U}²` : ''}`] : null]));
      break;
    }
    case 'circle':
      geo.push(xy('Centro', e.c, (q, c) => upd({ c: q }, c)),
        num('Radio', e.r, v => { if (v > 0) upd({ r: v }); }, { min: 0 }),
        num('Diámetro', 2 * e.r, v => { if (v > 0) upd({ r: v / 2 }); }, { min: 0 }),
        info([['Perímetro', `${F(inf.length)}${U}`], ['Área', `${F(inf.area)}${U ? `${U}²` : ''}`]]));
      break;
    case 'ellipse': {
      // círculo isométrico: se edita por su radio real (el de la circunferencia en la cara del cubo)
      const iso = isIsoCircle(e);
      const setR = r => upd(x => { const k = r / Math.hypot(...x.U), q = v => Math.round(v * k * 1e6) / 1e6; x.U = x.U.map(q); x.V = x.V.map(q); return x; });
      geo.push(xy('Centro', e.c, (q, c) => upd({ c: q }, c)));
      if (iso) {
        const plane = Object.entries(ISO_PLANES).find(([, P]) => {
          const ang = q => ((Math.round(Math.atan2(q[1], q[0]) * DEGR) % 180) + 180) % 180;
          const got = [ang(e.U), ang(e.V)].sort((a, b) => a - b).join(), want = P.axes.map(a => a % 180).sort((a, b) => a - b).join();
          return got === want;
        });
        geo.push(num('Radio', inf.r, v => { if (v > 0) setR(v); }, { min: 0 }),
          num('Diámetro', 2 * inf.r, v => { if (v > 0) setR(v / 2); }, { min: 0 }),
          info([['Cara', plane ? plane[1].label : 'girada'], ['Ejes de la elipse', `${F(2 * inf.r * Math.sqrt(1.5))} × ${F(2 * inf.r * Math.sqrt(0.5))}${U}`]]));
      }
      geo.push(info([['Perímetro', `${F(inf.length)}${U}`], ['Área', `${F(inf.area)}${U ? `${U}²` : ''}`]]));
      if (iso) geo.push(h('p', { class: 'note' }, 'Es un círculo dibujado en isométrica: una circunferencia de ese radio sobre una cara del cubo se ve como esta elipse.'));
      break;
    }
    case 'arc':
      geo.push(xy('Centro', e.c, (q, c) => upd({ c: q }, c)),
        num('Radio', e.r, v => { if (v > 0) upd({ r: v }); }, { min: 0 }),
        num('Inicio °', e.a0 * DEGR, v => upd({ a0: ((v / DEGR) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) }), { step: 1 }),
        num('Fin °', e.a1 * DEGR, v => upd({ a1: ((v / DEGR) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) }), { step: 1 }),
        info([['Longitud', `${F(inf.length)}${U}`], ['Ángulo incluido', `${fmtNum(inf.sweep, D, 2)}°`]]));
      break;
    case 'text': {
      const t = h('input', { class: 'text-input cad-text', value: e.text, spellcheck: 'false' });
      t.onchange = () => { if (t.value.trim()) upd({ text: t.value }); };
      t.onkeydown = ev => { if (ev.key === 'Enter') t.blur(); };
      geo.push(row('Texto', t), xy('Posición', e.p, (q, c) => upd({ p: q }, c)),
        num('Altura', e.h, v => { if (v > 0) upd({ h: v }); }, { min: 0.01 }),
        num('Rotación °', (e.rot || 0) * DEGR, v => upd({ rot: v / DEGR }), { step: 1 }));
      break;
    }
    case 'dim': {
      const t = h('input', { class: 'text-input cad-text', value: e.text || '', placeholder: '<> = la medida', spellcheck: 'false' });
      t.onchange = () => upd({ text: t.value.trim() || undefined });
      t.onkeydown = ev => { if (ev.key === 'Enter') t.blur(); };
      const val = e.kind === 'angle' ? `${fmtNum(inf.value, D, 2)}°` : `${F(inf.value)}${U}`;
      geo.push(info([['Medida', val]]), row('Texto', t),
        h('p', { class: 'note' }, 'Deja el texto vacío para mostrar la medida. Usa <> para añadir algo a la medida, p. ej. «2x <>» o «<> h7».'));
      if (e.a) geo.push(xy('Origen 1', e.a, (q, c) => upd({ a: q }, c)), xy('Origen 2', e.b, (q, c) => upd({ b: q }, c)));
      geo.push(xy('Posición', e.p, (q, c) => upd({ p: q }, c)));
      if (e.a) geo.push(row('Tipo', select([['horizontal', 'Horizontal'], ['vertical', 'Vertical'], ['aligned', 'Alineada']], e.kind, v => upd({ kind: v }))));
      break;
    }
  }
  box.replaceChildren(
    h('div', { class: 'prop-section' },
      h('h3', {}, e.type === 'dim' ? DIM_LABELS[e.kind] : isRect(e) ? 'Rectángulo' : isIsoCircle(e) ? 'Círculo isométrico' : TYPE_LABELS[e.type]),
      h('p', { class: 'muted small cad-hint' }, 'Escribe aquí valores exactos (Intro aplica) o, en el plano, arrastra los pinzamientos ■ azules. Esc: deseleccionar.'),
      row('Capa', layerSel(e.layer, v => upd({ layer: v }))),
      ['line', 'pline', 'circle', 'arc', 'ellipse'].includes(e.type)
        ? row('Tipo de línea', ltSel(e.lt || '', cad.layer(e.layer)?.lt, v => cad.updateEntity(id, n => { if (v) n.lt = v; else delete n.lt; return n; })))
        : null),
    h('div', { class: 'prop-section' }, h('h3', {}, 'Geometría'), geo),
    h('div', { class: 'prop-section' },
      h('h3', {}, 'Acciones'),
      h('div', { class: 'btn-row' },
        btn('Desplazar', () => cad.runOp('move')), btn('Copiar', () => cad.runOp('copy')),
        ['line', 'pline', 'circle', 'arc'].includes(e.type) ? btn('Desfase', () => cad.setTool('offset')) : null),
      h('div', { class: 'btn-row', style: 'margin-top:4px' },
        ['pline', 'circle'].includes(e.type) && (e.type === 'circle' || e.closed) ? btn('Extruir a 3D…', () => extrude2DDialog(), 'btn-primary') : null,
        e.type === 'pline' ? btn('Descomponer', () => cad.explodeSel()) : null,
        btn('Borrar', () => cad.eraseSel(), 'danger'))),
  );
}

function exportCad(kind) {
  const D = editor.cad.drawing;
  if (editor.cad.isEmpty() && kind !== 'pdf') { toast('El plano 2D está vacío', true); return; }
  const base = `${store.slug(project.name)}-plano`;
  if (kind === 'pdf') {
    if (!sheetOf(D)) { toast('Elige primero un formato de hoja (Propiedades del plano → Hoja)', true); return; }
    downloadBlob(new Blob([toPDF(D, { title: project.name })], { type: 'application/pdf' }), `${base}-${D.paper.size}.pdf`);
    toast(`Hoja ${D.paper.size} exportada a PDF a escala ${D.paper.scale || '1:1'} (imprímela al 100 %, sin «ajustar a la página»)`, 5000);
    return;
  }
  if (kind === 'dxf') downloadBlob(new Blob([toDXF(D)], { type: 'application/dxf' }), `${base}.dxf`);
  else downloadBlob(new Blob([toSVG(D)], { type: 'image/svg+xml' }), `${base}.svg`);
  toast(`Plano exportado a ${kind.toUpperCase()}`);
}

/** Convierte contornos cerrados del plano en piezas 3D (extrusiones con huecos). */
function extrude2DDialog() {
  const cad = editor.cad, D = cad.drawing;
  const sel = cad.selEnts();
  const ents = sel.length ? sel : cad.visibleEntities().filter(e => !['Cotas', 'Texto', 'Ejes', 'Construcción'].includes(e.layer));
  const { shapes, open } = buildShapes(ents);
  if (!shapes.length) {
    toast('No hay contornos cerrados que extruir: dibuja rectángulos, círculos, polilíneas cerradas o líneas y arcos que formen un contorno.', true);
    return;
  }
  const holes = shapes.reduce((n, s) => n + s.holes.length, 0);
  const unit = D.units === 'u' ? 'unidades' : D.units;
  const per3D0 = D.per3D || UNITS[D.units]?.per3D || 100;
  const field = (label, input, hint) => h('label', { class: 'field' }, h('span', {}, label), input, hint ? h('small', { class: 'muted' }, hint) : null);
  const depth = h('input', { type: 'number', class: 'text-input', value: D.lastDepth || +(10 / (UNITS[D.units]?.mm || 1)).toPrecision(3), step: 'any', min: 0 });
  const per3D = h('input', { type: 'number', class: 'text-input', value: per3D0, step: 'any', min: 0 });
  const center = h('input', { type: 'checkbox', checked: true });
  const wrap = h('div', { class: 'modal-backdrop' });
  const close = () => { document.removeEventListener('keydown', onKey2, true); wrap.remove(); };
  const go = () => {
    const d = parseFloat(depth.value), k = parseFloat(per3D.value);
    if (!(d > 0) || !(k > 0)) { toast('La altura y la escala deben ser mayores que 0', true); return; }
    close();
    const ids = editor.addExtrusions(shapes, { depth: d, scale: 1 / k, center: center.checked });
    D.lastDepth = d;
    if (D.per3D !== k) cad.setSetting('per3D', k); else cad.commit();
    editor.frame(true);
    toast(`${ids.length} pieza${ids.length > 1 ? 's' : ''} 3D creada${ids.length > 1 ? 's' : ''}${holes ? ` con ${holes} hueco${holes > 1 ? 's' : ''}` : ''} en la escena 3D. Pulsa «3D» arriba para verla${ids.length > 1 ? 's' : ''}.`, 5000);
  };
  const onKey2 = ev => {
    if (ev.key === 'Escape') { ev.stopPropagation(); close(); }
    else if (ev.key === 'Enter') { ev.preventDefault(); ev.stopPropagation(); go(); }
    else ev.stopPropagation();
  };
  document.addEventListener('keydown', onKey2, true);
  wrap.append(h('div', { class: 'modal convert', role: 'dialog', 'aria-modal': 'true' },
    h('header', { class: 'modal-head' }, h('h2', {}, 'Extruir el plano a 3D'),
      h('span', { class: 'muted' }, `${shapes.length} contorno${shapes.length > 1 ? 's' : ''} exterior${shapes.length > 1 ? 'es' : ''}${holes ? ` · ${holes} hueco${holes > 1 ? 's' : ''} interior${holes > 1 ? 'es' : ''}` : ''}${open ? ` · ${open} trazo${open > 1 ? 's' : ''} abierto${open > 1 ? 's' : ''} ignorado${open > 1 ? 's' : ''}` : ''} · ${sel.length ? 'de la selección' : 'de todo el plano (salvo cotas, texto, ejes y construcción)'}`)),
    h('div', { class: 'convert-body' },
      field(`Altura (${unit})`, depth),
      field(`Escala: ${unit} del plano por unidad 3D`, per3D, `Con ${per3D0} ${unit} = 1 unidad 3D, una pieza de ${per3D0} ${unit} mide como el cubo por defecto.`),
      h('label', { class: 'toggle' }, center, h('span', {}, 'Centrar las piezas en el origen de la escena 3D'))),
    h('footer', { class: 'modal-foot' },
      h('button', { class: 'btn', onclick: close }, 'Cancelar'),
      h('button', { class: 'btn btn-primary', onclick: go }, 'Crear piezas 3D'))));
  wrap.addEventListener('pointerdown', ev => { if (ev.target === wrap) close(); });
  document.body.append(wrap);
  depth.focus();
  depth.select();
}

function refreshLayoutButtons() {
  for (const b of document.querySelectorAll('button[data-layout]')) b.classList.toggle('active', +b.dataset.layout === editor.currentLayout);
}

// ----------------------------------------------------------- panel lateral
const SIDE_KEY = 'forja3d:side';
function sidePrefs() { try { return JSON.parse(localStorage.getItem(SIDE_KEY)) || {}; } catch { return {}; } }
function saveSidePrefs(p) { try { localStorage.setItem(SIDE_KEY, JSON.stringify({ ...sidePrefs(), ...p })); } catch { /* sin almacenamiento */ } }

function applySidebar() {
  const p = sidePrefs();
  const scr = $('#editor-screen');
  scr.classList.toggle('side-hidden', !!p.hidden);
  if (p.width) scr.style.setProperty('--side-w', `${p.width}px`);
  else scr.style.removeProperty('--side-w');
  $('#btn-side').classList.toggle('active', !p.hidden);
}

function toggleSidebar(force) {
  const hidden = force ?? !sidePrefs().hidden;
  saveSidePrefs({ hidden });
  applySidebar();
}

function initSidebarResize() {
  applySidebar();
  const handle = $('#side-resizer');
  handle.addEventListener('pointerdown', e => {
    e.preventDefault();
    handle.setPointerCapture(e.pointerId);
    document.body.classList.add('resizing');
    const scr = $('#editor-screen');
    const max = Math.max(260, Math.min(720, scr.clientWidth - 360));
    const move = ev => {
      const w = Math.round(Math.min(max, Math.max(220, scr.getBoundingClientRect().right - ev.clientX)));
      scr.style.setProperty('--side-w', `${w}px`);
    };
    const up = () => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', up);
      document.body.classList.remove('resizing');
      const w = parseInt(getComputedStyle(scr).getPropertyValue('--side-w'), 10);
      if (w) saveSidePrefs({ width: w });
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
  });
  handle.addEventListener('dblclick', () => { saveSidePrefs({ width: null }); applySidebar(); });
}

// ------------------------------------------------------ capturar / imprimir
const CAPTURE_KEY = 'forja3d:capture';

function canvasToBlob(canvas, type, quality) {
  return new Promise(res => canvas.toBlob(res, type, quality));
}

function flattenOn(canvas, color) {
  const c = document.createElement('canvas');
  c.width = canvas.width; c.height = canvas.height;
  const ctx = c.getContext('2d');
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(canvas, 0, 0);
  return c;
}

function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: name });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

const stamp = () => new Date().toLocaleString('es-ES', { dateStyle: 'long', timeStyle: 'short' });

function captureDialog(initialFormat) {
  if (document.querySelector('.modal-backdrop')) return;
  let prefs = {};
  try { prefs = JSON.parse(localStorage.getItem(CAPTURE_KEY)) || {}; } catch { /* nada */ }
  const st = {
    format: initialFormat || prefs.format || 'png',
    grid: prefs.grid ?? $('#chk-grid').checked,
    labels: prefs.labels ?? true,
    background: prefs.background || 'theme',
    scale: prefs.scale || 2,
    orientation: prefs.orientation || 'auto',
    header: prefs.header ?? true,
  };
  const wrap = h('div', { class: 'modal-backdrop' });
  const preview = h('img', { class: 'cap-preview', alt: 'Vista previa de la captura' });
  const info = h('span', { class: 'muted' });
  const seg = (key, options) => h('div', { class: 'seg cap-seg', 'data-key': key }, options.map(([v, l]) =>
    h('button', { type: 'button', 'data-v': v, class: String(st[key]) === String(v) ? 'active' : '' }, l)));
  const chk = (key, label) => {
    const c = h('input', { type: 'checkbox' });
    c.checked = !!st[key];
    c.onchange = () => { st[key] = c.checked; update(); };
    return h('label', { class: 'toggle' }, c, h('span', {}, label));
  };
  const rowsEl = {
    format: h('div', { class: 'cap-row' }, h('span', { class: 'cap-label' }, 'Formato'),
      seg('format', [['png', 'PNG'], ['jpg', 'JPG'], ['pdf', 'PDF'], ['print', 'Imprimir']])),
    background: h('div', { class: 'cap-row' }, h('span', { class: 'cap-label' }, 'Fondo'),
      seg('background', [['theme', 'Del tema'], ['white', 'Blanco'], ['transparent', 'Transparente']])),
    scale: h('div', { class: 'cap-row' }, h('span', { class: 'cap-label' }, 'Resolución'),
      seg('scale', [[1, '1×'], [2, '2×'], [4, '4×']])),
    orientation: h('div', { class: 'cap-row' }, h('span', { class: 'cap-label' }, 'Página A4'),
      seg('orientation', [['auto', 'Automática'], ['landscape', 'Horizontal'], ['portrait', 'Vertical']])),
    options: h('div', { class: 'cap-row cap-checks' }, h('span', { class: 'cap-label' }, 'Incluir'),
      h('div', { class: 'cap-checks-list' },
        chk('grid', 'Rejilla y ejes'),
        chk('labels', 'Nombre de cada vista'),
        chk('header', 'Título y fecha (PDF / impresión)'))),
  };
  const actionBtn = h('button', { class: 'btn btn-primary' }, 'Descargar');
  let current = null;
  let timer = null;

  function update() {
    for (const segEl of wrap.querySelectorAll('.cap-seg')) {
      for (const b of segEl.children) b.classList.toggle('active', String(st[segEl.dataset.key]) === b.dataset.v);
    }
    const isDoc = st.format === 'pdf' || st.format === 'print';
    if (st.background === 'transparent' && st.format !== 'png') st.background = 'theme';
    rowsEl.background.querySelector('[data-v="transparent"]').disabled = st.format !== 'png';
    rowsEl.orientation.hidden = !isDoc;
    rowsEl.options.querySelectorAll('.toggle')[1].hidden = editor.shownPanels.length < 2;
    rowsEl.options.querySelectorAll('.toggle')[2].hidden = !isDoc;
    actionBtn.textContent = st.format === 'print' ? 'Imprimir…' : 'Descargar';
    clearTimeout(timer);
    timer = setTimeout(render, 60);
  }

  function render() {
    current = editor.capture({ scale: st.scale, grid: st.grid, labels: st.labels, background: st.background });
    const pv = document.createElement('canvas');
    const k = Math.min(1, 560 / current.width);
    pv.width = Math.round(current.width * k); pv.height = Math.round(current.height * k);
    const ctx = pv.getContext('2d');
    if (st.background === 'transparent') {
      // damero para que se vea la transparencia
      for (let y = 0; y < pv.height; y += 10) for (let x = 0; x < pv.width; x += 10) {
        ctx.fillStyle = ((x + y) / 10) % 2 ? '#d8d8d8' : '#f4f4f4'; ctx.fillRect(x, y, 10, 10);
      }
    }
    ctx.drawImage(current, 0, 0, pv.width, pv.height);
    preview.src = pv.toDataURL('image/png');
    info.textContent = `${current.width} × ${current.height} px · ${editor.shownPanels.length} vista${editor.shownPanels.length > 1 ? 's' : ''}`;
  }

  wrap.addEventListener('click', e => {
    const b = e.target.closest('.cap-seg button');
    if (!b || b.disabled) return;
    const key = b.parentElement.dataset.key;
    st[key] = key === 'scale' ? +b.dataset.v : b.dataset.v;
    update();
  });

  const close = () => {
    clearTimeout(timer);
    document.removeEventListener('keydown', onKey, true);
    wrap.remove();
    try { localStorage.setItem(CAPTURE_KEY, JSON.stringify(st)); } catch { /* nada */ }
  };
  const base = `${store.slug(project.name)}-${new Date().toISOString().slice(0, 10)}`;
  const go = async () => {
    if (!current) render();
    const img = current;
    const title = st.header ? project.name : '';
    const sub = st.header ? `Forja 3D · ${stamp()} · ${editor.shownPanels.map(v => v.labelText()).join(' / ')}` : '';
    close();
    try {
      if (st.format === 'png') {
        downloadBlob(await canvasToBlob(img, 'image/png'), `${base}.png`);
      } else if (st.format === 'jpg') {
        const flat = st.background === 'theme' ? img : flattenOn(img, '#ffffff');
        downloadBlob(await canvasToBlob(flat, 'image/jpeg', 0.92), `${base}.jpg`);
      } else if (st.format === 'pdf') {
        const flat = flattenOn(img, '#ffffff');
        const jpeg = new Uint8Array(await (await canvasToBlob(flat, 'image/jpeg', 0.92)).arrayBuffer());
        const pdf = makePdf({ jpeg, width: flat.width, height: flat.height, orientation: st.orientation, title, subtitle: sub });
        downloadBlob(new Blob([pdf], { type: 'application/pdf' }), `${base}.pdf`);
      } else {
        printImage(img, { title, subtitle: sub, orientation: st.orientation });
        return;
      }
      toast(`Captura guardada (${img.width} × ${img.height} px)`);
    } catch (err) {
      console.error(err);
      toast(`No se pudo capturar: ${err.message}`, true);
    }
  };
  actionBtn.onclick = go;
  const onKey = e => {
    if (e.key === 'Escape') { e.stopPropagation(); close(); }
    else if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); go(); }
    else e.stopPropagation();
  };
  document.addEventListener('keydown', onKey, true);
  wrap.append(h('div', { class: 'modal capture', role: 'dialog', 'aria-modal': 'true' },
    h('header', { class: 'modal-head' }, h('h2', {}, 'Capturar o imprimir'),
      h('span', { class: 'muted' }, 'Se capturan las vistas tal como están en pantalla, sin el gizmo ni las cajas de selección.')),
    h('div', { class: 'capture-body' },
      h('div', { class: 'cap-preview-wrap' }, preview, info),
      h('div', { class: 'cap-opts' }, rowsEl.format, rowsEl.background, rowsEl.scale, rowsEl.orientation, rowsEl.options)),
    h('footer', { class: 'modal-foot' },
      h('button', { class: 'btn', onclick: close }, 'Cancelar'), actionBtn)));
  wrap.addEventListener('pointerdown', e => { if (e.target === wrap) close(); });
  document.body.append(wrap);
  update();
}

/** Imprime una imagen (el usuario puede elegir «Guardar como PDF» en el diálogo del navegador). */
function printImage(canvas, { title, subtitle, orientation }) {
  const sheet = $('#print-sheet');
  const landscape = orientation === 'landscape' || (orientation === 'auto' && canvas.width >= canvas.height);
  const flat = flattenOn(canvas, '#ffffff');
  sheet.replaceChildren(
    title ? h('h1', {}, title) : null,
    subtitle ? h('p', {}, subtitle) : null,
    h('img', { src: flat.toDataURL('image/jpeg', 0.95), alt: title || 'Captura', style: `max-height:${landscape ? 165 : 235}mm` }));
  let style = document.getElementById('print-page-style');
  if (!style) { style = h('style', { id: 'print-page-style' }); document.head.append(style); }
  style.textContent = `@page { size: A4 ${landscape ? 'landscape' : 'portrait'}; margin: 12mm; }`;
  document.body.classList.add('printing');
  const done = () => { document.body.classList.remove('printing'); sheet.replaceChildren(); window.removeEventListener('afterprint', done); };
  window.addEventListener('afterprint', done);
  const img = sheet.querySelector('img');
  const fire = () => setTimeout(() => window.print(), 50);
  img.complete ? fire() : img.addEventListener('load', fire, { once: true });
}

function setTransform(mode) {
  editor.setTransformMode(mode);
  for (const b of document.querySelectorAll('#transform-mode button')) b.classList.toggle('active', b.dataset.mode === mode);
}

const VIEW_LABEL = { solid: 'Sólido', wire: 'Alámbrico' };
function setView(mode) {
  editor.setViewMode(mode);
  for (const b of document.querySelectorAll('#view-mode button')) b.classList.toggle('active', b.dataset.view === editor.viewMode);
  refreshStatus();
}

// Vistas por tecla (fila de números o teclado numérico, estilo Blender)
const VIEW_KEYS = { 1: ['front', 'back'], 3: ['right', 'left'], 7: ['top', 'bottom'], 9: ['iso', 'iso'] };

function onKey(e) {
  if ($('#editor-screen').hidden || document.querySelector('.modal-backdrop')) return;
  const typing = e.target.closest('input, textarea, select');
  const mod = e.ctrlKey || e.metaKey;
  if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); saveNow(); toast('Guardado'); return; }
  if (mod && e.key.toLowerCase() === 'p') { e.preventDefault(); captureDialog('print'); return; }
  if (is2D()) {
    if (e.target.id === 'cmd-input' || !e.target.closest('input, textarea, select')) editor.cad.handleKey(e, $('#cmd-input'));
    return;
  }
  if (typing) return;
  const k = e.key.toLowerCase();
  const digit = (e.code.match(/^(?:Digit|Numpad)(\d)$/) || [])[1];
  if (editor.sculpt && !mod && sculptKey(e)) return;
  if (mod && k === 'z' && !e.shiftKey) { e.preventDefault(); editor.undo(); }
  else if (mod && (k === 'y' || (k === 'z' && e.shiftKey))) { e.preventDefault(); editor.redo(); }
  else if (mod && k === 'd') { e.preventDefault(); editor.duplicate(); }
  else if (mod && k === 'a') { e.preventDefault(); editor.selectAll(); }
  else if (mod) return;
  else if (digit && VIEW_KEYS[digit]) { editor.setView(VIEW_KEYS[digit][e.shiftKey ? 1 : 0]); scheduleSave(); }
  else if (digit === '5') { editor.toggleProjection(); scheduleSave(); }
  else if (digit === '0') { editor.setView('persp'); scheduleSave(); }
  else if (e.code === 'NumpadDecimal' || k === 'f') editor.frame();
  else if (k === 'n') toggleSidebar();
  else if (k === 'h') editor.setHand(!editor.hand);
  else if (k === 'w') setTransform('translate');
  else if (k === 'e') setTransform('rotate');
  else if (k === 'r') setTransform('scale');
  else if (k === 'z') { setView(editor.viewMode === 'wire' ? 'solid' : 'wire'); scheduleSave(); }
  else if (k === 'g') { const c = $('#chk-snap'); c.checked = !c.checked; c.dispatchEvent(new Event('change')); refreshSnapSizeBtn(); }
  else if (k === 'delete' || k === 'backspace') { e.preventDefault(); editor.remove(); }
  else if (k === 'escape') editor.select(null);
}

// ---------------------------------------------------------------- outliner
const EYE = '<svg viewBox="0 0 24 24"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>';
const EYE_OFF = '<svg viewBox="0 0 24 24"><path d="M3 3l18 18M10.6 5.1A10 10 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-3.2 4M6.6 6.6C3.8 8.4 2 12 2 12s3.6 7 10 7a9.6 9.6 0 0 0 5.4-1.6"/></svg>';

// Árbol de la escena: las operaciones booleanas se despliegan y muestran sus piezas (anidadas).
const treeOpen = new Set();       // claves «rootId/0/1» de los nodos desplegados
const treeKey = (rootId, path) => [rootId, ...path].join('/');
const CARET = '<svg viewBox="0 0 24 24"><path d="M9 6l6 6-6 6"/></svg>';
const ROLE = {
  union: i => (i === 0 ? ['base', 'Base de la unión'] : ['+', 'Se une']),
  subtract: i => (i === 0 ? ['base', 'Pieza de la que se resta'] : ['−', 'Se resta (hueco)']),
  intersect: i => (i === 0 ? ['base', 'Base de la intersección'] : ['∩', 'Se interseca']),
};
const roleOf = (op, i, node) => (node?.helper ? ['corte', 'Plano de corte (semiespacio)'] : (ROLE[op] || ROLE.union)(i));
const nodeName = n => (n.helper ? 'Plano de corte' : n.name || typeLabel(n));
const samePath = (a, b) => a && b && a.length === b.length && a.every((v, i) => v === b[i]);

function refreshOutliner() {
  if (!editor) return;
  const ul = $('#outliner');
  const items = editor.serialize();
  $('#obj-count').textContent = items.length;
  ul.replaceChildren();
  if (!items.length) ul.append(h('li', { class: 'empty-row' }, 'Escena vacía'));
  const sub = editor.subSel;
  // desplegar los antecesores de la pieza seleccionada
  if (sub) for (let d = 0; d < sub.path.length; d++) treeOpen.add(treeKey(sub.rootId, sub.path.slice(0, d)));

  const caret = (key, has) => {
    if (!has) return h('span', { class: 'caret empty' });
    const c = h('button', { class: `caret${treeOpen.has(key) ? ' open' : ''}`, title: treeOpen.has(key) ? 'Plegar' : 'Desplegar', onclick: e => {
      e.stopPropagation();
      treeOpen.has(key) ? treeOpen.delete(key) : treeOpen.add(key);
      refreshOutliner();
    } });
    c.innerHTML = CARET;
    return c;
  };

  const addChildren = (rootId, node, path, depth) => {
    const op = node.params?.op;
    node.operands.forEach((child, i) => {
      const p = [...path, i];
      const key = treeKey(rootId, p);
      const isBool = child.type === 'boolean';
      const [badge, roleTitle] = roleOf(op, i, child);
      const selected = sub && sub.rootId === rootId && samePath(sub.path, p);
      ul.append(h('li', {
        class: ['tree-child', selected && 'selected', child.helper && 'helper'].filter(Boolean).join(' '),
        style: `--d:${depth}`,
        title: `${roleTitle} · clic: seleccionar la pieza (se resalta en 3D y se puede mover) · doble clic: encuadrar`,
        onclick: () => editor.selectOperand(rootId, p),
        ondblclick: () => { editor.selectOperand(rootId, p); frameOperand(); },
      },
        caret(key, isBool),
        h('span', { class: `role role-${badge === 'base' ? 'base' : badge === 'corte' ? 'cut' : 'op'}`, title: roleTitle }, badge),
        h('span', { class: 'name' }, nodeName(child)),
        isBool ? h('span', { class: 'op-badge' }, BOOLEAN_OPS[child.params.op]?.symbol || '') : null,
        h('span', { class: 'type' }, child.helper ? 'Corte' : typeLabel(child))));
      if (isBool && treeOpen.has(key)) addChildren(rootId, child, p, depth + 1);
    });
  };

  for (const o of items) {
    const vis = h('button', { class: 'vis', title: o.visible ? 'Ocultar' : 'Mostrar', onclick: e => {
      e.stopPropagation();
      editor.update(o.id, { visible: !o.visible });
    } });
    vis.innerHTML = o.visible ? EYE : EYE_OFF;
    const sw = h('span', { class: 'swatch' });
    sw.style.background = o.material.color;
    const inSel = editor.selection.includes(o.id);
    const isBool = o.type === 'boolean';
    const key = treeKey(o.id, []);
    ul.append(h('li', {
      class: [inSel && (sub?.rootId === o.id ? 'contains-selected' : 'selected'), !o.visible && 'hidden-obj', 'tree-root'].filter(Boolean).join(' '),
      title: 'Clic: seleccionar · Mayús/Ctrl+clic: añadir a la selección · doble clic: encuadrar',
      onclick: e => (e.shiftKey || e.ctrlKey || e.metaKey) ? editor.toggleSelect(o.id) : editor.select(o.id),
      ondblclick: () => { editor.select(o.id); editor.frame(); },
    }, caret(key, isBool), sw, h('span', { class: 'name' }, o.name),
      isBool ? h('span', { class: 'op-badge', title: `${o.operands.length} piezas` }, `${BOOLEAN_OPS[o.params.op]?.symbol || ''}${o.operands.length}`) : null,
      h('span', { class: 'type' }, typeLabel(o)), vis));
    if (isBool && treeOpen.has(key)) addChildren(o.id, o, [], 1);
  }
  const hasSel = editor.selection.length > 0;
  $('#btn-duplicate').disabled = !hasSel;
  $('#btn-delete').disabled = !hasSel;
  $('#btn-delete').textContent = sub ? 'Quitar pieza' : 'Eliminar';
  ul.querySelector('.selected')?.scrollIntoView({ block: 'nearest' });
}

/** Abre o cierra todos los nodos de operaciones. */
function setTreeOpen(open) {
  treeOpen.clear();
  if (open) {
    const walk = (rootId, node, path) => {
      treeOpen.add(treeKey(rootId, path));
      node.operands?.forEach((c, i) => { if (c.type === 'boolean') walk(rootId, c, [...path, i]); });
    };
    for (const o of editor.serialize()) if (o.type === 'boolean') walk(o.id, o, []);
  }
  refreshOutliner();
}

/** Encuadra la pieza seleccionada (su resaltado) en la vista activa. */
function frameOperand() {
  const g = editor._ghost;
  if (!g) return;
  g.geometry.computeBoundingSphere();
  const s = g.geometry.boundingSphere.clone().applyMatrix4(g.matrix);
  editor.active.frameSphere(s);
}

// --------------------------------------------------------------- statusbar
function refreshStatus() {
  if (!editor) return;
  const s = editor.stats();
  const sel = editor.getSelected();
  const n = editor.selection.length;
  $('#status-3d').innerHTML =
    `<span>Objetos <b>${s.objects}</b></span><span>Triángulos <b>${s.tris.toLocaleString('es-ES')}</b></span>` +
    `<span>Vértices <b>${s.verts.toLocaleString('es-ES')}</b></span>` +
    `<span>Vista <b>${VIEW_LABEL[editor.viewMode]}</b></span><span>Snap <b>${editor.snap ? `${fmtN(editor.snapSizes.move)} u · ${fmtN(editor.snapSizes.rot)}° · ×${fmtN(editor.snapSizes.scale)}` : 'no'}</b></span>` +
    (n > 1 ? `<span>Selección <b>${n} objetos</b></span>` : sel ? `<span>Selección <b>${escapeHTML(sel.name)}</b></span>` : '') +
    (editor.sculpt ? '<span><b>Esculpiendo</b> · Intro o Esc para terminar</span>' : '');
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
  if (editor.subSel) {
    const op = editor.getSubSelected();
    if (!op) return;
    const arr = [...op[key]];
    arr[i] = v;
    editor.updateOperand(op.rootId, op.path, { [key]: arr }, commit);
    return;
  }
  const sel = editor.getSelected();
  if (!sel) return;
  const arr = [...sel[key]];
  arr[i] = v;
  editor.update(sel.id, { [key]: arr }, commit);
}

function syncTransformFields() {
  const sel = editor.subSel ? editor.getSubSelected() : editor.getSelected();
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
  if (is2D()) return renderCadProps(box);
  if (editor.selection.length > 1) return renderMultiProps(box);
  if (editor.subSel) return renderOperandProps(box);
  const sel = editor.getSelected();
  if (!sel) {
    box.replaceChildren(h('p', { class: 'empty' },
      'Nada seleccionado. Haz clic en un objeto del visor o de la lista (Mayús/Ctrl+clic para seleccionar varios).'));
    return;
  }
  const def = PRIMITIVES[sel.type];
  const id = sel.id;
  const upd = (patch, commit) => editor.update(id, patch, commit);

  // objeto
  const name = h('input', { class: 'text-input', value: sel.name, spellcheck: 'false' });
  name.addEventListener('change', () => upd({ name: name.value.trim() || typeLabel(sel) }, true));
  name.addEventListener('keydown', e => { if (e.key === 'Enter') name.blur(); });

  // geometría
  let geo;
  if (sel.type === 'sculpt') {
    const s = sel.sculpt || {};
    const g = editor.objects.get(id)?.geometry;
    const n = g ? Math.round((g.index ? g.index.count : (g.drawRange.count !== Infinity ? g.drawRange.count : g.attributes.position.count)) / 3) : 0;
    const voxel = s.kind === 'voxel';
    geo = [
      h('p', { class: 'note' }, `${voxel ? 'Escultura por volumen' : 'Escultura por malla'} · detalle ${LEVEL_LABELS[s.level] || '—'}` +
        (voxel ? ` · rejilla ${s.dims?.join(' × ')}` : '') + ` · ${n.toLocaleString('es-ES')} triángulos.`),
      editor.sculpt
        ? h('div', { class: 'btn-row' }, h('button', { class: 'btn sm btn-primary', onclick: () => editor.endSculpt() }, 'Terminar de esculpir'))
        : h('div', { class: 'btn-row' },
          h('button', { class: 'btn sm btn-primary', onclick: () => editor.startSculpt(id) }, 'Esculpir'),
          h('button', { class: 'btn sm', title: 'Probar el otro método sobre la forma actual', onclick: () => sculptDialog(voxel ? 'mesh' : 'voxel') }, voxel ? 'Pasar a malla…' : 'Pasar a volumen…')),
    ];
  } else if (sel.type === 'mesh') {
    const tris = editor.objects.get(id)?.geometry;
    const n = tris ? Math.round((tris.index ? tris.index.count : tris.attributes.position.count) / 3) : 0;
    geo = [
      h('p', { class: 'note' }, `Malla importada${sel.mesh?.source ? ` de «${sel.mesh.source}»` : ''} · ${n.toLocaleString('es-ES')} triángulos.`),
      h('p', { class: 'note' }, 'No tiene parámetros editables, pero puedes moverla, escalarla, cambiar su material y usarla en operaciones booleanas (mejor si es una malla cerrada).'),
    ];
  } else if (sel.type === 'boolean') {
    const isPiece = sel.operands.some(o => o.helper);
    const opSel = h('select', { class: 'select-input' },
      ['union', 'subtract', 'intersect'].map(k => {
        const o = h('option', { value: k }, `${BOOLEAN_OPS[k].symbol}  ${BOOLEAN_OPS[k].label}`);
        if (k === sel.params.op) o.selected = true;
        return o;
      }));
    opSel.onchange = () => upd({ params: { op: opSel.value } }, true);
    geo = [
      isPiece
        ? h('p', { class: 'note' }, `Pieza obtenida al partir «${sel.operands[0].name}» con un plano.`)
        : row('Operación', opSel),
      h('p', { class: 'note' }, 'Operandos (el primero es la base):'),
      h('ul', { class: 'operand-list' }, sel.operands.filter(o => !o.helper).map((o, i) =>
        h('li', {}, `${i + 1}. `, h('b', {}, o.name || typeLabel(o)), ` · ${typeLabel(o)}`))),
      h('div', { class: 'btn-row' },
        h('button', { class: 'btn sm', onclick: () => editor.explode([id]) }, 'Separar piezas')),
    ];
  } else {
    geo = def.params.map(p => {
      if (p.bool) {
        const chk = h('input', { type: 'checkbox' });
        chk.checked = !!(sel.params[p.key] ?? p.def);
        chk.onchange = () => { upd({ params: { [p.key]: chk.checked ? 1 : 0 } }, true); renderProps(); };
        return row(p.label, h('label', { class: 'toggle' }, chk, h('span', {}, chk.checked ? 'Sí' : 'No')));
      }
      return row(p.label, numberField({
        label: '↔', value: sel.params[p.key] ?? p.def, step: p.step, min: p.min, max: p.max, int: p.int,
        onInput: v => upd({ params: { [p.key]: v } }, false),
        onCommit: v => upd({ params: { [p.key]: v } }, true),
      }));
    });
    if (def.usesShape) {
      const n = sel.shape?.points?.length || 0;
      geo.unshift(
        h('p', { class: 'note' }, `${def.usesShape === 'path' ? 'Trazado' : 'Perfil'} de ${n} puntos${sel.shape?.smooth ? ', curva suave' : ''}.`),
        h('div', { class: 'btn-row', style: 'margin-bottom:8px' },
          h('button', { class: 'btn sm', onclick: () => editProfile(id) }, def.usesShape === 'path' ? 'Editar trazado…' : 'Editar perfil…')));
    }
    if (sel.type === 'extrude' && sel.shape?.holes?.length) {
      geo.push(h('p', { class: 'note' }, `Con ${sel.shape.holes.length} hueco${sel.shape.holes.length > 1 ? 's' : ''} interior${sel.shape.holes.length > 1 ? 'es' : ''}.`));
    }
    if (sel.type === 'line2d' || sel.type === 'circle2d') {
      geo.push(
        h('p', { class: 'note', style: 'margin-top:10px' }, 'Convertir en 3D:'),
        h('div', { class: 'btn-row' },
          h('button', { class: 'btn sm', onclick: () => convert2DDialog('extrude') }, 'Extruir…'),
          h('button', { class: 'btn sm', onclick: () => convert2DDialog('lathe') }, 'Revolución…')));
    }
  }

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
      row('Tipo', h('span', {}, typeLabel(sel)))),
    h('div', { class: 'prop-section' },
      h('h3', {}, 'Transformación'),
      vec3Row('Posición', 'position', sel.position, 0.05),
      vec3Row('Rotación °', 'rotation', sel.rotation, 1),
      vec3Row('Escala', 'scale', sel.scale, 0.05),
      row('Reflejar', mirrorButtons()),
      row('', h('div', { class: 'btn-row' }, h('button', { class: 'btn sm', onclick: () => editor.dropToFloor() }, 'Apoyar en el suelo')))),
    h('div', { class: 'prop-section' }, h('h3', {}, sel.type === 'boolean' ? 'Operación booleana' : 'Geometría'), geo),
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

/** Propiedades de una pieza dentro de una operación (edición no destructiva). */
function renderOperandProps(box) {
  const op = editor.getSubSelected();
  if (!op) return;
  const { rootId, path } = op;
  const root = editor.getSelected();
  const upd = (patch, commit) => editor.updateOperand(rootId, path, patch, commit);
  const def = PRIMITIVES[op.type];

  // ruta: Operación › subop › pieza
  const crumbs = [h('button', { class: 'crumb', onclick: () => editor.select(rootId) }, root.name)];
  let node = root;
  path.forEach((idx, d) => {
    node = node.operands[idx];
    const p = path.slice(0, d + 1);
    crumbs.push(h('span', { class: 'crumb-sep' }, '›'));
    crumbs.push(d === path.length - 1
      ? h('span', { class: 'crumb current' }, nodeName(node))
      : h('button', { class: 'crumb', onclick: () => editor.selectOperand(rootId, p) }, nodeName(node)));
  });
  const [, roleTitle] = roleOf(op.parentOp, path[path.length - 1], op);

  const name = h('input', { class: 'text-input', value: op.helper ? 'Plano de corte' : (op.name || ''), spellcheck: 'false', disabled: !!op.helper });
  name.addEventListener('change', () => upd({ name: name.value.trim() || typeLabel(op) }, true));
  name.addEventListener('keydown', e => { if (e.key === 'Enter') name.blur(); });

  let geo = [];
  if (op.helper) {
    geo = [h('p', { class: 'note' }, 'Es el plano que corta la pieza. Muévelo o gíralo (con el gizmo o con los valores) para cambiar por dónde se parte.')];
  } else if (op.type === 'boolean') {
    const opSel = h('select', { class: 'select-input' }, ['union', 'subtract', 'intersect'].map(k => {
      const o = h('option', { value: k }, `${BOOLEAN_OPS[k].symbol}  ${BOOLEAN_OPS[k].label}`);
      if (k === op.params.op) o.selected = true;
      return o;
    }));
    opSel.onchange = () => upd({ params: { op: opSel.value } }, true);
    geo = [row('Operación', opSel), h('p', { class: 'note' }, `Operación anidada con ${op.operands.length} piezas: despliégala en el árbol para editarlas.`)];
  } else if (op.type === 'mesh') {
    geo = [h('p', { class: 'note' }, `Malla importada${op.mesh?.source ? ` de «${op.mesh.source}»` : ''}.`)];
  } else if (def) {
    geo = def.params.map(p => {
      if (p.bool) {
        const chk = h('input', { type: 'checkbox' });
        chk.checked = !!(op.params[p.key] ?? p.def);
        chk.onchange = () => upd({ params: { [p.key]: chk.checked ? 1 : 0 } }, true);
        return row(p.label, h('label', { class: 'toggle' }, chk, h('span', {}, chk.checked ? 'Sí' : 'No')));
      }
      return row(p.label, numberField({
        label: '↔', value: op.params[p.key] ?? p.def, step: p.step, min: p.min, max: p.max, int: p.int,
        onInput: v => upd({ params: { [p.key]: v } }, false),
        onCommit: v => upd({ params: { [p.key]: v } }, true),
      }));
    });
    if (def.usesShape) geo.unshift(h('p', { class: 'note' }, 'Para cambiar el perfil, extrae la pieza, edítalo y vuelve a combinarla.'));
  }

  box.replaceChildren(
    h('div', { class: 'crumbs' }, crumbs),
    h('div', { class: 'prop-section' },
      h('h3', {}, 'Pieza de la operación'),
      row('Nombre', name),
      row('Tipo', h('span', {}, op.helper ? 'Plano de corte' : typeLabel(op))),
      row('Papel', h('span', {}, roleTitle)),
      h('p', { class: 'note' }, 'Se resalta en azul en el visor. Los cambios recalculan la operación al soltar el gizmo o confirmar el valor.')),
    h('div', { class: 'prop-section' },
      h('h3', {}, 'Transformación (dentro de la operación)'),
      vec3Row('Posición', 'position', op.position, 0.05),
      vec3Row('Rotación °', 'rotation', op.rotation, 1),
      vec3Row('Escala', 'scale', op.scale, 0.05)),
    geo.length ? h('div', { class: 'prop-section' }, h('h3', {}, 'Geometría'), geo) : null,
    h('div', { class: 'prop-section' },
      h('h3', {}, 'Acciones'),
      h('div', { class: 'btn-row' },
        op.helper ? null : h('button', { class: 'btn sm', title: 'La saca de la operación y la deja como objeto independiente', onclick: () => editor.removeOperand(rootId, path, { extract: true }) }, 'Extraer como objeto'),
        h('button', { class: 'btn sm danger', title: 'La quita de la operación (Supr)', onclick: () => editor.removeOperand(rootId, path) }, 'Quitar de la operación')),
      h('div', { class: 'btn-row', style: 'margin-top:4px' },
        h('button', { class: 'btn sm', onclick: () => frameOperand() }, 'Encuadrar pieza'),
        h('button', { class: 'btn sm', onclick: () => editor.select(rootId) }, 'Seleccionar la operación'))),
  );
}

const mirrorButtons = () => h('div', { class: 'btn-row' },
  ['x', 'y', 'z'].map(a => h('button', { class: 'btn sm', title: `Reflejar en el eje ${a.toUpperCase()}`, onclick: () => editor.mirror(a) }, a.toUpperCase())));

/** Panel para varios objetos seleccionados: orden, operaciones y color común. */
function renderMultiProps(box) {
  const sel = editor.selection.map(id => editor.objects.get(id)?.userData).filter(Boolean);
  const op = (label, key, title) => h('button', { class: 'btn sm', title, onclick: () => runOp(key) }, label);
  const hasPlane = sel.length === 2 && sel.filter(u => u.type === 'plane').length === 1;
  box.replaceChildren(
    h('div', { class: 'prop-section' },
      h('h3', {}, `${sel.length} objetos seleccionados`),
      h('ul', { class: 'multi-list' }, sel.map((u, i) => h('li', {},
        h('span', { class: i === 0 ? 'badge' : 'badge b' }, i === 0 ? 'A' : String.fromCharCode(65 + i)),
        h('span', {}, u.name), h('span', { class: 'muted' }, typeLabel(u))))),
      h('p', { class: 'note' }, 'El primero seleccionado (A) es la base: en «Restar» se le quitan los demás. El gizmo mueve todo el grupo.')),
    h('div', { class: 'prop-section' },
      h('h3', {}, 'Operaciones'),
      h('div', { class: 'btn-row' },
        op('∪ Unir', 'union', 'A ∪ B'), op('− Restar', 'subtract', 'A − B'), op('∩ Intersecar', 'intersect', 'A ∩ B')),
      hasPlane ? h('div', { class: 'btn-row', style: 'margin-top:4px' }, op('Partir con el plano', 'split', 'Corta el objeto con el plano seleccionado')) : null),
    h('div', { class: 'prop-section' },
      h('h3', {}, 'Transformación'),
      row('Reflejar', mirrorButtons()),
      row('', h('div', { class: 'btn-row' }, h('button', { class: 'btn sm', onclick: () => editor.dropToFloor() }, 'Apoyar en el suelo')))),
    h('div', { class: 'prop-section' },
      h('h3', {}, 'Color para todos'),
      h('div', { class: 'palette', style: 'grid-column:auto' }, PALETTE.map(c => {
        const b = h('button', { title: c, onclick: () => {
          for (const u of sel) editor.update(u.id, { material: { color: c } }, false);
          editor._commit();
        } });
        b.style.background = c;
        return b;
      }))),
  );
}

// ================================================================== arranque
window.addEventListener('hashchange', route);
store.init().then(route);
