import QRCodeStyling, { type Gradient, type Options, type TypeNumber } from 'qr-code-styling';
import type { ExportFormat, Paint, QrSettings } from '../state';
import { buildPayload } from './content';
import {
  flatten,
  loadImage,
  canvasToBlob,
  setSvgPhysicalSize,
  blobToDataUrl,
} from '../export/files';
import { withDpi } from '../export/png-dpi';

function gradientOf(p: Paint): Gradient | undefined {
  if (!p.gradient) return undefined;
  return {
    type: p.gradientType,
    rotation: (p.rotation * Math.PI) / 180,
    colorStops: [
      { offset: 0, color: p.color },
      { offset: 1, color: p.color2 },
    ],
  };
}

const fill = (p: Paint) => ({ color: p.color, gradient: gradientOf(p) });

export function qrPayload(s: QrSettings): string {
  return buildPayload(s.contentType, s.fields[s.contentType] ?? {});
}

export function qrOptions(
  s: QrSettings,
  data: string,
  width: number,
  type: 'svg' | 'canvas',
): Options {
  const margin = Math.round((width * s.marginPct) / 100);
  const squareFill = s.cornersMatchDots ? fill(s.dots) : fill(s.cornerSquare);
  const dotFill = s.cornersMatchDots ? fill(s.dots) : fill(s.cornerDot);
  return {
    type,
    shape: s.shape,
    width,
    height: width,
    margin,
    data,
    image: s.logo ?? undefined,
    qrOptions: {
      typeNumber: s.typeNumber as TypeNumber,
      mode: 'Byte',
      errorCorrectionLevel: s.ecLevel,
    },
    imageOptions: {
      hideBackgroundDots: s.hideBackgroundDots,
      imageSize: s.logoSize,
      margin: Math.round((s.logoMargin * width) / 1000),
      saveAsBlob: true,
    },
    dotsOptions: { type: s.dotType, roundSize: s.roundSize, ...fill(s.dots) },
    cornersSquareOptions: {
      type: s.cornerSquareType === 'none' ? undefined : s.cornerSquareType,
      ...squareFill,
    },
    cornersDotOptions: {
      type: s.cornerDotType === 'none' ? undefined : s.cornerDotType,
      ...dotFill,
    },
    backgroundOptions: s.transparentBackground
      ? { color: 'rgba(0,0,0,0)' }
      : { round: s.backgroundRound, ...fill(s.background) },
  };
}

/** Plain-English version of qr-code-styling's errors. */
export function explainQrError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  if (/overflow|too long|length/i.test(msg)) {
    return 'There’s too much content for a QR code at this setting. Shorten it, lower the error correction, or choose a bigger version.';
  }
  return msg;
}

/** Throws a readable error if the payload won't fit. */
export function assertQrFits(s: QrSettings, data: string): void {
  // qr-code-styling throws inside update(); render a tiny probe first.
  try {
    new QRCodeStyling(qrOptions({ ...s, logo: null }, data, 64, 'svg'));
  } catch (err) {
    throw new Error(explainQrError(err), { cause: err });
  }
}

async function rawBlob(qr: QRCodeStyling, ext: 'png' | 'svg' | 'jpeg' | 'webp'): Promise<Blob> {
  const data = await qr.getRawData(ext);
  if (!data) throw new Error('The QR code could not be drawn.');
  return data instanceof Blob ? data : new Blob([data as BlobPart]);
}

export interface QrRenderResult {
  blob: Blob;
  widthPx: number;
  heightPx: number;
}

export async function renderQr(
  s: QrSettings,
  data: string,
  opts: {
    format: Exclude<ExportFormat, 'pdf'>;
    px: number;
    dpi: number;
    physicalMm?: number;
    jpegQuality?: number;
  },
): Promise<QrRenderResult> {
  assertQrFits(s, data);
  const px = opts.px;
  if (opts.format === 'svg') {
    const qr = new QRCodeStyling(qrOptions(s, data, px, 'svg'));
    let svg = await (await rawBlob(qr, 'svg')).text();
    if (opts.physicalMm) svg = setSvgPhysicalSize(svg, opts.physicalMm, opts.physicalMm);
    return { blob: new Blob([svg], { type: 'image/svg+xml' }), widthPx: px, heightPx: px };
  }
  const qr = new QRCodeStyling(qrOptions(s, data, px, 'canvas'));
  if (opts.format === 'png') {
    const png = await rawBlob(qr, 'png');
    return { blob: await withDpi(png, opts.dpi), widthPx: px, heightPx: px };
  }
  // JPEG/WebP: draw the PNG onto a solid background so transparency doesn't go black.
  const png = await rawBlob(qr, 'png');
  const img = await loadImage(await blobToDataUrl(png));
  const canvas = document.createElement('canvas');
  canvas.width = px;
  canvas.height = px;
  canvas.getContext('2d')!.drawImage(img, 0, 0);
  const bg = s.transparentBackground ? '#ffffff' : s.background.color;
  const flat = opts.format === 'jpeg' ? flatten(canvas, bg) : canvas;
  const blob = await canvasToBlob(flat, `image/${opts.format}`, opts.jpegQuality ?? 0.92);
  return { blob, widthPx: px, heightPx: px };
}

/** Live preview: an SVG element sized by CSS. */
export async function renderQrPreview(s: QrSettings, data: string): Promise<SVGSVGElement> {
  assertQrFits(s, data);
  const qr = new QRCodeStyling(qrOptions(s, data, 600, 'svg'));
  const holder = document.createElement('div');
  qr.append(holder);
  // When there's a logo, the library finishes loading it asynchronously.
  await qr.getRawData('svg');
  const svg = holder.querySelector('svg');
  if (!svg) throw new Error('The QR code could not be drawn.');
  svg.setAttribute('viewBox', '0 0 600 600');
  svg.removeAttribute('width');
  svg.removeAttribute('height');
  return svg;
}
