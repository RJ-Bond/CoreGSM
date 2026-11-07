/**
 * Every route of the API either carries an access guard (sign-in, a role, a permission, an API key, the internal token)
 * or is on the list below with the reason it is open. A new route without a guard fails this test: whoever adds it has to
 * decide on purpose. The check reads the source (the text between the path and the handler), so it needs no running server.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';

const SRC = path.resolve(import.meta.dirname, '../src');

const walk = (dir: string): string[] =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : e.name.endsWith('.ts') ? [path.join(dir, e.name)] : []));

const ROUTE = /\b(app|router)\.(get|post|put|patch|delete)\(\s*(?:\n\s*)?(['`"])(\/[^'`"]*)\3/g;
const GUARD = /\b(auth|authed|admin|staff|viewer|moderator|newsStaff|replyStaff|apiKeyAuth|stepUp|internal)\b|\ballow\(/;

interface Found { file: string; method: string; route: string; guarded: boolean }

function scan(): Found[] {
  const out: Found[] = [];
  for (const file of walk(SRC)) {
    const text = fs.readFileSync(file, 'utf8');
    for (const m of text.matchAll(ROUTE)) {
      const from = (m.index ?? 0) + m[0].length;
      const arrow = text.indexOf('=>', from);
      const seg = text.slice(from, arrow > 0 ? Math.min(arrow, from + 500) : from + 400);
      const cut = /(async\s*\(|\(req|\(_req|wrap\(|guard\()/.exec(seg);
      const middle = cut ? seg.slice(0, cut.index) : seg;
      out.push({ file: path.relative(SRC, file).replace(/\\/g, '/'), method: m[2].toUpperCase(), route: m[4], guarded: GUARD.test(middle) });
    }
  }
  return out;
}

/** open on purpose: public pages and pictures, the sign-in family, routes that check their own token inside */
const OPEN: Record<string, string> = {
  'GET /api/health': 'liveness probe of the container',
  'GET /api/access': 'what the sign-in page needs (brand, registration mode)',
  'GET /api/games': 'the list of games, public data',
  'GET /api/push/key': 'the public VAPID key',
  'GET /api/v1/openapi.json': 'documentation of the public API',
  'GET /api/setup/status': 'tells the first-run page whether setup is still open',
  'GET /api/game-news/player/status': 'the CoreGSM game plugin: checks its own Bearer token inside',
  'POST /api/game-news/player/register': 'the CoreGSM game plugin: checks its own Bearer token inside; limited per game account',
  'GET /api/game-news/pull': 'the CoreGSM game plugin: checks its own Bearer token (the hash of it) inside',
  'POST /api/setup': 'first-run setup: needs the setup code, closes itself',
  'POST /api/auth/login': 'sign-in (rate limited, locks out)',
  'GET /api/auth/challenge': 'a puzzle for the sign-in form (rate limited, signed, works once)',
  'POST /api/auth/register': 'registration (rate limited, closes by the setting)',
  'GET /api/auth/check': 'does this login name exist: rate limited',
  'POST /api/auth/forgot': 'password reset request (rate limited, same answer for any login)',
  'POST /api/auth/reset': 'password reset by the link (token, rate limited)',
  'POST /api/auth/session': 'turns a Bearer token into the cookie (checks the token)',
  'POST /api/auth/verify-email': 'e-mail confirmation by the link (token, rate limited)',
  'GET /api/auth/discord/start': 'sign-in through Discord (rate limited)',
  'GET /api/auth/discord/callback': 'sign-in through Discord (state is checked inside)',
  'GET /api/metrics': 'Prometheus: off without METRICS_TOKEN, a Bearer token is checked inside',
  'GET /api/probe/agent.mjs': 'the probe script: public code, no data',
  'GET /api/probe/targets': 'a probe token is checked inside',
  'POST /api/probe/results': 'a probe token is checked inside',
  'GET /api/u/:username': 'a public profile: only when its owner switched it on (rate limited)',
  'GET /api/u/:username/card.png': 'the picture of a public profile (rate limited)',
  'GET /api/users/:id/banner': 'a banner picture of a profile',
  'GET /api/avatars/:file': 'avatar pictures',
  'GET /api/covers/:file': 'server cover pictures',
  'GET /api/branding/logo': 'the logo',
  'GET /api/manifest.json': 'the web app manifest',
  'GET /api/og/default.png': 'the link preview picture',
  'GET /api/card/:id.png': 'the picture card of a server (public panel data)',
  'GET /api/card/all.png': 'the picture card of all servers',
  'GET /api/game-icon/:game.png': 'game icons',
  'GET /api/digest/:to-:sig.png': 'a picture with a signature in its address',
  'GET /api/server-chart/:id-:sig.png': 'a picture with a signature in its address',
  'GET /badge/servers/:file': 'public badge (the public panel)',
  'GET /widget/servers/:id': 'public widget (the public panel)',
  'GET /api/news/images/:name': 'pictures of published news',
  'GET /n/:id': 'a public news page for link previews',
  'GET /s/:id': 'a public server page for link previews',
};

describe('every route has a guard or a reason to be open', () => {
  const found = scan();

  it('finds the routes', () => assert.ok(found.length > 250, `found ${found.length}`));

  it('a route without a guard is on the list of open ones', () => {
    const unknown = found.filter((f) => !f.guarded && !(`${f.method} ${f.route}` in OPEN)).map((f) => `${f.method} ${f.route}  (${f.file})`);
    assert.deepEqual(unknown, [], 'these routes have no guard: add one, or add the route to OPEN with the reason');
  });

  it('the list of open routes holds nothing that is gone or has a guard now', () => {
    const open = new Set(found.filter((f) => !f.guarded).map((f) => `${f.method} ${f.route}`));
    const stale = Object.keys(OPEN).filter((k) => !open.has(k));
    assert.deepEqual(stale, [], 'remove these from OPEN');
  });

  it('only the sign-in family and the probe can change something without a guard', () => {
    const writes = found.filter((f) => !f.guarded && f.method !== 'GET').map((f) => `${f.method} ${f.route}`).sort();
    assert.deepEqual(writes, [
      'POST /api/auth/forgot',
      'POST /api/auth/login',
      'POST /api/auth/register',
      'POST /api/auth/reset',
      'POST /api/auth/session',
      'POST /api/auth/verify-email',
      'POST /api/game-news/player/register',
      'POST /api/probe/results',
      'POST /api/setup',
    ]);
  });
});
