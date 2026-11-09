import { useEffect, useState } from 'react';
import { api } from '../api';
import { soon } from '../components/GameNewsParts';
import { confirmDialog } from '../confirm';
import { t, useI18n } from '../i18n';
import type { ModBan, ModEntry, ModTop } from '../gameNews';
import { errText, toast, usePoll } from '../ui';
import { EmptyState, SubTabs } from './GameNewsUi';

const FILTERS = ['all', 'kick', 'ban', 'warn', 'unban'] as const;
type Filter = (typeof FILTERS)[number];

export const MOD_PLAYER_KEY = 'coregsm.gn.modplayer';
const KIND_CLS: Record<ModEntry['kind'], string> = { kick: 'pill pill-warn', ban: 'pill pill-warn', warn: 'pill pill-mute', unban: 'pill pill-ok' };

/** «до 10.12 10:00» or «навсегда» */
const untilText = (until: number): string => (until === 0 ? t('gn.md.forever') : t('gn.md.until', { time: new Date(until).toLocaleString([], { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) }));

/**
 * What administrators did from the game: the bans in force (with «Разбанить»), who was kicked, warned and banned most, and the log with a
 * search by nickname. A click on a nickname anywhere (here or in the journal) shows that player's history.
 */
export function ModerationTab() {
  useI18n();
  const [filter, setFilter] = useState<Filter>('all');
  const [player, setPlayer] = useState(() => { try { return localStorage.getItem(MOD_PLAYER_KEY) ?? ''; } catch { return ''; } });
  const [data, setData] = useState<{ bans: ModBan[]; log: ModEntry[]; top: ModTop[] } | null>(null);
  // a nickname chosen elsewhere is used once
  useEffect(() => { try { localStorage.removeItem(MOD_PLAYER_KEY); } catch { /* private mode */ } }, []);

  const load = () => api<{ bans: ModBan[]; log: ModEntry[]; top: ModTop[] }>(`/game-news/moderation?kind=${filter === 'all' ? '' : filter}&player=${encodeURIComponent(player.trim())}`).then(setData).catch(() => undefined);
  usePoll(load, 10_000);
  useEffect(() => { void load(); }, [filter, player]); // eslint-disable-line react-hooks/exhaustive-deps

  const unban = async (b: ModBan) => {
    if (!(await confirmDialog({ title: t('gn.md.unbanTitle', { nick: b.nick || b.masked }), text: t('gn.md.unbanText'), confirmLabel: t('gn.md.unban') }))) return;
    try { await api(`/game-news/bans/${b.platformId}`, 'DELETE'); toast(t('gn.md.unbanned')); await load(); } catch (e) { toast(errText(e as Error), 'err'); }
  };
  const name = (nick: string) => (
    <button type="button" className="font-bold underline decoration-dotted underline-offset-2 hover:text-link" title={t('gn.md.history')} onClick={() => setPlayer(nick)}>{nick || '—'}</button>
  );

  return (
    <div className="space-y-5">
      <section className="panel space-y-3 p-5">
        <div>
          <h3 className="font-extrabold">{t('gn.md.bans')}</h3>
          <p className="text-sm font-semibold text-mute">{t('gn.md.bansNote')}</p>
        </div>
        {data == null && <div className="skeleton h-16 rounded-xl" aria-busy="true" />}
        {data && data.bans.length === 0 && <EmptyState icon="⛔" title={t('gn.md.bansEmpty')} hint={t('gn.md.bansEmptyHint')} />}
        {data && data.bans.length > 0 && (
          <ul className="divide-y divide-line">
            {data.bans.map((b) => (
              <li key={b.platformId} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-3">
                <div className="min-w-0 flex-1 basis-56">
                  <div className="flex flex-wrap items-center gap-2">
                    {name(b.nick)}
                    <span className={b.kind === 'block' ? 'pill pill-mute' : 'pill pill-warn'}>{b.kind === 'block' ? t('gn.md.block') : untilText(b.until)}</span>
                  </div>
                  <div className="text-sm font-semibold text-mute">{b.masked} · {b.reason || '—'} · {b.admin || '—'} · {soon(b.createdAt)}</div>
                </div>
                <button type="button" className="btn btn-soft btn-sm" onClick={() => void unban(b)}>{t('gn.md.unban')}</button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {data && data.top.length > 0 && (
        <section className="panel space-y-3 p-5">
          <h3 className="font-extrabold">{t('gn.md.top')}</h3>
          <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {data.top.map((p) => (
              <li key={p.platformId} className="flex items-center gap-3 rounded-xl border border-line px-3 py-2">
                <span aria-hidden className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-soft text-sm font-extrabold">{(p.nick || '?').slice(0, 1).toUpperCase()}</span>
                <div className="min-w-0 flex-1">
                  <div className="truncate">{name(p.nick)}</div>
                  <div className="text-xs font-semibold text-mute">{t('gn.md.counts', { k: p.kicks, w: p.warns, b: p.bans })} · {soon(p.last)}</div>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="panel space-y-3 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="font-extrabold">{t('gn.md.log')}</h3>
          <div className="flex items-center gap-2">
            <input className="input w-56" value={player} placeholder={t('gn.md.search')} aria-label={t('gn.md.search')} onChange={(e) => setPlayer(e.target.value)} />
            {player && <button type="button" className="btn btn-ghost btn-sm" onClick={() => setPlayer('')}>{t('gn.md.clear')}</button>}
          </div>
        </div>
        <SubTabs label={t('gn.md.log')} value={filter} onChange={setFilter} items={FILTERS.map((f) => ({ id: f, label: t(`gn.md.f.${f}` as 'gn.md.f.all') }))} />
        {data == null && <div className="skeleton h-24 rounded-xl" aria-busy="true" />}
        {data && data.log.length === 0 && <EmptyState icon="🗒" title={t('gn.md.logEmpty')} hint={t('gn.md.logEmptyHint')} />}
        {data && data.log.length > 0 && (
          <ul className="divide-y divide-line">
            {data.log.map((e) => (
              <li key={e.id} className="flex flex-wrap items-start gap-x-3 gap-y-1 py-3">
                <span className={KIND_CLS[e.kind]}>{t(`gn.md.k.${e.kind}` as 'gn.md.k.kick')}</span>
                <div className="min-w-0 flex-1 basis-56">
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    {name(e.nick)}
                    {e.kind === 'ban' && <span className="font-semibold text-mute">{untilText(e.until)}</span>}
                    <span className="font-semibold text-mute">{e.serverName && `${e.serverName} · `}{soon(e.ts)} · {e.admin || '—'}</span>
                  </div>
                  {e.reason && <p className="wrap-break-word text-sm">{e.reason}</p>}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
