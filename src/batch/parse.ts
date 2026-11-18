import Papa from 'papaparse';
import { safeFilename } from '../export/files';

export interface BatchTable {
  columns: string[];
  rows: string[][];
}

export interface BatchItem {
  row: number; // 1-based, as shown to people
  data: string;
  name: string;
}

/** Parse pasted text or a CSV/TSV file. One value per line also works. */
export function parseTable(raw: string, hasHeader: boolean): BatchTable {
  const text = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw;
  if (!text.trim()) return { columns: [], rows: [] };
  const result = Papa.parse<string[]>(text, { skipEmptyLines: 'greedy', delimiter: '' });
  const all = result.data.map((r) => r.map((c) => String(c ?? '')));
  const width = Math.max(0, ...all.map((r) => r.length));
  let columns: string[];
  let rows: string[][];
  if (hasHeader && all.length) {
    columns = Array.from({ length: width }, (_, i) => (all[0][i] ?? '').trim() || String(i + 1));
    rows = all.slice(1);
  } else {
    columns = Array.from({ length: width }, (_, i) => String(i + 1));
    rows = all;
  }
  return { columns, rows };
}

/** Replace {column}, {1} (1-based column number) and {row} in a template. */
export function fillTemplate(
  template: string,
  columns: string[],
  row: string[],
  rowNumber: number,
): string {
  return template.replace(/\{([^{}]+)\}/g, (match, key: string) => {
    const k = key.trim();
    if (k === 'row') return String(rowNumber);
    const named = columns.indexOf(k);
    if (named !== -1) return row[named] ?? '';
    if (/^\d+$/.test(k)) return row[Number(k) - 1] ?? '';
    return match;
  });
}

export function batchItems(
  table: BatchTable,
  dataTemplate: string,
  nameTemplate: string,
): BatchItem[] {
  const seen = new Map<string, number>();
  return table.rows.map((row, i) => {
    const rowNumber = i + 1;
    const data = fillTemplate(dataTemplate, table.columns, row, rowNumber);
    let name = safeFilename(
      fillTemplate(nameTemplate || '{row}', table.columns, row, rowNumber),
      `code-${rowNumber}`,
    );
    const count = seen.get(name.toLowerCase()) ?? 0;
    seen.set(name.toLowerCase(), count + 1);
    if (count) name = `${name}-${count + 1}`;
    return { row: rowNumber, data, name };
  });
}

/** A sensible template when the column list changes. */
export function suggestTemplates(columns: string[]): { data: string; name: string } {
  const lower = columns.map((c) => c.toLowerCase());
  const pick = (...names: string[]) => {
    const i = lower.findIndex((c) => names.includes(c));
    return i === -1 ? null : columns[i];
  };
  const data =
    pick('url', 'link', 'data', 'value', 'code', 'barcode', 'sku', 'text') ?? columns[0] ?? '1';
  const name = pick('name', 'filename', 'file', 'id', 'title', 'label') ?? 'row';
  return { data: `{${data}}`, name: `{${name}}` };
}

export function toCsv(rows: string[][]): string {
  return Papa.unparse(rows);
}
