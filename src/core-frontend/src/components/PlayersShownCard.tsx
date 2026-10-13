import { useEffect, useState } from 'react';
import { api } from '../api';
import { Section, toast } from '../ui';

const OPTIONS = [0, 3, 5, 8, 10, 15, 20];

/** «Ники в сообщении»: how many player names the Discord message lists; the rest is a link to the site. */
export default function PlayersShownCard() {
  const [value, setValue] = useState<number | null>(null);
  const [gone, setGone] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    api<{ playersShown: number }>('/settings/embed')
      .then((r) => { if (alive) setValue(r.playersShown); })
      .catch(() => { if (alive) setGone(true); });
    return () => { alive = false; };
  }, []);

  if (gone || value === null) return null;

  const change = async (n: number) => {
    const prev = value;
    setValue(n);
    setBusy(true);
    try {
      await api('/settings/embed', 'PUT', { playersShown: n });
      toast('Сохранено. Сообщения обновятся при следующем опросе');
    } catch (e) {
      setValue(prev);
      toast((e as Error).message, 'err');
    } finally {
      setBusy(false);
    }
  };

  const options = OPTIONS.includes(value) ? OPTIONS : [...OPTIONS, value].sort((a, b) => a - b);

  return (
    <Section title="Ники в сообщении" description="Сколько игроков перечислять в сообщении Discord. Остальные доступны по кнопке «Все игроки на сайте» и ссылке под списком. Первыми идут те, кто в игре дольше всех.">
      <label htmlFor="players-shown" className="label">Показывать ников</label>
      <select id="players-shown" className="input max-w-[16rem]" value={value} disabled={busy} onChange={(e) => void change(Number(e.target.value))}>
        {options.map((n) => <option key={n} value={n}>{n === 0 ? '0: только счётчик' : String(n)}</option>)}
      </select>
    </Section>
  );
}
