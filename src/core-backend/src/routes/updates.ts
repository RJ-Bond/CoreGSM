/** Updates of the panel: version check, changelog and requests to the host updater. */
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { admin } from '../auth.js';
import { APP_VERSION } from '../config.js';
import { wrap } from '../http.js';

export const router = express.Router();

// ---------- updates ----------
// The container never touches Docker or the host. "Update" drops a request file into UPDATE_DIR (a bind mount);
// a root systemd path unit on the host notices it and runs `coregsm-update`, which reports progress in status.json.
const UPDATE_DIR = process.env.UPDATE_DIR ?? '';
const UPDATE_BASE = process.env.UPDATE_BASE_URL ?? 'https://raw.githubusercontent.com/RJ-Bond/CoreGSM/refs/heads/main';

let remote: { build: string | null; error: string | null; at: number } = { build: null, error: null, at: 0 };

/** raw.githubusercontent.com is cached for minutes after a push; the GitHub API returns the file as it is now. */
function repoApiUrl(file: string): string | null {
  const m = /^https:\/\/raw\.githubusercontent\.com\/([^/]+)\/([^/]+)\/(?:refs\/heads\/)?([^/]+)\/?$/.exec(UPDATE_BASE);
  return m ? `https://api.github.com/repos/${m[1]}/${m[2]}/contents/${file}?ref=${m[3]}` : null;
}

async function fetchRepoText(file: string): Promise<string> {
  const api = repoApiUrl(file);
  if (api) {
    try {
      const r = await fetch(api, { signal: AbortSignal.timeout(8000), headers: { Accept: 'application/vnd.github.raw+json', 'User-Agent': 'CoreGSM' } });
      if (r.ok) return await r.text();
    } catch {
      /* rate limit or no route: fall back to the plain file below */
    }
  }
  const res = await fetch(`${UPDATE_BASE}/${file}?t=${Date.now()}`, { signal: AbortSignal.timeout(8000), headers: { 'cache-control': 'no-cache' } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

async function checkRemote(force = false): Promise<void> {
  if (!force && Date.now() - remote.at < 5 * 60_000) return;
  try {
    const m = /^build=([a-f0-9]{6,64})$/m.exec(await fetchRepoText('version.txt'));
    if (!m) throw new Error('некорректный version.txt');
    remote = { build: m[1], error: null, at: Date.now() };
  } catch (e) {
    remote = { build: remote.build, error: `Не удалось проверить обновления: ${(e as Error).message}`, at: Date.now() };
  }
}

function updateFile(name: string): string {
  return path.join(UPDATE_DIR, name);
}

function updatePayload() {
  // progress: 0..100 written by the manager/installer while an update runs (absent in older managers)
  let job: { state: string; message: string; time: number; rollback_available?: boolean; progress?: number } | null = null;
  try {
    job = JSON.parse(fs.readFileSync(updateFile('status.json'), 'utf8'));
  } catch {
    /* no update has run yet */
  }
  const dirOk = !!UPDATE_DIR && fs.existsSync(UPDATE_DIR);
  return {
    current: APP_VERSION || null,
    latest: remote.build,
    available: !!(APP_VERSION && remote.build && APP_VERSION !== remote.build),
    checkedAt: remote.at || null,
    error: remote.error,
    canApply: dirOk,
    pending: dirOk && fs.existsSync(updateFile('request')),
    // the host manager keeps the previous version and says so in status.json
    canRollback: dirOk && job?.rollback_available === true,
    job,
  };
}

// ---- changelog: the last commits of the repository the panel updates from
const GITHUB_API = (process.env.GITHUB_API_URL ?? 'https://api.github.com').replace(/\/+$/, '');
interface ChangelogItem { sha: string; title: string; date: number | null; url: string }
let changelog: { at: number; items: ChangelogItem[]; error: string | null } | null = null;

function commitsUrl(): string | null {
  const m = /^https:\/\/raw\.githubusercontent\.com\/([^/]+)\/([^/]+)\/(?:refs\/heads\/)?([^/]+)\/?$/.exec(UPDATE_BASE);
  return m ? `${GITHUB_API}/repos/${m[1]}/${m[2]}/commits?per_page=15&sha=${encodeURIComponent(m[3])}` : null;
}

/** first line of the message without "Co-Authored-By" trailers */
const commitTitle = (msg: string): string =>
  msg
    .split(/\r?\n/)
    .filter((l) => !/^co-authored-by:/i.test(l.trim()))[0]
    ?.trim()
    .slice(0, 200) ?? '';

async function loadChangelog(): Promise<{ items: ChangelogItem[]; error?: string }> {
  if (changelog && Date.now() - changelog.at < (changelog.error ? 60_000 : 10 * 60_000)) {
    return changelog.error ? { items: changelog.items, error: changelog.error } : { items: changelog.items };
  }
  const url = commitsUrl();
  try {
    if (!url) throw new Error('адрес репозитория обновлений не распознан');
    const r = await fetch(url, { signal: AbortSignal.timeout(8000), headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'CoreGSM' } });
    if (!r.ok) throw new Error(`GitHub ответил HTTP ${r.status}`);
    const list = (await r.json()) as { sha?: string; html_url?: string; commit?: { message?: string; committer?: { date?: string }; author?: { date?: string } } }[];
    if (!Array.isArray(list)) throw new Error('неожиданный ответ GitHub');
    const items = list.slice(0, 15).map((c) => {
      const d = Date.parse(c.commit?.committer?.date ?? c.commit?.author?.date ?? '');
      return { sha: String(c.sha ?? ''), title: commitTitle(String(c.commit?.message ?? '')), date: Number.isNaN(d) ? null : d, url: String(c.html_url ?? '') };
    });
    changelog = { at: Date.now(), items, error: null };
    return { items };
  } catch (e) {
    const error = `Не удалось получить список изменений: ${(e as Error).message}`;
    changelog = { at: Date.now(), items: changelog?.items ?? [], error };
    return { items: changelog.items, error };
  }
}

router.get(
  '/api/update/changelog',
  admin,
  wrap(async (_req, res) => {
    res.json(await loadChangelog());
  }),
);

router.get(
  '/api/update/status',
  admin,
  wrap(async (_req, res) => {
    await checkRemote();
    res.json(updatePayload());
  }),
);

router.post(
  '/api/update/check',
  admin,
  wrap(async (_req, res) => {
    await checkRemote(true);
    res.json(updatePayload());
  }),
);

router.post('/api/update/apply', admin, (_req, res) => {
  const state = updatePayload();
  if (!state.canApply) return res.status(503).json({ error: 'Обновление из панели не настроено на сервере. Выполните: sudo coregsm update' });
  if (state.job?.state === 'running') return res.status(409).json({ error: 'Обновление уже выполняется' });
  try {
    fs.writeFileSync(updateFile('request'), String(Date.now()));
  } catch {
    return res.status(500).json({ error: 'Не удалось создать запрос на обновление (нет прав на папку /app/update)' });
  }
  console.log('update requested from the panel');
  res.status(202).json(updatePayload());
});

// same request file, different word: the host manager reads it and restores the previous version
router.post('/api/update/rollback', admin, (_req, res) => {
  const state = updatePayload();
  if (!state.canApply) return res.status(503).json({ error: 'Откат из панели не настроен на сервере. Выполните: sudo coregsm rollback' });
  if (state.job?.state === 'running') return res.status(409).json({ error: 'Сейчас выполняется обновление или откат' });
  if (!state.canRollback) return res.status(409).json({ error: 'Откат недоступен: предыдущая версия не сохранена' });
  if (state.pending) return res.status(409).json({ error: 'Запрос уже ожидает выполнения' });
  try {
    fs.writeFileSync(updateFile('request'), 'rollback');
  } catch {
    return res.status(500).json({ error: 'Не удалось создать запрос на откат (нет прав на папку /app/update)' });
  }
  console.log('rollback requested from the panel');
  res.status(202).json(updatePayload());
});
