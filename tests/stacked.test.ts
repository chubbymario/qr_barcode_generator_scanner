import { describe, expect, it } from 'vitest';
import bwip from 'bwip-js/node';
import { PNG } from 'pngjs';
import { buildBwipOptions, defaultOptionString } from '../src/barcode/options';
import { defaultState } from '../src/state';
import { decodeExtra, lumaFromRgba, type Luma } from '../src/scan/extra';

const base = defaultState().barcode;

async function render(bcid: string, text: string, scale: number, extra = ''): Promise<Luma> {
  const sym = bwip.symbolList.find((s) => s.bcid === bcid)!;
  const opts = buildBwipOptions(
    { ...base, bcid },
    text,
    { x: scale, y: scale },
    null,
    `${defaultOptionString(sym.opts)} ${extra}`.trim(),
  );
  const png = PNG.sync.read(await bwip.toBuffer(opts as never));
  return lumaFromRgba(png.data, png.width, png.height);
}

/** Deterministic pseudo-random strings from a character set. */
function strings(chars: string, count: number, min: number, max: number, seed = 1): string[] {
  let s = seed;
  const rnd = () => (s = (s * 48271) % 2147483647) / 2147483647;
  return Array.from({ length: count }, () => {
    const n = min + Math.floor(rnd() * (max - min + 1));
    return Array.from({ length: n }, () => chars[Math.floor(rnd() * chars.length)]).join('');
  });
}

const ALNUM = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
const PRINTABLE = Array.from({ length: 95 }, (_, i) => String.fromCharCode(32 + i))
  .join('')
  .replace('^', '');

describe('Code 16K', () => {
  const cases = [
    'Abcd-1234567890-wxyZ', // bwip-js example
    'HELLO',
    '12345678901234567890', // set C
    'a1b2c3d4e5f6g7h8',
    'Mixed CASE with spaces & symbols!?',
    'X'.repeat(60), // many rows
    ...strings(PRINTABLE, 12, 1, 40, 3),
  ];
  it.each(cases)('reads %j', async (text) => {
    for (const scale of [2, 3])
      expect(decodeExtra(bwip, await render('code16k', text, scale))?.text).toBe(text);
  });

  it('reads extended ASCII (FNC4)', async () => {
    const r = decodeExtra(bwip, await render('code16k', 'caf^233 cr^232me', 3, 'parse'));
    expect(r?.text).toBe('café crème');
  });
});

describe('Code 49', () => {
  const cases = [
    'MULTIPLE ROWS IN CODE 49', // bwip-js example
    'CODE 49',
    '1234567890123', // numeric mode
    '12345', // numeric mode, one group
    'ABC1234567DEF', // alpha -> numeric -> alpha
    'lower case and Mixed',
    'ab',
    '9'.repeat(70), // 8 rows of numbers
    ...strings(ALNUM + '-. $/+%', 10, 1, 30, 5),
    ...strings(PRINTABLE, 10, 1, 20, 7),
  ];
  it.each(cases)('reads %j', async (text) => {
    for (const scale of [2, 3])
      expect(decodeExtra(bwip, await render('code49', text, scale))?.text).toBe(text);
  });
});

describe('Codablock F', () => {
  const cases: [string, string][] = [
    ['CODABLOCK F 34567890123456789010040digit', 'columns=8'], // bwip-js example
    ['Short', ''],
    [
      'A long message that wraps over several rows of a Codablock F symbol 0123456789',
      'columns=10',
    ],
    ['1234567890123456789012345678901234567890', 'columns=6'],
    ...strings(PRINTABLE, 8, 4, 60, 11).map((t): [string, string] => [t, 'columns=8']),
  ];
  it.each(cases)('reads %j (%s)', async (text, opts) => {
    for (const scale of [2, 3])
      expect(decodeExtra(bwip, await render('codablockf', text, scale, opts))?.text).toBe(text);
  });

  it('reads HIBC Codablock F', async () => {
    const r = decodeExtra(bwip, await render('hibccodablockf', 'A999BJC5D6E71', 3));
    expect(r).toEqual({ bcid: 'hibccodablockf', text: 'A999BJC5D6E71' });
  });
});

describe('PosiCode', () => {
  const cases: [string, string][] = [
    ['ABC123', 'version=b'], // bwip-js example style
    ['PosiCode 123', 'version=a'],
    ['lower and UPPER', 'version=b'],
    ['Symbols !@#$%&*()', 'version=a'],
    ['LIMITED-A.123', 'version=limiteda'],
    ['LIMITEDB-9', 'version=limitedb'],
    ...strings(PRINTABLE, 8, 1, 25, 13).map((t): [string, string] => [t, 'version=a']),
    ...strings(ALNUM + '-.', 4, 1, 20, 17).map((t): [string, string] => [t, 'version=limitedb']),
  ];
  it.each(cases)('reads %j (%s)', async (text, opts) => {
    for (const scale of [2, 3])
      expect(decodeExtra(bwip, await render('posicode', text, scale, opts))?.text).toBe(text);
  });
});
