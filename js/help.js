// Ayuda integrada: guía por secciones, atajos y ejemplos que se abren como proyectos.
import { defaultParams } from './primitives.js';
import { PRESETS } from './sketch.js';
import * as store from './storage.js';

// ------------------------------------------------------------------ ejemplos
const mat = (color, extra = {}) => ({ color, metalness: 0.05, roughness: 0.6, opacity: 1, flatShading: false, ...extra });

function obj(type, name, params = {}, { p = [0, 0, 0], r = [0, 0, 0], s = [1, 1, 1], color = '#d9d4c7', m = {}, shape } = {}) {
  const o = { id: store.uid(), name, type, params: { ...defaultParams(type), ...params },
    position: p, rotation: r, scale: s, material: mat(color, m), visible: true };
  if (shape) o.shape = structuredClone(shape);
  return o;
}

/** Objeto booleano; `p` es su pivote (los operandos se guardan relativos a él). */
function bool(op, name, operands, p = [0, 0, 0], material) {
  return {
    id: store.uid(), name, type: 'boolean', params: { op },
    operands: operands.map(o => ({ ...o, position: o.position.map((v, i) => +(v - p[i]).toFixed(4)) })),
    position: p, rotation: [0, 0, 0], scale: [1, 1, 1],
    material: material || operands[0].material, visible: true,
  };
}

const halfSpace = y => ({
  ...obj('box', 'Semiespacio', { width: 1000, height: 1000, depth: 1000 }, { p: [0, y + 500, 0] }), helper: true,
});

const hexagon = { points: [[0.5, 0], [0.25, 0.433], [-0.25, 0.433], [-0.5, 0], [-0.25, -0.433], [0.25, -0.433]] };

export const EXAMPLES = [
  {
    key: 'taza',
    name: 'Taza',
    summary: 'Unir y Restar: un cilindro unido a un toro (asa) y vaciado con otro cilindro.',
    steps: [
      'Añade un <b>Cilindro</b> (cuerpo): radio sup. 0,5 · radio inf. 0,45 · altura 1.',
      'Añade un <b>Toro</b> (asa): radio 0,25 · grosor 0,06. Muévelo a X = 0,52, Y = 0,5 para que asome por un lado.',
      'Selecciona el cuerpo y, con <kbd>Mayús</kbd>+clic, el asa. Pulsa <b>Unir</b>.',
      'Añade otro <b>Cilindro</b> algo más estrecho (radios 0,43 / 0,38) y súbelo a Y = 0,58 para que deje fondo.',
      'Selecciona primero la unión y después el cilindro interior, y pulsa <b>Restar</b>. ¡Ya tienes la taza!',
    ],
    camera: { position: [2.4, 2.2, 2.6], target: [0, 0.5, 0] },
    build() {
      const color = '#f4efe6';
      const body = obj('cylinder', 'Cuerpo', { radiusTop: 0.5, radiusBottom: 0.45, height: 1, radialSegments: 48 }, { p: [0, 0.5, 0], color });
      const handle = obj('torus', 'Asa', { radius: 0.25, tube: 0.06, radialSegments: 16, tubularSegments: 48 }, { p: [0.52, 0.5, 0], color });
      const inner = obj('cylinder', 'Interior', { radiusTop: 0.43, radiusBottom: 0.38, height: 1, radialSegments: 48 }, { p: [0, 0.58, 0], color });
      const cup = bool('subtract', 'Taza', [bool('union', 'Cuerpo y asa', [body, handle], [0.1, 0.5, 0]), inner], [0.1, 0.5, 0]);
      const plate = obj('cylinder', 'Plato', { radiusTop: 0.85, radiusBottom: 0.6, height: 0.06, radialSegments: 48 }, { p: [0, -0.03, 0], color: '#5b9bea' });
      return [cup, plate];
    },
  },
  {
    key: 'dado',
    name: 'Dado',
    summary: 'Intersecar para redondear un cubo y Restar varias esferas a la vez para los puntos.',
    steps: [
      'Añade un <b>Cubo</b> 1×1×1 y una <b>Esfera</b> de radio 0,68 en el mismo centro (Y = 0,5).',
      'Selecciona ambos y pulsa <b>Intersecar</b>: queda un cubo con las esquinas redondeadas.',
      'Añade esferas pequeñas (radio 0,09) centradas en las caras: 1 arriba, 2 delante, 3 a la derecha. Usa <kbd>Ctrl</kbd>+<kbd>D</kbd> para duplicarlas.',
      'Selecciona primero el cubo redondeado y luego todas las esferas pequeñas (<kbd>Mayús</kbd>+clic en la lista).',
      'Pulsa <b>Restar</b>: todas se restan de una vez. El primer objeto seleccionado (A) siempre es la base.',
    ],
    camera: { position: [2, 1.9, 2.3], target: [0, 0.5, 0] },
    build() {
      const color = '#f4efe6';
      const cube = obj('box', 'Cubo', {}, { p: [0, 0.5, 0], color });
      const ball = obj('sphere', 'Esfera', { radius: 0.68, widthSegments: 48, heightSegments: 32 }, { p: [0, 0.5, 0], color });
      const rounded = bool('intersect', 'Cubo redondeado', [cube, ball], [0, 0.5, 0]);
      const pip = (p, i) => obj('sphere', `Punto ${i}`, { radius: 0.09, widthSegments: 16, heightSegments: 12 }, { p, color: '#3b3f45' });
      const pips = [[0, 1, 0], [-0.22, 0.72, 0.5], [0.22, 0.28, 0.5], [0.5, 0.75, -0.25], [0.5, 0.5, 0], [0.5, 0.25, 0.25]].map(pip);
      return [bool('subtract', 'Dado', [rounded, ...pips], [0, 0.5, 0])];
    },
  },
  {
    key: 'tuerca',
    name: 'Tuerca y tornillo',
    summary: 'Extrusión de un hexágono con bisel, Restar un cilindro (agujero) y Unir cabeza y vástago.',
    steps: [
      'Pulsa <b>Extrusión</b>. En el editor de perfiles elige la plantilla <b>Hexágono</b> y pulsa <b>Aplicar perfil</b>.',
      'En Propiedades pon Altura 0,35 y Bisel 0,02. Material: color gris, Metalizado 0,8.',
      'Añade un <b>Cilindro</b> de radio 0,22 y altura 1 en el mismo centro. Selecciona el hexágono, luego el cilindro, y pulsa <b>Restar</b>: tuerca hecha.',
      'Para el tornillo: duplica el hexágono (<kbd>Ctrl</kbd>+<kbd>D</kbd>), añade un cilindro largo (radio 0,2, altura 1,2) debajo y pulsa <b>Unir</b>.',
      'Usa la vista <b>Alzado</b> (<kbd>1</kbd>) en ortográfica para alinear la cabeza con el vástago con precisión.',
    ],
    camera: { position: [2.6, 2.2, 3], target: [0.7, 0.5, 0] },
    build() {
      const m = { metalness: 0.45, roughness: 0.35 };
      const hex = (name, p) => obj('extrude', name, { depth: 0.35, bevel: 0.02, bevelSegments: 2 }, { p, color: '#8a8f98', m, shape: hexagon });
      const nut = bool('subtract', 'Tuerca', [
        hex('Hexágono', [0, 0.195, 0]),
        obj('cylinder', 'Agujero', { radiusTop: 0.22, radiusBottom: 0.22, height: 1, radialSegments: 32 }, { p: [0, 0.195, 0] }),
      ], [0, 0.195, 0]);
      const bolt = bool('union', 'Tornillo', [
        hex('Cabeza', [1.4, 1.395, 0]),
        obj('cylinder', 'Vástago', { radiusTop: 0.2, radiusBottom: 0.2, height: 1.2, radialSegments: 32 }, { p: [1.4, 0.6, 0], color: '#8a8f98', m }),
      ], [1.4, 0.8, 0]);
      return [nut, bolt];
    },
  },
  {
    key: 'casa',
    name: 'Casa',
    summary: 'Restar puerta y ventanas de un bloque, tejado con una Pirámide escalada y varias piezas sueltas.',
    steps: [
      'Añade un <b>Cubo</b> para las paredes: ancho 2 · alto 1,2 · fondo 1,6.',
      'Añade una <b>Pirámide</b> (4 lados, radio 1,45, altura 0,8), escálala en Z a 0,82 y apóyala sobre las paredes (Y = 1,6).',
      'Crea la puerta y dos ventanas con cubos que atraviesen la fachada delantera.',
      'Selecciona las paredes y luego puerta y ventanas; pulsa <b>Restar</b>.',
      'Añade una chimenea con un cubo estrecho. Comprueba la composición con <b>Planta</b> (<kbd>7</kbd>) y <b>Perfil</b> (<kbd>3</kbd>).',
    ],
    camera: { position: [3.4, 2.6, 4.2], target: [0, 0.8, 0] },
    build() {
      const walls = obj('box', 'Paredes', { width: 2, height: 1.2, depth: 1.6 }, { p: [0, 0.6, 0], color: '#e8dcc4' });
      const holes = [
        obj('box', 'Puerta', { width: 0.4, height: 0.7, depth: 0.4 }, { p: [0, 0.35, 0.8] }),
        obj('box', 'Ventana izq.', { width: 0.4, height: 0.35, depth: 0.4 }, { p: [-0.6, 0.75, 0.8] }),
        obj('box', 'Ventana dcha.', { width: 0.4, height: 0.35, depth: 0.4 }, { p: [0.6, 0.75, 0.8] }),
      ];
      return [
        bool('subtract', 'Fachada', [walls, ...holes], [0, 0.6, 0]),
        obj('pyramid', 'Tejado', { radius: 1.45, height: 0.8, sides: 4 }, { p: [0, 1.6, 0], s: [1, 1, 0.82], color: '#b4553f' }),
        obj('box', 'Chimenea', { width: 0.2, height: 0.6, depth: 0.2 }, { p: [0.55, 1.75, -0.2], color: '#8b5a3c' }),
        obj('plane', 'Jardín', { width: 4, height: 3.4 }, { p: [0, 0.001, 0.3], r: [-90, 0, 0], color: '#6fbf73' }),
      ];
    },
  },
  {
    key: 'torno',
    name: 'Piezas de torno',
    summary: 'Revolución: jarrón, copa y peón a partir de medio perfil girado alrededor del eje.',
    steps: [
      'Pulsa <b>Revolución</b>. Se abre el editor con un perfil de jarrón: la línea discontinua verde es el eje de giro.',
      'Arrastra los puntos para cambiar la silueta; haz clic en los <b>+</b> para añadir puntos intermedios. Activa <b>Curva suave</b> para redondear.',
      'Prueba las plantillas <b>Copa</b> y <b>Peón</b>. Empieza y termina el perfil sobre el eje (x = 0) para que la pieza quede cerrada.',
      'En Propiedades, <b>Ángulo</b> menor de 360° deja la pieza abierta, útil para ver un corte.',
      'Pulsa <b>Editar perfil…</b> en cualquier momento para volver a modificarlo.',
    ],
    camera: { position: [0.6, 2, 4.6], target: [0, 0.55, 0] },
    build() {
      const lathe = (name, preset, p, color, params = {}) =>
        obj('lathe', name, { segments: 48, ...params }, { p, color, shape: PRESETS.open[preset] });
      return [
        lathe('Jarrón', 'Jarrón', [-1.8, 0.6, 0], '#3fa7a0'),
        lathe('Copa', 'Copa', [-0.6, 0.55, 0], '#c56bd1'),
        lathe('Peón', 'Peón', [0.6, 0.51, 0], '#3b3f45'),
        lathe('Jarrón en corte', 'Jarrón', [1.8, 0.6, 0], '#f2a541', { angle: 270 }),
      ];
    },
  },
  {
    key: 'naranja',
    name: 'Naranja partida',
    summary: 'Partir una esfera con un plano y separar las mitades; Restar para vaciarla.',
    steps: [
      'Añade una <b>Esfera</b> (radio 0,6) y otra algo menor (0,55) en el mismo centro.',
      'Selecciona la grande y luego la pequeña y pulsa <b>Restar</b>: queda una cáscara hueca.',
      'Con la cáscara seleccionada pulsa <b>Partir</b>: se corta en horizontal por el centro y salen dos piezas (A y B).',
      'Para cortar con otro ángulo, añade un <b>Plano</b>, gíralo y selecciónalo junto al objeto antes de pulsar <b>Partir</b>.',
      'Sube y gira la mitad superior para ver el interior. <b>Separar</b> devuelve las piezas originales.',
    ],
    camera: { position: [2.2, 1.9, 2.4], target: [0, 0.7, 0] },
    build() {
      const color = '#f2a541';
      const outer = obj('sphere', 'Piel', { radius: 0.6, widthSegments: 40, heightSegments: 24 }, { p: [0, 0.6, 0], color });
      const inner = obj('sphere', 'Hueco', { radius: 0.55, widthSegments: 40, heightSegments: 24 }, { p: [0, 0.6, 0] });
      const shell = bool('subtract', 'Cáscara', [outer, inner], [0, 0.6, 0]);
      const top = bool('intersect', 'Mitad superior', [shell, halfSpace(0.6)], [0, 0.9, 0]);
      const bottom = bool('subtract', 'Mitad inferior', [shell, halfSpace(0.6)], [0, 0.3, 0]);
      top.position = [0.35, 1.25, -0.2];
      top.rotation = [-35, 0, 15];
      const pulp = obj('sphere', 'Pulpa', { radius: 0.55, widthSegments: 40, heightSegments: 12, }, { p: [0, 0.6, 0], s: [1, 0.02, 1], color: '#f6c86a' });
      return [bottom, top, pulp];
    },
  },
];

export function createExampleProject(key) {
  const ex = EXAMPLES.find(e => e.key === key);
  if (!ex) return null;
  return store.importProjectData({
    name: `Ejemplo · ${ex.name}`,
    objects: ex.build(),
    camera: { ...ex.camera, projection: 'persp', view: 'free' },
    settings: { view: 'solid', grid: true, snap: false },
  });
}

// ------------------------------------------------------------------ contenido
const k = (...keys) => keys.map(x => `<kbd>${x}</kbd>`).join('+');
const exBtn = key => `<button class="btn sm btn-example" data-example="${key}">Abrir ejemplo «${EXAMPLES.find(e => e.key === key).name}»</button>`;

const SECTIONS = [
  {
    id: 'inicio', title: 'Primeros pasos',
    html: `
      <p class="lead">Forja 3D es un editor 3D que funciona en el navegador. Construyes modelos combinando piezas básicas (primitivas), perfiles extruidos o torneados y operaciones booleanas.</p>
      <h4>La pantalla del editor</h4>
      <ul class="areas">
        <li><span class="tag">Barra superior</span> nombre del proyecto, deshacer/rehacer, herramienta (Mover · Rotar · Escalar), modo de vista (Sólido · Wire), Snap, Rejilla y Descargar JSON.</li>
        <li><span class="tag">Izquierda</span> primitivas: un clic añade la pieza en el centro de la vista, apoyada en el suelo.</li>
        <li><span class="tag">Visor</span> arriba, las <b>operaciones</b> (Unir, Restar…); abajo, las <b>vistas</b> (Alzado, Planta…); arriba a la derecha, el <b>navegador de ejes</b>.</li>
        <li><span class="tag">Derecha</span> la lista de objetos de la escena y las propiedades del seleccionado.</li>
      </ul>
      <h4>Tu primer modelo en 1 minuto</h4>
      <ol class="steps">
        <li>Pulsa <b>Cubo</b> en la barra izquierda.</li>
        <li>Pulsa <b>Esfera</b> y arrástrala con la flecha verde del gizmo hasta que asome por encima del cubo.</li>
        <li>Haz clic en el cubo y luego <kbd>Mayús</kbd>+clic en la esfera.</li>
        <li>Pulsa <b>Restar</b> en la barra de operaciones: el cubo queda con un hueco esférico.</li>
        <li>Pulsa <kbd>Ctrl</kbd>+<kbd>Z</kbd> para deshacer, o <b>Separar</b> para recuperar las dos piezas.</li>
      </ol>
      <p>La forma más rápida de aprender es abrir un ejemplo terminado y desmontarlo con <b>Separar</b>. Están en la sección <a href="#" data-goto="ejemplos">Ejemplos guiados</a>.</p>`,
  },
  {
    id: 'proyectos', title: 'Proyectos y guardado',
    html: `
      <p>Cada modelo es un <b>proyecto</b>. La pantalla de proyectos (botón <b>‹</b> de la barra superior) muestra todos con su miniatura.</p>
      <ul>
        <li><b>+ Nuevo proyecto</b>: crea uno vacío y lo abre.</li>
        <li>En cada tarjeta: <b>Abrir</b>, <b>Renombrar</b>, <b>Duplicar</b> (para probar variantes sin perder el original), <b>JSON</b> (descarga) y <b>Eliminar</b>.</li>
        <li>El nombre también se cambia haciendo clic sobre él en la barra superior del editor.</li>
      </ul>
      <h4>Guardado automático</h4>
      <p>Todo se guarda solo en el almacenamiento del navegador (<code>localStorage</code>) medio segundo después de cada cambio; junto al nombre verás <i>Guardando…</i> y luego <i>Guardado</i>. <kbd>Ctrl</kbd>+<kbd>S</kbd> fuerza el guardado.</p>
      <div class="callout">Los proyectos viven en <b>este navegador</b>: otro navegador, otro equipo o una ventana privada no los verán. Descarga copias en JSON de lo que te importe; el espacio suele limitarse a unos 5 MB.</div>
      <h4>Exportar e importar</h4>
      <ul>
        <li><b>Descargar JSON</b> (editor) o <b>JSON</b> (tarjeta): un archivo <code>.forja3d.json</code> con el proyecto.</li>
        <li><b>Exportar todo</b>: un único archivo con todos los proyectos (copia de seguridad).</li>
        <li><b>Importar JSON</b>: acepta tanto un proyecto como el archivo de «Exportar todo». Lo importado se añade como proyecto nuevo, nunca sobrescribe.</li>
      </ul>`,
  },
  {
    id: 'primitivas', title: 'Primitivas y propiedades',
    html: `
      <p>Hay 14 piezas 3D: <b>Cubo, Esfera, Cilindro, Cono, Pirámide, Toro, Cápsula, Plano, Anillo, Tetraedro, Octaedro, Dodecaedro, Icosaedro</b> y <b>Nudo</b>, y 2 primitivas 2D: <b>Círculo 2D</b> y <b>Línea 2D</b>. Además, <a href="#" data-goto="extrusion">Extrusión</a> y <a href="#" data-goto="revolucion">Revolución</a> crean piezas a partir de un perfil dibujado.</p>
      <h4>Primitivas 2D</h4>
      <p>Se dibujan planas sobre el suelo (vistas desde arriba, en <b>Planta</b> con <kbd>7</kbd>). Sirven para bocetos, contornos, marcas, caminos, como guía para colocar piezas 3D o como base para <b>extruir</b> o <b>revolucionar</b>.</p>
      <ul>
        <li><b>Círculo 2D</b>: por defecto es un contorno con <b>Grosor línea</b> ajustable. Activa <b>Relleno</b> para un disco. Con <b>Ángulo</b> menor de 360° obtienes un arco (o un sector, si está relleno); pocos <b>Segmentos</b> dan polígonos (6 = hexágono).</li>
        <li><b>Línea 2D</b>: al añadirla se abre el editor de trazado. Haz clic para ir añadiendo puntos (polilínea), activa <b>Curva suave</b> para trazos curvos o elige una plantilla: recta, L, zigzag, onda, arco, espiral, escalera… En Propiedades ajusta el <b>Grosor</b> y marca <b>Cerrada</b> para unir el último punto con el primero. <b>Editar trazado…</b> lo vuelve a abrir.</li>
      </ul>
      <p>Ejemplos: un <b>reloj</b> = Círculo 2D (radio 1) + 12 Líneas 2D cortas giradas de 30° en 30°; un <b>camino de jardín</b> = Línea 2D con plantilla <i>Onda</i> y grosor 0,3; una <b>señal de prohibido</b> = Círculo 2D con grosor 0,15 + Línea 2D recta girada 45°.</p>
      <h4>De 2D a 3D: Extruir y Revolución</h4>
      <p>Selecciona una Línea 2D o un Círculo 2D y pulsa <b>Extruir</b> o <b>Revolución</b> en la barra de operaciones (o los botones del panel de propiedades). Se abre un diálogo para elegir la forma:</p>
      <ul>
        <li><b>Extruir una línea abierta</b> → <b>pared</b> con el grosor de la línea (ideal para muros a partir de un plano en planta).</li>
        <li><b>Extruir una línea cerrada</b> → <b>sólido relleno</b> (el contorno se rellena) o <b>pared</b> (solo el contorno, hueco por dentro: una habitación, una caja sin tapa).</li>
        <li><b>Extruir un círculo</b> → <b>cilindro</b> o <b>tubo</b>; si es un arco, un sector o una pared curva.</li>
        <li><b>Revolución de una línea</b> → gira alrededor de su eje vertical (la línea x = 0 del editor de trazados). Abierta: superficie o pieza con grosor; cerrada: sólido (un trazado separado del eje da un anillo o toro).</li>
        <li><b>Revolución de un círculo</b> → esfera maciza o hueca.</li>
      </ul>
      <p>El resultado es una Extrusión o una Revolución normal: sigues pudiendo cambiar la altura, el bisel, el ángulo o el perfil con <b>Editar perfil…</b>. Marca <i>Conservar el elemento 2D</i> si quieres reutilizar el dibujo (quedará oculto en la lista).</p>
      <h4>Ejemplo: muros de una casa desde la planta</h4>
      <ol class="steps">
        <li>Pulsa ${k('7')} (Planta) y añade una <b>Línea 2D</b>; elige la plantilla <b>Rectángulo</b> y aplica.</li>
        <li>En Propiedades marca <b>Cerrada</b> y pon Grosor 0,15.</li>
        <li>Pulsa <b>Extruir</b>, elige <b>Pared</b>, Altura 1,2 y acepta: tienes los cuatro muros.</li>
        <li>Resta cubos para abrir puertas y ventanas (ver <a href="#" data-goto="booleanas">Operaciones booleanas</a>).</li>
      </ol>
      <h4>Ejemplo: un anillo con revolución</h4>
      <ol class="steps">
        <li>Añade una <b>Línea 2D</b>, plantilla <b>Rectángulo</b>, y en el editor arrastra los cuatro puntos a la derecha del eje (por ejemplo entre x = 0,4 y x = 0,6).</li>
        <li>Marca <b>Cerrada</b> y pulsa <b>Revolución</b>: obtienes un anillo de sección rectangular.</li>
      </ol>
      <h4>Panel de propiedades</h4>
      <ul>
        <li><b>Objeto</b>: nombre y tipo.</li>
        <li><b>Transformación</b>: posición, rotación (grados) y escala exactas.</li>
        <li><b>Geometría</b>: los parámetros propios de cada pieza (radios, alturas, número de segmentos…).</li>
        <li><b>Material</b>: color (o paleta rápida), metalizado, rugosidad, opacidad y <b>sombreado plano</b> (aspecto facetado, estilo low-poly).</li>
      </ul>
      <h4>Trucos para editar números</h4>
      <ul>
        <li>Escribe el valor y pulsa <kbd>Intro</kbd>.</li>
        <li><b>Arrastra horizontalmente</b> sobre la etiqueta (X, Y, Z o ↔) para cambiar el valor deslizando; con <kbd>Mayús</kbd> pulsada el ajuste es 10 veces más fino.</li>
      </ul>
      <h4>Ejemplos</h4>
      <ul>
        <li><b>Esfera low-poly</b>: Esfera con 8 seg. horizontales, 6 verticales y <i>Sombreado plano</i>.</li>
        <li><b>Tubo</b>: Cilindro con radio superior igual al inferior y muchos segmentos; para un <b>cono truncado</b> pon radios distintos.</li>
        <li><b>Prisma triangular</b>: Cilindro con 3 segmentos.</li>
        <li><b>Gema</b>: Octaedro escalado en Y a 1,5.</li>
      </ul>`,
  },
  {
    id: 'transformar', title: 'Seleccionar y transformar',
    html: `
      <h4>Seleccionar</h4>
      <ul>
        <li><b>Clic</b> en un objeto (visor o lista) lo selecciona; clic en vacío o <kbd>Esc</kbd> quita la selección.</li>
        <li><kbd>Mayús</kbd>+clic o <kbd>Ctrl</kbd>+clic añade o quita objetos: <b>selección múltiple</b>. <kbd>Ctrl</kbd>+<kbd>A</kbd> selecciona todo.</li>
        <li>El <b>orden importa</b>: el primero seleccionado es la base (A) de las operaciones booleanas. El panel muestra el orden con letras A, B, C…</li>
        <li>Doble clic en la lista encuadra el objeto; el icono del ojo lo oculta o muestra.</li>
      </ul>
      <h4>Mover, rotar y escalar</h4>
      <ul>
        <li>${k('W')} Mover · ${k('E')} Rotar · ${k('R')} Escalar. Arrastra una flecha/anillo/cubo del gizmo para un solo eje, o un cuadrado para un plano.</li>
        <li>Con varios objetos seleccionados el gizmo actúa sobre <b>todo el grupo</b> (gira alrededor del último seleccionado).</li>
        <li><b>Snap</b> (${k('G')}): mueve en pasos de 0,25, gira de 15° en 15° y escala de 0,1 en 0,1.</li>
        <li><b>Reflejar X/Y/Z</b>: crea la imagen en espejo (escala negativa). Combinado con <kbd>Ctrl</kbd>+<kbd>D</kbd> sirve para piezas simétricas.</li>
        <li><b>Al suelo</b>: apoya los objetos sobre la rejilla (Y = 0).</li>
        <li>${k('Ctrl', 'D')} duplica · ${k('Supr')} elimina.</li>
      </ul>
      <h4>Ejemplo: cuatro patas simétricas</h4>
      <ol class="steps">
        <li>Añade un Cilindro (radio 0,05, altura 0,7) y colócalo en X = 0,6, Z = 0,4.</li>
        <li>${k('Ctrl', 'D')} y en Posición escribe X = −0,6. Repite para Z = −0,4.</li>
        <li>Añade un Cubo de 1,5 × 0,08 × 1 encima (Y = 0,74): ya tienes una mesa. Selecciónalo todo y pulsa <b>Unir</b> si quieres una sola pieza.</li>
      </ol>`,
  },
  {
    id: 'vistas', title: 'Vistas y cámara',
    html: `
      <h4>Moverse por la escena</h4>
      <ul>
        <li><b>Botón izquierdo</b> arrastrando: orbitar · <b>botón derecho</b>: desplazar · <b>rueda</b>: zoom.</li>
        <li>${k('F')} <b>Encuadrar</b>: centra la vista en la selección (o en toda la escena).</li>
      </ul>
      <h4>Vistas rápidas</h4>
      <table class="keys">
        <tr><td>${k('1')}</td><td><b>Alzado</b> (vista frontal)</td><td>${k('Mayús', '1')}</td><td>Posterior</td></tr>
        <tr><td>${k('3')}</td><td><b>Perfil derecho</b> (lateral)</td><td>${k('Mayús', '3')}</td><td>Perfil izquierdo</td></tr>
        <tr><td>${k('7')}</td><td><b>Planta</b> (vista superior)</td><td>${k('Mayús', '7')}</td><td>Inferior</td></tr>
        <tr><td>${k('5')}</td><td>Ortográfica ⇄ perspectiva</td><td>${k('0')}</td><td>Perspectiva</td></tr>
      </table>
      <p>Funcionan en la fila de números y en el teclado numérico. También tienes los botones de la barra inferior del visor y el <b>navegador de ejes</b> (arriba a la derecha): haz clic en X, Y, Z o en los círculos opuestos.</p>
      <p>Las vistas predefinidas usan cámara <b>ortográfica</b>: sin deformación por la distancia, ideal para alinear piezas y comprobar medidas. Al orbitar con el ratón la vista pasa a «Libre».</p>
      <h4>Modos de visualización</h4>
      <ul>
        <li><b>Sólido</b>: superficies con iluminación.</li>
        <li><b>Wire</b>: solo la malla de alambre, para ver la estructura interior y el número de segmentos.</li>
      </ul>
      <p>${k('Z')} alterna entre los dos.</p>
      <h4>Ejemplo: alinear una tapa</h4>
      <ol class="steps">
        <li>Abre el ejemplo de la tuerca y el tornillo.</li>
        <li>Pulsa ${k('1')} (Alzado) y ${k('Z')} para pasar a Wire: verás si la cabeza y el vástago están centrados.</li>
        <li>Pulsa ${k('7')} (Planta) para comprobar la alineación desde arriba.</li>
      </ol>
      ${exBtn('tuerca')}`,
  },
  {
    id: 'extrusion', title: 'Extrusión',
    html: `
      <p>Dibuja un <b>perfil cerrado</b> visto desde arriba (en planta) y Forja 3D lo levanta con la altura que indiques. Sirve para letras, piezas mecánicas, engranajes, perfiles L/T/U, suelos de planta irregular…</p>
      <h4>El editor de perfiles</h4>
      <ul>
        <li><b>Clic</b> en vacío añade un punto al final del perfil.</li>
        <li><b>Arrastra</b> un punto para moverlo; clic en un <b>+</b> (centro de un tramo) inserta un punto.</li>
        <li><b>Clic derecho</b> o doble clic borra un punto; ${k('Ctrl', 'Z')} quita el último.</li>
        <li><b>Rueda</b> para zoom, <b>botón central</b> para desplazar; <b>Encuadrar</b> ajusta la vista al perfil.</li>
        <li><b>Plantilla</b>: rectángulo, círculo, hexágono, triángulo, estrella, perfiles L, T, U, I, flecha, engranaje y corazón.</li>
        <li><b>Curva suave</b> redondea el perfil pasando por los puntos; <b>Ajustar a rejilla</b> los coloca en múltiplos de 0,05.</li>
      </ul>
      <h4>Propiedades</h4>
      <ul>
        <li><b>Altura</b>: cuánto se extruye. <b>Bisel</b>: redondea los bordes (0 = sin bisel). <b>Seg. bisel</b>/<b>Seg. curva</b>: suavidad.</li>
        <li><b>Editar perfil…</b> vuelve a abrir el editor en cualquier momento.</li>
      </ul>
      <h4>Ejemplo: engranaje con eje</h4>
      <ol class="steps">
        <li>Pulsa <b>Extrusión</b>, elige la plantilla <b>Engranaje</b> y aplica. Altura 0,2.</li>
        <li>Añade un <b>Cilindro</b> de radio 0,12 en el mismo centro, más alto que el engranaje.</li>
        <li>Selecciona el engranaje y luego el cilindro: <b>Restar</b>. Ya tienes el agujero del eje.</li>
      </ol>
      ${exBtn('tuerca')}`,
  },
  {
    id: 'revolucion', title: 'Revolución (torno)',
    html: `
      <p>Dibuja <b>medio perfil</b> y Forja 3D lo gira alrededor del eje vertical, como en un torno: jarrones, copas, botellas, peones de ajedrez, lámparas, ruedas…</p>
      <ul>
        <li>En el editor, la <b>línea discontinua verde</b> es el eje de giro. Los puntos no pueden pasar a la izquierda (x &lt; 0).</li>
        <li>La silueta discontinua del otro lado es la vista previa del contorno completo.</li>
        <li>Empieza y termina el perfil <b>sobre el eje</b> para que la pieza quede cerrada (necesario si luego vas a usarla en una booleana).</li>
        <li><b>Segmentos</b>: suavidad del giro (pocos segmentos = pieza facetada, por ejemplo 6 para un vaso hexagonal).</li>
        <li><b>Ángulo</b>: menos de 360° deja una porción, útil para ver la sección interior.</li>
      </ul>
      <h4>Ejemplo: vaso hexagonal</h4>
      <ol class="steps">
        <li>Pulsa <b>Revolución</b>, elige la plantilla <b>Copa</b> y aplica.</li>
        <li>En Propiedades pon Segmentos = 6 y activa <i>Sombreado plano</i>.</li>
      </ol>
      ${exBtn('torno')}`,
  },
  {
    id: 'booleanas', title: 'Operaciones booleanas',
    html: `
      <p>Combinan el volumen de varios objetos. Selecciona primero la <b>base (A)</b> y después el resto con <kbd>Mayús</kbd>+clic; luego elige la operación en la barra superior del visor o en el panel de propiedades.</p>
      <div class="ops-grid">
        <div><b>∪ Unir</b><span>A + B en una sola pieza. Para soldar asas, patas, cabezas de tornillo…</span></div>
        <div><b>− Restar</b><span>A menos todo lo demás. Para agujeros, ranuras, huecos y encajes. Se pueden restar varios objetos a la vez.</span></div>
        <div><b>∩ Intersecar</b><span>Solo el volumen común. Cubo ∩ esfera = cubo con esquinas redondeadas.</span></div>
        <div><b>Partir</b><span>Corta un objeto en dos piezas. Con un <b>Plano</b> seleccionado corta por ese plano (puedes girarlo); sin plano, en horizontal por el centro.</span></div>
        <div><b>Separar</b><span>Deshace la operación del objeto seleccionado y devuelve las piezas originales, en su sitio.</span></div>
      </div>
      <h4>Bueno saber</h4>
      <ul>
        <li>Las operaciones son <b>no destructivas</b>: el resultado recuerda sus piezas. En Propiedades puedes cambiar la operación (de Unir a Restar, por ejemplo) sin rehacer nada.</li>
        <li>Se pueden <b>encadenar</b>: el resultado de una operación puede ser operando de otra.</li>
        <li>Funcionan mejor con <b>objetos cerrados</b>. Planos y anillos son superficies sin grosor y pueden dejar huecos.</li>
        <li>Si los objetos no se tocan, Restar o Intersecar dan un resultado vacío y no se cambia nada.</li>
      </ul>
      <h4>Ejemplos</h4>
      <div class="ex-row">${exBtn('taza')} ${exBtn('dado')} ${exBtn('casa')} ${exBtn('naranja')}</div>`,
  },
  {
    id: 'ejemplos', title: 'Ejemplos guiados',
    html: () => `
      <p>Cada ejemplo se abre como un <b>proyecto nuevo</b> (no toca los tuyos). Ábrelo, selecciona una pieza y pulsa <b>Separar</b> para ver cómo está hecha, o sigue los pasos para construirla desde cero.</p>
      ${EXAMPLES.map(ex => `
        <article class="example">
          <header><h4>${ex.name}</h4>${exBtn(ex.key)}</header>
          <p class="muted">${ex.summary}</p>
          <ol class="steps">${ex.steps.map(s => `<li>${s}</li>`).join('')}</ol>
        </article>`).join('')}`,
  },
  {
    id: 'atajos', title: 'Atajos de teclado',
    html: `
      <table class="keys wide">
        <tr><th colspan="2">Edición</th></tr>
        <tr><td>${k('W')} ${k('E')} ${k('R')}</td><td>Mover · Rotar · Escalar</td></tr>
        <tr><td>${k('G')}</td><td>Activar o desactivar Snap</td></tr>
        <tr><td>${k('Ctrl', 'D')}</td><td>Duplicar la selección</td></tr>
        <tr><td>${k('Supr')} / ${k('Retroceso')}</td><td>Eliminar la selección</td></tr>
        <tr><td>${k('Ctrl', 'A')}</td><td>Seleccionar todo</td></tr>
        <tr><td>${k('Mayús')}/${k('Ctrl')} + clic</td><td>Añadir o quitar de la selección</td></tr>
        <tr><td>${k('Esc')}</td><td>Quitar la selección</td></tr>
        <tr><td>${k('Ctrl', 'Z')} · ${k('Ctrl', 'Y')}</td><td>Deshacer · Rehacer (hasta 100 pasos)</td></tr>
        <tr><td>${k('Ctrl', 'S')}</td><td>Guardar ahora</td></tr>
        <tr><th colspan="2">Vista</th></tr>
        <tr><td>${k('1')} · ${k('Mayús', '1')}</td><td>Alzado (frontal) · Posterior</td></tr>
        <tr><td>${k('3')} · ${k('Mayús', '3')}</td><td>Perfil derecho · Perfil izquierdo</td></tr>
        <tr><td>${k('7')} · ${k('Mayús', '7')}</td><td>Planta (superior) · Inferior</td></tr>
        <tr><td>${k('5')} · ${k('0')}</td><td>Ortográfica ⇄ perspectiva · Perspectiva</td></tr>
        <tr><td>${k('F')}</td><td>Encuadrar selección</td></tr>
        <tr><td>${k('Z')}</td><td>Alternar Sólido ⇄ Wire</td></tr>
        <tr><th colspan="2">Ayuda</th></tr>
        <tr><td>${k('?')} · ${k('F1')}</td><td>Abrir esta ayuda</td></tr>
      </table>
      <p class="muted">En el editor de perfiles: ${k('Intro')} aplica, ${k('Esc')} cancela y ${k('Ctrl', 'Z')} quita el último punto.</p>`,
  },
];

// ------------------------------------------------------------------ ventana
let open = null;

export function openHelp(sectionId = 'inicio', { onExample } = {}) {
  if (open) { open.go(sectionId); return; }
  const wrap = document.createElement('div');
  wrap.className = 'modal-backdrop';
  wrap.innerHTML = `
    <div class="modal help" role="dialog" aria-modal="true" aria-label="Ayuda de Forja 3D">
      <header class="modal-head help-head">
        <h2>Ayuda de Forja 3D</h2>
        <button class="icon-btn" data-close title="Cerrar (Esc)"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg></button>
      </header>
      <div class="help-body">
        <nav class="help-nav">${SECTIONS.map(s => `<button data-sec="${s.id}">${s.title}</button>`).join('')}</nav>
        <div class="help-content" tabindex="0"></div>
      </div>
    </div>`;
  document.body.appendChild(wrap);
  const content = wrap.querySelector('.help-content');

  const go = id => {
    const sec = SECTIONS.find(s => s.id === id) || SECTIONS[0];
    content.innerHTML = `<h3>${sec.title}</h3>` + (typeof sec.html === 'function' ? sec.html() : sec.html);
    content.scrollTop = 0;
    for (const b of wrap.querySelectorAll('.help-nav button')) b.classList.toggle('active', b.dataset.sec === sec.id);
  };

  const close = () => {
    document.removeEventListener('keydown', onKey, true);
    wrap.remove();
    open = null;
  };
  const onKey = e => {
    if (e.key === 'Escape') { e.stopPropagation(); close(); }
    else e.stopPropagation();
  };
  document.addEventListener('keydown', onKey, true);

  wrap.addEventListener('click', e => {
    if (e.target === wrap || e.target.closest('[data-close]')) return close();
    const nav = e.target.closest('[data-sec]');
    if (nav) return go(nav.dataset.sec);
    const link = e.target.closest('[data-goto]');
    if (link) { e.preventDefault(); return go(link.dataset.goto); }
    const ex = e.target.closest('[data-example]');
    if (ex) {
      const p = createExampleProject(ex.dataset.example);
      close();
      if (p) onExample?.(p);
    }
  });

  open = { go };
  go(sectionId);
  content.focus();
}
