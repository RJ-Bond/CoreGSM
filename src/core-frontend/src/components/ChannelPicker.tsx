import { useEffect, useState } from 'react';
import { api, type DiscordGuild } from '../api';

/** A warning under the select when the chosen channel lacks soft permissions (embeds/images). */
export function MissingNote({ guild, channelId }: { guild?: DiscordGuild; channelId: string }) {
  const missing = guild?.channels.find((c) => c.id === channelId)?.missing;
  if (!missing?.length) return null;
  return (
    <p className="rounded-xl bg-warnbg px-3 py-2 text-sm font-bold text-warn">
      ⚠ У бота в этом канале нет прав: {missing.join(', ')}. Без «Встраивания ссылок» embed-сообщения могут не показываться, без «Прикрепления файлов» не отправятся картинки. Выдайте эти права роли бота в настройках канала.
    </p>
  );
}

/**
 * Pick a Discord channel by name (the bot reports the servers and channels it can post in),
 * with a manual ID field as a fallback.
 */
export function ChannelPicker({ value, onChange, id = 'channel' }: { value: string; onChange: (channelId: string) => void; id?: string }) {
  const [guilds, setGuilds] = useState<DiscordGuild[] | null>(null);
  const [guildId, setGuildId] = useState('');
  const [manual, setManual] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = () =>
    api<DiscordGuild[]>('/discord/channels')
      .then((g) => {
        const withChannels = g.filter((x) => x.channels.length > 0);
        setGuilds(withChannels);
        setGuildId((cur) => {
          if (cur && withChannels.some((x) => x.id === cur)) return cur;
          return (withChannels.find((x) => x.channels.some((c) => c.id === value)) ?? withChannels[0])?.id ?? '';
        });
        if (value && !withChannels.some((x) => x.channels.some((c) => c.id === value))) setManual(true);
      })
      .catch(() => setGuilds([]));
  useEffect(() => { void load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const refresh = async () => { setBusy(true); await load(); setBusy(false); };
  const hasList = !!guilds && guilds.length > 0;
  const guild = guilds?.find((g) => g.id === guildId);

  if (hasList && !manual) {
    return (
      <div className="space-y-2.5">
        <div className="grid gap-2.5 sm:grid-cols-2">
          {guilds!.length > 1 && (
            <select id={`${id}-guild`} aria-label="Сервер Discord" className="input" value={guildId} onChange={(e) => { setGuildId(e.target.value); onChange(''); }}>
              {guilds!.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
            </select>
          )}
          <select id={id} aria-label="Канал" className={`input ${guilds!.length > 1 ? '' : 'sm:col-span-2'}`} value={value} onChange={(e) => onChange(e.target.value)}>
            <option value="" disabled>Выберите канал…</option>
            {guild?.channels.map((c) => <option key={c.id} value={c.id}>{`# ${c.name}${c.missing?.length ? ' ⚠' : ''}`}</option>)}
          </select>
        </div>
        <MissingNote guild={guild} channelId={value} />
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm font-extrabold">
          <button type="button" className="btn-link" onClick={() => setManual(true)}>Ввести ID вручную</button>
          <button type="button" className="btn-link" onClick={refresh} disabled={busy}>{busy ? 'Обновляю…' : 'Обновить список'}</button>
        </div>
      </div>
    );
  }
  return (
    <div className="space-y-2">
      <input id={id} className="input font-mono" value={value} onChange={(e) => onChange(e.target.value.trim())} placeholder="ID канала, например 123456789012345678" inputMode="numeric" />
      <p className="text-sm font-semibold text-mute">
        {guilds && guilds.length === 0 ? <>Бот пока не видит каналов (его нужно пригласить на сервер Discord): <a href="/admin/discord" className="font-extrabold text-link hover:underline">проверить бота →</a>{' '}</> : ''}
        Режим разработчика в Discord: правая кнопка по каналу → «Копировать ID канала».
      </p>
      <div className="flex gap-4 text-sm font-extrabold">
        {hasList && <button type="button" className="btn-link" onClick={() => setManual(false)}>Выбрать из списка</button>}
        <button type="button" className="btn-link" onClick={refresh} disabled={busy}>{busy ? 'Обновляю…' : 'Обновить список'}</button>
      </div>
    </div>
  );
}
