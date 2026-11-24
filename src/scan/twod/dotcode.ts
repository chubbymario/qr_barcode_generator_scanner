// DotCode (AIM ISS DotCode): a checkerboard of dots read from an image.
// Codeword layout, masking, interleaved Reed-Solomon over GF(113) and the
// code sets mirror BWIPP's encoder (bwip-js), which draws this app's codes.

import { primeField, rsCorrect } from './rs';
import { bytesToText } from './text';
import { otsu } from './grid';
import { bracketAIs } from '../gs1cc';
import type { Luma } from '../extra/lines';

const GF113 = primeField(113, 3);

// 5-of-9 dot patterns for codeword values 0–112.
const ENCS = (
  '101010101 010101011 010101101 010110101 011010101 101010110 101011010 101101010 110101010 ' +
  '010101110 010110110 010111010 011010110 011011010 011101010 100101011 100101101 100110101 ' +
  '101001011 101001101 101010011 101011001 101100101 101101001 110010101 110100101 110101001 ' +
  '001010111 001011011 001011101 001101011 001101101 001110101 010010111 010011011 010011101 ' +
  '010100111 010110011 010111001 011001011 011001101 011010011 011011001 011100101 011101001 ' +
  '100101110 100110110 100111010 101001110 101011100 101100110 101101100 101110010 101110100 ' +
  '110010110 110011010 110100110 110101100 110110010 110110100 111001010 111010010 111010100 ' +
  '001011110 001101110 001110110 001111010 010011110 010111100 011001110 011011100 011100110 ' +
  '011101100 011110010 011110100 100010111 100011011 100011101 100100111 100110011 100111001 ' +
  '101000111 101100011 101110001 110001011 110001101 110010011 110011001 110100011 110110001 ' +
  '111000101 111001001 111010001 000101111 000110111 000111011 000111101 001001111 001100111 ' +
  '001110011 001111001 010001111 011000111 011100011 011110001 100011110 100111100 101111000 ' +
  '110001110 110011100 110111000 111000110 111001100'
).split(' ');
const DECS = new Map(ENCS.map((p, v) => [parseInt(p, 2), v]));
const MASKVALS = [0, 3, 7, 17];

export interface DotCodeRead {
  text: string;
  /** The data as GS1 element strings, for GS1 data (it starts with digits). */
  gs1?: string;
  rows: number;
  cols: number;
  errors: number;
  /** Corners in image pixels, when read from an image. */
  corners?: { x: number; y: number }[];
}

/** Symbol capacity for a rows × cols symbol. */
function capacity(rows: number, cols: number) {
  const ndots = Math.floor((rows * cols) / 2);
  let nd = 0;
  while ((nd + 1 + Math.floor((nd + 1) / 2) + 3) * 9 + 2 <= ndots) nd++;
  const nc = Math.floor(nd / 2) + 3;
  return { ndots, nd, nc, nw: nd + nc };
}

function sixEdges(rows: number, cols: number): [number, number][] {
  return rows % 2 === 0
    ? [
        [cols - 1, rows - 2],
        [0, rows - 2],
        [cols - 2, rows - 1],
        [1, rows - 1],
        [cols - 1, 0],
        [0, 0],
      ]
    : [
        [cols - 2, 0],
        [cols - 2, rows - 1],
        [cols - 1, 1],
        [cols - 1, rows - 2],
        [0, 0],
        [0, rows - 1],
      ];
}

/** Decode a dot matrix (row-major, 1 = dot). */
export function decodeDotCodeMatrix(
  mods: ArrayLike<number>,
  rows: number,
  cols: number,
): DotCodeRead | null {
  if (rows < 5 || cols < 5 || (rows + cols) % 2 !== 1) return null;
  const { ndots, nd, nw } = capacity(rows, cols);
  if (nd < 1) return null;
  // Dots never sit where x + y is odd.
  let stray = 0;
  for (let y = 0; y < rows; y++)
    for (let x = (y + 1) % 2; x < cols; x += 2) if (mods[y * cols + x]) stray++;
  if (stray > ndots * 0.05) return null;
  // Walk the symbol: columns top-down when rows is even, otherwise rows
  // left-right from the bottom; the six edge dots carry the last six bits.
  const edges = sixEdges(rows, cols);
  const edgeSet = new Set(edges.map(([x, y]) => y * cols + x));
  const bits: number[] = [];
  const take = (x: number, y: number) => {
    const i = y * cols + x;
    if ((x + y) % 2 === 0 && !edgeSet.has(i)) bits.push(mods[i] ? 1 : 0);
  };
  if (rows % 2 === 0) {
    for (let x = 0; x < cols; x++) for (let y = 0; y < rows; y++) take(x, y);
  } else {
    for (let y = rows - 1; y >= 0; y--) for (let x = 0; x < cols; x++) take(x, y);
  }
  bits.length = ndots - 6;
  for (const [x, y] of edges) bits.push(mods[y * cols + x] ? 1 : 0);
  // Codewords: 2 mask bits (codeword 0), then 9-bit patterns.
  const cws = [bits[0] * 2 + bits[1]];
  let erasures = 0;
  for (let i = 0; i < nw; i++) {
    let p = 0;
    for (let b = 0; b < 9; b++) p = p * 2 + bits[2 + i * 9 + b];
    const v = DECS.get(p);
    if (v === undefined) erasures++;
    cws.push(v ?? 0);
  }
  if (erasures > nw / 3) return null;
  // Interleaved Reed-Solomon blocks.
  const step = Math.floor(nw / 112) + 1;
  let errors = 0;
  for (let s = 0; s < step; s++) {
    const ND = Math.ceil((nd + 1 - s) / step);
    const NW = Math.ceil((nw + 1 - s) / step);
    const pos: number[] = [];
    for (let k = 0; k < NW; k++) pos.push(s + k * step);
    const block = pos.map((p) => cws[p]);
    const fixed = rsCorrect(
      GF113,
      block,
      NW - ND,
      1,
      Math.floor((NW - ND) / 2) - (NW - ND < 10 ? 1 : 0),
    );
    if (!fixed) return null;
    pos.forEach((p, k) => {
      if (cws[p] !== fixed[k]) errors++;
      cws[p] = fixed[k];
    });
  }
  const mask = cws[0];
  if (mask > 3) return null;
  const mv = MASKVALS[mask];
  const data: number[] = [];
  for (let k = 0; k < nd; k++) data.push((((cws[1 + k] - k * mv) % 113) + 113) % 113);
  const parsed = parseCodewords(data);
  if (!parsed) return null;
  return { ...parsed, rows, cols, errors };
}

const FNC1 = '\u001d';
const A = 0;
const B = 1;
const C = 2;
const BIN = 3;

const charA = (v: number) =>
  v < 64 ? String.fromCharCode(v + 32) : v < 96 ? String.fromCharCode(v - 64) : null;
const charB = (v: number) =>
  v < 96
    ? String.fromCharCode(v + 32)
    : (({ 96: '\r\n', 97: '\t', 98: '\x1c', 99: '\x1d', 100: '\x1e' } as Record<number, string>)[
        v
      ] ?? null);

/** The data codewords as text (bytes kept as Latin-1 until the end). */
function parseCodewords(cws: number[]): { text: string; gs1?: string } | null {
  let out = '';
  let gs1 = false;
  let mode = C;
  let i = 0;
  let segStart = 0; // codeword index where the current segment began
  let trailer = '';
  let bin: number[] = [];
  const flushBin = () => {
    if (bin.length === 1) return false;
    if (bin.length) {
      let n = 0;
      for (const d of bin) n = n * 103 + d;
      const vals: number[] = [];
      for (let k = 0; k < bin.length - 1; k++) {
        vals.unshift(n % 259);
        n = Math.floor(n / 259);
      }
      for (let k = 0; k < vals.length; k++) {
        const v = vals[k];
        if (v < 256) out += String.fromCharCode(v);
        else k += v - 255; // ECI designator: skip its value bytes
      }
      bin = [];
    }
    return true;
  };
  const eci = () => {
    // FNC2 in code sets A–C: one codeword below 40, else three.
    const v = cws[i++];
    if (v === undefined) return false;
    if (v >= 40) i += 2;
    return i <= cws.length;
  };
  const fnc = (v: number): boolean => {
    // 107 FNC1, 108 FNC2 (ECI), 109 FNC3 (new segment)
    if (v === 107) {
      // At the start, FNC1 marks digits that are *not* GS1 data.
      if (!(i - 1 === segStart && mode === C)) out += FNC1;
    } else if (v === 108) return eci();
    else {
      out += trailer;
      trailer = '';
      mode = C;
      segStart = i;
    }
    return true;
  };
  /** One code set C codeword (digits or FNC); used by C and C shifts. */
  const oneC = (v: number): boolean => {
    if (v < 100) out += String(v).padStart(2, '0');
    else if (v >= 107 && v <= 109) return fnc(v);
    else return false;
    return true;
  };
  const shiftB = (n: number) => {
    for (let k = 0; k < n; k++) {
      const x = cws[i++] ?? -1;
      // A shifted run can include FNC1–3 (bwip-js writes "X^FNC1" this way).
      if (x >= 107 && x <= 109) {
        if (!fnc(x)) return false;
        continue;
      }
      const c = charB(x);
      if (c === null) return false;
      out += c;
    }
    return true;
  };
  const shiftC = (n: number) => {
    for (let k = 0; k < n; k++) if (!oneC(cws[i++] ?? -1)) return false;
    return true;
  };
  const binShift = (v: number) => {
    const x = cws[i++];
    if (x === undefined) return false;
    const c = v === 110 ? charA(x) : charB(x);
    if (c === null || c.length !== 1) return false;
    out += String.fromCharCode(c.charCodeAt(0) + 128);
    return true;
  };
  while (i < cws.length) {
    const v = cws[i++];
    let ok = true;
    if (mode === BIN) {
      if (v < 103) {
        bin.push(v);
        if (bin.length === 6) flushBin();
        continue;
      }
      if (!flushBin()) return null;
      if (v <= 108) ok = shiftC(v - 101);
      else if (v === 109) mode = A;
      else if (v === 110) mode = B;
      else if (v === 111) mode = C;
      else {
        out += trailer;
        trailer = '';
        mode = C;
        segStart = i;
      }
    } else if (mode === C) {
      // Digits straight away mean GS1 data (an implied FNC1 in first position).
      if (i === 1 && v <= 100) gs1 = true;
      if (v < 100) out += String(v).padStart(2, '0');
      else if (v === 100) {
        // 17xxxxxx10 macro
        const p = cws.slice(i, i + 3);
        if (p.length < 3 || p.some((x) => x > 99)) return null;
        out += '17' + p.map((x) => String(x).padStart(2, '0')).join('') + '10';
        i += 3;
      } else if (v === 101) mode = A;
      else if (v <= 105) ok = shiftB(v - 101);
      else if (v === 106) {
        mode = B;
        // Structured data macros come straight after a segment's opening latch.
        if (i - 1 === segStart && cws[i] >= 97 && cws[i] <= 100) {
          const m = cws[i++];
          if (m === 100) {
            const d = [charB(cws[i++] ?? -1), charB(cws[i++] ?? -1)];
            if (d.some((c) => c === null || !/\d/.test(c))) return null;
            out += '[)>\x1e' + d.join('');
            trailer = '\x04';
          } else {
            out += '[)>\x1e' + ['05', '06', '12'][m - 97] + '\x1d';
            trailer = '\x1e\x04';
          }
        }
      } else if (v <= 109) ok = fnc(v);
      else if (v <= 111) ok = binShift(v);
      else mode = BIN;
    } else {
      // Code sets A and B.
      const ch = mode === A ? charA(v) : charB(v);
      if (ch !== null && (mode === A ? v < 96 : v <= 100)) out += ch;
      else if (mode === A && v >= 96 && v <= 101) ok = shiftB(v - 95);
      else if (mode === B && v === 101) {
        const c = charA(cws[i++] ?? -1);
        ok = c !== null;
        if (c) out += c;
      } else if (v === 102) mode = mode === A ? B : A;
      else if (v >= 103 && v <= 105) ok = shiftC(v - 101);
      else if (v === 106) mode = C;
      else if (v <= 109) ok = fnc(v);
      else if (v <= 111) ok = binShift(v);
      else mode = BIN;
    }
    if (!ok) return null;
  }
  if (mode === BIN && !flushBin()) return null;
  out += trailer;
  const text = bytesToText(out);
  return { text, gs1: gs1 ? (bracketAIs(out) ?? undefined) : undefined };
}

// ---- Reading from an image -------------------------------------------------

interface Dot {
  x: number;
  y: number;
  d: number; // diameter
}

/** Small round dark blobs: the candidate dots. */
function findDots(l: Luma, t: number): Dot[] {
  const { width: w, height: h, data } = l;
  const seen = new Uint8Array(w * h);
  const dots: Dot[] = [];
  const stack: number[] = [];
  const maxSide = Math.max(4, Math.min(w, h) / 12);
  for (let s = 0; s < w * h; s++) {
    if (seen[s] || data[s] >= t) continue;
    let n = 0;
    let sx = 0;
    let sy = 0;
    let x0 = w;
    let x1 = 0;
    let y0 = h;
    let y1 = 0;
    stack.push(s);
    seen[s] = 1;
    while (stack.length) {
      const p = stack.pop()!;
      const x = p % w;
      const y = (p - x) / w;
      n++;
      sx += x;
      sy += y;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
      if (x > 0 && !seen[p - 1] && data[p - 1] < t) {
        seen[p - 1] = 1;
        stack.push(p - 1);
      }
      if (x < w - 1 && !seen[p + 1] && data[p + 1] < t) {
        seen[p + 1] = 1;
        stack.push(p + 1);
      }
      if (y > 0 && !seen[p - w] && data[p - w] < t) {
        seen[p - w] = 1;
        stack.push(p - w);
      }
      if (y < h - 1 && !seen[p + w] && data[p + w] < t) {
        seen[p + w] = 1;
        stack.push(p + w);
      }
    }
    const bw = x1 - x0 + 1;
    const bh = y1 - y0 + 1;
    if (bw > maxSide || bh > maxSide || bw < 2 || bh < 2) continue;
    if (Math.max(bw, bh) > Math.min(bw, bh) * 1.7) continue;
    if (n < bw * bh * 0.45) continue;
    dots.push({ x: sx / n, y: sy / n, d: (bw + bh) / 2 });
  }
  return dots;
}

const median = (a: number[]) => {
  const s = [...a].sort((p, q) => p - q);
  return s[s.length >> 1];
};

/** Find and decode a DotCode symbol in an image. */
export function readDotCode(l: Luma): DotCodeRead | null {
  const t = otsu(l);
  // Dots that touch side by side (a code turned near 45°, or ink spread)
  // join into one blob: then try again with only the dots' darker cores.
  let dark = 255;
  for (let i = 0; i < l.data.length; i += 7) if (l.data[i] < dark) dark = l.data[i];
  for (const tt of [t, (t + dark) / 2]) {
    const r = readDotsAt(l, tt);
    if (r) return r;
  }
  return null;
}

function readDotsAt(l: Luma, t: number): DotCodeRead | null {
  const all = findDots(l, t);
  // Far more blobs than the biggest DotCode has dots: a texture, not a code.
  if (all.length < 12 || all.length > 25000) return null;
  // Group by dot size: the symbol's dots are all alike.
  // The symbol's dots are all alike in size; other specks in the picture can
  // outnumber them, so try the most common sizes in turn.
  const counts = new Map<number, number>();
  for (const d of all) counts.set(Math.round(d.d), (counts.get(Math.round(d.d)) ?? 0) + 1);
  const sizes = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([s]) => s);
  const tried: number[] = [];
  for (const dsize of [median(all.map((d) => d.d)), ...sizes]) {
    if (tried.some((t) => Math.abs(t - dsize) <= Math.max(1, dsize * 0.2))) continue;
    if (tried.length >= 3) break;
    tried.push(dsize);
    const r = readDotsOfSize(all, dsize);
    if (r) return r;
  }
  return null;
}

function readDotsOfSize(all: Dot[], dsize: number): DotCodeRead | null {
  const dots = all.filter((d) => Math.abs(d.d - dsize) <= Math.max(1.5, dsize * 0.45));
  if (dots.length < 12) return null;
  // Spatial hash for neighbour queries.
  const cell = dsize * 4;
  const grid = new Map<number, number[]>();
  const key = (x: number, y: number) => Math.floor(y / cell) * 100003 + Math.floor(x / cell);
  dots.forEach((d, i) => {
    const k = key(d.x, d.y);
    if (!grid.has(k)) grid.set(k, []);
    grid.get(k)!.push(i);
  });
  const near = (i: number, r: number) => {
    const d = dots[i];
    const out: number[] = [];
    const cx = Math.floor(d.x / cell);
    const cy = Math.floor(d.y / cell);
    const span = Math.ceil(r / cell);
    for (let gy = cy - span; gy <= cy + span; gy++)
      for (let gx = cx - span; gx <= cx + span; gx++)
        for (const j of grid.get(gy * 100003 + gx) ?? []) {
          const dx = dots[j].x - d.x;
          const dy = dots[j].y - d.y;
          if (j !== i && dx * dx + dy * dy <= r * r) out.push(j);
        }
    return out;
  };
  // Nearest-neighbour distance is the diagonal pitch (module × √2).
  const nn: number[] = [];
  const angles: number[] = [];
  const nnOf = new Float64Array(dots.length);
  for (let i = 0; i < dots.length; i++) {
    let best = Infinity;
    let bj = -1;
    for (const j of near(i, dsize * 4)) {
      const dx = dots[j].x - dots[i].x;
      const dy = dots[j].y - dots[i].y;
      const dd = dx * dx + dy * dy;
      if (dd < best) {
        best = dd;
        bj = j;
      }
    }
    nnOf[i] = Math.sqrt(best);
    if (bj >= 0) {
      nn.push(Math.sqrt(best));
      angles.push(Math.atan2(dots[bj].y - dots[i].y, dots[bj].x - dots[i].x));
    }
  }
  if (nn.length < 10) return null;
  const pitch = median(nn);
  const m = pitch / Math.SQRT2;
  // Grid angle: diagonal neighbours lie at 45° + k·90°.
  let sx = 0;
  let sy = 0;
  angles.forEach((a, k) => {
    if (Math.abs(nn[k] - pitch) > pitch * 0.25) return;
    sx += Math.cos(4 * (a - Math.PI / 4));
    sy += Math.sin(4 * (a - Math.PI / 4));
  });
  const theta = Math.atan2(sy, sx) / 4;
  // Clusters of dots linked within a few modules.
  const parent = dots.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (let i = 0; i < dots.length; i++) for (const j of near(i, m * 3.2)) parent[find(i)] = find(j);
  const groups = new Map<number, number[]>();
  dots.forEach((_, i) => {
    const r = find(i);
    if (!groups.has(r)) groups.set(r, []);
    groups.get(r)!.push(i);
  });
  const clusters = [...groups.values()]
    .filter((g) => g.length >= 12 && g.length <= 20000) // DotCode has at most 20,000 dots
    .sort((a, b) => b.length - a.length);
  for (const g of clusters.slice(0, 4)) {
    // A symbol's dots almost all have a neighbour one diagonal step away;
    // scattered blobs (noise, texture) don't.
    const regular = g.filter((i) => Math.abs(nnOf[i] - pitch) <= pitch * 0.2).length;
    if (regular < g.length * 0.6) continue;
    for (const turn of [0, Math.PI / 4, -Math.PI / 4]) {
      // The angle is from the dots' diagonal neighbours; if it's off, try the
      // other diagonal reading too.
      const cos = Math.cos(-theta - turn);
      const sin = Math.sin(-theta - turn);
      const pts = g.map((i) => ({
        x: dots[i].x * cos - dots[i].y * sin,
        y: dots[i].x * sin + dots[i].y * cos,
      }));
      const r = fitAndDecode(pts, turn ? m * Math.SQRT2 : m);
      if (r) {
        // Back from the upright frame to the image.
        const back = (p: { x: number; y: number }) => ({
          x: p.x * cos + p.y * sin,
          y: -p.x * sin + p.y * cos,
        });
        return { ...r.read, corners: r.corners.map(back) };
      }
    }
  }
  return null;
}

/**
 * Fit a grid to dot centres (roughly upright, pitch about `m`) and decode.
 * The pitch from nearest neighbours is only roughly right, and over 100
 * columns a 1% error is a whole column, so the grid is fitted by least
 * squares (an affine map, which also takes up leftover tilt and skew), and
 * sizes one column or row either side are tried too.
 */
function fitAndDecode(
  pts: { x: number; y: number }[],
  m0: number,
): { read: DotCodeRead; corners: { x: number; y: number }[] } | null {
  // A better pitch: the mean step between diagonal neighbours.
  let m = m0;
  {
    const sorted = [...pts].sort((a, b) => a.x - b.x);
    let sum = 0;
    let n = 0;
    for (let i = 0; i < sorted.length; i++)
      for (let j = i + 1; j < sorted.length && sorted[j].x - sorted[i].x < m0 * 1.4; j++) {
        const dx = Math.abs(sorted[j].x - sorted[i].x);
        const dy = Math.abs(sorted[j].y - sorted[i].y);
        if (dx > m0 * 0.6 && dy > m0 * 0.6 && dx < m0 * 1.4 && dy < m0 * 1.4) {
          sum += dx + dy;
          n += 2;
        }
      }
    if (n > 10) m = sum / n;
  }
  // Start from the dot nearest the middle, and grow the fit outwards.
  const cx = pts.reduce((a, p) => a + p.x, 0) / pts.length;
  const cy = pts.reduce((a, p) => a + p.y, 0) / pts.length;
  const o = pts.reduce((best, p) =>
    Math.hypot(p.x - cx, p.y - cy) < Math.hypot(best.x - cx, best.y - cy) ? p : best,
  );
  // Affine map grid (u, v) -> image: x = a0 + a1 u + a2 v, y = b0 + b1 u + b2 v.
  let A = [o.x, m, 0];
  let B = [o.y, 0, m];
  const maxR = Math.max(...pts.map((p) => Math.hypot(p.x - o.x, p.y - o.y)));
  let uv: { u: number; v: number; p: { x: number; y: number } }[] = [];
  // Distances from the middle dot, to take at least 12 dots in the first rounds.
  const dists = pts.map((p) => Math.hypot(p.x - o.x, p.y - o.y)).sort((a, b) => a - b);
  const minR = dists[Math.min(dists.length - 1, 11)];
  for (const frac of [0.25, 0.5, 0.75, 1, 1]) {
    const inv = invert(A, B);
    if (!inv) return null;
    uv = [];
    const reach = Math.max(maxR * frac, minR) + 1;
    for (const p of pts) {
      if (Math.hypot(p.x - o.x, p.y - o.y) > reach) continue;
      const u = Math.round(inv.u(p));
      const v = Math.round(inv.v(p));
      uv.push({ u, v, p });
    }
    const fit = fitAffine(uv);
    if (!fit) return null;
    [A, B] = fit;
  }
  // A real symbol's dots sit on the grid; scattered blobs don't.
  const invF = invert(A, B);
  if (!invF) return null;
  let on = 0;
  for (const q of uv) {
    const du = invF.u(q.p) - q.u;
    const dv = invF.v(q.p) - q.v;
    if (Math.abs(du) < 0.25 && Math.abs(dv) < 0.25) on++;
  }
  if (on < uv.length * 0.85) return null;
  const us = uv.map((q) => q.u);
  const vs = uv.map((q) => q.v);
  const u0 = Math.min(...us);
  const v0 = Math.min(...vs);
  const cols0 = Math.max(...us) - u0 + 1;
  const rows0 = Math.max(...vs) - v0 + 1;
  // The dots fix the grid; the size can still be one out if an edge dot was lost.
  for (const [dc, dr, ou, ov] of [
    [0, 0, 0, 0],
    [1, 0, 0, 0],
    [1, 0, -1, 0],
    [0, 1, 0, 0],
    [0, 1, 0, -1],
  ]) {
    const cols = cols0 + dc;
    const rows = rows0 + dr;
    if (cols < 5 || rows < 5 || cols > 210 || rows > 210 || (rows + cols) % 2 !== 1) continue;
    const mods = new Uint8Array(rows * cols);
    for (const q of uv) mods[(q.v - v0 - ov) * cols + (q.u - u0 - ou)] = 1;
    const read = decodeOriented(mods, rows, cols);
    if (read) {
      const at = (u: number, v: number) => ({
        x: A[0] + A[1] * u + A[2] * v,
        y: B[0] + B[1] * u + B[2] * v,
      });
      const U0 = u0 + ou - 0.5;
      const V0 = v0 + ov - 0.5;
      return {
        read,
        corners: [at(U0, V0), at(U0 + cols, V0), at(U0 + cols, V0 + rows), at(U0, V0 + rows)],
      };
    }
  }
  return null;
}

function invert(A: number[], B: number[]) {
  const det = A[1] * B[2] - A[2] * B[1];
  if (Math.abs(det) < 1e-9) return null;
  return {
    u: (p: { x: number; y: number }) => ((p.x - A[0]) * B[2] - (p.y - B[0]) * A[2]) / det,
    v: (p: { x: number; y: number }) => ((p.y - B[0]) * A[1] - (p.x - A[0]) * B[1]) / det,
  };
}

/** Least-squares affine fit of image points to integer grid positions. */
function fitAffine(
  q: { u: number; v: number; p: { x: number; y: number } }[],
): [number[], number[]] | null {
  if (q.length < 6) return null;
  // Normal equations for [1 u v] against x and against y.
  const M = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];
  const bx = [0, 0, 0];
  const by = [0, 0, 0];
  for (const { u, v, p } of q) {
    const r = [1, u, v];
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3; j++) M[i][j] += r[i] * r[j];
      bx[i] += r[i] * p.x;
      by[i] += r[i] * p.y;
    }
  }
  const solve = (b: number[]) => {
    const a = M.map((row, i) => [...row, b[i]]);
    for (let c = 0; c < 3; c++) {
      let piv = c;
      for (let r = c + 1; r < 3; r++) if (Math.abs(a[r][c]) > Math.abs(a[piv][c])) piv = r;
      [a[c], a[piv]] = [a[piv], a[c]];
      if (Math.abs(a[c][c]) < 1e-9) return null;
      for (let r = 0; r < 3; r++) {
        if (r === c) continue;
        const f = a[r][c] / a[c][c];
        for (let k = c; k < 4; k++) a[r][k] -= f * a[c][k];
      }
    }
    return [a[0][3] / a[0][0], a[1][3] / a[1][1], a[2][3] / a[2][2]];
  };
  const X = solve(bx);
  const Y = solve(by);
  return X && Y ? [X, Y] : null;
}

/** Try the eight orientations of a sampled dot grid. */
function decodeOriented(mods: Uint8Array, rows: number, cols: number): DotCodeRead | null {
  for (const transpose of [false, true])
    for (const fx of [false, true])
      for (const fy of [false, true]) {
        const R = transpose ? cols : rows;
        const Cn = transpose ? rows : cols;
        const out = new Uint8Array(R * Cn);
        for (let y = 0; y < R; y++)
          for (let x = 0; x < Cn; x++) {
            let sx = transpose ? y : x;
            let sy = transpose ? x : y;
            if (fx) sx = cols - 1 - sx;
            if (fy) sy = rows - 1 - sy;
            out[y * Cn + x] = mods[sy * cols + sx];
          }
        const r = decodeDotCodeMatrix(out, R, Cn);
        if (r) return r;
      }
  return null;
}
