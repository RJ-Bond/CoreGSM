/** The line under the bot's name in the member list: «Смотрит 26 игроков · 3/3 онлайн», rotated every 30 seconds. */
import { ActivityType, type Client } from 'discord.js';
import { backendJson } from './backend.js';
import { log } from './log.js';

const EVERY_MS = 30_000;
let lastAt = 0;
let index = 0;

interface PresenceData {
  status: 'online' | 'idle' | 'dnd';
  lines: string[];
}

export async function updatePresence(client: Client, now = Date.now()): Promise<void> {
  // Discord allows 5 presence updates per 20 s; one per 30 s is far below that
  if (now - lastAt < EVERY_MS) return;
  lastAt = now;
  try {
    const r = await backendJson<PresenceData>('/internal/presence');
    const data = r.ok ? r.data : null;
    if (!data || !Array.isArray(data.lines) || data.lines.length === 0) return;
    const line = String(data.lines[index++ % data.lines.length]).slice(0, 128);
    client.user?.setPresence({ status: data.status, activities: [{ type: ActivityType.Watching, name: line }] });
  } catch (e) {
    log('presence update failed:', (e as Error).message);
  }
}
