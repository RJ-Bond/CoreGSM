import assert from 'node:assert/strict';
import test from 'node:test';
import zlib from 'node:zlib';
import { comparePng, decodePng } from './png.mjs';

const crc = (buf) => { let c = ~0; for (const b of buf) { c ^= b; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1)); } return ~c >>> 0; };
const chunk = (type, body) => { const t = Buffer.from(type); const l = Buffer.alloc(4); l.writeUInt32BE(body.length); const c = Buffer.alloc(4); c.writeUInt32BE(crc(Buffer.concat([t, body]))); return Buffer.concat([l, t, body, c]); };
/** a flat RGBA picture, `paint(x, y)` -> [r, g, b] */
const png = (w, h, paint) => {
  const raw = Buffer.alloc(h * (w * 4 + 1));
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const [r, g, b] = paint(x, y); const o = y * (w * 4 + 1) + 1 + x * 4; raw[o] = r; raw[o + 1] = g; raw[o + 2] = b; raw[o + 3] = 255; }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
};

test('a picture is read back as it was written', () => {
  const p = decodePng(png(3, 2, (x, y) => [x * 50, y * 100, 7]));
  assert.equal(p.width, 3);
  assert.equal(p.height, 2);
  assert.deepEqual([...p.data.subarray(4, 8)], [50, 0, 7, 255]);
});

test('equal pictures differ by nothing, a changed corner by its share', () => {
  const base = png(10, 10, () => [20, 20, 20]);
  assert.equal(comparePng(base, base).ratio, 0);
  const changed = png(10, 10, (x, y) => (x < 5 && y < 4 ? [250, 100, 20] : [20, 20, 20]));
  assert.equal(comparePng(base, changed).ratio, 0.2);
});

test('a faint change (below the tolerance) is not a difference; another width is reported', () => {
  assert.equal(comparePng(png(4, 4, () => [20, 20, 20]), png(4, 4, () => [30, 30, 30])).ratio, 0);
  const r = comparePng(png(4, 4, () => [0, 0, 0]), png(6, 4, () => [0, 0, 0]));
  assert.equal(r.sizeChanged, true);
});
