/**
 * Community rules with a history and the players' consent.
 *   GET  /api/rules/me        the current rules and whether the signed-in user has agreed to this version
 *   POST /api/rules/agree     the signed-in user agrees to the current version
 *   GET  /api/rules/history   (admin) every version, how many agreed, how many players there are
 * The text itself stays in the setting `rules_text` (the panel, the Discord command and the export read it); every change
 * of it becomes a new version here, so older consents are not mistaken for consent to the new text.
 */
import type { Express, RequestHandler } from 'express';
import { type AuthedRequest } from './auth.js';
import { db, getSetting } from './db.js';
import { needsAgreement, nextRulesVersion, type RulesVersion } from './rulesLogic.js';

db.exec(`
CREATE TABLE IF NOT EXISTS rules_versions (
  version INTEGER PRIMARY KEY,
  text TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS rules_consent (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  agreed_at INTEGER NOT NULL,
  via TEXT NOT NULL DEFAULT 'web',
  PRIMARY KEY (user_id, version)
);
`);

const latest = (): RulesVersion | null => (db.prepare('SELECT version, text FROM rules_versions ORDER BY version DESC LIMIT 1').get() as RulesVersion | undefined) ?? null;

/** the current rules: a text set anywhere (the panel, an import, an older version) becomes a version here at once */
export function currentRules(): RulesVersion | null {
  const text = (getSetting('rules_text') ?? '').trim();
  if (!text) return null;
  const l = latest();
  const n = nextRulesVersion(l, text);
  if (n === null) return l;
  db.prepare('INSERT INTO rules_versions (version, text, created_at) VALUES (?, ?, ?)').run(n, text, Date.now());
  return { version: n, text };
}

export function recordConsent(userId: number, via: 'web' | 'discord' | 'panel'): void {
  const c = currentRules();
  if (!c) return;
  db.prepare('INSERT OR IGNORE INTO rules_consent (user_id, version, agreed_at, via) VALUES (?, ?, ?, ?)').run(userId, c.version, Date.now(), via);
}

const agreedVersion = (userId: number): number | null =>
  ((db.prepare('SELECT MAX(version) AS v FROM rules_consent WHERE user_id = ?').get(userId) as { v: number | null }).v) ?? null;

export function registerRules({ app, auth, admin }: { app: Express; auth: RequestHandler; admin: RequestHandler }): void {
  app.get('/api/rules/me', auth, (req: AuthedRequest, res) => {
    const c = currentRules();
    if (!c) return res.json({ version: null, text: '', agreed: true });
    res.json({ version: c.version, text: c.text, agreed: !needsAgreement(c.version, agreedVersion(req.user!.id)) });
  });
  app.post('/api/rules/agree', auth, (req: AuthedRequest, res) => {
    recordConsent(req.user!.id, 'panel');
    const c = currentRules();
    res.json({ version: c?.version ?? null, agreed: true });
  });
  app.get('/api/rules/history', admin, (_req, res) => {
    const c = currentRules();
    const agreedBy = new Map((db.prepare('SELECT version, COUNT(*) AS n FROM rules_consent GROUP BY version').all() as { version: number; n: number }[]).map((r) => [r.version, r.n]));
    const versions = (db.prepare('SELECT version, text, created_at FROM rules_versions ORDER BY version DESC').all() as { version: number; text: string; created_at: number }[]).map((v) => ({
      version: v.version,
      text: v.text,
      createdAt: v.created_at,
      agreed: agreedBy.get(v.version) ?? 0,
    }));
    const players = (db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'player' AND status = 'active'").get() as { n: number }).n;
    res.json({ current: c?.version ?? null, versions, players });
  });
}
