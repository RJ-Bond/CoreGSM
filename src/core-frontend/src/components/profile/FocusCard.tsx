import type { CSSProperties } from 'react';
import { t } from '../../i18n';
import { ago } from '../../ui';
import type { Focus } from './heroLogic';

const fmtH = (h: number) => (Math.round(h * 10) / 10).toLocaleString(undefined, { maximumFractionDigits: 1 });

/** «The main thing today»: one tile with the one thing worth a look, instead of three cards of the same weight */
export function FocusCard({ focus }: { focus: Focus | null }) {
  if (!focus) return null;
  let icon = '🎮';
  let title = '';
  let sub = '';
  let href = '';
  let bar: { pct: number; color?: string } | null = null;
  if (focus.kind === 'playing') {
    title = t('pf.focus.playing', { server: focus.name });
    sub = t('pf.focus.playingSince', { when: ago(focus.since) });
    href = `/servers/${focus.serverId}`;
  } else if (focus.kind === 'rank') {
    icon = '🏅';
    title = t('pf.focus.rank', { name: focus.name, hours: fmtH(focus.hoursLeft) });
    sub = t('pf.focus.rankSub', { pct: Math.round(focus.progress * 100) });
    href = '/profile/player';
    bar = { pct: Math.round(focus.progress * 100), color: focus.color };
  } else if (focus.kind === 'ach') {
    icon = '🏆';
    title = t('pf.focus.ach', { title: focus.title });
    sub = t('pf.focus.achSub', { done: Math.round(focus.progress), target: focus.target });
    href = '/profile/player';
    bar = { pct: focus.target > 0 ? Math.round((focus.progress / focus.target) * 100) : 0 };
  } else if (focus.kind === 'setupNick') {
    icon = '🎮';
    title = t('pf.focus.setup');
    sub = t('pf.focus.setupSub');
    href = '/profile/player';
  } else if (focus.kind === 'firstGame') {
    icon = '🚀';
    title = t('pf.focus.first');
    sub = t('pf.focus.firstSub');
    href = '/servers';
  } else {
    icon = '🟢';
    title = t('pf.focus.fav', { server: focus.name });
    sub = t('pf.focus.favSub', { n: focus.players });
    href = `/servers/${focus.serverId}`;
  }
  return (
    <section className={`pf-focus is-${focus.kind}`} aria-label={t('pf.focus.title')} style={focus.kind === 'rank' ? ({ ['--rc' as string]: focus.color } as CSSProperties) : undefined}>
      <span className="pf-focus-ico" aria-hidden>{icon}</span>
      <div className="min-w-0 flex-1">
        <p className="pf-focus-k">{t('pf.focus.title')}</p>
        <p className="pf-focus-t">{title}</p>
        <p className="pf-focus-s">{sub}</p>
        {bar && <div className="pf-bar mt-2" aria-hidden><i style={{ width: `${bar.pct}%`, ...(bar.color ? { background: bar.color } : {}) }} /></div>}
      </div>
      <a href={href} className="btn btn-soft btn-sm">{t('pf.focus.open')}</a>
    </section>
  );
}
