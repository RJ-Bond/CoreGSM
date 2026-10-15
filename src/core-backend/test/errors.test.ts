import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { codeOf, ERRORS } from '../src/errors.ts';
import { ADMIN, setupAdmin, startBackend, type Api } from './harness.ts';

const SRC = path.resolve(import.meta.dirname, '../src');
const files = (dir: string): string[] =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(path.join(dir, e.name)) : e.name.endsWith('.ts') ? [path.join(dir, e.name)] : []));
// discordRegister.ts answers the bot's slash commands: its texts are Discord replies, not errors of the panel
const sources = files(SRC).filter((f) => !f.endsWith('errors.ts') && !f.endsWith('discordRegister.ts'));

/** "${expr}" in a source literal and "{name}" in the catalogue both become "{}" */
const shape = (s: string) => s.replace(/\$\{[^}]*\}|\{\w+\}/g, '{}');
const catalogue = new Set(Object.values(ERRORS).map(shape));

// Russian texts that end up in the `error` of an answer: response bodies, zod messages, validators, limiters, backups
const CONTEXT = [
  /error:\s*$/,
  /issues\[0\]\?\.message \?\?\s*$/,
  /\.(regex|min|max|refine|length)\([^()]*,\s*$/,
  /message:\s*$/,
  /new BackupError\(\s*$/,
  /windowLimiter\([^()]*,\s*$/,
  /message = $/,
];
// validators that return the text of the error (null when the input is fine)
const VALIDATORS = new Set(['news.ts', 'maintenance.ts', 'backup.ts']);
// `error` fields of normal answers (not errors): the bot's state and the update check
const NOT_ERRORS = [/^Бот не отвечает/, /^Не удалось проверить обновления/];

function russianTexts(): { text: string; where: string }[] {
  const out: { text: string; where: string }[] = [];
  // one line at most: an apostrophe in a comment must not pair quotes across lines
  const lit = /(['`])((?:\\.|(?!\1)[^\\\n])*?[А-Яа-яЁё](?:\\.|(?!\1)[^\\\n])*?)\1(\s*\+)?/g;
  for (const f of sources) {
    const s = fs.readFileSync(f, 'utf8');
    for (const m of s.matchAll(lit)) {
      const before = s.slice(Math.max(0, m.index! - 80), m.index!);
      const validator = VALIDATORS.has(path.basename(f)) && /return\s*$/.test(before);
      if (!validator && !CONTEXT.some((re) => re.test(before))) continue;
      // 'Prefix: ' + detail is a template with one value at the end
      const text = m[3] ? `${m[2]}{}` : m[2];
      out.push({ text, where: `${path.relative(SRC, f)}:${s.slice(0, m.index).split('\n').length}` });
    }
  }
  return out;
}

describe('error catalogue', () => {
  it('has every Russian error text of the backend (add new texts to src/errors.ts)', () => {
    const texts = russianTexts();
    assert.ok(texts.length > 100, `only ${texts.length} texts found: the scan is broken`);
    const missing = texts.filter((t) => !catalogue.has(shape(t.text)) && !NOT_ERRORS.some((re) => re.test(t.text)));
    assert.deepEqual(missing, []);
  });

  it('has no entry that the code no longer uses', () => {
    const all = sources.map((f) => shape(fs.readFileSync(f, 'utf8'))).join('\n');
    const unused = Object.entries(ERRORS).filter(([, text]) => {
      const parts = shape(text).split('{}');
      // a template is used when its fixed parts appear in the code
      return !parts.every((p) => !p || all.includes(p.replace(/'/g, "\\'")) || all.includes(p));
    });
    assert.deepEqual(unused.map(([c]) => c), []);
  });

  it('texts are unique and codes are snake_case', () => {
    const texts = Object.values(ERRORS);
    assert.equal(new Set(texts).size, texts.length);
    for (const c of Object.keys(ERRORS)) assert.match(c, /^[a-z][a-z0-9_]*$/);
  });

  it('codeOf finds plain texts and fills templates', () => {
    assert.deepEqual(codeOf('Требуется вход'), { code: 'auth_required' });
    assert.deepEqual(codeOf('Слишком много неверных попыток. Повторите через 42 с.'), { code: 'login_locked', params: { sec: '42' } });
    assert.deepEqual(codeOf('Эту версию нельзя восстановить: Заголовок: не более 256 символов'), {
      code: 'version_unrestorable',
      params: { reason: 'Заголовок: не более 256 символов' },
    });
    assert.equal(codeOf('something else'), null);
  });
});

describe('error answers carry the code', () => {
  let api: Api;
  let admin = '';
  before(async () => {
    api = await startBackend();
    admin = await setupAdmin(api);
  });
  after(async () => {
    await api.stop();
  });

  it('auth_required with the Russian text kept', async () => {
    const r = await api.call('GET', '/api/me');
    assert.equal(r.status, 401);
    assert.equal(r.body.code, 'auth_required');
    assert.equal(r.body.error, 'Требуется вход');
  });

  it('wrong password: bad_credentials, then login_locked with the seconds', async () => {
    const login = (ip: string) =>
      fetch(`${api.base}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': ip }, body: JSON.stringify({ username: ADMIN.username, password: 'nope' }) });
    const first = await (await login('10.9.0.1')).json();
    assert.equal(first.code, 'bad_credentials');
    assert.equal(first.attemptsLeft, 4);
    for (let i = 0; i < 4; i++) await login('10.9.0.1');
    const locked = await (await login('10.9.0.1')).json();
    assert.equal(locked.code, 'login_locked');
    assert.match(locked.params.sec, /^\d+$/);
  });

  it('broken JSON: bad_json', async () => {
    const r = await api.call('POST', '/api/auth/login', { raw: '{', headers: { 'content-type': 'application/json' } });
    assert.equal(r.status, 400);
    assert.equal(r.body.code, 'bad_json');
  });

  it('a password autofilled into the bot token is refused and the saved token stays', async () => {
    // shaped like a bot token, built from parts so that secret scanners do not take it for a real one
    const token = ['t'.repeat(24), 'x'.repeat(6), 'k'.repeat(27)].join('.');
    assert.equal((await api.call('PUT', '/api/settings', { token: admin, body: { discordToken: token } })).status, 200);
    const r = await api.call('PUT', '/api/settings', { token: admin, body: { discordToken: ADMIN.password, proxyUrl: ADMIN.username } });
    assert.equal(r.status, 400);
    assert.ok(r.body.code === 'proxy_format' || r.body.code === 'bad_bot_token', r.body.code);
    const r2 = await api.call('PUT', '/api/settings', { token: admin, body: { discordToken: ADMIN.password } });
    assert.equal(r2.body.code, 'bad_bot_token');
    const cfg = await api.call('GET', '/internal/config', { headers: { 'x-internal-token': 'i'.repeat(48) } });
    assert.equal(cfg.body.discordToken, token);
    assert.equal(cfg.body.proxyUrl, '');
  });

  it('a normal answer is left alone', async () => {
    const r = await api.call('GET', '/api/setup/status');
    assert.equal(r.status, 200);
    assert.equal(r.body.code, undefined);
  });
});
