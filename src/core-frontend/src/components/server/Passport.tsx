import { useId, useState, type ReactNode } from 'react';
import { t, useI18n } from '../../i18n';
import { AnimatedNumber, ago, fmtDateTime, toast } from '../../ui';
import { pingTone } from './helpers';

export interface PassportData {
  game: string;
  version: string | null;
  flag: string;
  country: string;
  map: string | null;
  address: string;
  ping: number | null;
  online: boolean;
  createdAt: number | null;
  lastSeen: number | null;
  mode: string | null;
  discord: { text: string; href: string | null }[];
}

const FOLD_KEY = 'coregsm_srv_passport';
function readOpen(): boolean {
  try { return localStorage.getItem(FOLD_KEY) === '1'; } catch { return false; }
}
function writeOpen(v: boolean) {
  try { localStorage.setItem(FOLD_KEY, v ? '1' : '0'); } catch { /* private mode */ }
}

/** five bars: a lower ping lights more of them */
const pingBars = (ms: number) => (ms <= 30 ? 5 : ms <= 60 ? 4 : ms <= 100 ? 3 : ms <= 150 ? 2 : 1);

function Chip({ k, icon, children }: { k: string; icon: ReactNode; children: ReactNode }) {
  return (
    <li className="pp-chip" title={k}>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>{icon}</svg>
      <span className="sr-only">{k}: </span>
      <span className="truncate">{children}</span>
    </li>
  );
}


function Item({ k, wide, children }: { k: string; wide?: boolean; children: ReactNode }) {
  return (
    <div className={`pp-i ${wide ? 'wide' : ''}`}>
      <dt className="pp-k">{k}</dt>
      <dd className="pp-v">{children}</dd>
    </div>
  );
}

/** «Паспорт сервера»: five key facts; the rest is behind «Подробнее» (remembered) */
export default function Passport({ d }: { d: PassportData }) {
  useI18n();
  const [open, setOpen] = useState(readOpen);
  const bodyId = useId();
  const toggle = () => setOpen((v) => { writeOpen(!v); return !v; });
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(d.address);
      toast(t('d2.sd.t.addrCopied'));
    } catch {
      toast(t('d2.sd.t.addr', { addr: d.address }), 'info', 8000);
    }
  };
  const pt = d.ping != null && d.online ? pingTone(d.ping) : null;
  return (
    <section className="relative mt-3.5" aria-label={t('d2.pp.label')}>
      <ul className="pp-ribbon">
        <Chip k={t('d2.sf.game')} icon={<path d="M6 12h4M8 10v4M15 11.5h.01M18 13.5h.01M7 7h10a4 4 0 0 1 4 4v2a4 4 0 0 1-4 4h-1.5l-2-2h-3l-2 2H7a4 4 0 0 1-4-4v-2a4 4 0 0 1 4-4z" />}>{d.game}</Chip>
        {/* a fact the server does not report is left out instead of showing a dash */}
        {d.map && d.online && <Chip k={t('d2.pp.map')} icon={<path d="M12 21s7-6.2 7-11.5A7 7 0 0 0 5 9.500C5 14.800 12 21 12 21zM12 12a2.500 2.500 0 1 0 0-5 2.500 2.500 0 0 0 0 5z" />}>{d.map}</Chip>}
        {d.version && <Chip k={t('d2.srv.version')} icon={<path d="M3 12V4h8l10 10-8 8L3 12zM7.500 8h.01" />}>{`v${d.version.replace(/^v/i, '')}`}</Chip>}
        {d.country && (
          <li className="pp-chip" title={t('d2.pp.country', { name: d.country })}>
            <span className="pp-flag" aria-hidden>{d.flag}</span>
            <span className="sr-only">{t('d2.pp.countryK')} </span>
            <span className="truncate">{d.country}</span>
          </li>
        )}
        {pt && d.ping != null && (
          <li className="pp-chip pp-ping" data-tone={pt.tone} title={t('d2.pp.ping', { label: pt.label })}>
            <span className="pp-bars" aria-hidden data-n={pingBars(d.ping)}>{[1, 2, 3, 4, 5].map((i) => <i key={i} className={i <= pingBars(d.ping as number) ? 'on' : ''} style={{ height: 4 + i * 2.600 }} />)}</span>
            <span className="sr-only">{t('d2.sd.ping')}: </span>
            <span><AnimatedNumber value={d.ping} /> {t('d2.sv.ms')}</span>
          </li>
        )}
      </ul>
      <button type="button" className="pp-more-btn" aria-expanded={open} aria-controls={bodyId} onClick={toggle}>
        {open ? t('srv.pp.less') : t('srv.pp.more')}
        <svg className="pp-more-chev" data-open={open} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M6 9l6 6 6-6" /></svg>
      </button>
      <div id={bodyId} hidden={!open}>
        <dl className="pp mt-2">
          <Item k={t('d2.sv.address')} wide>
            <code title={d.address}>{d.address}</code>
            <button type="button" className="pp-copy" onClick={() => void copy()} title={t('d2.sv.copyAddr')} aria-label={t('d2.sv.copyAddr')}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <rect x="9" y="9" width="11" height="11" rx="2.5" />
                <path d="M5 15V6.5A2.5 2.5 0 0 1 7.5 4H15" />
              </svg>
            </button>
          </Item>
          <Item k={t('d2.pp.mode')}><span>{d.mode ?? '–'}</span></Item>
          <Item k={t('d2.pp.onPanel')} wide>
            <span title={d.createdAt ? fmtDateTime(d.createdAt) : undefined}>
              {d.createdAt ? t('d2.an.since', { date: new Date(d.createdAt).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' }) }) : t('d2.pp.dateUnknown')}
              {d.lastSeen ? ` · ${t('d2.pp.polled', { ago: ago(d.lastSeen) })}` : ''}
            </span>
          </Item>
          {d.discord.length > 0 && (
            <Item k="Discord" wide>
              {d.discord.map((x, i) => (
                x.href
                  ? <a key={i} href={x.href} target="_blank" rel="noopener noreferrer">{x.text}</a>
                  : <span key={i}>{x.text}</span>
              ))}
            </Item>
          )}
        </dl>
      </div>
    </section>
  );
}
