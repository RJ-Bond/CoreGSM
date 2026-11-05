import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import skia from 'skia-canvas';
import { imageInfo, imageProblem } from '../src/images/imageGuard.ts';

const png = (w: number, h: number): Buffer => {
  const b = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0);
  b.writeUInt32BE(13, 8);
  b.write('IHDR', 12, 'latin1');
  b.writeUInt32BE(w, 16);
  b.writeUInt32BE(h, 20);
  return b;
};
const jpeg = (w: number, h: number): Buffer => {
  const b = Buffer.alloc(30);
  b[0] = 0xff; b[1] = 0xd8;
  // a comment segment first, then the start of frame
  b[2] = 0xff; b[3] = 0xfe; b.writeUInt16BE(4, 4);
  b[8] = 0xff; b[9] = 0xc0; b.writeUInt16BE(17, 10); b[12] = 8;
  b.writeUInt16BE(h, 13); b.writeUInt16BE(w, 15);
  return b;
};
const webpX = (w: number, h: number): Buffer => {
  const b = Buffer.alloc(40);
  b.write('RIFF', 0, 'latin1'); b.write('WEBP', 8, 'latin1'); b.write('VP8X', 12, 'latin1');
  b.writeUIntLE(w - 1, 24, 3); b.writeUIntLE(h - 1, 27, 3);
  return b;
};
const webpL = (w: number, h: number): Buffer => {
  const b = Buffer.alloc(40);
  b.write('RIFF', 0, 'latin1'); b.write('WEBP', 8, 'latin1'); b.write('VP8L', 12, 'latin1');
  b.writeUInt32LE(((w - 1) & 0x3fff) | (((h - 1) & 0x3fff) << 14), 21);
  return b;
};

describe('image guard', () => {
  it('reads the size from the header of a PNG, a JPEG and a WebP', () => {
    assert.deepEqual(imageInfo(png(640, 480)), { type: 'png', width: 640, height: 480 });
    assert.deepEqual(imageInfo(jpeg(1920, 1080)), { type: 'jpeg', width: 1920, height: 1080 });
    assert.deepEqual(imageInfo(webpX(800, 600)), { type: 'webp', width: 800, height: 600 });
    assert.deepEqual(imageInfo(webpL(300, 200)), { type: 'webp', width: 300, height: 200 });
  });

  it('refuses a picture that declares more than it should, and what is not a picture', () => {
    assert.equal(imageProblem(png(640, 480)), null);
    assert.equal(imageProblem(png(12000, 12000)), 'big');
    assert.equal(imageProblem(png(6001, 10)), 'big');
    assert.equal(imageProblem(png(5000, 5000)), 'big', '25 million pixels');
    assert.equal(imageProblem(jpeg(8000, 100)), 'big');
    assert.equal(imageProblem(webpX(7000, 7000)), 'big');
    assert.equal(imageProblem(png(0, 10)), 'empty');
    assert.equal(imageProblem(Buffer.from('not a picture at all, just text')), 'unknown');
    assert.equal(imageProblem(Buffer.alloc(0)), 'unknown');
    assert.equal(imageProblem(Buffer.from([0xff, 0xd8, 0xff])), 'unknown');
  });

  it('agrees with a real picture made by the renderer', async () => {
    const c = new skia.Canvas(321, 123);
    const real = await c.toBuffer('png');
    assert.deepEqual(imageInfo(real), { type: 'png', width: 321, height: 123 });
    const jpg = await c.toBuffer('jpeg');
    assert.deepEqual(imageInfo(jpg), { type: 'jpeg', width: 321, height: 123 });
  });
});
