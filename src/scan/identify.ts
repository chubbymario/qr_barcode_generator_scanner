// Turns what a decoder read into what the person printed. Several formats
// share one barcode (UPC-A is an EAN-13 starting with 0, ITF-14 is an
// Interleaved 2 of 5 with 14 digits, ISBN is an EAN-13 starting 978...), and
// some decoders return check characters or padding that aren't part of the
// data. Each read gets a list of interpretations, most common first; when
// the scanner is set to one format, that format's interpretation wins. The
// others are shown as "could also be".

export interface Interpretation {
  bcid?: string;
  label: string;
  text: string;
  /** Extra facts shown with the result, e.g. a check digit that was removed. */
  details?: [string, string][];
  /** What "Edit in generator" should load, when not bcid + text. */
  edit?: { bcid: string; text: string };
}

/** The decoder's own facts about a read. */
export interface RawRead {
  format?: string; // zxing-cpp format name
  symbologyIdentifier?: string;
  extra?: string;
  version?: string;
  contentType?: string;
  /** Symbol width in modules, when the decoder knows it. */
  width?: number;
}

const C39 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ-. $/+%';

/** Code 39 / HIBC modulo-43 check character for `s`, or null if `s` isn't Code 39. */
export function mod43(s: string): string | null {
  let sum = 0;
  for (const c of s) {
    const v = C39.indexOf(c);
    if (v < 0) return null;
    sum += v;
  }
  return C39[sum % 43];
}

/** Decode Code 39 "full ASCII" pairs ($A, %B, /C, +D). Null if a pair is invalid. */
export function code39FullAscii(raw: string): string | null {
  let out = '';
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i];
    if (!'$%/+'.includes(c)) {
      out += c;
      continue;
    }
    const n = raw[++i];
    if (n === undefined || n < 'A' || n > 'Z') return null;
    const k = n.charCodeAt(0) - 65;
    if (c === '$') out += String.fromCharCode(k + 1);
    else if (c === '+') out += String.fromCharCode(k + 97);
    else if (c === '/') {
      if (k <= 14) out += String.fromCharCode(k + 33);
      else if (n === 'Z') out += ':';
      else return null;
    } else {
      const pct = '\x1b\x1c\x1d\x1e\x1f;<=>?[\\]^_{|}~\x7f\x00@`\x7f\x7f\x7f';
      out += pct[k];
    }
  }
  return out;
}

/** GS1 mod-10 (weights 3,1 from the right): is the last digit right? */
export function gs1CheckOk(d: string): boolean {
  if (!/^\d{2,}$/.test(d)) return false;
  let sum = 0;
  for (let i = d.length - 2, w = 3; i >= 0; i--, w = 4 - w) sum += +d[i] * w;
  return (10 - (sum % 10)) % 10 === +d[d.length - 1];
}

/** Deutsche Post Identcode/Leitcode check (weights 4,9 from the left). */
export function deutschePostOk(d: string): boolean {
  if (!/^\d+$/.test(d)) return false;
  let sum = 0;
  for (let i = 0; i < d.length - 1; i++) sum += +d[i] * (i % 2 ? 9 : 4);
  return (10 - (sum % 10)) % 10 === +d[d.length - 1];
}

/** PZN check: PZN7 (weights 2–7) or PZN8 (weights 1–7), modulo 11. */
export function pznOk(d: string): boolean {
  if (!/^\d{7,8}$/.test(d)) return false;
  const start = d.length === 7 ? 2 : 1;
  let sum = 0;
  for (let i = 0; i < d.length - 1; i++) sum += +d[i] * (i + start);
  return sum % 11 !== 10 && sum % 11 === +d[d.length - 1];
}

function codabarCheckOk(t: string): boolean {
  const chars = '0123456789-$:/.+ABCD';
  const v = [...t.toUpperCase()].map((c) => chars.indexOf(c));
  if (v.some((x) => x < 0) || v.length < 4) return false;
  return v.reduce((a, b) => a + b, 0) % 16 === 0;
}

function issnCheck(seven: string): string {
  let sum = 0;
  for (let i = 0; i < 7; i++) sum += +seven[i] * (8 - i);
  const c = (11 - (sum % 11)) % 11;
  return c === 10 ? 'X' : String(c);
}

function isbn10(nine: string): string {
  let sum = 0;
  for (let i = 0; i < 9; i++) sum += +nine[i] * (10 - i);
  const c = (11 - (sum % 11)) % 11;
  return nine + (c === 10 ? 'X' : String(c));
}

const GS1_DL = /^https?:\/\/[^/?#]+\/(?:[^?#]*\/)?01\/\d{14}(?:[/?#]|$)/i;
const DMRE = new Set(
  '8x48 8x64 8x80 8x96 8x120 8x144 12x64 12x88 16x64 20x36 20x44 20x64 22x48 24x48 24x64 26x40 26x48 26x64'.split(
    ' ',
  ),
);

function parseExtra(r: RawRead): Record<string, unknown> {
  try {
    return r.extra ? (JSON.parse(r.extra) as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** HIBC: '+' then data, ending with a modulo-43 check character. */
function hibc(text: string): string | null {
  if (text.length < 4 || text[0] !== '+') return null;
  const body = text.slice(0, -1);
  return mod43(body) === text[text.length - 1] ? text.slice(1, -1) : null;
}

function hibcVariant(base: Interpretation, hibcId: string, hibcLabel: string): Interpretation[] {
  const data = hibc(base.text);
  if (data === null) return [base];
  return [
    {
      bcid: hibcId,
      label: hibcLabel,
      text: data,
      details: [['HIBC check character', base.text[base.text.length - 1]]],
    },
    base,
  ];
}

/** Interpretations of an EAN/UPC read's digits (with an optional add-on). */
function retail(format: string, text: string, r: RawRead): Interpretation[] {
  // The main number's length is fixed by the format; zxing-cpp may append an
  // add-on with or without a space.
  const len =
    format === 'EAN8'
      ? 8
      : format === 'UPCA'
        ? 12
        : format === 'UPCE'
          ? text.startsWith('0') && /^\d{13}/.test(text)
            ? 13
            : 8
          : 13;
  const m =
    new RegExp(`^(\\d{${len}})(?: ?(\\d{2}|\\d{5}))?$`).exec(text) ?? /^(\d+)()$/.exec(text);
  if (!m) return [{ label: format, text }];
  const main = m[1];
  const addon = m[2] || undefined;
  const plus = addon ? ` ${addon}` : '';
  const addonDetail: [string, string][] = addon
    ? [[addon.length === 5 ? 'EAN-5 add-on' : 'EAN-2 add-on', addon]]
    : [];
  const ean13: Interpretation = {
    bcid: 'ean13',
    label: 'EAN-13',
    text: main + plus,
    details: addonDetail,
  };
  if (format === 'UPCE') {
    const upce = String(parseExtra(r).UPCE ?? '');
    const upca = main.length === 13 ? main.slice(1) : main;
    return [
      {
        bcid: 'upce',
        label: 'UPC-E',
        text: (upce || upca) + plus,
        details: [['As UPC-A', upca], ...addonDetail],
      },
    ];
  }
  if (main.length === 8) {
    const out: Interpretation[] = [
      { bcid: 'ean8', label: 'EAN-8', text: main + plus, details: addonDetail },
    ];
    if (main[0] === '0') out.push({ bcid: 'mands', label: 'Marks & Spencer', text: main.slice(1) });
    return out;
  }
  const d = main.length === 12 ? `0${main}` : main;
  if (d.length !== 13) return [ean13];
  if (d[0] === '0') {
    return [
      {
        bcid: 'upca',
        label: 'UPC-A',
        text: d.slice(1) + plus,
        details: addonDetail,
      },
      { ...ean13, text: d + plus },
    ];
  }
  if (d.startsWith('9790')) {
    return [
      {
        bcid: 'ismn',
        label: 'ISMN',
        text: d + plus,
        details: addonDetail,
        edit: { bcid: 'ean13', text: d + plus },
      },
      ean13,
    ];
  }
  if (d.startsWith('978') || d.startsWith('979')) {
    return [
      {
        bcid: 'isbn',
        label: 'ISBN',
        text: d + plus,
        details: [
          ...(d.startsWith('978') ? [['ISBN-10', isbn10(d.slice(3, 12))] as [string, string]] : []),
          ...(addon ? [['Price add-on', addon] as [string, string]] : []),
        ],
        edit: { bcid: 'ean13', text: d + plus },
      },
      ean13,
    ];
  }
  if (d.startsWith('977')) {
    const seven = d.slice(3, 10);
    const issn = `${seven.slice(0, 4)}-${seven.slice(4)}${issnCheck(seven)}`;
    const variant = d.slice(10, 12);
    return [
      {
        bcid: 'issn',
        label: 'ISSN',
        text: `${issn} ${variant}${plus}`,
        details: [
          ['ISSN', issn],
          ['Variant', variant],
          ...(addon ? [['Issue add-on', addon] as [string, string]] : []),
        ],
      },
      ean13,
    ];
  }
  return [ean13];
}

function itf(text: string, validated: boolean): Interpretation[] {
  const out: Interpretation[] = [];
  const gs1 = validated || gs1CheckOk(text);
  if (text.length === 14 && gs1) out.push({ bcid: 'itf14', label: 'ITF-14', text });
  if (text.length === 14 && deutschePostOk(text))
    out.push({ bcid: 'leitcode', label: 'Deutsche Post Leitcode', text });
  if (text.length === 12 && deutschePostOk(text))
    out.push({ bcid: 'identcode', label: 'Deutsche Post Identcode', text });
  if (gs1) {
    let data = text.slice(0, -1);
    const details: [string, string][] = [['Check digit', text[text.length - 1]]];
    // ITF needs an even number of digits; an odd one gets a 0 in front.
    if (data.length % 2 && data[0] === '0' && data.length > 1) {
      data = data.slice(1);
      details.push(['Padding', 'a 0 in front, to make an even number of digits']);
    }
    const plain: Interpretation = {
      bcid: 'interleaved2of5',
      label: 'Interleaved 2 of 5',
      text: data,
      details,
    };
    // Identcode is rarer than a plain ITF with a check digit; ITF-14 and
    // Leitcode (14 digits) are the usual reason for that length.
    if (out[0]?.bcid === 'identcode') out.unshift(plain);
    else if (!out.length) out.push(plain);
  }
  out.push({ bcid: 'interleaved2of5', label: 'Interleaved 2 of 5', text });
  return out;
}

function code39(text: string, r: RawRead): Interpretation[] {
  // zxing-cpp reports "]A1" when the last character is a valid check character.
  const si = r.symbologyIdentifier ?? '';
  const hasCheck = si.startsWith(']A')
    ? si === ']A1' || si === ']A5'
    : text.length > 1 && mod43(text.slice(0, -1)) === text[text.length - 1];
  const checkDetail: [string, string][] = hasCheck
    ? [['Check character', text[text.length - 1]]]
    : [];
  const data = hasCheck ? text.slice(0, -1) : text;
  const out: Interpretation[] = [];
  const h = hibc(text);
  if (h !== null)
    out.push({
      bcid: 'hibccode39',
      label: 'HIBC Code 39',
      text: h,
      details: [['HIBC check character', text[text.length - 1]]],
    });
  if (/^-\d{7,8}$/.test(text) && pznOk(text.slice(1)))
    out.push({
      bcid: 'pzn',
      label: 'PZN (Pharmazentralnummer)',
      text: text.slice(1, -1),
      details: [
        ['PZN', text.slice(1)],
        ['Check digit', text[text.length - 1]],
      ],
    });
  const ext = code39FullAscii(data);
  const plain: Interpretation = {
    bcid: 'code39',
    label: 'Code 39',
    text: data,
    details: checkDetail,
  };
  if (ext !== null && ext !== data && h === null) {
    out.push({
      bcid: 'code39ext',
      label: 'Code 39 Extended (full ASCII)',
      text: ext,
      details: checkDetail,
    });
  }
  out.push(plain);
  if (hasCheck) out.push({ bcid: 'code39', label: 'Code 39 without a check character', text });
  return out;
}

/**
 * All the ways to read one result, most likely first. `label`/`bcid`/`text`
 * are the decoder's own, used when no rule applies.
 */
export function interpretations(base: Interpretation, r: RawRead): Interpretation[] {
  const f = r.format ?? '';
  const text = base.text;
  const gs1 = r.contentType === 'GS1';
  switch (f) {
    case 'EAN13':
    case 'UPCA':
    case 'ISBN':
    case 'EAN8':
    case 'UPCE':
      return retail(f, text, r);
    case 'ITF':
    case 'ITF14':
      return itf(text, r.symbologyIdentifier === ']I1');
    case 'Code39':
    case 'Code39Std':
    case 'Code39Ext':
      return code39(text, r);
    case 'PZN':
      return [
        {
          bcid: 'pzn',
          label: 'PZN (Pharmazentralnummer)',
          text: text.replace(/^-/, '').slice(0, -1),
          details: [['PZN', text.replace(/^-/, '')]],
        },
      ];
    case 'Code32':
      return [
        {
          bcid: 'code32',
          label: 'Italian Pharmacode (Code 32)',
          text: text.replace(/^A/, '').slice(0, -1),
          details: [['As printed', text]],
        },
      ];
    case 'Telepen':
    case 'TelepenAlpha':
    case 'TelepenNumeric': {
      // Telepen Numeric packs two digits per character (00–99 as codes 27–126).
      // zxing-cpp only reads it as numeric when the first pair is 00–04, so
      // offer the numeric reading of an alphabetic result too.
      if (f === 'TelepenNumeric' || (/^\d+$/.test(text) && base.bcid === 'telepennumeric'))
        return [{ ...base, bcid: 'telepennumeric', label: 'Telepen Numeric' }];
      const codes = [...text].map((c) => c.charCodeAt(0));
      const numeric = codes.every((c) => c >= 27 && c <= 126)
        ? codes.map((c) => String(c - 27).padStart(2, '0')).join('')
        : null;
      const alpha: Interpretation = { ...base, bcid: 'telepen', label: 'Telepen' };
      if (numeric === null) return [alpha];
      const num: Interpretation = {
        bcid: 'telepennumeric',
        label: 'Telepen Numeric',
        text: numeric,
      };
      // Text that's mostly punctuation is far more likely to be digits.
      const letters = (text.match(/[A-Za-z0-9 ]/g) ?? []).length;
      return letters >= text.length * 0.6 ? [alpha, num] : [num, alpha];
    }
    case 'MaxiCode':
      // zxing-cpp shows spaces and control characters as visible symbols
      // (␠ ␝ ␞ ␄); turn them back into the characters that were encoded.
      return [
        {
          ...base,
          text: text.replace(/[\u2400-\u2421]/g, (c) =>
            c === '\u2421'
              ? '\x7f'
              : c === '\u2420'
                ? ' '
                : String.fromCharCode(c.charCodeAt(0) - 0x2400),
          ),
        },
      ];
    case 'Codabar': {
      if (codabarCheckOk(text) && text.length > 3) {
        return [
          {
            ...base,
            text: text.slice(0, -2) + text.slice(-1),
            details: [['Check character', text[text.length - 2]]],
          },
          { ...base, label: 'Codabar without a check character' },
        ];
      }
      return [base];
    }
    case 'Code93': {
      const extended = /[^0-9A-Z\-. $/+%]/.test(text);
      return extended
        ? [{ bcid: 'code93ext', label: 'Code 93 Extended (full ASCII)', text }]
        : [base, { bcid: 'code93ext', label: 'Code 93 Extended', text }];
    }
    case 'Aztec':
    case 'AztecCode':
    case 'AztecRune':
      if (r.symbologyIdentifier === ']zC' || f === 'AztecRune')
        return [{ bcid: 'aztecrune', label: 'Aztec Rune', text: String(parseInt(text, 10)) }];
      {
        // Compact Aztec comes in 15–27 modules, full-range from 19: 15 is
        // certainly compact, 19–27 could be either.
        const w = r.width ?? 0;
        const compact: Interpretation = {
          ...base,
          bcid: 'azteccodecompact',
          label: 'Compact Aztec',
        };
        const list = hibcVariant(base, 'hibcazteccode', 'HIBC Aztec');
        if (list.length > 1 || !w || w > 27) return list;
        return w === 15 ? [compact, base] : [base, compact];
      }
    case 'QRCode':
    case 'QRCodeModel2': {
      if (text.startsWith('SPC\r\n') || text.startsWith('SPC\n'))
        return [{ ...base, bcid: 'swissqrcode', label: 'Swiss QR code' }, base];
      if (!gs1 && GS1_DL.test(text))
        return [
          { ...base, bcid: 'gs1dlqrcode', label: 'GS1 Digital Link QR code' },
          { ...base, bcid: 'd3aqr', label: 'D3 AQR' },
          base,
        ];
      return hibcVariant(base, 'hibcqrcode', 'HIBC QR code');
    }
    case 'DataMatrix': {
      const v = r.version ?? '';
      const [h, w] = v.split('x').map(Number);
      const shape =
        h && w && h !== w ? (DMRE.has(v) ? ' (rectangular extension)' : ' (rectangular)') : '';
      const shapeId = shape
        ? DMRE.has(v)
          ? 'datamatrixrectangularextension'
          : 'datamatrixrectangular'
        : 'datamatrix';
      const sized: Interpretation = {
        ...base,
        bcid: gs1 ? (shape ? 'gs1datamatrixrectangular' : 'gs1datamatrix') : shapeId,
        label: `${gs1 ? 'GS1 ' : ''}Data Matrix${shape}`,
        details: v ? [['Size', `${v.replace('x', ' × ')} modules`]] : undefined,
      };
      if (text.startsWith('JGB '))
        return [{ ...sized, bcid: 'mailmark', label: 'Royal Mail Mailmark' }, sized];
      if (!gs1 && GS1_DL.test(text))
        return [
          { ...sized, bcid: 'gs1dldatamatrix', label: 'GS1 Digital Link Data Matrix' },
          sized,
        ];
      return hibcVariant(
        sized,
        shape ? 'hibcdatamatrixrectangular' : 'hibcdatamatrix',
        `HIBC Data Matrix${shape}`,
      );
    }
    case 'PDF417':
    case 'CompactPDF417': {
      const list = hibcVariant(base, 'hibcpdf417', 'HIBC PDF417');
      return list.length > 1
        ? list
        : [base, { ...base, bcid: 'pdf417compact', label: 'Compact PDF417' }];
    }
    case 'MicroPDF417':
      return hibcVariant(base, 'hibcmicropdf417', 'HIBC MicroPDF417');
    case 'Code128': {
      if (gs1 && /^\(01\)\d{14}$/.test(text))
        return [{ ...base, bcid: 'ean14', label: 'EAN-14 (GS1-128)' }, base];
      if (gs1 && /^\(00\)\d{18}$/.test(text))
        return [{ ...base, bcid: 'sscc18', label: 'SSCC-18 (GS1-128)' }, base];
      return hibcVariant(base, 'hibccode128', 'HIBC Code 128');
    }
    case 'DataBar':
    case 'DataBarOmni':
      return [base, { ...base, bcid: 'databartruncated', label: 'GS1 DataBar Truncated' }];
    case 'DataBarStk':
    case 'DataBarStkOmni':
      return [
        base,
        {
          ...base,
          bcid: base.bcid === 'databarstacked' ? 'databarstackedomni' : 'databarstacked',
          label:
            base.bcid === 'databarstacked'
              ? 'GS1 DataBar Stacked Omnidirectional'
              : 'GS1 DataBar Stacked',
        },
      ];
    case 'DataBarExp':
    case 'DataBarExpStk':
      if (text.startsWith('(8110)'))
        return [
          { ...base, bcid: 'gs1northamericancoupon', label: 'GS1 North American Coupon' },
          base,
        ];
      return [base];
    default:
      return [base];
  }
}

/** Put the interpretation for `target` first, if there is one. */
export function preferTarget(list: Interpretation[], target?: string): Interpretation[] {
  if (!target) return list;
  const i = list.findIndex((x) => x.bcid === target || x.edit?.bcid === target);
  if (i <= 0) return list;
  return [list[i], ...list.slice(0, i), ...list.slice(i + 1)];
}
