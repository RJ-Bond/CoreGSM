// Screenshots of the panel on demo data, for review of visual changes (see .github/workflows/screenshots.yml).
//   node tools/screenshots/shoot.mjs <panel url> <backend url> <database file> <playwright dir> <output dir>
// The backend runs on a throwaway database; the script creates the administrator, seeds servers with a day of history,
// signs in through the real login form and photographs the pages in a phone and a desktop size, light and dark.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const [panel, backend, dbFile, pwDir, outDir] = process.argv.slice(2);
const DAY = 86_400_000;
const require = createRequire(path.resolve('src/core-backend/package.json'));
const Database = require('better-sqlite3');
const { chromium } = createRequire(path.join(pwDir, 'package.json'))('playwright');

const ADMIN = { username: 'admin', password: 'Passw0rd!long' };
const post = async (url, body) => {
  const r = await fetch(backend + url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(url + ' -> ' + r.status + ' ' + (await r.text()));
};

await post('/api/setup', { ...ADMIN, code: 'shots-code' });

// ---- demo servers: a busy one, a quiet one and a small one of two other games
const db = new Database(dbFile);
const now = Date.now();
const demo = [
  { name: '[RU] Demo | Standart PvE', game: 'vrising', host: 'v.demo.example', port: 9876, players: 18, max: 40, ping: 42, map: 'VRisingWorld', base: 14, amp: 12 },
  { name: '[RU] Demo | Lite Brutal PvE', game: 'vrising', host: 'v.demo.example', port: 9878, players: 2, max: 40, ping: 48, map: 'VRisingWorld', base: 2, amp: 3 },
  { name: '[RU] Demo', game: 'icarus', host: 'icarus.demo.example', port: 27017, players: 0, max: 8, ping: 49, map: '', base: 0, amp: 1 },
  { name: '[RU] Demo | Roleplay [Alpha]', game: 'm2o', host: '203.0.113.15', port: 27015, players: 0, max: 64, ping: 3, map: '', base: 0, amp: 0 },
];
const insServer = db.prepare('INSERT INTO servers (name, game, host, port, created_at) VALUES (?, ?, ?, ?, ?)');
const insStatus = db.prepare('INSERT OR REPLACE INTO status (server_id, online, name, players, max_players, map, ping, player_names, updated_at) VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?)');
const insHist = db.prepare('INSERT INTO history (server_id, ts, online, players, ping) VALUES (?, ?, 1, ?, ?)');
const insUp = db.prepare('INSERT OR REPLACE INTO uptime_daily (server_id, day, up, total, peak) VALUES (?, ?, ?, ?, ?)');
for (const s of demo) {
  const id = Number(insServer.run(s.name, s.game, s.host, s.port, now - 40 * DAY).lastInsertRowid);
  const names = Array.from({ length: s.players }, (_, i) => 'Player' + (i + 1));
  insStatus.run(id, s.name, s.players, s.max, s.map, s.ping, JSON.stringify(names), now - 4000);
  for (let t = now - DAY; t <= now; t += 5 * 60_000) {
    const h = (t % DAY) / 3_600_000;
    const n = Math.max(0, Math.round(s.base + s.amp * Math.sin(((h - 14) / 24) * Math.PI * 2) + ((t / 60000) % 3)));
    insHist.run(id, t, Math.min(n, s.max), s.ping + ((t / 60000) % 7));
  }
  for (let d = 0; d < 30; d++) insUp.run(id, new Date(now - d * DAY).toISOString().slice(0, 10), 287 - (d === 5 ? 1 : 0), 288, s.base + s.amp);
}
db.close();

fs.mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch();
const sizes = { phone: { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true }, desktop: { width: 1366, height: 900, deviceScaleFactor: 1 } };
const pages = [['servers', '/servers'], ['server', '/servers/1'], ['status', '/status'], ['community', '/community'], ['news', '/news'], ['admin', '/admin']];

for (const theme of ['dark', 'light']) {
  for (const [sizeName, size] of Object.entries(sizes)) {
    const ctx = await browser.newContext({ viewport: { width: size.width, height: size.height }, deviceScaleFactor: size.deviceScaleFactor, isMobile: size.isMobile, hasTouch: size.hasTouch, locale: 'ru-RU', timezoneId: 'Europe/Moscow' });
    await ctx.addInitScript((t) => { try { localStorage.setItem('coregsm_theme', t); localStorage.setItem('coregsm_tour_done', '1'); } catch { /* ignore */ } }, theme);
    const page = await ctx.newPage();
    await page.goto(panel + '/login', { waitUntil: 'networkidle' });
    await page.screenshot({ path: path.join(outDir, `${theme}-${sizeName}-login.png`) });
    await page.locator('input[autocomplete="username"], input[name="username"], input[type="text"]').first().fill(ADMIN.username);
    const pw = page.locator('input[type="password"]').first();
    await pw.fill(ADMIN.password);
    await pw.press('Enter');
    await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 15000 }).catch(() => undefined);
    for (const [name, p] of pages) {
      await page.goto(panel + p, { waitUntil: 'networkidle' }).catch(() => undefined);
      await page.waitForTimeout(1200);
      // the first screen as the visitor sees it (a full-page picture moves fixed bars into the middle of the page)
      await page.screenshot({ path: path.join(outDir, `${theme}-${sizeName}-${name}-top.png`) }).catch((e) => console.log('skip', name, e.message));
      await page.screenshot({ path: path.join(outDir, `${theme}-${sizeName}-${name}.png`), fullPage: true }).catch((e) => console.log('skip', name, e.message));
    }
    await ctx.close();
  }
}
await browser.close();
console.log('screenshots:', fs.readdirSync(outDir).length);
