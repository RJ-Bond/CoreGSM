/**
 * Full backups of the panel: archive format, schedule, off-host copy, staged restore.
 *
 * Archive (.tar.gz) layout:
 *   coregsm.db           consistent snapshot of the database (SQLite online backup)
 *   news/<24hex>.<ext>   pictures uploaded in the news editor
 *   brand-logo.<ext>     custom logo (if any)
 *   manifest.json        { createdAt, version, files }
 *
 * Encrypted archive (.tar.gz.enc), written when the "backup_passphrase" setting is set:
 *   offset 0   8 bytes   magic "CGSMENC1"
 *   offset 8   16 bytes  scrypt salt
 *   offset 24  12 bytes  AES-GCM IV (nonce)
 *   offset 36  ...       ciphertext of the whole .tar.gz (AES-256-GCM, header bytes 0..35 are the AAD)
 *   last 16    16 bytes  GCM authentication tag
 * The 32-byte key is scrypt(passphrase, salt, N=32768, r=8, p=1).
 *
 * Restoring never touches the live database: the archive is unpacked and validated into
 * <DATA_DIR>/restore-pending/ and the swap happens at the next start (see db.ts), after which the process exits
 * and the container restarts.
 */
import type { Express, RequestHandler, Request, Response, NextFunction } from 'express';
import Database from 'better-sqlite3';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { once } from 'node:events';
import * as tar from 'tar';
import { z } from 'zod';
import { DATA_DIR, db, getSetting, setSetting } from '../db.js';
import { canDecrypt, isEncrypted, isSecretKey } from '../security/secrets.js';
import { log } from '../logger.js';
import { s3Problem, type S3Target } from './s3.js';
import { BackupError } from './backupError.js';
import { decryptFile, encryptFile, MAGIC } from './backupCrypto.js';
import { lastRemote, lastS3, uploadRemote, uploadS3 } from './backupRemote.js';

// the old import paths keep working
export { BackupError } from './backupError.js';
export { decryptFile, encryptFile } from './backupCrypto.js';
export { lastRemote, lastS3, uploadRemote, uploadS3, type RemoteResult } from './backupRemote.js';

export const BACKUP_DIR = path.join(DATA_DIR, 'backups');
const PENDING_DIR = path.join(DATA_DIR, 'restore-pending');
const MAX_UPLOAD = 300 * 1024 * 1024;
const MAX_UNPACKED = 2 * 1024 * 1024 * 1024;
const NAME_RE = /^coregsm-(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})-(auto|manual)\.tar\.gz(\.enc)?$/;
const ALLOWED_ENTRY = /^(coregsm\.db|manifest\.json|brand-logo\.(png|jpg|webp)|news|news\/[a-f0-9]{24}\.(png|jpg|gif|webp)|covers|covers\/\d{1,9}(@s)?\.jpg|avatars|avatars\/\d{1,9}\.png|banners|banners\/\d{1,9}\.jpg|gallery|gallery\/\d{1,9}(@s)?\.jpg)$/;
const DIR_ENTRIES = new Set(['news', 'covers', 'avatars', 'banners', 'gallery']);

// ---------- settings ----------
export type Schedule = 'off' | 'daily' | 'weekly';
export const backupSettings = () => {
  const sch = getSetting('backup_schedule');
  const keep = Number(getSetting('backup_keep'));
  return {
    schedule: (sch === 'daily' || sch === 'weekly' ? sch : 'off') as Schedule,
    keep: Number.isInteger(keep) && keep >= 1 && keep <= 30 ? keep : 7,
    remoteUrl: getSetting('backup_remote_url') || null,
    passphrase: getSetting('backup_passphrase') || null,
    s3: s3Settings(),
  };
};

/** S3-compatible storage: null until the endpoint, bucket and both keys are set */
export function s3Settings(): S3Target | null {
  const t: S3Target = {
    endpoint: getSetting('backup_s3_endpoint') || '',
    bucket: getSetting('backup_s3_bucket') || '',
    region: getSetting('backup_s3_region') || 'us-east-1',
    prefix: getSetting('backup_s3_prefix') || '',
    accessKey: getSetting('backup_s3_key') || '',
    secretKey: getSetting('backup_s3_secret') || '',
  };
  return t.endpoint && t.bucket && t.accessKey && t.secretKey ? t : null;
}

/** https://user:pass@host/path?token -> https://host/…  (nothing secret is returned to the panel) */
export function maskUrl(u: string | null): string | null {
  if (!u) return null;
  try {
    return `${new URL(u).origin}/…`;
  } catch {
    return '***';
  }
}

// ---------- names, listing ----------
const two = (n: number) => String(n).padStart(2, '0');
const stamp = (d: Date) => `${d.getUTCFullYear()}${two(d.getUTCMonth() + 1)}${two(d.getUTCDate())}-${two(d.getUTCHours())}${two(d.getUTCMinutes())}${two(d.getUTCSeconds())}`;

export interface BackupItem {
  name: string;
  size: number;
  createdAt: number;
  kind: 'auto' | 'manual';
}

export function listBackups(): BackupItem[] {
  if (!fs.existsSync(BACKUP_DIR)) return [];
  const out: BackupItem[] = [];
  for (const name of fs.readdirSync(BACKUP_DIR)) {
    const m = NAME_RE.exec(name);
    if (!m) continue;
    try {
      out.push({ name, size: fs.statSync(path.join(BACKUP_DIR, name)).size, createdAt: Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]), kind: m[7] as 'auto' | 'manual' });
    } catch {
      /* removed meanwhile */
    }
  }
  return out.sort((a, b) => b.createdAt - a.createdAt || (a.name < b.name ? 1 : -1));
}

export const isBackupName = (n: string) => NAME_RE.test(n);

/** keeps the newest `keep` automatic and the newest `keep` manual archives */
export function pruneBackups(keep: number): string[] {
  const removed: string[] = [];
  for (const kind of ['auto', 'manual'] as const) {
    for (const it of listBackups().filter((i) => i.kind === kind).slice(keep)) {
      fs.rmSync(path.join(BACKUP_DIR, it.name), { force: true });
      removed.push(it.name);
    }
  }
  return removed;
}

/** pure schedule rule: daily = 23 h since the last automatic archive, weekly = 6.9 days */
export function backupDue(schedule: Schedule, lastAutoAt: number | null, now: number): boolean {
  if (schedule === 'off') return false;
  if (lastAutoAt == null) return true;
  return now - lastAutoAt >= (schedule === 'daily' ? 23 * 3600_000 : 6.9 * 86400_000);
}

// ---------- creating an archive ----------
const rmrf = (p: string) => fs.rmSync(p, { recursive: true, force: true });
const newsDir = path.join(DATA_DIR, 'news');

/** Builds a .tar.gz (encrypted when a passphrase is given) at `dest` (the caller picks the final name). */
export async function buildArchive(dest: string, passphrase: string | null): Promise<void> {
  const stage = fs.mkdtempSync(path.join(DATA_DIR, '.backup-stage-'));
  const plain = `${dest}.part`;
  try {
    await db.backup(path.join(stage, 'coregsm.db'));
    const files = ['coregsm.db'];
    const entries = ['coregsm.db', 'manifest.json'];
    if (fs.existsSync(newsDir)) {
      fs.mkdirSync(path.join(stage, 'news'));
      for (const f of fs.readdirSync(newsDir)) {
        if (!/^[a-f0-9]{24}\.(png|jpg|gif|webp)$/.test(f)) continue;
        // news pictures never change after upload: a hard link costs nothing (copy when the volumes differ)
        try {
          fs.linkSync(path.join(newsDir, f), path.join(stage, 'news', f));
        } catch {
          fs.copyFileSync(path.join(newsDir, f), path.join(stage, 'news', f));
        }
        files.push(`news/${f}`);
      }
      entries.push('news');
    }
    for (const [dir, re] of [
      ['covers', /^\d{1,9}(@s)?\.jpg$/],
      ['avatars', /^\d{1,9}\.png$/],
      ['banners', /^\d{1,9}\.jpg$/],
      ['gallery', /^\d{1,9}(@s)?\.jpg$/],
    ] as const) {
      const src = path.join(DATA_DIR, dir);
      if (!fs.existsSync(src)) continue;
      fs.mkdirSync(path.join(stage, dir));
      for (const f of fs.readdirSync(src)) {
        if (!re.test(f)) continue;
        fs.copyFileSync(path.join(src, f), path.join(stage, dir, f));
        files.push(`${dir}/${f}`);
      }
      entries.push(dir);
    }
    for (const f of fs.readdirSync(DATA_DIR)) {
      if (/^brand-logo\.(png|jpg|webp)$/.test(f)) {
        fs.copyFileSync(path.join(DATA_DIR, f), path.join(stage, f));
        files.push(f);
        entries.push(f);
      }
    }
    fs.writeFileSync(path.join(stage, 'manifest.json'), JSON.stringify({ createdAt: new Date().toISOString(), version: process.env.APP_VERSION || null, files }, null, 2));
    await tar.c({ gzip: true, file: plain, cwd: stage, portable: true }, entries);
    if (passphrase) {
      await encryptFile(plain, dest, passphrase);
      rmrf(plain);
    } else {
      fs.renameSync(plain, dest);
    }
    try {
      fs.chmodSync(dest, 0o600);
    } catch {
      /* not supported on this file system */
    }
  } catch (e) {
    rmrf(plain);
    rmrf(dest);
    throw e;
  } finally {
    rmrf(stage);
  }
}

let busy = false;

/** Creates a stored archive, prunes old ones and starts the off-host copy (not awaited: it can be slow). */
export async function createStoredBackup(kind: 'auto' | 'manual'): Promise<BackupItem> {
  if (busy) throw new BackupError('Резервная копия уже создаётся, подождите', 409);
  busy = true;
  try {
    fs.mkdirSync(BACKUP_DIR, { recursive: true, mode: 0o700 });
    const s = backupSettings();
    let t = Date.now();
    const nameFor = () => `coregsm-${stamp(new Date(t))}-${kind}.tar.gz${s.passphrase ? '.enc' : ''}`;
    while (fs.existsSync(path.join(BACKUP_DIR, nameFor())) || fs.existsSync(path.join(BACKUP_DIR, nameFor().replace(/\.enc$/, '')))) t += 1000;
    const name = nameFor();
    const file = path.join(BACKUP_DIR, name);
    await buildArchive(file, s.passphrase);
    pruneBackups(s.keep);
    if (s.remoteUrl) void uploadRemote(file, name, s.remoteUrl);
    if (s.s3) void uploadS3(file, name, s.s3);
    const item = listBackups().find((i) => i.name === name);
    return item ?? { name, size: fs.statSync(file).size, createdAt: t, kind };
  } finally {
    busy = false;
  }
}

// ---------- scheduler ----------
export async function runScheduledIfDue(now = Date.now()): Promise<BackupItem | null> {
  try {
    const s = backupSettings();
    const lastAuto = listBackups().find((i) => i.kind === 'auto')?.createdAt ?? null;
    if (!backupDue(s.schedule, lastAuto, now)) return null;
    const it = await createStoredBackup('auto');
    log.info(`scheduled backup created: ${it.name}`);
    return it;
  } catch (e) {
    log.error('scheduled backup failed:', (e as Error).message);
    return null;
  }
}

const backupTimers: NodeJS.Timeout[] = [];
export function startBackupTimer(): void {
  backupTimers.push(setTimeout(() => void runScheduledIfDue(), 60_000).unref());
  backupTimers.push(setInterval(() => void runScheduledIfDue(), 3600_000).unref());
  backupTimers.push(setTimeout(() => void runVerifyIfDue(), 15 * 60_000).unref());
  backupTimers.push(setInterval(() => void runVerifyIfDue(), 6 * 3600_000).unref());
}

// ---------- restore check: a backup nobody has tried to open is a hope, not a backup ----------
export interface VerifyResult {
  at: number;
  name: string;
  ok: boolean;
  /** why the copy cannot be restored (Russian, for the panel); empty when the check passed */
  message: string;
  /** what the opened database holds, when the check passed */
  servers?: number;
  users?: number;
}
const VERIFY_KEY = 'backup_verify';
const VERIFY_EVERY = 6.9 * 86400_000;

export function lastVerify(): VerifyResult | null {
  try {
    const v = JSON.parse(getSetting(VERIFY_KEY) || 'null') as VerifyResult | null;
    return v && typeof v.at === 'number' && typeof v.name === 'string' && typeof v.ok === 'boolean' ? v : null;
  } catch {
    return null;
  }
}

/** pure rule: check when there is a copy and the last check is older than a week, or does not concern the newest copy */
export function verifyDue(newest: { name: string; createdAt: number } | null, last: { at: number; name: string } | null, now: number): boolean {
  if (!newest) return false;
  // a copy that has just been written is still being uploaded to the remote targets: give it a few minutes
  if (now - newest.createdAt < 5 * 60_000) return false;
  if (!last) return true;
  return now - last.at >= VERIFY_EVERY;
}

/** Opens a stored archive the way a restore would (decrypt, unpack, check the database) in a scratch folder and removes it again. */
export async function verifyBackup(name: string, now = Date.now()): Promise<VerifyResult> {
  const file = path.join(BACKUP_DIR, name);
  const stage = fs.mkdtempSync(path.join(DATA_DIR, '.verify-stage-'));
  const tmp: string[] = [];
  let result: VerifyResult;
  try {
    if (!isBackupName(name) || !fs.existsSync(file)) throw new BackupError('Копия не найдена');
    await extractAndValidate(file, backupSettings().passphrase, stage, tmp);
    const d = new Database(path.join(stage, 'coregsm.db'), { readonly: true });
    try {
      const n = (t: string) => (d.prepare(`SELECT COUNT(*) AS c FROM ${t}`).get() as { c: number }).c;
      result = { at: now, name, ok: true, message: '', servers: n('servers'), users: n('users') };
    } finally {
      d.close();
    }
  } catch (e) {
    result = { at: now, name, ok: false, message: e instanceof BackupError ? e.message : 'Не удалось открыть копию: ' + (e as Error).message.slice(0, 120) };
  } finally {
    rmrf(stage);
    for (const t of tmp) rmrf(t);
  }
  setSetting(VERIFY_KEY, JSON.stringify(result));
  if (result.ok) log.info(`backup check passed: ${name}`);
  else log.error(`backup check FAILED: ${name}: ${result.message}`);
  return result;
}

export async function runVerifyIfDue(now = Date.now()): Promise<VerifyResult | null> {
  try {
    const newest = listBackups()[0] ?? null;
    if (!verifyDue(newest, lastVerify(), now)) return null;
    return await verifyBackup(newest!.name, now);
  } catch (e) {
    log.error('backup check failed to run:', (e as Error).message);
    return null;
  }
}

/** Shutdown: no new scheduled backups; a backup being written is finished before the database closes. */
export async function stopBackups(): Promise<void> {
  for (const t of backupTimers) clearTimeout(t);
  while (busy) await new Promise((r) => setTimeout(r, 100));
}

// ---------- restoring ----------
const readHead = (file: string, n: number): Buffer => {
  const fd = fs.openSync(file, 'r');
  try {
    const b = Buffer.alloc(n);
    const got = fs.readSync(fd, b, 0, n, 0);
    return b.subarray(0, got);
  } finally {
    fs.closeSync(fd);
  }
};

/** null = fine, otherwise a message for the panel */
function validateDb(file: string): string | null {
  let t: InstanceType<typeof Database> | null = null;
  try {
    t = new Database(file, { readonly: true, fileMustExist: true });
    const tables = (t.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]).map((x) => x.name);
    if (!['users', 'servers', 'settings'].every((n) => tables.includes(n)) || t.pragma('quick_check', { simple: true }) !== 'ok') {
      return 'Файл повреждён или это копия не от CoreGSM';
    }
    const cols = (t.prepare('PRAGMA table_info(users)').all() as { name: string }[]).map((c) => c.name);
    // very old databases had no role/status columns: every account was an active administrator
    const where = [cols.includes('role') ? "role = 'admin'" : '1=1', cols.includes('status') ? "status = 'active'" : '1=1'].join(' AND ');
    if (!t.prepare(`SELECT 1 FROM users WHERE ${where} LIMIT 1`).get()) {
      return 'В копии нет ни одного активного администратора: восстановление отменено, чтобы вы не потеряли доступ к панели';
    }
    return null;
  } catch {
    return 'Файл повреждён или это копия не от CoreGSM';
  } finally {
    try {
      t?.close();
    } catch {
      /* a failed close of a temporary copy changes nothing: the files are removed right below */
    }
    for (const ext of ['-wal', '-shm']) rmrf(`${file}${ext}`);
  }
}

async function unpack(file: string, stage: string): Promise<void> {
  let total = 0;
  let bad: string | null = null;
  await tar.x({
    file,
    cwd: stage,
    preserveOwner: false,
    noChmod: true,
    filter: (p, entry) => {
      const e = entry as { type?: string; size?: number };
      const name = p.replace(/^(\.\/)+/, '').replace(/\/+$/, '');
      const okType = e.type === 'File' || e.type === 'Directory';
      const isDir = DIR_ENTRIES.has(name);
      if (!okType || !ALLOWED_ENTRY.test(name) || (isDir && e.type !== 'Directory') || (!isDir && e.type === 'Directory')) {
        bad ??= name || p;
        return false;
      }
      total += e.size ?? 0;
      if (total > MAX_UNPACKED) bad ??= 'слишком большой архив';
      return !bad;
    },
  });
  if (bad) throw new BackupError(`В архиве есть недопустимый файл («${String(bad).slice(0, 60)}»). Восстановление отменено.`);
}

/**
 * Validates an uploaded/stored backup (tar.gz, encrypted tar.gz or a legacy raw SQLite file) and stages it for the
 * swap at the next start. Throws BackupError with a Russian message when the file is not acceptable.
 */
/** secret settings of the staged copy that this host's key cannot decrypt (reported to the panel after a restore) */
let stagedUnreadable: string[] = [];

function unreadableSecrets(file: string): string[] {
  let t: InstanceType<typeof Database> | null = null;
  try {
    t = new Database(file, { readonly: true, fileMustExist: true });
    const rows = t.prepare('SELECT key, value FROM settings').all() as { key: string; value: string }[];
    return rows.filter((r) => isSecretKey(r.key) && isEncrypted(r.value) && !canDecrypt(r.value)).map((r) => r.key);
  } catch {
    return [];
  } finally {
    try {
      t?.close();
    } catch {
      /* a failed close of a temporary copy changes nothing: the files are removed right below */
    }
    for (const ext of ['-wal', '-shm']) rmrf(`${file}${ext}`);
  }
}

async function extractAndValidate(file: string, passphrase: string | null, stage: string, tmp: string[]): Promise<void> {
  {
    let src = file;
    let head = readHead(src, 15);
    if (head.length >= 8 && head.subarray(0, 8).equals(MAGIC)) {
      if (!passphrase) throw new BackupError('Архив зашифрован: укажите пароль шифрования (тот, что был задан при создании копии)');
      const dec = path.join(DATA_DIR, `.restore-dec-${crypto.randomBytes(6).toString('hex')}`);
      tmp.push(dec);
      await decryptFile(src, dec, passphrase);
      src = dec;
      head = readHead(src, 15);
    }
    if (head[0] === 0x1f && head[1] === 0x8b) {
      try {
        await unpack(src, stage);
      } catch (e) {
        if (e instanceof BackupError) throw e;
        throw new BackupError('Архив повреждён или имеет неверную структуру');
      }
      if (!fs.existsSync(path.join(stage, 'coregsm.db'))) throw new BackupError('В архиве нет базы данных (coregsm.db)');
    } else if (head.toString('latin1') === 'SQLite format 3') {
      fs.copyFileSync(src, path.join(stage, 'coregsm.db'));
    } else {
      throw new BackupError('Это не файл резервной копии CoreGSM (нужен .tar.gz или .db)');
    }
    const bad = validateDb(path.join(stage, 'coregsm.db'));
    if (bad) throw new BackupError(bad);
  }
}

export async function stageRestore(file: string, passphrase: string | null): Promise<void> {
  const stage = fs.mkdtempSync(path.join(DATA_DIR, '.restore-stage-'));
  const tmp: string[] = [];
  try {
    await extractAndValidate(file, passphrase, stage, tmp);
    // secrets are encrypted with SECRETS_KEY / JWT_SECRET of the host that made the copy: say so instead of failing later
    stagedUnreadable = unreadableSecrets(path.join(stage, 'coregsm.db'));
    rmrf(PENDING_DIR);
    fs.renameSync(stage, PENDING_DIR);
  } catch (e) {
    rmrf(stage);
    throw e;
  } finally {
    for (const t of tmp) rmrf(t);
  }
}

/** writes the request body to a file, refusing more than `max` bytes */
async function spool(req: Request, dest: string, max: number): Promise<void> {
  let n = 0;
  const cap = new Transform({
    transform(chunk: Buffer, _enc, cb) {
      n += chunk.length;
      if (n > max) cb(new BackupError('Файл больше 300 МБ', 413));
      else cb(null, chunk);
    },
  });
  await pipeline(req, cap, fs.createWriteStream(dest, { mode: 0o600 }));
}

const passFromHeader = (req: Request): string | null => {
  const raw = req.headers['x-backup-passphrase'];
  const v = Array.isArray(raw) ? raw[0] : raw;
  if (!v) return null;
  if (String(req.headers['x-backup-passphrase-encoding'] ?? '').toLowerCase() === 'uri') {
    try {
      return decodeURIComponent(v);
    } catch {
      return null;
    }
  }
  return v;
};

/**
 * Ends the process so the container restarts and db.ts applies the staged restore. The database is closed first
 * (WAL checkpoint); then the process is killed outright: process.exit() was seen to hang while the native canvas
 * library was being torn down, and a hung process would never be restarted.
 */
function restartSoon(): void {
  setTimeout(() => {
    try {
      db.close();
    } catch {
      /* closing is best effort: the process is killed right after */
    }
    process.kill(process.pid, 'SIGKILL');
  }, 800);
}

// ---------- routes ----------
export function registerBackups({ app, admin }: { app: Express; admin: RequestHandler }): void {
  const fail = (res: Response, e: unknown) => {
    if (e instanceof BackupError) return void res.status(e.status).json({ error: e.message });
    log.error('backup error', e);
    res.status(500).json({ error: `Не удалось выполнить операцию: ${(e as Error).message}` });
  };
  const guard =
    (fn: (req: Request, res: Response) => Promise<unknown> | unknown) =>
    (req: Request, res: Response, _next: NextFunction) => {
      Promise.resolve()
        .then(() => fn(req, res))
        .catch((e) => fail(res, e));
    };

  const payload = () => {
    const s = backupSettings();
    return { schedule: s.schedule, keep: s.keep, remoteUrl: maskUrl(s.remoteUrl), encrypted: !!s.passphrase, items: listBackups(), lastRemote: lastRemote(), verify: lastVerify(),
      s3: { endpoint: getSetting('backup_s3_endpoint') || '', bucket: getSetting('backup_s3_bucket') || '', region: getSetting('backup_s3_region') || 'us-east-1', prefix: getSetting('backup_s3_prefix') || '', configured: !!s.s3 },
      lastS3: lastS3(),
    };
  };

  // one-off archive for downloading (not stored)
  app.get(
    '/api/backup',
    admin,
    guard(async (_req, res) => {
      const s = backupSettings();
      const tmp = path.join(os.tmpdir(), `coregsm-dl-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`);
      const name = `coregsm-${stamp(new Date())}-manual.tar.gz${s.passphrase ? '.enc' : ''}`;
      await buildArchive(tmp, s.passphrase);
      res.download(tmp, name, () => rmrf(tmp));
    }),
  );

  app.post(
    '/api/backup/restore',
    admin,
    guard(async (req, res) => {
      const upload = path.join(DATA_DIR, `.restore-upload-${crypto.randomBytes(6).toString('hex')}`);
      try {
        const declared = Number(req.headers['content-length']);
        if (declared > MAX_UPLOAD) throw new BackupError('Файл больше 300 МБ', 413);
        try {
          await spool(req, upload, MAX_UPLOAD);
        } catch (e) {
          if (e instanceof BackupError) throw e;
          throw new BackupError('Загрузка прервана');
        }
        if (fs.statSync(upload).size < 100) throw new BackupError('Это не файл резервной копии CoreGSM');
        await stageRestore(upload, passFromHeader(req));
      } finally {
        rmrf(upload);
      }
      // the swap happens at start-up (see db.ts); the container restarts by itself
      res.json({ ok: true, restarting: true, unreadableSecrets: stagedUnreadable });
      restartSoon();
    }),
  );

  app.get('/api/backups', admin, guard((_req, res) => res.json(payload())));

  app.put(
    '/api/backups/settings',
    admin,
    guard((req, res) => {
      const b = z
        .object({
          schedule: z.enum(['off', 'daily', 'weekly']).optional(),
          keep: z.number().int().min(1).max(30).optional(),
          remoteUrl: z.string().trim().max(500).optional(),
          passphrase: z.string().max(200).optional(),
          s3: z
            .object({
              endpoint: z.string().trim().max(300),
              bucket: z.string().trim().max(80),
              region: z.string().trim().max(40).optional(),
              prefix: z.string().trim().max(120).optional(),
              accessKey: z.string().trim().max(200).optional(),
              secretKey: z.string().max(300).optional(),
            })
            .optional(),
          s3Clear: z.boolean().optional(),
        })
        .safeParse(req.body);
      if (!b.success) return res.status(400).json({ error: 'Проверьте поля: расписание off/daily/weekly, хранить от 1 до 30 копий' });
      if (b.data.remoteUrl) {
        let ok = false;
        try {
          ok = new URL(b.data.remoteUrl).protocol === 'https:';
        } catch {
          /* not a URL */
        }
        if (!ok) return res.status(400).json({ error: 'Адрес для копии должен начинаться с https://' });
      }
      if (b.data.s3) {
        const cur = s3Settings();
        const next: S3Target = {
          endpoint: b.data.s3.endpoint, bucket: b.data.s3.bucket, region: b.data.s3.region || 'us-east-1', prefix: b.data.s3.prefix ?? '',
          accessKey: b.data.s3.accessKey || cur?.accessKey || getSetting('backup_s3_key') || '',
          secretKey: b.data.s3.secretKey || cur?.secretKey || getSetting('backup_s3_secret') || '',
        };
        const bad = s3Problem(next);
        if (bad) return res.status(400).json({ error: bad });
        setSetting('backup_s3_endpoint', next.endpoint);
        setSetting('backup_s3_bucket', next.bucket);
        setSetting('backup_s3_region', next.region);
        setSetting('backup_s3_prefix', next.prefix);
        setSetting('backup_s3_key', next.accessKey);
        setSetting('backup_s3_secret', next.secretKey);
      }
      if (b.data.s3Clear) for (const k of ['endpoint', 'bucket', 'region', 'prefix', 'key', 'secret']) setSetting(`backup_s3_${k}`, '');
      if (b.data.passphrase && b.data.passphrase.length < 8) return res.status(400).json({ error: 'Пароль шифрования: не короче 8 символов' });
      if (b.data.schedule !== undefined) setSetting('backup_schedule', b.data.schedule);
      if (b.data.keep !== undefined) setSetting('backup_keep', String(b.data.keep));
      if (b.data.remoteUrl !== undefined) setSetting('backup_remote_url', b.data.remoteUrl);
      if (b.data.passphrase !== undefined) setSetting('backup_passphrase', b.data.passphrase);
      res.json(payload());
    }),
  );

  // a small file to the S3 storage: shows at once whether the address and the keys are right
  app.post(
    '/api/backups/test-s3',
    admin,
    guard(async (_req, res) => {
      const t = s3Settings();
      if (!t) return res.status(400).json({ error: 'Хранилище S3 не настроено' });
      const tmp = path.join(os.tmpdir(), `coregsm-s3-test-${crypto.randomBytes(4).toString('hex')}.txt`);
      fs.writeFileSync(tmp, `CoreGSM backup test ${new Date().toISOString()}\n`);
      try {
        res.json(await uploadS3(tmp, 'coregsm-test.txt', t, { remember: false }));
      } finally {
        fs.rmSync(tmp, { force: true });
      }
    }),
  );

  app.post(
    '/api/backups/run',
    admin,
    guard(async (_req, res) => {
      res.status(201).json(await createStoredBackup('manual'));
    }),
  );

  // opens the newest copy the way a restore would and says whether it can be restored
  app.post(
    '/api/backups/verify',
    admin,
    guard(async (_req, res) => {
      const newest = listBackups()[0];
      if (!newest) throw new BackupError('Копий пока нет: проверять нечего');
      res.json(await verifyBackup(newest.name));
    }),
  );

  const storedFile = (req: Request, res: Response): { name: string; file: string } | null => {
    const name = String(req.params.name ?? '');
    const file = path.join(BACKUP_DIR, name);
    if (!isBackupName(name) || !fs.existsSync(file)) {
      res.status(404).json({ error: 'Копия не найдена' });
      return null;
    }
    return { name, file };
  };

  app.get(
    '/api/backups/:name',
    admin,
    guard((req, res) => {
      const f = storedFile(req, res);
      if (f) res.download(f.file, f.name);
    }),
  );

  app.delete(
    '/api/backups/:name',
    admin,
    guard((req, res) => {
      const f = storedFile(req, res);
      if (!f) return;
      fs.rmSync(f.file, { force: true });
      res.json({ ok: true });
    }),
  );

  app.post(
    '/api/backups/:name/restore',
    admin,
    guard(async (req, res) => {
      const f = storedFile(req, res);
      if (!f) return;
      const given = z.object({ passphrase: z.string().max(200).optional() }).safeParse(req.body ?? {});
      const pass = (given.success && given.data.passphrase) || backupSettings().passphrase;
      await stageRestore(f.file, pass || null);
      res.json({ ok: true, restarting: true, unreadableSecrets: stagedUnreadable });
      restartSoon();
    }),
  );
}
