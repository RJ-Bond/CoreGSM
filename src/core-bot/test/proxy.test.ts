import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import { after, before, test } from 'node:test';
import { request } from 'undici';
import { parseProxy } from '../src/proxy.js';

/** a minimal SOCKS5 server (no auth, CONNECT only) that counts the tunnels it opened */
function socks5(): Promise<{ port: number; tunnels: () => number; close: () => void }> {
  let n = 0;
  const srv = net.createServer((c) => {
    c.once('data', () => {
      c.write(Buffer.from([5, 0]));
      c.once('data', (req) => {
        let host = '';
        let off = 4;
        if (req[3] === 1) { host = [...req.subarray(4, 8)].join('.'); off = 8; }
        else if (req[3] === 3) { host = req.subarray(5, 5 + req[4]).toString(); off = 5 + req[4]; }
        const port = req.readUInt16BE(off);
        const up = net.connect(port, host, () => {
          n++;
          c.write(Buffer.from([5, 0, 0, 1, 0, 0, 0, 0, 0, 0]));
          c.pipe(up).pipe(c);
        });
        up.on('error', () => c.destroy());
      });
    });
    c.on('error', () => undefined);
  });
  return new Promise((r) => srv.listen(0, '127.0.0.1', () => r({ port: (srv.address() as net.AddressInfo).port, tunnels: () => n, close: () => srv.close() })));
}

let web: http.Server;
let webPort = 0;
let proxy: Awaited<ReturnType<typeof socks5>>;
before(async () => {
  web = http.createServer((_q, s) => s.end('pong'));
  await new Promise<void>((r) => web.listen(0, '127.0.0.1', () => r()));
  webPort = (web.address() as net.AddressInfo).port;
  proxy = await socks5();
});
after(() => { web.close(); proxy.close(); });

test('a SOCKS proxy works with the request() discord.js uses (undici 6, dispatcher passed in the options)', async () => {
  const p = parseProxy(`socks5://127.0.0.1:${proxy.port}`)!;
  const r = await request(`http://127.0.0.1:${webPort}/`, { dispatcher: p.rest });
  assert.equal(await r.body.text(), 'pong');
  assert.equal(proxy.tunnels(), 1);
});

test('an HTTP proxy URL still gives a dispatcher, and a bad URL a clear error', () => {
  assert.equal(parseProxy('http://127.0.0.1:3128')!.label, 'http://127.0.0.1:3128');
  assert.equal(parseProxy(''), null);
  assert.throws(() => parseProxy('ftp://x'), /Unsupported proxy protocol/);
});
