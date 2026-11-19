// Entry point for the app's own decoders: the formats zxing-cpp can't read.

import { rotate90, rowRuns, samplePositions, segmentsWithGaps, type Luma } from './lines';
import { PICK_ONLY } from '../targets';
import {
  decodeBc412,
  decodeChannel,
  decodeEanAddon,
  decodeFim,
  decodePharmacode,
  decodePosicode,
  decodeRawWidths,
  decodeWidthFormats,
  WIDTH_SPECS,
} from './linear';
import { decodePostal, readBars } from './postal';
import { decodeStacked, STACKED_FORMATS } from './stacked';
import type { BwipRaw, ExtraResult } from './types';

export type { BwipRaw, ExtraResult } from './types';
export { deskew, flatten, lumaFromRgba, rotateBy, straighten, type Luma } from './lines';
export { decodeStacked, collectStacked, finishStacked } from './stacked';
export { collectCca, decodeCca } from './cca';

import { EXTRA_FORMATS, HINT_ONLY_FORMATS } from '../lists';
export { EXTRA_FORMATS, HINT_ONLY_FORMATS };

const LINEAR_ONLY = new Set([
  'posicode',
  ...WIDTH_SPECS.map((s) => s.bcid),
  'industrial2of5',
  'bc412',
  'ean2',
  'ean5',
  'pharmacode',
  'channelcode',
  'symbol',
  'raw',
]);

type LinearFn = (bwip: BwipRaw, runs: number[]) => { bcid: string; text: string } | null;

/** Linear decoders that check a check character or fixed structure; used by "Everything". */
const STRICT_LINEAR = ['width', 'bc412', 'posicode'];

function linearDecoders(only?: string, strict = false): LinearFn[] {
  const id = only === 'industrial2of5' ? 'code2of5' : only;
  const all: [string[], LinearFn, string][] = [
    [['ean2', 'ean5'], decodeEanAddon, 'addon'],
    [
      WIDTH_SPECS.map((s) => s.bcid),
      (b, r) =>
        decodeWidthFormats(
          b,
          r,
          id && WIDTH_SPECS.some((s) => s.bcid === id) ? id : undefined,
          strict,
        ),
      'width',
    ],
    [['bc412'], (b, r) => wrap('bc412', decodeBc412(b, r, only === 'bc412')), 'bc412'],
    [['channelcode'], (b, r) => wrap('channelcode', decodeChannel(b, r)), 'channel'],
    [['symbol'], (b, r) => wrap('symbol', decodeFim(b, r)), 'fim'],
    [['posicode'], (b, r) => wrap('posicode', decodePosicode(b, r)), 'posicode'],
  ];
  if (only === 'raw') return [(b, r) => wrap('raw', decodeRawWidths(b, r))];
  if (only === 'pharmacode') return [(b, r) => wrap('pharmacode', decodePharmacode(b, r))];
  return all
    .filter(
      ([ids, , kind]) => (!id || ids.includes(id)) && (!strict || STRICT_LINEAR.includes(kind)),
    )
    .map(([, fn]) => fn);
}

const wrap = (bcid: string, text: string | null) => (text === null ? null : { bcid, text });

interface Found {
  result: ExtraResult;
  bars: number;
  hits: number;
}

/**
 * Try every line and keep the verified read that spans the most bars. The
 * human-readable text under a barcode can itself look like a tiny barcode,
 * so the first match isn't necessarily the real one.
 */
function scanLines(
  bwip: BwipRaw,
  l: Luma,
  fns: LinearFn[],
  lines: number,
  strict = false,
): Found | null {
  const found = new Map<string, Found>();
  for (const y of samplePositions(l.height, lines)) {
    const runs = rowRuns(l, y);
    for (const { runs: seg, before, after } of segmentsWithGaps(runs)) {
      if (!hasQuietZones(seg, before, after)) continue;
      for (const fn of fns) {
        const r = fn(bwip, seg);
        if (!r) continue;
        const key = `${r.bcid}\u0000${r.text}`;
        const f = found.get(key);
        const bars = (seg.length + 1) / 2;
        if (f) {
          f.hits++;
          f.bars = Math.max(f.bars, bars);
        } else found.set(key, { result: r, bars, hits: 1 });
        break;
      }
    }
  }
  // A real barcode is crossed by several scan lines that agree.
  return best([...found.values()].filter((f) => f.hits >= (strict ? 3 : 2)));
}

/** Blank space either side of at least 4 narrow bars: a barcode, not part of a pattern. */
function hasQuietZones(seg: number[], before: number, after: number): boolean {
  const sorted = [...seg].sort((a, b) => a - b);
  const narrow = sorted[Math.floor(sorted.length * 0.1)];
  return before >= narrow * 4 && after >= narrow * 4;
}

function best(list: (Found | null)[]): Found | null {
  let top: Found | null = null;
  for (const f of list) {
    if (f && (!top || f.bars > top.bars || (f.bars === top.bars && f.hits > top.hits))) top = f;
  }
  return top;
}

export interface ExtraOptions {
  /** Restrict to one bwip-js format id. */
  only?: string;
  /** Lines sampled per direction (more is slower but finds smaller codes). */
  lines?: number;
  /**
   * For "Everything": skip formats with no check character, and require quiet
   * zones and agreement between scan lines, so random patterns don't read.
   */
  strict?: boolean;
}

/**
 * Try the app's own decoders on a greyscale image. Returns at most one result.
 * Width-based codes are tried along rows and columns; height-based postal codes
 * are tried on the image and its 90° rotation (180° is handled inside).
 */
export function decodeExtra(
  bwip: BwipRaw,
  image: Luma,
  opts: ExtraOptions = {},
): ExtraResult | null {
  const { only } = opts;
  const strict = !only && !!opts.strict;
  const lines = opts.lines ?? 24;
  const wantStacked = !only || STACKED_FORMATS.includes(only);
  let rotated: Luma | null = null;
  const turned = () => (rotated ??= rotate90(image));
  const candidates: (Found | null)[] = [];

  // Stacked codes first: each row could otherwise pass for a short linear code.
  if (wantStacked) {
    const r = decodeStacked(bwip, image, only) ?? decodeStacked(bwip, turned(), only);
    if (r) return r;
    if (only) return null;
  }
  const wantLinearAll = !only || LINEAR_ONLY.has(only);
  const wantPostalAll = !only || !LINEAR_ONLY.has(only);

  if (wantLinearAll && only !== 'pharmacode') {
    const fns = linearDecoders(only, strict);
    candidates.push(
      scanLines(bwip, image, fns, lines, strict),
      scanLines(bwip, turned(), fns, lines, strict),
    );
  }
  if (wantPostalAll) {
    // Upright and turned: keep the reading whose "bars" are tallest for their
    // width. Turned the wrong way, rows of a code can pass for short bars.
    let postal: { r: ExtraResult; n: number; aspect: number } | null = null;
    for (const l of [image, turned()]) {
      const bars = readBars(l, only === 'pharmacode2' ? 2 : only ? 4 : 10);
      if (!bars) continue;
      const r = decodePostal(bwip, bars, only, strict ? PICK_ONLY : undefined);
      const aspect = bars.aspect ?? 0;
      if (r && (!postal || aspect > postal.aspect)) postal = { r, n: bars.states.length, aspect };
    }
    if (postal) candidates.push({ result: postal.r, bars: postal.n, hits: 1 });
  }
  const top = best(candidates);
  if (top) return top.result;
  // Pharmacode last: almost any row of plain bars is a valid Pharmacode.
  if ((!only && !strict) || only === 'pharmacode') {
    const fns = linearDecoders('pharmacode');
    return (
      best([scanLines(bwip, image, fns, lines), scanLines(bwip, turned(), fns, lines)])?.result ??
      null
    );
  }
  return null;
}
