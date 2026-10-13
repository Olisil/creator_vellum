import { useEffect, useRef, useState } from "react";
import type { Doc } from "../lib/doc";
import { ctx2d } from "../lib/raster";
import type { BlendMode, Layer } from "../lib/types";
import { layerTransform } from "../lib/vector";
import { icons } from "./Icons";

const BLENDS: { value: BlendMode; label: string }[] = [
  { value: "normal", label: "Normal" },
  { value: "multiply", label: "Multiply" },
  { value: "screen", label: "Screen" },
  { value: "overlay", label: "Overlay" },
  { value: "darken", label: "Darken" },
  { value: "lighten", label: "Lighten" },
];

const TW = 44;

/** A small picture of a layer. Pixel layers redraw a moment after they change. */
function LayerThumb({ doc, layer, version }: { doc: Doc; layer: Layer; version: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const th = Math.max(8, Math.round((TW * doc.height) / doc.width));
  const src = layer.kind === "raster" ? doc.canvas(layer.id) : undefined;
  useEffect(() => {
    if (!src) return;
    const id = setTimeout(() => {
      const c = ref.current;
      if (!c) return;
      const ctx = ctx2d(c);
      ctx.clearRect(0, 0, c.width, c.height);
      ctx.imageSmoothingEnabled = doc.width > TW * 4;
      ctx.drawImage(src, 0, 0, c.width, c.height);
    }, 180);
    return () => clearTimeout(id);
  }, [src, version, doc.width, th]);
  if (layer.kind === "vector")
    return (
      <svg className="layer-thumb" width={TW} height={th} viewBox={`0 0 ${doc.width} ${doc.height}`} aria-hidden>
        <g transform={layerTransform(layer) || undefined} dangerouslySetInnerHTML={{ __html: layer.svg }} />
      </svg>
    );
  return <canvas ref={ref} className="layer-thumb" width={TW * 2} height={th * 2} style={{ width: TW, height: th }} aria-hidden />;
}

function LayerName({ layer, onRename }: { layer: Layer; onRename: (name: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(layer.name);
  if (!editing)
    return (
      <span
        className="layer-name"
        title="Double-click to rename"
        onDoubleClick={() => {
          setValue(layer.name);
          setEditing(true);
        }}
      >
        {layer.name}
      </span>
    );
  const done = (save: boolean) => {
    setEditing(false);
    const v = value.trim();
    if (save && v && v !== layer.name) onRename(v);
  };
  return (
    <input
      className="layer-name-input"
      aria-label="Layer name"
      autoFocus
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => done(true)}
      onKeyDown={(e) => {
        if (e.key === "Enter") done(true);
        if (e.key === "Escape") done(false);
        e.stopPropagation();
      }}
      onClick={(e) => e.stopPropagation()}
    />
  );
}

export function LayersPanel({ doc, version, onNotice }: { doc: Doc; version: number; onNotice: (m: string) => void }) {
  const [open, setOpen] = useState(() => window.innerWidth > 900);
  const active = doc.active;
  const idx = doc.layers.findIndex((l) => l.id === doc.activeId);
  const below = idx > 0 ? doc.layers[idx - 1] : undefined;
  const busy = !!doc.floating;

  return (
    <div className={`layers${open ? "" : " is-closed"}`} role="region" aria-label="Layers">
      <div className="layers-head">
        <button type="button" className="layers-title" aria-expanded={open} onClick={() => setOpen(!open)}>
          Layers
          <span className="layers-count">{doc.layers.length}</span>
          <svg viewBox="0 0 12 12" width="12" height="12" aria-hidden>
            <path d="M3 4.5 6 7.5 9 4.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <button type="button" className="mini-btn" aria-label="New pixel layer" title="New pixel layer (Ctrl Shift N)" disabled={busy} onClick={() => doc.addRasterLayer()}>
          {icons.plus}
        </button>
      </div>
      {open && (
        <>
          <ol className="layer-list">
            {[...doc.layers].reverse().map((l) => (
              <li
                key={l.id}
                className={`layer-row${l.id === doc.activeId ? " on" : ""}${l.visible ? "" : " is-hidden"}`}
                onClick={() => !busy && doc.setActive(l.id)}
                aria-current={l.id === doc.activeId ? "true" : undefined}
              >
                <button
                  type="button"
                  className="mini-btn eye"
                  aria-label={l.visible ? `Hide ${l.name}` : `Show ${l.name}`}
                  aria-pressed={l.visible}
                  onClick={(e) => {
                    e.stopPropagation();
                    doc.updateLayer(l.id, { visible: !l.visible }, l.visible ? "Hide layer" : "Show layer");
                  }}
                >
                  {l.visible ? icons.eye : icons.eyeOff}
                </button>
                <LayerThumb doc={doc} layer={l} version={version} />
                <span className="layer-text">
                  <LayerName layer={l} onRename={(name) => doc.updateLayer(l.id, { name }, "Rename layer")} />
                  {l.kind === "vector" && (
                    <span className="layer-kind" title={l.stats ? `${l.stats.paths} paths, ${l.stats.colors} colours` : "Vector layer"}>
                      {icons.vector} Vector{l.stats ? ` · ${l.stats.paths} ${l.stats.paths === 1 ? "path" : "paths"}` : ""}
                    </span>
                  )}
                </span>
              </li>
            ))}
          </ol>

          {active && (
            <div className="layer-props">
              <div className="layer-prop">
                <label htmlFor="layer-opacity">Opacity</label>
                <input
                  id="layer-opacity"
                  type="range"
                  min={0}
                  max={100}
                  step={1}
                  value={Math.round(active.opacity * 100)}
                  onChange={(e) => doc.updateLayer(active.id, { opacity: parseInt(e.target.value) / 100 }, "Layer opacity", "opacity")}
                />
                <output>{Math.round(active.opacity * 100)}%</output>
              </div>
              <select aria-label="Blend mode" value={active.blend} onChange={(e) => doc.updateLayer(active.id, { blend: e.target.value as BlendMode }, "Blend mode")}>
                {BLENDS.map((b) => (
                  <option key={b.value} value={b.value}>
                    {b.label}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="layer-actions">
            <button type="button" className="mini-btn" aria-label="Move layer up" title="Move up" disabled={busy || idx >= doc.layers.length - 1} onClick={() => active && doc.moveLayer(active.id, 1)}>
              {icons.up}
            </button>
            <button type="button" className="mini-btn" aria-label="Move layer down" title="Move down" disabled={busy || idx <= 0} onClick={() => active && doc.moveLayer(active.id, -1)}>
              {icons.down}
            </button>
            <button type="button" className="mini-btn" aria-label="Duplicate layer" title="Duplicate (Ctrl J)" disabled={busy || !active} onClick={() => active && doc.duplicateLayer(active.id)}>
              {icons.copy}
            </button>
            <button
              type="button"
              className="mini-btn"
              aria-label="Merge down"
              title={below?.kind === "raster" ? `Merge into ${below.name}` : "Merge down (needs a pixel layer below)"}
              disabled={busy || !active || below?.kind !== "raster"}
              onClick={() => active && doc.mergeDown(active.id)}
            >
              {icons.merge}
            </button>
            {active?.kind === "vector" && (
              <button type="button" className="mini-btn mini-text" title="Turn this vector layer into pixels" disabled={busy} onClick={() => doc.rasterize(active.id)}>
                To pixels
              </button>
            )}
            <button
              type="button"
              className="mini-btn danger"
              aria-label="Delete layer"
              title="Delete layer"
              disabled={busy || doc.layers.length <= 1}
              onClick={() => {
                if (!active) return;
                doc.removeLayer(active.id);
                onNotice(`Deleted ${active.name}. Undo brings it back.`);
              }}
            >
              {icons.trash}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
