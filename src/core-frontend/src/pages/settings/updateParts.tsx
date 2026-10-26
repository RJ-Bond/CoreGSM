/** Pieces of Settings → Updates: steps, warnings, release notes, the log and the options. */
import { useEffect, useState } from 'react';
import { api, type Changelog, type UpdateHistoryItem, type UpdateInfo, type UpdateNotes, type UpdatePreflight } from '../../api';
import { t, useI18n, type TKey } from '../../i18n';
import { ChannelName, ChannelPicker } from '../../components/ChannelPicker';
import { ErrorLine, fmtDateTime, Section, errText, toast } from '../../ui';
import { cleanNote, groupCommits, isNewerRelease, preflightWarnings, stepStates, upcomingFlags, versionText, type PreflightWarning } from './updateLogic';

/** the four steps of an update; the active one pulses, finished ones carry a tick */
export function StepList({ stage, finished }: { stage: UpdateInfo['stage']; finished: boolean }) {
  return (
    <ol className="upd-steps" aria-label={t('upd.steps')}>
      {stepStates(stage, finished).map((s) => (
        <li key={s.id} className={`upd-step is-${s.state}`} aria-current={s.state === 'active' ? 'step' : undefined}>
          <span className="upd-step-dot" aria-hidden>{s.state === 'done' ? '✓' : ''}</span>
          <span>{t(`upd.step.${s.id}` as TKey)}</span>
        </li>
      ))}
    </ol>
  );
}

const warnText = (w: PreflightWarning): string =>
  w.kind === 'players' ? t('upd.pf.players', { n: w.n }) : w.kind === 'noBackup' ? t('upd.pf.noBackup') : t('upd.pf.old', { h: w.hours });

/** what the update would interrupt, and the warnings from the notes of the newer versions */
export function PreflightNote({ pf, current, notes }: { pf: UpdatePreflight | null; current: string | null | undefined; notes: UpdateNotes | null }) {
  const { lang } = useI18n();
  const warns = preflightWarnings(pf, Date.now());
  const flags = notes ? upcomingFlags(notes.releases, current, lang) : [];
  if (warns.length === 0 && flags.length === 0) return null;
  return (
    <div className="relative mt-4 space-y-2 rounded-2xl bg-black/20 px-4 py-3 text-sm font-bold" role="note">
      {warns.map((w) => <p key={w.kind}>{warnText(w)}</p>)}
      {flags.length > 0 && (
        <div>
          <p className="font-black">{t('upd.fl.title')}</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-5">
            {flags.map((f, i) => <li key={i}><b>{t(`upd.fl.${f.flag}` as TKey)}:</b> {f.text}</li>)}
          </ul>
        </div>
      )}
    </div>
  );
}

const FLAG_PILL: Record<string, string> = { breaking: 'pill-bad', migration: 'pill-warn', env: 'pill-warn' };

/** «Что нового»: CHANGELOG.md grouped by version, the commits of the repository when there is none */
export function NotesCard({ notes, log, logError, current, installedAt }: {
  notes: UpdateNotes | null; log: Changelog | null; logError: string; current: string | null | undefined; installedAt: number | null | undefined;
}) {
  const [older, setOlder] = useState(false);
  const { lang } = useI18n();
  const releases = notes?.releases ?? [];
  const released = releases.filter((r) => r.version);
  const unreleased = releases.find((r) => !r.version);
  const hasNotes = releases.length > 0;
  // versions up to the running one are «older»; without a readable current version only the newest three are shown
  const fresh = released.filter((r) => isNewerRelease(r, current));
  const rest = released.filter((r) => !isNewerRelease(r, current));
  const shown = [...(unreleased && unreleased.groups.length > 0 ? [unreleased] : []), ...fresh, ...(older ? rest : rest.slice(0, 1))];
  return (
    <Section id="update-changes" title={t('upd.n.title')} className="scroll-mt-24">
      {!notes && !log && !logError && <div className="skeleton h-24 rounded-2xl" />}
      {hasNotes ? (
        <div className="space-y-5">
          {shown.map((r) => (
            <article key={r.version ?? 'unreleased'}>
              <h3 className="flex flex-wrap items-center gap-2 font-black">
                <span>{r.version ?? t('upd.n.unreleased')}</span>
                {r.date && <span className="text-sm font-semibold text-mute">{r.date}</span>}
                {isNewerRelease(r, current) && <span className="pill pill-ok">{t('upd.n.new')}</span>}
                {r.version && r.version === current && <span className="pill pill-mute">{t('upd.n.current')}</span>}
              </h3>
              {r.groups.map((g) => (
                <div key={g.title} className="mt-2">
                  <h4 className="text-sm font-black text-mute">{lang === 'en' && g.titleEn ? g.titleEn : g.title}</h4>
                  <ul className="mt-1 list-disc space-y-1 pl-5 font-semibold">
                    {g.items.map((it, i) => (
                      <li key={i}>
                        {cleanNote(lang === 'en' && it.textEn ? it.textEn : it.text)}
                        {it.flags.map((f) => <span key={f} className={`pill ${FLAG_PILL[f]} ml-2`}>{t(`upd.fl.${f}` as TKey)}</span>)}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </article>
          ))}
          {rest.length > 1 && (
            <button type="button" className="btn-link" onClick={() => setOlder((v) => !v)}>{older ? t('upd.n.fewer') : t('upd.n.older')}</button>
          )}
        </div>
      ) : (
        <>
          {notes && <p className="text-sm font-semibold text-mute">{t('upd.n.fallback')}</p>}
          {logError && <p className="text-sm font-semibold text-mute">{t('upd.n.error', { e: logError })}</p>}
          {log && log.items.length === 0 && !logError && <p className="font-semibold text-mute">{t('upd.n.empty')}</p>}
          {log && groupCommits(log.items, installedAt ?? null).map((g) => (
            <div key={g.id} className="mt-2">
              <h4 className="text-sm font-black text-mute">{t(`upd.g.${g.id}` as TKey)}</h4>
              <ul className="divide-y divide-line">
                {g.items.map((c) => (
                  <li key={c.sha} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 py-2">
                    <a href={/^https?:\/\//i.test(c.url) ? c.url : undefined} target="_blank" rel="noopener noreferrer" className="min-w-0 flex-1 basis-60 wrap-break-word font-bold hover:text-link">{c.title}</a>
                    {c.isNew && <span className="pill pill-ok">{t('upd.n.new')}</span>}
                    <span className="font-mono text-sm font-semibold text-mute">{c.sha.slice(0, 7)}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </>
      )}
    </Section>
  );
}

/** what the panel started: updates and rollbacks, newest first */
export function HistoryCard({ refreshKey }: { refreshKey: unknown }) {
  const [rows, setRows] = useState<UpdateHistoryItem[] | null>(null);
  useEffect(() => {
    api<UpdateHistoryItem[]>('/update/history').then(setRows).catch(() => setRows([]));
  }, [refreshKey]);
  return (
    <Section title={t('upd.h.title')}>
      {!rows && <div className="skeleton h-16 rounded-2xl" />}
      {rows && rows.length === 0 && <p className="font-semibold text-mute">{t('upd.h.empty')}</p>}
      {rows && rows.length > 0 && (
        <ul className="divide-y divide-line rounded-2xl border border-line">
          {rows.map((r) => (
            <li key={r.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-4 py-2.5">
              <span className={`pill ${r.state === 'done' ? 'pill-ok' : 'pill-bad'}`}>{r.state === 'done' ? t('upd.h.ok') : t('upd.h.fail')}</span>
              <span className="font-bold">{r.kind === 'rollback' ? t('upd.h.rollback') : t('upd.h.update')}</span>
              <span className="font-mono text-sm font-semibold text-mute">{versionText(r.label, r.version)}</span>
              <span className="text-sm font-semibold text-mute">{fmtDateTime(r.time)}</span>
              <span className="basis-full text-sm font-semibold text-mute">{r.message}</span>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

/** channel and Discord notices */
export function OptionsCard({ info, onChange }: { info: UpdateInfo; onChange: (i: UpdateInfo) => void }) {
  const [error, setError] = useState('');
  const [picking, setPicking] = useState(false);
  const save = async (body: { channel?: 'release' | 'main'; notify?: boolean; notifyLang?: 'ru' | 'en'; remindDays?: number; notifyChannel?: string }) => {
    setError('');
    try {
      onChange(await api<UpdateInfo>('/update/settings', 'PUT', body));
      toast(t('al.saved'));
    } catch (e) {
      setError(errText(e));
    }
  };
  return (
    <Section title={t('upd.o.title')}>
      <fieldset className="space-y-2" disabled={!!info.channelLocked}>
        <legend className="label">{t('upd.o.channel')}</legend>
        {(['release', 'main'] as const).map((c) => (
          <label key={c} className="flex cursor-pointer items-center gap-2.5 font-bold">
            <input type="radio" name="upd-channel" className="h-4 w-4 accent-brand" checked={(info.channel ?? 'release') === c} onChange={() => void save({ channel: c })} />
            <span>{t(`upd.o.${c}` as TKey)}</span>
          </label>
        ))}
        {info.channelLocked && <p className="text-sm font-semibold text-mute">{t('upd.o.locked')}</p>}
      </fieldset>
      <label className="flex cursor-pointer items-start gap-2.5 font-bold">
        <input type="checkbox" className="mt-1 h-4 w-4 accent-brand" checked={info.notify !== false} onChange={(e) => void save({ notify: e.target.checked })} aria-describedby="upd-notify-hint" />
        <span>{t('upd.o.notify')}<span id="upd-notify-hint" className="mt-0.5 block text-sm font-semibold text-mute">{t('upd.o.notifyHint')}</span></span>
      </label>
      {info.notify !== false && (
        <div>
          <span className="label">{t('upd.o.chan')}</span>
          <div className="flex flex-wrap items-center gap-3">
            <span className="font-black">{info.notifyChannel ? <ChannelName id={info.notifyChannel} /> : t('upd.o.chan.alerts')}</span>
            <button type="button" className="btn btn-soft btn-sm" onClick={() => setPicking((v) => !v)} aria-expanded={picking}>{t('upd.o.chan.pick')}</button>
            {info.notifyChannel && <button type="button" className="btn-link text-sm" onClick={() => void save({ notifyChannel: '' })}>{t('upd.o.chan.reset')}</button>}
          </div>
          {picking && (
            <div className="mt-3">
              <ChannelPicker id="upd-channel" value={info.notifyChannel ?? ''} onChange={(v) => { if (/^\d{15,25}$/.test(v)) { void save({ notifyChannel: v }); setPicking(false); } }} />
            </div>
          )}
        </div>
      )}
      {info.notify !== false && (
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor="upd-lang" className="label">{t('upd.o.lang')}</label>
            <select id="upd-lang" className="input" value={info.notifyLang ?? 'ru'} onChange={(e) => void save({ notifyLang: e.target.value as 'ru' | 'en' })}>
              <option value="ru">{'Русский'}</option>
              <option value="en">English</option>
            </select>
          </div>
          <div>
            <label htmlFor="upd-remind" className="label">{t('upd.o.remind')}</label>
            <select id="upd-remind" className="input" value={info.remindDays ?? 7} onChange={(e) => void save({ remindDays: Number(e.target.value) })}>
              <option value={0}>{t('upd.o.remind.off')}</option>
              {[3, 7, 14, 30].map((d) => <option key={d} value={d}>{t('upd.o.remind.n', { n: d })}</option>)}
            </select>
          </div>
        </div>
      )}
      <ErrorLine text={error} />
    </Section>
  );
}
