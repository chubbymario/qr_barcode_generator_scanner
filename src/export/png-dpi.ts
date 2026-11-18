// Writes a pHYs chunk into a PNG so print and layout apps know its physical size.
// Browsers' canvas.toBlob() always writes 72 dpi (or nothing), which makes a
// 40 mm code at 300 dpi open as a 165 mm image in Word or Illustrator.

const SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

let crcTable: Uint32Array | null = null;
function crc32(bytes: Uint8Array): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function isPng(bytes: Uint8Array): boolean {
  return SIGNATURE.every((v, i) => bytes[i] === v);
}

export function setPngDpi(png: Uint8Array, dpi: number): Uint8Array {
  if (!isPng(png) || !(dpi > 0)) return png;
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  const ppm = Math.round(dpi / 0.0254); // pixels per metre

  const chunk = new Uint8Array(21);
  const cv = new DataView(chunk.buffer);
  cv.setUint32(0, 9);
  chunk.set([0x70, 0x48, 0x59, 0x73], 4); // "pHYs"
  cv.setUint32(8, ppm);
  cv.setUint32(12, ppm);
  chunk[16] = 1; // unit: metre
  cv.setUint32(17, crc32(chunk.subarray(4, 17)));

  // Copy every chunk except an existing pHYs, inserting ours after IHDR.
  const parts: Uint8Array[] = [png.subarray(0, 8)];
  let offset = 8;
  while (offset + 8 <= png.length) {
    const length = view.getUint32(offset);
    const type = String.fromCharCode(...png.subarray(offset + 4, offset + 8));
    const end = offset + 12 + length;
    if (type !== 'pHYs') parts.push(png.subarray(offset, end));
    if (type === 'IHDR') parts.push(chunk);
    offset = end;
  }
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let pos = 0;
  for (const p of parts) {
    out.set(p, pos);
    pos += p.length;
  }
  return out;
}

export function readPngDpi(png: Uint8Array): number | null {
  if (!isPng(png)) return null;
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  let offset = 8;
  while (offset + 8 <= png.length) {
    const length = view.getUint32(offset);
    const type = String.fromCharCode(...png.subarray(offset + 4, offset + 8));
    if (type === 'pHYs' && png[offset + 16] === 1) {
      return Math.round(view.getUint32(offset + 8) * 0.0254);
    }
    offset += 12 + length;
  }
  return null;
}

export async function withDpi(blob: Blob, dpi: number): Promise<Blob> {
  if (blob.type !== 'image/png') return blob;
  const bytes = new Uint8Array(await blob.arrayBuffer());
  return new Blob([setPngDpi(bytes, dpi) as BlobPart], { type: 'image/png' });
}
