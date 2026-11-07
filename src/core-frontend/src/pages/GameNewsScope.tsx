import { createContext, useContext } from 'react';
import { t, useI18n } from '../i18n';

/** which settings the cards show: the general ones (server 0) or those of one server */
export interface Scope {
  server: number;
  /** '' or '?server=3': added to the address of every call of a card */
  q: string;
  /** which parts have their own value for this server (null: the general settings are shown) */
  mine: Record<string, boolean> | null;
  /** a card saved something: the page reads the settings again */
  changed: () => void;
  /** the server uses the general value of a part again */
  reset: (part: string) => void;
}

export const ScopeContext = createContext<Scope>({ server: 0, q: '', mine: null, changed: () => undefined, reset: () => undefined });
export const useScope = () => useContext(ScopeContext);

/** the keys of the settings of the server, by the name of the part */
const KEY: Record<string, string> = { welcome: 'gamenews_welcome', joinleave: 'gamenews_joinleave', register: 'gamenews_register', chat: 'gamenews_chat', restart: 'gamenews_restart_texts' };

/** «Все серверы · Сервер 1 · Сервер 2»: one choice for the whole page */
export function ScopeBar({ servers, value, onChange, own }: {
  servers: { id: number; name: string }[];
  value: number;
  onChange: (id: number) => void;
  /** servers that have settings of their own (a dot on the button) */
  own: Set<number>;
}) {
  useI18n();
  if (servers.length < 1) return null;
  return (
    <div className="panel space-y-2 px-4 py-3">
      <div className="flex flex-wrap items-center gap-2" role="group" aria-label={t('gn.sc.title')}>
        <span className="text-sm font-bold text-mute">{t('gn.sc.title')}</span>
        <button type="button" className={`chip-filter ${value === 0 ? 'on' : ''}`} aria-pressed={value === 0} onClick={() => onChange(0)}>{t('gn.sc.all')}</button>
        {servers.map((s) => (
          <button key={s.id} type="button" className={`chip-filter ${value === s.id ? 'on' : ''}`} aria-pressed={value === s.id} onClick={() => onChange(s.id)}>
            {s.name}{own.has(s.id) && <span aria-label={t('gn.sc.hasOwn')} title={t('gn.sc.hasOwn')} className="ml-1.5 inline-block h-2 w-2 rounded-full bg-accent" />}
          </button>
        ))}
      </div>
      <p className="text-sm font-semibold text-mute">{value === 0 ? t('gn.sc.noteAll') : t('gn.sc.noteOne')}</p>
    </div>
  );
}

/** inside a card of a server: «uses the general settings» or «own settings» with a way back */
export function ScopeNote({ part }: { part: keyof typeof KEY }) {
  useI18n();
  const s = useScope();
  if (!s.server || !s.mine) return null;
  const own = !!s.mine[KEY[part]];
  return (
    <div className={`flex flex-wrap items-center gap-3 rounded-xl border px-3 py-2 text-sm font-semibold ${own ? 'border-accent' : 'border-line text-mute'}`}>
      <span className="min-w-0 flex-1 basis-60">{own ? t('gn.sc.own') : t('gn.sc.inherit')}</span>
      {own && <button type="button" className="btn btn-ghost btn-sm" onClick={() => s.reset(part)}>{t('gn.sc.reset')}</button>}
    </div>
  );
}
