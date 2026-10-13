import { getStroke } from "perfect-freehand";
import type { Doc } from "./doc";
import { clampRect, ctx2d, floodMask, growMask, hardenAlpha, linePixels, makeCanvas, maskBounds, maskToCanvas, pixelStamp, unionRect, type Rect } from "./raster";

export type ToolId = "brush" | "pencil" | "eraser" | "fill" | "line" | "rect" | "ellipse" | "picker" | "select" | "lasso" | "wand" | "move" | "hand";

export interface ToolOptions {
  color: string;
  color2: string;
  recent: string[];
  brush: { size: number; opacity: number; smoothing: number; pressure: boolean; hard: boolean };
  pencil: { size: number; opacity: number; square: boolean };
  eraser: { size: number; opacity: number; hard: boolean };
  fill: { tolerance: number; contiguous: boolean; allLayers: boolean };
  shape: { width: number; opacity: number; filled: boolean; hard: boolean };
  wand: { tolerance: number; contiguous: boolean; allLayers: boolean };
}

export const DEFAULT_TOOL_OPTIONS: ToolOptions = {
  color: "#0E0E0E",
  color2: "#FFFFFF",
  recent: [],
  brush: { size: 8, opacity: 1, smoothing: 0.5, pressure: true, hard: false },
  pencil: { size: 1, opacity: 1, square: true },
  eraser: { size: 24, opacity: 1, hard: false },
  fill: { tolerance: 32, contiguous: true, allLayers: false },
  shape: { width: 4, opacity: 1, filled: false, hard: false },
  wand: { tolerance: 32, contiguous: true, allLayers: false },
};

export const TOOLS: { id: ToolId; label: string; key: string }[] = [
  { id: "brush", label: "Brush", key: "B" },
  { id: "pencil", label: "Pixel pencil", key: "N" },
  { id: "eraser", label: "Eraser", key: "E" },
  { id: "fill", label: "Fill", key: "G" },
  { id: "line", label: "Line", key: "L" },
  { id: "rect", label: "Rectangle", key: "R" },
  { id: "ellipse", label: "Ellipse", key: "O" },
  { id: "picker", label: "Colour picker", key: "I" },
  { id: "select", label: "Select", key: "M" },
  { id: "lasso", label: "Lasso", key: "Q" },
  { id: "wand", label: "Magic wand", key: "W" },
  { id: "move", label: "Move & resize", key: "V" },
  { id: "hand", label: "Hand (pan)", key: "H" },
];

export type Pt = [number, number, number];

/** perfect-freehand outline as a smooth closed path. */
function outlinePath(points: number[][]): Path2D {
  const p = new Path2D();
  if (points.length < 2) return p;
  const [x0, y0] = points[0];
  p.moveTo(x0, y0);
  for (let i = 0; i < points.length; i++) {
    const [ax, ay] = points[i];
    const [bx, by] = points[(i + 1) % points.length];
    p.quadraticCurveTo(ax, ay, (ax + bx) / 2, (ay + by) / 2);
  }
  p.closePath();
  return p;
}

/**
 * One drag of a painting tool on a pixel layer. The stroke is drawn on a scratch canvas, made
 * hard-edged if asked, clipped to the selection, then laid onto the layer over a copy of how the
 * layer looked before the stroke, so opacity stays even and previews never pile up.
 */
export class StrokeSession {
  private snap: HTMLCanvasElement;
  private tmp: HTMLCanvasElement;
  private total: Rect | null = null;
  private pts: Pt[] = [];
  private lastPx: [number, number] | null = null;
  private stamp: HTMLCanvasElement | null = null;
  private start: Pt | null = null;
  private constrain = false;

  constructor(
    private doc: Doc,
    private layerId: string,
    private tool: ToolId,
    private o: ToolOptions,
    private color: string,
  ) {
    this.snap = doc.beginEdit(layerId);
    this.tmp = makeCanvas(doc.width, doc.height);
    if (tool === "pencil") this.stamp = pixelStamp(o.pencil.size, color, o.pencil.square);
    if (tool === "eraser" && o.eraser.hard) this.stamp = pixelStamp(o.eraser.size, "#000", false);
  }

  private get erasing() {
    return this.tool === "eraser";
  }
  private get opacity() {
    const o = this.o;
    return this.tool === "brush" ? o.brush.opacity : this.tool === "pencil" ? o.pencil.opacity : this.tool === "eraser" ? o.eraser.opacity : o.shape.opacity;
  }
  private get hard() {
    const o = this.o;
    return this.tool === "brush" ? o.brush.hard : this.tool === "line" || this.tool === "rect" || this.tool === "ellipse" ? o.shape.hard : false;
  }

  add(x: number, y: number, pressure: number, shift = false) {
    this.constrain = shift;
    const p: Pt = [x, y, pressure];
    if (!this.start) this.start = p;
    if (this.stamp) return this.stampTo(x, y);
    if (this.tool === "line" || this.tool === "rect" || this.tool === "ellipse") this.pts = [this.start, p];
    else this.pts.push(p);
    this.redraw();
  }

  /** Hard-edged tools: stamp every pixel between the last point and this one. */
  private stampTo(x: number, y: number) {
    const s = this.stamp!;
    const half = Math.floor(s.width / 2);
    const tctx = ctx2d(this.tmp);
    const from = this.lastPx ?? [x, y];
    let r: Rect | null = null;
    linePixels(from[0], from[1], x, y, (px, py) => {
      tctx.drawImage(s, px - half, py - half);
      r = unionRect(r, { x: px - half, y: py - half, w: s.width, h: s.height });
    });
    this.lastPx = [x, y];
    this.composite(r);
  }

  private redraw() {
    const tctx = ctx2d(this.tmp);
    let r: Rect | null = null;
    const pad = 4;
    tctx.save();
    if (this.total) tctx.clearRect(this.total.x, this.total.y, this.total.w, this.total.h);
    tctx.fillStyle = this.color;
    tctx.strokeStyle = this.color;
    if (this.tool === "brush" || this.tool === "eraser") {
      const size = this.tool === "brush" ? this.o.brush.size : this.o.eraser.size;
      const pen = this.pts.some((p) => p[2] !== 0.5 && p[2] > 0);
      const outline = getStroke(this.pts, {
        size,
        thinning: this.tool === "brush" && this.o.brush.pressure ? 0.55 : 0,
        smoothing: 0.5,
        streamline: this.tool === "brush" ? this.o.brush.smoothing * 0.85 : 0.3,
        simulatePressure: !pen && this.tool === "brush" && this.o.brush.pressure,
        last: false,
      });
      tctx.fill(outlinePath(outline));
      const xs = this.pts.map((p) => p[0]);
      const ys = this.pts.map((p) => p[1]);
      r = { x: Math.min(...xs) - size, y: Math.min(...ys) - size, w: Math.max(...xs) - Math.min(...xs) + 2 * size, h: Math.max(...ys) - Math.min(...ys) + 2 * size };
    } else {
      const [a, b] = this.pts;
      let bx = b[0],
        by = b[1];
      const w = this.o.shape.width;
      if (this.tool === "line") {
        if (this.constrain) {
          const ang = Math.round(Math.atan2(by - a[1], bx - a[0]) / (Math.PI / 4)) * (Math.PI / 4);
          const len = Math.hypot(bx - a[0], by - a[1]);
          bx = a[0] + Math.cos(ang) * len;
          by = a[1] + Math.sin(ang) * len;
        }
        tctx.lineWidth = w;
        tctx.lineCap = "round";
        tctx.beginPath();
        tctx.moveTo(a[0], a[1]);
        tctx.lineTo(bx, by);
        tctx.stroke();
      } else {
        if (this.constrain) {
          const d = Math.max(Math.abs(bx - a[0]), Math.abs(by - a[1]));
          bx = a[0] + Math.sign(bx - a[0] || 1) * d;
          by = a[1] + Math.sign(by - a[1] || 1) * d;
        }
        const x = Math.min(a[0], bx),
          y = Math.min(a[1], by),
          ww = Math.abs(bx - a[0]),
          hh = Math.abs(by - a[1]);
        tctx.lineWidth = w;
        tctx.lineJoin = "miter";
        tctx.beginPath();
        if (this.tool === "rect") tctx.rect(x, y, ww, hh);
        else tctx.ellipse(x + ww / 2, y + hh / 2, ww / 2, hh / 2, 0, 0, Math.PI * 2);
        if (this.o.shape.filled) tctx.fill();
        else tctx.stroke();
      }
      const x0 = Math.min(a[0], bx),
        y0 = Math.min(a[1], by);
      r = { x: x0 - w, y: y0 - w, w: Math.abs(bx - a[0]) + 2 * w, h: Math.abs(by - a[1]) + 2 * w };
    }
    tctx.restore();
    if (r) r = { x: r.x - pad, y: r.y - pad, w: r.w + 2 * pad, h: r.h + 2 * pad };
    if (r && this.hard) hardenAlpha(this.tmp, r);
    this.composite(r);
  }

  /** Lays the scratch canvas onto the layer within the area touched so far. */
  private composite(r: Rect | null) {
    this.total = unionRect(this.total, r);
    const area = this.total && clampRect(this.total, this.doc.width, this.doc.height);
    if (!area) return;
    const sel = this.doc.selection;
    if (sel) {
      const tctx = ctx2d(this.tmp);
      tctx.save();
      tctx.globalCompositeOperation = "destination-in";
      tctx.drawImage(sel.mask, area.x, area.y, area.w, area.h, area.x, area.y, area.w, area.h);
      tctx.restore();
    }
    const c = this.doc.canvas(this.layerId)!;
    const ctx = ctx2d(c);
    ctx.save();
    ctx.clearRect(area.x, area.y, area.w, area.h);
    ctx.drawImage(this.snap, area.x, area.y, area.w, area.h, area.x, area.y, area.w, area.h);
    ctx.globalAlpha = this.opacity;
    ctx.globalCompositeOperation = this.erasing ? "destination-out" : "source-over";
    ctx.drawImage(this.tmp, area.x, area.y, area.w, area.h, area.x, area.y, area.w, area.h);
    ctx.restore();
    this.doc.touch(this.layerId);
  }

  end() {
    const label = { brush: "Brush", pencil: "Pencil", eraser: "Erase", line: "Line", rect: "Rectangle", ellipse: "Ellipse" }[this.tool as string] ?? "Draw";
    this.doc.endEdit(this.layerId, this.total, label);
  }
}

/** Bucket fill from a point, limited by the selection. */
export function fillAt(doc: Doc, layerId: string, x: number, y: number, o: ToolOptions, color: string) {
  const c = doc.canvas(layerId);
  if (!c) return;
  const src = o.fill.allLayers ? doc.compositeRaster() : c;
  const img = ctx2d(src).getImageData(0, 0, doc.width, doc.height);
  let mask = floodMask(img, Math.floor(x), Math.floor(y), o.fill.tolerance, o.fill.contiguous);
  if (o.fill.tolerance > 0) mask = growMask(mask, doc.width, doc.height);
  const b = maskBounds(mask, doc.width, doc.height);
  if (!b) return;
  const shape = maskToCanvas(mask, doc.width, doc.height);
  const sctx = ctx2d(shape);
  sctx.globalCompositeOperation = "source-in";
  sctx.fillStyle = color;
  sctx.fillRect(0, 0, doc.width, doc.height);
  if (doc.selection) {
    sctx.globalCompositeOperation = "destination-in";
    sctx.drawImage(doc.selection.mask, 0, 0);
  }
  doc.beginEdit(layerId);
  const ctx = ctx2d(c);
  ctx.drawImage(shape, 0, 0);
  doc.endEdit(layerId, b, "Fill");
}

/** Magic wand: selects similar colour from a point. */
export function wandAt(doc: Doc, x: number, y: number, o: ToolOptions) {
  const l = doc.active;
  const src = o.wand.allLayers || !l || l.kind !== "raster" ? doc.compositeRaster() : doc.canvas(l.id)!;
  const img = ctx2d(src).getImageData(0, 0, doc.width, doc.height);
  let mask = floodMask(img, Math.floor(x), Math.floor(y), o.wand.tolerance, o.wand.contiguous);
  // take in the soft edge pixels too, so deleting or moving leaves no halo
  if (o.wand.tolerance > 0) mask = growMask(mask, doc.width, doc.height);
  const b = maskBounds(mask, doc.width, doc.height);
  if (!b) return doc.setSelection(null);
  doc.setSelection({ kind: "mask", mask: maskToCanvas(mask, doc.width, doc.height), bounds: b });
}

/** Rectangle or lasso selection from points. */
export function polygonSelection(doc: Doc, kind: "rect" | "lasso", pts: [number, number][]) {
  if (pts.length < 2) return doc.setSelection(null);
  let poly = pts;
  if (kind === "rect") {
    const [a, b] = [pts[0], pts[pts.length - 1]];
    const x0 = Math.round(Math.min(a[0], b[0])),
      x1 = Math.round(Math.max(a[0], b[0])),
      y0 = Math.round(Math.min(a[1], b[1])),
      y1 = Math.round(Math.max(a[1], b[1]));
    if (x1 - x0 < 1 || y1 - y0 < 1) return doc.setSelection(null);
    poly = [
      [x0, y0],
      [x1, y0],
      [x1, y1],
      [x0, y1],
    ];
  }
  const mask = makeCanvas(doc.width, doc.height);
  const ctx = ctx2d(mask);
  ctx.fillStyle = "#fff";
  ctx.beginPath();
  poly.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  ctx.closePath();
  ctx.fill();
  const xs = poly.map((p) => p[0]);
  const ys = poly.map((p) => p[1]);
  const bounds = clampRect({ x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) }, doc.width, doc.height);
  if (!bounds) return doc.setSelection(null);
  doc.setSelection({ kind, points: poly, mask, bounds });
}

/** Colour of the visible pixels at a point, or null where nothing is drawn. */
export function pickAt(doc: Doc, x: number, y: number, flat?: HTMLCanvasElement): string | null {
  if (x < 0 || y < 0 || x >= doc.width || y >= doc.height) return null;
  const c = flat ?? doc.compositeRaster();
  const d = ctx2d(c).getImageData(Math.floor(x), Math.floor(y), 1, 1).data;
  if (d[3] === 0) return doc.background;
  return "#" + [d[0], d[1], d[2]].map((v) => v.toString(16).padStart(2, "0")).join("").toUpperCase();
}
