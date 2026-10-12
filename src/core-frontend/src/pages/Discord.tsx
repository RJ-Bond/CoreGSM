import { useEffect, useState, type FormEvent } from 'react';
import { api, type Binding, type BotStatus, type DiscordGuild, type Server, type SettingsInfo } from '../api';
import { DiscordArt } from '../components/Illustrations';
import { confirmDialog } from '../confirm';
import { Empty, ErrorLine, Field, GameAvatar, IconDiscord, InviteButton, Modal, PageHead, ago, toast, usePoll } from '../ui';
import { BotPill } from './Settings';
import { MissingNote } from '../components/ChannelPicker';
import EmbedPreview from './EmbedPreview';

type Style = 'embed' | 'card' | 'both';
interface Draft { id?: number; serverId: number; channelId: string; intervalSec: number; enabled: boolean; style: Style }

export default function DiscordPage() {
  const [servers, setServers] = useState<Server[]>([]);
  const [bindings, setBindings] = useState<Binding[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState('');
  const [settings, setSettings] = useState<SettingsInfo | null>(null);
  const [bot, setBot] = useState<BotStatus | null>(null);
  const [picked, setPicked] = useState<number[]>([]);

  const load = () =>
    Promise.all([api<Server[]>('/servers'), api<Binding[]>('/bindings'), api<SettingsInfo>('/settings'), api<BotStatus>('/bot/status')])
      .then(([s, b, st, bs]) => { setServers(s); setBindings(b); setSettings(st); setBot(bs); })
      .catch((e) => setError(e.message))
      .finally(() => setLoaded(true));
  usePoll(load, 15_000);

  const server = (id: number) => servers.find((s) => s.id === id);
  const working = bindings.some((b) => b.enabled && b.lastUpdate && !b.lastError);

  const remove = async (b: Binding) => {
    const ok = await confirmDialog({ title: 'Удалить привязку?', text: 'Сообщение в Discord останется, но обновляться перестанет.', confirmLabel: 'Удалить', danger: true });
    if (!ok) return;
    await api(`/bindings/${b.id}`, 'DELETE').then(() => toast('Привязка удалена')).catch((e) => setError(e.message));
    load();
  };

  const bulk = async (action: 'pause' | 'resume' | 'delete') => {
    if (action === 'delete') {
      const ok = await confirmDialog({ title: `Удалить привязок: ${picked.length}?`, text: 'Сообщения в Discord останутся, но обновляться перестанут.', confirmLabel: 'Удалить', danger: true });
      if (!ok) return;
    }
    await api('/bindings/bulk', 'POST', { ids: picked, action })
      .then(() => toast(action === 'delete' ? 'Привязки удалены' : action === 'pause' ? 'Поставлены на паузу' : 'Включены'))
      .catch((e: Error) => setError(e.message));
    setPicked([]);
    load();
  };
  const pick = (id: number) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));

  const toggle = async (b: Binding) => {
    await api(`/bindings/${b.id}`, 'PUT', { serverId: b.serverId, channelId: b.channelId, intervalSec: b.intervalSec, enabled: !b.enabled, style: b.style }).catch((e) => setError(e.message));
    load();
  };

  const steps = [
    { done: servers.length > 0, title: 'Добавьте сервер', text: 'На вкладке «Серверы».' },
    { done: bindings.length > 0, title: 'Пригласите бота и привяжите канал', text: 'Кнопка «Пригласить бота на сервер» откроет Discord: выберите сервер и подтвердите права. Затем выберите канал здесь.' },
    { done: working, title: 'Бот отправит карточку', text: 'Одно сообщение, которое потом обновляется по таймеру.' },
  ];
  const allDone = steps.every((s) => s.done);

  return (
    <div className="space-y-6">
      <PageHead icon={<IconDiscord />} title="Discord" subtitle="Куда бот публикует состояние серверов">
        <button data-tour="bind-channel" className="btn" disabled={servers.length === 0} onClick={() => setDraft({ serverId: servers[0].id, channelId: '', intervalSec: 60, enabled: true, style: 'embed' })}>+ Привязать канал</button>
      </PageHead>
      <ErrorLine text={error} />

      <div className="panel flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-5 py-3">
        <div className="flex items-center gap-3">
          <span className="font-black">Бот</span>
          <BotPill status={bot} tokenSet={!!settings?.discordTokenSet} />
        </div>
        {!settings?.discordTokenSet && <a href="#/admin/settings/bot" className="font-extrabold text-link hover:underline">Указать токен в настройках</a>}
        {settings?.discordTokenSet && bot?.state === 'online' && typeof bot.guildCount === 'number' && (
          <span className="text-sm font-bold text-mute">
            Серверов Discord: {bot.guildCount}
            {bot.guildCount > 0 ? ` · каналов для публикации: ${bot.channelCount ?? 0}` : ''}
          </span>
        )}
        {settings?.discordTokenSet && <InviteButton url={bot?.inviteUrl ?? null} className="btn-soft btn-sm" />}
        {settings?.discordTokenSet && bot?.state === 'error' && bot.error && <p className="w-full text-sm font-bold text-bad">{bot.error}</p>}
      </div>

      {!allDone && (
        <ol className="grid gap-3 md:grid-cols-3">
          {steps.map((s, i) => (
            <li key={s.title} className="panel flex gap-3 p-4">
              <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-full font-black ${s.done ? 'bg-okbg text-ok' : 'bg-soft text-mute'}`}>{s.done ? '✓' : i + 1}</span>
              <div>
                <div className="font-black">{s.title}</div>
                <div className="text-sm font-semibold text-mute">{s.text}</div>
              </div>
            </li>
          ))}
        </ol>
      )}

      {loaded && bindings.length === 0 && <Empty art={<DiscordArt />} title="Каналов пока нет" text="Привяжите канал, и бот опубликует там карточку выбранного сервера." />}

      {bindings.length > 1 && (
        <div className="flex flex-wrap items-center gap-2 rounded-2xl bg-soft px-4 py-2.5">
          <label className="flex items-center gap-2 font-bold">
            <input type="checkbox" className="h-4 w-4 accent-brand" checked={picked.length === bindings.length} onChange={(e) => setPicked(e.target.checked ? bindings.map((b) => b.id) : [])} />
            {picked.length ? `Выбрано: ${picked.length}` : 'Выбрать все'}
          </label>
          {picked.length > 0 && (
            <div className="ml-auto flex flex-wrap gap-2">
              <button className="btn btn-soft btn-sm" onClick={() => void bulk('pause')}>Пауза</button>
              <button className="btn btn-soft btn-sm" onClick={() => void bulk('resume')}>Включить</button>
              <button className="btn btn-danger btn-sm" onClick={() => void bulk('delete')}>Удалить</button>
            </div>
          )}
        </div>
      )}

      <div className="grid grid-cols-[minmax(0,1fr)] gap-4 md:grid-cols-2">
        {bindings.map((b) => {
          const s = server(b.serverId);
          return (
            <div key={b.id} className={`panel min-w-0 space-y-3 p-5 ${picked.includes(b.id) ? 'ring-2 ring-brand/60' : ''}`}>
              <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 items-center gap-3">
                  {bindings.length > 1 && <input type="checkbox" className="h-4 w-4 shrink-0 accent-brand" checked={picked.includes(b.id)} onChange={() => pick(b.id)} aria-label="Выбрать привязку" />}
                  {s && <GameAvatar game={s.game} size={40} />}
                  <div className="min-w-0">
                    <div className="line-clamp-2 break-words font-black leading-tight" title={s?.name}>{s?.name ?? `Сервер #${b.serverId}`}</div>
                    <div className="truncate text-sm font-bold text-mute" title={`ID канала ${b.channelId}`}>
                      {b.channelName ? `# ${b.channelName}${b.guildName ? ` · ${b.guildName}` : ''}` : `Канал ${b.channelId}`}
                    </div>
                  </div>
                </div>
                {!b.enabled ? <span className="pill pill-mute">ПАУЗА</span> : b.lastError ? <span className="pill pill-bad">ОШИБКА</span> : b.lastUpdate ? <span className="pill pill-ok">РАБОТАЕТ</span> : <span className="pill pill-warn">ОЖИДАНИЕ</span>}
              </div>

              {b.style !== 'card' && <EmbedPreview serverId={b.serverId} intervalSec={b.intervalSec} />}
              {b.style !== 'embed' && (
                <img
                  src={`/api/card/${b.serverId}.png?v=${s?.updatedAt ?? 0}`}
                  alt={`Карточка: ${s?.name ?? ''}`}
                  loading="lazy"
                  className="aspect-[5/2] w-full rounded-2xl bg-soft object-cover"
                />
              )}

              {b.lastError && b.enabled && <p className="rounded-xl bg-badbg px-3 py-2 text-sm font-bold text-bad">{b.lastError}</p>}
              <div className="flex justify-between text-sm font-bold text-mute">
                <span>Каждые {b.intervalSec} с</span>
                <span>Обновлено: {ago(b.lastUpdate)}</span>
              </div>
              <div className="flex flex-wrap gap-2">
                <button className="btn btn-soft btn-sm" onClick={() => toggle(b)}>{b.enabled ? 'Пауза' : 'Включить'}</button>
                <button className="btn btn-soft btn-sm" onClick={() => setDraft({ id: b.id, serverId: b.serverId, channelId: b.channelId, intervalSec: b.intervalSec, enabled: b.enabled, style: b.style })}>Изменить</button>
                <button className="btn btn-danger btn-sm" onClick={() => remove(b)}>Удалить</button>
              </div>
            </div>
          );
        })}
      </div>

      {draft && <BindingForm servers={servers} initial={draft} onClose={() => setDraft(null)} onSaved={() => { setDraft(null); toast('Привязка сохранена'); load(); }} />}
    </div>
  );
}

function BindingForm({ servers, initial, onClose, onSaved }: { servers: Server[]; initial: Draft; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState(initial);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [guilds, setGuilds] = useState<DiscordGuild[] | null>(null);
  // every Discord server the bot is on, including those where it has no channel to post in
  const [allGuilds, setAllGuilds] = useState<DiscordGuild[]>([]);
  const [guildId, setGuildId] = useState('');
  const [manual, setManual] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  // the bot reports the servers and channels it can post in: pick from the list instead of copying an ID
  const loadChannels = () =>
    api<DiscordGuild[]>('/discord/channels')
      .then((g) => {
        setAllGuilds(g);
        const withChannels = g.filter((x) => x.channels.length > 0);
        setGuilds(withChannels);
        setGuildId((cur) => {
          if (cur && withChannels.some((x) => x.id === cur)) return cur;
          const known = withChannels.find((x) => x.channels.some((c) => c.id === initial.channelId));
          return (known ?? withChannels[0])?.id ?? '';
        });
        if (initial.channelId && !withChannels.some((x) => x.channels.some((c) => c.id === initial.channelId))) setManual(true);
      })
      .catch(() => setGuilds([]));
  useEffect(() => { void loadChannels(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const refresh = async () => { setRefreshing(true); await loadChannels(); setRefreshing(false); };

  const hasList = !!guilds && guilds.length > 0;
  const guild = guilds?.find((g) => g.id === guildId);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!/^\d{15,25}$/.test(f.channelId)) return setError('Выберите канал из списка или введите его ID');
    setBusy(true);
    setError('');
    const { id, ...body } = f;
    try {
      await api(id ? `/bindings/${id}` : '/bindings', id ? 'PUT' : 'POST', body);
      onSaved();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  return (
    <Modal title={f.id ? 'Изменить привязку' : 'Новая привязка'} onClose={onClose}>
      <form onSubmit={submit} className="space-y-3.5">
        <Field label="Сервер">
          <select id="bind-server" className="input" value={f.serverId} onChange={(e) => setF({ ...f, serverId: Number(e.target.value) })}>
            {servers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </Field>

        {hasList && !manual ? (
          <>
            {guilds!.length > 1 && (
              <Field label="Сервер Discord">
                <select id="bind-guild" className="input" value={guildId} onChange={(e) => { setGuildId(e.target.value); setF({ ...f, channelId: '' }); }}>
                  {guilds!.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
                </select>
              </Field>
            )}
            <Field label={guilds!.length === 1 ? `Канал на сервере «${guild?.name ?? ''}»` : 'Канал'}>
              <select id="bind-channel-pick" className="input" value={f.channelId} onChange={(e) => setF({ ...f, channelId: e.target.value })} required>
                <option value="" disabled>Выберите канал…</option>
                {guild?.channels.map((c) => <option key={c.id} value={c.id}>{`# ${c.name}${c.missing?.length ? ' ⚠' : ''}`}</option>)}
              </select>
            </Field>
            <MissingNote guild={guild} channelId={f.channelId} />
            <div className="flex flex-wrap gap-x-4 gap-y-1">
              <button type="button" className="text-sm font-extrabold text-link hover:underline" onClick={() => setManual(true)}>Ввести ID канала вручную</button>
              <button type="button" className="text-sm font-extrabold text-link hover:underline" onClick={refresh} disabled={refreshing}>{refreshing ? 'Обновляю…' : 'Обновить список'}</button>
            </div>
          </>
        ) : (
          <>
            <Field label="ID канала Discord">
              <input id="bind-channel" className="input font-mono" value={f.channelId} onChange={(e) => setF({ ...f, channelId: e.target.value.trim() })} placeholder="123456789012345678" required pattern="\d{15,25}" inputMode="numeric" autoFocus />
            </Field>
            <p className="-mt-2 text-sm font-semibold text-mute">
              {guilds && guilds.length === 0 && allGuilds.length === 0
                ? 'Бот пока не видит ни одного сервера Discord. Пригласите его кнопкой «Пригласить бота на сервер» (на этой странице), затем нажмите «Обновить список». Пока можно ввести ID канала вручную: включите в Discord режим разработчика, нажмите на канал правой кнопкой и выберите «Копировать ID канала».'
                : guilds && guilds.length === 0
                  ? `Бот есть на сервере Discord «${allGuilds.map((g) => g.name).join('», «')}»${allGuilds.some((g) => g.hidden) ? ` и видит ${allGuilds.reduce((n, g) => n + (g.hidden ?? 0), 0)} текстовых каналов`: ''}, но не может писать ни в один из них. Выдайте боту (его роли) права «Просмотр канала», «Отправка сообщений» и «Прикрепление файлов» на нужном канале и нажмите «Обновить список».`
                  : 'Режим разработчика в Discord: нажмите на канал правой кнопкой и выберите «Копировать ID канала».'}
            </p>
            <div className="flex flex-wrap gap-x-4 gap-y-1">
              {hasList && <button type="button" className="text-sm font-extrabold text-link hover:underline" onClick={() => setManual(false)}>Выбрать из списка</button>}
              <button type="button" className="text-sm font-extrabold text-link hover:underline" onClick={refresh} disabled={refreshing}>{refreshing ? 'Обновляю…' : 'Обновить список'}</button>
            </div>
          </>
        )}

        <Field label="Оформление сообщения">
          <select id="bind-style" className="input" value={f.style} onChange={(e) => setF({ ...f, style: e.target.value as Style })}>
            <option value="embed">Embed: цвет, эмодзи, поля (рекомендуется)</option>
            <option value="card">Картинка-карточка</option>
            <option value="both">Embed и картинка</option>
          </select>
        </Field>
        <Field label="Обновлять каждые, секунд (30–3600)">
          <input id="bind-interval" className="input" type="number" min={30} max={3600} value={f.intervalSec} onChange={(e) => setF({ ...f, intervalSec: Number(e.target.value) })} required />
        </Field>
        <label className="flex items-center gap-2 font-bold text-mute">
          <input id="bind-enabled" type="checkbox" className="h-4 w-4 accent-brand" checked={f.enabled} onChange={(e) => setF({ ...f, enabled: e.target.checked })} /> Включена
        </label>
        <ErrorLine text={error} />
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" className="btn btn-soft" onClick={onClose}>Отмена</button>
          <button className="btn" disabled={busy}>Сохранить</button>
        </div>
      </form>
    </Modal>
  );
}
