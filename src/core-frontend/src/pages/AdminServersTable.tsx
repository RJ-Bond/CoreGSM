// The «Серверы» table of the admin area: search, filters, a checkbox per row for bulk actions, the figures of every
// server (status, players, ping, uptime, a 24 h curve) and the row actions as icons. On a phone it is a list of cards.
import { Fragment, useEffect, useMemo, useState } from 'react';
import type { Server } from '../api';
import { confirmDialog } from '../confirm';
import { t, useI18n, type TKey } from '../i18n';
import { gameColor, gameLabel } from '../games';
import { AnimatedNumber, GameAvatar, IconEdit, IconRefresh, IconTrash, IconWrench, MiniSpark, StatusPill, ago, isLag, toast } from '../ui';
import { countServers, filterServers, loadColumns, loadTableState, saveColumns, saveTableState, TABLE_COLUMNS, type ServerFilter, type TableColumn } from './adminServersLogic';

export interface TableActions {
  isAdmin: boolean;
  busyId: number | null;
  uptime: Map<number, number>;
  /** Discord channels bound to each server */
  bindings: Map<number, number>;
  onMaintenance: (s: Server) => void;
  onRefresh: (s: Server) => void;
  onEdit: (s: Server) => void;
  onRemove: (s: Server) => void;
  /** refresh / delete several at once; resolve when done */
  onRefreshMany: (list: Server[]) => Promise<void>;
  onRemoveMany: (list: Server[]) => Promise<void>;
  /** move a server one step up/down in the manual order (the ids on screen, in order) */
  onMove: (s: Server, dir: -1 | 1, shown: number[]) => void;
}

const FILTERS: [ServerFilter, TKey][] = [['all', 'adm.tbl.all'], ['online', 'adm.tbl.online'], ['problems', 'adm.tbl.problems']];
/** «2 ч», «15 мин»: how long a state has lasted */
export function spanText(ms: number): string {
  const m = Math.floor(ms / 60_000);
  if (m < 1) return 'меньше минуты';
  if (m < 60) return `${m} мин`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h} ч`;
  return `${Math.floor(h / 24)} дн`;
}
const stateLine = (s: Server): string | null => {
  if (s.maintenance || !s.hasStatus || !s.stateSince) return null;
  return `${s.online ? 'работает' : 'не отвечает'} · ${spanText(Date.now() - s.stateSince)}`;
};
const pct = (v: number | undefined) => (v == null ? '–' : `${(Math.round(v * 10) / 10).toLocaleString('ru-RU')}%`);

export function AdminServersTable({ servers, a }: { servers: Server[]; a: TableActions }) {
  useI18n();
  const [saved] = useState(loadTableState);
  const [filter, setFilter] = useState<ServerFilter>(saved.filter);
  const [query, setQuery] = useState(saved.query);
  useEffect(() => { saveTableState(filter, query); }, [filter, query]);
  const [cols, setCols] = useState<TableColumn[]>(loadColumns);
  const toggleCol = (c: TableColumn) => setCols((l) => { const n = l.includes(c) ? l.filter((x) => x !== c) : TABLE_COLUMNS.filter((x) => x === c || l.includes(x)); saveColumns(n); return n; });
  const has = (c: TableColumn) => cols.includes(c);
  const [sel, setSel] = useState<number[]>([]);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<number[]>([]);
  const [view, setView] = useState<'table' | 'cards'>(() => { try { return localStorage.getItem('coregsm_admin_srv_view') === 'cards' ? 'cards' : 'table'; } catch { return 'table'; } });
  const pickView = (v: 'table' | 'cards') => { setView(v); try { localStorage.setItem('coregsm_admin_srv_view', v); } catch { /* not remembered */ } };
  const counts = useMemo(() => countServers(servers), [servers]);
  const rows = useMemo(() => filterServers(servers, filter, query), [servers, filter, query]);
  const shownIds = rows.map((s) => s.id);
  const canMove = filter === 'all' && !query.trim() && rows.length > 1;
  const picked = servers.filter((s) => sel.includes(s.id));
  const allOn = rows.length > 0 && shownIds.every((id) => sel.includes(id));
  const toggle = (id: number) => setSel((l) => (l.includes(id) ? l.filter((x) => x !== id) : [...l, id]));
  const toggleAll = () => setSel((l) => (allOn ? l.filter((id) => !shownIds.includes(id)) : [...new Set([...l, ...shownIds])]));

  const flip = (id: number) => setOpen((l) => (l.includes(id) ? l.filter((x) => x !== id) : [...l, id]));
  const copy = async (s: Server) => {
    try { await navigator.clipboard.writeText(`${s.host}:${s.port}`); toast(t('adm.tbl.copied')); } catch { toast(t('nw.copyFail'), 'err'); }
  };

  const many = async (fn: (list: Server[]) => Promise<void>) => {
    setBusy(true);
    try { await fn(picked); setSel([]); } finally { setBusy(false); }
  };
  const removeMany = async () => {
    if (!(await confirmDialog({ title: t('adm.tbl.deleteQ', { n: picked.length }), text: t('adm.tbl.deleteText'), confirmLabel: t('adm.srv.delete'), danger: true }))) return;
    await many(a.onRemoveMany);
  };

  return (
    <div className="adm-st space-y-3">
      <div className="flex flex-wrap items-center gap-2.5">
        <nav className="seg flex w-fit max-w-full overflow-x-auto" aria-label={t('adm.tbl.filter')}>
          {FILTERS.map(([id, label]) => (
            <button key={id} type="button" className="seg-item whitespace-nowrap" aria-pressed={filter === id} onClick={() => setFilter(id)}>
              {t(label)} · {counts[id]}
            </button>
          ))}
        </nav>
        <div className="seg hidden w-fit md:flex" role="group" aria-label="Вид списка">
          <button type="button" className="seg-item" aria-pressed={view === 'table'} onClick={() => pickView('table')}>Таблица</button>
          <button type="button" className="seg-item" aria-pressed={view === 'cards'} onClick={() => pickView('cards')}>Карточки</button>
        </div>
        <details className="adm-cols hidden md:block">
          <summary className="seg-item cursor-pointer select-none">{t('adm.cols')}</summary>
          <div className="adm-cols-pop" role="group" aria-label={t('adm.cols')}>
            {TABLE_COLUMNS.map((c) => (
              <label key={c} className="flex cursor-pointer items-center gap-2 px-2 py-1 font-semibold">
                <input type="checkbox" className="srv-check" checked={has(c)} onChange={() => toggleCol(c)} />{t(`adm.col.${c}` as TKey)}
              </label>
            ))}
          </div>
        </details>
        <label className="adm-search ml-auto">
          <span aria-hidden>⌕</span>
          <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('adm.tbl.search')} aria-label={t('adm.tbl.search')} />
        </label>
      </div>

      {picked.length > 0 && (
        <div className="adm-bulk adm-bulk-float" role="region" aria-label={t('adm.tbl.selected')}>
          <b>{t('adm.tbl.picked', { n: picked.length })}</b>
          <button type="button" className="btn btn-soft btn-sm" disabled={busy} onClick={() => void many(a.onRefreshMany)}>{t('adm.tbl.poll')}</button>
          {a.isAdmin && <button type="button" className="btn btn-danger btn-sm" disabled={busy} onClick={() => void removeMany()}>{t('adm.srv.delete')}</button>}
          <button type="button" className="btn btn-ghost btn-sm ml-auto" onClick={() => setSel([])}>{t('adm.tbl.clear')}</button>
        </div>
      )}

      {rows.length === 0 ? (
        <div className="tile px-5 py-8 text-center font-semibold text-mute">
          {t('adm.tbl.none')} <button type="button" className="font-extrabold text-link underline" onClick={() => { setFilter('all'); setQuery(''); }}>{t('adm.tbl.reset')}</button>
        </div>
      ) : (
        <>
          {/* wide screens: a table */}
          <div className={`tile adm-tablewrap hidden p-1.5 ${view === 'table' ? 'md:block' : ''}`}>
            <table className="adm-table">
              <thead>
                <tr>
                  <th className="w-9"><input type="checkbox" className="srv-check" checked={allOn} onChange={toggleAll} aria-label={t('adm.tbl.selectAll')} /></th>
                  <th>{t('adm.tbl.server')}</th>
                  <th>{t('adm.tbl.status')}</th>
                  <th>{t('adm.tbl.players')}</th>
                  <th>{t('adm.tbl.ping')}</th>
                  {has('map') && <th>{t('adm.col.map')}</th>}
                  {has('version') && <th>{t('adm.col.version')}</th>}
                  {has('channels') && <th>{t('adm.col.channels')}</th>}
                  {has('uptime') && <th>{t('adm.tbl.uptime')}</th>}
                  {has('h24') && <th>{t('adm.tbl.h24')}</th>}
                  {has('updated') && <th>{t('adm.col.updated')}</th>}
                  <th aria-label={t('adm.tbl.actions')} />
                </tr>
              </thead>
              <tbody>
                {rows.map((s) => (
                  <Fragment key={s.id}>
                  <tr data-state={s.maintenance ? 'maint' : !s.online && s.hasStatus ? 'off' : isLag(s) ? 'lag' : 'on'} data-selected={sel.includes(s.id) ? 'true' : undefined} className="cursor-pointer" onClick={(e) => { if (!(e.target as HTMLElement).closest('a, button, input, label')) a.onEdit(s); }}>
                    <td><input type="checkbox" className="srv-check" checked={sel.includes(s.id)} onChange={() => toggle(s.id)} aria-label={`${t('adm.tbl.select')}: ${s.name}`} /></td>
                    <td>
                      <div className="flex min-w-0 items-center gap-3">
                        <button type="button" className="adm-expand" aria-expanded={open.includes(s.id)} aria-label={`${t('adm.tbl.details')}: ${s.name}`} title={t('adm.tbl.details')} onClick={() => flip(s.id)}><span aria-hidden>{open.includes(s.id) ? '▾' : '▸'}</span></button>
                        <GameAvatar game={s.game} size={38} />
                        <div className="min-w-0">
                          <a href={`/servers/${s.id}`} className="block max-w-50 xl:max-w-60 truncate font-extrabold leading-tight hover:text-link" title={s.name}>{s.name}</a>
                          <div className="max-w-50 xl:max-w-60 truncate text-xs font-semibold text-mute" title={s.displayAddress ? t('adm.tbl.shownAs', { a: s.displayAddress }) : undefined}>
                            {gameLabel(s.game)} · <button type="button" className="adm-copy font-mono" title={t('adm.tbl.copy')} onClick={() => void copy(s)}>{s.host}:{s.port}</button>
                          </div>
                        </div>
                      </div>
                    </td>
                    <td>
                      <StatusPill online={s.online} known={s.hasStatus} lag={isLag(s)} maintenance={!!s.maintenance} />
                      {stateLine(s) && <div className="mt-0.5 text-xs font-semibold text-mute">{stateLine(s)}</div>}
                    </td>
                    <td className="tabular-nums text-mute">{s.online ? <><b className="text-ink"><AnimatedNumber value={s.players} /></b>/{s.maxPlayers}</> : '—'}</td>
                    <td className="tabular-nums text-mute">{s.online && s.ping != null ? t('adm.tbl.ms', { n: s.ping }) : '—'}</td>
                    {has('map') && <td className="max-w-40 truncate text-mute" title={s.map ?? undefined}>{s.online && s.map ? s.map : '—'}</td>}
                    {has('version') && <td className="max-w-32 truncate font-mono text-xs text-mute" title={s.version ?? undefined}>{s.version || '—'}</td>}
                    {has('channels') && <td className="tabular-nums"><a href="/admin/discord" className="text-link hover:underline">{a.bindings.get(s.id) ?? 0}</a></td>}
                    {has('uptime') && <td className="tabular-nums">{pct(a.uptime.get(s.id))}</td>}
                    {has('h24') && <td><MiniSpark serverId={s.id} color={gameColor(s.game)} /></td>}
                    {has('updated') && <td className="text-mute">{ago(s.updatedAt)}</td>}
                    <td>
                      <div className="flex items-center justify-end gap-1" role="group" aria-label={`${t('adm.tbl.actions')}: ${s.name}`}>
                        {canMove && (
                          <>
                            <button type="button" className="row-act" title={t('adm.tbl.up')} aria-label={`${t('adm.tbl.up')}: ${s.name}`} disabled={s.id === shownIds[0]} onClick={() => a.onMove(s, -1, shownIds)}><span aria-hidden>↑</span></button>
                            <button type="button" className="row-act" title={t('adm.tbl.down')} aria-label={`${t('adm.tbl.down')}: ${s.name}`} disabled={s.id === shownIds[shownIds.length - 1]} onClick={() => a.onMove(s, 1, shownIds)}><span aria-hidden>↓</span></button>
                          </>
                        )}
                        <a className="row-act" href={`/admin/discord/new/${s.id}`} title={t('adm.tbl.bind')} aria-label={`${t('adm.tbl.bind')}: ${s.name}`}>
                          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M21 12a8 8 0 0 1-11.5 7.2L4 20l1-4.2A8 8 0 1 1 21 12z" /></svg>
                        </a>
                        <button type="button" className="row-act" title={t('adm.tbl.poll')} aria-label={`${t('adm.tbl.poll')}: ${s.name}`} onClick={() => a.onRefresh(s)} disabled={a.busyId === s.id} aria-busy={a.busyId === s.id || undefined}>
                          <IconRefresh spinning={a.busyId === s.id} />
                        </button>
                        <button type="button" className={`row-act ${s.maintenance ? 'is-on' : ''}`} title={s.maintenance ? t('adm.tbl.maintOff') : t('adm.tbl.maintOn')} aria-label={`${s.maintenance ? t('adm.tbl.maintOff') : t('adm.tbl.maintOn')}: ${s.name}`} aria-pressed={!!s.maintenance} onClick={() => a.onMaintenance(s)}><IconWrench /></button>
                        <button type="button" className="row-act" title={t('adm.tbl.edit')} aria-label={`${t('adm.tbl.edit')}: ${s.name}`} onClick={() => a.onEdit(s)}><IconEdit /></button>
                        {a.isAdmin && <button type="button" className="row-act row-act-danger" title={t('adm.srv.delete')} aria-label={`${t('adm.srv.delete')}: ${s.name}`} onClick={() => a.onRemove(s)}><IconTrash /></button>}
                      </div>
                    </td>
                  </tr>
                  {open.includes(s.id) && (
                    <tr className="adm-detail">
                      <td colSpan={14}>
                        <dl className="adm-detail-grid">
                          <div><dt>{t('adm.tbl.d.addr')}</dt><dd className="font-mono">{s.host}:{s.port}</dd></div>
                          <div><dt>{t('adm.tbl.d.query')}</dt><dd className="font-mono">{s.queryPort ?? '—'}</dd></div>
                          <div><dt>{t('adm.tbl.d.shown')}</dt><dd>{s.displayAddress || '—'}</dd></div>
                          <div><dt>{t('adm.tbl.d.game')}</dt><dd>{gameLabel(s.game)}</dd></div>
                          <div><dt>{t('adm.tbl.d.channels')}</dt><dd><a href="/admin/discord" className="text-link hover:underline">{a.bindings.get(s.id) ?? 0}</a></dd></div>
                          <div><dt>{t('adm.tbl.d.updated')}</dt><dd>{ago(s.updatedAt)}</dd></div>
                          {s.maintenance && <div><dt>{t('adm.tbl.d.maint')}</dt><dd>{s.maintenance.name}</dd></div>}
                        </dl>
                      </td>
                    </tr>
                  )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>

          {/* a phone: a card per server */}
          <div className={`adm-cards ${view === 'table' ? 'md:hidden' : ''}`}>
            {rows.map((s) => (
              <div key={s.id} className="tile adm-card flex flex-wrap items-center gap-x-3 gap-y-2 p-3.5" data-state={s.maintenance ? 'maint' : !s.online && s.hasStatus ? 'off' : isLag(s) ? 'lag' : 'on'} data-selected={sel.includes(s.id) ? 'true' : undefined}>
                <input type="checkbox" className="srv-check" checked={sel.includes(s.id)} onChange={() => toggle(s.id)} aria-label={`${t('adm.tbl.select')}: ${s.name}`} />
                <GameAvatar game={s.game} size={40} />
                <div className="min-w-0 flex-1 basis-40">
                  <a href={`/servers/${s.id}`} className="block wrap-break-word font-extrabold leading-tight">{s.name}</a>
                  <div className="truncate text-xs font-semibold text-mute">{gameLabel(s.game)} · <span className="font-mono">{s.host}:{s.port}</span></div>
                </div>
                <StatusPill online={s.online} known={s.hasStatus} lag={isLag(s)} maintenance={!!s.maintenance} />
                {stateLine(s) && <div className="w-full text-xs font-semibold text-mute">{stateLine(s)}</div>}
                <div className="flex w-full items-center gap-2 text-sm font-semibold text-mute">
                  <span className="tabular-nums">{s.online ? <><b className="text-ink">{s.players}</b>/{s.maxPlayers}</> : '—'}</span>
                  <span>· {ago(s.updatedAt)}</span>
                  <div className="ml-auto flex items-center gap-1">
                    <a className="row-act" href={`/admin/discord/new/${s.id}`} aria-label={`${t('adm.tbl.bind')}: ${s.name}`}>◔</a>
                    <button type="button" className="row-act" aria-label={`${t('adm.tbl.poll')}: ${s.name}`} onClick={() => a.onRefresh(s)} disabled={a.busyId === s.id}><IconRefresh spinning={a.busyId === s.id} /></button>
                    <button type="button" className="row-act" aria-label={`${t('adm.tbl.edit')}: ${s.name}`} onClick={() => a.onEdit(s)}><IconEdit /></button>
                    {a.isAdmin && <button type="button" className="row-act row-act-danger" aria-label={`${t('adm.srv.delete')}: ${s.name}`} onClick={() => a.onRemove(s)}><IconTrash /></button>}
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
