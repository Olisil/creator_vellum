import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { deleteProject, duplicateProject, getProject, saveProject } from "../lib/db";
import { Doc } from "../lib/doc";
import { copyPng } from "../lib/exporter";
import { downloadProjectFile, importProjectFile } from "../lib/files";
import { blobToCanvas, canvasToBlob, contentBounds, loadImageFile, makeCanvas } from "../lib/raster";
import { importSvg, looksLikeSvg } from "../lib/svgimport";
import { DEFAULT_TOOL_OPTIONS, TOOLS, type ToolId, type ToolOptions } from "../lib/tools";
import { Tracer, traceSource } from "../lib/tracer";
import { CANVAS_SIZES, type TraceSettings } from "../lib/types";
import { navigate } from "../router";
import { ThemeToggle } from "../theme";
import { Floating } from "./Floating";
import { HeaderNav } from "./HeaderNav";
import { LayersPanel } from "./LayersPanel";
import { Logo } from "./Logo";
import { ExportPanel } from "./panels/ExportPanel";
import { SketchPanel } from "./panels/SketchPanel";
import { VectorizePanel, type TraceStatus } from "./panels/VectorizePanel";
import { Stage, type Preview, type ViewMode } from "./Stage";
import { ToolPalette } from "./ToolPalette";

type Step = "sketch" | "vectorize" | "export";
const STEPS: { id: Step; label: string; next: string }[] = [
  { id: "sketch", label: "Sketch", next: "Next: vectorize" },
  { id: "vectorize", label: "Vectorize", next: "Next: export" },
  { id: "export", label: "Export", next: "" },
];

const TOOL_KEY = "creator-vellum:tools:v1";
function loadTools(): ToolOptions {
  try {
    const v = JSON.parse(localStorage.getItem(TOOL_KEY) || "null");
    if (!v) return DEFAULT_TOOL_OPTIONS;
    const o = { ...DEFAULT_TOOL_OPTIONS } as Record<string, unknown>;
    for (const k of Object.keys(DEFAULT_TOOL_OPTIONS) as (keyof ToolOptions)[]) {
      const d = DEFAULT_TOOL_OPTIONS[k];
      if (v[k] === undefined) continue;
      o[k] = typeof d === "object" && !Array.isArray(d) ? { ...d, ...v[k] } : v[k];
    }
    return o as unknown as ToolOptions;
  } catch {
    return DEFAULT_TOOL_OPTIONS;
  }
}

/** Small picture of the whole canvas for the projects page. */
async function makeThumb(doc: Doc): Promise<Blob> {
  const k = Math.min(1, 480 / doc.width, 360 / doc.height);
  const c = await doc.composite({ vectors: true, background: true, scale: k });
  return canvasToBlob(c, "image/png");
}

export function Editor({ projectId }: { projectId: string }) {
  const [doc, setDoc] = useState<Doc | null>(null);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    let live = true;
    setDoc(null);
    (async () => {
      const got = await getProject(projectId);
      if (!got) return live && setMissing(true);
      const canvases = new Map<string, HTMLCanvasElement>();
      for (const l of got.project.layers) {
        if (l.kind !== "raster") continue;
        const b = got.bitmaps.get(l.id);
        canvases.set(l.id, b ? await blobToCanvas(b, got.project.width, got.project.height) : makeCanvas(got.project.width, got.project.height));
      }
      if (live) setDoc(new Doc(got.project, canvases));
    })().catch(() => live && setMissing(true));
    return () => {
      live = false;
    };
  }, [projectId]);

  if (missing)
    return (
      <div className="empty-page">
        <h1>This project isn't in this browser</h1>
        <p>Projects are saved in the browser they were made in. Open the project file instead, or start a new one.</p>
        <a className="btn btn-primary" href="#/">
          Go to your projects
        </a>
      </div>
    );
  if (!doc) return <div className="empty-page" aria-busy="true" />;
  return <EditorLoaded key={doc.id} doc={doc} />;
}

function EditorLoaded({ doc }: { doc: Doc }) {
  const version = useSyncExternalStore(doc.subscribe, doc.getVersion);
  const [step, setStep] = useState<Step>("sketch");
  const [tool, setToolState] = useState<ToolId>("brush");
  const [options, setOptionsState] = useState<ToolOptions>(loadTools);
  const [notice, setNotice] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [stageSize, setStageSize] = useState({ w: 0, h: 0 });
  const [projectMenu, setProjectMenu] = useState<{ top: number; right: number } | null>(null);
  const [name, setName] = useState(doc.name);
  const [blank] = useState(() => startsBlank(doc));

  // vectorize
  const tracer = useMemo(() => new Tracer(), []);
  const [status, setStatus] = useState<TraceStatus>({ state: "idle" });
  const [preview, setPreview] = useState<Preview | null>(null);
  const [live, setLive] = useState(true);
  const [view, setView] = useState<ViewMode>("overlay");
  const [sourceOpacity, setSourceOpacity] = useState(0.3);

  const stageRef = useRef<HTMLElement>(null);
  const clip = useRef<{ canvas: HTMLCanvasElement; x: number; y: number } | null>(null);

  const setOptions = useCallback((fn: (o: ToolOptions) => ToolOptions) => {
    setOptionsState((prev) => {
      const next = fn(prev);
      try {
        localStorage.setItem(TOOL_KEY, JSON.stringify(next));
      } catch {
        /* tool settings are a convenience only */
      }
      return next;
    });
  }, []);
  const setTool = useCallback(
    (t: ToolId) => {
      if (t !== "move") doc.commitFloating();
      setToolState(t);
    },
    [doc],
  );
  const pickColor = useCallback((c: string) => setOptions((p) => ({ ...p, color: c })), [setOptions]);
  const swapColors = useCallback(() => setOptions((p) => ({ ...p, color: p.color2, color2: p.color })), [setOptions]);

  useEffect(() => () => tracer.dispose(), [tracer]);

  // The editor fills the window; the page itself never scrolls (except the stacked phone layout).
  useEffect(() => {
    document.documentElement.classList.add("editor-open");
    return () => document.documentElement.classList.remove("editor-open");
  }, []);

  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const fit = () => setStageSize({ w: el.clientWidth, h: el.clientHeight });
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (!notice) return;
    const id = setTimeout(() => setNotice(null), 5000);
    return () => clearTimeout(id);
  }, [notice]);

  // ---- autosave: changed layers as PNGs, the project record and a thumbnail
  useEffect(() => {
    let timer = 0;
    let saving = false;
    let again = false;
    const save = async () => {
      if (saving) {
        again = true;
        return;
      }
      if (!doc.dirty.size && !doc.metaDirty) return;
      saving = true;
      const ids = [...doc.dirty];
      doc.dirty.clear();
      doc.metaDirty = false;
      try {
        const bitmaps = new Map<string, Blob>();
        for (const id of ids) {
          const c = doc.canvas(id);
          if (c && doc.layer(id)?.kind === "raster") bitmaps.set(id, await canvasToBlob(c));
        }
        await saveProject(doc.toProject(), bitmaps, await makeThumb(doc).catch(() => undefined));
      } catch {
        ids.forEach((id) => doc.dirty.add(id));
        doc.metaDirty = true;
        setNotice("Couldn't save to this browser. Download the project file to keep your work.");
      } finally {
        saving = false;
        if (again) {
          again = false;
          schedule();
        }
      }
    };
    const schedule = () => {
      clearTimeout(timer);
      timer = window.setTimeout(save, 900);
    };
    const unsub = doc.subscribe(() => {
      if (doc.dirty.size || doc.metaDirty) schedule();
    });
    const hide = () => document.visibilityState === "hidden" && save();
    document.addEventListener("visibilitychange", hide);
    window.addEventListener("pagehide", save);
    return () => {
      unsub();
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", hide);
      window.removeEventListener("pagehide", save);
      doc.commitFloating();
      save();
    };
  }, [doc]);

  // ---- project menu
  useEffect(() => {
    if (!projectMenu) return;
    const outside = (e: PointerEvent) => {
      if (!(e.target as Element).closest(".project-menu, .project-menu-button")) setProjectMenu(null);
    };
    const key = (e: KeyboardEvent) => e.key === "Escape" && setProjectMenu(null);
    const away = () => setProjectMenu(null);
    window.addEventListener("pointerdown", outside);
    window.addEventListener("keydown", key);
    window.addEventListener("resize", away);
    window.addEventListener("scroll", away, true);
    return () => {
      window.removeEventListener("pointerdown", outside);
      window.removeEventListener("keydown", key);
      window.removeEventListener("resize", away);
      window.removeEventListener("scroll", away, true);
    };
  }, [projectMenu]);

  // ---- clipboard
  const copy = useCallback(
    (cut = false) => {
      const l = doc.active;
      if (!l || l.kind !== "raster") return setNotice("Copy works on pixel layers. Vector layers can be copied in Export.");
      let canvas: HTMLCanvasElement;
      let x: number;
      let y: number;
      if (doc.floating) {
        const f = doc.floating;
        canvas = makeCanvas(Math.max(1, Math.round(f.w)), Math.max(1, Math.round(f.h)));
        const ctx = canvas.getContext("2d")!;
        ctx.translate(f.flipX ? canvas.width : 0, f.flipY ? canvas.height : 0);
        ctx.scale(f.flipX ? -1 : 1, f.flipY ? -1 : 1);
        ctx.drawImage(f.canvas, 0, 0, canvas.width, canvas.height);
        x = f.x;
        y = f.y;
        if (cut) doc.cancelFloating();
      } else {
        const got = doc.copyPixels();
        if (!got) return;
        canvas = got.canvas;
        x = got.rect.x;
        y = got.rect.y;
        if (cut) doc.clearSelection();
      }
      clip.current = { canvas, x, y };
      copyPng(canvas).catch(() => {
        /* the app keeps its own copy; the system clipboard is a bonus */
      });
      setNotice(cut ? "Cut. Paste with Ctrl V (⌘ V)." : "Copied. Paste with Ctrl V (⌘ V).");
    },
    [doc],
  );

  const placeImage = useCallback(
    (img: HTMLCanvasElement, name: string) => {
      const c = clip.current;
      setStep("sketch");
      setToolState("move");
      // our own copy coming back through the system clipboard: same place, same size
      if (c && c.canvas.width === img.width && c.canvas.height === img.height) doc.paste(c.canvas, "Pasted pixels", { x: c.x + img.width / 2, y: c.y + img.height / 2 }, false);
      else doc.paste(img, name);
    },
    [doc],
  );

  const placeSvg = useCallback(
    (text: string, name = "Pasted vectors") => {
      const svg = importSvg(text);
      if (!svg) return setNotice("That SVG code couldn't be read.");
      doc.commitFloating();
      const shown = Math.min(svg.scale, (doc.width * 0.9) / svg.w, (doc.height * 0.9) / svg.h);
      const k = Math.min(1, shown / svg.scale) * svg.scale;
      doc.addVectorLayer(
        {
          name,
          svg: svg.markup,
          scale: k,
          x: Math.round((doc.width - svg.w * k) / 2),
          y: Math.round((doc.height - svg.h * k) / 2),
          stats: { paths: svg.paths, points: 0, colors: 0 },
        },
        "Paste vectors",
      );
      setStep("sketch");
      setToolState("move");
      setNotice("Pasted as a vector layer. Drag with the move tool to place it.");
    },
    [doc],
  );

  const addFile = useCallback(
    async (file: File) => {
      try {
        if (/\.svg$/i.test(file.name) || file.type === "image/svg+xml") placeSvg(await file.text(), file.name.replace(/\.svg$/i, ""));
        else if (/\.json$/i.test(file.name)) {
          const p = await importProjectFile(file);
          navigate(`/p/${p.id}`);
        } else if (file.type.startsWith("image/")) placeImage(await loadImageFile(file), file.name.replace(/\.[a-z0-9]+$/i, ""));
        else setNotice("Drop an image, an SVG, or a .vellum.json project file.");
      } catch (e) {
        setNotice(e instanceof Error ? e.message : "That file couldn't be opened.");
      }
    },
    [placeImage, placeSvg],
  );

  const pasteInternal = useCallback(() => {
    const c = clip.current;
    if (!c) return false;
    placeImage(c.canvas, "Pasted pixels");
    return true;
  }, [placeImage]);

  /** The Paste button: read the system clipboard where the browser allows it. */
  const pasteButton = useCallback(async () => {
    try {
      const items = await navigator.clipboard.read();
      for (const it of items) {
        const img = it.types.find((t) => t.startsWith("image/") && t !== "image/svg+xml");
        if (img) return placeImage(await loadImageFile(await it.getType(img)), "Pasted image");
        if (it.types.includes("image/svg+xml")) return placeSvg(await (await it.getType("image/svg+xml")).text());
        if (it.types.includes("text/plain")) {
          const text = await (await it.getType("text/plain")).text();
          if (looksLikeSvg(text)) return placeSvg(text);
        }
      }
      if (!pasteInternal()) setNotice("Nothing to paste. Copy an image or SVG code first.");
    } catch {
      if (!pasteInternal()) setNotice("The browser didn't allow reading the clipboard. Use Ctrl V (⌘ V) instead.");
    }
  }, [placeImage, placeSvg, pasteInternal]);

  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const t = e.target as HTMLElement;
      if (t && ["INPUT", "TEXTAREA"].includes(t.tagName)) return;
      const dt = e.clipboardData;
      if (!dt) return;
      e.preventDefault();
      const file = [...dt.files].find((f) => f.type.startsWith("image/"));
      if (file) return void addFile(file);
      const text = dt.getData("text/plain") || dt.getData("image/svg+xml");
      if (text && looksLikeSvg(text)) return placeSvg(text);
      if (!pasteInternal()) setNotice("Nothing to paste. Copy an image or SVG code first.");
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [addFile, placeSvg, pasteInternal]);

  // ---- files dropped on the page
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
      if (f) addFile(f);
    };
    window.addEventListener("dragover", over);
    window.addEventListener("dragleave", leave);
    window.addEventListener("drop", drop);
    return () => {
      window.removeEventListener("dragover", over);
      window.removeEventListener("dragleave", leave);
      window.removeEventListener("drop", drop);
    };
  }, [addFile]);

  // ---- keyboard
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      const typing = ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName) && !(el instanceof HTMLInputElement && ["range", "checkbox", "radio", "color"].includes(el.type));
      if (typing || e.defaultPrevented) return;
      const mod = e.metaKey || e.ctrlKey;
      const k = e.key.toLowerCase();
      if (mod) {
        if (k === "z" || k === "y") {
          e.preventDefault();
          if (k === "y" || e.shiftKey) doc.redo();
          else doc.undo();
        } else if (k === "a") {
          e.preventDefault();
          doc.selectAll();
        } else if (k === "d") {
          e.preventDefault();
          doc.setSelection(null);
        } else if (k === "j") {
          e.preventDefault();
          doc.duplicateLayer(doc.activeId);
        } else if (k === "n" && e.shiftKey) {
          e.preventDefault();
          doc.addRasterLayer();
        } else if ((k === "c" || k === "x") && !window.getSelection()?.toString()) {
          e.preventDefault();
          copy(k === "x");
        }
        return;
      }
      if (e.altKey) return;
      if (e.key === "Enter" && doc.floating) {
        e.preventDefault();
        doc.commitFloating();
        return;
      }
      if (e.key === "Escape") {
        if (doc.floating) doc.cancelFloating();
        else if (doc.selection) doc.setSelection(null);
        return;
      }
      if ((e.key === "Delete" || e.key === "Backspace") && doc.selection && doc.active?.kind === "raster") {
        e.preventDefault();
        doc.clearSelection();
        return;
      }
      if (step !== "sketch") return;
      if (k === "x") return swapColors();
      if (k === "[" || k === "]") {
        const d = k === "]" ? 1 : -1;
        setOptions((o) => {
          const grow = (v: number, max: number) => Math.max(1, Math.min(max, Math.round(v + d * Math.max(1, v * 0.15))));
          if (tool === "brush") return { ...o, brush: { ...o.brush, size: grow(o.brush.size, 200) } };
          if (tool === "eraser") return { ...o, eraser: { ...o.eraser, size: grow(o.eraser.size, 300) } };
          if (tool === "pencil") return { ...o, pencil: { ...o.pencil, size: grow(o.pencil.size, 64) } };
          if (tool === "line" || tool === "rect" || tool === "ellipse") return { ...o, shape: { ...o.shape, width: grow(o.shape.width, 80) } };
          return o;
        });
        return;
      }
      const t = TOOLS.find((x) => x.key.toLowerCase() === k);
      if (t) setTool(t.id);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [doc, step, tool, copy, setTool, setOptions, swapColors]);

  // ---- tracing (Vectorize step): again whenever the settings or the traced pixels change
  const s = doc.trace;
  const rasterSig = doc.layers
    .filter((l) => l.kind === "raster")
    .map((l) => `${l.id}:${l.visible ? 1 : 0}:${l.opacity}:${l.blend}`)
    .join(",");
  const traceKey = step === "vectorize" ? `${JSON.stringify(s)}|${doc.pixelRev}|${rasterSig}|${s.scope === "layer" ? doc.activeId : ""}|${s.scope === "selection" ? doc.selRev : ""}` : null;

  const runTrace = useCallback(async () => {
    doc.commitFloating();
    const src = traceSource(doc, doc.trace);
    if (typeof src === "string") {
      tracer.cancel();
      setPreview(null);
      setStatus({ state: "error", message: src });
      return;
    }
    setStatus({ state: "tracing" });
    try {
      const r = await tracer.trace(src, { ...doc.trace });
      if (!r) return;
      setPreview({ markup: r.markup, x: r.x, y: r.y, unit: r.unit });
      setStatus({ state: "done", result: r });
    } catch (e) {
      setStatus({ state: "error", message: `Tracing stopped: ${e instanceof Error ? e.message : String(e)}` });
    }
  }, [doc, tracer]);

  useEffect(() => {
    if (!traceKey || !live) return;
    const id = setTimeout(runTrace, 220);
    return () => clearTimeout(id);
  }, [traceKey, live, runTrace]);

  useEffect(() => {
    if (step !== "vectorize") tracer.cancel();
  }, [step, tracer]);

  const result = status.state === "done" ? status.result : null;
  const active = doc.active;
  const updatable = active?.kind === "vector" && active.source ? active : null;

  const keep = (replace?: string) => {
    if (!result || !result.markup) return;
    const v = {
      svg: result.markup,
      x: result.x,
      y: result.y,
      scale: result.unit,
      stats: result.stats,
      source: { layerIds: result.layerIds, scope: result.scope, settings: { ...doc.trace } },
    };
    if (replace) {
      doc.replaceVectorLayer(replace, v, "Update vectors");
      setNotice("Vector layer updated.");
      return;
    }
    const src = result.scope === "layer" ? doc.layer(result.layerIds[0]) : null;
    const base = src ? `${src.name} vectors` : result.scope === "selection" ? "Selection vectors" : "Vectors";
    let name = base;
    for (let n = 2; doc.layers.some((l) => l.name === name); n++) name = `${base} ${n}`;
    if (src) doc.setActive(src.id);
    doc.addVectorLayer({ name, ...v }, "Keep vectors", !src);
    setNotice(`Kept as the vector layer “${name}”. Export it in step 3, or keep fine-tuning.`);
  };

  const setTrace = useCallback((patch: Partial<TraceSettings>) => doc.setTrace(patch), [doc]);

  // ---- layout
  const stepIdx = STEPS.findIndex((x) => x.id === step);
  const goStep = (x: Step) => {
    doc.commitFloating();
    setProjectMenu(null);
    setStep(x);
  };
  const sizeValue = `${doc.width}x${doc.height}`;
  const knownSize = CANVAS_SIZES.some((c) => `${c.w}x${c.h}` === sizeValue);

  return (
    <div className={`editor${dragOver ? " is-dragover" : ""}`}>
      <header className="topbar app-header">
        <div className="app-header-start">
          <a className="app-logo" href="#/" aria-label="Creator Vellum, all projects">
            <Logo />
          </a>
          <nav className="breadcrumb" aria-label="Breadcrumb">
            <a className="crumb-link" href="#/">
              Projects
            </a>
            <span className="crumb-sep" aria-hidden>
              /
            </span>
            <input
              className="project-name"
              aria-label="Project name"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                doc.rename(e.target.value);
              }}
            />
          </nav>
        </div>
        <div className="topbar-end">
          <HeaderNav />
          <ThemeToggle />
        </div>
      </header>

      <div className="app-version">Version {__APP_VERSION__}</div>

      <nav className="steps" aria-label="Steps">
        {STEPS.map((x, i) => (
          <button key={x.id} type="button" className={`step${step === x.id ? " on" : ""}${i < stepIdx ? " past" : ""}`} aria-current={step === x.id ? "step" : undefined} onClick={() => goStep(x.id)}>
            <span className="step-num">{i + 1}</span>
            {x.label}
          </button>
        ))}
        <div className="steps-end">
          <button
            type="button"
            className={`icon-button project-menu-button${projectMenu ? " is-active" : ""}`}
            aria-label="Project: download, duplicate or delete"
            title="Project"
            aria-haspopup="menu"
            aria-expanded={!!projectMenu}
            onClick={(e) => {
              if (projectMenu) return setProjectMenu(null);
              const r = e.currentTarget.getBoundingClientRect();
              const vw = document.documentElement.clientWidth;
              setProjectMenu({ top: r.bottom + 4, right: Math.max(8, Math.min(vw - r.right, vw - 198)) });
            }}
          >
            <svg viewBox="0 0 18 16" width="24" height="22" aria-hidden>
              <path
                fill="currentColor"
                d="M12.5 7.98V6.5c0-.28-.23-.5-.5-.5H9.05C7.46 6 6.11 7.05 5.66 8.49 5.56 8.19 5.5 7.87 5.5 7.5 5.5 5.57 7.07 4 9 4h3c.28 0 .5-.22.5-.5V2.02L15.81 5 12.5 7.98ZM10.5 7.5H11V9c0 .55.45 1 1 1h.12c.25 0 .48-.09.67-.26l4.34-3.91c.24-.21.37-.51.37-.83s-.13-.62-.37-.83L12.81.28A1.08 1.08 0 0 0 11 1.08V2.5H9C6.24 2.5 4 4.74 4 7.5c0 1.89 1.08 3.1 2 3.78.18.14.36.25.52.35.14.08.27.15.37.21.1.05.19.09.26.12.07.03.14.04.22.04h.08c.31 0 .56-.25.56-.56 0-.24-.17-.46-.36-.61l-.04-.03a1.4 1.4 0 0 1-.31-.3 1.97 1.97 0 0 1-.43-1.26c0-1.13.92-2.05 2.05-2.05h1.45L10.5 7.5ZM2.25 1A2.25 2.25 0 0 0 0 3.25v10.5C0 14.99 1.01 16 2.25 16h10.5c1.24 0 2.25-1.01 2.25-2.25v-2a.75.75 0 0 0-1.5 0v2c0 .42-.33.75-.75.75H2.25a.75.75 0 0 1-.75-.75V3.25c0-.42.33-.75.75-.75h2a.75.75 0 0 0 0-1.5h-2Z"
              />
            </svg>
          </button>
          {projectMenu && (
            <div className="menu project-menu" role="menu" style={{ top: projectMenu.top, right: projectMenu.right }} onMouseLeave={() => setProjectMenu(null)}>
              <button type="button" role="menuitem" onClick={() => (setProjectMenu(null), downloadProjectFile(doc))}>
                Download project file
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={async () => {
                  setProjectMenu(null);
                  doc.commitFloating();
                  // save what's on screen first, so the copy has it all
                  await saveProject(doc.toProject(), await allBitmaps(doc));
                  const copy = await duplicateProject(doc.id);
                  if (copy) navigate(`/p/${copy.id}`);
                }}
              >
                Duplicate project
              </button>
              <button
                type="button"
                role="menuitem"
                className="danger"
                onClick={async () => {
                  setProjectMenu(null);
                  if (!confirm(`Delete ${doc.name}? It's removed from this browser. Download the project file first if you want to keep it.`)) return;
                  doc.dirty.clear();
                  doc.metaDirty = false;
                  await deleteProject(doc.id);
                  navigate("/");
                }}
              >
                Delete project
              </button>
            </div>
          )}
          <select
            className="aspect-select"
            aria-label="Canvas size"
            value={sizeValue}
            onChange={(e) => {
              const [w, h] = e.target.value.split("x").map(Number);
              doc.resize(w, h);
              setNotice(`Canvas is now ${w} × ${h} px. Undo puts it back.`);
            }}
          >
            {!knownSize && (
              <option value={sizeValue}>
                {doc.width} × {doc.height}
              </option>
            )}
            {CANVAS_SIZES.map((c) => (
              <option key={`${c.w}x${c.h}`} value={`${c.w}x${c.h}`}>
                {c.label}
              </option>
            ))}
          </select>
        </div>
      </nav>

      <aside className="panel">
        <div className="panel-body">
          {step === "sketch" && <SketchPanel doc={doc} tool={tool} options={options} setOptions={setOptions} onAddImage={addFile} onCopy={() => copy(false)} onCut={() => copy(true)} onPaste={pasteButton} />}
          {step === "vectorize" && (
            <VectorizePanel
              doc={doc}
              set={setTrace}
              status={status}
              live={live}
              setLive={setLive}
              onTrace={runTrace}
              view={view}
              setView={setView}
              sourceOpacity={sourceOpacity}
              setSourceOpacity={setSourceOpacity}
            />
          )}
          {step === "export" && <ExportPanel doc={doc} version={version} onNotice={setNotice} onVectorize={() => goStep("vectorize")} />}
        </div>
        {step === "vectorize" && (
          <footer className="panel-foot panel-foot-stack">
            <button type="button" className="btn btn-primary btn-wide" disabled={!result?.markup} onClick={() => keep()}>
              Keep as vector layer
            </button>
            {updatable && (
              <button type="button" className="btn btn-wide" disabled={!result?.markup} onClick={() => keep(updatable.id)} title="Replace its shapes with this trace">
                Update “{updatable.name}”
              </button>
            )}
            <button type="button" className="btn btn-wide" onClick={() => goStep("export")}>
              {STEPS[stepIdx].next}
            </button>
          </footer>
        )}
        {step === "sketch" && (
          <footer className="panel-foot">
            <button type="button" className="btn btn-primary btn-wide" onClick={() => goStep("vectorize")}>
              {STEPS[stepIdx].next}
            </button>
          </footer>
        )}
      </aside>

      <main className="stage" ref={stageRef}>
        <Stage
          doc={doc}
          version={version}
          step={step}
          tool={tool}
          options={options}
          onPick={pickColor}
          onNotice={setNotice}
          preview={step === "vectorize" ? preview : null}
          view={view}
          sourceOpacity={sourceOpacity}
        >
          {step === "sketch" && (
            <Floating id="tools" className="pos-tools" bounds={stageSize}>
              <ToolPalette doc={doc} tool={tool} setTool={setTool} options={options} onSwap={swapColors} />
            </Floating>
          )}
          <Floating id="layers" className="pos-layers" bounds={stageSize}>
            <LayersPanel doc={doc} version={version} onNotice={setNotice} />
          </Floating>
          {step === "vectorize" && updatable && JSON.stringify(updatable.source!.settings) !== JSON.stringify(doc.trace) && (
            <div className="stage-hint">
              <span>
                “{updatable.name}” was traced with its own settings.
              </span>
              <button type="button" className="btn btn-small" onClick={() => doc.setTrace({ ...updatable.source!.settings })}>
                Use its settings
              </button>
            </div>
          )}
          {step === "sketch" && blank && doc.pixelRev === 0 && doc.layers.length === 1 && !doc.floating && (
            <div className="getting-started">
              <strong>Start here</strong>
              <span>Draw with the brush, or paste or drop an image to trace. Then go to Vectorize.</span>
            </div>
          )}
          {dragOver && <div className="drop-veil">Drop an image, an SVG or a project file</div>}
        </Stage>
      </main>

      {notice && (
        <div className="notice" role="status">
          {notice}
        </div>
      )}
    </div>
  );
}

async function allBitmaps(doc: Doc) {
  const m = new Map<string, Blob>();
  for (const l of doc.layers) if (l.kind === "raster") m.set(l.id, await canvasToBlob(doc.canvas(l.id)!));
  return m;
}

/** A project that opened with one empty pixel layer. */
function startsBlank(doc: Doc) {
  if (doc.layers.length !== 1 || doc.layers[0].kind !== "raster") return false;
  const c = doc.canvas(doc.layers[0].id);
  return !c || contentBounds(c) === null;
}
