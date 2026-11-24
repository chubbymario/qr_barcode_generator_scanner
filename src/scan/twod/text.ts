// Bytes to text for the app's own 2D decoders. Symbols carry bytes; the
// generator (bwip-js) writes text as UTF-8, so bytes that form valid UTF-8
// are read as such, anything else as Latin-1.

export function bytesToText(s: string): string {
  // Only strings of byte values with something above ASCII need decoding.
  if (!/[\u0080-ÿ]/.test(s) || [...s].some((c) => c.charCodeAt(0) > 255)) return s;
  const bytes = Uint8Array.from(s, (c) => c.charCodeAt(0));
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return s;
  }
}
