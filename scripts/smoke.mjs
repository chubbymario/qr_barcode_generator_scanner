// Browser smoke test: serves the built site, drives every tab in headless
// Chrome, downloads real files and checks they scan back.
//
//   npm run build && npm run test:e2e
//
// Env: CHROME_PATH (defaults to the usual Chrome locations), BASE_PATH (must
// match the build), SCREENSHOTS=1 to save screenshots into ./screenshots.

import { spawn } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import puppeteer from 'puppeteer-core';
import { PNG } from 'pngjs';
import bwipNode from 'bwip-js/node';
import { prepareZXingModule, readBarcodes } from 'zxing-wasm/reader';

const require = createRequire(import.meta.url);
const root = new URL('..', import.meta.url).pathname;
const base = process.env.BASE_PATH ?? '/';
const port = 4173;
const url = `http://localhost:${port}${base}`;
const shots = process.env.SCREENSHOTS ? join(root, 'screenshots') : null;
if (shots) mkdirSync(shots, { recursive: true });

const chromePath =
  process.env.CHROME_PATH ??
  [
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  ].find((p) => existsSync(p));
if (!chromePath) {
  console.error('Chrome not found. Set CHROME_PATH.');
  process.exit(1);
}

prepareZXingModule({
  overrides: {
    wasmBinary: readFileSync(require.resolve('zxing-wasm/reader/zxing_reader.wasm')).buffer,
  },
  fireImmediately: true,
});
async function decode(file) {
  const results = await readBarcodes(new Uint8Array(readFileSync(file)), { tryHarder: true });
  const ok = results.find((r) => r.isValid);
  if (!ok) throw new Error(`Could not scan ${file}`);
  return ok.text;
}

let failures = 0;
const check = (ok, label) => {
  console.log(`${ok ? '✓' : '✗'} ${label}`);
  if (!ok) failures++;
};

// Run Vite directly (not through npx) so server.kill() stops the server itself.
const viteBin = join(root, 'node_modules', 'vite', 'bin', 'vite.js');
const server = spawn(
  process.execPath,
  [viteBin, 'preview', '--port', String(port), '--strictPort'],
  {
    cwd: root,
    env: { ...process.env, BASE_PATH: base },
    stdio: ['ignore', 'pipe', 'inherit'],
  },
);
await new Promise((resolve, reject) => {
  server.stdout.on('data', (d) => String(d).includes('Local') && resolve());
  server.on('exit', (code) => reject(new Error(`preview exited ${code}`)));
  setTimeout(() => reject(new Error('preview did not start')), 20000);
});

const downloads = mkdtempSync(join(tmpdir(), 'qr-smoke-'));

// A fake camera: one video frame with a QR code on a light grey background.
const CAMERA_TEXT = 'https://example.org/from-the-camera';
const camPng = PNG.sync.read(
  await bwipNode.toBuffer({
    bcid: 'qrcode',
    text: CAMERA_TEXT,
    scale: 6,
    padding: 4,
    backgroundcolor: 'FFFFFF',
  }),
);
const W = 640;
const H = 480;
const y4m = join(downloads, 'camera.y4m');
{
  const Y = Buffer.alloc(W * H, 200);
  const ox = (W - camPng.width) >> 1;
  const oy = (H - camPng.height) >> 1;
  for (let y = 0; y < camPng.height; y++)
    for (let x = 0; x < camPng.width; x++) {
      const i = (y * camPng.width + x) * 4;
      Y[(oy + y) * W + ox + x] = Math.round(
        camPng.data[i] * 0.299 + camPng.data[i + 1] * 0.587 + camPng.data[i + 2] * 0.114,
      );
    }
  const UV = Buffer.alloc((W / 2) * (H / 2) * 2, 128);
  writeFileSync(
    y4m,
    Buffer.concat([Buffer.from(`YUV4MPEG2 W${W} H${H} F15:1 Ip A1:1 C420jpeg\nFRAME\n`), Y, UV]),
  );
}

const browser = await puppeteer.launch({
  executablePath: chromePath,
  headless: true,
  args: [
    '--no-sandbox',
    '--disable-gpu',
    '--window-size=1400,1000',
    '--use-fake-ui-for-media-stream',
    '--use-fake-device-for-media-stream',
    `--use-file-for-fake-video-capture=${y4m}`,
  ],
});

try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1400, height: 1000 });
  const errors = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(e.message));
  // Capture downloads inside the page: Chrome blocks repeated automatic
  // downloads in headless mode, and this avoids the file system entirely.
  let saved = 0;
  await page.exposeFunction('__saveDownload', (name, b64) => {
    const file = join(downloads, `${++saved}-${name}`);
    writeFileSync(file, Buffer.from(b64, 'base64'));
  });
  await page.evaluateOnNewDocument(() => {
    const click = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () {
      if (!this.download) return click.call(this);
      const name = this.download;
      fetch(this.href)
        .then((r) => r.arrayBuffer())
        .then((buf) => {
          let bin = '';
          const bytes = new Uint8Array(buf);
          for (let i = 0; i < bytes.length; i += 0x8000)
            bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
          window.__saveDownload(name, btoa(bin));
        });
    };
  });

  const waitForDownload = async (ext, before) => {
    for (let i = 0; i < 150; i++) {
      const files = readdirSync(downloads).filter((f) => !before.includes(f));
      const hit = files.find((f) => f.endsWith(ext));
      if (hit) return join(downloads, hit);
      await new Promise((r) => setTimeout(r, 100));
    }
    const toast = await page
      .$eval('#toast', (t) => (t.hidden ? '' : t.textContent))
      .catch(() => '');
    throw new Error(`No download ending in ${ext}${toast ? ` (page says: ${toast})` : ''}`);
  };
  const clickAndDownload = async (label, ext) => {
    const before = readdirSync(downloads);
    await page.evaluate((t) => {
      const btn = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === t);
      if (!btn) throw new Error(`No button "${t}"`);
      btn.click();
    }, label);
    return waitForDownload(ext, before);
  };
  const shot = async (name) =>
    shots && page.screenshot({ path: join(shots, `${name}.png`), fullPage: false });
  const setValue = (selector, value) =>
    page.evaluate(
      (s, v) => {
        const el = document.querySelector(s);
        el.value = v;
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      },
      selector,
      value,
    );
  const settle = () => new Promise((r) => setTimeout(r, 600));
  // Pick a format in a searchable dropdown the way a person would: type, then Enter.
  const pickFormat = async (selector, query) => {
    await page.click(selector, { clickCount: 3 });
    await page.keyboard.type(query);
    await page.keyboard.press('Enter');
    await settle();
  };

  // ---------- QR ----------
  await page.goto(url, { waitUntil: 'networkidle0' });
  await page.waitForSelector('.art svg');
  check(true, 'QR preview renders');
  const csp = await page
    .$eval('meta[http-equiv="Content-Security-Policy"]', (m) => m.content)
    .catch(() => null);
  check(!!csp, 'Content-Security-Policy meta tag present');
  await setValue('.fields input', 'https://example.org/smoke');
  await settle();
  await shot('1-qr');
  const qrPng = await clickAndDownload('Download', '.png');
  check((await decode(qrPng)) === 'https://example.org/smoke', 'QR PNG download scans');

  // Logo upload + styling
  const fileInput = await page.$('input[type="file"]');
  await fileInput.uploadFile(join(root, 'public', 'pwa-512.png'));
  await page.waitForSelector('.logo-thumb');
  await page.evaluate(() =>
    [...document.querySelectorAll('.chips button')].find((b) => b.textContent === 'Dotted').click(),
  );
  await settle();
  await shot('2-qr-logo');
  const logoPng = await clickAndDownload('Download', '.png');
  check((await decode(logoPng)) === 'https://example.org/smoke', 'Styled QR with logo scans');

  // SVG and PDF exports
  await page.evaluate(() =>
    [...document.querySelectorAll('.segmented label')]
      .find((l) => l.textContent === 'SVG')
      .querySelector('input')
      .click(),
  );
  await settle();
  const svg = readFileSync(await clickAndDownload('Download', '.svg'), 'utf8');
  const svgOk = /<svg[^>]+width="40mm"/.test(svg);
  check(svgOk, `QR SVG is exactly 40 mm${svgOk ? '' : ` (${svg.slice(0, 160)})`}`);
  await page.evaluate(() =>
    [...document.querySelectorAll('.segmented label')]
      .find((l) => l.textContent === 'PDF')
      .querySelector('input')
      .click(),
  );
  await settle();
  const pdf = readFileSync(await clickAndDownload('Download', '.pdf'));
  check(pdf.subarray(0, 5).toString() === '%PDF-', 'QR PDF download');
  await page.evaluate(() =>
    [...document.querySelectorAll('.segmented label')]
      .find((l) => l.textContent === 'PNG')
      .querySelector('input')
      .click(),
  );

  // ---------- Barcodes ----------
  await page.click('#tab-barcode');
  await page.waitForSelector('#barcode-format', { timeout: 15000 });
  await page.waitForSelector('.art svg', { timeout: 15000 });
  // The format dropdown searches by name as you type.
  await page.click('#barcode-format', { clickCount: 3 });
  await page.keyboard.type('intelligent mail');
  const matches = await page.$$eval('#barcode-format ~ .combo-list .combo-option', (l) =>
    l.map((o) => o.textContent),
  );
  check(
    matches.length >= 1 && /Intelligent Mail/i.test(matches[0]),
    `Format search finds "${matches[0]}" (${matches.length} matches)`,
  );
  await shot('3a-format-search');
  await page.keyboard.press('Escape');
  await pickFormat('#barcode-format', 'ean13');
  await settle();
  await setValue('#barcode-data', '590123412345');
  await settle();
  await shot('3-barcode');
  const eanFile = await clickAndDownload('Download', '.png');
  const ean = await decode(eanFile).catch((e) => e.message);
  check(ean.startsWith('5901234123457'), `EAN-13 PNG scans with computed check digit (${ean})`);

  await pickFormat('#barcode-format', 'datamatrix');
  await settle();
  await setValue('#barcode-data', 'DM-SMOKE-42');
  await settle();
  check(
    (await decode(await clickAndDownload('Download', '.png'))) === 'DM-SMOKE-42',
    'Data Matrix PNG scans',
  );

  await pickFormat('#barcode-format', 'code128');
  await settle();
  await setValue('#barcode-data', 'ABC-123');
  await settle();
  check(
    (await decode(await clickAndDownload('Download', '.png'))) === 'ABC-123',
    'Code 128 PNG scans',
  );

  await pickFormat('#barcode-format', 'ean13');
  await settle();
  await setValue('#barcode-data', '12345');
  await settle();
  const err = await page.$eval('.status', (e) => e.textContent);
  check(/EAN-13/i.test(err) && !/bwipp\./.test(err), `Readable validation error: "${err}"`);

  // Barcodes that only the app's own decoders read, for the scanner test below.
  const extraFiles = {};
  for (const [bcid, text] of [
    ['msi', '0123456789'],
    ['onecode', '01234567094987654321012345678'],
    ['channelcode', '3493'],
    ['royalmail', 'LE28HS9Z'],
    ['code16k', 'Code 16K smoke test 123'],
    ['code49', 'CODE 49 SMOKE'],
    ['codablockf', 'Codablock F reads as one message, not rows'],
    ['posicode', 'PosiCode 42'],
    ['ean13composite', '9520123456788|(99)1234-abcd'],
  ]) {
    await pickFormat('#barcode-format', bcid);
    await settle();
    await setValue('#barcode-data', text);
    await settle();
    extraFiles[bcid] = [await clickAndDownload('Download', '.png'), text];
    if (shots) writeFileSync(join(shots, `extra-${bcid}.png`), readFileSync(extraFiles[bcid][0]));
  }

  // ---------- Batch ----------
  await page.click('#tab-batch');
  await page.waitForSelector('table');
  await shot('4-batch');
  const zip = await clickAndDownload('Make ZIP', '.zip');
  const JSZip = (await import('jszip')).default;
  const files = Object.keys((await JSZip.loadAsync(readFileSync(zip))).files);
  check(files.length === 3 && files.includes('home.png'), `Batch ZIP contains ${files.join(', ')}`);

  // ---------- Label sheets ----------
  await page.click('#tab-print');
  await page.waitForSelector('.sheet-page img', { timeout: 15000 });
  const imgs = await page.$$eval('.sheet-page img', (l) => l.length);
  check(imgs === 21, `Label sheet preview shows ${imgs} codes`);
  await shot('5-labels');
  const sheet = readFileSync(await clickAndDownload('Download PDF', '.pdf'));
  check(sheet.subarray(0, 5).toString() === '%PDF-', 'Label sheet PDF download');

  // ---------- Scanner: images ----------
  await page.click('#tab-scan');
  await page.waitForSelector('.scan-viewport');
  await page.evaluate(() =>
    [...document.querySelectorAll('.segmented label')]
      .find((l) => l.textContent === 'Image file')
      .querySelector('input')
      .click(),
  );
  await page.waitForSelector('.scan-viewport.image');
  const scanFile = async (file) => {
    await page.evaluate(() => (document.querySelector('.scan-results').innerHTML = ''));
    const input = await page.$(
      '.scan-viewport ~ * input[type="file"], .panel-body input[type="file"]',
    );
    await input.uploadFile(file);
    await page.waitForFunction(
      () =>
        document.querySelector('.scan-card') ||
        /No code|couldn/.test(document.querySelector('.scan-stage .status')?.textContent ?? ''),
      { timeout: 20000 },
    );
    return page.$$eval('.scan-card', (cards) =>
      cards.map((c) => ({
        label: c.querySelector('h3').textContent,
        text: c.querySelector('pre').textContent,
      })),
    );
  };
  await page.click('#scan-format');
  await shot('7a-scan-formats');
  await page.keyboard.press('Escape');
  const scanFormat = await page.$eval('#scan-format', (e) => e.value);
  check(scanFormat === 'QR Code', `Scanner defaults to QR codes ("${scanFormat}")`);
  const qrRead = await scanFile(logoPng);
  check(
    qrRead[0]?.text === 'https://example.org/smoke' && qrRead[0].label === 'QR code',
    `Scanner reads the styled QR with a logo (${JSON.stringify(qrRead[0])})`,
  );
  await shot('7-scan-image');
  const qrOnly = await scanFile(eanFile);
  check(qrOnly.length === 0, 'The QR scanner ignores an EAN-13');
  await pickFormat('#scan-format', 'ean13');
  const eanRead = await scanFile(eanFile);
  check(
    eanRead[0]?.text === '5901234123457',
    `Scanner reads EAN-13 (${JSON.stringify(eanRead[0])})`,
  );
  for (const [bcid, [file, text]] of Object.entries(extraFiles)) {
    await pickFormat('#scan-format', bcid);
    const r = await scanFile(file);
    check(r[0]?.text === text, `Scanner set to ${bcid} reads it (${JSON.stringify(r[0])})`);
  }
  await pickFormat('#scan-format', 'everything');
  for (const bcid of ['msi', 'onecode', 'code16k', 'ean13composite']) {
    const [file, text] = extraFiles[bcid];
    const r = await scanFile(file);
    check(r[0]?.text === text, `"Everything" reads ${bcid} (${JSON.stringify(r[0])})`);
  }
  const pharma = await scanFile(extraFiles.channelcode[0]);
  check(pharma.length === 0, '"Everything" leaves pick-only formats (Channel Code) alone');
  await pickFormat('#scan-format', 'qrcode');

  // ---------- Scanner: camera ----------
  await page.evaluate(() =>
    [...document.querySelectorAll('.segmented label')]
      .find((l) => l.textContent === 'Camera')
      .querySelector('input')
      .click(),
  );
  await page.waitForSelector('.scan-viewport.camera');
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find(
      (x) => x.textContent === 'Start camera' && !x.hidden,
    );
    b?.click();
  });
  await page.waitForSelector('.scan-card', { timeout: 20000 });
  const cam = await page.$eval('.scan-card pre', (e) => e.textContent);
  check(cam === CAMERA_TEXT, `Live camera scan reads the QR code (${cam})`);
  await shot('8-scan-camera');
  const camStopped = await page.$eval('.scan-viewport', (v) => !v.classList.contains('live'));
  check(camStopped, 'Camera stops after a find');

  // ---------- Mobile + dark ----------
  await page.click('#tab-qr');
  await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'dark' }]);
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });
  await settle();
  await shot('6-mobile-dark');

  // ---------- Footer: licences, clear cache ----------
  await page.setViewport({ width: 1280, height: 900 });
  const footerButton = (label) =>
    page.evaluate((l) => {
      [...document.querySelectorAll('footer button')].find((b) => b.textContent === l).click();
    }, label);
  await footerButton('Licences');
  await page.waitForFunction(
    () => /zxing-cpp/.test(document.querySelector('.licence-text')?.textContent ?? ''),
    { timeout: 10000 },
  );
  const lic = await page.$eval('.licence-text', (e) => e.textContent);
  check(
    /BSD Zero Clause|0BSD/i.test(lic) && /Apache License/.test(lic) && /bwip-js/i.test(lic),
    `Licences dialog shows the app licence and third-party notices (${lic.length} chars)`,
  );
  await shot('9-licences');
  await page.keyboard.press('Escape');
  await Promise.all([
    page.waitForNavigation({ timeout: 20000 }),
    footerButton('Clear cache and reload'),
  ]);
  await page.waitForFunction(() => /latest version/.test(document.body.textContent), {
    timeout: 10000,
  });
  const after = await page.evaluate(async () => ({
    url: location.href,
    caches: 'caches' in self ? (await caches.keys()).length : 0,
  }));
  check(
    !/refresh=/.test(after.url),
    `Clear cache and reload: page reloaded and confirmed (${after.url}, ${after.caches} caches rebuilt)`,
  );

  const real = errors.filter((e) => !/favicon|manifest|service worker/i.test(e));
  check(real.length === 0, `No console errors${real.length ? `: ${real.join(' | ')}` : ''}`);
} catch (e) {
  console.error(e);
  failures++;
} finally {
  await browser.close();
  server.kill();
  rmSync(downloads, { recursive: true, force: true });
}

console.log(failures ? `\n${failures} check(s) failed` : '\nAll browser checks passed');
process.exit(failures ? 1 : 0);
