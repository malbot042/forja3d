// Editor de perfiles 2D para Extrusión (perfil cerrado) y Revolución (perfil abierto alrededor del eje Y).
import { shapePoints } from './primitives.js';

const TAU = Math.PI * 2;
const r3 = v => Math.round(v * 1000) / 1000;
const poly = (n, r, rot = Math.PI / 2) => Array.from({ length: n }, (_, i) => {
  const a = rot + (i / n) * TAU;
  return [r3(Math.cos(a) * r), r3(Math.sin(a) * r)];
});

export const PRESETS = {
  closed: {
    'Rectángulo': { points: [[-0.6, -0.4], [0.6, -0.4], [0.6, 0.4], [-0.6, 0.4]] },
    'Círculo': { smooth: true, points: poly(8, 0.5) },
    'Hexágono': { points: poly(6, 0.5) },
    'Triángulo': { points: poly(3, 0.55) },
    'Estrella': { points: Array.from({ length: 10 }, (_, i) => {
      const a = Math.PI / 2 + (i / 10) * TAU, r = i % 2 ? 0.22 : 0.55;
      return [r3(Math.cos(a) * r), r3(Math.sin(a) * r)];
    }) },
    'Perfil L': { points: [[-0.5, -0.5], [0.5, -0.5], [0.5, -0.2], [-0.2, -0.2], [-0.2, 0.5], [-0.5, 0.5]] },
    'Perfil T': { points: [[-0.6, 0.5], [0.6, 0.5], [0.6, 0.25], [0.12, 0.25], [0.12, -0.5], [-0.12, -0.5], [-0.12, 0.25], [-0.6, 0.25]] },
    'Perfil U': { points: [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [0.3, 0.5], [0.3, -0.3], [-0.3, -0.3], [-0.3, 0.5], [-0.5, 0.5]] },
    'Perfil I': { points: [[-0.4, -0.5], [0.4, -0.5], [0.4, -0.35], [0.08, -0.35], [0.08, 0.35], [0.4, 0.35], [0.4, 0.5], [-0.4, 0.5], [-0.4, 0.35], [-0.08, 0.35], [-0.08, -0.35], [-0.4, -0.35]] },
    'Flecha': { points: [[-0.6, -0.15], [0.15, -0.15], [0.15, -0.4], [0.6, 0], [0.15, 0.4], [0.15, 0.15], [-0.6, 0.15]] },
    'Engranaje': { points: Array.from({ length: 48 }, (_, i) => {
      const tooth = Math.floor(i / 2) % 2, a = (i / 48) * TAU, r = tooth ? 0.42 : 0.55;
      return [r3(Math.cos(a) * r), r3(Math.sin(a) * r)];
    }) },
    'Corazón': { smooth: true, points: [[0, -0.55], [0.45, -0.05], [0.42, 0.32], [0.2, 0.42], [0, 0.25], [-0.2, 0.42], [-0.42, 0.32], [-0.45, -0.05]] },
  },
  path: {
    'Recta': { points: [[-0.5, 0], [0.5, 0]] },
    'Polilínea en L': { points: [[-0.5, 0.5], [-0.5, -0.5], [0.5, -0.5]] },
    'Zigzag': { points: [[-0.8, -0.2], [-0.4, 0.2], [0, -0.2], [0.4, 0.2], [0.8, -0.2]] },
    'Onda': { smooth: true, points: [[-0.9, 0], [-0.6, 0.25], [-0.3, 0], [0, -0.25], [0.3, 0], [0.6, 0.25], [0.9, 0]] },
    'Arco': { smooth: true, points: [[-0.6, 0], [-0.42, 0.42], [0, 0.6], [0.42, 0.42], [0.6, 0]] },
    'Espiral': { smooth: true, points: Array.from({ length: 22 }, (_, i) => {
      const a = i * 0.6, r = 0.05 + i * 0.03;
      return [r3(Math.cos(a) * r), r3(Math.sin(a) * r)];
    }) },
    'Escalera': { points: [[-0.6, -0.6], [-0.6, -0.3], [-0.3, -0.3], [-0.3, 0], [0, 0], [0, 0.3], [0.3, 0.3], [0.3, 0.6], [0.6, 0.6]] },
    'Rectángulo': { points: [[-0.6, -0.4], [0.6, -0.4], [0.6, 0.4], [-0.6, 0.4]] },
    'Triángulo': { points: poly(3, 0.55) },
    'Estrella': { points: Array.from({ length: 10 }, (_, i) => {
      const a = Math.PI / 2 + (i / 10) * TAU, r = i % 2 ? 0.22 : 0.55;
      return [r3(Math.cos(a) * r), r3(Math.sin(a) * r)];
    }) },
  },
  open: {
    'Jarrón': { smooth: true, points: [[0, 0], [0.4, 0], [0.45, 0.15], [0.3, 0.55], [0.22, 0.85], [0.35, 1.15], [0.3, 1.2], [0, 1.2]] },
    'Copa': { smooth: true, points: [[0, 0], [0.35, 0], [0.35, 0.04], [0.06, 0.08], [0.05, 0.55], [0.3, 0.75], [0.4, 1.1], [0.37, 1.1], [0, 0.72]] },
    'Botella': { points: [[0, 0], [0.35, 0], [0.38, 0.05], [0.38, 0.7], [0.3, 0.85], [0.12, 0.95], [0.11, 1.25], [0.13, 1.28], [0, 1.28]] },
    'Peón': { smooth: true, points: [[0, 0], [0.42, 0], [0.42, 0.1], [0.3, 0.18], [0.16, 0.5], [0.3, 0.58], [0.14, 0.64], [0.24, 0.82], [0.17, 0.98], [0, 1.02]] },
    'Cuenco': { smooth: true, points: [[0, 0], [0.25, 0], [0.45, 0.12], [0.6, 0.4], [0.56, 0.4], [0.42, 0.18], [0.22, 0.06], [0, 0.06]] },
    'Tubo': { points: [[0.3, 0], [0.4, 0], [0.4, 1], [0.3, 1], [0.3, 0]] },
    'Cono truncado': { points: [[0, 0], [0.5, 0], [0.25, 0.8], [0, 0.8]] },
    'Esfera': { smooth: true, points: [[0, -0.5], [0.25, -0.43], [0.43, -0.25], [0.5, 0], [0.43, 0.25], [0.25, 0.43], [0, 0.5]] },
  },
};

/**
 * Abre el editor de perfiles. Resuelve con el nuevo `shape` o `null` si se cancela.
 * @param {'closed'|'open'} mode
 */
export function editShape(initial, mode, title, { closedPath = false } = {}) {
  return new Promise(resolve => {
    const state = {
      points: (initial?.points || []).map(p => [...p]),
      smooth: !!initial?.smooth,
      snap: true,
      view: 1.6,          // semialtura visible en unidades
      cx: 0, cy: mode === 'open' ? 0.6 : 0,
      hover: -1, drag: -1, hoverMid: -1,
    };
    const closed = mode === 'closed' || (mode === 'path' && closedPath);
    const lathe = mode === 'open';
    const filled = mode === 'closed';

    const presetOpts = Object.keys(PRESETS[mode]).map(k => `<option>${k}</option>`).join('');
    const wrap = document.createElement('div');
    wrap.className = 'modal-backdrop';
    wrap.innerHTML = `
      <div class="modal sketch" role="dialog" aria-modal="true" aria-label="${title}">
        <header class="modal-head">
          <h2>${title}</h2>
          <span class="muted">${filled ? 'Perfil cerrado · se dibuja en planta y se extruye hacia arriba' : lathe ? 'Perfil abierto · gira alrededor del eje vertical (línea discontinua)' : `Línea ${closed ? 'cerrada' : 'abierta'} · se dibuja en planta (vista desde arriba)`}</span>
        </header>
        <div class="sketch-body">
          <canvas></canvas>
          <div class="sketch-side">
            <label class="field"><span>Plantilla</span>
              <select data-k="preset"><option value="">— elegir —</option>${presetOpts}</select></label>
            <label class="toggle"><input type="checkbox" data-k="smooth"><span>Curva suave</span></label>
            <label class="toggle"><input type="checkbox" data-k="snap" checked><span>Ajustar a rejilla (0,05)</span></label>
            <div class="sketch-actions">
              <button class="btn sm" data-k="reverse">Invertir orden</button>
              <button class="btn sm" data-k="clear">Vaciar</button>
              <button class="btn sm" data-k="fit">Encuadrar</button>
            </div>
            <ul class="sketch-help">
              <li><b>Clic</b> en vacío: añadir punto al final</li>
              <li><b>Clic</b> en <span class="plus">+</span>: insertar punto en el tramo</li>
              <li><b>Arrastrar</b> un punto: moverlo</li>
              <li><b>Clic derecho</b> / doble clic: borrar punto</li>
              <li><b>Rueda</b>: zoom · <b>botón central</b>: desplazar</li>
            </ul>
            <p class="sketch-info" data-k="info"></p>
          </div>
        </div>
        <footer class="modal-foot">
          <button class="btn" data-k="cancel">Cancelar</button>
          <button class="btn btn-primary" data-k="ok">Aplicar perfil</button>
        </footer>
      </div>`;
    document.body.appendChild(wrap);
    const q = k => wrap.querySelector(`[data-k="${k}"]`);
    const canvas = wrap.querySelector('canvas');
    const ctx = canvas.getContext('2d');
    q('smooth').checked = state.smooth;

    let W = 0, H = 0, dpr = 1;
    const resize = () => {
      const r = canvas.getBoundingClientRect();
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      W = r.width; H = r.height;
      canvas.width = W * dpr; canvas.height = H * dpr;
      draw();
    };
    const scale = () => H / 2 / state.view;
    const toScreen = ([x, y]) => [W / 2 + (x - state.cx) * scale(), H / 2 - (y - state.cy) * scale()];
    const toWorld = (sx, sy) => [state.cx + (sx - W / 2) / scale(), state.cy - (sy - H / 2) / scale()];
    const snapP = ([x, y]) => {
      if (state.snap) { x = Math.round(x / 0.05) * 0.05; y = Math.round(y / 0.05) * 0.05; }
      if (lathe) x = Math.max(0, x);
      return [r3(x), r3(y)];
    };
    const segs = () => {
      const n = state.points.length, out = [];
      for (let i = 0; i < n - 1; i++) out.push([i, i + 1]);
      if (closed && n > 2) out.push([n - 1, 0]);
      return out;
    };

    function draw() {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);
      ctx.fillStyle = '#0f1114';
      ctx.fillRect(0, 0, W, H);
      // rejilla
      const s = scale();
      const step = s * 0.1 < 8 ? 0.5 : 0.1;
      const [x0, y1] = toWorld(0, 0), [x1, y0] = toWorld(W, H);
      ctx.lineWidth = 1;
      for (let gx = Math.floor(x0 / step) * step; gx <= x1; gx += step) {
        const major = Math.abs(gx / 0.5 - Math.round(gx / 0.5)) < 1e-6;
        ctx.strokeStyle = major ? '#2a2f36' : '#1a1d22';
        const [sx] = toScreen([gx, 0]);
        ctx.beginPath(); ctx.moveTo(Math.round(sx) + 0.5, 0); ctx.lineTo(Math.round(sx) + 0.5, H); ctx.stroke();
      }
      for (let gy = Math.floor(y0 / step) * step; gy <= y1; gy += step) {
        const major = Math.abs(gy / 0.5 - Math.round(gy / 0.5)) < 1e-6;
        ctx.strokeStyle = major ? '#2a2f36' : '#1a1d22';
        const [, sy] = toScreen([0, gy]);
        ctx.beginPath(); ctx.moveTo(0, Math.round(sy) + 0.5); ctx.lineTo(W, Math.round(sy) + 0.5); ctx.stroke();
      }
      // ejes
      const [ox, oy] = toScreen([0, 0]);
      ctx.strokeStyle = lathe ? '#e5614f55' : '#e5614f88';
      ctx.beginPath(); ctx.moveTo(0, oy); ctx.lineTo(W, oy); ctx.stroke();
      ctx.strokeStyle = lathe ? '#6fbf73' : '#5b9bea88';
      if (lathe) { ctx.setLineDash([6, 5]); ctx.lineWidth = 1.5; }
      ctx.beginPath(); ctx.moveTo(ox, 0); ctx.lineTo(ox, H); ctx.stroke();
      ctx.setLineDash([]); ctx.lineWidth = 1;
      if (lathe) { ctx.fillStyle = 'rgba(229,97,79,.05)'; ctx.fillRect(0, 0, ox, H); }

      const pts = state.points;
      // relleno / silueta resultante (con suavizado)
      const curve = shapePoints({ points: pts, smooth: state.smooth }, closed);
      if (curve.length > 1) {
        ctx.beginPath();
        curve.forEach((p, i) => { const [sx, sy] = toScreen(p); i ? ctx.lineTo(sx, sy) : ctx.moveTo(sx, sy); });
        if (closed) {
          ctx.closePath();
          if (filled) { ctx.fillStyle = 'rgba(242,165,65,.12)'; ctx.fill(); }
        } else if (lathe) {
          // simetría (fantasma) para la revolución
          ctx.save();
          ctx.strokeStyle = 'rgba(242,165,65,.25)'; ctx.setLineDash([4, 4]);
          ctx.beginPath();
          curve.forEach((p, i) => { const [sx, sy] = toScreen([-p[0], p[1]]); i ? ctx.lineTo(sx, sy) : ctx.moveTo(sx, sy); });
          ctx.stroke(); ctx.restore();
          ctx.beginPath();
          curve.forEach((p, i) => { const [sx, sy] = toScreen(p); i ? ctx.lineTo(sx, sy) : ctx.moveTo(sx, sy); });
        }
        ctx.strokeStyle = '#f2a541'; ctx.lineWidth = 2; ctx.stroke(); ctx.lineWidth = 1;
      }
      // polígono de control si es suave
      if (state.smooth && pts.length > 1) {
        ctx.strokeStyle = 'rgba(255,255,255,.18)'; ctx.setLineDash([3, 3]);
        ctx.beginPath();
        pts.forEach((p, i) => { const [sx, sy] = toScreen(p); i ? ctx.lineTo(sx, sy) : ctx.moveTo(sx, sy); });
        if (closed) ctx.closePath();
        ctx.stroke(); ctx.setLineDash([]);
      }
      // puntos medios (+)
      segs().forEach(([a, b], i) => {
        const [sx, sy] = toScreen([(pts[a][0] + pts[b][0]) / 2, (pts[a][1] + pts[b][1]) / 2]);
        ctx.fillStyle = i === state.hoverMid ? '#f2a541' : '#3a4049';
        ctx.beginPath(); ctx.arc(sx, sy, 5, 0, TAU); ctx.fill();
        ctx.strokeStyle = i === state.hoverMid ? '#1a1307' : '#c9ced6'; ctx.lineWidth = 1.4;
        ctx.beginPath(); ctx.moveTo(sx - 2.5, sy); ctx.lineTo(sx + 2.5, sy); ctx.moveTo(sx, sy - 2.5); ctx.lineTo(sx, sy + 2.5); ctx.stroke();
        ctx.lineWidth = 1;
      });
      // vértices
      pts.forEach((p, i) => {
        const [sx, sy] = toScreen(p);
        ctx.fillStyle = i === state.drag || i === state.hover ? '#f2a541' : '#e6e8eb';
        ctx.strokeStyle = '#0f1114'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(sx, sy, i === 0 ? 6 : 5, 0, TAU); ctx.fill(); ctx.stroke();
        ctx.lineWidth = 1;
      });
      if (pts.length) {
        const [sx, sy] = toScreen(pts[0]);
        ctx.fillStyle = '#8c939d'; ctx.font = '11px ui-monospace, monospace';
        ctx.fillText('inicio', sx + 9, sy - 8);
      }
      const minPts = closed ? 3 : 2;
      const hoverPt = state.drag >= 0 ? pts[state.drag] : state.hover >= 0 ? pts[state.hover] : null;
      q('info').textContent = `${pts.length} puntos` + (hoverPt ? ` · (${hoverPt[0].toFixed(2)}, ${hoverPt[1].toFixed(2)})` : '') +
        (pts.length < minPts ? ` · faltan ${minPts - pts.length} como mínimo` : '');
      q('ok').disabled = pts.length < minPts;
    }

    const hit = (sx, sy) => state.points.findIndex(p => { const [px, py] = toScreen(p); return Math.hypot(px - sx, py - sy) < 9; });
    const hitMid = (sx, sy) => segs().findIndex(([a, b]) => {
      const p = state.points;
      const [px, py] = toScreen([(p[a][0] + p[b][0]) / 2, (p[a][1] + p[b][1]) / 2]);
      return Math.hypot(px - sx, py - sy) < 8;
    });
    const local = e => { const r = canvas.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };

    let pan = null;
    canvas.addEventListener('contextmenu', e => e.preventDefault());
    canvas.addEventListener('pointerdown', e => {
      const [sx, sy] = local(e);
      canvas.setPointerCapture(e.pointerId);
      if (e.button === 1) { pan = { sx, sy, cx: state.cx, cy: state.cy }; return; }
      const i = hit(sx, sy);
      if (e.button === 2) {
        if (i >= 0) { state.points.splice(i, 1); state.hover = -1; draw(); }
        return;
      }
      if (i >= 0) { state.drag = i; return; }
      const m = hitMid(sx, sy);
      if (m >= 0) {
        const [a, b] = segs()[m];
        const p = state.points;
        const np = snapP([(p[a][0] + p[b][0]) / 2, (p[a][1] + p[b][1]) / 2]);
        p.splice(b === 0 ? p.length : b, 0, np);
        state.drag = b === 0 ? p.length - 1 : b;
        draw();
        return;
      }
      state.points.push(snapP(toWorld(sx, sy)));
      state.drag = state.points.length - 1;
      draw();
    });
    canvas.addEventListener('pointermove', e => {
      const [sx, sy] = local(e);
      if (pan) {
        state.cx = pan.cx - (sx - pan.sx) / scale();
        state.cy = pan.cy + (sy - pan.sy) / scale();
      } else if (state.drag >= 0) {
        state.points[state.drag] = snapP(toWorld(sx, sy));
      } else {
        state.hover = hit(sx, sy);
        state.hoverMid = state.hover >= 0 ? -1 : hitMid(sx, sy);
        canvas.style.cursor = state.hover >= 0 ? 'grab' : state.hoverMid >= 0 ? 'copy' : 'crosshair';
      }
      draw();
    });
    canvas.addEventListener('pointerup', () => { state.drag = -1; pan = null; draw(); });
    canvas.addEventListener('dblclick', e => {
      const i = hit(...local(e));
      if (i >= 0) { state.points.splice(i, 1); draw(); }
    });
    canvas.addEventListener('wheel', e => {
      e.preventDefault();
      const [sx, sy] = local(e);
      const before = toWorld(sx, sy);
      state.view = Math.min(50, Math.max(0.2, state.view * (e.deltaY > 0 ? 1.12 : 1 / 1.12)));
      const after = toWorld(sx, sy);
      state.cx += before[0] - after[0];
      state.cy += before[1] - after[1];
      draw();
    }, { passive: false });

    function fit() {
      const pts = state.points;
      if (!pts.length) return;
      const xs = pts.map(p => p[0]).concat(lathe ? [0] : []), ys = pts.map(p => p[1]);
      const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
      state.cx = (minX + maxX) / 2; state.cy = (minY + maxY) / 2;
      state.view = Math.max(0.4, Math.max((maxY - minY) / 2, (maxX - minX) / 2 * (H / W)) * 1.35);
      draw();
    }

    q('preset').onchange = e => {
      const p = PRESETS[mode][e.target.value];
      if (!p) return;
      state.points = p.points.map(v => [...v]);
      state.smooth = !!p.smooth;
      q('smooth').checked = state.smooth;
      e.target.value = '';
      fit();
    };
    q('smooth').onchange = e => { state.smooth = e.target.checked; draw(); };
    q('snap').onchange = e => { state.snap = e.target.checked; };
    q('reverse').onclick = () => { state.points.reverse(); draw(); };
    q('clear').onclick = () => { state.points = []; draw(); };
    q('fit').onclick = fit;

    const close = result => {
      window.removeEventListener('resize', resize);
      document.removeEventListener('keydown', onKey, true);
      wrap.remove();
      resolve(result);
    };
    const onKey = e => {
      if (e.key === 'Escape') { e.stopPropagation(); close(null); }
      else if (e.key === 'Enter' && !q('ok').disabled) { e.stopPropagation(); q('ok').click(); }
      else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault(); e.stopPropagation(); state.points.pop(); draw();
      }
      if (!e.target.closest('select')) e.stopPropagation();
    };
    document.addEventListener('keydown', onKey, true);
    q('cancel').onclick = () => close(null);
    q('ok').onclick = () => close({ smooth: state.smooth, points: state.points.map(p => [r3(p[0]), r3(p[1])]) });
    wrap.addEventListener('pointerdown', e => { if (e.target === wrap) close(null); });

    window.addEventListener('resize', resize);
    requestAnimationFrame(() => { resize(); fit(); });
  });
}
