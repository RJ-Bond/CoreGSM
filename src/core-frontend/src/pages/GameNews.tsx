import { useMemo, useRef, useState, type FormEvent } from 'react';
import { api } from '../api';
import { confirmDialog } from '../confirm';
import { t, useI18n } from '../i18n';
import {
  MAX_VISIBLE, SWATCHES, TEMPLATES, colorOpen, isHex, parseNews, unbalanced, validateNews, visibleText, wrapSelection,
  type NewsLogRow, type NewsSendResult, type NewsServerInfo,
} from '../gameNews';
import { AdminPage, ErrorLine, Field, IconNews, IconSettings, LoadError, Modal, PageHead, Spinner, errText, toast, usePoll } from '../ui';

interface NewsState { servers: NewsServerInfo[]; log: NewsLogRow[] }

const swatchName = (id: string) => t(`gn.c.${id}` as 'gn.c.info');

/** «Игровые новости»: a message for the in-game chat of a server (the CoreGSM game plugin shows it), with a live preview. */
export default function GameNewsPage() {
  useI18n();
  const [data, setData] = useState<NewsState | null>(null);
  const [error, setError] = useState('');
  const [text, setText] = useState('');
  const [picked, setPicked] = useState<number[]>([]);
  const [busy, setBusy] = useState(false);
  const [custom, setCustom] = useState('#FF8A00');
  const [settingsFor, setSettingsFor] = useState<NewsServerInfo | null>(null);
  const [lastResult, setLastResult] = useState<NewsSendResult | null>(null);
  const area = useRef<HTMLTextAreaElement>(null);

  const load = () =>
    api<NewsState>('/game-news')
      .then((d) => { setData(d); setError(''); })
      .catch((e: Error) => setError(e.message));
  usePoll(load, 30_000);

  const segs = useMemo(() => parseNews(text), [text]);
  const visible = visibleText(text).trim().length;
  const problem = validateNews(text);
  const ready = (data?.servers ?? []).filter((s) => s.url && s.hasToken);

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
      const bad = r.results.filter((x) => !x.ok).length;
      toast(bad ? t('gn.t.partial', { ok: r.results.length - bad, total: r.results.length }) : t('gn.t.sent'), bad ? 'err' : undefined);
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
                {segs.length ? (
                  <p className="wrap-break-word">
                    {segs.map((s, i) => (
                      <span key={i} style={{ color: s.color ?? undefined, fontWeight: s.bold ? 800 : undefined, fontStyle: s.italic ? 'italic' : undefined }}>{s.text}</span>
                    ))}
                  </p>
                ) : <p style={{ color: '#8f86a3' }}>{t('gn.previewEmpty')}</p>}
              </div>
              <p className="text-sm font-semibold text-mute">{t('gn.previewNote')}</p>
            </div>

            <div className="panel space-y-3 p-5">
              <div className="flex items-center justify-between gap-2">
                <h3 className="font-extrabold">{t('gn.servers')}</h3>
              </div>
              {data.servers.length === 0 && <p className="text-sm font-semibold text-mute">{t('gn.noServers')}</p>}
              <ul className="divide-y divide-line">
                {data.servers.map((s) => {
                  const okTarget = !!(s.url && s.hasToken);
                  return (
                    <li key={s.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5">
                      <label className="flex min-w-0 flex-1 basis-48 items-center gap-2.5 font-bold">
                        <input type="checkbox" disabled={!okTarget} checked={picked.includes(s.id)} onChange={() => toggle(s.id)} />
                        <span className="min-w-0 wrap-break-word">{s.name}</span>
                      </label>
                      <span className={okTarget ? 'pill pill-ok' : 'pill pill-mute'}>{okTarget ? t('gn.plugin.on') : t('gn.plugin.off')}</span>
                      <button type="button" className="row-act" onClick={() => setSettingsFor(s)} aria-label={t('gn.plugin.settings', { name: s.name })}><IconSettings size={16} /></button>
                    </li>
                  );
                })}
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
                    <li key={r.serverId} className={r.ok ? 'text-ok' : 'text-danger'}>{r.ok ? '✓' : '✕'} {r.serverName}{r.ok ? '' : `: ${r.error}`}</li>
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
                    <span className={r.ok ? 'pill pill-ok' : 'pill pill-warn'}>{r.ok ? t('gn.h.ok') : t('gn.h.fail')}</span>
                    <span>{r.serverName}</span>
                    <span className="font-semibold text-mute">{new Date(r.sentAt).toLocaleString()} · {r.sentBy || '—'}</span>
                  </div>
                  <p className="mt-1 wrap-break-word text-sm">
                    {parseNews(r.text).map((s, i) => (
                      <span key={i} style={{ color: s.color ?? undefined, fontWeight: s.bold ? 800 : undefined, fontStyle: s.italic ? 'italic' : undefined }}>{s.text}</span>
                    ))}
                  </p>
                  {!r.ok && r.error && <p className="text-sm font-semibold text-danger">{r.error}</p>}
                </div>
                <button type="button" className="btn btn-soft btn-sm" onClick={() => setText(r.text)}>{t('gn.reuse')}</button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {settingsFor && <PluginModal server={settingsFor} onClose={() => setSettingsFor(null)} onSaved={() => { setSettingsFor(null); void load(); }} />}
    </AdminPage>
  );
}

function PluginModal({ server, onClose, onSaved }: { server: NewsServerInfo; onClose: () => void; onSaved: () => void }) {
  useI18n();
  const [url, setUrl] = useState(server.url || 'http://');
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [check, setCheck] = useState<{ ok: boolean; error: string } | null>(null);

  const save = async (): Promise<boolean> => {
    setBusy(true);
    setError('');
    try {
      await api(`/game-news/targets/${server.id}`, 'PUT', token ? { url, token } : { url });
      return true;
    } catch (e) {
      setError(errText(e));
      return false;
    } finally {
      setBusy(false);
    }
  };
  const submit = async (e: FormEvent) => { e.preventDefault(); if (await save()) { toast(t('gn.t.saved')); onSaved(); } };
  const test = async () => {
    if (!(await save())) return;
    setBusy(true);
    try { setCheck(await api<{ ok: boolean; error: string }>(`/game-news/check/${server.id}`, 'POST')); }
    catch (e) { setCheck({ ok: false, error: errText(e) }); }
    finally { setBusy(false); }
  };
  const remove = async () => {
    if (!(await confirmDialog({ title: t('gn.plugin.removeTitle', { name: server.name }), danger: true, confirmLabel: t('gn.plugin.remove') }))) return;
    try { await api(`/game-news/targets/${server.id}`, 'DELETE'); onSaved(); } catch (e) { setError(errText(e)); }
  };

  return (
    <Modal title={t('gn.plugin.title', { name: server.name })} onClose={onClose}>
      <form className="space-y-4" onSubmit={(e) => void submit(e)} noValidate>
        <p className="text-sm font-semibold text-mute">{t('gn.plugin.help')}</p>
        <Field label={t('gn.plugin.url')}>
          <input className="input font-mono text-sm" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="http://192.168.88.138:25590" />
        </Field>
        <Field label={t('gn.plugin.token')}>
          <input className="input font-mono text-sm" type="password" autoComplete="off" value={token} onChange={(e) => setToken(e.target.value)}
            placeholder={server.hasToken ? t('gn.plugin.tokenKept') : t('gn.plugin.tokenEx')} />
        </Field>
        <ErrorLine text={error} />
        {check && <p className={`text-sm font-semibold ${check.ok ? 'text-ok' : 'text-danger'}`}>{check.ok ? t('gn.plugin.checkOk') : check.error}</p>}
        <div className="flex flex-wrap justify-between gap-2">
          <div className="flex gap-2">
            {server.url && <button type="button" className="btn btn-ghost" onClick={() => void remove()}>{t('gn.plugin.remove')}</button>}
            <button type="button" className="btn btn-soft" disabled={busy} onClick={() => void test()}>{t('gn.plugin.check')}</button>
          </div>
          <div className="flex gap-2">
            <button type="button" className="btn btn-ghost" onClick={onClose}>{t('common.cancel')}</button>
            <button type="submit" className="btn" disabled={busy}>{busy && <Spinner />}{t('common.save')}</button>
          </div>
        </div>
      </form>
    </Modal>
  );
}
