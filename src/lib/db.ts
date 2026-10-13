import { coerceProject, uid, type Project } from "./types";

/**
 * Projects live in this browser (IndexedDB): the project record (layers as metadata, a small
 * thumbnail) in "projects", and each pixel layer as a PNG in "bitmaps" under "<project>/<layer>",
 * so a stroke only rewrites the layer it changed.
 */
const DB = "creator-vellum";
const PROJECTS = "projects";
const BITMAPS = "bitmaps";

export interface StoredProject extends Project {
  thumb?: Blob;
}

let dbp: Promise<IDBDatabase> | null = null;
function open(): Promise<IDBDatabase> {
  dbp ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(PROJECTS)) db.createObjectStore(PROJECTS, { keyPath: "id" });
      if (!db.objectStoreNames.contains(BITMAPS)) db.createObjectStore(BITMAPS);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => {
      dbp = null;
      reject(req.error);
    };
  });
  return dbp;
}

function done(t: IDBTransaction) {
  return new Promise<void>((resolve, reject) => {
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

function result<T>(req: IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

const range = (pid: string) => IDBKeyRange.bound(`${pid}/`, `${pid}/￿`);

export async function listProjects(): Promise<StoredProject[]> {
  const db = await open();
  const all = await result(db.transaction(PROJECTS).objectStore(PROJECTS).getAll() as IDBRequest<StoredProject[]>);
  return all.map((p) => ({ ...coerceProject(p), thumb: p.thumb })).sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function getProject(id: string): Promise<{ project: Project; bitmaps: Map<string, Blob> } | null> {
  const db = await open();
  const t = db.transaction([PROJECTS, BITMAPS]);
  const p = await result(t.objectStore(PROJECTS).get(id) as IDBRequest<StoredProject | undefined>);
  if (!p) return null;
  const bitmaps = new Map<string, Blob>();
  const store = t.objectStore(BITMAPS);
  const [keys, values] = await Promise.all([result(store.getAllKeys(range(id))), result(store.getAll(range(id)) as IDBRequest<Blob[]>)]);
  keys.forEach((k, i) => bitmaps.set(String(k).slice(id.length + 1), values[i]));
  const { thumb: _thumb, ...rest } = p;
  return { project: coerceProject(rest), bitmaps };
}

/** Saves the project record, the given layer bitmaps, and drops bitmaps of layers that are gone. */
export async function saveProject(p: Project, bitmaps: Map<string, Blob>, thumb?: Blob) {
  const db = await open();
  const t = db.transaction([PROJECTS, BITMAPS], "readwrite");
  const record: StoredProject = { ...p, thumb };
  if (!thumb) {
    const old = await result(t.objectStore(PROJECTS).get(p.id) as IDBRequest<StoredProject | undefined>);
    if (old?.thumb) record.thumb = old.thumb;
  }
  t.objectStore(PROJECTS).put(record);
  const store = t.objectStore(BITMAPS);
  for (const [lid, blob] of bitmaps) store.put(blob, `${p.id}/${lid}`);
  const keep = new Set(p.layers.map((l) => `${p.id}/${l.id}`));
  const keys = await result(store.getAllKeys(range(p.id)));
  for (const k of keys) if (!keep.has(String(k))) store.delete(k);
  await done(t);
}

export async function deleteProject(id: string) {
  const db = await open();
  const t = db.transaction([PROJECTS, BITMAPS], "readwrite");
  t.objectStore(PROJECTS).delete(id);
  t.objectStore(BITMAPS).delete(range(id));
  await done(t);
}

export async function duplicateProject(id: string): Promise<Project | null> {
  const got = await getProject(id);
  if (!got) return null;
  const now = Date.now();
  const idMap = new Map<string, string>();
  const copy: Project = structuredClone(got.project);
  copy.id = uid();
  copy.name = `${got.project.name} (copy)`;
  copy.createdAt = now;
  copy.updatedAt = now;
  copy.layers = copy.layers.map((l) => {
    const nid = uid();
    idMap.set(l.id, nid);
    return { ...l, id: nid };
  });
  copy.activeId = idMap.get(copy.activeId) ?? copy.layers[0].id;
  const bitmaps = new Map<string, Blob>();
  for (const [lid, b] of got.bitmaps) if (idMap.has(lid)) bitmaps.set(idMap.get(lid)!, b);
  const db = await open();
  const old = await result(db.transaction(PROJECTS).objectStore(PROJECTS).get(id) as IDBRequest<StoredProject | undefined>);
  await saveProject(copy, bitmaps, old?.thumb);
  return copy;
}
