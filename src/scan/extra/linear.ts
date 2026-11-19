// Decoders for 1D codes defined by bar and space widths.
//
// Rather than hard-coding pattern tables, each format's tables are learned at
// run time from bwip-js, the same encoder the app uses to draw them. Every
// read is then re-encoded and compared bar for bar, which also settles which
// check-digit option was used.

import { normaliseSbs, quantizeAll, same } from './lines';
import { tryRaw, type BwipRaw } from './types';
import { CHANNEL_MEMO, POSICODE_ENCS, POSICODE_SETS } from './tables';

interface WidthSpec {
  bcid: string;
  alphabet: string;
  learnOpts?: string;
  /**
   * Readings to try, in order of preference: [trailing check characters to
   * remove, encoder options that should reproduce the bars]. Some readings
   * produce identical bars (e.g. MSI "12345678" + one check digit vs "1234567"
   * + two), so the order picks the most common one.
   */
  attempts: [number, string][];
  /** For formats with a mandatory check before the stop pattern. */
  stopLength?: number;
}

export const WIDTH_SPECS: WidthSpec[] = [
  {
    bcid: 'code11',
    alphabet: '0123456789-',
    attempts: [
      [2, 'includecheck'],
      [1, 'includecheck'],
      [0, ''],
    ],
  },
  {
    bcid: 'msi',
    alphabet: '0123456789',
    attempts: [
      [1, 'includecheck'],
      [2, 'includecheck checktype=mod1010'],
      [2, 'includecheck checktype=mod1110'],
      [2, 'includecheck checktype=ncrmod1110'],
      [1, 'includecheck checktype=mod11'],
      [1, 'includecheck checktype=ncrmod11'],
      [2, 'includecheck checktype=mod11'],
      [2, 'includecheck checktype=ncrmod11'],
      [0, ''],
    ],
  },
  { bcid: 'plessey', alphabet: '0123456789ABCDEF', attempts: [[2, '']], stopLength: 9 },
  ...['code2of5', 'iata2of5', 'matrix2of5', 'coop2of5', 'datalogic2of5'].map((bcid): WidthSpec => ({
    bcid,
    alphabet: '0123456789',
    attempts: [
      [1, 'includecheck'],
      [0, ''],
    ],
  })),
];

interface Model {
  start: number[];
  stop: number[];
  charLength: number;
  dict: Map<string, string>;
  widths: number[];
}

const models = new Map<string, Model | null>();

function learn(bwip: BwipRaw, spec: WidthSpec): Model | null {
  if (models.has(spec.bcid)) return models.get(spec.bcid)!;
  const sbs = (t: string) => {
    const r = tryRaw(bwip, spec.bcid, t, spec.learnOpts ?? '');
    return r?.sbs ? r.sbs.map((v) => Math.round(v)) : null;
  };
  const al = spec.alphabet;
  const a = sbs(al[1]);
  const pairs = [
    [al[1], al[2]],
    [al[3], al[0]],
    [al[al.length - 1], al[1]],
  ];
  let model: Model | null = null;
  if (a) {
    const ab = sbs(al[1] + al[2]);
    const L = ab ? ab.length - a.length : 0;
    for (let s = 0; L > 0 && s + L <= a.length && !model; s++) {
      const ok = pairs.every(([x, y]) => {
        const sx = sbs(x);
        const sy = sbs(y);
        const p = sbs(x + y);
        if (!sx || !sy || !p) return false;
        const prefix = same(p.slice(0, s + L), sx.slice(0, s + L));
        const second = same(p.slice(s + L, s + 2 * L), sy.slice(s, s + L));
        const stop = spec.stopLength !== undefined || same(p.slice(s + 2 * L), sx.slice(s + L));
        return prefix && second && stop;
      });
      if (!ok) continue;
      const stopLen = spec.stopLength ?? a.length - s - L;
      const dict = new Map<string, string>();
      const widths = new Set<number>(a);
      for (const c of al) {
        const p = sbs(c);
        if (!p) continue;
        p.forEach((w) => widths.add(w));
        dict.set(p.slice(s, s + L).join(','), c);
      }
      // A scanned symbol ends on a bar, so drop a trailing space from the stop.
      const stop = a.slice(a.length - stopLen);
      if (a.length % 2 === 0) stop.pop();
      model = {
        start: a.slice(0, s),
        stop,
        charLength: L,
        dict,
        widths: [...widths].sort((x, y) => x - y),
      };
    }
  }
  models.set(spec.bcid, model);
  return model;
}

function verify(
  bwip: BwipRaw,
  bcid: string,
  text: string,
  opts: string,
  modules: number[],
): boolean {
  const r = tryRaw(bwip, bcid, text, opts);
  return !!r?.sbs && same(normaliseSbs(r.sbs), modules);
}

function decodeWith(
  bwip: BwipRaw,
  spec: WidthSpec,
  model: Model,
  modules: number[],
  strict = false,
): string | null {
  const { start, stop, charLength: L } = model;
  if (modules.length < start.length + stop.length + L) return null;
  if (!same(modules.slice(0, start.length), start)) return null;
  if (!same(modules.slice(modules.length - stop.length), stop)) return null;
  const middle = modules.slice(start.length, modules.length - stop.length);
  if (middle.length % L) return null;
  let text = '';
  for (let i = 0; i < middle.length; i += L) {
    const c = model.dict.get(middle.slice(i, i + L).join(','));
    if (c === undefined) return null;
    text += c;
  }
  for (const [k, opts] of spec.attempts) {
    if (text.length - k < 1) continue;
    // Strict mode: only readings with a check character, which noise rarely fakes.
    if (strict && !opts.includes('includecheck') && !spec.stopLength) continue;
    const candidate = text.slice(0, text.length - k);
    if (verify(bwip, spec.bcid, candidate, opts, modules)) return candidate;
  }
  return null;
}

export function decodeWidthFormats(
  bwip: BwipRaw,
  runs: number[],
  only?: string,
  strict = false,
): { bcid: string; text: string } | null {
  for (const spec of WIDTH_SPECS) {
    if (only && only !== spec.bcid) continue;
    const model = learn(bwip, spec);
    if (!model) continue;
    for (const modules of quantizeAll(runs, model.widths)) {
      for (const m of [modules, [...modules].reverse()]) {
        const text = decodeWith(bwip, spec, model, m, strict);
        if (text !== null) return { bcid: spec.bcid, text };
      }
    }
  }
  return null;
}

// ---------- BC412 (with or without the "semi" start/stop) ----------

const BC412 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ'; // invalid ones are skipped while learning
let bc412: { dict: Map<string, string>; semiStop: number[] } | null | undefined;

/**
 * BC412 in "semi" mode has start/stop bars. Without them any row of even bars
 * is valid BC412, so plain mode is only tried when picked in the scanner.
 */
export function decodeBc412(bwip: BwipRaw, runs: number[], allowPlain = false): string | null {
  if (bc412 === undefined) {
    const dict = new Map<string, string>();
    for (const c of BC412) {
      const r = tryRaw(bwip, 'bc412', c);
      if (r?.sbs) dict.set(r.sbs.map((v) => Math.round(v)).join(','), c);
    }
    const semi = tryRaw(bwip, 'bc412', 'AAAAAAA', 'semi');
    const plain = tryRaw(bwip, 'bc412', 'AAAAAAA', 'includecheck');
    bc412 =
      dict.size && semi?.sbs && plain?.sbs
        ? { dict, semiStop: semi.sbs.map((v) => Math.round(v)).slice(2 + plain.sbs.length) }
        : null;
  }
  if (!bc412) return null;
  for (const modules of quantizeAll(runs, [1, 2, 3, 4, 5])) {
    for (const m of [modules, [...modules].reverse()]) {
      // Characters are 8 elements. Without "semi" the last character's trailing
      // space isn't part of the symbol, so pad it back on.
      const variants: [number[], string[]][] = allowPlain
        ? [
            // Without start/stop bars only a check character tells BC412 from
            // any other row of even bars, so plain mode needs one.
            [[...m, 1], ['includecheck']],
          ]
        : [];
      if (
        m[0] === 1 &&
        m[1] === 2 &&
        same(m.slice(m.length - bc412.semiStop.length), bc412.semiStop)
      ) {
        variants.unshift([m.slice(2, m.length - bc412.semiStop.length), ['semi']]);
      }
      for (const [padded, optsList] of variants) {
        if (padded.length % 8) continue;
        let text = '';
        for (let i = 0; i < padded.length; i += 8) {
          let c = bc412.dict.get(padded.slice(i, i + 8).join(','));
          if (c === undefined && i + 8 === padded.length) {
            // Last character: match on its first 7 elements.
            const key = padded.slice(i, i + 7).join(',');
            for (const [k, v] of bc412.dict) if (k.startsWith(key + ',')) c = v;
          }
          if (c === undefined) {
            text = '';
            break;
          }
          text += c;
        }
        if (!text) continue;
        // In "semi" mode the check character is the second character; otherwise it's last.
        const candidates = optsList[0] === 'semi' ? [text[0] + text.slice(2)] : [text.slice(0, -1)];
        for (const candidate of candidates) {
          // A run of one repeated character is what stripes (blinds, rulers) read as.
          if (
            !candidate ||
            (optsList[0] !== 'semi' && (candidate.length < 3 || /^(.)\1*$/.test(candidate)))
          )
            continue;
          for (const opts of optsList)
            if (verify(bwip, 'bc412', candidate, opts, m)) return candidate;
        }
      }
    }
  }
  return null;
}

// ---------- EAN-2 / EAN-5 add-ons on their own ----------

const EAN_L = ['3211', '2221', '2122', '1411', '1132', '1231', '1114', '1312', '1213', '3112'];
const EAN_G = EAN_L.map((p) => [...p].reverse().join(''));

export function decodeEanAddon(
  bwip: BwipRaw,
  runs: number[],
): { bcid: string; text: string } | null {
  for (const modules of quantizeAll(runs, [1, 2, 3, 4])) {
    for (const m of [modules, [...modules].reverse()]) {
      const n = m.length === 13 ? 2 : m.length === 31 ? 5 : 0;
      if (!n || m[0] !== 1 || m[1] !== 1 || m[2] !== 2) continue;
      let digits = '';
      for (let i = 0; i < n; i++) {
        const p = m.slice(3 + i * 6, 7 + i * 6).join('');
        const d = EAN_L.indexOf(p) !== -1 ? EAN_L.indexOf(p) : EAN_G.indexOf(p);
        if (d === -1) break;
        digits += d;
      }
      if (digits.length !== n) continue;
      const bcid = n === 2 ? 'ean2' : 'ean5';
      if (verify(bwip, bcid, digits, '', m)) return { bcid, text: digits };
    }
  }
  return null;
}

// ---------- Pharmacode (one-track) ----------

export function decodePharmacode(bwip: BwipRaw, runs: number[]): string | null {
  // At least 4 bars: two or three bars are too easily part of something else
  // (a glare edge, a fragment of another code), and real Pharmacodes are longer.
  if (runs.length < 7) return null;
  const bars = runs.filter((_, i) => i % 2 === 0);
  const spaces = runs.filter((_, i) => i % 2 === 1);
  const narrow = Math.min(...bars);
  // All spaces equal, bars either narrow or about three times as wide.
  const sMin = Math.min(...spaces);
  const sMax = Math.max(...spaces);
  if (sMax > sMin * 1.5) return null;
  for (const seq of [bars, [...bars].reverse()]) {
    let value = 0;
    for (const b of seq) {
      const wide = b > narrow * 2;
      if (!wide && b > narrow * 1.5) return null;
      value = value * 2 + (wide ? 2 : 1);
    }
    if (value < 3 || value > 131070) continue;
    const r = tryRaw(bwip, 'pharmacode', String(value));
    if (!r?.sbs) continue;
    const expected = normaliseSbs(r.sbs).filter((_, i) => i % 2 === 0);
    const got = seq.map((b) => (b > narrow * 2 ? 3 : 1));
    if (same(expected, got)) return String(value);
  }
  return null;
}

// ---------- Channel Code ----------
// Values are numbered by walking every valid bar/space pattern in order (a
// port of BWIPP's enumeration). Walking starts from BWIPP's own checkpoints,
// so even 8-channel values need at most ~150,000 steps.

const CHANNEL_MAX = [26, 292, 3493, 44072, 576688, 7742862];

/** Value of a Channel Code data pattern (2 × channels elements, space first), or -1. */
export function channelValue(channels: number, data: number[]): number {
  const memo = CHANNEL_MEMO[channels - 3];
  const off = 2 * (8 - channels);
  // Patterns are in lexicographic order, so start from the last checkpoint not after it.
  const lex = (st: number[]) => {
    for (let i = 0; i < data.length; i++) if (st[off + i] !== data[i]) return st[off + i] - data[i];
    return 0;
  };
  const stateOf = (m: (typeof memo)[number]) => {
    const [, mb, ms] = m;
    const st: number[] = [];
    for (let i = 0; i < 8; i++) st.push(ms[i], mb[i]);
    return st;
  };
  let start = memo[0];
  for (const m of memo) if (lex(stateOf(m)) <= 0) start = m;

  const [value0, mb, ms, mbmax, msmax] = start;
  const b = [0, ...mb]; // 1-based
  const s = [0, ...ms];
  const bmax = [0, ...mbmax];
  const smax = [0, ...msmax];
  let value = value0;
  const limit = CHANNEL_MAX[channels - 3];
  let state = 'chkchr';
  for (let guard = 0; guard < 40_000_000; guard++) {
    switch (state) {
      case 'loops1':
        smax[2] = smax[1] + 1 - s[1];
        b[1] = 1;
        state = s[1] === 1 ? 'nextb1' : 'loopb1';
        break;
      case 'loopb1':
        bmax[2] = bmax[1] + 1 - b[1];
        s[2] = 1;
        state = 'loops2';
        break;
      case 'loops2':
        smax[3] = smax[2] + 1 - s[2];
        b[2] = 1;
        state = s[1] + b[1] + s[2] === 3 ? 'nextb2' : 'loopb2';
        break;
      case 'loopb2':
        bmax[3] = bmax[2] + 1 - b[2];
        s[3] = 1;
        state = 'loops3';
        break;
      case 'loops3':
        smax[4] = smax[3] + 1 - s[3];
        b[3] = 1;
        state = b[1] + s[2] + b[2] + s[3] === 4 ? 'nextb3' : 'loopb3';
        break;
      case 'loopb3':
        bmax[4] = bmax[3] + 1 - b[3];
        s[4] = 1;
        state = 'loops4';
        break;
      case 'loops4':
        smax[5] = smax[4] + 1 - s[4];
        b[4] = 1;
        state = b[2] + s[3] + b[3] + s[4] === 4 ? 'nextb4' : 'loopb4';
        break;
      case 'loopb4':
        bmax[5] = bmax[4] + 1 - b[4];
        s[5] = 1;
        state = 'loops5';
        break;
      case 'loops5':
        smax[6] = smax[5] + 1 - s[5];
        b[5] = 1;
        state = b[3] + s[4] + b[4] + s[5] === 4 ? 'nextb5' : 'loopb5';
        break;
      case 'loopb5':
        bmax[6] = bmax[5] + 1 - b[5];
        s[6] = 1;
        state = 'loops6';
        break;
      case 'loops6':
        smax[7] = smax[6] + 1 - s[6];
        b[6] = 1;
        state = b[4] + s[5] + b[5] + s[6] === 4 ? 'nextb6' : 'loopb6';
        break;
      case 'loopb6':
        bmax[7] = bmax[6] + 1 - b[6];
        s[7] = 1;
        state = 'loops7';
        break;
      case 'loops7':
        s[8] = smax[7] + 1 - s[7];
        b[7] = 1;
        state = b[5] + s[6] + b[6] + s[7] === 4 ? 'nextb7' : 'loopb7';
        break;
      case 'loopb7':
        b[8] = bmax[7] + 1 - b[7];
        state = b[6] + s[7] + b[7] + s[8] + b[8] === 5 ? 'nextb7' : 'chkchr';
        break;
      case 'chkchr': {
        // Patterns come in lexicographic order: stop once we've passed the target.
        let cmp = 0;
        for (let i = 0; i < data.length && !cmp; i++) {
          const idx = off + i;
          const v = idx % 2 === 0 ? s[(idx >> 1) + 1] : b[(idx >> 1) + 1];
          cmp = v - data[i];
        }
        if (cmp === 0) return value;
        if (cmp > 0) return -1;
        if (++value > limit) return -1;
        state = 'nextb7';
        break;
      }
      case 'nextb7':
        b[7]++;
        state = b[7] <= bmax[7] ? 'loopb7' : 'nexts7';
        break;
      case 'nexts7':
        s[7]++;
        state = s[7] <= smax[7] ? 'loops7' : 'nextb6';
        break;
      case 'nextb6':
        b[6]++;
        state = b[6] <= bmax[6] ? 'loopb6' : 'nexts6';
        break;
      case 'nexts6':
        s[6]++;
        state = s[6] <= smax[6] ? 'loops6' : 'nextb5';
        break;
      case 'nextb5':
        b[5]++;
        state = b[5] <= bmax[5] ? 'loopb5' : 'nexts5';
        break;
      case 'nexts5':
        s[5]++;
        state = s[5] <= smax[5] ? 'loops5' : 'nextb4';
        break;
      case 'nextb4':
        b[4]++;
        state = b[4] <= bmax[4] ? 'loopb4' : 'nexts4';
        break;
      case 'nexts4':
        s[4]++;
        state = s[4] <= smax[4] ? 'loops4' : 'nextb3';
        break;
      case 'nextb3':
        b[3]++;
        state = b[3] <= bmax[3] ? 'loopb3' : 'nexts3';
        break;
      case 'nexts3':
        s[3]++;
        state = s[3] <= smax[3] ? 'loops3' : 'nextb2';
        break;
      case 'nextb2':
        b[2]++;
        state = b[2] <= bmax[2] ? 'loopb2' : 'nexts2';
        break;
      case 'nexts2':
        s[2]++;
        state = s[2] <= smax[2] ? 'loops2' : 'nextb1';
        break;
      case 'nextb1':
        b[1]++;
        state = b[1] <= bmax[1] ? 'loopb1' : 'nexts1';
        break;
      case 'nexts1':
        s[1]++;
        if (s[1] <= smax[1]) state = 'loops1';
        else return -1;
        break;
    }
  }
  return -1;
}

export function decodeChannel(bwip: BwipRaw, runs: number[]): string | null {
  for (const modules of quantizeAll(runs, [1, 2, 3, 4, 5, 6, 7, 8])) {
    for (const m of [modules, [...modules].reverse()]) {
      if (!same(m.slice(0, 9), [1, 1, 1, 1, 1, 1, 1, 1, 1])) continue;
      // Data is 2 × channels elements, optionally followed by a 3-channel check (6 elements).
      for (const withCheck of [false, true]) {
        const dataLen = m.length - 9 - (withCheck ? 6 : 0);
        const channels = dataLen / 2;
        if (!Number.isInteger(channels) || channels < 3 || channels > 8) continue;
        const v = channelValue(channels, m.slice(9, 9 + dataLen));
        if (v < 0) continue;
        const text = String(v).padStart(channels - 1, '0');
        // The walk above matched the pattern exactly. Only the optional check
        // bars need the encoder (which is slow for large values).
        if (!withCheck || verify(bwip, 'channelcode', text, 'includecheck', m)) return text;
      }
    }
  }
  return null;
}

// ---------- USPS FIM marks (bwip-js "symbol") ----------

export function decodeFim(bwip: BwipRaw, runs: number[]): string | null {
  // FIM widths aren't whole modules, so compare proportions instead.
  for (const name of ['fima', 'fimb', 'fimc', 'fimd']) {
    const r = tryRaw(bwip, 'symbol', name);
    if (!r?.sbs) continue;
    const p = r.sbs.slice(0, r.sbs.length % 2 ? r.sbs.length : r.sbs.length - 1);
    if (p.length !== runs.length) continue;
    const scale = runs.reduce((a, b) => a + b, 0) / p.reduce((a, b) => a + b, 0);
    const fits = (seq: number[]) =>
      seq.every((v, i) => Math.abs(v - p[i] * scale) < Math.max(1.5, p[i] * scale * 0.3));
    if (fits(runs) || fits([...runs].reverse())) return name;
  }
  return null;
}

// ---------- Custom 1D (bwip-js "raw"): the text is the width pattern ----------

export function decodeRawWidths(bwip: BwipRaw, runs: number[]): string | null {
  for (const modules of quantizeAll(runs, [1, 2, 3, 4, 5, 6, 7, 8, 9])) {
    const text = modules.join('');
    if (verify(bwip, 'raw', text, '', modules)) return text;
  }
  return null;
}

// ---------- PosiCode (versions A, B, limited A, limited B) ----------

const POSI_VERSIONS = ['a', 'b', 'limiteda', 'limitedb'] as const;
const widthsOf = (p: string) => [...p].map((c) => c.charCodeAt(0) - 48);

/** Character codes, or 'FNC1'..'FNC4', from PosiCode codewords. */
function posiTokens(cws: number[], limited: boolean): (number | string)[] | null {
  const raw: (number | string)[] = [];
  let set = 0;
  let shift = -1;
  for (const v of cws) {
    if (limited) {
      if (v > 37) return null;
      raw.push(POSICODE_SETS[v][0].charCodeAt(0));
      continue;
    }
    const cur = shift >= 0 ? shift : set;
    shift = -1;
    const e = POSICODE_SETS[v]?.[cur];
    if (e === undefined) return null;
    if (e.length > 1 && e.startsWith('#')) {
      const op = e.slice(1);
      if (op === 'la0') set = 0;
      else if (op === 'la1') set = 1;
      else if (op === 'sf0') shift = 0;
      else if (op === 'sf1') shift = 1;
      else if (op === 'sf2') shift = 2;
      else raw.push(op.toUpperCase()); // FNC1..FNC4
    } else raw.push(e.charCodeAt(0));
  }
  // FNC4 shifts the next character into extended ASCII; two in a row latch it.
  const out: (number | string)[] = [];
  let latched = false;
  let shiftNext = false;
  for (let i = 0; i < raw.length; i++) {
    const t = raw[i];
    if (t === 'FNC4') {
      if (raw[i + 1] === 'FNC4') {
        latched = !latched;
        i++;
      } else shiftNext = true;
      continue;
    }
    if (typeof t === 'number') {
      out.push(t + (latched !== shiftNext ? 128 : 0));
      shiftNext = false;
    } else out.push(t);
  }
  return out;
}

export function decodePosicode(bwip: BwipRaw, runs: number[]): string | null {
  for (const modules of quantizeAll(runs, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]))
    for (const m of [modules, [...modules].reverse()]) {
      for (const version of POSI_VERSIONS) {
        const encs = POSICODE_ENCS[version];
        const start = widthsOf(encs[encs.length - 2]);
        const stopW = widthsOf(encs[encs.length - 1]);
        if (!same(m.slice(0, start.length), start)) continue;
        // The stop may end on a space that isn't part of the scanned symbol.
        const tail = stopW.length % 2 === 0 ? stopW.slice(0, -1) : stopW;
        if (!same(m.slice(m.length - tail.length), tail)) continue;
        const middle = m.slice(start.length, m.length - tail.length - 12);
        if (middle.length % 6 || !middle.length) continue;
        const dict = new Map(encs.slice(0, -2).map((p, i) => [widthsOf(p).join(','), i]));
        const cws: number[] = [];
        for (let i = 0; i < middle.length; i += 6) {
          const v = dict.get(middle.slice(i, i + 6).join(','));
          if (v === undefined) break;
          cws.push(v);
        }
        if (cws.length * 6 !== middle.length) continue;
        const tokens = posiTokens(cws, version.startsWith('limited'));
        if (!tokens) continue;
        let text = '';
        let input = '';
        for (const t of tokens) {
          if (typeof t === 'string') {
            input += `^${t}`;
            text += t === 'FNC1' ? '\u001d' : '';
          } else {
            text += String.fromCharCode(t);
            input +=
              t < 32 || t > 126 || t === 94
                ? `^${String(t).padStart(3, '0')}`
                : String.fromCharCode(t);
          }
        }
        if (verify(bwip, 'posicode', input, `version=${version} parse parsefnc`, m)) return text;
      }
    }
  return null;
}
