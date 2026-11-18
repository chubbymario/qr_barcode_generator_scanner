// GS1 CC-A and CC-B: the MicroPDF417-based 2D parts of composite barcodes.
// CC-A has its own sizes and a base-928 packing of the GS1 bit stream, which
// zxing-cpp doesn't read at all; CC-B is MicroPDF417 with byte compaction,
// which zxing-cpp misses at some small sizes. Rows are read here, the bit
// stream is decoded by ../gs1cc.ts, and the result is re-encoded with bwip-js
// and compared row by row (error-correction codewords included).

import { quantizeAll, rowRuns, segments, type Luma } from './lines';
import { tryRaw, type BwipRaw } from './types';
import { CCA_METRICS, MPDF_CLUSTERS, MPDF_METRICS, MPDF_RAPS } from './tables';
import { decodeCompositeBits } from '../gs1cc';

/** Bit capacity of each CC-A size (BWIPP gs1-cc.bitcapsmaps), by columns then rows. */
const CCA_BITS: Record<number, Record<number, number>> = {
  2: { 5: 59, 6: 78, 7: 88, 8: 108, 9: 118, 10: 138, 12: 167 },
  3: { 4: 78, 5: 98, 6: 118, 7: 138, 8: 167 },
  4: { 3: 78, 4: 108, 5: 138, 6: 167, 7: 197 },
};

let clusterMaps: Map<number, number>[] | null = null;
let rapLR: Map<number, number> | null = null;
let rapC: Map<number, number> | null = null;
function maps() {
  clusterMaps ??= MPDF_CLUSTERS.map((c) => new Map(c.map((bits, v) => [bits, v])));
  rapLR ??= new Map(MPDF_RAPS[0].map((bits, i) => [bits, i]));
  rapC ??= new Map(MPDF_RAPS[1].map((bits, i) => [bits, i]));
  return { clusterMaps, rapLR, rapC };
}

const toBits = (modules: number[]) => {
  const out: number[] = [];
  modules.forEach((w, i) => {
    for (let k = 0; k < w; k++) out.push(i % 2 ? 0 : 1);
  });
  return out;
};
const val = (bits: number[], from: number, n: number) =>
  bits.slice(from, from + n).reduce((a, b) => a * 2 + b, 0);

/** All composite sizes: CC-A first, then the MicroPDF417 sizes CC-B can use (2 to 4 columns). */
const SIZES: { kind: 'a' | 'b'; m: number[] }[] = [
  ...CCA_METRICS.map((m) => ({ kind: 'a' as const, m })),
  ...MPDF_METRICS.filter((m) => m[0] >= 2).map((m) => ({ kind: 'b' as const, m })),
];

interface CcaRow {
  size: number; // index into SIZES
  index: number;
  cws: number[];
}

/** Read one CC-A row from its module widths, or null. */
export function readCcaRow(modules: number[]): CcaRow[] {
  const bits = toBits(modules);
  const { clusterMaps, rapLR, rapC } = maps();
  let c: number;
  let left = -1;
  let centre = -1;
  let right = -1;
  let cwAt: number[];
  if (bits.length === 55) {
    c = 2;
    left = rapLR.get(val(bits, 0, 10)) ?? -2;
    cwAt = [10, 27];
    right = rapLR.get(val(bits, 44, 10)) ?? -2;
  } else if (bits.length === 72) {
    c = 3; // CC-A only: no left pattern
    cwAt = [0, 27, 44];
    centre = rapC.get(val(bits, 17, 10)) ?? -2;
    right = rapLR.get(val(bits, 61, 10)) ?? -2;
  } else if (bits.length === 82) {
    c = 3; // MicroPDF417 (CC-B)
    left = rapLR.get(val(bits, 0, 10)) ?? -2;
    cwAt = [10, 37, 54];
    centre = rapC.get(val(bits, 27, 10)) ?? -2;
    right = rapLR.get(val(bits, 71, 10)) ?? -2;
  } else if (bits.length === 99) {
    c = 4;
    left = rapLR.get(val(bits, 0, 10)) ?? -2;
    cwAt = [10, 27, 54, 71];
    centre = rapC.get(val(bits, 44, 10)) ?? -2;
    right = rapLR.get(val(bits, 88, 10)) ?? -2;
  } else return [];
  if (left === -2 || centre === -2 || right === -2 || bits[bits.length - 1] !== 1) return [];
  const out: CcaRow[] = [];
  SIZES.forEach(({ kind, m: [mc, r, , rl, rc, rr] }, size) => {
    if (mc !== c) return;
    // 3-column rows differ in width between CC-A and MicroPDF417.
    if (c === 3 && (kind === 'a') !== (bits.length === 72)) return;
    // Row i uses patterns (i + offset - 1) mod 52.
    const i = (((right - rr + 1) % 52) + 52) % 52;
    if (i >= r) return;
    if (left >= 0 && (i + rl - 1) % 52 !== left) return;
    if (centre >= 0 && (i + rc - 1) % 52 !== centre) return;
    const cluster = (i + rl - 1) % 3;
    const cws: number[] = [];
    for (const at of cwAt) {
      const v = clusterMaps[cluster].get(val(bits, at, 17));
      if (v === undefined) return;
      cws.push(v);
    }
    out.push({ size, index: i, cws });
  });
  return out;
}

/** Base-928 codewords back into the composite bit stream. */
function cwsToBits(cws: number[], totalBits: number): Uint8Array | null {
  const bits: number[] = [];
  let k = 0;
  for (let used = 0; used < totalBits;) {
    const bsl = Math.min(69, totalBits - used);
    const n = Math.floor(bsl / 10) + 1;
    let v = 0n;
    for (let j = 0; j < n; j++) {
      const cw = cws[k + j];
      if (cw === undefined || cw >= 928) return null;
      v = v * 928n + BigInt(cw);
    }
    const s = v.toString(2);
    if (s.length > bsl) return null;
    for (const ch of s.padStart(bsl, '0')) bits.push(ch === '1' ? 1 : 0);
    k += n;
    used += bsl;
  }
  const bytes = new Uint8Array(Math.ceil(bits.length / 8));
  bits.forEach((b, i) => (bytes[i >> 3] |= b << (7 - (i & 7))));
  return bytes;
}

/** CC-B data: 920 (composite flag), then 901/924 byte compaction (6 bytes per 5 codewords). */
function byteCompaction(cws: number[]): Uint8Array | null {
  if (cws[0] !== 920 || (cws[1] !== 901 && cws[1] !== 924)) return null;
  const body = cws.slice(2);
  const out: number[] = [];
  let i = 0;
  const fullGroups = cws[1] === 924 ? body.length / 5 : Math.floor((body.length - 1) / 5);
  if (!Number.isInteger(fullGroups)) return null;
  for (let g = 0; g < fullGroups; g++, i += 5) {
    let v = 0n;
    for (let j = 0; j < 5; j++) v = v * 900n + BigInt(body[i + j]);
    const bytes: number[] = [];
    for (let j = 0; j < 6; j++) {
      bytes.unshift(Number(v % 256n));
      v /= 256n;
    }
    if (v !== 0n) return null;
    out.push(...bytes);
  }
  for (; i < body.length; i++) {
    if (body[i] > 255) return null;
    out.push(body[i]);
  }
  return Uint8Array.from(out);
}

export interface CcaRead {
  size: number;
  rows: Map<number, number[]>;
}

/** Phase 1 (no bwip-js needed): collect CC-A rows from the image. */
export function collectCca(l: Luma): CcaRead[] {
  const votes = new Map<string, Map<string, number>>();
  const step = Math.max(1, Math.floor(l.height / 260));
  let prev = '';
  for (let y = 0; y < l.height; y += step) {
    const runs = rowRuns(l, y);
    if (runs.length < 29) continue;
    const key = runs.map((v) => Math.round(v)).join(',');
    if (key === prev) continue;
    prev = key;
    for (const seg of segments(runs)) {
      for (const dir of [seg, [...seg].reverse()]) {
        if (dir.length < 25 || dir.length > 60) continue;
        for (const q of quantizeAll(dir, [1, 2, 3, 4, 5, 6]))
          for (const rr of readCcaRow(q)) {
            const k = `${rr.size}:${rr.index}`;
            const m = votes.get(k) ?? new Map<string, number>();
            votes.set(k, m);
            const ck = rr.cws.join(',');
            m.set(ck, (m.get(ck) ?? 0) + 1);
          }
      }
    }
  }
  const bySize = new Map<number, Map<number, number[]>>();
  for (const [k, m] of votes) {
    const [size, index] = k.split(':').map(Number);
    let best = '';
    let n = 0;
    for (const [ck, c] of m) if (c > n) [best, n] = [ck, c];
    const rows = bySize.get(size) ?? new Map<number, number[]>();
    bySize.set(size, rows);
    rows.set(index, best.split(',').map(Number));
  }
  return [...bySize]
    .map(([size, rows]) => ({ size, rows }))
    .filter((x) => x.rows.size === SIZES[x.size].m[1]);
}

/** Phase 2: decode and verify. Returns the bracketed element string, e.g. "(99)1234-abcd". */
export function decodeCca(bwip: BwipRaw, reads: CcaRead[]): string | null {
  for (const { size, rows } of reads) {
    const { kind, m } = SIZES[size];
    const [c, r, k] = m;
    const cws: number[] = [];
    for (let i = 0; i < r; i++) cws.push(...rows.get(i)!);
    const n = r * c - k;
    const data = cws.slice(0, n);
    while (data.length && data[data.length - 1] === 900) data.pop();
    let text: string | null;
    if (kind === 'a') {
      const bytes = cwsToBits(data, CCA_BITS[c][r]);
      text = bytes && decodeCompositeBits(bytes, CCA_BITS[c][r]);
    } else {
      const bytes = byteCompaction(data);
      text = bytes && decodeCompositeBits(bytes);
    }
    if (!text) continue;
    // Re-encode and compare every row, error-correction codewords included.
    const raw = tryRaw(bwip, 'gs1-cc', text, `ccversion=${kind} cccolumns=${c}`) as {
      pixs?: number[];
      pixx?: number;
    } | null;
    if (!raw?.pixs || !raw.pixx) continue;
    const seen = new Set<string>();
    let ok = true;
    let count = 0;
    for (let y = 0; y * raw.pixx < raw.pixs.length && ok; y++) {
      const bits = raw.pixs.slice(y * raw.pixx, (y + 1) * raw.pixx);
      const key = bits.join('');
      if (seen.has(key)) continue;
      seen.add(key);
      // Back to widths, then through the same row reader.
      const widths: number[] = [];
      let run = 1;
      for (let x = 1; x < bits.length; x++) {
        if (bits[x] === bits[x - 1]) run++;
        else {
          widths.push(run);
          run = 1;
        }
      }
      widths.push(run);
      if (bits[0] === 0) widths.shift();
      const rr = readCcaRow(widths).find((x) => x.size === size);
      if (!rr) continue;
      count++;
      const mine = rows.get(rr.index);
      if (!mine || mine.join(',') !== rr.cws.join(',')) ok = false;
    }
    if (ok && count === r) return text;
  }
  return null;
}
