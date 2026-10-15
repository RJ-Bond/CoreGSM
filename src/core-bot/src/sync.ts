/**
 * Autoroles and voice counters: the panel says whom to give a role and whom to take it from, and what name each
 * counter channel should have; the bot applies it and reports back.
 *
 * Discord allows renaming a channel only twice per 10 minutes, so a counter is renamed at most every 5 minutes
 * and only when its name actually changed.
 */
import type { Client } from 'discord.js';
import { backend, backendJson } from './backend.js';
import { humanDiscordError } from './errors.js';
import { log } from './log.js';

interface SyncData {
  autoroles: { ruleId: number; guildId: string; roleId: string; add: string[]; remove: string[] }[];
  counters: { id: number; channelId: string; name: string }[];
}

export const RENAME_GAP_MS = 5 * 60_000;
const lastRename = new Map<string, number>();

/** true when a counter should be renamed now */
export function renameDue(current: string, wanted: string, last: number | undefined, now = Date.now()): boolean {
  return current !== wanted && (last === undefined || now - last >= RENAME_GAP_MS);
}

/** Discord «Unknown Member»: the person left the server, nothing to give or take */
const gone = (e: unknown) => (e as { code?: number }).code === 10007;

async function post(path: string, body: unknown) {
  try {
    await backend(path, { method: 'POST', body: JSON.stringify(body) });
  } catch (e) {
    log('sync report failed', (e as Error).message);
  }
}

export async function syncDiscord(c: Client, stopping: () => boolean): Promise<void> {
  const { ok, data } = await backendJson<SyncData>('/internal/discord/sync');
  if (!ok || !data) return;

  for (const r of data.autoroles) {
    if (stopping()) return;
    if (!r.add.length && !r.remove.length) continue;
    const added: string[] = [];
    const removed: string[] = [];
    let error: string | null = null;
    const guild = c.guilds.cache.get(r.guildId);
    if (!guild) {
      error = 'Бот не состоит в этом Discord-сервере';
    } else {
      for (const [ids, give] of [[r.add, true], [r.remove, false]] as const) {
        for (const id of ids) {
          try {
            const member = await guild.members.fetch(id);
            if (give) await member.roles.add(r.roleId, 'CoreGSM: автороль');
            else await member.roles.remove(r.roleId, 'CoreGSM: автороль');
            (give ? added : removed).push(id);
          } catch (e) {
            // a person who left: count as done, so the panel does not try every tick
            if (gone(e)) (give ? added : removed).push(id);
            else error = humanDiscordError(e);
          }
        }
      }
    }
    if (added.length || removed.length) log(`autorole ${r.ruleId}: +${added.length} −${removed.length}`);
    await post(`/internal/discord/autoroles/${r.ruleId}`, { added, removed, error });
  }

  for (const k of data.counters) {
    if (stopping()) return;
    try {
      const ch = await c.channels.fetch(k.channelId);
      if (!ch || !('setName' in ch) || !('name' in ch)) throw Object.assign(new Error('Канал не найден'), { code: 10003 });
      if (!renameDue(String(ch.name), k.name, lastRename.get(k.channelId))) continue;
      await ch.setName(k.name, 'CoreGSM: счётчик онлайна');
      lastRename.set(k.channelId, Date.now());
      log(`counter ${k.id}: «${k.name}»`);
      await post(`/internal/discord/counters/${k.id}`, { error: null });
    } catch (e) {
      // wait the full gap before the next attempt, so a missing permission does not hammer Discord
      lastRename.set(k.channelId, Date.now());
      await post(`/internal/discord/counters/${k.id}`, { error: humanDiscordError(e) });
    }
  }
}
