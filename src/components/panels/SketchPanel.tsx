import { useEffect, useState } from "react";
import type { Doc } from "../../lib/doc";
import { TOOLS, type ToolId, type ToolOptions } from "../../lib/tools";
import { ColorPicker, Fold, Section, Segmented, Slider, Toggle } from "../Controls";
import { icons } from "../Icons";

type SetOpt = <K extends keyof ToolOptions>(key: K, patch: Partial<ToolOptions[K]> | ToolOptions[K]) => void;

function ToolOptionsView({ tool, o, set }: { tool: ToolId; o: ToolOptions; set: SetOpt }) {
  const px = (v: number) => `${v} px`;
  const pct = (v: number) => `${Math.round(v * 100)}%`;
  switch (tool) {
    case "brush":
      return (
        <>
          <Slider label="Size" value={o.brush.size} min={1} max={200} step={1} format={px} onChange={(v) => set("brush", { size: v })} />
          <Slider label="Opacity" value={o.brush.opacity} min={0.05} max={1} step={0.05} format={pct} onChange={(v) => set("brush", { opacity: v })} />
          <Slider label="Smoothing" value={o.brush.smoothing} min={0} max={1} step={0.05} format={pct} ends={["Raw", "Steady"]} onChange={(v) => set("brush", { smoothing: v })} />
          <Toggle label="Pressure" hint="Thinner where you press lightly with a pen, or where you draw fast with a mouse." checked={o.brush.pressure} onChange={(v) => set("brush", { pressure: v })} />
          <Toggle label="Hard edge" hint="No soft edge pixels. Traces cleaner." checked={o.brush.hard} onChange={(v) => set("brush", { hard: v })} />
        </>
      );
    case "pencil":
      return (
        <>
          <Slider label="Size" value={o.pencil.size} min={1} max={64} step={1} format={px} onChange={(v) => set("pencil", { size: v })} />
          <Slider label="Opacity" value={o.pencil.opacity} min={0.05} max={1} step={0.05} format={pct} onChange={(v) => set("pencil", { opacity: v })} />
          <Segmented
            label="Pencil tip"
            value={o.pencil.square ? "square" : "round"}
            options={[
              { value: "square", label: "Square" },
              { value: "round", label: "Round" },
            ]}
            onChange={(v) => set("pencil", { square: v === "square" })}
          />
          <p className="hint">Every pixel crisp, no smoothing: for pixel art and exact marks.</p>
        </>
      );
    case "eraser":
      return (
        <>
          <Slider label="Size" value={o.eraser.size} min={1} max={300} step={1} format={px} onChange={(v) => set("eraser", { size: v })} />
          <Slider label="Strength" value={o.eraser.opacity} min={0.05} max={1} step={0.05} format={pct} onChange={(v) => set("eraser", { opacity: v })} />
          <Toggle label="Pixel eraser" hint="Hard, pixel-exact edges." checked={o.eraser.hard} onChange={(v) => set("eraser", { hard: v })} />
        </>
      );
    case "fill":
      return (
        <>
          <Slider label="Tolerance" value={o.fill.tolerance} min={0} max={255} step={1} ends={["Exact colour", "Similar colours"]} onChange={(v) => set("fill", { tolerance: v })} />
          <Toggle label="Only connected pixels" checked={o.fill.contiguous} onChange={(v) => set("fill", { contiguous: v })} />
          <Toggle label="Look at all layers" hint="Fill the area as you see it, on the current layer." checked={o.fill.allLayers} onChange={(v) => set("fill", { allLayers: v })} />
        </>
      );
    case "line":
    case "rect":
    case "ellipse":
      return (
        <>
          <Slider label="Line width" value={o.shape.width} min={1} max={80} step={1} format={px} onChange={(v) => set("shape", { width: v })} />
          <Slider label="Opacity" value={o.shape.opacity} min={0.05} max={1} step={0.05} format={pct} onChange={(v) => set("shape", { opacity: v })} />
          {tool !== "line" && <Toggle label="Filled" checked={o.shape.filled} onChange={(v) => set("shape", { filled: v })} />}
          <Toggle label="Hard edge" checked={o.shape.hard} onChange={(v) => set("shape", { hard: v })} />
          <p className="hint">Hold Shift for straight angles, squares and circles.</p>
        </>
      );
    case "wand":
      return (
        <>
          <Slider label="Tolerance" value={o.wand.tolerance} min={0} max={255} step={1} ends={["Exact colour", "Similar colours"]} onChange={(v) => set("wand", { tolerance: v })} />
          <Toggle label="Only connected pixels" checked={o.wand.contiguous} onChange={(v) => set("wand", { contiguous: v })} />
          <Toggle label="Look at all layers" checked={o.wand.allLayers} onChange={(v) => set("wand", { allLayers: v })} />
        </>
      );
    case "select":
    case "lasso":
      return <p className="hint">Drag to select. Painting, filling and tracing stay inside the selection. Click outside it to let go.</p>;
    case "move":
      return <p className="hint">Drag to move the selection, or the whole layer when nothing is selected. Pull the handles to resize; hold Shift to keep the shape. Arrow keys nudge.</p>;
    case "picker":
      return <p className="hint">Click the canvas to pick a colour. With the brush, hold Alt to pick without switching tools.</p>;
    case "hand":
      return <p className="hint">Drag to move around. You can also hold Space with any tool, or scroll. Ctrl + scroll zooms.</p>;
  }
}

function CanvasSize({ doc }: { doc: Doc }) {
  const [w, setW] = useState(String(doc.width));
  const [h, setH] = useState(String(doc.height));
  useEffect(() => {
    setW(String(doc.width));
    setH(String(doc.height));
  }, [doc.width, doc.height]);
  const nw = parseInt(w) || 0;
  const nh = parseInt(h) || 0;
  const valid = nw >= 1 && nh >= 1 && nw <= 8192 && nh <= 8192;
  return (
    <div className="size-row">
      <input className="input size-input" inputMode="numeric" aria-label="Width in pixels" value={w} onChange={(e) => setW(e.target.value.replace(/\D/g, ""))} />
      <span aria-hidden>×</span>
      <input className="input size-input" inputMode="numeric" aria-label="Height in pixels" value={h} onChange={(e) => setH(e.target.value.replace(/\D/g, ""))} />
      <button type="button" className="btn btn-small" disabled={!valid || (nw === doc.width && nh === doc.height)} onClick={() => doc.resize(nw, nh)}>
        Apply
      </button>
    </div>
  );
}

export function SketchPanel(props: {
  doc: Doc;
  tool: ToolId;
  options: ToolOptions;
  setOptions: (fn: (o: ToolOptions) => ToolOptions) => void;
  onAddImage: (file: File) => void;
  onCopy: () => void;
  onCut: () => void;
  onPaste: () => void;
}) {
  const { doc, tool, options: o } = props;
  const set: SetOpt = (key, patch) =>
    props.setOptions((prev) => ({ ...prev, [key]: typeof prev[key] === "object" && !Array.isArray(prev[key]) ? { ...(prev[key] as object), ...(patch as object) } : patch }));
  const setColor = (c: string) => props.setOptions((p) => ({ ...p, color: c, recent: [c, ...p.recent.filter((x) => x !== c)].slice(0, 8) }));
  const t = TOOLS.find((x) => x.id === tool)!;
  const f = doc.floating;
  const sel = doc.selection;
  const active = doc.active;

  return (
    <>
      <div className="panel-intro">
        <h2>Sketch</h2>
        <p>Draw, paste and arrange on layers. Everything you make here can be traced into vectors in the next step.</p>
      </div>

      {f && (
        <Section title={f.createdLayer ? "Place the image" : "Move & resize"}>
          <p className="hint">Drag to move, pull the handles to resize (Shift keeps the shape). Enter applies, Esc cancels.</p>
          <div className="button-row">
            <button type="button" className="btn btn-small btn-primary" onClick={() => doc.commitFloating()}>
              Apply
            </button>
            <button type="button" className="btn btn-small" onClick={() => doc.cancelFloating()}>
              Cancel
            </button>
          </div>
          <div className="button-row">
            <button type="button" className="btn btn-small" aria-pressed={f.flipX} onClick={() => doc.setFloating({ flipX: !f.flipX })}>
              {icons.flipH} Flip
            </button>
            <button type="button" className="btn btn-small" aria-pressed={f.flipY} onClick={() => doc.setFloating({ flipY: !f.flipY })}>
              {icons.flipV} Flip
            </button>
            <button
              type="button"
              className="btn btn-small"
              onClick={() => {
                const k = Math.min(doc.width / f.canvas.width, doc.height / f.canvas.height);
                const w = Math.round(f.canvas.width * k);
                const h = Math.round(f.canvas.height * k);
                doc.setFloating({ w, h, x: Math.round((doc.width - w) / 2), y: Math.round((doc.height - h) / 2) });
              }}
            >
              Fit canvas
            </button>
            <button type="button" className="btn btn-small" onClick={() => doc.setFloating({ w: f.canvas.width, h: f.canvas.height })}>
              100%
            </button>
          </div>
          <Toggle label="Smooth scaling" hint="Off keeps hard pixels when you scale up pixel art." checked={f.smooth} onChange={(v) => doc.setFloating({ smooth: v })} />
        </Section>
      )}

      <Section title="Colour">
        <div className="color-now">
          <label className="color-big" style={{ background: o.color }} title="Pick any colour">
            <input type="color" aria-label="Colour" value={o.color.slice(0, 7)} onChange={(e) => setColor(e.target.value.toUpperCase())} />
          </label>
          <span className="color-hex">{o.color}</span>
          <button type="button" className="btn btn-small btn-quiet" title="Swap with the second colour (X)" onClick={() => props.setOptions((p) => ({ ...p, color: p.color2, color2: p.color }))}>
            {icons.swap} Swap
          </button>
        </div>
        <ColorPicker label="Colour" value={o.color} onChange={setColor} />
        {o.recent.length > 0 && (
          <div className="colors recent" role="group" aria-label="Recent colours">
            {o.recent.map((c) => (
              <button key={c} type="button" className="color color-small" style={{ background: c }} aria-label={`Recent colour ${c}`} onClick={() => setColor(c)} />
            ))}
          </div>
        )}
      </Section>

      <Section title={t.label}>
        {active?.kind === "vector" && ["brush", "pencil", "eraser", "fill", "line", "rect", "ellipse"].includes(tool) && (
          <p className="hint hint-live">The active layer is a vector layer. Pick a pixel layer to draw on, or add one in Layers.</p>
        )}
        <ToolOptionsView tool={tool} o={o} set={set} />
      </Section>

      <Section title="Edit">
        <div className="button-row">
          <button type="button" className="btn btn-small" disabled={active?.kind !== "raster"} onClick={props.onCopy} title="Ctrl C">
            Copy
          </button>
          <button type="button" className="btn btn-small" disabled={active?.kind !== "raster"} onClick={props.onCut} title="Ctrl X">
            Cut
          </button>
          <button type="button" className="btn btn-small" onClick={props.onPaste} title="Ctrl V">
            Paste
          </button>
        </div>
        <div className="button-row">
          <button type="button" className="btn btn-small" onClick={() => doc.selectAll()} title="Ctrl A">
            Select all
          </button>
          <button type="button" className="btn btn-small" disabled={!sel} onClick={() => doc.setSelection(null)} title="Ctrl D">
            Deselect
          </button>
          <button type="button" className="btn btn-small" disabled={active?.kind !== "raster"} onClick={() => doc.clearSelection()} title="Delete">
            {sel ? "Clear selection" : "Clear layer"}
          </button>
        </div>
        <label className="btn btn-secondary btn-wide add-image">
          Add an image…
          <input
            type="file"
            accept="image/*,.svg"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (file) props.onAddImage(file);
            }}
          />
        </label>
        <p className="hint">Or paste (Ctrl V) or drop an image on the canvas. SVG code pastes as a vector layer.</p>
      </Section>

      <Fold title="Canvas" defaultOpen={false}>
        <Segmented
          label="Background"
          value={doc.background === null ? "none" : doc.background.toUpperCase() === "#FFFFFF" ? "white" : "color"}
          options={[
            { value: "white", label: "White" },
            { value: "color", label: "Colour" },
            { value: "none", label: "Transparent" },
          ]}
          onChange={(v) => doc.setBackground(v === "white" ? "#FFFFFF" : v === "none" ? null : o.color2 && o.color2.toUpperCase() !== "#FFFFFF" ? o.color2 : "#E6E6E6")}
        />
        {doc.background !== null && doc.background.toUpperCase() !== "#FFFFFF" && <ColorPicker label="Background colour" value={doc.background} onChange={(c) => doc.setBackground(c)} />}
        <div className="field-label">Size in pixels</div>
        <CanvasSize doc={doc} />
        <p className="hint">Changing the size keeps the drawing centred; anything outside is cut off. Undo brings it back.</p>
      </Fold>

      <Fold title="Shortcuts" defaultOpen={false}>
        <ul className="tips shortcuts">
          {TOOLS.map((x) => (
            <li key={x.id}>
              <kbd>{x.key}</kbd> {x.label}
            </li>
          ))}
          <li>
            <kbd>[</kbd> <kbd>]</kbd> Smaller, bigger
          </li>
          <li>
            <kbd>X</kbd> Swap colours
          </li>
          <li>
            <kbd>Space</kbd> Hold to pan
          </li>
          <li>
            <kbd>Ctrl Z</kbd> Undo, <kbd>Ctrl Shift Z</kbd> Redo
          </li>
          <li>
            <kbd>Ctrl A</kbd> Select all, <kbd>Ctrl D</kbd> Deselect
          </li>
          <li>
            <kbd>Ctrl C</kbd> <kbd>Ctrl X</kbd> <kbd>Ctrl V</kbd> Copy, cut, paste
          </li>
          <li>
            <kbd>Ctrl J</kbd> Duplicate layer
          </li>
          <li>
            <kbd>Ctrl 0</kbd> Fit, <kbd>Ctrl 1</kbd> 100%
          </li>
        </ul>
        <p className="hint">On a Mac, use ⌘ for Ctrl.</p>
      </Fold>
    </>
  );
}
