import { describe, expect, it } from 'vitest';
import { buildBwipOptions, defaultOptionString } from '../src/barcode/options';
import { buildPayload } from '../src/qr/content';
import { defaultState } from '../src/state';
import { decodePng, renderPng } from './decode';
import type { ReadInputBarcodeFormat } from 'zxing-wasm/reader';

const base = defaultState().barcode;

/** Try a few print sizes, like a phone seeing a code from different distances. Every size must scan. */
async function roundTrip(
  bcid: string,
  text: string,
  advanced = '',
  formats?: ReadInputBarcodeFormat[],
) {
  const seen = new Set<string>();
  for (const scale of [2, 3, 5]) {
    const opts = buildBwipOptions({ ...base, bcid }, text, { x: scale, y: scale }, 12, advanced);
    seen.add(await decodePng(await renderPng(opts), formats));
  }
  expect(seen.size).toBe(1);
  return [...seen][0];
}

describe('generated codes scan back', () => {
  it('QR code with plain text', async () => {
    expect(await roundTrip('qrcode', 'Hello, scanner!', 'eclevel=M', ['QRCode'])).toBe(
      'Hello, scanner!',
    );
  });

  it.each([
    ['url', { url: 'example.com/path?q=1' }],
    ['wifi', { ssid: 'Cafe; "Guest"', security: 'WPA', password: 'p@ss:word,1', hidden: true }],
    [
      'vcard',
      {
        firstName: 'Mei',
        lastName: 'Lim',
        org: 'Acme, Inc.',
        mobile: '+65 9123 4567',
        email: 'mei@example.com',
      },
    ],
    ['email', { to: 'hi@example.com', subject: 'Hello there', body: 'Line 1\nLine 2' }],
    ['sms', { number: '+65 9123 4567', message: 'On my way', format: 'smsto' }],
    ['geo', { lat: '1.2834', lng: '103.8607', label: 'Marina Bay', format: 'geo' }],
    [
      'event',
      { title: 'Lunch', start: '2026-12-01T12:30', end: '2026-12-01T13:30', location: 'Level 3' },
    ],
  ] as const)('QR content type %s survives encoding', async (type, fields) => {
    const payload = buildPayload(type, fields);
    expect(await roundTrip('qrcode', payload, 'eclevel=M', ['QRCode'])).toBe(payload);
  });

  it('Data Matrix', async () => {
    expect(await roundTrip('datamatrix', 'SN-000123/LOT-77', '', ['DataMatrix'])).toBe(
      'SN-000123/LOT-77',
    );
  });

  it('Code 128', async () => {
    expect(await roundTrip('code128', 'Count01234567!', '', ['Code128'])).toBe('Count01234567!');
  });

  it('EAN-13 adds the check digit to 12 digits', async () => {
    expect(
      await roundTrip('ean13', '952012345678', defaultOptionString('includetext guardwhitespace'), [
        'EAN13',
      ]),
    ).toBe('9520123456788');
  });

  it('UPC-A', async () => {
    // UPC-A is a subset of EAN-13; decoders may report it with a leading zero.
    expect(await roundTrip('upca', '01234500005', '', ['UPCA'])).toMatch(/^0?012345000058$/);
  });

  it('Code 39', async () => {
    expect(await roundTrip('code39', 'ABC-123', '', ['Code39'])).toBe('ABC-123');
  });

  it('ITF-14', async () => {
    expect(await roundTrip('itf14', '1540014128876', '', ['ITF'])).toBe('15400141288763');
  });

  it('PDF417', async () => {
    expect(await roundTrip('pdf417', 'Shipping label 42', 'columns=3', ['PDF417'])).toBe(
      'Shipping label 42',
    );
  });

  it('Aztec', async () => {
    expect(await roundTrip('azteccode', 'Boarding pass', 'format=full', ['Aztec'])).toBe(
      'Boarding pass',
    );
  });

  it('respects colours and transparent backgrounds', async () => {
    const opts = buildBwipOptions(
      { ...base, bcid: 'qrcode', barcolor: '#1b2a41', transparentBackground: true },
      'colour test',
      { x: 4, y: 4 },
      null,
      '',
    );
    expect(opts.backgroundcolor).toBeUndefined();
    expect(await decodePng(await renderPng(opts), ['QRCode'])).toBe('colour test');
  });
});
