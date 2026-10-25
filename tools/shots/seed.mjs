// Fills a fresh demo panel with believable data: servers (one offline, one with a very long name), a day of history,
// news in three rubrics. Used by run.mjs; it never touches a real panel (it needs a database file of its own).
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(path.join(here, '../../src/core-backend/package.json'));

export const ADMIN = { username: 'admin', password: 'Passw0rd!long' };
const SETUP_CODE = 'seed-code';
const INTERNAL = 'i'.repeat(48);

// name, game, port, max, now, ping, map, online
const DEFS = [
  ['Empire Bay RP | Mafia II Online', 'm2o', 27015, 32, 21, 38, 'Empire Bay', 1],
  ['[RU] Just-Skill.Ru | Standart PvE', 'vrising', 9876, 40, 27, 48, 'VRisingWorld', 1],
  ['Minecraft Survival', 'minecraft', 25565, 40, 14, 31, 'world', 1],
  ['Rust | Vanilla x2', 'rust', 28015, 100, 52, 44, 'Procedural Map', 1],
  ['CS2 Retake', 'counterstrike2', 27015, 10, 9, 22, 'de_mirage', 1],
  ['Palworld PvE', 'palworld', 8211, 32, 17, 52, 'Palpagos', 1],
  // a very long name with no spaces to break on: the usual way a layout breaks
  ['Valheim_Co-op_Very_Long_Server_Name_Without_Spaces_To_Break_On_Midgard_Season_12', 'valheim', 2456, 10, 3, 67, 'Midgard', 1],
  ['Terraria Hardcore', 'terraria', 7777, 16, 0, 0, '', 0],
];

export async function seed({ base, dbPath }) {
  const H = { 'content-type': 'application/json', 'x-coregsm': '1' };
  const call = async (method, url, body, token, extra = {}) => {
    const r = await fetch(base + url, { method, headers: { ...H, ...(token ? { authorization: `Bearer ${token}` } : {}), ...extra }, body: body ? JSON.stringify(body) : undefined });
    const text = await r.text();
    if (!r.ok) throw new Error(`${method} ${url} -> ${r.status} ${text.slice(0, 200)}`);
    return text ? JSON.parse(text) : {};
  };
  const token = (await call('POST', '/api/setup', { ...ADMIN, code: SETUP_CODE })).token;
  await call('PUT', '/api/access', { publicPanel: true }, token);

  // 127.0.0.1 so that the first poll fails at once (nothing waits for a timeout); real-looking addresses are written afterwards
  const ids = [];
  for (const [name, game, port] of DEFS) ids.push((await call('POST', '/api/servers', { name: name.slice(0, 60), game, host: '127.0.0.1', port: port + 20000 }, token)).id);
  await new Promise((r) => setTimeout(r, 2500));

  const Database = require('better-sqlite3');
  const db = new Database(dbPath);
  const now = Date.now();
  db.prepare('DELETE FROM history').run();
  const ins = db.prepare('INSERT INTO history (server_id, ts, online, players, ping, unconfirmed, maint) VALUES (?,?,?,?,?,0,0)');
  DEFS.forEach(([name, , port, max, pl, ping, map, online], i) => {
    db.prepare('UPDATE servers SET name=?, host=?, port=? WHERE id=?').run(name, `203.0.113.${i + 10}`, port, ids[i]);
    db.prepare('UPDATE status SET online=?, name=?, players=?, max_players=?, map=?, version=?, ping=?, updated_at=? WHERE server_id=?').run(online, name, pl, max, map, '1.6.0', online ? ping : null, now, ids[i]);
    for (let m = 24 * 60; m >= 0; m -= 5) {
      const ts = now - m * 60_000;
      const hour = new Date(ts).getHours() + new Date(ts).getMinutes() / 60;
      const wave = 0.5 + 0.5 * Math.sin(((hour - 14) / 24) * Math.PI * 2 + Math.PI / 2 * 0.2);
      const noise = 0.9 + 0.2 * Math.sin(m * 1.7 + i);
      const down = !online || (i === 6 && m > 400 && m < 470);
      ins.run(ids[i], ts, down ? 0 : 1, down ? 0 : Math.max(0, Math.round(max * (pl / max) * 1.15 * (0.35 + 0.65 * wave) * noise)), down ? null : ping);
    }
    db.prepare('INSERT OR REPLACE INTO uptime_daily (server_id, day, up, total, peak) VALUES (?,?,?,?,?)').run(ids[i], new Date().toISOString().slice(0, 10), online ? (i === 6 ? 270 : 288) : 0, 288, pl + 4);
  });
  db.close();

  const items = [
    { category: 'wipe', embed: { title: '🔥 Вайп Rust в субботу в 18:00', description: 'Карта 4000, x2, новые правила рейдов. Заходите заранее.', color: 0xea580c } },
    { category: 'update', embed: { title: 'Обновление Mafia II Online 1.6.0', description: 'Новые машины, исправлены вылеты, ускорен вход на сервер.' } },
    { category: 'event', embed: { title: 'Ивент выходного дня с очень длинным_заголовком_без_пробелов_чтобы_проверить_перенос', description: 'Двойной опыт на всех серверах до понедельника.' } },
  ];
  for (const it of items) {
    await call('POST', '/api/news', { channelId: '123456789012345678', action: 'now', payload: { content: '', mention: 'none', category: it.category, embed: it.embed } }, token);
  }
  // the bot is not running: mark the news as sent the way it would, so that they show on the public pages
  const pend = await call('GET', '/internal/news/pending', null, null, { 'x-internal-token': INTERNAL });
  for (const p of pend) await call('PATCH', `/internal/news/${p.id}`, { status: 'sent', messageId: `1${String(p.id).padStart(18, '0')}` }, null, { 'x-internal-token': INTERNAL });
  return { ids };
}
