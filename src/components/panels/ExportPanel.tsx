import { useMemo, useState } from "react";
import type { Doc } from "../../lib/doc";
import { buildSvg, copyPng, copySvg, exportPdf, exportPng, exportSvg, hasVectors, type ExportScope } from "../../lib/exporter";
import { downloadProjectFile } from "../../lib/files";
import { Field, Section, Segmented, Toggle } from "../Controls";
import { icons } from "../Icons";

function kb(n: number) {
  return n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function ExportPanel({ doc, version, onNotice, onVectorize }: { doc: Doc; version: number; onNotice: (m: string) => void; onVectorize: () => void }) {
  const [scope, setScope] = useState<ExportScope>("vectors");
  const [bg, setBg] = useState(false);
  const [scale, setScale] = useState(1);
  const [busy, setBusy] = useState<string | null>(null);

  const vectors = doc.layers.filter((l) => l.kind === "vector");
  const ready = scope === "vectors" ? hasVectors(doc, "vectors") : scope === "active" ? !!doc.active : true;
  const activeIsVector = doc.active?.kind === "vector";
  const svgSize = useMemo(() => (scope === "all" || !ready ? null : new Blob([buildSvg(doc, scope, bg)]).size), [doc, scope, bg, ready, version]);
  const stats = vectors
    .filter((l) => (scope === "active" ? l.id === doc.activeId : l.visible))
    .reduce((a, l) => ({ paths: a.paths + (l.stats?.paths ?? 0), points: a.points + (l.stats?.points ?? 0) }), { paths: 0, points: 0 });

  const run = async (label: string, fn: () => Promise<void> | void, done?: string) => {
    setBusy(label);
    try {
      doc.commitFloating();
      await fn();
      if (done) onNotice(done);
    } catch (e) {
      onNotice(`${label} didn't work: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <div className="panel-intro">
        <h2>Export</h2>
        <p>Copy straight into Figma, or download SVG, PDF or PNG. Each layer keeps its name as a group.</p>
      </div>

      <Section title="What">
        <Segmented
          label="What to export"
          value={scope}
          options={[
            { value: "vectors", label: "Vector layers" },
            { value: "active", label: "Active layer" },
            { value: "all", label: "Everything" },
          ]}
          onChange={setScope}
        />
        <p className="hint">
          {scope === "vectors"
            ? "The visible vector layers only."
            : scope === "active"
              ? `Only ${doc.active?.name ?? "the active layer"}${activeIsVector ? "" : " (a pixel layer, exported as an image)"}.`
              : "All visible layers; pixel layers come along as images."}
        </p>
        <Toggle label="Include background" hint={doc.background ? "A rectangle in the canvas colour, behind everything." : "The canvas is transparent."} checked={bg && !!doc.background} disabled={!doc.background} onChange={setBg} />
        {scope === "vectors" && !ready && (
          <div className="callout">
            <p>Nothing traced yet. Trace your sketch first, then keep the result as a vector layer.</p>
            <button type="button" className="btn btn-small" onClick={onVectorize}>
              Go to Vectorize
            </button>
          </div>
        )}
        {ready && scope !== "all" && (
          <p className="export-facts">
            {stats.paths > 0 && (
              <>
                {stats.paths.toLocaleString("en")} paths · {stats.points.toLocaleString("en")} points ·{" "}
              </>
            )}
            {svgSize !== null && `${kb(svgSize)} SVG`} · {doc.width} × {doc.height} px
          </p>
        )}
      </Section>

      <Section title="Figma">
        <button
          type="button"
          className="btn btn-primary btn-wide"
          disabled={!ready || !!busy}
          onClick={() => run("Copy for Figma", () => copySvg(buildSvg(doc, scope, bg)), "Copied. In Figma, paste with Ctrl V (⌘ V): it arrives as editable vectors.")}
        >
          {icons.copy} Copy for Figma
        </button>
        <p className="hint">Pastes as a frame of editable vector layers, named like your layers. Works in Illustrator, Affinity and Inkscape too.</p>
      </Section>

      <Section title="Download">
        <div className="export-grid">
          <button type="button" className="btn" disabled={!ready || !!busy} onClick={() => run("SVG", () => exportSvg(doc, scope, bg))}>
            SVG
          </button>
          <button type="button" className="btn" disabled={!ready || !!busy} onClick={() => run("PDF", () => exportPdf(doc, scope, bg))}>
            {busy === "PDF" ? "Making PDF…" : "PDF"}
          </button>
          <button type="button" className="btn" disabled={!ready || !!busy} onClick={() => run("PNG", () => exportPng(doc, scope, scale, bg))}>
            {busy === "PNG" ? "Making PNG…" : "PNG"}
          </button>
        </div>
        <Field label="PNG size">
          <Segmented
            label="PNG size"
            value={scale}
            options={[
              { value: 0.5, label: "½×" },
              { value: 1, label: "1×" },
              { value: 2, label: "2×" },
              { value: 4, label: "4×" },
            ]}
            onChange={setScale}
          />
        </Field>
        <p className="hint">
          PNG at {Math.round(doc.width * scale)} × {Math.round(doc.height * scale)} px{bg && doc.background ? "" : ", transparent where nothing is drawn"}.
        </p>
      </Section>

      <Section title="Clipboard">
        <div className="button-row">
          <button type="button" className="btn btn-small" disabled={!ready || !!busy} onClick={() => run("Copy SVG code", () => copySvg(buildSvg(doc, scope, bg)), "SVG code copied.")}>
            Copy SVG code
          </button>
          <button
            type="button"
            className="btn btn-small"
            disabled={!ready || !!busy}
            onClick={() =>
              run(
                "Copy PNG",
                async () => copyPng(await doc.composite({ vectors: true, background: bg, only: scope === "active" ? [doc.activeId] : scope === "vectors" ? vectors.filter((l) => l.visible).map((l) => l.id) : undefined })),
                "Image copied.",
              )
            }
          >
            Copy as image
          </button>
        </div>
      </Section>

      <Section title="Project">
        <button type="button" className="btn btn-small" onClick={() => downloadProjectFile(doc)}>
          Download project file
        </button>
        <p className="hint">All layers, pixels and trace settings in one .vellum.json file, to open on another computer or keep as a backup.</p>
      </Section>
    </>
  );
}
