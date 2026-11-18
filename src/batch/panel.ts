import type { BatchSettings, SizeUnit } from '../state';
import { batchItems, parseTable, suggestTemplates, toCsv, type BatchItem } from './parse';
import { renderBarcodeTo, renderQrTo, getSymbols } from '../generators';
import {
  button,
  checkbox,
  field,
  h,
  numberInput,
  section,
  segmented,
  select,
  textArea,
  textInput,
  toast,
} from '../ui/dom';
import { downloadBlob, EXTENSION, imagesToPdf } from '../export/files';
import { clampPx, toMm, toPx } from '../export/size';
import type { PanelContext } from '../qr/panel';

const PREVIEW_ROWS = 200;

export function buildBatchPanel(ctx: PanelContext): {
  controls: HTMLElement;
  stage: HTMLElement;
  refresh: () => void;
} {
  const b = ctx.get().batch;
  const set = (fn: (b: BatchSettings) => void, rebuild = false) =>
    ctx.update((s) => fn(s.batch), { rebuild });

  // ----- Source -----
  const raw = textArea(b.raw, (v) => set((x) => (x.raw = v)), 9);
  raw.classList.add('mono');
  const fileInput = h('input', {
    type: 'file',
    accept: '.csv,.tsv,.txt,text/csv,text/plain',
    class: 'visually-hidden',
  });
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    if (file.size > 5_000_000) {
      toast('That file is over 5 MB. Split it into smaller files.', 'error');
      return;
    }
    const text = await file.text();
    const table = parseTable(text, ctx.get().batch.hasHeader);
    const t = suggestTemplates(table.columns);
    set((x) => {
      x.raw = text;
      if (x.hasHeader) {
        x.dataTemplate = t.data;
        x.nameTemplate = t.name;
      }
    }, true);
    toast(`Loaded ${table.rows.length} rows from ${file.name}.`);
  });
  const table = parseTable(b.raw, b.hasHeader);
  const insert = (target: HTMLInputElement, token: string) => {
    const start = target.selectionStart ?? target.value.length;
    const end = target.selectionEnd ?? target.value.length;
    target.setRangeText(token, start, end, 'end');
    target.dispatchEvent(new Event('input'));
    target.focus();
  };
  const dataInput = textInput(b.dataTemplate, (v) => set((x) => (x.dataTemplate = v)), {
    placeholder: '{url}',
  });
  const nameInput = textInput(b.nameTemplate, (v) => set((x) => (x.nameTemplate = v)), {
    placeholder: '{row}',
  });
  const chips = (target: HTMLInputElement) =>
    h(
      'div',
      { class: 'chips', role: 'group', 'aria-label': 'Insert a column' },
      [...table.columns, 'row'].map((c) =>
        button(`{${c}}`, () => insert(target, `{${c}}`), { kind: 'quiet' }),
      ),
    );

  const sourceSection = section(
    'Your list',
    true,
    h(
      'div',
      { class: 'chips' },
      h('label', { class: 'btn plain file' }, fileInput, 'Open a CSV file'),
    ),
    field(
      'Or paste rows',
      raw,
      'CSV, tab-separated (paste from a spreadsheet), or one value per line.',
    ),
    checkbox('First row is column names', b.hasHeader, (v) => set((x) => (x.hasHeader = v), true)),
  );

  const codes = section(
    'What each code contains',
    true,
    field(
      'Make',
      segmented(
        'kind',
        [
          { value: 'qr', label: 'QR codes' },
          { value: 'barcode', label: 'Barcodes' },
        ],
        b.kind,
        (v) => set((x) => (x.kind = v as BatchSettings['kind'])),
      ),
      'QR codes use the style from the QR code tab. Barcodes use the format and look from the Barcode tab.',
    ),
    field(
      'Data',
      dataInput,
      'Columns in braces are replaced row by row. Mix in text, like https://example.com/item/{id}.',
    ),
    chips(dataInput),
    field('File names', nameInput),
    chips(nameInput),
  );

  // ----- Output -----
  const ex = ctx.get().export;
  const output = section(
    'Files',
    true,
    field(
      'Format',
      select(
        [
          { value: 'png', label: 'PNG images (ZIP)' },
          { value: 'svg', label: 'SVG images (ZIP)' },
          { value: 'jpeg', label: 'JPEG images (ZIP)' },
          { value: 'webp', label: 'WebP images (ZIP)' },
          { value: 'pdf-pages', label: 'One PDF, a code per page' },
        ],
        b.format,
        (v) => set((x) => (x.format = v as BatchSettings['format'])),
      ),
    ),
    h(
      'div',
      { class: 'grid-2' },
      field(
        'Width',
        numberInput(ex.size, (v) => ctx.update((s) => (s.export.size = Math.max(0.1, v))), {
          min: 0.1,
          step: 0.5,
        }),
      ),
      field(
        'Unit',
        select(
          ['mm', 'in', 'px'].map((u) => ({ value: u, label: u })),
          ex.unit,
          (v) => ctx.update((s) => (s.export.unit = v as SizeUnit)),
        ),
      ),
      field(
        'Resolution (dpi)',
        numberInput(
          ex.dpi,
          (v) => ctx.update((s) => (s.export.dpi = Math.max(36, Math.round(v)))),
          { min: 36, step: 1 },
        ),
      ),
    ),
    h(
      'p',
      { class: 'hint' },
      'Size and resolution are shared with the export settings on the QR code and Barcode tabs.',
    ),
  );

  const controls = h('div', { class: 'panel-body' }, sourceSection, codes, output);

  // ----- Stage -----
  const summary = h('p', { class: 'status', 'aria-live': 'polite' });
  const tableWrap = h('div', { class: 'table-wrap' });
  const progress = h('progress', { max: 1, value: 0 });
  progress.hidden = true;
  const problems = h('ul', { class: 'problems' });
  let cancelled = false;
  const cancel = button('Stop', () => (cancelled = true), { kind: 'quiet' });
  cancel.hidden = true;

  const generate = button(
    'Make files',
    async () => {
      const s = ctx.get();
      const items = batchItems(
        parseTable(s.batch.raw, s.batch.hasHeader),
        s.batch.dataTemplate,
        s.batch.nameTemplate,
      );
      if (!items.length) {
        toast('Add at least one row first.', 'error');
        return;
      }
      cancelled = false;
      generate.disabled = true;
      cancel.hidden = false;
      progress.hidden = false;
      progress.max = items.length;
      progress.value = 0;
      problems.replaceChildren();
      try {
        await run(items);
      } catch (err) {
        toast(err instanceof Error ? err.message : String(err), 'error');
      } finally {
        generate.disabled = false;
        cancel.hidden = true;
        progress.hidden = true;
      }
    },
    { kind: 'primary' },
  );

  async function run(items: BatchItem[]) {
    const s = ctx.get();
    const fmt = s.batch.format;
    const imageFormat = fmt === 'pdf-pages' ? 'png' : fmt;
    if (s.batch.kind === 'barcode') await getSymbols();
    const px = clampPx(toPx(s.export.size, s.export.unit, s.export.dpi));
    const exactMm =
      s.export.unit === 'px' ? undefined : toMm(s.export.size, s.export.unit, s.export.dpi);
    const failures: string[][] = [];
    const files: { name: string; blob: Blob; widthMm: number; heightMm: number }[] = [];
    for (const [i, it] of items.entries()) {
      if (cancelled) {
        toast('Stopped. Nothing was downloaded.');
        return;
      }
      try {
        const r =
          s.batch.kind === 'qr'
            ? await renderQrTo(s.qr, s.export, imageFormat, it.data, px, s.export.dpi, exactMm)
            : await renderBarcodeTo(s.barcode, s.export, imageFormat, it.data);
        files.push({
          name: `${it.name}.${EXTENSION[imageFormat]}`,
          blob: r.blob,
          widthMm: r.widthMm,
          heightMm: r.heightMm,
        });
      } catch (err) {
        failures.push([String(it.row), it.data, err instanceof Error ? err.message : String(err)]);
      }
      progress.value = i + 1;
      summary.textContent = `Making ${i + 1} of ${items.length}…`;
      // Let the page repaint and stay responsive on long lists.
      if (i % 10 === 9) await new Promise((r) => setTimeout(r));
    }
    if (!files.length) {
      summary.textContent = 'No files were made. Check the problems below.';
      showFailures(failures);
      return;
    }
    if (fmt === 'pdf-pages') {
      const pdf = await imagesToPdf(
        files.map((f) => ({ png: f.blob, widthMm: f.widthMm, heightMm: f.heightMm })),
      );
      downloadBlob(pdf, 'codes.pdf');
    } else {
      const { default: JSZip } = await import('jszip');
      const zip = new JSZip();
      for (const f of files)
        zip.file(f.name, f.blob, { compression: imageFormat === 'svg' ? 'DEFLATE' : 'STORE' });
      if (failures.length)
        zip.file('problems.csv', toCsv([['row', 'data', 'problem'], ...failures]));
      downloadBlob(await zip.generateAsync({ type: 'blob' }), 'codes.zip');
    }
    summary.textContent = `Made ${files.length} file${files.length === 1 ? '' : 's'}${failures.length ? `. ${failures.length} row${failures.length === 1 ? '' : 's'} couldn’t be made.` : '.'}`;
    showFailures(failures);
  }

  function showFailures(failures: string[][]) {
    problems.replaceChildren(
      ...failures
        .slice(0, 50)
        .map(([row, data, msg]) => h('li', {}, `Row ${row} (“${data.slice(0, 40)}”): ${msg}`)),
    );
  }

  const refresh = () => {
    const s = ctx.get().batch;
    const t = parseTable(s.raw, s.hasHeader);
    const items = batchItems(t, s.dataTemplate, s.nameTemplate);
    summary.textContent = items.length
      ? `${items.length} row${items.length === 1 ? '' : 's'} ready.${items.length > PREVIEW_ROWS ? ` Showing the first ${PREVIEW_ROWS}.` : ''}`
      : 'Paste a list or open a CSV file to start.';
    const ext = s.format === 'pdf-pages' ? '' : `.${EXTENSION[s.format]}`;
    tableWrap.replaceChildren(
      h(
        'table',
        {},
        h(
          'thead',
          {},
          h(
            'tr',
            {},
            h('th', { scope: 'col' }, 'Row'),
            h('th', { scope: 'col' }, 'Data'),
            h('th', { scope: 'col' }, 'File name'),
          ),
        ),
        h(
          'tbody',
          {},
          items
            .slice(0, PREVIEW_ROWS)
            .map((it) =>
              h(
                'tr',
                { class: it.data.trim() ? '' : 'blank' },
                h('td', {}, String(it.row)),
                h('td', {}, it.data || 'No data'),
                h('td', {}, s.format === 'pdf-pages' ? '—' : `${it.name}${ext}`),
              ),
            ),
        ),
      ),
    );
    generate.textContent = s.format === 'pdf-pages' ? 'Make PDF' : 'Make ZIP';
  };

  const stage = h(
    'div',
    { class: 'stage-inner batch-stage' },
    h(
      'div',
      { class: 'stage-head' },
      summary,
      h('div', { class: 'actions' }, generate, cancel),
      progress,
    ),
    problems,
    tableWrap,
  );
  return { controls, stage, refresh };
}
