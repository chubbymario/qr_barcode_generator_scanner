// The scanner as a whole (scanImage): per-format scanning, and no reads from
// things that aren't barcodes, in every mode. Runs zxing-cpp from node_modules
// and bwip-js's Node build in place of the browser loaders.
import { describe, expect, it, vi } from 'vitest';
import bwip from 'bwip-js/node';
import { PNG } from 'pngjs';
import { buildBwipOptions, defaultOptionString } from '../src/barcode/options';
import { defaultState } from '../src/state';

vi.mock('../src/scan/zxing', async () => (await import('./harness')).zxingMock());
vi.mock('../src/barcode/render', async () => (await import('./harness')).bwipMock());

const { scanImage } = await import('../src/scan/engine');
const { SCANNABLE, PICK_ONLY, ZX_TARGETS } = await import('../src/scan/targets');

type Img = { data: Uint8ClampedArray; width: number; height: number };

function fromPng(buf: Buffer, pad = 40): Img {
  const png = PNG.sync.read(buf);
  const width = png.width + pad * 2;
  const height = png.height + pad * 2;
  const data = new Uint8ClampedArray(width * height * 4).fill(255);
  for (let y = 0; y < png.height; y++) {
    for (let x = 0; x < png.width; x++) {
      const s = (y * png.width + x) * 4;
      const d = ((y + pad) * width + x + pad) * 4;
      const a = png.data[s + 3] / 255;
      for (let c = 0; c < 3; c++) data[d + c] = png.data[s + c] * a + 255 * (1 - a);
    }
  }
  return { data, width, height };
}

async function render(bcid: string): Promise<Img> {
  const sym = bwip.symbolList.find((s) => s.bcid === bcid)!;
  const opts = buildBwipOptions(
    { ...defaultState().barcode, bcid },
    sym.text,
    { x: 3, y: 3 },
    12,
    defaultOptionString(sym.opts),
  );
  return fromPng(await bwip.toBuffer(opts as never));
}

const scan = (img: Img, lookFor: string, live = false) =>
  scanImage(img as unknown as ImageData, { lookFor, live });

// ---------- things that aren't barcodes ----------

let seed = 12345;
const rand = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;

function blank(w: number, h: number, v = 255): Img {
  return { data: new Uint8ClampedArray(w * h * 4).fill(v), width: w, height: h };
}
function rect(img: Img, x0: number, y0: number, w: number, h: number, v: number) {
  for (let y = y0; y < Math.min(img.height, y0 + h); y++)
    for (let x = x0; x < Math.min(img.width, x0 + w); x++) {
      const i = (y * img.width + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
    }
}

/** A desktop screenshot: window frames, toolbars and lines of "text". */
function screen(): Img {
  const img = blank(960, 600, 240);
  rect(img, 0, 0, 960, 40, 40); // task bar
  for (let i = 0; i < 12; i++) rect(img, 10 + i * 46, 6, 30, 28, 200); // icons
  rect(img, 60, 70, 600, 480, 255); // window
  rect(img, 60, 70, 600, 30, 90); // title bar
  for (let line = 0; line < 22; line++) {
    let x = 80;
    const y = 120 + line * 19;
    while (x < 620) {
      const word = 8 + Math.floor(rand() * 50);
      // glyph-like strokes
      for (let g = x; g < Math.min(x + word, 640); g += 2 + Math.floor(rand() * 4))
        rect(img, g, y, 1 + Math.floor(rand() * 2), 9 + Math.floor(rand() * 3), 20);
      x += word + 6 + Math.floor(rand() * 6);
    }
  }
  rect(img, 700, 70, 220, 480, 255);
  for (let i = 0; i < 30; i++) rect(img, 710, 80 + i * 15, 200, 1, 160); // list rules
  return img;
}

/** Venetian blinds / a keyboard: evenly repeated bars. */
function stripes(period: number, bar: number): Img {
  const img = blank(800, 400);
  for (let x = 20; x < 780; x += period) rect(img, x, 50, bar, 300, 0);
  return img;
}

/** Random bars of random widths, with quiet zones: the hardest case. */
function randomBars(): Img {
  const img = blank(900, 300);
  let x = 80;
  while (x < 820) {
    const w = 2 + Math.floor(rand() * 10);
    rect(img, x, 60, w, 180, 0);
    x += w + 2 + Math.floor(rand() * 10);
  }
  return img;
}

/** Camera noise over grey. */
function noise(): Img {
  const img = blank(640, 480);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = 90 + rand() * 120;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
  }
  return img;
}

const NOT_BARCODES: [string, () => Img][] = [
  ['a desktop screenshot', screen],
  ['camera noise', noise],
  ['narrow stripes', () => stripes(8, 3)],
  ['wide stripes', () => stripes(24, 10)],
  ['random bars (seed 1)', () => ((seed = 1), randomBars())],
  ['random bars (seed 2)', () => ((seed = 2), randomBars())],
  ['random bars (seed 3)', () => ((seed = 3), randomBars())],
];

describe('no reads from things that are not barcodes', () => {
  it.each(NOT_BARCODES)('"Everything" finds nothing in %s', async (_, make) => {
    const img = make();
    expect(await scan(img, 'auto')).toEqual([]);
    expect(await scan(img, 'auto', true)).toEqual([]);
  });

  // Every format the scanner can be set to, apart from those that by design
  // accept any bar pattern (PICK_ONLY), stays quiet on all of them.
  const picks = [...SCANNABLE].filter((id) => !PICK_ONLY.has(id));
  it.each(picks)('%s finds nothing in any of them', async (bcid) => {
    for (const [name, make] of NOT_BARCODES) {
      const got = await scan(make(), bcid);
      expect(got, `${bcid} on ${name}: ${JSON.stringify(got)}`).toEqual([]);
    }
  });

  it('formats that fit any bar pattern need 3 agreeing camera frames', async () => {
    seed = 1;
    const [r] = await scan(randomBars(), 'pharmacode');
    if (r) expect(r.frames).toBe(3);
  });
});

// ---------- one format at a time ----------

describe('scanning for one format', () => {
  const all = [...SCANNABLE];
  it.each(all)('%s: finds its own code', async (bcid) => {
    const got = await scan(await render(bcid), bcid);
    expect(got.length, bcid).toBeGreaterThan(0);
    expect(got[0].frames).toBeGreaterThanOrEqual(1);
  });

  it('a QR code is invisible to the other format scanners', async () => {
    const img = await render('qrcode');
    for (const bcid of ['code128', 'datamatrix', 'ean13', 'pdf417', 'code16k', 'onecode'])
      expect(await scan(img, bcid), bcid).toEqual([]);
    expect((await scan(img, 'qrcode'))[0].text).toBe(
      bwip.symbolList.find((s) => s.bcid === 'qrcode')!.text,
    );
  });

  it('variant checks: a plain QR code is not a Swiss QR or HIBC QR', async () => {
    const img = await render('qrcode');
    expect(await scan(img, 'swissqrcode')).toEqual([]);
    expect(await scan(img, 'hibcqrcode')).toEqual([]);
  });

  it('a composite pick needs the 2D part', async () => {
    expect(await scan(await render('ean13'), 'ean13composite')).toEqual([]);
    expect((await scan(await render('ean13composite'), 'ean13composite')).length).toBe(1);
  });

  it('"Everything" still reads formats with check digits, and skips the pick-only ones', async () => {
    for (const bcid of ['qrcode', 'code128', 'code16k', 'onecode', 'plessey', 'posicode'])
      expect((await scan(await render(bcid), 'auto')).length, bcid).toBeGreaterThan(0);
    for (const bcid of ['pharmacode', 'kix', 'channelcode', 'symbol'])
      expect(
        (await scan(await render(bcid), 'auto')).filter((r) => r.bcid === bcid),
        bcid,
      ).toEqual([]);
  });

  it('every zxing target lists real zxing-cpp formats', () => {
    for (const t of Object.values(ZX_TARGETS)) expect(t.formats.length).toBeGreaterThan(0);
  });
});
