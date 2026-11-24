// The app's own 2D decoders: Code One, Han Xin, DotCode and Ultracode.

import { rotate90, rotateBy, type Luma } from '../extra/lines';
import { codeOneData, readCodeOne } from './codeone';
import { readHanXin } from './hanxin';
import { readDotCode } from './dotcode';
import { readUltracode, type Rgba } from './ultracode';

export { TWOD_FORMATS } from '../lists';

type Pt = { x: number; y: number };

export interface TwoDResult {
  bcid: string;
  text: string;
  corners?: Pt[];
  details?: [string, string][];
  /** Code One readings to check by encoding them again (see codeone.ts). */
  check?: { version: string; data: number[]; candidates: string[] };
}

/**
 * Settle a Code One read that has other possible readings. bwip-js (the app's
 * generator) can give two texts the very same codewords, so an alternative
 * that re-encodes to this symbol's data codewords is taken: the slip it
 * corrects is far more common than the coincidence it would hide (unless it
 * brings in control characters). Otherwise the reading by the specification
 * stands.
 */
export function settleCodeOne(
  check: NonNullable<TwoDResult['check']>,
  encode: (text: string, opts: string) => { pixs: number[]; pixx: number; pixy: number } | null,
): string {
  const same = (t: string, opts: string) => {
    const raw = encode(t, opts);
    const data = raw && codeOneData(raw.pixs, raw.pixy, raw.pixx);
    return !!data && data.length === check.data.length && data.every((v, i) => v === check.data[i]);
  };
  // Control characters are rare in real text: a reading with more of them
  // than the specification's reading is the coincidence, not the slip.
  // eslint-disable-next-line no-control-regex
  const odd = (t: string) => (t.match(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g) ?? []).length;
  const first = check.candidates[0];
  for (const t of check.candidates.slice(1))
    if (odd(t) <= odd(first) && (same(t, '') || same(t, `version=${check.version}`))) return t;
  return first;
}

/**
 * Code One is found by its full-width bars, read along rows: try each quarter
 * turn, then small tilts either way (a straightened copy is tried separately,
 * but its skew estimate can miss a small code in a big frame).
 */
function codeOne(l: Luma, thorough: boolean) {
  // Corners found in a turned copy, mapped back to the image.
  let img = l;
  let back = (p: Pt) => p;
  for (let turn = 0; turn < 4; turn++) {
    const r = readCodeOne(img);
    if (r) return { ...r, corners: r.corners?.map(back) };
    // rotate90 puts source (x, y) at (h − y, x), with h the source height.
    const h = img.height;
    const prev = back;
    back = (p) => prev({ x: p.y, y: h - p.x });
    img = rotate90(img);
  }
  for (const deg of thorough ? [1.5, -1.5, 3, -3] : []) {
    const r = readCodeOne(rotateBy(l, deg));
    if (r) return { ...r, corners: r.corners?.map((p) => unturn(l, deg, p)) };
  }
  return null;
}

/** Where rotateBy(l, deg) took the pixel at p from. */
function unturn(l: Luma, deg: number, p: Pt): Pt {
  const a = (deg * Math.PI) / 180;
  const cx = l.width / 2;
  const cy = l.height / 2;
  return {
    x: cx + (p.x - cx) * Math.cos(a) - (p.y - cy) * Math.sin(a),
    y: cy + (p.x - cx) * Math.sin(a) + (p.y - cy) * Math.cos(a),
  };
}

/**
 * Han Xin's finder search runs along rows and columns, which works to about
 * 25° of turn; beyond that, copies turned 45° and 22.5° bring it back in range.
 */
function hanXin(l: Luma, thorough: boolean) {
  const r = readHanXin(l);
  if (r) return r;
  for (const deg of thorough ? [45, 22.5] : []) {
    const t = readHanXin(rotateBy(l, deg));
    if (t) return { ...t, corners: t.corners?.map((p) => unturn(l, deg, p)) };
  }
  return null;
}

/** One reader per format, on a grey image. */
const READERS: [
  string,
  (
    l: Luma,
    only: string | undefined,
    thorough: boolean,
  ) => (TwoDResult & { skip?: boolean }) | null,
][] = [
  [
    'hanxin',
    (l, _only, thorough) => {
      const r = hanXin(l, thorough);
      return (
        r && {
          bcid: 'hanxin',
          text: r.text,
          corners: r.corners,
          details: [
            ['Version', String(r.version)],
            ['Error correction', `L${r.ecLevel}`],
          ],
        }
      );
    },
  ],
  [
    'dotcode',
    (l, only) => {
      const r = readDotCode(l);
      if (!r) return null;
      const gs1 = r.gs1 !== undefined;
      return {
        // Picking GS1 DotCode: a plain DotCode is passed over (but masked).
        skip: only === 'gs1dotcode' && !gs1,
        bcid: gs1 ? 'gs1dotcode' : 'dotcode',
        text: r.gs1 ?? r.text,
        corners: r.corners,
        details: [['Size', `${r.rows} × ${r.cols} dots`]],
      };
    },
  ],
  [
    'codeone',
    (l, _only, thorough) => {
      const r = codeOne(l, thorough);
      return (
        r && {
          bcid: 'codeone',
          text: r.text,
          corners: r.corners,
          details: [['Version', r.version]],
          ...(r.alternatives && r.data
            ? {
                check: {
                  version: r.version,
                  data: r.data,
                  candidates: [r.text, ...r.alternatives],
                },
              }
            : {}),
        }
      );
    },
  ],
];

/** Blank out a found code (its corners' box, a little wider) in a copy. */
function maskGrey(l: Luma, c: Pt[]): Luma {
  const data = new Uint8Array(l.data);
  const [x0, y0, x1, y1] = box(c, l.width, l.height);
  for (let y = y0; y <= y1; y++) data.fill(255, y * l.width + x0, y * l.width + x1 + 1);
  return { data, width: l.width, height: l.height };
}
function maskRgba(img: Rgba, c: Pt[]): Rgba {
  const data = new Uint8ClampedArray(img.data as ArrayLike<number>);
  const [x0, y0, x1, y1] = box(c, img.width, img.height);
  for (let y = y0; y <= y1; y++)
    data.fill(255, (y * img.width + x0) * 4, (y * img.width + x1 + 1) * 4);
  return { data, width: img.width, height: img.height };
}
function box(c: Pt[], w: number, h: number) {
  const xs = c.map((p) => p.x);
  const ys = c.map((p) => p.y);
  const pad =
    Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) * 0.06 + 3;
  return [
    Math.max(0, Math.floor(Math.min(...xs) - pad)),
    Math.max(0, Math.floor(Math.min(...ys) - pad)),
    Math.min(w - 1, Math.ceil(Math.max(...xs) + pad)),
    Math.min(h - 1, Math.ceil(Math.max(...ys) + pad)),
  ];
}

/**
 * Look for these formats (or one, with `only`). `views` are grey copies to
 * try in turn (the image, then a straightened copy); corners are kept only
 * for the first, which is in image coordinates. In a still image (`many`)
 * every code is collected: each find is blanked out and the reader runs again.
 */
export function readTwoD(
  views: (() => Luma | null)[],
  rgba: Rgba,
  only?: string,
  many = false,
  /** Also try turned copies (slower; still images rather than camera frames). */
  thorough = many,
): TwoDResult[] {
  const want = (id: string) => !only || only === id || (id === 'dotcode' && only === 'gs1dotcode');
  const out: TwoDResult[] = [];
  const limit = many ? 6 : 1;
  for (const [id, read] of READERS) {
    if (!want(id)) continue;
    for (let k = 0; k < views.length && out.length < limit; k++) {
      let l = views[k]();
      if (!l) continue;
      let found = false;
      while (out.length < limit) {
        const r = read(l, only, thorough);
        if (!r) break;
        if (k) r.corners = undefined;
        if (!r.skip) {
          found = true;
          const { skip: _, ...res } = r;
          void _;
          if (!out.some((o) => o.text === res.text && o.bcid === res.bcid)) out.push(res);
        }
        // Without corners (a turned or straightened copy) there's nothing to mask.
        if (!r.corners) break;
        l = maskGrey(l, r.corners);
      }
      if (found) break; // the straightened copy only when the image itself gave nothing
    }
    if (out.length >= limit) return out;
  }
  if (want('ultracode')) {
    let img = rgba;
    while (out.length < limit) {
      const r = readUltracode(img);
      if (!r) break;
      out.push({ bcid: 'ultracode', text: r.text, corners: r.corners });
      if (!r.corners) break;
      img = maskRgba(img, r.corners);
    }
  }
  return out;
}
