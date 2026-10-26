/** Admin → Оповещения: the weekly digest (settings, the numbers of the coming digest and its picture). */
import { useEffect, useState } from 'react';
import { t as tr, useI18n } from '../i18n';
import { api } from '../api';
import { ChannelPicker } from './ChannelPicker';
import { ErrorLine, Section, Switch, ago, plural, toast } from '../ui';

interface DigestInfo {
  enabled: boolean;
  channelId: string;
  weekday: number;
  hour: number;
  /** the picture: dark or light */
  theme: 'dark' | 'light';
  lastSent: number;
  preview: {
    totals: { players: number; prevPlayers: number; peak: number; peakServer: string | null; hours: number; prevHours: number; uptime: number | null; incidents: number; newPlayers: number };
  };
}

const WEEKDAYS = ['понедельник', 'вторник', 'среду', 'четверг', 'пятницу', 'субботу', 'воскресенье'];

export default function DigestSection({ alertsChannel }: { alertsChannel: string }) {
  useI18n();
  const [info, setInfo] = useState<DigestInfo | null>(null);
  const [error, setError] = useState('');
  const [picking, setPicking] = useState(false);
  const [imgKey, setImgKey] = useState(0);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<DigestInfo>('/digest').then(setInfo).catch((e: Error) => setError(e.message));
  }, []);

  const save = async (patch: Partial<Pick<DigestInfo, 'enabled' | 'channelId' | 'weekday' | 'hour' | 'theme'>>, done?: string) => {
    await api<DigestInfo>('/digest', 'PUT', patch)
      .then((d) => { setInfo(d); setImgKey((k) => k + 1); setError(''); if (done) toast(done); })
      .catch((e: Error) => setError(e.message));
  };
  const sendNow = async () => {
    setBusy(true);
    await api<DigestInfo>('/digest/send', 'POST')
      .then((d) => { setInfo(d); toast('Итоги недели поставлены в очередь: бот отправит их в канал'); })
      .catch((e: Error) => setError(e.message))
      .finally(() => setBusy(false));
  };

  if (!info) return <Section title="Итоги недели">{error ? <ErrorLine text={error} /> : <div className="skeleton h-24 rounded-ui-lg" aria-busy="true" />}</Section>;
  const t = info.preview.totals;
  const channel = info.channelId || alertsChannel;
  return (
    <Section title="Итоги недели" description="Раз в неделю бот публикует картинку с итогами: игроки, пик, часы в игре, доступность серверов и самые активные игроки.">
      <ErrorLine text={error} />
      <div className="adm-split">
      <div className="min-w-0 space-y-4">
      <label className="flex cursor-pointer items-start gap-3">
        <Switch className="mt-0.5" checked={info.enabled} onChange={(on) => void save({ enabled: on }, on ? 'Итоги недели включены' : 'Итоги недели выключены')} />
        <span>
          <span className="block font-extrabold">Публиковать итоги недели</span>
          <span className="block text-sm font-semibold text-mute">
            {channel ? `В ${WEEKDAYS[info.weekday]} в ${String(info.hour).padStart(2, '0')}:00` : 'Нужен канал: выберите его ниже или в настройках оповещений'}
            {info.lastSent ? ` · последний раз ${ago(info.lastSent)}` : ''}
          </span>
        </span>
      </label>

      <div className="grid gap-4 sm:grid-cols-3">
        <div>
          <label htmlFor="digest-day" className="label">День</label>
          <select id="digest-day" className="input" value={info.weekday} onChange={(e) => void save({ weekday: Number(e.target.value) }, 'Сохранено')}>
            {WEEKDAYS.map((d, i) => <option key={d} value={i}>{['Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота', 'Воскресенье'][i]}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="digest-hour" className="label">Время</label>
          <select id="digest-hour" className="input" value={info.hour} onChange={(e) => void save({ hour: Number(e.target.value) }, 'Сохранено')}>
            {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{String(h).padStart(2, '0')}:00</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="digest-theme" className="label">{tr('digest.theme')}</label>
          <select id="digest-theme" className="input" value={info.theme} onChange={(e) => void save({ theme: e.target.value as 'dark' | 'light' }, 'Сохранено')}>
            <option value="dark">{tr('digest.theme.dark')}</option>
            <option value="light">{tr('digest.theme.light')}</option>
          </select>
        </div>
      </div>

      <div>
        <span className="label">Канал</span>
        <div className="flex flex-wrap items-center gap-3">
          <span className="font-black">{info.channelId ? `Канал ${info.channelId}` : alertsChannel ? 'тот же, что для оповещений' : 'не выбран'}</span>
          <button className="btn btn-soft btn-sm" onClick={() => setPicking((v) => !v)} aria-expanded={picking}>Выбрать другой</button>
          {info.channelId && <button className="btn-link text-sm" onClick={() => void save({ channelId: '' }, 'Итоги пойдут в канал оповещений')}>Как у оповещений</button>}
        </div>
        {picking && (
          <div className="mt-3">
            <ChannelPicker id="digest-channel" value={info.channelId} onChange={(v) => { if (/^\d{15,25}$/.test(v)) { void save({ channelId: v }, 'Канал сохранён'); setPicking(false); } }} />
          </div>
        )}
      </div>

      </div>
      <div className="adm-split-side rounded-ui-lg bg-soft p-3">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <span className="text-sm font-extrabold text-mute">Так будут выглядеть итоги последних 7 дней</span>
          <span className="flex flex-wrap gap-2">
            <button className="btn btn-soft btn-sm" onClick={() => setImgKey((k) => k + 1)}>Обновить картинку</button>
            <button className="btn btn-sm" disabled={busy || !channel} onClick={() => void sendNow()}>Отправить сейчас</button>
          </span>
        </div>
        <img key={imgKey} src={`/api/digest/preview.png?k=${imgKey}`} alt={`Итоги недели: ${t.players} ${plural(t.players, ['игрок', 'игрока', 'игроков'])}, пик ${t.peak}, ${t.hours} часов в игре`} className="w-full rounded-ui-lg" loading="lazy" />
      </div>
      </div>
    </Section>
  );
}
