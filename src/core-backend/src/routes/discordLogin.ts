/** Sign in with Discord (OAuth2, identify scope): login, linking and registration of new players. */
import express from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import type { Request, Response } from 'express';
import { issueToken, loadUser, rateLimit, registrationOpen, userFromToken } from '../auth.js';
import { bot, clientIdFromToken } from '../botState.js';
import { db, getSetting } from '../db.js';
import { wrap } from '../http.js';
import { logAccount } from '../profile.js';
import { discordFetch } from '../proxyFetch.js';
import { noteLogin, setSessionCookie } from '../security.js';
import { baseOf, brand, publicBase, registrationMode } from '../site.js';

export const router = express.Router();

// ---------- sign in with Discord (OAuth2, identify scope) ----------
const oauthStates = new Map<string, { mode: 'login' | 'link'; userId: number; exp: number }>();
const redirectUri = (req: Request) => `${publicBase() ?? baseOf(req)}/api/auth/discord/callback`;
const toHash = (res: Response, hash: string) => res.redirect(302, `/#/${hash}`);
const failTo = (res: Response, msg: string) => toHash(res, `login/${encodeURIComponent(msg)}`);

router.get('/api/auth/discord/start', rateLimit(30), (req, res) => {
  const clientId = bot.status.clientId ?? clientIdFromToken(getSetting('discord_token'));
  if (!clientId || !getSetting('discord_client_secret')) return failTo(res, 'Вход через Discord не настроен администратором');
  const mode = req.query.mode === 'link' ? 'link' : 'login';
  let userId = 0;
  if (mode === 'link') {
    // the session cookie travels with this top-level navigation; ?t= stays for older clients
    const u = userFromToken(String(req.query.t ?? '')) ?? loadUser(req);
    if (!u) return failTo(res, 'Сначала войдите в панель, затем привяжите Discord');
    userId = u.id;
  }
  for (const [k, v] of oauthStates) if (v.exp < Date.now()) oauthStates.delete(k);
  // bounded memory: the oldest pending sign-ins are dropped first
  while (oauthStates.size >= 1000) oauthStates.delete(oauthStates.keys().next().value as string);
  const state = crypto.randomBytes(16).toString('hex');
  oauthStates.set(state, { mode, userId, exp: Date.now() + 10 * 60_000 });
  const q = new URLSearchParams({ client_id: clientId, response_type: 'code', scope: 'identify', redirect_uri: redirectUri(req), state, prompt: 'none' });
  res.redirect(302, `https://discord.com/oauth2/authorize?${q.toString()}`);
});

router.get(
  '/api/auth/discord/callback',
  wrap(async (req, res) => {
    const st = oauthStates.get(String(req.query.state ?? ''));
    oauthStates.delete(String(req.query.state ?? ''));
    if (!st || st.exp < Date.now()) return failTo(res, 'Сессия входа через Discord устарела, попробуйте ещё раз');
    if (req.query.error || !req.query.code) return failTo(res, 'Вход через Discord отменён');
    const clientId = bot.status.clientId ?? clientIdFromToken(getSetting('discord_token'));
    const secret = getSetting('discord_client_secret');
    if (!clientId || !secret) return failTo(res, 'Вход через Discord не настроен администратором');

    let me: { id: string; username: string; global_name?: string | null; avatar?: string | null };
    try {
      const tr = await discordFetch('https://discord.com/api/v10/oauth2/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ client_id: clientId, client_secret: secret, grant_type: 'authorization_code', code: String(req.query.code), redirect_uri: redirectUri(req) }),
      });
      if (!tr.ok) return failTo(res, 'Discord отклонил вход. Проверьте Client Secret и Redirect URI в настройках');
      const tok = (await tr.json()) as { access_token: string };
      const mr = await discordFetch('https://discord.com/api/v10/users/@me', { headers: { Authorization: `Bearer ${tok.access_token}` } });
      if (!mr.ok) return failTo(res, 'Не удалось получить профиль из Discord');
      me = (await mr.json()) as typeof me;
    } catch (e) {
      console.error('discord oauth request failed:', (e as Error).message);
      return failTo(res, getSetting('proxy_url') ? 'Не удалось связаться с Discord через прокси. Проверьте прокси в настройках бота' : 'Не удалось связаться с Discord. Если он недоступен напрямую, задайте прокси в настройках бота');
    }
    const dname = me.global_name || me.username;
    const owner = db.prepare('SELECT id, username, status FROM users WHERE discord_id = ?').get(me.id) as { id: number; username: string; status: string } | undefined;

    if (st.mode === 'link') {
      if (owner && owner.id !== st.userId) return toHash(res, 'profile/' + encodeURIComponent('Этот Discord уже привязан к другому аккаунту'));
      db.prepare('UPDATE users SET discord_id = ?, discord_name = ?, discord_avatar = ? WHERE id = ?').run(me.id, dname, me.avatar ?? null, st.userId);
      logAccount(req, st.userId, 'discord_linked', dname);
      return toHash(res, 'profile');
    }

    if (owner) {
      db.prepare('UPDATE users SET discord_name = ?, discord_avatar = ? WHERE id = ?').run(dname, me.avatar ?? null, owner.id);
      if (owner.status !== 'active') return failTo(res, 'Заявка на регистрацию ещё не одобрена администратором');
      logAccount(req, owner.id, 'login', 'Discord');
      noteLogin(req, owner.id, brand().name);
      const tok = issueToken(owner, req);
      setSessionCookie(req, res, tok);
      return toHash(res, `auth/${tok}`);
    }

    // first sign-in with this Discord account: register it (when registration is open)
    if (!registrationOpen()) return failTo(res, 'Регистрация закрыта администратором');
    let base = dname.replace(/[^\p{L}\p{N}_.\- ]/gu, '').replace(/ +/g, ' ').trim().slice(0, 28);
    if (base.length < 3) base = `player${me.id.slice(-4)}`;
    let name = base;
    for (let i = 2; db.prepare('SELECT 1 FROM users WHERE ulower(username) = ?').get(name.toLowerCase()); i++) name = `${base.slice(0, 28)} ${i}`.slice(0, 32);
    const pending = registrationMode() === 'approval';
    const id = Number(
      db
        .prepare("INSERT INTO users (username, password_hash, role, created_at, status, discord_id, discord_name, discord_avatar, no_password) VALUES (?, ?, 'player', ?, ?, ?, ?, ?, 1)")
        .run(name, bcrypt.hashSync(crypto.randomBytes(24).toString('hex'), 4), Date.now(), pending ? 'pending' : 'active', me.id, dname, me.avatar ?? null).lastInsertRowid,
    );
    if (pending) return failTo(res, 'Заявка отправлена. Дождитесь одобрения администратора');
    const tok = issueToken({ id, username: name }, req);
    setSessionCookie(req, res, tok);
    noteLogin(req, id, brand().name);
    toHash(res, `auth/${tok}`);
  }),
);
