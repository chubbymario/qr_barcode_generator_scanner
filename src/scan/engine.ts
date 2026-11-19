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
  type BwipRaw,
  type Luma,
} from './extra';
import { decodeCompositeBits } from './gs1cc';
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

function fromZxing(r: ReadResult): ScanResult {
  const p = r.position;
  return {
    text: r.text,
    label: zxingLabel(r.format, r.contentType),
    bcid: bcidForZxing(r.format, r.contentType),
    engine: 'zxing',
    corners: p ? [p.topLeft, p.topRight, p.bottomRight, p.bottomLeft] : undefined,
  };
}

async function postProcess(results: ReadResult[], luma: () => Luma): Promise<ScanResult[]> {
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
    const reads = collectCca(luma());
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
      const base = fromZxing(r);
      out.push({
        ...base,
        text: `${r.text}|${ccs[ccIndex].text}`,
        label: `${base.label} composite`,
        bcid: comp,
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
      });
    }
  });

  // 3. Code 128 that's really a row of a Codablock F.
  if (results.some((r) => r.format === 'Code128')) {
    const rows = collectStacked(luma(), 'codablockf');
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
  let lumaCache: Luma | null = null;
  const luma = () => (lumaCache ??= lumaFromRgba(image.data, image.width, image.height));
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

  if (target === 'auto' || target === 'standard') {
    const results = await zx(AUTO_ZXING_FORMATS);
    out = target === 'standard' ? results.map(fromZxing) : await postProcess(results, luma);
    if (!out.length && target === 'auto' && opts.extras !== false) {
      const r = decodeExtra(await bwipRaw(), luma(), { lines: opts.fast ? 14 : 30, strict: true });
      if (r) out.push(fromExtra(r));
    }
  } else if (ZX_TARGETS[target]) {
    const t = ZX_TARGETS[target];
    const results = await zx(t.formats);
    out = results.filter((r) => !t.accept || t.accept(r)).map(fromZxing);
  } else if (COMPOSITE_FORMATS.includes(target)) {
    // Only a read that includes the 2D part counts as a composite.
    const all = await postProcess(await zx(compositeFormats(target)), luma);
    out = all.filter((r) => sameComposite(r.bcid, target));
    if (!out.length && target === 'gs1-cc') {
      const reads = collectCca(luma());
      const text = reads.length ? decodeCca(await bwipRaw(), reads) : null;
      if (text) out.push({ text, label: 'GS1 composite 2D part', bcid: 'gs1-cc', engine: 'app' });
    }
  } else if (SCANNABLE.has(target)) {
    const r = decodeExtra(await bwipRaw(), luma(), {
      only: target,
      lines: opts.fast ? 14 : 30,
    });
    if (r) out.push(fromExtra(r));
  }
  return out.map((r) => ({ ...r, frames: framesNeeded(r.bcid, r.label) }));
}
