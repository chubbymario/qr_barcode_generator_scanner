// Han Xin Code (ISO/IEC 20830): from a module matrix to text. Layout, masks,
// interleaving and the data modes mirror BWIPP's encoder (bwip-js), which
// draws the codes this app makes: numeric, byte and GS1/FNC1 segments.

import { binaryField, rsCorrect } from './rs';
import { HANXIN_METRICS } from './hanxin-tables';
import { bytesToText } from './text';
import { otsu, sampleAt } from './grid';
import type { Luma } from '../extra/lines';

const GF256 = binaryField(256, 355);
const GF16 = binaryField(16, 19);

const FPAT = [
  [1, 1, 1, 1, 1, 1, 1, 0],
  [1, 0, 0, 0, 0, 0, 0, 0],
  [1, 0, 1, 1, 1, 1, 1, 0],
  [1, 0, 1, 0, 0, 0, 0, 0],
  [1, 0, 1, 0, 1, 1, 1, 0],
  [1, 0, 1, 0, 1, 1, 1, 0],
  [1, 0, 1, 0, 1, 1, 1, 0],
  [0, 0, 0, 0, 0, 0, 0, 0],
];
const FPAT2 = [
  [1, 1, 1, 0, 1, 0, 1, 0],
  [1, 1, 1, 0, 1, 0, 1, 0],
  [1, 1, 1, 0, 1, 0, 1, 0],
  [0, 0, 0, 0, 1, 0, 1, 0],
  [1, 1, 1, 1, 1, 0, 1, 0],
  [0, 0, 0, 0, 0, 0, 1, 0],
  [1, 1, 1, 1, 1, 1, 1, 0],
  [0, 0, 0, 0, 0, 0, 0, 0],
];

/** The 34 function-information bits: two places each, as [col, row]. */
function functionMap(size: number): [[number, number], [number, number]][] {
  const out: [[number, number], [number, number]][] = [];
  for (let k = 0; k <= 8; k++)
    out.push([
      [k, 8],
      [size - 1 - k, size - 9],
    ]);
  for (let k = 7; k >= 0; k--)
    out.push([
      [8, k],
      [size - 9, size - 1 - k],
    ]);
  for (let k = 0; k <= 8; k++)
    out.push([
      [size - 9, k],
      [8, size - 1 - k],
    ]);
  for (let k = 8; k >= 1; k--)
    out.push([
      [size - k, 8],
      [k - 1, size - 9],
    ]);
  return out;
}

interface Version {
  v: number;
  size: number;
  alnk: number;
  alnn: number;
  nmod: number;
  blocks: [number, number, number][];
}

const versions: Version[] = HANXIN_METRICS.map(([v, size, alnk, alnn, nmod, blocks]) => ({
  v,
  size,
  alnk,
  alnn,
  nmod,
  blocks,
}));

/** Fixed modules: -1 where data goes, 2 for function information, else 0/1.
 * Index = row * size + col. */
export function hanXinLayout(ver: Version): Int8Array {
  const { size, alnk, alnn } = ver;
  const pixs = new Int8Array(size * size).fill(-1);
  // BWIPP's "trmv": x counted from the right, y from the top.
  const trmv = (x: number, y: number) => y * size + size - 1 - x;
  const aplot = (a: number, b: number, v: number) => {
    pixs[a * size + size - 1 - b] = v;
    pixs[b * size + size - 1 - a] = v;
  };
  if (alnn) {
    const alnr = size - alnk * alnn;
    let i = 0;
    let stag = 0;
    while (i < size) {
      for (let j = 0; j < size; j++) {
        const on =
          j + alnr < size
            ? ((Math.floor(j / alnk) + stag) % 2 === 0 && !(i === 0 && j < alnk)) || j % alnk === 0
            : (alnn + stag) % 2 === 0;
        if (on) {
          aplot(j, i, 1);
          if (j + 1 < size && i + 1 < size) aplot(j + 1, i + 1, 0);
        }
      }
      i = i + alnr === size ? i + alnr - 1 : i + alnk;
      stag = 1 - stag;
    }
    for (let k = alnk; k <= size - 2; k += alnk) {
      if (Math.floor(k / alnk) % 2 !== 0) {
        for (const [x, y] of [
          [0, k - 1],
          [0, k + 1],
          [1, k - 1],
          [1, k],
          [1, k + 1],
          [k - 1, 0],
          [k + 1, 0],
          [k - 1, 1],
          [k, 1],
          [k + 1, 1],
        ])
          pixs[trmv(x, y)] = 0;
      }
      if (pixs[trmv(size - 1, k - 1)] !== 1) {
        for (const [x, y] of [
          [size - 1, k - 1],
          [size - 2, k - 1],
          [size - 2, k],
          [size - 2, k + 1],
          [size - 1, k + 1],
          [k - 1, size - 1],
          [k - 1, size - 2],
          [k, size - 2],
          [k + 1, size - 2],
          [k + 1, size - 1],
        ])
          pixs[trmv(x, y)] = 0;
      }
    }
  }
  for (let y = 0; y < 8; y++)
    for (let x = 0; x < 8; x++) {
      pixs[y * size + x] = FPAT[y][x];
      pixs[y * size + size - 1 - x] = FPAT[y][x];
      pixs[(size - 1 - y) * size + size - 1 - x] = FPAT[y][x];
      pixs[(size - 1 - y) * size + x] = FPAT2[y][x];
    }
  for (const pair of functionMap(size)) for (const [x, y] of pair) pixs[y * size + x] = 2;
  return pixs;
}

const MASKS: ((x: number, y: number) => number)[] = [
  () => 1,
  (x, y) => (x + y) % 2,
  (x, y) => (((x + y) % 3) + (x % 3)) % 2,
  (x, y) => ((x % y) + (y % x) + (y % 3) + (x % 3)) % 2,
];

export interface HanXinRead {
  text: string;
  version: number;
  ecLevel: number;
  errors: number;
  /** Corners in image pixels, when read from an image. */
  corners?: Pt[];
}

/** Version, EC level and mask from the function information, or null. */
function readFunctionInfo(mods: ArrayLike<number>, size: number) {
  const fm = functionMap(size);
  for (const copy of [0, 1]) {
    const bits: number[] = fm.map((p) => (mods[p[copy][1] * size + p[copy][0]] ? 1 : 0));
    const nib = (k: number) => bits.slice(k * 4, k * 4 + 4).reduce((a, b) => a * 2 + b, 0);
    const cw = [0, 1, 2, 3, 4, 5, 6].map(nib);
    const fixed = rsCorrect(GF16, cw, 4, 1);
    if (!fixed) continue;
    const funval = (fixed[0] << 8) | (fixed[1] << 4) | fixed[2];
    const mask = funval & 3;
    const ecl = (funval >> 2) & 3;
    const v = (funval >> 4) - 20;
    if (v < 1 || v > 84 || versions[v - 1].size !== size) continue;
    return { v, ecl, mask };
  }
  return null;
}

/** Decode a square module matrix (row-major, 1 = dark). */
export function decodeHanXinMatrix(mods: ArrayLike<number>, size: number): HanXinRead | null {
  const info = readFunctionInfo(mods, size);
  if (!info) return null;
  const ver = versions[info.v - 1];
  const layout = hanXinLayout(ver);
  // The finder patterns must be there, or this isn't Han Xin.
  let bad = 0;
  let fixedN = 0;
  for (let i = 0; i < layout.length; i++) {
    if (layout[i] === -1 || layout[i] === 2) continue;
    fixedN++;
    if ((mods[i] ? 1 : 0) !== layout[i]) bad++;
  }
  if (bad > fixedN * 0.15) return null;
  // Unmask and read the bit stream in row order.
  const mf = MASKS[info.mask];
  const ncws = Math.floor(ver.nmod / 8);
  const cwsIn = new Array(ncws).fill(0);
  let num = 0;
  for (let y = 0; y < size && num < ncws * 8; y++)
    for (let x = 0; x < size && num < ncws * 8; x++) {
      const i = y * size + x;
      if (layout[i] !== -1) continue;
      let b = mods[i] ? 1 : 0;
      if (mf(x + 1, y + 1) === 0) b ^= 1;
      cwsIn[num >> 3] |= b << (7 - (num & 7));
      num++;
    }
  // Undo the 13-way interleave.
  const cws = new Array(ncws);
  let t = 0;
  for (let s = 0; s < 13 && s < ncws; s++) for (let k = s; k < ncws; k += 13) cws[k] = cwsIn[t++];
  // Blocks: data then check codewords, block after block.
  const blocks = ver.blocks.slice(info.ecl * 3, info.ecl * 3 + 3).filter((b) => b[0] > 0);
  const data: number[] = [];
  let errors = 0;
  let p = 0;
  for (const [nb, dc, ec] of blocks)
    for (let b = 0; b < nb; b++) {
      const block = cws.slice(p, p + dc + ec);
      p += dc + ec;
      // Blocks with few check codewords keep one in reserve against miscorrection.
      const fixed = rsCorrect(GF256, block, ec, 1, Math.floor(ec / 2) - (ec < 10 ? 1 : 0));
      if (!fixed) return null;
      fixed.slice(0, dc).forEach((v, k) => {
        if (v !== block[k]) errors++;
        data.push(v);
      });
    }
  const text = parseBits(data);
  if (text === null) return null;
  return { text, version: info.v, ecLevel: info.ecl + 1, errors };
}

/** The data bit stream: numeric, byte and FNC1 segments (GS1 framing). */
function parseBits(cws: number[]): string | null {
  const bits: number[] = [];
  for (const c of cws) for (let b = 7; b >= 0; b--) bits.push((c >> b) & 1);
  let pos = 0;
  const read = (n: number) => {
    if (pos + n > bits.length) return -1;
    let v = 0;
    for (let k = 0; k < n; k++) v = v * 2 + bits[pos++];
    return v;
  };
  let out = '';
  let gs1 = false;
  // GS1 framing: 1110 0001 … 1111 1111
  if (bits.slice(0, 8).join('') === '11100001') {
    gs1 = true;
    pos = 8;
  }
  const FNC1 = '\u001d';
  for (;;) {
    if (pos + 4 > bits.length) break;
    const mode = read(4);
    if (mode === 0) break;
    if (gs1 && mode === 15) break; // the 11111111 trailer
    if (mode === 3) {
      const len = read(13);
      if (len < 0) return null;
      for (let k = 0; k < len; k++) {
        const v = read(8);
        if (v < 0) return null;
        out += String.fromCharCode(v);
      }
    } else if (mode === 1) {
      // Groups of 3 digits in 10 bits; 1111111101/110/111 end the segment
      // (last group 1, 2 or 3 digits); 1111101000 is FNC1.
      let pending: number | null = null;
      for (;;) {
        const v = read(10);
        if (v < 0) return null;
        if (v === 1000) {
          if (pending !== null) out += String(pending).padStart(3, '0');
          pending = null;
          out += FNC1;
          continue;
        }
        if (v >= 1021) {
          if (pending !== null) out += String(pending).padStart(v - 1020, '0');
          break;
        }
        if (v > 999) return null;
        if (pending !== null) out += String(pending).padStart(3, '0');
        pending = v;
      }
    } else if (mode === 15 && !gs1) break;
    else return null; // text and Chinese modes aren't produced by this app's generator
  }
  // A leading FNC1 in GS1 data isn't part of the text.
  return bytesToText(gs1 && out.startsWith(FNC1) ? out.slice(1) : out);
}

export { versions as HANXIN_VERSIONS };

// ---- Reading from an image -------------------------------------------------

interface Pt {
  x: number;
  y: number;
}
interface Finder extends Pt {
  m: number; // module size
  n: number; // number of hits
}

/**
 * Run lengths along a line of thresholded pixels, into `len` (starts in
 * `start`); returns the number of runs and whether the first run is dark.
 */
function lineRuns(
  dark: (i: number) => boolean,
  n: number,
  start: Int32Array,
  len: Int32Array,
): { count: number; firstDark: boolean } {
  let count = 0;
  let s = 0;
  let cur = n > 0 && dark(0);
  const firstDark = cur;
  for (let i = 1; i <= n; i++) {
    const d = i < n && dark(i);
    if (i === n || d !== cur) {
      start[count] = s;
      len[count++] = i - s;
      s = i;
      cur = d;
    }
  }
  return { count, firstDark };
}

/**
 * Whether runs k..k+4 (k dark) are 1:1:1:1:3 or 3:1:1:1:1; returns the
 * centre of the 3-module run and the module size, or null.
 */
function finderAt(start: Int32Array, len: Int32Array, k: number): { c: number; m: number } | null {
  const a = len[k];
  const b = len[k + 1];
  const c = len[k + 2];
  const d = len[k + 3];
  const e = len[k + 4];
  const m = (a + b + c + d + e) / 7;
  if (m < 1.4) return null;
  const one = (v: number) => Math.abs(v - m) <= m * 0.5 + 0.5;
  const three = (v: number) => Math.abs(v - 3 * m) <= m + 0.5;
  if (one(a) && one(b) && one(c) && one(d) && three(e)) return { c: start[k + 4] + e / 2, m };
  if (three(a) && one(b) && one(c) && one(d) && one(e)) return { c: start[k] + a / 2, m };
  return null;
}

/** Centres of the 3×3 blocks inside the three identical Han Xin finders. */
function findFinders(l: Luma, t: number): Finder[] {
  const { width: w, height: h, data } = l;
  const hits: Finder[] = [];
  const step = Math.max(1, Math.floor(h / 400));
  const rs = new Int32Array(w + 1);
  const rl = new Int32Array(w + 1);
  const cs = new Int32Array(h + 1);
  const cl = new Int32Array(h + 1);
  for (let y = 0; y < h && hits.length < 50000; y += step) {
    const row = y * w;
    const { count, firstDark } = lineRuns((x) => data[row + x] < t, w, rs, rl);
    for (let k = firstDark ? 0 : 1; k + 4 < count; k += 2) {
      const f = finderAt(rs, rl, k);
      if (!f) continue;
      const x = Math.round(f.c);
      // Confirm down the column through the same point (a window around it).
      const reach = Math.ceil(f.m * 9);
      const top = Math.max(0, y - reach);
      const n = Math.min(h, y + reach) - top;
      const col = lineRuns((i) => data[(top + i) * w + x] < t, n, cs, cl);
      let j = 0;
      while (j < col.count && cs[j] + cl[j] <= y - top) j++;
      const darkAt = (q: number) => (q % 2 === 0) === col.firstDark;
      for (const k2 of [j - 4, j]) {
        if (k2 < 0 || k2 + 4 >= col.count || !darkAt(k2)) continue;
        const g = finderAt(cs, cl, k2);
        if (!g) continue;
        const gy = g.c + top;
        if (Math.abs(gy - y) <= g.m * 1.6 && Math.abs(g.m - f.m) <= Math.max(f.m, g.m) * 0.5) {
          hits.push({ x: f.c, y: gy, m: (f.m + g.m) / 2, n: 1 });
          break;
        }
      }
    }
  }
  // Cluster hits of about the same module size that lie close together,
  // through a grid keyed by position and (quantised) module size.
  const out: Finder[] = [];
  const cells = new Map<string, Finder[]>();
  const level = (m: number) => Math.round(Math.log2(m) * 2);
  for (const p of hits) {
    const lv = level(p.m);
    let q: Finder | undefined;
    for (const l2 of [lv, lv - 1, lv + 1]) {
      const cs = 3 * 2 ** (l2 / 2);
      const cx = Math.floor(p.x / cs);
      const cy = Math.floor(p.y / cs);
      for (let dy = -1; dy <= 1 && !q; dy++)
        for (let dx = -1; dx <= 1 && !q; dx++)
          q = cells
            .get(`${l2},${cx + dx},${cy + dy}`)
            ?.find((o) => Math.hypot(o.x / o.n - p.x, o.y / o.n - p.y) < p.m * 2.5);
      if (q) break;
    }
    if (q) {
      q.x += p.x;
      q.y += p.y;
      q.m += p.m;
      q.n++;
    } else {
      const f = { ...p };
      out.push(f);
      const cs = 3 * 2 ** (lv / 2);
      const k = `${lv},${Math.floor(p.x / cs)},${Math.floor(p.y / cs)}`;
      if (!cells.has(k)) cells.set(k, []);
      cells.get(k)!.push(f);
    }
  }
  return out
    .map((o) => ({ x: o.x / o.n, y: o.y / o.n, m: o.m / o.n, n: o.n }))
    .filter((o) => o.n >= 2) // a real finder is crossed by several rows
    .sort((a, b) => b.n - a.n)
    .slice(0, 24); // several codes in one picture: three finders each
}

function sampleAffine(l: Luma, o: Pt, u: Pt, v: Pt, size: number, m: number): Uint8Array {
  const r = Math.max(0, m * 0.22);
  const vals = new Float32Array(size * size);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++)
      vals[y * size + x] = sampleAt(l, o.x + x * u.x + y * v.x, o.y + x * u.y + y * v.y, r);
  const sorted = Array.from(vals).sort((a, b) => a - b);
  const t =
    (sorted[Math.floor(sorted.length * 0.05)] + sorted[Math.floor(sorted.length * 0.95)]) / 2;
  const out = new Uint8Array(size * size);
  for (let i = 0; i < vals.length; i++) out[i] = vals[i] < t ? 1 : 0;
  return out;
}

/** Whether the four corner patterns are where this grid puts them. */
function finderCheck(l: Luma, t: number, o: Pt, u: Pt, v: Pt, size: number): boolean {
  let bad = 0;
  const at = (x: number, y: number) =>
    sampleAt(l, o.x + x * u.x + y * v.x, o.y + x * u.y + y * v.y, 0) < t ? 1 : 0;
  for (let y = 0; y < 7; y++)
    for (let x = 0; x < 7; x++) {
      if (at(x, y) !== FPAT[y][x]) bad++;
      if (at(size - 1 - x, y) !== FPAT[y][x]) bad++;
      if (at(size - 1 - x, size - 1 - y) !== FPAT[y][x]) bad++;
      if (at(x, size - 1 - y) !== FPAT2[y][x]) bad++;
    }
  return bad <= 4 * 49 * 0.2;
}

const SIZES = new Set(versions.map((v) => v.size));

/** Find and decode a Han Xin symbol in an image. */
export function readHanXin(l: Luma): HanXinRead | null {
  const t = otsu(l);
  const fs = findFinders(l, t);
  for (let a = 0; a < fs.length; a++)
    for (let b = 0; b < fs.length; b++)
      for (let c = b + 1; c < fs.length; c++) {
        if (a === b || a === c) continue;
        // a is top-right (the corner between the other two).
        const A = fs[a];
        const B = fs[b];
        const C = fs[c];
        const d1 = Math.hypot(B.x - A.x, B.y - A.y);
        const d2 = Math.hypot(C.x - A.x, C.y - A.y);
        if (Math.abs(d1 - d2) > Math.max(d1, d2) * 0.15) continue;
        const cos = ((B.x - A.x) * (C.x - A.x) + (B.y - A.y) * (C.y - A.y)) / (d1 * d2);
        if (Math.abs(cos) > 0.25) continue;
        const m = (A.m + B.m + C.m) / 3;
        const est = (d1 + d2) / 2 / m + 11;
        // Both handednesses: B or C as top-left (the other is bottom-right).
        for (const [TL, BR] of [
          [B, C],
          [C, B],
        ]) {
          // The module size is only roughly known, so try nearby sizes too,
          // closest first. A wrong size fails fast at the function info.
          const sizes = [...SIZES]
            .filter((s) => Math.abs(s - est) <= Math.max(2.5, est * 0.12))
            .sort((p, q) => Math.abs(p - est) - Math.abs(q - est));
          for (const size of sizes) {
            const n = size - 11;
            const u = { x: (A.x - TL.x) / n, y: (A.y - TL.y) / n };
            const v = { x: (BR.x - A.x) / n, y: (BR.y - A.y) / n };
            const o = { x: TL.x - 5 * u.x - 5 * v.x, y: TL.y - 5 * u.y - 5 * v.y };
            if (!finderCheck(l, t, o, u, v, size)) continue;
            const mods = sampleAffine(l, o, u, v, size, m);
            const r = decodeHanXinMatrix(mods, size);
            if (r) {
              const at = (cx: number, cy: number) => ({
                x: o.x + (cx - 0.5) * u.x + (cy - 0.5) * v.x,
                y: o.y + (cx - 0.5) * u.y + (cy - 0.5) * v.y,
              });
              return { ...r, corners: [at(0, 0), at(size, 0), at(size, size), at(0, size)] };
            }
          }
        }
      }
  return null;
}
