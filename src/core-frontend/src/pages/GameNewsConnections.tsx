import { useEffect, useState } from 'react';
import { api } from '../api';
import { soon } from '../components/GameNewsParts';
import { t, useI18n } from '../i18n';
import { usePoll } from '../ui';
import { EmptyState } from './GameNewsUi';

export interface ConnectionItem { id: number; serverName: string; ts: number; kind: 'join' | 'leave'; platformId: string; nick: string; reason: string; removedBy: string; minutes: number }

/** the reasons of the game in plain words; an unknown one is shown as the game wrote it */
const REASONS = ['LeftGame', 'Timeout', 'Kicked', 'Banned', 'ServerShutdown', 'ServerError', 'AuthSessionCancelled', 'AuthenticationError', 'ClientError', 'IncorrectVersion', 'IncorrectPassword', 'ServerFull'] as const;
const reasonText = (r: string): string => {
  const key = REASONS.find((x) => r.startsWith(x));
  return key ? t(`gn.cn.r.${key}` as 'gn.cn.r.LeftGame') : r || '—';
};
const reasonCls = (c: ConnectionItem): string => (c.removedBy ? 'pill pill-warn' : /^Timeout/.test(c.reason) ? 'pill pill-warn' : c.kind === 'join' ? 'pill pill-ok' : 'pill pill-mute');

/**
 * Who came and who went, and why (plugin 0.18+): what the game said, how long the player was in and whether CoreGSM removed him.
 * «CoreGSM не трогал» means the plugin had nothing to do with the departure. Follows the nickname typed in the search of the log.
 */
export function ConnectionsSection({ player, onPick }: { player: string; onPick: (nick: string) => void }) {
  useI18n();
  const [items, setItems] = useState<ConnectionItem[] | null>(null);
  const url = `/game-news/connections?player=${encodeURIComponent(player.trim())}&limit=150`;
  const load = () => api<{ items: ConnectionItem[] }>(url).then((r) => setItems(r.items)).catch(() => undefined);
  usePoll(load, 15_000);
  useEffect(() => { void api<{ items: ConnectionItem[] }>(url).then((r) => setItems(r.items)).catch(() => undefined); }, [url]);

  return (
    <section className="panel space-y-3 p-5">
      <div>
        <h3 className="font-extrabold">{t('gn.cn.title')}</h3>
        <p className="text-sm font-semibold text-mute">{t('gn.cn.note')}</p>
      </div>
      {items == null && <div className="skeleton h-24 rounded-xl" aria-busy="true" />}
      {items && items.length === 0 && <EmptyState icon="🚪" title={t('gn.cn.empty')} hint={t('gn.cn.emptyHint')} />}
      {items && items.length > 0 && (
        <ul className="divide-y divide-line">
          {items.map((c) => (
            <li key={c.id} className="flex flex-wrap items-start gap-x-3 gap-y-1 py-2.5">
              <span className={reasonCls(c)}>{c.kind === 'join' ? t('gn.cn.join') : reasonText(c.reason)}</span>
              <div className="min-w-0 flex-1 basis-56 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <button type="button" className="font-bold underline decoration-dotted underline-offset-2 hover:text-link" onClick={() => onPick(c.nick)}>{c.nick || '—'}</button>
                  <span className="font-semibold text-mute">{c.serverName && `${c.serverName} · `}{soon(c.ts)}{c.kind === 'leave' && c.minutes >= 0 ? ` · ${t('gn.cn.minutes', { n: c.minutes })}` : ''}</span>
                </div>
                {c.kind === 'leave' && (
                  <p className={c.removedBy ? 'font-semibold text-warn' : 'font-semibold text-mute'}>{c.removedBy ? t('gn.cn.removed', { why: c.removedBy }) : t('gn.cn.notUs')}</p>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
