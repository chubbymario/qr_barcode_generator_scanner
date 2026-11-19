// zxing-cpp only reads MaxiCode from "pure" images: an upright symbol on a
// blank background, as a generator draws it. To read one in a photo, this
// finds the bullseye in the middle of the symbol, straightens the hexagon
// grid, and cuts out a clean black-and-white copy for zxing-cpp to decode
// (with its own error correction).

import { rotateBy, skewAngle, type Luma } from './extra/lines';

function otsuOf(l: Luma): number {
  const hist = new Float64Array(256);
  const step = Math.max(1, Math.floor((l.width * l.height) / 200000));
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

/** Runs of one colour along a line: [start, length, dark]. */
function runs(get: (i: number) => boolean, n: number): [number, number, boolean][] {
  const out: [number, number, boolean][] = [];
  let start = 0;
  let cur = get(0);
  for (let i = 1; i <= n; i++) {
    const v = i < n ? get(i) : !cur;
    if (v !== cur) {
      out.push([start, i - start, cur]);
      start = i;
      cur = v;
    }
  }
  return out;
}

/**
 * The bullseye seen along a line: 3 dark rings each side of a light centre,
 * so 11 runs (dark, light, dark, light, dark, centre, dark, light, dark,
 * light, dark) of about equal width. Returns the centre and the span.
 */
function bullseyeAt(
  r: [number, number, boolean][],
  k: number,
): { mid: number; span: number } | null {
  if (k + 11 > r.length || !r[k][2]) return null;
  const seq = r.slice(k, k + 11);
  const rings = [...seq.slice(0, 5), ...seq.slice(6)].map((x) => x[1]);
  const w = [...rings].sort((a, b) => a - b)[5];
  if (w < 1.5) return null;
  if (rings.some((x) => x < w * 0.5 || x > w * 1.8)) return null;
  const centre = seq[5][1];
  if (centre < w * 0.5 || centre > w * 3.5) return null;
  const left = seq.slice(0, 5).reduce((a, x) => a + x[1], 0);
  const right = seq.slice(6).reduce((a, x) => a + x[1], 0);
  if (Math.abs(left - right) > 0.25 * (left + right)) return null;
  return { mid: seq[5][0] + centre / 2, span: left + right + centre };
}

interface Bullseye {
  x: number;
  y: number;
  span: number;
}

export function findBullseyes(l: Luma): Bullseye[] {
  const t = otsuOf(l);
  const dark = (x: number, y: number) => l.data[y * l.width + x] < t;
  const hits: Bullseye[] = [];
  for (let y = 0; y < l.height; y += 2) {
    const r = runs((x) => dark(x, y), l.width);
    for (let k = 0; k + 11 <= r.length; k++) {
      const h = bullseyeAt(r, k);
      if (!h) continue;
      const x = Math.round(h.mid);
      // Same pattern straight down through the centre.
      const c = runs((yy) => dark(x, yy), l.height);
      const at = c.findIndex(([s, n]) => y >= s && y < s + n);
      const v = at >= 5 ? bullseyeAt(c, at - 5) : null;
      if (!v || Math.abs(v.span - h.span) > 0.3 * h.span) continue;
      hits.push({ x: h.mid, y: v.mid, span: (h.span + v.span) / 2 });
    }
  }
  // Group hits from neighbouring rows into one bullseye each.
  const groups: Bullseye[][] = [];
  for (const b of hits) {
    const g = groups.find((g) => Math.hypot(g[0].x - b.x, g[0].y - b.y) < g[0].span / 2);
    if (g) g.push(b);
    else groups.push([b]);
  }
  return groups
    .filter((g) => g.length >= 2)
    .map((g) => ({
      x: g.reduce((a, b) => a + b.x, 0) / g.length,
      y: g.reduce((a, b) => a + b.y, 0) / g.length,
      span: g.reduce((a, b) => a + b.span, 0) / g.length,
    }));
}

function cropLuma(l: Luma, x0: number, y0: number, w: number, h: number): Luma {
  const out = new Uint8Array(w * h).fill(255);
  for (let y = 0; y < h; y++) {
    const sy = y0 + y;
    if (sy < 0 || sy >= l.height) continue;
    for (let x = 0; x < w; x++) {
      const sx = x0 + x;
      if (sx >= 0 && sx < l.width) out[y * w + x] = l.data[sy * l.width + sx];
    }
  }
  return { data: out, width: w, height: h };
}

/**
 * Clean, upright black-and-white cut-outs of each MaxiCode-like symbol,
 * as RGBA image data for zxing-cpp. Several per symbol (grid straightened
 * at each of the angles a hexagon grid allows).
 */
export function maxiCodeCandidates(
  l: Luma,
): { data: Uint8ClampedArray; width: number; height: number }[] {
  const out: { data: Uint8ClampedArray; width: number; height: number }[] = [];
  for (const b of findBullseyes(l).slice(0, 3)) {
    // The whole symbol is about 3.3 bullseyes wide; take a generous square.
    const half = Math.round(b.span * 2.3);
    const win = cropLuma(l, Math.round(b.x - half), Math.round(b.y - half), half * 2, half * 2);
    // Hexagon edges repeat every 60°, so measure the tilt with 6-fold symmetry.
    const a = skewAngle(win, 6);
    for (const turn of [a, a + 60, a - 60]) {
      const upright = Math.abs(turn) < 0.5 ? win : rotateBy(win, turn);
      const t = otsuOf(upright);
      // Bounding box of dark pixels near the bullseye (the symbol itself).
      const reach = b.span * 1.85;
      let x0 = Infinity;
      let y0 = Infinity;
      let x1 = -1;
      let y1 = -1;
      for (let y = 0; y < upright.height; y++)
        for (let x = 0; x < upright.width; x++) {
          if (Math.abs(x - half) > reach || Math.abs(y - half) > reach) continue;
          if (upright.data[y * upright.width + x] >= t) continue;
          if (x < x0) x0 = x;
          if (x > x1) x1 = x;
          if (y < y0) y0 = y;
          if (y > y1) y1 = y;
        }
      if (x1 < 0) continue;
      const w = x1 - x0 + 1;
      const h = y1 - y0 + 1;
      // MaxiCode is very nearly square; a lopsided box means a wrong turn.
      if (w / h > 1.35 || h / w > 1.35) continue;
      const pad = Math.round(Math.max(w, h) * 0.1);
      const W = w + pad * 2;
      const H = h + pad * 2;
      const data = new Uint8ClampedArray(W * H * 4).fill(255);
      for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++) {
          const v = upright.data[(y0 + y) * upright.width + x0 + x] < t ? 0 : 255;
          const i = ((y + pad) * W + x + pad) * 4;
          data[i] = data[i + 1] = data[i + 2] = v;
        }
      out.push({ data, width: W, height: H });
    }
  }
  return out;
}
