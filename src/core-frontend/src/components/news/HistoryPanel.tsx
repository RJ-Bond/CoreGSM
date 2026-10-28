import { useEffect, useState } from 'react';
import { api, ApiError, type NewsHistoryEntry, type NewsItem, type NewsPayload, type NewsVersion, type NewsVersionFull } from '../../api';
import { confirmDialog } from '../../confirm';
import { EmbedView } from '../../pages/EmbedPreview';
import { Button, Modal, fmtDateTime, toast } from '../../ui';
import { t, useI18n, type TKey } from '../../i18n';
import { fromPayload, sampleVars } from './model';
import { embedView, messageContent } from './Preview';

const ACTIONS: Record<string, TKey> = {
  create: 'd2.hp.a.create', created: 'd2.hp.a.create', update: 'd2.hp.a.update', updated: 'd2.hp.a.update', edit: 'd2.hp.a.update', publish: 'd2.hp.a.publish', published: 'd2.hp.a.publish', schedule: 'd2.hp.a.schedule', scheduled: 'd2.hp.a.schedule',
  restore: 'd2.hp.a.restore', restored: 'd2.hp.a.restore', delete: 'd2.hp.a.delete', duplicate: 'd2.hp.a.duplicate', duplicated: 'd2.hp.a.duplicate', send: 'd2.hp.a.send', sent: 'd2.hp.a.send',
};
const actionText = (a: string) => (ACTIONS[a] ? t(ACTIONS[a]) : a);

function VersionPreview({ payload }: { payload: NewsPayload }) {
  const d = fromPayload(payload, '');
  const v = sampleVars(null);
  const embeds = d.embeds.map((e) => embedView(e, v)).filter((e): e is NonNullable<typeof e> => !!e);
  return <EmbedView content={messageContent(d, v)} embeds={embeds} />;
}

/** Version history and «who changed what» for an existing item. Hidden when the backend has no such routes. */
export function HistoryPanel({ id, onRestored, locked }: { id: number; onRestored: (item: NewsItem) => void; locked?: boolean }) {
  useI18n();
  const [versions, setVersions] = useState<NewsVersion[] | null>(null);
  const [history, setHistory] = useState<NewsHistoryEntry[] | null>(null);
  const [supported, setSupported] = useState(true);
  const [open, setOpen] = useState<NewsVersionFull | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const load = () => {
    api<NewsVersion[]>(`/news/${id}/versions`)
      .then((v) => setVersions(Array.isArray(v) ? v : []))
      .catch((e) => { if (e instanceof ApiError && e.status === 404) setSupported(false); else setVersions([]); });
    api<NewsHistoryEntry[]>(`/news/${id}/history`)
      .then((h) => setHistory(Array.isArray(h) ? h : []))
      .catch(() => setHistory([]));
  };
  useEffect(load, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!supported) return null;

  const view = async (v: NewsVersion) => {
    setErr('');
    try { setOpen(await api<NewsVersionFull>(`/news/${id}/versions/${v.id}`)); } catch (e) { setErr((e as Error).message); }
  };
  const restore = async () => {
    if (!open) return;
    if (!(await confirmDialog({ title: t('d2.hp.c.title'), text: t('d2.hp.c.text'), confirmLabel: t('d2.bk.restore') }))) return;
    setBusy(true);
    try {
      const item = await api<NewsItem>(`/news/${id}/versions/${open.id}/restore`, 'POST');
      toast(t('d2.hp.t.restored'));
      setOpen(null);
      onRestored(item);
      load();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="panel space-y-3.5 p-5">
      <div>
        <h2 className="text-lg font-black">{t('d2.hp.title')}</h2>
        <p className="text-sm font-semibold text-mute">{t('d2.hp.text')}</p>
      </div>
      {err && <p className="text-sm font-bold text-bad" role="alert">{err}</p>}
      {versions === null && <div className="skeleton h-16 rounded-2xl" />}
      {versions && versions.length === 0 && <p className="text-sm font-semibold text-mute">{t('d2.hp.none')}</p>}
      {versions && versions.length > 0 && (
        <ul className="divide-y divide-line rounded-2xl border-2 border-line">
          {versions.map((v) => (
            <li key={v.id} className="flex flex-wrap items-center gap-2 px-3 py-2">
              <div className="min-w-0 flex-1">
                <div className="text-sm font-extrabold">{fmtDateTime(v.ts)} · {v.actor}</div>
                {v.note && <div className="truncate text-xs font-semibold text-mute">{v.note}</div>}
              </div>
              <button type="button" className="btn btn-soft btn-sm" onClick={() => void view(v)}>{t('d2.hp.view')}</button>
            </li>
          ))}
        </ul>
      )}
      {history && history.length > 0 && (
        <div>
          <h3 className="mb-1.5 text-sm font-extrabold text-mute">{t('d2.hp.who')}</h3>
          <ul className="space-y-1">
            {history.slice(0, 20).map((h, i) => (
              <li key={i} className="text-sm font-semibold"><span className="text-mute">{fmtDateTime(h.ts)}</span> · <b>{h.actor}</b> {actionText(h.action)}</li>
            ))}
          </ul>
        </div>
      )}
      {open && (
        <Modal title={t('d2.hp.version', { when: fmtDateTime(open.ts) })} onClose={() => setOpen(null)}>
          <p className="mb-3 text-sm font-semibold text-mute">{t('d2.hp.readOnly', { actor: open.actor })}</p>
          <div className="max-h-[55dvh] overflow-auto rounded-2xl">
            <VersionPreview payload={open.payload} />
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button variant="ghost" onClick={() => setOpen(null)}>{t('common.close')}</Button>
            <Button className="flex-1" loading={busy} disabled={locked} onClick={() => void restore()}>{t('d2.hp.restoreBtn')}</Button>
          </div>
          {locked && <p className="mt-2 text-xs font-semibold text-mute">{t('d2.hp.locked')}</p>}
        </Modal>
      )}
    </section>
  );
}
