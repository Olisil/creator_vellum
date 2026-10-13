import type { Doc } from "../lib/doc";
import { TOOLS, type ToolId, type ToolOptions } from "../lib/tools";
import { icons } from "./Icons";

const GROUPS: ToolId[][] = [
  ["brush", "pencil", "eraser", "fill"],
  ["line", "rect", "ellipse", "picker"],
  ["select", "lasso", "wand", "move"],
  ["hand"],
];

/** The tool column over the canvas: tools, the two colours, undo and redo. */
export function ToolPalette(props: { doc: Doc; tool: ToolId; setTool: (t: ToolId) => void; options: ToolOptions; onSwap: () => void }) {
  const { doc } = props;
  return (
    <div className="tool-palette" role="toolbar" aria-label="Tools" aria-orientation="vertical">
      {GROUPS.map((g, i) => (
        <div key={i} className="tool-group">
          {g.map((id) => {
            const t = TOOLS.find((x) => x.id === id)!;
            return (
              <button
                key={id}
                type="button"
                className={`tool${props.tool === id ? " on" : ""}`}
                aria-label={`${t.label} (${t.key})`}
                aria-pressed={props.tool === id}
                title={`${t.label} (${t.key})`}
                onClick={() => props.setTool(id)}
              >
                {icons[id]}
              </button>
            );
          })}
        </div>
      ))}
      <div className="tool-colors">
        <span className="swatch swatch-1" style={{ background: props.options.color }} title={`Colour ${props.options.color}`} />
        <span className="swatch swatch-2" style={{ background: props.options.color2 }} title={`Second colour ${props.options.color2}`} />
        <button type="button" className="swap" aria-label="Swap colours (X)" title="Swap colours (X)" onClick={props.onSwap}>
          {icons.swap}
        </button>
      </div>
      <div className="tool-group">
        <button type="button" className="tool" aria-label="Undo" title={doc.undoLabel ? `Undo ${doc.undoLabel.toLowerCase()} (Ctrl Z)` : "Undo (Ctrl Z)"} disabled={!doc.canUndo && !doc.floating} onClick={() => doc.undo()}>
          {icons.undo}
        </button>
        <button type="button" className="tool" aria-label="Redo" title="Redo (Ctrl Shift Z)" disabled={!doc.canRedo || !!doc.floating} onClick={() => doc.redo()}>
          {icons.redo}
        </button>
      </div>
    </div>
  );
}
