// Every format the scanner can read, rendered by the generator with its
// default options: set to that format, the scanner must name it and return
// the data as typed; on "Everything" it must name it or list it under
// "Could also be".
import { describe, expect, it, vi } from 'vitest';
vi.mock('../src/scan/zxing', async () => (await import('./harness')).zxingMock());
vi.mock('../src/barcode/render', async () => (await import('./harness')).bwipMock());
const { scanImage } = await import('../src/scan/engine');
const { renderFormat, sampleText, degrade } = await import('./harness');
const { SCANNABLE, PICK_ONLY } = await import('../src/scan/targets');
const { code39FullAscii, deutschePostOk, gs1CheckOk, mod43, pznOk } =
  await import('../src/scan/identify');

const norm = (s: string) =>
  s
    .replace(/\^(CR|LF|FNC\d|\d{3})/g, '')
    .replace(/[^A-Za-z0-9]/g, '')
    .toUpperCase();
/** Formats read as another id that prints identical bars. */
const SAME: Record<string, string> = { industrial2of5: 'code2of5' };

describe('scanner names each format and returns the data as typed', () => {
  it.each([...SCANNABLE])('%s', async (bcid) => {
    const img = await renderFormat(bcid, undefined, 2);
    const [p] = await scanImage(img as never, { lookFor: bcid });
    expect(p, `${bcid}: nothing read`).toBeTruthy();
    expect(p.bcid).toBe(SAME[bcid] ?? bcid);
    expect(norm(p.text)).toBe(norm(sampleText(bcid)));
    if (PICK_ONLY.has(bcid) || bcid === 'gs1-cc') return;
    const [a] = await scanImage(img as never, { lookFor: 'auto' });
    expect(a, `${bcid}: nothing read on "Everything"`).toBeTruthy();
    const ids = [a.bcid, ...(a.alternatives ?? []).map((x) => x.bcid)];
    expect(ids, `${bcid} on "Everything": ${a.label}`).toContain(SAME[bcid] ?? bcid);
  });
});

describe('specific cases', () => {
  it('UPC-A is UPC-A, with EAN-13 as the alternative', async () => {
    const [a] = await scanImage((await renderFormat('upca')) as never, { lookFor: 'auto' });
    expect([a.label, a.text]).toEqual(['UPC-A', '012345000058']);
    expect(a.alternatives?.[0]).toMatchObject({ label: 'EAN-13', text: '0012345000058' });
  });
  it('an EAN-13 alone gets no add-on', async () => {
    const [a] = await scanImage((await renderFormat('ean13')) as never, { lookFor: 'auto' });
    expect(a.text).toBe('9520123456788');
  });
  it('Code 39 drops its check character, and says so', async () => {
    const [a] = await scanImage((await renderFormat('code39', 'THIS IS CODE 39')) as never, {
      lookFor: 'auto',
    });
    expect(a.text).toBe('THIS IS CODE 39');
    expect(a.details).toContainEqual(['Check character', 'Q']);
  });
  it('Interleaved 2 of 5 drops the check digit and the padding 0', async () => {
    const [a] = await scanImage((await renderFormat('interleaved2of5', '2401234567')) as never, {
      lookFor: 'auto',
    });
    expect(a.text).toBe('2401234567');
  });
  it('MaxiCode in a tilted photo', async () => {
    const img = degrade(await renderFormat('maxicode', undefined, 3), {
      angle: 7,
      scale: 1,
      blur: 1,
    });
    const [a] = await scanImage(img as never, { lookFor: 'maxicode' });
    expect(a?.bcid).toBe('maxicode');
  });
  it.each(['onecode', 'royalmail', 'postnet', 'auspost', 'japanpost', 'code16k', 'ean13composite'])(
    '%s in a tilted, blurred photo',
    async (bcid) => {
      const img = degrade(await renderFormat(bcid, undefined, 3), { angle: -6, scale: 1, blur: 1 });
      const [a] = await scanImage(img as never, { lookFor: bcid });
      expect(a?.bcid).toBe(bcid);
      expect(norm(a.text)).toBe(norm(sampleText(bcid)));
    },
  );
});

describe('fixes from the independent checks', () => {
  it.each(['12345678', '99887766', '2026', '00112233'])('Telepen Numeric %s', async (n) => {
    const img = await renderFormat('telepennumeric', n);
    const [p] = await scanImage(img as never, { lookFor: 'telepennumeric' });
    expect(p.text).toBe(n);
    const [a] = await scanImage(img as never, { lookFor: 'auto' });
    const all = [a, ...(a.alternatives ?? [])];
    expect(all.some((x) => x.bcid === 'telepennumeric' && x.text === n)).toBe(true);
  });
  it('MaxiCode text has real spaces and control characters', async () => {
    const [p] = await scanImage((await renderFormat('maxicode')) as never, { lookFor: 'maxicode' });
    expect(p.text).not.toMatch(/[\u2400-\u2421]/);
    expect(p.text).toContain('634 ALPHA DR');
  });
  it('the 2D composite part on its own has no garbage alternative', async () => {
    const [p] = await scanImage((await renderFormat('gs1-cc')) as never, { lookFor: 'gs1-cc' });
    expect(p.alternatives).toBeUndefined();
  });
  it('a GS1-128 composite has the same name in both modes', async () => {
    const img = await renderFormat('gs1-128composite');
    const [p] = await scanImage(img as never, { lookFor: 'gs1-128composite' });
    const [a] = await scanImage(img as never, { lookFor: 'auto' });
    expect(p.label).toBe('GS1-128 composite');
    expect(a.label).toBe('GS1-128 composite');
    expect(a.alternatives?.some((x) => x.bcid === a.bcid)).toBeFalsy();
  });
  it.each(['pharmacode2', 'daft', 'kix'])(
    '%s never returns a wrong value when tilted',
    async (bcid) => {
      for (const angle of [3, -4, 5, -7, 9]) {
        const img = degrade(await renderFormat(bcid, undefined, 3), { angle, scale: 1, blur: 1 });
        const r = await scanImage(img as never, { lookFor: bcid });
        if (r.length) expect(norm(r[0].text), `${bcid} at ${angle}°`).toBe(norm(sampleText(bcid)));
      }
    },
  );
});

describe('fixes from the robustness testers', () => {
  /** The label on a darker surface (a desk, a box): a grey border around the render. */
  const onSurface = (
    img: { data: Uint8ClampedArray; width: number; height: number },
    grey = 100,
    border = 60,
  ) => {
    const W = img.width + border * 2;
    const H = img.height + border * 2;
    const data = new Uint8ClampedArray(W * H * 4).fill(grey);
    for (let i = 3; i < data.length; i += 4) data[i] = 255;
    for (let y = 0; y < img.height; y++)
      data.set(
        img.data.subarray(y * img.width * 4, (y + 1) * img.width * 4),
        ((y + border) * W + border) * 4,
      );
    return { data, width: W, height: H };
  };
  it.each([
    'onecode',
    'royalmail',
    'postnet',
    'planet',
    'auspost',
    'japanpost',
    'kix',
    'pharmacode2',
    'daft',
  ])('%s on a darker surface', async (bcid) => {
    const img = onSurface(await renderFormat(bcid, undefined, 3));
    const [p] = await scanImage(img as never, { lookFor: bcid });
    expect(p?.bcid).toBe(bcid);
    expect(norm(p.text)).toBe(norm(sampleText(bcid)));
  });
  it('an add-on joined on without a space is read once', async () => {
    const { interpretations } = await import('../src/scan/identify');
    const [top] = interpretations(
      { label: 'EAN-13', text: '977031117500117' },
      { format: 'EAN13' },
    );
    expect(top).toMatchObject({ bcid: 'issn', text: '0311-175X 00 17' });
  });
});

describe('check helpers', () => {
  it('work on known values', () => {
    expect(mod43('THIS IS CODE 39')).toBe('Q');
    expect(code39FullAscii('C+O+D+E39 E+X+T/A')).toBe('Code39 Ext!');
    expect(deutschePostOk('563102430313')).toBe(true);
    expect(deutschePostOk('21348075016401')).toBe(true);
    expect(gs1CheckOk('09521234543213')).toBe(true);
    expect(pznOk('1234562')).toBe(true);
    expect(pznOk('1234563')).toBe(false);
  });
});
