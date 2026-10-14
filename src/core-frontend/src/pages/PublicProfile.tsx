import { useEffect, useState } from 'react';
import { api, ApiError, type PublicProfile } from '../api';
import { useAuth } from '../auth';
import { AchievementArt } from '../components/profile/icons';
import { RankEmblem, rankName, vrAchText } from '../components/profile/VrRank';
import { bannerStyle } from '../components/profile/banner';
import { fmtDuration } from '../components/profile/format';
import { t, useI18n } from '../i18n';
import { Empty, fmtDate, Section, UserAvatar } from '../ui';

type State = { kind: 'loading' } | { kind: 'ok'; p: PublicProfile } | { kind: 'missing' } | { kind: 'error'; text: string };

function Tile({ value, label }: { value: string; label: string }) {
  return (
    <div className="pf-tile">
      <div className="pf-tile-v">{value}</div>
      <div className="pf-tile-l">{label}</div>
    </div>
  );
}

/** #/u/<username>: the public page of a player. Works without signing in; a private or unknown profile gives a 404 state. */
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
        <div className="skeleton h-48 rounded-ui-xl bg-soft" />
        <div className="skeleton h-28 rounded-ui-xl bg-soft" />
      </div>
    );
  }

  if (state.kind !== 'ok') {
    const missing = state.kind === 'missing';
    return (
      <Empty title={missing ? t('pub.missingTitle') : t('pub.errorTitle')} text={missing ? t('pub.missingText') : state.text}>
        <a href={me ? '#/profile' : '#/servers'} className="btn mt-2">{t('pub.back')}</a>
      </Empty>
    );
  }

  const p = state.p;
  const since = p.memberSince != null ? new Date(p.memberSince).getTime() : NaN;
  const role = p.role === 'admin' ? t('pf.role.admin') : p.role === 'moderator' ? t('pf.role.moderator') : t('pf.role.player');
  const s = p.stats ?? { totalSeconds: 0, sessions: 0, streakDays: 0, favouriteServerName: null };

  return (
    <div className="space-y-5">
      <div className="panel pf-hero">
        <div className="pf-banner" style={bannerStyle(p.bannerUrl, p.bannerPreset)} />
        <div className="pf-hero-body">
          <div className="pf-hero-avatar"><div className="pf-avatar-ring p-1"><UserAvatar name={p.username} url={p.avatarUrl} size={88} tone="brand" className="!rounded-3xl" /></div></div>
          <div className="min-w-0 flex-1 basis-56 pt-3">
            <h1 className="line-clamp-2 break-words text-2xl font-black leading-tight">{p.username}</h1>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <span className={`pill ${p.role === 'admin' ? 'pill-ok' : 'pill-mute'}`}>{role}</span>
              {p.rank && (
                <span className="inline-flex items-center gap-1.5 text-sm font-extrabold" style={{ color: p.rank.color }}>
                  <RankEmblem rank={p.rank} size={28} />
                  {rankName(p.rank)}
                </span>
              )}
              {p.gameNick && <span className="text-sm font-bold text-mute">{t('pub.nick', { nick: p.gameNick })}</span>}
              {Number.isFinite(since) && <span className="text-sm font-bold text-mute">{t('pub.since', { date: fmtDate(since) })}</span>}
            </div>
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
          <Tile value={fmtDuration(s.totalSeconds)} label={t('pf.stats.online')} />
          <Tile value={String(s.sessions)} label={t('pf.stats.sessions')} />
          <Tile value={t('pf.stats.days', { n: s.streakDays })} label={t('pf.stats.streak')} />
          <Tile value={s.favouriteServerName || '–'} label={t('pf.stats.favourite')} />
        </div>
      </Section>

      {p.vrAchievements && p.vrAchievements.length > 0 && (
        <Section title={t('vr.ach.title')}>
          <ul className="flex flex-wrap gap-2">
            {p.vrAchievements.map((a) => (
              <li key={a.id} className="pf-ach-mini">
                <span><img src={a.image} width={26} height={26} alt="" loading="lazy" draggable={false} style={{ width: 26, height: 26, objectFit: 'contain' }} /></span>
                <span className="pr-1">{vrAchText(a.id, 't', a.title)}</span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {p.achievements && p.achievements.length > 0 && (
        <Section title={t('pf.ach.title')}>
          <ul className="flex flex-wrap gap-2">
            {p.achievements.map((a) => (
              <li key={a.id} className="pf-ach-mini">
                <span><AchievementArt id={a.id} slug={a.icon} size={26} /></span>
                <span className="pr-1">{a.title}</span>
              </li>
            ))}
          </ul>
        </Section>
      )}
    </div>
  );
}
