/**
 * The speed the visitors really see (real user monitoring), without anything about the person: the page sends the
 * numbers of its own load once (LCP, INP, CLS, TTFB, FCP) when it is closed or hidden; here they are kept as plain
 * samples for 14 days and summarised per page for the administrator.
 *
 *   POST /api/rum          the page's numbers; public, tiny, rate limited; 204 and nothing else
 *   GET  /api/rum/summary  per page and metric: how many samples, the 75th percentile, the share that is good (administrator)
 *
 * No address, no user agent, no account is stored. The setting rum_enabled = 0 turns the collecting off.
 */
import { percentile, rating, RUM_LIMITS, RUM_METRICS, type RumMetric } from './rumLogic.js';
import type { Express } from 'express';
import { z } from 'zod';
import { admin } from '../security/auth.js';
import { windowLimiter } from '../security/security.js';
import { db, getSetting, setSetting } from '../db.js';

const KEEP_DAYS = 14;
/** the pages the panel has; anything else is not stored */
export const RUM_ROUTES = ['servers', 'server', 'news', 'status', 'community', 'bans', 'profile', 'player', 'login', 'register', 'admin', 'other'] as const;
export { RUM_LIMITS, RUM_METRICS };
type Metric = RumMetric;

const bodySchema = z.object({
  route: z.enum(RUM_ROUTES),
  m: z.object({
    LCP: z.number().min(0).max(120_000).optional(),
    INP: z.number().min(0).max(60_000).optional(),
    CLS: z.number().min(0).max(10).optional(),
    TTFB: z.number().min(0).max(60_000).optional(),
    FCP: z.number().min(0).max(120_000).optional(),
  }),
});

export const rumEnabled = (): boolean => getSetting('rum_enabled') !== '0';

export function summarize(days: number, now = Date.now()) {
  const since = now - days * 86400_000;
  const rows = db.prepare('SELECT route, metric, value FROM rum_samples WHERE ts > ? ORDER BY route, metric, value').all(since) as { route: string; metric: Metric; value: number }[];
  const by = new Map<string, number[]>();
  for (const r of rows) {
    const k = `${r.route}|${r.metric}`;
    const a = by.get(k);
    if (a) a.push(r.value);
    else by.set(k, [r.value]);
  }
  const out: { route: string; metric: Metric; n: number; p75: number; good: number; rating: 'good' | 'needs' | 'poor' }[] = [];
  for (const [k, values] of by) {
    const [route, metric] = k.split('|') as [string, Metric];
    const p75 = percentile(values, 75) as number;
    out.push({ route, metric, n: values.length, p75, good: Math.round((values.filter((v) => rating(metric, v) === 'good').length / values.length) * 100), rating: rating(metric, p75) });
  }
  return out;
}

let lastPrune = 0;
function prune(now: number): void {
  if (now - lastPrune < 3600_000) return;
  lastPrune = now;
  db.prepare('DELETE FROM rum_samples WHERE ts < ?').run(now - KEEP_DAYS * 86400_000);
}

export function registerRum(app: Express): void {
  app.post('/api/rum', windowLimiter(30, 60_000), (req, res) => {
    // nothing is said back: a beacon has nobody to read the answer
    res.status(204).end();
    if (!rumEnabled()) return;
    const b = bodySchema.safeParse(req.body);
    if (!b.success) return;
    const now = Date.now();
    prune(now);
    const ins = db.prepare('INSERT INTO rum_samples (ts, route, metric, value) VALUES (?, ?, ?, ?)');
    db.transaction(() => {
      for (const metric of RUM_METRICS) {
        const v = b.data.m[metric];
        if (typeof v === 'number' && Number.isFinite(v)) ins.run(now, b.data.route, metric, v);
      }
    })();
  });

  app.put('/api/rum/settings', admin, (req, res) => {
    const b = z.object({ enabled: z.boolean() }).safeParse(req.body);
    if (!b.success) return res.status(400).json({ error: 'Некорректный запрос' });
    setSetting('rum_enabled', b.data.enabled ? '1' : '0');
    res.json({ enabled: rumEnabled() });
  });

  app.get('/api/rum/summary', admin, (req, res) => {
    const days = Math.min(14, Math.max(1, Number(req.query.days ?? 7) || 7));
    res.json({ enabled: rumEnabled(), days, limits: RUM_LIMITS, rows: summarize(days) });
  });
}
