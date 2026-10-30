// Persistencia de proyectos en IndexedDB (cientos de MB o más, según el disco).
// Se mantiene en memoria un índice ligero (lista + miniaturas) para que la interfaz sea inmediata;
// los proyectos se leen bajo demanda y se escriben en segundo plano.
// En el primer arranque se migran los proyectos que hubiera en localStorage.

const NS = 'forja3d';
const DB_NAME = 'forja3d';
const DB_VERSION = 1;
export const FORMAT = 'forja3d-project';
export const FORMAT_VERSION = 1;

export const uid = () =>
  (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2)).slice(0, 12);

let db = null;
const index = new Map();      // id -> entrada del índice
const cache = new Map();      // id -> proyecto completo (los abiertos recientemente)
let pending = Promise.resolve();
let fallback = false;         // sin IndexedDB (navegación privada antigua): solo memoria + localStorage

// ------------------------------------------------------------- IndexedDB
function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const d = req.result;
      if (!d.objectStoreNames.contains('projects')) d.createObjectStore('projects', { keyPath: 'id' });
      if (!d.objectStoreNames.contains('index')) d.createObjectStore('index', { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('La base de datos está bloqueada por otra pestaña'));
  });
}

function tx(stores, mode, fn) {
  return new Promise((resolve, reject) => {
    const t = db.transaction(stores, mode);
    const out = fn(t);
    t.oncomplete = () => resolve(out?.result ?? out);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error || new Error('Transacción cancelada'));
  });
}

const reqP = r => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });

/** Encola una escritura para que se apliquen en orden. */
function queue(fn) {
  pending = pending.then(fn, fn);
  return pending;
}

// ------------------------------------------------------------- arranque
let ready = null;
export function init() {
  if (ready) return ready;
  ready = (async () => {
    try {
      db = await openDB();
      const entries = await tx(['index'], 'readonly', t => t.objectStore('index').getAll());
      for (const e of entries.result ?? entries) index.set(e.id, e);
      await migrateFromLocalStorage();
    } catch (err) {
      console.warn('IndexedDB no disponible, se usa localStorage', err);
      fallback = true;
      for (const e of readLS(`${NS}:index`, [])) index.set(e.id, e);
    }
    // pedir almacenamiento persistente (el navegador no lo borrará al ir justo de espacio)
    try { if (navigator.storage?.persist && !(await navigator.storage.persisted())) await navigator.storage.persist(); } catch { /* opcional */ }
  })();
  return ready;
}

function readLS(key, def) {
  try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : def; } catch { return def; }
}

async function migrateFromLocalStorage() {
  const old = readLS(`${NS}:index`, null);
  if (!old?.length) return;
  let moved = 0;
  for (const e of old) {
    const p = readLS(`${NS}:p:${e.id}`, null);
    if (!p || index.has(e.id)) continue;
    await tx(['projects', 'index'], 'readwrite', t => {
      t.objectStore('projects').put(p);
      t.objectStore('index').put(e);
    });
    index.set(e.id, e);
    moved++;
  }
  // los datos ya están en IndexedDB: liberar localStorage
  for (const e of old) localStorage.removeItem(`${NS}:p:${e.id}`);
  localStorage.removeItem(`${NS}:index`);
  if (moved) console.info(`Forja 3D: ${moved} proyecto(s) migrados de localStorage a IndexedDB`);
}

// ------------------------------------------------------------- API
export function listProjects() {
  return [...index.values()].sort((a, b) => b.updated - a.updated);
}

export function emptyProject(name = 'Proyecto sin título') {
  const now = Date.now();
  return {
    format: FORMAT,
    version: FORMAT_VERSION,
    id: uid(),
    name,
    created: now,
    updated: now,
    camera: { position: [5, 4, 6], target: [0, 0, 0] },
    settings: { view: 'solid', grid: true, snap: false },
    objects: [],
  };
}

export function createProject(name) {
  const p = emptyProject(name);
  saveProject(p);
  return p;
}

/** Lee un proyecto completo (asíncrono). */
export async function loadProject(id) {
  if (cache.has(id)) return cache.get(id);
  await pending;
  let p = null;
  if (fallback) p = readLS(`${NS}:p:${id}`, null);
  else p = await tx(['projects'], 'readonly', t => t.objectStore('projects').get(id)).then(r => r ?? null);
  if (p) cache.set(id, p);
  return p;
}

/**
 * Guarda el proyecto. El índice se actualiza al momento; la escritura en disco va en segundo plano.
 * Devuelve una promesa que se resuelve a true/false.
 */
export function saveProject(project, thumb) {
  project.updated = Date.now();
  const prev = index.get(project.id) || {};
  const entry = {
    id: project.id,
    name: project.name,
    created: project.created,
    updated: project.updated,
    count: project.objects.length,
    thumb: thumb ?? prev.thumb,
  };
  index.set(project.id, entry);
  cache.set(project.id, project);
  if (fallback) {
    try {
      localStorage.setItem(`${NS}:p:${project.id}`, JSON.stringify(project));
      localStorage.setItem(`${NS}:index`, JSON.stringify(listProjects()));
      return Promise.resolve(true);
    } catch (e) {
      console.error(e);
      return Promise.resolve(false);
    }
  }
  // IndexedDB clona los datos en el momento de put(), así que se pueden seguir editando
  return queue(() => tx(['projects', 'index'], 'readwrite', t => {
    t.objectStore('projects').put(project);
    t.objectStore('index').put(entry);
  }).then(() => true, err => { console.error(err); return false; }));
}

export async function renameProject(id, name) {
  const p = await loadProject(id);
  if (!p) return;
  p.name = name;
  await saveProject(p);
}

export function deleteProject(id) {
  index.delete(id);
  cache.delete(id);
  if (fallback) {
    localStorage.removeItem(`${NS}:p:${id}`);
    localStorage.setItem(`${NS}:index`, JSON.stringify(listProjects()));
    return Promise.resolve();
  }
  return queue(() => tx(['projects', 'index'], 'readwrite', t => {
    t.objectStore('projects').delete(id);
    t.objectStore('index').delete(id);
  }));
}

export async function duplicateProject(id) {
  const src = await loadProject(id);
  if (!src) return null;
  const now = Date.now();
  const copy = { ...structuredClone(src), id: uid(), name: `${src.name} (copia)`, created: now };
  await saveProject(copy, index.get(id)?.thumb);
  return copy;
}

/** Valida y normaliza un proyecto importado; le asigna id nuevo. */
export function importProjectData(data) {
  if (!data || typeof data !== 'object' || !Array.isArray(data.objects)) {
    throw new Error('El archivo no es un proyecto válido');
  }
  const base = emptyProject(String(data.name || 'Proyecto importado'));
  const p = {
    ...base,
    camera: data.camera ?? base.camera,
    settings: { ...base.settings, ...(data.settings || {}) },
    objects: data.objects,
    ...(data.drawing ? { drawing: data.drawing } : {}),
    ...(Array.isArray(data.sheets) ? { sheets: data.sheets, sheet: data.sheet } : {}),
    created: Date.now(),
  };
  saveProject(p);
  return p;
}

/** Espera a que terminen las escrituras pendientes. */
export const flush = () => pending;

/** Uso y cuota del almacenamiento del sitio. */
export async function storageInfo() {
  let usage = 0, quota = 0, persisted = false;
  try {
    const est = await navigator.storage?.estimate?.();
    usage = est?.usage || 0;
    quota = est?.quota || 0;
    persisted = !!(await navigator.storage?.persisted?.());
  } catch { /* no disponible */ }
  return { usage, quota, persisted, backend: fallback ? 'localStorage' : 'IndexedDB' };
}

export function downloadJSON(data, filename) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export const slug = s =>
  (s || 'proyecto').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() || 'proyecto';
