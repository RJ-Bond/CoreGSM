/** Administrator settings: bot token and proxy, bot status, access, branding, web app manifest. */
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import type { Request } from 'express';
import { z } from 'zod';
import { admin, publicPanel, registrationOpen } from '../auth.js';
import { pingVerdict, thin } from '../botLatencyLogic.js';
import { bot, BOT_COMMANDS, clientIdFromToken, discordLoginReady, invitePayload } from '../botState.js';
import { getSetting, setSetting } from '../db.js';
import { BOT_TOKEN_RE, maskProxy, normalizeProxy, PROXY_HELP, PROXY_RE, TOKEN_HELP } from '../proxyInput.js';
import { currentRules } from '../rules.js';
import { installedVersion } from './updates.js';
import { baseOf, brand, LOGO_PATH, LOGO_TYPES, logoFile, publicBase, registrationMode, rulesText } from '../site.js';

export const router = express.Router();

// ---------- bot settings (token, proxy) ----------
function settingsPayload(req?: Request) {
  const tok = getSetting('discord_token');
  const proxy = getSetting('proxy_url');
  return {
    discordTokenSet: !!tok,
    discordTokenHint: tok ? `…${tok.slice(-4)}` : null,
    proxyUrl: proxy ? maskProxy(proxy) : null,
    discordSecretSet: !!getSetting('discord_client_secret'),
    discordClientId: bot.status.clientId ?? clientIdFromToken(tok),
    discordRedirect: req ? `${publicBase() ?? baseOf(req)}/api/auth/discord/callback` : '',
  };
}

router.get('/api/settings', admin, (req, res) => {
  res.json(settingsPayload(req));
});

// undefined = keep, empty string = clear
const settingsSchema = z.object({
  discordToken: z.string().trim().max(200).optional(),
  proxyUrl: z.string().trim().max(300).optional(),
  proxyType: z.enum(['socks5', 'http']).optional(),
  discordClientSecret: z.string().trim().max(200).optional(),
});

router.put('/api/settings', admin, (req, res) => {
  const b = settingsSchema.safeParse(req.body);
  if (!b.success) return res.status(400).json({ error: 'Проверьте поля формы' });
  const proxyUrl = b.data.proxyUrl === undefined ? undefined : normalizeProxy(b.data.proxyUrl, b.data.proxyType ?? 'socks5');
  if (proxyUrl && !PROXY_RE.test(proxyUrl)) return res.status(400).json({ error: PROXY_HELP });
  if (b.data.discordToken && !BOT_TOKEN_RE.test(b.data.discordToken)) return res.status(400).json({ error: TOKEN_HELP });
  if (b.data.discordToken !== undefined) setSetting('discord_token', b.data.discordToken);
  if (proxyUrl !== undefined) setSetting('proxy_url', proxyUrl);
  if (b.data.discordClientSecret !== undefined) setSetting('discord_client_secret', b.data.discordClientSecret);
  res.json(settingsPayload(req));
});

router.get('/api/bot/status', admin, (_req, res) => {
  // a bot that stopped reporting is considered offline
  const stale = Date.now() - bot.status.updatedAt > 45_000;
  const base = stale ? { ...bot.status, state: 'error', error: 'Бот не отвечает (возможно, перезапускается). Если состояние не меняется больше минуты, на сервере выполните: sudo coregsm logs bot' } : bot.status;
  const latency = thin(bot.latency, 80);
  res.json({ ...base, ping: stale || base.state !== 'online' ? null : (bot.latency[bot.latency.length - 1]?.ms ?? null), pingVerdict: pingVerdict(bot.latency), latency, ...invitePayload(), commandList: BOT_COMMANDS, guildCount: bot.guilds.length, channelCount: bot.guilds.reduce((n, g) => n + g.channels.length, 0) });
});

const accessPayload = () => ({
  publicPanel: publicPanel(),
  registration: registrationOpen(),
  registrationMode: registrationMode(),
  rules: rulesText(),
  discordLogin: discordLoginReady(),
  brand: brand(),
  /** the installed version, as the update screens show it («1.0.0.50», or the short build id on an older install); null in a development run */
  version: installedVersion(),
});

router.get('/api/access', (_req, res) => {
  res.json(accessPayload());
});
router.put('/api/access', admin, (req, res) => {
  const b = z
    .object({
      publicPanel: z.boolean().optional(),
      registration: z.boolean().optional(),
      registrationMode: z.enum(['open', 'approval']).optional(),
      rules: z.string().max(5000).optional(),
    })
    .safeParse(req.body);
  if (!b.success) return res.status(400).json({ error: 'Неверные данные' });
  if (b.data.publicPanel !== undefined) setSetting('public_panel', b.data.publicPanel ? '1' : '0');
  if (b.data.registration !== undefined) setSetting('registration_open', b.data.registration ? '1' : '0');
  if (b.data.registrationMode !== undefined) setSetting('registration_mode', b.data.registrationMode);
  if (b.data.rules !== undefined) {
    setSetting('rules_text', b.data.rules.trim());
    // the change becomes a new version, so old consents do not count for it
    currentRules();
  }
  res.json(accessPayload());
});

router.put('/api/branding', admin, (req, res) => {
  const b = z
    .object({
      name: z.string().trim().min(1).max(32),
      color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
      color2: z.string().regex(/^(#[0-9a-fA-F]{6})?$/).optional(),
      preset: z.string().trim().max(24).optional(),
    })
    .safeParse(req.body);
  if (!b.success) return res.status(400).json({ error: 'Название до 32 символов, цвет в виде #RRGGBB' });
  setSetting('brand_name', b.data.name);
  setSetting('brand_color', b.data.color.toLowerCase());
  setSetting('brand_color2', (b.data.color2 ?? '').toLowerCase());
  setSetting('brand_preset', b.data.preset ?? '');
  res.json(brand());
});
router.put(
  '/api/branding/logo',
  admin,
  express.raw({ type: Object.keys(LOGO_TYPES), limit: '3mb' }),
  (req, res) => {
    const ext = LOGO_TYPES[String(req.headers['content-type'] ?? '').split(';')[0]];
    if (!ext || !Buffer.isBuffer(req.body) || req.body.length === 0) return res.status(400).json({ error: 'Нужна картинка PNG, JPG или WebP до 3 МБ' });
    const old = logoFile();
    if (old) fs.rmSync(old, { force: true });
    fs.writeFileSync(`${LOGO_PATH}.${ext}`, req.body);
    res.json(brand());
  },
);
router.put('/api/branding/theme', admin, (req, res) => {
  const b = z.object({ theme: z.enum(['auto', 'light', 'dark']) }).safeParse(req.body);
  if (!b.success) return res.status(400).json({ error: 'Неверные данные' });
  setSetting('default_theme', b.data.theme);
  res.json(brand());
});
router.delete('/api/branding/logo', admin, (_req, res) => {
  const old = logoFile();
  if (old) fs.rmSync(old, { force: true });
  res.json(brand());
});
router.get('/api/branding/logo', (_req, res) => {
  const f = logoFile();
  if (!f) return res.status(404).end();
  res.set('Cache-Control', 'public, max-age=300').type(path.extname(f).slice(1)).send(fs.readFileSync(f));
});
// web app manifest (install the panel to the phone's home screen)
router.get('/api/manifest.json', (_req, res) => {
  const b = brand();
  const icon = b.hasLogo ? `/api/branding/logo?v=${b.logoV}` : '/logo-192.png';
  res.type('application/manifest+json').json({
    id: '/',
    lang: 'ru',
    dir: 'ltr',
    orientation: 'any',
    name: b.name,
    short_name: b.name.slice(0, 12),
    description: 'Мониторинг игровых серверов: кто играет, доступность, новости',
    start_url: '/servers',
    scope: '/',
    display: 'standalone',
    // the default theme is dark: the splash screen matches it
    background_color: '#09090e',
    theme_color: b.color,
    categories: ['games', 'utilities'],
    shortcuts: [
      { name: 'Серверы', url: '/servers' },
      { name: 'Сообщество', url: '/community' },
      { name: 'Статус', url: '/status' },
    ],
    icons: [
      { src: icon, sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: b.hasLogo ? icon : '/logo-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      // the maskable icon has a full-bleed background and a safe zone (Android adaptive icons)
      { src: '/logo-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  });
});
