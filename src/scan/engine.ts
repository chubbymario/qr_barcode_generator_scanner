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
  deskew,
  type BwipRaw,
  type Luma,
} from './extra';
import { decodeCompositeBits } from './gs1cc';
import { maxiCodeCandidates } from './maxicode';
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
  const name = (b: ScanResult | { label: string }) =>
    `${b.label.replace(/ \(GS1-128\)$/, '')} composite`;
  return {
    ...base,
    text: `${base.text}|${cc}`,
    label: name(base),
    bcid: id,
    edit: undefined,
    alternatives: base.alternatives?.map((a) => ({
      label: name(a),
      text: `${a.text}|${cc}`,
      bcid: COMPOSITE_FOR[a.bcid ?? ''],
    })),
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
  // 2. No 2D part found yet, but a linear GS1 code is present: look for CC-A/CC-B rows.
  if (linear.length && !ccs.length) {
    let reads = collectCca(luma());
    if (!reads.length && straight()) reads = collectCca(straight()!);
    if (reads.length) {
      const text = decodeCca(await bwipRaw(), reads);
      if (text) ccs.push({ r: linear[0], text });
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
    } else out.push(fromZxing(r));
  }
  ccs.forEach((cc, i) => {
    if (!usedCc.has(i) && cc.r && /PDF417/.test(cc.r.format)) {
      out.push({
        ...fromZxing(cc.r),
        text: cc.text,
        label: 'GS1 composite 2D part',
        bcid: 'gs1-cc',
      });
    }
  });

  // 3. Code 128 that's really a row of a Codablock F.
  if (results.some((r) => r.format === 'Code128')) {
    const rows =
      collectStacked(luma(), 'codablockf') ??
      (straight() ? collectStacked(straight()!, 'codablockf') : null);
    if (rows) {
      const cb = finishStacked(await bwipRaw(), rows);
      if (cb) {
        const others = out.filter((r) => r.label !== 'Code 128' && r.label !== 'GS1 Code 128');
        return [
          { text: cb.text, label: EXTRA_LABELS[cb.bcid] ?? cb.bcid, bcid: cb.bcid, engine: 'app' },
          ...others,
        ];
      }
    }
  }
  return out;
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
  let straightCache: Luma | null | undefined;
  const straight = () =>
    straightCache === undefined ? (straightCache = deskew(luma())) : straightCache;
  const extra = (bwip: BwipRaw, o: Parameters<typeof decodeExtra>[2]) => {
    const r = decodeExtra(bwip, luma(), o);
    if (r) return r;
    const s = straight();
    return s ? decodeExtra(bwip, s, o) : null;
  };
  const zx = (formats: string[]) =>
    readWithZxing(image, {
      formats: formats as ReaderOptions['formats'],
      // On camera frames a linear code must be crossed by 3 scan lines, not 2.
      ...(opts.live ? { minLineCount: 3 } : {}),
      ...(opts.fast
        ? { tryHarder: false, tryDownscale: true, tryRotate: true, tryInvert: false }
        : {}),
    });
  let out: ScanResult[] = [];

  // zxing-cpp often misses an EAN-2/EAN-5 add-on (an ISBN's price, an ISSN's
  // issue number); look for one with the app's own reader.
  const withAddOn = async (results: ReadResult[]) => {
    for (const r of results) {
      if (!/^(EAN13|UPCA|ISBN|EAN8|UPCE)$/.test(r.format) || / /.test(r.text)) continue;
      const bwip = await bwipRaw();
      const add =
        extra(bwip, { only: 'ean5', lines: 20 }) ?? extra(bwip, { only: 'ean2', lines: 20 });
      if (add) r.text = `${r.text} ${add.text}`;
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
  return out.map((r) => ({ ...r, frames: framesNeeded(r.bcid, r.label) }));
}
