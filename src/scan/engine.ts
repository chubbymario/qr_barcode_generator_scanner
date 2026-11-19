// One call to scan an image: zxing-cpp first, then the app's own decoders for
// the formats zxing-cpp can't read, plus two kinds of follow-up:
//  - GS1 composites: pair the linear barcode with its 2D part (decoding CC-B/C
//    bytes from zxing-cpp, or reading CC-A/CC-B rows with the app's reader);
//  - Codablock F: zxing-cpp reads its rows as separate Code 128 symbols, so
//    when Code 128 turns up, check whether it's really a Codablock F.
// The 1 MB bwip-js encoder is only loaded when there's something to verify.

import { readWithZxing, type ReadResult } from './zxing';
import type { ReaderOptions } from 'zxing-wasm/reader';
import {
  PICK_ONLY,
  AUTO_ZXING_FORMATS,
  COMPOSITE_ALIASES,
  compositeFormats,
  framesNeeded,
  SCANNABLE,
  ZX_TARGETS,
} from './targets';
import { COMPOSITE_FORMATS } from './support';
import { bcidForZxing, EXTRA_LABELS, zxingLabel } from './formats';
import {
  collectCca,
  collectStacked,
  decodeCca,
  decodeExtra,
  finishStacked,
  lumaFromRgba,
  flatten,
  rotateBy,
  straighten,
  type BwipRaw,
  type Luma,
} from './extra';
import { decodeCompositeBits } from './gs1cc';
import { maxiCodeCandidates } from './maxicode';
import { barsAfter, looksLikeStackedRow } from './neighbours';
import { interpretations, preferTarget } from './identify';
import { SYMBOL_NAMES } from '../barcode/names';
import { loadBwip } from '../barcode/render';

export interface ScanResult {
  text: string;
  label: string; // format name for people
  bcid?: string; // bwip-js id, for "Edit in generator"
  engine: 'zxing' | 'app';
  /** Corners in image pixels, when known. */
  corners?: { x: number; y: number }[];
  /** Camera frames in a row that must agree before this read is shown. */
  frames?: number;
  /** Facts about the read, e.g. a check digit that was removed. */
  details?: [string, string][];
  /** Other formats that print the same bars, e.g. EAN-13 for a UPC-A. */
  alternatives?: { label: string; text: string; bcid?: string }[];
  /** What "Edit in generator" loads, when not bcid + text. */
  edit?: { bcid: string; text: string };
}

/** "auto" = everything; "standard" = zxing-cpp only; otherwise one format's bwip-js id. */
export type LookFor = string;

export interface ScanOptions {
  lookFor: LookFor;
  /** Faster settings for live camera frames. */
  fast?: boolean;
  /** Whether to also run the app's own decoders on this frame ("auto" only). */
  extras?: boolean;
  /** A live camera frame, which needs stricter settings than a still image. */
  live?: boolean;
  /** Internal: this is already the evened-out copy, don't even it out again. */
  flattened?: boolean;
}

async function bwipRaw(): Promise<BwipRaw> {
  const mod = await loadBwip();
  // In bwip-js's browser build the named export "raw" is the Custom 1D
  // symbology; the raw-data function lives on the default export.
  return (mod as unknown as { default?: BwipRaw }).default ?? (mod as unknown as BwipRaw);
}

/** Linear barcodes that can carry a GS1 composite 2D part, and the composite's bwip-js id. */
const COMPOSITE_OF: Record<string, string> = {
  EAN13: 'ean13composite',
  EAN8: 'ean8composite',
  UPCA: 'upcacomposite',
  UPCE: 'upcecomposite',
  DataBar: 'databaromnicomposite',
  DataBarOmni: 'databaromnicomposite',
  DataBarStk: 'databarstackedcomposite',
  DataBarStkOmni: 'databarstackedomnicomposite',
  DataBarLtd: 'databarlimitedcomposite',
  DataBarExp: 'databarexpandedcomposite',
  DataBarExpStk: 'databarexpandedstackedcomposite',
};

function compositeId(r: ReadResult): string | undefined {
  if (r.format === 'Code128') return r.contentType === 'GS1' ? 'gs1-128composite' : undefined;
  return COMPOSITE_OF[r.format];
}

/** The format the scanner is set to, if it's one format (used to rank interpretations). */
let preferred: string | undefined;

function fromZxing(r: ReadResult): ScanResult {
  const p = r.position;
  const list = preferTarget(
    interpretations(
      {
        text: r.text,
        label: zxingLabel(r.format, r.contentType),
        bcid: bcidForZxing(r.format, r.contentType),
      },
      {
        format: r.format,
        symbologyIdentifier: r.symbologyIdentifier,
        extra: r.extra,
        version: r.version,
        contentType: r.contentType,
        width: (r as { symbol?: { width?: number } }).symbol?.width,
      },
    ),
    preferred,
  );
  // Set to a format no rule can tell apart (Compact PDF417, D3 AQR...): name it as picked.
  if (preferred && !list.some((x) => x.bcid === preferred) && SYMBOL_NAMES[preferred])
    list.unshift({ ...list[0], bcid: preferred, label: SYMBOL_NAMES[preferred], edit: undefined });
  const [top, ...rest] = list;
  const alternatives = rest
    .filter((a) => a.label !== top.label || a.text !== top.text)
    .map((a) => ({ label: a.label, text: a.text, bcid: a.bcid }));
  return {
    text: top.text,
    label: top.label,
    bcid: top.bcid,
    engine: 'zxing',
    corners: p ? [p.topLeft, p.topRight, p.bottomRight, p.bottomLeft] : undefined,
    details: top.details?.length ? top.details : undefined,
    alternatives: alternatives.length ? alternatives : undefined,
    edit: top.edit,
  };
}

/** Composite id for each linear format the 2D part can sit on. */
const COMPOSITE_FOR: Record<string, string> = {
  ean13: 'ean13composite',
  isbn: 'ean13composite',
  ismn: 'ean13composite',
  issn: 'ean13composite',
  upca: 'upcacomposite',
  ean8: 'ean8composite',
  mands: 'ean8composite',
  upce: 'upcecomposite',
  databaromni: 'databaromnicomposite',
  databartruncated: 'databartruncatedcomposite',
  databarstacked: 'databarstackedcomposite',
  databarstackedomni: 'databarstackedomnicomposite',
  databarlimited: 'databarlimitedcomposite',
  databarexpanded: 'databarexpandedcomposite',
  databarexpandedstacked: 'databarexpandedstackedcomposite',
  'gs1-128': 'gs1-128composite',
  ean14: 'gs1-128composite',
  sscc18: 'gs1-128composite',
};

function compositeResult(linear: ReadResult, cc: string): ScanResult {
  const base = fromZxing(linear);
  const id = COMPOSITE_FOR[base.bcid ?? ''] ?? compositeId(linear);
  // A GS1-128 composite is named as such whatever its AIs (EAN-14, SSCC-18).
  const name = (b: { label: string; bcid?: string }) =>
    COMPOSITE_FOR[b.bcid ?? ''] === 'gs1-128composite'
      ? 'GS1-128 composite'
      : `${b.label} composite`;
  const alternatives = base.alternatives
    ?.filter((a) => COMPOSITE_FOR[a.bcid ?? ''] !== id)
    .map((a) => ({ label: name(a), text: `${a.text}|${cc}`, bcid: COMPOSITE_FOR[a.bcid ?? ''] }));
  return {
    ...base,
    text: `${base.text}|${cc}`,
    label: name(base),
    bcid: id,
    edit: undefined,
    alternatives: alternatives?.length ? alternatives : undefined,
  };
}

async function postProcess(
  results: ReadResult[],
  luma: () => Luma,
  straight: () => Luma | null,
): Promise<ScanResult[]> {
  // 1. 2D composite parts that zxing-cpp read as (Micro)PDF417 bytes.
  const ccs: { r: ReadResult; text: string }[] = [];
  const rest: ReadResult[] = [];
  for (const r of results) {
    const cc =
      /PDF417/.test(r.format) && r.contentType !== 'Text' ? decodeCompositeBits(r.bytes) : null;
    if (cc) ccs.push({ r, text: cc });
    else rest.push(r);
  }
  const linear = rest.filter((r) => compositeId(r));
  let unreadCc = false;
  // 2. No 2D part found yet, but a linear GS1 code is present: look for CC-A/CC-B rows.
  if (linear.length && !ccs.length) {
    // Try the image as it is, then straightened.
    const copies = [luma, straight];
    for (const get of copies) {
      const l = get();
      if (!l) continue;
      const reads = collectCca(l);
      if (!reads.length) continue;
      const text = decodeCca(await bwipRaw(), reads);
      if (text) {
        ccs.push({ r: linear[0], text });
        unreadCc = false;
        break;
      }
      unreadCc = true;
    }
  }
  const out: ScanResult[] = [];
  const usedCc = new Set<number>();
  for (const r of rest) {
    const comp = compositeId(r);
    const ccIndex = comp ? ccs.findIndex((_, i) => !usedCc.has(i)) : -1;
    if (comp && ccIndex >= 0) {
      usedCc.add(ccIndex);
      out.push(compositeResult(r, ccs[ccIndex].text));
    } else if (comp && unreadCc) {
      // Rows of a 2D composite part were seen but couldn't be read: say the
      // read is incomplete, and on the camera wait longer for a full read.
      const base = fromZxing(r);
      out.push({
        ...base,
        details: [
          ...(base.details ?? []),
          [
            'Incomplete',
            'There’s a 2D composite part above this code that couldn’t be read. Move closer or hold steadier.',
          ],
        ],
        frames: 8,
      });
    } else out.push(fromZxing(r));
  }
  ccs.forEach((cc, i) => {
    if (!usedCc.has(i) && cc.r && /PDF417/.test(cc.r.format)) {
      out.push({
        ...fromZxing(cc.r),
        text: cc.text,
        label: 'GS1 composite 2D part',
        bcid: 'gs1-cc',
        // The (Micro)PDF417 reading of the same bytes is binary, not a real alternative.
        alternatives: undefined,
        details: undefined,
        edit: undefined,
      });
    }
  });

  // 3. Code 128 that's really a row of a Codablock F.
  // A plain (non-GS1) Code 128 with more rows of bars right above or below it
  // is part of a stacked code the reader couldn't put together: don't show it.
  const stackedRow = new Set(
    results
      .filter(
        (r) =>
          r.format === 'Code128' &&
          r.contentType !== 'GS1' &&
          r.position &&
          looksLikeStackedRow(luma(), r.position),
      )
      .map((r) => r.text),
  );
  if (stackedRow.size) {
    for (let i = out.length - 1; i >= 0; i--)
      if (
        (out[i].bcid === 'code128' || out[i].bcid === 'hibccode128') &&
        [...stackedRow].some((t) => t.includes(out[i].text) || out[i].text.includes(t.slice(1)))
      )
        out.splice(i, 1);
  }
  if (results.some((r) => r.format === 'Code128')) {
    const rows =
      collectStacked(luma(), 'codablockf', 1) ??
      (straight() ? collectStacked(straight()!, 'codablockf', 1) : null);
    if (rows) {
      const others = out.filter((r) => r.bcid !== 'code128' && r.bcid !== 'hibccode128');
      const cb = rows.cb.size >= 2 ? finishStacked(await bwipRaw(), rows) : null;
      if (cb)
        return [
          { text: cb.text, label: EXTRA_LABELS[cb.bcid] ?? cb.bcid, bcid: cb.bcid, engine: 'app' },
          ...others,
        ];
      // Rows of a Codablock F that couldn't be put together: showing them as
      // Code 128 would give part of the message (and its row markers) as if it
      // were all of it. Show nothing for them; the next frame may do better.
      return others;
    }
  }
  return out;
}

type Box = { x0: number; y0: number; x1: number; y1: number };
function boxOf(r: ReadResult): Box | null {
  const p = r.position;
  if (!p) return null;
  const xs = [p.topLeft.x, p.topRight.x, p.bottomRight.x, p.bottomLeft.x];
  const ys = [p.topLeft.y, p.topRight.y, p.bottomRight.y, p.bottomLeft.y];
  return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
}
const area = (b: Box) => Math.max(1, b.x1 - b.x0) * Math.max(1, b.y1 - b.y0);
const span = (b: Box) => Math.max(b.x1 - b.x0, b.y1 - b.y0);

/**
 * Drop reads that are part of another read: zxing-cpp can find a short code
 * (a UPC-E, an ITF fragment) inside the bars of a longer one, with a valid
 * check digit. Of two overlapping linear reads the longer one wins, and
 * several Code 128 reads stacked exactly on top of each other are the rows
 * of a Codablock F (handled separately), not separate codes.
 */
function pruneOverlaps(results: ReadResult[], live = false): ReadResult[] {
  const linear = (r: ReadResult) => !/QR|DataMatrix|Aztec|PDF417|MaxiCode/.test(r.format);
  // Short codes with a weak check (UPC-E, EAN-8, Codabar, and Code 39 or ITF
  // without a check character) found on only a couple of scan lines are
  // usually a misread of something else: a real one is crossed by many lines.
  const weak = (r: ReadResult) =>
    /^(UPCE|EAN8|Codabar)$/.test(r.format) ||
    (/^Code39/.test(r.format) && r.symbologyIdentifier !== ']A1') ||
    (r.format === 'ITF' && r.symbologyIdentifier !== ']I1');
  // UPC-E and EAN-8 always; the others only in still images (on the camera,
  // several frames must agree instead).
  results = results.filter(
    (r) =>
      !(weak(r) && r.lineCount > 0 && r.lineCount < 6 && (!live || /^(UPCE|EAN8)$/.test(r.format))),
  );
  const boxes = results.map(boxOf);
  const drop = new Set<number>();
  results.forEach((a, i) => {
    const ba = boxes[i];
    if (!ba || !linear(a)) return;
    results.forEach((b, j) => {
      const bb = boxes[j];
      if (i === j || !bb || !linear(b) || drop.has(j)) return;
      const ix = Math.min(ba.x1, bb.x1) - Math.max(ba.x0, bb.x0);
      const iy = Math.min(ba.y1, bb.y1) - Math.max(ba.y0, bb.y0);
      // Overlap measured along the bars' direction only (linear boxes are thin).
      const horizontal = ba.x1 - ba.x0 >= ba.y1 - ba.y0;
      const overlap = horizontal
        ? ix / Math.min(ba.x1 - ba.x0, bb.x1 - bb.x0)
        : iy / Math.min(ba.y1 - ba.y0, bb.y1 - bb.y0);
      const near = horizontal
        ? Math.abs(ba.y0 + ba.y1 - (bb.y0 + bb.y1)) / 2 < Math.max(12, span(ba) * 0.5)
        : Math.abs(ba.x0 + ba.x1 - (bb.x0 + bb.x1)) / 2 < Math.max(12, span(ba) * 0.5);
      // The weaker read goes: fewer scan lines agreeing on it, or shorter.
      const weaker =
        b.lineCount > 0 && a.lineCount > 0
          ? b.lineCount < a.lineCount * 0.35
          : span(bb) < span(ba) || (span(bb) === span(ba) && area(bb) < area(ba));
      if (overlap > 0.5 && near && weaker) drop.add(j);
    });
  });
  const kept = results.filter((_, i) => !drop.has(i));
  // Two or more Code 128 reads of the same width, one above the other: Codablock rows.
  const c128 = kept.filter((r) => r.format === 'Code128' && boxOf(r));
  if (c128.length >= 2) {
    const bs = c128.map((r) => boxOf(r)!);
    const sameColumn = bs.every(
      (b) =>
        Math.abs(b.x0 - bs[0].x0) < span(bs[0]) * 0.06 &&
        Math.abs(b.x1 - bs[0].x1) < span(bs[0]) * 0.06,
    );
    if (sameColumn) return kept.filter((r) => !c128.includes(r));
  }
  return kept;
}

/** Composites whose linear parts zxing-cpp can't tell apart count as the same. */
function sameComposite(found: string | undefined, target: string): boolean {
  if (!found) return false;
  return found === target || (COMPOSITE_ALIASES[target] ?? []).includes(found);
}

function fromExtra(r: { bcid: string; text: string }): ScanResult {
  return { text: r.text, label: EXTRA_LABELS[r.bcid] ?? r.bcid, bcid: r.bcid, engine: 'app' };
}

export async function scanImage(image: ImageData, opts: ScanOptions): Promise<ScanResult[]> {
  const target = opts.lookFor;
  preferred =
    target === 'auto' || target === 'standard'
      ? undefined
      : (Object.entries(COMPOSITE_FOR).find(([, c]) => c === target)?.[0] ?? target);
  let lumaCache: Luma | null = null;
  const luma = () => (lumaCache ??= lumaFromRgba(image.data, image.width, image.height));
  // The same image with its bars straightened, for the app's own decoders,
  // which read along rows and columns (zxing-cpp copes with tilt itself).
  let straightCache: { image: Luma; angle: number } | null | undefined;
  const straightened = () =>
    straightCache === undefined ? (straightCache = straighten(luma())) : straightCache;
  const straight = () => straightened()?.image ?? null;
  // Straightened first when the bars lean: a tilted row of bars can pass for a
  // different (shorter) code, and formats without a check character can't tell.
  const extra = (bwip: BwipRaw, o: Parameters<typeof decodeExtra>[2]) => {
    const s = straight();
    const r = (s && decodeExtra(bwip, s, o)) || decodeExtra(bwip, luma(), o);
    // Formats with no check character: confirm on two more copies turned a
    // little each way. A real code reads the same; a misread rarely does.
    if (r && o?.only && PICK_ONLY.has(o.only)) {
      const base = straightened()?.angle ?? 0;
      for (const turn of [0.35, -0.35]) {
        const again = decodeExtra(bwip, rotateBy(luma(), base + turn), o);
        if (!again || again.text !== r.text) return null;
      }
    }
    return r;
  };
  const zx = async (formats: string[]) =>
    pruneOverlaps(
      await readWithZxing(image, {
        formats: formats as ReaderOptions['formats'],
        // On camera frames a linear code must be crossed by 3 scan lines, not 2.
        ...(opts.live ? { minLineCount: 3 } : {}),
        ...(opts.fast
          ? { tryHarder: false, tryDownscale: true, tryRotate: true, tryInvert: false }
          : {}),
      }),
      opts.live,
    );
  let out: ScanResult[] = [];
  const missingAddOn = new Set<ReadResult>();

  // zxing-cpp often misses an EAN-2/EAN-5 add-on (an ISBN's price, an ISSN's
  // issue number); look for one with the app's own reader.
  const withAddOn = async (results: ReadResult[]) => {
    for (const r of results) {
      if (!/^(EAN13|UPCA|ISBN|EAN8|UPCE)$/.test(r.format)) continue;
      // Already has one (zxing-cpp joins it on, with or without a space).
      const mainLen = r.format === 'EAN8' ? 8 : r.format === 'UPCA' ? 12 : 13;
      if (/ /.test(r.text) || r.text.length > mainLen) continue;
      const bwip = await bwipRaw();
      const add =
        extra(bwip, { only: 'ean5', lines: 20 }) ?? extra(bwip, { only: 'ean2', lines: 20 });
      if (add) r.text = `${r.text} ${add.text}`;
      else if (r.position && barsAfter(luma(), r.position)) missingAddOn.add(r);
    }
    return results;
  };

  // MaxiCode in a photo: cut out a clean upright copy for zxing-cpp.
  const maxi = async (): Promise<ScanResult[]> => {
    for (const c of maxiCodeCandidates(luma())) {
      const img =
        typeof ImageData !== 'undefined'
          ? new ImageData(c.data as Uint8ClampedArray<ArrayBuffer>, c.width, c.height)
          : (c as unknown as ImageData);
      const r = await readWithZxing(img, { formats: ['MaxiCode'], tryHarder: true });
      if (r.length) return r.map((x) => ({ ...fromZxing(x), corners: undefined }));
    }
    return [];
  };

  if (target === 'auto' || target === 'standard') {
    const results = await withAddOn(await zx(AUTO_ZXING_FORMATS));
    out =
      target === 'standard' ? results.map(fromZxing) : await postProcess(results, luma, straight);
    if (!out.length && !opts.fast) out = await maxi();
    if (!out.length && target === 'auto' && opts.extras !== false) {
      const r = extra(await bwipRaw(), { lines: opts.fast ? 14 : 30, strict: true });
      if (r) out.push(fromExtra(r));
    }
  } else if (ZX_TARGETS[target]) {
    const t = ZX_TARGETS[target];
    const results = await withAddOn(await zx(t.formats));
    out = results.filter((r) => !t.accept || t.accept(r)).map(fromZxing);
    if (!out.length && target === 'maxicode') out = await maxi();
  } else if (COMPOSITE_FORMATS.includes(target)) {
    // Only a read that includes the 2D part counts as a composite.
    const all = await postProcess(await zx(compositeFormats(target)), luma, straight);
    out = all.filter((r) => sameComposite(r.bcid, target));
    if (!out.length && target === 'gs1-cc') {
      let reads = collectCca(luma());
      if (!reads.length && straight()) reads = collectCca(straight()!);
      const text = reads.length ? decodeCca(await bwipRaw(), reads) : null;
      if (text) out.push({ text, label: 'GS1 composite 2D part', bcid: 'gs1-cc', engine: 'app' });
    }
  } else if (SCANNABLE.has(target)) {
    const r = extra(await bwipRaw(), {
      only: target,
      lines: opts.fast ? 14 : 30,
    });
    if (r) out.push(fromExtra(r));
  }
  // Nothing found: try once more with the lighting evened out (a shadow or a
  // lamp to one side defeats thresholds tuned to the whole line).
  if (
    !out.length &&
    !opts.fast &&
    !opts.flattened &&
    (target !== 'auto' || opts.extras !== false)
  ) {
    const f = flatten(luma());
    const rgba = new Uint8ClampedArray(f.width * f.height * 4);
    for (let i = 0; i < f.data.length; i++) {
      rgba[i * 4] = rgba[i * 4 + 1] = rgba[i * 4 + 2] = f.data[i];
      rgba[i * 4 + 3] = 255;
    }
    const img =
      typeof ImageData !== 'undefined'
        ? new ImageData(rgba, f.width, f.height)
        : ({ data: rgba, width: f.width, height: f.height } as unknown as ImageData);
    // On the camera the retry uses the quick settings, to keep frames coming.
    return scanImage(img, { ...opts, flattened: true, fast: opts.live ? true : opts.fast });
  }
  const incompleteTexts = new Set([...missingAddOn].map((r) => r.text));
  // The same code read twice (two scan directions, say) is shown once.
  const seenKeys = new Set<string>();
  out = out.filter((r) => {
    const k = `${r.bcid}\u0000${r.text}`;
    if (seenKeys.has(k)) return false;
    seenKeys.add(k);
    return true;
  });
  return out.map((r) => {
    const flag =
      incompleteTexts.size && [...incompleteTexts].some((t) => r.text.includes(t.slice(3, 12)));
    return {
      ...r,
      ...(flag
        ? {
            details: [
              ...(r.details ?? []),
              [
                'Incomplete',
                'There’s an add-on (e.g. a price) beside this code that couldn’t be read. Move closer or hold steadier.',
              ] as [string, string],
            ],
            frames: 6,
          }
        : {}),
      frames: flag ? 6 : (r.frames ?? framesNeeded(r.bcid, r.label)),
    };
  });
}
