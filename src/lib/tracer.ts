import type { Doc } from "./doc";
import { contentBounds, ctx2d, makeCanvas, type Rect } from "./raster";
import type { TraceRequest, TraceResponse } from "./trace.worker";
import type { TraceScope, TraceSettings } from "./types";
import type { TraceStats } from "./vector";

export interface TraceSource {
  canvas: HTMLCanvasElement;
  /** where the traced area sits on the canvas */
  x: number;
  y: number;
  /** canvas pixels per traced pixel */
  unit: number;
  layerIds: string[];
  scope: TraceScope;
}

export interface TraceResult {
  markup: string;
  stats: TraceStats;
  ms: number;
  x: number;
  y: number;
  unit: number;
  layerIds: string[];
  scope: TraceScope;
}

/** What to trace: the active pixel layer, all visible pixel layers, or the visible pixels in the selection. */
export function traceSource(doc: Doc, s: TraceSettings): TraceSource | string {
  let src: HTMLCanvasElement;
  let layerIds: string[];
  let area: Rect | null;
  if (s.scope === "layer") {
    const l = doc.active;
    if (!l || l.kind !== "raster") return "Pick a pixel layer to trace, or trace all visible layers.";
    src = doc.canvas(l.id)!;
    layerIds = [l.id];
    area = contentBounds(src);
  } else {
    src = doc.compositeRaster();
    layerIds = doc.layers.filter((l) => l.visible && l.kind === "raster").map((l) => l.id);
    if (s.scope === "selection") {
      if (!doc.selection) return "Make a selection first, or trace a layer or all visible layers.";
      const masked = makeCanvas(src.width, src.height);
      const ctx = ctx2d(masked);
      ctx.drawImage(src, 0, 0);
      ctx.globalCompositeOperation = "destination-in";
      ctx.drawImage(doc.selection.mask, 0, 0);
      src = masked;
    }
    area = contentBounds(src);
  }
  if (!area) return s.scope === "layer" ? "This layer is empty. Draw or paste something first." : "There's nothing to trace yet. Draw or paste something first.";
  const k = Math.max(0.1, Math.min(4, s.traceScale));
  const out = makeCanvas(Math.max(1, Math.round(area.w * k)), Math.max(1, Math.round(area.h * k)));
  const ctx = ctx2d(out);
  ctx.imageSmoothingEnabled = !(k >= 1 && s.curve === "pixel");
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(src, area.x, area.y, area.w, area.h, 0, 0, out.width, out.height);
  return { canvas: out, x: area.x, y: area.y, unit: area.w / out.width, layerIds, scope: s.scope };
}

/**
 * Runs traces in a worker. Only the newest request matters: when a new trace starts while one is
 * still running, the busy worker is stopped and a fresh one takes over, so slow settings never
 * queue up behind each other.
 */
export class Tracer {
  private worker: Worker | null = null;
  private seq = 0;
  private waiting = new Map<number, (r: TraceResponse | null) => void>();

  private get w() {
    if (!this.worker) {
      this.worker = new Worker(new URL("./trace.worker.ts", import.meta.url), { type: "module" });
      this.worker.onmessage = (e: MessageEvent<TraceResponse>) => {
        const done = this.waiting.get(e.data.id);
        this.waiting.delete(e.data.id);
        done?.(e.data);
      };
      this.worker.onerror = (e) => {
        e.preventDefault();
        const err = e.message || "The tracer stopped unexpectedly.";
        for (const [id, done] of this.waiting) done({ id, ok: false, error: err });
        this.waiting.clear();
        this.worker?.terminate();
        this.worker = null;
      };
    }
    return this.worker;
  }

  get busy() {
    return this.waiting.size > 0;
  }

  /** Stops a running trace (its promise resolves with null). */
  cancel() {
    if (!this.waiting.size) return;
    for (const done of this.waiting.values()) done(null);
    this.waiting.clear();
    this.worker?.terminate();
    this.worker = null;
  }

  /** Resolves with the result, or null when a newer trace was started (or it was cancelled) meanwhile. */
  async trace(src: TraceSource, settings: TraceSettings): Promise<TraceResult | null> {
    this.cancel();
    const id = ++this.seq;
    const img = ctx2d(src.canvas).getImageData(0, 0, src.canvas.width, src.canvas.height);
    const req: TraceRequest = { id, rgba: img.data.buffer, width: img.width, height: img.height, settings, unit: src.unit };
    const res = await new Promise<TraceResponse | null>((resolve) => {
      this.waiting.set(id, resolve);
      this.w.postMessage(req, [img.data.buffer]);
    });
    if (!res || id !== this.seq) return null;
    if (!res.ok) throw new Error(res.error);
    return { markup: res.markup, stats: res.stats, ms: res.ms, x: src.x, y: src.y, unit: src.unit, layerIds: src.layerIds, scope: src.scope };
  }

  dispose() {
    this.cancel();
    this.worker?.terminate();
    this.worker = null;
  }
}
