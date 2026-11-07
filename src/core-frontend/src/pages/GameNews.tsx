import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { api } from '../api';
import { NewsEditor, NewsPreview, Styled } from '../components/NewsEditor';
import { confirmDialog } from '../confirm';
import { t, useI18n } from '../i18n';
import { pluginConfig, validateNews, versionLess, type NewsLogRow, type NewsSendResult, type NewsServerInfo, type NewsStatus } from '../gameNews';
import { AdminPage, ErrorLine, IconNews, IconSettings, LoadError, Modal, PageHead, Spinner, errText, toast, usePoll } from '../ui';
import GameNewsRules from './GameNewsRules';

interface NewsState { servers: NewsServerInfo[]; log: NewsLogRow[]; pluginLatest: string }

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

/** «Новости в игру»: a message for the in-game chat (the CoreGSM game plugin picks it up), sent now or by a schedule. */
export default function GameNewsPage() {
  useI18n();
  const [data, setData] = useState<NewsState | null>(null);
  const [error, setError] = useState('');
  const [tab, setTab] = useState<'send' | 'auto'>('send');
  // the draft survives a switch of the page or a reload (kept in this browser only)
  const [text, setText] = useState(() => { try { return localStorage.getItem('coregsm.gamenews.draft') ?? ''; } catch { return ''; } });
  useEffect(() => { try { if (text) localStorage.setItem('coregsm.gamenews.draft', text); else localStorage.removeItem('coregsm.gamenews.draft'); } catch { /* private mode */ } }, [text]);
  const [picked, setPicked] = useState<number[]>([]);
  const [busy, setBusy] = useState(false);
  const [settingsFor, setSettingsFor] = useState<number | null>(null);
  const [lastResult, setLastResult] = useState<NewsSendResult | null>(null);

  const load = () =>
    api<NewsState>('/game-news')
      .then((d) => { setData(d); setError(''); })
      .catch((e: Error) => setError(e.message));
  usePoll(load, 10_000);

  const problem = validateNews(text);
  // the plugin exists for some games only: servers of other games are not listed (their number is shown)
  const shown = (data?.servers ?? []).filter((s) => s.supported);
  const hiddenCount = (data?.servers.length ?? 0) - shown.length;
  const ready = shown.filter((s) => s.hasToken);
  const settingsServer = data?.servers.find((s) => s.id === settingsFor) ?? null;
  const touched = useRef(false);
  const toggle = (id: number) => { touched.current = true; setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id])); };
  // a single server with a plugin is chosen right away (until the administrator picks by hand)
  useEffect(() => {
    if (!touched.current && ready.length === 1 && picked.length === 0) setPicked([ready[0].id]);
  }, [ready, picked.length]);
  const sendHint = problem === 'empty' ? t('gn.hint.text') : problem === 'long' ? t('gn.hint.long') : !picked.length ? t('gn.hint.server') : '';
  const onKey = (e: KeyboardEvent<HTMLFormElement>) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); void send(e); }
  };

  const send = async (e: FormEvent | KeyboardEvent) => {
    e.preventDefault();
    if (problem || !picked.length || busy) return;
    const names = (data?.servers ?? []).filter((s) => picked.includes(s.id)).map((s) => s.name).join(', ');
    const ok = await confirmDialog({ title: t('gn.confirm.title'), text: t('gn.confirm.text', { servers: names }), confirmLabel: t('gn.send') });
    if (!ok) return;
    setBusy(true);
    try {
      const r = await api<NewsSendResult>('/game-news/send', 'POST', { serverIds: picked, text });
      setLastResult(r);
      const bad = r.results.filter((x) => !x.queued).length;
      toast(bad ? t('gn.t.partial', { ok: r.results.length - bad, total: r.results.length }) : t('gn.t.queued'), bad ? 'err' : undefined);
      void load();
    } catch (err) {
      toast(errText(err), 'err');
    } finally {
      setBusy(false);
    }
  };

  return (
    <AdminPage
      head={(
        <PageHead icon={<IconNews size={22} />} title={t('gn.title')} subtitle={t('gn.subtitle')} hint={t('gn.hint')} help={<p>{t('gn.help')}</p>} />
      )}
    >
      {error && !data ? <LoadError error={error} onRetry={() => void load()} /> : <ErrorLine text={error} />}
      {!data && !error && <div className="skeleton panel h-40" aria-busy="true" aria-label={t('d2.news.loading')} />}

      {data && (
        <div className="flex flex-wrap gap-2" role="tablist" aria-label={t('gn.title')}>
          <button type="button" role="tab" aria-selected={tab === 'send'} className={`chip-filter ${tab === 'send' ? 'on' : ''}`} onClick={() => setTab('send')}>{t('gn.tab.send')}</button>
          <button type="button" role="tab" aria-selected={tab === 'auto'} className={`chip-filter ${tab === 'auto' ? 'on' : ''}`} onClick={() => setTab('auto')}>{t('gn.tab.auto')}</button>
        </div>
      )}

      {data && tab === 'auto' && <GameNewsRules servers={data.servers} />}

      {data && tab === 'send' && (
        <>
          <form className="grid gap-5 lg:grid-cols-2" onSubmit={(e) => void send(e)} onKeyDown={onKey} noValidate>
            <section className="panel p-5"><NewsEditor value={text} onChange={setText} /></section>

            <section className="space-y-5">
              <NewsPreview text={text} />

              <div className="panel space-y-3 p-5">
                <h3 className="font-extrabold">{t('gn.servers')}</h3>
                {shown.length === 0 && <p className="text-sm font-semibold text-mute">{t('gn.noServers')}</p>}
                <ul className="divide-y divide-line">
                  {shown.map((s) => {
                    const old = s.hasToken && s.online && versionLess(s.pluginVersion, data.pluginLatest);
                    return (
                      <li key={s.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5">
                        <label className="flex min-w-0 flex-1 basis-48 items-center gap-2.5 font-bold">
                          <input type="checkbox" disabled={!s.hasToken} checked={picked.includes(s.id)} onChange={() => toggle(s.id)} />
                          <span className="min-w-0 wrap-break-word">
                            {s.name}
                            {s.name !== s.address && <span className="block text-xs font-semibold text-mute">{s.address}</span>}
                          </span>
                        </label>
                        <span
                          className={!s.hasToken ? 'pill pill-mute' : !s.online ? 'pill pill-warn' : old ? 'pill pill-warn' : 'pill pill-ok'}
                          title={s.lastSeen ? t('gn.plugin.lastPoll', { time: ago(s.lastSeen) }) : undefined}
                        >
                          {!s.hasToken
                            ? t('gn.plugin.off')
                            : !s.online
                              ? (s.pluginVersion ? `${t('gn.plugin.silent')} · v${s.pluginVersion}` : t('gn.plugin.silent'))
                              : old
                                ? t('gn.plugin.outdated', { v: s.pluginVersion || '?', latest: data.pluginLatest })
                                : `${t('gn.plugin.online')} · v${s.pluginVersion || '?'}`}
                        </span>
                        <button type="button" className="row-act" onClick={() => setSettingsFor(s.id)} aria-label={t('gn.plugin.settings', { name: s.name })}><IconSettings size={16} /></button>
                      </li>
                    );
                  })}
                </ul>
                {hiddenCount > 0 && <p className="text-sm font-semibold text-mute">{t('gn.hiddenOther', { n: hiddenCount })}</p>}
                {shown.length > 0 && ready.length === 0 && <p className="text-sm font-semibold text-mute">{t('gn.noPlugin')}</p>}
                {ready.length > 1 && (
                  <button type="button" className="chip-filter" onClick={() => setPicked(picked.length === ready.length ? [] : ready.map((s) => s.id))}>
                    {picked.length === ready.length ? t('gn.pickNone') : t('gn.pickAll')}
                  </button>
                )}
                <div className="sticky bottom-3 z-10 flex flex-wrap items-center justify-end gap-3">
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
            </section>
          </form>

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
                      <span className="font-semibold text-mute">{new Date(r.sentAt).toLocaleString()} · {r.sentBy || '—'}</span>
                    </div>
                    <p className="mt-1 wrap-break-word text-sm"><Styled text={r.text} /></p>
                    {(r.status === 'failed' || r.status === 'expired') && r.error && <p className="text-sm font-semibold text-danger">{r.error}</p>}
                  </div>
                  <button type="button" className="btn btn-soft btn-sm" onClick={() => { setText(r.text); setTab('send'); }}>{t('gn.reuse')}</button>
                </li>
              ))}
            </ul>
          </section>
        </>
      )}

      {settingsServer && <PluginModal server={settingsServer} onClose={() => setSettingsFor(null)} onChanged={() => void load()} />}
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
