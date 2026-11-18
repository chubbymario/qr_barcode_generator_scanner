// Groups bwip-js's built-in symbol list into categories people recognise.
// The list itself (names, sample data, default options) comes from bwip-js at
// runtime, so new formats added upstream show up under "Other" automatically.

export interface SymbolInfo {
  bcid: string;
  desc: string;
  text: string;
  opts: string;
}

export const CATEGORIES: { name: string; ids: string[] }[] = [
  {
    name: 'Popular',
    ids: [
      'code128',
      'ean13',
      'upca',
      'qrcode',
      'datamatrix',
      'pdf417',
      'code39',
      'itf14',
      'azteccode',
    ],
  },
  {
    name: 'Retail (EAN / UPC / ISBN)',
    ids: ['ean13', 'ean8', 'upca', 'upce', 'ean5', 'ean2', 'isbn', 'ismn', 'issn', 'mands'],
  },
  {
    name: 'General purpose 1D',
    ids: [
      'code128',
      'code39',
      'code39ext',
      'code93',
      'code93ext',
      'rationalizedCodabar',
      'code11',
      'msi',
      'plessey',
      'telepen',
      'telepennumeric',
      'bc412',
      'channelcode',
      'posicode',
    ],
  },
  {
    name: '2 of 5 family',
    ids: [
      'interleaved2of5',
      'itf14',
      'code2of5',
      'industrial2of5',
      'iata2of5',
      'matrix2of5',
      'coop2of5',
      'datalogic2of5',
      'identcode',
      'leitcode',
    ],
  },
  {
    name: '2D matrix',
    ids: [
      'qrcode',
      'microqrcode',
      'rectangularmicroqrcode',
      'swissqrcode',
      'datamatrix',
      'datamatrixrectangular',
      'datamatrixrectangularextension',
      'azteccode',
      'azteccodecompact',
      'aztecrune',
      'maxicode',
      'dotcode',
      'hanxin',
      'codeone',
      'ultracode',
    ],
  },
  {
    name: 'Stacked',
    ids: ['pdf417', 'pdf417compact', 'micropdf417', 'codablockf', 'code16k', 'code49'],
  },
  {
    name: 'GS1',
    ids: [
      'gs1-128',
      'ean14',
      'sscc18',
      'gs1datamatrix',
      'gs1datamatrixrectangular',
      'gs1dldatamatrix',
      'gs1qrcode',
      'gs1dlqrcode',
      'gs1dotcode',
      'd3aqr',
      'databaromni',
      'databarstacked',
      'databarstackedomni',
      'databartruncated',
      'databarlimited',
      'databarexpanded',
      'databarexpandedstacked',
      'gs1northamericancoupon',
    ],
  },
  {
    name: 'GS1 composite',
    ids: [
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
    ],
  },
  {
    name: 'Healthcare (HIBC / pharma)',
    ids: [
      'hibccode39',
      'hibccode128',
      'hibcdatamatrix',
      'hibcdatamatrixrectangular',
      'hibcpdf417',
      'hibcmicropdf417',
      'hibcqrcode',
      'hibccodablockf',
      'hibcazteccode',
      'pharmacode',
      'pharmacode2',
      'code32',
      'pzn',
    ],
  },
  {
    name: 'Postal',
    ids: ['onecode', 'postnet', 'planet', 'royalmail', 'mailmark', 'auspost', 'kix', 'japanpost'],
  },
  {
    name: 'Special',
    ids: ['flattermarken', 'raw', 'daft', 'symbol'],
  },
];

/** Symbols where a "bar height" setting makes sense. */
const NO_HEIGHT = new Set([
  ...CATEGORIES.find((c) => c.name === '2D matrix')!.ids,
  ...CATEGORIES.find((c) => c.name === 'Stacked')!.ids,
  'gs1datamatrix',
  'gs1datamatrixrectangular',
  'gs1dldatamatrix',
  'gs1qrcode',
  'gs1dlqrcode',
  'gs1dotcode',
  'd3aqr',
  'hibcdatamatrix',
  'hibcdatamatrixrectangular',
  'hibcpdf417',
  'hibcmicropdf417',
  'hibcqrcode',
  'hibccodablockf',
  'hibcazteccode',
  'gs1-cc',
  'databarstacked',
  'databarstackedomni',
  'databarexpandedstacked',
  'databarstackedcomposite',
  'databarstackedomnicomposite',
  'databarexpandedstackedcomposite',
  'onecode',
  'postnet',
  'planet',
  'royalmail',
  'mailmark',
  'auspost',
  'kix',
  'japanpost',
  'daft',
  'symbol',
]);

export function usesBarHeight(bcid: string): boolean {
  return !NO_HEIGHT.has(bcid);
}

const TWO_D = new Set([
  ...CATEGORIES.find((c) => c.name === '2D matrix')!.ids,
  'gs1datamatrix',
  'gs1datamatrixrectangular',
  'gs1dldatamatrix',
  'gs1qrcode',
  'gs1dlqrcode',
  'gs1dotcode',
  'd3aqr',
  'hibcdatamatrix',
  'hibcdatamatrixrectangular',
  'hibcqrcode',
  'hibcazteccode',
]);

export function is2D(bcid: string): boolean {
  return TWO_D.has(bcid);
}

/** Short notes that help people get valid input on the first try. */
export const HINTS: Record<string, string> = {
  ean13: '12 digits (check digit added for you) or 13 digits. Add-ons: a space then 2 or 5 digits.',
  ean8: '7 digits, or 8 with the check digit.',
  upca: '11 digits, or 12 with the check digit.',
  upce: '7 digits starting with 0 or 1, or 8 with the check digit.',
  isbn: 'ISBN-13 with hyphens, e.g. 978-1-56581-231-4. Optional price add-on after a space.',
  itf14: '13 digits, or 14 with the check digit. Spaces are ignored.',
  interleaved2of5:
    'Digits only. An even count is needed; turn on the check digit to pad odd lengths.',
  code39: 'Uppercase A–Z, 0–9, space and - . $ / + %. Use Code 39 Extended for lowercase.',
  code93: 'Uppercase A–Z, 0–9, space and - . $ / + %. Use Code 93 Extended for lowercase.',
  code128: 'Any printable ASCII text.',
  qrcode: 'Any text. For styled QR codes with logos, use the QR code tab.',
  datamatrix: 'Any text. Use "version=24x24" in more options to fix the size.',
  'gs1-128': 'GS1 element strings in brackets, e.g. (01)09521234543213(10)ABC123.',
  gs1datamatrix: 'GS1 element strings in brackets, e.g. (01)09521234543213(17)261231.',
  gs1qrcode: 'GS1 element strings in brackets.',
  pdf417: 'Any text. "columns=N" controls width; "eclevel=0..8" sets error correction.',
  azteccode: 'Any text. "eclevel=23" sets the error-correction percentage.',
  rationalizedCodabar: 'Start and stop with A, B, C or D, e.g. A0123456789B.',
  onecode: '20, 25, 29 or 31 digits (tracking code + routing code).',
  postnet: '5, 9 or 11 digits.',
  pharmacode: 'A number from 3 to 131070.',
  msi: 'Digits only.',
  maxicode: 'Structured carrier data. "mode=2" or "mode=3" for addresses, "mode=4" for free text.',
  swissqrcode: 'Swiss QR-bill payload. Use ^CR^LF between lines and keep the "parse" option.',
};

export function groupSymbols(
  list: readonly SymbolInfo[],
): { name: string; symbols: SymbolInfo[] }[] {
  const byId = new Map(list.map((s) => [s.bcid, s]));
  const used = new Set<string>();
  const groups = CATEGORIES.map((cat) => {
    const symbols = cat.ids.map((id) => byId.get(id)).filter((s): s is SymbolInfo => !!s);
    if (cat.name !== 'Popular') symbols.forEach((s) => used.add(s.bcid));
    return { name: cat.name, symbols };
  });
  const other = list.filter((s) => !used.has(s.bcid));
  if (other.length) groups.push({ name: 'Other', symbols: other });
  return groups.filter((g) => g.symbols.length);
}
