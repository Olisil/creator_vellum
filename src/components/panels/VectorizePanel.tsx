import { useState } from "react";
import type { Doc } from "../../lib/doc";
import type { TraceResult } from "../../lib/tracer";
import { DEFAULT_TRACE, PRESETS, uid, type TracePreset, type TraceSettings } from "../../lib/types";
import type { ViewMode } from "../Stage";
import { ColorPicker, Field, Fold, Section, Segmented, Slider, Toggle } from "../Controls";

const PRESET_KEY = "creator-vellum:presets:v1";

function loadPresets(): TracePreset[] {
  try {
    const v = JSON.parse(localStorage.getItem(PRESET_KEY) || "[]");
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}
function savePresets(list: TracePreset[]) {
  try {
    localStorage.setItem(PRESET_KEY, JSON.stringify(list));
  } catch {
    /* presets are a convenience only */
  }
}

function matches(s: TraceSettings, p: Partial<TraceSettings>) {
  return (Object.keys(p) as (keyof TraceSettings)[]).every((k) => s[k] === p[k]);
}

const plural = (n: number, word: string) => `${n.toLocaleString("en")} ${word}${n === 1 ? "" : "s"}`;

export type TraceStatus = { state: "idle" } | { state: "tracing" } | { state: "done"; result: TraceResult } | { state: "error"; message: string };

export function VectorizePanel(props: {
  doc: Doc;
  set: (patch: Partial<TraceSettings>) => void;
  status: TraceStatus;
  live: boolean;
  setLive: (v: boolean) => void;
  onTrace: () => void;
  view: ViewMode;
  setView: (v: ViewMode) => void;
  sourceOpacity: number;
  setSourceOpacity: (v: number) => void;
}) {
  const { doc, set } = props;
  const s = doc.trace;
  const [mine, setMine] = useState<TracePreset[]>(loadPresets);
  const [naming, setNaming] = useState<string | null>(null);
  const vt = s.engine === "vtracer";
  const bw = s.colorMode === "bw";
  const usePreset = (p: Partial<TraceSettings>) => set({ ...DEFAULT_TRACE, ...p, scope: s.scope });

  const status = props.status;
  return (
    <>
      <div className="panel-intro">
        <h2>Vectorize</h2>
        <p>Turn the pixels into clean vector shapes. Start from a preset, then fine-tune; the canvas shows the result as you go.</p>
      </div>

      <Section title="Preset">
        <div className="preset-grid">
          {[...PRESETS, ...mine].map((p) => (
            <button key={p.id} type="button" className={`preset${matches(s, p.settings) ? " on" : ""}`} onClick={() => usePreset(p.settings)} title={p.hint}>
              <span className="preset-name">{p.name}</span>
              <span className="preset-hint">{p.hint}</span>
              {mine.includes(p) && (
                <span
                  role="button"
                  tabIndex={0}
                  className="preset-remove"
                  aria-label={`Remove preset ${p.name}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    const next = mine.filter((x) => x.id !== p.id);
                    setMine(next);
                    savePresets(next);
                  }}
                >
                  ×
                </span>
              )}
            </button>
          ))}
        </div>
        {naming === null ? (
          <div className="button-row">
            <button type="button" className="btn btn-small btn-quiet" onClick={() => setNaming("My preset")}>
              Save as preset
            </button>
            <button type="button" className="btn btn-small btn-quiet" onClick={() => usePreset({})}>
              Reset settings
            </button>
          </div>
        ) : (
          <form
            className="size-row"
            onSubmit={(e) => {
              e.preventDefault();
              const name = naming.trim();
              if (!name) return;
              const { scope: _scope, ...settings } = s;
              const next = [...mine, { id: `my-${uid()}`, name, hint: "Your preset", settings }];
              setMine(next);
              savePresets(next);
              setNaming(null);
            }}
          >
            <input className="input" aria-label="Preset name" autoFocus value={naming} onChange={(e) => setNaming(e.target.value)} onKeyDown={(e) => e.key === "Escape" && setNaming(null)} />
            <button type="submit" className="btn btn-small btn-primary">
              Save
            </button>
            <button type="button" className="btn btn-small btn-quiet" onClick={() => setNaming(null)}>
              Cancel
            </button>
          </form>
        )}
      </Section>

      <Section title="Trace">
        <Segmented
          label="What to trace"
          value={s.scope}
          options={[
            { value: "visible", label: "All visible" },
            { value: "layer", label: "This layer" },
            { value: "selection", label: "Selection" },
          ]}
          onChange={(v) => set({ scope: v })}
        />
        <p className="hint">
          {s.scope === "visible"
            ? "All visible pixel layers together, as you see them."
            : s.scope === "layer"
              ? `Only the active layer${doc.active ? ` (${doc.active.name})` : ""}.`
              : doc.selection
                ? "The visible pixels inside the selection."
                : "Make a selection in Sketch first."}
        </p>
        <Field label="Engine">
          <Segmented
            label="Engine"
            value={s.engine}
            options={[
              { value: "vtracer", label: "Precise", hint: "VTracer" },
              { value: "imagetracer", label: "Soft", hint: "ImageTracer" },
            ]}
            onChange={(v) => set({ engine: v })}
          />
        </Field>
      </Section>

      <Fold title="Colours">
        <Segmented
          label="Colour mode"
          value={s.colorMode}
          options={[
            { value: "color", label: "Colour" },
            { value: "bw", label: "Black & white" },
            ...(vt ? [{ value: "regions" as const, label: "Regions" }] : []),
          ]}
          onChange={(v) => set({ colorMode: v })}
        />
        {bw ? (
          <>
            <Slider label="Threshold" value={s.threshold} min={1} max={254} step={1} ends={["Only the darkest", "Lighter marks too"]} onChange={(v) => set({ threshold: v })} />
            {vt && <Toggle label="Adaptive threshold" hint="Follows uneven light, as in photographed paper." checked={s.adaptive} onChange={(v) => set({ adaptive: v })} />}
            <Toggle label="Invert" hint="Trace light marks on a dark ground." checked={s.invert} onChange={(v) => set({ invert: v })} />
            <div className="field-label">Ink colour</div>
            <ColorPicker label="Ink colour" value={s.inkColor} onChange={(c) => set({ inkColor: c })} />
          </>
        ) : s.colorMode === "regions" ? (
          <>
            <Slider label="Detail" value={s.regionDetail} min={8} max={255} step={1} ends={["Big regions", "Fine regions"]} onChange={(v) => set({ regionDetail: v })} />
            <p className="hint">Splits the picture into areas of similar colour, like a paint-by-number.</p>
          </>
        ) : (
          <>
            <Slider label="Colours" value={s.maxColors} min={0} max={vt ? 64 : 64} step={1} format={(v) => (v === 0 ? (vt ? "All" : "16") : String(v))} onChange={(v) => set({ maxColors: v })} />
            {s.maxColors > 0 && <p className="hint">The most used colours that clearly differ are kept; every pixel snaps to the nearest one.</p>}
            {vt && s.maxColors === 0 && (
              <>
                <Slider label="Colour precision" value={s.colorPrecision} min={1} max={8} step={1} ends={["Merge similar", "Keep nuances"]} onChange={(v) => set({ colorPrecision: v })} />
                <Slider label="Gradient step" value={s.layerDifference} min={1} max={128} step={1} ends={["Smooth gradients", "Flat colours"]} onChange={(v) => set({ layerDifference: v })} />
              </>
            )}
            {!vt && (
              <>
                <Segmented
                  label="Colour sampling"
                  value={s.itColorSampling}
                  options={[
                    { value: 2, label: "Deterministic" },
                    { value: 1, label: "Random" },
                    { value: 0, label: "Palette" },
                  ]}
                  onChange={(v) => set({ itColorSampling: v })}
                />
                <Slider label="Colour cycles" value={s.itCycles} min={1} max={10} step={1} onChange={(v) => set({ itCycles: v })} />
                <Slider label="Drop rare colours" value={s.itMinColorRatio} min={0} max={0.2} step={0.005} format={(v) => `${(v * 100).toFixed(1)}%`} onChange={(v) => set({ itMinColorRatio: v })} />
              </>
            )}
          </>
        )}
      </Fold>

      <Fold title="Shapes">
        {vt ? (
          <>
            <Segmented
              label="Curves"
              value={s.curve}
              options={[
                { value: "spline", label: "Smooth" },
                { value: "polygon", label: "Straight" },
                { value: "pixel", label: "Pixels" },
              ]}
              onChange={(v) => set({ curve: v })}
            />
            {!bw && (
              <Segmented
                label="Layering"
                value={s.hierarchical}
                options={[
                  { value: "stacked", label: "Stacked", hint: "Shapes on top of each other" },
                  { value: "cutout", label: "Cut out", hint: "No overlaps" },
                ]}
                onChange={(v) => set({ hierarchical: v })}
              />
            )}
            <Slider label="Ignore specks" value={s.filterSpeckle} min={0} max={64} step={1} format={(v) => (v ? `${v} px` : "Off")} ends={["Keep everything", "Drop small bits"]} onChange={(v) => set({ filterSpeckle: v })} />
            {s.curve === "spline" && (
              <>
                <Slider label="Corners" value={s.cornerThreshold} min={0} max={180} step={1} format={(v) => `${v}°`} ends={["Rounder", "Sharper"]} onChange={(v) => set({ cornerThreshold: v })} />
                <Slider label="Segment length" value={s.lengthThreshold} min={3.5} max={10} step={0.5} ends={["Detailed", "Smooth"]} onChange={(v) => set({ lengthThreshold: v })} />
                <Slider label="Splice angle" value={s.spliceThreshold} min={0} max={180} step={1} format={(v) => `${v}°`} ends={["More curves", "Fewer curves"]} onChange={(v) => set({ spliceThreshold: v })} />
                <Slider label="Refinement" value={s.maxIterations} min={1} max={30} step={1} format={(v) => `${v}×`} onChange={(v) => set({ maxIterations: v })} />
              </>
            )}
          </>
        ) : (
          <>
            <Slider label="Line tolerance" value={s.itLineTolerance} min={0.01} max={10} step={0.01} ends={["Exact", "Straighter"]} onChange={(v) => set({ itLineTolerance: v })} />
            <Slider label="Curve tolerance" value={s.itCurveTolerance} min={0.01} max={10} step={0.01} ends={["Exact", "Rounder"]} onChange={(v) => set({ itCurveTolerance: v })} />
            <Slider label="Ignore small paths" value={s.itPathOmit} min={0} max={64} step={1} format={(v) => (v ? `${v} px` : "Off")} onChange={(v) => set({ itPathOmit: v })} />
            <Toggle label="Keep right angles" checked={s.itRightAngles} onChange={(v) => set({ itRightAngles: v })} />
            <Slider label="Outline" value={s.itStroke} min={0} max={4} step={0.5} format={(v) => (v ? `${v} px` : "None")} onChange={(v) => set({ itStroke: v })} />
          </>
        )}
      </Fold>

      <Fold title="Before tracing" defaultOpen={false}>
        <Slider label="Soften" value={s.blur} min={0} max={8} step={1} format={(v) => (v ? `${v} px` : "Off")} ends={["Sharp", "Softer, smoother shapes"]} onChange={(v) => set({ blur: v })} />
        <Slider
          label="Trace resolution"
          value={s.traceScale}
          min={0.25}
          max={4}
          step={0.25}
          format={(v) => `${Math.round(v * 100)}%`}
          ends={["Faster, simpler", "Finer, slower"]}
          onChange={(v) => set({ traceScale: v })}
        />
      </Fold>

      <Fold title="Clean-up" defaultOpen={false}>
        <Slider label="Simplify" value={s.simplify} min={0} max={5} step={0.1} format={(v) => (v ? v.toFixed(1) : "Off")} ends={["All points", "Fewer points"]} onChange={(v) => set({ simplify: v })} />
        <Slider label="Remove small shapes" value={s.minSize} min={0} max={200} step={1} format={(v) => (v ? `${v} px` : "Off")} onChange={(v) => set({ minSize: v })} />
        <Slider label="Decimals" value={s.pathPrecision} min={0} max={4} step={1} format={(v) => String(v)} ends={["Smaller file", "More exact"]} onChange={(v) => set({ pathPrecision: v })} />
        <Toggle label="Merge shapes of the same colour" hint="One path per colour; tidier layers in Figma." checked={s.merge} onChange={(v) => set({ merge: v })} />
        <Toggle label="Remove a colour" hint="Drop the background or paper colour from the result." checked={s.dropColor !== null} onChange={(v) => set({ dropColor: v ? (doc.background ?? "#FFFFFF") : null })} />
        {s.dropColor !== null && (
          <>
            <ColorPicker label="Colour to remove" value={s.dropColor} onChange={(c) => set({ dropColor: c })} />
            <Slider label="Tolerance" value={s.dropTolerance} min={0} max={128} step={1} onChange={(v) => set({ dropTolerance: v })} />
          </>
        )}
      </Fold>

      <Section title="View">
        <Segmented
          label="View"
          value={props.view}
          options={[
            { value: "overlay", label: "Overlay" },
            { value: "vector", label: "Vectors" },
            { value: "outline", label: "Outlines" },
            { value: "source", label: "Pixels" },
          ]}
          onChange={props.setView}
        />
        {props.view === "overlay" && (
          <Slider label="Pixels underneath" value={props.sourceOpacity} min={0} max={1} step={0.05} format={(v) => `${Math.round(v * 100)}%`} onChange={props.setSourceOpacity} />
        )}
        <Toggle label="Live preview" hint="Traces again whenever you change a setting." checked={props.live} onChange={props.setLive} />
        {!props.live && (
          <button type="button" className="btn btn-small" onClick={props.onTrace} disabled={status.state === "tracing"}>
            Trace now
          </button>
        )}
        <div className="trace-status" role="status" aria-live="polite">
          {status.state === "tracing" && <span className="spinner" aria-hidden />}
          {status.state === "tracing" && "Tracing…"}
          {status.state === "error" && <span className="error-text">{status.message}</span>}
          {status.state === "done" && (
            <span>
              {plural(status.result.stats.paths, "path")} · {plural(status.result.stats.points, "point")} · {plural(status.result.stats.colors, "colour")} ·{" "}
              {status.result.ms < 1000 ? `${Math.round(status.result.ms)} ms` : `${(status.result.ms / 1000).toFixed(1)} s`}
            </span>
          )}
        </div>
      </Section>
    </>
  );
}
