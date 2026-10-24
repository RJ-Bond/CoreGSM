import { useState } from 'react';
import type { MyRank, VrAchievement } from '../../api';
import { t, type TKey } from '../../i18n';
import ru from '../../locales/ru';
import { fmtDate, Section } from '../../ui';
import { VR_RANKS, rankById } from '../../vrisingRanks';
import { isArray, isObject, useFetched } from './useFetched';
import { AchBrowser, AchFlag } from './Achievements';

/** rank name in the interface language (the ladder module keeps the Russian one) */
export function rankName(r: { id: string; name: string }): string {
  const k = `vr.rank.${r.id}`;
  return k in ru ? t(k as TKey) : r.name;
}

/** achievement title ('t') or description ('d') translated by id, the server's text otherwise */
export function vrAchText(id: string, part: 't' | 'd', fallback: string): string {
  const k = `vr.ach.${id}.${part}`;
  return k in ru ? t(k as TKey) : fallback;
}

export function RankEmblem({ rank, size = 48, dim = false }: { rank: { image: string }; size?: number; dim?: boolean }) {
  const [failed, setFailed] = useState(false);
  if (failed) return <span className="vr-emblem" style={{ width: size, height: size }} aria-hidden />;
  return (
    <img
      className="vr-emblem"
      src={rank.image}
      width={size}
      height={size}
      alt=""
      loading="lazy"
      draggable={false}
      onError={() => setFailed(true)}
      style={{ width: size, height: size, opacity: dim ? 0.4 : 1 }}
    />
  );
}

const fmtH = (h: number) => (Math.round(h * 10) / 10).toLocaleString(undefined, { maximumFractionDigits: 1 });

export function useMyRank() {
  return useFetched<MyRank>('/me/rank', isObject);
}

/** overview header: the emblem and the name of the current rank (only for a player with a game nick) */
export function RankHeaderBadge() {
  const { data } = useMyRank();
  if (!data || !data.nick) return null;
  return (
    <span className="inline-flex items-center gap-1.5 text-sm font-extrabold" style={{ color: data.rank.color }} title={t('vr.rank.title')}>
      <RankEmblem rank={data.rank} size={36} />
      {rankName(data.rank)}
    </span>
  );
}

/** «Игрок» tab: big emblem, hours, progress to the next rank and the whole ladder */
export function RankCard() {
  const { data } = useMyRank();
  if (data === null) return null;
  return (
    <Section title={t('vr.rank.title')} description={t('vr.rank.desc')}>
      {data === undefined && <div className="skeleton h-32 rounded-2xl bg-soft" />}
      {data && <RankBody d={data} />}
    </Section>
  );
}

function RankBody({ d }: { d: MyRank }) {
  const [pick, setPick] = useState<string | null>(null);
  const curIdx = Math.max(0, VR_RANKS.findIndex((r) => r.id === d.rank.id));
  const left = d.next ? Math.max(0, d.next.minHours - d.hours) : 0;
  return (
    <div className="space-y-4">
      <div className="vr-rank">
        <RankEmblem rank={d.rank} size={112} />
        <div className="vr-rank-main">
          <div className="wrap-break-word text-xl font-black leading-tight" style={{ color: d.rank.color }}>{rankName(d.rank)}</div>
          <div className="mt-0.5 text-sm font-semibold text-mute">
            {d.nick ? t('vr.rank.hours', { hours: fmtH(d.hours) }) : t('vr.rank.noNick')}
          </div>
          {d.next ? (
            <div className="mt-3">
              <div className="flex items-baseline justify-between gap-3 text-sm font-extrabold">
                <span className="min-w-0 truncate">{t('vr.rank.next', { name: rankName(d.next) })}</span>
                <span className="shrink-0 text-mute">{Math.round(d.progress * 100)}% · {t('vr.rank.left', { hours: fmtH(left) })}</span>
              </div>
              <div className="pf-bar mt-2" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(d.progress * 100)} aria-label={t('vr.rank.title')}>
                <i style={{ width: `${Math.round(d.progress * 100)}%`, background: d.next.color }} />
              </div>
            </div>
          ) : (
            <div className="mt-2 text-sm font-extrabold text-ok">{t('vr.rank.max')}</div>
          )}
        </div>
      </div>
      <ul className="vr-ladder" aria-label={t('vr.rank.ladder')}>
        {VR_RANKS.map((r, i) => (
          <li key={r.id} className={i < curIdx ? 'is-got' : i === curIdx ? 'is-cur' : ''} style={{ ['--vr-c' as string]: r.color }}>
            <button type="button" aria-pressed={(pick ?? d.rank.id) === r.id} aria-label={t('vr.rank.tip', { name: rankName(r), hours: r.minHours })} onClick={() => setPick(r.id)}>
              <RankEmblem rank={r} size={36} />
            </button>
          </li>
        ))}
      </ul>
      {(() => {
        const sel = VR_RANKS.find((x) => x.id === (pick ?? d.rank.id)) ?? d.rank;
        return (
          <p className="text-sm font-bold" style={{ color: sel.color }} aria-live="polite">
            {t('vr.rank.tip', { name: rankName(sel), hours: 'minHours' in sel ? sel.minHours : d.rank.minHours })}
            {sel.id === d.rank.id && <span className="pf-here"> · {t('vr.rank.here')}</span>}
          </p>
        );
      })()}
    </div>
  );
}

const pct = (a: VrAchievement) => (a.target > 0 ? Math.max(0, Math.min(100, (a.progress / a.target) * 100)) : a.earned ? 100 : 0);

function Card({ a }: { a: VrAchievement }) {
  const [failed, setFailed] = useState(false);
  const src = a.earned ? a.image : a.image.replace(/\.png$/, '-locked.png');
  const title = vrAchText(a.id, 't', a.title);
  return (
    <li className={`pf-ach ${a.earned ? 'is-on' : 'is-off'}`}>
      <span className="pf-ach-ico">
        {!failed && <img className="vr-ach-img" src={src} width={44} height={44} alt="" loading="lazy" draggable={false} onError={() => setFailed(true)} />}
        <AchFlag earned={a.earned} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="pf-ach-title wrap-break-word font-extrabold leading-tight">{title}</div>
        <div className="mt-0.5 text-sm font-semibold text-mute">{vrAchText(a.id, 'd', a.description)}</div>
        {a.earned ? (
          <div className="mt-1.5 text-sm font-extrabold text-ok">
            {a.earnedAt ? t('pf.ach.earnedAt', { date: fmtDate(a.earnedAt) }) : t('pf.ach.earned')}
          </div>
        ) : (
          <div className="mt-2">
            <div className="pf-bar" role="progressbar" aria-valuemin={0} aria-valuemax={a.target} aria-valuenow={Math.min(a.progress, a.target)} aria-label={title}>
              <i style={{ width: `${pct(a)}%` }} />
            </div>
            <div className="mt-1 text-xs font-extrabold text-mute">{Math.round(a.progress)} / {a.target}</div>
          </div>
        )}
      </div>
    </li>
  );
}

export function VrAchievementsGrid() {
  const { data } = useFetched<VrAchievement[]>('/me/achievements/vrising', isArray);
  if (data === null) return null;
  const list = data ?? [];
  const done = list.filter((a) => a.earned).length;
  return (
    <Section title={t('vr.ach.title')} description={data ? t('pf.ach.count', { done, total: list.length }) : undefined}>
      {data === undefined && <div className="skeleton h-32 rounded-2xl bg-soft" />}
      {data && list.length > 0 && <AchBrowser list={list} render={(a) => <Card key={a.id} a={a} />} />}
    </Section>
  );
}

export { rankById };
