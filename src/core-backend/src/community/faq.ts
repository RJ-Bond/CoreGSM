/**
 * Auto-answers of the bot (FAQ): the administrator writes questions with keywords and answers in the panel; the bot answers
 * /faq (with suggestions) and, when somebody mentions it in a question, the answer whose keywords fit.
 *
 *   GET|POST /api/faq, PUT|DELETE /api/faq/:id, PUT /api/settings/faq   (admin)
 *   POST /internal/faq/match, GET /internal/faq/suggest, GET /internal/faq/:id   (the bot)
 */
import type { Express, RequestHandler } from 'express';
import { z } from 'zod';
import { db, getSetting, setSetting } from '../db.js';
import { MAX_ANSWER, matchFaq, parseKeywords, type FaqEntry } from './faqLogic.js';

db.exec(`
CREATE TABLE IF NOT EXISTS faq (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  keywords TEXT NOT NULL DEFAULT '[]',
  answer TEXT NOT NULL,
  hits INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
`);

interface Row { id: number; title: string; keywords: string; answer: string; hits: number; created_at: number }
const entry = (r: Row): FaqEntry => ({ id: r.id, title: r.title, keywords: JSON.parse(r.keywords) as string[], answer: r.answer });
const all = (): FaqEntry[] => (db.prepare('SELECT * FROM faq ORDER BY id').all() as Row[]).map(entry);
export const faqEnabled = (): boolean => getSetting('faq_enabled') !== '0';

const body = z.object({ title: z.string().trim().min(2).max(100), keywords: z.string().max(1000), answer: z.string().trim().min(2).max(MAX_ANSWER) });

export function registerFaq(deps: { app: Express; admin: RequestHandler; internal: RequestHandler }): void {
  const { app, admin, internal } = deps;
  const list = () => ({ enabled: faqEnabled(), items: (db.prepare('SELECT * FROM faq ORDER BY id').all() as Row[]).map((r) => ({ ...entry(r), hits: r.hits })) });

  app.get('/api/faq', admin, (_req, res) => res.json(list()));
  app.post('/api/faq', admin, (req, res) => {
    const b = body.safeParse(req.body);
    if (!b.success) return res.status(400).json({ error: 'Вопрос — от 2 до 100 символов, ответ — от 2 до 1500' });
    if ((db.prepare('SELECT COUNT(*) AS n FROM faq').get() as { n: number }).n >= 100) return res.status(400).json({ error: 'Можно хранить не больше 100 ответов' });
    db.prepare('INSERT INTO faq (title, keywords, answer, created_at) VALUES (?, ?, ?, ?)').run(b.data.title, JSON.stringify(parseKeywords(b.data.keywords)), b.data.answer, Date.now());
    res.json(list());
  });
  app.put('/api/faq/:id', admin, (req, res) => {
    const b = body.safeParse(req.body);
    if (!b.success) return res.status(400).json({ error: 'Вопрос — от 2 до 100 символов, ответ — от 2 до 1500' });
    const r = db.prepare('UPDATE faq SET title = ?, keywords = ?, answer = ? WHERE id = ?').run(b.data.title, JSON.stringify(parseKeywords(b.data.keywords)), b.data.answer, Number(req.params.id));
    if (!r.changes) return res.status(404).json({ error: 'Не найдено' });
    res.json(list());
  });
  app.delete('/api/faq/:id', admin, (req, res) => {
    db.prepare('DELETE FROM faq WHERE id = ?').run(Number(req.params.id));
    res.json(list());
  });
  app.put('/api/settings/faq', admin, (req, res) => {
    const b = z.object({ enabled: z.boolean() }).safeParse(req.body);
    if (!b.success) return res.status(400).json({ error: 'bad body' });
    setSetting('faq_enabled', b.data.enabled ? '1' : '0');
    res.json(list());
  });

  // the bot
  app.post('/internal/faq/match', internal, (req, res) => {
    const b = z.object({ text: z.string().max(500) }).safeParse(req.body);
    if (!b.success || !faqEnabled()) return res.status(404).json({ error: 'none' });
    const e = matchFaq(b.data.text, all());
    if (!e) return res.status(404).json({ error: 'none' });
    db.prepare('UPDATE faq SET hits = hits + 1 WHERE id = ?').run(e.id);
    res.json({ id: e.id, title: e.title, answer: e.answer });
  });
  app.get('/internal/faq/suggest', internal, (req, res) => {
    const q = String(req.query.q ?? '').toLowerCase().slice(0, 60);
    const items = all()
      .filter((e) => !q || e.title.toLowerCase().includes(q) || e.keywords.some((k) => k.includes(q)))
      .slice(0, 25)
      .map((e) => ({ name: e.title.slice(0, 100), value: String(e.id) }));
    res.json({ items: faqEnabled() ? items : [] });
  });
  app.get('/internal/faq/:id', internal, (req, res) => {
    const r = db.prepare('SELECT * FROM faq WHERE id = ?').get(Number(req.params.id)) as Row | undefined;
    if (!r || !faqEnabled()) return res.status(404).json({ error: 'none' });
    db.prepare('UPDATE faq SET hits = hits + 1 WHERE id = ?').run(r.id);
    res.json({ id: r.id, title: r.title, answer: r.answer });
  });
}
