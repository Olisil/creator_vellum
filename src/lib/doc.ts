import { clampRect, cloneCanvas, ctx2d, makeCanvas, unionRect, type Rect } from "./raster";
import { newRasterLayer, uid, type Layer, type Project, type RasterLayer, type TraceSettings, type VectorLayer } from "./types";
import { vectorLayerSvg } from "./vector";

/**
 * The open document: layer list, one canvas per pixel layer, the selection, a floating
 * (pasted or lifted) image, and undo history. Lives outside React; components subscribe to
 * `version` and call methods. Layer records are replaced, never changed in place, so history
 * snapshots can keep references.
 */

export interface Selection {
  kind: "rect" | "lasso" | "mask";
  /** outline in canvas pixels (rect and lasso) */
  points?: [number, number][];
  /** white where selected, transparent elsewhere; canvas size */
  mask: HTMLCanvasElement;
  bounds: Rect;
}

export interface FloatingImage {
  canvas: HTMLCanvasElement;
  x: number;
  y: number;
  w: number;
  h: number;
  flipX: boolean;
  flipY: boolean;
  smooth: boolean;
  layerId: string;
  /** layer pixels before the lift, to restore on cancel and for the undo step */
  snapshot: HTMLCanvasElement;
  liftRect: Rect | null;
  /** the paste made a new layer; cancelling removes it */
  createdLayer: boolean;
  label: string;
}

interface DocState {
  layers: Layer[];
  canvases: Map<string, HTMLCanvasElement>;
  activeId: string;
  width: number;
  height: number;
  background: string | null;
}

type Entry =
  | { kind: "pixels"; label: string; layerId: string; rect: Rect; before: ImageData; after: ImageData }
  | { kind: "doc"; label: string; before: DocState; after: DocState; key?: string; at: number };

const MAX_HISTORY = 40;

export class Doc {
  id: string;
  name: string;
  createdAt: number;
  width: number;
  height: number;
  background: string | null;
  layers: Layer[];
  canvases: Map<string, HTMLCanvasElement>;
  activeId: string;
  trace: TraceSettings;

  selection: Selection | null = null;
  floating: FloatingImage | null = null;

  private past: Entry[] = [];
  private future: Entry[] = [];
  private listeners = new Set<() => void>();
  version = 0;
  /** bumps whenever pixels change (for re-tracing) */
  pixelRev = 0;
  /** bumps whenever the selection changes */
  selRev = 0;
  /** layers whose pixels changed since the last save */
  dirty = new Set<string>();
  metaDirty = false;
  private editSnap = new Map<string, HTMLCanvasElement>();

  constructor(p: Project, canvases: Map<string, HTMLCanvasElement>) {
    this.id = p.id;
    this.name = p.name;
    this.createdAt = p.createdAt;
    this.width = p.width;
    this.height = p.height;
    this.background = p.background;
    this.layers = p.layers;
    this.activeId = p.activeId;
    this.trace = p.trace;
    this.canvases = canvases;
    for (const l of this.layers) if (l.kind === "raster" && !canvases.has(l.id)) canvases.set(l.id, makeCanvas(this.width, this.height));
  }

  // ---------- change notification ----------
  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };
  getVersion = () => this.version;
  emit(meta = true) {
    this.version++;
    if (meta) this.metaDirty = true;
    this.listeners.forEach((f) => f());
  }

  toProject(): Project {
    return {
      id: this.id,
      name: this.name,
      createdAt: this.createdAt,
      updatedAt: Date.now(),
      width: this.width,
      height: this.height,
      background: this.background,
      layers: this.layers,
      activeId: this.activeId,
      trace: this.trace,
      version: 1,
    };
  }

  get active(): Layer | undefined {
    return this.layers.find((l) => l.id === this.activeId);
  }
  layer(id: string) {
    return this.layers.find((l) => l.id === id);
  }
  canvas(id: string) {
    return this.canvases.get(id);
  }
  get canUndo() {
    return this.past.length > 0;
  }
  get canRedo() {
    return this.future.length > 0;
  }
  get undoLabel() {
    return this.past[this.past.length - 1]?.label;
  }

  // ---------- history ----------
  private state(): DocState {
    return { layers: this.layers, canvases: new Map(this.canvases), activeId: this.activeId, width: this.width, height: this.height, background: this.background };
  }
  private apply(s: DocState) {
    this.layers = s.layers;
    this.canvases = new Map(s.canvases);
    this.activeId = s.activeId;
    this.width = s.width;
    this.height = s.height;
    this.background = s.background;
    this.pixelRev++;
    for (const l of this.layers) if (l.kind === "raster") this.dirty.add(l.id);
  }
  private push(e: Entry) {
    this.past.push(e);
    if (this.past.length > MAX_HISTORY) this.past.shift();
    this.future = [];
  }

  /** Runs a change to the layer list as one undo step. Same `key` within 1.2 s merges (sliders). */
  change(label: string, fn: () => void, key?: string) {
    const before = this.state();
    fn();
    const after = this.state();
    if (before.canvases.size !== after.canvases.size || [...after.canvases].some(([id, c]) => before.canvases.get(id) !== c)) this.pixelRev++;
    const last = this.past[this.past.length - 1];
    const now = performance.now();
    if (key && last?.kind === "doc" && last.key === key && now - last.at < 1200 && this.future.length === 0) {
      last.after = after;
      last.at = now;
    } else this.push({ kind: "doc", label, before, after, key, at: now });
    this.emit();
  }

  undo() {
    if (this.floating) return this.cancelFloating();
    const e = this.past.pop();
    if (!e) return;
    if (e.kind === "pixels") this.putPixels(e.layerId, e.rect, e.before);
    else this.apply(e.before);
    this.future.push(e);
    this.emit();
  }
  redo() {
    if (this.floating) return;
    const e = this.future.pop();
    if (!e) return;
    if (e.kind === "pixels") this.putPixels(e.layerId, e.rect, e.after);
    else this.apply(e.after);
    this.past.push(e);
    this.emit();
  }
  private putPixels(layerId: string, r: Rect, img: ImageData) {
    const c = this.canvases.get(layerId);
    if (!c) return;
    ctx2d(c).putImageData(img, r.x, r.y);
    this.pixelRev++;
    this.dirty.add(layerId);
  }

  // ---------- pixel edits ----------
  /** Call before drawing on a layer; returns a copy of its pixels to redraw previews from. */
  beginEdit(layerId: string): HTMLCanvasElement {
    const c = this.canvases.get(layerId)!;
    const snap = cloneCanvas(c);
    this.editSnap.set(layerId, snap);
    return snap;
  }
  /** Ends an edit started with beginEdit: records the changed area as one undo step. */
  endEdit(layerId: string, rect: Rect | null, label: string) {
    const snap = this.editSnap.get(layerId);
    this.editSnap.delete(layerId);
    const c = this.canvases.get(layerId);
    if (!snap || !c || !rect) return;
    const r = clampRect(rect, c.width, c.height);
    if (!r) return;
    const before = ctx2d(snap).getImageData(r.x, r.y, r.w, r.h);
    const after = ctx2d(c).getImageData(r.x, r.y, r.w, r.h);
    this.push({ kind: "pixels", label, layerId, rect: r, before, after });
    this.pixelRev++;
    this.dirty.add(layerId);
    this.emit(false);
  }
  /** Marks pixels as changed for redraw (during a stroke). */
  touch(layerId: string) {
    this.dirty.add(layerId);
    this.pixelRev++;
    this.version++;
    this.listeners.forEach((f) => f());
  }

  // ---------- layers ----------
  setActive(id: string) {
    if (this.activeId === id) return;
    this.activeId = id;
    this.emit();
  }
  private replace(id: string, patch: Partial<Layer>) {
    this.layers = this.layers.map((l) => (l.id === id ? ({ ...l, ...patch } as Layer) : l));
  }
  updateLayer(id: string, patch: Partial<Layer>, label = "Change layer", key?: string) {
    this.change(label, () => this.replace(id, patch), key ? `${key}:${id}` : undefined);
  }
  addRasterLayer(name = this.nextName("Layer"), canvas?: HTMLCanvasElement, label = "New layer"): string {
    const layer = newRasterLayer(name);
    this.change(label, () => {
      this.canvases.set(layer.id, canvas ?? makeCanvas(this.width, this.height));
      this.insertAboveActive(layer);
      this.activeId = layer.id;
    });
    this.dirty.add(layer.id);
    return layer.id;
  }
  addVectorLayer(v: Omit<VectorLayer, "id" | "kind" | "visible" | "opacity" | "blend">, label = "Keep vectors", onTop = false): string {
    const layer: VectorLayer = { id: uid(), kind: "vector", visible: true, opacity: 1, blend: "normal", ...v };
    this.change(label, () => {
      if (onTop) this.layers = [...this.layers, layer];
      else this.insertAboveActive(layer);
      this.activeId = layer.id;
    });
    return layer.id;
  }
  replaceVectorLayer(id: string, patch: Partial<VectorLayer>, label = "Trace again") {
    this.change(label, () => this.replace(id, patch));
  }
  private insertAboveActive(layer: Layer) {
    const i = this.layers.findIndex((l) => l.id === this.activeId);
    const at = i < 0 ? this.layers.length : i + 1;
    this.layers = [...this.layers.slice(0, at), layer, ...this.layers.slice(at)];
  }
  nextName(base: string) {
    let n = this.layers.length + 1;
    while (this.layers.some((l) => l.name === `${base} ${n}`)) n++;
    return `${base} ${n}`;
  }
  duplicateLayer(id: string) {
    const src = this.layer(id);
    if (!src) return;
    const copy = { ...structuredClone(src), id: uid(), name: `${src.name} copy` } as Layer;
    this.change("Duplicate layer", () => {
      if (copy.kind === "raster") this.canvases.set(copy.id, cloneCanvas(this.canvases.get(id)!));
      const i = this.layers.findIndex((l) => l.id === id);
      this.layers = [...this.layers.slice(0, i + 1), copy, ...this.layers.slice(i + 1)];
      this.activeId = copy.id;
    });
    if (copy.kind === "raster") this.dirty.add(copy.id);
  }
  removeLayer(id: string) {
    if (this.layers.length <= 1) return;
    this.change("Delete layer", () => {
      const i = this.layers.findIndex((l) => l.id === id);
      this.layers = this.layers.filter((l) => l.id !== id);
      this.canvases.delete(id);
      if (this.activeId === id) this.activeId = this.layers[Math.max(0, i - 1)].id;
    });
  }
  moveLayer(id: string, dir: 1 | -1) {
    const i = this.layers.findIndex((l) => l.id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= this.layers.length) return;
    this.change(dir > 0 ? "Move layer up" : "Move layer down", () => {
      const ls = [...this.layers];
      [ls[i], ls[j]] = [ls[j], ls[i]];
      this.layers = ls;
    });
  }
  /** Merges a layer into the pixel layer below it (vector layers are drawn as pixels). */
  async mergeDown(id: string) {
    const i = this.layers.findIndex((l) => l.id === id);
    const top = this.layers[i];
    const below = this.layers[i - 1];
    if (!top || !below || below.kind !== "raster") return;
    const merged = cloneCanvas(this.canvases.get(below.id)!);
    const ctx = ctx2d(merged);
    ctx.globalAlpha = top.opacity;
    ctx.globalCompositeOperation = blendOp(top.blend);
    if (top.kind === "raster") ctx.drawImage(this.canvases.get(top.id)!, 0, 0);
    else ctx.drawImage(await this.renderVector(top), 0, 0);
    this.change("Merge down", () => {
      this.canvases.set(below.id, merged);
      this.canvases.delete(top.id);
      this.layers = this.layers.filter((l) => l.id !== top.id);
      this.activeId = below.id;
    });
    this.dirty.add(below.id);
  }
  /** Turns a vector layer into pixels in place. */
  async rasterize(id: string) {
    const l = this.layer(id);
    if (!l || l.kind !== "vector") return;
    const c = await this.renderVector(l);
    const r: RasterLayer = { id: l.id, kind: "raster", name: l.name, visible: l.visible, opacity: l.opacity, blend: l.blend };
    this.change("Turn into pixels", () => {
      this.canvases.set(id, c);
      this.layers = this.layers.map((x) => (x.id === id ? r : x));
    });
    this.dirty.add(id);
  }
  setBackground(bg: string | null) {
    this.change("Background", () => (this.background = bg), "bg");
  }
  setTrace(patch: Partial<TraceSettings>) {
    this.trace = { ...this.trace, ...patch };
    this.emit();
  }
  rename(name: string) {
    this.name = name;
    this.emit();
  }

  /** New canvas size; pixels keep their place relative to the anchor (0..1 in x and y). */
  resize(w: number, h: number, ax = 0.5, ay = 0.5) {
    w = Math.max(1, Math.min(8192, Math.round(w)));
    h = Math.max(1, Math.min(8192, Math.round(h)));
    if (w === this.width && h === this.height) return;
    this.commitFloating();
    const dx = Math.round((w - this.width) * ax);
    const dy = Math.round((h - this.height) * ay);
    this.selection = null;
    this.selRev++;
    this.change("Canvas size", () => {
      const next = new Map<string, HTMLCanvasElement>();
      for (const [id, c] of this.canvases) {
        const n = makeCanvas(w, h);
        ctx2d(n).drawImage(c, dx, dy);
        next.set(id, n);
        this.dirty.add(id);
      }
      this.canvases = next;
      this.layers = this.layers.map((l) => (l.kind === "vector" ? { ...l, x: l.x + dx, y: l.y + dy } : l));
      this.width = w;
      this.height = h;
    });
  }

  // ---------- selection ----------
  setSelection(sel: Selection | null) {
    this.selection = sel;
    this.selRev++;
    this.emit(false);
  }
  selectAll() {
    const mask = makeCanvas(this.width, this.height);
    const ctx = ctx2d(mask);
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, this.width, this.height);
    this.setSelection({
      kind: "rect",
      points: [
        [0, 0],
        [this.width, 0],
        [this.width, this.height],
        [0, this.height],
      ],
      mask,
      bounds: { x: 0, y: 0, w: this.width, h: this.height },
    });
  }
  /** Clears the selected pixels (or the whole layer) of a pixel layer. */
  clearSelection(layerId = this.activeId) {
    const c = this.canvases.get(layerId);
    if (!c) return;
    const r = this.selection?.bounds ?? { x: 0, y: 0, w: this.width, h: this.height };
    this.beginEdit(layerId);
    const ctx = ctx2d(c);
    ctx.save();
    if (this.selection) {
      ctx.globalCompositeOperation = "destination-out";
      ctx.drawImage(this.selection.mask, 0, 0);
    } else ctx.clearRect(0, 0, c.width, c.height);
    ctx.restore();
    this.endEdit(layerId, r, "Delete pixels");
  }
  /** The selected pixels of a layer (or its whole content), cropped to the selection. */
  copyPixels(layerId = this.activeId): { canvas: HTMLCanvasElement; rect: Rect } | null {
    const c = this.canvases.get(layerId);
    if (!c) return null;
    const r = this.selection?.bounds ?? { x: 0, y: 0, w: this.width, h: this.height };
    const out = makeCanvas(r.w, r.h);
    const ctx = ctx2d(out);
    ctx.drawImage(c, -r.x, -r.y);
    if (this.selection) {
      ctx.globalCompositeOperation = "destination-in";
      ctx.drawImage(this.selection.mask, -r.x, -r.y);
    }
    return { canvas: out, rect: r };
  }

  // ---------- floating image (paste, move, resize) ----------
  /** Lifts the selected pixels (or the whole layer) off a pixel layer so they can be moved and resized. */
  lift(layerId = this.activeId): boolean {
    if (this.floating) return true;
    const l = this.layer(layerId);
    const c = this.canvases.get(layerId);
    if (!l || l.kind !== "raster" || !c) return false;
    const got = this.copyPixels(layerId);
    if (!got) return false;
    // crop to what is actually drawn when nothing is selected
    let rect = got.rect;
    let canvas = got.canvas;
    if (!this.selection) {
      const b = boundsOf(canvas);
      if (!b) return false;
      const crop = makeCanvas(b.w, b.h);
      ctx2d(crop).drawImage(canvas, -b.x, -b.y);
      canvas = crop;
      rect = { x: rect.x + b.x, y: rect.y + b.y, w: b.w, h: b.h };
    }
    const snapshot = cloneCanvas(c);
    const ctx = ctx2d(c);
    ctx.save();
    ctx.globalCompositeOperation = "destination-out";
    if (this.selection) ctx.drawImage(this.selection.mask, 0, 0);
    else ctx.clearRect(rect.x, rect.y, rect.w, rect.h);
    ctx.restore();
    this.floating = { canvas, ...rect, flipX: false, flipY: false, smooth: true, layerId, snapshot, liftRect: rect, createdLayer: false, label: "Move pixels" };
    this.selection = null;
    this.selRev++;
    this.touch(layerId);
    return true;
  }

  /** Pastes an image as a new layer, floating so it can be placed and sized before it is applied. */
  paste(img: HTMLCanvasElement, name = "Pasted image", at?: { x: number; y: number }, fit = true) {
    this.commitFloating();
    const id = this.addRasterLayer(name, undefined, "Paste");
    const c = this.canvases.get(id)!;
    let w = img.width,
      h = img.height;
    const k = fit ? Math.min(1, (this.width * 0.9) / w, (this.height * 0.9) / h) : 1;
    w = Math.max(1, Math.round(w * k));
    h = Math.max(1, Math.round(h * k));
    const x = Math.round(at ? at.x - w / 2 : (this.width - w) / 2);
    const y = Math.round(at ? at.y - h / 2 : (this.height - h) / 2);
    this.floating = { canvas: img, x, y, w, h, flipX: false, flipY: false, smooth: true, layerId: id, snapshot: cloneCanvas(c), liftRect: null, createdLayer: true, label: "Place image" };
    this.selection = null;
    this.selRev++;
    this.emit(false);
  }

  setFloating(patch: Partial<FloatingImage>) {
    if (!this.floating) return;
    this.floating = { ...this.floating, ...patch };
    this.emit(false);
  }

  /** Draws the floating image into its layer: one undo step with the lift. */
  commitFloating() {
    const f = this.floating;
    if (!f) return;
    const c = this.canvases.get(f.layerId);
    this.floating = null;
    if (!c) return this.emit(false);
    const ctx = ctx2d(c);
    ctx.save();
    ctx.imageSmoothingEnabled = f.smooth;
    ctx.imageSmoothingQuality = "high";
    ctx.translate(f.x + (f.flipX ? f.w : 0), f.y + (f.flipY ? f.h : 0));
    ctx.scale(f.flipX ? -1 : 1, f.flipY ? -1 : 1);
    ctx.drawImage(f.canvas, 0, 0, f.w, f.h);
    ctx.restore();
    const r = unionRect(f.liftRect, { x: Math.floor(f.x), y: Math.floor(f.y), w: Math.ceil(f.w) + 1, h: Math.ceil(f.h) + 1 });
    this.editSnap.set(f.layerId, f.snapshot);
    this.endEdit(f.layerId, r, f.label);
  }

  cancelFloating() {
    const f = this.floating;
    if (!f) return;
    this.floating = null;
    const c = this.canvases.get(f.layerId);
    if (f.createdLayer) {
      // drop the "Paste" step that made the layer
      const e = this.past[this.past.length - 1];
      if (e?.kind === "doc" && e.label === "Paste") {
        this.past.pop();
        this.apply(e.before);
      }
    } else if (c) {
      const ctx = ctx2d(c);
      ctx.clearRect(0, 0, c.width, c.height);
      ctx.drawImage(f.snapshot, 0, 0);
      this.pixelRev++;
      this.dirty.add(f.layerId);
    }
    this.emit();
  }

  // ---------- rendering ----------
  /** Draws a vector layer to a canvas of the document size. */
  async renderVector(l: VectorLayer, w = this.width, h = this.height, scale = 1): Promise<HTMLCanvasElement> {
    const svg = vectorLayerSvg(l, this.width, this.height);
    const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
    try {
      const img = new Image();
      img.decoding = "async";
      img.src = url;
      await img.decode();
      const c = makeCanvas(w * scale, h * scale);
      ctx2d(c).drawImage(img, 0, 0, w * scale, h * scale);
      return c;
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  /**
   * The visible layers flattened. `vectors` includes vector layers (async), `background` paints
   * the background colour first, `only` limits it to some layers.
   */
  async composite(opts: { vectors?: boolean; background?: boolean; scale?: number; only?: string[] } = {}): Promise<HTMLCanvasElement> {
    const s = opts.scale ?? 1;
    const out = makeCanvas(this.width * s, this.height * s);
    const ctx = ctx2d(out);
    ctx.imageSmoothingEnabled = s < 1;
    if (opts.background && this.background) {
      ctx.fillStyle = this.background;
      ctx.fillRect(0, 0, out.width, out.height);
    }
    for (const l of this.layers) {
      if (opts.only ? !opts.only.includes(l.id) : !l.visible) continue;
      ctx.globalAlpha = l.opacity;
      ctx.globalCompositeOperation = blendOp(l.blend);
      if (l.kind === "raster") ctx.drawImage(this.canvases.get(l.id)!, 0, 0, out.width, out.height);
      else if (opts.vectors) ctx.drawImage(await this.renderVector(l, this.width, this.height, s), 0, 0);
    }
    return out;
  }

  /** Sync flatten of the visible pixel layers (for the eyedropper and fills). */
  compositeRaster(): HTMLCanvasElement {
    const out = makeCanvas(this.width, this.height);
    const ctx = ctx2d(out);
    for (const l of this.layers) {
      if (!l.visible || l.kind !== "raster") continue;
      ctx.globalAlpha = l.opacity;
      ctx.globalCompositeOperation = blendOp(l.blend);
      ctx.drawImage(this.canvases.get(l.id)!, 0, 0);
    }
    return out;
  }
}

export function blendOp(b: string): GlobalCompositeOperation {
  return b === "normal" ? "source-over" : (b as GlobalCompositeOperation);
}

function boundsOf(c: HTMLCanvasElement): Rect | null {
  const { width: w, height: h } = c;
  const d = ctx2d(c).getImageData(0, 0, w, h).data;
  let x0 = w,
    y0 = h,
    x1 = -1,
    y1 = -1;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      if (d[(y * w + x) * 4 + 3]) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        y1 = y;
      }
  return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}
