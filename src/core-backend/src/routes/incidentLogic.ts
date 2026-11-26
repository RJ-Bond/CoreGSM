/** The pure part of the page of one outage: the story in order and the points of the chart. */

export interface IncidentCore { start: number; end: number | null; playersBefore: number; planned: boolean }
export interface NoteLike { title: string; body: string; level: string; created_at: number; resolved_at: number | null }
export interface ChangeRow { ts: number; kind: string; oldValue: string; newValue: string }

export type TimelineItem =
  | { ts: number; kind: 'down'; playersBefore: number; planned: boolean }
  | { ts: number; kind: 'up'; minutes: number }
  | { ts: number; kind: 'note'; title: string; body: string; level: string }
  | { ts: number; kind: 'noteDone'; title: string }
  | { ts: number; kind: 'change'; what: string; from: string; to: string };

/** everything that happened around the outage, oldest first; at the same moment «down» comes first and «up» last */
export function buildTimeline(i: IncidentCore, notes: NoteLike[], changes: ChangeRow[]): TimelineItem[] {
  const out: TimelineItem[] = [{ ts: i.start, kind: 'down', playersBefore: i.playersBefore, planned: i.planned }];
  for (const n of notes) {
    out.push({ ts: n.created_at, kind: 'note', title: n.title, body: n.body, level: n.level });
    if (n.resolved_at != null) out.push({ ts: n.resolved_at, kind: 'noteDone', title: n.title });
  }
  for (const c of changes) out.push({ ts: c.ts, kind: 'change', what: c.kind, from: c.oldValue, to: c.newValue });
  if (i.end != null) out.push({ ts: i.end, kind: 'up', minutes: Math.max(1, Math.round((i.end - i.start) / 60_000)) });
  const rank = (k: TimelineItem['kind']) => (k === 'down' ? 0 : k === 'up' ? 2 : 1);
  return out.sort((a, b) => a.ts - b.ts || rank(a.kind) - rank(b.kind));
}

/** at most `max` points, evenly spread; a point where the server did not answer is never dropped in favour of a good one */
export function samplePoints(rows: { ts: number; online: number; players: number }[], max: number): { ts: number; online: boolean; players: number }[] {
  const shape = (r: { ts: number; online: number; players: number }) => ({ ts: r.ts, online: !!r.online, players: r.players });
  if (rows.length <= max) return rows.map(shape);
  const out: { ts: number; online: boolean; players: number }[] = [];
  const size = rows.length / max;
  for (let k = 0; k < max; k++) {
    const part = rows.slice(Math.floor(k * size), Math.floor((k + 1) * size));
    if (!part.length) continue;
    out.push(shape(part.find((r) => !r.online) ?? part[part.length - 1]));
  }
  return out;
}
