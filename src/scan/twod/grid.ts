// Shared image helpers for the app's own 2D readers: a threshold, dark runs,
// and sampling a regular grid of modules.

import type { Luma } from '../extra/lines';

/** Otsu threshold of the whole image (sampled). */
export function otsu(l: Luma): number {
  const hist = new Float64Array(256);
  const step = Math.max(1, Math.floor((l.width * l.height) / 250000));
  let n = 0;
  for (let i = 0; i < l.data.length; i += step) {
    hist[l.data[i]]++;
    n++;
  }
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * hist[i];
  let sumB = 0;
  let wB = 0;
  let best = 0;
  let t = 128;
  for (let i = 0; i < 256; i++) {
    wB += hist[i];
    if (!wB) continue;
    const wF = n - wB;
    if (!wF) break;
    sumB += i * hist[i];
    const between = wB * wF * (sumB / wB - (sum - sumB) / wF) ** 2;
    if (between > best) {
      best = between;
      t = i + 0.5;
    }
  }
  return t;
}

/** Mean of the pixels within `r` of (x, y) (bilinear centre). */
export function sampleAt(l: Luma, x: number, y: number, r: number): number {
  let s = 0;
  let n = 0;
  const x0 = Math.floor(x - r);
  const x1 = Math.ceil(x + r);
  const y0 = Math.floor(y - r);
  const y1 = Math.ceil(y + r);
  for (let yy = y0; yy <= y1; yy++) {
    if (yy < 0 || yy >= l.height) continue;
    for (let xx = x0; xx <= x1; xx++) {
      if (xx < 0 || xx >= l.width) continue;
      s += l.data[yy * l.width + xx];
      n++;
    }
  }
  return n ? s / n : 255;
}

/**
 * Sample a rows × cols grid whose module (0,0) centre is at (x0, y0), with
 * module size mx × my. Returns 1 for dark. The threshold is set from the
 * samples themselves (midway between the dark and light clusters).
 */
export function sampleGrid(
  l: Luma,
  x0: number,
  y0: number,
  mx: number,
  my: number,
  rows: number,
  cols: number,
): Uint8Array {
  const r = Math.max(0, Math.min(mx, my) * 0.22);
  const vals = new Float32Array(rows * cols);
  for (let y = 0; y < rows; y++)
    for (let x = 0; x < cols; x++) vals[y * cols + x] = sampleAt(l, x0 + x * mx, y0 + y * my, r);
  const sorted = Array.from(vals).sort((a, b) => a - b);
  const lo = sorted[Math.floor(sorted.length * 0.05)];
  const hi = sorted[Math.floor(sorted.length * 0.95)];
  const t = (lo + hi) / 2;
  const out = new Uint8Array(rows * cols);
  for (let i = 0; i < vals.length; i++) out[i] = vals[i] < t ? 1 : 0;
  return out;
}

export interface Run {
  y: number;
  x0: number;
  x1: number; // exclusive
}

/** Horizontal dark runs of at least `min` pixels. */
export function darkRuns(l: Luma, t: number, min: number): Run[] {
  const out: Run[] = [];
  for (let y = 0; y < l.height; y++) {
    let start = -1;
    const row = y * l.width;
    for (let x = 0; x <= l.width; x++) {
      const d = x < l.width && l.data[row + x] < t;
      if (d && start < 0) start = x;
      else if (!d && start >= 0) {
        if (x - start >= min) out.push({ y, x0: start, x1: x });
        start = -1;
      }
    }
  }
  return out;
}

/** Runs stacked on consecutive rows with (nearly) the same ends: a bar. */
export interface Bar {
  x0: number;
  x1: number;
  y0: number;
  y1: number; // inclusive
}

export function barsFrom(runs: Run[], tol = 2): Bar[] {
  const open: Bar[] = [];
  const done: Bar[] = [];
  let lastY = -1;
  for (const r of runs) {
    if (r.y !== lastY) {
      // Close bars that didn't continue onto this row.
      for (let i = open.length - 1; i >= 0; i--)
        if (open[i].y1 < r.y - 1) done.push(...open.splice(i, 1));
      lastY = r.y;
    }
    const b = open.find(
      (o) => o.y1 === r.y - 1 && Math.abs(o.x0 - r.x0) <= tol && Math.abs(o.x1 - r.x1) <= tol,
    );
    if (b) b.y1 = r.y;
    else open.push({ x0: r.x0, x1: r.x1, y0: r.y, y1: r.y });
  }
  return [...done, ...open];
}
