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
export const SCOPE_KEYS: Record<string, string> = { welcome: 'gamenews_welcome', joinleave: 'gamenews_joinleave', register: 'gamenews_register', chat: 'gamenews_chat', restart: 'gamenews_restart_texts', kick: 'gamenews_kick' };

/** inside a card of a server: «uses the general settings» or «own settings» with a way back */
export function ScopeNote({ part }: { part: keyof typeof SCOPE_KEYS }) {
  useI18n();
  const s = useScope();
  if (!s.server || !s.mine) return null;
  const own = !!s.mine[SCOPE_KEYS[part]];
  return (
    <div className={`flex flex-wrap items-center gap-3 rounded-xl border px-3 py-2 text-sm font-semibold ${own ? 'border-accent' : 'border-line text-mute'}`}>
      <span className="min-w-0 flex-1 basis-60">{own ? t('gn.sc.own') : t('gn.sc.inherit')}</span>
      {own && <button type="button" className="btn btn-ghost btn-sm" onClick={() => s.reset(part)}>{t('gn.sc.reset')}</button>}
    </div>
  );
}
