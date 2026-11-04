import { useEffect, useState, type CSSProperties } from 'react';
import { useAuth } from '../../auth';
import { t } from '../../i18n';
import { ago, GameAvatar } from '../../ui';
import { MoreMenu } from '../MoreMenu';
import type { MyRank, MyStats } from '../../api';
import { AvatarEditor } from './AvatarEditor';
import { bannerStyle } from './banner';
import { IcoCalendar, IcoDiscord, IcoGamepad, IcoLogout, ShareButton } from './bits';
import { rankLevel } from './heroLogic';
import { RankHeaderBadge, rankName } from './VrRank';

/** the ring round the picture: an arc that fills towards the next rank, drawn once the page is up (it grows from empty) */
function LevelRing({ pct }: { pct: number }) {
  const [shown, setShown] = useState(0);
  useEffect(() => {
    const id = requestAnimationFrame(() => setShown(pct));
    return () => cancelAnimationFrame(id);
  }, [pct]);
  const r = 48;
  const c = 2 * Math.PI * r;
  return (
    <svg className="pf-lvring" viewBox="0 0 102 102" aria-hidden>
      <circle cx="51" cy="51" r={r} className="pf-lvring-track" />
      <circle cx="51" cy="51" r={r} className="pf-lvring-arc" strokeDasharray={c} strokeDashoffset={c * (1 - shown / 100)} />
    </svg>
  );
}

/**
 * The top of «Обзор»: the banner, the avatar in a ring that fills towards the next rank (with the level), the name,
 * the role and the rank, the places the player is known by, and where they are playing right now.
 */
export function ProfileHero({ rank, playing, editBanner, onToggleBanner, since }: {
  rank: MyRank | null | undefined;
  playing: MyStats['playingNow'] | undefined;
  editBanner: boolean;
  onToggleBanner: () => void;
  since?: number | null;
}) {
  const { me, isAdmin, logout, reload } = useAuth();
  if (!me) return null;
  const role = me.role === 'admin' ? t('pf.role.admin') : me.role === 'moderator' ? t('pf.role.moderator') : t('pf.role.player');
  const ranked = !!rank && !!rank.nick;
  const lv = ranked ? rankLevel(rank.rank.id) : null;
  const pct = ranked ? (rank.next ? Math.round(rank.progress * 100) : 100) : 0;

  return (
    <div className="panel pf-hero">
      <div className={`pf-banner ${me.bannerUrl ? '' : 'has-pattern'}`} style={bannerStyle(me.bannerUrl, me.bannerPreset)}>
        <button type="button" className="pf-banner-btn" aria-expanded={editBanner} onClick={onToggleBanner}>
          {editBanner ? t('pf.banner.close') : t('pf.banner.edit')}
        </button>
      </div>
      <div className="pf-hero-body">
        <div className="pf-hero-avatar">
          <div
            className={ranked ? 'pf-level' : undefined}
            style={ranked ? ({ ['--rc' as string]: rank.rank.color } as CSSProperties) : undefined}
            title={ranked && lv ? t('pf.hero.levelTitle', { n: lv.level, total: lv.total, name: rankName(rank.rank) }) : undefined}
          >
            {ranked && <LevelRing pct={pct} />}
            <AvatarEditor onChanged={reload} size={80} ring={null} />
            {ranked && lv && <span className="pf-level-badge">{t('pf.hero.level', { n: lv.level })}</span>}
          </div>
        </div>
        <div className="min-w-0 flex-1 basis-56 pt-3">
          <div className="line-clamp-2 wrap-break-word text-2xl font-black leading-tight">{me.username}</div>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <span className={`pill ${isAdmin ? 'pill-ok' : 'pill-mute'}`}>{role}</span>
            <RankHeaderBadge />
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {playing && (
              <a href={`/servers/${playing.serverId}`} className="pf-live" title={playing.name}>
                <GameAvatar game={playing.game} size={18} />
                <span className="truncate">{t('pf.hero.playing', { server: playing.name })}</span>
                <span className="text-mute">· {ago(playing.since)}</span>
              </a>
            )}
            {me.discordName && <span className="pf-meta"><IcoDiscord />{me.discordName}</span>}
            {rank?.nick && <span className="pf-meta"><IcoGamepad />{rank.nick}</span>}
            {since ? <span className="pf-meta"><IcoCalendar />{t('pf.hero.since', { when: ago(since) })}</span> : null}
          </div>
        </div>
        <div className="mt-3 flex items-center gap-2">
          <ShareButton username={me.username} />
          <MoreMenu plain>
            {(close) => (
              <button type="button" role="menuitem" className="upd-more-item" onClick={() => { close(); logout(); }}>
                <span className="inline-flex items-center gap-2"><IcoLogout />{t('hdr.logout')}</span>
              </button>
            )}
          </MoreMenu>
        </div>
      </div>
    </div>
  );
}
