#!/usr/bin/env node
// Puts several pictures of the shots side by side (each cropped to its top part) into one PNG, to look at many pages at once.
//   node tools/shots/montage.mjs <out.png> <height> <a.png> <b.png> ...
// No dependencies (Node's zlib only); reads what Chrome writes (see png.mjs).
import fs from 'node:fs';
import zlib from 'node:zlib';
import { decodePng } from './png.mjs';

const [out, heightArg, ...files] = process.argv.slice(2);
const H = Number(heightArg);
if (!out || !H || files.length === 0) { console.error('usage: montage.mjs <out.png> <height> <a.png> ...'); process.exit(2); }
const GAP = 10;
const pics = files.map((f) => decodePng(fs.readFileSync(f)));
const W = pics.reduce((n, p) => n + p.width, 0) + GAP * (pics.length - 1);
const buf = Buffer.alloc(W * H * 4, 0);
for (let i = 0; i < W * H; i++) { buf[i * 4] = 40; buf[i * 4 + 1] = 40; buf[i * 4 + 2] = 40; buf[i * 4 + 3] = 255; }
let x0 = 0;
for (const p of pics) {
  const h = Math.min(H, p.height);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < p.width; x++) {
      const s = (y * p.width + x) * p.ch;
      const d = (y * W + x0 + x) * 4;
      buf[d] = p.data[s]; buf[d + 1] = p.ch >= 3 ? p.data[s + 1] : p.data[s]; buf[d + 2] = p.ch >= 3 ? p.data[s + 2] : p.data[s]; buf[d + 3] = 255;
    }
  }
  x0 += p.width + GAP;
}
const raw = Buffer.alloc((W * 4 + 1) * H);
for (let y = 0; y < H; y++) { raw[y * (W * 4 + 1)] = 0; buf.copy(raw, y * (W * 4 + 1) + 1, y * W * 4, (y + 1) * W * 4); }
const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = (b) => { let c = 0xffffffff; for (const v of b) c = crcTable[(c ^ v) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (type, data) => { const t = Buffer.from(type); const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const c = Buffer.alloc(4); c.writeUInt32BE(crc(Buffer.concat([t, data]))); return Buffer.concat([len, t, data, c]); };
const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4); ihdr[8] = 8; ihdr[9] = 6;
fs.writeFileSync(out, Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
console.log(`${out}: ${W} x ${H}, ${pics.length} pictures`);
