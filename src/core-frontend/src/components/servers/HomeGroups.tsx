import { useState } from 'react';
import { api, type Server } from '../../api';
import { useAuth } from '../../auth';
import { gameLabel } from '../../games';
import { connectGuide } from '../../connectGuides';
import { t, useI18n } from '../../i18n';
import { GameAvatar, ago, errText, toast } from '../../ui';
import { pingTone, TONE_TEXT } from '../server/helpers';
import { CapacityBar, durText, useQuickLongPress } from './serverUi';
import { QuickMenu } from './QuickMenu';

/** the servers that do not answer: one narrow red line each, above the cards */
export function DownStrip({ servers, since }: { servers: Server[]; since: Map<number, number> }) {
  useI18n();
  const { isAdmin } = useAuth();
  const [busy, setBusy] = useState<number | null>(null);
  const poll = async (id: number) => {
    setBusy(id);
    try { await api(`/servers/${id}/refresh`, 'POST'); toast(t('srv.hero.polled')); } catch (e) { toast(errText(e), 'err'); }
    setBusy(null);
  };
  if (servers.length === 0) return null;
  return (
    <ul className="home-down" aria-label={t('home.down.label')}>
      {servers.map((s) => {
        const from = since.get(s.id);
        return (
          <li key={s.id} className="home-down-row">
            <span className="home-down-dot" aria-hidden />
            <GameAvatar game={s.game} size={28} />
            <p className="min-w-0 flex-1">
              <a href={`/servers/${s.id}`} className="font-extrabold hover:underline">{s.name}</a>{' '}
              <span className="font-semibold">{from ? t('home.down.for', { d: durText(Date.now() - from) }) : t('home.down.noReply', { ago: ago(s.updatedAt) })}</span>
            </p>
            {isAdmin && <button type="button" className="btn btn-soft btn-sm" disabled={busy === s.id} onClick={() => void poll(s.id)}>{busy === s.id ? t('d2.sd.polling') : t('srv.hero.poll')}</button>}
            <QuickMenu s={s} />
          </li>
        );
      })}
    </ul>
  );
}

/** the servers that answer with nobody on: compact rows, so the full ones keep the room */
export function QuietList({ servers }: { servers: Server[] }) {
  useI18n();
  if (servers.length === 0) return null;
  return (
    <section className="home-quiet" aria-label={t('home.quiet.title')}>
      <h2 className="srv-grp">{t('home.quiet.title')} <span className="text-mute">{servers.length}</span></h2>
      <ul className="home-quiet-list">
        {servers.map((s) => (
          <li key={s.id} className="home-quiet-row">
            <GameAvatar game={s.game} size={32} />
            <span className="min-w-0 flex-1">
              <a href={`/servers/${s.id}`} className="home-quiet-link block truncate font-extrabold">{s.name}</a>
              <span className="block truncate text-xs font-semibold text-mute">{gameLabel(s.game)}</span>
            </span>
            {s.ping != null && <span className={`shrink-0 text-fs-sm font-bold ${TONE_TEXT[pingTone(s.ping).tone]}`}>{t('d2.bot.ms', { n: s.ping })}</span>}
            <span className="shrink-0 text-fs-sm font-bold tabular-nums text-mute">0/{s.maxPlayers}</span>
            <span className="relative z-10 shrink-0"><QuickMenu s={s} /></span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** the big card of a phone: one tall row with the name, the places and the way in */
export function HeroRow({ s, label }: { s: Server; label: string }) {
  useI18n();
  const play = connectGuide(s.game, s.address).link;
  const { swallow, ...lp } = useQuickLongPress();
  return (
    // the click that ends a long touch must not open the server
    <article {...lp} className="home-hero-row" onClickCapture={(e) => { if (swallow()) { e.preventDefault(); e.stopPropagation(); } }}>
      <GameAvatar game={s.game} size={48} />
      <div className="min-w-0 flex-1">
        {label && <span className="home-hero-label">{label}</span>}
        <h2 className="line-clamp-2 wrap-break-word text-fs-lg font-extrabold leading-tight" title={s.name}>
          <a href={`/servers/${s.id}`} className="home-quiet-link">{s.name}</a>
        </h2>
        {s.online
          ? <CapacityBar className="mt-1.5" players={s.players} max={s.maxPlayers} color="rgb(var(--brand))" showPct={false} slots={false} />
          : <p className="text-fs-sm font-semibold text-bad">{t('d2.srv.noReplyAgo', { ago: ago(s.updatedAt) })}</p>}
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1.5">
        <b className="text-fs-xl font-extrabold leading-none tabular-nums">{s.online ? <>{s.players}<span className="text-fs-sm text-mute">/{s.maxPlayers}</span></> : '–'}</b>
        {s.online && play && <a className="btn btn-sm relative z-10" href={play.href}>{t('home.play')}</a>}
      </div>
      <span className="srv-row-qm" aria-hidden><QuickMenu s={s} /></span>
    </article>
  );
}
