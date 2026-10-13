import { pathInfo } from "./svgpath";
import type { TraceSettings, VectorLayer } from "./types";

/** One filled shape from a trace, in traced pixel units. */
export interface Shape {
  d: string;
  fill: string;
  stroke?: string;
  strokeWidth?: number;
  tx: number;
  ty: number;
}

export interface TraceStats {
  paths: number;
  points: number;
  colors: number;
}

const attr = (tag: string, name: string) => new RegExp(`\\s${name}="([^"]*)"`).exec(tag)?.[1];

function toHex(c: string | undefined): string | undefined {
  if (!c || c === "none") return undefined;
  if (c.startsWith("#")) {
    const h = c.slice(1);
    return ("#" + (h.length === 3 ? h.replace(/./g, "$&$&") : h)).toUpperCase();
  }
  const m = /rgba?\(([^)]+)\)/.exec(c);
  if (!m) return c;
  const [r, g, b] = m[1].split(",").map((v) => parseFloat(v));
  return "#" + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, "0")).join("").toUpperCase();
}

/** Reads the `<path>` elements a tracer produced (VTracer or ImageTracer). */
export function parseEngineSvg(svg: string): Shape[] {
  const out: Shape[] = [];
  for (const m of svg.matchAll(/<path\b[^>]*>/g)) {
    const tag = m[0];
    const d = attr(tag, "d");
    if (!d) continue;
    const opacity = attr(tag, "opacity");
    if (opacity !== undefined && parseFloat(opacity) === 0) continue;
    const fill = toHex(attr(tag, "fill"));
    if (!fill) continue;
    const stroke = toHex(attr(tag, "stroke"));
    const sw = parseFloat(attr(tag, "stroke-width") ?? "0");
    const tr = /translate\(\s*([-\d.]+)[ ,]+([-\d.]+)\s*\)/.exec(attr(tag, "transform") ?? "");
    out.push({ d, fill, stroke: stroke && sw > 0 ? stroke : undefined, strokeWidth: stroke && sw > 0 ? sw : undefined, tx: tr ? parseFloat(tr[1]) : 0, ty: tr ? parseFloat(tr[2]) : 0 });
  }
  return out;
}

function rgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1, 7), 16) || 0;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function near(a: string, b: string, tol: number) {
  const [r1, g1, b1] = rgb(a);
  const [r2, g2, b2] = rgb(b);
  return Math.abs(r1 - r2) <= tol && Math.abs(g1 - g2) <= tol && Math.abs(b1 - b2) <= tol;
}

/**
 * Clean-up after tracing: drop a colour (e.g. the paper), drop small shapes, merge shapes of the
 * same colour into one path. `unit` is canvas pixels per traced pixel.
 */
export function cleanUp(shapes: Shape[], s: TraceSettings, unit: number, stacked: boolean): Shape[] {
  let out = shapes;
  if (s.dropColor) out = out.filter((sh) => !near(sh.fill, s.dropColor!, s.dropTolerance));
  if (s.minSize > 0) {
    out = out.filter((sh) => {
      const b = pathInfo(sh.d);
      return Math.max(b.x1 - b.x0, b.y1 - b.y0) * unit >= s.minSize;
    });
  }
  if (s.merge) out = mergeSameColour(out, stacked);
  return out;
}

/**
 * Joins shapes that share fill, stroke and offset into one path. Stacked traces overlap, so there
 * only neighbours in drawing order are joined (the look stays the same); otherwise all of a colour.
 */
function mergeSameColour(shapes: Shape[], onlyNeighbours: boolean): Shape[] {
  const key = (s: Shape) => `${s.fill}|${s.stroke ?? ""}|${s.strokeWidth ?? 0}|${s.tx}|${s.ty}`;
  if (onlyNeighbours) {
    const out: Shape[] = [];
    for (const s of shapes) {
      const last = out[out.length - 1];
      if (last && key(last) === key(s)) out[out.length - 1] = { ...last, d: `${last.d} ${s.d}` };
      else out.push({ ...s });
    }
    return out;
  }
  const groups = new Map<string, Shape>();
  for (const s of shapes) {
    const k = key(s);
    const g = groups.get(k);
    if (g) g.d += ` ${s.d}`;
    else groups.set(k, { ...s });
  }
  return [...groups.values()];
}

export function shapeStats(shapes: Shape[]): TraceStats {
  let points = 0;
  for (const s of shapes) points += pathInfo(s.d).points;
  return { paths: shapes.length, points, colors: new Set(shapes.map((s) => s.fill)).size };
}

/** Plain `<path>` elements with attributes only (no classes or styles), which Figma reads well. */
export function shapesToMarkup(shapes: Shape[]): string {
  return shapes
    .map((s) => {
      const tr = s.tx || s.ty ? ` transform="translate(${s.tx} ${s.ty})"` : "";
      const st = s.stroke ? ` stroke="${s.stroke}" stroke-width="${s.strokeWidth}" stroke-linejoin="round"` : "";
      return `<path d="${s.d}" fill="${s.fill}"${st}${tr}/>`;
    })
    .join("");
}

export function escapeXml(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

const num = (v: number) => String(Math.round(v * 1000) / 1000);

export function layerTransform(l: Pick<VectorLayer, "x" | "y" | "scale">) {
  const parts: string[] = [];
  if (l.x || l.y) parts.push(`translate(${num(l.x)} ${num(l.y)})`);
  if (l.scale !== 1) parts.push(`scale(${num(l.scale)})`);
  return parts.join(" ");
}

/** One vector layer as a group: named after the layer, so Figma shows the same layer name. */
export function layerGroup(l: VectorLayer) {
  const t = layerTransform(l);
  const op = l.opacity < 1 ? ` opacity="${num(l.opacity)}"` : "";
  return `<g id="${escapeXml(l.name)}"${t ? ` transform="${t}"` : ""}${op}>${l.svg}</g>`;
}

/** A complete SVG document for one vector layer (used to draw it into a canvas). */
export function vectorLayerSvg(l: VectorLayer, w: number, h: number) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${layerGroup({ ...l, opacity: 1 })}</svg>`;
}
