# Forja 3D

Editor 3D que funciona directamente en el navegador, hecho con **three.js** y **JavaScript vanilla** (módulos ES, sin Node.js, sin empaquetador, sin paso de compilación). Permite construir modelos a partir de primitivas básicas, verlos en modo sólido o alámbrico, gestionar varios proyectos y guardarlo todo en el almacenamiento local del navegador.

## Funcionalidades

- **14 primitivas**: cubo, esfera, cilindro, cono, pirámide, toro, cápsula, plano, anillo, tetraedro, octaedro, dodecaedro, icosaedro y nudo toroidal. Todos sus parámetros (radios, alturas, segmentos…) son editables.
- **Primitivas 2D** planas sobre el suelo: **Círculo 2D** (contorno o relleno, arco con ángulo parcial) y **Línea 2D** (polilínea abierta o cerrada, recta o curva, dibujada con el editor de trazados y con grosor ajustable).
- **De 2D a 3D**: selecciona una Línea 2D o un Círculo 2D y pulsa **Extruir** (sólido relleno o pared con grosor, cilindro o tubo) o **Revolución** (gira el trazado alrededor de su eje vertical; un círculo da una esfera maciza o hueca).
- **Extrusión**: dibuja un perfil cerrado en planta (o elige una plantilla: rectángulo, círculo, estrella, perfiles L/T/U/I, engranaje, flecha…) y se extruye hacia arriba, con altura y bisel ajustables.
- **Revolución (torno)**: dibuja medio perfil y gíralo alrededor del eje vertical para hacer jarrones, copas, botellas, peones… con ángulo parcial opcional.
- **Operaciones booleanas** (no destructivas, recuperables con *Separar*):
  - **Unir** (A ∪ B): fusiona varios objetos en uno.
  - **Restar** (A − B): vacía el primer objeto seleccionado con el volumen de los demás (agujeros, ranuras, encajes).
  - **Intersecar** (A ∩ B): conserva solo el volumen común.
  - **Partir**: corta un objeto con un *Plano* seleccionado (o, si no hay plano, en horizontal por su centro) y genera dos piezas.
  - **Separar**: deshace una operación booleana y devuelve las piezas originales.
  - **Árbol de operaciones** en la lista de Escena: cada operación se despliega mostrando sus piezas anidadas y su papel (base, +, −, ∩, corte). Cada pieza se puede seleccionar (se resalta en 3D), mover con el gizmo, editar sus parámetros, extraer o quitar, y la operación se recalcula.
- **Selección múltiple** con Mayús/Ctrl + clic (en el visor o en la lista); el gizmo mueve, gira y escala todo el grupo.
- **Reflejar** en X/Y/Z y **Apoyar en el suelo**.
- **Modo escultor** con dos métodos a elegir: **Volumen (tallar)** — el objeto se convierte en un bloque de material y se pica con Cincel, Gubia, Arcilla, Lima y Aplanar (permite agujeros y túneles) — y **Malla (deformar)** — Dibujar, Inflar, Suavizar, Aplanar, Pellizcar y Arrastrar sobre una malla subdividida. Tamaño, fuerza, simetría X/Y/Z, presión del lápiz y deshacer por trazo.
- **Editor 2D de planos** al estilo AutoCAD: línea de órdenes con alias (`L`, `PL`, `REC`, `C`, `A`, `T`, `M`, `CO`, `RO`, `SC`, `MI`, `O`, `TR`…), coordenadas absolutas, relativas (`@dx,dy`), polares (`d<ángulo`) y distancia directa; referencias a objetos (final, medio, centro, cuadrante, intersección), Orto, forzar a rejilla, pinzamientos, selección por ventana/captura, rótulos junto al cursor que explican cada acción, copiar/pegar/duplicar y desplazamiento con flechas.
  - **Cotas** lineales, alineadas, de radio, diámetro y ángulo, y herramienta **Medir** (distancia, ΔX, ΔY, ángulo); longitudes, perímetros y áreas en Propiedades.
  - **Hoja** A5, A4, A3, A2, A1 o A0, horizontal o vertical, a escala (10:1 … 1:1000), con recuadro y cajetín; **PDF vectorial a escala real** para imprimir.
  - **Modo isométrico** en el plano: rejilla a 30°/90°/150°, forzado a sus nodos y orto isométrico. **Mano** (pan) para moverse libremente por la hoja.
  - **Tipos de línea** continua, trazos, oculta, eje, puntos y **lápiz** (trazo a mano alzada con la geometría exacta, sobre la rejilla), por capa o por objeto; botón *✎ Lápiz* para dibujar en ese estilo.
  - **Capas** con color, tipo de línea y grosor; unidades (mm, cm, m, pulgadas…) y estilo de cota configurables.
  - **Espacio de trabajo 2D independiente del 3D**: el selector 3D | 2D cambia toda la pantalla; cada espacio tiene sus herramientas, su deshacer/rehacer y su propia pantalla dividida (en 2D, 1-4 paneles del plano con zoom independiente). Ambos se guardan con el proyecto.
  - **Extruir a 3D**: los contornos cerrados del plano se convierten en una pieza 3D, con los contornos interiores como huecos.
  - **DXF** (exportar e importar, compatible con AutoCAD, LibreCAD, FreeCAD y cortadoras láser) y **SVG**.
- **Pantalla dividida** en 1, 2, 3 o 4 vistas, cada una con su propia cámara, navegador de ejes y vista (perspectiva, alzado, planta, perfil…); se guarda con el proyecto.
- **Panel lateral** redimensionable (arrastrando su borde) y ocultable (botón o tecla `N`).
- **Capturar** lo que se ve en pantalla (todas las vistas) como **PNG** (también con fondo transparente), **JPG**, **PDF** A4 o **imprimir**, con o sin rejilla, a 1×, 2× o 4× de resolución.
- **Vistas rápidas** con cámara ortográfica: alzado (frontal), perfil derecho e izquierdo (laterales), planta (superior), posterior, inferior, **isométrica** y perspectiva; navegador de ejes clicable en la esquina del visor; herramienta **Mano** (pan) para desplazarse con el botón izquierdo.
- **Transformaciones** con gizmo (mover / rotar / escalar) o con valores numéricos exactos. Arrastra la etiqueta X/Y/Z de un campo para cambiar el valor deslizando (Mayús = ajuste fino).
- **Modos de vista**: Sólido y Wire (alámbrico).
- **Materiales**: color con paleta rápida, metalizado, rugosidad, opacidad y sombreado plano.
- **Escena**: lista de objetos, selección, ocultar/mostrar, duplicar, eliminar, renombrar.
- **Deshacer / rehacer** (hasta 100 pasos).
- **Snap** a rejilla (0,25 u), rotación (15°) y escala (0,1).
- **Modo claro y oscuro**: sigue al sistema por defecto y se puede cambiar con el botón de luna/sol; la elección se recuerda.
- **Gestor de proyectos**: crear, abrir, renombrar, duplicar, eliminar; miniatura automática de cada proyecto.
- **Guardado automático** en **IndexedDB** (cientos de MB o más según el disco; se pide almacenamiento persistente). Los proyectos antiguos de `localStorage` se migran solos.
- **Exportar** a **GLB / glTF** (recomendado para Blender, Unity, Godot y visores web), **OBJ + MTL** y **STL** (impresión 3D), además del JSON propio editable.
- **Importar** modelos **.glb, .gltf, .obj (+ .mtl) y .stl** (botón o arrastrar y soltar) como «Mallas importadas» que se pueden transformar, recolorear y usar en booleanas; y proyectos `.json` (uno o un paquete completo).
- **Blender**: el formato `.blend` no se puede generar en el navegador; usa GLB en ambos sentidos (Archivo → Importar/Exportar → glTF 2.0).

## Ayuda integrada y ejemplos

El botón **?** del editor (o las teclas `?` / `F1`) y **Ayuda y ejemplos** en la pantalla de proyectos abren una guía con todas las funcionalidades una sección del editor 2D con todas las órdenes y seis ejemplos guiados (taza, dado, tuerca y tornillo, casa, piezas de torno y naranja partida). Cada ejemplo se puede abrir con un clic como proyecto nuevo y desmontar con *Separar* para ver cómo está hecho.

## Atajos de teclado

| Tecla | Acción |
|---|---|
| `W` / `E` / `R` | Mover / Rotar / Escalar |
| `1` / `Mayús+1` | Alzado (frontal) / posterior |
| `3` / `Mayús+3` | Perfil derecho / izquierdo (laterales) |
| `7` / `Mayús+7` | Planta (superior) / inferior |
| `5` | Alternar ortográfica / perspectiva |
| `0` | Vista en perspectiva |
| `Z` | Alternar sólido / alámbrico |
| `Ctrl+A` | Seleccionar todo |
| `Mayús` o `Ctrl` + clic | Añadir o quitar de la selección |
| `F` | Encuadrar selección (o toda la escena) |
| `G` | Activar/desactivar snap |
| `Supr` / `Retroceso` | Eliminar objeto seleccionado |
| `Ctrl+D` | Duplicar |
| `Ctrl+Z` / `Ctrl+Y` (o `Ctrl+Mayús+Z`) | Deshacer / Rehacer |
| `Ctrl+S` | Guardar ahora |
| `?` / `F1` | Abrir la ayuda |
| `N` | Mostrar u ocultar el panel lateral |
| `Ctrl+P` | Capturar imagen, PDF o imprimir |
| `[` `]` / `Mayús+[` `]` | (Modo escultor) tamaño / fuerza del pincel |
| `9` | Vista isométrica |
| `H` | Mano: desplazar la vista con el botón izquierdo (en 2D, orden `P`) |
| `Esc` | Quitar selección |
| `F3` / `F7` / `F8` / `F9` | (Editor 2D) Referencias / Rejilla / Orto / Forzar a rejilla |

En el editor 2D basta con teclear: lo escrito va a la línea de órdenes y se confirma con `Intro`, `Espacio` o clic derecho.

Las teclas de vista funcionan tanto en la fila de números como en el teclado numérico (mismo esquema que Blender).

Ratón en el visor: botón izquierdo orbita, derecho desplaza, rueda hace zoom. Clic sobre un objeto lo selecciona; doble clic en la lista lo encuadra.

## Ejecutarlo en local

Los módulos ES no se cargan desde `file://`, así que hace falta un servidor estático cualquiera. Por ejemplo, con Python (ya incluido en macOS y Linux):

```bash
python3 -m http.server 8000
# abre http://localhost:8000
```

También sirve la extensión *Live Server* de VS Code.

## Publicar en GitHub Pages

1. Crea un repositorio en GitHub (p. ej. `forja3d`) y sube el contenido de esta carpeta a la rama `main`:
   ```bash
   git remote add origin https://github.com/<tu-usuario>/forja3d.git
   git push -u origin main
   ```
2. En el repositorio: **Settings → Pages → Build and deployment**, elige **Deploy from a branch**, rama `main` y carpeta `/ (root)`. Guarda.
3. En uno o dos minutos estará en `https://<tu-usuario>.github.io/forja3d/`.

El archivo `.nojekyll` evita que GitHub Pages procese el sitio con Jekyll. Todas las rutas son relativas, así que funciona en cualquier subcarpeta.

## Estructura

```
index.html              Interfaz (pantalla de proyectos + editor) e import map
css/style.css           Estilos
js/main.js              Navegación, gestor de proyectos, paneles, atajos
js/editor.js            Escena three.js, selección, gizmo, vistas, historial, serialización
js/primitives.js        Catálogo de primitivas y sus parámetros
js/storage.js           Persistencia en IndexedDB (con migración), import/export JSON
js/sculpt.js            Modo escultor: malla (deformar) y volumen (tallar con vóxeles)
js/csg.js               Operaciones booleanas (CSG) y caché de resultados
js/sketch.js            Editor de perfiles 2D para extrusión y revolución
js/cad2d.js             Editor 2D de planos: entidades, órdenes, referencias, cotas, capas, DXF/SVG
js/help.js              Ayuda integrada y proyectos de ejemplo
js/theme.js             Modo claro / oscuro
js/io.js                Exportar/importar glTF, GLB, OBJ y STL
js/views.js             Paneles de vista independientes (pantalla dividida)
js/pdf.js               Generador de PDF mínimo para las capturas
lib/three/              three.js r170 (copia local, licencia MIT), controles, exportadores y cargadores
lib/three-bvh-csg/      three-bvh-csg 0.0.17 (MIT) · booleanas
lib/three-mesh-bvh/     three-mesh-bvh 0.8.3 (MIT) · dependencia de la anterior
```

three.js se incluye en el repositorio (`lib/three`) para que el editor no dependa de un CDN y funcione también sin conexión. Si prefieres un CDN, cambia el import map de `index.html`:

```html
"three": "https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.min.js",
"three/addons/": "https://cdn.jsdelivr.net/npm/three@0.170.0/examples/jsm/"
```

## Formato del JSON

```json
{
  "format": "forja3d-project",
  "version": 1,
  "id": "a1b2c3d4e5f6",
  "name": "Robot",
  "created": 1793260800000,
  "updated": 1793260800000,
  "camera": { "position": [5, 4, 6], "target": [0, 0, 0] },
  "settings": { "view": "solid", "grid": true, "snap": false },
  "objects": [
    {
      "id": "9f8e7d6c5b4a",
      "name": "Cubo 1",
      "type": "box",
      "params": { "width": 1, "height": 1, "depth": 1, "segments": 1 },
      "position": [0, 0.5, 0],
      "rotation": [0, 45, 0],
      "scale": [1, 1, 1],
      "material": { "color": "#d9d4c7", "metalness": 0.05, "roughness": 0.6, "opacity": 1, "flatShading": false },
      "visible": true
    }
  ]
}
```

- `rotation` va en **grados** (orden XYZ).
- `type` es uno de: `box`, `sphere`, `cylinder`, `cone`, `pyramid`, `torus`, `capsule`, `plane`, `ring`, `tetrahedron`, `octahedron`, `dodecahedron`, `icosahedron`, `torusKnot`, `circle2d`, `line2d`, `extrude`, `lathe` o `boolean`.
- `extrude`, `lathe` y `line2d` añaden `"shape": { "points": [[x, y], …], "smooth": false }`; una extrusión puede incluir además `"holes": [[[x, y], …], …]` (huecos interiores).
- `boolean` guarda la operación en `params.op` (`union`, `subtract`, `intersect`) y los objetos originales en `operands` (con sus transformaciones relativas al resultado). La malla se recalcula al abrir el proyecto, así que el JSON sigue siendo pequeño y editable.
- “Exportar todo” genera `{ "format": "forja3d-bundle", "projects": [ … ] }`, que también se puede importar.

## Añadir una primitiva nueva

En `js/primitives.js`, añade una entrada a `PRIMITIVES` con su etiqueta, icono SVG, parámetros y la función que crea la geometría, e inclúyela en `TOOLBAR_ORDER`. El panel de propiedades, el guardado y el JSON la recogen automáticamente.

## Limitaciones conocidas

- Los datos viven en IndexedDB de ese navegador; borrar los datos del sitio los elimina. Descarga los proyectos importantes en JSON.
- Los datos viven en ese navegador y ese dominio: otro navegador u otro equipo no los verá salvo que importes el JSON.
- Las booleanas funcionan mejor con objetos cerrados (sólidos); con planos o anillos (superficies abiertas) el resultado puede tener huecos.
- Aún no hay agrupación jerárquica ni exportación a formatos 3D (glTF/OBJ/STL).

## Licencia

MIT. three.js © three.js authors; three-bvh-csg y three-mesh-bvh © Garrett Johnson. Todas con licencia MIT (ver `LICENSE` en cada carpeta de `lib/`).
