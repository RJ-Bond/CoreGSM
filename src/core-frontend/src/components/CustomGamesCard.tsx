import { useEffect, useState } from 'react';
import { api } from '../api';
import { loadGameProfiles, resetGameProfiles } from '../gameProfiles';
import { t, useI18n } from '../i18n';
import { Button, Section, fail, toast } from '../ui';

interface Item { file: string; profile: { id: string; label: string; defaultPort: number } | null; errors: string[] }
interface Data { template: unknown; items: Item[] }

/** «Свои игры»: a game described in a JSON file appears in the list of games without changing the panel's code. */
export default function CustomGamesCard() {
  useI18n();
  const [data, setData] = useState<Data | null>(null);
  const [text, setText] = useState('');
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const reload = (items?: Item[]) => {
    resetGameProfiles();
    void loadGameProfiles();
    if (items) setData((d) => (d ? { ...d, items } : d));
  };
  useEffect(() => {
    let alive = true;
    api<Data>('/admin/games/custom').then((r) => { if (alive) setData(r); }).catch(() => undefined);
    return () => { alive = false; };
  }, []);
  if (!data) return null;

  const save = async () => {
    setBusy(true);
    setErrors([]);
    try {
      const r = await api<{ items: Item[] }>('/admin/games/custom', 'PUT', { text });
      reload(r.items);
      setText('');
      toast(t('cg.saved'));
    } catch (e) {
      const list = (e as { data?: { errors?: unknown } }).data?.errors;
      if (Array.isArray(list) && list.length) setErrors(list.map(String));
      else fail(e);
    } finally {
      setBusy(false);
    }
  };
  const remove = async (id: string) => {
    try {
      const r = await api<{ items: Item[] }>(`/admin/games/custom/${encodeURIComponent(id)}`, 'DELETE');
      reload(r.items);
    } catch (e) {
      fail(e);
    }
  };

  return (
    <Section title={t('cg.title')}>
      <p className="mb-3 text-sm font-semibold text-mute">{t('cg.help')}</p>
      {data.items.length > 0 && (
        <ul className="mb-3 divide-y divide-line">
          {data.items.map((it) => (
            <li key={it.file} className="flex items-start justify-between gap-3 py-2">
              <div className="min-w-0">
                <div className="font-black">{it.profile ? `${it.profile.label} · ${it.profile.id}` : it.file}</div>
                {it.errors.map((m, i) => <p key={i} className="text-sm font-semibold text-bad">{m}</p>)}
              </div>
              {it.profile && <button type="button" className="btn-link text-bad" onClick={() => void remove(it.profile!.id)}>{t('cg.remove')}</button>}
            </li>
          ))}
        </ul>
      )}
      <label htmlFor="cg-text" className="label">{t('cg.file')}</label>
      <textarea id="cg-text" className="input min-h-40 font-mono text-sm" spellCheck={false} value={text} onChange={(e) => setText(e.target.value)} placeholder={JSON.stringify(data.template, null, 2)} />
      {errors.length > 0 && (
        <ul className="mt-2 space-y-1" role="alert">
          {errors.map((m, i) => <li key={i} className="text-sm font-bold text-bad">{m}</li>)}
        </ul>
      )}
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <Button type="button" loading={busy} disabled={!text.trim()} onClick={() => void save()}>{t('cg.add')}</Button>
        <button type="button" className="btn-link" onClick={() => setText(JSON.stringify(data.template, null, 2))}>{t('cg.template')}</button>
      </div>
      <p className="mt-2 text-sm font-semibold text-mute">{t('cg.note')}</p>
    </Section>
  );
}
