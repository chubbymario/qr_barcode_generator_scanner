// Pure helpers that turn barcode settings into bwip-js render options.
// Kept free of DOM and bwip-js imports so they can be unit-tested in Node.

import type { BarcodeSettings } from '../state';
import { usesBarHeight } from './catalog';

export type BwipValue = string | number | boolean;
export type BwipOptions = Record<string, BwipValue> & { bcid: string; text: string };

/** Parse "includecheck version=24x24 eclevel=Q" into an options object. */
export function parseOptionString(input: string): Record<string, BwipValue> {
  const out: Record<string, BwipValue> = {};
  for (const token of input.trim().split(/\s+/).filter(Boolean)) {
    const eq = token.indexOf('=');
    if (eq === -1) {
      out[token] = true;
      continue;
    }
    const key = token.slice(0, eq);
    const raw = token.slice(eq + 1);
    if (!key) continue;
    if (raw === 'true' || raw === 'false') out[key] = raw === 'true';
    else if (/^-?\d+(\.\d+)?$/.test(raw)) out[key] = Number(raw);
    else out[key] = raw;
  }
  return out;
}

/** Default "more options" for a symbol, minus the switches the UI already controls. */
export function defaultOptionString(opts: string): string {
  // "includecheckintext" would print the check character under the bars as if
  // it were part of the data; the scanner returns the data without it.
  return opts
    .split(/\s+/)
    .filter((t) => t && t !== 'includetext' && t !== 'includecheckintext')
    .join(' ');
}

const hex = (c: string) => c.replace(/^#/, '').toUpperCase();

/** bwip-js expresses bar height in millimetres at 72 points per inch. */
export function barHeightParam(heightMm: number, dpi: number, pxPerUnit: number): number {
  return (heightMm * dpi) / (72 * pxPerUnit);
}

export function buildBwipOptions(
  s: BarcodeSettings,
  text: string,
  scale: { x: number; y: number },
  height: number | null,
  advanced: string,
): BwipOptions {
  const o: BwipOptions = {
    bcid: s.bcid,
    text,
    scaleX: scale.x,
    scaleY: scale.y,
    rotate: s.rotate,
    paddingwidth: s.paddingModules,
    paddingheight: Math.round(s.paddingModules / 2),
    barcolor: hex(s.barcolor),
    textcolor: hex(s.textcolor),
  };
  if (!s.transparentBackground) o.backgroundcolor = hex(s.backgroundcolor);
  if (s.includetext) {
    o.includetext = true;
    // Only override the format's own text layout when asked to.
    if (s.textxalign) o.textxalign = s.textxalign;
    if (s.textyalign) o.textyalign = s.textyalign;
    if (s.textsize > 0) o.textsize = s.textsize;
    if (s.textfont) o.textfont = s.textfont;
  }
  if (s.showborder) o.showborder = true;
  if (height !== null && usesBarHeight(s.bcid)) o.height = +height.toFixed(3);
  // "More options" win over everything else.
  Object.assign(o, parseOptionString(advanced));
  o.bcid = s.bcid;
  o.text = text;
  return o;
}

/** Turn "bwipp.ean13badLength: EAN-13 must be 12 or 13 digits" into the readable half. */
export function explainBwipError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  const cleaned = msg.replace(/^(Error:\s*)?bwip(p|-js)\.[\w.#]+:\s*/i, '').trim();
  if (/^unknown encoder|not a valid barcode type/i.test(cleaned))
    return 'This format isn’t supported.';
  return cleaned || 'The barcode could not be drawn.';
}
