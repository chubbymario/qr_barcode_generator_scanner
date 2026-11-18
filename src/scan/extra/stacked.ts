// Decoders for stacked barcodes: Code 16K, Code 49 and Codablock F (incl. HIBC).
//
// Each image line that crosses a row is decoded to that row's codewords and
// row number. Votes from many lines are combined, the message is decoded,
// and the result is re-encoded with bwip-js and compared codeword for
// codeword before it's accepted. Tables come from BWIPP via
// scripts/extract-tables.mjs.

import { quantizeAll, rowRuns, segments, type Luma } from './lines';
import { tryRaw, type BwipRaw } from './types';
import {
  CODABLOCK_ENCS,
  CODE16K_ENCS,
  CODE16K_START,
  CODE16K_STOP_EVEN,
  CODE16K_STOP_ODD,
  CODE49_COMBOS,
  CODE49_PARITY,
  CODE49_PATTERNS,
} from './tables';

type Token = number | 'FNC1' | 'FNC2' | 'FNC3';
export interface StackedResult {
  bcid: string;
  text: string;
}

interface RowRead {
  index: number;
  cws: number[];
  /** Codablock F columns, so rows of different symbols don't mix. */
  width?: number;
}

// ---------- shared helpers ----------

const lookup = (list: string[]) => new Map(list.map((p, i) => [p, i]));
const chunk = (s: string, n: number) =>
  Array.from({ length: s.length / n }, (_, i) => s.slice(i * n, i * n + n));

let c16Encs: Map<string, number> | null = null;
let cbEncs: Map<string, number> | null = null;
let c49Words: Map<string, [number, number]> | null = null;

function tables() {
  c16Encs ??= lookup(chunk(CODE16K_ENCS, 6));
  cbEncs ??= lookup(CODABLOCK_ENCS);
  if (!c49Words) {
    c49Words = new Map();
    const all = chunk(CODE49_PATTERNS, 8);
    all.forEach((p, i) => c49Words!.set(p, [i < 2401 ? 0 : 1, i % 2401]));
  }
  return { c16Encs, cbEncs, c49Words };
}

/** Text for display, and the same text escaped for bwip-js's parse/parsefnc options. */
function render(tokens: Token[]): { text: string; input: string } {
  let text = '';
  let input = '';
  for (const t of tokens) {
    if (typeof t === 'string') {
      text += t === 'FNC1' ? '\u001d' : '';
      input += `^${t}`;
    } else {
      text += String.fromCharCode(t);
      input +=
        t < 32 || t > 126 || t === 94 ? `^${String(t).padStart(3, '0')}` : String.fromCharCode(t);
    }
  }
  return { text, input };
}

/** Module widths of each distinct symbol row, from bwip-js raw output (for verification). */
function rowsFromPixs(r: { pixs?: number[]; pixx?: number } | null): number[][] {
  if (!r?.pixs || !r.pixx) return [];
  const out: number[][] = [];
  let prev = '';
  for (let y = 0; y * r.pixx < r.pixs.length; y++) {
    const bits = r.pixs.slice(y * r.pixx, (y + 1) * r.pixx);
    const key = bits.join('');
    if (key === prev) continue;
    prev = key;
    const first = bits.indexOf(1);
    const last = bits.lastIndexOf(1);
    if (first < 0) continue;
    const runs: number[] = [];
    let run = 1;
    for (let x = first + 1; x <= last; x++) {
      if (bits[x] === bits[x - 1]) run++;
      else {
        runs.push(run);
        run = 1;
      }
    }
    runs.push(run);
    out.push(runs);
  }
  return out;
}

/** Combine row reads from many image lines: most common reading per row number. */
class Votes {
  private m = new Map<string, Map<string, { read: RowRead; n: number }>>();
  add(read: RowRead) {
    const key = `${read.width ?? 0}:${read.index}`;
    const byRead = this.m.get(key) ?? new Map();
    this.m.set(key, byRead);
    const k = read.cws.join(',');
    const e = byRead.get(k);
    if (e) e.n++;
    else byRead.set(k, { read, n: 1 });
  }
  best(width = 0): Map<number, number[]> {
    const out = new Map<number, number[]>();
    for (const [key, reads] of this.m) {
      const [w, idx] = key.split(':').map(Number);
      if (w !== width) continue;
      let top: { read: RowRead; n: number } | null = null;
      for (const e of reads.values()) if (!top || e.n > top.n) top = e;
      if (top) out.set(idx, top.read.cws);
    }
    return out;
  }
  widths(): number[] {
    return [...new Set([...this.m.keys()].map((k) => Number(k.split(':')[0])))];
  }
  get size() {
    return this.m.size;
  }
}

const same = (a: number[] | undefined, b: number[] | undefined) =>
  !!a && !!b && a.length === b.length && a.every((v, i) => v === b[i]);

// ---------- Code 128-style code sets (Code 16K, Codablock F) ----------

type Op =
  | 'fn1'
  | 'fn2'
  | 'fn3'
  | 'fn4'
  | 'swa'
  | 'swb'
  | 'swc'
  | 'sa1'
  | 'sb1'
  | 'sa2'
  | 'sb2'
  | 'sb3'
  | 'sc2'
  | 'sc3'
  | 'sft'
  | 'pad'
  | 'sta'
  | 'stp';
type Set3 = 'A' | 'B' | 'C';

const C16K_OPS: Record<Set3, Record<number, Op>> = {
  A: {
    96: 'fn3',
    97: 'fn2',
    98: 'sb1',
    99: 'swc',
    100: 'swb',
    101: 'fn4',
    102: 'fn1',
    103: 'pad',
    104: 'sb2',
    105: 'sc2',
    106: 'sc3',
  },
  B: {
    96: 'fn3',
    97: 'fn2',
    98: 'sa1',
    99: 'swc',
    100: 'fn4',
    101: 'swa',
    102: 'fn1',
    103: 'pad',
    104: 'sa2',
    105: 'sc2',
    106: 'sc3',
  },
  C: { 100: 'swb', 101: 'swa', 102: 'fn1', 103: 'pad', 104: 'sb1', 105: 'sb2', 106: 'sb3' },
};
const CB_OPS: Record<Set3, Record<number, Op>> = {
  A: {
    96: 'fn3',
    97: 'fn2',
    98: 'sft',
    99: 'swc',
    100: 'swb',
    101: 'fn4',
    102: 'fn1',
    103: 'sta',
    104: 'stp',
  },
  B: {
    96: 'fn3',
    97: 'fn2',
    98: 'sft',
    99: 'swc',
    100: 'fn4',
    101: 'swa',
    102: 'fn1',
    103: 'sta',
    104: 'stp',
  },
  C: { 100: 'swb', 101: 'swa', 102: 'fn1', 103: 'sta', 104: 'stp' },
};

const SHIFTS: Partial<Record<Op, [Set3, number]>> = {
  sa1: ['A', 1],
  sb1: ['B', 1],
  sa2: ['A', 2],
  sb2: ['B', 2],
  sb3: ['B', 3],
  sc2: ['C', 2],
  sc3: ['C', 3],
};

/**
 * Decode codewords in Code 128-style code sets.
 * `latchFn4`: two FNC4s in a row toggle extended ASCII (Code 16K); otherwise
 * FNC4 only shifts the next character (Codablock F).
 */
function decodeSets(
  cws: number[],
  start: Set3,
  ops: Record<Set3, Record<number, Op>>,
  latchFn4: boolean,
): Token[] | null {
  const out: Token[] = [];
  let set = start;
  let shiftSet: Set3 | null = null;
  let shiftLeft = 0;
  let extended = false;
  let fn4Next = false;
  for (let k = 0; k < cws.length; k++) {
    const cur: Set3 = shiftLeft > 0 && shiftSet ? shiftSet : set;
    const v = cws[k];
    const op: Op | undefined = ops[cur][v];
    const inShift = shiftLeft > 0;
    if (op) {
      if (SHIFTS[op]) {
        [shiftSet, shiftLeft] = SHIFTS[op]!;
        continue;
      }
      if (op === 'sft') {
        shiftSet = cur === 'A' ? 'B' : 'A';
        shiftLeft = 1;
        continue;
      }
      if (op === 'fn1') out.push('FNC1');
      else if (op === 'fn2') out.push('FNC2');
      else if (op === 'fn3') out.push('FNC3');
      else if (op === 'fn4') {
        if (latchFn4 && ops[cur][cws[k + 1]] === 'fn4') {
          extended = !extended;
          k++;
        } else fn4Next = true;
      } else if (op === 'swa') set = 'A';
      else if (op === 'swb') set = 'B';
      else if (op === 'swc') set = 'C';
      else if (op === 'sta' || op === 'stp') return null; // can't appear in data
    } else if (cur === 'C') {
      if (v > 99) return null;
      out.push(48 + Math.floor(v / 10), 48 + (v % 10));
    } else {
      if (v > 95) return null;
      const base = cur === 'A' ? (v < 64 ? v + 32 : v - 64) : v + 32;
      out.push(base + (extended !== fn4Next ? 128 : 0));
      fn4Next = false;
    }
    if (inShift) shiftLeft--;
  }
  return out;
}

// ---------- Code 16K ----------

function readCode16kRow(elems: number[]): RowRead | null {
  if (elems.length !== 39 || elems[4] !== 1) return null;
  const { c16Encs } = tables();
  const start = elems.slice(0, 4).join('');
  const stop = elems.slice(35, 39).join('');
  let index = -1;
  for (let i = 0; i < 16; i++) {
    if (
      CODE16K_START[i] === start &&
      (CODE16K_STOP_ODD[i] === stop || CODE16K_STOP_EVEN[i] === stop)
    ) {
      index = i;
      break;
    }
  }
  if (index < 0) return null;
  const cws: number[] = [];
  for (let k = 0; k < 5; k++) {
    const v = c16Encs.get(elems.slice(5 + k * 6, 11 + k * 6).join(''));
    if (v === undefined) return null;
    cws.push(v);
  }
  return { index, cws };
}

function code16kMessage(
  rows: Map<number, number[]>,
): { tokens: Token[]; r: number; mode: number; cws: number[] } | null {
  const first = rows.get(0);
  if (!first) return null;
  const r = Math.floor(first[0] / 7) + 2;
  const mode = first[0] % 7;
  if (r < 2 || r > 16) return null;
  const cws: number[] = [];
  for (let i = 0; i < r; i++) {
    const rw = rows.get(i);
    if (!rw) return null;
    cws.push(...rw);
  }
  const dcws = 5 * r - 3;
  let c1 = 0;
  for (let k = 0; k <= dcws; k++) c1 += (k + 2) * cws[k];
  c1 %= 107;
  let c2 = 0;
  for (let k = 0; k <= dcws; k++) c2 += (k + 1) * cws[k];
  c2 = (c2 + c1 * (dcws + 2)) % 107;
  if (cws[dcws + 1] !== c1 || cws[dcws + 2] !== c2) return null;

  let data = cws.slice(1, dcws + 1);
  const tokens: Token[] = [];
  let start: Set3 = 'B';
  // Modes: 0 A, 1 B, 2 C, 3 B+FNC1, 4 C+FNC1, 5 C with first in B, 6 C with first two in B.
  if (mode === 0) start = 'A';
  else if (mode === 1) start = 'B';
  else if (mode === 2) start = 'C';
  else if (mode === 3) {
    start = 'B';
    tokens.push('FNC1');
  } else if (mode === 4) {
    start = 'C';
    tokens.push('FNC1');
  } else if (mode === 5 || mode === 6) {
    start = 'C';
    // Implied Shift B for the first one or two codewords.
    data = [mode === 5 ? 104 : 105, ...data];
  }
  const rest = decodeSets(data, start, C16K_OPS, true);
  if (!rest) return null;
  return { tokens: [...tokens, ...rest], r, mode, cws };
}

function decodeCode16k(bwip: BwipRaw, votes: Votes): StackedResult | null {
  const rows = votes.best();
  const msg = code16kMessage(rows);
  if (!msg) return null;
  const { input, text } = render(msg.tokens);
  // Re-encode and compare every codeword.
  const raw = tryRaw(bwip, 'code16k', input, `parse parsefnc rows=${msg.r}`);
  const again = rowsFromPixs(raw as never)
    .map((runs) => readCode16kRow(runs))
    .filter((x): x is RowRead => !!x);
  if (again.length !== msg.r || !again.every((rw) => same(rw.cws, rows.get(rw.index)))) return null;
  return { bcid: 'code16k', text };
}

// ---------- Codablock F ----------

const AB_ROW = [
  ...Array.from({ length: 32 }, (_, i) => 64 + i),
  ...Array.from({ length: 16 }, (_, i) => i),
  ...Array.from({ length: 38 }, (_, i) => 26 + i),
];

function readCodablockRow(elems: number[]): RowRead | null {
  if ((elems.length - 7) % 6) return null;
  const n = (elems.length - 7) / 6 + 1; // codewords incl. stop
  const columns = n - 5;
  if (columns < 4 || columns > 62) return null;
  const { cbEncs } = tables();
  const cws: number[] = [];
  for (let k = 0; k < n - 1; k++) {
    const v = cbEncs.get(elems.slice(k * 6, k * 6 + 6).join(''));
    if (v === undefined) return null;
    cws.push(v);
  }
  if (elems.slice(elems.length - 7).join('') !== CODABLOCK_ENCS[104]) return null;
  if (cws[0] !== 103) return null;
  // Row checksum (Code 128 style, over start .. last data).
  let sum = cws[0];
  for (let i = 1; i < cws.length - 1; i++) sum += cws[i] * i;
  if (sum % 103 !== cws[cws.length - 1]) return null;
  // Row indicator, encoded via set C's or sets A/B's value map.
  const ind = cws[1] === 99 ? cws[2] : AB_ROW.indexOf(cws[2]);
  if (ind < 0 || ind > 85) return null;
  // Row 0 carries "rows - 2" (0..42); later rows carry "row + 42".
  const index = ind >= 43 ? ind - 42 : 0;
  return { index, cws: ind < 43 ? [ind + 2, ...cws] : [0, ...cws], width: columns };
}

function decodeCodablock(bwip: BwipRaw, votes: Votes): StackedResult | null {
  for (const columns of votes.widths()) {
    if (!columns) continue;
    const rows = votes.best(columns);
    const first = rows.get(0);
    if (!first) continue;
    const r = first[0];
    const tokens: Token[] = [];
    let ok = true;
    for (let i = 0; i < r && ok; i++) {
      const rw = rows.get(i);
      if (!rw) {
        ok = false;
        break;
      }
      const cws = rw.slice(1); // drop the row-count slot added above
      const sel = cws[1];
      const start: Set3 = sel === 99 ? 'C' : sel === 100 ? 'B' : 'A';
      if (sel !== 98 && sel !== 99 && sel !== 100) {
        ok = false;
        break;
      }
      // Data sits between the row indicator and the row check; the last row
      // ends with the K1/K2 message checks.
      const data = cws.slice(3, columns + 3 - (i === r - 1 ? 2 : 0));
      const t = decodeSets(data, start, CB_OPS, false);
      if (!t) ok = false;
      else tokens.push(...t);
    }
    if (!ok) continue;
    const { input, text } = render(tokens);
    const verify = (bcid: string, t: string) => {
      const raw = tryRaw(bwip, bcid, t, `parse parsefnc columns=${columns} rows=${r}`);
      const again = rowsFromPixs(raw as never)
        .map((runs) => readCodablockRow(runs))
        .filter((x): x is RowRead => !!x);
      return again.length === r && again.every((rw) => same(rw.cws, rows.get(rw.index)));
    };
    // HIBC: "+" data check-character, read back as the bare data.
    if (text.startsWith('+') && text.length > 2) {
      const hibc = input.slice(1, -1);
      if (verify('hibccodablockf', hibc))
        return { bcid: 'hibccodablockf', text: text.slice(1, -1) };
    }
    if (verify('codablockf', input)) return { bcid: 'codablockf', text };
  }
  return null;
}

// ---------- Code 49 ----------

const C49_CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ-. $/+%';
let c49Shift: Map<string, number> | null = null;
function c49ShiftMap() {
  if (!c49Shift) {
    c49Shift = new Map();
    for (let i = 0; i < 128; i++) {
      const pair = CODE49_COMBOS.slice(i * 2, i * 2 + 2);
      if (pair[0] === '1' || pair[0] === '2')
        c49Shift.set(`${pair[0]}${C49_CHARS.indexOf(pair[1])}`, i);
    }
  }
  return c49Shift;
}

function readCode49Row(elems: number[]): RowRead | null {
  if (elems.length !== 35 || elems[0] !== 1 || elems[1] !== 1 || elems[34] !== 4) return null;
  const { c49Words } = tables();
  let parity = '';
  const cws: number[] = [];
  for (let j = 0; j < 4; j++) {
    const w = c49Words.get(elems.slice(2 + j * 8, 10 + j * 8).join(''));
    if (!w) return null;
    parity += w[0];
    cws.push(Math.floor(w[1] / 49), w[1] % 49);
  }
  // Row check: the 8th value is the sum of the first 7, mod 49.
  if (cws.slice(0, 7).reduce((a, b) => a + b, 0) % 49 !== cws[7]) return null;
  // "0000" marks the last row; store it as index 99 until the row count is known.
  const index = parity === '0000' ? 99 : CODE49_PARITY.indexOf(parity);
  if (index < 0) return null;
  return { index, cws };
}

function code49Tokens(data: number[], mode: number): Token[] | null {
  const out: Token[] = [];
  let i = 0;
  // Trailing 48s are padding.
  let end = data.length;
  while (end > 0 && data[end - 1] === 48) end--;
  const d = data.slice(0, end);
  let numeric = mode === 2;
  if (mode === 3) i = 1; // structured append: first value is the group number
  if (mode === 4 || mode === 5) {
    // First character is shifted, with the shift implied.
    const c = c49ShiftMap().get(`${mode === 4 ? 1 : 2}${d[0]}`);
    if (c === undefined) return null;
    out.push(c);
    i = 1;
  }
  while (i < d.length) {
    if (numeric) {
      let j = i;
      while (j < d.length && d[j] !== 48) j++;
      const run = d.slice(i, j);
      const groups: number[][] = [];
      let k = 0;
      const rem = run.length % 3;
      const full = rem === 1 ? run.length - 1 : rem === 2 ? run.length - 2 : run.length;
      for (; k < full; k += 3) groups.push(run.slice(k, k + 3));
      for (const g of groups) {
        const v = g[0] * 2304 + g[1] * 48 + g[2];
        // "10dddd" encodes a 4-digit tail; everything else is 5 digits.
        const s = v >= 100000 ? String(v - 100000).padStart(4, '0') : String(v).padStart(5, '0');
        if (v >= 110000) return null;
        for (const ch of s) out.push(ch.charCodeAt(0));
      }
      if (rem === 2) {
        const v = run[full] * 48 + run[full + 1];
        if (v > 999) return null;
        for (const ch of String(v).padStart(3, '0')) out.push(ch.charCodeAt(0));
      } else if (rem === 1) {
        if (run[full] > 9) return null;
        out.push(48 + run[full]);
      }
      i = j + 1; // skip the numeric shift back to alphanumeric
      numeric = false;
      continue;
    }
    const v = d[i];
    if (v < 43) out.push(C49_CHARS.charCodeAt(v));
    else if (v === 43 || v === 44) {
      const c = c49ShiftMap().get(`${v === 43 ? 1 : 2}${d[i + 1]}`);
      if (c === undefined) return null;
      out.push(c);
      i++;
    } else if (v === 45) out.push('FNC1');
    else if (v === 46) out.push('FNC2');
    else if (v === 47) out.push('FNC3');
    else if (v === 48) numeric = true;
    i++;
  }
  return out;
}

const C49_SAMVAL = [
  12, 22, 13, 23, 33, 14, 24, 34, 44, 15, 25, 35, 45, 55, 16, 26, 36, 46, 56, 66, 17, 27, 37, 47,
  57, 67, 77, 18, 28, 38, 48, 58, 68, 78, 88, 19, 29, 39, 49, 59, 69, 79, 89, 99,
];

function decodeCode49(bwip: BwipRaw, votes: Votes): StackedResult | null {
  const rows = votes.best();
  const last = rows.get(99);
  if (!last) return null;
  const cr7 = last[6];
  const r = Math.floor(cr7 / 7) + 2;
  const mode = cr7 % 7;
  if (r < 2 || r > 8 || mode > 5) return null;
  const data: number[] = [];
  for (let i = 0; i < r - 1; i++) {
    const rw = rows.get(i);
    if (!rw) return null;
    data.push(...rw.slice(0, 7));
  }
  if (r < 7) data.push(last[0], last[1]);
  const tokens = code49Tokens(data, mode);
  if (!tokens) return null;
  const { input, text } = render(tokens);
  let opts = `parse parsefnc rows=${r}`;
  if (mode === 1) opts += ' append';
  if (mode === 3) opts += ` sam=${C49_SAMVAL[data[0] - 1]}`;
  const raw = tryRaw(bwip, 'code49', input, opts);
  const again = rowsFromPixs(raw as never)
    .map((runs) => readCode49Row(runs))
    .filter((x): x is RowRead => !!x);
  if (again.length !== r) return null;
  for (const rw of again) if (!same(rw.cws, rows.get(rw.index))) return null;
  return { bcid: 'code49', text };
}

// ---------- scanning ----------

export const STACKED_FORMATS = ['code16k', 'code49', 'codablockf', 'hibccodablockf'];

function collect(l: Luma, only: string | undefined): { c16: Votes; c49: Votes; cb: Votes } {
  const c16 = new Votes();
  const c49 = new Votes();
  const cb = new Votes();
  const want = (id: string) =>
    !only || only === id || (only === 'hibccodablockf' && id === 'codablockf');
  // Rows can be only a few pixels tall, so sample densely.
  const step = Math.max(1, Math.floor(l.height / 220));
  let prev = '';
  for (let y = 0; y < l.height; y += step) {
    const runs = rowRuns(l, y);
    if (runs.length < 25) continue;
    const key = runs.map((v) => Math.round(v)).join(',');
    if (key === prev) continue;
    prev = key;
    for (const seg of segments(runs)) {
      for (const dir of [seg, [...seg].reverse()]) {
        if (want('code16k') && dir.length === 39) {
          for (const q of quantizeAll(dir, [1, 2, 3, 4])) {
            const rr = readCode16kRow(q);
            if (rr) c16.add(rr);
          }
        }
        if (want('code49') && dir.length === 35) {
          for (const q of quantizeAll(dir, [1, 2, 3, 4, 5, 6])) {
            const rr = readCode49Row(q);
            if (rr) c49.add(rr);
          }
        }
        if (want('codablockf') && dir.length >= 55 && (dir.length - 7) % 6 === 0) {
          for (const q of quantizeAll(dir, [1, 2, 3, 4])) {
            const rr = readCodablockRow(q);
            if (rr) cb.add(rr);
          }
        }
      }
    }
  }
  return { c16, c49, cb };
}

export type StackedRows = ReturnType<typeof collect>;

/** Phase 1 (no bwip-js needed): read rows of any stacked code in the image. */
export function collectStacked(l: Luma, only?: string): StackedRows | null {
  const rows = collect(l, only);
  return rows.c16.size >= 2 || rows.c49.size >= 2 || rows.cb.size >= 2 ? rows : null;
}

/** Phase 2: assemble and verify. */
export function finishStacked(bwip: BwipRaw, rows: StackedRows): StackedResult | null {
  const { c16, c49, cb } = rows;
  return (
    (c16.size >= 2 ? decodeCode16k(bwip, c16) : null) ??
    (c49.size >= 2 ? decodeCode49(bwip, c49) : null) ??
    (cb.size >= 2 ? decodeCodablock(bwip, cb) : null)
  );
}

export function decodeStacked(bwip: BwipRaw, l: Luma, only?: string): StackedResult | null {
  const { c16, c49, cb } = collect(l, only);
  return (
    (c16.size >= 2 ? decodeCode16k(bwip, c16) : null) ??
    (c49.size >= 2 ? decodeCode49(bwip, c49) : null) ??
    (cb.size >= 2 ? decodeCodablock(bwip, cb) : null)
  );
}
