// The «Серверы» table of the admin area: search, filters, a checkbox per row for bulk actions, the figures of every
// server (status, players, ping, uptime, a 24 h curve) and the row actions as icons. On a phone it is a list of cards.
import { useMemo, useState } from 'react';
import type { Server } from '../api';
import { confirmDialog } from '../confirm';
import { gameColor, gameLabel } from '../games';
import { GameAvatar, IconEdit, IconRefresh, IconTrash, MiniSpark, StatusPill, ago, isLag } from '../ui';
import { countServers, filterServers, type ServerFilter } from './adminServersLogic';

export interface TableActions {
  isAdmin: boolean;
  busyId: number | null;
  uptime: Map<number, number>;
  onRefresh: (s: Server) => void;
  onEdit: (s: Server) => void;
  onRemove: (s: Server) => void;
  /** refresh / delete several at once; resolve when done */
  onRefreshMany: (list: Server[]) => Promise<void>;
  onRemoveMany: (list: Server[]) => Promise<void>;
}

const FILTERS: [ServerFilter, string][] = [['all', 'Все'], ['online', 'Онлайн'], ['problems', 'Проблемы']];
const pct = (v: number | undefined) => (v == null ? '–' : `${(Math.round(v * 10) / 10).toLocaleString('ru-RU')}%`);

export function AdminServersTable({ servers, a }: { servers: Server[]; a: TableActions }) {
  const [filter, setFilter] = useState<ServerFilter>('all');
  const [query, setQuery] = useState('');
  const [sel, setSel] = useState<number[]>([]);
  const [busy, setBusy] = useState(false);
  const counts = useMemo(() => countServers(servers), [servers]);
  const rows = useMemo(() => filterServers(servers, filter, query), [servers, filter, query]);
  const shownIds = rows.map((s) => s.id);
  const picked = servers.filter((s) => sel.includes(s.id));
  const allOn = rows.length > 0 && shownIds.every((id) => sel.includes(id));
  const toggle = (id: number) => setSel((l) => (l.includes(id) ? l.filter((x) => x !== id) : [...l, id]));
  const toggleAll = () => setSel((l) => (allOn ? l.filter((id) => !shownIds.includes(id)) : [...new Set([...l, ...shownIds])]));

  const many = async (fn: (list: Server[]) => Promise<void>) => {
    setBusy(true);
    try { await fn(picked); setSel([]); } finally { setBusy(false); }
  };
  const removeMany = async () => {
    if (!(await confirmDialog({ title: `Удалить серверов: ${picked.length}?`, text: 'Серверы будут удалены вместе с привязками к Discord.', confirmLabel: 'Удалить', danger: true }))) return;
    await many(a.onRemoveMany);
  };

  return (
    <div className="adm-st space-y-3">
      <div className="flex flex-wrap items-center gap-2.5">
        <nav className="seg flex w-fit max-w-full overflow-x-auto" aria-label="Фильтр серверов">
          {FILTERS.map(([id, label]) => (
            <button key={id} type="button" className="seg-item whitespace-nowrap" aria-pressed={filter === id} onClick={() => setFilter(id)}>
              {label} · {counts[id]}
            </button>
          ))}
        </nav>
        <label className="adm-search ml-auto">
          <span aria-hidden>⌕</span>
          <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Найти сервер" aria-label="Найти сервер" />
        </label>
      </div>

      {picked.length > 0 && (
        <div className="adm-bulk" role="region" aria-label="Выбранные серверы">
          <b>Выбрано: {picked.length}</b>
          <button type="button" className="btn btn-soft btn-sm" disabled={busy} onClick={() => void many(a.onRefreshMany)}>Опросить сейчас</button>
          {a.isAdmin && <button type="button" className="btn btn-danger btn-sm" disabled={busy} onClick={() => void removeMany()}>Удалить</button>}
          <button type="button" className="btn btn-ghost btn-sm ml-auto" onClick={() => setSel([])}>Снять выбор</button>
        </div>
      )}

      {rows.length === 0 ? (
        <div className="tile px-5 py-8 text-center font-semibold text-mute">
          Ничего не найдено. <button type="button" className="font-extrabold text-link underline" onClick={() => { setFilter('all'); setQuery(''); }}>Сбросить фильтры</button>
        </div>
      ) : (
        <>
          {/* wide screens: a table */}
          <div className="tile hidden overflow-x-auto p-1.5 md:block">
            <table className="adm-table">
              <thead>
                <tr>
                  <th className="w-9"><input type="checkbox" className="srv-check" checked={allOn} onChange={toggleAll} aria-label="Выбрать все" /></th>
                  <th>Сервер</th>
                  <th>Статус</th>
                  <th>Игроки</th>
                  <th>Пинг</th>
                  <th className="hidden 2xl:table-cell">Аптайм 30 д</th>
                  <th className="hidden lg:table-cell">24 ч</th>
                  <th aria-label="Действия" />
                </tr>
              </thead>
              <tbody>
                {rows.map((s) => (
                  <tr key={s.id} data-selected={sel.includes(s.id) ? 'true' : undefined} className="cursor-pointer" onClick={(e) => { if (!(e.target as HTMLElement).closest('a, button, input, label')) a.onEdit(s); }}>
                    <td><input type="checkbox" className="srv-check" checked={sel.includes(s.id)} onChange={() => toggle(s.id)} aria-label={`Выбрать: ${s.name}`} /></td>
                    <td>
                      <div className="flex min-w-0 items-center gap-3">
                        <GameAvatar game={s.game} size={38} />
                        <div className="min-w-0">
                          <a href={`/servers/${s.id}`} className="block max-w-50 xl:max-w-60 truncate font-extrabold leading-tight hover:text-link" title={s.name}>{s.name}</a>
                          <div className="max-w-50 xl:max-w-60 truncate text-xs font-semibold text-mute" title={s.displayAddress ? `Показывается как ${s.displayAddress}` : undefined}>
                            {gameLabel(s.game)} · <span className="font-mono">{s.host}:{s.port}</span>
                          </div>
                        </div>
                      </div>
                    </td>
                    <td><StatusPill online={s.online} known={s.hasStatus} lag={isLag(s)} maintenance={!!s.maintenance} /></td>
                    <td className="tabular-nums text-mute">{s.online ? <><b className="text-ink">{s.players}</b>/{s.maxPlayers}</> : '—'}</td>
                    <td className="tabular-nums text-mute">{s.online && s.ping != null ? `${s.ping} мс` : '—'}</td>
                    <td className="hidden tabular-nums 2xl:table-cell">{pct(a.uptime.get(s.id))}</td>
                    <td className="hidden lg:table-cell"><MiniSpark serverId={s.id} color={gameColor(s.game)} /></td>
                    <td>
                      <div className="flex items-center justify-end gap-1" role="group" aria-label={`Действия: ${s.name}`}>
                        <a className="row-act" href={`/admin/discord/new/${s.id}`} title="Привязать к Discord" aria-label={`Привязать к Discord: ${s.name}`}>
                          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M21 12a8 8 0 0 1-11.5 7.2L4 20l1-4.2A8 8 0 1 1 21 12z" /></svg>
                        </a>
                        <button type="button" className="row-act" title="Опросить сейчас" aria-label={`Опросить сейчас: ${s.name}`} onClick={() => a.onRefresh(s)} disabled={a.busyId === s.id} aria-busy={a.busyId === s.id || undefined}>
                          <IconRefresh spinning={a.busyId === s.id} />
                        </button>
                        <button type="button" className="row-act" title="Изменить" aria-label={`Изменить: ${s.name}`} onClick={() => a.onEdit(s)}><IconEdit /></button>
                        {a.isAdmin && <button type="button" className="row-act row-act-danger" title="Удалить" aria-label={`Удалить: ${s.name}`} onClick={() => a.onRemove(s)}><IconTrash /></button>}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* a phone: a card per server */}
          <div className="space-y-2.5 md:hidden">
            {rows.map((s) => (
              <div key={s.id} className="tile flex flex-wrap items-center gap-x-3 gap-y-2 p-3.5" data-selected={sel.includes(s.id) ? 'true' : undefined}>
                <input type="checkbox" className="srv-check" checked={sel.includes(s.id)} onChange={() => toggle(s.id)} aria-label={`Выбрать: ${s.name}`} />
                <GameAvatar game={s.game} size={40} />
                <div className="min-w-0 flex-1 basis-40">
                  <a href={`/servers/${s.id}`} className="block wrap-break-word font-extrabold leading-tight">{s.name}</a>
                  <div className="truncate text-xs font-semibold text-mute">{gameLabel(s.game)} · <span className="font-mono">{s.host}:{s.port}</span></div>
                </div>
                <StatusPill online={s.online} known={s.hasStatus} lag={isLag(s)} maintenance={!!s.maintenance} />
                <div className="flex w-full items-center gap-2 text-sm font-semibold text-mute">
                  <span className="tabular-nums">{s.online ? <><b className="text-ink">{s.players}</b>/{s.maxPlayers}</> : '—'}</span>
                  <span>· {ago(s.updatedAt)}</span>
                  <div className="ml-auto flex items-center gap-1">
                    <a className="row-act" href={`/admin/discord/new/${s.id}`} aria-label={`Привязать к Discord: ${s.name}`}>◔</a>
                    <button type="button" className="row-act" aria-label={`Опросить сейчас: ${s.name}`} onClick={() => a.onRefresh(s)} disabled={a.busyId === s.id}><IconRefresh spinning={a.busyId === s.id} /></button>
                    <button type="button" className="row-act" aria-label={`Изменить: ${s.name}`} onClick={() => a.onEdit(s)}><IconEdit /></button>
                    {a.isAdmin && <button type="button" className="row-act row-act-danger" aria-label={`Удалить: ${s.name}`} onClick={() => a.onRemove(s)}><IconTrash /></button>}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
