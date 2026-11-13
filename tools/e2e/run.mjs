// End-to-end scenarios on a real backend (throwaway database) and a real browser (see .github/workflows/e2e.yml).
//   node tools/e2e/run.mjs <panel url> <backend url> <database file> <playwright dir> <output dir>
// Each scenario is independent of the look of the page where it can be (ids, roles); what the bot would do (post to
// Discord) is played by the script writing the status into the database. A failed scenario leaves a picture in <output dir>.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const [panel, backend, dbFile, pwDir, outDir] = process.argv.slice(2);
const require = createRequire(path.resolve('src/core-backend/package.json'));
const Database = require('better-sqlite3');
const { chromium } = createRequire(path.join(pwDir, 'package.json'))('playwright');
fs.mkdirSync(outDir, { recursive: true });

const ADMIN = { username: 'admin', password: 'Passw0rd!long' };
const PLAYER = { username: 'e2e_player', password: 'Passw0rd!long' };
const CHANNEL = '123456789012345678';

const call = async (url, { method = 'GET', body, token } = {}) => {
  const r = await fetch(backend + url, {
    method,
    headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}), 'x-coregsm': '1' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { status: r.status, data };
};
const ok = (r, what) => { if (r.status >= 300) throw new Error(`${what}: ${r.status} ${JSON.stringify(r.data)}`); return r.data; };
const check = (cond, msg) => { if (!cond) throw new Error(msg); };

await ok(await call('/api/setup', { method: 'POST', body: { ...ADMIN, code: 'shots-code' } }), 'setup');
// E2E_CHROME: a Chrome that is already installed (no download of a browser for Playwright)
const browser = await chromium.launch(process.env.E2E_CHROME ? { executablePath: process.env.E2E_CHROME } : {});
const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 }, locale: 'ru-RU' });
await ctx.addInitScript(() => { try { localStorage.setItem('coregsm_tour_done', '1'); localStorage.setItem('coregsm_theme', 'light'); } catch { /* ignore */ } });
const page = await ctx.newPage();
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(e.message));

const state = { adminToken: '', playerToken: '', newsId: 0, commentId: 0 };
const results = [];
const scenario = async (name, fn) => {
  const t0 = Date.now();
  try { await fn(); results.push({ name, ok: true, ms: Date.now() - t0 }); console.log('ok  ', name); }
  catch (e) {
    results.push({ name, ok: false, ms: Date.now() - t0, error: e.message });
    console.log('FAIL', name, '-', e.message.split('\n')[0]);
    await page.screenshot({ path: path.join(outDir, name.replace(/\W+/g, '-') + '.png'), fullPage: true }).catch(() => undefined);
  }
};

await scenario('1 sign-in: a wrong password is refused, the right one opens the panel', async () => {
  await page.goto(panel + '/login', { waitUntil: 'networkidle' });
  const user = page.locator('input[autocomplete="username"], input[name="username"], input[type="text"]').first();
  const pw = page.locator('input[type="password"]').first();
  await user.fill(ADMIN.username);
  await pw.fill('wrong-password-1');
  await pw.press('Enter');
  await page.locator('[role="alert"]').first().waitFor({ timeout: 10000 });
  check(page.url().includes('/login'), 'still on the login page after a wrong password');
  await pw.fill(ADMIN.password);
  await pw.press('Enter');
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 15000 });
  const r = await call('/api/auth/login', { method: 'POST', body: ADMIN });
  state.adminToken = ok(r, 'login').token;
  check(state.adminToken, 'no token from the API login');
});

await scenario('2 add a server in the admin form', async () => {
  await page.goto(panel + '/admin/servers/new', { waitUntil: 'networkidle' });
  await page.locator('#srv-game').click();
  await page.keyboard.type('vrising');
  await page.keyboard.press('Enter');
  await page.locator('#srv-host').fill('203.0.113.7');
  const port = page.locator('#srv-port');
  if (!(await port.inputValue())) await port.fill('9876');
  await page.locator('.adm-sticky-foot button:not([type="button"])').click();
  await page.waitForFunction(async () => (await (await fetch('/api/servers')).text()).includes('203.0.113.7'), null, { timeout: 15000 }).catch(() => undefined);
  const list = ok(await call('/api/servers', { token: state.adminToken }), 'servers');
  check(list.some((s) => s.host === '203.0.113.7'), 'the new server is not in /api/servers');
});

await scenario('3 publish news: queued for the bot, then visible to everyone', async () => {
  const payload = { content: '', embed: { title: 'E2E release notes', description: 'Plain text of the news item', color: 5793266 } };
  const made = ok(await call('/api/news', { method: 'POST', token: state.adminToken, body: { channelId: CHANNEL, payload, action: 'now' } }), 'create news');
  state.newsId = made.id;
  check(made.status === 'queued', `status after publishing is ${made.status}, expected queued`);
  const hidden = ok(await call('/api/news'), 'public list before the bot');
  check(!hidden.some((n) => n.id === state.newsId), 'a queued item is already public');
  // the bot posts the message and reports back
  const db = new Database(dbFile);
  db.prepare("UPDATE news SET status = 'sent', sent_at = ?, message_id = '1' WHERE id = ?").run(Date.now(), state.newsId);
  db.close();
  const shown = ok(await call('/api/news'), 'public list after the bot');
  check(shown.some((n) => n.id === state.newsId), 'the posted item is not in the public list');
  await page.goto(panel + '/news', { waitUntil: 'networkidle' });
  await page.getByText('E2E release notes').first().waitFor({ timeout: 10000 });
});

await scenario('4 comment under the news item from the page', async () => {
  check(state.newsId, 'no news item from scenario 3');
  await page.goto(panel + '/news/' + state.newsId, { waitUntil: 'networkidle' });
  const box = page.locator('textarea.cm-input').first();
  await box.waitFor({ timeout: 10000 });
  await box.fill('First e2e comment');
  await box.press('Control+Enter');
  await page.locator('.cm', { hasText: 'First e2e comment' }).first().waitFor({ timeout: 10000 });
  const thread = ok(await call(`/api/news/${state.newsId}/comments`, { token: state.adminToken }), 'comments');
  const list = Array.isArray(thread) ? thread : thread.comments ?? thread.items ?? [];
  const c = list.find((x) => x.text === 'First e2e comment');
  check(c, 'the comment is not in the API thread');
  state.commentId = c.id;
});

await scenario('5 report a comment: a player flags it, a moderator sees it in the queue', async () => {
  check(state.commentId, 'no comment from scenario 4');
  const reg = await call('/api/auth/register', { method: 'POST', body: PLAYER });
  state.playerToken = ok(reg, 'register').token;
  ok(await call(`/api/news/comments/${state.commentId}/flag`, { method: 'POST', token: state.playerToken, body: {} }), 'flag');
  const q = ok(await call('/api/news/comments/queue', { token: state.adminToken }), 'queue');
  const row = q.find((x) => x.id === state.commentId);
  check(row && row.flags >= 1, 'the flagged comment is not in the moderation queue');
});

await scenario('6 report a player: the complaint reaches the moderators', async () => {
  check(state.playerToken, 'no player from scenario 5');
  ok(await call('/api/players/Griefer42/report', { method: 'POST', token: state.playerToken, body: { reason: 'abuse', text: 'e2e' } }), 'report');
  const again = await call('/api/players/Griefer42/report', { method: 'POST', token: state.playerToken, body: { reason: 'abuse', text: 'e2e' } });
  check(again.status === 409, `a second open report should be refused with 409, got ${again.status}`);
  const list = ok(await call('/api/reports', { token: state.adminToken }), 'reports');
  const rows = Array.isArray(list) ? list : list.items ?? list.reports ?? [];
  check(rows.some((r) => String(r.nick).toLowerCase() === 'griefer42'), 'the report is not in /api/reports');
});

await scenario('8 bans: a banned player appeals, a moderator accepts and the ban is lifted', async () => {
  const db = new Database(dbFile);
  db.prepare("INSERT OR REPLACE INTO game_bans (platform_id, nick, reason, admin, created_at, until, kind, server_id, scope) VALUES ('e2e-1', 'E2E_Cheater', 'aimbot', 'Boss', ?, 0, 'ban', 0, 'all')").run(Date.now());
  db.close();
  // a player who is signed out sees the list and the form
  const guest = await browser.newContext({ viewport: { width: 1366, height: 900 }, locale: 'ru-RU' });
  const gp = await guest.newPage();
  await gp.goto(panel + '/bans', { waitUntil: 'networkidle' });
  await gp.getByText('E2E_Cheater').first().waitFor({ timeout: 10000 });
  await gp.getByRole('button', { name: /Вас заблокировали/ }).click();
  await gp.locator('#bn-nick').fill('e2e_cheater');
  await gp.locator('#bn-text').fill('I was not cheating, please check the log again');
  await gp.getByRole('button', { name: 'Отправить заявку' }).click();
  await gp.getByText(/Заявка отправлена/).first().waitFor({ timeout: 10000 });
  await guest.close();
  const list = ok(await call('/api/bans/appeals', { token: state.adminToken }), 'appeals');
  check(list.some((a) => a.nick === 'E2E_Cheater' && a.status === 'open'), 'the appeal is not in the list of the staff');
  // the moderator decides in the tab of the panel
  await page.goto(panel + '/bans', { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: /^Заявки/ }).click();
  await page.getByRole('button', { name: 'Принять и снять бан' }).first().click();
  await page.getByText('Принята').first().waitFor({ timeout: 10000 });
  const left = ok(await call('/api/bans'), 'bans');
  check(!left.items.some((b) => b.nick === 'E2E_Cheater'), 'the ban is still in force after the appeal was accepted');
});

await scenario('9 status: a signed-in person subscribes to the outages of all servers', async () => {
  await page.goto(panel + '/status', { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'Уведомлять о сбоях' }).click();
  await page.getByRole('button', { name: /Уведомления о сбоях включены/ }).waitFor({ timeout: 10000 });
  const subs = ok(await call('/api/me/subscriptions', { token: state.adminToken }), 'subscriptions');
  check(Array.isArray(subs) && subs.some((x) => (x.kinds ?? []).includes('went_down')), 'no outage subscription was saved');
});

await scenario('10 a new player sees the three hints once', async () => {
  const ctx2 = await browser.newContext({ viewport: { width: 1366, height: 900 }, locale: 'ru-RU' });
  await ctx2.addInitScript(() => { try { localStorage.setItem('coregsm_theme', 'light'); } catch { /* ignore */ } });
  const p2 = await ctx2.newPage();
  await p2.goto(panel + '/login', { waitUntil: 'networkidle' });
  await p2.locator('input[autocomplete="username"], input[name="username"], input[type="text"]').first().fill(PLAYER.username);
  const pw = p2.locator('input[type="password"]').first();
  await pw.fill(PLAYER.password);
  await pw.press('Enter');
  await p2.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 15000 });
  await p2.getByRole('dialog', { name: /Добро пожаловать/ }).waitFor({ timeout: 10000 });
  await p2.getByRole('button', { name: 'Понятно' }).click();
  await p2.reload({ waitUntil: 'networkidle' });
  await p2.waitForTimeout(500);
  check((await p2.getByRole('dialog', { name: /Добро пожаловать/ }).count()) === 0, 'the hints came back after they were closed');
  await ctx2.close();
});

await scenario('11 phone: the bottom bar returns to the place left in a section', async () => {
  const servers = ok(await call('/api/servers'), 'servers');
  check(servers.length > 0, 'no server from scenario 2');
  const phone = await browser.newContext({ viewport: { width: 390, height: 800 }, locale: 'ru-RU', hasTouch: true });
  await phone.addInitScript(() => { try { localStorage.setItem('coregsm_tour_done', '1'); } catch { /* ignore */ } });
  const pp = await phone.newPage();
  await pp.goto(panel + '/servers/' + servers[0].id + '/players', { waitUntil: 'networkidle' });
  const bar = pp.locator('nav.nav-bottom');
  await bar.getByRole('link', { name: 'Новости' }).click();
  await pp.waitForURL((u) => u.pathname.startsWith('/news'), { timeout: 10000 });
  await bar.getByRole('link', { name: 'Серверы' }).click();
  await pp.waitForURL((u) => u.pathname === '/servers/' + servers[0].id + '/players', { timeout: 10000 });
  await bar.getByRole('link', { name: 'Серверы' }).click();
  await pp.waitForURL((u) => u.pathname === '/servers', { timeout: 10000 });
  await phone.close();
});

await scenario('12 a news item that names a server shows on the page of that server', async () => {
  const servers = ok(await call('/api/servers'), 'servers');
  const sid = servers[0].id;
  const payload = { content: '', embed: { title: 'E2E about a server', description: 'text' }, statusServerIds: [sid] };
  const made = ok(await call('/api/news', { method: 'POST', token: state.adminToken, body: { channelId: CHANNEL, payload, action: 'now' } }), 'create news');
  const db = new Database(dbFile);
  db.prepare("UPDATE news SET status = 'sent', sent_at = ?, message_id = '2' WHERE id = ?").run(Date.now(), made.id);
  db.close();
  await page.goto(panel + '/servers/' + sid, { waitUntil: 'networkidle' });
  await page.locator('a.sv-news', { hasText: 'E2E about a server' }).first().waitFor({ timeout: 10000 });
  await page.goto(panel + '/news', { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'Список' }).first().click();
  await page.waitForTimeout(300);
  await page.getByRole('button', { name: 'Карточки' }).first().click();
});

await scenario('14 a reload keeps the look of the community from the first paint (no second of the classic one)', async () => {
  ok(await call('/api/branding/look', { method: 'PUT', token: state.adminToken, body: { look: 'ember' } }), 'default look');
  const fresh = await browser.newContext({ viewport: { width: 1366, height: 900 }, locale: 'ru-RU' });
  // the visitor has been here: the default look is remembered, nothing else; the script records every change of the attribute
  await fresh.addInitScript(() => {
    try { localStorage.setItem('coregsm_look_default', 'ember'); localStorage.setItem('coregsm_theme', 'dark'); } catch { /* ignore */ }
    window.__lookLog = [];
    new MutationObserver(() => window.__lookLog.push(document.documentElement.getAttribute('data-ember'))).observe(document, { attributes: true, subtree: true, attributeFilter: ['data-ember'] });
  });
  const fp = await fresh.newPage();
  await fp.goto(panel + '/servers', { waitUntil: 'networkidle' });
  await fp.reload({ waitUntil: 'networkidle' });
  await fp.waitForTimeout(500);
  const log = await fp.evaluate(() => window.__lookLog);
  const now = await fp.evaluate(() => document.documentElement.getAttribute('data-ember'));
  check(now === '1', 'the page is not in the Ember look after the load');
  check(!log.includes(null), 'the Ember look was taken off for a while during the load: ' + JSON.stringify(log));
  await fresh.close();
  ok(await call('/api/branding/look', { method: 'PUT', token: state.adminToken, body: { look: 'classic' } }), 'default look back');
});

await scenario('13 the public and admin pages open without script errors', async () => {
  pageErrors.length = 0;
  for (const p of ['/servers', '/status', '/community', '/bans', '/news', '/news/' + state.newsId, '/admin', '/admin/servers', '/admin/news', '/profile']) {
    await page.goto(panel + p, { waitUntil: 'networkidle' });
    await page.waitForTimeout(400);
    check(!pageErrors.length, `script error on ${p}: ${pageErrors[0]}`);
    check((await page.locator('body').innerText()).trim().length > 20, `${p} is empty`);
  }
});

await browser.close();
const failed = results.filter((r) => !r.ok);
fs.writeFileSync(path.join(outDir, 'E2E.md'), ['# End-to-end scenarios', '', ...results.map((r) => `- ${r.ok ? 'ok' : 'FAIL'}: ${r.name} (${r.ms} ms)${r.error ? ' - ' + r.error.split('\n')[0] : ''}`)].join('\n') + '\n');
for (const f of failed) console.log(`::error title=e2e ${f.name}::${f.error.split('\n')[0]}`);
console.log(`${results.length - failed.length}/${results.length} scenarios passed`);
process.exit(failed.length ? 1 : 0);
