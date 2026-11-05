/**
 * Reads the size of an uploaded picture from its header BEFORE it is decoded. A small file can declare a huge picture
 * (a «decompression bomb»: a 30 KB PNG of 12000×12000 pixels needs more than half a gigabyte once decoded), so the size is
 * checked first and a picture over the limit never reaches the decoder.
 */

/** the longest side and the number of pixels a picture of the panel may have */
export const MAX_SIDE = 6000;
export const MAX_PIXELS = 24_000_000;

export interface ImageInfo {
  type: 'png' | 'jpeg' | 'webp';
  width: number;
  height: number;
}

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function pngInfo(b: Buffer): ImageInfo | null {
  if (b.length < 24 || !b.subarray(0, 8).equals(PNG) || b.toString('latin1', 12, 16) !== 'IHDR') return null;
  return { type: 'png', width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
}

function jpegInfo(b: Buffer): ImageInfo | null {
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) return null;
  let pos = 2;
  while (pos + 9 < b.length) {
    if (b[pos] !== 0xff) {
      pos++;
      continue;
    }
    const marker = b[pos + 1];
    if (marker === 0xff) {
      pos++;
      continue;
    }
    // standalone markers carry no length
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      pos += 2;
      continue;
    }
    const len = b.readUInt16BE(pos + 2);
    // the start-of-frame markers hold the size (C4, C8 and CC are not frames)
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { type: 'jpeg', height: b.readUInt16BE(pos + 5), width: b.readUInt16BE(pos + 7) };
    }
    if (len < 2) return null;
    pos += 2 + len;
  }
  return null;
}

function webpInfo(b: Buffer): ImageInfo | null {
  if (b.length < 30 || b.toString('latin1', 0, 4) !== 'RIFF' || b.toString('latin1', 8, 12) !== 'WEBP') return null;
  const kind = b.toString('latin1', 12, 16);
  if (kind === 'VP8 ') return { type: 'webp', width: b.readUInt16LE(26) & 0x3fff, height: b.readUInt16LE(28) & 0x3fff };
  if (kind === 'VP8L') {
    const bits = b.readUInt32LE(21);
    return { type: 'webp', width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
  }
  if (kind === 'VP8X') return { type: 'webp', width: 1 + b.readUIntLE(24, 3), height: 1 + b.readUIntLE(27, 3) };
  return null;
}

/** the type and size from the header, or null when it is not a PNG, JPEG or WebP we can read */
export const imageInfo = (b: Buffer): ImageInfo | null => pngInfo(b) ?? jpegInfo(b) ?? webpInfo(b);

/** null when the picture may be decoded, otherwise what is wrong with it */
export function imageProblem(b: Buffer, maxSide = MAX_SIDE, maxPixels = MAX_PIXELS): 'unknown' | 'empty' | 'big' | null {
  const info = imageInfo(b);
  if (!info) return 'unknown';
  if (info.width < 1 || info.height < 1) return 'empty';
  if (info.width > maxSide || info.height > maxSide || info.width * info.height > maxPixels) return 'big';
  return null;
}
