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
  ...obj('box', 'Semiespacio', { width: 1000, height: 1000, depth: 1000 }, { p: [0, y + 500, 0], r: [-90, 0, 0] }), helper: true,
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
        <li><span class="tag">Barra superior</span> nombre del proyecto, deshacer/rehacer, herramienta (Mover · Rotar · Escalar), modo de vista (Sólido · Wire), Snap, Rejilla, <b>Importar</b> y <b>Exportar</b> (JSON, GLB, glTF, OBJ, STL), el botón de <b>modo claro / oscuro</b> (luna o sol) y la ayuda (<b>?</b>).</li>
        <li><span class="tag">Izquierda</span> primitivas: un clic añade la pieza en el centro de la vista, apoyada en el suelo.</li>
        <li><span class="tag">Visor</span> arriba, las <b>operaciones</b> (Unir, Restar…); abajo, las <b>vistas</b> (Alzado, Planta…); arriba a la derecha, el <b>navegador de ejes</b>.</li>
        <li><span class="tag">Derecha</span> la lista de objetos de la escena y las propiedades del seleccionado.</li>
      </ul>
      <h4>Modo claro u oscuro</h4>
      <p>El botón con la <b>luna</b> o el <b>sol</b> (en la barra superior del editor y en la pantalla de proyectos) cambia entre el modo oscuro y el claro. La primera vez se usa el modo de tu sistema; cuando eliges uno, se recuerda en este navegador.</p>
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
      <p>Todo se guarda solo en la base de datos del navegador (<code>IndexedDB</code>) medio segundo después de cada cambio; junto al nombre verás <i>Guardando…</i> y luego <i>Guardado</i>. <kbd>Ctrl</kbd>+<kbd>S</kbd> fuerza el guardado.</p>
      <p>El espacio disponible es <b>grande</b> (normalmente cientos de MB o varios GB, según el disco): la pantalla de proyectos muestra cuánto se usa y cuánto queda. Forja 3D pide además al navegador almacenamiento <b>persistente</b> para que no lo borre si el disco se llena. Los proyectos guardados con versiones anteriores (en <code>localStorage</code>) se migran solos la primera vez.</p>
      <div class="callout">Los proyectos viven en <b>este navegador</b>: otro navegador, otro equipo o una ventana privada no los verán, y borrar los «datos de sitios» del navegador los elimina. Descarga copias en JSON de lo que te importe.</div>
      <h4>Exportar e importar</h4>
      <ul>
        <li><b>Exportar → Proyecto Forja 3D</b> (editor) o <b>JSON</b> (tarjeta): un archivo <code>.forja3d.json</code> con el proyecto. Para otros programas mira <a href="#" data-goto="formatos">Exportar e importar 3D</a>.</li>
        <li><b>Exportar todo</b>: un único archivo con todos los proyectos (copia de seguridad).</li>
        <li><b>Importar</b>: acepta un proyecto, el archivo de «Exportar todo» o un modelo 3D (.glb, .gltf, .obj, .stl). Lo importado se añade como proyecto nuevo, nunca sobrescribe.</li>
      </ul>`,
  },
  {
    id: 'formatos', title: 'Exportar e importar 3D',
    html: `
      <p>Además del JSON propio, Forja 3D intercambia modelos con otros programas (Blender, impresoras 3D, motores de juego, visores web).</p>
      <h4>Exportar</h4>
      <p>Pulsa <b>Exportar</b> en la barra superior del editor y elige el formato:</p>
      <ul>
        <li><b>GLB</b> (<code>.glb</code>): glTF 2.0 binario en un solo archivo. <b>El más recomendable</b> para Blender, Unity, Godot, visores web y realidad aumentada. Conserva nombres, posiciones y colores/materiales.</li>
        <li><b>glTF</b> (<code>.gltf</code>): lo mismo en texto JSON, con los datos incrustados.</li>
        <li><b>OBJ</b> (<code>.obj</code> + <code>.mtl</code>): formato clásico; el <code>.mtl</code> guarda los colores.</li>
        <li><b>STL</b> (<code>.stl</code>): para impresión 3D. Sin colores; la mayoría de laminadores interpretan 1 unidad = 1 mm, así que escala la pieza en el laminador o antes de exportar.</li>
        <li><b>Proyecto Forja 3D</b> (<code>.json</code>): el único que conserva la edición (parámetros, perfiles, booleanas).</li>
      </ul>
      <p>Marca <b>Solo la selección</b> para exportar únicamente los objetos seleccionados. Los objetos ocultos nunca se exportan.</p>
      <h4>Importar</h4>
      <ul>
        <li>En el editor: botón <b>Importar</b> o <b>arrastra el archivo</b> sobre la ventana. El modelo se añade a la escena, apoyado en el suelo y al lado de lo que ya haya.</li>
        <li>En la pantalla de proyectos: <b>Importar</b> crea un proyecto nuevo con el modelo.</li>
        <li>Formatos: <code>.glb</code>, <code>.gltf</code> (con los datos incrustados), <code>.obj</code> (selecciona también su <code>.mtl</code> para traer los colores), <code>.stl</code> y <code>.json</code> de Forja 3D (sus objetos se añaden a la escena).</li>
        <li>Cada malla del archivo se convierte en un objeto <b>Malla importada</b>: se puede mover, girar, escalar, recolorear y usar en <a href="#" data-goto="booleanas">operaciones booleanas</a>, pero no tiene parámetros editables.</li>
        <li>Si el modelo es enorme o diminuto (por ejemplo, en milímetros), se reescala automáticamente a unas 2 unidades y se avisa del factor.</li>
      </ul>
      <div class="callout">No se importan texturas, animaciones ni glTF con compresión Draco/Meshopt. Los modelos muy detallados ocupan bastante; caben sin problema, pero conviene descargar una copia del proyecto en JSON.</div>
      <h4>Con Blender</h4>
      <ol class="steps">
        <li><b>De Forja 3D a Blender</b>: Exportar → GLB. En Blender: <i>Archivo → Importar → glTF 2.0 (.glb/.gltf)</i>. Blender convierte automáticamente el eje vertical (Y arriba → Z arriba).</li>
        <li><b>De Blender a Forja 3D</b>: en Blender, <i>Archivo → Exportar → glTF 2.0</i>, formato <i>glTF Binary (.glb)</i> y sin compresión. Después, <b>Importar</b> en Forja 3D.</li>
        <li>El formato <code>.blend</code> es interno de Blender y no se puede leer ni escribir desde el navegador: usa GLB como puente.</li>
      </ol>`,
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
      <h4>Dividir la pantalla en varias vistas</h4>
      <p>Los iconos de la izquierda de la barra inferior dividen el visor en <b>1, 2, 3 o 4 vistas</b>. Cada panel tiene su <b>propia cámara</b> (perspectiva u ortográfica), su navegador de ejes y su nombre en la esquina:</p>
      <ul>
        <li><b>2 vistas</b>: perspectiva + alzado. <b>3 vistas</b>: perspectiva grande + alzado + planta. <b>4 vistas</b>: perspectiva, planta, alzado y perfil (como en los programas de CAD).</li>
        <li>Haz clic en un panel para hacerlo <b>activo</b> (borde de color): las teclas de vista (<kbd>1</kbd>, <kbd>3</kbd>, <kbd>7</kbd>, <kbd>5</kbd>, <kbd>0</kbd>, <kbd>F</kbd>) y los botones de la barra inferior actúan sobre él.</li>
        <li>Puedes seleccionar y mover objetos desde cualquier panel: el gizmo funciona en el panel que está bajo el ratón, y los cambios se ven a la vez en todos.</li>
        <li>La división y las cámaras de cada panel se guardan con el proyecto.</li>
      </ul>
      <h4>Panel lateral</h4>
      <ul>
        <li>Arrastra el <b>borde izquierdo</b> del panel de Escena/Propiedades para hacerlo más ancho o más estrecho (doble clic en el borde: ancho por defecto).</li>
        <li>El botón <b>▯▮</b> de la barra superior o la tecla <kbd>N</kbd> lo ocultan y lo vuelven a mostrar, para ganar espacio para las vistas.</li>
      </ul>
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
    id: 'captura', title: 'Capturar e imprimir',
    html: `
      <p>El botón de la <b>cámara de fotos</b> de la barra superior (o ${k('Ctrl', 'P')}) abre «Capturar o imprimir». Se captura <b>lo que ves en pantalla</b>: todas las vistas visibles con su disposición actual, sin el gizmo ni las cajas de selección.</p>
      <ul>
        <li><b>Formato</b>: <b>PNG</b> (sin pérdida; admite fondo transparente), <b>JPG</b> (más ligero), <b>PDF</b> (página A4 que se descarga directamente) o <b>Imprimir</b> (abre el diálogo de impresión del navegador; desde ahí también puedes elegir «Guardar como PDF»).</li>
        <li><b>Fondo</b>: el del tema actual, blanco (ideal para documentos) o transparente (solo PNG, para montar la imagen sobre otro fondo).</li>
        <li><b>Resolución</b>: 1×, 2× o 4× el tamaño de la pantalla, para imágenes nítidas o carteles.</li>
        <li><b>Incluir</b>: la <b>rejilla y los ejes</b> (desmárcalo para una imagen limpia), el <b>nombre de cada vista</b> cuando hay varias, y para PDF/impresión un <b>título y la fecha</b>.</li>
        <li><b>Página A4</b> (PDF e impresión): orientación automática según la forma de la imagen, horizontal o vertical.</li>
      </ul>
      <p>La vista previa del diálogo muestra exactamente lo que se va a guardar. Las opciones elegidas se recuerdan para la próxima vez.</p>
      <h4>Ejemplo: lámina de un diseño en 4 vistas</h4>
      <ol class="steps">
        <li>Abre el ejemplo de la casa y elige <b>4 vistas</b> en la barra inferior.</li>
        <li>Pulsa ${k('N')} para ocultar el panel lateral y ganar espacio.</li>
        <li>Pulsa ${k('Ctrl', 'P')}, elige <b>PDF</b>, fondo <b>Blanco</b>, desmarca <b>Rejilla y ejes</b> y pulsa <b>Descargar</b>.</li>
      </ol>
      ${exBtn('casa')}`,
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
    id: 'escultor', title: 'Modo escultor',
    html: `
      <p>Convierte cualquier objeto en una <b>escultura</b> y modélalo con pinceles, como en arcilla o piedra. Selecciona el objeto y pulsa <b>Esculpir</b> en la barra de operaciones (o en Propiedades). Hay <b>dos métodos</b>; puedes probar los dos y quedarte con el que prefieras (con <i>Pasar a volumen… / Pasar a malla…</i> se cambia de uno a otro sobre la forma actual):</p>
      <div class="ops-grid">
        <div><b>Volumen (tallar)</b><span>El objeto se convierte en un bloque de material. Las herramientas <b>quitan o añaden materia</b>: se pueden abrir agujeros y túneles, separar partes y volver a rellenar. Es lo más parecido a <b>picar piedra</b>.</span></div>
        <div><b>Malla (deformar)</b><span>El objeto se subdivide y los pinceles <b>empujan, hunden, alisan o estiran</b> su superficie. Ideal para formas orgánicas suaves, relieves o terrenos; no puede abrir agujeros.</span></div>
      </div>
      <h4>Herramientas · Volumen</h4>
      <ul>
        <li><b>Cincel</b> (<kbd>C</kbd>): quita material a cada golpe. <b>Gubia</b> (<kbd>U</kbd>): abre surcos al arrastrar. <b>Arcilla</b> (<kbd>A</kbd>): añade material.</li>
        <li><b>Lima</b> (<kbd>S</kbd>): suaviza las marcas. <b>Aplanar</b> (<kbd>F</kbd>): desbasta en plano, como un formón (con <kbd>Ctrl</kbd>, rellena hasta el plano).</li>
      </ul>
      <h4>Herramientas · Malla</h4>
      <ul>
        <li><b>Dibujar</b> (<kbd>D</kbd>): levanta la superficie (con <kbd>Ctrl</kbd>, la hunde). <b>Inflar</b> (<kbd>I</kbd>): hincha en todas direcciones.</li>
        <li><b>Suavizar</b> (<kbd>S</kbd>), <b>Aplanar</b> (<kbd>F</kbd>), <b>Pellizcar</b> (<kbd>P</kbd>, afila aristas) y <b>Arrastrar</b> (<kbd>G</kbd>, agarra una zona y la estira).</li>
      </ul>
      <h4>Controles</h4>
      <ul>
        <li><b>Arrastra sobre el objeto</b> para esculpir; arrastrando fuera de él, la vista gira como siempre.</li>
        <li><b>Tamaño</b> y <b>Fuerza</b> con los deslizadores o con <kbd>[</kbd> <kbd>]</kbd> y <kbd>Mayús</kbd>+<kbd>[</kbd> <kbd>]</kbd>. El círculo sobre la superficie muestra el tamaño; el círculo interior, la fuerza (rojo: quita, verde: añade, azul: suaviza).</li>
        <li><kbd>Ctrl</kbd> mientras esculpes <b>invierte</b> la herramienta (quitar ↔ añadir, levantar ↔ hundir).</li>
        <li><b>Simetría</b> X / Y / Z: lo que hagas en un lado se repite reflejado en el otro (ideal para caras).</li>
        <li>Con tableta gráfica, la <b>presión del lápiz</b> regula la fuerza.</li>
        <li>Cada trazo se puede deshacer con <kbd>Ctrl</kbd>+<kbd>Z</kbd>. <b>Suavizar todo</b> alisa el objeto entero. <kbd>Intro</kbd> o <kbd>Esc</kbd> (o <b>Terminar</b>) salen del modo escultor.</li>
        <li>El <b>Detalle</b> (Baja / Media / Alta) se elige al convertir: más detalle permite marcas más finas pero cada trazo es más lento.</li>
      </ul>
      <p>Una escultura se comporta como cualquier objeto: se puede mover, colorear, usar en booleanas, capturar y exportar a GLB, OBJ o STL (por ejemplo, para imprimirla en 3D).</p>
      <h4>Ejemplo: tallar una cara en una esfera</h4>
      <ol class="steps">
        <li>Añade una <b>Esfera</b> (radio 1), pulsa <b>Esculpir</b> y elige <b>Volumen (tallar)</b>, detalle <b>Media</b>.</li>
        <li>Pulsa ${k('1')} (alzado) y activa la <b>Simetría X</b>.</li>
        <li>Con el <b>Cincel</b> (tamaño pequeño, fuerza alta), golpea dos veces donde irán los ojos: se abren las dos cuencas a la vez.</li>
        <li>Con la <b>Arcilla</b> añade la nariz; con la <b>Gubia</b> traza la boca de un lado a otro.</li>
        <li>Pasa la <b>Lima</b> para suavizar y pulsa <b>Terminar</b>.</li>
      </ol>`,
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
      <h4>El árbol de operaciones</h4>
      <p>En la lista <b>Escena</b>, cada operación tiene una flecha <b>›</b> que la despliega y muestra sus piezas; si una pieza es a su vez una operación, se despliega dentro (árbol anidado). Los botones <b>⌄</b> y <b>›</b> de la cabecera despliegan o pliegan todo.</p>
      <ul>
        <li>Cada pieza lleva su <b>papel</b>: <code>base</code> (la pieza de partida), <code>+</code> se une, <code>−</code> se resta, <code>∩</code> se interseca, <code>corte</code> el plano de una pieza partida.</li>
        <li>Haz clic en una pieza para seleccionarla: se <b>resalta en azul</b> en el visor y el <b>gizmo la mueve, gira o escala</b> dentro de la operación; al soltar, el resultado se recalcula.</li>
        <li>En Propiedades puedes cambiar su nombre, su transformación y sus <b>parámetros</b> (radio, altura, segmentos…), o el tipo de una operación anidada. La ruta de arriba (<i>Taza › Cuerpo y asa › Asa</i>) permite subir de nivel.</li>
        <li><b>Extraer como objeto</b> la saca de la operación y la deja como objeto independiente en su sitio; <b>Quitar de la operación</b> (o <kbd>Supr</kbd>) la elimina. Si la operación se queda con una sola pieza, desaparece y queda esa pieza.</li>
        <li>En una pieza partida, selecciona el <b>Plano de corte</b> y muévelo o gíralo para cambiar por dónde se corta.</li>
      </ul>
      <h4>Ejemplo: ajustar el asa de la taza sin rehacer nada</h4>
      <ol class="steps">
        <li>Abre el ejemplo de la taza y despliega <b>Taza › Cuerpo y asa</b>.</li>
        <li>Haz clic en <b>Asa</b>: se resalta en azul. Cambia <b>Grosor</b> a 0,1 y pulsa <kbd>Intro</kbd>.</li>
        <li>Arrastra la flecha verde del gizmo para subir o bajar el asa; al soltar, la taza se recalcula.</li>
        <li>Selecciona <b>Interior</b> y cambia su escala o su posición para hacer las paredes más finas o el fondo más grueso.</li>
      </ol>
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
    id: 'cad2d', title: 'Editor 2D (planos y cotas)',
    html: `
      <p>Un editor de planos al estilo AutoCAD para diseñar <b>piezas 2D</b> con medidas exactas, acotarlas y, si quieres, convertirlas en piezas 3D. Cada proyecto tiene <b>un plano</b> que se guarda junto a la escena 3D.</p>
      <h4>Dos espacios de trabajo independientes</h4>
      <ul>
        <li>El selector <b>3D | 2D</b> de la barra superior cambia <b>toda la pantalla</b> entre la escena 3D y el plano 2D. Son independientes: cada uno tiene sus herramientas, su panel lateral (Escena o Capas), su <b>deshacer/rehacer</b> y su propia <b>pantalla dividida</b>.</li>
        <li>Los botones de diseño (1, 2, 3 o 4 vistas) se aplican al espacio en el que estás. En 2D, cada panel muestra el mismo plano con su propio zoom y encuadre: por ejemplo, la pieza entera en uno y un detalle ampliado en otro.</li>
        <li>Al cambiar de espacio no se pierde nada: cada uno vuelve exactamente como lo dejaste, y se guarda con el proyecto.</li>
        <li>Rueda: zoom hacia el cursor. Botón central o derecho arrastrando: desplazar. Doble clic con el central (o <b>Encuadrar</b>, o la orden <code>Z</code>): ver todo.</li>
      </ul>
      <h4>La línea de órdenes</h4>
      <p>En la barra de estado hay una <b>línea de órdenes</b>: escribe una orden y pulsa <kbd>Intro</kbd> (no hace falta hacer clic en ella; basta con teclear). El texto de la izquierda indica qué espera cada paso. <kbd>Intro</kbd> o <kbd>Espacio</kbd> sin texto termina la orden (o repite la última); <kbd>Esc</kbd> la cancela; el clic derecho equivale a <kbd>Intro</kbd>.</p>
      <table class="keys wide">
        <tr><th colspan="2">Dibujo</th></tr>
        <tr><td><code>L</code></td><td>Línea (segmentos encadenados; <code>C</code> cierra, <code>H</code> deshace el último)</td></tr>
        <tr><td><code>PL</code></td><td>Polilínea (un solo objeto; <code>C</code> la cierra, <code>H</code> deshace el último punto)</td></tr>
        <tr><td><code>REC</code></td><td>Rectángulo por dos esquinas (<code>@100,60</code> o <code>100x60</code> para medidas exactas)</td></tr>
        <tr><td><code>C</code></td><td>Círculo: centro y radio (o <code>d16</code> para dar el diámetro)</td></tr>
        <tr><td><code>A</code></td><td>Arco por tres puntos</td></tr>
        <tr><td><code>T</code></td><td>Texto</td></tr>
        <tr><th colspan="2">Cotas y medidas</th></tr>
        <tr><td><code>DLI</code> · <code>DAL</code></td><td>Cota lineal (horizontal o vertical) · alineada: dos puntos y la posición de la línea de cota</td></tr>
        <tr><td><code>DRA</code> · <code>DDI</code></td><td>Cota de radio · diámetro: clic en el círculo o arco y luego dónde poner el texto</td></tr>
        <tr><td><code>DAN</code></td><td>Cota angular entre dos líneas</td></tr>
        <tr><td><code>DI</code></td><td>Medir: distancia, ΔX, ΔY y ángulo entre dos puntos (no dibuja nada)</td></tr>
        <tr><th colspan="2">Modificar</th></tr>
        <tr><td><code>M</code> · <code>CO</code></td><td>Desplazar · Copiar (punto base y destino)</td></tr>
        <tr><td><code>RO</code> · <code>SC</code> · <code>MI</code></td><td>Girar · Escalar · Simetría</td></tr>
        <tr><td><code>O</code></td><td>Desfase (equidistancia): distancia, objeto y lado</td></tr>
        <tr><td><code>TR</code></td><td>Recortar: clic en la parte que sobra; corta en las intersecciones con el resto</td></tr>
        <tr><td><code>X</code> · <code>E</code></td><td>Descomponer (rectángulo/polilínea → líneas) · Borrar</td></tr>
        <tr><td><code>Z</code> · <code>U</code></td><td>Encuadrar todo · Deshacer</td></tr>
      </table>
      <h4>Coordenadas</h4>
      <ul>
        <li><code>30,20</code>: punto <b>absoluto</b> (x, y).</li>
        <li><code>@50,0</code>: <b>relativo</b> al último punto.</li>
        <li><code>@40&lt;30</code> o <code>40&lt;30</code>: <b>polar</b>, 40 de distancia con 30° de ángulo.</li>
        <li><code>25</code>: <b>distancia directa</b> en la dirección en la que apunta el cursor (muy útil con Orto).</li>
        <li>Los decimales se pueden escribir con punto o con coma (<code>12.5</code> o <code>12,5</code>).</li>
      </ul>
      <h4>Ayudas al dibujo</h4>
      <ul>
        <li><b>Referencias</b> (<kbd>F3</kbd>): el cursor se engancha a puntos finales, medios, centros, cuadrantes, intersecciones e inserción de texto. Se eligen en Propiedades (sin nada seleccionado).</li>
        <li><b>Orto</b> (<kbd>F8</kbd>): solo horizontal o vertical. <b>Forzar</b> (<kbd>F9</kbd>): el cursor salta a la rejilla. <b>Rejilla</b> (<kbd>F7</kbd>).</li>
        <li>Los botones de la barra de estado activan y desactivan lo mismo; a la derecha se ven las coordenadas del cursor.</li>
      </ul>
      <h4>Seleccionar y editar</h4>
      <ul>
        <li>Al pasar el ratón, el objeto se <b>ilumina</b> y un rótulo junto al cursor dice qué es (tipo, medida, capa) y qué pasará al hacer clic o arrastrar.</li>
        <li><b>Clic</b> para seleccionar (se dibuja discontinuo en azul), <kbd>Mayús</kbd>+clic para añadir o quitar, <kbd>Esc</kbd> o clic en vacío para deseleccionar.</li>
        <li>Arrastrando en vacío: de izquierda a derecha, <b>ventana</b> azul (solo lo que queda dentro del todo); de derecha a izquierda, <b>captura</b> verde (todo lo que toca). El rótulo indica cuántos objetos entrarán.</li>
        <li>Los <b>pinzamientos</b> (cuadrados azules) se ponen rojos al pasar por encima; arrástralos para estirar extremos, mover vértices o centros, o cambiar radios. Mientras arrastras se ve la medida (longitud, radio, desplazamiento).</li>
        <li>Arrastrar la <b>línea</b> de un objeto lo mueve (con todo lo seleccionado). Las <b>flechas</b> lo desplazan un paso de rejilla (<kbd>Mayús</kbd>: ×10).</li>
        <li><kbd>Ctrl</kbd>+<kbd>C</kbd> / <kbd>Ctrl</kbd>+<kbd>X</kbd> / <kbd>Ctrl</kbd>+<kbd>V</kbd>: copiar, cortar y pegar (lo pegado sigue al cursor; clic para colocarlo, varias veces si quieres). <kbd>Ctrl</kbd>+<kbd>D</kbd>: duplicar.</li>
        <li>Durante una orden, el rótulo junto al cursor muestra qué pide y lo que vas tecleando, para no tener que mirar la barra de estado.</li>
        <li>En <b>Propiedades</b> se editan las coordenadas, el radio, la longitud, el texto o la capa con valores exactos; con varios objetos se ve la longitud total y se puede cambiar la capa de todos.</li>
        <li>Seleccionando primero y escribiendo después la orden (por ejemplo <code>M</code>), la orden usa la selección directamente.</li>
      </ul>
      <h4>Capas</h4>
      <p>El panel <b>Capas del plano</b> muestra las capas con su color, tipo de línea (continua, eje, oculta, trazos…) y grosor; el círculo marca la <b>capa actual</b>, donde se dibuja. Vienen preparadas <i>Contorno</i>, <i>Ejes</i>, <i>Ocultas</i>, <i>Cotas</i>, <i>Texto</i> y <i>Construcción</i>; el ojo las oculta y la cruz las elimina.</p>
      <h4>Unidades y estilo de cota</h4>
      <p>Sin nada seleccionado, Propiedades muestra el plano: unidades (mm, cm, m, pulgadas…), decimales, separador decimal, altura de texto y tamaño de flecha de las cotas.</p>
      <h4>Del plano a la pieza 3D</h4>
      <ul>
        <li><b>Extruir a 3D</b> busca los <b>contornos cerrados</b> del plano (o de la selección): rectángulos, círculos, polilíneas cerradas y cadenas de líneas y arcos que se cierran. Los contornos que quedan dentro de otro se convierten en <b>huecos</b>.</li>
        <li>Se ignoran las capas de cotas, texto, ejes y construcción. Elige el grosor y la escala (por defecto, 100 mm = 1 unidad 3D) y la pieza se añade a la escena 3D sin salir del plano; pulsa <b>3D</b> para verla. El plano no cambia: puedes seguir editándolo y volver a extruir.</li>
      </ul>
      <h4>Exportar, importar e imprimir</h4>
      <ul>
        <li><b>Exportar</b> en modo 2D propone <b>DXF</b> (AutoCAD, LibreCAD, FreeCAD, cortadoras láser…) o <b>SVG</b>. El DXF conserva capas, colores, tipos de línea y unidades; las cotas se guardan como líneas y texto.</li>
        <li><b>Importar</b> un <code>.dxf</code> lo añade al plano (líneas, polilíneas, círculos, arcos, elipses, splines y textos).</li>
        <li><b>Capturar</b> (<kbd>Ctrl</kbd>+<kbd>P</kbd>) incluye los paneles 2D tal como se ven, con o sin rejilla, y con fondo blanco quedan como un plano impreso.</li>
      </ul>
      <h4>Ejemplo: placa con dos taladros</h4>
      <ol class="steps">
        <li>Pulsa <b>2D</b>. Escribe <code>REC</code> ${k('Intro')}, <code>0,0</code> ${k('Intro')}, <code>@100,60</code> ${k('Intro')}.</li>
        <li><code>C</code> ${k('Intro')} <code>25,30</code> ${k('Intro')} <code>10</code> ${k('Intro')} y <code>C</code> ${k('Intro')} <code>75,30</code> ${k('Intro')} <code>d16</code> ${k('Intro')}. Escribe <code>Z</code> para encuadrar.</li>
        <li>Acota: <code>DLI</code>, clic en las dos esquinas inferiores (las referencias las enganchan) y clic debajo para situar la cota. <code>DRA</code> y clic en el primer taladro.</li>
        <li>Mide con <code>DI</code> la diagonal: la barra de estado muestra la distancia y el ángulo.</li>
        <li>Pulsa <b>Extruir a 3D</b>, grosor 8 mm: aparece la placa con sus dos agujeros junto al plano.</li>
        <li>Exporta el plano a <b>DXF</b> para cortarlo o abrirlo en otro programa de CAD.</li>
      </ol>`,
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
        <tr><td>${k('N')}</td><td>Mostrar u ocultar el panel lateral</td></tr>
        <tr><th colspan="2">Editor 2D</th></tr>
        <tr><td>Teclear + ${k('Intro')}</td><td>Orden o valor en la línea de órdenes (L, PL, REC, C, A, T, DLI, DRA, DI, M, CO, RO, O, TR…)</td></tr>
        <tr><td>${k('Intro')} · ${k('Espacio')} · clic derecho</td><td>Terminar la orden (sin orden activa: repetir la última)</td></tr>
        <tr><td>${k('Esc')}</td><td>Cancelar la orden · quitar la selección</td></tr>
        <tr><td>${k('F3')} · ${k('F7')} · ${k('F8')} · ${k('F9')}</td><td>Referencias · Rejilla · Orto · Forzar a rejilla</td></tr>
        <tr><td>Doble clic central</td><td>Encuadrar todo el plano</td></tr>
        <tr><td>Flechas · ${k('Mayús')}+flechas</td><td>Desplazar la selección un paso de rejilla · ×10</td></tr>
        <tr><td>${k('Ctrl', 'C')} · ${k('Ctrl', 'X')} · ${k('Ctrl', 'V')} · ${k('Ctrl', 'D')}</td><td>Copiar · Cortar · Pegar · Duplicar (en el plano)</td></tr>
        <tr><th colspan="2">Modo escultor</th></tr>
        <tr><td>${k('[')} ${k(']')}</td><td>Tamaño del pincel</td></tr>
        <tr><td>${k('Mayús', '[')} ${k('Mayús', ']')}</td><td>Fuerza del pincel</td></tr>
        <tr><td>${k('Ctrl')} + arrastrar</td><td>Invertir (quitar ↔ añadir)</td></tr>
        <tr><td>Letras de herramienta</td><td>C, U, A, S, F (volumen) · D, I, S, F, P, G (malla)</td></tr>
        <tr><td>${k('Intro')} · ${k('Esc')}</td><td>Terminar de esculpir</td></tr>
        <tr><th colspan="2">Capturar</th></tr>
        <tr><td>${k('Ctrl', 'P')}</td><td>Capturar imagen, PDF o imprimir</td></tr>
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
