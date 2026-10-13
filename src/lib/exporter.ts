import type { Doc } from "./doc";
import { canvasToBlob } from "./raster";
import { escapeXml, layerGroup } from "./vector";

export type ExportScope = "vectors" | "active" | "all";

export function slug(name: string) {
  return (
    name
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "sketch"
  );
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/**
 * SVG of the document. "vectors": the visible vector layers; "active": the active layer only;
 * "all": every visible layer, pixel layers as embedded PNG images. Each layer is a group named
 * after it, in the same order as the layer list.
 */
export function buildSvg(doc: Doc, scope: ExportScope, background = false): string {
  const { width: w, height: h } = doc;
  const parts: string[] = [];
  if (background && doc.background) parts.push(`<rect id="Background" width="${w}" height="${h}" fill="${doc.background}"/>`);
  for (const l of doc.layers) {
    if (scope === "active" ? l.id !== doc.activeId : !l.visible) continue;
    if (l.kind === "vector") parts.push(layerGroup(l));
    else if (scope !== "vectors") {
      const url = doc.canvas(l.id)!.toDataURL("image/png");
      const op = l.opacity < 1 ? ` opacity="${l.opacity}"` : "";
      parts.push(`<image id="${escapeXml(l.name)}" width="${w}" height="${h}" href="${url}"${op}/>`);
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${parts.join("")}</svg>`;
}

export function hasVectors(doc: Doc, scope: ExportScope) {
  return doc.layers.some((l) => l.kind === "vector" && (scope === "active" ? l.id === doc.activeId : l.visible));
}

/**
 * Puts the SVG on the clipboard. Figma (and recent Illustrator) turn pasted SVG code into
 * editable vector layers. Plain text is what they read; an SVG image type is added where the
 * browser allows it.
 */
export async function copySvg(svg: string): Promise<void> {
  const text = new Blob([svg], { type: "text/plain" });
  try {
    const items: Record<string, Blob> = { "text/plain": text };
    if (typeof ClipboardItem !== "undefined" && ClipboardItem.supports?.("image/svg+xml")) items["image/svg+xml"] = new Blob([svg], { type: "image/svg+xml" });
    await navigator.clipboard.write([new ClipboardItem(items)]);
  } catch {
    await navigator.clipboard.writeText(svg);
  }
}

export async function copyPng(c: HTMLCanvasElement): Promise<void> {
  const blob = await canvasToBlob(c);
  await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
}

export async function exportPng(doc: Doc, scope: ExportScope, scale: number, background: boolean) {
  const only = scope === "active" ? [doc.activeId] : scope === "vectors" ? doc.layers.filter((l) => l.kind === "vector" && l.visible).map((l) => l.id) : undefined;
  const c = await doc.composite({ vectors: true, background, scale, only });
  downloadBlob(await canvasToBlob(c), `${slug(doc.name)}${scale !== 1 ? `@${scale}x` : ""}.png`);
}

export function exportSvg(doc: Doc, scope: ExportScope, background: boolean) {
  downloadBlob(new Blob([buildSvg(doc, scope, background)], { type: "image/svg+xml" }), `${slug(doc.name)}.svg`);
}

/** PDF with the layers as real vectors (pixel layers as images), page = canvas size. */
export async function exportPdf(doc: Doc, scope: ExportScope, background: boolean) {
  const [{ jsPDF }, { svg2pdf }] = await Promise.all([import("jspdf"), import("svg2pdf.js")]);
  const { width: w, height: h } = doc;
  const pdf = new jsPDF({ unit: "px", format: [w, h], orientation: w >= h ? "landscape" : "portrait", hotfixes: ["px_scaling"], compress: true });
  const holder = document.createElement("div");
  holder.style.cssText = "position:fixed;left:-99999px;top:0;";
  holder.innerHTML = buildSvg(doc, scope, background);
  document.body.appendChild(holder);
  try {
    await svg2pdf(holder.firstElementChild as SVGElement, pdf, { x: 0, y: 0, width: w, height: h });
    downloadBlob(pdf.output("blob"), `${slug(doc.name)}.pdf`);
  } finally {
    holder.remove();
  }
}
