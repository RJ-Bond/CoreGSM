/**
 * Smart alerts: messages to the alerts channel about a server that answers but is not well. Each kind is switched on
 * by itself in the panel and fires only when its condition has held for a while, then rests for a cooldown:
 *   low   far fewer players than usual for this weekday and hour (under 30% of the average of the last four weeks,
 *         when that average is at least 5) for 20 minutes
 *   ping  the ping is over twice the day's average and over 150 ms for 15 minutes
 *   full  90% of the slots or more are taken for 15 minutes
 */
import { alertSettings, enqueueAlert } from './alerts.js';
import { db, EFFECTIVE_NAME, getSetting } from './db.js';
import { gameLabel } from './games.js';

export type SmartKind = 'low' | 'ping' | 'full';
export const SMART_KINDS: SmartKind[] = ['low', 'ping', 'full'];

const RULES: Record<SmartKind, { holdMin: number; cooldownH: number; color: number }> = {
  low: { holdMin: 20, cooldownH: 6, color: 0xf5b01e },
  ping: { holdMin: 15, cooldownH: 3, color: 0xf5b01e },
  full: { holdMin: 15, cooldownH: 12, color: 0x5865f2 },
};

export const smartEnabled = (k: SmartKind) => getSetting(`alerts_smart_${k}`) === '1';

// the usual players for an hour of the week and the day's ping are read once an hour per server
const usualCache = new Map<string, { at: number; v: number | null }>();
function usualPlayers(serverId: number, now: number): number | null {
  const how = new Date(now).getUTCDay() * 24 + new Date(now).getUTCHours();
  const key = `${serverId}|${how}`;
  const c = usualCache.get(key);
  if (c && now - c.at < 3600_000) return c.v;
  const r = db
    .prepare(
      `SELECT AVG(players) AS a, COUNT(*) AS n FROM history
       WHERE server_id = ? AND online = 1 AND ts > ? AND ts < ? AND CAST(strftime('%w', ts / 1000, 'unixepoch') AS INTEGER) * 24 + CAST(strftime('%H', ts / 1000, 'unixepoch') AS INTEGER) = ?`,
    )
    .get(serverId, now - 28 * 86400_000, now - 86400_000, how) as { a: number | null; n: number };
  // at least two weeks' worth of that hour, otherwise there is nothing to compare with
  const v = r.n >= 40 && r.a != null ? r.a : null;
  usualCache.set(key, { at: now, v });
  return v;
}
const pingCache = new Map<number, { at: number; v: number | null }>();
function usualPing(serverId: number, now: number): number | null {
  const c = pingCache.get(serverId);
  if (c && now - c.at < 3600_000) return c.v;
  const r = db.prepare('SELECT AVG(ping) AS a, COUNT(*) AS n FROM history WHERE server_id = ? AND online = 1 AND ping IS NOT NULL AND ts > ?').get(serverId, now - 86400_000) as { a: number | null; n: number };
  const v = r.n >= 20 && r.a != null ? r.a : null;
  pingCache.set(serverId, { at: now, v });
  return v;
}

/** whether each condition holds now, with the numbers for the message */
export function smartConditions(
  serverId: number,
  s: { online: boolean; players: number; maxPlayers: number; ping: number | null },
  now = Date.now(),
): Record<SmartKind, { on: boolean; text: string }> {
  const usual = s.online ? usualPlayers(serverId, now) : null;
  const ping = s.online && s.ping != null ? usualPing(serverId, now) : null;
  return {
    low: {
      on: s.online && usual != null && usual >= 5 && s.players < usual * 0.3,
      text: `Сейчас ${s.players} ${s.players === 1 ? 'игрок' : 'игроков'}, а обычно в это время около ${Math.round(usual ?? 0)}.`,
    },
    ping: {
      on: s.online && s.ping != null && ping != null && s.ping > 150 && s.ping > ping * 2,
      text: `Пинг ${s.ping} мс, а за сутки в среднем ${Math.round(ping ?? 0)} мс.`,
    },
    full: {
      on: s.online && s.maxPlayers > 0 && s.players >= s.maxPlayers * 0.9,
      text: `Занято ${s.players} из ${s.maxPlayers} мест: новым игрокам скоро будет некуда зайти. Возможно, пора добавить слоты.`,
    },
  };
}

const TITLE: Record<SmartKind, (n: string) => string> = {
  low: (n) => `📉 На ${n} необычно мало игроков`,
  ping: (n) => `🐢 ${n}: вырос пинг`,
  full: (n) => `🔥 ${n} почти заполнен`,
};

/** Called after every confirmed poll of a server (not during maintenance). */
export function trackSmart(serverId: number, s: { online: boolean; players: number; maxPlayers: number; ping: number | null }, now = Date.now()): void {
  const a = alertSettings();
  if (!a.enabled || !a.channelId || !SMART_KINDS.some(smartEnabled)) return;
  const cond = smartConditions(serverId, s, now);
  const get = db.prepare('SELECT since, last_alert FROM smart_state WHERE server_id = ? AND kind = ?');
  const put = db.prepare(
    'INSERT INTO smart_state (server_id, kind, since, last_alert) VALUES (?, ?, ?, ?) ON CONFLICT (server_id, kind) DO UPDATE SET since = excluded.since, last_alert = excluded.last_alert',
  );
  for (const k of SMART_KINDS) {
    if (!smartEnabled(k)) continue;
    const st = (get.get(serverId, k) as { since: number | null; last_alert: number } | undefined) ?? { since: null, last_alert: 0 };
    if (!cond[k].on) {
      if (st.since != null) put.run(serverId, k, null, st.last_alert);
      continue;
    }
    const since = st.since ?? now;
    const rule = RULES[k];
    if (now - since >= rule.holdMin * 60_000 && now - st.last_alert >= rule.cooldownH * 3600_000) {
      const i = db
        .prepare(`SELECT ${EFFECTIVE_NAME} AS n, s.game, s.display_address, s.host, s.port FROM servers s LEFT JOIN status st ON st.server_id = s.id WHERE s.id = ?`)
        .get(serverId) as { n: string; game: string; display_address: string; host: string; port: number } | undefined;
      if (i) {
        enqueueAlert(k, i.n, {
          content: '',
          mention: 'none',
          embed: {
            title: TITLE[k](i.n),
            description: `${cond[k].text}\n📍 \`${i.display_address || `${i.host}:${i.port}`}\``,
            color: rule.color,
            author: { name: `🎮 ${gameLabel(i.game)}` },
            footer: { text: 'CoreGSM · умное оповещение' },
            timestamp: new Date(now).toISOString(),
          },
        });
      }
      put.run(serverId, k, since, now);
    } else if (st.since == null) {
      put.run(serverId, k, since, st.last_alert);
    }
  }
}
