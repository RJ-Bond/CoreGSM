/**
 * The calendar of the community as a feed for any calendar program (Google Calendar, Apple, Thunderbird):
 *   GET /api/events.ics   the news with a countdown that is still ahead (events, wipes) and the planned maintenance
 * Whoever may open the panel may subscribe (a closed panel: the feed needs a sign-in, which a calendar program cannot give).
 * Repeating maintenance windows are not unrolled: only windows that have no repeat are listed.
 */
import type { Express } from 'express';
import { db } from '../db.js';
import { viewer } from '../security/auth.js';
import { publicBase } from '../admin/site.js';

export interface CalEvent { uid: string; start: number; end: number; summary: string; description?: string; url?: string }

const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
const stamp = (ms: number) => new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');

/** a content line cut into pieces of at most 75 bytes; a continuation starts with a space (RFC 5545) */
export function fold(line: string): string {
  const out: string[] = [];
  let cur = '';
  let bytes = 0;
  for (const ch of line) {
    const n = Buffer.byteLength(ch);
    if (bytes + n > (out.length ? 74 : 75)) { out.push(cur); cur = ''; bytes = 0; }
    cur += ch;
    bytes += n;
  }
  out.push(cur);
  return out.join('\r\n ');
}

/** the text of the calendar: events in the order of their start */
export function buildIcs(events: CalEvent[], now: number, name: string): string {
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//CoreGSM//events//EN', 'CALSCALE:GREGORIAN', `X-WR-CALNAME:${esc(name)}`];
  for (const e of [...events].sort((a, b) => a.start - b.start)) {
    lines.push('BEGIN:VEVENT', `UID:${e.uid}`, `DTSTAMP:${stamp(now)}`, `DTSTART:${stamp(e.start)}`, `DTEND:${stamp(Math.max(e.end, e.start + 60_000))}`, `SUMMARY:${esc(e.summary)}`);
    if (e.description) lines.push(`DESCRIPTION:${esc(e.description)}`);
    if (e.url) lines.push(`URL:${e.url}`);
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return `${lines.map(fold).join('\r\n')}\r\n`;
}

export function upcomingEvents(now: number): CalEvent[] {
  const base = publicBase() ?? '';
  const out: CalEvent[] = [];
  const news = db
    .prepare(
      `SELECT id, payload FROM news WHERE test = 0 AND status IN ('sent', 'edit_queued')
       AND CAST(json_extract(payload, '$.countdownAt') AS INTEGER) > ? LIMIT 100`,
    )
    .all(now) as { id: number; payload: string }[];
  for (const n of news) {
    try {
      const p = JSON.parse(n.payload) as { countdownAt?: number; countdownLabel?: string; embed?: { title?: string; description?: string } };
      if (typeof p.countdownAt !== 'number') continue;
      out.push({
        uid: `news-${n.id}@coregsm`,
        start: p.countdownAt,
        end: p.countdownAt + 3_600_000,
        summary: p.countdownLabel || p.embed?.title || 'Событие',
        description: (p.embed?.description ?? '').slice(0, 300),
        url: base ? `${base}/news/${n.id}` : undefined,
      });
    } catch { /* a broken payload is skipped */ }
  }
  const works = db
    .prepare(
      `SELECT m.id, m.name, m.start_ts, m.end_ts, s.name AS server FROM maintenance_windows m LEFT JOIN servers s ON s.id = m.server_id
       WHERE m.repeat = 'none' AND m.end_ts > ? LIMIT 100`,
    )
    .all(now) as { id: number; name: string; start_ts: number; end_ts: number; server: string | null }[];
  for (const w of works) out.push({ uid: `maint-${w.id}@coregsm`, start: w.start_ts, end: w.end_ts, summary: `Работы: ${w.name || 'обслуживание'}${w.server ? ` (${w.server})` : ''}`, url: base ? `${base}/news` : undefined });
  return out;
}

export function registerCalendar(app: Express): void {
  app.get('/api/events.ics', viewer, (_req, res) => {
    const now = Date.now();
    res.set('Content-Type', 'text/calendar; charset=utf-8').set('Cache-Control', 'public, max-age=300').send(buildIcs(upcomingEvents(now), now, 'CoreGSM: события'));
  });
}
