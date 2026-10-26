import express from 'express';
import type { NextFunction, Request, Response } from 'express';
import { registerAlerts } from './alerts.js';
import { admin, allow, auth, type AuthedRequest, avatarUrl, internal, isStaff, publicPanel, rateLimit, registrationOpen, staff, userFromToken, type UserFull, viewer } from './auth.js';
import { customAvatarUrl, registerAvatars } from './avatars.js';
import { registerBackups, startBackupTimer, stopBackups } from './backup.js';
import { bot, channelInfo } from './botState.js';
import { APP_VERSION, APP_VERSION_NAME, POLL_MS, PORT, SETUP_TOKEN } from './config.js';
import { registerCovers } from './covers.js';
import { db, getSetting, setSetting } from './db.js';
import { registerDeliveries } from './deliveries.js';
import { registerDiscordRegistration } from './discordRegister.js';
import { errorCodes } from './errors.js';
import { registerDigest, startDigestTimer } from './digest.js';
import { registerOg } from './ogImage.js';
import { registerServerChart } from './serverChart.js';
import { registerGames } from './games.js';
import { registerCustomGames } from './customGames.js';
import { startPoller, stopPoller } from './gsm.js';
import { registerHealth } from './health.js';
import { startDbMaintenance } from './dbMaintenance.js';
import { registerMetrics } from './metrics.js';
import { wrap } from './http.js';
import { registerMaintenance } from './maintenance.js';
import { registerStatusNotes } from './statusNotes.js';
import { registerNews } from './news.js';
import { registerNickStatus } from './nickOnboarding.js';
import { installAudit, registerOps } from './ops.js';
import { registerOverview } from './overview.js';
import { registerAttention } from './attention.js';
import { registerWelcome } from './welcome.js';
import { registerRules } from './rules.js';
import { registerPolls } from './polls.js';
import { logAccount, registerProfile } from './profile.js';
import { csrfGuard, registerSecurity, securityHeaders, windowLimiter } from './security.js';
import { embedFor, SELECT_SERVERS, SERVER_ORDER, serialize, type ServerJoin } from './serverData.js';
import { installShutdown, onShutdown, registerShutdownServer, shutdownNow } from './shutdown.js';
import { baseOf, brand, needsSetup, publicBase, registrationMode, rulesText } from './site.js';
import { registerSubscriptions } from './subscriptions.js';
import { registerPlayerFollows } from './playerFollows.js';
import { router as accountRouter } from './routes/account.js';
import { router as settingsRouter } from './routes/settings.js';
import { router as updatesRouter } from './routes/updates.js';
import { router as usersRouter } from './routes/users.js';
import { router as discordLoginRouter } from './routes/discordLogin.js';
import { router as serversRouter } from './routes/servers.js';
import { router as analyticsRouter } from './routes/analytics.js';
import { router as communityRouter } from './routes/community.js';
import { router as discordExtrasRouter } from './routes/discordExtras.js';
import { router as seasonsRouter } from './seasons.js';
import { router as reviewsRouter } from './reviews.js';
import { router as reportsRouter } from './reports.js';
import { router as galleryRouter } from './gallery.js';
import { router as restartsRouter, startRestartTimer, stopRestartTimer } from './restarts.js';
import { router as wipesRouter, startWipeTimer, stopWipeTimer } from './wipes.js';
import { router as newsCommentsRouter } from './newsComments.js';
import { router as newsViewsRouter } from './newsViews.js';
import { router as newsSubsRouter } from './newsSubs.js';
import { router as probesRouter } from './probes.js';
import { router as configRouter } from './configExport.js';
import { router as pushRouter } from './push.js';
import { router as bindingsRouter } from './routes/bindings.js';
import { router as internalRouter } from './routes/internal.js';
import { log } from './logger.js';

// optional first-start defaults from .env (the panel settings take over afterwards)
if (getSetting('discord_token') === null && process.env.DISCORD_TOKEN) setSetting('discord_token', process.env.DISCORD_TOKEN);
if (getSetting('proxy_url') === null && process.env.PROXY_URL) setSetting('proxy_url', process.env.PROXY_URL);

// A rejected promise nobody awaits is logged and the process keeps running (the poller and the bot should not stop
// because of one bad request). A synchronous exception that escaped everything means the state is unknown: stop
// cleanly and let Docker start a fresh process (restart: unless-stopped).
process.on('unhandledRejection', (reason) => {
  log.error('unhandled rejection:', reason instanceof Error ? (reason.stack ?? reason.message) : reason);
});
process.on('uncaughtException', (err) => {
  log.error('uncaught exception:', err.stack ?? err.message);
  void shutdownNow('uncaughtException');
});

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
app.use('/api/config/import', express.json({ limit: '2mb' }));
app.use(express.json({ limit: '50kb' }));
// Express 5 leaves req.body undefined when a request has no body (4 gave {}): the handlers parse it with zod objects
app.use((req, _res, next) => { if (req.body === undefined) req.body = {}; next(); });
installAudit(app);

registerMetrics(app);

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
app.use(discordExtrasRouter);
app.use(seasonsRouter);
app.use(reviewsRouter);
app.use(reportsRouter);
app.use(galleryRouter);
app.use(restartsRouter);
app.use(wipesRouter);
app.use(probesRouter);
app.use(configRouter);
app.use(pushRouter);
app.use(bindingsRouter);
app.use(internalRouter);

// before the news routes: /api/news/discussed and /api/news/comments/* must not be taken for /api/news/:id
app.use(newsCommentsRouter);
app.use(newsViewsRouter);
app.use(newsSubsRouter);

registerNews({
  app,
  publicBase,
  publicPanel,
  baseOf,
  brand: () => ({ name: brand().name, color: brand().color }),
  staff: allow('news'),
  auth,
  viewer,
  internal,
  channelInfo,
  isStaff,
  servers: () =>
    (db.prepare(`${SELECT_SERVERS} ORDER BY ${SERVER_ORDER}`).all() as ServerJoin[]).map(serialize).map((s) => ({
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
registerServerChart(app);
registerOg(app);
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
registerPlayerFollows({ app, auth, userId: (req) => (req as AuthedRequest).user!.id });
registerGames(app);
registerCustomGames({ app, admin });
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
registerCovers({ app, admin: allow('servers') });
registerOps({ app, admin, getBot: () => bot.status, guildCount: () => bot.guilds.length, version: APP_VERSION, versionName: APP_VERSION_NAME, pollMs: POLL_MS, publicBase });
registerBackups({ app, admin });
registerMaintenance({ app, admin: allow('maintenance'), viewer });
registerStatusNotes({ app, admin: allow('maintenance') });
registerHealth({ app, admin, bot: () => bot.status });
startDbMaintenance();
registerOverview({ app, viewer });
registerAttention({ app, admin });
registerWelcome({ app, admin, internal });
registerRules({ app, auth, admin });
registerPolls({ app, auth, admin, internal });

// ---------- errors ----------
app.use((err: Error & { type?: string; status?: number }, _req: Request, res: Response, _next: NextFunction) => {
  // body-parser: broken JSON / too large body are the client's mistake, not a server error
  if (err.type === 'entity.parse.failed') return void res.status(400).json({ error: 'Некорректный JSON в запросе' });
  if (err.type === 'entity.too.large') return void res.status(413).json({ error: 'Слишком большой запрос' });
  if (err.type === 'request.aborted' || err.type === 'encoding.unsupported' || err.type === 'charset.unsupported') return void res.status(400).json({ error: 'Некорректный запрос' });
  log.error(err);
  res.status(500).json({ error: 'Внутренняя ошибка сервера' });
});

const server = app.listen(PORT, () => {
  log.info(`CoreGSM backend listening on :${PORT}`);
  if (needsSetup()) {
    log.info('First run: open the panel in a browser and create the administrator.');
    if (!process.env.SETUP_TOKEN) log.info(`Setup code: ${SETUP_TOKEN}`);
  }
  startPoller(POLL_MS);
  startBackupTimer();
  startDigestTimer();
  startRestartTimer();
  startWipeTimer();
});
onShutdown('poller', stopPoller);
onShutdown('backups', stopBackups);
onShutdown('restarts', stopRestartTimer);
onShutdown('wipes', stopWipeTimer);
installShutdown(server);
registerShutdownServer(server);

