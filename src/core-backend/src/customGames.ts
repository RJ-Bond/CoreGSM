/**
 * Games without code changes: a JSON file per game in <data>/games/.
 *   GET    /api/admin/games/custom        the template, the loaded games and the files that did not pass the check
 *   PUT    /api/admin/games/custom        { text } — a game file; checked, saved as <id>.json and applied at once
 *   DELETE /api/admin/games/custom/:id    removes the file
 * The files are read at start and after every change; a broken file is reported, never breaks the others.
 */
import fs from 'node:fs';
import path from 'node:path';
import type { Express, RequestHandler } from 'express';
import { z } from 'zod';
import { DATA_DIR } from './db.js';
import { GAME_TEMPLATE, GAME_ID, parseGameFile } from './gameFileLogic.js';
import { builtinGameIds, setCustomGames, type GameProfile } from './games.js';
import { log } from './logger.js';

const DIR = path.join(DATA_DIR, 'games');
const MAX_FILE = 16 * 1024;

export interface LoadedFile { file: string; profile: GameProfile | null; errors: string[] }

export function loadCustomGames(): LoadedFile[] {
  const out: LoadedFile[] = [];
  let names: string[] = [];
  try {
    names = fs.readdirSync(DIR).filter((n) => n.endsWith('.json')).sort();
  } catch {
    /* no folder yet: no custom games */
  }
  const builtin = builtinGameIds();
  const seen = new Set<string>();
  for (const file of names) {
    try {
      const text = fs.readFileSync(path.join(DIR, file), 'utf8');
      if (text.length > MAX_FILE) throw new Error('файл больше 16 КБ');
      const r = parseGameFile(JSON.parse(text));
      if (!r.ok) { out.push({ file, profile: null, errors: r.errors }); continue; }
      if (builtin.has(r.profile.id)) { out.push({ file, profile: null, errors: [`id «${r.profile.id}» уже есть среди встроенных игр`] }); continue; }
      if (seen.has(r.profile.id)) { out.push({ file, profile: null, errors: [`id «${r.profile.id}» уже описан в другом файле`] }); continue; }
      seen.add(r.profile.id);
      out.push({ file, profile: r.profile, errors: [] });
    } catch (e) {
      out.push({ file, profile: null, errors: [`Не удалось прочитать: ${(e as Error).message}`.slice(0, 200)] });
    }
  }
  setCustomGames(out.flatMap((f) => (f.profile ? [f.profile] : [])));
  return out;
}

export function registerCustomGames({ app, admin }: { app: Express; admin: RequestHandler }): void {
  try {
    const n = loadCustomGames().filter((f) => f.profile).length;
    if (n) log.info(`custom games loaded: ${n}`);
  } catch (e) {
    log.error('custom games failed', (e as Error).message);
  }
  app.get('/api/admin/games/custom', admin, (_req, res) => res.json({ template: GAME_TEMPLATE, dir: 'games', items: loadCustomGames() }));
  app.put('/api/admin/games/custom', admin, (req, res) => {
    const b = z.object({ text: z.string().max(MAX_FILE) }).safeParse(req.body);
    if (!b.success) return res.status(400).json({ error: 'Файл игры не прошёл проверку', errors: ['Текст файла — до 16 КБ'] });
    let json: unknown;
    try {
      json = JSON.parse(b.data.text);
    } catch (e) {
      return res.status(400).json({ error: 'Файл игры не прошёл проверку', errors: [`Это не JSON: ${(e as Error).message}`.slice(0, 200)] });
    }
    const r = parseGameFile(json);
    if (!r.ok) return res.status(400).json({ error: 'Файл игры не прошёл проверку', errors: r.errors });
    if (builtinGameIds().has(r.profile.id)) return res.status(400).json({ error: 'Файл игры не прошёл проверку', errors: [`id «${r.profile.id}» уже есть среди встроенных игр`] });
    fs.mkdirSync(DIR, { recursive: true });
    fs.writeFileSync(path.join(DIR, `${r.profile.id}.json`), `${JSON.stringify(json, null, 2)}\n`);
    res.json({ items: loadCustomGames() });
  });
  app.delete('/api/admin/games/custom/:id', admin, (req, res) => {
    const id = String(req.params.id);
    if (!GAME_ID.test(id)) return res.status(400).json({ error: 'Файл игры не прошёл проверку', errors: ['Некорректный id'] });
    fs.rmSync(path.join(DIR, `${id}.json`), { force: true });
    res.json({ items: loadCustomGames() });
  });
}
