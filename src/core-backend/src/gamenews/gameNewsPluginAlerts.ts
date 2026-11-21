/**
 * What the administrators are told about the plugins themselves (the service channel, like the other alerts of the panel):
 *  - a plugin that has not answered for N minutes (it went silent after it had been talking; once per silence);
 *  - a plugin older than the newest one the panel knows (once per server and version).
 * Settings: `gn_alert_silent_min` (0 = off, 10 by default) and `gn_alert_outdated` ('0' = off, on by default).
 * Also the daily summary of the joins and departures (gameNewsDaily.ts): `daily`, `dailyHour`.
 *   GET / PUT /api/game-news/plugin-alerts   (administrators)
 */
import type { Express, RequestHandler } from 'express';
import { z } from 'zod';
import { db, getSetting, setSetting } from '../db.js';
import { systemTarget } from '../alerts/alertRoute.js';
import { alertSettings, enqueueAlert } from '../alerts/alerts.js';
import { PLUGIN_VERSION, type TargetRow } from './gameNews.js';
import { serverLabel } from './gameNewsVars.js';
import { dailyHour, dailyOn } from './gameNewsDaily.js';

export const SILENT_CHOICES = [0, 5, 10, 30, 60] as const;
export const DEFAULT_SILENT_MIN = 10;
/** a plugin silent for longer than this is gone for good, not an incident to announce */
const GONE_MS = 7 * 86_400_000;

export const silentMinutes = (): number => {
  const raw = getSetting('gn_alert_silent_min');
  if (raw == null) return DEFAULT_SILENT_MIN;
  const n = Number(raw);
  return (SILENT_CHOICES as readonly number[]).includes(n) ? n : DEFAULT_SILENT_MIN;
};
export const outdatedAlertOn = (): boolean => getSetting('gn_alert_outdated') !== '0';

/** true when version `a` is older than `b` (dotted numbers); an unknown version is not «older» (nothing to announce) */
export function isOlder(a: string, b: string): boolean {
  const pa = a.split('.').map((x) => parseInt(x, 10));
  const pb = b.split('.').map((x) => parseInt(x, 10));
  if (!a || pa.some(Number.isNaN) || pb.some(Number.isNaN)) return false;
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] ?? 0;
    const y = pb[i] ?? 0;
    if (x !== y) return x < y;
  }
  return false;
}

/** what was already told: «silent:<server>:<last seen>» (one silence) and «old:<server>:<version>» */
const told = new Set<string>();
export const resetTold = (): void => told.clear();

export interface PluginAlert { kind: 'silent' | 'outdated'; serverId: number; text: string }

/** what is worth telling now (and was not told yet); pure over the rows, so it can be tested */
export function pluginAlertsDue(rows: Pick<TargetRow, 'server_id' | 'last_seen' | 'plugin_version' | 'token_hash'>[], now: number, opts: { silentMin: number; outdated: boolean; latest: string }): PluginAlert[] {
  const out: PluginAlert[] = [];
  for (const r of rows) {
    if (!r.token_hash || r.last_seen <= 0) continue;
    const silentFor = now - r.last_seen;
    if (opts.silentMin > 0 && silentFor >= opts.silentMin * 60_000 && silentFor < GONE_MS) {
      const key = `silent:${r.server_id}:${r.last_seen}`;
      if (!told.has(key)) out.push({ kind: 'silent', serverId: r.server_id, text: key });
    }
    if (opts.outdated && silentFor < 3 * 60_000 && isOlder(r.plugin_version, opts.latest)) {
      const key = `old:${r.server_id}:${r.plugin_version}`;
      if (!told.has(key)) out.push({ kind: 'outdated', serverId: r.server_id, text: key });
    }
  }
  return out;
}

/** called by the timer: tells the administrators about the silent and the old plugins */
export function checkPlugins(now = Date.now()): number {
  const rows = db.prepare("SELECT server_id, last_seen, plugin_version, token_hash FROM game_news_targets WHERE token_hash <> ''").all() as TargetRow[];
  const due = pluginAlertsDue(rows, now, { silentMin: silentMinutes(), outdated: outdatedAlertOn(), latest: PLUGIN_VERSION });
  let n = 0;
  for (const a of due) {
    told.add(a.text);
    n++;
    try {
      if (!systemTarget(alertSettings())) continue;
      const name = serverLabel(a.serverId);
      const row = rows.find((r) => r.server_id === a.serverId);
      enqueueAlert('update', name, a.kind === 'silent'
        ? {
          content: '', mention: 'none',
          embed: { title: '🔌 Плагин не отвечает', description: `Сервер **${name}**: плагин CoreGSM не выходил на связь ${silentMinutes()} минут и больше. Проверьте, что игровой сервер запущен и плагин видит панель: «Игровой плагин».`, color: 0xed4245, timestamp: new Date(now).toISOString() },
        }
        : {
          content: '', mention: 'none',
          embed: { title: '🧩 Есть новая версия плагина', description: `Сервер **${name}**: стоит плагин ${row?.plugin_version ?? '?'}, последняя версия — ${PLUGIN_VERSION}. Обновить: «Игровой плагин» → сервер → «Обновить плагин» (вступит в силу после перезапуска сервера).`, color: 0xf5b01e, timestamp: new Date(now).toISOString() },
        });
    } catch { /* an alert must not stop the timer */ }
  }
  return n;
}

const state = () => ({ silentMin: silentMinutes(), outdated: outdatedAlertOn(), choices: SILENT_CHOICES, daily: dailyOn(), dailyHour: dailyHour() });

export function registerGameNewsPluginAlerts({ app, admin }: { app: Express; admin: RequestHandler }): void {
  app.get('/api/game-news/plugin-alerts', admin, (_req, res) => {
    res.json(state());
  });
  app.put('/api/game-news/plugin-alerts', admin, (req, res) => {
    const b = z.object({ silentMin: z.number().int().optional(), outdated: z.boolean().optional(), daily: z.boolean().optional(), dailyHour: z.number().int().min(0).max(23).optional() }).safeParse(req.body);
    if (!b.success) return res.status(400).json({ error: 'Проверьте поля' });
    if (b.data.silentMin !== undefined) {
      if (!(SILENT_CHOICES as readonly number[]).includes(b.data.silentMin)) return res.status(400).json({ error: 'Проверьте поля' });
      setSetting('gn_alert_silent_min', String(b.data.silentMin));
    }
    if (b.data.outdated !== undefined) setSetting('gn_alert_outdated', b.data.outdated ? '1' : '0');
    if (b.data.daily !== undefined) setSetting('gn_daily_summary', b.data.daily ? '1' : '0');
    if (b.data.dailyHour !== undefined) setSetting('gn_daily_hour', String(b.data.dailyHour));
    res.json(state());
  });
}
