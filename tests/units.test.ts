import { describe, expect, it } from 'vitest';
import { PNG } from 'pngjs';
import {
  barHeightParam,
  buildBwipOptions,
  defaultOptionString,
  explainBwipError,
  parseOptionString,
} from '../src/barcode/options';
import { groupSymbols, usesBarHeight } from '../src/barcode/catalog';
import { batchItems, fillTemplate, parseTable, suggestTemplates } from '../src/batch/parse';
import { cells, checkGeometry, fitInLabel, paginate, PRESETS } from '../src/print/layout';
import { readPngDpi, setPngDpi } from '../src/export/png-dpi';
import { toPx, toMm } from '../src/export/size';
import { defaultState, fromBase64Url, mergeDeep, shareSnapshot, toBase64Url } from '../src/state';
import bwip from 'bwip-js/node';

describe('barcode options', () => {
  it('parses option strings', () => {
    expect(
      parseOptionString(' includecheck  version=24x24 eclevel=5 scale=1.5 parse=false '),
    ).toEqual({
      includecheck: true,
      version: '24x24',
      eclevel: 5,
      scale: 1.5,
      parse: false,
    });
    expect(parseOptionString('')).toEqual({});
  });

  it('drops includetext from format defaults', () => {
    expect(defaultOptionString('includetext guardwhitespace')).toBe('guardwhitespace');
  });

  it('lets advanced options override UI settings', () => {
    const o = buildBwipOptions(
      { ...defaultState().barcode, bcid: 'code128' },
      'X',
      { x: 1, y: 1 },
      10,
      'barcolor=FF0000',
    );
    expect(o.barcolor).toBe('FF0000');
    expect(o.height).toBe(10);
  });

  it('omits height for 2D symbols', () => {
    const o = buildBwipOptions(
      { ...defaultState().barcode, bcid: 'datamatrix' },
      'X',
      { x: 1, y: 1 },
      10,
      '',
    );
    expect(o.height).toBeUndefined();
    expect(usesBarHeight('code128')).toBe(true);
    expect(usesBarHeight('qrcode')).toBe(false);
  });

  it('computes bar height so the printed bars match the requested mm', () => {
    // 15 mm at 300 dpi = 177.2 px. bwip-js: height(mm) * 72/25.4 * scale = px
    const k = 4;
    const h = barHeightParam(15, 300, k);
    expect(h * (72 / 25.4) * k).toBeCloseTo((15 / 25.4) * 300, 5);
  });

  it('turns encoder errors into readable messages', () => {
    expect(
      explainBwipError(new Error('bwipp.ean13badLength: EAN-13 must be 12 or 13 digits')),
    ).toBe('EAN-13 must be 12 or 13 digits');
  });

  it('every bwip-js format renders with its example data', () => {
    const s = defaultState().barcode;
    const failures: string[] = [];
    for (const sym of bwip.symbolList) {
      const o = buildBwipOptions(
        { ...s, bcid: sym.bcid },
        sym.text,
        { x: 1, y: 1 },
        12,
        defaultOptionString(sym.opts),
      );
      try {
        bwip.toSVG(o as never);
      } catch (e) {
        failures.push(`${sym.bcid}: ${(e as Error).message}`);
      }
    }
    expect(failures).toEqual([]);
    expect(bwip.symbolList.length).toBeGreaterThanOrEqual(100);
  });

  it('puts every format in a category', () => {
    const groups = groupSymbols(bwip.symbolList);
    expect(groups.find((g) => g.name === 'Other')).toBeUndefined();
  });
});

describe('batch lists', () => {
  it('parses CSV with headers', () => {
    const t = parseTable('name,url\nhome,"https://a.test/?x=1,2"\n', true);
    expect(t.columns).toEqual(['name', 'url']);
    expect(t.rows).toEqual([['home', 'https://a.test/?x=1,2']]);
  });

  it('parses tab-separated text pasted from a spreadsheet', () => {
    const t = parseTable('sku\tqty\nA1\t3\nB2\t4', true);
    expect(t.columns).toEqual(['sku', 'qty']);
    expect(t.rows.length).toBe(2);
  });

  it('treats one value per line as a single column', () => {
    const t = parseTable('﻿alpha\nbeta\n\ngamma', false);
    expect(t.columns).toEqual(['1']);
    expect(t.rows.map((r) => r[0])).toEqual(['alpha', 'beta', 'gamma']);
  });

  it('fills templates by column name, number and row', () => {
    expect(
      fillTemplate('https://x.test/{id}?r={row}&n={2}&k={missing}', ['id', 'n'], ['7', 'b'], 3),
    ).toBe('https://x.test/7?r=3&n=b&k={missing}');
  });

  it('makes unique, safe file names', () => {
    const items = batchItems(parseTable('name,url\na/b,1\na/b,2\n,3', true), '{url}', '{name}');
    expect(items.map((i) => i.name)).toEqual(['a-b', 'a-b-2', 'code-3']);
  });

  it('suggests templates from column names', () => {
    expect(suggestTemplates(['Title', 'URL'])).toEqual({ data: '{URL}', name: '{Title}' });
  });
});

describe('label sheets', () => {
  it('every preset fits on its page', () => {
    for (const p of PRESETS) expect(checkGeometry(p.geometry), p.id).toEqual([]);
  });

  it('flags layouts that run off the page', () => {
    const g = { ...PRESETS[0].geometry, columns: 4 };
    expect(checkGeometry(g)[0]).toMatch(/right edge/);
  });

  it('lays labels out left to right, top to bottom', () => {
    const c = cells(PRESETS[0].geometry);
    expect(c.length).toBe(21);
    expect(c[1].x).toBeGreaterThan(c[0].x);
    expect(c[3].y).toBeGreaterThan(c[0].y);
  });

  it('skips used labels on the first sheet', () => {
    const { pages, placements } = paginate([1, 2, 3], 2, 1);
    expect(pages).toBe(2);
    expect(placements.map((p) => [p.page, p.index])).toEqual([
      [0, 1],
      [1, 0],
      [1, 1],
    ]);
  });

  it('keeps codes inside the label with room for a caption', () => {
    const cell = { x: 0, y: 0, w: 60, h: 30 };
    const { code, caption } = fitInLabel(cell, 1, 100, 4);
    expect(code.w).toBeCloseTo(26);
    expect(code.y + code.h + 4).toBeLessThanOrEqual(30.0001);
    expect(caption?.y).toBeCloseTo(code.y + code.h);
  });
});

describe('export helpers', () => {
  it('converts sizes', () => {
    expect(toPx(25.4, 'mm', 300)).toBe(300);
    expect(toPx(1, 'in', 600)).toBe(600);
    expect(toMm(300, 'px', 300)).toBeCloseTo(25.4);
  });

  it('writes DPI into PNGs without breaking them', () => {
    const png = new PNG({ width: 4, height: 4 });
    png.data.fill(255);
    const bytes = new Uint8Array(PNG.sync.write(png));
    const withDpi = setPngDpi(bytes, 300);
    expect(readPngDpi(withDpi)).toBe(300);
    expect(readPngDpi(setPngDpi(withDpi, 600))).toBe(600); // replaces, doesn't duplicate
    expect(PNG.sync.read(Buffer.from(withDpi)).width).toBe(4);
  });
});

describe('settings', () => {
  it('ignores saved values of the wrong type', () => {
    const merged = mergeDeep(defaultState(), {
      qr: { marginPct: 'lots', ecLevel: 'H' },
      nonsense: 1,
    });
    expect(merged.qr.marginPct).toBe(6);
    expect(merged.qr.ecLevel).toBe('H');
  });

  it('share links round-trip and leave the logo out', () => {
    const s = defaultState();
    s.qr.logo = 'data:image/png;base64,AAAA';
    s.qr.fields.text = { text: 'héllo ✓' };
    s.qr.contentType = 'text';
    const encoded = toBase64Url(JSON.stringify(shareSnapshot(s)));
    expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/);
    const back = JSON.parse(fromBase64Url(encoded));
    expect(back.qr.logo).toBeUndefined();
    expect(back.qr.fields.text.text).toBe('héllo ✓');
    expect(mergeDeep(defaultState(), back).qr.contentType).toBe('text');
  });
});
