import type { Doc } from "./doc";
import { saveProject } from "./db";
import { downloadBlob, slug } from "./exporter";
import { coerceProject, uid, type Project } from "./types";

/** Project files (.vellum.json): the project with each pixel layer as a PNG data URL. */
export function downloadProjectFile(doc: Doc) {
  const bitmaps: Record<string, string> = {};
  for (const l of doc.layers) if (l.kind === "raster") bitmaps[l.id] = doc.canvas(l.id)!.toDataURL("image/png");
  const body = JSON.stringify({ format: "creator-vellum", version: 1, project: doc.toProject(), bitmaps });
  downloadBlob(new Blob([body], { type: "application/json" }), `${slug(doc.name)}.vellum.json`);
}

/** Reads a project file and stores it as a new project (it never overwrites one you have). */
export async function importProjectFile(file: File): Promise<Project> {
  let parsed: { format?: string; project?: Partial<Project>; bitmaps?: Record<string, string> };
  try {
    parsed = JSON.parse(await file.text());
  } catch {
    throw new Error("That file isn't a Creator Vellum project file.");
  }
  if (parsed?.format !== "creator-vellum" || !parsed.project) throw new Error("That file isn't a Creator Vellum project file.");
  const p = coerceProject(parsed.project);
  const now = Date.now();
  p.id = uid();
  p.updatedAt = now;
  const bitmaps = new Map<string, Blob>();
  for (const [lid, url] of Object.entries(parsed.bitmaps ?? {})) {
    if (!p.layers.some((l) => l.id === lid) || !url.startsWith("data:image/")) continue;
    bitmaps.set(lid, await (await fetch(url)).blob());
  }
  await saveProject(p, bitmaps);
  return p;
}
