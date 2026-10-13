import { useEffect, useMemo, useState } from "react";
import { deleteProject, duplicateProject, getProject, listProjects, saveProject, type StoredProject } from "../lib/db";
import { createDemo } from "../lib/demo";
import { downloadBlob, slug } from "../lib/exporter";
import { importProjectFile } from "../lib/files";
import { canvasToBlob, ctx2d, loadImageFile, makeCanvas } from "../lib/raster";
import { CANVAS_SIZES, newProject } from "../lib/types";
import { navigate } from "../router";
import { ThemeToggle } from "../theme";
import { HeaderNav } from "./HeaderNav";
import { Logo } from "./Logo";

function ago(ts: number) {
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} minute${m === 1 ? "" : "s"} ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} hour${h === 1 ? "" : "s"} ago`;
  const d = Math.round(h / 24);
  if (d < 30) return `${d} day${d === 1 ? "" : "s"} ago`;
  return new Date(ts).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

function Thumb({ p }: { p: StoredProject }) {
  const url = useMemo(() => (p.thumb ? URL.createObjectURL(p.thumb) : null), [p.thumb]);
  useEffect(() => () => void (url && URL.revokeObjectURL(url)), [url]);
  if (!url) return <div className="thumb thumb-empty">Empty canvas</div>;
  return (
    <div className="thumb thumb-canvas">
      <img src={url} alt="" />
    </div>
  );
}

/** The project file for a stored project, without opening it. */
async function downloadStored(id: string) {
  const got = await getProject(id);
  if (!got) return;
  const bitmaps: Record<string, string> = {};
  for (const [lid, blob] of got.bitmaps)
    bitmaps[lid] = await new Promise<string>((res) => {
      const r = new FileReader();
      r.onload = () => res(String(r.result));
      r.readAsDataURL(blob);
    });
  const body = JSON.stringify({ format: "creator-vellum", version: 1, project: got.project, bitmaps });
  downloadBlob(new Blob([body], { type: "application/json" }), `${slug(got.project.name)}.vellum.json`);
}

export function Home() {
  const [projects, setProjects] = useState<StoredProject[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [size, setSize] = useState("1600x1200");

  const refresh = () =>
    listProjects()
      .then(setProjects)
      .catch(() => {
        setProjects([]);
        setError("This browser won't let the app save projects. Private windows often block it; try a normal window.");
      });
  useEffect(() => {
    refresh();
  }, []);

  const create = async () => {
    const [w, h] = size.split("x").map(Number);
    const p = newProject("Untitled sketch", w, h);
    await saveProject(p, new Map());
    navigate(`/p/${p.id}`);
  };
  const example = async () => {
    const p = await createDemo();
    navigate(`/p/${p.id}`);
  };
  /** A new project the size of an image, with the image on its first layer. */
  const fromImage = async (file: File) => {
    const img = await loadImageFile(file);
    const k = Math.min(1, 4096 / img.width, 4096 / img.height);
    const w = Math.max(1, Math.round(img.width * k));
    const h = Math.max(1, Math.round(img.height * k));
    const name = file.name.replace(/\.[a-z0-9]+$/i, "") || "Image";
    const p = newProject(name, w, h);
    p.layers[0] = { ...p.layers[0], name: "Image" };
    const c = makeCanvas(w, h);
    const ctx = ctx2d(c);
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(img, 0, 0, w, h);
    const t = makeCanvas(Math.round(w * Math.min(1, 480 / w, 360 / h)), Math.round(h * Math.min(1, 480 / w, 360 / h)));
    const tc = ctx2d(t);
    tc.fillStyle = "#FFFFFF";
    tc.fillRect(0, 0, t.width, t.height);
    tc.drawImage(c, 0, 0, t.width, t.height);
    await saveProject(p, new Map([[p.layers[0].id, await canvasToBlob(c)]]), await canvasToBlob(t));
    navigate(`/p/${p.id}`);
  };
  const open = async (f: File) => {
    try {
      if (/\.json$/i.test(f.name) || f.type === "application/json") {
        const p = await importProjectFile(f);
        navigate(`/p/${p.id}`);
      } else if (f.type.startsWith("image/") && f.type !== "image/svg+xml") await fromImage(f);
      else setError("Open an image (PNG, JPG, WebP…) or a .vellum.json project file.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "That file couldn't be opened.");
    }
  };

  useEffect(() => {
    const over = (e: DragEvent) => {
      if (!e.dataTransfer?.types.includes("Files")) return;
      e.preventDefault();
      setDragOver(true);
    };
    const leave = (e: DragEvent) => e.relatedTarget === null && setDragOver(false);
    const drop = (e: DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      const f = e.dataTransfer?.files?.[0];
      if (f) open(f);
    };
    window.addEventListener("dragover", over);
    window.addEventListener("dragleave", leave);
    window.addEventListener("drop", drop);
    return () => {
      window.removeEventListener("dragover", over);
      window.removeEventListener("dragleave", leave);
      window.removeEventListener("drop", drop);
    };
  }, []);

  return (
    <div className="home">
      <header className="topbar app-header home-header">
        <div className="app-header-start">
          <a className="app-logo" href="#/" aria-label="Creator Vellum">
            <Logo />
          </a>
          <nav className="breadcrumb" aria-label="Breadcrumb">
            <span className="crumb-current">Projects</span>
          </nav>
        </div>
        <div className="topbar-end">
          <HeaderNav />
          <ThemeToggle />
        </div>
      </header>

      <main className="home-main">
        <section className="home-hero">
          <h1>Sketch, then vectorize</h1>
          <p className="lead">Draw in pixels on layers, or bring in a scan or a picture, and turn it into clean vectors with fine control. Copy straight into Figma, or download SVG, PDF and PNG.</p>
          <div className="button-group">
            <button type="button" className="btn btn-primary" onClick={create}>
              Create project
            </button>
            <select className="home-size" aria-label="Canvas size" value={size} onChange={(e) => setSize(e.target.value)}>
              {CANVAS_SIZES.map((c) => (
                <option key={`${c.w}x${c.h}`} value={`${c.w}x${c.h}`}>
                  {c.label}
                </option>
              ))}
            </select>
          </div>
          <div className="button-group">
            <label className="btn btn-secondary">
              Open an image
              <input
                type="file"
                accept="image/*"
                hidden
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  e.target.value = "";
                  if (f) open(f);
                }}
              />
            </label>
            <label className="btn btn-secondary">
              Open a project file
              <input
                type="file"
                accept=".json,application/json"
                hidden
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  e.target.value = "";
                  if (f) open(f);
                }}
              />
            </label>
          </div>
          <p className="hint">Free, no account. Projects are saved in this browser; download a project file to move one to another computer.</p>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
        </section>

        <section className="home-projects" aria-labelledby="projects-title">
          <div className="home-projects-head">
            <h2 id="projects-title">Your projects</h2>
            {projects && projects.length > 0 && (
              <span className="pill">
                {projects.length} {projects.length === 1 ? "project" : "projects"}
              </span>
            )}
          </div>
          {projects === null ? null : projects.length === 0 ? (
            <div className="empty">
              <p>No projects yet. Create one, open an image, or start from the example sketch.</p>
              <button type="button" className="btn" onClick={example}>
                Open the example
              </button>
            </div>
          ) : (
            <ul className="cards">
              {projects.map((p) => (
                <li key={p.id} className="card">
                  <a className="card-open" href={`#/p/${p.id}`}>
                    <Thumb p={p} />
                    <span className="card-name">{p.name || "Untitled sketch"}</span>
                  </a>
                  <div className="card-meta">
                    <span className="pill">
                      {p.width} × {p.height}
                    </span>
                    <span className="pill">
                      {p.layers.length} {p.layers.length === 1 ? "layer" : "layers"}
                    </span>
                    <span className="card-time">Edited {ago(p.updatedAt)}</span>
                  </div>
                  <div className="card-actions">
                    <button
                      type="button"
                      className="btn btn-small"
                      onClick={async () => {
                        await duplicateProject(p.id);
                        refresh();
                      }}
                    >
                      Duplicate
                    </button>
                    <button type="button" className="btn btn-small" onClick={() => downloadStored(p.id)}>
                      Download file
                    </button>
                    <button
                      type="button"
                      className="btn btn-small btn-quiet btn-danger"
                      onClick={async () => {
                        if (!confirm(`Delete ${p.name}? It's removed from this browser. Download the project file first if you want to keep it.`)) return;
                        await deleteProject(p.id);
                        refresh();
                      }}
                    >
                      Delete
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>

      <footer className="home-foot">
        <span>Tracing by VTracer and ImageTracer, open source</span>
        <a href="/">nassau.se</a>
      </footer>
      {dragOver && <div className="drop-veil">Drop an image or a project file</div>}
    </div>
  );
}
