// Code One (AIM USS Code One): from a module matrix to text.
// The layout, codeword placement and data modes mirror BWIPP's encoder
// (bwip-js), which draws the codes this app makes.

import { binaryField, rsCorrect, type Field } from './rs';
import { bytesToText } from './text';
import type { Luma } from '../extra/lines';
import { barsFrom, darkRuns, otsu, sampleAt, sampleGrid } from './grid';

interface Metrics {
  ver: string;
  rows: number;
  cols: number;
  dcol: number;
  dcws: number;
  rscw: number;
  rsbl: number;
  riso: number;
  risi: number;
  risl: number;
}

const M = (
  ver: string,
  rows: number,
  cols: number,
  dcol: number,
  dcws: number,
  rscw: number,
  rsbl: number,
  riso: number,
  risi: number,
  risl: number,
): Metrics => ({ ver, rows, cols, dcol, dcws, rscw, rsbl, riso, risi, risl });

export const CODEONE_METRICS: Metrics[] = [
  M('S-10', 8, 11, 10, 4, 4, 1, 99, 99, 99),
  M('S-20', 8, 21, 20, 8, 8, 1, 99, 99, 99),
  M('S-30', 8, 31, 30, 12, 12, 1, 99, 99, 99),
  M('A', 16, 18, 16, 10, 10, 1, 4, 99, 6),
  M('B', 22, 22, 20, 19, 16, 1, 4, 99, 8),
  M('C', 28, 32, 28, 44, 26, 1, 4, 22, 11),
  M('D', 40, 42, 36, 91, 44, 1, 4, 16, 16),
  M('E', 52, 54, 48, 182, 70, 1, 4, 22, 22),
  M('F', 70, 76, 68, 370, 140, 2, 4, 22, 31),
  M('G', 104, 98, 88, 732, 280, 4, 6, 21, 47),
  M('H', 148, 134, 120, 1480, 560, 8, 6, 20, 69),
  M('T-16', 16, 17, 16, 10, 10, 1, 99, 99, 99),
  M('T-32', 16, 33, 32, 24, 16, 1, 99, 99, 99),
  M('T-48', 16, 49, 48, 38, 22, 1, 99, 99, 99),
];

const CPAT: Record<string, string> = {
  A: '121343',
  B: '12134343',
  C: '12121343',
  D: '1213434343',
  E: '1212134343',
  F: '1212121343',
  G: '121213434343',
  H: '121212134343',
  S: '56661278',
  T: '5666666666127878',
};

const DOTS: Record<string, [number, number][]> = {
  A: [[12, 5]],
  B: [[16, 7]],
  C: [[26, 12]],
  D: [],
  E: [[26, 23]],
  F: [
    [26, 32],
    [70, 32],
    [26, 34],
    [70, 34],
  ],
  G: [
    [27, 48],
    [69, 48],
  ],
  H: [
    [26, 70],
    [66, 70],
    [106, 70],
    [26, 72],
    [66, 72],
    [106, 72],
  ],
  'S-10': [],
  'S-20': [[10, 4]],
  'S-30': [
    [15, 4],
    [15, 6],
  ],
  'T-16': [[8, 10]],
  'T-32': [
    [16, 10],
    [16, 12],
  ],
  'T-48': [
    [24, 10],
    [24, 12],
    [24, 14],
  ],
};

/** Fixed modules of a version: -1 where data goes, else 0/1. Row-major. */
export function codeOneLayout(m: Metrics): Int8Array {
  const { rows, cols } = m;
  const pixs = new Int8Array(rows * cols).fill(-1);
  const half = (cols - 1) >> 1;
  const artifact: (() => number[])[] = [
    () => new Array(cols).fill(0),
    () => new Array(cols).fill(1),
    () => [0, ...new Array(cols - 2).fill(1), 0],
    () => [0, 1, ...new Array(cols - 4).fill(0), 1, 0],
    () => [...new Array(half).fill(-1), 1, ...new Array(half).fill(-1)],
    () => [...new Array(half).fill(-1), 0, ...new Array(half).fill(-1)],
    () => [1, ...new Array(cols - 2).fill(0), 1],
    () => [1, 0, ...new Array(cols - 4).fill(1), 0, 1],
  ];
  const cpat = CPAT[m.ver[0]];
  const start = ((rows - cpat.length) >> 1) * cols;
  const rowsOut = [...cpat].flatMap((ch) => artifact[ch.charCodeAt(0) - 49]());
  pixs.set(rowsOut, start);
  // Risers
  for (let i = 0; i < m.risl; i++) {
    for (let j = m.riso; j <= cols - 1; j += m.risi) {
      const pair = [1, i % 12 === 0 ? 1 : 0];
      pixs.set(pair, i * cols + j);
      if (i !== m.risl - 1) pixs.set(pair, (rows - i - 1) * cols + (cols - j - 2));
    }
  }
  for (const [x, y] of DOTS[m.ver] ?? DOTS[m.ver[0]] ?? []) pixs[y * cols + x] = 1;
  return pixs;
}

const GF256 = binaryField(256, 301);
const GF32 = binaryField(32, 37);

/** Codewords (data + check) read from the data modules of a matrix. */
function readCodewords(m: Metrics, mods: ArrayLike<number>, layout: Int8Array): number[] {
  const stype = m.ver.startsWith('S');
  const total = m.dcws + m.rscw;
  const bits: number[] = [];
  for (let i = 0; i < layout.length; i++) if (layout[i] === -1) bits.push(mods[i] ? 1 : 0);
  // mmat is dcol wide, two rows per band of codewords.
  const dcol = m.dcol;
  const at = (r: number, c: number) => bits[r * dcol + c] ?? 0;
  const cws: number[] = [];
  let r = 0;
  let c = 0;
  const step = stype ? 5 : 4;
  for (let i = 0; i < total; i += stype ? 2 : 1) {
    const top = Array.from({ length: step }, (_, k) => at(r, c + k));
    const bot = Array.from({ length: step }, (_, k) => at(r + 1, c + k));
    if (!stype) cws.push([...top, ...bot].reduce((a, b) => a * 2 + b, 0));
    else {
      // c1 = top[0..2] bot[0..1]; c2 = top[3..4] bot[2..4]
      const c1 = [top[0], top[1], top[2], bot[0], bot[1]];
      const c2 = [top[3], top[4], bot[2], bot[3], bot[4]];
      cws.push(
        c1.reduce((a, b) => a * 2 + b, 0),
        c2.reduce((a, b) => a * 2 + b, 0),
      );
    }
    c += step;
    if (c === dcol) {
      c = 0;
      r += 2;
    }
  }
  return cws.slice(0, total);
}

/** De-interleave, correct each block, re-interleave the data codewords. */
function correct(m: Metrics, cws: number[], f: Field): number[] | null {
  const { dcws, rscw, rsbl } = m;
  const dcpb = dcws / rsbl;
  const ecpb = rscw / rsbl;
  const data = new Array(dcws);
  for (let blk = 0; blk < rsbl; blk++) {
    const block: number[] = [];
    for (let k = 0; k < dcpb; k++) block.push(cws[k * rsbl + blk]);
    for (let k = 0; k < ecpb; k++) block.push(cws[dcws + k * rsbl + blk]);
    // BWIPP's generator has roots α^0…α^(n-1).
    // Blocks with few check codewords keep one in reserve against miscorrection.
    const fixed = rsCorrect(
      f,
      block,
      ecpb,
      0,
      ecpb < 10 ? Math.floor(ecpb / 2) - 1 : Math.floor(ecpb / 2),
    );
    if (!fixed) return null;
    for (let k = 0; k < dcpb; k++) data[k * rsbl + blk] = fixed[k];
  }
  return data;
}

const FNC1 = '\u001d';

/** Set when C40/Text/X12 decoding ran into the symbol's padding. */
let padPairs = false;
/** Pair positions where bwip-js may have left out an unlatch (see below). */
let crossed: number[] = [];

function decodeData(
  cws: number[],
  implied: Set<number> = new Set(),
  spots: Set<number> = new Set(),
): string | null {
  padPairs = false;
  crossed = [];
  let out = '';
  let i = 0;
  let upper = false; // FNC4: next character + 128
  const emit = (code: number) => {
    out += String.fromCharCode(upper ? code + 128 : code);
    upper = false;
  };
  const n = cws.length;
  let mode: 'a' | 'c' | 't' | 'x' | 'd' | 'b' = 'a';
  let dbits: number[] = [];
  // Padding (129) read in any mode but ASCII means the reading went astray.
  const padFrom = (() => {
    let k = n;
    while (k > 0 && cws[k - 1] === 129) k--;
    return k;
  })();
  while (i < n || (mode === 'd' && dbits.length)) {
    if (mode !== 'a' && i >= padFrom && i < n && !(mode === 'd' && dbits.length)) padPairs = true;
    if (mode === 'a') {
      const v = cws[i++];
      if (v >= 1 && v <= 128) emit(v - 1);
      else if (v === 129)
        break; // pad: end of data
      else if (v >= 130 && v <= 229) {
        const d = String(v - 130).padStart(2, '0');
        out += d;
      } else if (v === 230) mode = 'c';
      else if (v === 231) mode = 'b';
      else if (v === 232) out += out.length ? FNC1 : '';
      else if (v === 233 || v === 234) {
        /* FNC2/FNC3: structured append / reader programming, no data */
      } else if (v === 235) upper = true;
      else if (v === 236) {
        out += out.length ? FNC1 : '';
        mode = 'd';
        dbits = [];
      } else if (v === 238) mode = 'x';
      else if (v === 239) mode = 't';
      else if (v >= 240) {
        // Latch to decimal: the low 4 bits are the first decimal bits.
        mode = 'd';
        dbits = [(v >> 3) & 1, (v >> 2) & 1, (v >> 1) & 1, v & 1];
      } else return null;
    } else if (mode === 'b') {
      let len = cws[i++];
      if (len === undefined) return null;
      if (len === 0) len = n - i;
      else if (len >= 250) len = (len - 249) * 250 + cws[i++];
      if (i + len > n) return null;
      for (let k = 0; k < len; k++) emit(cws[i++]);
      mode = 'a';
    } else if (mode === 'd') {
      // Pull whole codewords into the bit buffer as needed.
      const need = (k: number) => {
        while (dbits.length < k && i < n) {
          const v = cws[i++];
          for (let b = 7; b >= 0; b--) dbits.push((v >> b) & 1);
        }
        return dbits.length >= k;
      };
      const val = (k: number) => dbits.splice(0, k).reduce((a, b) => a * 2 + b, 0);
      // One whole codeword left at a byte boundary: it's ASCII.
      if (dbits.length === 0 && n - i === 1) {
        mode = 'a';
        continue;
      }
      // Look at 6 bits first: 111111 is the unlatch, and a 10-bit group never
      // starts with it. Only then pull in more (the next codeword may already
      // be ASCII after an unlatch).
      need(6);
      const unlatch = dbits.length >= 6 && dbits.slice(0, 6).every((b) => b === 1);
      if (!unlatch && need(10)) {
        const v = val(10);
        if (v < 1 || v > 1000) return null;
        out += String(v - 1).padStart(3, '0');
        continue;
      }
      if (unlatch) val(6);
      // Remaining bits to the byte boundary: an optional 4-bit digit, then 01.
      if (dbits.length >= 4) {
        const v = val(4);
        if (v >= 1 && v <= 10) out += String(v - 1);
        else if (v !== 15) return null;
      }
      if (dbits.length >= 2) val(2);
      dbits = [];
      mode = 'a';
    } else {
      // C40, Text, X12-style: pairs of codewords hold three values.
      if (i >= n) break;
      if (cws[i] === 255) {
        i++;
        mode = 'a';
        continue;
      }
      if (n - i === 1 || implied.has(i)) {
        mode = 'a'; // implied unlatch: a final single ASCII codeword
        continue;
      }
      // The slip shows as a few ASCII codewords, then a latch back into a mode.
      if (spots.has(i) && cws[i] >= 1 && cws[i] <= 229) {
        let j = i;
        while (j < i + 8 && cws[j] >= 1 && cws[j] <= 229 && cws[j] !== 129) j++;
        if ([230, 238, 239].includes(cws[j])) crossed.push(i);
      }
      const v = cws[i] * 256 + cws[i + 1] - 1;
      i += 2;
      const vals = [Math.floor(v / 1600), Math.floor(v / 40) % 40, v % 40];
      for (const x of vals) ctx.push(x);
      while (ctx.length && flushCtx(mode)) {
        /* consume */
      }
    }
  }
  return out;

  // ---- C40 / Text / X12 state ----
  // (declared with function hoisting below)
  function flushCtx(m: 'c' | 't' | 'x'): boolean {
    if (!ctx.length) return false;
    if (m === 'x') {
      const v = ctx.shift()!;
      if (v === 0) out += '\r';
      else if (v === 1) out += '*';
      else if (v === 2) out += '>';
      else if (v === 3) out += ' ';
      else if (v <= 13) out += String(v - 4);
      else if (v <= 39) out += String.fromCharCode(65 + v - 14);
      return true;
    }
    const v = ctx[0];
    if (v <= 2) {
      if (ctx.length < 2) return false;
      ctx.shift();
      const w = ctx.shift()!;
      if (v === 0) emit(w);
      else if (v === 1) {
        if (w <= 14) emit(33 + w);
        else if (w <= 21) emit(58 + w - 15);
        else if (w <= 26) emit(91 + w - 22);
        else if (w === 27) out += out.length ? FNC1 : '';
        else if (w === 30) upper = true;
        // 28 FNC2, 29 FNC3, 31 pad: nothing
      } else if (m === 'c') emit(96 + w);
      else {
        if (w === 0) emit(96);
        else if (w <= 26) emit(64 + w);
        else emit(123 + w - 27);
      }
      return true;
    }
    ctx.shift();
    if (v === 3) emit(32);
    else if (v <= 13) emit(48 + v - 4);
    else emit((m === 'c' ? 65 : 97) + v - 14);
    return true;
  }
}
// Values waiting in a C40/Text/X12 triple (module-level scratch, reset per decode).
let ctx: number[] = [];

/** S-type: the codewords are one big binary number, the value plus one. */
function decodeStype(m: Metrics, cws: number[]): string | null {
  let v = 0n;
  for (const c of cws) v = v * 32n + BigInt(c);
  if (v === 0n) return null;
  const digits = { 'S-10': 6, 'S-20': 12, 'S-30': 18 }[m.ver] ?? 18;
  if (v - 1n >= 10n ** BigInt(digits)) return null; // more digits than the version holds
  return String(v - 1n).padStart(digits, '0');
}

export interface CodeOneRead {
  text: string;
  version: string;
  /** Codewords the error correction had to fix. */
  errors: number;
  /** Corners in image pixels, when read from an image. */
  corners?: { x: number; y: number }[];
  /** Other possible readings (see decodeCodeOneMatrix), with the data codewords to check them against. */
  alternatives?: string[];
  data?: number[];
}

/** Decode a module matrix (row-major, 1 = dark) of the given size. */
/** The corrected data codewords of a module matrix (to compare two symbols). */
export function codeOneData(mods: ArrayLike<number>, rows: number, cols: number): number[] | null {
  const m = CODEONE_METRICS.find((v) => v.rows === rows && v.cols === cols);
  if (!m) return null;
  const cws = readCodewords(m, mods, cachedLayout(m));
  return correct(m, cws, m.ver.startsWith('S') ? GF32 : GF256);
}

const layouts = new Map<string, { layout: Int8Array; fixed: number[] }>();
function layoutInfo(m: Metrics) {
  let e = layouts.get(m.ver);
  if (!e) {
    const layout = codeOneLayout(m);
    const all: number[] = [];
    layout.forEach((v, i) => {
      if (v !== -1) all.push(i);
    });
    // An even spread of up to 400 fixed modules, for a quick check.
    const stepN = Math.max(1, Math.floor(all.length / 400));
    e = { layout, fixed: all.filter((_, k) => k % stepN === 0) };
    layouts.set(m.ver, e);
  }
  return e;
}
const cachedLayout = (m: Metrics) => layoutInfo(m).layout;

export function decodeCodeOneMatrix(
  mods: ArrayLike<number>,
  rows: number,
  cols: number,
): CodeOneRead | null {
  for (const m of CODEONE_METRICS) {
    if (m.rows !== rows || m.cols !== cols) continue;
    const layout = cachedLayout(m);
    // The fixed pattern must mostly match, or this isn't Code One.
    let bad = 0;
    let fixedN = 0;
    for (let i = 0; i < layout.length; i++) {
      if (layout[i] === -1) continue;
      fixedN++;
      if ((mods[i] ? 1 : 0) !== layout[i]) bad++;
    }
    if (bad > fixedN * 0.1) continue;
    const stype = m.ver.startsWith('S');
    const cws = readCodewords(m, mods, layout);
    const data = correct(m, cws, stype ? GF32 : GF256);
    if (!data) continue;
    let errors = 0;
    const raw = cws.slice(0, m.dcws);
    data.forEach((d, k) => (errors += d !== raw[k] ? 1 : 0));
    ctx = [];
    // bwip-js (the app's generator) leaves out the C40/Text/X12 unlatch when
    // one codeword would be left in a smaller version, then may grow the
    // symbol: what follows is ASCII but reads as pairs. At the end of the
    // data that shows as padding read as pairs (fixed here); in the middle it
    // reads as valid but wrong text, so the other readings are offered as
    // alternatives for the scanner to check by encoding them again.
    const spots = new Set(
      CODEONE_METRICS.filter((v) => !v.ver.startsWith('S') && v.dcws < m.dcws).map(
        (v) => v.dcws - 1,
      ),
    );
    let text = stype ? decodeStype(m, data) : decodeData(data, new Set(), spots);
    const alternatives: string[] = [];
    if (!stype) {
      const wasPad = padPairs;
      // Each place on its own, then two at once (the slip can happen twice).
      const sets: number[][] = wasPad
        ? [...spots].sort((p, q) => q - p).map((x) => [x])
        : crossed.flatMap((a, k) => [[a], ...crossed.slice(k + 1).map((b) => [a, b])]);
      for (const at of sets.slice(0, 40)) {
        const again = decodeData(data, new Set(at));
        if (again === null || padPairs) continue;
        if (wasPad) {
          text = again;
          break;
        }
        const t2 = bytesToText(again);
        if (again !== text && !alternatives.includes(t2)) alternatives.push(t2);
      }
    }
    if (text === null) continue;
    return {
      text: bytesToText(text),
      version: m.ver,
      errors,
      ...(alternatives.length ? { alternatives, data } : {}),
    };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Finding Code One in an image. Every version has a full-width dark row in
// its centre pattern, exactly one module tall: find such bars, and for each
// version whose width in modules fits the bar, sample the grid around it.

export function readCodeOne(l: Luma): CodeOneRead | null {
  const t = otsu(l);
  const minLen = Math.max(22, Math.round(Math.min(l.width, l.height) * 0.04));
  const bars = barsFrom(darkRuns(l, t, minLen))
    .filter((b) => {
      const len = b.x1 - b.x0;
      const h = b.y1 - b.y0 + 1;
      return len >= minLen && h * 6 <= len;
    })
    .sort((a, b) => b.x1 - b.x0 - (a.x1 - a.x0))
    .slice(0, 40); // in a busy picture, other long edges can outrank the code's bars
  for (const b of bars) {
    const len = b.x1 - b.x0;
    const h = b.y1 - b.y0 + 1;
    for (const m of CODEONE_METRICS) {
      const mx = len / m.cols;
      if (mx < 1.5 || Math.abs(h - mx) > Math.max(1.2, mx * 0.6)) continue;
      const cpat = CPAT[m.ver[0]];
      const top = (m.rows - cpat.length) >> 1;
      const barY = (b.y0 + b.y1 + 1) / 2; // centre of the bar
      for (let k = 0; k < cpat.length; k++) {
        if (cpat[k] !== '2') continue;
        const y0 = barY - (top + k) * mx; // centre of row 0
        const x0 = b.x0 + mx / 2;
        // Small nudges absorb rounding in where the bar's edges fell.
        for (const [dx, dy] of [
          [0, 0],
          [0.25, 0],
          [-0.25, 0],
          [0, 0.25],
          [0, -0.25],
        ]) {
          const gx = x0 + dx * mx;
          const gy = y0 + dy * mx;
          // Quick check of a sample of the fixed modules before reading them all.
          const { layout, fixed } = layoutInfo(m);
          let bad = 0;
          for (const i of fixed) {
            const v = sampleAt(l, gx + (i % m.cols) * mx, gy + Math.floor(i / m.cols) * mx, 0) < t;
            if ((v ? 1 : 0) !== layout[i]) bad++;
          }
          if (bad > fixed.length * 0.2) continue;
          const mods = sampleGrid(l, gx, gy, mx, mx, m.rows, m.cols);
          const r = decodeCodeOneMatrix(mods, m.rows, m.cols);
          if (r) {
            const L = x0 - mx / 2;
            const T = y0 - mx / 2;
            const R = L + m.cols * mx;
            const B = T + m.rows * mx;
            return {
              ...r,
              corners: [
                { x: L, y: T },
                { x: R, y: T },
                { x: R, y: B },
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
