import express from 'express';
import type { NextFunction, Request, Response } from 'express';
import { registerAlerts } from './alerts.js';
import { admin, auth, type AuthedRequest, avatarUrl, internal, isStaff, rateLimit, registrationOpen, staff, userFromToken, type UserFull, viewer } from './auth.js';
import { customAvatarUrl, registerAvatars } from './avatars.js';
import { registerBackups, startBackupTimer, stopBackups } from './backup.js';
import { bot, channelInfo } from './botState.js';
import { APP_VERSION, POLL_MS, PORT, SETUP_TOKEN } from './config.js';
import { registerCovers } from './covers.js';
import { db, getSetting, setSetting } from './db.js';
import { registerDeliveries } from './deliveries.js';
import { registerDiscordRegistration } from './discordRegister.js';
import { errorCodes } from './errors.js';
import { registerDigest, startDigestTimer } from './digest.js';
import { registerGames } from './games.js';
import { startPoller, stopPoller } from './gsm.js';
import { registerHealth } from './health.js';
import { wrap } from './http.js';
import { registerMaintenance } from './maintenance.js';
import { registerNews } from './news.js';
import { registerNickStatus } from './nickOnboarding.js';
import { installAudit, registerOps } from './ops.js';
import { registerOverview } from './overview.js';
import { logAccount, registerProfile } from './profile.js';
import { csrfGuard, registerSecurity, securityHeaders, windowLimiter } from './security.js';
import { embedFor, SELECT_SERVERS, serialize, type ServerJoin } from './serverData.js';
import { installShutdown, onShutdown } from './shutdown.js';
import { baseOf, brand, needsSetup, publicBase, registrationMode, rulesText } from './site.js';
import { registerSubscriptions } from './subscriptions.js';
import { router as accountRouter } from './routes/account.js';
import { router as settingsRouter } from './routes/settings.js';
import { router as updatesRouter } from './routes/updates.js';
import { router as usersRouter } from './routes/users.js';
import { router as discordLoginRouter } from './routes/discordLogin.js';
import { router as serversRouter } from './routes/servers.js';
import { router as analyticsRouter } from './routes/analytics.js';
import { router as communityRouter } from './routes/community.js';
import { router as bindingsRouter } from './routes/bindings.js';
import { router as internalRouter } from './routes/internal.js';

// optional first-start defaults from .env (the panel settings take over afterwards)
if (getSetting('discord_token') === null && process.env.DISCORD_TOKEN) setSetting('discord_token', process.env.DISCORD_TOKEN);
if (getSetting('proxy_url') === null && process.env.PROXY_URL) setSetting('proxy_url', process.env.PROXY_URL);

const app = express();
// One trusted proxy hop (the nginx container): req.ip / req.secure come from the X-Forwarded-For / X-Forwarded-Proto it
// writes. The backend port is not published, so clients cannot spoof them; keep it that way (see security.ts).
app.set('trust proxy', 1);
app.disable('x-powered-by');
// error answers get a stable code next to the Russian text (errors.ts)
app.use(errorCodes);
app.use(securityHeaders);
// a cookie-authenticated state-changing request must carry X-CoreGSM (CSRF guard)
app.use('/api', csrfGuard);
// public player pages: a coarse per-address ceiling on top of the route's own limiter
app.use('/api/u', windowLimiter(120, 60_000));
app.use('/internal/bot-guilds', express.json({ limit: '2mb' }));
app.use(express.json({ limit: '50kb' }));
installAudit(app);

app.get('/api/health', (_req, res) => {
  res.json({ ok: true });
});

// the order matters only where paths overlap; it is the order the routes had in one file
app.use(accountRouter);
app.use(settingsRouter);
app.use(updatesRouter);
app.use(usersRouter);
app.use(discordLoginRouter);
app.use(serversRouter);
app.use(analyticsRouter);
app.use(communityRouter);
app.use(bindingsRouter);
app.use(internalRouter);

registerNews({
  app,
  staff,
  auth,
  viewer,
  internal,
  channelInfo,
  isStaff,
  servers: () =>
    (db.prepare(`${SELECT_SERVERS} ORDER BY s.id`).all() as ServerJoin[]).map(serialize).map((s) => ({
      id: s.id,
      name: s.name,
      players: s.players,
      maxPlayers: s.maxPlayers,
      online: s.online,
      address: s.address,
      map: s.map,
      ping: s.ping,
    })),
  statusEmbed: (id) => embedFor(id, 60),
});
registerAlerts({ app, admin, internal, channelInfo });
registerDigest({ app, admin });
registerSecurity({
  app,
  admin,
  auth,
  userId: (req) => (req as AuthedRequest).user!.id,
  userFromToken,
  publicBase,
  baseOf,
  brandName: () => brand().name,
});
registerDeliveries({ app, admin, internal });
registerSubscriptions({ app, auth, userId: (req) => (req as AuthedRequest).user!.id, canDm: () => bot.status.state === 'online' });
registerGames(app);
registerAvatars({ app, auth, userId: (req) => (req as AuthedRequest).user!.id, onChange: (req, id, what) => logAccount(req, id, 'avatar_changed', what) });
registerProfile({
  app,
  auth,
  rateLimit,
  userId: (req) => (req as AuthedRequest).user!.id,
  avatarOf: (id) => {
    const u = db.prepare('SELECT * FROM users WHERE id = ?').get(id) as UserFull | undefined;
    return customAvatarUrl(id) ?? (u ? avatarUrl(u) : null);
  },
});
registerDiscordRegistration({ app, internal, wrap, publicBase, registrationOpen, registrationMode, rulesText });
registerNickStatus({ app, auth, userId: (req) => (req as AuthedRequest).user!.id });
registerCovers({ app, admin });
registerOps({ app, admin, getBot: () => bot.status, guildCount: () => bot.guilds.length, version: APP_VERSION, pollMs: POLL_MS, publicBase });
registerBackups({ app, admin });
registerMaintenance({ app, admin, viewer });
registerHealth({ app, admin, bot: () => bot.status });
registerOverview({ app, viewer });

// ---------- errors ----------
app.use((err: Error & { type?: string; status?: number }, _req: Request, res: Response, _next: NextFunction) => {
  // body-parser: broken JSON / too large body are the client's mistake, not a server error
  if (err.type === 'entity.parse.failed') return void res.status(400).json({ error: 'Некорректный JSON в запросе' });
  if (err.type === 'entity.too.large') return void res.status(413).json({ error: 'Слишком большой запрос' });
  if (err.type === 'request.aborted' || err.type === 'encoding.unsupported' || err.type === 'charset.unsupported') return void res.status(400).json({ error: 'Некорректный запрос' });
  console.error(err);
  res.status(500).json({ error: 'Внутренняя ошибка сервера' });
});

const server = app.listen(PORT, () => {
  console.log(`CoreGSM backend listening on :${PORT}`);
  if (needsSetup()) {
    console.log('First run: open the panel in a browser and create the administrator.');
    if (!process.env.SETUP_TOKEN) console.log(`Setup code: ${SETUP_TOKEN}`);
  }
  startPoller(POLL_MS);
  startBackupTimer();
  startDigestTimer();
});
onShutdown('poller', stopPoller);
onShutdown('backups', stopBackups);
installShutdown(server);

