/** The public news feed: pages, neighbours and «read next» in one answer, and the link-preview page /n/<id>. */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { setupAdmin, startBackend, type Api } from './harness.ts';

const H = { 'x-internal-token': 'i'.repeat(48) };
const CH = '123456789012345678';

describe('news feed over the API', () => {
  let api: Api;
  let admin = '';
  const ids: number[] = [];
  const cats = ['wipe', 'wipe', 'update', 'event', 'announcement', 'wipe'];

  before(async () => {
    api = await startBackend({ PUBLIC_URL: 'https://panel.example.com' });
    admin = await setupAdmin(api);
    for (let i = 0; i < cats.length; i++) {
      const c = await api.call('POST', '/api/news', {
        token: admin,
        body: { channelId: CH, action: 'now', payload: { content: '', mention: 'none', category: cats[i], embed: { title: `Новость ${i + 1}`, description: i === 0 ? '**Жирный** текст [ссылка](https://x.example) и <b>тег</b>' : `Текст ${i + 1}` } } },
      });
      assert.ok([200, 201].includes(c.status), JSON.stringify(c.body));
      ids.push(c.body.id as number);
    }
    // the bot reports them as sent, one after another (so the order by time is the order of creation)
    const pend = await api.call('GET', '/internal/news/pending', { headers: H });
    for (const p of pend.body as { id: number }[]) {
      await api.call('PATCH', `/internal/news/${p.id}`, { headers: H, body: { status: 'sent', messageId: `1${String(p.id).padStart(18, '0')}` } });
      await new Promise((r) => setTimeout(r, 15));
    }
  });
  after(async () => { await api.stop(); });

  it('without a limit the list is whole (as before); with a limit it is a page, the order is the same', async () => {
    const all = await api.call('GET', '/api/news');
    assert.equal(all.body.length, 6);
    const p1 = await api.call('GET', '/api/news?limit=4&offset=0');
    const p2 = await api.call('GET', '/api/news?limit=4&offset=4');
    assert.equal(p1.body.length, 4);
    assert.equal(p2.body.length, 2);
    assert.deepEqual([...p1.body, ...p2.body].map((n: { id: number }) => n.id), all.body.map((n: { id: number }) => n.id));
    assert.equal((await api.call('GET', '/api/news?limit=4&offset=99')).body.length, 0);
    assert.equal((await api.call('GET', '/api/news?limit=abc')).body.length, 6, 'a bad limit is ignored');
  });

  it('the newest first; a page never holds more than 100', async () => {
    const all = await api.call('GET', '/api/news');
    assert.equal(all.body[0].id, ids[ids.length - 1]);
    assert.equal((await api.call('GET', '/api/news?limit=1000')).body.length, 6);
  });

  it('one item brings its neighbours and three suggestions (the same rubric first, never itself)', async () => {
    const mid = await api.call('GET', `/api/news/${ids[2]}`);
    assert.equal(mid.status, 200);
    assert.equal(mid.body.prev.id, ids[3], 'prev is the newer one');
    assert.equal(mid.body.next.id, ids[1], 'next is the older one');
    assert.equal(mid.body.related.length, 3);
    assert.ok(!mid.body.related.some((n: { id: number }) => n.id === ids[2]));
    const first = await api.call('GET', `/api/news/${ids[0]}`);
    assert.equal(first.body.next, null);
    // three «wipe» news besides this one are suggested before the others
    assert.deepEqual(first.body.related.map((n: { id: number }) => n.id).slice(0, 2).sort(), [ids[1], ids[5]].sort());
    assert.equal(first.body.related[0].payload.embed.title.startsWith('Новость'), true);
    assert.equal('channelId' in first.body.related[0], false, 'the public shape: no channel');
  });

  it('filters by rubric and counts every rubric (the chips cannot be counted from one page)', async () => {
    const wipes = await api.call('GET', '/api/news?category=wipe');
    assert.deepEqual(wipes.body.map((n: { id: number }) => n.id).sort(), [ids[0], ids[1], ids[5]].sort());
    assert.equal((await api.call('GET', '/api/news?category=wipe&limit=2')).body.length, 2);
    assert.equal((await api.call('GET', '/api/news?category=nonsense')).body.length, 6, 'an unknown rubric is ignored');
    const c = await api.call('GET', '/api/news/counts');
    assert.deepEqual(c.body, { all: 6, announcement: 1, wipe: 3, update: 1, event: 1, maintenance: 0, other: 0 });
  });

  it('a draft is neither in the list nor among the neighbours', async () => {
    const d = await api.call('POST', '/api/news', { token: admin, body: { channelId: CH, action: 'draft', payload: { content: '', mention: 'none', embed: { title: 'Черновик' } } } });
    assert.ok([200, 201].includes(d.status));
    assert.equal((await api.call('GET', '/api/news')).body.length, 6);
    assert.equal((await api.call('GET', `/api/news/${d.body.id}`)).status, 404);
    const last = await api.call('GET', `/api/news/${ids[5]}`);
    assert.ok(!last.body.related.some((n: { id: number }) => n.id === d.body.id));
  });
});

describe('news link preview page', () => {
  let api: Api;
  let admin = '';
  let id = 0;
  before(async () => {
    api = await startBackend({ PUBLIC_URL: 'https://panel.example.com' });
    admin = await setupAdmin(api);
    const c = await api.call('POST', '/api/news', {
      token: admin,
      body: { channelId: CH, action: 'now', payload: { content: '', mention: 'none', embed: { title: 'Вайп <script>x</script> в субботу', description: '**Карта 4000**, x2. [Правила](https://x.example)' } } },
    });
    id = c.body.id as number;
    const pend = await api.call('GET', '/internal/news/pending', { headers: H });
    for (const p of pend.body as { id: number }[]) await api.call('PATCH', `/internal/news/${p.id}`, { headers: H, body: { status: 'sent', messageId: '1'.repeat(19) } });
  });
  after(async () => { await api.stop(); });

  const raw = async (path: string) => {
    const r = await fetch(`${api.base}${path}`);
    return { status: r.status, text: await r.text(), type: r.headers.get('content-type') ?? '' };
  };

  it('has the meta tags of a preview, an escaped title, a plain teaser and sends people on to the news page', async () => {
    const r = await raw(`/n/${id}`);
    assert.equal(r.status, 200);
    assert.match(r.type, /text\/html/);
    assert.match(r.text, /<meta property="og:title" content="Вайп &lt;script&gt;x&lt;\/script&gt; в субботу">/);
    assert.match(r.text, /<meta property="og:description" content="Карта 4000, x2\. Правила">/);
    assert.match(r.text, /<meta property="og:url" content="https:\/\/panel\.example\.com\/n\/\d+">/);
    assert.match(r.text, /<meta property="og:image" content="https:\/\/panel\.example\.com\/og-default\.png">/);
    assert.match(r.text, new RegExp(`url=/news/${id}`));
    assert.ok(!r.text.includes('<script>x</script>'), 'the title cannot inject markup');
  });

  it('is 404 for an unknown or unpublished item', async () => {
    assert.equal((await raw('/n/99999')).status, 404);
    const d = await api.call('POST', '/api/news', { token: admin, body: { channelId: CH, action: 'draft', payload: { content: '', mention: 'none', embed: { title: 'Черновик' } } } });
    assert.equal((await raw(`/n/${d.body.id}`)).status, 404);
  });

  it('is closed together with a closed panel', async () => {
    const off = await api.call('PUT', '/api/access', { token: admin, body: { publicPanel: false } });
    assert.equal(off.status, 200);
    assert.equal((await raw(`/n/${id}`)).status, 404);
  });
});
