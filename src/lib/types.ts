/** Project format and defaults for Creator Vellum. */

export type BlendMode = "normal" | "multiply" | "screen" | "overlay" | "darken" | "lighten";

interface LayerBase {
  id: string;
  name: string;
  visible: boolean;
  opacity: number; // 0..1
  blend: BlendMode;
  locked?: boolean;
}

/** A pixel layer; its pixels live in a canvas (and as a PNG in storage), not in this record. */
export interface RasterLayer extends LayerBase {
  kind: "raster";
}

/** A traced layer: SVG paths in canvas pixel units, moved by x/y and scaled by `scale`. */
export interface VectorLayer extends LayerBase {
  kind: "vector";
  /** `<path …/>` elements (and groups), canvas pixel units */
  svg: string;
  x: number;
  y: number;
  scale: number;
  stats?: { paths: number; points: number; colors: number };
  /** what it was traced from, so it can be traced again with other settings */
  source?: { layerIds: string[]; scope: TraceScope; settings: TraceSettings };
}

export type Layer = RasterLayer | VectorLayer;

export type TraceScope = "layer" | "visible" | "selection";
export type Engine = "vtracer" | "imagetracer";

export interface TraceSettings {
  engine: Engine;
  scope: TraceScope;
  // colours
  colorMode: "color" | "bw" | "regions";
  /** auto-quantize to this many colours (0 = off) */
  maxColors: number;
  /** bits per channel kept when clustering (1-8) */
  colorPrecision: number;
  /** colour difference between gradient steps (0-128) */
  layerDifference: number;
  /** black & white: threshold 0-255, foreground darker than it */
  threshold: number;
  adaptive: boolean;
  invert: boolean;
  /** colour of black & white traces */
  inkColor: string;
  /** regions mode: level of detail */
  regionDetail: number;
  // shapes
  curve: "spline" | "polygon" | "pixel";
  hierarchical: "stacked" | "cutout";
  filterSpeckle: number;
  cornerThreshold: number;
  lengthThreshold: number;
  spliceThreshold: number;
  maxIterations: number;
  // preparation
  blur: number;
  traceScale: number;
  // clean-up
  simplify: number;
  pathPrecision: number;
  minSize: number;
  dropColor: string | null;
  dropTolerance: number;
  merge: boolean;
  // ImageTracer
  itLineTolerance: number;
  itCurveTolerance: number;
  itPathOmit: number;
  itRightAngles: boolean;
  itColorSampling: 0 | 1 | 2;
  itCycles: number;
  itMinColorRatio: number;
  itStroke: number;
}

export interface Project {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  width: number;
  height: number;
  /** colour behind the layers, or null for transparent */
  background: string | null;
  layers: Layer[];
  activeId: string;
  trace: TraceSettings;
  version: 1;
}

export function uid() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

export const DEFAULT_TRACE: TraceSettings = {
  engine: "vtracer",
  scope: "visible",
  colorMode: "color",
  maxColors: 8,
  colorPrecision: 6,
  layerDifference: 16,
  threshold: 160,
  adaptive: false,
  invert: false,
  inkColor: "#000000",
  regionDetail: 128,
  curve: "spline",
  hierarchical: "stacked",
  filterSpeckle: 4,
  cornerThreshold: 60,
  lengthThreshold: 4,
  spliceThreshold: 45,
  maxIterations: 10,
  blur: 0,
  traceScale: 1,
  simplify: 0,
  pathPrecision: 2,
  minSize: 0,
  dropColor: null,
  dropTolerance: 24,
  merge: true,
  itLineTolerance: 1,
  itCurveTolerance: 1,
  itPathOmit: 8,
  itRightAngles: true,
  itColorSampling: 2,
  itCycles: 3,
  itMinColorRatio: 0,
  itStroke: 0,
};

export interface TracePreset {
  id: string;
  name: string;
  hint: string;
  settings: Partial<TraceSettings>;
}

export const PRESETS: TracePreset[] = [
  {
    id: "line-art",
    name: "Line art",
    hint: "Black and white ink, smooth curves",
    settings: { engine: "vtracer", colorMode: "bw", threshold: 160, adaptive: false, curve: "spline", filterSpeckle: 4, cornerThreshold: 60, lengthThreshold: 4, simplify: 0.8, blur: 0 },
  },
  {
    id: "logo",
    name: "Logo",
    hint: "Few flat colours, clean edges",
    settings: { engine: "vtracer", colorMode: "color", maxColors: 6, colorPrecision: 6, layerDifference: 16, hierarchical: "cutout", curve: "spline", filterSpeckle: 6, cornerThreshold: 60, simplify: 1, blur: 0, merge: true },
  },
  {
    id: "pixel-art",
    name: "Pixel art",
    hint: "Exact pixel edges, every colour kept",
    settings: { engine: "vtracer", colorMode: "color", maxColors: 0, colorPrecision: 8, layerDifference: 1, hierarchical: "cutout", curve: "pixel", filterSpeckle: 0, simplify: 0, blur: 0, traceScale: 1, merge: true },
  },
  {
    id: "poster",
    name: "Poster",
    hint: "Bold shapes in a handful of colours",
    settings: { engine: "vtracer", colorMode: "color", maxColors: 5, colorPrecision: 5, layerDifference: 24, hierarchical: "stacked", curve: "spline", filterSpeckle: 12, cornerThreshold: 80, simplify: 1.5, blur: 1 },
  },
  {
    id: "sharp",
    name: "Sharp shapes",
    hint: "Straight edges and corners",
    settings: { engine: "vtracer", colorMode: "color", maxColors: 8, hierarchical: "cutout", curve: "polygon", filterSpeckle: 4, cornerThreshold: 30, simplify: 0.5, blur: 0 },
  },
  {
    id: "detailed",
    name: "Detailed",
    hint: "Images and paintings, many colours",
    settings: { engine: "vtracer", colorMode: "color", maxColors: 0, colorPrecision: 6, layerDifference: 12, hierarchical: "stacked", curve: "spline", filterSpeckle: 2, cornerThreshold: 60, simplify: 0, blur: 0 },
  },
  {
    id: "soft",
    name: "Soft & curvy",
    hint: "ImageTracer engine, rounded forms",
    settings: { engine: "imagetracer", maxColors: 8, itLineTolerance: 0.5, itCurveTolerance: 0.5, itPathOmit: 8, itRightAngles: false, itColorSampling: 2, itCycles: 3, blur: 1, itStroke: 1 },
  },
];

export const CANVAS_SIZES: { w: number; h: number; label: string }[] = [
  { w: 1600, h: 1200, label: "1600 × 1200" },
  { w: 1920, h: 1080, label: "1920 × 1080 HD" },
  { w: 1080, h: 1920, label: "1080 × 1920 Portrait" },
  { w: 2048, h: 2048, label: "2048 × 2048" },
  { w: 1024, h: 1024, label: "1024 × 1024" },
  { w: 800, h: 600, label: "800 × 600" },
  { w: 256, h: 256, label: "256 × 256 Pixel art" },
  { w: 128, h: 128, label: "128 × 128 Pixel art" },
  { w: 64, h: 64, label: "64 × 64 Pixel art" },
  { w: 32, h: 32, label: "32 × 32 Pixel art" },
];

export function newRasterLayer(name: string): RasterLayer {
  return { id: uid(), kind: "raster", name, visible: true, opacity: 1, blend: "normal" };
}

export function newProject(name = "Untitled sketch", w = 1600, h = 1200): Project {
  const now = Date.now();
  const layer = newRasterLayer("Sketch");
  return {
    id: uid(),
    name,
    createdAt: now,
    updatedAt: now,
    width: w,
    height: h,
    background: "#FFFFFF",
    layers: [layer],
    activeId: layer.id,
    trace: { ...DEFAULT_TRACE },
    version: 1,
  };
}

/** Fill in anything missing from an older or hand-edited project. */
export function coerceProject(raw: Partial<Project>): Project {
  const base = newProject();
  const p: Project = { ...base, ...raw, trace: { ...DEFAULT_TRACE, ...(raw.trace ?? {}) } } as Project;
  p.width = Math.max(1, Math.min(8192, Math.round(p.width || base.width)));
  p.height = Math.max(1, Math.min(8192, Math.round(p.height || base.height)));
  if (!Array.isArray(p.layers) || p.layers.length === 0) p.layers = base.layers;
  p.layers = p.layers.map((l) =>
    l.kind === "vector"
      ? { ...l, opacity: l.opacity ?? 1, blend: l.blend ?? "normal", visible: l.visible ?? true, x: l.x ?? 0, y: l.y ?? 0, scale: l.scale ?? 1, svg: l.svg ?? "" }
      : { ...l, kind: "raster", opacity: l.opacity ?? 1, blend: l.blend ?? "normal", visible: l.visible ?? true },
  );
  if (!p.layers.some((l) => l.id === p.activeId)) p.activeId = p.layers[p.layers.length - 1].id;
  return p;
}
