/**
 * Operations for administrators: action log, bulk actions on Discord bindings,
 * system health and diagnostics, database backup and restore.
 */
import express, { type Express, type NextFunction, type Request, type RequestHandler, type Response } from 'express';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { z } from 'zod';
import { db, getSetting } from './db.js';

const DB_PATH = process.env.DB_PATH ?? './data/coregsm.db';
const DATA_DIR = path.dirname(DB_PATH);
const startedAt = Date.now();

// ---------- action log ----------
interface Rule {
  m: string;
  re: RegExp;
  label: string;
  /** looked up before the handler runs (a deleted row can no longer be read afterwards) */
  pre?: (id: string) => string | null;
  detail?: (req: Request, pre: string | null) => string;
  /** the user is not signed in yet: take the name from the body */
  anon?: boolean;
}

const nameOf = (sql: string) => (id: string) => (db.prepare(sql).get(Number(id)) as { n: string } | undefined)?.n ?? null;
const serverName = nameOf("SELECT COALESCE(NULLIF(name, ''), host || ':' || port) AS n FROM servers WHERE id = ?");
const userName = nameOf('SELECT username AS n FROM users WHERE id = ?');
const s = (v: unknown, n = 80) => (typeof v === 'string' ? v.slice(0, n) : '');

const RULES: Rule[] = [
  { m: 'POST', re: /^\/api\/servers$/, label: 'Добавлен сервер', detail: (r) => s(r.body?.name) || `${s(r.body?.host)}:${Number(r.body?.port) || ''}` },
  { m: 'PUT', re: /^\/api\/servers\/(\d+)$/, label: 'Изменён сервер', pre: serverName },
  { m: 'DELETE', re: /^\/api\/servers\/(\d+)$/, label: 'Удалён сервер', pre: serverName },
  { m: 'POST', re: /^\/api\/bindings$/, label: 'Создана привязка Discord', detail: (r) => `сервер #${Number(r.body?.serverId) || '?'}` },
  { m: 'PUT', re: /^\/api\/bindings\/(\d+)$/, label: 'Изменена привязка Discord', pre: (id) => `#${id}` },
  { m: 'DELETE', re: /^\/api\/bindings\/(\d+)$/, label: 'Удалена привязка Discord', pre: (id) => `#${id}` },
  { m: 'POST', re: /^\/api\/bindings\/bulk$/, label: 'Массовое действие с привязками', detail: (r) => `${s(r.body?.action, 12)} × ${Array.isArray(r.body?.ids) ? r.body.ids.length : 0}` },
  { m: 'PUT', re: /^\/api\/settings$/, label: 'Изменены настройки бота', detail: (r) => [r.body?.discordToken !== undefined ? 'токен' : '', r.body?.proxyUrl !== undefined ? 'прокси' : ''].filter(Boolean).join(', ') },
  { m: 'POST', re: /^\/api\/news$/, label: 'Создана новость', detail: (r) => s(r.body?.payload?.embed?.title) || s(r.body?.payload?.content, 60) },
  { m: 'PUT', re: /^\/api\/news\/(\d+)$/, label: 'Изменена новость', pre: (id) => `#${id}` },
  { m: 'POST', re: /^\/api\/news\/(\d+)\/publish$/, label: 'Новость отправлена в Discord', pre: (id) => `#${id}` },
  { m: 'DELETE', re: /^\/api\/news\/(\d+)$/, label: 'Удалена новость', pre: (id) => `#${id}` },
  { m: 'PUT', re: /^\/api\/news\/settings$/, label: 'Изменён канал новостей' },
  { m: 'PUT', re: /^\/api\/users\/(\d+)$/, label: 'Изменена роль пользователя', pre: userName, detail: (r, p) => `${p ?? ''} → ${s(r.body?.role, 10)}` },
  { m: 'PUT', re: /^\/api\/users\/(\d+)\/password$/, label: 'Сброшен пароль пользователя', pre: userName },
  { m: 'DELETE', re: /^\/api\/users\/(\d+)$/, label: 'Удалён пользователь', pre: userName },
  { m: 'PUT', re: /^\/api\/access$/, label: 'Изменён доступ к панели', detail: (r) => [r.body?.publicPanel !== undefined ? `открыта: ${r.body.publicPanel ? 'да' : 'нет'}` : '', r.body?.registration !== undefined ? `регистрация: ${r.body.registration ? 'да' : 'нет'}` : ''].filter(Boolean).join(', ') },
  { m: 'PUT', re: /^\/api\/branding$/, label: 'Изменено оформление', detail: (r) => s(r.body?.name, 32) },
  { m: 'PUT', re: /^\/api\/branding\/logo$/, label: 'Загружен логотип' },
  { m: 'DELETE', re: /^\/api\/branding\/logo$/, label: 'Сброшен логотип' },
  { m: 'POST', re: /^\/api\/update\/apply$/, label: 'Запущено обновление панели' },
  { m: 'POST', re: /^\/api\/backup\/restore$/, label: 'Восстановлена резервная копия' },
  { m: 'POST', re: /^\/api\/auth\/login$/, label: 'Вход', anon: true },
  { m: 'POST', re: /^\/api\/auth\/register$/, label: 'Регистрация', anon: true },
  { m: 'POST', re: /^\/api\/auth\/password$/, label: 'Смена пароля' },
  { m: 'POST', re: /^\/api\/users\/(\d+)\/approve$/, label: 'Одобрена заявка на регистрацию', pre: userName },
  { m: 'POST', re: /^\/api\/sessions\/revoke-others$/, label: 'Завершены остальные сеансы' },
];

/** records every successful change made through the panel; must be installed before the routes */
export function installAudit(app: Express): void {
  const insert = db.prepare('INSERT INTO audit (ts, actor, action, detail) VALUES (?, ?, ?, ?)');
  app.use('/api', (req: Request, res: Response, next: NextFunction) => {
    if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return next();
    const url = req.originalUrl.split('?')[0];
    let match: RegExpExecArray | null = null;
    const rule = RULES.find((r) => r.m === req.method && (match = r.re.exec(url)) !== null);
    if (!rule || !match) return next();
    const id = (match as RegExpExecArray)[1] ?? '';
    const pre = rule.pre ? rule.pre(id) : null;
    res.on('finish', () => {
      if (res.statusCode >= 400) return;
      try {
        const user = (req as Request & { user?: { username: string } }).user;
        const actor = user?.username ?? (rule.anon ? s(req.body?.username, 40) : '') ?? '';
        const detail = rule.detail ? rule.detail(req, pre) : (pre ?? '');
        insert.run(Date.now(), actor || '—', rule.label, detail.trim());
        db.prepare('DELETE FROM audit WHERE id <= (SELECT MAX(id) - 2000 FROM audit)').run();
      } catch (e) {
        console.error('audit failed', (e as Error).message);
      }
    });
    next();
  });
}

interface Ctx {
  app: Express;
  admin: RequestHandler;
  getBot: () => { state: string; tag: string | null; error: string | null; updatedAt: number };
  guildCount: () => number;
  version: string;
  pollMs: number;
}

export function registerOps({ app, admin, getBot, guildCount, version, pollMs }: Ctx): void {
  // ----- log -----
  app.get('/api/audit', admin, (req, res) => {
    const limit = Math.min(500, Math.max(1, Number(req.query.limit) || 200));
    res.json(db.prepare('SELECT id, ts, actor, action, detail FROM audit ORDER BY id DESC LIMIT ?').all(limit));
  });

  // ----- bulk actions on bindings -----
  app.post('/api/bindings/bulk', admin, (req, res) => {
    const b = z
      .object({ ids: z.array(z.number().int()).min(1).max(500), action: z.enum(['pause', 'resume', 'delete']) })
      .safeParse(req.body);
    if (!b.success) return res.status(400).json({ error: 'Выберите привязки и действие' });
    const marks = b.data.ids.map(() => '?').join(',');
    const r =
      b.data.action === 'delete'
        ? db.prepare(`DELETE FROM bindings WHERE id IN (${marks})`).run(...b.data.ids)
        : db.prepare(`UPDATE bindings SET enabled = ? WHERE id IN (${marks})`).run(b.data.action === 'resume' ? 1 : 0, ...b.data.ids);
    res.json({ changed: r.changes });
  });

  // ----- health -----
  const freeSpace = () => {
    try {
      const st = fs.statfsSync(DATA_DIR);
      return { free: Number(st.bavail) * Number(st.bsize), total: Number(st.blocks) * Number(st.bsize) };
    } catch {
      return { free: null, total: null };
    }
  };
  const count = (sql: string) => (db.prepare(sql).get() as { c: number }).c;

  app.get('/api/system', admin, (_req, res) => {
    const space = freeSpace();
    const dbBytes = (() => {
      try {
        return fs.statSync(DB_PATH).size;
      } catch {
        return null;
      }
    })();
    res.json({
      version: version || null,
      uptimeSec: Math.round((Date.now() - startedAt) / 1000),
      node: process.version,
      dbBytes,
      diskFree: space.free,
      diskTotal: space.total,
      memoryMb: Math.round(process.memoryUsage().rss / 1048576),
      counts: {
        servers: count('SELECT COUNT(*) AS c FROM servers'),
        online: count('SELECT COUNT(*) AS c FROM status WHERE online = 1'),
        bindings: count('SELECT COUNT(*) AS c FROM bindings'),
        users: count('SELECT COUNT(*) AS c FROM users'),
        history: count('SELECT COUNT(*) AS c FROM history'),
      },
      bot: getBot(),
      guilds: guildCount(),
      publicBase: getSetting('public_base') || null,
    });
  });

  type Check = { id: string; label: string; status: 'ok' | 'warn' | 'fail'; detail: string };
  const probe = async (url: string): Promise<boolean> => {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(6000), headers: { 'User-Agent': 'CoreGSM' } });
      return r.status < 500;
    } catch {
      return false;
    }
  };

  app.post('/api/system/run', admin, async (_req, res) => {
    const checks: Check[] = [];
    const add = (id: string, label: string, status: Check['status'], detail: string) => checks.push({ id, label, status, detail });

    try {
      const q = db.pragma('quick_check', { simple: true });
      add('db', 'База данных', q === 'ok' ? 'ok' : 'fail', q === 'ok' ? 'Целостность в порядке' : `Проверка вернула: ${String(q)}`);
    } catch (e) {
      add('db', 'База данных', 'fail', (e as Error).message);
    }

    const sp = freeSpace();
    if (sp.free == null) add('disk', 'Место на диске', 'warn', 'Не удалось определить');
    else {
      const gb = (sp.free / 1073741824).toFixed(1);
      add('disk', 'Место на диске', sp.free < 300 * 1048576 ? 'fail' : sp.free < 1073741824 ? 'warn' : 'ok', `Свободно ${gb} ГБ`);
    }

    const bot = getBot();
    const tokenSet = !!getSetting('discord_token');
    if (!tokenSet) add('token', 'Токен Discord-бота', 'warn', 'Не задан: Настройки → Discord-бот');
    else add('token', 'Токен Discord-бота', 'ok', 'Задан');
    if (tokenSet) {
      const stale = Date.now() - bot.updatedAt > 45_000;
      if (stale) add('bot', 'Discord-бот', 'fail', 'Не отвечает. На сервере: sudo coregsm logs bot');
      else if (bot.state === 'online') add('bot', 'Discord-бот', 'ok', `Подключён${bot.tag ? ` как ${bot.tag}` : ''}`);
      else add('bot', 'Discord-бот', bot.state === 'error' ? 'fail' : 'warn', bot.error ?? `Состояние: ${bot.state}`);
      const g = guildCount();
      add('guilds', 'Серверы Discord, где есть бот', g > 0 ? 'ok' : 'warn', g > 0 ? `Найдено: ${g}` : 'Бот пока нигде не добавлен: используйте кнопку приглашения');
    }

    const last = (db.prepare('SELECT MAX(updated_at) AS t FROM status').get() as { t: number | null }).t;
    const total = count('SELECT COUNT(*) AS c FROM servers');
    if (total === 0) add('poll', 'Опрос игровых серверов', 'warn', 'Серверов ещё нет');
    else if (!last || Date.now() - last > Math.max(pollMs * 5, 120_000)) add('poll', 'Опрос игровых серверов', 'fail', 'Давно не было ответов: проверьте журнал backend');
    else add('poll', 'Опрос игровых серверов', 'ok', `Последний опрос ${Math.round((Date.now() - last) / 1000)} с назад`);

    const base = getSetting('public_base');
    add('public', 'Публичный адрес (значки в Discord)', base ? 'ok' : 'warn', base ? base : 'Откройте панель по домену с https, и значки игр появятся в сообщениях');

    const [gh, ds] = await Promise.all([probe('https://api.github.com'), getSetting('proxy_url') ? Promise.resolve(true) : probe('https://discord.com/api/v10/gateway')]);
    add('github', 'Доступ к GitHub (обновления)', gh ? 'ok' : 'warn', gh ? 'Доступен' : 'Нет ответа: проверка обновлений не сработает');
    add('discord-net', 'Доступ к Discord', ds ? 'ok' : 'fail', getSetting('proxy_url') ? 'Работа идёт через прокси' : ds ? 'Доступен напрямую' : 'Нет ответа. Включите прокси в настройках бота');
    res.json({ at: Date.now(), checks });
  });

  // ----- backup -----
  app.get('/api/backup', admin, async (_req, res) => {
    const tmp = path.join(os.tmpdir(), `coregsm-backup-${Date.now()}.db`);
    try {
      await db.backup(tmp);
    } catch (e) {
      return res.status(500).json({ error: `Не удалось создать копию: ${(e as Error).message}` });
    }
    const d = new Date();
    const p = (n: number) => String(n).padStart(2, '0');
    const name = `coregsm-backup-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}.db`;
    res.download(tmp, name, () => fs.rmSync(tmp, { force: true }));
  });

  app.post('/api/backup/restore', admin, express.raw({ type: 'application/octet-stream', limit: '300mb' }), (req, res) => {
    const body = req.body as Buffer;
    if (!Buffer.isBuffer(body) || body.length < 4096 || body.subarray(0, 15).toString('latin1') !== 'SQLite format 3') {
      return res.status(400).json({ error: 'Это не файл резервной копии CoreGSM (.db)' });
    }
    const pending = path.join(DATA_DIR, 'restore-pending.db');
    try {
      fs.writeFileSync(pending, body);
      const t = new Database(pending, { readonly: true });
      const tables = (t.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]).map((x) => x.name);
      const ok = ['users', 'servers', 'settings'].every((n) => tables.includes(n)) && t.pragma('quick_check', { simple: true }) === 'ok';
      t.close();
      for (const ext of ['-wal', '-shm']) fs.rmSync(`${pending}${ext}`, { force: true });
      if (!ok) throw new Error('bad');
    } catch {
      fs.rmSync(pending, { force: true });
      return res.status(400).json({ error: 'Файл повреждён или это копия не от CoreGSM' });
    }
    // the swap happens at start-up (see db.ts); the container restarts by itself
    res.json({ ok: true, restarting: true });
    setTimeout(() => process.exit(0), 800);
  });
}
