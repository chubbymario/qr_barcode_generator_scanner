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
