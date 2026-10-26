import assert from 'node:assert/strict';
import { test } from 'node:test';
import { s3ObjectUrl, s3Problem, signV4 } from '../src/s3.js';

test('SigV4 matches the example from the AWS documentation (GET with a Range header)', () => {
  const h = signV4({
    method: 'GET',
    url: new URL('https://examplebucket.s3.amazonaws.com/test.txt'),
    headers: { Range: 'bytes=0-9' },
    payloadHash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    region: 'us-east-1',
    accessKey: 'AKIAIOSFODNN7EXAMPLE',
    secretKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
    now: new Date('2013-05-24T00:00:00Z'),
  });
  assert.match(h.authorization!, /Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41$/);
});

test('object address is path-style, the prefix is optional, names are encoded', () => {
  const t = { endpoint: 'https://s3.example.com', bucket: 'bk', region: 'r', accessKey: 'a', secretKey: 's', prefix: '/coregsm/' };
  assert.equal(s3ObjectUrl(t, 'a b.tar.gz').href, 'https://s3.example.com/bk/coregsm/a%20b.tar.gz');
  assert.equal(s3ObjectUrl({ ...t, prefix: '' }, 'x').pathname, '/bk/x');
});

test('s3Problem rejects http, a bad bucket and missing keys', () => {
  const ok = { endpoint: 'https://s3.example.com', bucket: 'my-bucket', accessKey: 'a', secretKey: 's' };
  assert.equal(s3Problem(ok), null);
  assert.match(s3Problem({ ...ok, endpoint: 'http://x' })!, /https/);
  assert.ok(s3Problem({ ...ok, bucket: '-' }));
  assert.ok(s3Problem({ ...ok, secretKey: '' }));
});
