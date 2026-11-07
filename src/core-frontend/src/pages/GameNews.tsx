import { useEffect, useRef, useState, type FormEvent } from 'react';
import { api } from '../api';
import { NewsEditor, NewsPreview, Styled } from '../components/NewsEditor';
import { soon } from '../components/GameNewsParts';
import { confirmDialog } from '../confirm';
import { t, useI18n } from '../i18n';
import {
  pluginConfig, validateNews, versionLess,
  type NewsLogRow, type NewsSendResult, type NewsServerInfo, type NewsStatus, type RulesState,
} from '../gameNews';
import { AdminPage, ErrorLine, IconNews, LoadError, Modal, PageHead, Spinner, errText, navigate, toast, usePoll } from '../ui';
import { ChatCard, ExtrasCard, JoinLeaveCard, RegisterCard, RestartCard, WelcomeCard } from './GameNewsCards';
import { ServerHead } from './GameNewsServerHead';
import { ScopeContext } from './GameNewsScope';
import { ServerRestartCard } from './GameNewsServerRestart';
import GameNewsRules from './GameNewsRules';

interface NewsState { servers: NewsServerInfo[]; log: NewsLogRow[]; pluginLatest: string }

/** 'send' | 'auto' | 'general' | 's<id>' (the settings of one server) | 'history' */
type Tab = string;
const DOCS = 'https://github.com/RJ-Bond/CoreGSM/blob/main/docs/game-plugin.md';

/** «3 с назад», «5 мин назад», «2 ч назад» */
function ago(ts: number): string {
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (s < 90) return t('gn.ago.s', { n: s });
  if (s < 5400) return t('gn.ago.m', { n: Math.round(s / 60) });
  return t('gn.ago.h', { n: Math.round(s / 3600) });
}

const STATUS: Record<NewsStatus, { text: 'gn.h.queued' | 'gn.h.ok' | 'gn.h.expired' | 'gn.h.fail'; cls: string }> = {
  queued: { text: 'gn.h.queued', cls: 'pill pill-mute' },
  delivered: { text: 'gn.h.ok', cls: 'pill pill-ok' },
  expired: { text: 'gn.h.expired', cls: 'pill pill-warn' },
  failed: { text: 'gn.h.fail', cls: 'pill pill-warn' },
};

function Tile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="panel min-w-0 px-4 py-3">
      <div className="text-xs font-bold uppercase tracking-wide text-mute">{label}</div>
      <div className="mt-0.5 wrap-break-word text-lg font-extrabold">{value}</div>
      {sub && <div className="wrap-break-word text-sm font-semibold text-mute">{sub}</div>}
    </div>
  );
}

/** «Игровой плагин»: messages to the in-game chat (the CoreGSM game plugin picks them up), schedules, events, the chat in Discord. */
export default function GameNewsPage({ sub = '' }: { sub?: string }) {
  useI18n();
  const [data, setData] = useState<NewsState | null>(null);
  const [rd, setRd] = useState<RulesState | null>(null);
  const [error, setError] = useState('');
  // the tab is part of the address: /admin/gamenews, /auto, /players, /discord, /history («events» is the old name of «players»)
  // (/general holds the general settings; /s12 the settings of the server 12; «players», «discord» and «events» are the old names of /general)
  const tab: Tab = ['players', 'discord', 'events'].includes(sub) ? 'general' : (/^(send|auto|general|history|s\d+)$/.test(sub) ? sub : 'send');
  const goTab = (x: Tab) => navigate(x === 'send' ? '/admin/gamenews' : `/admin/gamenews/${x}`);
  // the draft survives a switch of the page or a reload (kept in this browser only)
  const [text, setText] = useState(() => { try { return localStorage.getItem('coregsm.gamenews.draft') ?? ''; } catch { return ''; } });
  useEffect(() => { try { if (text) localStorage.setItem('coregsm.gamenews.draft', text); else localStorage.removeItem('coregsm.gamenews.draft'); } catch { /* private mode */ } }, [text]);
  const [picked, setPicked] = useState<number[]>([]);
  const [busy, setBusy] = useState(false);
  const [settingsFor, setSettingsFor] = useState<number | null>(null);
  const [lastResult, setLastResult] = useState<NewsSendResult | null>(null);
  const [showBare, setShowBare] = useState(false);
  const [wizardOff, setWizardOff] = useState(() => { try { return localStorage.getItem('coregsm.gn.wizard') === '0'; } catch { return false; } });

  const loadMain = () => api<NewsState>('/game-news').then((d) => { setData(d); setError(''); }).catch((e: Error) => setError(e.message));
  // the settings of the tab: the general ones (0) or those of one server («s12» is the server 12)
  const [scopeRev, setScopeRev] = useState(0);
  const tabServer = /^s\d+$/.test(tab) ? Number(tab.slice(1)) : 0;
  const effScope = !tabServer || !data || data.servers.some((x) => x.id === tabServer && x.hasToken) ? tabServer : 0;
  const q = effScope ? `?server=${effScope}` : '';
  const loadRules = () => api<RulesState>(`/game-news/rules${q}`).then(setRd).catch(() => undefined);
  usePoll(() => Promise.all([loadMain(), loadRules()]), 10_000);
  // another tab: the old cards go at once, the settings of the new one are read
  useEffect(() => { setRd(null); void loadRules(); }, [effScope]); // eslint-disable-line react-hooks/exhaustive-deps

  const problem = validateNews(text);
  // the plugin exists for some games only: servers of other games are not listed (their number is shown)
  const supported = (data?.servers ?? []).filter((s) => s.supported);
  const hiddenOther = (data?.servers.length ?? 0) - supported.length;
  const withToken = supported.filter((s) => s.hasToken);
  const bare = supported.filter((s) => !s.hasToken);
  const settingsServer = data?.servers.find((s) => s.id === settingsFor) ?? null;
  const touched = useRef(false);
  const toggle = (id: number) => { touched.current = true; setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id])); };
  // a single server with a plugin is chosen right away (until the administrator picks by hand)
  useEffect(() => {
    if (!touched.current && withToken.length === 1 && picked.length === 0) setPicked([withToken[0].id]);
  }, [withToken, picked.length]);
  const sendHint = problem === 'empty' ? t('gn.hint.text') : problem === 'long' ? t('gn.hint.long') : !picked.length ? t('gn.hint.server') : '';

  // the strip on top and the counters on the tabs
  const online = withToken.filter((s) => s.online);
  const players = online.reduce((n, s) => n + (s.players ?? 0), 0);
  const activeRules = (rd?.rules ?? []).filter((r) => r.enabled);
  const nextRun = activeRules.map((r) => r.nextRun).filter((x): x is number => !!x).sort((a, b) => a - b)[0] ?? null;
  const day = Date.now() - 86_400_000;
  const delivered24 = (data?.log ?? []).filter((r) => r.status === 'delivered' && r.sentAt > day).length;
  const queued = (data?.log ?? []).filter((r) => r.status === 'queued').length;
  const eventsOn = rd ? [rd.welcome.enabled, rd.joinLeave.joinEnabled || rd.joinLeave.leaveEnabled, rd.register.enabled, rd.restartCountdown].filter(Boolean).length : 0;
  const chatOn = rd ? (rd.chat.enabled && rd.chat.set ? 1 : 0) : 0;
  const counter: Record<string, number> = { auto: activeRules.length, general: tab === 'general' ? eventsOn + chatOn : 0, history: queued };
  // with one server its settings are the general ones; with several each gets a tab of its own
  const serverTabs = withToken.length > 1 ? withToken : [];
  const tabList: { id: Tab; label: string }[] = [
    { id: 'send', label: t('gn.tab.send') }, { id: 'auto', label: t('gn.tab.auto') }, { id: 'general', label: t('gn.tab.general') },
    { id: 'history', label: t('gn.tab.history') },
  ];

  // the setup guide: until a plugin is online
  const showWizard = !!data && supported.length > 0 && online.length === 0 && !wizardOff;
  const firstBare = bare[0] ?? withToken[0] ?? null;

  const send = async (e?: FormEvent) => {
    e?.preventDefault();
    if (problem || !picked.length || busy) return;
    const names = (data?.servers ?? []).filter((s) => picked.includes(s.id)).map((s) => s.name).join(', ');
    const ok = await confirmDialog({ title: t('gn.confirm.title'), text: t('gn.confirm.text', { servers: names }), confirmLabel: t('gn.send') });
    if (!ok) return;
    setBusy(true);
    try {
      const r = await api<NewsSendResult>('/game-news/send', 'POST', { serverIds: picked, text });
      setLastResult(r);
      const badCount = r.results.filter((x) => !x.queued).length;
      toast(badCount ? t('gn.t.partial', { ok: r.results.length - badCount, total: r.results.length }) : t('gn.t.queued'), badCount ? 'err' : undefined);
      void loadMain();
    } catch (err) {
      toast(errText(err), 'err');
    } finally {
      setBusy(false);
    }
  };

  const serverRow = (s: NewsServerInfo) => {
    const old = s.hasToken && s.online && versionLess(s.pluginVersion, data?.pluginLatest ?? '');
    return (
      <li key={s.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5">
        <label className="flex min-w-0 flex-1 basis-48 items-center gap-2.5 font-bold">
          <input type="checkbox" disabled={!s.hasToken} checked={picked.includes(s.id)} onChange={() => toggle(s.id)} />
          <span className="min-w-0 wrap-break-word">
            {s.name}
            <span className="block text-xs font-semibold text-mute">
              {s.name !== s.address && s.address}
              {s.players != null && <>{s.name !== s.address && ' · '}{t('gn.players', { n: s.players, max: s.maxPlayers ?? 0 })}</>}
            </span>
          </span>
        </label>
        <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
          <span
            className={!s.hasToken ? 'pill pill-mute' : !s.online || old ? 'pill pill-warn' : 'pill pill-ok'}
            title={s.lastSeen ? t('gn.plugin.lastPoll', { time: ago(s.lastSeen) }) : undefined}
          >
            {!s.hasToken
              ? t('gn.plugin.off')
              : !s.online
                ? (s.pluginVersion ? `${t('gn.plugin.silent')} · v${s.pluginVersion}` : t('gn.plugin.silent'))
                : old
                  ? t('gn.plugin.outdated', { v: s.pluginVersion || '?', latest: data?.pluginLatest ?? '' })
                  : `${t('gn.plugin.online')} · v${s.pluginVersion || '?'}`}
          </span>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setSettingsFor(s.id)} aria-label={t('gn.plugin.settings', { name: s.name })}>{t('gn.sv.setup')}</button>
        </div>
      </li>
    );
  };

  return (
    <AdminPage
      head={(
        <PageHead icon={<IconNews size={22} />} title={t('gn.title')} subtitle={t('gn.subtitle')} hint={t('gn.hint')} help={<p>{t('gn.help')}</p>} />
      )}
    >
      {error && !data ? <LoadError error={error} onRetry={() => void loadMain()} /> : <ErrorLine text={error} />}
      {!data && !error && <div className="skeleton panel h-40" aria-busy="true" aria-label={t('d2.news.loading')} />}

      {data && (
        <div className="grid gap-3 min-[560px]:grid-cols-2 lg:grid-cols-4">
          <Tile
            label={t('gn.s.plugin')}
            value={withToken.length ? t('gn.s.pluginVal', { on: online.length, all: withToken.length }) : t('gn.s.pluginNone')}
            sub={online[0]?.pluginVersion ? `v${online[0].pluginVersion}` : undefined}
          />
          <Tile label={t('gn.s.players')} value={online.length ? String(players) : '—'} sub={online.length ? t('gn.s.onServers', { n: online.length }) : undefined} />
          <Tile label={t('gn.s.auto')} value={t('gn.s.autoVal', { n: activeRules.length })} sub={nextRun ? t('gn.s.next', { time: soon(nextRun) }) : undefined} />
          <Tile label={t('gn.s.sent')} value={String(delivered24)} sub={queued ? t('gn.s.queued', { n: queued }) : undefined} />
        </div>
      )}

      {showWizard && (
        <section className="panel space-y-3 p-5" aria-label={t('gn.wz.title')}>
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <h3 className="font-extrabold">{t('gn.wz.title')}</h3>
              <p className="text-sm font-semibold text-mute">{t('gn.wz.note')}</p>
            </div>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setWizardOff(true); try { localStorage.setItem('coregsm.gn.wizard', '0'); } catch { /* private mode */ } }}>{t('gn.wz.hide')}</button>
          </div>
          <ol className="grid gap-3 lg:grid-cols-3">
            {[
              { n: 1, done: withToken.length > 0, title: t('gn.wz.s1'), hint: t('gn.wz.s1h') },
              { n: 2, done: withToken.length > 0, title: t('gn.wz.s2'), hint: t('gn.wz.s2h') },
              { n: 3, done: online.length > 0, title: t('gn.wz.s3'), hint: t('gn.wz.s3h') },
            ].map((st) => (
              <li key={st.n} className="flex items-start gap-3">
                <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-sm font-black ${st.done ? 'bg-ok text-white' : 'bg-soft text-mute'}`} aria-hidden>{st.done ? '✓' : st.n}</span>
                <span className="min-w-0">
                  <span className="block font-bold">{st.title}</span>
                  <span className="block text-sm font-semibold text-mute">{st.hint}</span>
                </span>
              </li>
            ))}
          </ol>
          <div className="flex flex-wrap gap-2">
            {firstBare && !firstBare.hasToken && <button type="button" className="btn btn-sm" onClick={() => setSettingsFor(firstBare.id)}>{t('gn.wz.token')}</button>}
            <a className="btn btn-soft btn-sm" href={DOCS} target="_blank" rel="noreferrer">{t('gn.wz.docs')}</a>
          </div>
        </section>
      )}

      {data && (
        <div className="flex flex-wrap gap-2" role="tablist" aria-label={t('gn.title')}>
          {[...tabList.slice(0, -1), ...serverTabs.map((x) => ({ id: `s${x.id}`, label: x.name, phone: true })), ...tabList.slice(-1)].map((x) => (
            <button key={x.id} type="button" role="tab" aria-selected={tab === x.id} className={`chip-filter ${tab === x.id ? 'on' : ''} ${'phone' in x ? 'md:hidden' : ''}`} onClick={() => goTab(x.id)}>
              {x.label}
              {(counter[x.id] ?? 0) > 0 && <span className="ml-1.5 rounded-full bg-soft px-1.5 text-xs font-extrabold">{counter[x.id]}</span>}
            </button>
          ))}
        </div>
      )}

      {data && tab === 'send' && (
        <form className="grid items-start gap-5 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]" onSubmit={(e) => void send(e)} noValidate>
          <section className="panel p-5"><NewsEditor value={text} onChange={setText} onCtrlEnter={() => void send()} /></section>

          <div className="space-y-5 lg:sticky lg:top-4">
            <NewsPreview text={text} />

            <div className="panel space-y-3 p-5">
              <h3 className="font-extrabold">{t('gn.servers')}</h3>
              {supported.length === 0 && <p className="text-sm font-semibold text-mute">{t('gn.noServers')}</p>}
              <ul className="divide-y divide-line">{withToken.map(serverRow)}</ul>
              {bare.length > 0 && (
                <>
                  {showBare && <ul className="divide-y divide-line">{bare.map(serverRow)}</ul>}
                  <button type="button" className="btn btn-ghost btn-sm" aria-expanded={showBare} onClick={() => setShowBare((v) => !v)}>
                    {showBare ? t('gn.sv.less') : t('gn.sv.more', { n: bare.length })}
                  </button>
                </>
              )}
              {hiddenOther > 0 && <p className="text-sm font-semibold text-mute">{t('gn.hiddenOther', { n: hiddenOther })}</p>}
              {supported.length > 0 && withToken.length === 0 && <p className="text-sm font-semibold text-mute">{t('gn.noPlugin')}</p>}
              {withToken.length > 1 && (
                <button type="button" className="chip-filter" onClick={() => setPicked(picked.length === withToken.length ? [] : withToken.map((s) => s.id))}>
                  {picked.length === withToken.length ? t('gn.pickNone') : t('gn.pickAll')}
                </button>
              )}
              <div className="flex flex-wrap items-center justify-end gap-3">
                {sendHint && <span className="text-sm font-semibold text-mute">{sendHint}</span>}
                <button type="submit" className="btn" disabled={!!problem || !picked.length || busy} title={t('gn.sendKey')}>{busy && <Spinner />}{t('gn.send')}</button>
              </div>
              {lastResult && (
                <ul className="space-y-1 text-sm font-semibold">
                  {lastResult.results.map((r) => (
                    <li key={r.serverId} className={r.queued ? (r.online ? 'text-ok' : undefined) : 'text-danger'}>
                      {r.queued ? '✓' : '✕'} {r.serverName}: {r.queued ? (r.online ? t('gn.r.queued') : t('gn.r.queuedSilent')) : r.error}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </form>
      )}

      {data && tab === 'auto' && rd && <GameNewsRules servers={data.servers} rules={rd.rules} timezone={rd.timezone} reload={() => void loadRules()} />}

      {data && (tab === 'general' || tabServer > 0) && rd && (
        <ScopeContext.Provider value={{
          server: effScope, q, mine: rd.mine,
          changed: () => void loadRules(),
          reset: (part) => { api(`/game-news/server-settings/${effScope}?part=${part}`, 'DELETE').then(() => { setScopeRev((n) => n + 1); return loadRules(); }).catch((e: Error) => toast(errText(e), 'err')); },
        }}>
          <div className="space-y-4" key={`${tab}-${scopeRev}`}>
            {effScope > 0 && data.servers.find((x) => x.id === effScope) && <ServerHead server={data.servers.find((x) => x.id === effScope)!} rd={rd} latest={data.pluginLatest} />}
            {serverTabs.length > 0 && <p className="text-sm font-semibold text-mute">{effScope ? t('gn.sc.noteOne') : t('gn.sc.noteAll')}</p>}
            <WelcomeCard initial={rd.welcome} />
            <JoinLeaveCard initial={rd.joinLeave} />
            <RegisterCard initial={rd.register} />
            <ServerRestartCard />
            {!effScope && <RestartCard enabled={rd.restartCountdown} onChange={(v) => { api('/game-news/restart-countdown', 'PUT', { enabled: v }).then(() => loadRules()).catch((e: Error) => toast(errText(e), 'err')); }} />}
            <ChatCard initial={rd.chat} joinText={rd.joinLeave.joinText} leaveText={rd.joinLeave.leaveText} />
            {!effScope && <ExtrasCard initial={rd.extras} />}
          </div>
        </ScopeContext.Provider>
      )}

      {data && tab === 'history' && (
        <section className="panel overflow-hidden">
          <h3 className="px-5 pt-4 font-extrabold">{t('gn.history')}</h3>
          {data.log.length === 0 && <p className="px-5 py-4 text-sm font-semibold text-mute">{t('gn.historyEmpty')}</p>}
          <ul className="divide-y divide-line">
            {data.log.map((r) => (
              <li key={r.id} className="flex flex-wrap items-start gap-x-4 gap-y-1 px-5 py-3">
                <div className="min-w-0 flex-1 basis-60">
                  <div className="flex flex-wrap items-center gap-2 text-sm font-bold">
                    <span className={STATUS[r.status].cls}>{t(STATUS[r.status].text)}</span>
                    <span>{r.serverName}</span>
                    <span className="font-semibold text-mute">{soon(r.sentAt)} · {r.sentBy || '—'}</span>
                  </div>
                  <p className="mt-1 wrap-break-word text-sm"><Styled text={r.text} /></p>
                  {(r.status === 'failed' || r.status === 'expired') && r.error && <p className="text-sm font-semibold text-danger">{r.error}</p>}
                </div>
                <button type="button" className="btn btn-soft btn-sm" onClick={() => { setText(r.text); goTab('send'); }}>{t('gn.reuse')}</button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {settingsServer && <PluginModal server={settingsServer} onClose={() => setSettingsFor(null)} onChanged={() => void loadMain()} />}
    </AdminPage>
  );
}

/** the token of a server's plugin: created here, shown once, pasted into the plugin config */
function PluginModal({ server, onClose, onChanged }: { server: NewsServerInfo; onClose: () => void; onChanged: () => void }) {
  useI18n();
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const config = token ? pluginConfig(window.location.origin, token) : '';

  const create = async () => {
    if (server.hasToken && !(await confirmDialog({ title: t('gn.plugin.renewTitle'), text: t('gn.plugin.renewText'), confirmLabel: t('gn.plugin.renew'), danger: true }))) return;
    setBusy(true);
    setError('');
    try {
      const r = await api<{ token: string }>(`/game-news/targets/${server.id}/token`, 'POST');
      setToken(r.token);
      onChanged();
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  };
  const remove = async () => {
    if (!(await confirmDialog({ title: t('gn.plugin.removeTitle', { name: server.name }), danger: true, confirmLabel: t('gn.plugin.remove') }))) return;
    try { await api(`/game-news/targets/${server.id}`, 'DELETE'); onChanged(); onClose(); } catch (e) { setError(errText(e)); }
  };
  const copy = async () => {
    try { await navigator.clipboard.writeText(config); toast(t('gn.plugin.copied')); } catch { toast(t('gn.plugin.copyFail'), 'err'); }
  };

  return (
    <Modal title={t('gn.plugin.title', { name: server.name })} onClose={onClose}>
      <div className="space-y-4">
        <p className="text-sm font-semibold text-mute">{t('gn.plugin.help')}</p>
        <p className="text-sm font-bold">
          {!server.hasToken
            ? t('gn.plugin.stateNone')
            : server.online
              ? t('gn.plugin.stateOnline', { v: server.pluginVersion || '?' })
              : server.lastSeen
                ? t('gn.plugin.stateSilent', { time: new Date(server.lastSeen).toLocaleString() })
                : t('gn.plugin.stateNever')}
        </p>
        {token && (
          <div className="space-y-2">
            <p className="text-sm font-bold">{t('gn.plugin.once')}</p>
            <pre className="panel overflow-x-auto p-3 font-mono text-sm" data-testid="plugin-config">{config}</pre>
            <button type="button" className="btn btn-soft btn-sm" onClick={() => void copy()}>{t('gn.plugin.copy')}</button>
            <p className="text-sm font-semibold text-mute">{t('gn.plugin.where')}</p>
          </div>
        )}
        <ErrorLine text={error} />
        <div className="flex flex-wrap justify-between gap-2">
          <div>{server.hasToken && <button type="button" className="btn btn-ghost" onClick={() => void remove()}>{t('gn.plugin.remove')}</button>}</div>
          <div className="flex gap-2">
            <button type="button" className="btn btn-ghost" onClick={onClose}>{t('common.close')}</button>
            <button type="button" className="btn" disabled={busy} onClick={() => void create()}>{busy && <Spinner />}{server.hasToken ? t('gn.plugin.renew') : t('gn.plugin.create')}</button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
