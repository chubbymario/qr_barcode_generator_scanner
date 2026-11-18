// One call to scan an image: zxing-cpp first, then the app's own decoders for
// the formats zxing-cpp can't read, plus two kinds of follow-up:
//  - GS1 composites: pair the linear barcode with its 2D part (decoding CC-B/C
//    bytes from zxing-cpp, or reading CC-A/CC-B rows with the app's reader);
//  - Codablock F: zxing-cpp reads its rows as separate Code 128 symbols, so
//    when Code 128 turns up, check whether it's really a Codablock F.
// The 1 MB bwip-js encoder is only loaded when there's something to verify.

import { readWithZxing, type ReadResult } from './zxing';
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
}

/** "auto" = everything; "standard" = zxing only; otherwise a bwip-js id for one app-decoded format. */
export type LookFor = string;

export interface ScanOptions {
  lookFor: LookFor;
  /** Faster settings for live camera frames. */
  fast?: boolean;
  /** Whether to also run the app's own decoders on this frame. */
  extras?: boolean;
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

export async function scanImage(image: ImageData, opts: ScanOptions): Promise<ScanResult[]> {
  const onlyExtra = opts.lookFor !== 'auto' && opts.lookFor !== 'standard';
  let lumaCache: Luma | null = null;
  const luma = () => (lumaCache ??= lumaFromRgba(image.data, image.width, image.height));
  let out: ScanResult[] = [];
  if (!onlyExtra) {
    const results = await readWithZxing(
      image,
      opts.fast ? { tryHarder: false, tryDownscale: true, tryRotate: true, tryInvert: false } : {},
    );
    out = opts.lookFor === 'standard' ? results.map(fromZxing) : await postProcess(results, luma);
  }
  const wantExtras = onlyExtra || (opts.lookFor === 'auto' && opts.extras !== false);
  if (!out.length && wantExtras) {
    const bwip = await bwipRaw();
    const r = decodeExtra(bwip, luma(), {
      only: onlyExtra ? opts.lookFor : undefined,
      lines: opts.fast ? 14 : 30,
    });
    if (r)
      out.push({
        text: r.text,
        label: EXTRA_LABELS[r.bcid] ?? r.bcid,
        bcid: r.bcid,
        engine: 'app',
      });
  }
  return out;
}
