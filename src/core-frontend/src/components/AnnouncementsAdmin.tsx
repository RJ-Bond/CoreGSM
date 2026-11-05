import { useEffect, useState, type FormEvent } from 'react';
import { api } from '../api';
import { confirmDialog } from '../confirm';
import { t, useI18n } from '../i18n';
import { Button, ErrorLine, Section, fail, fmtDateTime, toast } from '../ui';
import { ChannelName, ChannelPicker } from './ChannelPicker';

interface Announcement { id: number; title: string; text: string; channelId: string; mention: 'none' | 'here' | 'everyone'; repeat: 'none' | 'daily' | 'weekly'; nextAt: number | null; lastSentAt: number | null }

/** Discord → «Дополнительно»: a text sent to a channel at a set time, once, daily or weekly */
export default function AnnouncementsAdmin() {
  useI18n();
  const [list, setList] = useState<Announcement[] | null>(null);
  const [title, setTitle] = useState('');
  const [text, setText] = useState('');
  const [at, setAt] = useState('');
  const [repeat, setRepeat] = useState<Announcement['repeat']>('none');
  const [mention, setMention] = useState<Announcement['mention']>('none');
  const [channelId, setChannelId] = useState('');
  const [picking, setPicking] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = () => api<Announcement[]>('/announcements').then(setList).catch((e: Error) => setError(e.message));
  useEffect(() => {
    let alive = true;
    api<Announcement[]>('/announcements').then((l) => { if (alive) setList(l); }).catch((e: Error) => { if (alive) setError(e.message); });
    return () => { alive = false; };
  }, []);

  const create = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    if (!at) { setError(t('ann.needTime')); return; }
    setBusy(true);
    try {
      await api('/announcements', 'POST', { title, text, channelId, mention, repeat, at: new Date(at).getTime() });
      setTitle(''); setText(''); setAt(''); setRepeat('none'); setMention('none');
      toast(t('ann.created'));
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const remove = async (a: Announcement) => {
    if (!(await confirmDialog({ title: t('ann.deleteQ'), text: a.title || a.text.slice(0, 80), confirmLabel: t('ann.delete'), danger: true }))) return;
    try { await api(`/announcements/${a.id}`, 'DELETE'); await load(); } catch (err) { fail(err); }
  };

  return (
    <Section title={t('ann.title')} description={t('ann.desc')}>
      <form onSubmit={(e) => void create(e)} className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor="ann-title" className="label">{t('ann.heading')}</label>
            <input id="ann-title" className="input" value={title} maxLength={100} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div>
            <label htmlFor="ann-at" className="label">{t('ann.when')}</label>
            <input id="ann-at" className="input" type="datetime-local" value={at} onChange={(e) => setAt(e.target.value)} required />
          </div>
        </div>
        <div>
          <label htmlFor="ann-text" className="label">{t('ann.text')}</label>
          <textarea id="ann-text" className="input min-h-24" value={text} maxLength={1800} onChange={(e) => setText(e.target.value)} required />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor="ann-repeat" className="label">{t('ann.repeat')}</label>
            <select id="ann-repeat" className="input" value={repeat} onChange={(e) => setRepeat(e.target.value as Announcement['repeat'])}>
              <option value="none">{t('ann.r.none')}</option>
              <option value="daily">{t('ann.r.daily')}</option>
              <option value="weekly">{t('ann.r.weekly')}</option>
            </select>
          </div>
          <div>
            <label htmlFor="ann-mention" className="label">{t('ann.mention')}</label>
            <select id="ann-mention" className="input" value={mention} onChange={(e) => setMention(e.target.value as Announcement['mention'])}>
              <option value="none">{t('ann.m.none')}</option>
              <option value="here">@here</option>
              <option value="everyone">@everyone</option>
            </select>
          </div>
        </div>
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <span className="font-black">{channelId ? <ChannelName id={channelId} /> : t('ann.noChannel')}</span>
            <button type="button" className="btn btn-soft btn-sm" onClick={() => setPicking((v) => !v)} aria-expanded={picking}>{t('ann.pick')}</button>
          </div>
          {picking && <div className="mt-3"><ChannelPicker id="ann-channel" value={channelId} onChange={(v) => { if (/^\d{15,25}$/.test(v)) { setChannelId(v); setPicking(false); } }} /></div>}
        </div>
        <ErrorLine text={error} />
        <Button loading={busy} disabled={!channelId}>{t('ann.create')}</Button>
      </form>
      <div className="mt-5 divide-y divide-line">
        {list && list.length === 0 && <p className="font-semibold text-mute">{t('ann.none')}</p>}
        {list?.map((a) => (
          <div key={a.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-3">
            <div className="min-w-0 flex-1">
              <div className="font-extrabold wrap-break-word">{a.title || a.text.slice(0, 60)}</div>
              <div className="text-sm font-semibold text-mute">
                <ChannelName id={a.channelId} /> · {a.nextAt ? t('ann.next', { when: fmtDateTime(a.nextAt) }) : t('ann.sent')}{a.repeat !== 'none' ? ` · ${t(`ann.r.${a.repeat}` as const)}` : ''}
              </div>
            </div>
            <button type="button" className="btn-link text-bad" onClick={() => void remove(a)}>{t('ann.delete')}</button>
          </div>
        ))}
      </div>
    </Section>
  );
}
