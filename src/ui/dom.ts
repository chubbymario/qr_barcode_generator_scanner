// Tiny DOM helpers. No framework: the app is a handful of forms and a preview.

type Attrs = Record<string, string | number | boolean | null | undefined>;
type Child = Node | string | null | undefined | false;

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  ...children: (Child | Child[])[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'spellcheck' && typeof v === 'boolean') {
      el.setAttribute('spellcheck', String(v));
      continue;
    }
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') el.className = String(v);
    else if (k in el && typeof v !== 'string') (el as unknown as Record<string, unknown>)[k] = v;
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c);
  }
  return el;
}

let uid = 0;
export const nextId = (prefix = 'f') => `${prefix}-${++uid}`;

export interface Option {
  value: string;
  label: string;
}

/** A labelled row. `control` must be focusable; the label is linked to it. */
export function field(label: string, control: HTMLElement, hint?: string): HTMLElement {
  const id = control.id || nextId();
  control.id = id;
  const hintEl = hint ? h('p', { class: 'hint', id: `${id}-hint` }, hint) : null;
  if (hintEl) control.setAttribute('aria-describedby', hintEl.id);
  return h('div', { class: 'field' }, h('label', { for: id }, label), control, hintEl);
}

export function textInput(
  value: string,
  onInput: (v: string) => void,
  opts: { type?: string; placeholder?: string; autocomplete?: string; spellcheck?: boolean } = {},
): HTMLInputElement {
  const el = h('input', {
    type: opts.type ?? 'text',
    placeholder: opts.placeholder,
    autocomplete: opts.autocomplete ?? 'off',
    spellcheck: opts.spellcheck ?? false,
  });
  el.value = value;
  el.addEventListener('input', () => onInput(el.value));
  return el;
}

export function textArea(
  value: string,
  onInput: (v: string) => void,
  rows = 3,
): HTMLTextAreaElement {
  const el = h('textarea', { rows, spellcheck: false });
  el.value = value;
  el.addEventListener('input', () => onInput(el.value));
  return el;
}

export function numberInput(
  value: number,
  onInput: (v: number) => void,
  opts: { min?: number; max?: number; step?: number } = {},
): HTMLInputElement {
  const el = h('input', {
    type: 'number',
    inputmode: 'decimal',
    min: opts.min,
    max: opts.max,
    step: opts.step ?? 'any',
  });
  el.value = String(value);
  el.addEventListener('input', () => {
    const v = el.valueAsNumber;
    if (Number.isFinite(v)) onInput(v);
  });
  return el;
}

export function select(
  options: Option[] | { group: string; options: Option[] }[],
  value: string,
  onChange: (v: string) => void,
): HTMLSelectElement {
  const el = h('select');
  for (const o of options) {
    if ('group' in o) {
      el.append(
        h(
          'optgroup',
          { label: o.group },
          o.options.map((x) => h('option', { value: x.value }, x.label)),
        ),
      );
    } else {
      el.append(h('option', { value: o.value }, o.label));
    }
  }
  el.value = value;
  el.addEventListener('change', () => onChange(el.value));
  return el;
}

export function checkbox(
  label: string,
  checked: boolean,
  onChange: (v: boolean) => void,
): HTMLElement {
  const input = h('input', { type: 'checkbox' });
  input.checked = checked;
  input.addEventListener('change', () => onChange(input.checked));
  return h('label', { class: 'check' }, input, h('span', {}, label));
}

/** Slider with its value shown next to it. */
export function range(
  value: number,
  onInput: (v: number) => void,
  opts: { min: number; max: number; step?: number; format?: (v: number) => string },
): HTMLElement {
  const fmt = opts.format ?? String;
  const input = h('input', { type: 'range', min: opts.min, max: opts.max, step: opts.step ?? 1 });
  input.value = String(value);
  const out = h('output', {}, fmt(value));
  input.addEventListener('input', () => {
    out.textContent = fmt(input.valueAsNumber);
    onInput(input.valueAsNumber);
  });
  const wrap = h('div', { class: 'range' }, input, out);
  // Let field() link its label to the slider itself.
  Object.defineProperty(wrap, 'id', {
    get: () => input.id,
    set: (v: string) => (input.id = v),
  });
  return wrap;
}

/** Colour swatch plus hex text box, kept in sync. */
export function colorInput(value: string, onInput: (v: string) => void): HTMLElement {
  const swatch = h('input', { type: 'color', 'aria-label': 'Pick colour' });
  const text = h('input', {
    type: 'text',
    class: 'hex',
    maxlength: 7,
    spellcheck: false,
    autocomplete: 'off',
  });
  swatch.value = normaliseHex(value);
  text.value = normaliseHex(value);
  swatch.addEventListener('input', () => {
    text.value = swatch.value;
    onInput(swatch.value);
  });
  text.addEventListener('input', () => {
    const v = text.value.trim();
    if (/^#?[0-9a-f]{6}$/i.test(v) || /^#?[0-9a-f]{3}$/i.test(v)) {
      const hex = normaliseHex(v);
      swatch.value = hex;
      onInput(hex);
    }
  });
  const wrap = h('div', { class: 'color' }, swatch, text);
  Object.defineProperty(wrap, 'id', { get: () => text.id, set: (v: string) => (text.id = v) });
  return wrap;
}

export function normaliseHex(v: string): string {
  let s = v.trim().replace(/^#/, '');
  if (s.length === 3) s = s.replace(/./g, (c) => c + c);
  return /^[0-9a-f]{6}$/i.test(s) ? `#${s.toLowerCase()}` : '#000000';
}

/** Segmented radio buttons for 2–5 short choices. */
export function segmented(
  name: string,
  options: Option[],
  value: string,
  onChange: (v: string) => void,
): HTMLElement {
  const group = nextId(name);
  const wrap = h('div', { class: 'segmented', role: 'radiogroup' });
  for (const o of options) {
    const input = h('input', { type: 'radio', name: group, value: o.value });
    input.checked = o.value === value;
    input.addEventListener('change', () => input.checked && onChange(o.value));
    wrap.append(h('label', {}, input, h('span', {}, o.label)));
  }
  return wrap;
}

/** Collapsible group of settings. */
export function section(
  title: string,
  open: boolean,
  ...children: (Child | Child[])[]
): HTMLDetailsElement {
  const d = h(
    'details',
    { class: 'group', open },
    h('summary', {}, title),
    h('div', { class: 'group-body' }, ...children),
  );
  return d;
}

export function button(
  label: string,
  onClick: (ev: MouseEvent) => void,
  opts: { kind?: 'primary' | 'quiet' | 'plain'; title?: string; type?: 'button' | 'submit' } = {},
): HTMLButtonElement {
  const el = h(
    'button',
    { type: opts.type ?? 'button', class: `btn ${opts.kind ?? 'plain'}`, title: opts.title },
    label,
  );
  el.addEventListener('click', onClick);
  return el;
}

export function debounce<A extends unknown[]>(
  fn: (...args: A) => void,
  ms: number,
): (...args: A) => void {
  let t: ReturnType<typeof setTimeout> | undefined;
  return (...args: A) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

// ---------- toast ----------

let toastTimer: ReturnType<typeof setTimeout> | undefined;
export function toast(
  message: string,
  kind: 'ok' | 'error' = 'ok',
  action?: { label: string; run: () => void },
): void {
  const el = document.getElementById('toast');
  if (!el) return;
  el.replaceChildren(h('span', {}, message));
  if (action)
    el.append(
      button(
        action.label,
        () => {
          action.run();
          el.hidden = true;
        },
        { kind: 'quiet' },
      ),
    );
  el.dataset.kind = kind;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.hidden = true), action ? 12_000 : 3_500);
}
