// Decoder for the 2D part of GS1 composite barcodes (CC-A, CC-B, CC-C).
//
// zxing-cpp reads and error-corrects the MicroPDF417/PDF417 part of CC-B and
// CC-C and returns its bytes; those bytes are a GS1 "general purpose" bit
// stream, decoded here into an element string such as "(10)ABC123(21)XYZ".
// The bit layout follows BWIPP's gs1-cc encoder (bwip-js, MIT).

/** Read bits MSB-first from bytes. */
class Bits {
  constructor(
    private readonly bytes: Uint8Array,
    private readonly length = bytes.length * 8,
    public pos = 0,
  ) {}
  get size() {
    return this.length;
  }
  left() {
    return this.size - this.pos;
  }
  peek(n: number, at = this.pos): number {
    let v = 0;
    for (let i = 0; i < n; i++) {
      const p = at + i;
      v = v * 2 + ((this.bytes[p >> 3] >> (7 - (p & 7))) & 1);
    }
    return v;
  }
  read(n: number): number {
    const v = this.peek(n);
    this.pos += n;
    return v;
  }
}

const FNC1 = '\u001d';
const dropFnc1 = (s: string) => (s.startsWith(FNC1) ? s.slice(1) : s);
const ISO8: Record<number, string> = {
  232: '!',
  233: '"',
  251: '_',
  252: ' ',
};
for (let c = 37; c <= 47; c++) ISO8[c + 197] = String.fromCharCode(c);
for (let c = 58; c <= 63; c++) ISO8[c + 187] = String.fromCharCode(c);

type Mode = 'numeric' | 'alphanumeric' | 'iso646';

/** Decode the general-purpose field until the bits run out. Padding is a run of latches. */
function generalField(b: Bits, start: Mode): string | null {
  let mode: Mode = start;
  let out = '';
  while (b.left() > 0) {
    if (mode === 'numeric') {
      if (b.left() >= 7) {
        const v = b.peek(7);
        if (v >= 8) {
          b.read(7);
          const d1 = Math.floor((v - 8) / 11);
          const d2 = (v - 8) % 11;
          if (d1 > 10) return null;
          out += d1 === 10 ? FNC1 : String(d1);
          out += d2 === 10 ? FNC1 : String(d2);
          continue;
        }
      }
      if (b.left() >= 4 && b.peek(4) === 0) {
        b.read(4);
        mode = 'alphanumeric';
        continue;
      }
      // End of symbol: one last digit in 4 bits (value = digit + 1), then zeros.
      if (b.left() >= 4 && b.left() <= 6) {
        const v = b.read(4);
        if (v < 1 || v > 10) return null;
        out += String(v - 1);
        if (b.left() && b.read(b.left()) !== 0) return null;
        continue;
      }
      if (b.left() < 4) {
        if (b.read(b.left()) !== 0) return null;
        continue;
      }
      return null;
    }
    // Alphanumeric and ISO 646 share the latches and the digit/FNC1 codes.
    if (b.left() < 3) {
      b.read(b.left());
      break;
    }
    if (b.peek(3) === 0) {
      b.read(3);
      mode = 'numeric';
      continue;
    }
    if (b.left() >= 5 && b.peek(5) === 4) {
      b.read(5);
      mode = mode === 'alphanumeric' ? 'iso646' : 'alphanumeric';
      continue;
    }
    if (b.left() < 5) {
      b.read(b.left());
      break;
    }
    const v5 = b.peek(5);
    if (v5 >= 5 && v5 <= 14) {
      b.read(5);
      out += String(v5 - 5);
      continue;
    }
    if (v5 === 15) {
      b.read(5);
      out += FNC1;
      mode = 'numeric'; // FNC1 always returns to numeric
      continue;
    }
    if (mode === 'alphanumeric') {
      if (b.left() < 6) return null;
      const v6 = b.read(6);
      if (v6 >= 32 && v6 <= 57) out += String.fromCharCode(v6 + 33);
      else if (v6 === 58) out += '*';
      else if (v6 >= 59 && v6 <= 62) out += String.fromCharCode(v6 - 15);
      else return null;
      continue;
    }
    if (b.left() >= 7) {
      const v7 = b.peek(7);
      if (v7 >= 64 && v7 <= 89) {
        b.read(7);
        out += String.fromCharCode(v7 + 1);
        continue;
      }
      if (v7 >= 90 && v7 <= 115) {
        b.read(7);
        out += String.fromCharCode(v7 + 7);
        continue;
      }
    }
    if (b.left() >= 8 && ISO8[b.peek(8)]) {
      out += ISO8[b.read(8)];
      continue;
    }
    return null;
  }
  return out;
}

// ---------- AI structure ----------

/** Digits in an AI, from its first two digits (GS1 General Specifications). */
function aiLength(s: string): number {
  const p = Number(s.slice(0, 2));
  if (p <= 2 || (p >= 10 && p <= 17) || (p >= 20 && p <= 22) || p === 30 || p === 37 || p >= 90)
    return 2;
  if (p === 23 || p === 24 || p === 25 || p === 40 || p === 41 || p === 42 || p === 71) return 3;
  return 4;
}

/** Value lengths of AIs that never need an FNC1 after them (by first two digits). */
const PREDEFINED: Record<string, number> = {
  '00': 18,
  '01': 14,
  '02': 14,
  '03': 14,
  '04': 16,
  '11': 6,
  '12': 6,
  '13': 6,
  '14': 6,
  '15': 6,
  '16': 6,
  '17': 6,
  '18': 6,
  '19': 6,
  '20': 2,
  '31': 6,
  '32': 6,
  '33': 6,
  '34': 6,
  '35': 6,
  '36': 6,
  '41': 13,
};

/** "1012AB\u001d2134" -> "(10)12AB(21)34" */
export function bracketAIs(raw: string): string | null {
  let out = '';
  let i = 0;
  while (i < raw.length) {
    if (raw[i] === FNC1) {
      i++;
      continue;
    }
    if (!/^\d\d/.test(raw.slice(i, i + 2))) return null;
    const ai = raw.slice(i, i + aiLength(raw.slice(i)));
    if (!/^\d+$/.test(ai)) return null;
    i += ai.length;
    const fixed = PREDEFINED[ai.slice(0, 2)];
    let value: string;
    if (fixed !== undefined) {
      value = raw.slice(i, i + fixed);
      i += fixed;
    } else {
      const end = raw.indexOf(FNC1, i);
      value = raw.slice(i, end === -1 ? raw.length : end);
      i = end === -1 ? raw.length : end;
    }
    if (!value) return null;
    out += `(${ai})${value}`;
  }
  return out || null;
}

/** Decode a composite component's bit stream into a bracketed element string. */
export function decodeCompositeBits(bytes: Uint8Array, bitLength?: number): string | null {
  const b = new Bits(bytes, bitLength);
  if (b.size < 8) return null;
  let prefix = '';
  let start: Mode = 'numeric';

  const method = b.read(1) === 0 ? '0' : b.read(1) === 0 ? '10' : '11';
  if (method === '0') {
    // Method "0": general purpose only.
  } else if (method === '10') {
    // Method "10": AI 11/17 date and/or AI 10 lot, compressed.
    if (b.peek(2) === 3) {
      b.read(2); // no date
    } else {
      const v = b.read(16);
      const yy = Math.floor(v / 384);
      const mm = Math.floor((v % 384) / 32) + 1;
      const dd = v % 32;
      if (yy > 99 || mm > 12 || dd > 31) return null;
      const ai = b.read(1) ? '17' : '11';
      prefix += `${ai}${String(yy).padStart(2, '0')}${String(mm).padStart(2, '0')}${String(dd).padStart(2, '0')}`;
    }
    // What follows is AI 10's value, unless it starts with FNC1.
    const rest = generalField(b, 'numeric');
    if (rest === null) return null;
    const raw = rest.startsWith(FNC1) ? prefix + rest : `${prefix}10${rest}`;
    return bracketAIs(raw);
  } else {
    // Method "11": AI 90 with a compressed leading number and letter.
    const m1 = b.read(1);
    const enc: 'alphanumeric' | 'numeric' | 'alpha' =
      m1 === 0 ? 'alphanumeric' : b.read(1) ? 'alpha' : 'numeric';
    let follow = '';
    if (b.read(1) === 1) follow = b.read(1) ? '8004' : '21';
    let nval: number;
    let letter: string;
    if (b.peek(5) === 31) {
      b.read(5);
      nval = b.read(10);
      letter = String.fromCharCode(65 + b.read(5));
    } else {
      nval = b.read(5);
      letter = 'BDHIJKLNPQRSTVXZ'[b.read(4)];
    }
    let ai90 = `${nval ? nval : ''}${letter}`;
    if (enc === 'alpha') {
      // Uppercase letters (5 bits) and digits (6 bits) until FNC1 (11111).
      while (b.left() >= 5) {
        const v5 = b.peek(5);
        if (v5 === 31) {
          b.read(5);
          break;
        }
        if (v5 < 26) {
          b.read(5);
          ai90 += String.fromCharCode(65 + v5);
          continue;
        }
        if (b.left() < 6) return null;
        const v6 = b.read(6);
        if (v6 < 52 || v6 > 61) return null;
        ai90 += String(v6 - 52);
      }
      start = 'numeric';
    } else start = enc;
    const rest = generalField(b, start);
    if (rest === null) return null;
    let raw = `90${ai90}`;
    let tail = rest;
    if (enc !== 'alpha') {
      const end = tail.indexOf(FNC1);
      raw += end === -1 ? tail : tail.slice(0, end);
      tail = end === -1 ? '' : tail.slice(end);
    } else if (tail.startsWith(FNC1)) tail = tail.slice(1);
    if (follow) {
      tail = dropFnc1(tail);
      const end = tail.indexOf(FNC1);
      raw += `${FNC1}${follow}${end === -1 ? tail : tail.slice(0, end)}`;
      tail = end === -1 ? '' : tail.slice(end);
    }
    return bracketAIs(raw + (tail ? FNC1 + dropFnc1(tail) : ''));
  }
  const rest = generalField(b, start);
  return rest === null ? null : bracketAIs(rest);
}
