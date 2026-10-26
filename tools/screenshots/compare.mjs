// Compares the new screenshots with the ones of the main branch and writes DIFF.md plus a red-marked picture for each
// page that changed:   node tools/screenshots/compare.mjs <playwright dir> <new dir> <baseline dir> <output dir>
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const [pwDir, newDir, baseDir, outDir] = process.argv.slice(2);
const req = createRequire(path.join(pwDir, 'package.json'));
const { PNG } = req('pngjs');
const pm = req('pixelmatch');
const pixelmatch = pm.default ?? pm;

fs.mkdirSync(outDir, { recursive: true });
const rows = [];
let changed = 0;
const list = [];
for (const f of fs.readdirSync(newDir).filter((x) => x.endsWith('.png')).sort()) {
  const baseFile = path.join(baseDir, f);
  if (!fs.existsSync(baseFile)) { rows.push(`| ${f} | new page | |`); continue; }
  const a = PNG.sync.read(fs.readFileSync(baseFile));
  const b = PNG.sync.read(fs.readFileSync(path.join(newDir, f)));
  if (a.width !== b.width || a.height !== b.height) {
    changed++;
    list.push({ file: f, note: `size ${a.width}x${a.height} -> ${b.width}x${b.height}`, pct: 100 });
    rows.push(`| ${f} | size ${a.width}x${a.height} -> ${b.width}x${b.height} | |`);
    continue;
  }
  const diff = new PNG({ width: a.width, height: a.height });
  const n = pixelmatch(a.data, b.data, diff.data, a.width, a.height, { threshold: 0.1, includeAA: false });
  const pct = (n / (a.width * a.height)) * 100;
  if (pct >= 0.05) {
    changed++;
    fs.writeFileSync(path.join(outDir, f), PNG.sync.write(diff));
    list.push({ file: f, note: `${pct.toFixed(2)}% of pixels`, pct });
    rows.push(`| ${f} | ${pct.toFixed(2)}% of pixels | diff/${f} |`);
  }
}
const md = ['# Changes against main', '', changed || rows.length ? '| picture | change | marked picture |' : 'No visual changes.', changed || rows.length ? '|---|---|---|' : '', ...rows];
fs.writeFileSync(path.join(path.dirname(outDir), 'DIFF.md'), md.join('\n') + '\n');
fs.writeFileSync(path.join(path.dirname(outDir), 'changed.json'), JSON.stringify(list));
console.log('changed pictures:', changed);
