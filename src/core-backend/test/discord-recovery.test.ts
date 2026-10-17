/** Password recovery through a private Discord message, and the «read in full» link in news. */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import Database from 'better-sqlite3';
import { ADMIN, setupAdmin, startBackend, type Api } from './harness.ts';

const BASE = 'https://panel.example.com';
const H = { 'x-internal-token': 'i'.repeat(48) };
const DISCORD_ID = '223344556677889900';

describe('password recovery via Discord', () => {
  let api: Api;
  let db: InstanceType<typeof Database>;
  before(async () => {
    api = await startBackend({ PUBLIC_URL: BASE });
    await setupAdmin(api);
    db = new Database(api.dbPath);
    db.prepare('UPDATE users SET discord_id = ? WHERE username = ?').run(DISCORD_ID, ADMIN.username);
  });
  after(async () => { db.close(); await api.stop(); });

  const dms = async () => {
    const r = await api.call('GET', '/internal/deliveries/pending?kinds=dm', { headers: H });
    return r.body as { target: string; payload: { content: string } }[];
  };
  const waitDm = async (re: RegExp) => {
    for (let i = 0; i < 40; i++) {
      const hit = (await dms()).find((d) => re.test(d.payload.content));
      if (hit) return hit;
      await new Promise((r) => setTimeout(r, 100));
    }
    return undefined;
  };

  it('sends the reset link to the linked Discord account and confirms the change there', async () => {
    const forgot = await api.call('POST', '/api/auth/forgot', { body: { login: ADMIN.username } });
    assert.equal(forgot.status, 200);
    const dm = await waitDm(/#\/reset\//);
    assert.ok(dm, 'a private message with the link is queued');
    assert.equal(dm.target, DISCORD_ID);
    const token = /#\/reset\/([A-Za-z0-9_-]+)/.exec(dm.payload.content)?.[1] ?? '';
    assert.ok(dm.payload.content.includes(`${BASE}/#/reset/`));

    const done = await api.call('POST', '/api/auth/reset', { body: { token, password: 'Via-discord-pass1' } });
    assert.equal(done.status, 200);
    assert.ok(await waitDm(/изменён/), 'the change is confirmed in Discord');
    assert.equal((await api.call('POST', '/api/auth/reset', { body: { token, password: 'Another-pass-2' } })).status, 400, 'single use');
  });

  it('answers the same for an account without Discord and e-mail, and sends nothing', async () => {
    const before = (await dms()).length;
    const known = await api.call('POST', '/api/auth/forgot', { body: { login: 'nobody-here' } });
    assert.equal(known.status, 200);
    await new Promise((r) => setTimeout(r, 300));
    assert.equal((await dms()).length, before);
  });
});

describe('news: link to the full version', () => {
  let api: Api;
  let token = '';
  const channelId = '123456789012345678';
  before(async () => { api = await startBackend({ PUBLIC_URL: BASE }); token = await setupAdmin(api); });
  after(async () => { await api.stop(); });

  type Pending = { id: number; payload: { embed?: { title?: string; url?: string }; actions?: { label: string; url: string }[] } };
  const send = async (payload: Record<string, unknown>) => {
    const c = await api.call('POST', '/api/news', { token, body: { channelId, action: 'now', payload } });
    assert.ok([200, 201].includes(c.status), JSON.stringify(c.body));
    const pending = await api.call('GET', '/internal/news/pending', { headers: H });
    return { id: c.body.id as number, sent: (pending.body as Pending[]).find((x) => x.id === c.body.id)! };
  };

  it('adds a «read in full» button first and makes the title a link', async () => {
    const { id, sent } = await send({ mention: 'none', embed: { title: 'Вайп', description: 'Текст' } });
    assert.equal(sent.payload.actions?.[0].url, `${BASE}/go/news/${id}`);
    assert.equal(sent.payload.actions?.[0].label, 'Читать полностью');
    assert.equal(sent.payload.embed?.url, `${BASE}/go/news/${id}`);
  });

  it('keeps the author buttons after it (three at most) and an own title link', async () => {
    const own = 'https://example.com/post';
    const { sent } = await send({
      mention: 'none',
      embed: { title: 'T', url: own },
      actions: [1, 2, 3].map((n) => ({ label: `B${n}`, url: `https://example.com/${n}` })),
    });
    assert.equal(sent.payload.actions?.length, 3);
    assert.deepEqual(sent.payload.actions?.map((a) => a.label), ['Читать полностью', 'B1', 'B2']);
    assert.equal(sent.payload.embed?.url, own);
  });
});
