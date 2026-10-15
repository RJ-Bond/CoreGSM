/**
 * A small Source RCON client (the protocol of Minecraft, CS, ARK, V Rising, Palworld, Garry's Mod, Valheim with
 * a mod and others): sign in with the password, run one command, return its text.
 *
 * Packet: int32 size, int32 id, int32 type, body (ASCII/UTF-8) + "\0\0", little endian; size counts everything
 * after itself. Types: 3 auth, 2 exec (and the auth answer), 0 response value.
 */
import net from 'node:net';

const AUTH = 3;
const EXEC = 2;

export function encodePacket(id: number, type: number, body: string): Buffer {
  const b = Buffer.from(body, 'utf8');
  const buf = Buffer.alloc(14 + b.length);
  buf.writeInt32LE(10 + b.length, 0);
  buf.writeInt32LE(id, 4);
  buf.writeInt32LE(type, 8);
  b.copy(buf, 12);
  return buf;
}

/** the complete packets at the start of `buf`, and the bytes left over */
export function decodePackets(buf: Buffer): { packets: { id: number; type: number; body: string }[]; rest: Buffer } {
  const packets: { id: number; type: number; body: string }[] = [];
  let off = 0;
  while (buf.length - off >= 4) {
    const size = buf.readInt32LE(off);
    if (size < 10 || size > 1_000_000) throw new Error('RCON: повреждённый ответ сервера');
    if (buf.length - off - 4 < size) break;
    packets.push({ id: buf.readInt32LE(off + 4), type: buf.readInt32LE(off + 8), body: buf.toString('utf8', off + 12, off + 4 + size - 2) });
    off += 4 + size;
  }
  return { packets, rest: buf.subarray(off) };
}

export class RconError extends Error {}

/**
 * Runs one command. The answer is everything the server sends back for it until it goes quiet for a moment
 * (long answers come in several packets).
 */
export function rconCommand(host: string, port: number, password: string, command: string, timeoutMs = 6000): Promise<string> {
  return new Promise((resolve, reject) => {
    const sock = net.createConnection({ host, port });
    let buf: Buffer = Buffer.alloc(0);
    let authed = false;
    let out = '';
    let quiet: NodeJS.Timeout | undefined;
    let settled = false;
    const done = (err: Error | null, text = '') => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(quiet);
      sock.destroy();
      if (err) reject(err);
      else resolve(text);
    };
    const timer = setTimeout(() => done(authed ? null : new RconError('RCON: сервер не ответил вовремя'), out.trim()), timeoutMs);
    sock.setNoDelay(true);
    sock.on('connect', () => sock.write(encodePacket(1, AUTH, password)));
    sock.on('error', (e: NodeJS.ErrnoException) =>
      done(new RconError(e.code === 'ECONNREFUSED' ? 'RCON: порт закрыт (проверьте порт и что RCON включён на сервере)' : `RCON: ${e.message}`)),
    );
    sock.on('close', () => done(authed ? null : new RconError('RCON: сервер закрыл соединение'), out.trim()));
    sock.on('data', (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      let parsed;
      try {
        parsed = decodePackets(buf);
      } catch (e) {
        return done(e as Error);
      }
      buf = parsed.rest;
      for (const p of parsed.packets) {
        if (!authed) {
          if (p.type !== EXEC) continue; // some servers send an empty response value before the auth answer
          if (p.id === -1) return done(new RconError('RCON: неверный пароль'));
          authed = true;
          sock.write(encodePacket(2, EXEC, command));
          // a command with no output: finish after a short wait
          quiet = setTimeout(() => done(null, out.trim()), 1500);
          continue;
        }
        if (p.id !== 2) continue;
        out += p.body;
        clearTimeout(quiet);
        quiet = setTimeout(() => done(null, out.trim()), 300);
      }
    });
  });
}
