import { useMemo, useRef, useState, type FormEvent } from 'react';
import { api } from '../api';
import { confirmDialog } from '../confirm';
import { t, useI18n } from '../i18n';
import {
  MAX_VISIBLE, SWATCHES, TEMPLATES, colorOpen, isHex, parseNews, pluginConfig, unbalanced, validateNews, visibleText, wrapSelection,
  type NewsLogRow, type NewsSendResult, type NewsServerInfo, type NewsStatus,
} from '../gameNews';
import { AdminPage, ErrorLine, Field, IconNews, IconSettings, LoadError, Modal, PageHead, Spinner, errText, toast, usePoll } from '../ui';

interface NewsState { servers: NewsServerInfo[]; log: NewsLogRow[] }

const swatchName = (id: string) => t(`gn.c.${id}` as 'gn.c.info');
const STATUS: Record<NewsStatus, { text: 'gn.h.queued' | 'gn.h.ok' | 'gn.h.expired' | 'gn.h.fail'; cls: string }> = {
  queued: { text: 'gn.h.queued', cls: 'pill pill-mute' },
  delivered: { text: 'gn.h.ok', cls: 'pill pill-ok' },
  expired: { text: 'gn.h.expired', cls: 'pill pill-warn' },
  failed: { text: 'gn.h.fail', cls: 'pill pill-warn' },
};

function Styled({ text }: { text: string }) {
  return (
    <>
      {parseNews(text).map((s, i) => (
        <span key={i} style={{ color: s.color ?? undefined, fontWeight: s.bold ? 800 : undefined, fontStyle: s.italic ? 'italic' : undefined }}>{s.text}</span>
      ))}
    </>
  );
}

/** «Новости в игру»: a message for the in-game chat of a server (the CoreGSM game plugin picks it up), with a live preview. */
export default function GameNewsPage() {
  useI18n();
  const [data, setData] = useState<NewsState | null>(null);
  const [error, setError] = useState('');
  const [text, setText] = useState('');
  const [picked, setPicked] = useState<number[]>([]);
  const [busy, setBusy] = useState(false);
  const [custom, setCustom] = useState('#FF8A00');
  const [settingsFor, setSettingsFor] = useState<number | null>(null);
  const [lastResult, setLastResult] = useState<NewsSendResult | null>(null);
  const area = useRef<HTMLTextAreaElement>(null);

  const load = () =>
    api<NewsState>('/game-news')
      .then((d) => { setData(d); setError(''); })
      .catch((e: Error) => setError(e.message));
  usePoll(load, 10_000);

  const segs = useMemo(() => parseNews(text), [text]);
  const visible = visibleText(text).trim().length;
  const problem = validateNews(text);
  const ready = (data?.servers ?? []).filter((s) => s.hasToken);
  const settingsServer = data?.servers.find((s) => s.id === settingsFor) ?? null;

  const edit = (fn: (start: number, end: number) => { text: string; start: number; end: number }) => {
    const el = area.current;
    const r = fn(el?.selectionStart ?? text.length, el?.selectionEnd ?? text.length);
    setText(r.text);
    requestAnimationFrame(() => { el?.focus(); el?.setSelectionRange(r.start, r.end); });
  };
  const wrap = (open: string, close: string) => edit((a, b) => wrapSelection(text, a, b, open, close));
  const useTemplate = (id: string) => {
    const tpl = TEMPLATES.find((x) => x.id === id);
    if (tpl) setText(tpl.text(t('gn.tpl.when')));
  };
  const toggle = (id: number) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));

  const send = async (e: FormEvent) => {
    e.preventDefault();
    if (problem || !picked.length || busy) return;
    const names = (data?.servers ?? []).filter((s) => picked.includes(s.id)).map((s) => s.name).join(', ');
    const ok = await confirmDialog({
      title: t('gn.confirm.title'),
      text: t('gn.confirm.text', { servers: names }),
      confirmLabel: t('gn.send'),
    });
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
        <form className="grid gap-5 lg:grid-cols-2" onSubmit={(e) => void send(e)} noValidate>
          <section className="panel space-y-4 p-5">
            <div className="flex flex-wrap gap-2" role="group" aria-label={t('gn.templates')}>
              <span className="self-center text-sm font-bold text-mute">{t('gn.templates')}:</span>
              {TEMPLATES.map((x) => (
                <button key={x.id} type="button" className="chip-filter" onClick={() => useTemplate(x.id)}>{t(`gn.tpl.${x.id}` as 'gn.tpl.restart')}</button>
              ))}
            </div>

            <Field label={t('gn.message')}>
              <textarea
                ref={area}
                className="input min-h-32 font-mono text-sm"
                value={text}
                rows={5}
                maxLength={700}
                placeholder={t('gn.placeholder')}
                onChange={(e) => setText(e.target.value)}
              />
            </Field>

            <div className="flex flex-wrap items-center gap-2" role="group" aria-label={t('gn.colors')}>
              {SWATCHES.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  className="h-8 w-8 rounded-full border border-line"
                  style={{ background: s.hex }}
                  title={swatchName(s.id)}
                  aria-label={t('gn.colorize', { name: swatchName(s.id) })}
                  onClick={() => wrap(colorOpen(s.hex), '</color>')}
                />
              ))}
              <input
                className="input w-28 font-mono text-sm"
                value={custom}
                maxLength={7}
                aria-label={t('gn.customHex')}
                onChange={(e) => setCustom(e.target.value)}
              />
              <button type="button" className="btn btn-soft btn-sm" disabled={!isHex(custom)} onClick={() => wrap(colorOpen(custom), '</color>')}>{t('gn.applyHex')}</button>
              <button type="button" className="btn btn-soft btn-sm font-black" onClick={() => wrap('<b>', '</b>')} aria-label={t('gn.bold')}>B</button>
              <button type="button" className="btn btn-soft btn-sm italic" onClick={() => wrap('<i>', '</i>')} aria-label={t('gn.italic')}>I</button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setText(visibleText(text))}>{t('gn.clearTags')}</button>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 text-sm font-semibold text-mute">
              <span className={visible > MAX_VISIBLE ? 'text-danger' : undefined}>{t('gn.counter', { n: visible, max: MAX_VISIBLE })}</span>
              {unbalanced(text) && <span>{t('gn.unbalanced')}</span>}
            </div>
          </section>

          <section className="space-y-5">
            <div className="panel space-y-3 p-5">
              <h3 className="font-extrabold">{t('gn.preview')}</h3>
              <div className="rounded-xl p-4 font-semibold" style={{ background: '#15121c', color: '#e8e3f0' }} aria-live="polite">
                <div className="mb-1 text-xs font-bold uppercase tracking-wide" style={{ color: '#8f86a3' }}>{t('gn.chatLabel')}</div>
                {segs.length ? <p className="wrap-break-word"><Styled text={text} /></p> : <p style={{ color: '#8f86a3' }}>{t('gn.previewEmpty')}</p>}
              </div>
              <p className="text-sm font-semibold text-mute">{t('gn.previewNote')}</p>
            </div>

            <div className="panel space-y-3 p-5">
              <h3 className="font-extrabold">{t('gn.servers')}</h3>
              {data.servers.length === 0 && <p className="text-sm font-semibold text-mute">{t('gn.noServers')}</p>}
              <ul className="divide-y divide-line">
                {data.servers.map((s) => (
                  <li key={s.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5">
                    <label className="flex min-w-0 flex-1 basis-48 items-center gap-2.5 font-bold">
                      <input type="checkbox" disabled={!s.hasToken} checked={picked.includes(s.id)} onChange={() => toggle(s.id)} />
                      <span className="min-w-0 wrap-break-word">{s.name}</span>
                    </label>
                    <span className={!s.hasToken ? 'pill pill-mute' : s.online ? 'pill pill-ok' : 'pill pill-warn'}>
                      {!s.hasToken ? t('gn.plugin.off') : s.online ? t('gn.plugin.online') : t('gn.plugin.silent')}
                    </span>
                    <button type="button" className="row-act" onClick={() => setSettingsFor(s.id)} aria-label={t('gn.plugin.settings', { name: s.name })}><IconSettings size={16} /></button>
                  </li>
                ))}
              </ul>
              {data.servers.length > 0 && ready.length === 0 && <p className="text-sm font-semibold text-mute">{t('gn.noPlugin')}</p>}
              {ready.length > 1 && (
                <button type="button" className="chip-filter" onClick={() => setPicked(picked.length === ready.length ? [] : ready.map((s) => s.id))}>
                  {picked.length === ready.length ? t('gn.pickNone') : t('gn.pickAll')}
                </button>
              )}
              <div className="flex justify-end">
                <button type="submit" className="btn" disabled={!!problem || !picked.length || busy}>{busy && <Spinner />}{t('gn.send')}</button>
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
      )}

      {data && (
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
                <button type="button" className="btn btn-soft btn-sm" onClick={() => setText(r.text)}>{t('gn.reuse')}</button>
              </li>
            ))}
          </ul>
        </section>
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
