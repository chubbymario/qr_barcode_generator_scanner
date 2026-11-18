// Which generated formats the scanner can read, and how. This list is what the
// Barcode tab shows next to each format, and tests/scan-support.test.ts checks
// every entry against real renders so it can't drift from reality.

import { EXTRA_FORMATS, HINT_ONLY_FORMATS } from './lists';

/** Read by zxing-cpp (compiled to WebAssembly). */
export const ZXING_FORMATS = [
  'ean13',
  'ean8',
  'upca',
  'upce',
  'isbn',
  'ismn',
  'issn',
  'mands',
  'code128',
  'gs1-128',
  'ean14',
  'sscc18',
  'code39',
  'code39ext',
  'code32',
  'pzn',
  'code93',
  'code93ext',
  'interleaved2of5',
  'itf14',
  'identcode',
  'leitcode',
  'rationalizedCodabar',
  'telepen',
  'telepennumeric',
  'databaromni',
  'databarstacked',
  'databarstackedomni',
  'databartruncated',
  'databarlimited',
  'databarexpanded',
  'databarexpandedstacked',
  'gs1northamericancoupon',
  'qrcode',
  'swissqrcode',
  'microqrcode',
  'rectangularmicroqrcode',
  'gs1qrcode',
  'gs1dlqrcode',
  'd3aqr',
  'hibcqrcode',
  'datamatrix',
  'datamatrixrectangular',
  'datamatrixrectangularextension',
  'gs1datamatrix',
  'gs1datamatrixrectangular',
  'gs1dldatamatrix',
  'hibcdatamatrix',
  'hibcdatamatrixrectangular',
  'mailmark',
  'pdf417',
  'pdf417compact',
  'micropdf417',
  'hibcpdf417',
  'hibcmicropdf417',
  'azteccode',
  'azteccodecompact',
  'aztecrune',
  'hibcazteccode',
  'maxicode',
  'hibccode39',
  'hibccode128',
];

/** GS1 composites: zxing-cpp reads the linear part, the app decodes the 2D part. */
export const COMPOSITE_FORMATS = [
  'ean13composite',
  'ean8composite',
  'upcacomposite',
  'upcecomposite',
  'databaromnicomposite',
  'databarstackedcomposite',
  'databarstackedomnicomposite',
  'databartruncatedcomposite',
  'databarlimitedcomposite',
  'databarexpandedcomposite',
  'databarexpandedstackedcomposite',
  'gs1-128composite',
  'gs1-cc',
];

/** No decoder exists for these in this app. */
export const UNSUPPORTED_FORMATS: Record<string, string> = {
  hanxin: 'Han Xin isn’t supported by the scanner yet.',
  dotcode: 'DotCode isn’t supported by the scanner yet.',
  gs1dotcode: 'DotCode isn’t supported by the scanner yet.',
  codeone: 'Code One isn’t supported by the scanner yet.',
  ultracode: 'Ultracode isn’t supported by the scanner yet.',
  flattermarken: 'Flattermarken are print-collation marks, not a data barcode.',
};

export type ScanLevel = 'zxing' | 'extra' | 'hint' | 'composite' | 'none';

export function scanSupport(bcid: string): { level: ScanLevel; note: string } {
  if (ZXING_FORMATS.includes(bcid))
    return { level: 'zxing', note: 'The Scan tab can read this format.' };
  if (EXTRA_FORMATS.includes(bcid))
    return { level: 'extra', note: 'The Scan tab reads this with the app’s own decoder.' };
  if (HINT_ONLY_FORMATS.includes(bcid))
    return {
      level: 'hint',
      note: 'The Scan tab reads this only when you pick it under “Look for”, because almost any bar pattern fits it.',
    };
  if (COMPOSITE_FORMATS.includes(bcid))
    return {
      level: 'composite',
      note: 'The Scan tab reads this: the linear part with zxing-cpp, the 2D part with the app’s own decoder.',
    };
  return {
    level: 'none',
    note: UNSUPPORTED_FORMATS[bcid] ?? 'The Scan tab can’t read this format.',
  };
}
