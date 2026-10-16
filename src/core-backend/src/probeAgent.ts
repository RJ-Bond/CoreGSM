/**
 * The probe: a small program that runs on another machine (another city, another provider), queries the panel's
 * game servers from there and reports what it sees. The panel serves it as one file (GET /api/probe/agent.mjs);
 * it needs Node 18+ and the gamedig package, nothing else.
 *
 *   PANEL_URL=https://panel.example PROBE_TOKEN=... node probe.mjs
 */
export const GAMEDIG_VERSION = '5';

export const AGENT_SOURCE = `// CoreGSM probe: queries the game servers of the panel from this machine and reports the results.
// Run: PANEL_URL=https://panel.example PROBE_TOKEN=... node probe.mjs   (needs: npm i gamedig@${GAMEDIG_VERSION})
import { GameDig } from 'gamedig';

const PANEL = (process.env.PANEL_URL || '').replace(/\\/+$/, '');
const TOKEN = process.env.PROBE_TOKEN || '';
const EVERY = Math.max(30, Number(process.env.PROBE_INTERVAL_SEC) || 60) * 1000;
const VERSION = 'probe-1';
if (!PANEL || !TOKEN) {
  console.error('Set PANEL_URL and PROBE_TOKEN');
  process.exit(1);
}
const headers = { 'x-probe-token': TOKEN, 'content-type': 'application/json', 'x-probe-version': VERSION };

async function query(t) {
  const started = Date.now();
  try {
    const r = await GameDig.query({ type: t.game, host: t.host, port: t.queryPort || t.port, maxRetries: 1, socketTimeout: 3000, attemptTimeout: 9000 });
    const players = Number(r.numplayers ?? (Array.isArray(r.players) ? r.players.length : 0)) || 0;
    return { serverId: t.id, online: true, ping: typeof r.ping === 'number' ? Math.round(r.ping) : Date.now() - started, players, error: null };
  } catch (e) {
    return { serverId: t.id, online: false, ping: null, players: 0, error: String(e && e.message || e).slice(0, 160) };
  }
}

async function round() {
  const res = await fetch(PANEL + '/api/probe/targets', { headers });
  if (res.status === 401) throw new Error('the panel does not know this token (removed or replaced?)');
  if (!res.ok) throw new Error('targets: HTTP ' + res.status);
  const targets = await res.json();
  const results = [];
  for (let i = 0; i < targets.length; i += 4) results.push(...(await Promise.all(targets.slice(i, i + 4).map(query))));
  const sent = await fetch(PANEL + '/api/probe/results', { method: 'POST', headers, body: JSON.stringify(results) });
  if (!sent.ok) throw new Error('results: HTTP ' + sent.status);
  console.log(new Date().toISOString(), 'checked', results.length, 'servers,', results.filter((r) => r.online).length, 'online');
}

for (;;) {
  try {
    await round();
  } catch (e) {
    console.error(new Date().toISOString(), String(e && e.message || e));
  }
  await new Promise((r) => setTimeout(r, EVERY));
}
`;
