import { describe, expect, it } from 'vitest';
import bwip from 'bwip-js/node';
import { PNG } from 'pngjs';
import { lumaFromRgba } from '../src/scan/extra';
import { collectCca, decodeCca } from '../src/scan/extra/cca';
import { decodeCompositeBits } from '../src/scan/gs1cc';
import { decodeAll } from './decode';

const CONTENT = [
  '(99)1234-abcd', // bwip-js example: ISO 646 lowercase
  '(01)09521234543213(3103)000123',
  '(10)ABC123', // method 10 without a date
  '(11)990102(10)LOT1', // method 10 with AI 11
  '(17)261231', // method 10, AI 17 only
  '(17)010200(10)ABCD1234(21)XYZ',
  '(21)abcdefghijklmnopq',
  '(90)1A1234', // method 11, numeric remainder
  '(90)12BX7Z9(21)123', // method 11, AI 21 follows
  '(90)ABCDEF', // method 11, alpha
  '(90)3Ka/b(8004)952123456789012', // method 11, alphanumeric + AI 8004
  '(240)XYZ(250)SER-1.2/3',
  '(420)12345(421)12345678',
  '(7003)2612311230(8020)ABC',
  '(00)095287654321012346(02)09521234543213(37)24',
];

async function png(bcid: string, text: string, opts: Record<string, string | number>) {
  return bwip.toBuffer({
    bcid,
    text,
    scale: 3,
    padding: 10,
    backgroundcolor: 'FFFFFF',
    ...opts,
  } as never);
}

describe('CC-B and CC-C through zxing-cpp', () => {
  for (const ccversion of ['b', 'c']) {
    it.each(CONTENT)(`CC-${ccversion.toUpperCase()} %s`, async (text) => {
      let buf: Buffer;
      try {
        buf = await png('gs1-cc', text, { ccversion, cccolumns: 4 });
      } catch {
        return; // too long for this version
      }
      const r = (await decodeAll(buf)).find((x) => /PDF417/.test(x.format));
      if (r) expect(decodeCompositeBits(r.bytes)).toBe(text);
      // zxing-cpp misses some small MicroPDF417 sizes; the app's reader covers CC-B.
      if (ccversion === 'b') {
        const p = PNG.sync.read(buf);
        expect(decodeCca(bwip, collectCca(lumaFromRgba(p.data, p.width, p.height)))).toBe(text);
      } else expect(r, 'zxing-cpp reads CC-C').toBeTruthy();
    });
  }
});

describe('CC-B at every width with the app’s own reader', () => {
  for (const cccolumns of [2, 3, 4]) {
    it.each(CONTENT)(`CC-B, ${cccolumns} columns: %s`, async (text) => {
      let buf: Buffer;
      try {
        buf = await png('gs1-cc', text, { ccversion: 'b', cccolumns });
      } catch {
        return;
      }
      const p = PNG.sync.read(buf);
      expect(decodeCca(bwip, collectCca(lumaFromRgba(p.data, p.width, p.height)))).toBe(text);
    });
  }
});

describe('CC-A with the app’s own reader', () => {
  for (const cccolumns of [2, 3, 4]) {
    it.each(CONTENT)(`CC-A, ${cccolumns} columns: %s`, async (text) => {
      let buf: Buffer;
      try {
        buf = await png('gs1-cc', text, { ccversion: 'a', cccolumns });
      } catch {
        return; // doesn't fit CC-A at this width
      }
      const p = PNG.sync.read(buf);
      const reads = collectCca(lumaFromRgba(p.data, p.width, p.height));
      expect(decodeCca(bwip, reads)).toBe(text);
    });
  }
});

describe('whole composite symbols', () => {
  it.each([
    ['ean13composite', '9520123456788|(99)1234-abcd'],
    ['ean8composite', '95200002|(21)A12345678'],
    ['upcacomposite', '012345000058|(99)1234-abcd'],
    ['upcecomposite', '01234558|(15)021231'],
    ['databaromnicomposite', '(01)09521234543213|(11)990102'],
    ['databarlimitedcomposite', '(01)09521234543213|(21)abcdefghijklmnopq'],
    ['databarexpandedcomposite', '(01)09521234543213(3103)001234|(91)1A2B3'],
    ['gs1-128composite', '(00)095287654321012346|(02)09521234543213(37)24'],
  ])('%s: the 2D part reads back', async (bcid, text) => {
    const cc = text.split('|')[1];
    const buf = await png(bcid, text, {});
    const zx = (await decodeAll(buf)).find((x) => /PDF417/.test(x.format));
    if (zx) {
      expect(decodeCompositeBits(zx.bytes)).toBe(cc); // CC-B or CC-C
    } else {
      const p = PNG.sync.read(buf);
      expect(decodeCca(bwip, collectCca(lumaFromRgba(p.data, p.width, p.height)))).toBe(cc); // CC-A
    }
  });
});
