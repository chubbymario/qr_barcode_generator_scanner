// What to look for when the scanner is set to one format, and how much to
// trust each kind of read. No decoders are imported here, so the Scan tab's
// menu can be built without loading them.

import { COMPOSITE_FORMATS, ZXING_FORMATS } from './support';
import { EXTRA_FORMATS, HINT_ONLY_FORMATS } from './lists';

/** The parts of a zxing-cpp result the filters look at. */
export interface ZxRead {
  format: string;
  contentType?: string;
  text: string;
}

export interface ZxTarget {
  /** zxing-cpp formats to switch on. */
  formats: string[];
  /** Extra check that the read is this particular variant. */
  accept?: (r: ZxRead) => boolean;
}

const gs1 = (r: ZxRead) => r.contentType === 'GS1';
const hibc = (r: ZxRead) => r.text.startsWith('+');
const ai = (code: string) => (r: ZxRead) =>
  gs1(r) && (r.text.startsWith(`(${code})`) || r.text.startsWith(code));
const digits = (n: number) => (r: ZxRead) => new RegExp(`^\\d{${n}}$`).test(r.text);
const prefix =
  (...p: string[]) =>
  (r: ZxRead) =>
    p.some((x) => r.text.startsWith(x));

const QR = ['QRCode'];
const DM = ['DataMatrix'];
const PDF = ['PDF417', 'CompactPDF417'];
const AZ = ['Aztec'];
const C39 = ['Code39'];
const ITF = ['ITF', 'ITF14'];
const EAN13 = ['EAN13', 'ISBN'];
const DATABAR = ['DataBar'];

export const ZX_TARGETS: Record<string, ZxTarget> = {
  ean13: { formats: EAN13 },
  ean8: { formats: ['EAN8'] },
  upca: {
    formats: ['UPCA', 'EAN13'],
    accept: (r) => r.format === 'UPCA' || r.text.startsWith('0'),
  },
  upce: { formats: ['UPCE'] },
  isbn: { formats: EAN13, accept: prefix('978', '979') },
  ismn: { formats: EAN13, accept: prefix('9790') },
  issn: { formats: EAN13, accept: prefix('977') },
  mands: { formats: ['EAN8'] },
  code128: { formats: ['Code128'] },
  'gs1-128': { formats: ['Code128'], accept: gs1 },
  ean14: { formats: ['Code128'], accept: ai('01') },
  sscc18: { formats: ['Code128'], accept: ai('00') },
  code39: { formats: C39 },
  code39ext: { formats: C39 },
  code32: { formats: ['Code32'] },
  // zxing-cpp reports PZN as Code 39 with its '-' prefix.
  pzn: { formats: ['Code39', 'PZN'], accept: (r) => r.format === 'PZN' || r.text.startsWith('-') },
  code93: { formats: ['Code93'] },
  code93ext: { formats: ['Code93'] },
  interleaved2of5: { formats: ITF },
  itf14: { formats: ITF, accept: digits(14) },
  identcode: { formats: ITF, accept: digits(12) },
  leitcode: { formats: ITF, accept: digits(14) },
  rationalizedCodabar: { formats: ['Codabar'] },
  telepen: { formats: ['Telepen'] },
  telepennumeric: { formats: ['Telepen'] },
  databaromni: { formats: DATABAR },
  databartruncated: { formats: DATABAR },
  databarstacked: { formats: DATABAR },
  databarstackedomni: { formats: DATABAR },
  databarlimited: { formats: ['DataBarLtd'] },
  databarexpanded: { formats: ['DataBarExp'] },
  databarexpandedstacked: { formats: ['DataBarExp'] },
  gs1northamericancoupon: { formats: ['DataBarExp'], accept: ai('8110') },
  qrcode: { formats: QR },
  swissqrcode: { formats: QR, accept: prefix('SPC') },
  gs1qrcode: { formats: QR, accept: gs1 },
  gs1dlqrcode: { formats: QR, accept: (r) => /^https?:\/\//i.test(r.text) || gs1(r) },
  d3aqr: { formats: QR },
  hibcqrcode: { formats: QR, accept: hibc },
  microqrcode: { formats: ['MicroQRCode'] },
  rectangularmicroqrcode: { formats: ['RMQRCode'] },
  datamatrix: { formats: DM },
  datamatrixrectangular: { formats: DM },
  datamatrixrectangularextension: { formats: DM },
  gs1datamatrix: { formats: DM, accept: gs1 },
  gs1datamatrixrectangular: { formats: DM, accept: gs1 },
  gs1dldatamatrix: { formats: DM, accept: (r) => /^https?:\/\//i.test(r.text) || gs1(r) },
  hibcdatamatrix: { formats: DM, accept: hibc },
  hibcdatamatrixrectangular: { formats: DM, accept: hibc },
  mailmark: { formats: DM, accept: prefix('JGB') },
  pdf417: { formats: PDF },
  pdf417compact: { formats: PDF },
  micropdf417: { formats: ['MicroPDF417'] },
  hibcpdf417: { formats: PDF, accept: hibc },
  hibcmicropdf417: { formats: ['MicroPDF417'], accept: hibc },
  azteccode: { formats: AZ },
  azteccodecompact: { formats: AZ },
  aztecrune: { formats: [...AZ, 'AztecRune'] },
  hibcazteccode: { formats: AZ, accept: hibc },
  maxicode: { formats: ['MaxiCode'] },
  // Plain Code 39, so HIBC's '/' and '$' aren't taken as Code 39 Extended escapes.
  hibccode39: { formats: ['Code39Std'], accept: hibc },
  hibccode128: { formats: ['Code128'], accept: hibc },
};

/** The linear part zxing-cpp reads for each composite. */
const COMPOSITE_LINEAR: Record<string, string[]> = {
  ean13composite: ['EAN13'],
  ean8composite: ['EAN8'],
  upcacomposite: ['UPCA', 'EAN13'],
  upcecomposite: ['UPCE'],
  databaromnicomposite: DATABAR,
  databartruncatedcomposite: DATABAR,
  databarstackedcomposite: DATABAR,
  databarstackedomnicomposite: DATABAR,
  databarlimitedcomposite: ['DataBarLtd'],
  databarexpandedcomposite: ['DataBarExp'],
  databarexpandedstackedcomposite: ['DataBarExp'],
  'gs1-128composite': ['Code128'],
  'gs1-cc': [],
};

/** Composites whose linear parts read the same (UPC-A is an EAN-13 starting with 0). */
export const COMPOSITE_ALIASES: Record<string, string[]> = {
  upcacomposite: ['ean13composite'],
  databartruncatedcomposite: ['databaromnicomposite'],
  databaromnicomposite: ['databartruncatedcomposite'],
  databarstackedcomposite: ['databarstackedomnicomposite'],
  databarstackedomnicomposite: ['databarstackedcomposite'],
  databarexpandedstackedcomposite: ['databarexpandedcomposite'],
};

/** zxing-cpp formats to switch on for a composite: the linear part plus the 2D part. */
export function compositeFormats(bcid: string): string[] {
  return [...(COMPOSITE_LINEAR[bcid] ?? []), 'MicroPDF417', 'PDF417'];
}

/**
 * Every zxing-cpp format the app generates, for "Everything" mode. Listing them
 * keeps out formats the app never makes (DX film edge) and the standalone
 * EAN-2/EAN-5 add-ons, which a stray pair of bars can fake.
 */
export const AUTO_ZXING_FORMATS = [
  ...new Set(Object.values(ZX_TARGETS).flatMap((t) => t.formats)),
].filter((f) => f !== 'EAN2' && f !== 'EAN5');

/**
 * App-decoded formats left out of "Everything", because without a check
 * character almost any row of bars (a keyboard, blinds, text) can pass for
 * them. They are read when picked on their own.
 */
export const PICK_ONLY = new Set([
  ...HINT_ONLY_FORMATS,
  'pharmacode',
  'pharmacode2',
  'symbol',
  'ean2',
  'ean5',
  'kix',
  'channelcode',
]);

/** Every format the scanner can be set to, in the generator's order. */
export const SCANNABLE = new Set([
  ...ZXING_FORMATS,
  ...COMPOSITE_FORMATS,
  ...EXTRA_FORMATS,
  ...HINT_ONLY_FORMATS,
]);

/**
 * How many camera frames in a row must agree before a read is shown.
 * 1 for 2D codes and stacked codes with heavy error detection, 2 for linear
 * codes with a check character, 3 for codes that have none.
 */
export function framesNeeded(bcid: string | undefined, label: string): number {
  if (!bcid) return 2;
  if (PICK_ONLY.has(bcid)) return 3;
  if (
    /^(code39|code39ext|hibccode39|rationalizedCodabar|interleaved2of5|code2of5|industrial2of5|iata2of5|matrix2of5|coop2of5|datalogic2of5|code11|msi|bc412|posicode|telepen|telepennumeric)$/.test(
      bcid,
    )
  )
    return 3;
  if (
    /qr|datamatrix|aztec|pdf417|maxicode|mailmark|composite|gs1-cc|code16k|code49|codablock/i.test(
      bcid,
    ) ||
    /composite/i.test(label)
  )
    return 1;
  return 2;
}
