import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api';
import { soon } from '../components/GameNewsParts';
import { Styled } from '../components/NewsEditor';
import { KIND_ICON, PLUGIN_NOTE_ICON } from '../components/GameNewsIcons';
import { confirmDialog } from '../confirm';
import { gameColor } from '../games';
import type { NewsServerInfo } from '../gameNews';
import { t, useI18n } from '../i18n';
import { errText, toast, usePoll } from '../ui';
import { EmptyState, SubTabs } from './GameNewsUi';
import { dayWord } from './connectionsLogic';
import { FILTERS, KEEP_DAYS, PLUGIN_KINDS, adviceKey, groupDays, isMessage, isProblem, relatedOf, tookSeconds, type Entry, type Filter } from './journalLogic';

/** the colour of the round icon of an entry: red for a problem, green for what went well, grey for the rest */
const toneOf = (e: Entry): string => (isProblem(e) ? 'bg-badbg text-bad' : (isMessage(e) && e.status === 'delivered') || (e.kind === 'restart' && e.status === 'done') ? 'bg-okbg text-ok' : 'bg-soft text-ink');
/** the icon of an entry, drawn (a component picked in the middle of a render would be a new one every time) */
function EntryIcon({ e, size }: { e: Entry; size: number }) {
  const Ico = e.kind === 'plugin' ? PLUGIN_NOTE_ICON[e.status] ?? PLUGIN_NOTE_ICON.other : KIND_ICON[e.kind];
  return <Ico size={size} />;
}

const MSG_STATUS: Record<string, { text: 'gn.h.queued' | 'gn.h.ok' | 'gn.h.expired' | 'gn.h.fail'; cls: string }> = {
  queued: { text: 'gn.h.queued', cls: 'pill pill-mute' },
  delivered: { text: 'gn.h.ok', cls: 'pill pill-ok' },
  expired: { text: 'gn.h.expired', cls: 'pill pill-warn' },
  failed: { text: 'gn.h.fail', cls: 'pill pill-bad' },
};
const RESTART_STATUS: Record<string, { text: 'gn.rr.o.counting' | 'gn.rr.o.done' | 'gn.rr.o.cancelled' | 'gn.rr.o.missed' | 'gn.rr.o.replaced'; cls: string }> = {
  counting: { text: 'gn.rr.o.counting', cls: 'pill pill-warn' },
  done: { text: 'gn.rr.o.done', cls: 'pill pill-ok' },
  cancelled: { text: 'gn.rr.o.cancelled', cls: 'pill pill-mute' },
  missed: { text: 'gn.rr.o.missed', cls: 'pill pill-bad' },
  replaced: { text: 'gn.rr.o.replaced', cls: 'pill pill-mute' },
};
const LINK_TEXT: Record<string, 'gn.jn.reg' | 'gn.jn.login' | 'gn.jn.unlink'> = { game_register: 'gn.jn.reg', game_login: 'gn.jn.login', game_unlink: 'gn.jn.unlink' };

interface Counts { [kind: string]: number; problems: number }
interface JournalAnswer { items: Entry[]; counts?: Counts; retentionDays?: number }

const PAGE = 100;
const COMPACT_KEY = 'coregsm_jn_compact';
const readCompact = (): boolean => { try { return localStorage.getItem(COMPACT_KEY) === '1'; } catch { return false; } };
const clock = (ts: number) => new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
const fullTime = (ts: number) => new Date(ts).toLocaleString([], { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' });
const dayTitle = (day: string): string => {
  const w = dayWord(day);
  if (w) return t(`gn.cn.day.${w}` as 'gn.cn.day.today');
  return new Date(`${day}T12:00:00`).toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' });
};

/** the label of an entry: who did it and where it went («Админ → Rust», «Автообъявление Тех.работы → Rust») */
const whoWhere = (e: Entry): string => {
  const who = e.kind === 'auto' ? e.by.replace(/^авто:\s*/i, '') || t('gn.jn.f.auto') : e.kind === 'discord' ? e.by.replace(/^Discord:\s*/i, '') || 'Discord' : e.kind === 'mod' ? e.by : e.by;
  return [who, e.serverName].filter(Boolean).join(' → ');
};

/** the status of an entry as a pill (and for a message the number of players who saw it) */
function StatusPills({ e }: { e: Entry }) {
  if (e.kind === 'restart') return <span className={RESTART_STATUS[e.status]?.cls ?? 'pill pill-mute'}>{RESTART_STATUS[e.status] ? t(RESTART_STATUS[e.status].text) : e.status}</span>;
  if (e.kind === 'mod') return <span className={e.status === 'unban' ? 'pill pill-ok' : 'pill pill-warn'}>{t(`gn.md.k.${e.status}` as 'gn.md.k.kick')}</span>;
  if (e.kind === 'link') return <span className="pill pill-ok">{LINK_TEXT[e.status] ? t(LINK_TEXT[e.status]) : e.status}</span>;
  if (e.kind === 'plugin') return <span className={`pill ${isProblem(e) ? 'pill-warn' : 'pill-mute'}`}>{t(`gn.jn.pk.${(PLUGIN_KINDS as readonly string[]).includes(e.status) ? e.status : 'other'}` as 'gn.jn.pk.other')}</span>;
  if (e.kind === 'conn') return <span className="pill pill-warn">{e.status}</span>;
  return (
    <>
      <span className={MSG_STATUS[e.status]?.cls ?? 'pill pill-mute'}>{MSG_STATUS[e.status] ? t(MSG_STATUS[e.status].text) : e.status}</span>
      {e.shown != null && e.shown >= 0 && e.status === 'delivered' && <span className="pill pill-ok" title={t('gn.jn.shownTitle')}>{t('gn.jn.shown', { n: e.shown })}</span>}
    </>
  );
}

/** the text of an entry in one line (the whole text when it is open) */
function Body({ e, open, onPlayer }: { e: Entry; open: boolean; onPlayer: (nick: string) => void }) {
  if (e.kind === 'restart') return <span>{t('gn.jn.restartLine', { n: e.text })}</span>;
  if (e.kind === 'mod') {
    return (
      <span>
        <button type="button" className="font-bold underline decoration-dotted underline-offset-2 hover:text-link" title={t('gn.md.history')} onClick={(ev) => { ev.stopPropagation(); onPlayer(e.text); }}>{e.text}</button>
        {e.error && <span className="font-semibold text-mute"> · {e.error}</span>}
      </span>
    );
  }
  if (e.kind === 'link' || e.kind === 'plugin' || e.kind === 'conn') return <span>{e.kind === 'conn' ? `${e.text} · ${e.status}` : e.text}</span>;
  return open ? <Styled text={e.text} /> : <span className="line-clamp-1"><Styled text={e.text} /></span>;
}

/** the row of an entry: a click opens it (the whole text as the game shows it, who and when, what belongs to it, what was around it) */
function Row({ e, color, compact, open, onToggle, all, onReuse, onPlayer, onFilterServer }: {
  e: Entry; color: string | null; compact: boolean; open: boolean; onToggle: () => void; all: Entry[]; onReuse: (text: string) => void; onPlayer: (nick: string) => void; onFilterServer: (id: number) => void;
}) {
  const advice = adviceKey(e);
  const took = tookSeconds(e);
  const related = open ? relatedOf(e, all) : [];
  const [near, setNear] = useState<Entry[] | null>(null);
  const loadNear = () => api<JournalAnswer>(`/game-news/journal?around=${e.ts}${e.serverId ? `&server=${e.serverId}` : ''}`).then((r) => setNear(r.items.filter((x) => x.id !== e.id))).catch(() => setNear([]));
  const problem = isProblem(e);
  return (
    <li className={`jn-row ${problem ? 'is-problem' : ''} ${open ? 'is-open' : ''}`}>
      <button type="button" className={`flex w-full items-start gap-3 text-left ${compact ? 'py-1.5' : 'py-2.5'}`} aria-expanded={open} onClick={onToggle}>
        <span aria-hidden className={`relative flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${toneOf(e)}`} title={t(`gn.jn.f.${e.kind === 'conn' ? 'plugin' : e.kind}` as 'gn.jn.f.all')}>
          <EntryIcon e={e} size={16} />
          {color && <i className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full ring-2 ring-card" style={{ background: color }} />}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
            <time dateTime={new Date(e.ts).toISOString()} title={`${fullTime(e.ts)} · ${soon(e.ts)}`} className="font-bold tabular-nums text-mute">{clock(e.ts)}</time>
            <span className="min-w-0 truncate font-bold">{whoWhere(e)}</span>
            <StatusPills e={e} />
          </span>
          {!compact && <span className="mt-0.5 block text-sm"><Body e={e} open={open} onPlayer={onPlayer} /></span>}
          {problem && e.error && <span className="mt-0.5 block text-sm font-semibold text-bad">{e.error}</span>}
        </span>
        <span aria-hidden className="mt-1.5 shrink-0 text-mute">{open ? '▴' : '▾'}</span>
      </button>

      {open && (
        <div className="space-y-3 pb-3 pl-11 text-sm">
          {compact && <p className="wrap-break-word"><Body e={e} open onPlayer={onPlayer} /></p>}
          {isMessage(e) && (
            <div>
              <div className="mb-1 text-xs font-bold text-mute">{t('gn.jn.preview')}</div>
              <div className="jn-chat"><Styled text={e.text} /></div>
            </div>
          )}
          <dl className="grid gap-x-6 gap-y-1 sm:grid-cols-2">
            <div><dt className="text-xs font-bold text-mute">{t('gn.jn.when')}</dt><dd className="font-semibold">{fullTime(e.ts)}</dd></div>
            {e.by && <div><dt className="text-xs font-bold text-mute">{t('gn.jn.by')}</dt><dd className="font-semibold">{e.by}</dd></div>}
            {e.serverName && (
              <div><dt className="text-xs font-bold text-mute">{t('gn.jn.where')}</dt><dd className="font-semibold">{e.serverId ? <button type="button" className="underline decoration-dotted underline-offset-2 hover:text-link" title={t('gn.jn.onlyServer')} onClick={() => onFilterServer(e.serverId!)}>{e.serverName}</button> : e.serverName}</dd></div>
            )}
            {took != null && <div><dt className="text-xs font-bold text-mute">{t('gn.jn.delivery')}</dt><dd className="font-semibold">{t('gn.jn.took', { s: took })}{e.shown != null && e.shown >= 0 ? ` · ${t('gn.jn.shown', { n: e.shown })}` : ''}</dd></div>}
          </dl>
          {advice && <p className="jn-advice">{t(advice)}</p>}
          {related.length > 0 && (
            <div>
              <div className="mb-1 text-xs font-bold text-mute">{e.kind === 'restart' ? t('gn.jn.relatedRestart') : t('gn.jn.related')}</div>
              <ul className="space-y-0.5">
                {related.map((x) => (
                  <li key={x.id} className="flex flex-wrap items-center gap-2"><time className="tabular-nums text-mute" title={fullTime(x.ts)}>{clock(x.ts)}</time><StatusPills e={x} /><span className="min-w-0 truncate"><Styled text={x.text} /></span></li>
                ))}
              </ul>
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2">
            {(e.kind === 'message' || e.kind === 'auto') && <button type="button" className="btn btn-soft btn-sm" onClick={() => onReuse(e.text)}>{t('gn.reuse')}</button>}
            <button type="button" className="btn btn-soft btn-sm" onClick={() => void loadNear()}>{t('gn.jn.around')}</button>
          </div>
          {near && (
            near.length === 0
              ? <p className="font-semibold text-mute">{t('gn.jn.aroundNone')}</p>
              : (
                <ul className="space-y-0.5 rounded-xl bg-soft p-2.5" aria-label={t('gn.jn.around')}>
                  {near.slice(0, 30).map((x) => (
                    <li key={x.id} className="flex flex-wrap items-center gap-2">
                      <time className="tabular-nums text-mute" title={fullTime(x.ts)}>{clock(x.ts)}</time>
                      <span aria-hidden className="text-mute"><EntryIcon e={x} size={14} /></span>
                      <span className="min-w-0 truncate font-semibold">{x.kind === 'restart' ? t('gn.jn.restartLine', { n: x.text }) : <Styled text={x.text} />}</span>
                    </li>
                  ))}
                </ul>
              )
          )}
        </div>
      )}
    </li>
  );
}

/** how long the journal is kept and a way to clear the old part */
function KeepSettings({ days, onChanged }: { days: number; onChanged: () => void }) {
  useI18n();
  const [value, setValue] = useState(days);
  useEffect(() => setValue(days), [days]);
  const save = async (n: number) => {
    setValue(n);
    try { await api('/game-news/journal/settings', 'PUT', { days: n }); toast(t('al.saved')); onChanged(); } catch (err) { toast(errText(err), 'err'); }
  };
  const purge = async () => {
    if (!(await confirmDialog({ title: t('gn.jn.purgeTitle'), text: t('gn.jn.purgeText', { n: value }), confirmLabel: t('gn.jn.purge', { n: value }), danger: true }))) return;
    try { const r = await api<{ removed: number }>(`/game-news/journal?olderThanDays=${value}`, 'DELETE'); toast(t('gn.jn.purged', { n: r.removed })); onChanged(); } catch (err) { toast(errText(err), 'err'); }
  };
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-xl bg-soft p-3 text-sm">
      <label className="flex items-center gap-2 font-bold">
        {t('gn.jn.keep')}
        <select className="input w-28 py-1 text-sm" value={value} onChange={(e) => void save(Number(e.target.value))}>
          {(KEEP_DAYS.includes(value as never) ? KEEP_DAYS : [...KEEP_DAYS, value].sort((a, b) => a - b)).map((d) => <option key={d} value={d}>{t('gn.jn.days', { n: d })}</option>)}
        </select>
      </label>
      <button type="button" className="btn btn-soft btn-sm" onClick={() => void purge()}>{t('gn.jn.purge', { n: value })}</button>
    </div>
  );
}

/** everything the plugin did in one list: messages (by hand, by a rule, from Discord), restarts, linked players, what the plugin told about itself */
export function JournalTab({ onReuse, onPlayer }: { onReuse: (text: string) => void; onPlayer: (nick: string) => void }) {
  useI18n();
  const [filter, setFilter] = useState<Filter>('all');
  const [server, setServer] = useState(0);
  const [servers, setServers] = useState<NewsServerInfo[]>([]);
  // how many entries are asked for; another filter or server starts from the first page again
  const key = `${filter}|${server}`;
  const [more, setMore] = useState({ key, n: PAGE });
  const limit = more.key === key ? more.n : PAGE;
  const [items, setItems] = useState<Entry[] | null>(null);
  const [counts, setCounts] = useState<Counts | null>(null);
  const [keepDays, setKeepDays] = useState(30);
  const [compact, setCompact] = useState(readCompact);
  const [openId, setOpenId] = useState<string | null>(null);
  const [settings, setSettings] = useState(false);
  // the filter the person looks at now: an answer for another one (a slow request of the tab left a moment ago) is dropped
  const current = useRef(key);
  current.current = key;
  const url = `/game-news/journal?kind=${filter}&limit=${limit}${server ? `&server=${server}` : ''}`;
  const take = useCallback((k: string, r: JournalAnswer) => {
    if (current.current !== k) return;
    setItems(r.items);
    if (r.counts) setCounts(r.counts);
    if (r.retentionDays) setKeepDays(r.retentionDays);
  }, []);
  // a new filter is read at once (the poll below only repeats it: waiting for its next turn left the list empty for ten seconds)
  useEffect(() => {
    let off = false;
    setItems(null);
    void api<JournalAnswer>(url).then((r) => { if (!off) take(key, r); }).catch(() => undefined);
    return () => { off = true; };
  }, [url, key, take]);
  usePoll(() => { const k = key; return api<JournalAnswer>(url).then((r) => take(k, r)).catch(() => undefined); }, 10_000);
  useEffect(() => { void api<{ servers: NewsServerInfo[] }>('/game-news').then((r) => setServers(r.servers.filter((s) => s.hasToken))).catch(() => undefined); }, []);

  const colorOf = useMemo(() => {
    const m = new Map<number, string>();
    for (const s of servers) m.set(s.id, gameColor(s.game));
    return m;
  }, [servers]);
  const groups = useMemo(() => groupDays(items ?? []), [items]);
  const toggleCompact = () => { const v = !compact; setCompact(v); try { localStorage.setItem(COMPACT_KEY, v ? '1' : '0'); } catch { /* not remembered */ } };
  const reload = () => { void api<JournalAnswer>(url).then((r) => take(key, r)).catch(() => undefined); };

  return (
    <section className="panel space-y-3 p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-extrabold">{t('gn.jn.title')}</h3>
        <div className="flex flex-wrap items-center gap-2">
          {servers.length > 1 && (
            <select className="input w-48 py-1 text-sm" value={server} aria-label={t('gn.cn.server')} onChange={(e) => setServer(Number(e.target.value))}>
              <option value={0}>{t('gn.cn.allServers')}</option>
              {servers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          )}
          <button type="button" className={`chip-filter ${compact ? 'on' : ''}`} aria-pressed={compact} onClick={toggleCompact}>{t('gn.cn.compact')}</button>
          <button type="button" className={`chip-filter ${settings ? 'on' : ''}`} aria-pressed={settings} aria-label={t('gn.jn.settings')} onClick={() => setSettings((v) => !v)} title={t('gn.jn.settings')}>⚙</button>
        </div>
      </div>
      {settings && <KeepSettings days={keepDays} onChanged={reload} />}
      <SubTabs
        label={t('gn.jn.title')}
        value={filter}
        onChange={(f) => { setFilter(f); setOpenId(null); }}
        items={FILTERS.map((f) => ({ id: f, label: t(`gn.jn.f.${f}` as 'gn.jn.f.all'), badge: f === 'all' ? 0 : counts ? (f === 'problems' ? counts.problems : counts[f] ?? 0) : 0 }))}
      />
      {counts && <p className="text-xs font-semibold text-mute">{t('gn.jn.counts24')}</p>}
      {items == null && <div className="skeleton h-24 rounded-xl" aria-busy="true" />}
      {items && items.length === 0 && <EmptyState icon="🗒" title={filter === 'problems' ? t('gn.jn.noProblems') : t('gn.jn.empty')} hint={filter === 'problems' ? t('gn.jn.noProblemsHint') : t('gn.jn.emptyHint')} />}
      {groups.map((g) => (
        <div key={g.day}>
          <h4 className="sticky top-0 z-[1] bg-card/95 py-1 text-sm font-extrabold capitalize text-mute backdrop-blur">{dayTitle(g.day)} <span className="font-semibold">· {g.items.length}</span></h4>
          <ul className="divide-y divide-line">
            {g.items.map((e) => (
              <Row key={e.id} e={e} color={e.serverId && servers.length > 1 ? colorOf.get(e.serverId) ?? null : null} compact={compact} open={openId === e.id} onToggle={() => setOpenId(openId === e.id ? null : e.id)} all={items ?? []} onReuse={onReuse} onPlayer={onPlayer} onFilterServer={setServer} />
            ))}
          </ul>
        </div>
      ))}
      {items && items.length >= limit && limit < 500 && (
        <div className="text-center"><button type="button" className="btn btn-soft btn-sm" onClick={() => setMore({ key, n: limit + PAGE })}>{t('gn.cn.more')}</button></div>
      )}
    </section>
  );
}

