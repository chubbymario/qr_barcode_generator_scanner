import { describe, expect, it } from 'vitest';
import bwip from 'bwip-js/node';
import { buildBwipOptions, defaultOptionString } from '../src/barcode/options';
import { defaultState } from '../src/state';
import {
  COMPOSITE_FORMATS,
  scanSupport,
  UNSUPPORTED_FORMATS,
  ZXING_FORMATS,
} from '../src/scan/support';
import { PNG } from 'pngjs';
import { collectCca, decodeCca, lumaFromRgba } from '../src/scan/extra';
import { decodeCompositeBits } from '../src/scan/gs1cc';
import { EXTRA_FORMATS, HINT_ONLY_FORMATS } from '../src/scan/extra';
import { decodeAll } from './decode';
import { buildPayload, CONTENT_TYPES } from '../src/qr/content';
import { interpret } from '../src/scan/interpret';

const base = defaultState().barcode;
// Correct reads that print differently from the input: UPC-E expands to its
// UPC-A form, and Codabar keeps the check digit the app adds by default.
const DECODED_AS: Record<string, string> = {
  upce: '012345000058',
  upcecomposite: '012345000058',
  rationalizedCodabar: 'A01234567892B',
};

const norm = (s: string) =>
  s
    .replace(/\^(CR|LF|FNC\d|\d{3})/g, '')
    .replace(/[^A-Za-z0-9]/g, '')
    .toUpperCase();

describe('scanner support list', () => {
  it('puts every one of the 111 formats in exactly one category', () => {
    const lists = [
      ZXING_FORMATS,
      EXTRA_FORMATS,
      HINT_ONLY_FORMATS,
      COMPOSITE_FORMATS,
      Object.keys(UNSUPPORTED_FORMATS),
    ];
    const all = lists.flat();
    expect(new Set(all).size).toBe(all.length); // no duplicates
    const ids = bwip.symbolList.map((s) => s.bcid);
    expect([...all].sort()).toEqual([...ids].sort());
    expect(ids.length).toBe(111);
  });

  it.each(ZXING_FORMATS)('zxing-cpp reads %s', async (bcid) => {
    const sym = bwip.symbolList.find((s) => s.bcid === bcid)!;
    const opts = buildBwipOptions(
      { ...base, bcid },
      sym.text,
      { x: 3, y: 3 },
      12,
      defaultOptionString(sym.opts),
    );
    const results = await decodeAll(await bwip.toBuffer(opts as never));
    expect(results.length, bcid).toBeGreaterThan(0);
    const got = norm(results.map((r) => r.text).join(''));
    const want = norm(DECODED_AS[bcid] ?? sym.text);
    const ok =
      got.includes(want) ||
      want.includes(got) ||
      // ISSN prints as EAN-13 with the 977 prefix and a recalculated check digit.
      (bcid === 'issn' && got.startsWith('977' + want.slice(0, 7)));
    expect(ok, `${bcid}: got ${got}, want ${want}`).toBe(true);
    expect(scanSupport(bcid).level).toBe('zxing');
  });

  it.each(COMPOSITE_FORMATS)('%s: linear part by zxing-cpp, 2D part by the app', async (bcid) => {
    const sym = bwip.symbolList.find((s) => s.bcid === bcid)!;
    const opts = buildBwipOptions(
      { ...base, bcid },
      sym.text,
      { x: 3, y: 3 },
      12,
      defaultOptionString(sym.opts),
    );
    const buf = await bwip.toBuffer(opts as never);
    const results = await decodeAll(buf);
    const [linearText, ccText] = sym.text.includes('|') ? sym.text.split('|') : ['', sym.text];
    if (linearText) {
      const linear = norm(DECODED_AS[bcid] ?? linearText);
      expect(
        results.some((r) => norm(r.text).includes(linear) || linear.includes(norm(r.text))),
      ).toBe(true);
    }
    const zx = results.find((r) => /PDF417/.test(r.format));
    const fromZx = zx ? decodeCompositeBits(zx.bytes) : null;
    const p = PNG.sync.read(buf);
    const cc = fromZx ?? decodeCca(bwip, collectCca(lumaFromRgba(p.data, p.width, p.height)));
    expect(cc).toBe(ccText);
    expect(scanSupport(bcid).level).toBe('composite');
  });
});

describe('reading QR content back', () => {
  const samples: Record<string, Record<string, string | boolean>> = {
    url: { url: 'https://example.com/a?b=1' },
    text: { text: 'Plain words' },
    wifi: { ssid: 'Café; "5G"', security: 'WPA', password: 'p:a;s\\s', hidden: true },
    vcard: {
      firstName: 'Mei',
      lastName: 'Lim',
      org: 'A, B; C',
      mobile: '+65 9123 4567',
      email: 'mei@example.com',
      note: 'two\nlines',
    },
    email: { to: 'a@b.c', subject: 'Hi there', body: 'Line 1\nLine 2' },
    sms: { number: '+6591234567', message: 'On my way', format: 'smsto' },
    phone: { number: '+6591234567' },
    whatsapp: { number: '6591234567', message: 'Hello!' },
    geo: { lat: '1.2834', lng: '103.8607', label: 'Marina Bay', format: 'geo' },
    event: {
      title: 'Lunch',
      start: '2026-12-01T12:30',
      end: '2026-12-01T13:30',
      location: 'Level 3',
      allDay: false,
    },
  };

  it.each(CONTENT_TYPES.map((c) => c.type))('%s comes back as the same type and fields', (type) => {
    const fields = samples[type];
    const back = interpret(buildPayload(type, fields));
    expect(back.type).toBe(type);
    for (const [k, v] of Object.entries(fields)) expect(back.fields[k], `${type}.${k}`).toBe(v);
  });

  it('only offers safe links', () => {
    expect(interpret('javascript:alert(1)').href).toBeUndefined();
    expect(interpret('https://example.com').href).toBe('https://example.com');
  });
});

describe('scanner labels', () => {
  it('every format the app decodes has a readable name', async () => {
    const { EXTRA_LABELS } = await import('../src/scan/formats');
    const { APP_DECODED } = await import('../src/scan/lists');
    for (const id of APP_DECODED) expect(EXTRA_LABELS[id], id).toBeTruthy();
  });
});
