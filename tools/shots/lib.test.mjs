import test from 'node:test';
import assert from 'node:assert/strict';
import { BAD_TEXT, buildMatrix, formatReport, isExpectedFailure, parseArgs } from './lib.mjs';

test('parseArgs reads flags and values, rejects the unknown form', () => {
  assert.deepEqual(parseArgs(['--pages=a,b', '--full']), { pages: 'a,b', full: true });
  assert.throws(() => parseArgs(['pages=a']), /Unknown argument/);
});

test('buildMatrix: groups, prefixes, viewports and themes', () => {
  const rows = buildMatrix({ pages: 'server', viewports: 'phone', themes: 'dark,light' });
  assert.ok(rows.length >= 14, 'server + the tabs of a server, twice');
  assert.ok(rows.every((r) => r.page.id.startsWith('server')));
  assert.equal(new Set(rows.map((r) => r.theme)).size, 2);
  const noAdmin = buildMatrix({ pages: 'all' }, false);
  assert.ok(noAdmin.every((r) => !r.page.admin));
  assert.ok(buildMatrix({ pages: 'admin' }).every((r) => r.page.admin));
});

test('buildMatrix: a typo is an error, not an empty run', () => {
  assert.throws(() => buildMatrix({ pages: 'sevrers' }), /Unknown page/);
  assert.throws(() => buildMatrix({ viewports: 'watch' }), /Unknown viewport/);
  assert.throws(() => buildMatrix({ themes: 'blue' }), /Unknown theme/);
});

test('BAD_TEXT finds leaked values but not words that merely contain them', () => {
  for (const s of ['Игроков: undefined', 'NaN%', '[object Object]', 'до null', 'Invalid Date']) assert.match(s, BAD_TEXT, s);
  for (const s of ['Nullsoft', 'nullable', 'Hannah', 'Игроков: 21']) assert.doesNotMatch(s, BAD_TEXT, s);
});

test('isExpectedFailure: a guest 401 on /api/me is fine, a 500 is not', () => {
  assert.equal(isExpectedFailure('http://x/api/me', 401), true);
  assert.equal(isExpectedFailure('http://x/api/servers', 500), false);
  assert.equal(isExpectedFailure('http://x/api/servers', 401), false);
});

test('formatReport: errors fail the run, warnings only in strict mode', () => {
  const base = { id: 'news', viewport: 'phone', theme: 'dark', file: 'a.png', errors: [], warnings: [] };
  assert.equal(formatReport([base]).failed, false);
  const w = { ...base, warnings: ['clipped text'] };
  assert.equal(formatReport([w]).failed, false);
  assert.equal(formatReport([w], { strict: true }).failed, true);
  const e = { ...base, errors: ['horizontal scroll'] };
  const rep = formatReport([e, w]);
  assert.equal(rep.failed, true);
  assert.match(rep.text, /phone\/dark news/);
  assert.equal(rep.errors, 1);
});
