/** Small SVG path reader: bounding box and point count of a `d` string (control points included). */

export interface PathInfo {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  points: number;
}

const ARGS: Record<string, number> = { m: 2, l: 2, h: 1, v: 1, c: 6, s: 4, q: 4, t: 2, a: 7, z: 0 };

export function pathInfo(d: string): PathInfo {
  const info: PathInfo = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity, points: 0 };
  const tokens = d.match(/[a-zA-Z]|[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?/g) ?? [];
  let i = 0;
  let cmd = "";
  let x = 0,
    y = 0,
    sx = 0,
    sy = 0;
  const add = (px: number, py: number) => {
    if (px < info.x0) info.x0 = px;
    if (px > info.x1) info.x1 = px;
    if (py < info.y0) info.y0 = py;
    if (py > info.y1) info.y1 = py;
  };
  const num = () => parseFloat(tokens[i++]);
  while (i < tokens.length) {
    const t = tokens[i];
    if (/[a-zA-Z]/.test(t)) {
      cmd = t;
      i++;
      if (cmd === "z" || cmd === "Z") {
        x = sx;
        y = sy;
        continue;
      }
    } else if (!cmd) {
      i++;
      continue;
    }
    const lc = cmd.toLowerCase();
    const rel = cmd === lc;
    const n = ARGS[lc];
    if (n === undefined || n === 0 || i + n > tokens.length) {
      i++;
      continue;
    }
    if (lc === "h") {
      x = rel ? x + num() : num();
      add(x, y);
    } else if (lc === "v") {
      y = rel ? y + num() : num();
      add(x, y);
    } else if (lc === "a") {
      i += 5;
      const nx = num(),
        ny = num();
      x = rel ? x + nx : nx;
      y = rel ? y + ny : ny;
      add(x, y);
    } else {
      const vals: number[] = [];
      for (let k = 0; k < n; k++) vals.push(num());
      for (let k = 0; k < n; k += 2) add(rel ? x + vals[k] : vals[k], rel ? y + vals[k + 1] : vals[k + 1]);
      x = rel ? x + vals[n - 2] : vals[n - 2];
      y = rel ? y + vals[n - 1] : vals[n - 1];
      if (lc === "m") {
        sx = x;
        sy = y;
        // further pairs after a moveto are linetos
        cmd = rel ? "l" : "L";
      }
    }
    info.points++;
  }
  if (!isFinite(info.x0)) info.x0 = info.y0 = info.x1 = info.y1 = 0;
  return info;
}
