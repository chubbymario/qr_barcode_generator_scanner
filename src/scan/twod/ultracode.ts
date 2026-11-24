// Ultracode (AIM ISS Ultracode): colour tiles of five cells in a column.
// The layout, tile values and Reed-Solomon code over GF(283) mirror BWIPP's
// encoder (bwip-js), which draws this app's codes: one codeword per byte.

import { primeField, rsCorrect } from './rs';
import { bytesToText } from './text';

const GF283 = primeField(283, 3);

// Colour codes as BWIPP writes them: 0 white, 9 black, 1 cyan, 3 magenta,
// 5 yellow, 6 green.
const TILES = (
  '13135 13136 13153 13156 13163 13165 13513 13515 13516 13531 13535 13536 13561 13563 13565 ' +
  '13613 13615 13616 13631 13635 13636 13651 13653 13656 15135 15136 15153 15163 15165 15313 ' +
  '15315 15316 15351 15353 15356 15361 15363 15365 15613 15615 15616 15631 15635 15636 15651 ' +
  '15653 15656 16135 16136 16153 16156 16165 16313 16315 16316 16351 16353 16356 16361 16363 ' +
  '16365 16513 16515 16516 16531 16535 16536 16561 16563 16565 31315 31316 31351 31356 31361 ' +
  '31365 31513 31515 31516 31531 31535 31536 31561 31563 31565 31613 31615 31631 31635 31636 ' +
  '31651 31653 31656 35131 35135 35136 35151 35153 35156 35161 35163 35165 35315 35316 35351 ' +
  '35356 35361 35365 35613 35615 35616 35631 35635 35636 35651 35653 35656 36131 36135 36136 ' +
  '36151 36153 36156 36163 36165 36315 36316 36351 36356 36361 36365 36513 36515 36516 36531 ' +
  '36535 36536 36561 36563 36565 51313 51315 51316 51351 51353 51356 51361 51363 51365 51513 ' +
  '51516 51531 51536 51561 51563 51613 51615 51616 51631 51635 51636 51651 51653 51656 53131 ' +
  '53135 53136 53151 53153 53156 53161 53163 53165 53513 53516 53531 53536 53561 53563 53613 ' +
  '53615 53616 53631 53635 53636 53651 53653 53656 56131 56135 56136 56151 56153 56156 56161 ' +
  '56163 56165 56313 56315 56316 56351 56353 56356 56361 56363 56365 56513 56516 56531 56536 ' +
  '56561 56563 61313 61315 61316 61351 61353 61356 61361 61363 61365 61513 61515 61516 61531 ' +
  '61535 61536 61561 61563 61565 61615 61631 61635 61651 61653 63131 63135 63136 63151 63153 ' +
  '63156 63161 63163 63165 63513 63515 63516 63531 63535 63536 63561 63563 63565 63613 63615 ' +
  '63631 63635 63651 63653 65131 65135 65136 65151 65153 65156 65161 65163 65165 65313 65315 ' +
  '65316 65351 65353 65356 65361 65363 65365 65613 65615 65631 65635 65651 65653 56565 51515'
).split(' ');
const TILE_VALUE = new Map(TILES.map((t, v) => [t, v]));

export interface UltracodeRead {
  text: string;
  errors: number;
  /** Corners in image pixels, when read from an image. */
  corners?: { x: number; y: number }[];
}

/** The data columns of a symbol `cols` wide: not the timing columns. */
function isTiming(x: number) {
  return x >= 19 && (x - 3) % 16 === 0;
}

/**
 * Decode a matrix of colour codes (0 W, 9 K, 1 C, 3 M, 5 Y, 6 G), row-major,
 * `rows` = 6·tile rows + 1.
 */
export function decodeUltracodeMatrix(
  cells: ArrayLike<number>,
  rows: number,
  cols: number,
): UltracodeRead | null {
  if ((rows - 1) % 6 !== 0 || rows < 13 || rows > 31 || cols < 11) return null;
  // Tiles column by column from x = 5, five cells each between timing rows.
  const seq: (number | undefined)[] = [];
  for (let x = 5; x < cols - 1; x++) {
    if (isTiming(x)) continue;
    for (let y = 1; y + 5 <= rows - 1; y += 6) {
      let key = '';
      for (let k = 0; k < 5; k++) key += cells[(y + k) * cols + x];
      seq.push(TILE_VALUE.get(key));
    }
  }
  const n = seq.length;
  if (n < 8) return null;
  // The sequence: start, mcc, check codewords (qcc), tcc, SEP, acc, data,
  // pads, qcc. The counts are repeated (tcc = mcc + qcc), so take whichever
  // pair agrees.
  const tries: [number, number][] = [];
  const mcc0 = seq[1];
  const qcc0 = seq[n - 1];
  if (mcc0 !== undefined && qcc0 !== undefined) tries.push([mcc0, qcc0]);
  for (let q = 3; q <= 101 && q + 6 < n; q++) {
    const tcc = seq[2 + q];
    if (seq[3 + q] === 283 && tcc !== undefined && tcc > q) tries.push([tcc - q, q]);
  }
  for (const [mcc, qcc] of tries) {
    if (mcc < 3 || qcc < 3 || 5 + qcc + mcc - 3 > n) continue;
    const dcws = seq.slice(5 + qcc, 5 + qcc + mcc - 3);
    const ecws = seq.slice(2, 2 + qcc);
    const msg = [seq[0], mcc, seq[4 + qcc], ...dcws, ...ecws].map((v) => v ?? 0);
    // EC0 (qcc 3) only detects errors; small levels keep one in reserve.
    const fixed = rsCorrect(
      GF283,
      msg,
      qcc,
      1,
      qcc <= 3 ? 0 : qcc < 10 ? Math.floor(qcc / 2) - 1 : Math.floor(qcc / 2),
    );
    if (!fixed) continue;
    let errors = 0;
    fixed.forEach((v, i) => {
      if (v !== msg[i]) errors++;
    });
    const data = fixed.slice(3, 3 + mcc - 3);
    const text = parseCodewords(fixed[0], data);
    if (text !== null) return { text, errors };
  }
  return null;
}

/** Codewords as text: start 257 (ISO-8859-1 bytes), 268 FNC1, 269 FNC3. */
function parseCodewords(start: number, cws: number[]): string | null {
  if (start !== 257) return null;
  let out = '';
  for (const c of cws) {
    if (c < 256) out += String.fromCharCode(c);
    else if (c === 268) out += '\u001d';
    else if (c === 269) continue;
    else return null;
  }
  return bytesToText(out);
}

// ---- Reading from a colour image ------------------------------------------

export interface Rgba {
  data: ArrayLike<number>;
  width: number;
  height: number;
}

/** Colour code of an RGB triple: 0 W, 9 K, 1 C, 3 M, 5 Y, 6 G, or -1. */
function classify(r: number, g: number, b: number): number {
  const hi = Math.max(r, g, b);
  const lo = Math.min(r, g, b);
  if (hi - lo < 70) return (r + g + b) / 3 > 128 ? 0 : 9;
  const mid = (hi + lo) / 2;
  const key = (r > mid ? 4 : 0) + (g > mid ? 2 : 0) + (b > mid ? 1 : 0);
  return ({ 3: 1, 5: 3, 6: 5, 2: 6 } as Record<number, number>)[key] ?? -1;
}

const SAT = 90;

const sat = (d: ArrayLike<number>, i: number) =>
  Math.max(d[i], d[i + 1], d[i + 2]) - Math.min(d[i], d[i + 1], d[i + 2]);

/**
 * Find and decode an Ultracode symbol in a colour image. Each colourful
 * patch is taken in turn (other colourful things in the picture are tried and
 * rejected), turned upright, its colours stretched to full range, and read.
 */
export function readUltracode(img: Rgba): UltracodeRead | null {
  const { width: w, height: h, data } = img;
  // How colourful the most colourful pixels are sets the bar for "colourful".
  const hist = new Int32Array(256);
  for (let i = 0; i < w * h * 4; i += 4 * 3) hist[sat(data, i)]++;
  // Among the pixels with some colour, how strong the strongest tenth are.
  let colour = 0;
  for (let v = 21; v < 256; v++) colour += hist[v];
  if (colour < 30) return null;
  let n = 0;
  let p90 = 255;
  for (let v = 255; v > 20; v--) {
    n += hist[v];
    if (n >= colour * 0.1) {
      p90 = v;
      break;
    }
  }
  if (p90 < 30) return null;
  const st = Math.max(20, p90 * 0.4);
  // Colourful cells on a coarse grid, joined across small gaps.
  const f = Math.max(2, Math.ceil(Math.max(w, h) / 320));
  const gw = Math.ceil(w / f);
  const gh = Math.ceil(h / f);
  const grid = new Uint8Array(gw * gh);
  const by = f >= 4 ? 2 : 1;
  for (let y = 0; y < h; y += by)
    for (let x = 0; x < w; x += by)
      if (sat(data, (y * w + x) * 4) > st) {
        const i = (y * w + x) * 4;
        const g = Math.floor(y / f) * gw + Math.floor(x / f);
        // 2: a colour Ultracode doesn't use (red, blue).
        if (grid[g] !== 1) grid[g] = classify(data[i], data[i + 1], data[i + 2]) === -1 ? 2 : 1;
      }
  const grown = new Uint8Array(gw * gh);
  const R = 2;
  for (let y = 0; y < gh; y++)
    for (let x = 0; x < gw; x++) {
      if (!grid[y * gw + x]) continue;
      for (let dy = -R; dy <= R; dy++)
        for (let dx = -R; dx <= R; dx++) {
          const xx = x + dx;
          const yy = y + dy;
          if (xx >= 0 && yy >= 0 && xx < gw && yy < gh) grown[yy * gw + xx] = 1;
        }
    }
  const label = new Int32Array(gw * gh).fill(-1);
  const comps: { x0: number; y0: number; x1: number; y1: number; n: number; off: number }[] = [];
  for (let s0 = 0; s0 < gw * gh; s0++) {
    if (!grown[s0] || label[s0] >= 0) continue;
    const c = { x0: gw, y0: gh, x1: 0, y1: 0, n: 0, off: 0 };
    const stack = [s0];
    label[s0] = comps.length;
    while (stack.length) {
      const q = stack.pop()!;
      const x = q % gw;
      const y = (q - x) / gw;
      if (grid[q]) c.n++;
      if (grid[q] === 2) c.off++;
      c.x0 = Math.min(c.x0, x);
      c.x1 = Math.max(c.x1, x);
      c.y0 = Math.min(c.y0, y);
      c.y1 = Math.max(c.y1, y);
      for (const nb of [q - 1, q + 1, q - gw, q + gw]) {
        if (nb < 0 || nb >= gw * gh || label[nb] >= 0 || !grown[nb]) continue;
        if ((nb === q - 1 && x === 0) || (nb === q + 1 && x === gw - 1)) continue;
        label[nb] = comps.length;
        stack.push(nb);
      }
    }
    comps.push(c);
  }
  const separate = comps.map((c) => ({ ...c }));
  // The DCC column sits two cells apart from the data tiles: join patches
  // that are close for their size (and try them unjoined too, in case
  // something else colourful was joined on).
  for (let merged = true; merged;) {
    merged = false;
    for (let i = 0; i < comps.length && !merged; i++)
      for (let j = i + 1; j < comps.length && !merged; j++) {
        const a = comps[i];
        const b = comps[j];
        const gapX = Math.max(0, Math.max(a.x0, b.x0) - Math.min(a.x1, b.x1));
        const gapY = Math.max(0, Math.max(a.y0, b.y0) - Math.min(a.y1, b.y1));
        const size = Math.max(a.y1 - a.y0, a.x1 - a.x0, b.y1 - b.y0, b.x1 - b.x0);
        if (
          Math.max(gapX, gapY) <= size * 0.25 &&
          Math.min(a.n, b.n) >= 4 &&
          a.off <= a.n * 0.25 &&
          b.off <= b.n * 0.25
        ) {
          a.x0 = Math.min(a.x0, b.x0);
          a.y0 = Math.min(a.y0, b.y0);
          a.x1 = Math.max(a.x1, b.x1);
          a.y1 = Math.max(a.y1, b.y1);
          a.n += b.n;
          a.off += b.off;
          comps.splice(j, 1);
          merged = true;
        }
      }
  }
  const key = (c: { x0: number; y0: number; x1: number; y1: number }) =>
    `${c.x0},${c.y0},${c.x1},${c.y1}`;
  const merged = new Set(comps.map(key));
  // Patches mostly in Ultracode's own colours first, then by size.
  const rank = (a: (typeof comps)[number], b: (typeof comps)[number]) =>
    Number(a.off > a.n * 0.25) - Number(b.off > b.n * 0.25) || b.n - a.n;
  const big = [
    ...comps
      .filter((c) => c.n >= 12)
      .sort(rank)
      .slice(0, 16),
    ...separate
      .filter((c) => c.n >= 12 && !merged.has(key(c)))
      .sort(rank)
      .slice(0, 6),
  ];
  for (const c of big) {
    const pad = 3 * f;
    const X0 = Math.max(0, c.x0 * f - pad);
    const Y0 = Math.max(0, c.y0 * f - pad);
    const X1 = Math.min(w, (c.x1 + 1) * f + pad);
    const Y1 = Math.min(h, (c.y1 + 1) * f + pad);
    const r = readPatch(img, X0, Y0, X1, Y1, st);
    if (r) return r;
  }
  return null;
}

/** Read the code in one colourful patch of the image. */
function readPatch(img: Rgba, X0: number, Y0: number, X1: number, Y1: number, st: number) {
  const { width: w, data } = img;
  // Ultracode's colours are cyan, magenta, yellow and green; a patch where
  // many colourful pixels are red or blue is something else (a photo, noise).
  let colourful = 0;
  let off = 0;
  const step = Math.max(1, Math.floor(Math.sqrt(((X1 - X0) * (Y1 - Y0)) / 4000)));
  for (let y = Y0; y < Y1; y += step)
    for (let x = X0; x < X1; x += step) {
      const i = (y * w + x) * 4;
      if (sat(data, i) <= st) continue;
      colourful++;
      const c = classify(data[i], data[i + 1], data[i + 2]);
      if (c === -1) off++;
    }
  if (colourful < 20 || off > colourful * 0.25) return null;
  let angle = gridAngle(img, X0, Y0, X1, Y1);
  // Square on already: don't resample (small cells would blur).
  if (Math.abs(angle) < 0.006) angle = 0;
  // An upright copy of the patch, big enough for any turn, colours stretched.
  const cx = (X0 + X1) / 2;
  const cy = (Y0 + Y1) / 2;
  const side = Math.ceil(Math.hypot(X1 - X0, Y1 - Y0)) + 4;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const out = new Uint8ClampedArray(side * side * 4);
  const lo = [255, 255, 255];
  const hi = [0, 0, 0];
  for (let y = 0; y < side; y++)
    for (let x = 0; x < side; x++) {
      const dx = x - side / 2;
      const dy = y - side / 2;
      const sx = cx + dx * cos - dy * sin;
      const sy = cy + dx * sin + dy * cos;
      const o = (y * side + x) * 4;
      out[o + 3] = 255;
      if (sx < X0 || sy < Y0 || sx >= X1 - 1 || sy >= Y1 - 1) {
        out[o] = out[o + 1] = out[o + 2] = 255;
        continue;
      }
      const x0 = Math.floor(sx);
      const y0 = Math.floor(sy);
      const fx = angle ? sx - x0 : 0;
      const fy = angle ? sy - y0 : 0;
      for (let k = 0; k < 3; k++) {
        const i = (y0 * w + x0) * 4 + k;
        const v =
          (data[i] * (1 - fx) + data[i + 4] * fx) * (1 - fy) +
          (data[i + w * 4] * (1 - fx) + data[i + w * 4 + 4] * fx) * fy;
        out[o + k] = v;
        if (v < lo[k]) lo[k] = v;
        if (v > hi[k]) hi[k] = v;
      }
    }
  // Stretch each channel to full range: dim light, low contrast, colour casts.
  for (let i = 0; i < out.length; i += 4)
    for (let k = 0; k < 3; k++)
      out[i + k] = hi[k] > lo[k] + 10 ? ((out[i + k] - lo[k]) * 255) / (hi[k] - lo[k]) : out[i + k];
  const r = readUpright({ data: out, width: side, height: side });
  if (!r) return null;
  const back = (p: { x: number; y: number }) => {
    const dx = p.x - side / 2;
    const dy = p.y - side / 2;
    return { x: cx + dx * cos - dy * sin, y: cy + dx * sin + dy * cos };
  };
  return { ...r, corners: r.corners?.map(back) };
}

/**
 * The turn (radians, within ±45°) that makes the cells upright: the main
 * direction of colour edges in the patch, taken modulo 90° (cell edges run
 * both ways), weighted by edge strength.
 */
function gridAngle(img: Rgba, X0: number, Y0: number, X1: number, Y1: number): number {
  const { width: w, data } = img;
  let sx = 0;
  let sy = 0;
  for (let y = Y0 + 1; y < Y1 - 1; y++)
    for (let x = X0 + 1; x < X1 - 1; x++) {
      let gx = 0;
      let gy = 0;
      const i = (y * w + x) * 4;
      // Scharr kernels: much less biased by direction than plain differences.
      const W4 = w * 4;
      for (let k = 0; k < 3; k++) {
        const v = (dx: number, dy: number) => data[i + dy * W4 + dx * 4 + k];
        gx += 3 * (v(1, -1) - v(-1, -1)) + 10 * (v(1, 0) - v(-1, 0)) + 3 * (v(1, 1) - v(-1, 1));
        gy += 3 * (v(-1, 1) - v(-1, -1)) + 10 * (v(0, 1) - v(0, -1)) + 3 * (v(1, 1) - v(1, -1));
      }
      const m2 = gx * gx + gy * gy;
      if (m2 < 900 * 256) continue;
      // cos/sin of 4θ from the gradient direction, weighted by magnitude.
      const c2 = (gx * gx - gy * gy) / m2;
      const s2 = (2 * gx * gy) / m2;
      const mag = Math.sqrt(m2);
      sx += (c2 * c2 - s2 * s2) * mag;
      sy += 2 * c2 * s2 * mag;
    }
  return Math.atan2(sy, sx) / 4;
}

/** Read an upright Ultracode symbol that's the only colourful thing in `img`. */
function readUpright(img: Rgba): UltracodeRead | null {
  const { width: w, height: h, data } = img;
  // Rows and columns with colourful pixels.
  const rowN = new Int32Array(h);
  const colN = new Int32Array(w);
  let total = 0;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      if (Math.max(r, g, b) - Math.min(r, g, b) > SAT) {
        rowN[y]++;
        colN[x]++;
        total++;
      }
    }
  if (total < 200) return null;
  const span = (a: Int32Array) => {
    const peak = Math.max(...a);
    let s = 0;
    while (a[s] < peak * 0.08) s++;
    let e = a.length - 1;
    while (a[e] < peak * 0.08) e--;
    return [s, e + 1];
  };
  const [y0, y1] = span(rowN);
  const [x0, x1] = span(colN);
  const bw = x1 - x0;
  const bh = y1 - y0;
  // Both ways up: the tile columns may run across or down the image.
  for (const across of [true, false]) {
    const long = across ? bw : bh; // along the tile columns' sequence
    const short = across ? bh : bw;
    for (const R of [13, 19, 25, 31]) {
      // The colourful area spans rows 1..R-2 and columns 2..C-2.
      const m = short / (R - 2);
      if (m < 1.5) continue;
      const est = long / m + 3;
      for (const C of [Math.round(est), Math.round(est) - 1, Math.round(est) + 1]) {
        if (C < 11 || C > 70) continue;
        const ml = long / (C - 3);
        // The four ways round for this axis. The colourful area starts two
        // cells in from the symbol's edge on the DCC side, one on the other.
        for (const [fx, fy] of [
          [false, false],
          [true, true],
          [true, false],
          [false, true],
        ]) {
          const out = new Int8Array(R * C);
          for (let y = 0; y < R; y++)
            for (let x = 0; x < C; x++) {
              const ix = fx ? C - 1 - x : x;
              const iy = fy ? R - 1 - y : y;
              const u = (ix - (fx ? 1 : 2) + 0.5) * ml; // along
              const v = (iy - 1 + 0.5) * m; // across
              const px = across ? x0 + u : x0 + v;
              const py = across ? y0 + v : y0 + u;
              out[y * C + x] = cellColour(
                img,
                px,
                py,
                Math.min(m, ml) < 3.5 ? 0 : Math.min(m, ml) * 0.25,
              );
            }
          const r = decodeUltracodeMatrix(out, R, C);
          if (r) {
            // The whole symbol: two cells beyond the colour on one side, one on the other.
            const pre = (fx ? 1 : 2) * ml;
            const post = (fx ? 2 : 1) * ml;
            const [L, T, Rr, B] = across
              ? [x0 - pre, y0 - m, x1 + post, y1 + m]
              : [x0 - m, y0 - pre, x1 + m, y1 + post];
            return {
              ...r,
              corners: [
                { x: L, y: T },
                { x: Rr, y: T },
                { x: Rr, y: B },
                { x: L, y: B },
              ],
            };
          }
        }
      }
    }
  }
  return null;
}

function cellColour(img: Rgba, cx: number, cy: number, rad: number): number {
  const { width: w, height: h, data } = img;
  let r = 0;
  let g = 0;
  let b = 0;
  let n = 0;
  for (let y = Math.round(cy - rad); y <= Math.round(cy + rad); y++)
    for (let x = Math.round(cx - rad); x <= Math.round(cx + rad); x++) {
      if (x < 0 || y < 0 || x >= w || y >= h) continue;
      const i = (y * w + x) * 4;
      r += data[i];
      g += data[i + 1];
      b += data[i + 2];
      n++;
    }
  return n ? classify(r / n, g / n, b / n) : -1;
}
