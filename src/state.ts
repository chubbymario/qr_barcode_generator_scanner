import { CONTENT_TYPES, type ContentType, type Fields } from './qr/content';
import type {
  CornerDotType,
  CornerSquareType,
  DotType,
  ErrorCorrectionLevel,
  ShapeType,
} from 'qr-code-styling';

export type Tab = 'qr' | 'barcode' | 'batch' | 'print' | 'scan';
export type Theme = 'system' | 'light' | 'dark';
export type ExportFormat = 'png' | 'svg' | 'jpeg' | 'webp' | 'pdf';
export type SizeUnit = 'mm' | 'in' | 'px';

export interface Paint {
  color: string;
  gradient: boolean;
  gradientType: 'linear' | 'radial';
  color2: string;
  rotation: number; // degrees
}

export interface QrSettings {
  contentType: ContentType;
  fields: Record<ContentType, Fields>;
  ecLevel: ErrorCorrectionLevel;
  typeNumber: number; // 0 = automatic
  marginPct: number; // quiet zone as % of image width
  shape: ShapeType;
  dotType: DotType;
  roundSize: boolean;
  dots: Paint;
  cornerSquareType: CornerSquareType | 'none';
  cornerDotType: CornerDotType | 'none';
  cornersMatchDots: boolean;
  cornerSquare: Paint;
  cornerDot: Paint;
  background: Paint;
  transparentBackground: boolean;
  backgroundRound: number; // 0..1
  logo: string | null; // data URL, never leaves the browser
  logoName: string;
  logoSize: number; // 0.1..0.5 of the code area
  logoMargin: number; // px at 1000px output
  hideBackgroundDots: boolean;
}

export interface BarcodeSettings {
  bcid: string;
  texts: Record<string, string>;
  options: Record<string, string>; // per-format advanced options string
  includetext: boolean;
  /** '' keeps the format's own text layout (EAN/UPC split digits, etc.). */
  textxalign: '' | 'center' | 'left' | 'right' | 'justify' | 'offleft' | 'offright';
  textyalign: '' | 'below' | 'above' | 'center';
  textsize: number; // 0 = format default
  textfont: string;
  barcolor: string;
  textcolor: string;
  backgroundcolor: string;
  transparentBackground: boolean;
  heightMm: number; // bar height for linear symbols
  rotate: 'N' | 'R' | 'L' | 'I';
  paddingModules: number;
  showborder: boolean;
}

export interface ExportSettings {
  format: ExportFormat;
  unit: SizeUnit;
  size: number; // width in `unit`
  dpi: number;
  crisp: boolean; // barcodes: snap modules to whole pixels
  filename: string;
  jpegQuality: number;
}

export interface LabelGeometry {
  pageWidth: number; // mm
  pageHeight: number;
  columns: number;
  rows: number;
  labelWidth: number;
  labelHeight: number;
  marginTop: number;
  marginLeft: number;
  gapX: number;
  gapY: number;
}

export interface PrintSettings {
  preset: string;
  custom: LabelGeometry;
  source: 'qr' | 'barcode' | 'batch';
  copies: number;
  offsetX: number; // printer alignment nudge, mm
  offsetY: number;
  startAt: number; // skip already-used labels on a partial sheet
  codeSizePct: number; // code size relative to the label's short side
  caption: 'none' | 'data' | 'custom';
  captionText: string;
  captionSize: number; // pt
  outlines: boolean;
  dpi: number;
}

export interface BatchSettings {
  kind: 'qr' | 'barcode';
  hasHeader: boolean;
  dataTemplate: string;
  nameTemplate: string;
  format: Exclude<ExportFormat, 'pdf'> | 'pdf-pages';
  raw: string;
}

export interface ScanRecord {
  text: string;
  label: string;
  bcid?: string;
  at: number; // ms since epoch
}

export interface ScanSettings {
  source: 'camera' | 'image';
  lookFor: string; // 'auto' | 'standard' | a bwip-js id
  continuous: boolean;
  feedback: boolean;
  deviceId: string;
  keepHistory: boolean;
  history: ScanRecord[];
}

export interface AppState {
  tab: Tab;
  theme: Theme;
  qr: QrSettings;
  barcode: BarcodeSettings;
  export: ExportSettings;
  print: PrintSettings;
  batch: BatchSettings;
  scan: ScanSettings;
}

const ink = '#1b2a41';

const paint = (color: string, color2 = '#2a6f97'): Paint => ({
  color,
  gradient: false,
  gradientType: 'linear',
  color2,
  rotation: 45,
});

export function defaultState(): AppState {
  const fields = Object.fromEntries(
    CONTENT_TYPES.map((c) => [c.type, { ...c.defaults }]),
  ) as Record<ContentType, Fields>;
  return {
    tab: 'qr',
    theme: 'system',
    qr: {
      contentType: 'url',
      fields,
      ecLevel: 'M',
      typeNumber: 0,
      marginPct: 6,
      shape: 'square',
      dotType: 'square',
      roundSize: true,
      dots: paint(ink),
      cornerSquareType: 'none',
      cornerDotType: 'none',
      cornersMatchDots: true,
      cornerSquare: paint(ink),
      cornerDot: paint(ink),
      background: paint('#ffffff', '#e6ebee'),
      transparentBackground: false,
      backgroundRound: 0,
      logo: null,
      logoName: '',
      logoSize: 0.3,
      logoMargin: 8,
      hideBackgroundDots: true,
    },
    barcode: {
      bcid: 'code128',
      texts: {},
      options: {},
      includetext: true,
      textxalign: '',
      textyalign: '',
      textsize: 0,
      textfont: '',
      barcolor: '#000000',
      textcolor: '#000000',
      backgroundcolor: '#ffffff',
      transparentBackground: false,
      heightMm: 15,
      rotate: 'N',
      paddingModules: 10,
      showborder: false,
    },
    export: {
      format: 'png',
      unit: 'mm',
      size: 40,
      dpi: 300,
      crisp: true,
      filename: '',
      jpegQuality: 0.92,
    },
    print: {
      preset: 'avery-l7160',
      custom: {
        pageWidth: 210,
        pageHeight: 297,
        columns: 3,
        rows: 7,
        labelWidth: 63.5,
        labelHeight: 38.1,
        marginTop: 15.15,
        marginLeft: 7.2,
        gapX: 2.5,
        gapY: 0,
      },
      source: 'qr',
      copies: 21,
      offsetX: 0,
      offsetY: 0,
      startAt: 1,
      codeSizePct: 80,
      caption: 'none',
      captionText: '',
      captionSize: 8,
      outlines: true,
      dpi: 300,
    },
    batch: {
      kind: 'qr',
      hasHeader: true,
      dataTemplate: '{url}',
      nameTemplate: '{name}',
      format: 'png',
      raw: 'name,url\nhome,https://example.com\nshop,https://example.com/shop\nblog,https://example.com/blog\n',
    },
    scan: {
      source: 'camera',
      lookFor: 'auto',
      continuous: false,
      feedback: true,
      deviceId: '',
      keepHistory: true,
      history: [],
    },
  };
}

// ---------- merging, persistence and share links ----------

type Plain = Record<string, unknown>;
const isPlain = (v: unknown): v is Plain =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** Overlay `patch` onto `base`, keeping only keys whose types match the base. */
export function mergeDeep<T>(base: T, patch: unknown): T {
  if (!isPlain(base) || !isPlain(patch)) return base;
  const out: Plain = { ...base };
  for (const [k, v] of Object.entries(patch)) {
    const cur = (base as Plain)[k];
    if (cur === undefined) {
      // Open-ended maps (fields, texts, options) accept new keys.
      out[k] = v;
    } else if (isPlain(cur) && isPlain(v)) {
      out[k] = mergeDeep(cur, v);
    } else if (cur === null || v === null || typeof cur === typeof v) {
      out[k] = v;
    }
  }
  return out as T;
}

const STORAGE_KEY = 'qr-barcode-studio:v1';

export function loadState(): AppState {
  let state = defaultState();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) state = mergeDeep(state, JSON.parse(raw));
  } catch {
    /* storage unavailable or corrupt: start fresh */
  }
  const shared = readShareHash(location.hash);
  if (shared) state = mergeDeep(state, shared);
  return state;
}

export function saveState(state: AppState): boolean {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    return true;
  } catch {
    // Most likely the logo is too big for storage. Save everything else.
    try {
      const slim = { ...state, qr: { ...state.qr, logo: null } };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(slim));
    } catch {
      /* ignore */
    }
    return false;
  }
}

export function clearSavedState(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

function toBase64Url(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  bytes.forEach((byte) => (bin += String.fromCharCode(byte)));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(text: string): string {
  const b64 = text.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

/** Settings for a share link. The logo is left out: links would get huge. */
export function shareSnapshot(state: AppState): Partial<AppState> {
  const { logo: _logo, logoName: _name, fields, ...qrRest } = state.qr;
  const bc = state.barcode;
  return {
    tab: state.tab === 'barcode' ? 'barcode' : 'qr',
    qr: {
      ...qrRest,
      fields: { [state.qr.contentType]: fields[state.qr.contentType] },
    } as unknown as QrSettings,
    barcode: {
      ...bc,
      texts: { [bc.bcid]: bc.texts[bc.bcid] ?? '' },
      options: bc.options[bc.bcid] !== undefined ? { [bc.bcid]: bc.options[bc.bcid] } : {},
    },
    export: state.export,
  };
}

export function buildShareUrl(state: AppState): string {
  const url = new URL(location.href);
  url.hash = `s=${toBase64Url(JSON.stringify(shareSnapshot(state)))}`;
  return url.toString();
}

export function readShareHash(hash: string): unknown {
  const m = /^#s=([A-Za-z0-9_-]+)$/.exec(hash);
  if (!m) return null;
  try {
    return JSON.parse(fromBase64Url(m[1]));
  } catch {
    return null;
  }
}

export { toBase64Url, fromBase64Url };
