import { useEffect, useRef, useState } from 'react';
import { t, useI18n } from '../../i18n';
import { AnimatedNumber, Burst, IconBell, plural } from '../../ui';
import MaintenanceChip from '../MaintenanceChip';
import NickPic from '../NickPic';
import { capLevel, capacityPct, slotsInfo } from '../servers/capacity';
import { nickHue, nickInitial, NEWBIE_MS, VETERAN_MS, playedFor } from './helpers';
import { useKnownNicks } from './useKnownNicks';

export type FreeSlotState = 'guest' | 'ready' | 'subscribed' | 'hidden';
export interface Who { name: string; since: number | null }

/** the fill bar cut into slots (one per place, at most 40), the record place marked; the free-places pill under it */
function SlotBar({ players, max, peak }: { players: number; max: number; peak: number | null }) {
  const pct = capacityPct(players, max);
  const level = capLevel(pct);
  const segs = Math.max(1, Math.min(max, 40));
  const filled = players > 0 ? Math.max(1, Math.round((players / max) * segs)) : 0;
  const peakAt = peak != null && peak > players ? Math.min(segs - 1, Math.max(0, Math.round((peak / max) * segs) - 1)) : -1;
  const info = slotsInfo(players, max);
  const text = !info ? '' : info.kind === 'full' ? t('srv.slots.full') : info.kind === 'almost' ? t('srv.slots.almost') : t('srv.slots.free', { n: info.free });
  return (
    <div className="srv-hero-bar">
      <div className="flex items-center gap-2.5">
        <div
          className={`srv-slots-bar ${level}`}
          role="meter"
          aria-label={t('srv.cap.label')}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={pct}
          title={level === 'hot' ? t('srv.cap.nearFull', { pct }) : t('srv.cap.taken', { pct })}
        >
          {Array.from({ length: segs }, (_, i) => (
            <i key={i} className={`${i < filled ? 'on' : ''} ${i === peakAt ? 'is-peak' : ''}`} style={{ ['--d' as string]: `${i * 16}ms` }} title={i === peakAt ? `Пик за период: ${peak}` : undefined} />
          ))}
        </div>
        <span className={`srv-pct on-dark big ${level}`}>{pct}%</span>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {info && <span className={`srv-slotpill ${info.kind}`}>{text}</span>}
        {peak != null && peak > 0 && <span className="srv-peaknote">пик за период: {peak}</span>}
      </div>
    </div>
  );
}

/** players over the last two hours, a tiny line with the change in words */
function HeroSpark({ values }: { values: number[] }) {
  if (values.length < 4) return null;
  const hi = Math.max(...values, 1);
  const pts = values.map((y, i) => `${((i / (values.length - 1)) * 100).toFixed(1)},${(20 - (y / hi) * 18).toFixed(1)}`).join(' ');
  const d = values[values.length - 1] - values[0];
  return (
    <div className="srv-hero-trend" title="Игроки за последние 2 часа">
      <svg viewBox="0 0 100 22" preserveAspectRatio="none" aria-hidden>
        <polyline points={pts} fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
      </svg>
      <span>{d === 0 ? 'за 2 ч без изменений' : `за 2 ч ${d > 0 ? '+' : '−'}${Math.abs(d)}`}</span>
    </div>
  );
}

/** the players now on the server: a stack of avatars (a ring marks newcomers and veterans), a card on tap */
function WhoStack({ who, players, href, now }: { who: Who[]; players: number; href?: string; now: number }) {
  const [sel, setSel] = useState<string | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const known = useKnownNicks();
  useEffect(() => {
    if (!sel) return;
    const off = (e: Event) => { if (!box.current?.contains(e.target as Node)) setSel(null); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setSel(null); };
    document.addEventListener('pointerdown', off);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('pointerdown', off); document.removeEventListener('keydown', esc); };
  }, [sel]);
  const shown = who.slice(0, 6);
  const rest = Math.max(0, players - shown.length);
  const cur = sel ? who.find((w) => w.name === sel) : null;
  const place = cur ? known.get(cur.name.toLowerCase()) : undefined;
  return (
    <div className="srv-who" ref={box}>
      <div className="srv-who-row">
        <span className="srv-who-stack">
          {shown.map((w) => {
            const dur = w.since != null ? now - w.since : null;
            const ring = dur == null ? '' : dur < NEWBIE_MS ? 'ring-new' : dur >= VETERAN_MS ? 'ring-vet' : '';
            return (
              <button key={w.name} type="button" className={`srv-who-av ${ring}`} aria-expanded={sel === w.name} aria-label={w.name} onClick={() => setSel(sel === w.name ? null : w.name)}>
                <NickPic name={w.name} size={32} className="rounded-full">
                  <i className="avatar-hue" style={{ ['--h' as string]: nickHue(w.name) }}>{nickInitial(w.name)}</i>
                </NickPic>
              </button>
            );
          })}
          {rest > 0 && <span className="srv-who-more-n">+{rest}</span>}
        </span>
        <a className="srv-who-link" href={href}>{plural(players, ['игрок', 'игрока', 'игроков'])} в игре →</a>
      </div>
      {cur && (
        <div className="srv-who-pop" role="dialog" aria-label={cur.name}>
          <b className="block truncate text-base">{cur.name}</b>
          <span className="text-sm font-semibold opacity-85">{cur.since != null ? `в игре ${playedFor(cur.since, now)}` : 'в сети сейчас'}</span>
          <span className="mt-1 flex flex-wrap items-center gap-2">
            {place != null && place > 0 && <span className="pl-place-chip" title="Место в рейтинге недели">#{place}</span>}
            {place != null && <a className="srv-who-prof" href={`/player/${encodeURIComponent(cur.name)}`}>Профиль →</a>}
          </span>
        </div>
      )}
    </div>
  );
}

/**
 * The state of the server at a glance (inside the banner): a big player counter with the two-hour trend, the slot bar,
 * the maintenance chip, who is playing, and, when the server is full, «Сообщить, когда будет место».
 */
export default function Hero({
  online, hasStatus, players, max, maintenance, freeSlot, onNotify, who = [], whoHref, peak = null, recent = [], now,
}: {
  online: boolean;
  hasStatus: boolean;
  players: number;
  max: number;
  maintenance?: { name: string; until: number | null } | null;
  freeSlot: FreeSlotState;
  onNotify: () => void;
  who?: Who[];
  whoHref?: string;
  /** the highest online of the shown period (a mark on the bar; beating it while the page is open starts a small celebration) */
  peak?: number | null;
  /** players over the last two hours */
  recent?: number[];
  now: number;
}) {
  useI18n();
  // a new record while the page is open
  const base = useRef<number | null>(null);
  const [boom, setBoom] = useState(0);
  useEffect(() => {
    if (!online) return;
    if (base.current == null) { base.current = Math.max(peak ?? 0, players); return; }
    base.current = Math.max(base.current, peak ?? 0);
    if (players > base.current) {
      base.current = players;
      if (players >= 3) setBoom((k) => k + 1);
    }
  }, [players, peak, online]);

  return (
    <section className="srv-hero relative" aria-label={t('srv.hero.label')}>
      <div className="srv-hero-top">
        <div className="srv-hero-count" aria-live="polite">
          {online ? (
            <>
              <span className="srv-hero-n"><AnimatedNumber value={players} delta /></span>
              {max > 0 && <span className="srv-hero-max"><small>из</small> {max}</span>}
              <span className="srv-hero-unit">{t('srv.hero.players')}</span>
            </>
          ) : (
            <>
              <span className="srv-hero-n srv-hero-none" aria-hidden>–</span>
              <span className="srv-hero-unit">{hasStatus ? t('srv.hero.offline') : t('srv.hero.waiting')}</span>
            </>
          )}
          {boom > 0 && (
            <span key={boom} className="srv-record" role="status">
              <Burst count={10} radius={30} />
              🏆 Новый рекорд
            </span>
          )}
        </div>
        {maintenance && <MaintenanceChip m={maintenance} glass />}
      </div>
      {online && <HeroSpark values={recent} />}
      {online && max > 0 && <SlotBar players={players} max={max} peak={peak} />}
      {online && who.length > 0 && <WhoStack who={who} players={players} href={whoHref} now={now} />}
      {freeSlot !== 'hidden' && (
        <div className="srv-hero-free mt-3">
          {freeSlot === 'subscribed' ? (
            <p className="srv-hero-sub"><IconBell size={16} />{t('srv.freeSlot.subscribed')}</p>
          ) : freeSlot === 'guest' ? (
            <a className="btn-glass" href="/login"><IconBell size={18} />{t('srv.freeSlot.login')}</a>
          ) : (
            <button type="button" className="btn-glass" onClick={onNotify} aria-haspopup="dialog"><IconBell size={18} />{t('srv.freeSlot.button')}</button>
          )}
        </div>
      )}
    </section>
  );
}
