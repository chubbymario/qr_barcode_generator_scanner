// Decoders for height-modulated codes: 4-state postal barcodes, POSTNET/PLANET
// and two-track Pharmacode. Each bar is classified as Full, Ascender,
// Descender or Tracker, then decoded and verified by re-encoding with bwip-js.

import { lineThreshold, type Luma } from './lines';
import { tryRaw, type BwipRaw } from './types';
import { BARMAP, TAB213, TAB513 } from './tables';

export interface BarRead {
  states: string; // e.g. "FADT..."
  /** False when some bar was close to the line between two states. */
  sure?: boolean;
  /** Mean bar height over mean bar width: real postal bars are tall and thin. */
  aspect?: number;
  spaceToBar: number; // mean space width / mean bar width
}

/**
 * Full / Ascender / Descender / Tracker for each bar, judged against the
 * symbol's overall extent, so the result doesn't depend on which bar types
 * happen to appear (a code with no tracker-only bars still classifies right).
 */
function classify(
  tops: number[],
  bottoms: number[],
  upIsLess: boolean,
  out?: { sure: boolean },
): string {
  const dir = upIsLess ? 1 : -1;
  // Work in "up is less" terms.
  const T = tops.map((v) => v * dir);
  const B = bottoms.map((v) => v * dir);
  const pct = (v: number[], p: number) =>
    [...v].sort((a, b) => a - b)[Math.round((v.length - 1) * p)];
  const hi0 = pct(T, 0.1);
  const lo0 = pct(B, 0.9);
  const H0 = Math.abs(lo0 - hi0) || 1;
  // Fit a straight line through the bars that reach each edge, so a slight
  // remaining tilt doesn't matter. Percentiles (not extremes) pick the edges,
  // because in a blurry photo a bar can run into the printed text below it.
  const fit = (v: number[], ref: number) => {
    const pts = v.map((y, i) => [i, y]).filter(([, y]) => Math.abs(y - ref) < 0.3 * H0);
    if (pts.length < 3) return () => ref;
    const n = pts.length;
    const mx = pts.reduce((a, [x]) => a + x, 0) / n;
    const my = pts.reduce((a, [, y]) => a + y, 0) / n;
    let sxy = 0;
    let sxx = 0;
    for (const [x, y] of pts) {
      sxy += (x - mx) * (y - my);
      sxx += (x - mx) ** 2;
    }
    const k = sxx ? sxy / sxx : 0;
    return (i: number) => my + k * (i - mx);
  };
  const hiAt = fit(T, hi0);
  const loAt = fit(B, lo0);
  return T.map((t, i) => {
    const H = Math.abs(loAt(i) - hiAt(i)) || 1;
    // Beyond the edge counts as reaching it.
    const up = (t - hiAt(i)) / H;
    const down = (loAt(i) - B[i]) / H;
    const asc = up < 0.2;
    const desc = down < 0.2;
    // Bar ends sit at 0 or about 37% of the height from an edge; one near the
    // 20% dividing line (8–29%) could be read either way.
    if (out && ((up > 0.08 && up < 0.29) || (down > 0.08 && down < 0.29))) out.sure = false;
    return asc && desc ? 'F' : asc ? 'A' : desc ? 'D' : 'T';
  }).join('');
}

/** Expected states for a code as bwip-js would draw it. */
export function statesFromRaw(
  bwip: BwipRaw,
  bcid: string,
  text: string,
  opts = '',
): BarRead | null {
  const r = tryRaw(bwip, bcid, text, opts);
  if (!r?.bhs || !r.bbs || !r.sbs) return null;
  const tops = r.bhs.map((h, i) => h + r.bbs![i]);
  const bars = r.sbs.filter((_, i) => i % 2 === 0);
  const spaces = r.sbs.filter((_, i) => i % 2 === 1).slice(0, bars.length - 1);
  const mean = (v: number[]) => v.reduce((a, b) => a + b, 0) / (v.length || 1);
  return { states: classify(tops, r.bbs, false), spaceToBar: mean(spaces) / mean(bars) };
}

/** Find a row of evenly spaced bars and measure each bar's top and bottom. */
export function readBars(l: Luma, minBars = 10): BarRead | null {
  // Threshold per row (the code may cover only part of the image), then use
  // the best row's threshold for measuring bar heights.
  const thresholds: (number | null)[] = [];
  let bestY = -1;
  let bestCount = 0;
  const counts: number[] = [];
  for (let y = 0; y < l.height; y++) {
    const t = lineThreshold(l.data.subarray(y * l.width, (y + 1) * l.width));
    thresholds[y] = t;
    let c = 0;
    if (t !== null) {
      let prev = false;
      for (let x = 0; x < l.width; x++) {
        const d = l.data[y * l.width + x] < t;
        if (d && !prev) c++;
        prev = d;
      }
    }
    counts[y] = c;
    if (c > bestCount) {
      bestCount = c;
      bestY = y;
    }
  }
  if (bestCount < minBars) return null;
  const t = thresholds[bestY]!;
  const dark = (x: number, y: number) => l.data[y * l.width + x] < t;
  // Middle of the band of rows that cross every bar (the tracker).
  let y0 = bestY;
  let y1 = bestY;
  while (y0 > 0 && counts[y0 - 1] === bestCount) y0--;
  while (y1 < l.height - 1 && counts[y1 + 1] === bestCount) y1++;
  const y = (y0 + y1) >> 1;

  // Look a few rows either side too: after straightening a photo the thin
  // tracker band can still drift by a pixel or two across a long code.
  let lo = y - Math.max(1, Math.min(3, (y1 - y0) >> 1));
  let hi = y + Math.max(1, Math.min(3, (y1 - y0) >> 1));
  // Two-track Pharmacode has no row that crosses every bar (bars hang from
  // the top, stand on the bottom, or both), so look across the whole symbol.
  if (minBars <= 2) {
    const need = Math.max(minBars, Math.ceil(bestCount * 0.4));
    lo = bestY;
    hi = bestY;
    while (lo > 0 && counts[lo - 1] >= need) lo--;
    while (hi < l.height - 1 && counts[hi + 1] >= need) hi++;
  }
  lo = Math.max(0, lo);
  hi = Math.min(l.height - 1, hi);
  const darkNear = (x: number) => {
    for (let yy = lo; yy <= hi; yy++) if (dark(x, yy)) return true;
    return false;
  };
  const bars: [number, number][] = [];
  let start = -1;
  for (let x = 0; x <= l.width; x++) {
    const d = x < l.width && darkNear(x);
    if (d && start < 0) start = x;
    if (!d && start >= 0) {
      bars.push([start, x]);
      start = -1;
    }
  }
  // Keep the longest run of evenly sized, evenly spaced bars: the code. A
  // darker surface around the label (a desk, a box, a bottle) shows up as
  // wide "bars" at the ends of the row.
  {
    const ws = bars.map(([a, b]) => b - a).sort((a, b) => a - b);
    const med = ws[ws.length >> 1] ?? 0;
    const okW = (w: number) => Math.abs(w - med) <= Math.max(2, med * 0.5);
    const kept = bars.filter(([a, b]) => okW(b - a));
    const pitches = kept
      .slice(1)
      .map(([a], i) => a - kept[i][0])
      .sort((a, b) => a - b);
    const pitch = pitches[pitches.length >> 1] ?? 0;
    let best: [number, number][] = [];
    let cur: [number, number][] = [];
    for (const bar of bars) {
      const prev = cur[cur.length - 1];
      if (okW(bar[1] - bar[0]) && (!prev || bar[0] - prev[0] < pitch * 1.6)) cur.push(bar);
      else cur = okW(bar[1] - bar[0]) ? [bar] : [];
      if (cur.length > best.length) best = cur.slice();
    }
    if (best.length >= minBars) bars.splice(0, bars.length, ...best);
  }
  // Drop a thin frame line at either end (e.g. Pharmacode's border).
  const sortedW = bars.map(([a, b]) => b - a).sort((a, b) => a - b);
  const medianW = sortedW[sortedW.length >> 1] ?? 0;
  while (bars.length && bars[0][1] - bars[0][0] < medianW * 0.6) bars.shift();
  while (bars.length && bars[bars.length - 1][1] - bars[bars.length - 1][0] < medianW * 0.6)
    bars.pop();
  if (bars.length < minBars) return null;
  const widths = bars.map(([a, b]) => b - a);
  const gaps = bars.slice(1).map(([a], i) => a - bars[i][1]);
  const mean = (v: number[]) => v.reduce((a, b) => a + b, 0) / (v.length || 1);
  const wMean = mean(widths);
  // Height-modulated codes have bars of one width; reject rows that don't.
  const wMedian = [...widths].sort((a, b) => a - b)[widths.length >> 1];
  if (widths.some((w) => Math.abs(w - wMedian) > Math.max(2, wMedian * 0.5))) return null;

  const tops: number[] = [];
  const bottoms: number[] = [];
  for (const [a, b] of bars) {
    const cx = (a + b) >> 1;
    const col = (yy: number) =>
      dark(cx, yy) || (b - a > 2 && (dark(cx - 1, yy) || dark(cx + 1, yy)));
    // Start from the bar's dark pixel nearest the middle row.
    let start = y;
    for (let k = 0; k <= Math.max(y - lo, hi - y); k++) {
      if (y - k >= lo && col(y - k)) {
        start = y - k;
        break;
      }
      if (y + k <= hi && col(y + k)) {
        start = y + k;
        break;
      }
    }
    let top = start;
    while (top > 0 && col(top - 1)) top--;
    let bottom = start;
    while (bottom < l.height - 1 && col(bottom + 1)) bottom++;
    tops.push(top);
    bottoms.push(bottom);
  }
  const conf = { sure: true };
  const states = classify(tops, bottoms, true, conf);
  const aspect = mean(tops.map((t, i) => bottoms[i] - t + 1)) / wMean;
  return { states, spaceToBar: mean(gaps) / wMean, sure: conf.sure, aspect };
}

const flip = (s: string) =>
  [...s]
    .reverse()
    .map((c) => (c === 'A' ? 'D' : c === 'D' ? 'A' : c))
    .join('');

function matches(bwip: BwipRaw, bcid: string, text: string, read: BarRead, opts = ''): boolean {
  const exp = statesFromRaw(bwip, bcid, text, opts);
  if (!exp || exp.states !== read.states) return false;
  const ratio = read.spaceToBar / exp.spaceToBar;
  // Loose: blur and tilt make bars look fatter or thinner than drawn.
  return ratio > 0.4 && ratio < 2.5;
}

// ---------- POSTNET / PLANET ----------

function decodePostnetLike(
  bwip: BwipRaw,
  read: BarRead,
  bcid: 'postnet' | 'planet',
): string | null {
  const s = read.states;
  if ((s.length - 2) % 5 || s[0] !== 'F' || s[s.length - 1] !== 'F') return null;
  const weights = [7, 4, 2, 1, 0];
  let digits = '';
  for (let i = 1; i < s.length - 1; i += 5) {
    const bits = [...s.slice(i, i + 5)].map((c) => (c === 'F') !== (bcid === 'planet'));
    if (bits.filter(Boolean).length !== 2) return null;
    const v = bits.reduce((a, on, k) => a + (on ? weights[k] : 0), 0);
    digits += v === 11 ? '0' : String(v);
  }
  const text = digits.slice(0, -1);
  return matches(bwip, bcid, text, read) ? text : null;
}

// ---------- RM4SCC / KIX ----------

let rmTable: Map<string, string> | null = null;
function rm(bwip: BwipRaw) {
  if (!rmTable) {
    rmTable = new Map();
    for (const c of '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ') {
      const st = statesFromRaw(bwip, 'kix', c)?.states;
      if (st) rmTable.set(st, c);
    }
  }
  return rmTable;
}

function decodeRm(bwip: BwipRaw, s: string): string {
  let text = '';
  for (let i = 0; i + 4 <= s.length; i += 4) {
    const c = rm(bwip).get(s.slice(i, i + 4));
    if (c === undefined) return '';
    text += c;
  }
  return text;
}

function decodeKix(bwip: BwipRaw, read: BarRead): string | null {
  if (read.states.length % 4) return null;
  const text = decodeRm(bwip, read.states);
  return text && matches(bwip, 'kix', text, read) ? text : null;
}

function decodeRoyalMail(bwip: BwipRaw, read: BarRead): string | null {
  const s = read.states;
  if ((s.length - 2) % 4) return null;
  const text = decodeRm(bwip, s.slice(1, -1));
  if (text.length < 2) return null;
  const data = text.slice(0, -1); // last character is the check
  return matches(bwip, 'royalmail', data, read) ? data : null;
}

// ---------- Japan Post ----------

let jpTable: Map<string, string> | null = null;
function jp(bwip: BwipRaw) {
  if (!jpTable) {
    jpTable = new Map();
    const at = (t: string, i: number) =>
      statesFromRaw(bwip, 'japanpost', t)?.states.slice(2 + i * 3, 5 + i * 3);
    for (const c of '0123456789-') {
      const p = at(c, 0);
      if (p) jpTable.set(p, c);
    }
    const marks: [string, string, number][] = [
      ['A', 'CC1', 0],
      ['K', 'CC2', 0],
      ['U', 'CC3', 0],
      ['1', 'CC4', 1],
    ];
    for (const [t, name, i] of marks) {
      const p = at(t, i);
      if (p) jpTable.set(p, name);
    }
  }
  return jpTable;
}

function decodeJapanPost(bwip: BwipRaw, read: BarRead): string | null {
  const s = read.states;
  if (s.length !== 67) return null;
  const syms: string[] = [];
  for (let i = 0; i < 20; i++) {
    const v = jp(bwip).get(s.slice(2 + i * 3, 5 + i * 3));
    if (v === undefined) return null;
    syms.push(v);
  }
  let text = '';
  for (let i = 0; i < syms.length; i++) {
    const v = syms[i];
    if (v === 'CC4') break;
    if (v === 'CC1' || v === 'CC2' || v === 'CC3') {
      const d = Number(syms[++i]);
      if (!Number.isInteger(d)) return null;
      text += String.fromCharCode((v === 'CC1' ? 65 : v === 'CC2' ? 75 : 85) + d);
    } else text += v;
  }
  return text && matches(bwip, 'japanpost', text, read) ? text : null;
}

// ---------- Australia Post ----------

const AUS_ENCS = [
  '000',
  '001',
  '002',
  '010',
  '011',
  '012',
  '020',
  '021',
  '022',
  '100',
  '101',
  '102',
  '110',
  '111',
  '112',
  '120',
  '121',
  '122',
  '200',
  '201',
  '202',
  '210',
  '211',
  '212',
  '220',
  '221',
  '222',
  '300',
  '301',
  '302',
  '310',
  '311',
  '312',
  '320',
  '321',
  '322',
  '023',
  '030',
  '031',
  '032',
  '033',
  '103',
  '113',
  '123',
  '130',
  '131',
  '132',
  '133',
  '203',
  '213',
  '223',
  '230',
  '231',
  '232',
  '233',
  '303',
  '313',
  '323',
  '330',
  '331',
  '332',
  '333',
  '003',
  '013',
];
const AUS_N = ['00', '01', '02', '10', '11', '12', '20', '21', '22', '30'];
const AUS_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789abcdefghijklmnopqrstuvwxyz #';
const AUS_LEN: Record<string, number> = {
  '11': 37,
  '45': 37,
  '87': 37,
  '92': 37,
  '59': 52,
  '62': 67,
};

let ausMap: Map<string, string> | null = null; // state letter -> symbol digit
function aus(bwip: BwipRaw) {
  if (!ausMap) {
    ausMap = new Map();
    // Start "13", FCC "11" -> N(1)N(1) = "0101", DPID zeros -> "00..", DPID twos -> "02..".
    const a = statesFromRaw(bwip, 'auspost', '1100000000')?.states;
    const b = statesFromRaw(bwip, 'auspost', '1122222222')?.states;
    if (a && b) {
      ausMap.set(a[0], '1');
      ausMap.set(a[1], '3');
      ausMap.set(a[2], '0');
      ausMap.set(b[7], '2');
    }
  }
  return ausMap;
}

function decodeAusPost(bwip: BwipRaw, read: BarRead): string | null {
  const map = aus(bwip);
  if (map.size !== 4) return null;
  const sym = [...read.states].map((c) => map.get(c) ?? '?').join('');
  if (!sym.startsWith('13') || !sym.endsWith('13')) return null;
  const n = (s: string) => {
    let out = '';
    for (let i = 0; i + 2 <= s.length; i += 2) {
      const d = AUS_N.indexOf(s.slice(i, i + 2));
      if (d === -1) return null;
      out += d;
    }
    return out;
  };
  const fcc = n(sym.slice(2, 6));
  if (!fcc || AUS_LEN[fcc] !== sym.length) return null;
  const dpid = n(sym.slice(6, 22));
  if (!dpid) return null;
  const base = fcc + dpid;
  const info = sym.slice(22, sym.length - 14);
  const candidates: [string, string][] = [[base, '']];
  for (let k = Math.floor(info.length / 2); k > 0; k--) {
    const d = n(info.slice(0, k * 2));
    if (d !== null) candidates.push([base + d, 'custinfoenc=numeric']);
  }
  for (let k = Math.floor(info.length / 3); k > 0; k--) {
    let t = '';
    for (let i = 0; i < k; i++) {
      const idx = AUS_ENCS.indexOf(info.slice(i * 3, i * 3 + 3));
      if (idx === -1) {
        t = '';
        break;
      }
      t += AUS_CHARS[idx];
    }
    if (t) candidates.push([base + t, 'custinfoenc=character']);
  }
  for (const [text, opts] of candidates)
    if (matches(bwip, 'auspost', text, read, opts)) return text;
  return null;
}

// ---------- USPS Intelligent Mail ----------

let inv513: Map<number, number> | null = null;
let inv213: Map<number, number> | null = null;

export function decodeImbStates(states: string): string | null {
  if (states.length !== 65) return null;
  inv513 ??= new Map(TAB513.map((v, i) => [v, i]));
  inv213 ??= new Map(TAB213.map((v, i) => [v, i]));
  const chars = new Array<number>(10).fill(0);
  for (let i = 0; i < 65; i++) {
    const st = states[i];
    if (st === 'F' || st === 'D') chars[BARMAP[i * 4]] |= 1 << BARMAP[i * 4 + 1];
    if (st === 'F' || st === 'A') chars[BARMAP[i * 4 + 2]] |= 1 << BARMAP[i * 4 + 3];
  }
  const cws: number[] = [];
  for (let j = 0; j < 10; j++) {
    const look = (c: number) =>
      inv513!.has(c) ? inv513!.get(c)! : inv213!.has(c) ? 1287 + inv213!.get(c)! : -1;
    let cw = look(chars[j]);
    if (cw === -1) cw = look(~chars[j] & 0x1fff); // FCS bit set for this character
    if (cw === -1) return null;
    cws.push(cw);
  }
  if (cws[9] % 2) return null;
  cws[9] /= 2;
  if (cws[0] > 658) cws[0] -= 659;
  let bin = BigInt(cws[0]);
  for (let j = 1; j < 9; j++) bin = bin * 1365n + BigInt(cws[j]);
  bin = bin * 636n + BigInt(cws[9]);
  const E18 = 10n ** 18n;
  const tail = (bin % E18).toString().padStart(18, '0');
  let x = bin / E18;
  const t1 = x % 5n;
  x /= 5n;
  const t0 = x % 10n;
  const r = x / 10n;
  if (t1 > 4n) return null;
  let routing: string;
  if (r === 0n) routing = '';
  else if (r <= 100000n) routing = (r - 1n).toString().padStart(5, '0');
  else if (r <= 1000100000n) routing = (r - 100001n).toString().padStart(9, '0');
  else if (r <= 101000100000n) routing = (r - 1000100001n).toString().padStart(11, '0');
  else return null;
  return `${t0}${t1}${tail}${routing}`;
}

function decodeImb(bwip: BwipRaw, read: BarRead): string | null {
  const text = decodeImbStates(read.states);
  return text && matches(bwip, 'onecode', text, read) ? text : null;
}

// ---------- Two-track Pharmacode ----------

function decodePharmacode2(bwip: BwipRaw, read: BarRead): string | null {
  const s = read.states;
  if (s.length < 2 || /T/.test(s)) return null;
  const perms = [
    ['F', 'A', 'D'],
    ['F', 'D', 'A'],
    ['A', 'F', 'D'],
    ['A', 'D', 'F'],
    ['D', 'F', 'A'],
    ['D', 'A', 'F'],
  ];
  for (const seq of [s, [...s].reverse().join('')]) {
    for (const p of perms) {
      let v = 0;
      for (const c of seq) v = v * 3 + p.indexOf(c) + 1;
      if (v < 4 || v > 64570080) continue;
      if (matches(bwip, 'pharmacode2', String(v), read)) return String(v);
    }
  }
  return null;
}

/** Height-modulated formats without a check character. */
const NO_CHECK = new Set(['kix', 'pharmacode2']);

const POSTAL: [string, (b: BwipRaw, r: BarRead) => string | null][] = [
  ['onecode', decodeImb],
  ['japanpost', decodeJapanPost],
  ['auspost', decodeAusPost],
  ['royalmail', decodeRoyalMail],
  ['kix', decodeKix],
  ['postnet', (b, r) => decodePostnetLike(b, r, 'postnet')],
  ['planet', (b, r) => decodePostnetLike(b, r, 'planet')],
  ['pharmacode2', decodePharmacode2],
];

export function decodePostal(
  bwip: BwipRaw,
  read: BarRead,
  only?: string,
  skip?: ReadonlySet<string>,
): { bcid: string; text: string } | null {
  for (const r of [read, { ...read, states: flip(read.states) }]) {
    // Formats with no check character only accept a read with no doubtful bars.
    if (only === 'daft') {
      if (r.sure === false) continue;
      if (matches(bwip, 'daft', r.states, r)) return { bcid: 'daft', text: r.states };
      continue;
    }
    for (const [bcid, fn] of POSTAL) {
      if ((only && only !== bcid) || skip?.has(bcid)) continue;
      if (NO_CHECK.has(bcid) && r.sure === false) continue;
      const text = fn(bwip, r);
      if (text !== null) return { bcid, text };
    }
  }
  return null;
}
