import '@fontsource-variable/archivo/wdth.css';
import './styles.css';
import {
  clearSavedState,
  loadState,
  readShareHash,
  saveState,
  type AppState,
  type Tab,
  type Theme,
} from './state';
import { buildQrPanel, type PanelContext } from './qr/panel';
import { buildBarcodePanel } from './barcode/panel';
import { buildBatchPanel } from './batch/panel';
import { buildPrintPanel } from './print/panel';
import { buildScanPanel } from './scan/panel';
import { buildStage } from './ui/stage';
import { barcodeGenerator, getSymbols, qrGenerator } from './generators';
import { button, debounce, h, toast } from './ui/dom';

const state: AppState = loadState();

if (location.hash === '#scan') {
  state.tab = 'scan';
  history.replaceState(null, '', location.pathname + location.search);
}
if (readShareHash(location.hash)) {
  history.replaceState(null, '', location.pathname + location.search);
  queueMicrotask(() => toast('Settings loaded from the link.'));
}

const controlsEl = document.getElementById('controls')!;
const stageEl = document.getElementById('stage')!;
const tabButtons = [...document.querySelectorAll<HTMLButtonElement>('[role="tab"]')];

let refreshStage: () => void = () => {};
let disposeStage: () => void = () => {};
const scheduleRefresh = debounce(() => refreshStage(), 140);
const scheduleSave = debounce(() => {
  if (!saveState(state) && state.qr.logo) {
    toast('Your logo is too big to remember between visits. Everything else is saved.', 'error');
  }
}, 400);

const ctx: PanelContext = {
  get: () => state,
  update(fn, opts = {}) {
    const tabBefore = state.tab;
    fn(state);
    scheduleSave();
    if (opts.rebuild || state.tab !== tabBefore) void mount();
    else scheduleRefresh();
  },
};

const qrGen = qrGenerator(() => state);
const barcodeGen = barcodeGenerator(() => state);

/** Remember which sections are open so rebuilding doesn't collapse them. */
const openSections = new Map<string, boolean>();
function rememberSections() {
  controlsEl.querySelectorAll<HTMLDetailsElement>('details.group').forEach((d) => {
    const key = `${state.tab}:${d.querySelector('summary')?.textContent}`;
    openSections.set(key, d.open);
  });
}
function restoreSections() {
  controlsEl.querySelectorAll<HTMLDetailsElement>('details.group').forEach((d) => {
    const key = `${state.tab}:${d.querySelector('summary')?.textContent}`;
    const open = openSections.get(key);
    if (open !== undefined) d.open = open;
    d.addEventListener('toggle', () => openSections.set(key, d.open));
  });
}

let mountToken = 0;
async function mount() {
  const mine = ++mountToken;
  const scroll = controlsEl.scrollTop;
  const focusedId = document.activeElement?.id;
  rememberSections();
  for (const b of tabButtons) {
    const on = b.dataset.tab === state.tab;
    b.setAttribute('aria-selected', String(on));
    b.tabIndex = on ? 0 : -1;
  }
  document.body.dataset.tab = state.tab;

  let controls: HTMLElement;
  let stage: HTMLElement;
  disposeStage();
  disposeStage = () => {};
  switch (state.tab) {
    case 'qr': {
      controls = buildQrPanel(ctx);
      const s = buildStage(ctx, qrGen);
      stage = s.el;
      refreshStage = s.refresh;
      break;
    }
    case 'barcode': {
      if (!stageEl.querySelector('.stage-inner') || document.body.dataset.loaded !== 'barcode') {
        controlsEl.replaceChildren(h('p', { class: 'loading' }, 'Loading barcode formats…'));
        stageEl.replaceChildren();
      }
      const symbols = await getSymbols();
      if (mine !== mountToken) return;
      document.body.dataset.loaded = 'barcode';
      controls = buildBarcodePanel(ctx, symbols);
      const s = buildStage(ctx, barcodeGen);
      stage = s.el;
      refreshStage = s.refresh;
      break;
    }
    case 'batch': {
      const p = buildBatchPanel(ctx);
      controls = p.controls;
      stage = p.stage;
      refreshStage = p.refresh;
      break;
    }
    case 'print': {
      const p = buildPrintPanel(ctx);
      controls = p.controls;
      stage = p.stage;
      refreshStage = p.refresh;
      break;
    }
    case 'scan': {
      const p = buildScanPanel(ctx);
      controls = p.controls;
      stage = p.stage;
      refreshStage = p.refresh;
      disposeStage = p.dispose;
      break;
    }
  }
  if (mine !== mountToken) return;
  controlsEl.replaceChildren(controls);
  stageEl.replaceChildren(stage);
  controlsEl.setAttribute('aria-labelledby', `tab-${state.tab}`);
  restoreSections();
  controlsEl.scrollTop = scroll;
  if (focusedId) document.getElementById(focusedId)?.focus({ preventScroll: true });
  refreshStage();
}

// ----- tabs -----
tabButtons.forEach((btn, i) => {
  btn.addEventListener('click', () => ctx.update((s) => (s.tab = btn.dataset.tab as Tab)));
  btn.addEventListener('keydown', (e) => {
    const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const next = tabButtons[(i + step + tabButtons.length) % tabButtons.length];
    next.focus();
    next.click();
  });
});

// ----- theme -----
const themeBtn = document.getElementById('theme') as HTMLButtonElement;
const THEME_LABEL: Record<Theme, string> = {
  system: 'automatic',
  light: 'light',
  dark: 'dark',
};
function applyTheme() {
  if (state.theme === 'system') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = state.theme;
  themeBtn.replaceChildren(
    h('span', { class: 'theme-prefix' }, 'Theme:\u00a0'),
    THEME_LABEL[state.theme],
  );
  themeBtn.setAttribute('aria-label', `Theme: ${THEME_LABEL[state.theme]}. Click to change.`);
}
themeBtn.addEventListener('click', () => {
  const order: Theme[] = ['system', 'light', 'dark'];
  state.theme = order[(order.indexOf(state.theme) + 1) % order.length];
  applyTheme();
  scheduleSave();
});
applyTheme();

// ----- footer -----
const footerLinks = document.getElementById('footer-links')!;
const gh = /^([^.]+)\.github\.io$/i.exec(location.hostname);
if (gh) {
  const repo = location.pathname.split('/').filter(Boolean)[0];
  const href = repo
    ? `https://github.com/${gh[1]}/${repo}`
    : `https://github.com/${gh[1]}/${gh[1]}.github.io`;
  footerLinks.prepend(h('a', { href, rel: 'noopener' }, 'Source code'));
}
footerLinks.append(
  button(
    'Reset all settings',
    () => {
      if (!confirm('Reset every setting, including your logo and batch list?')) return;
      clearSavedState();
      location.reload();
    },
    { kind: 'quiet' },
  ),
);

// ----- offline support -----
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  import('virtual:pwa-register').then(({ registerSW }) => {
    const update = registerSW({
      onNeedRefresh() {
        toast('A new version is ready.', 'ok', { label: 'Update', run: () => void update(true) });
      },
      onOfflineReady() {
        toast('Ready to work offline.');
      },
    });
  });
}

void mount();
