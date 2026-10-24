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
const pwRequire = createRequire(path.join(pwDir, 'package.json'));
const { chromium } = pwRequire('playwright');
const axeMod = (() => { try { return pwRequire('@axe-core/playwright'); } catch { return null; } })();
const AxeBuilder = axeMod?.default ?? axeMod?.AxeBuilder ?? null;
// accessibility findings of every page: rule -> { impact, help, nodes, where }
const a11y = new Map();

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
      if (AxeBuilder) {
        try {
          const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
          for (const v of r.violations) {
            const e = a11y.get(v.id) ?? { impact: v.impact, help: v.help, url: v.helpUrl, nodes: 0, where: new Set(), sample: v.nodes[0]?.target?.join(' ') ?? '' };
            e.nodes += v.nodes.length;
            e.where.add(`${theme}-${sizeName}-${name}`);
            a11y.set(v.id, e);
          }
        } catch (e) { console.log('axe skipped', name, e.message); }
      }
    }
    await ctx.close();
  }
}
await browser.close();
if (AxeBuilder) {
  const order = { critical: 0, serious: 1, moderate: 2, minor: 3 };
  const rows = [...a11y.entries()].sort((a, b) => (order[a[1].impact] ?? 9) - (order[b[1].impact] ?? 9) || b[1].nodes - a[1].nodes);
  const md = ['# Accessibility (axe-core, WCAG 2.0/2.1 A and AA)', '', rows.length ? '| impact | rule | elements | pages | example |' : 'No violations found.', rows.length ? '|---|---|---|---|---|' : ''];
  for (const [id, e] of rows) md.push(`| ${e.impact} | [${id}](${e.url}): ${e.help} | ${e.nodes} | ${[...e.where].slice(0, 4).join(', ')}${e.where.size > 4 ? ` +${e.where.size - 4}` : ''} | \`${e.sample.replace(/\|/g, '/').slice(0, 80)}\` |`);
  fs.writeFileSync(path.join(outDir, 'A11Y.md'), md.join('\n') + '\n');
  console.log('a11y rules with violations:', rows.length);
}
console.log('screenshots:', fs.readdirSync(outDir).length);
