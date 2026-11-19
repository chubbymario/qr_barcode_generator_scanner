// Every format the scanner can read, rendered by the generator with its
// default options: set to that format, the scanner must name it and return
// the data as typed; on "Everything" it must name it or list it under
// "Could also be".
import { describe, expect, it, vi } from 'vitest';
vi.mock('../src/scan/zxing', async () => (await import('./harness')).zxingMock());
vi.mock('../src/barcode/render', async () => (await import('./harness')).bwipMock());
const { scanImage } = await import('../src/scan/engine');
const { renderFormat, renderOnPage, sampleText, degrade } = await import('./harness');
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

// The Barcode tab shows the code with only its own quiet zone, on the page's
// colour (light grey, or nearly black in the dark theme). A screenshot or a
// photo of the screen looks like this, not like a code on a white sheet.
describe('as shown on the page', () => {
  const PAGES = [
    ['dark page', 22],
    ['light page', 232],
  ] as const;
  it.each([...SCANNABLE].flatMap((id) => PAGES.map(([n, v]) => [id, n, v] as const)))(
    '%s on a %s',
    async (bcid, _, page) => {
      const img = await renderOnPage(bcid, page);
      const [p] = await scanImage(img as never, { lookFor: bcid });
      expect(p, `${bcid}: nothing read`).toBeTruthy();
      expect(norm(p.text)).toBe(norm(sampleText(bcid)));
      if (PICK_ONLY.has(bcid) || bcid === 'gs1-cc') return;
      const a = await scanImage(img as never, { lookFor: 'auto' });
      const all = a.flatMap((r) => [r, ...(r.alternatives ?? [])]);
      expect(all.some((x) => norm(x.text) === norm(sampleText(bcid)))).toBe(true);
    },
  );
  it('MaxiCode with only a thin quiet zone, on a dark page', async () => {
    for (const q of [1, 2]) {
      const img = await renderOnPage('maxicode', 22, 3, undefined, { quietZone2D: q });
      const [p] = await scanImage(img as never, { lookFor: 'maxicode' });
      expect(p?.bcid, `quiet zone ${q}`).toBe('maxicode');
      const [a] = await scanImage(img as never, { lookFor: 'auto' });
      expect(a?.bcid, `quiet zone ${q}, Everything`).toBe('maxicode');
    }
  });
  it('MaxiCode with size marks and a caption around it, as on the Barcode tab', async () => {
    for (const page of [22, 232]) {
      const img = await renderOnPage('maxicode', page, 3);
      const set = (x: number, y: number, v: number) => {
        if (x < 0 || y < 0 || x >= img.width || y >= img.height) return;
        const i = (y * img.width + x) * 4;
        img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
      };
      // Size marks 12 px outside the code's own image, and a line of "text" below it.
      for (let x = 30; x < img.width - 30; x++) set(x, 18, 120);
      for (let y = 30; y < img.height - 30; y++) set(18, y, 120);
      for (let x = 60; x < img.width - 60; x += 7)
        for (let y = img.height - 24; y < img.height - 14; y++)
          for (let k = 0; k < 3; k++) set(x + k, y, 90);
      const [p] = await scanImage(img as never, { lookFor: 'maxicode' });
      expect(p?.bcid, `page ${page}`).toBe('maxicode');
    }
  });
  it('2D quiet zones are measured in modules', async () => {
    const { quietZone } = await import('../src/barcode/options');
    const { defaultState } = await import('../src/state');
    const b = defaultState().barcode;
    expect(quietZone({ ...b, bcid: 'maxicode', quietZone2D: 4 })).toEqual({
      paddingwidth: 16,
      paddingheight: 16,
    });
    expect(quietZone({ ...b, bcid: 'qrcode', quietZone2D: 4 })).toEqual({
      paddingwidth: 8,
      paddingheight: 8,
    });
    expect(quietZone({ ...b, bcid: 'code128', paddingModules: 10 })).toEqual({
      paddingwidth: 10,
      paddingheight: 5,
    });
  });
});

describe('generator settings people actually use', () => {
  const INVERT = { barcolor: '#FFFFFF', backgroundcolor: '#000000' };
  it.each(['L', 'I', 'R'])('MaxiCode turned %s', async (rotate) => {
    const img = await renderOnPage('maxicode', 232, 3, undefined, { rotate: rotate as 'L' });
    expect((await scanImage(img as never, { lookFor: 'maxicode' }))[0]?.bcid).toBe('maxicode');
  });
  it.each([
    'code128',
    'ean13',
    'code39',
    'interleaved2of5',
    'databaromni',
    'code16k',
    'postnet',
    'msi',
  ])('%s in white on black', async (bcid) => {
    const img = await renderOnPage(bcid, 232, 3, undefined, INVERT);
    const [a] = await scanImage(img as never, { lookFor: 'auto' });
    expect(norm(a?.text ?? '')).toBe(norm(sampleText(bcid)));
  });
  it('an inverted DataBar composite is not read inside out (a different valid GTIN)', async () => {
    const img = await renderOnPage('databarstackedomnicomposite', 232, 3, undefined, INVERT);
    for (const r of await scanImage(img as never, { lookFor: 'auto' }))
      expect(r.text.startsWith('(01)03612345678904')).toBe(true);
  });
  it.each(
    ['R', 'L'].flatMap((rotate) =>
      ['ean13composite', 'databaromnicomposite', 'gs1-128composite'].map((id) => [id, rotate]),
    ),
  )('%s turned %s keeps its 2D part', async (bcid, rotate) => {
    const img = await renderOnPage(bcid, 232, 3, undefined, { rotate: rotate as 'L' });
    const [p] = await scanImage(img as never, { lookFor: bcid });
    expect(norm(p?.text ?? '')).toBe(norm(sampleText(bcid)));
  });
  it('several codes in one picture are all found, nothing else', async () => {
    const parts = await Promise.all(
      ['qrcode', 'maxicode', 'postnet', 'code128'].map((id) => renderOnPage(id, 232, 3)),
    );
    const W = parts.reduce((a, p) => a + p.width, 0);
    const H = Math.max(...parts.map((p) => p.height));
    const data = new Uint8ClampedArray(W * H * 4).fill(232);
    for (let i = 3; i < data.length; i += 4) data[i] = 255;
    let ox = 0;
    for (const p of parts) {
      for (let y = 0; y < p.height; y++)
        data.set(p.data.subarray(y * p.width * 4, (y + 1) * p.width * 4), (y * W + ox) * 4);
      ox += p.width;
    }
    const r = await scanImage({ data, width: W, height: H } as never, { lookFor: 'auto' });
    expect(r.map((x) => x.bcid).sort()).toEqual(['code128', 'maxicode', 'postnet', 'qrcode']);
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
