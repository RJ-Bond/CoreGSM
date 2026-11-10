// A small PNG reader and a picture comparison, with no dependencies (Node's zlib only).
// Reads 8-bit, non-interlaced, grey / RGB / RGBA pictures, which is what Chrome writes.
import zlib from 'node:zlib';

export function decodePng(buf) {
  if (buf.length < 33 || buf.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG');
  let pos = 8, width = 0, height = 0, depth = 0, color = 0, interlace = 0;
  const data = [];
  while (pos + 8 <= buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('ascii', pos + 4, pos + 8);
    const body = buf.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') { width = body.readUInt32BE(0); height = body.readUInt32BE(4); depth = body[8]; color = body[9]; interlace = body[12]; }
    else if (type === 'IDAT') data.push(body);
    else if (type === 'IEND') break;
    pos += 12 + len;
  }
  if (depth !== 8 || interlace !== 0 || ![0, 2, 6].includes(color)) throw new Error(`PNG kind not supported (depth ${depth}, colour ${color}, interlace ${interlace})`);
  const ch = color === 0 ? 1 : color === 2 ? 3 : 4;
  const raw = zlib.inflateSync(Buffer.concat(data));
  const stride = width * ch;
  const out = Buffer.alloc(height * stride);
  for (let y = 0; y < height; y++) {
    const f = raw[y * (stride + 1)];
    const src = y * (stride + 1) + 1;
    const dst = y * stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= ch ? out[dst + x - ch] : 0;
      const b = y > 0 ? out[dst - stride + x] : 0;
      const c = x >= ch && y > 0 ? out[dst - stride + x - ch] : 0;
      let v = raw[src + x];
      if (f === 1) v += a;
      else if (f === 2) v += b;
      else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      out[dst + x] = v & 255;
    }
  }
  return { width, height, ch, data: out };
}

/**
 * How much of the picture changed: the share of pixels whose colour moved by more than `tol` in some channel.
 * Pictures of different heights are compared on the common top part; the difference in height is reported apart.
 */
export function comparePng(a, b, tol = 24) {
  const A = decodePng(a), B = decodePng(b);
  if (A.width !== B.width) return { sizeChanged: true, a: [A.width, A.height], b: [B.width, B.height], ratio: 1 };
  const h = Math.min(A.height, B.height);
  let diff = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < A.width; x++) {
      const ia = (y * A.width + x) * A.ch, ib = (y * B.width + x) * B.ch;
      let d = 0;
      for (let k = 0; k < Math.min(3, A.ch, B.ch); k++) d = Math.max(d, Math.abs(A.data[ia + k] - B.data[ib + k]));
      if (d > tol) diff++;
    }
  }
  return { sizeChanged: false, heightDelta: B.height - A.height, ratio: h ? diff / (h * A.width) : 0 };
}
