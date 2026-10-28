// Administrator bulk actions on the servers page: poll now, maintenance window, favourites. Russian only (admin area).
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { api, type Server } from '../../api';
import { t, useI18n, type TKey } from '../../i18n';
import { Field, Modal, toast, ErrorLine } from '../../ui';
import { fromLocalInput, toLocalInput, validateWindow } from '../../maintenance';

type Dur = '30' | '60' | '120' | 'until';

/** the maintenance dialog: one window per selected server */
function MaintenanceDialog({ servers, onClose, onDone }: { servers: Server[]; onClose: () => void; onDone: () => void }) {
  useI18n();
  const [name, setName] = useState(t('d2.bb.defName'));
  const [dur, setDur] = useState<Dur>('60');
  const [until, setUntil] = useState(() => toLocalInput(Date.now() + 3 * 3600_000));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const range = (): { startTs: number; endTs: number | null } => {
    const startTs = Math.floor(Date.now() / 60_000) * 60_000;
    return { startTs, endTs: dur === 'until' ? fromLocalInput(until) : startTs + Number(dur) * 60_000 };
  };
  const preview = range();
  const problem = validateWindow({ name, startTs: preview.startTs, endTs: preview.endTs, repeat: 'none' });

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (problem || busy) return;
    const { startTs, endTs } = range();
    setBusy(true);
    setError('');
    let ok = 0;
    for (const s of servers) {
      try {
        await api('/maintenance', 'POST', { serverId: s.id, name: name.trim(), startTs, endTs, repeat: 'none' });
        ok++;
      } catch (err) {
        setError(`«${s.name}»: ${(err as Error).message}`);
        setBusy(false);
        if (ok) toast(t('d2.bb.partial', { ok, total: servers.length }), 'err');
        return;
      }
    }
    toast(ok === 1 ? t('d2.bb.created1') : t('d2.bb.createdN', { n: ok }));
    onDone();
  };

  return (
    <Modal title={t('d2.bb.title')} onClose={onClose}>
      <form className="space-y-4" onSubmit={(e) => void submit(e)} noValidate>
        <p className="text-sm font-semibold text-mute">
          {t('d2.bb.text', { n: servers.length })}
        </p>
        <Field label={t('d2.sf.name')}>
          <input className="input" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
        </Field>
        <div role="group" aria-label={t('d2.bb.duration')}>
          <span className="label">{t('d2.bb.duration')}</span>
          <div className="flex flex-wrap gap-2">
            {([['30', 'd2.bb.d30'], ['60', 'd2.bb.d60'], ['120', 'd2.bb.d120'], ['until', 'd2.bb.until']] as [Dur, TKey][]).map(([v, label]) => (
              <button key={v} type="button" className={`chip-filter ${dur === v ? 'on' : ''}`} aria-pressed={dur === v} onClick={() => setDur(v)}>{t(label)}</button>
            ))}
          </div>
        </div>
        {dur === 'until' && (
          <Field label={t('d2.mt.end')}><input className="input" type="datetime-local" value={until} onChange={(e) => setUntil(e.target.value)} /></Field>
        )}
        {problem && name.trim() !== '' && <p className="text-sm font-bold text-bad">{problem}</p>}
        <ErrorLine text={error} />
        <div className="flex flex-wrap justify-end gap-2.5">
          <button type="button" className="btn btn-ghost" onClick={onClose}>{t('common.cancel')}</button>
          <button type="submit" className="btn" disabled={!!problem || busy}>{busy ? t('d2.bb.creating') : t('d2.bb.create')}</button>
        </div>
      </form>
    </Modal>
  );
}

export function BulkBar({ selected, visible, favs, onSelectAll, onClear, onExit, onReload, onFavs }: {
  selected: Server[];
  visible: Server[];
  favs: number[];
  onSelectAll: () => void;
  onClear: () => void;
  onExit: () => void;
  onReload: () => void;
  onFavs: (next: number[]) => void;
}) {
  useI18n();
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [dialog, setDialog] = useState(false);
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);
  const n = selected.length;
  const busy = progress != null;

  const refreshAll = async () => {
    if (busy || n === 0) return;
    const list = [...selected];
    let fail = 0;
    for (let i = 0; i < list.length; i++) {
      if (alive.current) setProgress({ done: i, total: list.length });
      try {
        await api(`/servers/${list[i].id}/refresh`, 'POST');
      } catch {
        fail++;
      }
    }
    if (alive.current) setProgress(null);
    toast(fail ? t('d2.bb.t.polledFail', { ok: list.length - fail, total: list.length, fail }) : list.length === 1 ? t('d2.bb.t.polled1') : t('d2.bb.t.polledN', { n: list.length }), fail ? 'err' : 'ok');
    onReload();
  };

  const setFav = async (on: boolean) => {
    if (busy || n === 0) return;
    const ids = selected.map((s) => s.id).filter((id) => favs.includes(id) !== on);
    if (ids.length === 0) { toast(on ? t('d2.bb.t.allFav') : t('d2.bb.t.noneFav'), 'info'); return; }
    onFavs(on ? [...favs, ...ids] : favs.filter((id) => !ids.includes(id)));
    const res = await Promise.allSettled(ids.map((id) => api(`/favorites/${id}`, on ? 'PUT' : 'DELETE')));
    const bad = res.filter((r) => r.status === 'rejected').length;
    toast(bad ? t('d2.bb.t.favFail', { n: bad }) : on ? t('d2.bb.t.favAdded', { n: ids.length }) : t('d2.bb.t.favRemoved', { n: ids.length }), bad ? 'err' : 'ok');
  };

  return (
    <>
      <div className="srv-bulk" role="toolbar" aria-label={t('d2.bb.actions')}>
        <div className="srv-bulk-count" aria-live="polite">
          {busy ? t('d2.bb.progress', { a: progress.done + 1, b: progress.total }) : n === 0 ? t('d2.bb.none') : t('d2.news.picked', { n })}
        </div>
        <div className="srv-bulk-actions">
          <button type="button" className="btn btn-soft" onClick={onSelectAll} disabled={busy || n === visible.length}>{t('d2.news.pickAll')}</button>
          <button type="button" className="btn btn-soft" onClick={onClear} disabled={busy || n === 0}>{t('d2.news.reset')}</button>
          <button type="button" className="btn" onClick={() => void refreshAll()} disabled={busy || n === 0}>{t('d2.bb.pollNow')}</button>
          <button type="button" className="btn btn-soft" onClick={() => setDialog(true)} disabled={busy || n === 0}>{t('d2.bb.maintenance')}</button>
          <button type="button" className="btn btn-soft" onClick={() => void setFav(true)} disabled={busy || n === 0}>{t('d2.bb.addFav')}</button>
          <button type="button" className="btn btn-soft" onClick={() => void setFav(false)} disabled={busy || n === 0}>{t('common.remove')}</button>
          <button type="button" className="btn btn-soft" onClick={onExit}>{t('d2.bb.done')}</button>
        </div>
      </div>
      {dialog && <MaintenanceDialog servers={selected} onClose={() => setDialog(false)} onDone={() => { setDialog(false); onReload(); }} />}
    </>
  );
}
