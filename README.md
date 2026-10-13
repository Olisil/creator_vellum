# Creator Vellum

Sketch and vectorize, as a page on nassau.se. Draw in pixels on layers (brush, pixel pencil,
eraser, fill, shapes, selections, move and resize), paste or drop in images, then trace them
into clean vectors with fine control. Copy straight into Figma, or download SVG, PDF and PNG.
No backend, no accounts: projects live in the browser (IndexedDB) and can be downloaded as
`.vellum.json` files.

## Run locally

    npm install
    npm run dev        # http://localhost:5173

Node 22+. Current Chrome, Edge, Firefox and Safari.

## Deploy as a page under nassau.se (Webflow Cloud)

Plain Vite + React, which Webflow Cloud builds directly (`webflow.json` pins `vite`). Don't set
`base` in `vite.config.ts`; Webflow Cloud sets it from the mount path. Routing is hash based
(`#/`, `#/p/<id>`), so any mount path works without rewrites.

1. Push this folder to GitHub (contents at the repository root).
2. nassau.se site settings > Webflow Cloud > create a project from the repository, mount path
   `/creator_vellum` (or `/apps/creator_vellum`, like the other apps).
3. Publish the site once. Every push to the branch redeploys.

## How it works

- **Document** (`src/lib/doc.ts`): the layer list, one canvas per pixel layer, the selection, a
  floating (pasted or lifted) image, and undo history. Pixel edits store only the changed
  rectangle; layer changes store the layer list. It lives outside React; the UI subscribes.
- **Tools** (`src/lib/tools.ts`): strokes are drawn on a scratch canvas and laid over a copy of
  the layer, so opacity stays even. The brush uses perfect-freehand (pressure from a pen, or
  simulated from speed); the pixel pencil and pixel eraser stamp every pixel along the line.
  Painting, filling and tracing stay inside the selection.
- **Tracing** (`src/lib/trace.worker.ts`) runs in a worker: optional softening, colour reduction
  (the colours that are both common and clearly different are kept, refined with k-means, every
  pixel snapped to them), then the engine, then clean-up (simplify, remove small shapes, remove a
  colour, merge shapes of the same colour). A newer trace stops a running one.
  - **Precise** = VTracer, compiled to WebAssembly (`src/vendor/vtracer`, from the npm package
    `@visioncortex/vtracer` 1.0.0-alpha.4, its glue rewritten as an ES module).
  - **Soft** = ImageTracer.js.
- **Figma copy** puts the SVG on the clipboard as text (and as an SVG image where the browser
  allows it). Figma turns pasted SVG code into a frame of editable vector layers, each layer of
  the drawing a group named like it. Illustrator, Affinity and Inkscape take it the same way.
- **Paste in**: images (from the clipboard, a file, or dropped) become a new pixel layer you place
  and size before applying. SVG code becomes a vector layer; scripts, event handlers, external
  links and `<style>` are removed and ids made unique.
- **Saving**: every change is saved after a moment, each pixel layer as its own PNG, so a stroke
  only rewrites the layer it touched.

## Design system

`src/base.css` is the shared Nassau app frame from the Voyager apps: the exact Webflow variables
of nassau.se, the header plate (logo, breadcrumb, Buy me a coffee with the same support panel as
nassau.se/apps, Apps home, theme toggle shared through `localStorage["dark-mode"]`), the step
bar with the project menu, the side panel, buttons and controls. `src/vellum.css` adds the
drawing stage, tool palette, layers panel, presets and export.

The logo in `src/components/Logo.tsx` is a placeholder (the Nassau app icon and the name) until
the Creator Vellum logo file is ready: put the SVG in `src/assets/` and swap the component for an
`<img>`, like the Voyager apps.

## Keyboard

B brush, N pixel pencil, E eraser, G fill, L line, R rectangle, O ellipse, I colour picker,
M select, Q lasso, W magic wand, V move & resize, H hand. `[` `]` size, X swap colours, Space
(hold) pan, Ctrl/⌘ Z undo, Ctrl/⌘ Shift Z redo, Ctrl/⌘ A select all, Ctrl/⌘ D deselect,
Ctrl/⌘ C / X / V copy, cut, paste, Ctrl/⌘ J duplicate layer, Ctrl/⌘ Shift N new layer,
Delete clears the selection, Enter applies a move, Esc cancels it, Ctrl/⌘ 0 fit, Ctrl/⌘ 1 100%.
Ctrl/⌘ + scroll or a pinch zooms; scroll or two fingers pans.

## Licences of the parts

All free to use in a commercial site.

| Part | Licence |
| --- | --- |
| VTracer (visioncortex) | MIT or Apache-2.0 |
| ImageTracer.js (András Jankovics) | Unlicense (public domain) |
| perfect-freehand (Steve Ruiz) | MIT |
| jsPDF | MIT |
| svg2pdf.js (yWorks) | MIT |
| React, Vite | MIT |
| Raleway (fallback font) | SIL Open Font License |
