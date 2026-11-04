/** Off-host copies of the backups: a PUT to a URL and an S3-compatible bucket, and the result of the last attempt. */
import fs from 'node:fs';
import { Readable } from 'node:stream';
import { getSetting, setSetting } from '../db.js';
import { log } from '../logger.js';
import { s3ObjectUrl, s3Problem, signV4, UNSIGNED_PAYLOAD, type S3Target } from './s3.js';

export interface RemoteResult {
  at: number;
  ok: boolean;
  error: string | null;
}
export const lastRemote = (): RemoteResult | null => {
  try {
    const v = JSON.parse(getSetting('backup_last_remote') ?? 'null');
    return v && typeof v.at === 'number' ? (v as RemoteResult) : null;
  } catch {
    return null;
  }
};

/** HTTP PUT of the archive. If the URL ends with "/" the file name is appended. Never throws. */
export async function uploadRemote(file: string, name: string, url: string): Promise<RemoteResult> {
  let result: RemoteResult;
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:') throw new Error('адрес должен начинаться с https://');
    const headers: Record<string, string> = { 'content-type': 'application/octet-stream', 'content-length': String(fs.statSync(file).size), 'user-agent': 'CoreGSM' };
    if (u.username || u.password) {
      headers.authorization = `Basic ${Buffer.from(`${decodeURIComponent(u.username)}:${decodeURIComponent(u.password)}`).toString('base64')}`;
      u.username = '';
      u.password = '';
    }
    if (u.pathname.endsWith('/')) u.pathname += name;
    const r = await fetch(u, {
      method: 'PUT',
      headers,
      body: Readable.toWeb(fs.createReadStream(file)) as unknown as BodyInit,
      // streaming request bodies need this flag in Node's fetch
      ...({ duplex: 'half' } as object),
      signal: AbortSignal.timeout(15 * 60_000),
    });
    if (!r.ok) throw new Error(`сервер ответил HTTP ${r.status}`);
    result = { at: Date.now(), ok: true, error: null };
  } catch (e) {
    const err = e as Error & { cause?: { message?: string } };
    result = { at: Date.now(), ok: false, error: `${err.message}${err.cause?.message ? ` (${err.cause.message})` : ''}`.slice(0, 300) };
    log.error('backup upload failed:', result.error);
  }
  try {
    setSetting('backup_last_remote', JSON.stringify(result));
  } catch (err) {
    log.warn('backup: could not store the upload result:', (err as Error).message);
  }
  return result;
}

export const lastS3 = (): RemoteResult | null => {
  try {
    const v = JSON.parse(getSetting('backup_last_s3') ?? 'null');
    return v && typeof v.at === 'number' ? (v as RemoteResult) : null;
  } catch {
    return null;
  }
};

/** PUT of the archive (or of a small file) to an S3-compatible storage, signed with SigV4. Never throws. */
export async function uploadS3(file: string, name: string, t: S3Target, opts: { remember?: boolean } = {}): Promise<RemoteResult> {
  let result: RemoteResult;
  try {
    const bad = s3Problem(t);
    if (bad) throw new Error(bad);
    const size = fs.statSync(file).size;
    const url = s3ObjectUrl(t, name);
    const headers = signV4({
      method: 'PUT', url, headers: { 'content-type': 'application/octet-stream', 'content-length': String(size) },
      payloadHash: UNSIGNED_PAYLOAD, region: t.region, accessKey: t.accessKey, secretKey: t.secretKey,
    });
    delete headers.host;
    const r = await fetch(url, {
      method: 'PUT',
      headers: { ...headers, 'user-agent': 'CoreGSM' },
      body: Readable.toWeb(fs.createReadStream(file)) as unknown as BodyInit,
      ...({ duplex: 'half' } as object),
      signal: AbortSignal.timeout(15 * 60_000),
    });
    if (!r.ok) {
      const body = (await r.text().catch(() => '')).match(/<Message>([^<]{1,150})<\/Message>/)?.[1];
      throw new Error(`хранилище ответило HTTP ${r.status}${body ? `: ${body}` : ''}`);
    }
    result = { at: Date.now(), ok: true, error: null };
  } catch (e) {
    const err = e as Error & { cause?: { message?: string } };
    result = { at: Date.now(), ok: false, error: `${err.message}${err.cause?.message ? ` (${err.cause.message})` : ''}`.slice(0, 300) };
    log.error('backup S3 upload failed:', result.error);
  }
  if (opts.remember !== false) {
    try {
      setSetting('backup_last_s3', JSON.stringify(result));
    } catch (err) {
      log.warn('backup: could not store the S3 result:', (err as Error).message);
    }
  }
  return result;
}
