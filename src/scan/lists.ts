// Plain lists of which formats the app's own decoders read. Kept separate from
// the decoders so the main page can show them without loading the decoders.

/** Formats read by the app's own decoders (src/scan/extra), by bwip-js id. */
export const EXTRA_FORMATS = [
  'code11',
  'msi',
  'plessey',
  'code2of5',
  'iata2of5',
  'matrix2of5',
  'coop2of5',
  'datalogic2of5',
  'industrial2of5',
  'bc412',
  'ean2',
  'ean5',
  'pharmacode',
  'channelcode',
  'symbol',
  'posicode',
  'onecode',
  'japanpost',
  'auspost',
  'royalmail',
  'kix',
  'postnet',
  'planet',
  'pharmacode2',
  'code16k',
  'code49',
  'codablockf',
  'hibccodablockf',
];

/** 2D formats read by the app's own decoders (src/scan/twod). */
export const TWOD_FORMATS = ['codeone', 'hanxin', 'dotcode', 'gs1dotcode', 'ultracode'];

/** Formats read only when picked in the scanner, because any bar pattern fits them. */
export const HINT_ONLY_FORMATS = ['raw', 'daft'];

/** Choices for the scanner's "Look for" list. */
export const APP_DECODED = [
  ...EXTRA_FORMATS.filter((f) => f !== 'industrial2of5'),
  ...TWOD_FORMATS,
  ...HINT_ONLY_FORMATS,
];
