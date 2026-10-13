import { useId, useState, type ReactNode } from 'react';
import { t, useI18n } from '../../i18n';
import { ago, fmtDateTime, toast } from '../../ui';
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

const PP_TONE = { ok: 'pp-tone-ok', warn: 'pp-tone-warn', bad: 'pp-tone-bad' } as const;

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
      toast('Адрес скопирован');
    } catch {
      toast(`Адрес: ${d.address}`, 'info', 8000);
    }
  };
  const pt = d.ping != null && d.online ? pingTone(d.ping) : null;
  return (
    <section className="relative mt-3.5" aria-label="Паспорт сервера">
      <dl className="pp pp-main">
        <Item k="Игра"><span>{d.game}</span></Item>
        <Item k="Карта"><span title={d.map ?? undefined}>{d.map && d.online ? d.map : '–'}</span></Item>
        <Item k="Версия"><span>{d.version ? `v${d.version.replace(/^v/i, '')}` : '–'}</span></Item>
        <Item k="Страна"><span>{d.country ? `${d.flag} ${d.country}`.trim() : '–'}</span></Item>
        <Item k="Пинг">
          {pt && d.ping != null ? <span className={PP_TONE[pt.tone]}>{d.ping} мс · {pt.label}</span> : <span>–</span>}
        </Item>
      </dl>
      <button type="button" className="pp-more-btn" aria-expanded={open} aria-controls={bodyId} onClick={toggle}>
        {open ? t('srv.pp.less') : t('srv.pp.more')}
        <svg className="pp-more-chev" data-open={open} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M6 9l6 6 6-6" /></svg>
      </button>
      <div id={bodyId} hidden={!open}>
        <dl className="pp mt-2">
          <Item k="Адрес" wide>
            <code title={d.address}>{d.address}</code>
            <button type="button" className="pp-copy" onClick={() => void copy()} title="Скопировать адрес" aria-label="Скопировать адрес">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <rect x="9" y="9" width="11" height="11" rx="2.5" />
                <path d="M5 15V6.5A2.5 2.5 0 0 1 7.5 4H15" />
              </svg>
            </button>
          </Item>
          <Item k="Режим"><span>{d.mode ?? '–'}</span></Item>
          <Item k="Добавлен">
            <span title={d.createdAt ? fmtDateTime(d.createdAt) : undefined}>
              {d.createdAt ? new Date(d.createdAt).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' }) : '–'}
            </span>
          </Item>
          <Item k="Последний опрос"><span title={d.lastSeen ? fmtDateTime(d.lastSeen) : undefined}>{d.lastSeen ? ago(d.lastSeen) : '–'}</span></Item>
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
