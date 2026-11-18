// zxing-cpp (WebAssembly) for the mainstream formats. The .wasm file ships with
// the site, so scanning works offline and never contacts another server.

import wasmUrl from 'zxing-wasm/reader/zxing_reader.wasm?url';
import type { ReadResult, ReaderOptions } from 'zxing-wasm/reader';

type Zxing = typeof import('zxing-wasm/reader');
let loading: Promise<Zxing> | null = null;

export function loadZxing(): Promise<Zxing> {
  loading ??= import('zxing-wasm/reader').then(async (m) => {
    await m.prepareZXingModule({
      overrides: {
        locateFile: (path: string, prefix: string) =>
          path.endsWith('.wasm') ? wasmUrl : prefix + path,
      },
      fireImmediately: true,
    });
    return m;
  });
  return loading;
}

export async function readWithZxing(
  image: ImageData,
  opts: Partial<ReaderOptions> = {},
): Promise<ReadResult[]> {
  const z = await loadZxing();
  const results = await z.readBarcodes(image, {
    tryHarder: true,
    tryRotate: true,
    tryInvert: true,
    tryDownscale: true,
    eanAddOnSymbol: 'Read',
    maxNumberOfSymbols: 8,
    ...opts,
  });
  return results.filter((r) => r.isValid && r.text !== '');
}

export type { ReadResult };
