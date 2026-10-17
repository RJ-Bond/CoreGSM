#!/usr/bin/env node
/**
 * Game emblems: one source, two outputs.
 *   src/core-frontend/public/games/<id>.svg   the emblem for the web panel (crisp at any size)
 *   src/core-backend/src/gameImages.ts        the same emblem as a 192 px transparent PNG (base64) for the PNG card
 *                                             and the Discord thumbnail (entries of other games are kept)
 * Every emblem is drawn in the colour of its game (read from core-frontend/src/games.ts): a gradient body, a darker
 * side and white highlights, so it reads on a dark tile, on a light Discord and as a bare thumbnail alike.
 * The symbols are original and generic (a block, a crosshair, a gear...), not the logos of the games.
 *
 *   node tools/gen-game-emblems.cjs            write everything
 *   node tools/gen-game-emblems.cjs --sheet X  also write a contact sheet PNG to X
 *
 * The PNGs are rasterised by headless Chrome (skia-canvas cannot read SVG): set CHROME to its path if it is not found.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const root = path.join(__dirname, '..');
const { Canvas, loadImage } = require(path.join(root, 'src/core-backend/node_modules/skia-canvas'));

// ---------- colour helpers ----------
const rgb = (hex) => { const n = parseInt(hex.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const hex = (c) => '#' + c.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
const mix = (h, to, t) => { const a = rgb(h); return hex(a.map((v, i) => v + (to[i] - v) * t)); };
const lighten = (h, t) => mix(h, [255, 255, 255], t);
const darken = (h, t) => mix(h, [0, 0, 0], t);

// ---------- geometry helpers ----------
const f = (n) => Number(n.toFixed(2));
/** a gear: `n` trapezoid teeth between radius ri and ro, an optional round hole (drawn with fill-rule evenodd) */
function gear(cx, cy, ro, ri, n, hole = 0) {
  const step = (2 * Math.PI) / n;
  let d = '';
  for (let i = 0; i < n; i++) {
    const a = i * step;
    [[ri, a - step * 0.3], [ro, a - step * 0.17], [ro, a + step * 0.17], [ri, a + step * 0.3]].forEach(([r, g], j) => {
      d += `${i === 0 && j === 0 ? 'M' : 'L'}${f(cx + r * Math.cos(g))} ${f(cy + r * Math.sin(g))} `;
    });
  }
  d += 'Z';
  if (hole) d += ` M${f(cx + hole)} ${cy} a${hole} ${hole} 0 1 0 ${-2 * hole} 0 a${hole} ${hole} 0 1 0 ${2 * hole} 0Z`;
  return d;
}
const star = (cx, cy, ro, ri, n = 5, rot = -Math.PI / 2) =>
  Array.from({ length: n * 2 }, (_, i) => {
    const r = i % 2 ? ri : ro;
    const a = rot + (i * Math.PI) / n;
    return `${i ? 'L' : 'M'}${f(cx + r * Math.cos(a))} ${f(cy + r * Math.sin(a))}`;
  }).join(' ') + 'Z';
const poly = (pts) => pts.map(([x, y], i) => `${i ? 'L' : 'M'}${f(x)} ${f(y)}`).join(' ') + 'Z';

// ---------- the emblems: (palette) => svg inner markup ----------
// palette: m = body gradient, l = light, d = dark side, k = deep shade, w = white
const E = {};

E.minecraft = (P) => `
<path d="M32 5 L57 19.5 L32 34 L7 19.5Z" fill="${P.l}"/>
<path d="M7 19.5 L32 34 V60 L7 45.5Z" fill="${P.m}"/>
<path d="M57 19.5 L32 34 V60 L57 45.5Z" fill="${P.d}"/>
<path d="M32 11 L40 15.6 L32 20.2 L24 15.6Z" fill="#fff" fill-opacity=".38"/>
<path d="M13 28 l8 4.6 v7 l-8 -4.6z M43 33 l8 -4.6 v7 l-8 4.6z" fill="#fff" fill-opacity=".22"/>
<path d="M7 19.5 L32 34 L57 19.5 M32 34 V60" stroke="#fff" stroke-opacity=".4" stroke-width="1.4" stroke-linejoin="round"/>`;

E.mbe = (P) => `
<path d="M32 5 L57 19.5 L32 34 L7 19.5Z" fill="${P.l}"/>
<path d="M7 19.5 L32 34 V60 L7 45.5Z" fill="${P.m}"/>
<path d="M57 19.5 L32 34 V60 L57 45.5Z" fill="${P.d}"/>
<path d="M32 12 L36 14.4 L30 18.4 L26 16Z" fill="${P.k}" fill-opacity=".45"/>
<path d="M12 27 L18 33 L14.5 39 L22 45 M52 27 L46 33 L49.5 39 L42 45" stroke="#fff" stroke-opacity=".6" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
<path d="M7 19.5 L32 34 L57 19.5 M32 34 V60" stroke="#fff" stroke-opacity=".35" stroke-width="1.4" stroke-linejoin="round"/>`;

E.counterstrike2 = (P) => `
<circle cx="32" cy="32" r="20" stroke="${P.m}" stroke-width="5"/>
<circle cx="32" cy="32" r="11" stroke="${P.l}" stroke-width="2" stroke-opacity=".6"/>
<path d="M32 4V16 M32 48V60 M4 32H16 M48 32H60" stroke="${P.m}" stroke-width="5" stroke-linecap="round"/>
<circle cx="32" cy="32" r="4" fill="#fff"/>`;

E.csgo = (P) => `
<path d="M8 22V13Q8 8 13 8H22 M42 8H51Q56 8 56 13V22 M56 42V51Q56 56 51 56H42 M22 56H13Q8 56 8 51V42" stroke="${P.m}" stroke-width="5.5" stroke-linecap="round" stroke-linejoin="round"/>
<path d="M32 20V28 M32 36V44 M20 32H28 M36 32H44" stroke="${P.l}" stroke-width="3.6" stroke-linecap="round"/>
<circle cx="32" cy="32" r="3" fill="#fff"/>`;

E.counterstrike16 = (P) => `
<circle cx="32" cy="32" r="26" stroke="${P.d}" stroke-width="2.2" stroke-opacity=".7"/>
<path d="M32 6V24 M32 40V58 M6 32H24 M40 32H58" stroke="${P.m}" stroke-width="6" stroke-linecap="round"/>
<circle cx="32" cy="32" r="3.6" fill="#fff"/>`;

E.css = (P) => `
<circle cx="32" cy="32" r="22" stroke="${P.m}" stroke-width="5"/>
<path d="M12 12L21 21 M52 12L43 21 M12 52L21 43 M52 52L43 43" stroke="${P.l}" stroke-width="4.5" stroke-linecap="round"/>
<path d="M32 21V27 M32 37V43 M21 32H27 M37 32H43" stroke="${P.m}" stroke-width="3.2" stroke-linecap="round"/>
<circle cx="32" cy="32" r="3.6" fill="#fff"/>`;

E.rust = (P) => `
<path d="${gear(32, 32, 28, 22, 10, 9)}" fill="${P.d}" fill-opacity=".62" fill-rule="evenodd"/>
<g transform="rotate(32 32 32)">
  <path d="M29.4 14 H34.6 V57 Q34.6 60 32 60 Q29.4 60 29.4 57Z" fill="${P.l}"/>
  <path d="M34.6 12 C46 9 55 14 57 25 C55 34 46 38 34.6 35Z" fill="${P.m}"/>
  <path d="M38 17 C45 15.5 50 18 52 23" stroke="#fff" stroke-opacity=".6" stroke-width="2" stroke-linecap="round"/>
</g>`;

E.valheim = (P) => {
  // three triangles (a valknut-like knot): each points outwards from the centre, their bases overlap there
  const tri = (deg, col) => {
    const a = (deg * Math.PI) / 180;
    const ux = Math.cos(a), uy = -Math.sin(a);
    const px = -uy, py = ux;
    const cx = 32, cy = 36;
    const apex = [cx + 25 * ux, cy + 25 * uy];
    const b1 = [cx + 4 * ux + 13 * px, cy + 4 * uy + 13 * py];
    const b2 = [cx + 4 * ux - 13 * px, cy + 4 * uy - 13 * py];
    return `<path d="${poly([apex, b1, b2])}" stroke="${col}" stroke-width="4.6" stroke-linejoin="round"/>`;
  };
  return tri(90, P.m) + tri(210, P.l) + tri(330, '#fff');
};

E.garrysmod = (P) => `
<path transform="translate(-2.4 -9) scale(3.2)" d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.7 2.7-2.3-.7-.7-2.3z" fill="${P.m}"/>
<path transform="translate(-2.4 -9) scale(3.2)" d="M3 18l3 3 6.3-6.3-3-3z" fill="${P.d}" fill-opacity=".6"/>
<path d="M20 52 L33 39" stroke="#fff" stroke-opacity=".5" stroke-width="2.6" stroke-linecap="round"/>`;

E.teamfortress2 = (P) => `
<path d="M32 5 L55 13 V31 C55 45 45 54 32 59 C19 54 9 45 9 31 V13Z" fill="${P.m}"/>
<path d="M32 5 L55 13 V31 C55 45 45 54 32 59Z" fill="#000" fill-opacity=".14"/>
<path d="M32 9.5 L51 16 V31 C51 42 43.5 50 32 54.6 C20.5 50 13 42 13 31 V16Z" stroke="#fff" stroke-opacity=".35" stroke-width="1.6"/>
<path d="${star(32, 32, 13, 5.6)}" fill="#fff"/>`;

E.l4d2 = (P) => `
<path d="M12 10 H52 Q56 10 56 14 V50 Q56 54 52 54 H12 Q8 54 8 50 V14 Q8 10 12 10Z" fill="${P.m}"/>
<path d="M12 10 H52 Q56 10 56 14 V19 H8 V14 Q8 10 12 10Z" fill="#fff" fill-opacity=".2"/>
<path d="M26.5 17 H37.5 V27 H47 V37 H37.5 V47 H26.5 V37 H17 V27 H26.5Z" fill="#fff"/>
<path d="M26.5 17 H37.5 V20 H26.5Z" fill="${P.k}" fill-opacity=".18"/>`;

E.terraria = (P) => `
<path d="M11 57 L49 17" stroke="${P.d}" stroke-width="6" stroke-linecap="round"/>
<path d="M11 57 L49 17" stroke="${P.l}" stroke-width="2.4" stroke-linecap="round" stroke-opacity=".7"/>
<path d="M20 12 C40 2 59 13 61 40 C55 23 42 17 20 12Z" fill="${P.m}"/>
<path d="M26 13 C40 9 52 14 57 24" stroke="#fff" stroke-opacity=".55" stroke-width="2" stroke-linecap="round"/>
<path d="M13 5 L15 11 L21 13 L15 15 L13 21 L11 15 L5 13 L11 11Z" fill="#fff"/>`;

E.sdtd = (P) => `
<path d="M10 54 V22 Q10 16 16 16 H48 Q54 16 54 22 V54 Q54 58 50 58 H14 Q10 58 10 54Z" fill="#fff" fill-opacity=".95"/>
<path d="M10 28 V22 Q10 16 16 16 H48 Q54 16 54 22 V28Z" fill="${P.m}"/>
<path d="M19.5 8 H24.5 V20 H19.5Z M39.5 8 H44.5 V20 H39.5Z" fill="${P.d}"/>
<path d="M22.5 36 H41.5 L30.5 52" stroke="${P.m}" stroke-width="5.4" stroke-linecap="round" stroke-linejoin="round"/>
<path d="M46 40 C48.5 43.5 50 46 50 48.4 A4 4 0 0 1 42 48.4 C42 46 43.5 43.5 46 40Z" fill="${P.d}"/>`;

E.dayz = (P) => `
<circle cx="32" cy="32" r="25" stroke="${P.d}" stroke-width="4"/>
<circle cx="32" cy="32" r="21" stroke="${P.l}" stroke-width="1.2" stroke-opacity=".5"/>
<path d="M32 11 L37.5 26.5 L53 32 L37.5 37.5 L32 53 L26.5 37.5 L11 32 L26.5 26.5Z" fill="${P.m}"/>
<path d="M32 11 L37.5 26.5 L32 32 Z M53 32 L37.5 37.5 L32 32 Z M32 53 L26.5 37.5 L32 32 Z M11 32 L26.5 26.5 L32 32 Z" fill="#000" fill-opacity=".14"/>
<path d="M32 3 L36.4 10.5 H27.6Z" fill="#fff"/>
<circle cx="32" cy="32" r="3.4" fill="#fff"/>`;

/** a three-toed footprint (used by both ARK games) */
const footprint = (P, g = '') => `
<g ${g}>
  <path d="M32 31 C42 31 50 38 50 46 C50 53 44 56 39 54.6 C36 53.8 34 53 32 53 C30 53 28 53.8 25 54.6 C20 56 14 53 14 46 C14 38 22 31 32 31Z" fill="${P.m}"/>
  <ellipse cx="13" cy="26" rx="5.2" ry="8" transform="rotate(-24 13 26)" fill="${P.l}"/>
  <ellipse cx="32" cy="16" rx="6" ry="9.6" fill="${P.l}"/>
  <ellipse cx="51" cy="26" rx="5.2" ry="8" transform="rotate(24 51 26)" fill="${P.l}"/>
  <path d="M26 44 C28 41 31 40 34 40" stroke="#fff" stroke-opacity=".5" stroke-width="2.2" stroke-linecap="round"/>
  <path d="M30.6 11 C31 9 33 9 33.4 11" stroke="#fff" stroke-opacity=".7" stroke-width="2" stroke-linecap="round"/>
</g>`;
E.ase = (P) => footprint(P);
E.asa = (P) => `
<path d="${poly(Array.from({ length: 6 }, (_, i) => [32 + 29 * Math.cos((i * Math.PI) / 3 - Math.PI / 2), 32 + 29 * Math.sin((i * Math.PI) / 3 - Math.PI / 2)]))}" stroke="${P.l}" stroke-width="3.4" stroke-linejoin="round"/>
${footprint(P, 'transform="translate(12.2 12.4) scale(.62)"')}`;

E.conanexiles = (P) => `
<path d="M32 3 L39.5 13 V40 H24.5 V13Z" fill="${P.m}"/>
<path d="M32 3 L39.5 13 V40 H32Z" fill="#000" fill-opacity=".16"/>
<path d="M32 9 V37" stroke="#fff" stroke-opacity=".5" stroke-width="2" stroke-linecap="round"/>
<path d="M13 40 H51 V45.5 Q51 47 49.5 47 H14.5 Q13 47 13 45.5Z" fill="${P.l}"/>
<path d="M29 47 H35 V56 H29Z" fill="${P.d}"/>
<circle cx="32" cy="58.4" r="3.6" fill="${P.l}"/>`;

E.palworld = (P) => `
<path d="M32 30 C42 30 50 39 50 47 C50 53.5 44 55.5 40 54.4 C36.5 53.4 34.5 52.6 32 52.6 C29.5 52.6 27.5 53.4 24 54.4 C20 55.5 14 53.5 14 47 C14 39 22 30 32 30Z" fill="${P.m}"/>
<ellipse cx="13.5" cy="30" rx="5.6" ry="7.8" transform="rotate(-22 13.5 30)" fill="${P.l}"/>
<ellipse cx="25" cy="17.5" rx="5.8" ry="8.4" transform="rotate(-8 25 17.5)" fill="${P.l}"/>
<ellipse cx="39" cy="17.5" rx="5.8" ry="8.4" transform="rotate(8 39 17.5)" fill="${P.l}"/>
<ellipse cx="50.5" cy="30" rx="5.6" ry="7.8" transform="rotate(22 50.5 30)" fill="${P.l}"/>
<path d="M24 46 C26 43 29 41.5 32 41.5" stroke="#fff" stroke-opacity=".5" stroke-width="2.4" stroke-linecap="round"/>`;

E.factorio = (P) => `
<path d="${gear(27, 37, 25, 19, 10, 8.5)}" fill="${P.m}" fill-rule="evenodd"/>
<circle cx="27" cy="37" r="13.5" stroke="#fff" stroke-opacity=".28" stroke-width="1.6"/>
<path d="${gear(50, 14, 11.5, 8.6, 8, 3.6)}" fill="${P.l}" fill-rule="evenodd"/>`;

E.unturned = (P) => `
<path d="M16 10 H48 Q56 10 56 18 V48 Q56 56 48 56 H16 Q8 56 8 48 V18 Q8 10 16 10Z" fill="${P.m}"/>
<path d="M16 10 H48 Q56 10 56 18 V25 H8 V18 Q8 10 16 10Z" fill="${P.d}"/>
<path d="M18 30 H29 V42 H18Z M35 30 H46 V42 H35Z" fill="#fff"/>
<path d="M23 33 H29 V40 H23Z M40 33 H46 V40 H40Z" fill="${P.k}" fill-opacity=".7"/>
<path d="M23 48 H41 V52 H23Z" fill="${P.k}" fill-opacity=".55"/>`;

E.projectzomboid = (P) => `
<path d="M32 6 C17.5 6 9 16.5 9 28.5 C9 36 13 41 18 44 V53 H46 V44 C51 41 55 36 55 28.5 C55 16.5 46.5 6 32 6Z" fill="${P.m}"/>
<path d="M32 6 C46.5 6 55 16.5 55 28.5 C55 36 51 41 46 44 V53 H32Z" fill="#000" fill-opacity=".14"/>
<ellipse cx="22.5" cy="30" rx="6.4" ry="7.2" fill="${P.k}" fill-opacity=".85"/>
<ellipse cx="41.5" cy="30" rx="6.4" ry="7.2" fill="${P.k}" fill-opacity=".85"/>
<path d="M32 36.5 L28.5 44 H35.5Z" fill="${P.k}" fill-opacity=".8"/>
<path d="M25.5 47 V53 M32 47 V53 M38.5 47 V53" stroke="${P.k}" stroke-opacity=".6" stroke-width="2.4" stroke-linecap="round"/>
<path d="M18 17 C21 12 26 9.5 31 9.2" stroke="#fff" stroke-opacity=".5" stroke-width="2.4" stroke-linecap="round"/>`;

E.gta5f = (P) => `
<path d="M3 42 V35 Q3 29.5 9 28.5 L18 26.5 L25.5 17 H42 L50.5 26.5 H56 Q61 27.5 61 33 V42Z" fill="${P.m}"/>
<path d="M3 36 H61 V42 H3Z" fill="#000" fill-opacity=".14"/>
<path d="M28 20.4 H40.2 L45.8 26.5 H22.6Z" fill="${P.k}" fill-opacity=".6"/>
<path d="M30.5 21 L31 25.6" stroke="#fff" stroke-opacity=".5" stroke-width="1.6"/>
<path d="M53 33 H59" stroke="#fff" stroke-opacity=".7" stroke-width="2.6" stroke-linecap="round"/>
<circle cx="17.5" cy="42.5" r="8" fill="${P.k}"/>
<circle cx="47.5" cy="42.5" r="8" fill="${P.k}"/>
<circle cx="17.5" cy="42.5" r="4" fill="${P.l}"/>
<circle cx="47.5" cy="42.5" r="4" fill="${P.l}"/>`;

E.gtasam = (P) => `
<circle cx="13.5" cy="14" r="7.5" fill="${P.l}"/>
<path d="M29.5 60 C29.5 46 32 34 39 23" stroke="${P.d}" stroke-width="5" stroke-linecap="round"/>
<path d="M39 23 C30 15 19 17 12 26 C21 21 30 21 39 23Z" fill="${P.m}"/>
<path d="M39 23 C35 10 25 5 16 8 C26 9 33 14 39 23Z" fill="${P.l}"/>
<path d="M39 23 C45 11 54 9 60 13 C52 14 45 17 39 23Z" fill="${P.m}"/>
<path d="M39 23 C49 20 57 26 60 34 C53 28 46 26 39 23Z" fill="${P.l}"/>
<path d="M39 23 C34 27 31 33 31 40 C35 32 38 28 39 23Z" fill="${P.d}"/>
<circle cx="39" cy="23" r="3" fill="${P.k}" fill-opacity=".6"/>`;

E.teamspeak3 = (P) => `
<path d="M12 37 V32 C12 20.5 20.5 12 32 12 C43.5 12 52 20.5 52 32 V37" stroke="${P.m}" stroke-width="5.4" stroke-linecap="round"/>
<path d="M9 36 H17 V52 H12 Q9 52 9 49Z" fill="${P.l}"/>
<path d="M55 36 H47 V52 H52 Q55 52 55 49Z" fill="${P.l}"/>
<path d="M17 38 V50 H12 Q9 50 9 47V38Z M47 38 V50 H52 Q55 50 55 47 V38Z" fill="${P.d}" fill-opacity=".55"/>
<path d="M51 52 Q51 59 38 59" stroke="${P.m}" stroke-width="3.4" stroke-linecap="round"/>
<circle cx="35.5" cy="59" r="3.4" fill="#fff"/>
<path d="M19 22 C22 16 27 13 32 13" stroke="#fff" stroke-opacity=".5" stroke-width="2" stroke-linecap="round"/>`;

// ---------- build ----------
const gamesTs = fs.readFileSync(path.join(root, 'src/core-frontend/src/games.ts'), 'utf8');
const COLOR = {};
for (const m of gamesTs.matchAll(/\{\s*id:\s*'([a-z0-9_]+)'[^}]*color:\s*'(#[0-9a-fA-F]{6})'/g)) COLOR[m[1]] = m[2];

function svgOf(id) {
  const c = COLOR[id];
  if (!c) throw new Error('no colour for ' + id);
  const P = { m: 'url(#m)', l: lighten(c, 0.55), d: darken(c, 0.32), k: darken(c, 0.62), w: '#fff' };
  const body = E[id](P).trim();
  return `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64" fill="none"><defs><linearGradient id="m" x1="0" y1="0" x2="0" y2="64" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="${lighten(c, 0.42)}"/><stop offset="1" stop-color="${c}"/></linearGradient></defs>${body}</svg>\n`;
}

async function main() {
  const ids = Object.keys(E);
  const outDir = path.join(root, 'src/core-frontend/public/games');
  const b64 = {};
  const tiles = [];
  for (const id of ids) fs.writeFileSync(path.join(outDir, `${id}.svg`), svgOf(id));

  // rasterise: one page with every emblem at 192 px on a transparent background, one screenshot, cut into tiles
  const COLS = 8, S = 192;
  const rows = Math.ceil(ids.length / COLS);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'emblems-'));
  const html = path.join(tmp, 'sheet.html');
  const url = (p) => 'file:///' + p.split(path.sep).join('/');
  fs.writeFileSync(html, `<!doctype html><meta charset="utf-8"><body style="margin:0;background:transparent">${ids
    .map((id, i) => `<img src="${url(path.join(outDir, id + '.svg'))}" width="${S}" height="${S}" style="position:absolute;left:${(i % COLS) * S}px;top:${Math.floor(i / COLS) * S}px">`)
    .join('')}`);
  const shot = path.join(tmp, 'sheet.png');
  const chrome = [process.env.CHROME, 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'].find((p) => p && fs.existsSync(p));
  if (!chrome) throw new Error('Chrome not found: set CHROME to its path');
  const r = spawnSync(chrome, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--default-background-color=00000000', `--user-data-dir=${path.join(tmp, 'profile')}`,
    `--window-size=${COLS * S},${rows * S}`, '--virtual-time-budget=4000', `--screenshot=${shot}`, url(html)], { stdio: 'ignore', timeout: 60_000 });
  if (!fs.existsSync(shot)) throw new Error('Chrome made no screenshot (exit ' + r.status + ')');
  const sheetImg = await loadImage(shot);
  for (let i = 0; i < ids.length; i++) {
    const cv = new Canvas(S, S);
    cv.getContext('2d').drawImage(sheetImg, (i % COLS) * S, Math.floor(i / COLS) * S, S, S, 0, 0, S, S);
    const png = await cv.toBuffer('png');
    b64[ids[i]] = png.toString('base64');
    tiles.push({ id: ids[i], png });
  }
  fs.rmSync(tmp, { recursive: true, force: true });

  // gameImages.ts: keep the entries of the games that are not emblems (artwork PNGs), rewrite ours
  const file = path.join(root, 'src/core-backend/src/gameImages.ts');
  const src = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
  const keep = [];
  for (const m of src.matchAll(/^ {2}([a-z0-9_]+): '([A-Za-z0-9+/=]+)',$/gm)) if (!E[m[1]]) keep.push([m[1], m[2]]);
  const all = [...keep, ...ids.map((id) => [id, b64[id]])].sort((a, b) => a[0].localeCompare(b[0]));
  const head = src.split('\n').filter((l) => l.startsWith('//')).join('\n');
  fs.writeFileSync(file, `${head}\nexport const GAME_IMAGES: Record<string, string> = {\n${all.map(([k, v]) => `  ${k}: '${v}',`).join('\n')}\n};\n`);

  const sheet = process.argv.indexOf('--sheet');
  if (sheet > 0) {
    const cols = 8, size = 128, pad = 14;
    const rows = Math.ceil(tiles.length / cols);
    const cv = new Canvas(cols * (size + pad) + pad, rows * (size * 2 + pad * 2) + pad);
    const ctx = cv.getContext('2d');
    ctx.fillStyle = '#0e0f15';
    ctx.fillRect(0, 0, cv.width, cv.height);
    for (let i = 0; i < tiles.length; i++) {
      const x = pad + (i % cols) * (size + pad);
      const y = pad + Math.floor(i / cols) * (size * 2 + pad * 2);
      const c = COLOR[tiles[i].id];
      const img = await loadImage(tiles[i].png);
      // 1: the deep tile of the panel / the card; 2: a light Discord
      const g = ctx.createLinearGradient(x, y, x + size, y + size);
      g.addColorStop(0, darken(c, 0.45));
      g.addColorStop(1, darken(c, 0.75));
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.roundRect(x, y, size, size, 34); ctx.fill();
      ctx.drawImage(img, x + size * 0.13, y + size * 0.13, size * 0.74, size * 0.74);
      ctx.fillStyle = '#f2f3f5';
      ctx.beginPath(); ctx.roundRect(x, y + size + pad, size, size, 12); ctx.fill();
      ctx.drawImage(img, x + size * 0.13, y + size + pad + size * 0.13, size * 0.74, size * 0.74);
    }
    fs.writeFileSync(process.argv[sheet + 1], await cv.toBuffer('png'));
  }
  console.log(`${ids.length} emblems: ${ids.join(', ')}`);
}
main().catch((e) => { console.error(e); process.exit(1); });
