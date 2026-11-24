// The app's own 2D decoders: Code One, Han Xin, DotCode (and GS1 DotCode) and
// Ultracode. Matrices come straight from bwip-js (the app's generator), then
// whole images go through the scanner.
import { describe, expect, it, vi } from 'vitest';
import bwip from 'bwip-js/node';
import { binaryField, primeField, rsCorrect, rsEncode } from '../src/scan/twod/rs';
import { CODEONE_METRICS, decodeCodeOneMatrix } from '../src/scan/twod/codeone';
import { decodeHanXinMatrix } from '../src/scan/twod/hanxin';
import { decodeDotCodeMatrix } from '../src/scan/twod/dotcode';
import { decodeUltracodeMatrix } from '../src/scan/twod/ultracode';
import { degrade, renderFormat, renderOnPage, sampleText } from './harness';

vi.mock('../src/scan/zxing', async () => (await import('./harness')).zxingMock());
vi.mock('../src/barcode/render', async () => (await import('./harness')).bwipMock());
const { scanImage } = await import('../src/scan/engine');

type Raw = { pixs: number[]; pixx: number; pixy: number };
const raw = (bcid: string, text: string, opts = ''): Raw =>
  (bwip as unknown as { raw: (b: string, t: string, o: string) => Raw[] }).raw(bcid, text, opts)[0];

// A deterministic stream of pseudo-random numbers.
function rng(seed: number) {
  return () => (seed = (seed * 1103515245 + 12345) >>> 0) / 2 ** 32;
}

describe('Reed-Solomon', () => {
  it.each([
    ['GF(256) fcr 1', binaryField(256, 0x12d), 1],
    ['GF(256) fcr 0', binaryField(256, 301), 0],
    ['GF(32)', binaryField(32, 37), 1],
    ['GF(113)', primeField(113, 3), 1],
    ['GF(283)', primeField(283, 3), 1],
  ] as const)('%s corrects up to half the check codewords', (_, f, fcr) => {
    const data = Array.from({ length: 20 }, (_, i) => (i * 37 + 11) % f.size);
    const cw = [...data, ...rsEncode(f, data, 10, fcr)];
    expect(rsCorrect(f, cw, 10, fcr)).toEqual(cw);
    const bad = cw.slice();
    for (const [i, d] of [
      [3, 5],
      [17, 1],
      [25, 9],
      [0, 2],
      [29, 3],
    ])
      bad[i] = (bad[i] + d) % f.size;
    expect(rsCorrect(f, bad, 10, fcr)).toEqual(cw);
    bad[10] = (bad[10] + 1) % f.size;
    expect(rsCorrect(f, bad, 10, fcr)).not.toEqual(cw);
  });
});

const TEXTS = ['Hello', '1234567890', 'MiXeD case 123 !@#', 'bytes éüÿ', 'A', 'x'.repeat(60)];

describe('Code One matrices', () => {
  it('reads every version', () => {
    let n = 0;
    for (const m of CODEONE_METRICS) {
      const texts = m.ver.startsWith('S') ? ['123456', '42'] : TEXTS;
      for (const t of texts) {
        let r: Raw;
        try {
          r = raw('codeone', t, `version=${m.ver}`);
        } catch {
          continue; // doesn't fit this version
        }
        const d = decodeCodeOneMatrix(r.pixs, r.pixy, r.pixx);
        expect(d && (d.text === t || BigInt(d.text) === BigInt(t)), `${m.ver} ${t}`).toBe(true);
        n++;
      }
    }
    expect(n).toBeGreaterThan(60);
  });
});

describe('Han Xin matrices', () => {
  it('reads versions 1–84 at each error correction level', { timeout: 60000 }, () => {
    for (const v of [1, 2, 5, 12, 25, 40, 63, 84])
      for (const ecl of [1, 2, 3, 4])
        for (const t of ['Han Xin', '0123456789', 'bytes éüÿ 汉信码']) {
          let r: Raw;
          try {
            r = raw('hanxin', t, `version=${v} eclevel=L${ecl}`);
          } catch {
            continue; // too long for this version
          }
          expect(decodeHanXinMatrix(r.pixs, r.pixx)?.text, `v${v} L${ecl}`).toBe(t);
        }
  });
  it('corrects damaged modules and never misreads', () => {
    const rand = rng(7);
    let ok = 0;
    for (let k = 0; k < 60; k++) {
      const t = `test ${k} ${'z'.repeat(k % 30)}`;
      const r = raw('hanxin', t, `eclevel=L${1 + (k % 4)}`);
      const p = r.pixs.slice();
      for (let f = 0; f < p.length * 0.01; f++) p[Math.floor(rand() * p.length)] ^= 1;
      const d = decodeHanXinMatrix(p, r.pixx);
      if (d) expect(d.text).toBe(t);
      if (d) ok++;
    }
    expect(ok).toBeGreaterThan(45);
  });
});

describe('DotCode matrices', () => {
  it.each([
    'This is DotCode',
    '1234567890',
    'abc\r\ndef\tghi',
    '17123456101234',
    'xx' + '9'.repeat(30) + 'yy',
    'bytes éüÿ 汉信',
    String.fromCharCode(...Array.from({ length: 40 }, (_, i) => 128 + i)),
    '[)>\x1e05\x1d123\x1e\x04',
  ])('reads %j at several sizes and masks', (t) => {
    for (const o of ['', 'rows=11', 'columns=30', 'rows=40', 'mask=1', 'mask=3', 'ratio=1']) {
      const r = raw('dotcode', t, o);
      expect(decodeDotCodeMatrix(r.pixs, r.pixy, r.pixx)?.text, o).toBe(t);
    }
  });
  it('reads GS1 DotCode as element strings', () => {
    const t = sampleText('gs1dotcode');
    const r = raw('gs1dotcode', t, 'rows=16');
    expect(decodeDotCodeMatrix(r.pixs, r.pixy, r.pixx)?.gs1).toBe(t);
    // Plain digits are not GS1: DotCode marks them with a leading FNC1.
    const p = raw('dotcode', '0109521234543213');
    const d = decodeDotCodeMatrix(p.pixs, p.pixy, p.pixx);
    expect(d?.text).toBe('0109521234543213');
    expect(d?.gs1).toBeUndefined();
  });
});

describe('Ultracode matrices', () => {
  it.each(['Awesome colours!', 'A', '1234567890', 'bytes éüÿ', 'x'.repeat(200)])(
    'reads %j at each error correction level',
    (t) => {
      for (const o of ['eclevel=EC1', 'eclevel=EC2', 'eclevel=EC3', 'rev=1 eclevel=EC0']) {
        let r: Raw;
        try {
          r = raw('ultracode', t, o);
        } catch {
          continue;
        }
        expect(decodeUltracodeMatrix(r.pixs, r.pixy, r.pixx)?.text, o).toBe(t);
      }
    },
  );
});

describe('fixes from testing', () => {
  it('reads an FNC1 inside a DotCode Shift B run', () => {
    for (const t of ['X^FNC1', 'A^FNC1B', 'ABC^FNC1']) {
      const r = raw('dotcode', t, 'parsefnc');
      expect(decodeDotCodeMatrix(r.pixs, r.pixy, r.pixx)?.text).toBe(t.replace('^FNC1', '\x1d'));
    }
  });
  it('keeps a leading GS byte in plain Han Xin data', () => {
    for (const t of ['\x1dABC', '\x1d\x1dX']) {
      const r = raw('hanxin', t);
      expect(decodeHanXinMatrix(r.pixs, r.pixx)?.text).toBe(t);
    }
  });
  it('reads Code One where bwip-js leaves X12 without its unlatch', () => {
    for (const t of [
      '\n\x00O1AXY813\r\x00[',
      'AECUO?#{ZKLYWKE~<@tnsm\tkb$~/\r\x01\r\x04-;FFMVTOXEIX5*~<',
    ]) {
      const r = raw('codeone', t);
      expect(decodeCodeOneMatrix(r.pixs, r.pixy, r.pixx)?.text).toBe(t);
    }
  });
  it('does not correct Ultracode EC0, which only detects errors', () => {
    const r = raw('ultracode', 'x'.repeat(80), 'rev=1 eclevel=EC0');
    const p = r.pixs.slice();
    for (const [i, c] of [
      [109, 9],
      [321, 5],
      [551, 6],
      [222, 5],
      [567, 9],
      [449, 6],
      [323, 1],
      [584, 5],
    ])
      p[i] = c;
    expect(decodeUltracodeMatrix(p, r.pixy, r.pixx)).toBeNull();
  });
  it('rejects a Code One S-10 value with too many digits', () => {
    const bits =
      '1001010111000010010001000010011010111100001000000000000111111111111000000000110111111101';
    expect(decodeCodeOneMatrix([...bits].map(Number), 8, 11)).toBeNull();
  });
  it('does not miscorrect damaged small Han Xin and Code One S-10 symbols', () => {
    const hx = raw('hanxin', 'Café 汉字 😀', 'eclevel=L1');
    const p = hx.pixs.slice();
    for (const i of [
      199, 29, 264, 122, 515, 139, 458, 290, 328, 36, 64, 155, 261, 153, 97, 182, 59, 130, 16, 446,
      174, 450, 259, 17,
    ])
      p[i] ^= 1;
    expect(decodeHanXinMatrix(p, hx.pixx)?.text ?? null).not.toBe('AaÂe!æ±å­\u0013 ð');
    const c1 = raw('codeone', '123456', 'version=S-10');
    const q = c1.pixs.slice();
    for (const i of [28, 87, 4, 10, 7, 6]) q[i] ^= 1;
    const d = decodeCodeOneMatrix(q, c1.pixy, c1.pixx);
    expect(d === null || d.text === '123456').toBe(true);
  });
});

type Img = { data: Uint8ClampedArray; width: number; height: number };
/** The image in the middle of a bigger white canvas, so turning it doesn't crop it. */
function padded(src: Img, k = 0.5): Img {
  const P = Math.round(Math.max(src.width, src.height) * k);
  const W = src.width + 2 * P;
  const H = src.height + 2 * P;
  const data = new Uint8ClampedArray(W * H * 4).fill(255);
  for (let y = 0; y < src.height; y++)
    data.set(src.data.subarray(y * src.width * 4, (y + 1) * src.width * 4), ((y + P) * W + P) * 4);
  return { data, width: W, height: H };
}
/** Colour-preserving turn about the centre. */
function turn(src: Img, deg: number): Img {
  const a = (deg * Math.PI) / 180;
  const [c, s] = [Math.cos(a), Math.sin(a)];
  const { width: W, height: H } = src;
  const d = new Uint8ClampedArray(W * H * 4).fill(255);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const sx = W / 2 + (x - W / 2) * c - (y - H / 2) * s;
      const sy = H / 2 + (x - W / 2) * s + (y - H / 2) * c;
      const x0 = Math.floor(sx);
      const y0 = Math.floor(sy);
      if (x0 < 0 || y0 < 0 || x0 >= W - 1 || y0 >= H - 1) continue;
      const fx = sx - x0;
      const fy = sy - y0;
      for (let k = 0; k < 3; k++) {
        const i = (y0 * W + x0) * 4 + k;
        d[(y * W + x) * 4 + k] =
          (src.data[i] * (1 - fx) + src.data[i + 4] * fx) * (1 - fy) +
          (src.data[i + W * 4] * (1 - fx) + src.data[i + W * 4 + 4] * fx) * fy;
      }
    }
  return { data: d, width: W, height: H };
}

describe('image conditions found in testing', () => {
  it(
    'reads DotCode and GS1 DotCode at in-between module sizes and any angle',
    { timeout: 60000 },
    async () => {
      for (const id of ['dotcode', 'gs1dotcode']) {
        const base = padded(await renderFormat(id, undefined, 10));
        for (const [px, angle] of [
          [4.4, 0],
          [2.4, 0],
          [3.6, 0],
          [4, 12],
          [4, 38],
        ]) {
          const img = degrade(base, { angle, scale: px / 10, blur: 0, noise: 0, contrast: 1 });
          const [r] = await scanImage(img as never, { lookFor: id });
          expect(r?.text, `${id} ${px}px ${angle}°`).toBe(sampleText(id));
        }
      }
    },
  );
  it('reads Han Xin turned past 25°', { timeout: 60000 }, async () => {
    const base = padded(await renderFormat('hanxin', undefined, 10));
    for (const angle of [30, 40]) {
      const img = degrade(base, { angle, scale: 0.4, blur: 0, noise: 0, contrast: 1 });
      const [r] = await scanImage(img as never, { lookFor: 'hanxin' });
      expect(r?.text, `${angle}°`).toBe(sampleText('hanxin'));
    }
  });
  it(
    'reads Ultracode turned, small, dim and next to other colours',
    { timeout: 60000 },
    async () => {
      const t = sampleText('ultracode');
      const base = padded(await renderFormat('ultracode', undefined, 2));
      for (const angle of [3, 20, 44]) {
        const [r] = await scanImage(turn(base, angle) as never, { lookFor: 'ultracode' });
        expect(r?.text, `${angle}°`).toBe(t);
      }
      const small = await renderFormat('ultracode', undefined, 1);
      expect((await scanImage(small as never, { lookFor: 'ultracode' }))[0]?.text, '2 px').toBe(t);
      const dim = { ...base, data: base.data.map((v, i) => (i % 4 === 3 ? v : 100 + v * 0.25)) };
      expect((await scanImage(dim as never, { lookFor: 'ultracode' }))[0]?.text, 'dim').toBe(t);
      const busy = padded(base, 1);
      for (let y = 20; y < 100; y++)
        for (let x = 20; x < 100; x++) busy.data.set([230, 30, 30], (y * busy.width + x) * 4);
      expect((await scanImage(busy as never, { lookFor: 'ultracode' }))[0]?.text, 'red patch').toBe(
        t,
      );
    },
  );
});

/** Images side by side on white, with gaps. */
function sideBySide(imgs: Img[], gap = 30): Img {
  const W = imgs.reduce((a, i) => a + i.width + gap, gap);
  const H = Math.max(...imgs.map((i) => i.height)) + 2 * gap;
  const data = new Uint8ClampedArray(W * H * 4).fill(255);
  let ox = gap;
  for (const img of imgs) {
    for (let y = 0; y < img.height; y++)
      data.set(
        img.data.subarray(y * img.width * 4, (y + 1) * img.width * 4),
        ((y + gap) * W + ox) * 4,
      );
    ox += img.width + gap;
  }
  return { data, width: W, height: H };
}

describe('round 2 fixes', () => {
  it('reads Code One where bwip-js leaves out an X12 unlatch mid-message', async () => {
    for (const t of ['************f>JS0IV', 'A*A*A*A*A*A*!AAAAAAA', 'W2Z*SN9SATFAf>JS0IV']) {
      const [r] = await scanImage((await renderFormat('codeone', t)) as never, {
        lookFor: 'codeone',
      });
      expect(r?.text, t).toBe(t);
    }
  });
  it('reads the smallest DotCode symbols', async () => {
    for (const t of ['Z', 'AB', '1234567890'])
      for (const s of [2, 3, 4]) {
        const [r] = await scanImage((await renderFormat('dotcode', t, s)) as never, {
          lookFor: 'dotcode',
        });
        expect(r?.text, `${t} @${s}`).toBe(t);
      }
  });
  it('finds a GS1 DotCode next to a plain one when GS1 DotCode is picked', async () => {
    const t = '(01)09521234543213(10)LOTA';
    const img = sideBySide([
      await renderFormat('dotcode', 'DotCode number A 12345'),
      await renderFormat('gs1dotcode', t),
    ]);
    const got = await scanImage(img as never, { lookFor: 'gs1dotcode' });
    expect(got.map((r) => r.text)).toEqual([t]);
  });
  it('reads six Han Xin codes in one picture', { timeout: 60000 }, async () => {
    const imgs = await Promise.all(
      [0, 1, 2, 3, 4, 5].map((k) => renderFormat('hanxin', `H${k}`, 2)),
    );
    const got = await scanImage(sideBySide(imgs) as never, { lookFor: 'hanxin' });
    expect(got.map((r) => r.text).sort()).toEqual(['H0', 'H1', 'H2', 'H3', 'H4', 'H5']);
  });
  it('collects two Code One codes turned upside down', { timeout: 60000 }, async () => {
    const pair = sideBySide([
      await renderFormat('codeone', 'TURN C1'),
      await renderFormat('codeone', 'TURN C2'),
    ]);
    const flipped = { ...pair, data: new Uint8ClampedArray(pair.data.length) };
    const px = pair.width * pair.height;
    for (let i = 0; i < px; i++)
      flipped.data.set(pair.data.subarray(i * 4, i * 4 + 4), (px - 1 - i) * 4);
    const got = await scanImage(flipped as never, { lookFor: 'codeone' });
    expect(got.map((r) => r.text).sort()).toEqual(['TURN C1', 'TURN C2']);
  });
  it('keeps a Code One next to a QR code with the same text', async () => {
    const img = sideBySide([
      await renderFormat('codeone', 'same text'),
      await renderFormat('qrcode', 'same text'),
    ]);
    const got = await scanImage(img as never, { lookFor: 'auto' });
    expect(got.map((r) => r.bcid).sort()).toEqual(['codeone', 'qrcode']);
  });
});

describe('scanning images', () => {
  const ids = ['codeone', 'hanxin', 'dotcode', 'gs1dotcode', 'ultracode'];
  it.each(ids)('reads %s when picked and in Everything mode', async (bcid) => {
    const img = await renderFormat(bcid);
    const [p] = await scanImage(img as never, { lookFor: bcid });
    expect(p?.text).toBe(sampleText(bcid));
    expect(p?.bcid).toBe(bcid);
    expect(p?.corners).toHaveLength(4);
    const [a] = await scanImage(img as never, { lookFor: 'auto' });
    expect(a?.bcid).toBe(bcid);
  });
  it.each(ids)('reads %s on a dark and a light page', async (bcid) => {
    for (const page of [22, 232]) {
      const [p] = await scanImage((await renderOnPage(bcid, page)) as never, { lookFor: bcid });
      expect(p?.text, `page ${page}`).toBe(sampleText(bcid));
    }
  });
  it.each(['codeone', 'hanxin', 'dotcode'])(
    'reads %s tilted, blurred and smaller',
    async (bcid) => {
      const img = degrade(await renderFormat(bcid, undefined, 4), {
        angle: 5,
        scale: 0.75,
        blur: 1,
      });
      const [p] = await scanImage(img as never, { lookFor: bcid });
      expect(p?.text).toBe(sampleText(bcid));
    },
  );
});
