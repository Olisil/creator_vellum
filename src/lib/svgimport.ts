import { uid } from "./types";

/**
 * SVG code pasted or dropped in: made safe to show inline (no scripts, event handlers, external
 * links or page-wide styles), ids made unique so several pastes don't clash, and measured so it
 * can become a vector layer.
 */
export interface ImportedSvg {
  /** inner markup in its own units, already shifted so the viewBox starts at 0,0 */
  markup: string;
  /** size in its own units */
  w: number;
  h: number;
  /** its own units per displayed pixel (width attribute ÷ viewBox width) */
  scale: number;
  paths: number;
}

const BLOCKED = new Set(["script", "foreignobject", "iframe", "object", "embed", "audio", "video", "style", "animate", "set", "animatemotion", "animatetransform"]);

function num(v: string | null): number | null {
  if (!v) return null;
  const n = parseFloat(v);
  return Number.isFinite(n) && n > 0 && !/%$/.test(v.trim()) ? n : null;
}

export function looksLikeSvg(text: string) {
  return /<svg[\s>]/i.test(text.slice(0, 4000));
}

export function importSvg(text: string): ImportedSvg | null {
  const start = text.search(/<svg[\s>]/i);
  if (start < 0) return null;
  const doc = new DOMParser().parseFromString(text.slice(start), "image/svg+xml");
  if (doc.querySelector("parsererror")) return null;
  const root = doc.documentElement;
  if (root.nodeName.toLowerCase() !== "svg") return null;

  // remove anything that runs code, loads things, or styles the whole page
  for (const el of [...root.querySelectorAll("*")]) {
    if (BLOCKED.has(el.nodeName.toLowerCase())) {
      el.remove();
      continue;
    }
    for (const a of [...el.attributes]) {
      const n = a.name.toLowerCase();
      const v = a.value.trim().toLowerCase();
      if (n.startsWith("on")) el.removeAttribute(a.name);
      else if ((n === "href" || n === "xlink:href") && !(v.startsWith("#") || v.startsWith("data:image/"))) el.removeAttribute(a.name);
      else if (n === "style" && /url\(\s*['"]?(?!#)/.test(v)) el.removeAttribute(a.name);
    }
  }

  // unique ids, and references to them
  const prefix = `s${uid().slice(0, 6)}-`;
  const ids = new Map<string, string>();
  for (const el of root.querySelectorAll("[id]")) {
    const id = el.getAttribute("id")!;
    ids.set(id, prefix + id);
    el.setAttribute("id", prefix + id);
  }
  if (ids.size) {
    const fix = (v: string) => v.replace(/url\(\s*(['"]?)#([^)'"]+)\1\s*\)/g, (m, q, id) => (ids.has(id) ? `url(${q}#${ids.get(id)}${q})` : m));
    for (const el of root.querySelectorAll("*")) {
      for (const a of [...el.attributes]) {
        if ((a.name === "href" || a.name === "xlink:href") && a.value.startsWith("#") && ids.has(a.value.slice(1))) a.value = "#" + ids.get(a.value.slice(1));
        else if (a.value.includes("url(")) a.value = fix(a.value);
      }
    }
  }

  let [vx, vy, vw, vh] = (root.getAttribute("viewBox") ?? "").split(/[\s,]+/).map(Number);
  const aw = num(root.getAttribute("width"));
  const ah = num(root.getAttribute("height"));
  if (!(vw > 0 && vh > 0)) {
    vx = 0;
    vy = 0;
    vw = aw ?? 300;
    vh = ah ?? 150;
  }
  const scale = aw ? aw / vw : ah ? ah / vh : 1;
  const inner = [...root.childNodes].map((n) => new XMLSerializer().serializeToString(n)).join("");
  // fill/stroke set on the root element would be lost with it; carry them over on a group
  const carry = ["fill", "stroke", "stroke-width", "fill-rule", "opacity", "color"]
    .map((n) => (root.getAttribute(n) ? ` ${n}="${root.getAttribute(n)!.replace(/"/g, "&quot;")}"` : ""))
    .join("");
  const shift = vx || vy ? ` transform="translate(${-vx} ${-vy})"` : "";
  const markup = shift || carry ? `<g${shift}${carry}>${inner}</g>` : inner;
  return { markup, w: vw, h: vh, scale, paths: root.querySelectorAll("path, rect, circle, ellipse, polygon, polyline, line").length };
}
