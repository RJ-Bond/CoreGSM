/** Subscriptions to the rubrics of the news and the statistics of one item. */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { newsNoticeText, normRubric } from '../src/newsSubs.ts';
import { setupAdmin, startBackend, type Api } from './harness.ts';

const channelId = '123456789012345678';
const H = { 'x-internal-token': 'i'.repeat(48) };
const MSG = '1'.repeat(19);

describe('news subscriptions: texts', () => {
  it('puts the rubric into the text and falls back to announcements', () => {
    assert.equal(newsNoticeText('wipe', 'Вайп в субботу'), '🧹 Новая новость: «Вайп в субботу»');
    assert.equal(newsNoticeText('zzz', 'Раз'), '📰 Новая новость: «Раз»');
    assert.equal(normRubric('wipe'), 'wipe');
    assert.equal(normRubric('zzz'), 'announcement');
  });
});

describe('api: news subscriptions and stats', () => {
  let api: Api;
  let admin = '';
  let reader = '';
  let news = 0;

  before(async () => {
    api = await startBackend();
    admin = await setupAdmin(api);
    reader = (await api.call('POST', '/api/auth/register', { body: { username: 'sub_reader', password: 'Passw0rd!long', acceptRules: true } })).body.token as string;
    news = (await api.call('POST', '/api/news', { token: admin, body: { channelId, action: 'now', payload: { content: 'Вайп', category: 'wipe', embed: { title: 'Вайп в субботу' } } } })).body.id as number;
  });
  after(async () => { await api.stop(); });

  it('needs a signed-in user and keeps the chosen rubrics in canonical order', async () => {
    assert.equal((await api.call('GET', '/api/me/news-subscriptions')).status, 401);
    const put = await api.call('PUT', '/api/me/news-subscriptions', { token: reader, body: { categories: ['wipe', 'update', 'wipe'] } });
    assert.deepEqual(put.body.categories, ['wipe', 'update']);
    assert.deepEqual((await api.call('GET', '/api/me/news-subscriptions', { token: reader })).body.categories, ['wipe', 'update']);
    assert.equal((await api.call('PUT', '/api/me/news-subscriptions', { token: reader, body: { categories: ['nope'] } })).status, 400);
    assert.deepEqual((await api.call('PUT', '/api/me/news-subscriptions', { token: reader, body: { categories: [] } })).body.categories, []);
  });

  it('tells the subscribers when the bot posts the item for the first time', async () => {
    await api.call('PUT', '/api/me/news-subscriptions', { token: reader, body: { categories: ['wipe'] } });
    const done = await api.call('PATCH', `/internal/news/${news}`, { headers: H, body: { status: 'sent', messageId: MSG } });
    assert.equal(done.status, 200, JSON.stringify(done.body));
    const inbox = (await api.call('GET', '/api/me/notifications', { token: reader })).body.items as { kind: string; text: string; url: string }[];
    const n = inbox.find((x) => x.kind === 'news');
    assert.ok(n, JSON.stringify(inbox));
    assert.equal(n.url, `/news/${news}`);
    assert.match(n.text, /Вайп в субботу/);
    // the second report of the same item (an edit) says nothing new
    await api.call('PATCH', `/internal/news/${news}`, { headers: H, body: { status: 'sent', messageId: MSG } });
    const again = (await api.call('GET', '/api/me/notifications', { token: reader })).body.items as { kind: string }[];
    assert.equal(again.filter((x) => x.kind === 'news').length, 1);
  });

  it('shows the statistics to the editors only', async () => {
    await api.call('POST', `/api/news/${news}/view`, { token: reader });
    assert.equal((await api.call('GET', `/api/news/${news}/stats`, { token: reader })).status, 403);
    const s = await api.call('GET', `/api/news/${news}/stats`, { token: admin });
    assert.equal(s.status, 200);
    assert.equal(s.body.views, 1);
    assert.equal(s.body.byDay.length, 30);
    assert.equal(s.body.byDay[29].n, 1);
  });
});
