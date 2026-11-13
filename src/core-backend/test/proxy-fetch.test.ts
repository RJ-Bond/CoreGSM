/** The requests that go to Discord through the proxy of the panel: an HTTP proxy and a SOCKS5 proxy both carry them. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'coregsm-pf-'));
process.env.DB_PATH = path.join(tmp, 'coregsm.db');
process.env.DATA_DIR = tmp;
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET ??= 'j'.repeat(48);
process.env.INTERNAL_TOKEN ??= 'i'.repeat(48);
const { setSetting } = await import('../src/db.ts');
const { discordFetch } = await import('../src/security/proxyFetch.ts');

const listen = (s: net.Server) => new Promise<number>((r) => s.listen(0, '127.0.0.1', () => r((s.address() as net.AddressInfo).port)));

describe('discordFetch through a proxy', () => {
  let target: http.Server;
  let httpProxy: http.Server;
  let socks: net.Server;
  let targetPort = 0;
  const seen: string[] = [];

  before(async () => {
    target = http.createServer((_req, res) => { res.end('hello from the target'); });
    targetPort = await listen(target);
    // an HTTP proxy: a plain request to an http address arrives with the whole address (forwarding), an https one comes as CONNECT
    httpProxy = http.createServer((q, r) => {
      seen.push(`FORWARD ${q.url}`);
      const u = new URL(String(q.url));
      const up = http.request({ host: u.hostname, port: Number(u.port), path: u.pathname + u.search, method: q.method, headers: q.headers }, (resp) => { r.writeHead(resp.statusCode ?? 502, resp.headers); resp.pipe(r); });
      up.on('error', () => { r.statusCode = 502; r.end(); });
      q.pipe(up);
    });
    httpProxy.on('connect', (req, client, head) => {
      seen.push(`CONNECT ${req.url}`);
      const [host, port] = String(req.url).split(':');
      const up = net.connect(Number(port), host, () => { client.write('HTTP/1.1 200 Connection Established\r\n\r\n'); if (head.length) up.write(head); up.pipe(client); client.pipe(up); });
      up.on('error', () => client.destroy());
      client.on('error', () => up.destroy());
    });
    // a SOCKS5 proxy without a password: greeting, one CONNECT request, then a pipe
    socks = net.createServer((c) => {
      c.once('data', () => {
        c.write(Buffer.from([5, 0]));
        c.once('data', (req) => {
          let host = '';
          let off = 4;
          if (req[3] === 1) { host = [...req.subarray(4, 8)].join('.'); off = 8; } else if (req[3] === 3) { const n = req[4]; host = req.subarray(5, 5 + n).toString(); off = 5 + n; }
          const port = req.readUInt16BE(off);
          seen.push(`SOCKS ${host}:${port}`);
          const up = net.connect(port, host, () => { c.write(Buffer.from([5, 0, 0, 1, 0, 0, 0, 0, 0, 0])); up.pipe(c); c.pipe(up); });
          up.on('error', () => c.destroy());
          c.on('error', () => up.destroy());
        });
      });
      c.on('error', () => undefined);
    });
  });
  after(() => { target.close(); httpProxy.close(); socks.close(); });

  it('reaches a server through an HTTP proxy', async () => {
    const p = await listen(httpProxy);
    setSetting('proxy_url', `http://127.0.0.1:${p}`);
    const r = await discordFetch(`http://127.0.0.1:${targetPort}/`);
    assert.equal(await r.text(), 'hello from the target');
    assert.ok(seen.some((s) => s.startsWith('FORWARD http://127.0.0.1:') || s.startsWith('CONNECT 127.0.0.1:')), JSON.stringify(seen));
  });

  it('reaches a server through a SOCKS5 proxy', async () => {
    const p = await listen(socks);
    setSetting('proxy_url', `socks5://127.0.0.1:${p}`);
    const r = await discordFetch(`http://127.0.0.1:${targetPort}/`);
    assert.equal(await r.text(), 'hello from the target');
    assert.ok(seen.some((s) => s.startsWith('SOCKS 127.0.0.1:')), JSON.stringify(seen));
  });

  it('goes straight when there is no proxy', async () => {
    setSetting('proxy_url', '');
    const before = seen.length;
    assert.equal(await (await discordFetch(`http://127.0.0.1:${targetPort}/`)).text(), 'hello from the target');
    assert.equal(seen.length, before, 'nothing went through a proxy');
  });
});
