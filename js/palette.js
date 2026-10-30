// Paleta de órdenes (Ctrl+K): busca y ejecuta cualquier herramienta o acción y muestra sus atajos.
// Recibe una lista de acciones { id, label, group, keys?, hint?, words?, enabled?(), run(), other? }.

const RECENT_KEY = 'forja3d:palette-recent';
const fold = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

function recent() { try { return JSON.parse(localStorage.getItem(RECENT_KEY)) || []; } catch { return []; } }
function pushRecent(id) {
  try { localStorage.setItem(RECENT_KEY, JSON.stringify([id, ...recent().filter(x => x !== id)].slice(0, 6))); } catch { /* sin almacenamiento */ }
}

/** Puntuación de una acción para la búsqueda (0 = no coincide). */
function score(a, q) {
  if (!q) return 1;
  const label = fold(a.label), keys = fold((a.keys || []).join(' ')), hay = `${label} ${fold(a.group)} ${fold(a.words)} ${fold(a.hint)} ${keys}`;
  const toks = q.split(/\s+/).filter(Boolean);
  let s = 0;
  for (const t of toks) {
    if (!hay.includes(t)) return 0;
    if (label.startsWith(t)) s += 30;
    else if (new RegExp(`(^|[\\s(/·-])${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).test(label)) s += 20;
    else if (label.includes(t)) s += 10;
    else if ((a.keys || []).some(k => fold(k) === t)) s += 25;    // el atajo exacto (p. ej. «l», «dli», «f3»)
    else s += 3;
  }
  if (a.other) s -= 8;                                               // las del otro espacio de trabajo, después
  return s;
}

const kbd = keys => (keys || []).map(k => `<kbd>${k.replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' })[c])}</kbd>`).join('');

let openEl = null;

/** Abre la paleta. `getActions` se llama al abrir (las acciones dependen del estado del editor). */
export function openPalette(getActions, { placeholder = 'Busca una herramienta o acción…' } = {}) {
  if (openEl) { openEl.querySelector('input').focus(); return; }
  const actions = getActions();
  const wrap = document.createElement('div');
  wrap.className = 'modal-backdrop palette-backdrop';
  wrap.innerHTML = `
    <div class="cmdk" role="dialog" aria-modal="true" aria-label="Buscar acciones">
      <div class="palette-search">
        <svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/></svg>
        <input type="text" spellcheck="false" autocomplete="off" placeholder="${placeholder}" aria-label="Buscar">
        <kbd>Esc</kbd>
      </div>
      <div class="palette-list" role="listbox"></div>
      <div class="palette-foot"><span><kbd>↑</kbd><kbd>↓</kbd> elegir</span><span><kbd>Intro</kbd> ejecutar</span><span><kbd>Ctrl</kbd><kbd>K</kbd> abrir o cerrar</span><span class="palette-count"></span></div>
    </div>`;
  document.body.append(wrap);
  openEl = wrap;
  const input = wrap.querySelector('input'), list = wrap.querySelector('.palette-list'), count = wrap.querySelector('.palette-count');
  let shown = [], cur = 0;

  const close = () => { document.removeEventListener('keydown', onKey, true); wrap.remove(); openEl = null; };
  const run = a => {
    if (!a || (a.enabled && !a.enabled())) return;
    close();
    pushRecent(a.id);
    setTimeout(() => a.run(), 0);
  };
  const render = () => {
    const q = fold(input.value.trim());
    let items = actions.map(a => ({ a, s: score(a, q) })).filter(x => x.s > 0);
    if (q) items.sort((x, y) => y.s - x.s);
    shown = items.map(x => x.a);
    // sin texto: recientes arriba y el resto por grupos (sirve de chuleta de atajos)
    const rec = q ? [] : recent().map(id => actions.find(a => a.id === id)).filter(a => a && !a.other);
    const rows = [];
    let groupNow = null;
    const row = (a, i) => {
      const off = a.enabled && !a.enabled();
      return `<div class="palette-item${i === cur ? ' cur' : ''}${off ? ' off' : ''}" role="option" data-i="${i}" aria-selected="${i === cur}">
        <span class="pi-label">${a.label}${a.hint ? `<small>${a.hint}</small>` : ''}</span>
        <span class="pi-group">${a.other ? `${a.group} · cambia a ${a.other}` : a.group}</span>
        <span class="pi-keys">${kbd(a.keys)}</span></div>`;
    };
    const order = [];
    if (rec.length) { rows.push('<div class="palette-group">Recientes</div>'); rec.forEach(a => { order.push(a); rows.push(row(a, order.length - 1)); }); }
    for (const a of shown) {
      if (!q && a.group !== groupNow) { groupNow = a.group; rows.push(`<div class="palette-group">${a.other ? `${a.group} (${a.other})` : a.group}</div>`); }
      order.push(a);
      rows.push(row(a, order.length - 1));
    }
    shown = order;
    list.classList.toggle('grouped', !q);
    if (cur >= shown.length) cur = Math.max(0, shown.length - 1);
    list.innerHTML = rows.join('') || `<div class="palette-empty">Nada coincide con «${input.value.replace(/[<>&]/g, '')}». Prueba con otra palabra (p. ej. «mover», «cota», «vista»).</div>`;
    list.querySelectorAll('.palette-item').forEach(el => el.classList.toggle('cur', +el.dataset.i === cur));
    count.textContent = `${q ? shown.length : actions.length} acciones`;
    list.querySelector('.palette-item.cur')?.scrollIntoView({ block: 'nearest' });
  };
  const move = d => {
    if (!shown.length) return;
    cur = (cur + d + shown.length) % shown.length;
    list.querySelectorAll('.palette-item').forEach(el => { const on = +el.dataset.i === cur; el.classList.toggle('cur', on); el.setAttribute('aria-selected', on); });
    list.querySelector('.palette-item.cur')?.scrollIntoView({ block: 'nearest' });
  };
  const onKey = e => {
    if (e.key === 'Escape' || ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k')) { e.preventDefault(); e.stopPropagation(); close(); return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); move(1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); move(-1); }
    else if (e.key === 'PageDown') { e.preventDefault(); move(8); }
    else if (e.key === 'PageUp') { e.preventDefault(); move(-8); }
    else if (e.key === 'Enter') { e.preventDefault(); run(shown[cur]); }
    e.stopPropagation();
  };
  input.addEventListener('input', () => { cur = 0; render(); });
  list.addEventListener('pointermove', e => { const it = e.target.closest('.palette-item'); if (it && +it.dataset.i !== cur) { cur = +it.dataset.i; list.querySelectorAll('.palette-item').forEach(el => el.classList.toggle('cur', +el.dataset.i === cur)); } });
  list.addEventListener('click', e => { const it = e.target.closest('.palette-item'); if (it) run(shown[+it.dataset.i]); });
  wrap.addEventListener('pointerdown', e => { if (e.target === wrap) close(); });
  document.addEventListener('keydown', onKey, true);
  render();
  input.focus();
}

export const paletteIsOpen = () => !!openEl;
