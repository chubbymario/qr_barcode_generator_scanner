import type { ReaderOptions } from 'zxing-wasm/reader';

/** zxing-cpp settings for every scan (callers can override per call). */
export const ZXING_DEFAULTS: Partial<ReaderOptions> = {
  tryHarder: true,
  tryRotate: true,
  tryInvert: true,
  tryDownscale: true,
  eanAddOnSymbol: 'Read',
  maxNumberOfSymbols: 8,
};
