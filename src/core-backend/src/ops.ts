/**
 * Operations for administrators: action log, bulk actions on Discord bindings,
 * system health and diagnostics, database backup and restore.
 */
import type { Express, NextFunction, Request, RequestHandler, Response } from 'express';
import fs from 'node:fs';
import tls from 'node:tls';
import { z } from 'zod';
import { DATA_DIR, db, getSetting } from './db.js';

const DB_PATH = process.env.DB_PATH ?? './data/coregsm.db';
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
  { m: 'PUT', re: /^\/api\/servers\/(\d+)\/cover$/, label: 'Загружена обложка сервера', pre: serverName },
  { m: 'DELETE', re: /^\/api\/servers\/(\d+)\/cover$/, label: 'Убрана обложка сервера', pre: serverName },
  { m: 'POST', re: /^\/api\/bindings$/, label: 'Создана привязка Discord', detail: (r) => `сервер #${Number(r.body?.serverId) || '?'}` },
  { m: 'PUT', re: /^\/api\/bindings\/(\d+)$/, label: 'Изменена привязка Discord', pre: (id) => `#${id}` },
  { m: 'DELETE', re: /^\/api\/bindings\/(\d+)$/, label: 'Удалена привязка Discord', pre: (id) => `#${id}` },
  { m: 'POST', re: /^\/api\/bindings\/bulk$/, label: 'Массовое действие с привязками', detail: (r) => `${s(r.body?.action, 12)} × ${Array.isArray(r.body?.ids) ? r.body.ids.length : 0}` },
  { m: 'PUT', re: /^\/api\/settings$/, label: 'Изменены настройки бота', detail: (r) => [r.body?.discordToken !== undefined ? 'токен' : '', r.body?.proxyUrl !== undefined ? 'прокси' : ''].filter(Boolean).join(', ') },
  { m: 'POST', re: /^\/api\/news$/, label: 'Создана новость', detail: (r) => s(r.body?.payload?.embed?.title) || s(r.body?.payload?.content, 60) },
  { m: 'PUT', re: /^\/api\/news\/(\d+)$/, label: 'Изменена новость', pre: (id) => `#${id}` },
  { m: 'POST', re: /^\/api\/news\/(\d+)\/publish$/, label: 'Новость отправлена в Discord', pre: (id) => `#${id}` },
  { m: 'DELETE', re: /^\/api\/news\/(\d+)$/, label: 'Удалена новость', pre: (id) => `#${id}` },
  { m: 'POST', re: /^\/api\/news\/(\d+)\/duplicate$/, label: 'Создана копия новости', pre: (id) => `#${id}` },
  { m: 'PATCH', re: /^\/api\/news\/(\d+)\/schedule$/, label: 'Изменено время публикации новости', pre: (id) => `#${id}` },
  { m: 'POST', re: /^\/api\/news\/(\d+)\/versions\/\d+\/restore$/, label: 'Новость восстановлена из версии', pre: (id) => `#${id}` },
  { m: 'POST', re: /^\/api\/news\/test$/, label: 'Тестовая отправка новости', detail: (r) => s(r.body?.payload?.embed?.title) || s(r.body?.payload?.content, 60) },
  { m: 'PUT', re: /^\/api\/news\/settings$/, label: 'Изменён канал новостей' },
  { m: 'PUT', re: /^\/api\/users\/(\d+)$/, label: 'Изменена роль пользователя', pre: userName, detail: (r, p) => `${p ?? ''} → ${s(r.body?.role, 10)}` },
  { m: 'PUT', re: /^\/api\/users\/(\d+)\/password$/, label: 'Сброшен пароль пользователя', pre: userName },
  { m: 'DELETE', re: /^\/api\/users\/(\d+)$/, label: 'Удалён пользователь', pre: userName },
  { m: 'PUT', re: /^\/api\/access$/, label: 'Изменён доступ к панели', detail: (r) => [r.body?.publicPanel !== undefined ? `открыта: ${r.body.publicPanel ? 'да' : 'нет'}` : '', r.body?.registration !== undefined ? `регистрация: ${r.body.registration ? 'да' : 'нет'}` : ''].filter(Boolean).join(', ') },
  { m: 'PUT', re: /^\/api\/branding$/, label: 'Изменено оформление', detail: (r) => s(r.body?.name, 32) },
  { m: 'PUT', re: /^\/api\/branding\/logo$/, label: 'Загружен логотип' },
  { m: 'DELETE', re: /^\/api\/branding\/logo$/, label: 'Сброшен логотип' },
  { m: 'POST', re: /^\/api\/update\/apply$/, label: 'Запущено обновление панели' },
  { m: 'POST', re: /^\/api\/update\/rollback$/, label: 'Запущен откат панели' },
  { m: 'POST', re: /^\/api\/backup\/restore$/, label: 'Восстановлена резервная копия' },
  { m: 'PUT', re: /^\/api\/backups\/settings$/, label: 'Изменены настройки резервного копирования', detail: (r) => ['schedule', 'keep', 'remoteUrl', 'passphrase'].filter((k) => r.body?.[k] !== undefined).map((k) => (k === 'schedule' ? `расписание: ${s(r.body?.schedule, 10)}` : k === 'keep' ? `хранить: ${Number(r.body?.keep) || ''}` : k === 'remoteUrl' ? 'внешняя копия' : 'шифрование')).join(', ') },
  { m: 'POST', re: /^\/api\/backups\/run$/, label: 'Создана резервная копия' },
  { m: 'DELETE', re: /^\/api\/backups\/([^/]+)$/, label: 'Удалена резервная копия', pre: (id) => s(id, 80) },
  { m: 'POST', re: /^\/api\/backups\/([^/]+)\/restore$/, label: 'Восстановлена копия из архива', pre: (id) => s(id, 80) },
  { m: 'POST', re: /^\/api\/auth\/login$/, label: 'Вход', anon: true },
  { m: 'POST', re: /^\/api\/auth\/register$/, label: 'Регистрация', anon: true },
  { m: 'POST', re: /^\/api\/auth\/password$/, label: 'Смена пароля' },
  { m: 'POST', re: /^\/api\/users\/(\d+)\/approve$/, label: 'Одобрена заявка на регистрацию', pre: userName },
  { m: 'POST', re: /^\/api\/sessions\/revoke-others$/, label: 'Завершены остальные сеансы' },
  { m: 'PUT', re: /^\/api\/alerts$/, label: 'Изменены оповещения о недоступности серверов' },
  { m: 'POST', re: /^\/api\/alerts\/test$/, label: 'Тестовое оповещение' },
];

/** records every successful change made through the panel; must be installed before the routes */
export function installAudit(app: Express): void {
  const insert = db.prepare('INSERT INTO audit (ts, actor, action, detail) VALUES (?, ?, ?, ?)');
  app.use('/api', (req: Request, res: Response, next: NextFunction) => {
    // paths are matched case-insensitively and without a trailing slash (Express routes the same way)
    const url = req.originalUrl.split('?')[0].toLowerCase().replace(/\/+$/, '');
    if (req.method === 'GET') {
      // downloads of backups are reads, but worth a log line
      if (/^\/api\/backup$/.test(url) || /^\/api\/backups\/coregsm-[\w.-]+$/.test(url)) {
        res.on('finish', () => {
          if (res.statusCode >= 400) return;
          try {
            const user = (req as Request & { user?: { username: string } }).user;
            insert.run(Date.now(), user?.username ?? '—', 'Скачана резервная копия', url === '/api/backup' ? '' : url.slice('/api/backups/'.length));
          } catch (e) {
            console.error('audit failed', (e as Error).message);
          }
        });
      }
      return next();
    }
    if (req.method === 'HEAD' || req.method === 'OPTIONS') return next();
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
  /** trusted public base URL (https://domain) or null */
  publicBase: () => string | null;
}

interface CertInfo {
  daysLeft: number | null;
  notAfter: number | null;
  issuer: string | null;
  selfSigned: boolean;
}
const NO_CERT: CertInfo = { daysLeft: null, notAfter: null, issuer: null, selfSigned: false };
let certCache: { at: number; info: CertInfo } | null = null;

const dnString = (n: unknown): string => {
  if (!n || typeof n !== 'object') return '';
  const o = n as Record<string, string | string[]>;
  return ['CN', 'O', 'OU', 'C'].map((k) => (o[k] ? `${k}=${Array.isArray(o[k]) ? o[k].join('+') : o[k]}` : '')).filter(Boolean).join(', ');
};

/** What the reverse proxy serves on :443 (cached for an hour). Nulls when DOMAIN is unset or the proxy does not answer. */
export function checkCert(force = false): Promise<CertInfo> {
  const domain = process.env.DOMAIN;
  if (!domain) return Promise.resolve(NO_CERT);
  if (!force && certCache && Date.now() - certCache.at < 3600_000) return Promise.resolve(certCache.info);
  return new Promise<CertInfo>((resolve) => {
    let done = false;
    const finish = (info: CertInfo) => {
      if (done) return;
      done = true;
      // a failed check is retried after 2 minutes, a successful one after an hour
      certCache = { at: info.daysLeft == null ? Date.now() - 3600_000 + 120_000 : Date.now(), info };
      try {
        sock.destroy();
      } catch {
        /* ignore */
      }
      resolve(info);
    };
    const sock = tls.connect({ host: process.env.CERT_CHECK_HOST || 'nginx-proxy', port: Number(process.env.CERT_CHECK_PORT) || 443, servername: domain, rejectUnauthorized: false, timeout: 4000 }, () => {
      try {
        const c = sock.getPeerCertificate();
        if (!c || !c.valid_to) return finish(NO_CERT);
        const notAfter = Date.parse(c.valid_to);
        const issuer = dnString(c.issuer);
        finish({
          daysLeft: Number.isNaN(notAfter) ? null : Math.floor((notAfter - Date.now()) / 86400_000),
          notAfter: Number.isNaN(notAfter) ? null : notAfter,
          issuer: issuer || null,
          selfSigned: !!issuer && issuer === dnString(c.subject),
        });
      } catch {
        finish(NO_CERT);
      }
    });
    sock.on('error', () => finish(NO_CERT));
    sock.on('timeout', () => finish(NO_CERT));
    setTimeout(() => finish(NO_CERT), 5000).unref();
  });
}

export function registerOps({ app, admin, getBot, guildCount, version, pollMs, publicBase }: Ctx): void {
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

  app.get('/api/system', admin, async (_req, res) => {
    const cert = await checkCert().catch(() => NO_CERT);
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
      publicBase: publicBase(),
      cert,
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

  app.post('/api/system/run', admin, async (_req, res, next) => {
    try {
      await runChecks(res);
    } catch (e) {
      next(e);
    }
  });

  async function runChecks(res: Response): Promise<void> {
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

    const base = publicBase();
    add('public', 'Публичный адрес (значки в Discord)', base ? 'ok' : 'warn', base ? base : 'Откройте панель по домену с https, и значки игр появятся в сообщениях');

    const [gh, ds] = await Promise.all([probe('https://api.github.com'), getSetting('proxy_url') ? Promise.resolve(true) : probe('https://discord.com/api/v10/gateway')]);
    const cert = await checkCert().catch(() => NO_CERT);
    if (cert.daysLeft == null) add('cert', 'Сертификат HTTPS', 'warn', 'не удалось проверить');
    else if (cert.daysLeft < 0) add('cert', 'Сертификат HTTPS', 'fail', 'Срок действия сертификата истёк');
    else if (cert.daysLeft <= 14) add('cert', 'Сертификат HTTPS', 'warn', `Истекает через ${cert.daysLeft} дн.${cert.selfSigned ? ' (самоподписанный)' : ''}`);
    else add('cert', 'Сертификат HTTPS', 'ok', `Действует ещё ${cert.daysLeft} дн.${cert.selfSigned ? ' (самоподписанный)' : ''}`);

    add('github', 'Доступ к GitHub (обновления)', gh ? 'ok' : 'warn', gh ? 'Доступен' : 'Нет ответа: проверка обновлений не сработает');
    add('discord-net', 'Доступ к Discord', ds ? 'ok' : 'fail', getSetting('proxy_url') ? 'Работа идёт через прокси' : ds ? 'Доступен напрямую' : 'Нет ответа. Включите прокси в настройках бота');
    res.json({ at: Date.now(), checks });
  }
}
