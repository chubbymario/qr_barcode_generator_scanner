// The right-hand side for the QR and barcode tabs: a proof of the code with its
// printed size marked, and the controls for getting it out of the browser.

import type { AppState, ExportFormat, SizeUnit } from '../state';
import { buildShareUrl } from '../state';
import { EmptyContentError, type Generator } from '../generators';
import {
  button,
  checkbox,
  field,
  h,
  numberInput,
  range,
  segmented,
  select,
  textInput,
  toast,
} from './dom';
import {
  blobToDataUrl,
  copyImageToClipboard,
  downloadBlob,
  EXTENSION,
  printImage,
  safeFilename,
} from '../export/files';
import { formatMm, MAX_PX, toPx } from '../export/size';
import type { PanelContext } from '../qr/panel';

export interface Stage {
  el: HTMLElement;
  refresh: () => void;
}

const FORMATS: { value: ExportFormat; label: string }[] = [
  { value: 'png', label: 'PNG' },
  { value: 'svg', label: 'SVG' },
  { value: 'jpeg', label: 'JPEG' },
  { value: 'webp', label: 'WebP' },
  { value: 'pdf', label: 'PDF' },
];

const FORMAT_NOTES: Record<ExportFormat, string> = {
  png: 'Sharp image with transparency. Best for most uses.',
  svg: 'Vector. Scales to any size; best for print and design apps.',
  jpeg: 'Small photo format. No transparency.',
  webp: 'Small modern image format.',
  pdf: 'One page sized exactly to the code. Ready to print.',
};

export function buildStage(ctx: PanelContext, gen: Generator): Stage {
  const art = h('div', { class: 'art' });
  const dimX = h('span', { class: 'dim-label' });
  const dimY = h('span', { class: 'dim-label' });
  const sheet = h(
    'figure',
    { class: 'sheet', 'aria-label': `${gen.label} preview` },
    h('div', { class: 'dim dim-x', 'aria-hidden': 'true' }, dimX),
    h('div', { class: 'dim dim-y', 'aria-hidden': 'true' }, dimY),
    h('span', { class: 'crop tl', 'aria-hidden': 'true' }),
    h('span', { class: 'crop tr', 'aria-hidden': 'true' }),
    h('span', { class: 'crop bl', 'aria-hidden': 'true' }),
    h('span', { class: 'crop br', 'aria-hidden': 'true' }),
    art,
  );
  const status = h('p', { class: 'status', 'aria-live': 'polite' });
  const note = h('p', { class: 'note' });
  note.hidden = true;
  const payload = h('pre', { class: 'payload' });
  const payloadBox = h('details', { class: 'encoded' }, h('summary', {}, 'Encoded text'), payload);

  let token = 0;
  const refresh = async () => {
    const mine = ++token;
    sheet.classList.add('busy');
    try {
      const p = await gen.preview();
      if (mine !== token) return;
      art.replaceChildren(p.node);
      const aspect = p.widthPx / p.heightPx;
      sheet.style.setProperty('--aspect', String(aspect));
      sheet.dataset.shape = aspect > 1.6 ? 'wide' : aspect < 0.62 ? 'tall' : 'square';
      dimX.textContent = formatMm(p.widthMm);
      dimY.textContent = formatMm(p.heightMm);
      status.textContent = `${p.widthMm.toFixed(1)} × ${p.heightMm.toFixed(1)} mm at ${p.dpi} dpi (${p.widthPx} × ${p.heightPx} px)`;
      status.classList.remove('error');
      note.textContent = p.note ?? '';
      note.hidden = !p.note;
      payload.textContent = p.payload;
      if (nameInput) nameInput.placeholder = gen.suggestedName();
      sheet.classList.remove('empty', 'failed');
      setActionsEnabled(true);
    } catch (err) {
      if (mine !== token) return;
      const msg = err instanceof Error ? err.message : String(err);
      const empty = err instanceof EmptyContentError;
      sheet.classList.toggle('empty', empty);
      sheet.classList.toggle('failed', !empty);
      if (empty) art.replaceChildren(h('p', { class: 'empty-msg' }, msg));
      status.textContent = empty ? '' : msg;
      status.classList.toggle('error', !empty);
      note.hidden = true;
      setActionsEnabled(false);
    } finally {
      if (mine === token) sheet.classList.remove('busy');
    }
  };

  // ----- output controls -----
  const setEx = (fn: (s: AppState['export']) => void, rebuildOutput = false) => {
    ctx.update((s) => fn(s.export));
    if (rebuildOutput) drawOutput();
  };
  const output = h('div', { class: 'output' });
  const actions: HTMLButtonElement[] = [];
  const setActionsEnabled = (on: boolean) => actions.forEach((b) => (b.disabled = !on));

  const filename = () => {
    const s = ctx.get().export;
    return `${safeFilename(s.filename || gen.suggestedName())}.${EXTENSION[s.format]}`;
  };

  const run = async (btn: HTMLButtonElement, label: string, job: () => Promise<void>) => {
    btn.disabled = true;
    const old = btn.textContent;
    btn.textContent = label;
    try {
      await job();
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), 'error');
    } finally {
      btn.textContent = old;
      btn.disabled = false;
    }
  };

  let nameInput: HTMLInputElement | null = null;
  const fileNameInput = (value: string) => {
    nameInput = textInput(value, (v) => setEx((x) => (x.filename = v)), {
      placeholder: gen.suggestedName(),
    });
    return nameInput;
  };

  function drawOutput() {
    const e = ctx.get().export;
    const pxEstimate = toPx(e.size, e.unit, e.dpi);
    const tooBig = pxEstimate > MAX_PX;

    const download = button(
      'Download',
      () =>
        run(download, 'Preparing…', async () => {
          const r = await gen.render(ctx.get().export.format);
          downloadBlob(r.blob, filename());
        }),
      { kind: 'primary' },
    );
    const copy = button('Copy image', () =>
      run(copy, 'Copying…', async () => {
        await copyImageToClipboard(gen.render('png').then((r) => r.blob));
        toast('Image copied.');
      }),
    );
    const print = button('Print', () =>
      run(print, 'Preparing…', async () => {
        const r = await gen.render('png');
        printImage(await blobToDataUrl(r.blob), r.widthMm, r.heightMm);
      }),
    );
    const share = button(
      'Copy link to these settings',
      async () => {
        try {
          await navigator.clipboard.writeText(buildShareUrl(ctx.get()));
          toast(
            ctx.get().qr.logo && gen.kind === 'qr'
              ? 'Link copied. Logos aren’t included in links.'
              : 'Link copied.',
          );
        } catch {
          toast('Couldn’t copy the link. Your browser blocked clipboard access.', 'error');
        }
      },
      { kind: 'quiet' },
    );
    const sheetBtn = button(
      'Fill a label sheet',
      () =>
        ctx.update(
          (s) => {
            s.print.source = gen.kind;
            s.tab = 'print';
          },
          { rebuild: true },
        ),
      { kind: 'quiet' },
    );
    actions.splice(0, actions.length, download, copy, print);

    const sizeRow = h(
      'div',
      { class: 'size-row' },
      numberInput(e.size, (v) => setEx((x) => (x.size = Math.max(0.1, v))), {
        min: 0.1,
        step: e.unit === 'px' ? 1 : 0.5,
      }),
      select(
        [
          { value: 'mm', label: 'mm' },
          { value: 'in', label: 'in' },
          { value: 'px', label: 'px' },
        ],
        e.unit,
        (v) => {
          if (v !== 'mm' && v !== 'in' && v !== 'px') return;
          const from = ctx.get().export;
          const mm =
            from.unit === 'mm'
              ? from.size
              : from.unit === 'in'
                ? from.size * 25.4
                : (from.size / from.dpi) * 25.4;
          const next = v === 'mm' ? mm : v === 'in' ? mm / 25.4 : (mm / 25.4) * from.dpi;
          setEx((x) => {
            x.unit = v as SizeUnit;
            x.size = +next.toFixed(v === 'px' ? 0 : 2);
          }, true);
        },
      ),
    );
    sizeRow.firstElementChild!.setAttribute('aria-label', 'Width');
    sizeRow.lastElementChild!.setAttribute('aria-label', 'Unit');

    const dpiList = h(
      'datalist',
      { id: 'dpi-list' },
      [72, 96, 150, 203, 300, 600, 1200].map((d) => h('option', { value: d })),
    );
    const dpi = numberInput(
      e.dpi,
      (v) => setEx((x) => (x.dpi = Math.min(2400, Math.max(36, Math.round(v))))),
      { min: 36, max: 2400, step: 1 },
    );
    dpi.setAttribute('list', 'dpi-list');

    output.replaceChildren(
      ...[
        h('h2', { class: 'output-title' }, 'Export'),
        field(
          'Format',
          segmented('fmt', FORMATS, e.format, (v) =>
            setEx((x) => (x.format = v as ExportFormat), true),
          ),
          FORMAT_NOTES[e.format],
        ),
        h(
          'div',
          { class: 'pair' },
          field(gen.kind === 'qr' ? 'Width and height' : 'Width', sizeRow),
          field('Resolution (dpi)', dpi),
          dpiList,
        ),
        tooBig
          ? h(
              'p',
              { class: 'note' },
              `That's over ${MAX_PX} px wide, so it will be capped. Lower the size or dpi.`,
            )
          : null,
        gen.kind === 'barcode'
          ? checkbox('Sharp bars (snap to whole pixels)', e.crisp, (v) =>
              setEx((x) => (x.crisp = v)),
            )
          : null,
        e.format === 'jpeg' || e.format === 'webp'
          ? field(
              'Quality',
              range(
                Math.round(e.jpegQuality * 100),
                (v) => setEx((x) => (x.jpegQuality = v / 100)),
                { min: 50, max: 100, step: 1, format: (v) => `${v}%` },
              ),
            )
          : null,
        field('File name', fileNameInput(e.filename)),
        h('div', { class: 'actions' }, download, copy, print),
        h('div', { class: 'actions secondary' }, share, sheetBtn),
      ].filter((x): x is HTMLElement => !!x),
    );
  }
  drawOutput();

  const el = h(
    'div',
    { class: 'stage-inner' },
    h('div', { class: 'proof' }, sheet, status, note, payloadBox),
    output,
  );
  return { el, refresh: () => void refresh() };
}
