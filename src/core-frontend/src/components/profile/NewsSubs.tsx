/** Profile: which rubrics of the news the account wants to hear about (the bell, the devices and Discord). */
import { useEffect, useState } from 'react';
import { api, type NewsCategory } from '../../api';
import { ErrorLine, Section, toast } from '../../ui';
import { categoryLabel } from '../news/NewsParts';

const RUBRICS: NewsCategory[] = ['announcement', 'wipe', 'update', 'event', 'maintenance', 'other'];

export function NewsSubsCard() {
  const [picked, setPicked] = useState<NewsCategory[] | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    api<{ categories: NewsCategory[] }>('/me/news-subscriptions').then((r) => setPicked(r.categories)).catch((e: Error) => setError(e.message));
  }, []);
  const save = async (next: NewsCategory[]) => {
    const before = picked;
    setPicked(next);
    setError('');
    try {
      const r = await api<{ categories: NewsCategory[] }>('/me/news-subscriptions', 'PUT', { categories: next });
      setPicked(r.categories);
      toast(r.categories.length ? 'Подписка на новости сохранена' : 'Подписка на новости выключена');
    } catch (e) {
      setPicked(before);
      setError((e as Error).message);
    }
  };
  const flip = (c: NewsCategory) => void save(picked?.includes(c) ? picked.filter((x) => x !== c) : [...(picked ?? []), c]);
  const all = picked?.length === RUBRICS.length;
  return (
    <Section title="Новости" description="О каких новостях сообщать: уведомление придёт в колокольчик, на устройства с включёнными уведомлениями и в личные сообщения Discord (если привязан).">
      <ErrorLine text={error} />
      {picked === null ? <div className="skeleton h-20 rounded-2xl" /> : (
        <div className="grid gap-2">
          <label className="flex cursor-pointer items-center gap-2.5 font-extrabold">
            <input type="checkbox" className="h-4 w-4 accent-brand" checked={all} onChange={() => void save(all ? [] : [...RUBRICS])} />
            Все рубрики
          </label>
          <div className="grid gap-1.5 sm:grid-cols-2">
            {RUBRICS.map((c) => (
              <label key={c} className="flex cursor-pointer items-center gap-2.5 font-bold">
                <input type="checkbox" className="h-4 w-4 accent-brand" checked={picked.includes(c)} onChange={() => flip(c)} />
                {categoryLabel(c)}
              </label>
            ))}
          </div>
        </div>
      )}
    </Section>
  );
}
