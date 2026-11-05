import { useEffect, useState } from 'react';
import { api } from '../api';
import { t } from '../i18n';
import { Button, Section, Switch, fail, toast } from '../ui';

interface Item { id: number; title: string; keywords: string[]; answer: string; hits: number }
interface Data { enabled: boolean; items: Item[] }
const EMPTY = { id: 0, title: '', keywords: '', answer: '' };

/** answers to frequent questions: /faq in Discord and the reply when somebody mentions the bot with a question */
export default function FaqCard() {
  const [d, setD] = useState<Data | null>(null);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState<typeof EMPTY | null>(null);

  useEffect(() => {
    let alive = true;
    api<Data>('/faq').then((r) => { if (alive) setD(r); }).catch(() => undefined);
    return () => { alive = false; };
  }, []);
  if (!d) return null;

  const run = async (f: () => Promise<Data>, ok?: string) => {
    setBusy(true);
    try {
      setD(await f());
      if (ok) toast(ok);
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };

  const submit = async () => {
    if (!form) return;
    const body = { title: form.title, keywords: form.keywords, answer: form.answer };
    await run(() => (form.id ? api<Data>(`/faq/${form.id}`, 'PUT', body) : api<Data>('/faq', 'POST', body)), t('faq.saved'));
    setForm(null);
  };
  const valid = !!form && form.title.trim().length >= 2 && form.answer.trim().length >= 2;

  return (
    <Section title={t('faq.title')}>
      <p className="mb-3 text-sm font-semibold text-mute">{t('faq.help')}</p>
      <label className="mb-4 flex items-center gap-3 font-bold">
        <Switch id="faq-on" checked={d.enabled} onChange={(on) => void run(() => api<Data>('/settings/faq', 'PUT', { enabled: on }), t('faq.saved'))} /> {t('faq.on')}
      </label>
      {d.items.length === 0 && !form && <p className="mb-3 text-sm font-semibold text-mute">{t('faq.empty')}</p>}
      <ul className="mb-3 grid gap-2">
        {d.items.map((e) => (
          <li key={e.id} className="rounded-xl border border-line p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <b>{e.title}</b>
              <span className="flex gap-2">
                <button type="button" className="btn btn-soft btn-sm" onClick={() => setForm({ id: e.id, title: e.title, keywords: e.keywords.join(', '), answer: e.answer })}>{t('adm.tbl.edit')}</button>
                <button type="button" className="btn btn-soft btn-sm" disabled={busy} onClick={() => void run(() => api<Data>(`/faq/${e.id}`, 'DELETE'), t('faq.deleted'))}>{t('ann.delete')}</button>
              </span>
            </div>
            <p className="mt-1 line-clamp-2 text-sm font-semibold text-mute">{e.answer}</p>
            <p className="mt-1 text-xs font-semibold text-mute">{e.keywords.join(' · ') || t('faq.noKeys')} · {t('faq.hits', { n: e.hits })}</p>
          </li>
        ))}
      </ul>
      {form ? (
        <div className="grid gap-3">
          <div>
            <label htmlFor="faq-title" className="label">{t('faq.q')}</label>
            <input id="faq-title" className="input w-full" maxLength={100} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
          </div>
          <div>
            <label htmlFor="faq-keys" className="label">{t('faq.keys')}</label>
            <input id="faq-keys" className="input w-full" maxLength={1000} placeholder={t('faq.keysHint')} value={form.keywords} onChange={(e) => setForm({ ...form, keywords: e.target.value })} />
          </div>
          <div>
            <label htmlFor="faq-answer" className="label">{t('faq.a')}</label>
            <textarea id="faq-answer" className="input min-h-28 w-full" maxLength={1500} value={form.answer} onChange={(e) => setForm({ ...form, answer: e.target.value })} />
          </div>
          <div className="flex gap-2">
            <Button type="button" loading={busy} disabled={!valid} onClick={() => void submit()}>{t('common.save')}</Button>
            <button type="button" className="btn btn-soft" onClick={() => setForm(null)}>{t('common.cancel')}</button>
          </div>
        </div>
      ) : (
        <button type="button" className="btn btn-soft" onClick={() => setForm({ ...EMPTY })}>{t('faq.add')}</button>
      )}
    </Section>
  );
}
