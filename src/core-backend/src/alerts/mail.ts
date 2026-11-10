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
import { getSetting } from '../db.js';

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

/** the accent colour of the community (the setting of the brand), or the default one; only a plain #rrggbb is let into the markup */
const accentColor = (): string => {
  const c = (getSetting('brand_color') ?? '').trim();
  return /^#[0-9a-f]{6}$/i.test(c) ? c : getSetting('default_look') === 'ember' ? '#d6420a' : '#4f46e5';
};

/** where the logo of the panel is: its public address, or null when the panel has none (a letter cannot show a picture then) */
const logoUrl = (): string | null => {
  const env = (process.env.PUBLIC_URL ?? '').trim().replace(/\/+$/, '');
  if (/^https:\/\/[^\s/]+$/i.test(env)) return `${env}/logo-128.png`;
  const d = (process.env.DOMAIN ?? '').trim();
  if (/^[a-z0-9.-]+$/i.test(d) && d.includes('.') && !/^[\d.]+$/.test(d)) return `https://${d}/logo-128.png`;
  return null;
};

/**
 * A letter in the look of the panel: the brand (logo and name) on a bar of the accent colour, the text, one big button
 * and a quiet footer. Tables and inline styles only: mail programs ignore anything else.
 */
export function layout(brand: string, lines: string[], action?: { label: string; url: string }): { text: string; html: string } {
  const text = [...lines, ...(action ? ['', `${action.label}: ${action.url}`] : []), '', `— ${brand}`].join('\n');
  const accent = accentColor();
  const logo = logoUrl();
  const head =
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${accent}"><tr><td style="padding:18px 28px;font-size:18px;font-weight:700;color:#ffffff">` +
    (logo ? `<img src="${escHtml(logo)}" width="28" height="28" alt="" style="vertical-align:middle;border-radius:7px;margin-right:10px">` : '') +
    `<span style="vertical-align:middle">${escHtml(brand)}</span></td></tr></table>`;
  const body = lines.map((l) => `<p style="margin:0 0 14px">${escHtml(l)}</p>`).join('');
  const button = action
    ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:22px 0 6px"><tr><td style="border-radius:10px;background:${accent}"><a href="${escHtml(action.url)}" style="display:inline-block;padding:13px 26px;font-size:16px;font-weight:700;color:#ffffff;text-decoration:none">${escHtml(action.label)}</a></td></tr></table>` +
      `<p style="margin:14px 0 0;font-size:12px;color:#6b7280;word-break:break-all">${escHtml(action.url)}</p>`
    : '';
  const html =
    `<div style="margin:0;padding:24px 12px;background:#f3f4f8;font-family:Arial,Helvetica,sans-serif">` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:14px;overflow:hidden">` +
    `<tr><td>${head}</td></tr>` +
    `<tr><td style="padding:26px 28px 8px;font-size:15px;line-height:1.55;color:#1f2937">${body}${button}</td></tr>` +
    `<tr><td style="padding:18px 28px 24px;font-size:12px;color:#9ca3af">${escHtml(brand)}</td></tr>` +
    `</table></div>`;
  return { text, html };
}
