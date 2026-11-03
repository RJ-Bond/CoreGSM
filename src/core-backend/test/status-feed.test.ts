import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildAtom, FEED_LIMIT, incidentEntry, xmlEscape, type FeedEntry } from '../src/alerts/statusFeedLogic.js';

const BASE = 'https://panel.example';
const e = (id: string, updated: number, title = 't'): FeedEntry => ({ id, title, body: 'b', at: updated - 1000, updated, link: `${BASE}/status` });

describe('status feed', () => {
  it('escapes everything that could break the XML, and drops control characters', () => {
    assert.equal(xmlEscape(`<a href="x">&'</a>`), '&lt;a href=&quot;x&quot;&gt;&amp;&apos;&lt;/a&gt;');
    assert.equal(xmlEscape('a\u0000b\u0007c'), 'abc');
  });

  it('the newest entry first, and the feed is dated by it', () => {
    const xml = buildAtom({ title: 'Status', base: BASE, entries: [e('a', 1_000_000), e('b', 3_000_000), e('c', 2_000_000)], now: 9 });
    const ids = [...xml.matchAll(/<id>[^<]*#([a-z])<\/id>/g)].map((m) => m[1]);
    assert.deepEqual(ids, ['b', 'c', 'a']);
    assert.match(xml, /<updated>1970-01-01T00:50:00\.000Z<\/updated>\n  <entry>/);
  });

  it('an empty feed is still a valid document dated now', () => {
    const xml = buildAtom({ title: 'Status', base: BASE, entries: [], now: 0 });
    assert.match(xml, /^<\?xml version="1.0" encoding="utf-8"\?>/);
    assert.match(xml, /<updated>1970-01-01T00:00:00\.000Z<\/updated>/);
    assert.ok(!xml.includes('<entry>'));
  });

  it('never more than the limit', () => {
    const many = Array.from({ length: FEED_LIMIT + 20 }, (_, i) => e(`n${i}`, i * 1000));
    assert.equal(buildAtom({ title: 'S', base: BASE, entries: many }).split('<entry>').length - 1, FEED_LIMIT);
  });

  it('a name with markup cannot inject elements', () => {
    const xml = buildAtom({ title: '<x>', base: BASE, entries: [incidentEntry({ serverId: 1, start: 0, end: 60_000, minutes: 1, planned: false }, '</entry><evil/>', BASE)] });
    assert.ok(!xml.includes('<evil/>'));
    assert.match(xml, /&lt;\/entry&gt;&lt;evil\/&gt;/);
  });

  it('an incident says whether it is going on, and whether it was planned', () => {
    const open = incidentEntry({ serverId: 2, start: 1_700_000_000_000, end: null, minutes: 5, planned: false }, 'Rust', BASE);
    assert.equal(open.title, 'Недоступен: Rust');
    const done = incidentEntry({ serverId: 2, start: 1_700_000_000_000, end: 1_700_000_300_000, minutes: 5, planned: false }, 'Rust', BASE);
    assert.equal(done.title, 'Снова работает: Rust');
    assert.equal(done.updated, 1_700_000_300_000);
    const plan = incidentEntry({ serverId: 2, start: 1_700_000_000_000, end: 1_700_000_300_000, minutes: 5, planned: true }, 'Rust', BASE);
    assert.equal(plan.title, 'Работы завершены: Rust');
    assert.notEqual(open.id, incidentEntry({ serverId: 3, start: 1_700_000_000_000, end: null, minutes: 5, planned: false }, 'Rust', BASE).id);
  });
});
