import type { BarcodeSettings, ExportSettings } from '../state';
import { barHeightParam, buildBwipOptions, explainBwipError, type BwipOptions } from './options';
import { clampPx, pxToMm, toPx } from '../export/size';
import { canvasToBlob, flatten, rasterizeSvg, setSvgPhysicalSize } from '../export/files';
import { withDpi } from '../export/png-dpi';
import type { SymbolInfo } from './catalog';

type Bwip = typeof import('bwip-js/browser');
let bwipPromise: Promise<Bwip> | null = null;

/** bwip-js is ~1 MB, so it only loads when a barcode is first needed. */
export function loadBwip(): Promise<Bwip> {
  bwipPromise ??= import('bwip-js/browser');
  return bwipPromise;
}

export async function symbolList(): Promise<readonly SymbolInfo[]> {
  return (await loadBwip()).symbolList;
}

export function textFor(s: BarcodeSettings, sym: SymbolInfo | undefined): string {
  return s.texts[s.bcid] ?? sym?.text ?? '';
}

export interface BarcodePlan {
  options: BwipOptions; // at scale 1, for SVG
  scale: number; // pixels per bwip unit in the final raster
  widthPx: number;
  heightPx: number;
  widthMm: number;
  heightMm: number;
}

function svgSize(svg: string): { w: number; h: number } {
  const vb = /viewBox="([\d.\s-]+)"/.exec(svg);
  if (vb) {
    const [, , w, h] = vb[1].trim().split(/\s+/).map(Number);
    return { w, h };
  }
  const w = Number(/width="([\d.]+)/.exec(svg)?.[1] ?? 0);
  const h = Number(/height="([\d.]+)/.exec(svg)?.[1] ?? 0);
  return { w, h };
}

/**
 * Work out the scale that makes the symbol the requested physical width, and
 * the bar height that makes the bars the requested physical height.
 */
export async function planBarcode(
  s: BarcodeSettings,
  text: string,
  advanced: string,
  ex: Pick<ExportSettings, 'unit' | 'size' | 'dpi' | 'crisp'>,
  targetPxOverride?: number,
): Promise<BarcodePlan> {
  const bwip = await loadBwip();
  const dpi = ex.dpi;
  const target = clampPx(targetPxOverride ?? toPx(ex.size, ex.unit, dpi));
  const rotated = s.rotate === 'R' || s.rotate === 'L';

  try {
    // Pass 1: measure at scale 1 (bar height doesn't change the width).
    const probe = buildBwipOptions(s, text, { x: 1, y: 1 }, 10, advanced);
    const probeSize = svgSize(bwip.toSVG(probe as never));
    const naturalLength = rotated ? probeSize.h : probeSize.w;
    if (!naturalLength) throw new Error('The barcode has no size.');

    let k = target / naturalLength;
    if (ex.crisp) k = Math.max(1, Math.round(k));

    // Pass 2: real bar height for that scale.
    const options = buildBwipOptions(
      s,
      text,
      { x: 1, y: 1 },
      barHeightParam(s.heightMm, dpi, k),
      advanced,
    );
    const size = svgSize(bwip.toSVG(options as never));
    const widthPx = Math.round(size.w * k);
    const heightPx = Math.round(size.h * k);
    return {
      options,
      scale: k,
      widthPx,
      heightPx,
      widthMm: pxToMm(widthPx, dpi),
      heightMm: pxToMm(heightPx, dpi),
    };
  } catch (err) {
    throw new Error(explainBwipError(err), { cause: err });
  }
}

export async function barcodeSvg(plan: BarcodePlan, physical: boolean): Promise<string> {
  const bwip = await loadBwip();
  const svg = bwip.toSVG(plan.options as never);
  return physical ? setSvgPhysicalSize(svg, plan.widthMm, plan.heightMm) : svg;
}

export async function renderBarcode(
  s: BarcodeSettings,
  plan: BarcodePlan,
  format: 'png' | 'svg' | 'jpeg' | 'webp',
  ex: Pick<ExportSettings, 'unit' | 'dpi' | 'crisp' | 'jpegQuality'>,
): Promise<Blob> {
  if (format === 'svg') {
    const svg = await barcodeSvg(plan, ex.unit !== 'px');
    return new Blob([svg], { type: 'image/svg+xml' });
  }
  const bwip = await loadBwip();
  let canvas: HTMLCanvasElement;
  if (Number.isInteger(plan.scale)) {
    // Crisp: every module is a whole number of pixels.
    canvas = document.createElement('canvas');
    try {
      bwip.toCanvas(canvas, { ...plan.options, scaleX: plan.scale, scaleY: plan.scale } as never);
    } catch (err) {
      throw new Error(explainBwipError(err), { cause: err });
    }
  } else {
    canvas = await rasterizeSvg(
      bwip.toSVG(plan.options as never),
      plan.widthPx,
      plan.heightPx,
      null,
    );
  }
  if (format === 'png') return withDpi(await canvasToBlob(canvas, 'image/png'), ex.dpi);
  const bg = s.transparentBackground ? '#ffffff' : s.backgroundcolor;
  const flat = format === 'jpeg' ? flatten(canvas, bg) : canvas;
  return canvasToBlob(flat, `image/${format}`, ex.jpegQuality);
}
