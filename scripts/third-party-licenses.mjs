// Collects the licence text of every runtime dependency into
// dist/THIRD_PARTY_LICENSES.txt. The bundled libraries are MIT-licensed (and
// JSZip is MIT or GPLv3, used here under MIT), which requires shipping their
// copyright notices with the built site. Runs automatically after `npm run build`.

import { execSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const tree = JSON.parse(
  execSync('npm ls --omit=dev --all --json', { cwd: root, encoding: 'utf8' }),
);

const seen = new Map();
function walk(deps = {}) {
  for (const [name, info] of Object.entries(deps)) {
    const key = `${name}@${info.version}`;
    if (!seen.has(key) && info.version) seen.set(key, name);
    walk(info.dependencies);
  }
}
walk(tree.dependencies);

const sections = [];
for (const [key, name] of [...seen.entries()].sort()) {
  const dir = join(root, 'node_modules', name);
  if (!existsSync(dir)) continue;
  const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
  const licenseFiles = readdirSync(dir).filter((f) => /^(licen[cs]e|copying|notice)/i.test(f));
  const texts = licenseFiles.map((f) => readFileSync(join(dir, f), 'utf8').trim());
  sections.push(
    [
      '='.repeat(72),
      `${key}`,
      `License: ${typeof pkg.license === 'string' ? pkg.license : JSON.stringify(pkg.license ?? 'see below')}`,
      pkg.homepage ? `Homepage: ${pkg.homepage}` : null,
      '='.repeat(72),
      texts.join('\n\n') || '(No licence file included in the package.)',
    ]
      .filter(Boolean)
      .join('\n'),
  );
}

// zxing-wasm (MIT) contains zxing-cpp compiled to WebAssembly, which is
// Apache-2.0 licensed; its licence text isn't in the npm package, so add it.
sections.push(
  [
    '='.repeat(72),
    'zxing-cpp (compiled into zxing_reader.wasm, shipped by zxing-wasm)',
    'License: Apache-2.0',
    'Homepage: https://github.com/zxing-cpp/zxing-cpp',
    'Copyright the ZXing authors and zxing-cpp contributors.',
    '='.repeat(72),
    readFileSync(join(root, 'scripts', 'licenses', 'apache-2.0.txt'), 'utf8').trim(),
  ].join('\n'),
);

const header = `Third-party software included in QR & Barcode Studio
Generated ${new Date().toISOString().slice(0, 10)} from the installed packages.

The app's own code is under the 0BSD licence (see LICENSE in the repository).
The font is Archivo (SIL Open Font License 1.1) via @fontsource.
Pattern tables for USPS Intelligent Mail and Channel Code in src/scan/extra/tables.ts
are copied from BWIPP (bwip-js, MIT).

`;
const out = header + sections.join('\n\n') + '\n';
const target = join(root, 'dist', 'THIRD_PARTY_LICENSES.txt');
if (existsSync(join(root, 'dist'))) {
  writeFileSync(target, out);
  console.log(`Wrote ${sections.length} licences to dist/THIRD_PARTY_LICENSES.txt`);
} else {
  process.stdout.write(out);
}
