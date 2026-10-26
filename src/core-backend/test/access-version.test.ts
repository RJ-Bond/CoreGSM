import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { startBackend, type Api } from './harness.ts';

/** the footer shows the same version as the update screens: the readable name, else the short build id */
const withEnv = (title: string, env: Record<string, string>, expected: string | null) =>
  describe(title, () => {
    let api: Api;
    before(async () => { api = await startBackend(env); });
    after(async () => { await api.stop(); });
    it('is in the public access settings, so a guest sees it too', async () => {
      const r = await api.call('GET', '/api/access');
      assert.equal(r.status, 200);
      assert.equal(r.body.version, expected);
    });
  });

describe('the public access settings carry the installed version', () => {
  withEnv('a build with a name', { APP_VERSION: 'a1b2c3d4e5f6', APP_VERSION_NAME: '1.2.3.4' }, '1.2.3.4');
  withEnv('a build that has no name yet (an older install)', { APP_VERSION: '0123456789ab', APP_VERSION_NAME: '' }, '0123456');
  withEnv('only the name is known', { APP_VERSION: '', APP_VERSION_NAME: '1.2.3.4' }, '1.2.3.4');
  withEnv('a development run', { APP_VERSION: '', APP_VERSION_NAME: '' }, null);
});
