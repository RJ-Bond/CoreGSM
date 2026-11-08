import type { FormEvent } from 'react';
import { NewsEditor, NewsPreview } from '../components/NewsEditor';
import { t, useI18n } from '../i18n';
import { versionLess, type NewsSendResult, type NewsServerInfo } from '../gameNews';
import { Spinner } from '../ui';
import { EmptyState } from './GameNewsUi';

export interface SendProps {
  withToken: NewsServerInfo[];
  bare: NewsServerInfo[];
  hiddenOther: number;
  supportedCount: number;
  latest: string;
  picked: number[];
  toggle: (id: number) => void;
  pickAll: () => void;
  text: string;
  setText: (v: string) => void;
  problem: string | null;
  sendHint: string;
  busy: boolean;
  lastResult: NewsSendResult | null;
  showBare: boolean;
  setShowBare: (v: boolean) => void;
  onSend: (e?: FormEvent) => void;
  onSetup: (id: number) => void;
  onTest: () => void;
  onRestart: () => void;
}

/** the «Отправить» tab: the editor and its preview, the servers as chips, quick actions and the send button that stays in reach on a phone */
export function SendTab(p: SendProps) {
  useI18n();
  const allPicked = p.withToken.length > 0 && p.picked.length === p.withToken.length;

  return (
    <form className="grid items-start gap-5 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]" onSubmit={(e) => p.onSend(e)} noValidate>
      <section className="panel space-y-4 p-5">
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label={t('gn.q.title')}>
          <span className="text-sm font-bold text-mute">{t('gn.q.title')}</span>
          <button type="button" className="chip-filter gap-1.5" disabled={p.picked.length === 0 || p.busy} onClick={p.onTest} title={t('gn.q.testNote')}><span aria-hidden>⚡</span>{t('gn.q.test')}</button>
          <button type="button" className="chip-filter gap-1.5" disabled={p.picked.length === 0 || p.busy} onClick={p.onRestart} title={t('gn.q.restartNote')}><span aria-hidden>♻</span>{t('gn.q.restart')}</button>
        </div>
        <NewsEditor value={p.text} onChange={p.setText} onCtrlEnter={() => p.onSend()} />
      </section>

      <div className="space-y-5 lg:sticky lg:top-4">
        <NewsPreview text={p.text} />

        <div className="panel space-y-3 p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="font-extrabold">{t('gn.servers')}</h3>
            {p.withToken.length > 1 && (
              <button type="button" className="btn btn-ghost btn-sm" onClick={p.pickAll}>{allPicked ? t('gn.pickNone') : t('gn.pickAll')}</button>
            )}
          </div>

          {p.supportedCount === 0 && <p className="text-sm font-semibold text-mute">{t('gn.noServers')}</p>}
          {p.supportedCount > 0 && p.withToken.length === 0 && (
            <EmptyState icon="🔌" title={t('gn.noPlugin')} hint={t('gn.q.connectHint')} />
          )}

          <div className="flex flex-wrap gap-2" role="group" aria-label={t('gn.servers')}>
            {p.withToken.map((s) => {
              const on = p.picked.includes(s.id);
              const old = s.online && versionLess(s.pluginVersion, p.latest);
              return (
                <span key={s.id} className={`inline-flex max-w-full items-stretch overflow-hidden rounded-full border ${on ? 'border-ink' : 'border-line'}`}>
                  <button
                    type="button" aria-pressed={on}
                    className={`flex min-w-0 items-center gap-2 px-3 py-1.5 text-sm font-bold ${on ? 'bg-soft' : ''}`}
                    title={s.online ? (old ? t('gn.plugin.outdated', { v: s.pluginVersion || '?', latest: p.latest }) : t('gn.plugin.online')) : t('gn.q.offlineNote')}
                    onClick={() => p.toggle(s.id)}
                  >
                    <span aria-hidden className={`inline-block h-2 w-2 shrink-0 rounded-full ${!s.online ? 'bg-mute' : old ? 'bg-warn' : 'bg-ok'}`} />
                    <span className="min-w-0 wrap-break-word text-left">{s.name}</span>
                    {s.players != null && <span className="shrink-0 rounded-full bg-soft px-1.5 text-xs font-extrabold">{s.players}</span>}
                    {on && <span aria-hidden className="shrink-0">✓</span>}
                  </button>
                  <button type="button" className="border-l border-line px-2 text-mute hover:text-ink" aria-label={t('gn.plugin.settings', { name: s.name })} title={t('gn.sv.setup')} onClick={() => p.onSetup(s.id)}>⚙</button>
                </span>
              );
            })}
          </div>

          {p.bare.length > 0 && (
            <div className="space-y-2">
              <button type="button" className="btn btn-ghost btn-sm" aria-expanded={p.showBare} onClick={() => p.setShowBare(!p.showBare)}>
                {p.showBare ? t('gn.sv.less') : t('gn.sv.more', { n: p.bare.length })}
              </button>
              {p.showBare && (
                <div className="flex flex-wrap gap-2">
                  {p.bare.map((s) => (
                    <button key={s.id} type="button" className="chip-filter gap-1.5" onClick={() => p.onSetup(s.id)}>
                      <span aria-hidden>＋</span>{t('gn.q.connect', { name: s.name })}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
          {p.hiddenOther > 0 && <p className="text-sm font-semibold text-mute">{t('gn.hiddenOther', { n: p.hiddenOther })}</p>}

          <div className="flex flex-wrap items-center justify-end gap-3 max-md:sticky max-md:bottom-20 max-md:z-10 max-md:rounded-xl max-md:border max-md:border-line max-md:bg-card max-md:p-3 max-md:shadow-lg">
            {p.sendHint && <span className="min-w-0 flex-1 text-sm font-semibold text-mute">{p.sendHint}</span>}
            <button type="submit" className="btn" disabled={!!p.problem || !p.picked.length || p.busy} title={t('gn.sendKey')}>
              {p.busy && <Spinner />}{p.picked.length > 1 ? t('gn.sendCount', { n: p.picked.length }) : t('gn.send')}
            </button>
          </div>

          {p.lastResult && (
            <ul className="space-y-1 text-sm font-semibold">
              {p.lastResult.results.map((r) => (
                <li key={r.serverId} className={r.queued ? (r.online ? 'text-ok' : undefined) : 'text-danger'}>
                  {r.queued ? '✓' : '✕'} {r.serverName}: {r.queued ? (r.online ? t('gn.r.queued') : t('gn.r.queuedSilent')) : r.error}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </form>
  );
}
