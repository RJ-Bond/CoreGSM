import { useEffect, useRef, useState, type FormEvent } from 'react';
import { api } from '../api';
import { soon } from '../components/GameNewsParts';
import { confirmDialog } from '../confirm';
import { t, useI18n } from '../i18n';
import {
  pluginConfig, validateNews,
  type NewsLogRow, type NewsSendResult, type NewsServerInfo, type RulesState,
} from '../gameNews';
import { AdminPage, ErrorLine, IconNews, LoadError, Modal, PageHead, Spinner, errText, navigate, toast, usePoll } from '../ui';
import { ChatCard, ExtrasCard, JoinLeaveCard, KickCard, RegisterCard, WelcomeCard } from './GameNewsCards';
import { ServerHead } from './GameNewsServerHead';
import { ScopeContext } from './GameNewsScope';
import { ServerRestartCard } from './GameNewsServerRestart';
import GameNewsRules from './GameNewsRules';
import { JournalTab } from './GameNewsJournal';
import { LinksTab } from './GameNewsLinks';
import { MOD_PLAYER_KEY, ModerationTab } from './GameNewsModeration';
import { SendTab } from './GameNewsSend';
import { ScopedCard, SubTabs } from './GameNewsUi';

interface NewsState { servers: NewsServerInfo[]; log: NewsLogRow[]; pluginLatest: string }

/** 'send' | 'auto' | 'general' | 's<id>' (the settings of one server) | 'players' (linked players) | 'journal' */
type Tab = string;
const DOCS = 'https://github.com/RJ-Bond/CoreGSM/blob/main/docs/game-plugin.md';

/** «Игровой плагин»: messages to the in-game chat (the CoreGSM game plugin picks them up), schedules, events, the chat in Discord. */
export default function GameNewsPage({ sub = '' }: { sub?: string }) {
  useI18n();
  const [data, setData] = useState<NewsState | null>(null);
  const [rd, setRd] = useState<RulesState | null>(null);
  const [error, setError] = useState('');
  // the tab is part of the address: /admin/gamenews, /auto, /players, /discord, /history («events» is the old name of «players»)
  // (/general holds the general settings; /s12 the settings of the server 12; «players», «discord» and «events» are the old names of /general)
  // («discord» and «events» are old names of /general, «history» of /journal)
  const tab: Tab = ['discord', 'events'].includes(sub) ? 'general' : sub === 'history' ? 'journal' : (/^(send|auto|general|players|mod|journal|s\d+)$/.test(sub) ? sub : 'send');
  const goTab = (x: Tab) => navigate(x === 'send' ? '/admin/gamenews' : `/admin/gamenews/${x}`);
  // the draft survives a switch of the page or a reload (kept in this browser only)
  const [text, setText] = useState(() => { try { return localStorage.getItem('coregsm.gamenews.draft') ?? ''; } catch { return ''; } });
  useEffect(() => { try { if (text) localStorage.setItem('coregsm.gamenews.draft', text); else localStorage.removeItem('coregsm.gamenews.draft'); } catch { /* private mode */ } }, [text]);
  const [picked, setPicked] = useState<number[]>([]);
  const [busy, setBusy] = useState(false);
  const [settingsFor, setSettingsFor] = useState<number | null>(null);
  const [lastResult, setLastResult] = useState<NewsSendResult | null>(null);
  const [showBare, setShowBare] = useState(false);
  // inside the settings of the general page or of a server: players | restart | discord (remembered in this browser)
  const [inner, setInner] = useState<'players' | 'restart' | 'discord'>(() => { try { const v = localStorage.getItem('coregsm.gn.inner'); return v === 'restart' || v === 'discord' ? v : 'players'; } catch { return 'players'; } });
  const pickInner = (v: 'players' | 'restart' | 'discord') => { setInner(v); try { localStorage.setItem('coregsm.gn.inner', v); } catch { /* private mode */ } };
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
  useEffect(() => { setRd(null); void api<RulesState>(`/game-news/rules${q}`).then(setRd).catch(() => undefined); }, [q]);

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
  const counter: Record<string, number> = { auto: activeRules.length, journal: queued };
  // with one server its settings are the general ones; with several each gets a page of its own (in the menu on the left, on a phone in the strip)
  const serverTabs = withToken.length > 1 ? withToken : [];
  const tabList: { id: Tab; label: string }[] = [
    { id: 'send', label: t('gn.tab.send') }, { id: 'auto', label: t('gn.tab.auto') }, { id: 'general', label: t('gn.tab.general') },
    { id: 'players', label: t('gn.tab.players') }, { id: 'mod', label: t('gn.tab.mod') }, { id: 'journal', label: t('gn.tab.journal') },
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

  // quick actions of the «Отправить» tab: a test line, a restart in five minutes (both for the chosen servers)
  const quickTest = async () => {
    if (!picked.length || busy) return;
    setBusy(true);
    try {
      await api('/game-news/send', 'POST', { serverIds: picked, text: `<color=#6EC1FF>* ${t('gn.sh.testText')}</color>` });
      toast(t('gn.q.testSent'));
      void loadMain();
    } catch (err) { toast(errText(err), 'err'); } finally { setBusy(false); }
  };
  const quickRestart = async () => {
    if (!picked.length || busy) return;
    const names = (data?.servers ?? []).filter((x) => picked.includes(x.id)).map((x) => x.name).join(', ');
    if (!(await confirmDialog({ title: t('gn.q.restartTitle'), text: t('gn.q.restartText', { servers: names }), confirmLabel: t('gn.q.restart'), danger: true }))) return;
    setBusy(true);
    try {
      for (const id of picked) await api('/game-news/restart', 'POST', { serverId: id, time: '5m' });
      toast(t('gn.rr.started'));
    } catch (err) { toast(errText(err), 'err'); } finally { setBusy(false); }
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
        <div className="panel flex flex-wrap items-center gap-x-6 gap-y-2 px-5 py-3" role="status" aria-label={t('gn.s.plugin')}>
          <span className="flex items-center gap-2 font-extrabold">
            <span aria-hidden className={`inline-block h-2.5 w-2.5 rounded-full ${online.length === 0 ? 'bg-mute' : online.length < withToken.length ? 'bg-warn' : 'bg-ok'}`} />
            {withToken.length ? t('gn.s.pluginVal', { on: online.length, all: withToken.length }) : t('gn.s.pluginNone')}
            {online[0]?.pluginVersion && <span className="text-sm font-semibold text-mute">v{online[0].pluginVersion}</span>}
          </span>
          <span className="text-sm font-bold"><span aria-hidden>👥 </span>{online.length ? t('gn.st.players', { n: players }) : '—'}</span>
          <span className="text-sm font-bold"><span aria-hidden>⟳ </span>{t('gn.s.autoVal', { n: activeRules.length })}{nextRun ? <span className="font-semibold text-mute"> · {t('gn.s.next', { time: soon(nextRun) })}</span> : null}</span>
          <span className="text-sm font-bold"><span aria-hidden>✉ </span>{t('gn.st.sent', { n: delivered24 })}{queued ? <span className="font-semibold text-mute"> · {t('gn.s.queued', { n: queued })}</span> : null}</span>
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
        <div className="-mx-1 overflow-x-auto px-1 pb-1" role="tablist" aria-label={t('gn.title')}>
         <div className="flex min-w-max gap-2 md:min-w-0 md:flex-wrap">
          {[...tabList.slice(0, 3), ...serverTabs.map((x) => ({ id: `s${x.id}`, label: x.name, phone: true })), ...tabList.slice(3)].map((x) => (
            <span key={x.id} className={'phone' in x ? 'contents md:hidden' : 'contents'}>
            <button type="button" role="tab" aria-selected={tab === x.id} className={`chip-filter whitespace-nowrap ${tab === x.id ? 'on' : ''}`} onClick={() => goTab(x.id)}>
              {x.label}
              {(counter[x.id] ?? 0) > 0 && <span className="ml-1.5 rounded-full bg-soft px-1.5 text-xs font-extrabold">{counter[x.id]}</span>}
            </button>
            </span>
          ))}
         </div>
        </div>
      )}

      {data && tab === 'send' && (
        <SendTab
          withToken={withToken} bare={bare} hiddenOther={hiddenOther} supportedCount={supported.length} latest={data.pluginLatest}
          picked={picked} toggle={toggle} pickAll={() => setPicked(picked.length === withToken.length ? [] : withToken.map((x) => x.id))}
          text={text} setText={setText} problem={problem} sendHint={sendHint} busy={busy} lastResult={lastResult}
          showBare={showBare} setShowBare={setShowBare} onSend={(e) => void send(e)} onSetup={setSettingsFor} onTest={() => void quickTest()} onRestart={() => void quickRestart()}
        />
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
            <SubTabs
              label={t('gn.in.title')}
              value={inner}
              onChange={pickInner}
              items={[{ id: 'players', label: t('gn.in.players') }, { id: 'restart', label: t('gn.in.restart') }, { id: 'discord', label: t('gn.in.discord') }]}
            />
            {inner === 'players' && (
              <div className="space-y-4">
                <ScopedCard part="welcome" title={t('gn.w.title')}><WelcomeCard initial={rd.welcome} /></ScopedCard>
                <ScopedCard part="joinleave" title={t('gn.jl.title')}><JoinLeaveCard initial={rd.joinLeave} /></ScopedCard>
                <ScopedCard part="register" title={t('gn.rg.title')}><RegisterCard initial={rd.register} /></ScopedCard>
                <ScopedCard part="kick" title={t('gn.kk.title')}><KickCard initial={rd.kick} /></ScopedCard>
                {!effScope && <ExtrasCard initial={rd.extras} />}
              </div>
            )}
            {inner === 'restart' && (
              <ServerRestartCard countdown={!effScope ? { enabled: rd.restartCountdown, onChange: (v) => { api('/game-news/restart-countdown', 'PUT', { enabled: v }).then(() => loadRules()).catch((e: Error) => toast(errText(e), 'err')); } } : undefined} />
            )}
            {inner === 'discord' && <ScopedCard part="chat" title={t('gn.ch.title')}><ChatCard initial={rd.chat} joinText={rd.joinLeave.joinText} leaveText={rd.joinLeave.leaveText} kickText={rd.kick.template} /></ScopedCard>}
          </div>
        </ScopeContext.Provider>
      )}

      {data && tab === 'players' && <LinksTab />}

      {data && tab === 'mod' && <ModerationTab />}

      {data && tab === 'journal' && <JournalTab onReuse={(x) => { setText(x); goTab('send'); }} onPlayer={(nick) => { try { localStorage.setItem(MOD_PLAYER_KEY, nick); } catch { /* private mode */ } goTab('mod'); }} />}

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
