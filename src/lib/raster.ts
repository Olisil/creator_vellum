/** Canvas helpers: creating and copying layers, flood fill, hard-edge stamps, colours. */

export type Rect = { x: number; y: number; w: number; h: number };

export function makeCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
}

export function ctx2d(c: HTMLCanvasElement): CanvasRenderingContext2D {
  return c.getContext("2d", { willReadFrequently: true })!;
}

export function cloneCanvas(src: HTMLCanvasElement): HTMLCanvasElement {
  const c = makeCanvas(src.width, src.height);
  ctx2d(c).drawImage(src, 0, 0);
  return c;
}

export function clampRect(r: Rect, w: number, h: number): Rect | null {
  const x0 = Math.max(0, Math.floor(r.x));
  const y0 = Math.max(0, Math.floor(r.y));
  const x1 = Math.min(w, Math.ceil(r.x + r.w));
  const y1 = Math.min(h, Math.ceil(r.y + r.h));
  if (x1 <= x0 || y1 <= y0) return null;
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

export function unionRect(a: Rect | null, b: Rect | null): Rect | null {
  if (!a) return b;
  if (!b) return a;
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
}

export function hexToRgb(hex: string): [number, number, number] {
  let h = hex.replace("#", "");
  if (h.length === 3) h = h.replace(/./g, "$&$&");
  const n = parseInt(h.slice(0, 6), 16) || 0;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function rgbToHex(r: number, g: number, b: number): string {
  return "#" + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, "0")).join("").toUpperCase();
}

/** Bounding box of the non-transparent pixels, or null when the canvas is empty. */
export function contentBounds(c: HTMLCanvasElement): Rect | null {
  const { width: w, height: h } = c;
  const d = ctx2d(c).getImageData(0, 0, w, h).data;
  let x0 = w,
    y0 = h,
    x1 = -1,
    y1 = -1;
  for (let y = 0; y < h; y++) {
    const row = y * w * 4;
    for (let x = 0; x < w; x++) {
      if (d[row + x * 4 + 3] > 0) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        y1 = y;
      }
    }
  }
  return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

/**
 * Flood fill: which pixels are reached from (sx, sy) within `tolerance` of the start colour.
 * Contiguous uses a scanline fill; otherwise every pixel of a similar colour.
 */
export function floodMask(img: ImageData, sx: number, sy: number, tolerance: number, contiguous: boolean): Uint8Array {
  const { width: w, height: h, data: d } = img;
  const mask = new Uint8Array(w * h);
  if (sx < 0 || sy < 0 || sx >= w || sy >= h) return mask;
  const i0 = (sy * w + sx) * 4;
  const r0 = d[i0],
    g0 = d[i0 + 1],
    b0 = d[i0 + 2],
    a0 = d[i0 + 3];
  const tol = tolerance * tolerance * 4;
  const like = (p: number) => {
    const i = p * 4;
    const a = d[i + 3];
    // transparent pixels match each other whatever their (invisible) colour
    if (a0 === 0 && a === 0) return true;
    const dr = d[i] - r0,
      dg = d[i + 1] - g0,
      db = d[i + 2] - b0,
      da = a - a0;
    return dr * dr + dg * dg + db * db + da * da <= tol;
  };
  if (!contiguous) {
    for (let p = 0; p < w * h; p++) if (like(p)) mask[p] = 1;
    return mask;
  }
  const stack = [sx, sy];
  while (stack.length) {
    const y = stack.pop()!;
    let x = stack.pop()!;
    let p = y * w + x;
    while (x >= 0 && !mask[p] && like(p)) {
      x--;
      p--;
    }
    x++;
    p++;
    let up = false,
      down = false;
    while (x < w && !mask[p] && like(p)) {
      mask[p] = 1;
      if (y > 0) {
        const q = p - w;
        if (!mask[q] && like(q)) {
          if (!up) {
            stack.push(x, y - 1);
            up = true;
          }
        } else up = false;
      }
      if (y < h - 1) {
        const q = p + w;
        if (!mask[q] && like(q)) {
          if (!down) {
            stack.push(x, y + 1);
            down = true;
          }
        } else down = false;
      }
      x++;
      p++;
    }
  }
  return mask;
}

/** Grows a mask by one pixel so fills reach under anti-aliased edges. */
export function growMask(mask: Uint8Array, w: number, h: number): Uint8Array {
  const out = mask.slice();
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const p = y * w + x;
      if (mask[p]) continue;
      if ((x > 0 && mask[p - 1]) || (x < w - 1 && mask[p + 1]) || (y > 0 && mask[p - w]) || (y < h - 1 && mask[p + w])) out[p] = 1;
    }
  return out;
}

export function maskBounds(mask: Uint8Array, w: number, h: number): Rect | null {
  let x0 = w,
    y0 = h,
    x1 = -1,
    y1 = -1;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      if (mask[y * w + x]) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        y1 = y;
      }
  return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

/** A canvas whose alpha is the mask (white where selected). */
export function maskToCanvas(mask: Uint8Array, w: number, h: number): HTMLCanvasElement {
  const c = makeCanvas(w, h);
  const ctx = ctx2d(c);
  const img = ctx.createImageData(w, h);
  for (let p = 0; p < w * h; p++) if (mask[p]) img.data.set([255, 255, 255, 255], p * 4);
  ctx.putImageData(img, 0, 0);
  return c;
}

/** Hard-edged round (or square) stamp for the pencil and pixel eraser. */
export function pixelStamp(size: number, color: string, square: boolean): HTMLCanvasElement {
  const s = Math.max(1, Math.round(size));
  const c = makeCanvas(s, s);
  const ctx = ctx2d(c);
  ctx.fillStyle = color;
  if (square || s <= 2) {
    ctx.fillRect(0, 0, s, s);
    return c;
  }
  const r = s / 2;
  for (let y = 0; y < s; y++)
    for (let x = 0; x < s; x++) {
      const dx = x + 0.5 - r,
        dy = y + 0.5 - r;
      if (dx * dx + dy * dy <= r * r) ctx.fillRect(x, y, 1, 1);
    }
  return c;
}

/** Makes anti-aliased edges hard: alpha below half goes, the rest becomes opaque. */
export function hardenAlpha(c: HTMLCanvasElement, r: Rect) {
  const rr = clampRect(r, c.width, c.height);
  if (!rr) return;
  const ctx = ctx2d(c);
  const img = ctx.getImageData(rr.x, rr.y, rr.w, rr.h);
  const d = img.data;
  for (let i = 3; i < d.length; i += 4) d[i] = d[i] >= 128 ? 255 : 0;
  ctx.putImageData(img, rr.x, rr.y);
}

/** Every pixel on the line from a to b (Bresenham), for gap-free hard-edged strokes. */
export function linePixels(ax: number, ay: number, bx: number, by: number, visit: (x: number, y: number) => void) {
  let x0 = Math.floor(ax),
    y0 = Math.floor(ay);
  const x1 = Math.floor(bx),
    y1 = Math.floor(by);
  const dx = Math.abs(x1 - x0),
    dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1,
    sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  for (;;) {
    visit(x0, y0);
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x0 += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y0 += sy;
    }
  }
}

export function canvasToBlob(c: HTMLCanvasElement, type = "image/png", quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => c.toBlob((b) => (b ? resolve(b) : reject(new Error("Couldn't encode the image"))), type, quality));
}

export async function blobToCanvas(b: Blob, w?: number, h?: number): Promise<HTMLCanvasElement> {
  const bmp = await createImageBitmap(b);
  const c = makeCanvas(w ?? bmp.width, h ?? bmp.height);
  ctx2d(c).drawImage(bmp, 0, 0);
  bmp.close();
  return c;
}

export function loadImageFile(file: Blob): Promise<HTMLCanvasElement> {
  return blobToCanvas(file);
}
