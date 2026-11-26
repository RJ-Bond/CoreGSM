/** The cards of the server list: the big one, the tile, the row of a phone, and what they share. */
import { useState, type CSSProperties, type MouseEvent } from 'react';
import { nextUsualPeak } from './heroLogic';
import { useBaseline } from './useBaseline';
import { api, type Server } from '../../api';
import { useAuth } from '../../auth';
import { gameColor, gameGradient, gameLabel } from '../../games';
import { coverBackground, emblemStyle, gameBackdrop, coverUrlOf } from '../../cover';
import MaintenanceChip from '../MaintenanceChip';
import { AnimatedNumber, Burst, GameAvatar, Spark, StatusPill, ago, isLag, spanCaption, useSparkSpanMin, toast, fmtTime, errText, useDayStats } from '../../ui';
import { connectGuide } from '../../connectGuides';
import { t, useI18n } from '../../i18n';
import { calmSeriesColor, useCoverAccent } from '../server/coverAccent';
import { pingTone, TONE_TEXT } from '../server/helpers';
import { AddrCopy, PlayerStack, CapacityBar, useQuickLongPress, CountReact, PingBars, PlayerNames, StatusFlash, TrendChip, durText, reactionOf, type Reactions } from './serverUi';
import { type SelectProps } from './ServerViews';
import { QuickMenu } from './QuickMenu';
import { type HeroReason } from './overviewLogic';
import { CardClock, CardMap, CardRefresh, CardTag, CardUptime } from './CardIcons';

/** staggered entrance: the tile number goes to the --i custom property */
export const stagger = (i: number): CSSProperties => ({ ['--i' as string]: i });

/** `className` colours the star; `glass` is the variant for covers (white star on a translucent disc) */
export function FavButton({ on, name, onClick, className = '', glass = false }: { on: boolean; name: string; onClick: () => void; className?: string; glass?: boolean }) {
  useI18n();
  // the star pops (scale, tilt and a few sparks) only after the user's own click, not when the list loads
  const [pops, setPops] = useState(0);
  return (
    <button
      onClick={(e) => { e.stopPropagation(); if (!on) setPops((n) => n + 1); onClick(); }}
      className={`${glass ? 'btn-icon-glass btn-icon-sm' : 'btn-icon-ghost btn-icon-sm'} ${on ? '' : 'star-quiet'}`}
      title={on ? t('d2.srv.favRemove') : t('d2.srv.fav')}
      aria-label={t('d2.srv.favName', { name })}
      aria-pressed={on}
    >
      <span className={`star-wrap text-xl leading-none ${className}`}>
        <span key={on ? pops : 'off'} className={on && pops > 0 ? 'star-pop' : ''} aria-hidden>{on ? '★' : '☆'}</span>
        {on && pops > 0 && <Burst key={pops} count={6} radius={15} />}
      </span>
    </button>
  );
}

export type TileDnd = React.HTMLAttributes<HTMLElement> & { 'data-tile-id'?: number };
export const ORDER_KEY = 'coregsm_srv_order';
export const readOrder = (): number[] => {
  try { const v = JSON.parse(localStorage.getItem(ORDER_KEY) ?? '[]') as unknown; return Array.isArray(v) ? v.filter((x): x is number => Number.isInteger(x)) : []; } catch { return []; }
};
export const saveOrder = (ids: number[]) => { try { localStorage.setItem(ORDER_KEY, JSON.stringify(ids)); } catch { /* not remembered */ } };

/** the checkbox of the selection mode in a corner of a card */
export function CardCheck({ s, select, className = '' }: { s: Server; select: SelectProps; className?: string }) {
  useI18n();
  return (
    <input
      type="checkbox"
      className={`srv-check srv-check-card ${className}`}
      checked={select.has(s.id)}
      onChange={() => select.toggle(s.id)}
      onClick={(e) => e.stopPropagation()}
      aria-label={t('d2.news.pickOne', { title: s.name })}
    />
  );
}

/** in the selection mode a link toggles the card instead of leaving the page */
export const linkClick = (s: Server, select?: SelectProps) => (e: MouseEvent<HTMLElement>) => {
  e.stopPropagation();
  if (select?.on) {
    e.preventDefault();
    select.toggle(s.id);
  }
};

export function HeroTile({ s, idx, uptime, downSince, fav, onFav, onOpen, rx, reason, select }: { rx: Reactions; s: Server; idx: number; uptime?: number; downSince?: number; fav: boolean | null; onFav: () => void; onOpen: () => void; reason: HeroReason; select?: SelectProps }) {
  const sparkSpan = useSparkSpanMin(s.id);
  useI18n();
  const [c1] = gameGradient(s.game);
  const lag = isLag(s);
  const r = reactionOf(rx, s.id);
  const emb = emblemStyle(s.coverUrl, s.game);
  const cover = coverUrlOf(s.coverUrl, s.game, false);
  const { swallow, ...lp } = useQuickLongPress();
  const { isAdmin } = useAuth();
  const baseline = useBaseline(s.id);
  const peak = s.online ? nextUsualPeak(baseline, Date.now()) : null;
  const play = connectGuide(s.game, s.address).link;
  const full = s.online && s.maxPlayers > 0 && s.players / s.maxPlayers >= 0.9;
  const [polling, setPolling] = useState(false);
  const pollNow = async (e: MouseEvent<HTMLElement>) => {
    e.stopPropagation();
    setPolling(true);
    try { await api(`/servers/${s.id}/refresh`, 'POST'); toast(t('srv.hero.polled')); } catch (err) { toast(errText(err), 'err'); }
    setPolling(false);
  };
  return (
    <article
      {...lp}
      className={`hero3 tile-in tile-hover relative cursor-pointer overflow-hidden rounded-ui-xl text-white shadow-soft ${s.online ? '' : 'is-down'} ${reason === 'attention' ? 'hero-attn' : ''} ${full ? 'is-full' : ''} ${s.online && lag ? 'is-lag' : ''}`}
      style={{
        ...stagger(idx),
        ['--gc' as string]: gameColor(s.game),
        boxShadow: `${select?.has(s.id) ? '0 0 0 3px rgb(var(--brand)), ' : reason === 'attention' ? `0 0 0 3px rgb(var(${s.online ? '--warn' : '--bad'}) / .85), ` : ''}0 1px 2px rgba(20,24,40,.06), 0 18px 40px -16px ${c1}66`,
      }}
      onClick={select?.on ? () => select.toggle(s.id) : () => { if (!swallow()) onOpen(); }}
    >
      {select?.on && <CardCheck s={s} select={select} className="left-2 top-2" />}

      <div className="h3-l">
        <div className="h3-head flex items-start gap-3">
          <GameAvatar game={s.game} size={46} glass vtId={s.id} />
          <div className="min-w-0 flex-1">
            {reason && reason !== 'attention' && <span className="hero-reason">{t(`srv.hero.${reason}` as const)}</span>}
            <h2 className="line-clamp-2 wrap-break-word text-xl font-extrabold leading-tight" title={s.name}>
              <a href={`/servers/${s.id}`} onClick={linkClick(s, select)} className="hover:underline">{s.name}</a>
            </h2>
            <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-fs-sm font-bold text-white/85">
              <span>{gameLabel(s.game)}</span>
              <span aria-hidden>·</span>
              <AddrCopy address={s.address} className="truncate font-mono text-xs font-semibold" />
            </div>
            {s.maintenance && <MaintenanceChip m={s.maintenance} glass className="mt-1.5" />}
          </div>
        </div>

        {s.online ? (
          <>
            <div className="h3-figs">
            <div className={`h3-count flex flex-wrap items-baseline gap-x-2.5 gap-y-1 ${s.players === 0 ? 'is-zero' : ''}`}>
              <CountReact r={r} onDark><AnimatedNumber value={s.players} className="text-[72px] font-extrabold leading-none tracking-[-0.05em] sm:text-[88px]" /></CountReact>
              <span className="text-lg font-bold text-white/85">/ {t('d2.srv.nPlayers', { n: s.maxPlayers })}</span>
            </div>
            <div className="h3-sub flex flex-wrap items-center gap-x-4 gap-y-1">
              <TrendChip serverId={s.id} onDark />
              {s.ping != null && <span className="inline-flex items-center gap-1.5 font-bold text-white/90"><PingBars ping={s.ping} tone={pingTone(s.ping).tone} />{t('d2.srv.ping', { ms: s.ping })}</span>}
              {peak && <span className="hero-peak" title={t('srv.hero.peakTip', { n: peak.value })}>{peak.now ? t('srv.hero.peakNow') : t('srv.hero.peakAt', { time: fmtTime(peak.at), h: peak.hoursAhead })}</span>}
            </div>
            </div>
            <CapacityBar className="h3-bar" players={s.players} max={s.maxPlayers} color="#fff" onDark slots={false} />
            <div className="h3-row">
              {play && <a className="btn h3-play" href={play.href} onClick={(e) => e.stopPropagation()}>{play.label}</a>}
              <PlayerNames names={s.playerNames ?? []} max={4} onDark />
            </div>
          </>
        ) : (
          // a server that is down: what is wrong and since when, instead of the figures
          <div className="h3-down rounded-2xl bg-white/10 px-4 py-3" title={s.error ?? undefined}>
            {s.hasStatus ? (
              <>
                <p className="line-clamp-3 text-base font-extrabold leading-snug">{s.error ?? t('d2.srv.noReply')}</p>
                <p className="mt-1 text-sm font-semibold text-white/80">{downSince ? t('srv.down.for', { d: durText(Date.now() - downSince) }) + ' · ' : ''}{t('d2.srv.lastReply', { ago: ago(s.updatedAt) })}</p>
              </>
            ) : (
              <p className="text-base font-extrabold">{t('d2.srv.waitFirst')}</p>
            )}
          </div>
        )}

        <div className="h3-foot flex flex-wrap items-center text-fs-sm font-bold text-white/80">
          <span className="h3-fact"><CardClock />{spanCaption(sparkSpan)}</span>
          {uptime != null && <span className="h3-fact"><CardUptime />{t('d2.srv.uptime', { v: (Math.round(uptime * 10) / 10).toLocaleString('ru-RU') })}</span>}
          {s.online && s.map && <span className="h3-fact"><CardMap />{t('d2.srv.map', { map: s.map })}</span>}
          {s.version && <span className="h3-fact"><CardTag />v{s.version}</span>}
          {!s.online && <span className="h3-fact"><CardRefresh />{t('d2.srv.updated', { ago: ago(s.updatedAt) })}</span>}
        </div>
      </div>

      <div
        className={`h3-r ${emb.className ? 'emblem-host' : ''}`}
        style={{ ...emb.style, ['--h3-cover' as string]: cover ? `url("${cover}")` : 'none', ['--h3-fallback' as string]: gameBackdrop(c1) }}
      >
        {emb.className && <span aria-hidden className="emblem-layer" />}
        <div className="h3-actions flex items-center gap-1">
          <StatusFlash r={r}><StatusPill glass online={s.online} known={s.hasStatus} lag={lag} maintenance={!!s.maintenance} /></StatusFlash>
          {fav != null && <FavButton on={fav} name={s.name} onClick={onFav} className={fav ? 'text-white' : 'text-white/80'} glass />}
          <QuickMenu s={s} glass />
        </div>
        {s.online ? (
          <div className="h3-chart">
            <Spark serverId={s.id} color="#ffffff" variant="hero" />
          </div>
        ) : (
          <div className="h3-downpane">
            <span className="h3-down-k">{t('srv.down.k')}</span>
            <b className="h3-down-v">{downSince ? durText(Date.now() - downSince) : ago(s.updatedAt)}</b>
            <span className="h3-down-s">{t('srv.down.last', { ago: ago(s.updatedAt) })}</span>
            {isAdmin && <button type="button" className="btn btn-glass btn-sm" disabled={polling} onClick={(e) => void pollNow(e)}>{polling ? t('d2.sd.polling') : t('srv.hero.poll')}</button>}
          </div>
        )}
      </div>
    </article>
  );
}

/** the phone version of a tile: one row (emblem, name with a thin bar, players, status dot) at least 56 px high */
export function PhoneRow({ s, idx, fav, onFav, onOpen, select }: { rx: Reactions; s: Server; idx: number; fav: boolean | null; onFav: () => void; onOpen: () => void; select?: SelectProps; uptime?: number; downSince?: number }) {
  useI18n();
  const lag = isLag(s);
  const tone = !s.hasStatus ? 'bg-mute' : !s.online ? 'bg-bad' : lag || s.maintenance ? 'bg-warn' : 'bg-ok';
  const { swallow, ...lp } = useQuickLongPress();
  return (
    <article
      {...lp}
      className={`srv-row tile-in relative ${select?.has(s.id) ? 'srv-selected' : ''} ${s.online ? '' : 'is-down'}`}
      style={stagger(idx)}
      onClick={select?.on ? () => select.toggle(s.id) : () => { if (!swallow()) onOpen(); }}
    >
      {select?.on && <CardCheck s={s} select={select} className="left-1 top-1" />}
      <GameAvatar game={s.game} size={40} vtId={s.id} />
      <div className="srv-row-main">
        <h3 className="text-fs-base font-extrabold leading-tight" title={s.name}>
          <a href={`/servers/${s.id}`} onClick={linkClick(s, select)}>{s.name}</a>
        </h3>
        {s.online ? (
          <CapacityBar className="srv-row-bar" players={s.players} max={s.maxPlayers} color="rgb(var(--ink) / .5)" showPct={false} slots={false} />
        ) : (
          <p className="truncate text-fs-sm font-semibold text-mute">{s.hasStatus ? t('d2.srv.noReplyAgo', { ago: ago(s.updatedAt) }) : t('d2.srv.waitFirst')}</p>
        )}
      </div>
      <div className="srv-row-count">
        {s.online ? <><b>{s.players}</b><span>/{s.maxPlayers}</span></> : <span>–</span>}
      </div>
      <span className={`srv-row-dot ${tone}`} aria-hidden />
      {fav != null && <FavButton on={fav} name={s.name} onClick={onFav} className={fav ? 'text-warn' : 'text-mute'} />}
      {/* the menu that a long touch opens: out of sight, its button is pressed by the touch handler */}
      <span className="srv-row-qm" aria-hidden><QuickMenu s={s} /></span>
    </article>
  );
}

/** a server with nobody on it: not a grey zero and an empty bar, but when somebody was last there, the peak of the day and when it usually fills up */
export function EmptyNow({ s, accent }: { s: Server; accent?: string }) {
  useI18n();
  const day = useDayStats(s.id);
  const baseline = useBaseline(s.id);
  const usual = nextUsualPeak(baseline, Date.now(), 24);
  return (
    <div className="srv-empty px-1.5">
      <div className="srv-empty-head">
        <b><i aria-hidden />{t('srv.empty.title')}<small>/ {s.maxPlayers}</small></b>
        {s.ping != null && <span className={`inline-flex items-center gap-1.5 text-fs-sm font-bold ${TONE_TEXT[pingTone(s.ping).tone]}`}><i className={`ping-dot ${pingTone(s.ping).tone}`} aria-hidden />{t('d2.bot.ms', { n: s.ping })}</span>}
      </div>
      <CapacityBar className="mt-1" players={0} max={s.maxPlayers} color="rgb(var(--ink) / .5)" slots={false} />
      <ul>
        {day.known && <li>{day.lastActiveMin == null ? t('srv.empty.noneDay') : t('srv.empty.last', { d: durText(Math.max(1, day.lastActiveMin) * 60_000) })}</li>}
        {day.known && day.peak > 0 && <li>{t('srv.empty.peak', { n: day.peak })}</li>}
        {usual && !usual.now && <li>{t('srv.empty.usual', { time: fmtTime(usual.at) })}</li>}
      </ul>
      {accent && <div className="srv-spark-wrap" title={t('srv.spark.hint')}><Spark serverId={s.id} color={accent} /></div>}
    </div>
  );
}

export function SmallTile({ s, idx, fav, onFav, onOpen, rx, select, uptime, downSince, dnd, wide }: { dnd?: TileDnd; wide?: number; rx: Reactions; s: Server; idx: number; fav: boolean | null; onFav: () => void; onOpen: () => void; select?: SelectProps; uptime?: number; downSince?: number }) {
  useI18n();
  const [who, setWho] = useState(false);
  const [c1] = gameGradient(s.game);
  // the accent is taken from the cover picture, so two games of the same colour family still look different
  const accent = calmSeriesColor(useCoverAccent(s.coverUrl, gameColor(s.game)), gameColor(s.game));
  const lag = isLag(s);
  const r = reactionOf(rx, s.id);
  const emb = emblemStyle(s.coverUrl, s.game);
  const nearFull = s.online && s.maxPlayers > 0 && s.players / s.maxPlayers >= 0.8;
  // as many people as at the busiest moment of the day (a real crowd, not two players on a quiet server)
  const dayStats = useDayStats(s.id);
  const atPeak = s.online && dayStats.known && dayStats.peak >= 5 && s.players >= dayStats.peak;
  const { swallow, ...lp } = useQuickLongPress();
  const { isAdmin } = useAuth();
  const unnamed = s.name === s.address || s.name === `${s.host}:${s.port}`;
  const play = connectGuide(s.game, s.address).link;
  const [polling, setPolling] = useState(false);
  const pollNow = async (e: MouseEvent<HTMLElement>) => {
    e.stopPropagation();
    setPolling(true);
    try { await api(`/servers/${s.id}/refresh`, 'POST'); toast(t('srv.hero.polled')); } catch (err) { toast(errText(err), 'err'); }
    setPolling(false);
  };
  const planned = async (e: MouseEvent<HTMLElement>) => {
    e.stopPropagation();
    setPolling(true);
    const now = Date.now();
    try { await api('/maintenance', 'POST', { serverId: s.id, name: t('srv.planned.name'), startTs: now, endTs: now + 3_600_000, repeat: 'none' }); toast(t('srv.planned.done')); } catch (err) { toast(errText(err), 'err'); }
    setPolling(false);
  };
  return (
    <article
      {...dnd}
      {...lp}
      className={`srv-tile tile tile-in tile-hover relative flex cursor-pointer flex-col gap-2 p-3 pb-4 ${select?.has(s.id) ? 'srv-selected' : ''} ${s.online ? '' : 'is-down'} ${nearFull ? 'is-busy' : ''} ${s.online && lag ? 'is-lag' : ''} ${wide && wide > 1 ? 'srv-wide' : ''}`}
      // the fuller the server, the stronger its glow in the game's colour
      style={{ ...stagger(idx), ...(wide && wide > 1 ? { gridColumn: `span ${wide}` } : {}), ['--gc' as string]: accent, ['--fill' as string]: s.online && s.maxPlayers > 0 ? Math.min(1, s.players / s.maxPlayers).toFixed(2) : '0' }}
      onClick={select?.on ? () => select.toggle(s.id) : () => { if (!swallow()) onOpen(); }}
    >
      {select?.on && <CardCheck s={s} select={select} className="left-1 top-1" />}
      <div className={`${emb.className} relative flex h-[124px] items-start justify-between rounded-ui-lg p-3 ${s.online ? '' : 'offline-cover'}`} style={{ ...emb.style, background: coverBackground(s.coverUrl, gameBackdrop(c1, 135), { small: true, game: s.game }) }}>
        <span aria-hidden className="cover-scrim" />
        <GameAvatar game={s.game} size={46} glass vtId={s.id} />
        <div className="srv-cover-actions flex items-center gap-0.5">
          <StatusFlash r={r}><StatusPill glass online={s.online} known={s.hasStatus} lag={lag} maintenance={!!s.maintenance} /></StatusFlash>
          {fav != null && <FavButton on={fav} name={s.name} onClick={onFav} className={fav ? 'text-white' : 'text-white/85'} glass />}
          <QuickMenu s={s} glass />
        </div>
        {/* the way in without opening the server: shown under the pointer (and by the keyboard), not on a phone */}
        <div className="srv-hover-actions">
          {s.online && play && <a className="btn btn-glass btn-sm" href={play.href} title={play.label} onClick={(e) => e.stopPropagation()}>{t('home.play')}</a>}
        </div>
        {s.online && <CapacityBar className="srv-cover-cap" players={s.players} max={s.maxPlayers} color="rgb(var(--brand))" showPct={false} slots={false} onDark />}
      </div>

      <div className="px-1.5">
        <h3 className="srv-name text-fs-lg font-extrabold leading-tight" title={s.name}>
          <a href={`/servers/${s.id}`} onClick={linkClick(s, select)} className={unnamed ? 'srv-unnamed hover:text-link' : 'hover:text-link'} title={unnamed && isAdmin ? t('srv.unnamed.tip') : undefined}>{unnamed ? t('srv.unnamed') : s.name}</a>
        </h3>
        <div className="srv-chips">{nearFull && <span className="srv-badge-full" title={t('srv.cap.nearFull', { pct: Math.round((s.players / s.maxPlayers) * 100) })}>{t('srv.tile.full')}</span>}<span className="srv-game truncate">{gameLabel(s.game)}</span>{s.online && s.map && <span className="srv-chip" title={t('d2.srv.mapTitle', { map: s.map })}><CardMap />{s.map}</span>}{s.version && <span className="srv-chip" title={t('d2.srv.version')}><CardTag />v{s.version}</span>}</div>
        {s.maintenance && <MaintenanceChip m={s.maintenance} className="mt-1" />}
      </div>

      {s.online && s.players === 0 ? (
        <EmptyNow s={s} accent={accent} />
      ) : s.online ? (
        <>
          <div className={`srv-count flex items-baseline gap-1.5 px-1.5 ${s.players === 0 ? 'srv-zero' : ''}`}>
            <CountReact r={r}><AnimatedNumber value={s.players} className="text-[38px] font-extrabold leading-none tracking-[-0.03em]" /></CountReact>
            <span className="text-fs-xl font-bold text-mute">/ {s.maxPlayers}</span>
            <TrendChip serverId={s.id} />
            {atPeak && <span className="srv-peak-chip" title={t('srv.tile.dayPeakHint', { n: dayStats.peak })}>★ {t('srv.tile.dayPeak')}</span>}
            {(s.playerNames?.length ?? 0) > 0 && <button type="button" className="srv-who" aria-label={t('srv.who')} title={t('srv.who')} aria-expanded={who} onClick={(e) => { e.stopPropagation(); setWho((v) => !v); }}>{(s.playerNames?.length ?? 0) === 1 ? <span className="srv-who-one">{s.playerNames[0]}</span> : <PlayerStack names={s.playerNames ?? []} />}</button>}
            <span className={`ml-auto inline-flex items-center gap-1.5 text-fs-sm font-bold ${s.ping != null ? TONE_TEXT[pingTone(s.ping).tone] : 'text-mute'}`} title={s.ping != null ? t('d2.srv.ping', { ms: s.ping }) : undefined}>{s.ping != null && <><i className={`ping-dot ${pingTone(s.ping).tone}`} aria-hidden />{t('d2.bot.ms', { n: s.ping })}</>}</span>
          </div>
          {who && <PlayerNames className="px-1.5" names={s.playerNames ?? []} max={12} />}
          {s.players === 0
            ? <p className="srv-empty-now"><i aria-hidden />{t('srv.empty.now')}</p>
            : <div className="srv-spark-wrap px-1.5" title={t('srv.spark.hint')}><Spark serverId={s.id} color={accent} /></div>}
        </>
      ) : (
        s.hasStatus ? (
          <>
            <div className="srv-down mx-1.5" title={s.error ?? undefined}>
              <span className="srv-down-k"><i aria-hidden />{t('srv.down.k')}</span>
              <b className="srv-down-v">{downSince ? durText(Date.now() - downSince) : ago(s.updatedAt)}</b>
              <span className="srv-down-s">{downSince ? t('srv.down.since', { when: new Date(downSince).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) }) + ' · ' : ''}{t('srv.down.last', { ago: ago(s.updatedAt) })}</span>
              {isAdmin && <button type="button" className="btn btn-soft btn-sm srv-down-btn" disabled={polling} onClick={(e) => void pollNow(e)}>{polling ? t('d2.sd.polling') : t('srv.hero.poll')}</button>}
              {isAdmin && <button type="button" className="btn btn-soft btn-sm srv-down-btn" disabled={polling} title={t('srv.planned.hint')} onClick={(e) => void planned(e)}>{t('srv.planned.btn')}</button>}
            </div>
            <div className="srv-off-fig px-1.5" aria-hidden><b>{t('srv.off.fig')}</b><i /></div>
          </>
        ) : (
          <div className="mx-1.5 rounded-xl bg-soft px-3 py-2.5 text-fs-sm font-bold text-mute">{t('d2.srv.waitFirst')}</div>
        )
      )}

      <div className="mt-auto flex items-center justify-between gap-2 px-1.5 pt-1 text-xs font-bold text-mute">
        <AddrCopy address={s.address} className="min-w-0 font-mono" reveal />
        <span className="flex shrink-0 items-center gap-2">
          {uptime != null && <span className={`srv-up ${uptime >= 99 ? 'ok' : uptime >= 95 ? 'warn' : 'bad'}`} title={t('d2.srv.uptime30')}><small className="srv-up-l">{t('srv.up.label')}</small> {(Math.round(uptime * 10) / 10).toLocaleString('ru-RU')}%</span>}
          {s.online ? (s.updatedAt != null && Date.now() - s.updatedAt > 120_000 ? ago(s.updatedAt) : '') : ago(s.updatedAt)}
        </span>
      </div>
    </article>
  );
}
