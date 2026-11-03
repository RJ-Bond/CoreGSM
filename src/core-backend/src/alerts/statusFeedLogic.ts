/**
 * The Atom feed of the status page (GET /api/status/feed.xml): the notes of the administrators and the incidents of the
 * last weeks, newest first, so that a reader of feeds (or a chat bot) can follow the state of the servers without an
 * account. Pure text building, no database: servers.ts collects the entries.
 */
export interface FeedEntry {
  /** a stable id inside the feed: «note-5», «incident-3-1700000000000» */
  id: string;
  title: string;
  body: string;
  /** when the entry was created, ms */
  at: number;
  /** when it last changed, ms (≥ at) */
  updated: number;
  /** the page the entry belongs to, absolute */
  link: string;
}

export const FEED_LIMIT = 50;

/** text for XML: the five characters that matter and control characters that XML forbids */
export function xmlEscape(v: string): string {
  return v
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

const iso = (ms: number) => new Date(ms).toISOString();

export interface IncidentLike { serverId: number; start: number; end: number | null; minutes: number; planned: boolean }

/** one entry for an incident: the title tells whether it is going on, the body how long it took */
export function incidentEntry(i: IncidentLike, serverName: string, base: string): FeedEntry {
  const going = i.end == null;
  const kind = i.planned ? 'Плановые работы' : 'Недоступен';
  const title = going ? `${kind}: ${serverName}` : `${i.planned ? 'Работы завершены' : 'Снова работает'}: ${serverName}`;
  const when = new Date(i.start).toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
  const body = going
    ? `${serverName}: ${i.planned ? 'идут плановые работы' : 'сервер не отвечает'} с ${when} (${i.minutes} мин).`
    : `${serverName}: ${i.planned ? 'плановые работы' : 'сбой'} с ${when}, длилось ${i.minutes} мин.`;
  return {
    id: `incident-${i.serverId}-${i.start}`,
    title,
    body,
    at: i.start,
    updated: i.end ?? Date.now(),
    link: `${base}/status`,
  };
}

/** the Atom document; entries are sorted and cut here, so that the caller need not care */
export function buildAtom(opts: { title: string; base: string; entries: FeedEntry[]; now?: number }): string {
  const now = opts.now ?? Date.now();
  const entries = [...opts.entries].sort((a, b) => b.updated - a.updated).slice(0, FEED_LIMIT);
  const updated = entries[0]?.updated ?? now;
  const self = `${opts.base}/api/status/feed.xml`;
  const items = entries
    .map(
      (e) => `  <entry>
    <id>${xmlEscape(`${opts.base}#${e.id}`)}</id>
    <title>${xmlEscape(e.title)}</title>
    <link href="${xmlEscape(e.link)}"/>
    <published>${iso(e.at)}</published>
    <updated>${iso(e.updated)}</updated>
    <summary>${xmlEscape(e.body)}</summary>
  </entry>`,
    )
    .join('\n');
  return `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <id>${xmlEscape(self)}</id>
  <title>${xmlEscape(opts.title)}</title>
  <link rel="self" type="application/atom+xml" href="${xmlEscape(self)}"/>
  <link rel="alternate" type="text/html" href="${xmlEscape(`${opts.base}/status`)}"/>
  <updated>${iso(updated)}</updated>
${items}
</feed>
`;
}
