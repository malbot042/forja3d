// Persistencia de proyectos en localStorage.
// Índice ligero (lista + miniaturas) separado de los datos de cada proyecto.

const NS = 'forja3d';
const INDEX_KEY = `${NS}:index`;
const projectKey = id => `${NS}:p:${id}`;
export const FORMAT = 'forja3d-project';
export const FORMAT_VERSION = 1;

export const uid = () =>
  (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2)).slice(0, 12);

function readJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function writeJSON(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

export function listProjects() {
  const index = readJSON(INDEX_KEY, []);
  return index.sort((a, b) => b.updated - a.updated);
}

function saveIndex(index) {
  try {
    writeJSON(INDEX_KEY, index);
  } catch (e) {
    // Sin espacio: eliminar miniaturas y reintentar
    for (const p of index) delete p.thumb;
    writeJSON(INDEX_KEY, index);
  }
}

function upsertIndex(entry) {
  const index = readJSON(INDEX_KEY, []);
  const i = index.findIndex(p => p.id === entry.id);
  if (i >= 0) index[i] = { ...index[i], ...entry };
  else index.push(entry);
  saveIndex(index);
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

export function loadProject(id) {
  return readJSON(projectKey(id), null);
}

/** Guarda el proyecto. Devuelve true si se ha guardado. */
export function saveProject(project, thumb) {
  project.updated = Date.now();
  try {
    writeJSON(projectKey(project.id), project);
  } catch (e) {
    console.error(e);
    return false;
  }
  const entry = {
    id: project.id,
    name: project.name,
    created: project.created,
    updated: project.updated,
    count: project.objects.length,
  };
  if (thumb) entry.thumb = thumb;
  upsertIndex(entry);
  return true;
}

export function renameProject(id, name) {
  const p = loadProject(id);
  if (!p) return;
  p.name = name;
  saveProject(p);
}

export function deleteProject(id) {
  localStorage.removeItem(projectKey(id));
  saveIndex(readJSON(INDEX_KEY, []).filter(p => p.id !== id));
}

export function duplicateProject(id) {
  const src = loadProject(id);
  if (!src) return null;
  const now = Date.now();
  const copy = { ...structuredClone(src), id: uid(), name: `${src.name} (copia)`, created: now };
  const thumb = readJSON(INDEX_KEY, []).find(p => p.id === id)?.thumb;
  saveProject(copy, thumb);
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
    created: Date.now(),
  };
  saveProject(p);
  return p;
}

export function storageUsage() {
  let bytes = 0;
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k.startsWith(NS)) bytes += (k.length + (localStorage.getItem(k)?.length || 0)) * 2;
  }
  return bytes;
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
