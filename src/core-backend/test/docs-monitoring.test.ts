import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

/** the dashboard and the rules of docs/monitoring must only name metrics that the panel really gives */
const root = new URL('../../../', import.meta.url);
const read = (p: string) => readFileSync(new URL(p, root), 'utf8');
const source = read('src/core-backend/src/monitoring/metrics.ts');
const names = (text: string) => [...new Set([...text.matchAll(/\bcoregsm_[a-z_]+\b/g)].map((m) => m[0]))];

describe('docs/monitoring', () => {
  it('the dashboard is valid JSON and names only metrics that exist', () => {
    const text = read('docs/monitoring/coregsm-grafana.json');
    const d = JSON.parse(text) as { panels: unknown[]; uid: string };
    assert.ok(d.panels.length >= 8);
    assert.equal(d.uid, 'coregsm-overview');
    const missing = names(text).filter((n) => !source.includes(`'${n}'`));
    assert.deepEqual(missing, [], `not in metrics.ts: ${missing.join(', ')}`);
  });

  it('the rules name only metrics that exist', () => {
    const missing = names(read('docs/monitoring/prometheus-rules.yml')).filter((n) => !source.includes(`'${n}'`));
    assert.deepEqual(missing, [], `not in metrics.ts: ${missing.join(', ')}`);
  });

  it('the readme lists every metric of the panel', () => {
    const readme = read('docs/monitoring/README.md');
    const given = [...source.matchAll(/metric\('(coregsm_[a-z_]+)'/g)].map((m) => m[1]);
    assert.ok(given.length >= 15);
    const unlisted = given.filter((n) => !readme.includes(n));
    assert.deepEqual(unlisted, [], `not in the readme: ${unlisted.join(', ')}`);
  });
});
