import type {
  CornerDotType,
  CornerSquareType,
  DotType,
  ErrorCorrectionLevel,
} from 'qr-code-styling';
import type { AppState, QrSettings } from '../state';
import { CONTENT_TYPES, contentDef, type ContentType, type FieldDef } from './content';
import {
  button,
  checkbox,
  field,
  h,
  range,
  section,
  segmented,
  select,
  textArea,
  textInput,
  toast,
} from '../ui/dom';
import { paintEditor } from '../ui/paint';
import { blobToDataUrl, canvasToBlob, loadImage } from '../export/files';

export interface PanelContext {
  get: () => AppState;
  /** Change settings. `rebuild` re-creates the panel (for structural changes). */
  update: (fn: (s: AppState) => void, opts?: { rebuild?: boolean }) => void;
}

const DOT_TYPES: { value: DotType; label: string }[] = [
  { value: 'square', label: 'Square' },
  { value: 'rounded', label: 'Rounded' },
  { value: 'extra-rounded', label: 'Extra rounded' },
  { value: 'dots', label: 'Dots' },
  { value: 'classy', label: 'Classy' },
  { value: 'classy-rounded', label: 'Classy rounded' },
];

const CORNER_SQUARE: { value: CornerSquareType | 'none'; label: string }[] = [
  { value: 'none', label: 'Same as pattern' },
  { value: 'square', label: 'Square' },
  { value: 'extra-rounded', label: 'Rounded' },
  { value: 'dot', label: 'Circle' },
  { value: 'dots', label: 'Dotted' },
  { value: 'classy', label: 'Classy' },
  { value: 'classy-rounded', label: 'Classy rounded' },
];

const CORNER_DOT: { value: CornerDotType | 'none'; label: string }[] = [
  { value: 'none', label: 'Same as pattern' },
  { value: 'square', label: 'Square' },
  { value: 'dot', label: 'Circle' },
  { value: 'rounded', label: 'Rounded' },
  { value: 'extra-rounded', label: 'Extra rounded' },
  { value: 'dots', label: 'Dots' },
  { value: 'classy', label: 'Classy' },
  { value: 'classy-rounded', label: 'Classy rounded' },
];

const PRESETS: { name: string; apply: (q: QrSettings) => void }[] = [
  {
    name: 'Plain',
    apply: (q) => {
      q.dotType = 'square';
      q.cornerSquareType = 'none';
      q.cornerDotType = 'none';
      q.shape = 'square';
    },
  },
  {
    name: 'Soft',
    apply: (q) => {
      q.dotType = 'rounded';
      q.cornerSquareType = 'extra-rounded';
      q.cornerDotType = 'dot';
    },
  },
  {
    name: 'Dotted',
    apply: (q) => {
      q.dotType = 'dots';
      q.cornerSquareType = 'extra-rounded';
      q.cornerDotType = 'dot';
    },
  },
  {
    name: 'Classy',
    apply: (q) => {
      q.dotType = 'classy-rounded';
      q.cornerSquareType = 'classy-rounded';
      q.cornerDotType = 'classy';
    },
  },
  {
    name: 'Round badge',
    apply: (q) => {
      q.shape = 'circle';
      q.dotType = 'dots';
      q.cornerSquareType = 'dot';
      q.cornerDotType = 'dot';
    },
  },
];

function contentField(
  def: FieldDef,
  value: string | boolean,
  onChange: (v: string | boolean) => void,
) {
  switch (def.kind) {
    case 'checkbox':
      return checkbox(def.label, value === true, onChange);
    case 'textarea':
      return field(def.label, textArea(String(value ?? ''), onChange, 3));
    case 'select':
      return field(
        def.label,
        select(def.options ?? [], String(value ?? def.options?.[0]?.value ?? ''), onChange),
      );
    default:
      return field(
        def.label,
        textInput(String(value ?? ''), onChange, {
          type: def.kind,
          placeholder: def.placeholder,
          autocomplete: def.autocomplete,
        }),
      );
  }
}

/** Shrink big raster logos so they fit in storage and render fast. */
async function readLogo(file: File): Promise<string> {
  if (file.type === 'image/svg+xml') {
    if (file.size > 500_000) throw new Error('That SVG is over 500 KB. Try a simpler file.');
    return blobToDataUrl(file);
  }
  const url = await blobToDataUrl(file);
  const img = await loadImage(url);
  const max = 640;
  const scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
  if (scale === 1 && file.size < 400_000) return url;
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(img.naturalWidth * scale);
  canvas.height = Math.round(img.naturalHeight * scale);
  canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
  return blobToDataUrl(await canvasToBlob(canvas, 'image/png'));
}

export function buildQrPanel(ctx: PanelContext): HTMLElement {
  const q = ctx.get().qr;
  const set = (fn: (q: QrSettings) => void, rebuild = false) =>
    ctx.update((s) => fn(s.qr), { rebuild });

  // ----- Content -----
  const def = contentDef(q.contentType);
  const values = { ...def.defaults, ...(q.fields[q.contentType] ?? {}) };
  const fieldsWrap = h('div', { class: 'fields' });
  const drawFields = () => {
    const current = { ...def.defaults, ...(ctx.get().qr.fields[q.contentType] ?? {}) };
    fieldsWrap.replaceChildren(
      ...def.fields
        .filter((f) => !f.when || f.when(current))
        .map((f) =>
          contentField(f, current[f.key] ?? '', (v) => {
            set((qq) => {
              qq.fields[qq.contentType] = { ...values, ...qq.fields[qq.contentType], [f.key]: v };
            });
            if (def.fields.some((x) => x.when)) {
              // Re-evaluate conditional fields without losing focus on text boxes.
              if (f.kind === 'select' || f.kind === 'checkbox') drawFields();
            }
          }),
        ),
    );
  };
  drawFields();

  const typePicker = segmented(
    'ctype',
    CONTENT_TYPES.map((c) => ({ value: c.type, label: c.label })),
    q.contentType,
    (v) => set((qq) => (qq.contentType = v as ContentType), true),
  );
  typePicker.classList.add('wrap');
  typePicker.setAttribute('aria-label', 'What the code opens');

  const content = section('Content', true, typePicker, fieldsWrap);

  // ----- Pattern -----
  const presetRow = h(
    'div',
    { class: 'chips', role: 'group', 'aria-label': 'Style presets' },
    PRESETS.map((p) => button(p.name, () => set(p.apply, true), { kind: 'quiet' })),
  );
  const pattern = section(
    'Pattern',
    false,
    presetRow,
    field(
      'Dot style',
      select(DOT_TYPES, q.dotType, (v) => set((qq) => (qq.dotType = v as DotType))),
    ),
    field(
      'Outline',
      segmented(
        'shape',
        [
          { value: 'square', label: 'Square' },
          { value: 'circle', label: 'Circle' },
        ],
        q.shape,
        (v) => set((qq) => (qq.shape = v as QrSettings['shape'])),
      ),
    ),
    checkbox('Align dots to whole pixels', q.roundSize, (v) => set((qq) => (qq.roundSize = v))),
    paintEditor('Dot colour', q.dots, (p) => set((qq) => (qq.dots = p))),
  );

  // ----- Corners -----
  const cornerColours = h(
    'div',
    { class: 'subfields' },
    paintEditor('Frame colour', q.cornerSquare, (p) => set((qq) => (qq.cornerSquare = p))),
    paintEditor('Centre colour', q.cornerDot, (p) => set((qq) => (qq.cornerDot = p))),
  );
  cornerColours.hidden = q.cornersMatchDots;
  const corners = section(
    'Corners',
    false,
    field(
      'Corner frame',
      select(CORNER_SQUARE, q.cornerSquareType, (v) =>
        set((qq) => (qq.cornerSquareType = v as QrSettings['cornerSquareType'])),
      ),
    ),
    field(
      'Corner centre',
      select(CORNER_DOT, q.cornerDotType, (v) =>
        set((qq) => (qq.cornerDotType = v as QrSettings['cornerDotType'])),
      ),
    ),
    checkbox('Use the dot colour', q.cornersMatchDots, (v) => {
      cornerColours.hidden = v;
      set((qq) => (qq.cornersMatchDots = v));
    }),
    cornerColours,
  );

  // ----- Background -----
  const bgPaint = h(
    'div',
    {},
    paintEditor('Background colour', q.background, (p) => set((qq) => (qq.background = p))),
    field(
      'Rounded corners',
      range(q.backgroundRound * 100, (v) => set((qq) => (qq.backgroundRound = v / 100)), {
        min: 0,
        max: 100,
        step: 5,
        format: (v) => `${v}%`,
      }),
    ),
  );
  bgPaint.hidden = q.transparentBackground;
  const background = section(
    'Background',
    false,
    checkbox('Transparent', q.transparentBackground, (v) => {
      bgPaint.hidden = v;
      set((qq) => (qq.transparentBackground = v));
    }),
    bgPaint,
  );

  // ----- Logo -----
  const fileInput = h('input', {
    type: 'file',
    accept: 'image/png,image/jpeg,image/webp,image/gif,image/svg+xml',
    class: 'visually-hidden',
  });
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    try {
      const data = await readLogo(file);
      const raised = ctx.get().qr.ecLevel !== 'H';
      set((qq) => {
        qq.logo = data;
        qq.logoName = file.name;
        if (raised) qq.ecLevel = 'H';
      }, true);
      if (raised) toast('Error correction set to High so the code still scans with a logo.');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'That image could not be read.', 'error');
    }
  });
  const pick = h(
    'label',
    { class: 'btn plain file' },
    fileInput,
    q.logo ? 'Replace image' : 'Choose image',
  );
  const logoBody: HTMLElement[] = [
    h(
      'div',
      { class: 'logo-row' },
      q.logo ? h('img', { src: q.logo, alt: '', class: 'logo-thumb' }) : null,
      h(
        'div',
        {},
        pick,
        q.logo
          ? h('p', { class: 'hint' }, q.logoName)
          : h('p', { class: 'hint' }, 'PNG, JPG, WebP, GIF or SVG. It stays on this device.'),
      ),
      q.logo
        ? button('Remove', () => set((qq) => ((qq.logo = null), (qq.logoName = '')), true), {
            kind: 'quiet',
          })
        : null,
    ),
  ];
  if (q.logo) {
    logoBody.push(
      field(
        'Logo size',
        range(q.logoSize * 100, (v) => set((qq) => (qq.logoSize = v / 100)), {
          min: 10,
          max: 50,
          step: 1,
          format: (v) => `${v}%`,
        }),
        'Above about 30% the code may stop scanning, especially at lower error correction.',
      ),
      field(
        'Space around logo',
        range(q.logoMargin, (v) => set((qq) => (qq.logoMargin = v)), { min: 0, max: 40, step: 1 }),
      ),
      checkbox('Clear the dots behind the logo', q.hideBackgroundDots, (v) =>
        set((qq) => (qq.hideBackgroundDots = v)),
      ),
    );
  }
  const logo = section('Logo', !!q.logo, ...logoBody);

  // ----- Error correction & size -----
  const ecHints: Record<ErrorCorrectionLevel, string> = {
    L: 'Low: recovers about 7% damage. Smallest code.',
    M: 'Medium: about 15%. A good default.',
    Q: 'Quartile: about 25%.',
    H: 'High: about 30%. Best with a logo or for rough surfaces.',
  };
  const ecHint = h('p', { class: 'hint' }, ecHints[q.ecLevel]);
  const versions = [{ value: '0', label: 'Automatic' }].concat(
    Array.from({ length: 40 }, (_, i) => ({
      value: String(i + 1),
      label: `${i + 1} (${17 + 4 * (i + 1)}×${17 + 4 * (i + 1)})`,
    })),
  );
  const technical = section(
    'Error correction and size',
    false,
    field(
      'Error correction',
      segmented(
        'ec',
        (['L', 'M', 'Q', 'H'] as const).map((v) => ({
          value: v,
          label: { L: 'Low', M: 'Medium', Q: 'Quartile', H: 'High' }[v],
        })),
        q.ecLevel,
        (v) => {
          ecHint.textContent = ecHints[v as ErrorCorrectionLevel];
          set((qq) => (qq.ecLevel = v as ErrorCorrectionLevel));
        },
      ),
    ),
    ecHint,
    field(
      'Version (grid size)',
      select(versions, String(q.typeNumber), (v) => set((qq) => (qq.typeNumber = Number(v)))),
      'Automatic picks the smallest grid that fits. Fix it to keep a set of codes the same size.',
    ),
    field(
      'Quiet zone',
      range(q.marginPct, (v) => set((qq) => (qq.marginPct = v)), {
        min: 0,
        max: 20,
        step: 1,
        format: (v) => `${v}%`,
      }),
      'The blank border scanners need. Keep some unless the code sits on a plain background.',
    ),
  );

  return h('div', { class: 'panel-body' }, content, pattern, corners, background, logo, technical);
}
