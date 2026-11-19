// Looks at the image around a 1D read for things the decoders missed: more
// rows of bars stacked on it (a Codablock F read as one Code 128 row), a 2D
// composite part above it, or an add-on beside it.

import type { Luma } from './extra/lines';

interface Pt {
  x: number;
  y: number;
}
export interface Quad {
  topLeft: Pt;
  topRight: Pt;
  bottomRight: Pt;
  bottomLeft: Pt;
}

function sampler(l: Luma) {
  return (x: number, y: number) => {
    const xi = Math.round(x);
    const yi = Math.round(y);
    return xi < 0 || yi < 0 || xi >= l.width || yi >= l.height ? 255 : l.data[yi * l.width + xi];
  };
}

function geometry(q: Quad) {
  const left = { x: (q.topLeft.x + q.bottomLeft.x) / 2, y: (q.topLeft.y + q.bottomLeft.y) / 2 };
  const right = {
    x: (q.topRight.x + q.bottomRight.x) / 2,
    y: (q.topRight.y + q.bottomRight.y) / 2,
  };
  const L = Math.hypot(right.x - left.x, right.y - left.y) || 1;
  const u = { x: (right.x - left.x) / L, y: (right.y - left.y) / L };
  // Normal pointing to the symbol's top.
  const n = { x: u.y, y: -u.x };
  const topSide = (q.topLeft.x - q.bottomLeft.x) * n.x + (q.topLeft.y - q.bottomLeft.y) * n.y;
  if (topSide < 0) {
    n.x = -n.x;
    n.y = -n.y;
  }
  const half =
    Math.abs((q.topLeft.x - q.bottomLeft.x) * n.x + (q.topLeft.y - q.bottomLeft.y) * n.y) / 2;
  return { left, u, n, L, half };
}

/** Light/dark profile along a line parallel to the code, `d` pixels towards its top. */
function profile(l: Luma, q: Quad, d: number, from = 0, to = 1, fixed?: number): boolean[] {
  const { left, u, n, L } = geometry(q);
  const get = sampler(l);
  const N = Math.min(1500, Math.max(40, Math.round(L * (to - from))));
  const vals: number[] = [];
  for (let i = 0; i < N; i++) {
    const t = (from + ((to - from) * i) / (N - 1)) * L;
    vals.push(get(left.x + u.x * t + n.x * d, left.y + u.y * t + n.y * d));
  }
  if (fixed !== undefined) return vals.map((v) => v < fixed);
  const s = [...vals].sort((a, b) => a - b);
  const lo = s[Math.floor(N * 0.05)];
  const hi = s[Math.floor(N * 0.95)];
  if (hi - lo < 50) return vals.map(() => false); // no contrast: blank
  const t = (lo + hi) / 2;
  return vals.map((v) => v < t);
}
const transitions = (p: boolean[]) => p.reduce((a, v, i) => a + (i && v !== p[i - 1] ? 1 : 0), 0);
/**
 * How alike two profiles are, allowing a sideways shift: when the code is
 * tilted against the line the decoder reported, its own bars move along as
 * the sampling line moves away from the centre.
 */
function similarity(a: boolean[], b: boolean[], maxShift = 0): number {
  let best = 0;
  for (let k = -maxShift; k <= maxShift; k++) {
    let same = 0;
    let n = 0;
    for (let i = Math.max(0, -k); i < a.length && i + k < b.length; i++) {
      same += a[i] === b[i + k] ? 1 : 0;
      n++;
    }
    if (n > a.length * 0.7) best = Math.max(best, same / n);
  }
  return best;
}

/**
 * An add-on just past the end of the code: a blank gap (7–12 modules, about
 * 7–13% of an EAN-13's length), a short burst of bars (up to about half its
 * length), then blank again, so not a screen edge or a pattern that runs on.
 */
export function barsAfter(l: Luma, q: Quad): boolean {
  // Judge darkness by the code's own ink and paper, so faint patterns (a
  // screen's moiré, paper texture) don't count as bars.
  const { left, u, L } = geometry(q);
  const get = sampler(l);
  const own: number[] = [];
  for (let i = 0; i < 200; i++) {
    const t = (L * i) / 199;
    own.push(get(left.x + u.x * t, left.y + u.y * t));
  }
  own.sort((a, b) => a - b);
  const ink = own[10];
  const paper = own[189];
  if (paper - ink < 50) return false;
  const thr = ink + (paper - ink) * 0.4;
  if (transitions(profile(l, q, 0, 1.01, 1.06, thr)) > 1) return false;
  const t = transitions(profile(l, q, 0, 1.06, 1.68, thr));
  if (t < 8 || t > 60) return false;
  return transitions(profile(l, q, 0, 1.72, 1.9, thr)) <= 2;
}

/**
 * A thin row of bars with another row of bars, as dense as itself, stacked
 * right against it: a row of a stacked code (Codablock F) rather than a code
 * of its own. Ordinary 1D codes are much taller for their length, and the
 * printed text under them is a different kind of pattern.
 */
export function looksLikeStackedRow(l: Luma, q: Quad): boolean {
  const { L } = geometry(q);
  const centre = profile(l, q, 0);
  const t0 = transitions(centre);
  if (t0 < 20) return false;
  const step = Math.max(1, L / 400);
  const shiftAt = (d: number, n: number) => Math.ceil((d * 0.47 * n) / L) + 2;
  // Height of the row's own bars, each side.
  const extent = (side: 1 | -1) => {
    let d = step;
    while (d < L * 0.4) {
      const p = profile(l, q, d * side);
      if (similarity(p, centre, shiftAt(d, p.length)) <= 0.8) break;
      d += step;
    }
    return d;
  };
  const up = extent(1);
  const down = extent(-1);
  const H = up + down;
  if (H / L > 0.13) return false;
  // Look just past the row on each side for another dense row.
  for (const [side, from] of [
    [1, up],
    [-1, down],
  ] as const) {
    for (let d = from; d < from + H * 0.6 + step * 2; d += step) {
      const p = profile(l, q, d * side);
      if (transitions(p) >= t0 * 0.7 && similarity(p, centre, shiftAt(d, p.length)) <= 0.8)
        return true;
    }
  }
  return false;
}

/**
 * Light bars on a dark background read the normal way round: the quiet zone
 * beyond each end of the code is darker than the code itself. zxing-cpp can
 * then read the spaces as bars (backwards) and still find a valid check digit.
 */
export function darkQuietZones(l: Luma, q: Quad): boolean {
  const { left, u, L } = geometry(q);
  const get = sampler(l);
  const along = (from: number, to: number, n = 20) => {
    const v: number[] = [];
    for (let i = 0; i <= n; i++) {
      const t = (from + ((to - from) * i) / n) * L;
      v.push(get(left.x + u.x * t, left.y + u.y * t));
    }
    return v;
  };
  const inside = along(0.02, 0.98, 200).sort((a, b) => a - b);
  const ink = inside[10];
  const paper = inside[190];
  if (paper - ink < 50) return false;
  const mid = (ink + paper) / 2;
  const mean = (v: number[]) => v.reduce((a, b) => a + b, 0) / v.length;
  // Just beyond the ends (0.8–2.2% of the length): inside a quiet zone of a
  // few modules, so a dark page further out doesn't count. A real quiet zone
  // is paper-light on both sides; dark on either side means the read was
  // framed on a light-on-dark code (or overlaps something else).
  return mean(along(-0.022, -0.008)) < mid || mean(along(1.008, 1.022)) < mid;
}

/**
 * The same test for any shape of symbol (stacked ones included): is the thin
 * ring just outside the read's bounding box darker than the box itself?
 */
export function darkSurround(l: Luma, q: Quad): boolean {
  const pts = [q.topLeft, q.topRight, q.bottomRight, q.bottomLeft];
  const x0 = Math.min(...pts.map((p) => p.x));
  const x1 = Math.max(...pts.map((p) => p.x));
  const y0 = Math.min(...pts.map((p) => p.y));
  const y1 = Math.max(...pts.map((p) => p.y));
  const span = Math.max(x1 - x0, y1 - y0);
  const t = Math.max(2, span * 0.012);
  const gap = Math.max(1, span * 0.003);
  let inSum = 0;
  let inN = 0;
  let outSum = 0;
  let outN = 0;
  const step = Math.max(1, Math.floor(span / 300));
  for (let y = Math.floor(y0 - gap - t); y <= y1 + gap + t; y += step) {
    if (y < 0 || y >= l.height) continue;
    for (let x = Math.floor(x0 - gap - t); x <= x1 + gap + t; x += step) {
      if (x < 0 || x >= l.width) continue;
      const v = l.data[y * l.width + x];
      const inside = x >= x0 && x <= x1 && y >= y0 && y <= y1;
      const ring = !inside && (x < x0 - gap || x > x1 + gap || y < y0 - gap || y > y1 + gap);
      if (inside) {
        inSum += v;
        inN++;
      } else if (ring) {
        outSum += v;
        outN++;
      }
    }
  }
  if (!inN || !outN) return false;
  return outSum / outN < inSum / inN - 25;
}
