import { useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import { t, useI18n } from '../i18n';
import { Empty, ErrorLine, LoadError, PageHead, ago, errText, fmtDateTime, toast, usePoll } from '../ui';
import { useAuth } from '../auth';
import { Switch } from '../components/Switch';
import ArtPic from '../components/ArtPic';
import '../styles/bans.css';

export interface PublicBan {
  nick: string;
  reason: string;
  serverId: number;
  server: string;
  scope: 'all' | 'server';
  createdAt: number;
  until: number;
  admin?: string;
  platformId?: string;
}

export interface BansData {
  total: number;
  forever: number;
  last7d: number;
  servers: { id: number; name: string; count: number }[];
  items: PublicBan[];
}

export interface BanHistoryItem {
  kind: 'ban' | 'unban';
  nick: string;
  reason: string;
  serverId: number;
  server: string;
  at: number;
  until: number;
  expired: boolean;
  admin?: string;
}

export interface Appeal {
  id: number;
  at: number;
  nick: string;
  platformId: string;
  text: string;
  contact: string;
  status: 'open' | 'accepted' | 'rejected';
  note: string;
  decidedBy: string | null;
  decidedAt: number | null;
}

const IconBan = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <circle cx="12" cy="12" r="9" /><path d="m5.7 5.7 12.6 12.6" />
  </svg>
);
export { IconBan };

/** «ещё 3 дн.» / «ещё 5 ч» / «ещё 20 мин»: what is left of a ban */
export function leftText(untilMs: number, now: number): string {
  const ms = Math.max(0, untilMs - now);
  const min = Math.ceil(ms / 60_000);
  if (min < 60) return t('bans.left.m', { n: Math.max(1, min) });
  const h = Math.ceil(min / 60);
  if (h < 48) return t('bans.left.h', { n: h });
  return t('bans.left.d', { n: Math.ceil(h / 24) });
}

/** the filter of the list: a server (0 = all) and a piece of the nickname or of the reason */
export function filterBans(items: PublicBan[], server: number, q: string): PublicBan[] {
  const s = q.trim().toLowerCase();
  return items.filter((b) => (server === 0 || b.scope === 'all' || b.serverId === server) && (!s || b.nick.toLowerCase().includes(s) || b.reason.toLowerCase().includes(s)));
}

function Stat({ n, label }: { n: number; label: string }) {
  return (
    <div className="bn-stat">
      <b className="tabular-nums">{n}</b>
      <span>{label}</span>
    </div>
  );
}

function Row({ b, now, staff }: { b: PublicBan; now: number; staff: boolean }) {
  const forever = b.until === 0;
  return (
    <li className="bn-row">
      <span className="bn-ava" aria-hidden>{(Array.from(b.nick)[0] ?? '?').toUpperCase()}</span>
      <div className="bn-main">
        <div className="bn-head">
          <a className="bn-nick" href={`/player/${encodeURIComponent(b.nick)}`}>{b.nick || '—'}</a>
          <time className="bn-when" dateTime={new Date(b.createdAt).toISOString()} title={fmtDateTime(b.createdAt)}>{ago(b.createdAt)}</time>
        </div>
        <p className={`bn-reason ${b.reason ? '' : 'is-none'}`}>{b.reason || t('bans.noReason')}</p>
        <div className="bn-meta">
          {b.server && <span className="bn-chip">{b.server}</span>}
          <span className="bn-chip">{b.scope === 'server' ? t('bans.scope.server') : t('bans.scope.all')}</span>
          {staff && b.admin && <span className="bn-chip">{t('bans.by', { name: b.admin })}</span>}
          {staff && b.platformId && <span className="bn-chip tabular-nums" title={t('bans.account')}>{b.platformId}</span>}
        </div>
      </div>
      <div className="bn-state">
        {forever ? <span className="pill pill-bad">{t('bans.forever')}</span> : <span className="pill pill-warn" title={fmtDateTime(b.until)}>{leftText(b.until, now)}</span>}
        {!forever && <span className="bn-until">{t('bans.until', { date: fmtDateTime(b.until) })}</span>}
      </div>
    </li>
  );
}

function HistoryRow({ h, staff }: { h: BanHistoryItem; staff: boolean }) {
  const lifted = h.kind === 'unban';
  return (
    <li className="bn-row">
      <span className={`bn-ava ${lifted ? 'is-ok' : ''}`} aria-hidden>{lifted ? '✓' : (Array.from(h.nick)[0] ?? '?').toUpperCase()}</span>
      <div className="bn-main">
        <div className="bn-head">
          <a className="bn-nick" href={`/player/${encodeURIComponent(h.nick)}`}>{h.nick || '—'}</a>
          <time className="bn-when" dateTime={new Date(h.at).toISOString()} title={fmtDateTime(h.at)}>{ago(h.at)}</time>
        </div>
        {!lifted && <p className={`bn-reason ${h.reason ? '' : 'is-none'}`}>{h.reason || t('bans.noReason')}</p>}
        <div className="bn-meta">
          {h.server && <span className="bn-chip">{h.server}</span>}
          {staff && h.admin && <span className="bn-chip">{t('bans.by', { name: h.admin })}</span>}
        </div>
      </div>
      <div className="bn-state">
        {lifted ? <span className="pill pill-ok">{t('bans.h.lifted')}</span> : h.expired ? <span className="pill pill-mute">{t('bans.h.expired')}</span> : h.until === 0 ? <span className="pill pill-bad">{t('bans.forever')}</span> : <span className="pill pill-warn">{t('bans.until', { date: fmtDateTime(h.until) })}</span>}
      </div>
    </li>
  );
}

/** «Вас заблокировали?»: a form of an appeal; the staff reads it in the «Заявки» tab */
function AppealForm() {
  useI18n();
  const [open, setOpen] = useState(false);
  const [nick, setNick] = useState('');
  const [text, setText] = useState('');
  const [contact, setContact] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [sent, setSent] = useState(false);
  const submit = async (e: { preventDefault: () => void }) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api('/bans/appeals', 'POST', { nick: nick.trim(), text: text.trim(), contact: contact.trim() || undefined });
      setSent(true);
    } catch (err) {
      setError(errText(err));
    }
    setBusy(false);
  };
  if (sent) return <p className="bn-appeal bn-appeal-done" role="status">{t('bans.appeal.sent')}</p>;
  return (
    <section className="bn-appeal" aria-label={t('bans.appeal.title')}>
      <button type="button" className="bn-appeal-head" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <b>{t('bans.appeal.title')}</b>
        <span>{t('bans.appeal.hint')}</span>
        <span aria-hidden>{open ? '−' : '+'}</span>
      </button>
      {open && (
        <form className="bn-appeal-form" onSubmit={(e) => void submit(e)}>
          <label className="label" htmlFor="bn-nick">{t('bans.appeal.nick')}</label>
          <input id="bn-nick" className="input" value={nick} onChange={(e) => setNick(e.target.value)} maxLength={100} required />
          <label className="label" htmlFor="bn-text">{t('bans.appeal.text')}</label>
          <textarea id="bn-text" className="input" rows={4} value={text} onChange={(e) => setText(e.target.value)} minLength={10} maxLength={1000} required />
          <label className="label" htmlFor="bn-contact">{t('bans.appeal.contact')}</label>
          <input id="bn-contact" className="input" value={contact} onChange={(e) => setContact(e.target.value)} maxLength={100} />
          <ErrorLine text={error} />
          <button type="submit" className="btn" disabled={busy || nick.trim().length === 0 || text.trim().length < 10}>{t('bans.appeal.send')}</button>
        </form>
      )}
    </section>
  );
}

const fetchAppeals = () => api<Appeal[]>('/bans/appeals');

/** the staff: the appeals; a decision, with the ban lifted at once if asked */
function AppealsPanel({ onChanged }: { onChanged: () => void }) {
  useI18n();
  const [list, setList] = useState<Appeal[] | null>(null);
  const [error, setError] = useState('');
  const load = () => fetchAppeals().then(setList).catch((e: Error) => setError(e.message));
  useEffect(() => {
    let off = false;
    fetchAppeals().then((l) => { if (!off) setList(l); }).catch((e: Error) => { if (!off) setError(e.message); });
    return () => { off = true; };
  }, []);
  const decide = async (a: Appeal, status: 'accepted' | 'rejected', unban: boolean) => {
    try {
      await api(`/bans/appeals/${a.id}`, 'PATCH', { status, unban });
      toast(status === 'accepted' ? t('bans.appeal.accepted') : t('bans.appeal.rejected'));
      await load();
      onChanged();
    } catch (e) {
      setError(errText(e));
    }
  };
  if (error && !list) return <LoadError error={error} onRetry={() => void load()} />;
  if (!list) return <div className="skeleton bn-skel" aria-busy="true" />;
  if (list.length === 0) return <Empty art={<ArtPic src="empty/empty-players" size={132} />} title={t('bans.appeals.none')} text={t('bans.appeals.noneText')} />;
  return (
    <>
      <ErrorLine text={error} />
      <ul className="bn-list">
        {list.map((a) => (
          <li key={a.id} className={`bn-row bn-appeal-row is-${a.status}`}>
            <span className="bn-ava" aria-hidden>{(Array.from(a.nick)[0] ?? '?').toUpperCase()}</span>
            <div className="bn-main">
              <div className="bn-head">
                <a className="bn-nick" href={`/player/${encodeURIComponent(a.nick)}`}>{a.nick}</a>
                <time className="bn-when" dateTime={new Date(a.at).toISOString()} title={fmtDateTime(a.at)}>{ago(a.at)}</time>
              </div>
              <p className="bn-reason">{a.text}</p>
              <div className="bn-meta">
                {a.contact && <span className="bn-chip">{t('bans.appeal.contactOf', { c: a.contact })}</span>}
                {a.decidedBy && <span className="bn-chip">{t('bans.appeal.by', { name: a.decidedBy })}</span>}
              </div>
            </div>
            <div className="bn-state">
              {a.status === 'open' ? (
                <>
                  <button type="button" className="btn btn-sm" onClick={() => void decide(a, 'accepted', true)}>{t('bans.appeal.acceptUnban')}</button>
                  <button type="button" className="btn btn-soft btn-sm" onClick={() => void decide(a, 'rejected', false)}>{t('bans.appeal.reject')}</button>
                </>
              ) : <span className={`pill ${a.status === 'accepted' ? 'pill-ok' : 'pill-mute'}`}>{a.status === 'accepted' ? t('bans.appeal.accepted') : t('bans.appeal.rejected')}</span>}
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}

/** «a push to me about new bans and appeals»: a switch of the staff */
function AlertsToggle() {
  useI18n();
  const [on, setOn] = useState<boolean | null>(null);
  useEffect(() => { api<{ on: boolean }>('/bans/alerts').then((r) => setOn(r.on)).catch(() => setOn(null)); }, []);
  if (on === null) return null;
  const set = async (v: boolean) => {
    setOn(v);
    try { await api('/bans/alerts', 'PUT', { on: v }); } catch (e) { setOn(!v); toast(errText(e), 'err'); }
  };
  return (
    <label className="bn-alerts">
      <Switch id="bans-alerts" checked={on} onChange={(v) => void set(v)} />
      <span>{t('bans.alerts')}<small>{t('bans.alerts.hint')}</small></span>
    </label>
  );
}

type Tab = 'active' | 'history' | 'appeals';

/** the bans: the ones in force, the history, for the staff the appeals; `serverId` narrows it to one server (its tab) */
export function BansView({ serverId = 0 }: { serverId?: number }) {
  useI18n();
  const { me } = useAuth();
  const staff = me?.role === 'admin' || me?.role === 'moderator';
  const [tab, setTab] = useState<Tab>('active');
  const [data, setData] = useState<BansData | null>(null);
  const [history, setHistory] = useState<BanHistoryItem[] | null>(null);
  const [error, setError] = useState('');
  const [server, setServer] = useState(serverId);
  const [q, setQ] = useState('');
  const [now, setNow] = useState(() => Date.now());
  const load = () => api<BansData>('/bans').then((d) => { setData(d); setNow(Date.now()); setError(''); }).catch((e: Error) => setError(e.message));
  usePoll(load, 60_000);
  useEffect(() => {
    if (tab !== 'history') return;
    api<{ items: BanHistoryItem[] }>(`/bans/history${serverId ? `?server=${serverId}` : ''}`).then((r) => setHistory(r.items)).catch((e: Error) => setError(e.message));
  }, [tab, serverId]);

  const shown = useMemo(() => (data ? filterBans(data.items, server, q) : []), [data, server, q]);
  const histShown = useMemo(() => (history ?? []).filter((h) => !q.trim() || h.nick.toLowerCase().includes(q.trim().toLowerCase()) || h.reason.toLowerCase().includes(q.trim().toLowerCase())), [history, q]);
  const tabs: [Tab, string][] = [['active', t('bans.tab.active')], ['history', t('bans.tab.history')], ...(staff ? [['appeals', t('bans.tab.appeals')] as [Tab, string]] : [])];

  return (
    <div className="bn-page">
      {error && !data ? <LoadError error={error} onRetry={() => void load()} /> : <ErrorLine text={error} />}
      {!data && !error && <div className="skeleton bn-skel" aria-busy="true" aria-label={t('bans.loading')} />}
      {data && (
        <>
          {!serverId && (
            <div className="bn-stats">
              <Stat n={data.total} label={t('bans.stat.active')} />
              <Stat n={data.forever} label={t('bans.stat.forever')} />
              <Stat n={data.last7d} label={t('bans.stat.week')} />
            </div>
          )}
          <div className="bn-tabs seg" role="group" aria-label={t('bans.tabs')}>
            {tabs.map(([id, label]) => <button key={id} type="button" className="seg-item" aria-pressed={tab === id} onClick={() => setTab(id)}>{label}</button>)}
          </div>
          {staff && !serverId && <AlertsToggle />}

          {tab !== 'appeals' && (data.total > 0 || tab === 'history') && (
            <div className="bn-bar">
              <input type="search" className="input bn-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('bans.search')} aria-label={t('bans.search')} maxLength={60} />
              {tab === 'active' && !serverId && data.servers.length > 1 && (
                <div className="bn-servers" role="group" aria-label={t('bans.servers')}>
                  <button type="button" className="nw-rub" aria-pressed={server === 0} onClick={() => setServer(0)}>{t('bans.allServers')}</button>
                  {data.servers.map((s) => (
                    <button key={s.id} type="button" className="nw-rub" aria-pressed={server === s.id} onClick={() => setServer(s.id)}>
                      {s.name}<span className="nw-rub-n tabular-nums">{s.count}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {tab === 'active' && (
            <>
              {data.total === 0 && <Empty art={<ArtPic src="empty/empty-players" size={132} />} title={t('bans.empty.title')} text={t('bans.empty.text')} />}
              {data.total > 0 && shown.length === 0 && <Empty art={<ArtPic src="empty/empty-players" size={132} />} title={t('bans.none.title')} text={t('bans.none.text')} />}
              {shown.length > 0 && (
                <ul className="bn-list fade-in" key={`${server}-${q}`} aria-label={t('nav.bans')}>
                  {shown.map((b) => <Row key={`${b.platformId ?? b.nick}-${b.createdAt}`} b={b} now={now} staff={staff} />)}
                </ul>
              )}
              {!serverId && <AppealForm />}
            </>
          )}
          {tab === 'history' && (
            history === null ? <div className="skeleton bn-skel" aria-busy="true" /> : histShown.length === 0
              ? <Empty art={<ArtPic src="empty/empty-players" size={132} />} title={t('bans.h.empty')} text={t('bans.h.emptyText')} />
              : <ul className="bn-list fade-in" aria-label={t('bans.tab.history')}>{histShown.map((h) => <HistoryRow key={`${h.kind}-${h.nick}-${h.at}`} h={h} staff={staff} />)}</ul>
          )}
          {tab === 'appeals' && staff && <AppealsPanel onChanged={() => void load()} />}
        </>
      )}
    </div>
  );
}

/** /bans: the bans that the game plugin has put in force */
export default function BansPage() {
  useI18n();
  return (
    <div className="bn-page">
      <PageHead icon={<IconBan />} title={t('nav.bans')} subtitle={t('bans.subtitle')} />
      <BansView />
    </div>
  );
}
