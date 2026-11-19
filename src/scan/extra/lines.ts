// Image helpers for the extra decoders: greyscale images, scan lines,
// thresholds and bar/space run lengths with sub-pixel edges.

export interface Luma {
  data: Uint8Array | Uint8ClampedArray;
  width: number;
  height: number;
}

export function lumaFromRgba(
  rgba: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number,
): Luma {
  const data = new Uint8Array(width * height);
  for (let i = 0; i < width * height; i++) {
    const a = rgba[i * 4 + 3] / 255;
    // Transparent pixels count as white paper.
    const r = rgba[i * 4] * a + 255 * (1 - a);
    const g = rgba[i * 4 + 1] * a + 255 * (1 - a);
    const b = rgba[i * 4 + 2] * a + 255 * (1 - a);
    data[i] = (r * 299 + g * 587 + b * 114) / 1000;
  }
  return { data, width, height };
}

/** Swap rows and columns, so vertical codes can be read as horizontal ones. */
export function transpose(l: Luma): Luma {
  const out = new Uint8Array(l.width * l.height);
  for (let y = 0; y < l.height; y++) {
    for (let x = 0; x < l.width; x++) out[x * l.height + y] = l.data[y * l.width + x];
  }
  return { data: out, width: l.height, height: l.width };
}

export function row(l: Luma, y: number): Uint8Array {
  return l.data.subarray(y * l.width, (y + 1) * l.width) as Uint8Array;
}

/** Otsu's threshold over a set of 0–255 values. */
export function otsu(values: ArrayLike<number>): number {
  const hist = new Float64Array(256);
  for (let i = 0; i < values.length; i++) hist[values[i] | 0]++;
  const total = values.length;
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * hist[i];
  let sumB = 0;
  let wB = 0;
  let best = 0;
  let threshold = 128;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (!wB) continue;
    const wF = total - wB;
    if (!wF) break;
    sumB += t * hist[t];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) ** 2;
    if (between > best) {
      best = between;
      threshold = t + 0.5;
    }
  }
  return threshold;
}

/** Values at the given fraction of the way through a line's sorted values (via histogram). */
function percentiles(values: ArrayLike<number>, lo: number, hi: number): [number, number] {
  const hist = new Uint32Array(256);
  for (let i = 0; i < values.length; i++) hist[values[i] | 0]++;
  const loN = values.length * lo;
  const hiN = values.length * hi;
  let acc = 0;
  let pLo = 0;
  let pHi = 255;
  let gotLo = false;
  for (let v = 0; v < 256; v++) {
    acc += hist[v];
    if (!gotLo && acc >= loN) {
      pLo = v;
      gotLo = true;
    }
    if (acc >= hiN) {
      pHi = v;
      break;
    }
  }
  return [pLo, pHi];
}

/** Minimum gap between a line's dark and light levels for it to be worth reading. */
export const MIN_CONTRAST = 70;

/** Threshold halfway between the darkest and lightest few percent, or null if there's no real contrast. */
export function lineThreshold(values: ArrayLike<number>): number | null {
  const [lo, hi] = percentiles(values, 0.04, 0.96);
  return hi - lo < MIN_CONTRAST ? null : (lo + hi) / 2;
}

/**
 * Run lengths along one line, starting and ending with a dark run.
 * Edges are placed between pixels by linear interpolation for accuracy
 * when bars are only a couple of pixels wide.
 */
export function runsAlong(values: ArrayLike<number>, threshold?: number): Runs {
  const t = threshold ?? lineThreshold(values);
  if (t === null) return [] as Runs;
  const edges: number[] = [];
  let dark = values[0] < t;
  if (dark) edges.push(0);
  for (let x = 1; x < values.length; x++) {
    const d = values[x] < t;
    if (d !== dark) {
      const a = values[x - 1];
      const b = values[x];
      edges.push(x - 1 + (a === b ? 0.5 : (t - a) / (b - a)));
      dark = d;
    }
  }
  if (dark) edges.push(values.length);
  // edges alternate: dark start, dark end, dark start, ...
  if (edges.length < 2) return [] as Runs;
  const runs: Runs = [];
  for (let i = 1; i < edges.length; i++) runs.push(edges[i] - edges[i - 1]);
  // Light space before the first bar and after the last one.
  runs.lead = edges[0];
  runs.trail = values.length - edges[edges.length - 1];
  return runs; // [bar, space, bar, ..., bar]
}

/** Bar/space runs, plus the light margins either side when known. */
export type Runs = number[] & { lead?: number; trail?: number };

/** Each image row's runs are computed once and shared by every decoder. */
const runCache = new WeakMap<Luma, Map<number, Runs>>();
export function rowRuns(l: Luma, y: number): Runs {
  let m = runCache.get(l);
  if (!m) runCache.set(l, (m = new Map()));
  let r = m.get(y);
  if (!r) m.set(y, (r = runsAlong(row(l, y))));
  return r;
}

/** Crop to a rectangle given as fractions of the image (e.g. a camera viewfinder). */
export function crop(l: Luma, x0: number, y0: number, x1: number, y1: number): Luma {
  const ax = Math.floor(l.width * x0);
  const ay = Math.floor(l.height * y0);
  const w = Math.max(1, Math.floor(l.width * x1) - ax);
  const h = Math.max(1, Math.floor(l.height * y1) - ay);
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++)
    out.set(l.data.subarray((ay + y) * l.width + ax, (ay + y) * l.width + ax + w), y * w);
  return { data: out, width: w, height: h };
}

/** Split a run list at wide light gaps, so separate codes or text become separate segments. */
export function segments(runs: number[]): number[][] {
  return segmentsWithGaps(runs).map((s) => s.runs);
}

export interface Segment {
  runs: number[];
  /** Light space before and after the segment (0 when unknown). */
  before: number;
  after: number;
}

/**
 * Pieces of a line that could each be one barcode: the whole line, the line
 * split at unusually wide spaces, and the line without a surrounding frame.
 */
export function segmentsWithGaps(runs: Runs): Segment[] {
  if (runs.length < 3) return [];
  const lead = runs.lead ?? 0;
  const trail = runs.trail ?? 0;
  const out: Segment[] = [{ runs, before: lead, after: trail }];
  const sorted = [...runs].sort((a, b) => a - b);
  const median = sorted[sorted.length >> 1];
  for (const factor of [5, 9]) {
    let start = 0;
    const gap = median * factor;
    for (let i = 1; i < runs.length; i += 2) {
      if (runs[i] > gap) {
        if (i - start >= 3)
          out.push({
            runs: runs.slice(start, i),
            before: start ? runs[start - 1] : lead,
            after: runs[i],
          });
        start = i + 1;
      }
    }
    if (start > 0 && runs.length - start >= 3)
      out.push({ runs: runs.slice(start), before: runs[start - 1], after: trail });
  }
  // A frame drawn around some codes (e.g. Pharmacode) shows up as a thin bar
  // and a wide gap at each end: also try without it.
  if (runs.length > 7 && runs[1] > median * 3 && runs[runs.length - 2] > median * 3) {
    out.push({
      runs: runs.slice(2, runs.length - 2),
      before: runs[1],
      after: runs[runs.length - 2],
    });
  }
  const seen = new Set<string>();
  return out.filter(({ runs: s }) => {
    const k = `${s.length}:${s[0]}:${s[s.length - 1]}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** Evenly spread line positions across a dimension, centre first. */
export function samplePositions(size: number, count: number): number[] {
  const out = [Math.floor(size / 2)];
  for (let i = 1; i <= count; i++) {
    const p = Math.floor((size * i) / (count + 1));
    if (!out.includes(p)) out.push(p);
  }
  return out;
}

/**
 * Turn measured runs into whole module widths.
 *
 * The module size comes from bar+space pairs: ink spread and blur make bars
 * fatter and spaces thinner by the same amount, so each pair's total is
 * still a whole number of modules. The bars' shared offset is then found
 * from the fractional parts and removed before rounding.
 */
export function quantize(runs: number[], allowed: number[]): number[] | null {
  return quantizeAll(runs, allowed)[0] ?? null;
}

/**
 * Like quantize, but when bars are spread by close to half a module or more,
 * a bar+space pair like 5px + 4px at 3px/module could be 2+1 or 1+2 modules.
 * Both readings fit equally well, so return both and let the decoder's
 * verification pick the right one.
 */
export function quantizeAll(runs: number[], allowed: number[]): number[][] {
  if (runs.length < 3) return [];
  const maxW = Math.max(...allowed);
  const pairs: number[] = [];
  for (let i = 0; i + 1 < runs.length; i++) pairs.push(runs[i] + runs[i + 1]);
  const minPair = Math.min(...pairs);
  const nearest = (v: number) => {
    let best = allowed[0];
    for (const w of allowed) if (Math.abs(v - w) < Math.abs(v - best)) best = w;
    return best;
  };
  const withPhase = (x: number, phase: number) => {
    const out: number[] = [];
    let err = 0;
    for (let i = 0; i < runs.length; i++) {
      const v = runs[i] / x + (i % 2 ? phase : -phase);
      const q = nearest(v);
      err += Math.abs(v - q);
      out.push(q);
    }
    return { out, err: err / runs.length };
  };

  const candidates: { out: number[]; err: number; x: number }[] = [];
  for (let k = 2; k <= 2 * maxW; k++) {
    const x0 = minPair / k;
    // Refine the module size from whole-module pair totals.
    let modules = 0;
    let width = 0;
    let ok = true;
    for (const p of pairs) {
      const m = Math.round(p / x0);
      if (m < 2 || m > 2 * maxW) {
        ok = false;
        break;
      }
      modules += m;
      width += p;
    }
    if (!ok) continue;
    const x = width / modules;
    // Shared bar offset (ink spread) from the circular mean of fractional
    // parts. It's only known modulo one module, so also try it a whole
    // module the other way: with heavy spread a 5px bar + 4px space at
    // 3px/module could be 2+1 or 1+2 modules.
    let sin = 0;
    let cos = 0;
    for (let i = 0; i < runs.length; i += 2) {
      const a = (2 * Math.PI * runs[i]) / x;
      sin += Math.sin(a);
      cos += Math.cos(a);
    }
    const phase = Math.atan2(sin, cos) / (2 * Math.PI);
    candidates.push({ ...withPhase(x, phase), x });
    if (Math.abs(phase) > 0.2) candidates.push({ ...withPhase(x, phase - Math.sign(phase)), x });
  }
  // Best fits first; prefer the larger module size when fits are about equal (x/2 always fits too).
  const good = candidates.filter((c) => c.err <= 0.3);
  good.sort((a, b) => (Math.abs(a.err - b.err) < 0.03 ? b.x - a.x : a.err - b.err));
  const seen = new Set<string>();
  const out: number[][] = [];
  for (const c of good) {
    const key = c.out.join(',');
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(c.out);
    if (out.length === 3) break;
  }
  return out;
}

/** Rotate 90° clockwise. */
export function rotate90(l: Luma): Luma {
  const out = new Uint8Array(l.width * l.height);
  for (let y = 0; y < l.height; y++) {
    for (let x = 0; x < l.width; x++)
      out[x * l.height + (l.height - 1 - y)] = l.data[y * l.width + x];
  }
  return { data: out, width: l.height, height: l.width };
}

/** bwip-js reports widths as floats and sometimes ends on a trailing space. */
export function normaliseSbs(sbs: number[]): number[] {
  const out = sbs.map((v) => Math.round(v));
  if (out.length % 2 === 0) out.pop();
  return out;
}

export const same = (a: number[], b: number[]) =>
  a.length === b.length && a.every((v, i) => v === b[i]);
