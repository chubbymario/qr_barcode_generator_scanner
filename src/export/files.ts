import type { ExportFormat } from '../state';

export const MIME: Record<Exclude<ExportFormat, 'pdf'>, string> = {
  png: 'image/png',
  svg: 'image/svg+xml',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
};

export const EXTENSION: Record<ExportFormat, string> = {
  png: 'png',
  svg: 'svg',
  jpeg: 'jpg',
  webp: 'webp',
  pdf: 'pdf',
};

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** Make a string safe to use as a file name on Windows, macOS and Linux. */
export function safeFilename(name: string, fallback = 'code'): string {
  const cleaned = name
    .replace(/^[a-z]+:\/\//i, '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/^[-. ]+|[-. ]+$/g, '')
    .slice(0, 80);
  return cleaned || fallback;
}

export function canvasToBlob(
  canvas: HTMLCanvasElement,
  type: string,
  quality?: number,
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) =>
        blob ? resolve(blob) : reject(new Error('This browser could not create the image.')),
      type,
      quality,
    );
  });
}

export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('The image could not be read.'));
    img.src = src;
  });
}

/** Draw an SVG string onto a canvas at an exact pixel size. */
export async function rasterizeSvg(
  svg: string,
  width: number,
  height: number,
  background: string | null,
): Promise<HTMLCanvasElement> {
  const url = URL.createObjectURL(new Blob([svg], { type: MIME.svg }));
  try {
    const img = await loadImage(url);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas is not available in this browser.');
    if (background) {
      ctx.fillStyle = background;
      ctx.fillRect(0, 0, width, height);
    }
    ctx.drawImage(img, 0, 0, width, height);
    return canvas;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Paint a transparent canvas onto a solid colour (JPEG has no alpha). */
export function flatten(source: HTMLCanvasElement, color: string): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = source.width;
  canvas.height = source.height;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(source, 0, 0);
  return canvas;
}

/** Give an SVG physical width/height (e.g. "40mm") while keeping its viewBox. */
export function setSvgPhysicalSize(svg: string, widthMm: number, heightMm: number): string {
  const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
  const root = doc.documentElement;
  if (!root.getAttribute('viewBox')) {
    const w = parseFloat(root.getAttribute('width') ?? '0');
    const h = parseFloat(root.getAttribute('height') ?? '0');
    if (w && h) root.setAttribute('viewBox', `0 0 ${w} ${h}`);
  }
  root.setAttribute('width', `${+widthMm.toFixed(3)}mm`);
  root.setAttribute('height', `${+heightMm.toFixed(3)}mm`);
  return new XMLSerializer().serializeToString(root);
}

export async function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

/** Takes a promise so Safari still treats the copy as part of the click. */
export async function copyImageToClipboard(png: Promise<Blob>): Promise<void> {
  if (!('ClipboardItem' in window) || !navigator.clipboard?.write) {
    throw new Error('This browser can’t copy images. Download the file instead.');
  }
  await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]);
}

/** One image per page, each page exactly the size of the image. */
export async function imagesToPdf(
  pages: { png: Blob; widthMm: number; heightMm: number }[],
): Promise<Blob> {
  const { jsPDF } = await import('jspdf');
  let pdf: InstanceType<typeof jsPDF> | null = null;
  for (const page of pages) {
    const orientation = page.widthMm > page.heightMm ? 'landscape' : 'portrait';
    const format: [number, number] = [page.widthMm, page.heightMm];
    if (!pdf) pdf = new jsPDF({ unit: 'mm', format, orientation, compress: true });
    else pdf.addPage(format, orientation);
    const data = new Uint8Array(await page.png.arrayBuffer());
    pdf.addImage(data, 'PNG', 0, 0, page.widthMm, page.heightMm, undefined, 'NONE');
  }
  if (!pdf) throw new Error('Nothing to put in the PDF.');
  return pdf.output('blob');
}

export function printImage(src: string, widthMm: number, heightMm: number): void {
  const frame = document.createElement('iframe');
  frame.setAttribute('aria-hidden', 'true');
  frame.style.cssText = 'position:fixed;width:0;height:0;border:0;right:0;bottom:0';
  document.body.append(frame);
  const doc = frame.contentDocument!;
  doc.open();
  doc.write('<!doctype html><title>Print</title>');
  doc.close();
  const style = doc.createElement('style');
  style.textContent = `@page{margin:15mm}html,body{margin:0}img{display:block;width:${widthMm}mm;height:${heightMm}mm}`;
  doc.head.append(style);
  const img = doc.createElement('img');
  img.onload = () => {
    frame.contentWindow!.focus();
    frame.contentWindow!.print();
    setTimeout(() => frame.remove(), 60_000);
  };
  img.src = src;
  doc.body.append(img);
}
