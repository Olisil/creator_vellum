/// <reference lib="webworker" />
/**
 * Tracing runs here, off the main thread: preparation (blur, black & white), the engine
 * (VTracer as WebAssembly, or ImageTracer in JavaScript), then clean-up.
 */
import ImageTracer from "imagetracerjs";
import { init, vectorize_rgba } from "../vendor/vtracer/vtracer.js";
import wasmUrl from "../vendor/vtracer/vtracer_bg.wasm?url";
import type { TraceSettings } from "./types";
import { cleanUp, parseEngineSvg, shapesToMarkup, shapeStats, type TraceStats } from "./vector";

export interface TraceRequest {
  id: number;
  rgba: ArrayBuffer;
  width: number;
  height: number;
  settings: TraceSettings;
  /** canvas pixels per traced pixel */
  unit: number;
}
export type TraceResponse =
  | { id: number; ok: true; markup: string; stats: TraceStats; ms: number }
  | { id: number; ok: false; error: string };

let ready: Promise<void> | null = null;
const vtracer = () => (ready ??= fetch(wasmUrl).then((r) => r.arrayBuffer()).then((b) => init(b)));

function hexRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace("#", "").slice(0, 6), 16) || 0;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Box blur, three passes ≈ gaussian; colours premultiplied so transparent edges don't darken. */
function blur(d: Uint8ClampedArray, w: number, h: number, r: number) {
  if (r <= 0) return;
  const f = new Float32Array(d.length);
  for (let i = 0; i < d.length; i += 4) {
    const a = d[i + 3] / 255;
    f[i] = d[i] * a;
    f[i + 1] = d[i + 1] * a;
    f[i + 2] = d[i + 2] * a;
    f[i + 3] = d[i + 3];
  }
  const tmp = new Float32Array(d.length);
  const pass = (src: Float32Array, dst: Float32Array, horizontal: boolean) => {
    const len = horizontal ? w : h;
    const lines = horizontal ? h : w;
    const span = 2 * r + 1;
    for (let line = 0; line < lines; line++) {
      for (let c = 0; c < 4; c++) {
        let acc = 0;
        const at = (k: number) => {
          const kk = Math.min(len - 1, Math.max(0, k));
          return horizontal ? (line * w + kk) * 4 + c : (kk * w + line) * 4 + c;
        };
        for (let k = -r; k <= r; k++) acc += src[at(k)];
        for (let k = 0; k < len; k++) {
          dst[at(k)] = acc / span;
          acc += src[at(k + r + 1)] - src[at(k - r)];
        }
      }
    }
  };
  for (let n = 0; n < 3; n++) {
    pass(f, tmp, true);
    pass(tmp, f, false);
  }
  for (let i = 0; i < d.length; i += 4) {
    const a = f[i + 3];
    const k = a > 0 ? 255 / a : 0;
    d[i] = f[i] * k;
    d[i + 1] = f[i + 1] * k;
    d[i + 2] = f[i + 2] * k;
    d[i + 3] = a;
  }
}

/** Paper behind the drawing: transparent pixels become white (black & white tracing needs it). */
function flatten(d: Uint8ClampedArray) {
  for (let i = 0; i < d.length; i += 4) {
    const a = d[i + 3] / 255;
    d[i] = d[i] * a + 255 * (1 - a);
    d[i + 1] = d[i + 1] * a + 255 * (1 - a);
    d[i + 2] = d[i + 2] * a + 255 * (1 - a);
    d[i + 3] = 255;
  }
}

function invert(d: Uint8ClampedArray) {
  for (let i = 0; i < d.length; i += 4) {
    d[i] = 255 - d[i];
    d[i + 1] = 255 - d[i + 1];
    d[i + 2] = 255 - d[i + 2];
  }
}

/** Black & white for ImageTracer: black ink where darker than the threshold, white paper elsewhere. */
function binarize(d: Uint8ClampedArray, threshold: number) {
  for (let i = 0; i < d.length; i += 4) {
    const lum = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    d[i] = d[i + 1] = d[i + 2] = lum < threshold ? 0 : 255;
    d[i + 3] = 255;
  }
}

/**
 * Reduces the picture to at most `n` flat colours, picked from a 15-bit colour histogram and
 * refined with a few k-means rounds. Every pixel then
 * snaps to its nearest colour and alpha becomes on/off, so the tracer sees clean areas without
 * anti-aliased fringes.
 */
function quantize(d: Uint8ClampedArray, n: number): number[][] {
  const N = 1 << 15;
  const count = new Uint32Array(N);
  const sr = new Float64Array(N);
  const sg = new Float64Array(N);
  const sb = new Float64Array(N);
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] < 128) continue;
    const k = ((d[i] >> 3) << 10) | ((d[i + 1] >> 3) << 5) | (d[i + 2] >> 3);
    count[k]++;
    sr[k] += d[i];
    sg[k] += d[i + 1];
    sb[k] += d[i + 2];
  }
  const bins: number[] = [];
  for (let k = 0; k < N; k++) if (count[k]) bins.push(k);
  if (!bins.length) return [];
  bins.sort((a, b) => count[b] - count[a]);
  const mean = (k: number): [number, number, number] => [sr[k] / count[k], sg[k] / count[k], sb[k] / count[k]];
  const dist = (a: number[], b: number[]) => {
    const r = (a[0] + b[0]) / 2;
    const dr = a[0] - b[0];
    const dg = a[1] - b[1];
    const db = a[2] - b[2];
    return (2 + r / 256) * dr * dr + 4 * dg * dg + (2 + (255 - r) / 256) * db * db;
  };
  // starting colours: the most common one, then each time the colour that is both common and far
  // from the ones already picked (count × distance), so a small area in its own colour beats the
  // in-between shades along edges
  const means = new Map<number, [number, number, number]>();
  for (const k of bins) means.set(k, mean(k));
  let pal: number[][] = [means.get(bins[0])!];
  const gap = new Float64Array(N).fill(Infinity);
  while (pal.length < n) {
    const last = pal[pal.length - 1];
    let best = -1;
    let score = 0;
    for (const k of bins) {
      const dd = Math.min(gap[k], dist(last, means.get(k)!));
      gap[k] = dd;
      const sc = count[k] * dd;
      if (sc > score) {
        score = sc;
        best = k;
      }
    }
    if (best < 0) break;
    pal.push(means.get(best)!);
  }
  const assign = new Uint16Array(N);
  const nearest = (c: number[]) => {
    let best = 0;
    let bd = Infinity;
    for (let j = 0; j < pal.length; j++) {
      const dd = dist(pal[j], c);
      if (dd < bd) {
        bd = dd;
        best = j;
      }
    }
    return best;
  };
  for (let round = 0; round < 3; round++) {
    const acc = pal.map(() => [0, 0, 0, 0]);
    for (const k of bins) {
      const j = nearest(means.get(k)!);
      assign[k] = j;
      const a = acc[j];
      a[0] += sr[k];
      a[1] += sg[k];
      a[2] += sb[k];
      a[3] += count[k];
    }
    pal = pal.map((p, j) => (acc[j][3] ? [acc[j][0] / acc[j][3], acc[j][1] / acc[j][3], acc[j][2] / acc[j][3]] : p));
  }
  for (const k of bins) assign[k] = nearest(means.get(k)!);
  const rounded = pal.map((p) => p.map((v) => Math.round(v)));
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] < 128) {
      d[i] = d[i + 1] = d[i + 2] = d[i + 3] = 0;
      continue;
    }
    const c = rounded[assign[((d[i] >> 3) << 10) | ((d[i + 1] >> 3) << 5) | (d[i + 2] >> 3)]];
    d[i] = c[0];
    d[i + 1] = c[1];
    d[i + 2] = c[2];
    d[i + 3] = 255;
  }
  return rounded;
}

/** The tracer may average colours where it merges small areas; put them back on the palette. */
function snapFill(hex: string, pal: number[][]): string {
  const [r, g, b] = hexRgb(hex);
  let best = pal[0];
  let bd = Infinity;
  for (const p of pal) {
    const dd = (p[0] - r) ** 2 + (p[1] - g) ** 2 + (p[2] - b) ** 2;
    if (dd < bd) {
      bd = dd;
      best = p;
    }
  }
  return "#" + best.map((v) => v.toString(16).padStart(2, "0")).join("").toUpperCase();
}

function hasPixels(d: Uint8ClampedArray) {
  for (let i = 3; i < d.length; i += 4) if (d[i] > 0) return true;
  return false;
}

async function trace(req: TraceRequest): Promise<{ markup: string; stats: TraceStats }> {
  const s = req.settings;
  const { width: w, height: h } = req;
  const d = new Uint8ClampedArray(req.rgba);
  if (!hasPixels(d)) return { markup: "", stats: { paths: 0, points: 0, colors: 0 } };
  const bw = s.colorMode === "bw";
  blur(d, w, h, Math.round(s.blur));
  if (bw) {
    flatten(d);
    if (s.invert) invert(d);
  }
  const reduce = !bw && s.colorMode === "color" && s.maxColors > 0;
  const pal = reduce ? quantize(d, Math.round(s.maxColors)) : [];
  let svg: string;
  if (s.engine === "vtracer") {
    await vtracer();
    const opts: Record<string, unknown> = {
      clustering: bw ? "bw" : s.colorMode === "regions" ? "watershed" : "color-cluster",
      hierarchical: s.hierarchical,
      mode: s.curve,
      filterSpeckle: Math.round(s.filterSpeckle),
      colorPrecision: Math.round(s.colorPrecision),
      layerDifference: Math.round(s.layerDifference),
      cornerThreshold: Math.round(s.cornerThreshold),
      lengthThreshold: s.lengthThreshold,
      maxIterations: Math.round(s.maxIterations),
      spliceThreshold: Math.round(s.spliceThreshold),
      pathPrecision: Math.round(s.pathPrecision),
    };
    if (s.simplify > 0) opts.simplify = s.simplify;
    // colours were already reduced above; nothing should merge them again
    if (reduce) {
      opts.colorPrecision = 8;
      opts.layerDifference = 1;
    }
    if (bw) {
      opts.binaryThreshold = Math.round(s.threshold);
      opts.adaptive = s.adaptive;
    }
    if (s.colorMode === "regions") opts.watershedDetail = Math.round(s.regionDetail);
    svg = vectorize_rgba(new Uint8Array(d.buffer, d.byteOffset, d.byteLength), w, h, opts);
  } else {
    if (bw) binarize(d, s.threshold);
    svg = ImageTracer.imagedataToSVG(
      { width: w, height: h, data: d },
      {
        ltres: s.itLineTolerance,
        qtres: s.itCurveTolerance,
        pathomit: Math.round(s.itPathOmit),
        rightangleenhance: s.itRightAngles,
        colorsampling: bw ? 0 : s.itColorSampling,
        // one more than the colours kept: transparent areas need a slot of their own
        numberofcolors: bw ? 2 : reduce ? Math.round(s.maxColors) + 1 : 16,
        mincolorratio: s.itMinColorRatio,
        colorquantcycles: bw ? 1 : Math.round(s.itCycles),
        ...(bw
          ? {
              pal: [
                { r: 0, g: 0, b: 0, a: 255 },
                { r: 255, g: 255, b: 255, a: 255 },
              ],
            }
          : {}),
        blurradius: 0,
        blurdelta: 20,
        strokewidth: s.itStroke,
        linefilter: false,
        roundcoords: Math.round(s.pathPrecision),
        layering: 0,
        scale: 1,
        viewbox: false,
        desc: false,
      },
    );
  }
  let shapes = parseEngineSvg(svg);
  if (bw) {
    // VTracer draws the ink black; ImageTracer keeps colours. Both get the ink colour here.
    const [r, g, b] = hexRgb(s.inkColor);
    const ink = "#" + [r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("").toUpperCase();
    shapes = shapes.filter((sh) => sh.fill !== "#FFFFFF").map((sh) => ({ ...sh, fill: ink, stroke: sh.stroke ? ink : undefined }));
  }
  if (pal.length) shapes = shapes.map((sh) => ({ ...sh, fill: snapFill(sh.fill, pal), stroke: sh.stroke ? snapFill(sh.stroke, pal) : undefined }));
  shapes = cleanUp(shapes, s, req.unit, s.engine === "vtracer" && s.hierarchical === "stacked");
  return { markup: shapesToMarkup(shapes), stats: shapeStats(shapes) };
}

self.onmessage = async (e: MessageEvent<TraceRequest>) => {
  const t0 = performance.now();
  try {
    const out = await trace(e.data);
    (self as unknown as Worker).postMessage({ id: e.data.id, ok: true, ...out, ms: performance.now() - t0 } satisfies TraceResponse);
  } catch (err) {
    (self as unknown as Worker).postMessage({ id: e.data.id, ok: false, error: err instanceof Error ? err.message : String(err) } satisfies TraceResponse);
  }
};
