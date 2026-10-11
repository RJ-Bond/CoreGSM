import { AttachmentBuilder, Client, EmbedBuilder, GatewayIntentBits } from 'discord.js';

const TOKEN = process.env.DISCORD_TOKEN ?? '';
const BACKEND = process.env.BACKEND_URL ?? 'http://backend:3000';
const INTERNAL_TOKEN = process.env.INTERNAL_TOKEN ?? '';
const TICK_MS = 10_000;

interface Binding {
  id: number;
  serverId: number;
  serverName: string;
  channelId: string;
  messageId: string | null;
  intervalSec: number;
}

const log = (...a: unknown[]) => console.log(new Date().toISOString(), ...a);

async function backend(path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(BACKEND + path, {
    ...init,
    headers: { 'x-internal-token': INTERNAL_TOKEN, 'content-type': 'application/json', ...(init.headers ?? {}) },
    signal: AbortSignal.timeout(20_000),
  });
}

async function report(id: number, body: { messageId?: string | null; error?: string | null }) {
  try {
    await backend(`/internal/bindings/${id}`, { method: 'PATCH', body: JSON.stringify(body) });
  } catch (e) {
    log('report failed', e);
  }
}

if (!TOKEN) {
  log('DISCORD_TOKEN is empty: bot is idle. Set it in /app/.env and run "docker compose up -d bot".');
  setInterval(() => undefined, 1 << 30);
} else {
  const client = new Client({ intents: [GatewayIntentBits.Guilds] });
  const lastRun = new Map<number, number>();
  let busy = false;

  async function update(b: Binding): Promise<void> {
    const img = await backend(`/api/card/${b.serverId}.png`, { headers: { 'content-type': 'image/png' } });
    if (!img.ok) throw new Error(`card HTTP ${img.status}`);
    const png = Buffer.from(await img.arrayBuffer());

    const channel = await client.channels.fetch(b.channelId);
    if (!channel || !channel.isTextBased() || !('send' in channel)) throw new Error('Канал не найден или не текстовый');

    const payload = () => ({
      embeds: [new EmbedBuilder().setColor(0x5865f2).setImage('attachment://card.png').setTimestamp()],
      files: [new AttachmentBuilder(png, { name: 'card.png' })],
    });

    if (b.messageId) {
      try {
        const msg = await channel.messages.fetch(b.messageId);
        await msg.edit({ ...payload(), attachments: [] });
        return await report(b.id, { error: null });
      } catch (e) {
        log(`binding ${b.id}: cannot edit message, posting a new one`, (e as Error).message);
      }
    }
    const sent = await channel.send(payload());
    await report(b.id, { messageId: sent.id, error: null });
  }

  async function tick(): Promise<void> {
    if (busy || !client.isReady()) return;
    busy = true;
    try {
      const res = await backend('/internal/bindings');
      if (!res.ok) throw new Error(`bindings HTTP ${res.status}`);
      const list = (await res.json()) as Binding[];
      const ids = new Set(list.map((b) => b.id));
      for (const k of lastRun.keys()) if (!ids.has(k)) lastRun.delete(k);
      for (const b of list) {
        if (Date.now() - (lastRun.get(b.id) ?? 0) < b.intervalSec * 1000) continue;
        lastRun.set(b.id, Date.now());
        try {
          await update(b);
          log(`binding ${b.id} (${b.serverName}) updated`);
        } catch (e) {
          const msg = (e as Error).message.slice(0, 250);
          log(`binding ${b.id} failed:`, msg);
          await report(b.id, { error: msg });
        }
      }
    } catch (e) {
      log('tick failed:', (e as Error).message);
    } finally {
      busy = false;
    }
  }

  client.once('ready', (c) => {
    log(`Logged in as ${c.user.tag}`);
    void tick();
    setInterval(() => void tick(), TICK_MS);
  });
  client.on('error', (e) => log('client error', e));

  client.login(TOKEN).catch((e) => {
    console.error('Discord login failed:', e.message);
    process.exit(1);
  });
}
