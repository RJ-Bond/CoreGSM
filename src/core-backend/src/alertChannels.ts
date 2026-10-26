/**
 * Alert channels that do not depend on Discord: outgoing webhooks and e-mail to administrators.
 *
 *   GET    /api/alert-channels            channels, the events and whether SMTP is ready (administrators)
 *   POST   /api/alert-channels            add one
 *   PUT    /api/alert-channels/:id        change one (a secret that is not sent stays as it is)
 *   DELETE /api/alert-channels/:id        remove
 *   POST   /api/alert-channels/:id/test   send a test message at once and show the result
 *
 * A message is put into the common delivery queue (deliveries.ts, kinds 'webhook' and 'email': the table is the queue,
 * the retries and the backoff are the same as for Discord) and a worker in this process sends it. The result of the
 * last attempt is kept on the channel. The signing secret is stored encrypted and is never sent back to the browser.
 */
import http from 'node:http';
import https from 'node:https';
import type { Express, RequestHandler } from 'express';
import { z } from 'zod';
import {
  botIsDown, CHANNEL_EVENTS, EVENT_LABELS, isEvent, mailSubject, MAX_RESPONSE_BYTES, parseRecipients, WEBHOOK_TIMEOUT_MS, webhookBody, webhookHeaders,
  type ChannelEvent, type ChannelKind, type EventData,
} from './alertChannelsLogic.js';
import { bot } from './botState.js';
import { db, getSetting } from './db.js';
import { claimDue, enqueueDelivery, registerKind, reportResult, type DeliveryStatus } from './deliveries.js';
import { log } from './logger.js';
import { layout, mailReady, sendMail } from './mail.js';
import { decryptSecret, encryptSecret } from './secrets.js';
import { brand } from './site.js';
import { checkWebhookUrl, safeLookup } from './urlGuard.js';

export const MAX_CHANNELS = 20;
export const SMTP_MISSING = 'SMTP не настроен: укажите почтовый сервер в настройках, и канал заработает';

interface ChannelRow {
  id: number;
  kind: ChannelKind;
  name: string;
  url: string;
  secret: string;
  recipients: string;
  events: string;
  enabled: number;
  allow_private: number;
  last_status: string | null;
  last_error: string | null;
  last_at: number | null;
  created_at: number;
}

const eventsOf = (r: Pick<ChannelRow, 'events'>): ChannelEvent[] => {
  try {
    const v = JSON.parse(r.events) as unknown;
    return Array.isArray(v) ? v.filter(isEvent) : [];
  } catch {
    return [];
  }
};
const recipientsOf = (r: Pick<ChannelRow, 'recipients'>): string[] => {
  try {
    const v = JSON.parse(r.recipients) as unknown;
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return [];
  }
};
const secretOf = (r: Pick<ChannelRow, 'secret'>): string => {
  if (!r.secret) return '';
  try {
    return decryptSecret(r.secret);
  } catch {
    return '';
  }
};

/** the address without its path and query: they often carry a token (Slack, Discord and similar) */
export function maskUrl(raw: string): string {
  try {
    const u = new URL(raw);
    return `${u.protocol}//${u.host}/…`;
  } catch {
    return '';
  }
}

function present(r: ChannelRow) {
  return {
    id: r.id,
    kind: r.kind,
    name: r.name,
    urlPreview: r.kind === 'webhook' ? maskUrl(r.url) : '',
    hasSecret: !!r.secret,
    recipients: recipientsOf(r),
    events: eventsOf(r),
    enabled: !!r.enabled,
    allowPrivate: !!r.allow_private,
    lastStatus: r.last_status,
    lastError: r.last_error,
    lastAt: r.last_at,
    createdAt: r.created_at,
  };
}

const channels = () => db.prepare('SELECT * FROM alert_channels ORDER BY id').all() as ChannelRow[];

/** true when at least one enabled channel listens to the event (the alert machinery must run for it) */
export function channelsWant(event: ChannelEvent): boolean {
  try {
    return channels().some((c) => c.enabled && eventsOf(c).includes(event));
  } catch {
    return false;
  }
}

/** Puts a message into the queue of every enabled channel that listens to the event. Never throws. */
export function dispatchEvent(e: EventData & { event: ChannelEvent }): number {
  let n = 0;
  try {
    for (const c of channels()) {
      if (!c.enabled || !eventsOf(c).includes(e.event)) continue;
      enqueueDelivery({ kind: c.kind, refId: c.id, target: String(c.id), payload: e });
      n++;
    }
    if (n) setImmediate(() => void processQueue());
  } catch (err) {
    log.error('alert channels dispatch failed', (err as Error).message);
  }
  return n;
}

// ---------- sending ----------
export interface SendResult {
  ok: boolean;
  error?: string;
  /** do not retry (the address is forbidden, the channel is gone) */
  final?: boolean;
  retryAfterMs?: number;
  /** HTTP status of the receiver */
  status?: number;
}

/** One POST with a timeout, a limit on the answer and no redirects. */
export function postJson(url: URL, headers: Record<string, string>, body: string, allowPrivate: boolean): Promise<{ status: number; text: string; retryAfter: number | null }> {
  return new Promise((resolve, reject) => {
    const lib = url.protocol === 'https:' ? https : http;
    const req = lib.request(
      {
        protocol: url.protocol,
        hostname: url.hostname.replace(/^\[|\]$/g, ''),
        port: url.port || undefined,
        path: `${url.pathname}${url.search}`,
        method: 'POST',
        headers: { ...headers, 'Content-Length': String(Buffer.byteLength(body)) },
        lookup: safeLookup(allowPrivate) as never,
        agent: false,
      },
      (res) => {
        const chunks: Buffer[] = [];
        let size = 0;
        res.on('data', (c: Buffer) => {
          size += c.length;
          if (size <= MAX_RESPONSE_BYTES) chunks.push(c);
          else res.destroy(); // enough: the rest is not read
        });
        const done = () => {
          clearTimeout(timer);
          const ra = Number(res.headers['retry-after']);
          resolve({ status: res.statusCode ?? 0, text: Buffer.concat(chunks).toString('utf8'), retryAfter: Number.isFinite(ra) && ra > 0 ? ra * 1000 : null });
        };
        res.on('end', done);
        res.on('close', done);
        res.on('error', () => done());
      },
    );
    const timer = setTimeout(() => req.destroy(Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' })), WEBHOOK_TIMEOUT_MS);
    req.on('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
    req.end(body);
  });
}

const netError = (e: unknown): string => {
  const err = e as Error & { code?: string };
  if (err.code === 'EBLOCKED') return 'Адрес запрещён: он указывает на локальную сеть. Разрешить такие адреса можно в настройках канала';
  if (err.code === 'ENOTFOUND' || err.code === 'EAI_AGAIN') return 'Имя сервера не найдено';
  if (err.code === 'ECONNREFUSED') return 'Соединение отклонено';
  if (err.code === 'ETIMEDOUT' || err.code === 'ECONNRESET') return 'Сервер не ответил за отведённое время';
  if (err.code && /CERT|SELF_SIGNED|TLS|SSL|UNABLE_TO/i.test(err.code)) return 'Ошибка сертификата получателя';
  return `Сбой отправки: ${String(err.message ?? err).slice(0, 120)}`;
};

export async function sendWebhook(c: Pick<ChannelRow, 'url' | 'secret' | 'allow_private'>, e: EventData, deliveryId: number | string): Promise<SendResult> {
  const chk = checkWebhookUrl(c.url, !!c.allow_private);
  if (!chk.ok) return { ok: false, error: chk.error, final: true };
  const ts = Math.floor(Date.now() / 1000);
  const body = webhookBody(e, ts, deliveryId);
  try {
    const r = await postJson(chk.url, webhookHeaders(secretOf(c), ts, body, e.event, deliveryId), body, !!c.allow_private);
    if (r.status >= 200 && r.status < 300) return { ok: true, status: r.status };
    if (r.status >= 300 && r.status < 400) return { ok: false, status: r.status, error: `Получатель ответил перенаправлением (${r.status}): укажите конечный адрес`, final: true };
    return { ok: false, status: r.status, error: `Получатель ответил ошибкой ${r.status}`, retryAfterMs: r.status === 429 ? (r.retryAfter ?? undefined) : undefined };
  } catch (err) {
    const code = (err as { code?: string }).code;
    return { ok: false, error: netError(err), final: code === 'EBLOCKED' };
  }
}

export async function sendEmail(c: Pick<ChannelRow, 'recipients'>, e: EventData): Promise<SendResult> {
  if (!mailReady()) return { ok: false, error: SMTP_MISSING };
  const to = recipientsOf(c);
  if (!to.length) return { ok: false, error: 'Не указан ни один получатель', final: true };
  const b = brand().name;
  const lines = [e.title, ...(e.text ? [e.text] : [])];
  const l = layout(b, lines);
  try {
    await sendMail({ to: to.join(', '), subject: mailSubject(b, e), text: l.text, html: l.html });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: (err as Error).message.slice(0, 200) };
  }
}

function send(c: ChannelRow, e: EventData, deliveryId: number | string): Promise<SendResult> {
  return c.kind === 'webhook' ? sendWebhook(c, e, deliveryId) : sendEmail(c, e);
}

function remember(id: number, r: SendResult, now = Date.now()): void {
  db.prepare('UPDATE alert_channels SET last_status = ?, last_error = ?, last_at = ? WHERE id = ?').run(r.ok ? 'ok' : 'error', r.ok ? null : (r.error ?? 'Ошибка').slice(0, 300), now, id);
}

// the queue reports progress back to the channel: sent -> ok, a failure (retry or dead) -> error with the reason
function onState(refId: number, status: DeliveryStatus, error: string | null, now: number): void {
  if (status === 'sending' || status === 'pending') return;
  db.prepare('UPDATE alert_channels SET last_status = ?, last_error = ?, last_at = ? WHERE id = ?').run(status === 'sent' ? 'ok' : 'error', status === 'sent' ? null : error, now, refId);
}
registerKind('webhook', { onState });
registerKind('email', { onState });

let working = false;
/** sends the due messages of the channels; exported for tests */
export async function processQueue(): Promise<number> {
  if (working) return 0;
  working = true;
  let n = 0;
  try {
    for (const d of claimDue(['webhook', 'email'], Date.now(), 20)) {
      n++;
      const c = db.prepare('SELECT * FROM alert_channels WHERE id = ?').get(d.refId) as ChannelRow | undefined;
      if (!c || !c.enabled) {
        reportResult(d.id, { ok: false, error: 'Канал удалён или выключен', final: true });
        continue;
      }
      let r: SendResult;
      try {
        r = await send(c, d.payload as EventData, d.id);
      } catch (e) {
        r = { ok: false, error: (e as Error).message.slice(0, 200) };
      }
      reportResult(d.id, r.ok ? { ok: true } : { ok: false, error: r.error ?? 'Ошибка отправки', final: r.final, retryAfterMs: r.retryAfterMs });
    }
  } catch (e) {
    log.error('alert channels queue failed', (e as Error).message);
  } finally {
    working = false;
  }
  return n;
}

// ---------- the bot itself ----------
/** How long the bot may be out of reach before the administrators are told (it reconnects on its own after a blip). */
export const BOT_DOWN_AFTER_MS = 2 * 60_000;
const startedAt = Date.now();
let botBadSince: number | null = null;
let botNotified = false;

/** called by a timer; exported for tests (`now` and the status can be passed) */
export function watchBot(now = Date.now(), status = bot.status, token = !!getSetting('discord_token')): void {
  const down = botIsDown(status, token, now);
  if (!down) {
    botBadSince = null;
    if (botNotified) {
      botNotified = false;
      dispatchEvent({ event: 'bot_up', title: 'Discord-бот снова на связи', text: status.tag ? `Бот ${status.tag} подключён.` : '', data: { state: status.state } });
    }
    return;
  }
  botBadSince ??= Math.max(now, startedAt);
  if (!botNotified && now - botBadSince >= BOT_DOWN_AFTER_MS) {
    botNotified = true;
    const why = status.error ? `Причина: ${status.error.slice(0, 200)}` : status.state === 'online' ? 'Бот давно не присылал отчёт о состоянии.' : `Состояние бота: ${status.state}.`;
    dispatchEvent({ event: 'bot_down', title: 'Discord-бот не на связи', text: `${why} Оповещения в Discord и новости не доставляются, пока бот не вернётся.`, data: { state: status.state, error: status.error } });
  }
}

// ---------- routes ----------
const eventList = z.array(z.enum(CHANNEL_EVENTS)).max(20);

const bodySchema = z.object({
  kind: z.enum(['webhook', 'email']),
  name: z.string().trim().min(1, 'Дайте каналу название').max(60, 'Название не длиннее 60 символов'),
  url: z.string().max(500).optional(),
  /** null clears the secret; absent keeps it */
  secret: z.string().max(200).nullable().optional(),
  recipients: z.union([z.string().max(2000), z.array(z.string().max(200)).max(20)]).optional(),
  events: eventList,
  enabled: z.boolean().optional(),
  allowPrivate: z.boolean().optional(),
});

export function registerAlertChannels(deps: { app: Express; admin: RequestHandler }): void {
  const { app, admin } = deps;
  const timer = setInterval(() => {
    try {
      watchBot();
    } catch (e) {
      log.error('bot watch failed', (e as Error).message);
    }
    void processQueue();
  }, 5_000);
  timer.unref();

  const view = () => ({
    smtpReady: mailReady(),
    events: CHANNEL_EVENTS.map((id) => ({ id, label: EVENT_LABELS[id] })),
    items: channels().map(present),
  });

  app.get('/api/alert-channels', admin, (_req, res) => res.json(view()));

  /** validates the body against the stored row (for a change) and returns the values to write */
  function prepare(b: z.infer<typeof bodySchema>, old: ChannelRow | null): { error: string; status?: number } | { row: Omit<ChannelRow, 'id' | 'last_status' | 'last_error' | 'last_at' | 'created_at'> } {
    const enabled = b.enabled ?? (old ? !!old.enabled : true);
    const allowPrivate = b.allowPrivate ?? (old ? !!old.allow_private : false);
    let url = '';
    let recipients: string[] = [];
    if (b.kind === 'webhook') {
      url = (b.url ?? old?.url ?? '').trim();
      const chk = checkWebhookUrl(url, allowPrivate);
      if (!chk.ok) return { error: chk.error };
    } else {
      const p = parseRecipients(b.recipients ?? (old ? recipientsOf(old) : []));
      if (p.bad.length) return { error: `Неверный адрес почты: ${p.bad.slice(0, 3).join(', ')}` };
      if (!p.ok.length) return { error: 'Укажите хотя бы одного получателя' };
      if (p.ok.length > 20) return { error: 'Получателей не больше 20' };
      recipients = p.ok;
      if (enabled && !mailReady()) return { error: SMTP_MISSING, status: 409 };
    }
    const secret = b.kind !== 'webhook' || b.secret === null ? '' : b.secret === undefined ? (old?.secret ?? '') : b.secret.trim() ? encryptSecret(b.secret.trim()) : (old?.secret ?? '');
    return {
      row: { kind: b.kind, name: b.name, url, secret, recipients: JSON.stringify(recipients), events: JSON.stringify([...new Set(b.events)]), enabled: enabled ? 1 : 0, allow_private: allowPrivate ? 1 : 0 },
    };
  }

  app.post('/api/alert-channels', admin, (req, res) => {
    const b = bodySchema.safeParse(req.body);
    if (!b.success) return res.status(400).json({ error: b.error.issues[0]?.message ?? 'Проверьте поля' });
    if ((db.prepare('SELECT COUNT(*) AS n FROM alert_channels').get() as { n: number }).n >= MAX_CHANNELS) return res.status(400).json({ error: `Каналов не больше ${MAX_CHANNELS}` });
    const p = prepare(b.data, null);
    if ('error' in p) return res.status(p.status ?? 400).json({ error: p.error });
    const r = p.row;
    const id = Number(
      db
        .prepare('INSERT INTO alert_channels (kind, name, url, secret, recipients, events, enabled, allow_private, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .run(r.kind, r.name, r.url, r.secret, r.recipients, r.events, r.enabled, r.allow_private, Date.now()).lastInsertRowid,
    );
    res.status(201).json({ ...view(), id });
  });

  app.put('/api/alert-channels/:id', admin, (req, res) => {
    const id = Number(req.params.id);
    const old = db.prepare('SELECT * FROM alert_channels WHERE id = ?').get(id) as ChannelRow | undefined;
    if (!old) return res.status(404).json({ error: 'Канал не найден' });
    const b = bodySchema.safeParse(req.body);
    if (!b.success) return res.status(400).json({ error: b.error.issues[0]?.message ?? 'Проверьте поля' });
    if (b.data.kind !== old.kind) return res.status(400).json({ error: 'Тип канала изменить нельзя: создайте новый' });
    const p = prepare(b.data, old);
    if ('error' in p) return res.status(p.status ?? 400).json({ error: p.error });
    const r = p.row;
    db.prepare('UPDATE alert_channels SET name = ?, url = ?, secret = ?, recipients = ?, events = ?, enabled = ?, allow_private = ? WHERE id = ?').run(r.name, r.url, r.secret, r.recipients, r.events, r.enabled, r.allow_private, id);
    res.json(view());
  });

  app.delete('/api/alert-channels/:id', admin, (req, res) => {
    const id = Number(req.params.id);
    const r = db.prepare('DELETE FROM alert_channels WHERE id = ?').run(id);
    if (!r.changes) return res.status(404).json({ error: 'Канал не найден' });
    db.prepare("DELETE FROM deliveries WHERE kind IN ('webhook','email') AND ref_id = ? AND status IN ('pending','error','sending')").run(id);
    res.json(view());
  });

  app.post('/api/alert-channels/:id/test', admin, async (req, res) => {
    const id = Number(req.params.id);
    const c = db.prepare('SELECT * FROM alert_channels WHERE id = ?').get(id) as ChannelRow | undefined;
    if (!c) return res.status(404).json({ error: 'Канал не найден' });
    const e: EventData = { event: 'test', title: 'Проверка оповещений', text: 'Если вы видите это сообщение, канал оповещений настроен верно.', data: { channel: c.name } };
    const r = await send(c, e, `test-${Date.now()}`);
    remember(id, r);
    res.json({ ok: r.ok, error: r.error ?? null, httpStatus: r.status ?? null, ...view() });
  });
}
