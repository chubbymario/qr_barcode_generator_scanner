// Speed and false-positive guards for the app's own decoders on camera-sized
// frames (1280x720) with a noisy background. Budgets are generous so slow CI
// machines pass; a real regression (e.g. 10x slower) still fails.
import { describe, expect, it } from 'vitest';
import bwip from 'bwip-js/node';
import { PNG } from 'pngjs';
import {
  collectCca,
  collectStacked,
  decodeExtra,
  lumaFromRgba,
  type Luma,
} from '../src/scan/extra';

const W = 1280;
const H = 720;

function frame(png: PNG | null, seed = 3): Luma {
  const data = new Uint8Array(W * H);
  let s = seed;
  for (let i = 0; i < data.length; i++)
    data[i] = 150 + (((s = (s * 1103515245 + 12345) & 0x7fffffff) >> 16) % 60);
  if (png) {
    const l = lumaFromRgba(png.data, png.width, png.height);
    const ox = (W - l.width) >> 1;
    const oy = (H - l.height) >> 1;
    for (let y = 0; y < l.height; y++)
      for (let x = 0; x < l.width; x++) data[(oy + y) * W + ox + x] = l.data[y * l.width + x];
  }
  return { data, width: W, height: H };
}

function ms(f: () => unknown, runs = 3): number {
  f();
  const t = performance.now();
  for (let i = 0; i < runs; i++) f();
  return (performance.now() - t) / runs;
}

async function render(bcid: string, text: string, opts: Record<string, unknown> = {}) {
  return PNG.sync.read(
    await bwip.toBuffer({
      bcid,
      text,
      scale: 3,
      padding: 10,
      backgroundcolor: 'FFFFFF',
      ...opts,
    } as never),
  );
}

describe('camera-frame performance', () => {
  it('finds nothing in noise, quickly', () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const f = frame(null, seed);
      expect(decodeExtra(bwip, f, { lines: 14 })).toBeNull();
      expect(collectCca(f)).toEqual([]);
      expect(collectStacked(f)).toBeNull();
    }
    expect(ms(() => decodeExtra(bwip, frame(null), { lines: 14 }))).toBeLessThan(150);
  });

  it.each([
    ['code16k', 'Abcd-1234567890-wxyZ', {}],
    ['code49', 'MULTIPLE ROWS IN CODE 49', {}],
    ['codablockf', 'CODABLOCK F 34567890123456789010040digit', { columns: 8 }],
    ['onecode', '01234567094987654321012345678', {}],
    ['msi', '0123456789', { includecheck: true }],
    ['posicode', 'ABC123', { version: 'b' }],
  ] as const)('%s on a noisy frame', async (bcid, text, opts) => {
    const f = frame(await render(bcid, text, opts));
    expect(decodeExtra(bwip, f, { lines: 14 })?.text).toBe(text);
    expect(ms(() => decodeExtra(bwip, f, { lines: 14 }))).toBeLessThan(250);
  });

  it('looks for a composite 2D part quickly', async () => {
    const f = frame(await render('ean13composite', '9520123456788|(99)1234-abcd'));
    expect(collectCca(f).length).toBe(1);
    expect(ms(() => collectCca(f))).toBeLessThan(60);
  });
});
