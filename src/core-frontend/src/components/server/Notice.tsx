import { useState } from 'react';
import { api } from '../../api';
import { t, useI18n, type TKey } from '../../i18n';
import { ago, toast, fail } from '../../ui';

export interface ServerNotice { text: string; tone: string; updatedAt: number }

const TONES: [string, TKey][] = [['info', 'st.note.info'], ['ok', 'd2.nt.tone.ok'], ['warn', 'd2.nt.tone.warn'], ['bad', 'd2.nt.tone.bad']];
const ICON: Record<string, string> = { info: 'ℹ️', ok: '✅', warn: '⚠️', bad: '🚨' };

/**
 * A pinned note of the staff at the top of the overview (rules, the next wipe, working hours). Everybody reads it;
 * those who manage servers get «Закрепить объявление» / «Изменить» and a small form.
 */
export default function PinnedNotice({ serverId, notice, canEdit, onChange }: { serverId: number; notice: ServerNotice | null; canEdit: boolean; onChange: (n: ServerNotice | null) => void }) {
  useI18n();
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState('');
  const [tone, setTone] = useState('info');
  const [busy, setBusy] = useState(false);

  const open = () => { setText(notice?.text ?? ''); setTone(notice?.tone ?? 'info'); setEditing(true); };
  const save = async (value: string) => {
    setBusy(true);
    try {
      const r = await api<{ notice: ServerNotice | null }>(`/servers/${serverId}/notice`, 'PUT', { text: value, tone });
      onChange(r.notice);
      setEditing(false);
      toast(r.notice ? t('d2.nt.t.pinned') : t('d2.nt.t.removed'));
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };

  if (editing) {
    return (
      <form className="srv-notice-form" onSubmit={(e) => { e.preventDefault(); void save(text); }}>
        <label className="font-extrabold" htmlFor="srv-notice-text">{t('d2.nt.title')}</label>
        <textarea id="srv-notice-text" className="input min-h-20" value={text} maxLength={500} onChange={(e) => setText(e.target.value)} placeholder={t('d2.nt.ph')} autoFocus />
        <div className="flex flex-wrap items-center gap-2">
          <div className="seg" role="group" aria-label={t('sn.f.level')}>
            {TONES.map(([k, label]) => <button key={k} type="button" className="seg-item" aria-pressed={tone === k} onClick={() => setTone(k)}>{t(label)}</button>)}
          </div>
          <span className="ml-auto text-xs font-bold text-mute">{text.length}/500</span>
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          {notice && <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => void save('')}>{t('d2.nt.remove')}</button>}
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditing(false)}>{t('common.cancel')}</button>
          <button className="btn btn-sm" disabled={busy || !text.trim()}>{t('d2.news.pin')}</button>
        </div>
      </form>
    );
  }
  if (!notice) {
    return canEdit ? <button type="button" className="srv-notice-add" onClick={open}>📌 {t('d2.nt.pin')}</button> : null;
  }
  return (
    <aside className={`srv-notice is-${notice.tone}`} role="note">
      <span className="srv-notice-i" aria-hidden>{ICON[notice.tone] ?? ICON.info}</span>
      <div className="min-w-0 flex-1">
        <p className="whitespace-pre-line font-bold leading-snug">{notice.text}</p>
        <p className="mt-1 text-xs font-bold opacity-70">{t('d2.nt.pinnedAgo', { ago: ago(notice.updatedAt) })}</p>
      </div>
      {canEdit && <button type="button" className="btn-link btn-xs shrink-0" onClick={open}>{t('d2.news.change')}</button>}
    </aside>
  );
}
