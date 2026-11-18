// One interface over the two code makers, so preview, export, batch and
// print sheets don't care whether they're dealing with a QR code or a barcode.

import type { AppState, BarcodeSettings, ExportFormat, ExportSettings, QrSettings } from './state';
import { qrPayload, renderQr, renderQrPreview } from './qr/render';
import { contentDef } from './qr/content';
import { barcodeSvg, planBarcode, renderBarcode, symbolList, textFor } from './barcode/render';
import { defaultOptionString } from './barcode/options';
import { clampPx, pxToMm, toMm, toPx } from './export/size';
import { imagesToPdf, safeFilename } from './export/files';
import type { SymbolInfo } from './barcode/catalog';

export class EmptyContentError extends Error {}

export interface Preview {
  node: Element;
  widthMm: number;
  heightMm: number;
  widthPx: number;
  heightPx: number;
  dpi: number;
  payload: string;
  note?: string;
}

export interface Rendered {
  blob: Blob;
  widthMm: number;
  heightMm: number;
  widthPx: number;
  heightPx: number;
}

export interface Generator {
  kind: 'qr' | 'barcode';
  label: string;
  preview(): Promise<Preview>;
  render(
    format: ExportFormat,
    overrides?: { data?: string; widthMm?: number; dpi?: number },
  ): Promise<Rendered>;
  suggestedName(): string;
}

function parseSvg(svg: string): Element {
  const el = new DOMParser().parseFromString(svg, 'image/svg+xml').documentElement;
  el.removeAttribute('width');
  el.removeAttribute('height');
  return document.importNode(el, true);
}

// ---------- QR ----------

export function qrGenerator(getState: () => AppState): Generator {
  const exportPx = (ex: ExportSettings, widthMm?: number, dpi?: number) =>
    clampPx(
      widthMm !== undefined ? toPx(widthMm, 'mm', dpi ?? ex.dpi) : toPx(ex.size, ex.unit, ex.dpi),
    );

  return {
    kind: 'qr',
    label: 'QR code',
    async preview() {
      const { qr, export: ex } = getState();
      const payload = qrPayload(qr);
      if (!payload.trim()) throw new EmptyContentError('Add some content to make a QR code.');
      const node = await renderQrPreview(qr, payload);
      const px = exportPx(ex);
      const mm = ex.unit === 'px' ? pxToMm(px, ex.dpi) : toMm(ex.size, ex.unit, ex.dpi);
      return { node, widthMm: mm, heightMm: mm, widthPx: px, heightPx: px, dpi: ex.dpi, payload };
    },
    async render(format, o = {}) {
      const { qr, export: ex } = getState();
      const exactMm = o.widthMm ?? (ex.unit === 'px' ? undefined : toMm(ex.size, ex.unit, ex.dpi));
      return renderQrTo(
        qr,
        ex,
        format,
        o.data ?? qrPayload(qr),
        exportPx(ex, o.widthMm, o.dpi),
        o.dpi ?? ex.dpi,
        exactMm,
      );
    },
    suggestedName() {
      const { qr } = getState();
      return `qr-${contentDef(qr.contentType).label.toLowerCase().replace(/\W+/g, '-')}`;
    },
  };
}

export async function renderQrTo(
  qr: QrSettings,
  ex: ExportSettings,
  format: ExportFormat,
  data: string,
  px: number,
  dpi: number,
  exactMm?: number,
): Promise<Rendered> {
  if (!data.trim()) throw new EmptyContentError('This row has no content.');
  // Vector and PDF output use the exact requested size; rasters are whole pixels.
  const mm = exactMm ?? pxToMm(px, dpi);
  if (format === 'pdf') {
    const png = await renderQr(qr, data, { format: 'png', px, dpi });
    const blob = await imagesToPdf([{ png: png.blob, widthMm: mm, heightMm: mm }]);
    return { blob, widthMm: mm, heightMm: mm, widthPx: px, heightPx: px };
  }
  const r = await renderQr(qr, data, {
    format,
    px,
    dpi,
    physicalMm: ex.unit === 'px' ? undefined : mm,
    jpegQuality: ex.jpegQuality,
  });
  return { blob: r.blob, widthMm: mm, heightMm: mm, widthPx: px, heightPx: px };
}

// ---------- Barcode ----------

let symbols: readonly SymbolInfo[] = [];
export async function getSymbols(): Promise<readonly SymbolInfo[]> {
  if (!symbols.length) symbols = await symbolList();
  return symbols;
}
export function findSymbol(bcid: string): SymbolInfo | undefined {
  return symbols.find((s) => s.bcid === bcid);
}

export function advancedFor(s: BarcodeSettings): string {
  return s.options[s.bcid] ?? defaultOptionString(findSymbol(s.bcid)?.opts ?? '');
}

export function barcodeGenerator(getState: () => AppState): Generator {
  return {
    kind: 'barcode',
    label: 'Barcode',
    async preview() {
      await getSymbols();
      const { barcode: bc, export: ex } = getState();
      const sym = findSymbol(bc.bcid);
      const text = textFor(bc, sym);
      if (!text.trim()) throw new EmptyContentError('Type the data to encode.');
      const plan = await planBarcode(bc, text, advancedFor(bc), ex);
      const node = parseSvg(await barcodeSvg(plan, false));
      const requested = toMm(ex.size, ex.unit, ex.dpi);
      const off = Math.abs(plan.widthMm - requested) / requested;
      const note =
        ex.crisp && off > 0.02 && ex.unit !== 'px'
          ? `Snapped to whole pixels per bar, so it's ${plan.widthMm.toFixed(1)} mm wide instead of ${requested.toFixed(1)} mm. Turn off “Sharp bars” for the exact size.`
          : undefined;
      return {
        node,
        widthMm: plan.widthMm,
        heightMm: plan.heightMm,
        widthPx: plan.widthPx,
        heightPx: plan.heightPx,
        dpi: ex.dpi,
        payload: text,
        note,
      };
    },
    async render(format, o = {}) {
      await getSymbols();
      const { barcode: bc, export: ex } = getState();
      const text = o.data ?? textFor(bc, findSymbol(bc.bcid));
      return renderBarcodeTo(bc, ex, format, text, o.widthMm, o.dpi);
    },
    suggestedName() {
      const { barcode: bc } = getState();
      return safeFilename(`${bc.bcid}-${textFor(bc, findSymbol(bc.bcid))}`, bc.bcid);
    },
  };
}

export async function renderBarcodeTo(
  bc: BarcodeSettings,
  ex: ExportSettings,
  format: ExportFormat,
  text: string,
  widthMm?: number,
  dpi?: number,
): Promise<Rendered> {
  if (!text.trim()) throw new EmptyContentError('This row has no content.');
  const exp = { ...ex, dpi: dpi ?? ex.dpi };
  const target = widthMm !== undefined ? toPx(widthMm, 'mm', exp.dpi) : undefined;
  const plan = await planBarcode(bc, text, advancedFor(bc), exp, target);
  const dims = {
    widthMm: plan.widthMm,
    heightMm: plan.heightMm,
    widthPx: plan.widthPx,
    heightPx: plan.heightPx,
  };
  if (format === 'pdf') {
    const png = await renderBarcode(bc, plan, 'png', exp);
    const blob = await imagesToPdf([{ png, widthMm: plan.widthMm, heightMm: plan.heightMm }]);
    return { blob, ...dims };
  }
  return { blob: await renderBarcode(bc, plan, format, exp), ...dims };
}
