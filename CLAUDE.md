# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Proyecto

Forja 3D: editor 3D + editor 2D de planos (estilo AutoCAD) que corre en el navegador. three.js r170 y JavaScript vanilla con módulos ES: **sin Node, sin npm, sin empaquetador, sin build, sin tests ni linter**. Toda la interfaz, los comentarios, los mensajes de commit y la documentación están en **español**.

## Ejecutar

Los módulos ES no cargan desde `file://`; hace falta un servidor estático:

    python3 -m http.server 8000   # http://localhost:8000

No hay suite de tests: los cambios se verifican abriendo la app en el navegador (consola sin errores, probar la función en 3D y/o 2D, recargar para comprobar que se guarda y se restaura). Se publica tal cual en GitHub Pages (`.nojekyll`, rutas relativas).

## Dependencias

Copias locales en `lib/` resueltas por el import map de `index.html` (`three`, `three/addons/`, `three-mesh-bvh`, `three-bvh-csg`). No añadir CDNs ni paquetes npm; si hace falta un addon de three, copiarlo a `lib/three/addons/`.

## Arquitectura

- `index.html`: marcado estático de ambas pantallas (proyectos y editor), barras y paneles; `main.js` los rellena y les engancha eventos.
- `js/main.js`: capa de UI. Navegación por hash (`#/p/<id>` abre un proyecto), gestor de proyectos, barra de herramientas, panel de propiedades (`renderProps`, `renderCadProps`), árbol de Escena (`refreshOutliner`), diálogos, atajos globales (`onKey`), acciones de la paleta (`paletteActions`) y guardado (`snapshotProject` → `scheduleSave` → `store.saveProject`). Construye DOM con el helper `h(tag, attrs, ...children)` y botones con `actBtn`/`opBtn`/`cadBtn`.
- `js/editor.js`: clase `Editor` (extiende `EventTarget`): escena, objetos (`Map` id → mesh con los datos en `mesh.userData`), selección, gizmo, booleanas, escultor, vistas, historial y serialización. Se comunica con la UI solo por `CustomEvent`s: `objects`, `select`, `transform`, `change`, `history`, `workspace`, `layout`, `camera`, `sculpt`, `notice`… `main.js` escucha y vuelve a pintar.
- Historial 3D: cada cambio confirmado llama a `_commit()`, que guarda un snapshot JSON completo (`_snapshot`) en `history` (máx. 100) y emite `objects` + `change` (este último dispara el autoguardado). `update(id, patch, false)` sirve para cambios en vivo (arrastrar, deslizar) sin crear paso de historial; se confirma al soltar.
- Datos de objeto = lo que va al JSON del proyecto (`type`, `params`, `shape`, `position`, `rotation` en grados, `scale`, `material`, `operands`…). La geometría se regenera siempre a partir de esos datos: `primitives.js` (`buildGeometry`) y `csg.js` (`geometryFor`, booleanas con caché por `csgKey`). Las mallas importadas o esculpidas se guardan codificadas con `io.js` (`encodeGeometry`/`decodeGeometry`).
- `js/views.js`: `View` (cámara + OrbitControls por panel 3D) y `CadPanel` (envoltorio de `CadView` en 2D); `LAYOUTS` para pantalla dividida. Hay dos espacios de trabajo, `'3d'` y `'2d'` (`editor.setWorkspace`), cada uno con su deshacer y su propia división de pantalla.
- `js/cad2d.js`: todo el 2D. `Cad` (también `EventTarget`, emite con `this.emit(...)`) es el modelo de un plano (`drawing`: entidades, capas, papel, cajetín, rejilla…) con su propio historial (`commit`/`undo`/`redo`); `CadView` es un canvas con su propio zoom y encuadre que dibuja ese mismo `Cad`. Las órdenes son máquinas de estado: `CAD_TOOLS` (dibujo/cotas) y `CAD_OPS` (edición) declaran etiqueta, alias de la línea de órdenes e icono; el comportamiento está en el registro interno `TOOLS` (`nombre: cad => ({ prompt, point, input, preview, … })`). `setTool`/`runOp` las activan; `handleKey` gestiona la línea de órdenes. También exporta/importa DXF, SVG y PDF vectorial.
- Hojas: `main.js` mantiene `sheets` (`[{ id, name, drawing }]`) y solo la hoja activa vive en `editor.cad`; al cambiar de hoja se guarda su estado de trabajo con `cad.stash()`.
- Croquis (Extrusión/Revolución): reutiliza el mismo `Cad` 2D en modo croquis (`cad.beginSketch`, `openSketch`/`finishSketch` en `main.js`) y lo convierte con `profileFromSketch`; la pieza guarda el `sketch` para reeditarlo.
- `js/storage.js`: proyectos en IndexedDB (migra los antiguos de `localStorage`), formato `forja3d-project` v1. `localStorage` solo para preferencias de UI (tema, panel lateral, opciones de referencias…), siempre dentro de `try/catch`.
- Otros: `sculpt.js` (vóxeles con marching cubes / deformación de malla con BVH), `sketch3d.js` (vista «Lápiz»), `palette.js` (Ctrl+K), `help.js` (guía `SECTIONS` y proyectos de ejemplo `EXAMPLES`), `pdf.js` (generador PDF mínimo), `theme.js` (`cssVar` para leer colores del tema; los colores de los canvas salen de variables CSS, nunca fijos en el código).

## Convenciones al añadir o cambiar una función

Cada función nueva suele tocar a la vez (ver commits recientes):
1. La lógica (`editor.js` y/o `cad2d.js`) y su UI en `main.js` (+ `index.html`/`css/style.css`).
2. Una acción en `paletteActions()` (con `ws: '2d'|'3d'` si es de un solo espacio) y, si tiene tecla, en `onKey` / `Cad.handleKey`.
3. La ayuda integrada en `js/help.js` (sección correspondiente y tabla de atajos).
4. El `README.md` (lista de funcionalidades, atajos y formato del JSON si cambia).

Si se añade estado al proyecto, serializarlo y tolerar proyectos antiguos sin ese campo (valores por defecto al cargar). Nueva primitiva: entrada en `PRIMITIVES` y en `TOOLBAR_ORDER` de `primitives.js`; propiedades y guardado salen solos.

Estilo: código compacto (funciones flecha, líneas largas, pocos comentarios y en español), sin frameworks ni dependencias. Los textos de UI usan coma decimal y terminología de CAD en español (alzado, planta, perfil, cota, desfase…).
