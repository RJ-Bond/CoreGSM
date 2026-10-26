/** Updates of the panel: version check, changelog and requests to the host updater. */
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { admin } from '../auth.js';
import { APP_VERSION, APP_VERSION_NAME } from '../config.js';
import { wrap } from '../http.js';
import { log } from '../logger.js';
import { db, getSetting, setSetting } from '../db.js';
import { alertSettings, enqueueAlert } from '../alerts.js';
import { listBackups } from '../backup.js';
import { classifyCommit, isNoopJob, parseChangelog, parseVersion, jobKind, parseChannel, shouldAnnounce, stageOf, type Channel, type CommitFlag, type CommitKind } from '../updateLogic.js';

export const router = express.Router();

// ---------- updates ----------
// The container never touches Docker or the host. "Update" drops a request file into UPDATE_DIR (a bind mount);
// a root systemd path unit on the host notices it and runs `coregsm-update`, which reports progress in status.json.
const UPDATE_DIR = process.env.UPDATE_DIR ?? '';
const UPDATE_BASE = process.env.UPDATE_BASE_URL ?? 'https://raw.githubusercontent.com/RJ-Bond/CoreGSM/refs/heads/main';
// The same channel as the host updater (tools/coregsm.sh): the newest GitHub Release first, the tip of the branch when
// there is no release yet. A custom UPDATE_BASE_URL (a fork, a test branch) or UPDATE_CHANNEL=main skips the release.
const RELEASE_DEFAULT = process.env.UPDATE_RELEASE_BASE_URL ?? 'https://github.com/RJ-Bond/CoreGSM/releases/latest/download';
// the channel can be chosen in the panel unless the server pins it through the environment
const CHANNEL_LOCKED = process.env.UPDATE_RELEASE_BASE_URL !== undefined || !!process.env.UPDATE_BASE_URL || !!process.env.UPDATE_CHANNEL;
const channel = (): Channel => (process.env.UPDATE_CHANNEL === 'main' || process.env.UPDATE_BASE_URL ? 'main' : parseChannel(getSetting('update_channel')));
const releaseBase = (): string => (process.env.UPDATE_RELEASE_BASE_URL !== undefined ? process.env.UPDATE_RELEASE_BASE_URL : channel() === 'main' ? '' : RELEASE_DEFAULT);

let remote: { build: string | null; label: string | null; error: string | null; at: number; builtAt: number | null } = { build: null, label: null, error: null, at: 0, builtAt: null };

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

/** version.txt of the newest release, or null when there is none (or it does not look right) */
async function fetchReleaseVersion(): Promise<string | null> {
  const base = releaseBase();
  if (!base) return null;
  try {
    const r = await fetch(`${base}/version.txt`, { signal: AbortSignal.timeout(8000), headers: { 'User-Agent': 'CoreGSM' } });
    if (!r.ok) return null;
    const text = await r.text();
    return /^build=[a-f0-9]{6,64}$/m.test(text) && /^sha256=[a-f0-9]{64}$/m.test(text) ? text : null;
  } catch {
    return null;
  }
}

/** when version.txt last changed in the repository (best effort: the GitHub API may be out of reach) */
async function fetchBuiltAt(): Promise<number | null> {
  const m = /^https:\/\/raw\.githubusercontent\.com\/([^/]+)\/([^/]+)\/(?:refs\/heads\/)?([^/]+)\/?$/.exec(UPDATE_BASE);
  if (!m) return null;
  try {
    const r = await fetch(`${GITHUB_API}/repos/${m[1]}/${m[2]}/commits?path=version.txt&per_page=1&sha=${encodeURIComponent(m[3])}`, { signal: AbortSignal.timeout(8000), headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'CoreGSM' } });
    if (!r.ok) return null;
    const list = (await r.json()) as { commit?: { committer?: { date?: string } } }[];
    const d = Date.parse(list[0]?.commit?.committer?.date ?? '');
    return Number.isNaN(d) ? null : d;
  } catch {
    return null;
  }
}

async function checkRemote(force = false): Promise<void> {
  if (!force && Date.now() - remote.at < 5 * 60_000) return;
  try {
    const text = (await fetchReleaseVersion()) ?? (await fetchRepoText('version.txt'));
    const m = /^build=([a-f0-9]{6,64})$/m.exec(text);
    if (!m) throw new Error('некорректный version.txt');
    const label = /^version=(\d+(?:\.\d+){1,4})$/m.exec(text)?.[1] ?? null;
    if (label) rememberLabel(m[1]!, label);
    const builtAt = m[1] === remote.build && remote.builtAt ? remote.builtAt : await fetchBuiltAt();
    remote = { build: m[1]!, label, error: null, at: Date.now(), builtAt };
    announceVersion();
  } catch (e) {
    remote = { build: remote.build, label: remote.label, error: `Не удалось проверить обновления: ${(e as Error).message}`, at: Date.now(), builtAt: remote.builtAt };
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
    currentLabel: labelOf(APP_VERSION),
    latestLabel: remote.label,
    available: !!(APP_VERSION && remote.build && APP_VERSION !== remote.build),
    checkedAt: remote.at || null,
    error: remote.error,
    canApply: dirOk,
    pending: dirOk && fs.existsSync(updateFile('request')),
    // the host manager keeps the previous version and says so in status.json
    canRollback: dirOk && job?.rollback_available === true,
    job,
    stage: stageOf(job),
    latestAt: remote.builtAt,
    installedAt: installedAt(),
    channel: channel(),
    channelLocked: CHANNEL_LOCKED,
    skipped: !!remote.build && getSetting('update_skip') === remote.build,
    notify: getSetting('update_notify') !== '0',
  };
}

// ---- readable versions: the running build knows its own name (APP_VERSION_NAME); the others are learned from version.txt
db.exec('CREATE TABLE IF NOT EXISTS build_labels (build TEXT PRIMARY KEY, label TEXT NOT NULL)');
function rememberLabel(build: string, label: string): void {
  if (parseVersion(label)) db.prepare('INSERT OR REPLACE INTO build_labels (build, label) VALUES (?, ?)').run(build, label);
}
if (APP_VERSION && APP_VERSION_NAME) rememberLabel(APP_VERSION, APP_VERSION_NAME);
function labelOf(build: string | null | undefined): string | null {
  if (!build) return null;
  if (build === APP_VERSION && APP_VERSION_NAME) return APP_VERSION_NAME;
  return (db.prepare('SELECT label FROM build_labels WHERE build = ?').get(build) as { label: string } | undefined)?.label ?? null;
}

// ---- history of the host jobs, and the notices about them
db.exec(`
CREATE TABLE IF NOT EXISTS update_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_time INTEGER NOT NULL UNIQUE,
  state TEXT NOT NULL,
  kind TEXT NOT NULL,
  message TEXT NOT NULL,
  version TEXT,
  at INTEGER NOT NULL
);
`);

interface HistoryRow { id: number; job_time: number; state: string; kind: string; message: string; version: string | null; at: number }

/** when the running build was installed by the panel (null: not known, e.g. installed by hand) */
function installedAt(): number | null {
  if (!APP_VERSION) return null;
  const r = db.prepare("SELECT job_time FROM update_history WHERE state = 'done' AND kind = 'update' AND version = ? ORDER BY job_time DESC LIMIT 1").get(APP_VERSION) as { job_time: number } | undefined;
  return r?.job_time ?? null;
}

function readJob(): { state: string; message: string; time: number; progress?: number } | null {
  try {
    return JSON.parse(fs.readFileSync(updateFile('status.json'), 'utf8'));
  } catch {
    return null;
  }
}

/** the alerts channel of the administrators gets the notice, when it is set up */
function announce(title: string, description: string, color: number): void {
  if (getSetting('update_notify') === '0') return;
  const s = alertSettings();
  if (!s.enabled || !s.channelId) return;
  try {
    enqueueAlert('update', '', { content: '', mention: 'none', embed: { title, description, color, timestamp: new Date().toISOString() } });
  } catch (e) {
    log.warn('update notice failed:', (e as Error).message);
  }
}

function announceVersion(): void {
  if (!shouldAnnounce({ notify: getSetting('update_notify') !== '0', available: !!(APP_VERSION && remote.build && APP_VERSION !== remote.build), latest: remote.build, announced: getSetting('update_announced'), skipped: getSetting('update_skip') })) return;
  setSetting('update_announced', remote.build);
  announce('Доступно обновление панели', `Версия \`${remote.label ?? (remote.build ?? '').slice(0, 7)}\`. Установить: Настройки → Обновления и копии.`, 0x5865f2);
}

/** writes a finished job into the history once; the first run on an old database only fills it in silently */
export function recordJob(): void {
  const job = readJob();
  if (!job || (job.state !== 'done' && job.state !== 'error') || isNoopJob(job.message)) return;
  if (db.prepare('SELECT 1 FROM update_history WHERE job_time = ?').get(job.time)) return;
  const first = (db.prepare('SELECT COUNT(*) AS n FROM update_history').get() as { n: number }).n === 0;
  const kind = jobKind(job.message);
  const now = Date.now();
  db.prepare('INSERT INTO update_history (job_time, state, kind, message, version, at) VALUES (?, ?, ?, ?, ?, ?)').run(job.time, job.state, kind, job.message.slice(0, 500), APP_VERSION || null, now);
  db.prepare('DELETE FROM update_history WHERE id NOT IN (SELECT id FROM update_history ORDER BY job_time DESC LIMIT 100)').run();
  if (first || now - job.time > 6 * 3600_000) return;
  if (job.state === 'error') announce('Обновление панели не удалось', job.message, 0xf23f42);
  else if (kind === 'rollback') announce('Откат панели выполнен', job.message, 0xf0b232);
  else announce('Панель обновлена', job.message, 0x23a55a);
}

setTimeout(() => { try { recordJob(); } catch { /* the table is not ready yet */ } }, 3000).unref();
setInterval(() => { try { recordJob(); } catch (e) { log.warn('update history failed:', (e as Error).message); } }, 30_000).unref();

router.get('/api/update/history', admin, (_req, res) => {
  recordJob();
  const rows = db.prepare('SELECT * FROM update_history ORDER BY job_time DESC LIMIT 30').all() as HistoryRow[];
  res.json(rows.map((r) => ({ id: r.id, time: r.job_time, state: r.state, kind: r.kind, message: r.message, version: r.version, label: labelOf(r.version) })));
});

// what an update would interrupt: players online now and the age of the last backup
router.get('/api/update/preflight', admin, (_req, res) => {
  const r = db.prepare('SELECT COUNT(*) AS servers, COALESCE(SUM(players), 0) AS players FROM status WHERE online = 1').get() as { servers: number; players: number };
  const last = listBackups().reduce((m, b) => Math.max(m, b.createdAt), 0);
  res.json({ onlineServers: r.servers, players: r.players, lastBackupAt: last || null });
});

router.put('/api/update/settings', admin, (req, res) => {
  const b = (req.body ?? {}) as { channel?: unknown; skip?: unknown; notify?: unknown };
  if (b.channel !== undefined) {
    if (CHANNEL_LOCKED) return res.status(409).json({ error: 'Канал задан переменными окружения сервера' });
    if (b.channel !== 'release' && b.channel !== 'main') return res.status(400).json({ error: 'Канал: release или main' });
    setSetting('update_channel', b.channel);
    // the host updater reads the same choice from the shared folder
    if (UPDATE_DIR && fs.existsSync(UPDATE_DIR)) { try { fs.writeFileSync(updateFile('channel'), b.channel); } catch { /* the folder is read-only */ } }
    remote = { ...remote, at: 0 };
  }
  if (b.skip !== undefined) {
    if (b.skip !== null && (typeof b.skip !== 'string' || !/^[a-f0-9]{6,64}$/.test(b.skip))) return res.status(400).json({ error: 'Некорректная версия' });
    setSetting('update_skip', b.skip);
  }
  if (b.notify !== undefined) setSetting('update_notify', b.notify === false ? '0' : '1');
  res.json(updatePayload());
});

// ---- changelog: the last commits of the repository the panel updates from
const GITHUB_API = (process.env.GITHUB_API_URL ?? 'https://api.github.com').replace(/\/+$/, '');
interface ChangelogItem { sha: string; title: string; date: number | null; url: string; kind: CommitKind; flags: CommitFlag[] }
let changelog: { at: number; items: ChangelogItem[]; error: string | null } | null = null;

function commitsUrl(): string | null {
  const m = /^https:\/\/raw\.githubusercontent\.com\/([^/]+)\/([^/]+)\/(?:refs\/heads\/)?([^/]+)\/?$/.exec(UPDATE_BASE);
  return m ? `${GITHUB_API}/repos/${m[1]}/${m[2]}/commits?per_page=30&sha=${encodeURIComponent(m[3])}` : null;
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
    const items = list.slice(0, 30).map((c) => {
      const d = Date.parse(c.commit?.committer?.date ?? c.commit?.author?.date ?? '');
      const msg = String(c.commit?.message ?? '');
      return { sha: String(c.sha ?? ''), title: commitTitle(msg), date: Number.isNaN(d) ? null : d, url: String(c.html_url ?? ''), ...classifyCommit(msg) };
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
  log.info('update requested from the panel');
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
  log.info('rollback requested from the panel');
  res.status(202).json(updatePayload());
});

// ---- release notes: CHANGELOG.md of the repository (Russian, written by hand); the commits are the fallback
let notes: { at: number; releases: ReturnType<typeof parseChangelog>; error: string | null } | null = null;
router.get(
  '/api/update/notes',
  admin,
  wrap(async (_req, res) => {
    if (!notes || Date.now() - notes.at > (notes.error ? 60_000 : 10 * 60_000)) {
      try {
        notes = { at: Date.now(), releases: parseChangelog(await fetchRepoText('CHANGELOG.md')).slice(0, 12), error: null };
      } catch (e) {
        notes = { at: Date.now(), releases: notes?.releases ?? [], error: (e as Error).message };
      }
    }
    res.json({ releases: notes.releases, error: notes.error });
  }),
);
