/**
 * Encryption of the backup archives (AES-256-GCM, key from a passphrase with scrypt). Layout of an encrypted archive
 * (.tar.gz.enc): see the description at the top of backup.ts.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import { once } from 'node:events';
import { BackupError } from './backupError.js';

export const MAGIC = Buffer.from('CGSMENC1');
export const HEADER_LEN = 8 + 16 + 12;

const scrypt = (pass: string, salt: Buffer): Promise<Buffer> =>
  new Promise((resolve, reject) => crypto.scrypt(pass, salt, 32, { N: 32768, r: 8, p: 1, maxmem: 128 * 1024 * 1024 }, (e, k) => (e ? reject(e) : resolve(k))));

export async function encryptFile(src: string, dst: string, pass: string): Promise<void> {
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const header = Buffer.concat([MAGIC, salt, iv]);
  const cipher = crypto.createCipheriv('aes-256-gcm', await scrypt(pass, salt), iv);
  cipher.setAAD(header);
  const out = fs.createWriteStream(dst, { mode: 0o600 });
  const done = new Promise<void>((res, rej) => {
    out.on('finish', res);
    out.on('error', rej);
  });
  // a failure before `await done` must not become an unhandled rejection
  done.catch(() => undefined);
  out.write(header);
  for await (const chunk of fs.createReadStream(src)) {
    const c = cipher.update(chunk as Buffer);
    if (c.length && !out.write(c)) await once(out, 'drain');
  }
  out.write(cipher.final());
  out.end(cipher.getAuthTag());
  await done;
}

export async function decryptFile(src: string, dst: string, pass: string): Promise<void> {
  const size = fs.statSync(src).size;
  if (size < HEADER_LEN + 16) throw new BackupError('Файл повреждён');
  const fd = fs.openSync(src, 'r');
  const header = Buffer.alloc(HEADER_LEN);
  const tag = Buffer.alloc(16);
  try {
    fs.readSync(fd, header, 0, HEADER_LEN, 0);
    fs.readSync(fd, tag, 0, 16, size - 16);
  } finally {
    fs.closeSync(fd);
  }
  if (!header.subarray(0, 8).equals(MAGIC)) throw new BackupError('Это не зашифрованная копия CoreGSM');
  const key = await scrypt(pass, header.subarray(8, 24));
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, header.subarray(24, 36));
  decipher.setAAD(header);
  decipher.setAuthTag(tag);
  const out = fs.createWriteStream(dst, { mode: 0o600 });
  const done = new Promise<void>((res, rej) => {
    out.on('finish', res);
    out.on('error', rej);
  });
  // a failure before `await done` must not become an unhandled rejection
  done.catch(() => undefined);
  try {
    if (size - 16 > HEADER_LEN) {
      for await (const chunk of fs.createReadStream(src, { start: HEADER_LEN, end: size - 17 })) {
        const c = decipher.update(chunk as Buffer);
        if (c.length && !out.write(c)) await once(out, 'drain');
      }
    }
    out.end(decipher.final());
  } catch {
    out.destroy();
    throw new BackupError('Неверный пароль шифрования или файл повреждён');
  }
  await done;
}
