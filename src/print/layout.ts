import type { LabelGeometry } from '../state';

export interface Preset {
  id: string;
  name: string;
  geometry: LabelGeometry;
}

const A4 = { pageWidth: 210, pageHeight: 297 };
const LETTER = { pageWidth: 215.9, pageHeight: 279.4 };
const IN = 25.4;

// Measurements from the manufacturers' published templates. Printers vary, so
// print one sheet on plain paper and hold it against a label sheet first.
export const PRESETS: Preset[] = [
  {
    id: 'avery-l7160',
    name: 'Avery L7160 (A4, 21 per sheet, 63.5 × 38.1 mm)',
    geometry: {
      ...A4,
      columns: 3,
      rows: 7,
      labelWidth: 63.5,
      labelHeight: 38.1,
      marginTop: 15.15,
      marginLeft: 7.2,
      gapX: 2.5,
      gapY: 0,
    },
  },
  {
    id: 'avery-l7163',
    name: 'Avery L7163 (A4, 14 per sheet, 99.1 × 38.1 mm)',
    geometry: {
      ...A4,
      columns: 2,
      rows: 7,
      labelWidth: 99.1,
      labelHeight: 38.1,
      marginTop: 15.15,
      marginLeft: 4.65,
      gapX: 2.5,
      gapY: 0,
    },
  },
  {
    id: 'avery-l7165',
    name: 'Avery L7165 (A4, 8 per sheet, 99.1 × 67.7 mm)',
    geometry: {
      ...A4,
      columns: 2,
      rows: 4,
      labelWidth: 99.1,
      labelHeight: 67.7,
      marginTop: 13.1,
      marginLeft: 4.65,
      gapX: 2.5,
      gapY: 0,
    },
  },
  {
    id: 'avery-l7651',
    name: 'Avery L7651 (A4, 65 per sheet, 38.1 × 21.2 mm)',
    geometry: {
      ...A4,
      columns: 5,
      rows: 13,
      labelWidth: 38.1,
      labelHeight: 21.2,
      marginTop: 10.7,
      marginLeft: 4.75,
      gapX: 2.5,
      gapY: 0,
    },
  },
  {
    id: 'avery-5160',
    name: 'Avery 5160 (Letter, 30 per sheet, 2⅝ × 1 in)',
    geometry: {
      ...LETTER,
      columns: 3,
      rows: 10,
      labelWidth: 2.625 * IN,
      labelHeight: 1 * IN,
      marginTop: 0.5 * IN,
      marginLeft: 0.1875 * IN,
      gapX: 0.125 * IN,
      gapY: 0,
    },
  },
  {
    id: 'avery-5163',
    name: 'Avery 5163 (Letter, 10 per sheet, 4 × 2 in)',
    geometry: {
      ...LETTER,
      columns: 2,
      rows: 5,
      labelWidth: 4 * IN,
      labelHeight: 2 * IN,
      marginTop: 0.5 * IN,
      marginLeft: 0.15625 * IN,
      gapX: 0.1875 * IN,
      gapY: 0,
    },
  },
  {
    id: 'avery-5167',
    name: 'Avery 5167 (Letter, 80 per sheet, 1¾ × ½ in)',
    geometry: {
      ...LETTER,
      columns: 4,
      rows: 20,
      labelWidth: 1.75 * IN,
      labelHeight: 0.5 * IN,
      marginTop: 0.5 * IN,
      marginLeft: 0.3 * IN,
      gapX: 0.3125 * IN,
      gapY: 0,
    },
  },
  {
    id: 'a4-grid',
    name: 'Plain A4, 4 × 6 grid',
    geometry: {
      ...A4,
      columns: 4,
      rows: 6,
      labelWidth: 45,
      labelHeight: 45,
      marginTop: 13.5,
      marginLeft: 10,
      gapX: 2.5,
      gapY: 0,
    },
  },
  {
    id: 'letter-grid',
    name: 'Plain Letter, 4 × 5 grid',
    geometry: {
      ...LETTER,
      columns: 4,
      rows: 5,
      labelWidth: 1.875 * IN,
      labelHeight: 1.875 * IN,
      marginTop: 0.5 * IN,
      marginLeft: 0.25 * IN,
      gapX: 0.125 * IN,
      gapY: 0.125 * IN,
    },
  },
  {
    id: 'a4-one',
    name: 'One per A4 page',
    geometry: {
      ...A4,
      columns: 1,
      rows: 1,
      labelWidth: 190,
      labelHeight: 277,
      marginTop: 10,
      marginLeft: 10,
      gapX: 0,
      gapY: 0,
    },
  },
  {
    id: 'letter-one',
    name: 'One per Letter page',
    geometry: {
      ...LETTER,
      columns: 1,
      rows: 1,
      labelWidth: 7.5 * IN,
      labelHeight: 10 * IN,
      marginTop: 0.5 * IN,
      marginLeft: 0.5 * IN,
      gapX: 0,
      gapY: 0,
    },
  },
];

export function geometryFor(preset: string, custom: LabelGeometry): LabelGeometry {
  return PRESETS.find((p) => p.id === preset)?.geometry ?? custom;
}

export interface Cell {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Label rectangles on one page, left to right then top to bottom. */
export function cells(g: LabelGeometry, offsetX = 0, offsetY = 0): Cell[] {
  const out: Cell[] = [];
  for (let r = 0; r < g.rows; r++) {
    for (let c = 0; c < g.columns; c++) {
      out.push({
        x: g.marginLeft + offsetX + c * (g.labelWidth + g.gapX),
        y: g.marginTop + offsetY + r * (g.labelHeight + g.gapY),
        w: g.labelWidth,
        h: g.labelHeight,
      });
    }
  }
  return out;
}

/** Problems a person should fix before printing. Empty when the layout fits. */
export function checkGeometry(g: LabelGeometry): string[] {
  const issues: string[] = [];
  const right = g.marginLeft + g.columns * g.labelWidth + (g.columns - 1) * g.gapX;
  const bottom = g.marginTop + g.rows * g.labelHeight + (g.rows - 1) * g.gapY;
  if (g.columns < 1 || g.rows < 1) issues.push('Use at least one row and one column.');
  if (right > g.pageWidth + 0.01)
    issues.push(`Labels run ${(right - g.pageWidth).toFixed(1)} mm past the right edge.`);
  if (bottom > g.pageHeight + 0.01)
    issues.push(`Labels run ${(bottom - g.pageHeight).toFixed(1)} mm past the bottom edge.`);
  return issues;
}

export interface Placement<T> {
  page: number;
  cell: Cell;
  item: T;
}

/** Spread items across pages, skipping `skip` labels already used on the first sheet. */
export function paginate<T>(
  items: T[],
  perPage: number,
  skip: number,
): { pages: number; placements: { page: number; index: number; item: T }[] } {
  const placements: { page: number; index: number; item: T }[] = [];
  const offset = Math.max(0, Math.min(skip, perPage - 1));
  items.forEach((item, i) => {
    const slot = i + offset;
    placements.push({ page: Math.floor(slot / perPage), index: slot % perPage, item });
  });
  const pages = placements.length ? placements[placements.length - 1].page + 1 : 0;
  return { pages, placements };
}

/** Where the code and caption go inside a label. */
export function fitInLabel(
  cell: Cell,
  aspect: number, // width / height of the code image
  sizePct: number,
  captionMm: number,
): { code: Cell; caption: Cell | null } {
  const pad = Math.min(cell.w, cell.h) * ((100 - sizePct) / 200);
  const availW = cell.w - pad * 2;
  const availH = cell.h - pad * 2 - captionMm;
  let w = availW;
  let h = w / aspect;
  if (h > availH) {
    h = Math.max(0, availH);
    w = h * aspect;
  }
  const blockH = h + captionMm;
  const top = cell.y + (cell.h - blockH) / 2;
  const code = { x: cell.x + (cell.w - w) / 2, y: top, w, h };
  const caption =
    captionMm > 0 ? { x: cell.x + pad, y: top + h, w: cell.w - pad * 2, h: captionMm } : null;
  return { code, caption };
}

export const PT_TO_MM = 25.4 / 72;
