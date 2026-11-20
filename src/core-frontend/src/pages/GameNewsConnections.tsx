import { useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import { soon } from '../components/GameNewsParts';
import { t, useI18n } from '../i18n';
import { usePoll } from '../ui';
import { EmptyState, SubTabs } from './GameNewsUi';
import { useOpenProfile } from './GameNewsProfile';
import { IconDoor } from '../components/GameNewsIcons';
import {
  PERIODS, REPEAT_JOINS, SHORT_VISIT_MIN, STATUSES, buildRows, dayWord, groupByDay, isKicked, isTimeout, matchesStatus, periodSince, repeaters, visitMinutes,
  type ConnectionItem, type Period, type Row, type Status,
} from './connectionsLogic';

export type { ConnectionItem } from './connectionsLogic';

/** the reasons of the game in plain words; an unknown one is shown as the game wrote it */
const REASONS = ['LeftGame', 'Timeout', 'Kicked', 'Banned', 'ServerShutdown', 'ServerError', 'AuthSessionCancelled', 'AuthenticationError', 'ClientError', 'IncorrectVersion', 'IncorrectPassword', 'ServerFull'] as const;
const reasonText = (r: string): string => {
  const key = REASONS.find((x) => r.startsWith(x));
  return key ? t(`gn.cn.r.${key}` as 'gn.cn.r.LeftGame') : r || '—';
};
const clock = (ts: number) => new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const fullTime = (ts: number) => `${new Date(ts).toLocaleString([], { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', second: '2-digit' })} · ${soon(ts)}`;
const dayTitle = (day: string): string => {
  const w = dayWord(day);
  if (w) return t(`gn.cn.day.${w}` as 'gn.cn.day.today');
  return new Date(`${day}T12:00:00`).toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' });
};
const pillOf = (r: Row): { cls: string; text: string } => {
  if (r.inGame) return { cls: 'pill pill-ok', text: t('gn.cn.inGame') };
  if (!r.leave) return { cls: 'pill pill-ok', text: t('gn.cn.join') };
  const warn = !!r.leave.removedBy || isTimeout(r) || isKicked(r);
  return { cls: warn ? 'pill pill-warn' : 'pill pill-mute', text: reasonText(r.leave.reason) };
};

const PAGE = 200;
const compactKey = 'coregsm_cn_compact';
const readCompact = (): boolean => { try { return localStorage.getItem(compactKey) === '1'; } catch { return false; } };

/**
 * Who came and who went, and why (plugin 0.18+): one line per visit («came → left · how long»), grouped by day, with the reason of the
 * game and a note only when CoreGSM itself removed the player. Follows the nickname typed in the search of the log.
 */
export function ConnectionsSection({ player, onPick }: { player: string; onPick: (nick: string) => void }) {
  useI18n();
  const [items, setItems] = useState<ConnectionItem[] | null>(null);
  const [status, setStatus] = useState<Status>('all');
  const [period, setPeriod] = useState<Period>('week');
  const [server, setServer] = useState(0);
  // how many entries are asked for; a new search, server or period starts from the first page again
  const filterKey = `${player.trim()}|${server}|${period}`;
  const [more, setMore] = useState({ key: filterKey, n: PAGE });
  const limit = more.key === filterKey ? more.n : PAGE;
  const [compact, setCompact] = useState(readCompact);
  const url = `/game-news/connections?player=${encodeURIComponent(player.trim())}&limit=${limit}${server ? `&server=${server}` : ''}${period === 'all' ? '' : `&since=${periodSince(period)}`}`;
  const load = () => api<{ items: ConnectionItem[] }>(url).then((r) => setItems(r.items)).catch(() => undefined);
  usePoll(load, 15_000);
  useEffect(() => { void api<{ items: ConnectionItem[] }>(url).then((r) => setItems(r.items)).catch(() => undefined); }, [url]);

  const rows = useMemo(() => (items ? buildRows(items) : []), [items]);
  const again = useMemo(() => repeaters(items ?? []), [items]);
  const servers = useMemo(() => {
    const m = new Map<number, string>();
    for (const c of items ?? []) if (c.serverId) m.set(c.serverId, c.serverName);
    return [...m];
  }, [items]);
  const shown = rows.filter((r) => matchesStatus(r, status));
  const groups = groupByDay(shown);
  const many = servers.length > 1 || server > 0;
  const toggleCompact = () => {
    const v = !compact;
    setCompact(v);
    try { localStorage.setItem(compactKey, v ? '1' : '0'); } catch { /* the choice just is not remembered */ }
  };

  return (
    <section className="panel space-y-3 p-5">
      <div>
        <h3 className="font-extrabold">{t('gn.cn.title')}</h3>
        <p className="text-sm font-semibold text-mute">{t('gn.cn.note')}</p>
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <SubTabs label={t('gn.cn.status')} value={status} onChange={setStatus} items={STATUSES.map((s) => ({ id: s, label: t(`gn.cn.st.${s}` as 'gn.cn.st.all') }))} />
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {player.trim() && (
            <button type="button" className="chip-filter on" onClick={() => onPick('')} aria-label={t('gn.cn.dropPlayer', { name: player.trim() })}>{player.trim()} ✕</button>
          )}
          {servers.length > 1 && (
            <select className="input w-44 py-1 text-sm" value={server} aria-label={t('gn.cn.server')} onChange={(e) => setServer(Number(e.target.value))}>
              <option value={0}>{t('gn.cn.allServers')}</option>
              {servers.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
            </select>
          )}
          <select className="input w-36 py-1 text-sm" value={period} aria-label={t('gn.cn.period')} onChange={(e) => setPeriod(e.target.value as Period)}>
            {PERIODS.map((p) => <option key={p} value={p}>{t(`gn.cn.p.${p}` as 'gn.cn.p.day')}</option>)}
          </select>
          <button type="button" className={`chip-filter ${compact ? 'on' : ''}`} aria-pressed={compact} onClick={toggleCompact}>{t('gn.cn.compact')}</button>
        </div>
      </div>

      {items == null && <div className="skeleton h-24 rounded-xl" aria-busy="true" />}
      {items && items.length === 0 && <EmptyState icon={<IconDoor size={22} />} title={t('gn.cn.empty')} hint={t('gn.cn.emptyHint')} />}
      {items && items.length > 0 && shown.length === 0 && <p className="py-4 text-center text-sm font-semibold text-mute">{t('gn.cn.nothing')}</p>}
      {groups.map((g) => (
        <div key={g.day}>
          <h4 className="sticky top-0 z-[1] bg-card/95 py-1 text-sm font-extrabold capitalize text-mute backdrop-blur">{dayTitle(g.day)} <span className="font-semibold">· {g.rows.length}</span></h4>
          <ul className="divide-y divide-line">
            {g.rows.map((r) => <ConnectionRow key={r.key} r={r} compact={compact} many={many} repeat={again.has(r.who)} />)}
          </ul>
        </div>
      ))}
      {items && items.length >= limit && limit < 1000 && (
        <div className="text-center"><button type="button" className="btn btn-soft btn-sm" onClick={() => setMore({ key: filterKey, n: limit + PAGE })}>{t('gn.cn.more')}</button></div>
      )}
    </section>
  );
}

function ConnectionRow({ r, compact, many, repeat }: { r: Row; compact: boolean; many: boolean; repeat: boolean }) {
  const openProfile = useOpenProfile();
  const pill = pillOf(r);
  const mins = visitMinutes(r);
  const short = !!r.leave && mins != null && mins < SHORT_VISIT_MIN;
  const span = r.join && r.leave
    ? `${clock(r.join.ts)} → ${clock(r.leave.ts)}`
    : r.join ? `${clock(r.join.ts)} → ${r.inGame ? t('gn.cn.now') : '…'}` : `→ ${clock(r.at)}`;
  return (
    <li className={`flex flex-wrap items-start gap-x-3 gap-y-1 ${compact ? 'py-1' : 'py-2.5'}`} title={fullTime(r.at)}>
      <span className={`${pill.cls} shrink-0`}>{pill.text}</span>
      <div className="min-w-0 flex-1 basis-56 text-sm">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
          <button type="button" className="font-bold underline decoration-dotted underline-offset-2 hover:text-link" title={t('gn.pf.open')} onClick={() => { if (r.nick) openProfile(r.nick); }}>{r.nick || '—'}</button>
          <span className="font-semibold tabular-nums text-mute">{span}{mins != null ? ` · ${t('gn.cn.min', { n: mins })}` : ''}</span>
          {many && r.serverName && <span className="min-w-0 truncate text-xs font-semibold text-mute">{r.serverName}</span>}
          {repeat && <span className="pill pill-warn" title={t('gn.cn.repeatHint', { n: REPEAT_JOINS })}>{t('gn.cn.repeat')}</span>}
          {short && !repeat && <span className="pill pill-mute" title={t('gn.cn.shortHint', { n: SHORT_VISIT_MIN })}>{t('gn.cn.short')}</span>}
        </div>
        {r.leave?.removedBy && <p className="font-semibold text-warn">{t('gn.cn.removed', { why: r.leave.removedBy })}</p>}
      </div>
    </li>
  );
}
