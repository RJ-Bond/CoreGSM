import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { setupAdmin, startBackend, type Api } from './harness.ts';

/** the size of a PNG from its header: the signature, then the IHDR chunk with the width and the height */
function pngSize(buf: Buffer): { w: number; h: number } | null {
  if (buf.length < 24 || buf.readUInt32BE(0) !== 0x89504e47) return null;
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
}

describe('the picture cards', () => {
  let api: Api;
  let token = '';
  let id = 0;
  before(async () => {
    api = await startBackend();
    token = await setupAdmin(api);
    const c = await api.call('POST', '/api/servers', { token, body: { name: '[RU] Test | Standart PvE', game: 'vrising', host: '127.0.0.1', port: 25598 } });
    id = c.body.id;
  });
  after(async () => { await api.stop(); });

  const get = async (path: string) => {
    const r = await fetch(`${api.base}${path}${path.includes('?') ? '&' : '?'}t=${encodeURIComponent(token)}`);
    return { status: r.status, type: r.headers.get('content-type'), buf: Buffer.from(await r.arrayBuffer()) };
  };

  const cases: [string, string, number, number][] = [
    ['the split card, dark', '', 1200, 480],
    ['the split card, light', '?theme=light', 1200, 480],
    ['the strip, dark', '?style=strip', 1200, 240],
    ['the strip, light', '?style=strip&theme=light', 1200, 240],
    ['an unknown style falls back to the split card', '?style=nope&theme=nope', 1200, 480],
  ];
  for (const [title, query, w, h] of cases) {
    it(`${title}: a ${w}x${h} PNG`, async () => {
      const r = await get(`/api/card/${id}.png${query}`);
      assert.equal(r.status, 200);
      assert.equal(r.type, 'image/png');
      assert.deepEqual(pngSize(r.buf), { w, h });
    });
  }

  it('the picture with every server is 1200 px wide and as tall as its rows need', async () => {
    const r = await get('/api/card/all.png');
    assert.equal(r.status, 200);
    const s = pngSize(r.buf);
    assert.equal(s?.w, 1200);
    assert.ok((s?.h ?? 0) > 200);
    assert.equal((await get('/api/card/all.png?theme=light')).status, 200);
  });

  it('a server that does not exist has no card', async () => {
    assert.equal((await get('/api/card/99999.png')).status, 404);
  });

  it('the look for the bot is a setting of the panel and the internal route follows it', async () => {
    const put = await api.call('PUT', '/api/settings', { token, body: { botCardStyle: 'strip', botCardTheme: 'light' } });
    assert.equal(put.status, 200);
    assert.equal(put.body.botCardStyle, 'strip');
    const r = await fetch(`${api.base}/internal/card/${id}.png`, { headers: { 'x-internal-token': 'i'.repeat(48) } });
    assert.equal(r.status, 200);
    assert.deepEqual(pngSize(Buffer.from(await r.arrayBuffer())), { w: 1200, h: 240 });
  });
});
