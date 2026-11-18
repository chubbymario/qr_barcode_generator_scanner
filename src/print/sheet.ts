// Builds label sheets: renders each code once, places it on labels, and
// produces an on-screen preview, a printable page set, or a PDF.

import type { AppState, LabelGeometry } from '../state';
import { cells, fitInLabel, geometryFor, paginate, PT_TO_MM, type Cell } from './layout';
import { renderBarcodeTo, renderQrTo, findSymbol, getSymbols } from '../generators';
import { qrPayload } from '../qr/render';
import { textFor } from '../barcode/render';
import { batchItems, fillTemplate, parseTable } from '../batch/parse';
import { blobToDataUrl } from '../export/files';
import { h } from '../ui/dom';

export interface SheetItem {
  data: string;
  caption: string;
}

export interface RenderedCode {
  url: string; // data URL
  png: Blob;
  widthMm: number;
  heightMm: number;
}

export interface PlacedLabel {
  page: number;
  cell: Cell;
  code: Cell;
  caption: Cell | null;
  item: SheetItem;
  image: RenderedCode | null;
  error?: string;
}

export interface SheetPlan {
  geometry: LabelGeometry;
  pages: number;
  labels: PlacedLabel[];
  captionFontMm: number;
  errors: string[];
}

export async function sheetItems(
  state: AppState,
): Promise<{ items: SheetItem[]; kind: 'qr' | 'barcode' }> {
  const p = state.print;
  const captionFor = (data: string, extra: Record<string, string> = {}, row = 1) => {
    if (p.caption === 'none') return '';
    if (p.caption === 'data') return data;
    const cols = ['data', ...Object.keys(extra)];
    return fillTemplate(p.captionText, cols, [data, ...Object.values(extra)], row);
  };
  if (p.source === 'batch') {
    const b = state.batch;
    const table = parseTable(b.raw, b.hasHeader);
    const list = batchItems(table, b.dataTemplate, b.nameTemplate);
    const items = list.map((it, i) => {
      const extra = Object.fromEntries(table.columns.map((c, ci) => [c, table.rows[i][ci] ?? '']));
      return { data: it.data, caption: captionFor(it.data, { ...extra, name: it.name }, it.row) };
    });
    return { items, kind: b.kind };
  }
  let data: string;
  if (p.source === 'qr') data = qrPayload(state.qr);
  else {
    await getSymbols();
    data = textFor(state.barcode, findSymbol(state.barcode.bcid));
  }
  const copies = Math.max(1, Math.min(5000, Math.round(p.copies)));
  return {
    items: Array.from({ length: copies }, (_, i) => ({
      data,
      caption: captionFor(data, {}, i + 1),
    })),
    kind: p.source,
  };
}

async function renderForBox(
  state: AppState,
  kind: 'qr' | 'barcode',
  data: string,
  box: Cell,
): Promise<RenderedCode> {
  const dpi = state.print.dpi;
  const ex = { ...state.export, crisp: false, format: 'png' as const };
  if (kind === 'qr') {
    const side = Math.min(box.w, box.h);
    const px = Math.max(16, Math.round((side / 25.4) * dpi));
    const r = await renderQrTo(state.qr, ex, 'png', data, px, dpi);
    return { png: r.blob, url: await blobToDataUrl(r.blob), widthMm: side, heightMm: side };
  }
  // Barcodes: fit the width, then shrink if the bars + text are too tall.
  const bc = { ...state.barcode, heightMm: Math.min(state.barcode.heightMm, box.h * 0.8) };
  let r = await renderBarcodeTo(bc, ex, 'png', data, box.w, dpi);
  if (r.heightMm > box.h || r.widthMm > box.w) {
    const f = Math.min(box.h / r.heightMm, box.w / r.widthMm) * 0.98;
    bc.heightMm *= f;
    r = await renderBarcodeTo(bc, ex, 'png', data, r.widthMm * f, dpi);
  }
  return {
    png: r.blob,
    url: await blobToDataUrl(r.blob),
    widthMm: r.widthMm,
    heightMm: r.heightMm,
  };
}

export async function planSheet(
  state: AppState,
  opts: { maxPages?: number; onProgress?: (done: number, total: number) => void } = {},
): Promise<SheetPlan> {
  const p = state.print;
  const g = geometryFor(p.preset, p.custom);
  const slots = cells(g, p.offsetX, p.offsetY);
  const { items, kind } = await sheetItems(state);
  const { pages, placements } = paginate(items, slots.length, p.startAt - 1);
  const limit = opts.maxPages ?? Infinity;
  const used = placements.filter((pl) => pl.page < limit);

  const hasCaption = p.caption !== 'none';
  const captionFontMm = p.captionSize * PT_TO_MM;
  const captionMm = hasCaption ? captionFontMm * 1.35 : 0;

  // Work out the code box using a probe of the first item's aspect ratio.
  const cache = new Map<string, Promise<RenderedCode>>();
  const errors: string[] = [];
  const labels: PlacedLabel[] = [];
  let done = 0;
  for (const pl of used) {
    const cell = slots[pl.index];
    const square = kind === 'qr';
    const box = fitInLabel(
      cell,
      square ? 1 : cell.w / Math.max(1, cell.h - captionMm),
      p.codeSizePct,
      captionMm,
    );
    const key = pl.item.data;
    let image: RenderedCode | null = null;
    let error: string | undefined;
    try {
      if (!key.trim()) throw new Error('empty');
      if (!cache.has(key)) cache.set(key, renderForBox(state, kind, key, box.code));
      image = await cache.get(key)!;
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
      if (errors.length < 20)
        errors.push(
          `${key ? `“${key.slice(0, 40)}”` : 'Empty row'}: ${error === 'empty' ? 'no data' : error}`,
        );
    }
    // Centre the actual image inside the code box.
    let code = box.code;
    if (image) {
      code = {
        x: box.code.x + (box.code.w - image.widthMm) / 2,
        y: box.code.y + (box.code.h - image.heightMm) / 2,
        w: image.widthMm,
        h: image.heightMm,
      };
    }
    labels.push({ page: pl.page, cell, code, caption: box.caption, item: pl.item, image, error });
    opts.onProgress?.(++done, used.length);
  }
  return { geometry: g, pages, labels, captionFontMm, errors };
}

// ---------- on-screen / print DOM ----------

const pct = (v: number, of: number) => `${((v / of) * 100).toFixed(4)}%`;

export function sheetDom(plan: SheetPlan, outlines: boolean, maxPages = Infinity): HTMLElement[] {
  const g = plan.geometry;
  const out: HTMLElement[] = [];
  const pageCount = Math.min(plan.pages, maxPages);
  for (let i = 0; i < pageCount; i++) {
    const page = h('div', {
      class: `sheet-page${outlines ? ' outlines' : ''}`,
      'aria-label': `Page ${i + 1}`,
    });
    page.style.aspectRatio = `${g.pageWidth} / ${g.pageHeight}`;
    page.style.setProperty('--page-w', `${g.pageWidth}mm`);
    page.style.setProperty('--page-h', `${g.pageHeight}mm`);
    // Every empty slot on the page gets an outline so the layout is visible.
    for (const c of cells(g)) {
      const slot = h('div', { class: 'slot' });
      Object.assign(slot.style, {
        left: pct(c.x, g.pageWidth),
        top: pct(c.y, g.pageHeight),
        width: pct(c.w, g.pageWidth),
        height: pct(c.h, g.pageHeight),
      });
      page.append(slot);
    }
    for (const l of plan.labels.filter((x) => x.page === i)) {
      if (l.image) {
        const img = h('img', { src: l.image.url, alt: l.item.data, class: 'code' });
        Object.assign(img.style, {
          left: pct(l.code.x, g.pageWidth),
          top: pct(l.code.y, g.pageHeight),
          width: pct(l.code.w, g.pageWidth),
          height: pct(l.code.h, g.pageHeight),
        });
        page.append(img);
      } else {
        const bad = h('div', { class: 'bad', title: l.error ?? '' }, 'Can’t draw');
        Object.assign(bad.style, {
          left: pct(l.cell.x, g.pageWidth),
          top: pct(l.cell.y, g.pageHeight),
          width: pct(l.cell.w, g.pageWidth),
          height: pct(l.cell.h, g.pageHeight),
        });
        page.append(bad);
      }
      if (l.caption && l.item.caption) {
        const cap = h('div', { class: 'caption' }, l.item.caption);
        Object.assign(cap.style, {
          left: pct(l.caption.x, g.pageWidth),
          top: pct(l.caption.y, g.pageHeight),
          width: pct(l.caption.w, g.pageWidth),
          height: pct(l.caption.h, g.pageHeight),
          fontSize: `calc(${(plan.captionFontMm / g.pageWidth) * 100}cqw)`,
        });
        page.append(cap);
      }
    }
    out.push(page);
  }
  return out;
}

export async function printSheet(plan: SheetPlan, outlines: boolean): Promise<void> {
  const g = plan.geometry;
  document.getElementById('print-root')?.remove();
  document.getElementById('print-page-style')?.remove();
  const root = h('div', { id: 'print-root' }, ...sheetDom(plan, outlines));
  const style = h(
    'style',
    { id: 'print-page-style' },
    `@page { size: ${g.pageWidth}mm ${g.pageHeight}mm; margin: 0; }`,
  );
  document.head.append(style);
  document.body.append(root);
  document.body.classList.add('printing-sheet');
  await Promise.all(
    [...root.querySelectorAll('img')].map((img) => img.decode().catch(() => undefined)),
  );
  const cleanup = () => {
    document.body.classList.remove('printing-sheet');
    root.remove();
    style.remove();
    window.removeEventListener('afterprint', cleanup);
  };
  window.addEventListener('afterprint', cleanup);
  window.print();
}

export async function sheetPdf(plan: SheetPlan, outlines: boolean): Promise<Blob> {
  const { jsPDF } = await import('jspdf');
  const g = plan.geometry;
  const orientation = g.pageWidth > g.pageHeight ? 'landscape' : 'portrait';
  const pdf = new jsPDF({
    unit: 'mm',
    format: [g.pageWidth, g.pageHeight],
    orientation,
    compress: true,
  });
  const added = new Map<string, string>(); // reuse identical images across labels
  for (let i = 0; i < plan.pages; i++) {
    if (i > 0) pdf.addPage([g.pageWidth, g.pageHeight], orientation);
    if (outlines) {
      pdf.setDrawColor(200);
      pdf.setLineWidth(0.1);
      for (const c of cells(g)) pdf.roundedRect(c.x, c.y, c.w, c.h, 1.5, 1.5, 'S');
    }
    for (const l of plan.labels.filter((x) => x.page === i)) {
      if (l.image) {
        let alias = added.get(l.image.url);
        if (!alias) {
          alias = `img${added.size}`;
          added.set(l.image.url, alias);
        }
        const data = new Uint8Array(await l.image.png.arrayBuffer());
        pdf.addImage(data, 'PNG', l.code.x, l.code.y, l.code.w, l.code.h, alias, 'NONE');
      }
      if (l.caption && l.item.caption) {
        pdf.setFontSize(plan.captionFontMm / PT_TO_MM);
        pdf.setTextColor(20);
        const lines = pdf.splitTextToSize(l.item.caption, l.caption.w) as string[];
        pdf.text(lines[0] ?? '', l.caption.x + l.caption.w / 2, l.caption.y + plan.captionFontMm, {
          align: 'center',
        });
      }
    }
  }
  return pdf.output('blob');
}
