import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { setupAdmin, startBackend, type Api } from './harness.ts';
import { slugFrom, slugProblem } from '../src/routes/serverSlug.ts';

describe('slugs of servers (pure)', () => {
  it('accepts latin words with dashes and refuses the rest', () => {
    assert.equal(slugProblem('rust-main'), null);
    assert.equal(slugProblem('r'), 'format');
    assert.equal(slugProblem('Rust'), 'format');
    assert.equal(slugProblem('rust--main'), 'format');
    assert.equal(slugProblem('-rust'), 'format');
    assert.equal(slugProblem('12345'), 'number');
    assert.equal(slugProblem('x'.repeat(41)), 'format');
  });
  it('suggests a slug from a title, with a transliteration', () => {
    assert.equal(slugFrom('Мой Rust #1'), 'moy-rust-1');
    assert.equal(slugFrom('  !!! '), '');
    assert.equal(slugFrom('Щука'), 'schuka');
  });
});

describe('api: slug of a server', () => {
  let api: Api;
  let token = '';
  const body = (name: string, slug?: string) => ({ name, game: 'minecraft', host: '127.0.0.1', port: 25565, ...(slug === undefined ? {} : { slug }) });
  before(async () => { api = await startBackend(); token = await setupAdmin(api); });
  after(async () => { await api.stop(); });

  it('is saved, opens the server by name, redirects the share link and is unique', async () => {
    const a = await api.call('POST', '/api/servers', { token, body: body('Alpha', 'Alpha-One') });
    assert.equal(a.status, 201);
    const id = (a.body as { id: number; slug: string }).id;
    assert.equal((a.body as { slug: string }).slug, 'alpha-one', 'lowercased');
    const r = await api.call('GET', '/api/servers/by-slug/alpha-one', { token });
    assert.deepEqual(r.body, { id });
    assert.equal((await api.call('GET', '/api/servers/by-slug/nothing-here', { token })).status, 404);
    const s = await fetch(`${api.base}/s/alpha-one`, { redirect: 'manual' });
    assert.equal(s.status, 302);
    assert.equal(s.headers.get('location'), `/s/${id}`);
    const b = await api.call('POST', '/api/servers', { token, body: body('Beta', 'alpha-one') });
    assert.equal(b.status, 409);
  });

  it('refuses a bad one, keeps the old one when an edit does not mention it, and clears it with an empty string', async () => {
    assert.equal((await api.call('POST', '/api/servers', { token, body: body('Bad', 'Bad Name!') })).status, 400);
    assert.equal((await api.call('POST', '/api/servers', { token, body: body('Num', '777') })).status, 400);
    const c = (await api.call('POST', '/api/servers', { token, body: body('Gamma', 'gamma') })).body as { id: number };
    const kept = await api.call('PUT', `/api/servers/${c.id}`, { token, body: body('Gamma 2') });
    assert.equal((kept.body as { slug: string }).slug, 'gamma');
    const same = await api.call('PUT', `/api/servers/${c.id}`, { token, body: body('Gamma 2', 'gamma') });
    assert.equal(same.status, 200, 'its own slug is not taken');
    const cleared = await api.call('PUT', `/api/servers/${c.id}`, { token, body: body('Gamma 2', '') });
    assert.equal((cleared.body as { slug: string }).slug, '');
  });
});
