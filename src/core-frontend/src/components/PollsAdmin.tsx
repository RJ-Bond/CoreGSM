import { useEffect, useState, type FormEvent } from 'react';
import { api } from '../api';
import { confirmDialog } from '../confirm';
import { t, useI18n } from '../i18n';
import { Button, ErrorLine, Section, fail, toast } from '../ui';
import { ChannelPicker } from './ChannelPicker';
import { PollBlock, type PollView } from './PollsCard';

/** Admin → Сообщество → Голосования: create a poll (optionally posted to a Discord channel with vote buttons), close it, delete it. */
export default function PollsAdmin() {
  useI18n();
  const [polls, setPolls] = useState<PollView[] | null>(null);
  const [question, setQuestion] = useState('');
  const [options, setOptions] = useState(['', '']);
  const [until, setUntil] = useState('');
  const [channelId, setChannelId] = useState('');
  const [picking, setPicking] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = () => api<PollView[]>('/polls').then(setPolls).catch((e: Error) => setError(e.message));
  useEffect(() => { void load(); }, []);

  const create = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await api('/polls', 'POST', {
        question,
        options: options.filter((o) => o.trim()),
        closesAt: until ? new Date(until).getTime() : null,
        channelId,
      });
      setQuestion('');
      setOptions(['', '']);
      setUntil('');
      toast(channelId ? t('pl.createdPosted') : t('pl.created'));
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const close = async (p: PollView) => {
    if (!(await confirmDialog({ title: t('pl.closeQ'), text: t('pl.closeText'), confirmLabel: t('pl.close') }))) return;
    try { await api(`/polls/${p.id}/close`, 'POST'); await load(); } catch (err) { fail(err); }
  };
  const remove = async (p: PollView) => {
    if (!(await confirmDialog({ title: t('pl.deleteQ'), text: t('pl.deleteText'), confirmLabel: t('pl.delete') }))) return;
    try { await api(`/polls/${p.id}`, 'DELETE'); await load(); } catch (err) { fail(err); }
  };

  return (
    <>
      <Section title={t('pl.new')} description={t('pl.newHelp')}>
        <form onSubmit={(e) => void create(e)} className="space-y-3">
          <div>
            <label htmlFor="poll-q" className="label">{t('pl.question')}</label>
            <input id="poll-q" className="input" value={question} maxLength={200} onChange={(e) => setQuestion(e.target.value)} required />
          </div>
          <div>
            <span className="label">{t('pl.options')}</span>
            <div className="space-y-2">
              {options.map((o, i) => (
                <input key={i} className="input" aria-label={t('pl.optionN', { n: i + 1 })} value={o} maxLength={80} onChange={(e) => setOptions(options.map((x, k) => (k === i ? e.target.value : x)))} />
              ))}
            </div>
            {options.length < 10 && <button type="button" className="btn-link mt-2" onClick={() => setOptions([...options, ''])}>{t('pl.addOption')}</button>}
          </div>
          <div>
            <label htmlFor="poll-until" className="label">{t('pl.until2')}</label>
            <input id="poll-until" className="input" type="datetime-local" value={until} onChange={(e) => setUntil(e.target.value)} />
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-3">
              <span className="font-black">{channelId ? t('pl.channel', { id: channelId }) : t('pl.noChannel')}</span>
              <button type="button" className="btn btn-soft btn-sm" onClick={() => setPicking((v) => !v)} aria-expanded={picking}>{t('pl.pick')}</button>
              {channelId && <button type="button" className="btn-link text-sm" onClick={() => setChannelId('')}>{t('pl.noPost')}</button>}
            </div>
            {picking && <div className="mt-3"><ChannelPicker id="poll-channel" value={channelId} onChange={(v) => { if (/^\d{15,25}$/.test(v)) { setChannelId(v); setPicking(false); } }} /></div>}
          </div>
          <ErrorLine text={error} />
          <Button loading={busy}>{t('pl.create')}</Button>
        </form>
      </Section>
      <Section title={t('pl.list')}>
        {polls && polls.length === 0 && <p className="font-semibold text-mute">{t('pl.none')}</p>}
        <div className="divide-y divide-line">
          {polls?.map((p) => (
            <div key={p.id}>
              <PollBlock poll={p} onChange={(x) => setPolls((cur) => cur?.map((y) => (y.id === x.id ? x : y)) ?? cur)} />
              <div className="flex gap-4 pb-3">
                {!p.closed && <button type="button" className="btn-link" onClick={() => void close(p)}>{t('pl.close')}</button>}
                <button type="button" className="btn-link text-bad" onClick={() => void remove(p)}>{t('pl.delete')}</button>
              </div>
            </div>
          ))}
        </div>
      </Section>
    </>
  );
}
