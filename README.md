# Forja 3D

Editor 3D que funciona directamente en el navegador, hecho con **three.js** y **JavaScript vanilla** (módulos ES, sin Node.js, sin empaquetador, sin paso de compilación). Permite construir modelos a partir de primitivas básicas, verlos en modo sólido o alámbrico, gestionar varios proyectos y guardarlo todo en el almacenamiento local del navegador.

## Funcionalidades

- **14 primitivas**: cubo, esfera, cilindro, cono, pirámide, toro, cápsula, plano, anillo, tetraedro, octaedro, dodecaedro, icosaedro y nudo toroidal. Todos sus parámetros (radios, alturas, segmentos…) son editables.
- **Transformaciones** con gizmo (mover / rotar / escalar) o con valores numéricos exactos. Arrastra la etiqueta X/Y/Z de un campo para cambiar el valor deslizando (Mayús = ajuste fino).
- **Modos de vista**: Sólido, Wire (alámbrico) y Mixto (sólido + aristas).
- **Materiales**: color con paleta rápida, metalizado, rugosidad, opacidad y sombreado plano.
- **Escena**: lista de objetos, selección, ocultar/mostrar, duplicar, eliminar, renombrar.
- **Deshacer / rehacer** (hasta 100 pasos).
- **Snap** a rejilla (0,25 u), rotación (15°) y escala (0,1).
- **Gestor de proyectos**: crear, abrir, renombrar, duplicar, eliminar; miniatura automática de cada proyecto.
- **Guardado automático** en `localStorage`.
- **Descargar JSON** de un proyecto o de todos, e **importar JSON** (un proyecto o un paquete completo).

## Atajos de teclado

| Tecla | Acción |
|---|---|
| `W` / `E` / `R` | Mover / Rotar / Escalar |
| `1` / `2` / `3` | Vista sólida / alámbrica / mixta |
| `F` | Encuadrar selección (o toda la escena) |
| `G` | Activar/desactivar snap |
| `Supr` / `Retroceso` | Eliminar objeto seleccionado |
| `Ctrl+D` | Duplicar |
| `Ctrl+Z` / `Ctrl+Y` (o `Ctrl+Mayús+Z`) | Deshacer / Rehacer |
| `Ctrl+S` | Guardar ahora |
| `Esc` | Quitar selección |

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
js/storage.js           Persistencia en localStorage, import/export JSON
lib/three/              three.js r170 (copia local, licencia MIT) y controles
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
- `type` es uno de: `box`, `sphere`, `cylinder`, `cone`, `pyramid`, `torus`, `capsule`, `plane`, `ring`, `tetrahedron`, `octahedron`, `dodecahedron`, `icosahedron`, `torusKnot`.
- “Exportar todo” genera `{ "format": "forja3d-bundle", "projects": [ … ] }`, que también se puede importar.

## Añadir una primitiva nueva

En `js/primitives.js`, añade una entrada a `PRIMITIVES` con su etiqueta, icono SVG, parámetros y la función que crea la geometría, e inclúyela en `TOOLBAR_ORDER`. El panel de propiedades, el guardado y el JSON la recogen automáticamente.

## Limitaciones conocidas

- `localStorage` suele limitarse a unos 5 MB por sitio; descarga los proyectos importantes en JSON.
- Los datos viven en ese navegador y ese dominio: otro navegador u otro equipo no los verá salvo que importes el JSON.
- Aún no hay agrupación jerárquica, operaciones booleanas ni exportación a formatos 3D (glTF/OBJ/STL).

## Licencia

MIT. three.js © three.js authors, licencia MIT (`lib/three/LICENSE`).
