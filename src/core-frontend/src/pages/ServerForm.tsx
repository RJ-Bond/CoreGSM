import { useEffect, useRef, useState, type FormEvent } from 'react';
import { confirmDialog } from '../confirm';
import { api, getToken, type ServerInput, type TestResult } from '../api';
import { GAMES, gameLabel } from '../games';
import GamePicker from '../components/GamePicker';
import { ErrorLine, Field, GameAvatar, Modal, errText } from '../ui';
import { COUNTRIES } from '../countries';
import { nextPort, shownFields, useGameProfiles } from '../gameProfiles';
import { t, useI18n } from '../i18n';
import { errorText } from '../apiErrors';

/** the first problem with the address field, or '' (an address only: no scheme, path, spaces or a port glued to it) */
export function hostError(v: string): string {
  const h = v.trim();
  if (!h) return '';
  if (/\s/.test(h)) return t('d2.sf.h.spaces');
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(h) || h.includes('/')) return t('d2.sf.h.noScheme');
  if ((h.match(/:/g) ?? []).length === 1) return t('d2.sf.h.port');
  return '';
}

export const emptyServer: ServerInput = { name: '', game: 'minecraft', host: '', port: 25565, queryPort: null, displayAddress: '', country: '' };

/** Add / edit a server. The first screen asks only what is needed; the rest is under "Дополнительно". */
export default function ServerForm({ initial, id, coverUrl, onCoverChanged, onClose, onSaved }: { initial: ServerInput; id?: number; coverUrl?: string | null; onCoverChanged?: () => void; onClose: () => void; onSaved: () => void }) {
  useI18n();
  const [f, setF] = useState(initial);
  const [cover, setCover] = useState<string | null>(coverUrl ?? null);
  const [coverBusy, setCoverBusy] = useState(false);

  const uploadCover = async (file: File) => {
    if (!id) return;
    setCoverBusy(true);
    setError('');
    try {
      const r = await fetch(`/api/servers/${id}/cover`, { method: 'PUT', headers: { 'Content-Type': file.type, Authorization: `Bearer ${getToken() ?? ''}` }, body: file });
      const j = (await r.json().catch(() => null)) as { coverUrl?: string; error?: string } | null;
      if (!r.ok) throw new Error(errorText(j, t('d2.sf.coverFail')));
      setCover(j?.coverUrl ?? null);
      onCoverChanged?.();
    } catch (e) {
      setError(errText(e));
    } finally {
      setCoverBusy(false);
    }
  };
  const removeCover = async () => {
    if (!id) return;
    setCoverBusy(true);
    try {
      await api(`/servers/${id}/cover`, 'DELETE');
      setCover(null);
      onCoverChanged?.();
    } catch (e) {
      setError(errText(e));
    } finally {
      setCoverBusy(false);
    }
  };
  const [custom, setCustom] = useState(!GAMES.some((g) => g.id === initial.game));
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState(false);
  const [test, setTest] = useState<TestResult | null>(null);

  // "advanced" is open when it already holds something (editing)
  const advancedUsed = !!(initial.name || initial.queryPort || initial.displayAddress || initial.country || coverUrl);

  const profiles = useGameProfiles();
  // true once the user typed a port themselves: a game change must not overwrite it
  const portTouched = useRef(false);

  const pickGame = (v: string) => {
    setTest(null);
    if (v === '__custom') { setCustom(true); return; }
    setCustom(false);
    const g = GAMES.find((x) => x.id === v);
    const nextDefault = profiles?.[v]?.defaultPort ?? g?.port;
    setF((p) => ({
      ...p,
      game: v,
      port: nextPort({
        current: p.port,
        touched: portTouched.current,
        hasHost: !!p.host,
        prevDefault: profiles?.[p.game]?.defaultPort ?? GAMES.find((x) => x.id === p.game)?.port,
        nextDefault,
      }),
    }));
  };

  const change = (patch: Partial<ServerInput>) => {
    setTest(null);
    setF((p) => ({ ...p, ...patch }));
  };

  const gameProfile = custom ? undefined : profiles?.[f.game];
  const fieldList = shownFields(gameProfile?.fields);

  const hostProblem = hostError(f.host);
  const portProblem = f.port && (f.port < 1 || f.port > 65535 || !Number.isInteger(f.port)) ? t('d2.sf.portRange') : '';
  const canTest = f.host.trim().length > 0 && f.game.length > 0 && f.port > 0 && !hostProblem && !portProblem;
  // closing with unsaved edits asks first; a reload or closing the tab is warned about by the browser
  const dirty = JSON.stringify(f) !== JSON.stringify(initial);
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);
  const close = async () => {
    if (dirty && !(await confirmDialog({ title: t('d2.sf.discardTitle'), text: t('d2.sf.discardText'), confirmLabel: t('common.close'), cancelLabel: t('d2.sf.keepEditing'), danger: true }))) return;
    onClose();
  };

  const runTest = async () => {
    setTesting(true);
    setError('');
    setTest(null);
    try {
      setTest(await api<TestResult>('/servers/test', 'POST', { game: f.game, host: f.host, port: f.port, queryPort: f.queryPort }));
    } catch (e) {
      setError(errText(e));
    } finally {
      setTesting(false);
    }
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api(id ? `/servers/${id}` : '/servers', id ? 'PUT' : 'POST', f);
      onSaved();
    } catch (err) {
      setError(errText(err));
      setBusy(false);
    }
  };

  return (
    <Modal side title={id ? t('d2.sf.editTitle') : t('d2.sf.newTitle')} onClose={() => void close()}>
      <form onSubmit={submit} className="space-y-3.5">
        <div className="sf-preview" aria-label={t('d2.sf.previewLabel')} style={cover ? { backgroundImage: `linear-gradient(rgb(0 0 0 / .45), rgb(0 0 0 / .65)), url(${cover})` } : undefined} data-cover={cover ? 'true' : undefined}>
          <GameAvatar game={f.game} size={44} />
          <div className="min-w-0 flex-1">
            <p className="truncate font-extrabold">{f.name || (test?.online && test.name) || (f.host ? `${f.host}:${f.port}` : t('d2.sf.serverName'))}</p>
            <p className="truncate text-xs font-semibold opacity-80">{gameLabel(f.game)} · <span className="font-mono">{f.displayAddress || (f.host ? `${f.host}:${f.port}` : t('d2.sf.address'))}</span></p>
          </div>
          <span className={`sf-preview-st ${test ? (test.online ? 'is-on' : 'is-off') : ''}`}>
            {test ? (test.online ? `${test.players}/${test.maxPlayers}` : t('d2.sf.noAnswer')) : t('d2.sf.notChecked')}
          </span>
        </div>
        <div>
          <span className="label">{t('d2.sf.game')}</span>
          <GamePicker id="srv-game" value={f.game} custom={custom} onPick={pickGame} autoFocus />
        </div>
        {custom && (
          <Field label="GameDig ID">
            <input id="srv-gameid" className="input" value={f.game} onChange={(e) => change({ game: e.target.value.trim() })} placeholder={t('d2.sf.gameIdEx')} required pattern="[A-Za-z0-9_]+" />
          </Field>
        )}
        <div className="grid grid-cols-3 gap-3">
          <div className="col-span-2">
            <Field label={t('d2.sf.host')}>
              <input id="srv-host" className="input" value={f.host} onChange={(e) => change({ host: e.target.value.trim() })} required placeholder="192.168.1.10" aria-invalid={hostProblem ? true : undefined} aria-describedby={hostProblem ? 'srv-host-err' : undefined} />
            {hostProblem && <p id="srv-host-err" className="mt-1 text-sm font-bold text-bad" role="alert">{hostProblem}</p>}
            </Field>
          </div>
          <Field label={t('d2.sf.port')}>
            <input id="srv-port" className="input" type="number" min={1} max={65535} value={f.port} onChange={(e) => { portTouched.current = true; change({ port: Number(e.target.value) }); }} required />
          </Field>
        </div>
        {gameProfile?.queryPortHint && <p className="-mt-2 text-sm font-semibold text-mute">{t('sf.queryHint', { hint: gameProfile.queryPortHint })}</p>}
        {fieldList.length > 0 && <p className="-mt-2 text-sm font-semibold text-mute">{t('sf.fields', { list: fieldList.map((k) => t(`sf.field.${k}` as const)).join(' / ') })}</p>}

        <div className="space-y-2">
          <button type="button" className="btn btn-soft" onClick={runTest} disabled={!canTest || testing}>
            {testing ? t('d2.sf.testing') : t('d2.sf.test')}
          </button>
          {test && test.online && (
            <div className="rounded-2xl bg-okbg px-4 py-3 text-sm font-bold text-ok" role="status">
              ✔ {t('d2.sf.answered')}{test.name ? `: «${test.name}»` : ''}
              <div className="mt-0.5 font-semibold">
                {t('d2.sf.players')} {test.players}/{test.maxPlayers}
                {test.map ? ` ${t('d2.sf.map', { map: test.map })}` : ''}
                {test.ping != null ? ` ${t('d2.sf.ping', { ms: test.ping })}` : ''}
              </div>
            </div>
          )}
          {test && !test.online && (
            <div className="rounded-2xl bg-badbg px-4 py-3 text-sm font-bold text-bad" role="alert">
              ✖ {test.error ?? t('d2.sf.noReply')}
            </div>
          )}
        </div>

        <details className="group rounded-2xl border-2 border-line px-4 py-2.5" open={advancedUsed}>
          <summary className="cursor-pointer select-none font-extrabold text-link">{t('d2.sf.advanced')}</summary>
          <div className="mt-3 space-y-3.5">
            <Field label={t('d2.sf.name')}>
              <input id="srv-name" className="input" value={f.name} onChange={(e) => change({ name: e.target.value })} maxLength={64} placeholder={t('d2.sf.nameEx')} />
            </Field>
            <p className="-mt-2 text-sm font-semibold text-mute">{t('d2.sf.nameHint')}</p>
            <Field label={t('d2.sf.qport')}>
              <input id="srv-qport" className="input" type="number" min={1} max={65535} value={f.queryPort ?? ''} onChange={(e) => change({ queryPort: e.target.value ? Number(e.target.value) : null })} placeholder={t('d2.sf.notSet')} />
            </Field>
            <Field label={t('d2.sf.display')}>
              <input id="srv-display" className="input font-mono" value={f.displayAddress} onChange={(e) => change({ displayAddress: e.target.value.trim() })} maxLength={100} placeholder={t('d2.sf.displayEx')} />
            </Field>
            <Field label={t('d2.sf.country')}>
              <select id="srv-country" className="input" value={f.country} onChange={(e) => change({ country: e.target.value })}>
                <option value="">{t('d2.sf.countryAuto')}</option>
                {COUNTRIES.map(([code, name]) => <option key={code} value={code}>{name}</option>)}
              </select>
            </Field>
            <p className="-mt-2 text-sm font-semibold text-mute">{t('d2.sf.countryHint')}</p>
            <p className="-mt-2 text-sm font-semibold text-mute">{t('d2.sf.displayHint')}</p>
            <div>
              <span className="label">{t('d2.sf.cover')}</span>
              {id ? (
                <div className="flex flex-wrap items-center gap-3">
                  <div className="h-[72px] w-32 shrink-0 overflow-hidden rounded-xl border border-line bg-soft" style={cover ? { backgroundImage: `url(${cover})`, backgroundSize: 'cover', backgroundPosition: 'center' } : undefined} aria-hidden />
                  <label className="btn btn-soft btn-sm cursor-pointer">
                    {coverBusy ? t('d2.sf.uploading') : t('d2.sf.upload')}
                    <input type="file" accept="image/png,image/jpeg,image/webp" className="hidden" disabled={coverBusy} onChange={(e) => { const file = e.target.files?.[0]; if (file) void uploadCover(file); e.target.value = ''; }} />
                  </label>
                  {cover && <button type="button" className="btn btn-soft btn-sm" onClick={() => void removeCover()} disabled={coverBusy}>{t('common.remove')}</button>}
                  <span className="basis-full text-sm font-semibold text-mute">{t('d2.sf.coverHint')}</span>
                </div>
              ) : (
                <p className="text-sm font-semibold text-mute">{t('d2.sf.coverLater')}</p>
              )}
            </div>
          </div>
        </details>

        <ErrorLine text={error} />
        {portProblem && <p className="text-sm font-bold text-bad" role="alert">{portProblem}</p>}
        <div className="adm-sticky-foot flex justify-end gap-2 pt-1">
          <button type="button" className="btn btn-ghost" onClick={() => void close()}>{t('common.cancel')}</button>
          <button className="btn" disabled={busy || !canTest}>{busy ? t('d2.sf.saving') : t('common.save')}</button>
        </div>
      </form>
    </Modal>
  );
}
