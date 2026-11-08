/**
 * The .kick command of the game plugin. An administrator of the game types  .kick (ник) (причина);  the plugin asks the panel
 * (POST /api/game-news/player/kick) and the panel decides: is the command on, may this player be kicked, is a reason needed, how the
 * line for everybody reads («* Игрок Ник был кикнут с сервера. Причина: …» in the colours chosen here). The plugin then shows the line
 * and removes the player. Everything about the command is set in the panel (Игроки → Кик).
 */
import type { Express, RequestHandler } from 'express';
import { z } from 'zod';
import { enqueueAlert } from '../alerts/alerts.js';
import { db } from '../db.js';
import { pluginTarget } from './gameNews.js';
import { postKickToDiscord } from './gameNewsChat.js';
import { isHexColor, plainLine } from './gameNewsJoinLeave.js';
import { readScoped, serverOf, writeScoped } from './gameNewsScope.js';
import { serverLabel } from './gameNewsVars.js';

export interface KickSettings {
  enabled: boolean;
  /** the line for everybody: {name} the kicked player, {reason}, {admin} who kicked */
  template: string;
  textColor: string;
  nameColor: string;
  reasonColor: string;
  adminColor: string;
  /** used when the administrator gave no reason */
  defaultReason: string;
  /** a kick without a reason is refused */
  requireReason: boolean;
  /** administrators of the game cannot be kicked with the command */
  protectAdmins: boolean;
  /** the line is shown to everybody (off: the player is removed quietly) */
  announce: boolean;
  /** seconds between two kicks of one administrator (0 = no pause) */
  cooldownSec: number;
  /** the longest reason, characters */
  maxReason: number;
  /** the channel of Discord (the bot posts there) for the log of kicks: where, when, whom, who and why; '' = none */
  logChannelId: string;
}

export const DEFAULT_KICK: KickSettings = {
  enabled: true,
  template: '* Игрок {name} был кикнут с сервера. Причина: {reason}',
  textColor: '#FF5555',
  nameColor: '#5FD068',
  reasonColor: '#FFCC33',
  adminColor: '#6EC1FF',
  defaultReason: 'не указана',
  requireReason: false,
  protectAdmins: true,
  announce: true,
  cooldownSec: 0,
  maxReason: 100,
  logChannelId: '',
};

export function getKick(serverId?: number): KickSettings {
  try {
    const v = JSON.parse(readScoped('gamenews_kick', serverId) || '{}') as Partial<KickSettings>;
    const d = DEFAULT_KICK;
    const text = (x: unknown, def: string) => (typeof x === 'string' && x.trim() ? x : def);
    const color = (x: unknown, def: string) => (isHexColor(x) ? (x as string).toUpperCase() : def);
    const bool = (x: unknown, def: boolean) => (typeof x === 'boolean' ? x : def);
    return {
      enabled: bool(v.enabled, d.enabled),
      template: text(v.template, d.template),
      textColor: color(v.textColor, d.textColor),
      nameColor: color(v.nameColor, d.nameColor),
      reasonColor: color(v.reasonColor, d.reasonColor),
      adminColor: color(v.adminColor, d.adminColor),
      defaultReason: text(v.defaultReason, d.defaultReason),
      requireReason: bool(v.requireReason, d.requireReason),
      protectAdmins: bool(v.protectAdmins, d.protectAdmins),
      announce: bool(v.announce, d.announce),
      cooldownSec: Number.isFinite(v.cooldownSec) ? Math.min(3600, Math.max(0, Math.round(v.cooldownSec as number))) : d.cooldownSec,
      logChannelId: typeof v.logChannelId === 'string' && /^\d{15,25}$/.test(v.logChannelId) ? v.logChannelId : d.logChannelId,
      maxReason: Number.isFinite(v.maxReason) ? Math.min(200, Math.max(10, Math.round(v.maxReason as number))) : d.maxReason,
    };
  } catch {
    return { ...DEFAULT_KICK };
  }
}

/**
 * The line for everybody, in flat colour tags: the text in its colour, the nickname, the reason and the administrator each in theirs.
 * What a player typed (a reason, a nickname) cannot bring tags of its own.
 */
export function kickLine(s: KickSettings, name: string, reason: string, admin: string): string {
  const vars: Record<string, { text: string; color: string }> = {
    name: { text: plainLine(name), color: s.nameColor },
    reason: { text: plainLine(reason), color: s.reasonColor },
    admin: { text: plainLine(admin), color: s.adminColor },
  };
  const out: string[] = [];
  for (const part of plainLine(s.template).split(/(\{(?:name|reason|admin)\})/)) {
    if (!part) continue;
    const m = /^\{(name|reason|admin)\}$/.exec(part);
    if (m) out.push(`<color=${vars[m[1]].color}>${vars[m[1]].text}</color>`);
    else out.push(`<color=${s.textColor}>${part}</color>`);
  }
  return out.join('');
}

// ---- a pause between two kicks of one administrator
const last = new Map<string, number>();
export function kickWait(adminId: string, cooldownSec: number, now: number): number {
  if (cooldownSec <= 0) return 0;
  const left = Math.ceil(((last.get(adminId) ?? 0) + cooldownSec * 1000 - now) / 1000);
  return left > 0 ? left : 0;
}
export function kickDone(adminId: string, now: number): void {
  last.set(adminId, now);
  if (last.size > 300) for (const [k, t] of last) if (now - t > 3_600_000) last.delete(k);
}

const C_BAD = '#FF5555';
const C_GOOD = '#5FD068';
const say = (color: string, text: string): string => `<color=${color}>${plainLine(text)}</color>`;

export function registerGameNewsKick({ app, admin }: { app: Express; admin: RequestHandler }): void {
  // the plugin: .kick
  app.post('/api/game-news/player/kick', (req, res) => {
    const t = pluginTarget(req);
    if (!t) return res.status(401).json({ error: 'unauthorized' });
    const b = z.object({
      adminId: z.string().max(25), adminName: z.string().max(100), targetId: z.string().max(25), name: z.string().max(100),
      targetIsAdmin: z.boolean(), reason: z.string().max(400),
    }).safeParse(req.body);
    if (!b.success) return res.status(400).json({ ok: false, replies: [say(C_BAD, '* Не удалось разобрать команду. Введите: .kick (ник) (причина)')] });
    const s = getKick(t.server_id);
    const refuse = (text: string) => res.json({ ok: false, replies: [say(C_BAD, text)] });
    if (!s.enabled) return refuse('* Команда .kick отключена в панели.');
    if (s.protectAdmins && b.data.targetIsAdmin) return refuse('* Администратора кикнуть нельзя.');
    const now = Date.now();
    const wait = kickWait(b.data.adminId, s.cooldownSec, now);
    if (wait > 0) return refuse(`* Подождите ещё ${wait} с перед следующим киком.`);
    let reason = plainLine(b.data.reason).slice(0, s.maxReason);
    if (!reason) {
      if (s.requireReason) return refuse('* Укажите причину: .kick (ник) (причина)');
      reason = plainLine(s.defaultReason).slice(0, s.maxReason);
    }
    kickDone(b.data.adminId, now);
    db.prepare('INSERT INTO audit (ts, actor, action, detail) VALUES (?, ?, ?, ?)').run(now, 'game-plugin', 'game_kick', `${plainLine(b.data.adminName)} → ${plainLine(b.data.name)}: ${reason}`.slice(0, 300));
    // the same line goes to the chat in Discord (when the «Кик» kind is on there)
    try { postKickToDiscord(t.server_id, s.template, { name: b.data.name, reason, admin: b.data.adminName }, now); } catch { /* the kick itself must not depend on Discord */ }
    // the log of kicks in the channel of the administrators: where, when, whom, who and why
    if (s.logChannelId) {
      try {
        const unix = Math.floor(now / 1000);
        enqueueAlert('update', serverLabel(t.server_id), {
          content: '', mention: 'none',
          embed: {
            title: '🚪 Игрок кикнут',
            color: 0xed4245,
            fields: [
              { name: 'Сервер', value: serverLabel(t.server_id).slice(0, 200) || '—', inline: true },
              { name: 'Игрок', value: plainLine(b.data.name).slice(0, 100) || '—', inline: true },
              { name: 'Кто кикнул', value: plainLine(b.data.adminName).slice(0, 100) || '—', inline: true },
              { name: 'Причина', value: reason || '—' },
              { name: 'Когда', value: `<t:${unix}:f> (<t:${unix}:R>)` },
            ],
            timestamp: new Date(now).toISOString(),
          },
        }, s.logChannelId);
      } catch { /* the log must not stop the kick */ }
    }
    res.json({
      ok: true,
      line: s.announce ? kickLine(s, b.data.name, reason, b.data.adminName) : '',
      replies: [say(C_GOOD, `* Игрок ${b.data.name} кикнут.${s.announce ? '' : ' (без объявления)'}`)],
    });
  });

  // the panel: the settings of the command
  app.put('/api/game-news/kick-settings', admin, (req, res) => {
    const color = z.string().refine(isHexColor, 'color');
    const b = z.object({
      enabled: z.boolean(), template: z.string().min(1).max(300), textColor: color, nameColor: color, reasonColor: color, adminColor: color,
      defaultReason: z.string().max(100), requireReason: z.boolean(), protectAdmins: z.boolean(), announce: z.boolean(),
      cooldownSec: z.number().int().min(0).max(3600), logChannelId: z.string().regex(/^(\d{15,25})?$/), maxReason: z.number().int().min(10).max(200),
    }).safeParse(req.body);
    if (!b.success) return res.status(400).json({ error: 'Проверьте поля' });
    const d = getKick(serverOf(req));
    const template = plainLine(b.data.template);
    if (!template) return res.status(400).json({ error: 'Введите текст' });
    writeScoped('gamenews_kick', JSON.stringify({
      ...b.data, template, defaultReason: plainLine(b.data.defaultReason) || d.defaultReason,
      textColor: b.data.textColor.toUpperCase(), nameColor: b.data.nameColor.toUpperCase(), reasonColor: b.data.reasonColor.toUpperCase(), adminColor: b.data.adminColor.toUpperCase(),
    }), serverOf(req));
    res.json({ ok: true });
  });
}
