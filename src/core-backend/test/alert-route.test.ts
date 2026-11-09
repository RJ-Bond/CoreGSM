import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { alertTarget, systemTarget } from '../src/alerts/alertRoute.ts';
import { setupAdmin, startBackend, type Api } from './harness.ts';

const s = { enabled: true, channelId: '111111111111111111', systemChannelId: '222222222222222222' };

describe('where a message goes', () => {
  it('a service message goes to the service channel, a game message to the alerts channel', () => {
    assert.equal(alertTarget('update', undefined, s), s.systemChannelId);
    assert.equal(alertTarget('disk', undefined, s), s.systemChannelId);
    assert.equal(alertTarget('down', undefined, s), s.channelId);
    assert.equal(alertTarget('poll', undefined, s), s.channelId);
  });
  it('without a service channel everything goes to the alerts channel as before, and an explicit channel always wins', () => {
    assert.equal(alertTarget('update', undefined, { ...s, systemChannelId: '' }), s.channelId);
    assert.equal(alertTarget('update', '333333333333333333', s), '333333333333333333');
  });
  it('a service message needs the service channel or the alerts channel switched on', () => {
    assert.equal(systemTarget(s), s.systemChannelId);
    assert.equal(systemTarget({ ...s, enabled: false }), s.systemChannelId);
    assert.equal(systemTarget({ ...s, systemChannelId: '' }), s.channelId);
    assert.equal(systemTarget({ ...s, systemChannelId: '', enabled: false }), '');
  });
});

describe('api: the service channel', () => {
  let api: Api;
  let token = '';
  before(async () => { api = await startBackend(); token = await setupAdmin(api); });
  after(async () => { await api.stop(); });

  it('is saved, shown back, refused when it is not a channel id, and can be cleared', async () => {
    const put = (body: unknown) => api.call('PUT', '/api/alerts', { token, body });
    assert.equal((await put({ systemChannelId: 'general' })).status, 400);
    const ok = await put({ systemChannelId: '222222222222222222' });
    assert.equal(ok.status, 200);
    assert.equal((ok.body as { systemChannelId: string }).systemChannelId, '222222222222222222');
    assert.equal(((await api.call('GET', '/api/alerts', { token })).body as { systemChannelId: string }).systemChannelId, '222222222222222222');
    assert.equal(((await put({ systemChannelId: '' })).body as { systemChannelId: string }).systemChannelId, '');
  });
});
