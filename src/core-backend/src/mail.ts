/**
 * Outgoing e-mail (nodemailer). SMTP settings live in the settings table: smtp_host, smtp_port, smtp_secure ('1' = TLS
 * from the first byte, otherwise STARTTLS is used when the server offers it), smtp_user, smtp_password (stored
 * encrypted), smtp_from.
 *
 * Test hooks: MAIL_DEBUG_FILE=<path> appends every message as one JSON line to that file instead of sending it
 * (and counts as "SMTP works"); setTransportFactory() replaces the transport in-process.
 */
import fs from 'node:fs';
import nodemailer, { type Transporter } from 'nodemailer';
import { getSetting } from './db.js';

export interface SmtpConfig {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  password: string;
  from: string;
}

export function smtpConfig(): SmtpConfig {
  const secure = getSetting('smtp_secure');
  const port = Number(getSetting('smtp_port')) || (secure === '1' ? 465 : 587);
  return {
    host: getSetting('smtp_host') ?? '',
    port,
    secure: secure === '1',
    user: getSetting('smtp_user') ?? '',
    password: getSetting('smtp_password') ?? '',
    from: getSetting('smtp_from') ?? '',
  };
}

const debugFile = () => (process.env.MAIL_DEBUG_FILE ?? '').trim();

/** true when letters can be sent (SMTP host configured, or the debug file is active) */
export function mailReady(): boolean {
  return !!debugFile() || !!smtpConfig().host;
}

type Factory = (cfg: SmtpConfig) => Pick<Transporter, 'sendMail'>;
let factory: Factory | null = null;
/** replaces the SMTP transport (tests) */
export function setTransportFactory(f: Factory | null): void {
  factory = f;
}

export interface Mail {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

/** Sends a letter. Rejects with an Error whose message is safe to show to an administrator. */
export async function sendMail(m: Mail): Promise<void> {
  const cfg = smtpConfig();
  const from = cfg.from || (cfg.user.includes('@') ? cfg.user : `coregsm@${cfg.host || 'localhost'}`);
  if (debugFile()) {
    fs.appendFileSync(debugFile(), JSON.stringify({ ts: Date.now(), from, ...m }) + '\n');
    return;
  }
  if (!cfg.host) throw new Error('SMTP не настроен: укажите сервер в настройках почты');
  const transport =
    factory?.(cfg) ??
    nodemailer.createTransport({
      host: cfg.host,
      port: cfg.port,
      secure: cfg.secure,
      auth: cfg.user ? { user: cfg.user, pass: cfg.password } : undefined,
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 20_000,
    });
  try {
    await transport.sendMail({ from, to: m.to, subject: m.subject, text: m.text, html: m.html });
  } catch (e) {
    const err = e as Error & { code?: string; responseCode?: number };
    const why =
      err.code === 'EAUTH' ? 'сервер отклонил логин или пароль'
      : err.code === 'ECONNECTION' || err.code === 'ECONNREFUSED' || err.code === 'ENOTFOUND' ? 'не удалось подключиться к серверу'
      : err.code === 'ETIMEDOUT' || err.code === 'ESOCKET' ? 'сервер не отвечает или неверный порт/шифрование'
      : err.message.slice(0, 160);
    throw new Error(`Не удалось отправить письмо: ${why}`);
  }
}

const escHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** a small, plain HTML letter around a paragraph and one button */
export function layout(brand: string, lines: string[], action?: { label: string; url: string }): { text: string; html: string } {
  const text = [...lines, ...(action ? ['', `${action.label}: ${action.url}`] : []), '', `— ${brand}`].join('\n');
  const html =
    `<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.5;color:#1f2937;max-width:520px">` +
    lines.map((l) => `<p>${escHtml(l)}</p>`).join('') +
    (action ? `<p><a href="${escHtml(action.url)}" style="display:inline-block;padding:10px 18px;border-radius:8px;background:#4f46e5;color:#fff;text-decoration:none">${escHtml(action.label)}</a></p><p style="font-size:13px;color:#6b7280;word-break:break-all">${escHtml(action.url)}</p>` : '') +
    `<p style="font-size:13px;color:#6b7280">${escHtml(brand)}</p></div>`;
  return { text, html };
}
