import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { redact } from '../src/security/redact.ts';

describe('redact', () => {
  const token = 'MTIzNDU2Nzg5MDEyMzQ1Njc4.GabcDE.' + 'x'.repeat(30);
  const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.' + 'a'.repeat(20);

  it('takes out the bot token, a webhook, a JWT, a Bearer header and an API key', () => {
    assert.equal(redact(`login failed for ${token}`).includes('GabcDE'), false);
    assert.equal(redact('POST https://discord.com/api/webhooks/123456789/SECRETPART_abc failed'), 'POST https://discord.com/api/webhooks/123456789/*** failed');
    assert.equal(redact(`cookie ${jwt}`).includes('eyJ'), false);
    assert.equal(redact('Authorization: Bearer abcdef0123456789xyz'), 'Authorization: Bearer ***');
    assert.equal(redact('key cgsm_' + 'A'.repeat(43) + ' used'), 'key cgsm_*** used');
  });

  it('takes out the password of an address and «password=…» pairs', () => {
    assert.equal(redact('proxy socks5://user:p%40ss@10.0.0.1:1080 down'), 'proxy socks5://***:***@10.0.0.1:1080 down');
    assert.equal(redact('smtp?password=hunter22&user=a'), 'smtp?password=***&user=a');
    assert.equal(redact('{"token":"abcdef","name":"x"}'), '{"token":"***","name":"x"}');
    assert.equal(redact('secret: s3cr3t-value'), 'secret: ***');
  });

  it('takes out stored encrypted values and long hexadecimal secrets', () => {
    assert.equal(redact('value enc:v1:AAAABBBBCCCC=='), 'value enc:v1:***');
    assert.equal(redact('hash ' + 'ab12'.repeat(16)), 'hash ***');
  });

  it('leaves ordinary text, short numbers and non-strings alone', () => {
    const plain = 'Poll of server 12 took 340 ms (192.168.1.5:27015)';
    assert.equal(redact(plain), plain);
    assert.equal(redact(42), 42);
    assert.equal(redact(''), '');
    assert.deepEqual(redact({ a: 1 }), { a: 1 });
  });
});
