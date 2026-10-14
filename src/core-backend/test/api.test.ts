import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { setupAdmin, startBackend, type Api } from './harness.ts';

describe('servers', () => {
  let api: Api;
  let token = '';
  before(async () => { api = await startBackend(); token = await setupAdmin(api); });
  after(async () => { await api.stop(); });

  it('creates, lists, updates and deletes a server', async () => {
    const c = await api.call('POST', '/api/servers', { token, body: { name: 'Test', game: 'minecraft', host: '127.0.0.1', port: 25565 } });
    assert.ok([200, 201].includes(c.status), JSON.stringify(c.body));
    const id = c.body.id as number;
    const list = await api.call('GET', '/api/servers', { token });
    assert.ok((list.body as { id: number }[]).some((s) => s.id === id));
    const u = await api.call('PUT', `/api/servers/${id}`, { token, body: { name: 'Renamed', game: 'minecraft', host: '127.0.0.1', port: 25565 } });
    assert.equal(u.status, 200, JSON.stringify(u.body));
    const d = await api.call('GET', `/api/servers/${id}/details?hours=24`, { token });
    assert.equal(d.status, 200);
    assert.equal(d.body.server.id, id);
    assert.equal((await api.call('DELETE', `/api/servers/${id}`, { token })).status, 200);
    assert.equal((await api.call('GET', `/api/servers/${id}/details`, { token })).status, 404);
  });

  it('rejects invalid input', async () => {
    const r = await api.call('POST', '/api/servers', { token, body: { name: '', game: 'minecraft', host: '', port: 0 } });
    assert.equal(r.status, 400);
  });

  it('accepts a 30-day details window', async () => {
    const c = await api.call('POST', '/api/servers', { token, body: { name: 'H', game: 'minecraft', host: '127.0.0.1', port: 25566 } });
    const d = await api.call('GET', `/api/servers/${c.body.id}/details?hours=720`, { token });
    assert.equal(d.status, 200);
    assert.equal(d.body.hours, 720);
  });
});

describe('news', () => {
  let api: Api;
  let token = '';
  const channelId = '123456789012345678';
  before(async () => { api = await startBackend(); token = await setupAdmin(api); });
  after(async () => { await api.stop(); });

  const payload = { content: 'hi {players}', mention: 'none', embed: { title: 'T', description: 'd' }, extraEmbeds: [{ title: 'Second' }] };

  it('lists variables', async () => {
    const r = await api.call('GET', '/api/news/variables', { token });
    assert.equal(r.status, 200);
    assert.ok((r.body as { token: string }[]).some((v) => v.token === '{players}'));
  });

  it('creates a draft, versions it, duplicates it and reschedules', async () => {
    const c = await api.call('POST', '/api/news', { token, body: { channelId, action: 'draft', payload } });
    assert.ok([200, 201].includes(c.status), JSON.stringify(c.body));
    const id = c.body.id as number;
    assert.equal(c.body.status, 'draft');
    const v = await api.call('GET', `/api/news/${id}/versions`, { token });
    assert.equal(v.body.length, 1);
    const dup = await api.call('POST', `/api/news/${id}/duplicate`, { token });
    assert.equal(dup.status, 201);
    assert.match(dup.body.title, /копия/);
    const past = await api.call('PATCH', `/api/news/${id}/schedule`, { token, body: { scheduledAt: Date.now() - 60_000 } });
    assert.equal(past.status, 400);
    const ok = await api.call('PATCH', `/api/news/${id}/schedule`, { token, body: { scheduledAt: Date.now() + 3_600_000 } });
    assert.equal(ok.status, 200);
    assert.equal(ok.body.status, 'scheduled');
    const back = await api.call('PATCH', `/api/news/${id}/schedule`, { token, body: { scheduledAt: null } });
    assert.equal(back.body.status, 'draft');
  });

  it('rejects more than 9 extra embeds and a bad channel', async () => {
    const many = { ...payload, extraEmbeds: Array.from({ length: 10 }, (_, i) => ({ title: `e${i}` })) };
    assert.equal((await api.call('POST', '/api/news', { token, body: { channelId, action: 'draft', payload: many } })).status, 400);
    assert.equal((await api.call('POST', '/api/news', { token, body: { channelId: 'abc', action: 'draft', payload } })).status, 400);
  });

  it('autosaves a draft per user', async () => {
    assert.equal((await api.call('PUT', '/api/news/autosave', { token, body: { key: 'new', payload: { a: 1 } } })).status, 200);
    const g = await api.call('GET', '/api/news/autosave?key=new', { token });
    assert.deepEqual(g.body.payload, { a: 1 });
    await api.call('DELETE', '/api/news/autosave?key=new', { token });
    assert.equal((await api.call('GET', '/api/news/autosave?key=new', { token })).body.payload, null);
  });

  it('refuses a test send without a channel', async () => {
    const r = await api.call('POST', '/api/news/test', { token, body: { payload: { content: 'x' } } });
    assert.equal(r.status, 400);
  });
});

describe('profile', () => {
  let api: Api;
  let token = '';
  before(async () => { api = await startBackend(); token = await setupAdmin(api); });
  after(async () => { await api.stop(); });

  it('validates the time zone and stores preferences', async () => {
    assert.equal((await api.call('PUT', '/api/me/prefs', { token, body: { timezone: 'Mars/Phobos' } })).status, 400);
    const ok = await api.call('PUT', '/api/me/prefs', { token, body: { lang: 'en', timezone: 'Europe/Moscow', timeFormat: '12', dateFormat: 'iso' } });
    assert.equal(ok.status, 200);
    const g = await api.call('GET', '/api/me/prefs', { token });
    assert.equal(g.body.lang, 'en');
    assert.equal(g.body.timeFormat, '12');
  });

  it('returns empty stats and 12 achievements', async () => {
    const s = await api.call('GET', '/api/me/stats?days=30', { token });
    assert.equal(s.status, 200);
    assert.equal(s.body.totalSeconds, 0);
    assert.equal(s.body.byDay.length, 30);
    const a = await api.call('GET', '/api/me/achievements', { token });
    assert.equal(a.body.length, 12);
  });

  it('hides the public profile until it is enabled, and never leaks the e-mail', async () => {
    assert.equal((await api.call('GET', '/api/u/admin')).status, 404);
    await api.call('PUT', '/api/me/player', { token, body: { gameNick: 'Tester', bio: 'hello', publicProfile: true } });
    const pub = await api.call('GET', '/api/u/admin');
    assert.equal(pub.status, 200);
    assert.equal(pub.body.gameNick, 'Tester');
    assert.equal('email' in pub.body, false);
    assert.equal('ip' in pub.body, false);
  });

  it('keeps an account journal', async () => {
    const j = await api.call('GET', '/api/me/journal?limit=20', { token });
    assert.equal(j.status, 200);
    assert.ok(j.body.some((e: { kind: string }) => e.kind === 'prefs_changed'));
  });
});

describe('news mentions', () => {
  let api: Api;
  let token = '';
  const channelId = '123456789012345678';
  const internal = { 'x-internal-token': 'i'.repeat(48) };
  before(async () => { api = await startBackend(); token = await setupAdmin(api); });
  after(async () => { await api.stop(); });

  const sendAndRead = async (payload: Record<string, unknown>) => {
    const c = await api.call('POST', '/api/news', { token, body: { channelId, action: 'now', payload } });
    assert.ok([200, 201].includes(c.status), JSON.stringify(c.body));
    const pending = await api.call('GET', '/internal/news/pending', { headers: internal });
    return (pending.body as { id: number; payload: { mention: string; content?: string } }[]).find((x) => x.id === c.body.id)!;
  };

  it('keeps the chosen mention', async () => {
    const r = await sendAndRead({ content: 'hello', mention: 'everyone', embed: { title: 'T' } });
    assert.equal(r.payload.mention, 'everyone');
  });

  it('turns @everyone typed into the text into a real ping', async () => {
    const r = await sendAndRead({ content: '@everyone запуск', mention: 'none', embed: { title: 'T' } });
    assert.equal(r.payload.mention, 'everyone');
  });

  it('turns @here typed into an embed description into a ping on the message', async () => {
    const r = await sendAndRead({ content: '', mention: 'none', embed: { title: 'T', description: 'внимание @here всем' } });
    assert.equal(r.payload.mention, 'here');
  });

  it('does not ping when nothing asks for it', async () => {
    const r = await sendAndRead({ content: 'просто текст', mention: 'none', embed: { title: 'T', description: 'почта a@everyone.ru' } });
    assert.equal(r.payload.mention, 'none');
  });
});

describe('news author', () => {
  let api: Api;
  let token = '';
  before(async () => { api = await startBackend(); token = await setupAdmin(api); });
  after(async () => { await api.stop(); });

  it('signs with the site login when Discord is not linked', async () => {
    const r = await api.call('GET', '/api/me/author', { token });
    assert.equal(r.status, 200);
    assert.equal(r.body.name, 'admin');
    assert.equal(r.body.source, 'site');
    assert.equal(r.body.iconUrl, null);
  });

  it('needs a signed-in user', async () => {
    assert.equal((await api.call('GET', '/api/me/author')).status, 401);
  });
});
