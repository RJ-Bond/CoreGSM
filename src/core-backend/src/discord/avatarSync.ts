/**
 * Keeps the Discord pictures of linked accounts fresh: a person changes the avatar in Discord, the panel learns about it
 * within hours (until now only at a sign-in or /register), and a copy is stored on our side (see images/avatars.ts).
 * Asks Discord for the user with the bot token, a few accounts per minute, going round all of them.
 */
import { db, getSetting, setSetting } from '../db.js';
import { mirrorDiscordAvatar } from '../images/avatars.js';
import { log } from '../logger.js';
import { nextBatch } from './avatarSyncLogic.js';
import { discordFetch } from '../security/proxyFetch.js';

const PER_RUN = 20;
const EVERY_MS = 60_000;

export async function syncAvatars(): Promise<number> {
  const token = getSetting('discord_token');
  if (!token) return 0;
  const rows = db.prepare("SELECT id, discord_id, discord_avatar FROM users WHERE discord_id IS NOT NULL AND discord_id != '' AND status = 'active'").all() as { id: number; discord_id: string; discord_avatar: string | null }[];
  if (!rows.length) return 0;
  const batch = nextBatch(rows, Number(getSetting('avatar_sync_cursor') ?? 0) || 0, PER_RUN);
  let changed = 0;
  for (const u of batch) {
    try {
      const r = await discordFetch(`https://discord.com/api/v10/users/${u.discord_id}`, { headers: { Authorization: `Bot ${token}` } });
      if (r.status === 429) break;
      if (r.ok) {
        const me = (await r.json()) as { avatar?: string | null };
        const hash = me.avatar ?? null;
        if (hash !== u.discord_avatar) {
          db.prepare('UPDATE users SET discord_avatar = ? WHERE id = ?').run(hash, u.id);
          changed++;
        }
        if (hash) await mirrorDiscordAvatar(u.id, u.discord_id, hash);
      }
    } catch (e) {
      log.warn('Discord avatar sync failed', (e as Error).message);
      break;
    }
    setSetting('avatar_sync_cursor', String(u.id));
    await new Promise((res) => setTimeout(res, 400));
  }
  if (batch.length && batch[batch.length - 1]!.id === Math.max(...rows.map((x) => x.id))) setSetting('avatar_sync_cursor', '0');
  return changed;
}

export function startAvatarSync(): void {
  const tick = () => void syncAvatars().catch((e) => log.warn('avatar sync', (e as Error).message));
  setTimeout(tick, 90_000).unref();
  setInterval(tick, EVERY_MS).unref();
}
