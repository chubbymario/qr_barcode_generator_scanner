import type { LabelGeometry, PrintSettings } from '../state';
import { checkGeometry, geometryFor, PRESETS } from './layout';
import { planSheet, printSheet, sheetDom, sheetItems, sheetPdf } from './sheet';
import {
  button,
  checkbox,
  field,
  h,
  numberInput,
  range,
  section,
  segmented,
  select,
  textInput,
  toast,
} from '../ui/dom';
import { downloadBlob } from '../export/files';
import type { PanelContext } from '../qr/panel';

const PREVIEW_PAGES = 6;

export function buildPrintPanel(ctx: PanelContext): {
  controls: HTMLElement;
  stage: HTMLElement;
  refresh: () => void;
} {
  const p = ctx.get().print;
  const set = (fn: (p: PrintSettings) => void, rebuild = false) =>
    ctx.update((s) => fn(s.print), { rebuild });
  const setGeo = (fn: (g: LabelGeometry) => void) =>
    ctx.update((s) => {
      // Editing any measurement turns the layout into a custom one.
      if (s.print.preset !== 'custom') {
        s.print.custom = { ...geometryFor(s.print.preset, s.print.custom) };
        s.print.preset = 'custom';
        presetSelect.value = 'custom';
      }
      fn(s.print.custom);
    });

  // ----- What to print -----
  const copiesField = field(
    'Number of labels',
    numberInput(p.copies, (v) => set((x) => (x.copies = Math.max(1, Math.round(v)))), {
      min: 1,
      max: 5000,
      step: 1,
    }),
  );
  copiesField.hidden = p.source === 'batch';
  const source = section(
    'What to print',
    true,
    field(
      'Codes from',
      segmented(
        'src',
        [
          { value: 'qr', label: 'QR code tab' },
          { value: 'barcode', label: 'Barcode tab' },
          { value: 'batch', label: 'Batch list' },
        ],
        p.source,
        (v) => {
          copiesField.hidden = v === 'batch';
          set((x) => (x.source = v as PrintSettings['source']));
        },
      ),
      'Batch prints one label per row, using the Batch tab’s list and settings.',
    ),
    copiesField,
    field(
      'Start at label',
      numberInput(p.startAt, (v) => set((x) => (x.startAt = Math.max(1, Math.round(v)))), {
        min: 1,
        step: 1,
      }),
      'Skip labels already used on a partly used sheet. Counts left to right, top to bottom.',
    ),
  );

  // ----- Sheet -----
  const geo = geometryFor(p.preset, p.custom);
  const presetSelect = select(
    [
      ...PRESETS.map((x) => ({ value: x.id, label: x.name })),
      { value: 'custom', label: 'Custom layout' },
    ],
    p.preset,
    (v) =>
      set((x) => {
        if (v === 'custom') x.custom = { ...geometryFor(x.preset, x.custom) };
        x.preset = v;
      }, true),
  );
  const num = (label: string, key: keyof LabelGeometry, step = 0.1, min = 0) =>
    field(
      label,
      numberInput(+geo[key].toFixed(3), (v) => setGeo((g) => (g[key] = Math.max(min, v))), {
        min,
        step,
      }),
    );
  const sheet = section(
    'Sheet and labels',
    true,
    field(
      'Label sheet',
      presetSelect,
      'Measurements are from the makers’ templates. Print a test on plain paper first.',
    ),
    h(
      'div',
      { class: 'grid-2' },
      num('Page width (mm)', 'pageWidth', 0.1, 10),
      num('Page height (mm)', 'pageHeight', 0.1, 10),
      num('Columns', 'columns', 1, 1),
      num('Rows', 'rows', 1, 1),
      num('Label width (mm)', 'labelWidth', 0.1, 1),
      num('Label height (mm)', 'labelHeight', 0.1, 1),
      num('Top margin (mm)', 'marginTop'),
      num('Left margin (mm)', 'marginLeft'),
      num('Gap across (mm)', 'gapX'),
      num('Gap down (mm)', 'gapY'),
    ),
  );

  // ----- Label content -----
  const captionText = field(
    'Caption',
    textInput(p.captionText, (v) => set((x) => (x.captionText = v)), { placeholder: '{data}' }),
    'Use {data}, {row}, or a batch column name like {name}.',
  );
  captionText.hidden = p.caption !== 'custom';
  const content = section(
    'Label content',
    false,
    field(
      'Code size',
      range(p.codeSizePct, (v) => set((x) => (x.codeSizePct = v)), {
        min: 30,
        max: 100,
        step: 1,
        format: (v) => `${v}%`,
      }),
      'How much of the label the code fills.',
    ),
    field(
      'Text under the code',
      segmented(
        'cap',
        [
          { value: 'none', label: 'None' },
          { value: 'data', label: 'The data' },
          { value: 'custom', label: 'Custom' },
        ],
        p.caption,
        (v) => {
          captionText.hidden = v !== 'custom';
          set((x) => (x.caption = v as PrintSettings['caption']));
        },
      ),
    ),
    captionText,
    field(
      'Caption size',
      range(p.captionSize, (v) => set((x) => (x.captionSize = v)), {
        min: 5,
        max: 24,
        step: 1,
        format: (v) => `${v} pt`,
      }),
    ),
  );

  // ----- Printing -----
  const printing = section(
    'Printer settings',
    false,
    checkbox('Print label outlines', p.outlines, (v) => set((x) => (x.outlines = v))),
    field(
      'Resolution (dpi)',
      select(
        [150, 300, 600].map((d) => ({ value: String(d), label: `${d} dpi` })),
        String(p.dpi),
        (v) => set((x) => (x.dpi = Number(v))),
      ),
    ),
    h(
      'div',
      { class: 'grid-2' },
      field(
        'Nudge right (mm)',
        numberInput(p.offsetX, (v) => set((x) => (x.offsetX = v)), { step: 0.1 }),
      ),
      field(
        'Nudge down (mm)',
        numberInput(p.offsetY, (v) => set((x) => (x.offsetY = v)), { step: 0.1 }),
      ),
    ),
    h(
      'p',
      { class: 'hint' },
      'If the test print is off, nudge everything to line up. In the print dialog, set scale to 100% (“Actual size”) and margins to none.',
    ),
  );

  const controls = h('div', { class: 'panel-body' }, source, sheet, content, printing);

  // ----- Stage -----
  const summary = h('p', { class: 'status', 'aria-live': 'polite' });
  const problems = h('ul', { class: 'problems' });
  const pages = h('div', { class: 'sheet-pages' });
  const progress = h('progress', { max: 1, value: 0 });
  progress.hidden = true;

  const busy = async (btn: HTMLButtonElement, label: string, fn: () => Promise<void>) => {
    btn.disabled = true;
    const old = btn.textContent;
    btn.textContent = label;
    progress.hidden = false;
    try {
      await fn();
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = old;
      progress.hidden = true;
    }
  };
  const onProgress = (d: number, t: number) => {
    progress.max = t;
    progress.value = d;
  };
  const printBtn = button(
    'Print',
    () =>
      busy(printBtn, 'Preparing…', async () => {
        const plan = await planSheet(ctx.get(), { onProgress });
        await printSheet(plan, ctx.get().print.outlines);
      }),
    { kind: 'primary' },
  );
  const pdfBtn = button('Download PDF', () =>
    busy(pdfBtn, 'Preparing…', async () => {
      const plan = await planSheet(ctx.get(), { onProgress });
      downloadBlob(await sheetPdf(plan, ctx.get().print.outlines), 'label-sheet.pdf');
    }),
  );

  let token = 0;
  const refresh = async () => {
    const mine = ++token;
    const s = ctx.get();
    const g = geometryFor(s.print.preset, s.print.custom);
    const issues = checkGeometry(g);
    problems.replaceChildren(...issues.map((i) => h('li', {}, i)));
    try {
      const plan = await planSheet(s, { maxPages: PREVIEW_PAGES });
      if (mine !== token) return;
      const count = plan.labels.length;
      const perPage = g.columns * g.rows;
      const total = (await sheetItems(s)).items.length;
      if (mine !== token) return;
      summary.textContent = total
        ? `${total} label${total === 1 ? '' : 's'} on ${plan.pages} page${plan.pages === 1 ? '' : 's'}, ${perPage} per page.` +
          (plan.pages > PREVIEW_PAGES ? ` Showing the first ${PREVIEW_PAGES} pages.` : '')
        : 'Nothing to print yet. Add content on the chosen tab.';
      summary.classList.remove('error');
      for (const e of plan.errors) problems.append(h('li', {}, e));
      pages.replaceChildren(...sheetDom(plan, true, PREVIEW_PAGES));
      printBtn.disabled = pdfBtn.disabled = count === 0;
    } catch (err) {
      if (mine !== token) return;
      summary.textContent = err instanceof Error ? err.message : String(err);
      summary.classList.add('error');
    }
  };

  const stage = h(
    'div',
    { class: 'stage-inner print-stage' },
    h(
      'div',
      { class: 'stage-head' },
      summary,
      h('div', { class: 'actions' }, printBtn, pdfBtn),
      progress,
    ),
    problems,
    pages,
  );
  return { controls, stage, refresh: () => void refresh() };
}
