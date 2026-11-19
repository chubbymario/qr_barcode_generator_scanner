// A searchable dropdown: type to filter, arrow keys to move, Enter to pick.
// Follows the WAI-ARIA combobox pattern (input + listbox with active descendant).

import { h, nextId } from './dom';

export interface ComboOption {
  value: string;
  label: string;
  group?: string;
  /** Short secondary text shown after the label (e.g. "can't scan"). */
  note?: string;
  /** Extra words that match when searching (e.g. "ean upc retail"). */
  keywords?: string;
}

export interface Combobox extends HTMLElement {
  /** Pick a value as if the user had chosen it (fires onChange). */
  choose(value: string): void;
}

const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

/** Score how well an option matches the query (0 = no match). */
function score(o: ComboOption, q: string): number {
  if (!q) return 1;
  const label = norm(o.label);
  const value = norm(o.value);
  const hay = `${label} ${value} ${norm(o.keywords ?? '')} ${norm(o.group ?? '')}`;
  const words = q.split(' ').filter(Boolean);
  if (!words.every((w) => hay.includes(w))) return 0;
  if (value === q || label === q) return 100;
  const compact = (s: string) => s.replace(/ /g, '');
  if (compact(value) === compact(q) || compact(label) === compact(q)) return 90;
  if (label.startsWith(q)) return 50;
  if (label.split(' ').some((w) => w.startsWith(words[0]))) return 30;
  return 10;
}

export function combobox(opts: {
  options: ComboOption[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  /** Accessible name when there's no visible <label>. */
  ariaLabel?: string;
}): Combobox {
  const listId = nextId('list');
  const input = h('input', {
    type: 'text',
    role: 'combobox',
    autocomplete: 'off',
    spellcheck: false,
    'aria-autocomplete': 'list',
    'aria-expanded': 'false',
    'aria-controls': listId,
    placeholder: opts.placeholder ?? 'Type to search',
    'aria-label': opts.ariaLabel,
  });
  const list = h('ul', { id: listId, role: 'listbox', class: 'combo-list' });
  list.hidden = true;
  const toggle = h(
    'button',
    { type: 'button', class: 'combo-toggle', tabindex: -1, 'aria-label': 'Show all' },
    h('span', { 'aria-hidden': 'true' }),
  );
  const root = h('div', { class: 'combo' }, input, toggle, list) as unknown as Combobox;

  let value = opts.value;
  let shown: ComboOption[] = [];
  let active = -1;
  const labelOf = (v: string) => opts.options.find((o) => o.value === v)?.label ?? '';
  input.value = labelOf(value);

  function render(query: string) {
    const q = norm(query);
    const seen = new Set<string>();
    const scored = opts.options.map((o, i) => ({ o, s: score(o, q), i })).filter((x) => x.s > 0);
    // While searching, best matches first and each value once; browsing keeps groups.
    if (q) scored.sort((a, b) => b.s - a.s || a.i - b.i);
    shown = [];
    list.replaceChildren();
    let lastGroup: string | undefined;
    for (const { o } of scored) {
      // Searching lists each format once; browsing shows it under every
      // group it belongs to (e.g. "Popular" and its own category).
      if (q && seen.has(o.value)) continue;
      seen.add(o.value);
      if (!q && o.group !== lastGroup && o.group) {
        list.append(h('li', { class: 'combo-group', role: 'presentation' }, o.group));
        lastGroup = o.group;
      }
      const idx = shown.length;
      shown.push(o);
      const li = h(
        'li',
        {
          role: 'option',
          id: `${listId}-${idx}`,
          class: 'combo-option',
          'aria-selected': String(o.value === value),
        },
        h('span', {}, o.label),
        o.note ? h('span', { class: 'combo-note' }, o.note) : null,
      );
      // Chosen on click, so scrolling the list with a finger never picks
      // anything; mousedown is cancelled so the text box keeps focus.
      li.addEventListener('mousedown', (e) => e.preventDefault());
      li.addEventListener('click', () => pick(o.value));
      // Touch: a tap is a press and release without moving (a scroll is
      // cancelled by the browser before it gets here).
      let downAt: [number, number] | null = null;
      li.addEventListener('pointerdown', (e) => {
        downAt = e.pointerType === 'mouse' ? null : [e.clientX, e.clientY];
      });
      li.addEventListener('pointerup', (e) => {
        if (downAt && Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) < 10) {
          e.preventDefault();
          pick(o.value);
        }
        downAt = null;
      });
      li.addEventListener('pointercancel', () => (downAt = null));
      list.append(li);
    }
    if (!shown.length)
      list.append(h('li', { class: 'combo-empty', role: 'presentation' }, 'No matches'));
    // The current choice in its own category (the last place it's listed).
    let current = -1;
    shown.forEach((o, i) => o.value === value && (current = i));
    setActive(q ? 0 : Math.max(0, current), false);
  }

  function setActive(i: number, scroll = true) {
    active = shown.length ? Math.max(0, Math.min(shown.length - 1, i)) : -1;
    list
      .querySelectorAll('.combo-option')
      .forEach((el, k) => el.classList.toggle('active', k === active));
    if (active >= 0) {
      const el = document.getElementById(`${listId}-${active}`);
      input.setAttribute('aria-activedescendant', `${listId}-${active}`);
      if (scroll) el?.scrollIntoView({ block: 'nearest' });
    } else input.removeAttribute('aria-activedescendant');
  }

  // Where the list was scrolled when it was last closed without a choice.
  let savedScroll: number | null = null;
  function open(query = '') {
    render(query);
    list.hidden = false;
    input.setAttribute('aria-expanded', 'true');
    if (query) return;
    if (savedScroll !== null) list.scrollTop = savedScroll;
    else {
      // Show the current choice in the middle of the list.
      const el = active >= 0 ? document.getElementById(`${listId}-${active}`) : null;
      if (el) list.scrollTop = el.offsetTop - (list.clientHeight - el.offsetHeight) / 2;
    }
  }
  function close(restore = true) {
    if (!list.hidden && input.value === labelOf(value)) savedScroll = list.scrollTop;
    list.hidden = true;
    input.setAttribute('aria-expanded', 'false');
    input.removeAttribute('aria-activedescendant');
    if (restore) input.value = labelOf(value);
  }
  function pick(v: string) {
    const changed = v !== value;
    value = v;
    input.value = labelOf(v);
    close(false);
    savedScroll = null;
    if (changed) opts.onChange(v);
  }
  root.choose = pick;

  // Focus alone (including focus restored after the page redraws) only
  // selects the text; the list opens on a press, typing or the arrow keys.
  input.addEventListener('focus', () => input.select());
  // Pressing on the closed box opens the list. With a mouse the text is
  // selected, ready to type over; with a finger the list opens without the
  // keyboard (tap the box again to type a search).
  const openFromPointer = (e: PointerEvent) => {
    e.preventDefault();
    if (e.pointerType === 'mouse') {
      input.focus();
      input.select();
    }
    open();
  };
  input.addEventListener('pointerdown', (e) => {
    if (list.hidden) openFromPointer(e);
  });
  input.addEventListener('input', () => open(input.value));
  // While the pointer is down inside the list (dragging its scrollbar, say),
  // losing focus doesn't close it.
  let pressingList = false;
  list.addEventListener('pointerdown', () => (pressingList = true));
  const release = (e: PointerEvent) => {
    if (!pressingList) return;
    pressingList = false;
    if (e.pointerType === 'mouse' && !list.hidden && document.activeElement !== input)
      input.focus({ preventScroll: true });
  };
  window.addEventListener('pointerup', release);
  window.addEventListener('pointercancel', release);
  input.addEventListener('blur', () => {
    if (!pressingList) close();
  });
  // A press anywhere else closes the list (needed when it was opened by touch,
  // without focus).
  const outside = (e: PointerEvent) => {
    if (!root.isConnected) {
      document.removeEventListener('pointerdown', outside, true);
      window.removeEventListener('pointerup', release);
      window.removeEventListener('pointercancel', release);
      return;
    }
    if (!list.hidden && !root.contains(e.target as Node)) close();
  };
  document.addEventListener('pointerdown', outside, true);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (list.hidden) open();
      else setActive(active + (e.key === 'ArrowDown' ? 1 : -1));
    } else if (e.key === 'PageDown' || e.key === 'PageUp') {
      e.preventDefault();
      setActive(active + (e.key === 'PageDown' ? 8 : -8));
    } else if (e.key === 'Enter') {
      if (!list.hidden && active >= 0) {
        e.preventDefault();
        pick(shown[active].value);
      }
    } else if (e.key === 'Escape') {
      if (!list.hidden) {
        e.preventDefault();
        close();
      }
    }
  });
  toggle.addEventListener('pointerdown', (e) => {
    if (list.hidden) openFromPointer(e);
    else {
      e.preventDefault();
      close();
    }
  });

  // Let field() link its <label> and hint to the input.
  const setAttr = root.setAttribute.bind(root);
  root.setAttribute = (name: string, v: string) =>
    name.startsWith('aria-') ? input.setAttribute(name, v) : setAttr(name, v);
  Object.defineProperty(root, 'id', { get: () => input.id, set: (v: string) => (input.id = v) });
  return root;
}
