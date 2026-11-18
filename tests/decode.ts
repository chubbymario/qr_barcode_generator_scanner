// Test helper: render with bwip-js in Node and read the result back with
// zxing-cpp (compiled to WebAssembly), the decoder family most phone scanners use.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import bwip from 'bwip-js/node';
import { PNG } from 'pngjs';
import { prepareZXingModule, readBarcodes, type ReadInputBarcodeFormat } from 'zxing-wasm/reader';

const require = createRequire(import.meta.url);
// Load the decoder from node_modules instead of the default CDN, so tests run offline.
const wasmPath = require.resolve('zxing-wasm/reader/zxing_reader.wasm');
let ready: Promise<unknown> | null = null;
function init() {
  ready ??= Promise.resolve(
    prepareZXingModule({
      overrides: { wasmBinary: readFileSync(wasmPath).buffer as ArrayBuffer },
      fireImmediately: true,
    }),
  );
  return ready;
}

export async function renderPng(options: Record<string, unknown>): Promise<Buffer> {
  return bwip.toBuffer(options as never);
}

/** Put a possibly transparent PNG on white paper, like a printed label. */
function onWhite(buf: Buffer): Buffer {
  const png = PNG.sync.read(buf);
  const d = png.data;
  for (let i = 0; i < d.length; i += 4) {
    const a = d[i + 3] / 255;
    d[i] = d[i] * a + 255 * (1 - a);
    d[i + 1] = d[i + 1] * a + 255 * (1 - a);
    d[i + 2] = d[i + 2] * a + 255 * (1 - a);
    d[i + 3] = 255;
  }
  return PNG.sync.write(png);
}

export async function decodePng(buf: Buffer, formats?: ReadInputBarcodeFormat[]): Promise<string> {
  await init();
  const results = await readBarcodes(new Uint8Array(onWhite(buf)), {
    formats,
    tryHarder: true,
    maxNumberOfSymbols: 1,
  });
  const ok = results.find((r) => r.isValid);
  if (!ok) throw new Error(`No ${formats?.join('/') ?? 'barcode'} found`);
  return ok.text;
}

export async function decodeAll(buf: Buffer) {
  await init();
  const results = await readBarcodes(new Uint8Array(onWhite(buf)), {
    tryHarder: true,
    formats: [],
  });
  return results.filter((r) => r.isValid);
}
