import { useEffect, useState, type ReactNode } from 'react';
import { api, ApiError, type PublicProfile } from '../api';
import { useAuth } from '../auth';
import { AchievementArt } from '../components/profile/icons';
import { IcoCalendar, IcoClock, IcoFlame, IcoGamepad, IcoHeart, IcoPlay, ShareButton, StatTile } from '../components/profile/bits';
import { NotFoundArt } from '../components/Illustrations';
import { RankEmblem, rankName, vrAchText } from '../components/profile/VrRank';
import { bannerStyle } from '../components/profile/banner';
import { fmtDuration } from '../components/profile/format';
import { t, useI18n } from '../i18n';
import { Empty, fmtDate, Section, UserAvatar } from '../ui';

type State = { kind: 'loading' } | { kind: 'ok'; p: PublicProfile } | { kind: 'missing' } | { kind: 'error'; text: string };

/** the first `limit` items; a button opens the rest */
function Folded({ items, limit = 8 }: { items: ReactNode[]; limit?: number }) {
  const [all, setAll] = useState(false);
  const shown = all ? items : items.slice(0, limit);
  return (
    <>
      <ul className="flex flex-wrap gap-2">{shown}</ul>
      {items.length > limit && (
        <button type="button" className="btn btn-soft btn-sm mt-3" onClick={() => setAll((v) => !v)} aria-expanded={all}>
          {all ? t('pub.less') : t('pub.more', { k: items.length - limit })}
        </button>
      )}
    </>
  );
}

/** /u/<username>: the public page of a player. Works without signing in; a private or unknown profile gives a 404 state. */
export default function PublicProfilePage({ username }: { username: string }) {
  const { me } = useAuth();
  useI18n();
  const [state, setState] = useState<State>({ kind: 'loading' });

  useEffect(() => {
    let stale = false;
    setState({ kind: 'loading' });
    api<PublicProfile>(`/u/${encodeURIComponent(username)}`)
      .then((p) => { if (!stale) setState(p && typeof p === 'object' && p.username ? { kind: 'ok', p } : { kind: 'missing' }); })
      .catch((e: unknown) => {
        if (stale) return;
        // 404 (private or no such user) is a normal state; anything else is shown as a retryable error
        if (e instanceof ApiError && (e.status === 404 || e.status === 403)) setState({ kind: 'missing' });
        else setState({ kind: 'error', text: (e as Error).message });
      });
    return () => { stale = true; };
  }, [username]);

  if (state.kind === 'loading') {
    return (
      <div className="space-y-5" role="status" aria-label={t('hdr.loading')}>
        <div className="panel pf-hero">
          <div className="pf-banner skeleton" />
          <div className="pf-hero-body">
            <div className="pf-hero-avatar"><div className="pf-avatar-ring p-1"><div className="skeleton h-20 w-20 rounded-3xl bg-soft" /></div></div>
            <div className="min-w-0 flex-1 basis-56 space-y-2 pt-3">
              <div className="skeleton h-7 w-48 rounded-full bg-soft" />
              <div className="skeleton h-5 w-64 max-w-full rounded-full bg-soft" />
            </div>
          </div>
        </div>
        <div className="pf-tiles">{[0, 1, 2, 3].map((i) => <div key={i} className="skeleton h-24 rounded-2xl bg-soft" />)}</div>
      </div>
    );
  }

  if (state.kind !== 'ok') {
    const missing = state.kind === 'missing';
    return (
      <Empty title={missing ? t('pub.missingTitle') : t('pub.errorTitle')} text={missing ? t('pub.missingText') : state.text} art={missing ? <NotFoundArt /> : undefined}>
        <a href={me ? '/profile' : '/servers'} className="btn mt-2">{t('pub.back')}</a>
      </Empty>
    );
  }

  const p = state.p;
  const since = p.memberSince != null ? new Date(p.memberSince).getTime() : NaN;
  const role = p.role === 'admin' ? t('pf.role.admin') : p.role === 'moderator' ? t('pf.role.moderator') : t('pf.role.player');
  const mine = me?.username === p.username;
  const s = p.stats ?? { totalSeconds: 0, sessions: 0, streakDays: 0, favouriteServerName: null };

  return (
    <div className="space-y-5">
      <div className="panel pf-hero">
        <div className="pf-banner" style={bannerStyle(p.bannerUrl, p.bannerPreset)} />
        <div className="pf-hero-body">
          <div className="pf-hero-avatar"><div className="pf-avatar-ring p-1" style={p.rank ? { ['--ring' as string]: p.rank.color } : undefined}><UserAvatar name={p.username} url={p.avatarUrl} size={80} tone="brand" className="rounded-3xl!" /></div></div>
          <div className="min-w-0 flex-1 basis-56 pt-3">
            <h1 className="line-clamp-2 wrap-break-word text-2xl font-black leading-tight">{p.username}</h1>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <span className={`pill ${p.role === 'admin' ? 'pill-ok' : 'pill-mute'}`}>{role}</span>
              {p.rank && (
                <span className="inline-flex items-center gap-1.5 text-sm font-extrabold" style={{ color: p.rank.color }}>
                  <RankEmblem rank={p.rank} size={36} />
                  {rankName(p.rank)}
                </span>
              )}
              {mine && <span className="pill pill-ok">{t('pf.you')}</span>}
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              {p.gameNick && <span className="pf-meta"><IcoGamepad />{t('pub.nick', { nick: p.gameNick })}</span>}
              {Number.isFinite(since) && <span className="pf-meta"><IcoCalendar />{t('pub.since', { date: fmtDate(since) })}</span>}
            </div>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {mine && <a href="/profile" className="btn btn-sm">{t('pf.you.edit')}</a>}
            <ShareButton username={p.username} />
          </div>
        </div>
      </div>

      {p.bio && (
        <Section title={t('pub.about')}>
          <p className="pf-pub-bio font-semibold">{p.bio}</p>
        </Section>
      )}

      <Section title={t('pub.stats')}>
        <div className="pf-tiles">
          <StatTile icon={<IcoClock />} value={fmtDuration(s.totalSeconds)} label={t('pf.stats.online')} />
          <StatTile icon={<IcoPlay />} value={String(s.sessions)} label={t('pf.stats.sessions')} />
          <StatTile icon={<IcoFlame />} hot={s.streakDays >= 7} value={t('pf.stats.days', { n: s.streakDays })} label={t('pf.stats.streak')} />
          <StatTile icon={<IcoHeart />} value={s.favouriteServerName || '–'} label={t('pf.stats.favourite')} />
        </div>
      </Section>

      {p.vrAchievements && p.vrAchievements.length > 0 && (
        <Section title={t('vr.ach.title')}>
          <Folded items={p.vrAchievements.map((a) => (
            <li key={a.id} className="pf-ach-mini">
              <span><img src={a.image} width={26} height={26} alt="" loading="lazy" draggable={false} style={{ width: 26, height: 26, objectFit: 'contain' }} /></span>
              <span className="pr-1">{vrAchText(a.id, 't', a.title)}</span>
            </li>
          ))} />
        </Section>
      )}

      {p.achievements && p.achievements.length > 0 && (
        <Section title={t('pf.ach.title')}>
          <Folded items={p.achievements.map((a) => (
            <li key={a.id} className="pf-ach-mini">
              <span><AchievementArt id={a.id} slug={a.icon} size={26} /></span>
              <span className="pr-1">{a.title}</span>
            </li>
          ))} />
        </Section>
      )}
    </div>
  );
}
