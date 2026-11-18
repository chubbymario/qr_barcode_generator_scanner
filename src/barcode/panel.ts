import type { BarcodeSettings } from '../state';
import { groupSymbols, HINTS, usesBarHeight, is2D, type SymbolInfo } from './catalog';
import { defaultOptionString } from './options';
import {
  button,
  checkbox,
  colorInput,
  field,
  h,
  numberInput,
  range,
  section,
  segmented,
  select,
  textArea,
  textInput,
} from '../ui/dom';
import type { PanelContext } from '../qr/panel';
import { scanSupport } from '../scan/support';

export function buildBarcodePanel(ctx: PanelContext, symbols: readonly SymbolInfo[]): HTMLElement {
  const bc = ctx.get().barcode;
  const set = (fn: (b: BarcodeSettings) => void, rebuild = false) =>
    ctx.update((s) => fn(s.barcode), { rebuild });
  const sym = symbols.find((s) => s.bcid === bc.bcid) ?? symbols[0];
  const groups = groupSymbols(symbols);

  // ----- Format picker with search -----
  const formatSelect = select([], bc.bcid, (v) => set((b) => (b.bcid = v), true));
  formatSelect.size = 1;
  formatSelect.id = 'barcode-format';
  const fillFormats = (query: string) => {
    const q = query.trim().toLowerCase();
    const frag = document.createDocumentFragment();
    for (const g of groups) {
      const matches = g.symbols.filter(
        (s) => !q || s.desc.toLowerCase().includes(q) || s.bcid.toLowerCase().includes(q),
      );
      if (!matches.length) continue;
      if (q && g.name === 'Popular') continue; // avoid duplicates while searching
      frag.append(
        h(
          'optgroup',
          { label: g.name },
          // Mark formats the Scan tab can't read, so it's clear before printing one.
          matches.map((s) =>
            h(
              'option',
              { value: s.bcid },
              s.desc + (scanSupport(s.bcid).level === 'none' ? ' (can’t scan)' : ''),
            ),
          ),
        ),
      );
    }
    formatSelect.replaceChildren(frag);
    if ([...formatSelect.options].some((o) => o.value === bc.bcid)) formatSelect.value = bc.bcid;
    else if (formatSelect.options.length) formatSelect.selectedIndex = -1;
  };
  fillFormats('');
  const search = textInput('', (v) => fillFormats(v), {
    type: 'search',
    placeholder: 'Search 111 formats',
  });
  search.setAttribute('aria-label', 'Search formats');

  // ----- Data -----
  const text = bc.texts[bc.bcid] ?? sym?.text ?? '';
  const dataBox = is2D(bc.bcid)
    ? textArea(text, (v) => set((b) => (b.texts[b.bcid] = v)), 3)
    : textInput(text, (v) => set((b) => (b.texts[b.bcid] = v)), { spellcheck: false });
  dataBox.id = 'barcode-data';
  const hint = HINTS[bc.bcid] ?? (sym ? `Example: ${sym.text}` : '');

  const format = section(
    'Format and data',
    true,
    field('Find a format', search),
    field('Format', formatSelect, `Scanning: ${scanSupport(bc.bcid).note}`),
    field('Data', dataBox, hint),
    h(
      'div',
      { class: 'chips' },
      button('Use example data', () => set((b) => (b.texts[b.bcid] = sym?.text ?? ''), true), {
        kind: 'quiet',
      }),
    ),
  );

  // ----- Human-readable text -----
  const textBits = h(
    'div',
    { class: 'subfields' },
    field(
      'Font',
      select(
        [
          { value: '', label: 'Format default' },
          { value: 'OCR-B', label: 'OCR-B' },
          { value: 'OCR-A', label: 'OCR-A' },
        ],
        bc.textfont,
        (v) => set((b) => (b.textfont = v)),
      ),
    ),
    field(
      'Size',
      range(bc.textsize, (v) => set((b) => (b.textsize = v < 5 ? 0 : v)), {
        min: 4,
        max: 24,
        step: 1,
        format: (v) => (v < 5 ? 'Default' : `${v} pt`),
      }),
    ),
    field(
      'Alignment',
      select(
        [
          { value: '', label: 'Format default' },
          { value: 'center', label: 'Centred' },
          { value: 'left', label: 'Left' },
          { value: 'right', label: 'Right' },
          { value: 'justify', label: 'Spread to width' },
          { value: 'offleft', label: 'Outside left' },
          { value: 'offright', label: 'Outside right' },
        ],
        bc.textxalign,
        (v) => set((b) => (b.textxalign = v as BarcodeSettings['textxalign'])),
      ),
    ),
    field(
      'Position',
      segmented(
        'ty',
        [
          { value: '', label: 'Default' },
          { value: 'below', label: 'Below' },
          { value: 'above', label: 'Above' },
          { value: 'center', label: 'Middle' },
        ],
        bc.textyalign,
        (v) => set((b) => (b.textyalign = v as BarcodeSettings['textyalign'])),
      ),
    ),
    field(
      'Text colour',
      colorInput(bc.textcolor, (v) => set((b) => (b.textcolor = v))),
    ),
  );
  textBits.hidden = !bc.includetext;
  const textSection = section(
    'Text under the bars',
    false,
    checkbox('Show the text', bc.includetext, (v) => {
      textBits.hidden = !v;
      set((b) => (b.includetext = v));
    }),
    textBits,
  );

  // ----- Appearance -----
  const bgField = field(
    'Background',
    colorInput(bc.backgroundcolor, (v) => set((b) => (b.backgroundcolor = v))),
  );
  bgField.hidden = bc.transparentBackground;
  const look = section(
    'Bars and colours',
    false,
    usesBarHeight(bc.bcid)
      ? field(
          'Bar height (mm)',
          numberInput(bc.heightMm, (v) => set((b) => (b.heightMm = Math.max(1, v))), {
            min: 1,
            max: 300,
            step: 0.5,
          }),
          'Physical height of the bars at the export resolution.',
        )
      : null,
    field(
      'Bar colour',
      colorInput(bc.barcolor, (v) => set((b) => (b.barcolor = v))),
    ),
    checkbox('Transparent background', bc.transparentBackground, (v) => {
      bgField.hidden = v;
      set((b) => (b.transparentBackground = v));
    }),
    bgField,
    field(
      'Quiet zone',
      range(bc.paddingModules, (v) => set((b) => (b.paddingModules = v)), {
        min: 0,
        max: 40,
        step: 1,
        format: (v) => `${v} modules`,
      }),
      'Blank space around the code. Most 1D scanners want at least 10 modules.',
    ),
    checkbox('Draw a border', bc.showborder, (v) => set((b) => (b.showborder = v))),
    field(
      'Rotation',
      segmented(
        'rot',
        [
          { value: 'N', label: '0°' },
          { value: 'R', label: '90°' },
          { value: 'I', label: '180°' },
          { value: 'L', label: '270°' },
        ],
        bc.rotate,
        (v) => set((b) => (b.rotate = v as BarcodeSettings['rotate'])),
      ),
    ),
  );

  // ----- Advanced -----
  const defaults = defaultOptionString(sym?.opts ?? '');
  const adv = textInput(
    bc.options[bc.bcid] ?? defaults,
    (v) => set((b) => (b.options[b.bcid] = v)),
    {
      placeholder: 'e.g. includecheck version=24x24',
    },
  );
  const advanced = section(
    'More options',
    false,
    field(
      'Encoder options',
      adv,
      `Space-separated options passed to the encoder, like "includecheck" or "eclevel=Q". This format's defaults: ${defaults || 'none'}.`,
    ),
    h(
      'div',
      { class: 'chips' },
      button('Reset to defaults', () => set((b) => delete b.options[b.bcid], true), {
        kind: 'quiet',
      }),
      h(
        'a',
        {
          class: 'btn quiet',
          href: 'https://github.com/bwipp/postscriptbarcode/wiki/Symbologies-Reference',
          target: '_blank',
          rel: 'noopener noreferrer',
        },
        'All options per format',
      ),
    ),
  );

  return h('div', { class: 'panel-body' }, format, textSection, look, advanced);
}
