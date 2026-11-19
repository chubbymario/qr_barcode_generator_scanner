// Shared by the scanner tests: zxing-cpp from node_modules and bwip-js's Node
// build in place of the browser loaders, plus image helpers.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import bwip from 'bwip-js/node';
import { PNG } from 'pngjs';
import { prepareZXingModule, readBarcodes, type ReaderOptions } from 'zxing-wasm/reader';
import { buildBwipOptions, defaultOptionString } from '../src/barcode/options';
import { defaultState } from '../src/state';

export function zxingMock() {
  const require = createRequire(import.meta.url);
  const wasm = readFileSync(require.resolve('zxing-wasm/reader/zxing_reader.wasm'));
  let ready: Promise<unknown> | null = null;
  return {
    readWithZxing: async (image: ImageData, opts: Partial<ReaderOptions> = {}) => {
      ready ??= Promise.resolve(
        prepareZXingModule({
          overrides: { wasmBinary: wasm.buffer as ArrayBuffer },
          fireImmediately: true,
        }),
      );
      await ready;
      const { ZXING_DEFAULTS } = await import('../src/scan/zxing-defaults');
      const r = await readBarcodes(image, { ...ZXING_DEFAULTS, ...opts });
      return r.filter((x) => x.isValid && x.text !== '');
    },
  };
}

export const bwipMock = () => ({ loadBwip: async () => ({ default: bwip }) });

export type Img = { data: Uint8ClampedArray; width: number; height: number };

export function fromPng(buf: Buffer, pad = 40): Img {
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

/** Render a format the way the Barcode tab does, with its default options. */
export async function renderFormat(bcid: string, text?: string, scale = 3): Promise<Img> {
  const sym = bwip.symbolList.find((s) => s.bcid === bcid)!;
  const opts = buildBwipOptions(
    { ...defaultState().barcode, bcid },
    text ?? sym.text,
    { x: scale, y: scale },
    12,
    defaultOptionString(sym.opts),
  );
  return fromPng(await bwip.toBuffer(opts as never));
}

export const sampleText = (bcid: string) => bwip.symbolList.find((s) => s.bcid === bcid)!.text;
export const allIds = () => bwip.symbolList.map((s) => s.bcid);

let seed = 7;
const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;

/**
 * Make a clean render look like a phone photo of a screen or label: rotated,
 * resampled (scale < 1 shrinks), blurred, lower contrast, with sensor noise.
 */
export function degrade(
  src: Img,
  o: { angle?: number; scale?: number; blur?: number; noise?: number; contrast?: number } = {},
): Img {
  const { angle = 4, scale = 0.6, blur = 1, noise = 12, contrast = 0.7 } = o;
  const a = (angle * Math.PI) / 180;
  const W = Math.round(src.width * scale + 60);
  const H = Math.round(src.height * scale + 60);
  const grey = new Float32Array(W * H);
  const cx = src.width / 2;
  const cy = src.height / 2;
  const sample = (x: number, y: number) => {
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    let acc = 0;
    for (const [dx, dy, w] of [
      [0, 0, (1 - (x - x0)) * (1 - (y - y0))],
      [1, 0, (x - x0) * (1 - (y - y0))],
      [0, 1, (1 - (x - x0)) * (y - y0)],
      [1, 1, (x - x0) * (y - y0)],
    ]) {
      const px = x0 + dx;
      const py = y0 + dy;
      const v =
        px < 0 || py < 0 || px >= src.width || py >= src.height
          ? 255
          : src.data[(py * src.width + px) * 4];
      acc += v * w;
    }
    return acc;
  };
  // Supersample 2x2 per output pixel, like a camera sensor averaging light.
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      let acc = 0;
      for (const [sx, sy] of [
        [0.25, 0.25],
        [0.75, 0.25],
        [0.25, 0.75],
        [0.75, 0.75],
      ]) {
        const ux = (x + sx - W / 2) / scale;
        const uy = (y + sy - H / 2) / scale;
        acc += sample(
          cx + ux * Math.cos(a) + uy * Math.sin(a),
          cy - ux * Math.sin(a) + uy * Math.cos(a),
        );
      }
      grey[y * W + x] = acc / 4;
    }
  let g = grey;
  for (let pass = 0; pass < blur; pass++) {
    const out = new Float32Array(W * H);
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        let s = 0;
        let n = 0;
        for (let dy = -1; dy <= 1; dy++)
          for (let dx = -1; dx <= 1; dx++) {
            const xx = x + dx;
            const yy = y + dy;
            if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
            s += g[yy * W + xx];
            n++;
          }
        out[y * W + x] = s / n;
      }
    g = out;
  }
  const data = new Uint8ClampedArray(W * H * 4);
  for (let i = 0; i < W * H; i++) {
    const v = 128 + (g[i] - 128) * contrast + (rnd() - 0.5) * noise;
    data[i * 4] = data[i * 4 + 1] = data[i * 4 + 2] = v;
    data[i * 4 + 3] = 255;
  }
  return { data, width: W, height: H };
}
