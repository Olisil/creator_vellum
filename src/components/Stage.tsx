import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Doc } from "../lib/doc";
import { ctx2d, makeCanvas } from "../lib/raster";
import { fillAt, pickAt, polygonSelection, StrokeSession, wandAt, type ToolId, type ToolOptions } from "../lib/tools";
import type { VectorLayer } from "../lib/types";
import { layerTransform } from "../lib/vector";
import { icons } from "./Icons";

export type ViewMode = "overlay" | "vector" | "source" | "outline";
export interface Preview {
  markup: string;
  x: number;
  y: number;
  unit: number;
}

type View = { zoom: number; x: number; y: number };
type Drag =
  | { kind: "stroke"; session: StrokeSession; id: number }
  | { kind: "pan"; sx: number; sy: number; vx: number; vy: number }
  | { kind: "select"; tool: "select" | "lasso"; pts: [number, number][] }
  | { kind: "float-move"; sx: number; sy: number; fx: number; fy: number }
  | { kind: "float-size"; handle: string; sx: number; sy: number; f: { x: number; y: number; w: number; h: number } }
  | { kind: "vector-move"; id: string; sx: number; sy: number; lx: number; ly: number }
  | { kind: "pick"; flat: HTMLCanvasElement }
  | { kind: "pinch"; d0: number; mx: number; my: number; v: View };

/** Hosts a layer canvas (which lives in the document, not in React). */
function CanvasHost({ canvas, className }: { canvas: HTMLCanvasElement; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (el && el.firstChild !== canvas) el.replaceChildren(canvas);
  }, [canvas]);
  return <div ref={ref} className={className} />;
}

function VectorView({ l, className }: { l: Pick<VectorLayer, "svg" | "x" | "y" | "scale">; className?: string }) {
  const t = layerTransform(l);
  return (
    <svg className={className} xmlns="http://www.w3.org/2000/svg">
      <g transform={t || undefined} dangerouslySetInnerHTML={{ __html: l.svg }} />
    </svg>
  );
}

const HANDLES = ["nw", "n", "ne", "e", "se", "s", "sw", "w"] as const;

export function Stage(props: {
  doc: Doc;
  version: number;
  step: "sketch" | "vectorize" | "export";
  tool: ToolId;
  options: ToolOptions;
  onPick: (color: string) => void;
  onNotice: (msg: string) => void;
  preview: Preview | null;
  view: ViewMode;
  sourceOpacity: number;
  children?: ReactNode;
}) {
  const { doc, tool, options } = props;
  const vp = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [view, setView] = useState<View>({ zoom: 1, x: 0, y: 0 });
  const viewRef = useRef(view);
  viewRef.current = view;
  const drag = useRef<Drag | null>(null);
  const touches = useRef(new Map<number, { x: number; y: number }>());
  const [, force] = useState(0);
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);
  const [space, setSpace] = useState(false);
  const fitted = useRef("");

  // ---------- view ----------
  useLayoutEffect(() => {
    const el = vp.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  const fit = useCallback(() => {
    if (!size.w || !size.h) return;
    const pad = size.w < 700 ? 24 : 96;
    const z = Math.min((size.w - pad) / doc.width, (size.h - pad) / doc.height);
    const zoom = Math.max(0.02, Math.min(32, z));
    setView({ zoom, x: (size.w - doc.width * zoom) / 2, y: (size.h - doc.height * zoom) / 2 });
  }, [size.w, size.h, doc.width, doc.height]);

  useEffect(() => {
    const key = `${doc.width}x${doc.height}`;
    if (size.w && fitted.current !== key) {
      fitted.current = key;
      fit();
    }
  }, [size.w, doc.width, doc.height, fit]);

  const zoomAt = useCallback((factor: number, cx?: number, cy?: number) => {
    setView((v) => {
      const zoom = Math.max(0.02, Math.min(64, v.zoom * factor));
      const px = cx ?? (vp.current?.clientWidth ?? 0) / 2;
      const py = cy ?? (vp.current?.clientHeight ?? 0) / 2;
      const k = zoom / v.zoom;
      return { zoom, x: px - (px - v.x) * k, y: py - (py - v.y) * k };
    });
  }, []);
  const setZoom = (z: number) => zoomAt(z / viewRef.current.zoom);

  useEffect(() => {
    const el = vp.current;
    if (!el) return;
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      if (e.ctrlKey || e.metaKey) zoomAt(Math.exp(-e.deltaY * 0.0025), e.clientX - r.left, e.clientY - r.top);
      else setView((v) => ({ ...v, x: v.x - e.deltaX, y: v.y - e.deltaY }));
    };
    el.addEventListener("wheel", wheel, { passive: false });
    return () => el.removeEventListener("wheel", wheel);
  }, [zoomAt]);

  useEffect(() => {
    const typing = () => {
      const a = document.activeElement;
      return a instanceof HTMLInputElement || a instanceof HTMLTextAreaElement || a instanceof HTMLSelectElement;
    };
    const down = (e: KeyboardEvent) => {
      if (typing()) return;
      if (e.code === "Space" && !e.repeat) {
        setSpace(true);
        e.preventDefault();
      }
      const mod = e.ctrlKey || e.metaKey;
      if (mod && (e.key === "0" || e.key === "1" || e.key === "+" || e.key === "=" || e.key === "-")) {
        e.preventDefault();
        if (e.key === "0") fit();
        else if (e.key === "1") setZoom(1);
        else zoomAt(e.key === "-" ? 1 / 1.25 : 1.25);
      }
      const f = doc.floating;
      if (f && ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)) {
        e.preventDefault();
        const step = e.shiftKey ? 10 : 1;
        doc.setFloating({ x: f.x + (e.key === "ArrowLeft" ? -step : e.key === "ArrowRight" ? step : 0), y: f.y + (e.key === "ArrowUp" ? -step : e.key === "ArrowDown" ? step : 0) });
      }
    };
    const up = (e: KeyboardEvent) => e.code === "Space" && setSpace(false);
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fit, zoomAt, doc]);

  const toCanvas = (e: { clientX: number; clientY: number }) => {
    const r = vp.current!.getBoundingClientRect();
    const v = viewRef.current;
    return [(e.clientX - r.left - v.x) / v.zoom, (e.clientY - r.top - v.y) / v.zoom] as [number, number];
  };

  // ---------- pointer ----------
  const active = doc.active;
  const paintTool = ["brush", "pencil", "eraser", "line", "rect", "ellipse", "fill"].includes(tool);

  const pinchStart = () => {
    const [a, b] = [...touches.current.values()];
    const r = vp.current!.getBoundingClientRect();
    drag.current = { kind: "pinch", d0: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)), mx: (a.x + b.x) / 2 - r.left, my: (a.y + b.y) / 2 - r.top, v: viewRef.current };
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button === 2) return;
    const el = vp.current!;
    el.setPointerCapture(e.pointerId);
    if (e.pointerType === "touch") {
      touches.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (touches.current.size === 2) {
        // a second finger: pinch to zoom and pan; a stroke the first finger started is taken back
        const d = drag.current;
        if (d?.kind === "stroke") {
          d.session.end();
          doc.undo();
        }
        pinchStart();
        return;
      }
      if (touches.current.size > 2) return;
    }
    const [x, y] = toCanvas(e);
    const v = viewRef.current;
    if (e.button === 1 || space || tool === "hand" || props.step !== "sketch") {
      drag.current = { kind: "pan", sx: e.clientX, sy: e.clientY, vx: v.x, vy: v.y };
      return;
    }
    const f = doc.floating;
    if (f) {
      const inside = x >= Math.min(f.x, f.x + f.w) && x <= Math.max(f.x, f.x + f.w) && y >= Math.min(f.y, f.y + f.h) && y <= Math.max(f.y, f.y + f.h);
      if (inside) drag.current = { kind: "float-move", sx: x, sy: y, fx: f.x, fy: f.y };
      else doc.commitFloating();
      return;
    }
    if (tool === "picker" || (e.altKey && (tool === "brush" || tool === "pencil" || tool === "fill" || tool === "line" || tool === "rect" || tool === "ellipse"))) {
      const flat = doc.compositeRaster();
      const c = pickAt(doc, x, y, flat);
      if (c) props.onPick(c);
      drag.current = { kind: "pick", flat };
      return;
    }
    if (tool === "select" || tool === "lasso") {
      drag.current = { kind: "select", tool, pts: [[x, y]] };
      return;
    }
    if (tool === "wand") {
      wandAt(doc, x, y, options);
      return;
    }
    if (tool === "move") {
      if (active?.kind === "vector") {
        drag.current = { kind: "vector-move", id: active.id, sx: x, sy: y, lx: active.x, ly: active.y };
        return;
      }
      if (!active || !active.visible) return props.onNotice("Show the layer to move it.");
      if (doc.lift()) {
        const nf = doc.floating!;
        drag.current = { kind: "float-move", sx: x, sy: y, fx: nf.x, fy: nf.y };
      } else props.onNotice("Nothing to move on this layer.");
      return;
    }
    if (paintTool) {
      if (!active || active.kind !== "raster") return props.onNotice("This is a vector layer. Pick or add a pixel layer to draw on.");
      if (!active.visible) return props.onNotice("This layer is hidden. Show it to draw on it.");
      const color = options.color;
      if (tool === "fill") {
        fillAt(doc, active.id, x, y, options, color);
        return;
      }
      const session = new StrokeSession(doc, active.id, tool, options, color);
      session.add(x, y, e.pointerType === "pen" ? e.pressure : 0.5, e.shiftKey);
      drag.current = { kind: "stroke", session, id: e.pointerId };
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const [x, y] = toCanvas(e);
    if (e.pointerType !== "touch") setCursor({ x, y });
    if (touches.current.has(e.pointerId)) touches.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const d = drag.current;
    if (!d) return;
    if (d.kind === "pinch") {
      if (touches.current.size < 2) return;
      const [a, b] = [...touches.current.values()];
      const r = vp.current!.getBoundingClientRect();
      const k = Math.hypot(a.x - b.x, a.y - b.y) / d.d0;
      const zoom = Math.max(0.02, Math.min(64, d.v.zoom * k));
      const mx = (a.x + b.x) / 2 - r.left;
      const my = (a.y + b.y) / 2 - r.top;
      const kk = zoom / d.v.zoom;
      setView({ zoom, x: mx - (d.mx - d.v.x) * kk, y: my - (d.my - d.v.y) * kk });
      return;
    }
    if (d.kind === "pan") setView((v) => ({ ...v, x: d.vx + e.clientX - d.sx, y: d.vy + e.clientY - d.sy }));
    else if (d.kind === "stroke") {
      const evs = (e.nativeEvent.getCoalescedEvents?.() ?? []) as PointerEvent[];
      const list = evs.length ? evs : [e.nativeEvent];
      for (const ev of list) {
        const [cx, cy] = toCanvas(ev);
        d.session.add(cx, cy, ev.pointerType === "pen" ? ev.pressure : 0.5, ev.shiftKey);
      }
    } else if (d.kind === "pick") {
      const c = pickAt(doc, x, y, d.flat);
      if (c) props.onPick(c);
    } else if (d.kind === "select") {
      if (d.tool === "select") d.pts = [d.pts[0], [x, y]];
      else d.pts.push([x, y]);
      force((n) => n + 1);
    } else if (d.kind === "float-move") doc.setFloating({ x: Math.round(d.fx + x - d.sx), y: Math.round(d.fy + y - d.sy) });
    else if (d.kind === "float-size") resizeFloating(d, x, y, e.shiftKey);
    else if (d.kind === "vector-move") {
      const l = doc.layer(d.id);
      if (l?.kind === "vector") doc.updateLayer(d.id, { x: Math.round(d.lx + x - d.sx), y: Math.round(d.ly + y - d.sy) }, "Move layer", "move");
    }
  };

  const onPointerUp = (e: React.PointerEvent) => {
    touches.current.delete(e.pointerId);
    const d = drag.current;
    if (d?.kind === "pinch") {
      if (touches.current.size < 2) drag.current = null;
      return;
    }
    drag.current = null;
    if (!d) return;
    if (d.kind === "stroke") d.session.end();
    else if (d.kind === "select") {
      const moved = d.pts.length > 1 && Math.hypot(d.pts[d.pts.length - 1][0] - d.pts[0][0], d.pts[d.pts.length - 1][1] - d.pts[0][1]) > 2;
      if (!moved) doc.setSelection(null);
      else polygonSelection(doc, d.tool === "select" ? "rect" : "lasso", d.pts);
      force((n) => n + 1);
    }
  };

  const resizeFloating = (d: Extract<Drag, { kind: "float-size" }>, x: number, y: number, keep: boolean) => {
    const { f, handle } = d;
    let x0 = f.x,
      y0 = f.y,
      x1 = f.x + f.w,
      y1 = f.y + f.h;
    const dx = x - d.sx,
      dy = y - d.sy;
    if (handle.includes("w")) x0 += dx;
    if (handle.includes("e")) x1 += dx;
    if (handle.includes("n")) y0 += dy;
    if (handle.includes("s")) y1 += dy;
    let w = Math.max(1, x1 - x0),
      h = Math.max(1, y1 - y0);
    if (keep && handle.length === 2) {
      const k = Math.max(w / f.w, h / f.h);
      w = Math.max(1, f.w * k);
      h = Math.max(1, f.h * k);
      if (handle.includes("w")) x0 = f.x + f.w - w;
      if (handle.includes("n")) y0 = f.y + f.h - h;
    }
    doc.setFloating({ x: Math.round(x0), y: Math.round(y0), w: Math.round(w), h: Math.round(h) });
  };

  // ---------- rendering helpers ----------
  const { zoom } = view;
  const toScreen = (x: number, y: number) => [view.x + x * zoom, view.y + y * zoom] as const;
  const sel = doc.selection;
  const f = doc.floating;

  // selection made by the wand: a tinted mask
  const tint = useMemo(() => {
    if (!sel || sel.kind !== "mask") return null;
    const c = makeCanvas(sel.mask.width, sel.mask.height);
    const ctx = ctx2d(c);
    ctx.drawImage(sel.mask, 0, 0);
    ctx.globalCompositeOperation = "source-in";
    ctx.fillStyle = "rgba(10, 190, 215, 0.35)";
    ctx.fillRect(0, 0, c.width, c.height);
    return c;
  }, [sel]);

  const floatCanvas = useMemo(() => {
    if (!f) return null;
    f.canvas.className = "float-img";
    return f.canvas;
  }, [f?.canvas]);

  const brushSize = tool === "brush" ? options.brush.size : tool === "eraser" ? options.eraser.size : tool === "pencil" ? options.pencil.size : 0;
  const vectorStep = props.step === "vectorize";
  const pixelated = zoom >= 2;
  const cursorClass = space || tool === "hand" || props.step !== "sketch" ? "cur-grab" : f ? "cur-move" : `cur-${tool}`;

  const selPoly = (pts: [number, number][]) => pts.map(([x, y]) => toScreen(x, y).join(",")).join(" ");
  const dsel = drag.current?.kind === "select" ? drag.current : null;

  return (
    <div className="stage-area">
      <div
        ref={vp}
        className={`viewport ${cursorClass}${drag.current?.kind === "pan" ? " is-panning" : ""}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onPointerLeave={() => setCursor(null)}
        onContextMenu={(e) => e.preventDefault()}
      >
        <div
          className={`paper view-${vectorStep ? props.view : "normal"}${pixelated ? " is-pixelated" : ""}`}
          style={{ width: doc.width, height: doc.height, transform: `translate(${view.x}px, ${view.y}px) scale(${zoom})`, ["--src-opacity" as string]: props.sourceOpacity }}
        >
          <div className={`paper-bg${doc.background ? "" : " is-transparent"}`} style={doc.background ? { background: doc.background } : undefined} />
          {doc.layers.map((l) =>
            l.kind === "raster" ? (
              <div key={l.id} className="layer layer-raster" style={{ opacity: l.visible ? l.opacity : 0, mixBlendMode: l.blend === "normal" ? undefined : l.blend }}>
                <CanvasHost canvas={doc.canvas(l.id)!} className="layer-host" />
              </div>
            ) : (
              <div key={l.id} className="layer layer-vector" style={{ opacity: l.visible ? l.opacity : 0, mixBlendMode: l.blend === "normal" ? undefined : l.blend }}>
                <VectorView l={l} />
              </div>
            ),
          )}
          {floatCanvas && f && (
            <div className="float" style={{ left: f.x, top: f.y, width: f.w, height: f.h, transform: `scale(${f.flipX ? -1 : 1}, ${f.flipY ? -1 : 1})`, imageRendering: f.smooth ? undefined : "pixelated" }}>
              <CanvasHost canvas={floatCanvas} className="float-host" />
            </div>
          )}
          {tint && <CanvasHost canvas={tint} className="sel-tint" />}
          {vectorStep && props.preview && (
            <div className="layer trace-preview">
              <VectorView l={{ svg: props.preview.markup, x: props.preview.x, y: props.preview.y, scale: props.preview.unit }} />
            </div>
          )}
        </div>

        <svg className="overlay" width={size.w} height={size.h}>
          {sel?.points && <polygon className="ants" points={selPoly(sel.points)} />}
          {sel?.kind === "mask" && (
            <rect className="ants" x={toScreen(sel.bounds.x, 0)[0]} y={toScreen(0, sel.bounds.y)[1]} width={sel.bounds.w * zoom} height={sel.bounds.h * zoom} />
          )}
          {dsel &&
            (dsel.tool === "select" && dsel.pts.length > 1 ? (
              <rect
                className="ants"
                x={Math.min(toScreen(dsel.pts[0][0], 0)[0], toScreen(dsel.pts[1][0], 0)[0])}
                y={Math.min(toScreen(0, dsel.pts[0][1])[1], toScreen(0, dsel.pts[1][1])[1])}
                width={Math.abs(dsel.pts[1][0] - dsel.pts[0][0]) * zoom}
                height={Math.abs(dsel.pts[1][1] - dsel.pts[0][1]) * zoom}
              />
            ) : (
              <polyline className="ants" points={selPoly(dsel.pts)} />
            ))}
          {f && (
            <g>
              <rect className="float-frame" x={toScreen(f.x, 0)[0]} y={toScreen(0, f.y)[1]} width={f.w * zoom} height={f.h * zoom} />
              {HANDLES.map((h) => {
                const hx = f.x + (h.includes("w") ? 0 : h.includes("e") ? f.w : f.w / 2);
                const hy = f.y + (h.includes("n") ? 0 : h.includes("s") ? f.h : f.h / 2);
                const [sx, sy] = toScreen(hx, hy);
                return (
                  <rect
                    key={h}
                    className={`handle handle-${h}`}
                    x={sx - 5}
                    y={sy - 5}
                    width={10}
                    height={10}
                    onPointerDown={(e) => {
                      e.stopPropagation();
                      vp.current!.setPointerCapture(e.pointerId);
                      const [cx, cy] = toCanvas(e);
                      drag.current = { kind: "float-size", handle: h, sx: cx, sy: cy, f: { x: f.x, y: f.y, w: f.w, h: f.h } };
                    }}
                  />
                );
              })}
            </g>
          )}
          {cursor && brushSize * zoom >= 4 && props.step === "sketch" && !f && !space && (
            <circle className="brush-cursor" cx={toScreen(cursor.x, 0)[0]} cy={toScreen(0, cursor.y)[1]} r={(brushSize * zoom) / 2} />
          )}
        </svg>

        <div className="frame-size" style={{ left: view.x, top: view.y - 20 }}>
          {doc.width} × {doc.height} px · {Math.round(zoom * 100)}%
        </div>
      </div>

      <div className="zoom-controls" role="group" aria-label="Zoom">
        <button type="button" className="map-ctl" aria-label="Zoom in" title="Zoom in (Ctrl +)" onClick={() => zoomAt(1.25)}>
          {icons.zoomIn}
        </button>
        <button type="button" className="map-ctl" aria-label="Zoom out" title="Zoom out (Ctrl −)" onClick={() => zoomAt(1 / 1.25)}>
          {icons.zoomOut}
        </button>
        <button type="button" className="map-ctl" aria-label="Fit to window" title="Fit (Ctrl 0)" onClick={fit}>
          {icons.fit}
        </button>
        <button type="button" className="map-ctl zoom-100" aria-label="Actual pixels" title="100 % (Ctrl 1)" onClick={() => setZoom(1)}>
          1:1
        </button>
      </div>
      {props.children}
    </div>
  );
}
