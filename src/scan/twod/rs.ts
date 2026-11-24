// Reed-Solomon error correction for the app's own 2D decoders: Code One and
// Han Xin (binary fields GF(2^m)), DotCode (prime field GF(113)) and
// Ultracode (GF(283)). Berlekamp-Massey finds the error locations, Forney the
// values. Returns the corrected codewords, or null if there are more errors
// than the check codewords can fix.

export interface Field {
  size: number; // number of elements
  add(a: number, b: number): number;
  sub(a: number, b: number): number;
  mul(a: number, b: number): number;
  div(a: number, b: number): number;
  /** α^i */
  exp(i: number): number;
  /** log_α(a), a ≠ 0 */
  log(a: number): number;
}

/** GF(2^m) with the given primitive polynomial (e.g. 0x12d) and α = 2. */
export function binaryField(size: number, poly: number): Field {
  const exp = new Int32Array(size * 2);
  const log = new Int32Array(size);
  let x = 1;
  for (let i = 0; i < size - 1; i++) {
    exp[i] = x;
    log[x] = i;
    x <<= 1;
    if (x >= size) x ^= poly;
  }
  for (let i = size - 1; i < size * 2; i++) exp[i] = exp[i - (size - 1)];
  const n = size - 1;
  return {
    size,
    add: (a, b) => a ^ b,
    sub: (a, b) => a ^ b,
    mul: (a, b) => (a && b ? exp[log[a] + log[b]] : 0),
    div: (a, b) => {
      if (!b) throw new Error('divide by zero');
      return a ? exp[(log[a] - log[b] + n) % n] : 0;
    },
    exp: (i) => exp[((i % n) + n) % n],
    log: (a) => log[a],
  };
}

/** GF(p) for a prime p, with the given primitive element g. */
export function primeField(p: number, g: number): Field {
  const exp = new Int32Array(p * 2);
  const log = new Int32Array(p);
  let x = 1;
  for (let i = 0; i < p - 1; i++) {
    exp[i] = x;
    log[x] = i;
    x = (x * g) % p;
  }
  for (let i = p - 1; i < p * 2; i++) exp[i] = exp[i - (p - 1)];
  const n = p - 1;
  return {
    size: p,
    add: (a, b) => (a + b) % p,
    sub: (a, b) => (a - b + p) % p,
    mul: (a, b) => (a && b ? exp[log[a] + log[b]] : 0),
    div: (a, b) => {
      if (!b) throw new Error('divide by zero');
      return a ? exp[(log[a] - log[b] + n) % n] : 0;
    },
    exp: (i) => exp[((i % n) + n) % n],
    log: (a) => log[a],
  };
}

/**
 * Syndromes of a received word (highest-degree coefficient first) for roots
 * α^fcr … α^(fcr+nsym-1).
 */
function syndromes(f: Field, msg: number[], nsym: number, fcr: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < nsym; i++) {
    const a = f.exp(i + fcr);
    let s = 0;
    for (const c of msg) s = f.add(f.mul(s, a), c);
    out.push(s);
  }
  return out;
}

/** Evaluate a polynomial (lowest-degree coefficient first) at x. */
function evalLow(f: Field, p: number[], x: number): number {
  let y = 0;
  for (let i = p.length - 1; i >= 0; i--) y = f.add(f.mul(y, x), p[i]);
  return y;
}

/**
 * Correct `msg` (data + check codewords, highest degree first; the last
 * `nsym` are the check codewords). `fcr` is the power of α of the first
 * root of the generator polynomial. Erasures are not used. `maxErrors` caps
 * how many codewords may be changed (default: all the code can fix); small
 * codes are safer with a margin, since a fix that uses the whole budget is
 * the one most likely to be a wrong codeword "corrected" into another.
 */
export function rsCorrect(
  f: Field,
  msg: number[],
  nsym: number,
  fcr: number,
  maxErrors = Math.floor(nsym / 2),
): number[] | null {
  if (msg.some((c) => c < 0 || c >= f.size)) return null;
  const synd = syndromes(f, msg, nsym, fcr);
  if (synd.every((s) => s === 0)) return msg.slice();
  // Berlekamp-Massey: error locator Λ(x), lowest degree first.
  let C = [1];
  let B = [1];
  let L = 0;
  let m = 1;
  let b = 1;
  for (let n = 0; n < nsym; n++) {
    let d = synd[n];
    for (let i = 1; i <= L; i++) d = f.add(d, f.mul(C[i] ?? 0, synd[n - i]));
    if (d === 0) {
      m++;
      continue;
    }
    const coef = f.div(d, b);
    const T = C.slice();
    const len = Math.max(C.length, B.length + m);
    const next = new Array(len).fill(0);
    for (let i = 0; i < C.length; i++) next[i] = C[i];
    for (let i = 0; i < B.length; i++) next[i + m] = f.sub(next[i + m], f.mul(coef, B[i]));
    C = next;
    if (2 * L <= n) {
      L = n + 1 - L;
      B = T;
      b = d;
      m = 1;
    } else m++;
  }
  while (C.length > 1 && C[C.length - 1] === 0) C.pop();
  if (C.length - 1 !== L || 2 * L > nsym || L > maxErrors) return null;
  // Chien search: position j (from the end) is in error if Λ(α^-j) = 0.
  const N = msg.length;
  const positions: number[] = [];
  for (let j = 0; j < N; j++) if (evalLow(f, C, f.exp(-j)) === 0) positions.push(j);
  if (positions.length !== L) return null;
  // Error evaluator Ω(x) = S(x)Λ(x) mod x^nsym, S lowest first.
  const omega = new Array(nsym).fill(0);
  for (let i = 0; i < nsym; i++)
    for (let k = 0; k < C.length && i + k < nsym; k++)
      omega[i + k] = f.add(omega[i + k], f.mul(synd[i], C[k]));
  // Λ'(x): formal derivative (in GF(p) multiply by the integer degree).
  const deriv: number[] = [];
  for (let i = 1; i < C.length; i++) {
    let v = 0;
    for (let k = 0; k < i; k++) v = f.add(v, C[i]);
    deriv.push(v);
  }
  const out = msg.slice();
  for (const j of positions) {
    const xinv = f.exp(-j); // X_j^-1
    const num = evalLow(f, omega, xinv);
    const den = evalLow(f, deriv, xinv);
    if (den === 0) return null;
    // Forney: e = -X^(1-fcr) Ω(X^-1) / Λ'(X^-1)
    const xpow = f.exp(j * (1 - fcr));
    const e = f.sub(0, f.mul(xpow, f.div(num, den)));
    const idx = N - 1 - j;
    out[idx] = f.sub(out[idx], e);
  }
  return syndromes(f, out, nsym, fcr).every((s) => s === 0) ? out : null;
}

/** Check codewords for `data` with roots α^fcr…: for tests and to find fcr. */
export function rsEncode(f: Field, data: number[], nsym: number, fcr: number): number[] {
  // Generator polynomial, highest degree first.
  let g = [1];
  for (let i = 0; i < nsym; i++) {
    const r = f.exp(i + fcr);
    const next = new Array(g.length + 1).fill(0);
    for (let k = 0; k < g.length; k++) {
      next[k] = f.add(next[k], g[k]);
      next[k + 1] = f.sub(next[k + 1], f.mul(g[k], r));
    }
    g = next;
  }
  const rem = new Array(nsym).fill(0);
  for (const d of data) {
    const factor = f.add(d, rem[0]);
    rem.shift();
    rem.push(0);
    for (let k = 0; k < nsym; k++) rem[k] = f.sub(rem[k], f.mul(factor, g[k + 1]));
  }
  // The codeword is data·x^n − remainder.
  return rem.map((v) => f.sub(0, v));
}
