import { describe, expect, it } from 'vitest';
import bwip from 'bwip-js/node';
import { PNG } from 'pngjs';
import { buildBwipOptions, defaultOptionString } from '../src/barcode/options';
import { defaultState } from '../src/state';
import {
  decodeExtra,
  EXTRA_FORMATS,
  HINT_ONLY_FORMATS,
  lumaFromRgba,
  type Luma,
} from '../src/scan/extra';
import { decodeImbStates } from '../src/scan/extra/postal';

const base = defaultState().barcode;
const sample = (bcid: string) => bwip.symbolList.find((s) => s.bcid === bcid)!;

async function render(
  bcid: string,
  text: string,
  scale: number,
  includetext = true,
  extra = '',
): Promise<Luma> {
  const sym = sample(bcid);
  const opts = buildBwipOptions(
    { ...base, bcid, includetext },
    text,
    { x: scale, y: scale },
    12,
    `${defaultOptionString(sym.opts)} ${extra}`.trim(),
  );
  const png = PNG.sync.read(await bwip.toBuffer(opts as never));
  return lumaFromRgba(png.data, png.width, png.height);
}

function rotate90(l: Luma): Luma {
  const out = new Uint8Array(l.width * l.height);
  for (let y = 0; y < l.height; y++)
    for (let x = 0; x < l.width; x++)
      out[x * l.height + (l.height - 1 - y)] = l.data[y * l.width + x];
  return { data: out, width: l.height, height: l.width };
}

function rotate180(l: Luma): Luma {
  return { ...l, data: Uint8Array.from(l.data).reverse() };
}

/** Soften edges and add noise, like a phone photo of a print. */
function rough(l: Luma, seed = 7): Luma {
  const out = new Uint8Array(l.data.length);
  let s = seed;
  const rnd = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff - 0.5) * 30;
  for (let y = 0; y < l.height; y++) {
    for (let x = 0; x < l.width; x++) {
      let sum = 0;
      let n = 0;
      for (let dx = -1; dx <= 1; dx++) {
        const xx = Math.min(l.width - 1, Math.max(0, x + dx));
        sum += l.data[y * l.width + xx];
        n++;
      }
      out[y * l.width + x] = Math.max(0, Math.min(255, sum / n + rnd()));
    }
  }
  return { data: out, width: l.width, height: l.height };
}

// Sample data that differs from bwip's examples where those are odd lengths etc.
const DATA: Record<string, string> = {
  industrial2of5: '0123456789',
  symbol: 'fimc',
};

describe('the app’s own decoders read every format they claim', () => {
  const ids = [...EXTRA_FORMATS];
  it.each(ids)('%s', async (bcid) => {
    const text = DATA[bcid] ?? sample(bcid).text;
    for (const scale of [2, 3]) {
      for (const withText of [true, false]) {
        const r = decodeExtra(bwip, await render(bcid, text, scale, withText));
        expect(r, `${bcid} scale ${scale} text ${withText}`).not.toBeNull();
        expect(r!.text).toBe(text);
        expect(r!.bcid === bcid || (bcid === 'industrial2of5' && r!.bcid === 'code2of5')).toBe(
          true,
        );
      }
    }
  });

  it.each(HINT_ONLY_FORMATS)('%s when picked in the scanner', async (bcid) => {
    const text = sample(bcid).text;
    const r = decodeExtra(bwip, await render(bcid, text, 3), { only: bcid });
    expect(r?.text).toBe(text);
  });
});

describe('robustness', () => {
  it.each([
    'msi',
    'code11',
    'plessey',
    'code2of5',
    'channelcode',
    'onecode',
    'royalmail',
    'postnet',
  ])('%s rotated 90° and 180°', async (bcid) => {
    const text = sample(bcid).text;
    const img = await render(bcid, text, 3);
    expect(decodeExtra(bwip, rotate90(img))?.text).toBe(text);
    expect(decodeExtra(bwip, rotate180(img))?.text).toBe(text);
  });

  it.each(['msi', 'code11', 'matrix2of5', 'datalogic2of5', 'bc412', 'onecode', 'auspost'])(
    '%s with blur and noise',
    async (bcid) => {
      const text = sample(bcid).text;
      expect(decodeExtra(bwip, rough(await render(bcid, text, 4)))?.text).toBe(text);
    },
  );

  it('reads every USPS Intelligent Mail routing length', async () => {
    for (const text of [
      '01234567094987654321',
      '0123456709498765432101234',
      '01234567094987654321012345678',
      '0123456709498765432101234567891',
    ]) {
      expect(decodeExtra(bwip, await render('onecode', text, 3))?.text).toBe(text);
    }
  });

  it('inverts the IMb encoder for many random values', () => {
    let seed = 1;
    const digit = () => ((seed = (seed * 48271) % 2147483647) % 10).toString();
    for (let n = 0; n < 200; n++) {
      let t = '';
      for (let i = 0; i < 20; i++) t += i === 1 ? String(Number(digit()) % 5) : digit();
      for (let i = 0; i < [0, 5, 9, 11][n % 4]; i++) t += digit();
      const r = bwip.raw('onecode', t, '')[0] as { bhs: number[]; bbs: number[] };
      const tops = r.bhs.map((h, i) => h + r.bbs[i]);
      const states = tops
        .map((top: number, i: number) => {
          const asc = top > 0.12;
          const desc = r.bbs[i] < 0.03;
          return asc && desc ? 'F' : asc ? 'A' : desc ? 'D' : 'T';
        })
        .join('');
      expect(decodeImbStates(states)).toBe(t);
    }
  });

  it('reads Channel Code at every channel count', async () => {
    for (const text of ['26', '292', '3493', '044072', '576688', '7742862', '05', '000']) {
      expect(decodeExtra(bwip, await render('channelcode', text, 3))?.text).toBe(text);
    }
  }, 120_000); // drawing large Channel Code values is slow in bwip-js itself

  it('finds nothing in a blank image', () => {
    const blank = { data: new Uint8Array(200 * 100).fill(255), width: 200, height: 100 };
    expect(decodeExtra(bwip, blank)).toBeNull();
  });
});
