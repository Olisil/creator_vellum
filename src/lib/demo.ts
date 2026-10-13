import { saveProject } from "./db";
import { canvasToBlob, ctx2d, makeCanvas } from "./raster";
import { newProject, newRasterLayer, type Project } from "./types";

/**
 * The example project: a small seaside sketch in two pixel layers (flat colour and hand-drawn
 * ink), drawn here so the app ships no image files. Ready to trace.
 */

// a fixed pseudo-random sequence, so the example looks the same every time
function rng(seed: number) {
  return () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
}

type P = [number, number];

/** A wobbly line through points, like a felt pen. */
function inkLine(ctx: CanvasRenderingContext2D, pts: P[], width: number, rand: () => number, closed = false) {
  const wob = (v: number) => v + (rand() - 0.5) * width * 0.5;
  const list = closed ? [...pts, pts[0], pts[1]] : pts;
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.moveTo(wob(list[0][0]), wob(list[0][1]));
  for (let i = 1; i < list.length - 1; i++) {
    const [x, y] = list[i];
    const [nx, ny] = list[i + 1];
    ctx.quadraticCurveTo(wob(x), wob(y), (x + nx) / 2, (y + ny) / 2);
  }
  const [lx, ly] = list[list.length - 1];
  ctx.lineTo(wob(lx), wob(ly));
  ctx.stroke();
}

function circlePts(cx: number, cy: number, r: number, n = 24): P[] {
  return Array.from({ length: n }, (_, i) => [cx + Math.cos((i / n) * Math.PI * 2) * r, cy + Math.sin((i / n) * Math.PI * 2) * r]);
}

function hill(x0: number, x1: number, base: number, top: number, n = 10): P[] {
  return Array.from({ length: n + 1 }, (_, i) => {
    const t = i / n;
    return [x0 + (x1 - x0) * t, base - Math.sin(t * Math.PI) * (base - top)];
  });
}

function fillPoly(ctx: CanvasRenderingContext2D, pts: P[], color: string) {
  ctx.fillStyle = color;
  ctx.beginPath();
  pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  ctx.closePath();
  ctx.fill();
}

export async function createDemo(): Promise<Project> {
  const W = 1600;
  const H = 1200;
  const p = newProject("Example: seaside", W, H);
  const colour = { ...newRasterLayer("Colour"), id: p.layers[0].id };
  const ink = newRasterLayer("Ink");
  p.layers = [colour, ink];
  p.activeId = ink.id;

  // ---- flat colour
  const c = makeCanvas(W, H);
  const cc = ctx2d(c);
  cc.fillStyle = "#F0592B";
  cc.beginPath();
  cc.arc(1140, 400, 170, 0, Math.PI * 2);
  cc.fill();
  fillPoly(cc, [...hill(-40, 820, 820, 470), [820, 900], [-40, 900]], "#004242");
  fillPoly(cc, [...hill(420, 1300, 820, 560), [1300, 900], [420, 900]], "#BAD70A");
  cc.fillStyle = "#0ABED7";
  cc.fillRect(0, 800, W, H - 800);
  // boat
  fillPoly(
    cc,
    [
      [560, 900],
      [900, 900],
      [850, 970],
      [610, 970],
    ],
    "#0E0E0E",
  );
  fillPoly(
    cc,
    [
      [720, 560],
      [720, 880],
      [890, 880],
    ],
    "#E6E6E6",
  );
  fillPoly(
    cc,
    [
      [700, 620],
      [700, 880],
      [590, 880],
    ],
    "#C5A11F",
  );

  // ---- ink
  const k = makeCanvas(W, H);
  const kc = ctx2d(k);
  const rand = rng(7);
  kc.strokeStyle = "#0E0E0E";
  kc.lineCap = "round";
  kc.lineJoin = "round";
  inkLine(kc, circlePts(1140, 400, 170), 9, rand, true);
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2 + 0.2;
    inkLine(
      kc,
      [
        [1140 + Math.cos(a) * 205, 400 + Math.sin(a) * 205],
        [1140 + Math.cos(a) * 250, 400 + Math.sin(a) * 250],
      ],
      8,
      rand,
    );
  }
  inkLine(kc, hill(-40, 820, 820, 470), 9, rand);
  inkLine(kc, hill(420, 1300, 820, 560), 9, rand);
  inkLine(
    kc,
    [
      [0, 800],
      [W, 800],
    ],
    7,
    rand,
  );
  inkLine(
    kc,
    [
      [560, 900],
      [900, 900],
      [850, 970],
      [610, 970],
    ],
    9,
    rand,
    true,
  );
  inkLine(
    kc,
    [
      [710, 540],
      [710, 900],
    ],
    9,
    rand,
  );
  // waves
  for (const [y, x0] of [
    [1010, 120],
    [1080, 900],
    [1140, 300],
    [1040, 1240],
  ] as P[]) {
    const pts: P[] = [];
    for (let i = 0; i <= 8; i++) pts.push([x0 + i * 40, y + (i % 2 ? -18 : 12)]);
    inkLine(kc, pts, 7, rand);
  }
  // birds
  for (const [x, y, s] of [
    [300, 260, 1],
    [420, 200, 0.8],
    [520, 300, 0.7],
  ] as [number, number, number][]) {
    inkLine(
      kc,
      [
        [x - 50 * s, y],
        [x - 25 * s, y - 25 * s],
        [x, y],
        [x + 25 * s, y - 25 * s],
        [x + 50 * s, y],
      ],
      7,
      rand,
    );
  }

  const bitmaps = new Map<string, Blob>([
    [colour.id, await canvasToBlob(c)],
    [ink.id, await canvasToBlob(k)],
  ]);
  const thumb = makeCanvas(480, 360);
  const tc = ctx2d(thumb);
  tc.fillStyle = "#FFFFFF";
  tc.fillRect(0, 0, 480, 360);
  tc.drawImage(c, 0, 0, 480, 360);
  tc.drawImage(k, 0, 0, 480, 360);
  await saveProject(p, bitmaps, await canvasToBlob(thumb));
  return p;
}
