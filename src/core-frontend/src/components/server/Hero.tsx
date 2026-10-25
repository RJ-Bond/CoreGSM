import { t, useI18n } from '../../i18n';
import { AnimatedNumber } from '../../ui';
import { IconBell } from '../../ui';
import MaintenanceChip from '../MaintenanceChip';
import { CapacityBar } from '../servers/serverUi';
import NickPic from '../NickPic';
import { nickHue, nickInitial } from './helpers';

export type FreeSlotState = 'guest' | 'ready' | 'subscribed' | 'hidden';

/**
 * The state of the server at a glance (inside the banner): a big player counter, the fill bar with «Свободно N мест»,
 * the maintenance chip, and, when the server is full, «Сообщить, когда будет место».
 */
export default function Hero({
  online, hasStatus, players, max, maintenance, freeSlot, onNotify, who = [], whoHref,
}: {
  online: boolean;
  hasStatus: boolean;
  players: number;
  max: number;
  maintenance?: { name: string; until: number | null } | null;
  freeSlot: FreeSlotState;
  onNotify: () => void;
  /** nicks of the players now on the server (a stack of avatars under the counter) */
  who?: string[];
  whoHref?: string;
}) {
  useI18n();
  return (
    <section className="srv-hero relative" aria-label={t('srv.hero.label')}>
      <div className="srv-hero-top">
        <div className="srv-hero-count" aria-live="polite">
          {online ? (
            <>
              <span className="srv-hero-n"><AnimatedNumber value={players} delta /></span>
              {max > 0 && <span className="srv-hero-max">/{max}</span>}
              <span className="srv-hero-unit">{t('srv.hero.players')}</span>
            </>
          ) : (
            <>
              <span className="srv-hero-n srv-hero-none" aria-hidden>–</span>
              <span className="srv-hero-unit">{hasStatus ? t('srv.hero.offline') : t('srv.hero.waiting')}</span>
            </>
          )}
        </div>
        {maintenance && <MaintenanceChip m={maintenance} glass />}
      </div>
      {online && max > 0 && <CapacityBar className="srv-hero-bar mt-2.5" players={players} max={max} color="#fff" onDark big />}
      {online && who.length > 0 && (
        <a className="srv-who" href={whoHref} aria-label={`${t('srv.hero.players')}: ${players}`}>
          <span className="srv-who-stack" aria-hidden>
            {who.slice(0, 7).map((n) => (
              <b key={n} className="srv-who-av">
                <NickPic name={n} size={28} className="rounded-full">
                  <i className="avatar-hue" style={{ ['--h' as string]: nickHue(n) }}>{nickInitial(n)}</i>
                </NickPic>
              </b>
            ))}
          </span>
          <span className="srv-who-more">
            {who.slice(0, 3).join(', ')}{players > Math.min(3, who.length) ? ` и ещё ${players - Math.min(3, who.length)}` : ''}
          </span>
        </a>
      )}
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
