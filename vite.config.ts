/// <reference types="vitest/config" />
import { defineConfig, type Plugin } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

// GitHub Pages serves a project site from /<repo-name>/. The deploy workflow
// passes that path in BASE_PATH (taken from actions/configure-pages), so the
// same config works for project sites, user sites and custom domains.
const base = normaliseBase(process.env.BASE_PATH ?? '/');

function normaliseBase(value: string): string {
  let b = value.trim() || '/';
  if (!b.startsWith('/')) b = `/${b}`;
  if (!b.endsWith('/')) b = `${b}/`;
  return b;
}

// GitHub Pages can't send HTTP headers, so the Content-Security-Policy goes in
// a <meta> tag. It is only added to production builds because the dev server
// needs inline scripts and a websocket for hot reload.
const CSP = [
  "default-src 'self'",
  // WebAssembly (the scanner's zxing-cpp engine) needs wasm-unsafe-eval; it does not allow JS eval.
  "script-src 'self' 'wasm-unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self' data: blob:",
  "worker-src 'self' blob:",
  "manifest-src 'self'",
  "media-src 'self' blob: mediastream:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'none'",
].join('; ');

function contentSecurityPolicy(): Plugin {
  return {
    name: 'inject-csp',
    apply: 'build',
    transformIndexHtml(html) {
      return html.replace(
        '<meta charset="UTF-8" />',
        `<meta charset="UTF-8" />\n    <meta http-equiv="Content-Security-Policy" content="${CSP}" />`,
      );
    },
  };
}

export default defineConfig({
  base,
  // The scanner runs in a module worker that lazy-loads zxing-cpp and bwip-js.
  worker: { format: 'es' },
  build: {
    target: 'es2022',
    sourcemap: true,
    chunkSizeWarningLimit: 1500,
  },
  plugins: [
    contentSecurityPolicy(),
    VitePWA({
      registerType: 'prompt',
      injectRegister: false,
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'QR & Barcode Studio',
        // Lets the installed app open straight to the scanner from a long-press on its icon.
        shortcuts: [{ name: 'Scan a code', short_name: 'Scan', url: './#scan' }],
        short_name: 'Codes',
        description: 'Make QR codes and barcodes in your browser. Nothing is uploaded.',
        theme_color: '#1b2a41',
        background_color: '#e6ebee',
        display: 'standalone',
        start_url: '.',
        scope: '.',
        icons: [
          { src: 'pwa-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'pwa-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // bwip-js and jsPDF are large; cache them so the app works offline.
        maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
        globPatterns: ['**/*.{js,css,html,svg,png,woff2,txt,wasm}'],
        // jsPDF's optional HTML/SVG helpers are never used by this app.
        globIgnores: ['**/html2canvas-*.js', '**/purify.es-*.js', '**/index.es-*.js'],
        navigateFallback: 'index.html',
      },
    }),
  ],
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
