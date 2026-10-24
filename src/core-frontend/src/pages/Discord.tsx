import { useEffect, useRef, useState, type FormEvent } from 'react';
import { api, type Binding, type BotStatus, type DiscordGuild, type Server, type SettingsInfo } from '../api';
import { DiscordWizard, computeWizard } from '../components/DiscordWizard';
import DeliveryList from '../components/DeliveryList';
import DiscordExtras from '../components/DiscordExtras';
import PlayersShownCard from '../components/PlayersShownCard';
import { DiscordArt } from '../components/Illustrations';
import { confirmDialog } from '../confirm';
import { Button, Empty, ErrorLine, Field, LoadError, GameAvatar, GoLink, plural, IconDiscord, IconEdit, IconPause, IconPlay, IconTrash, InviteButton, Modal, Notice, PageHead, Strip, Switch, AdminPage, ago, toast, undoable, usePoll, navigate } from '../ui';
import { BotPill } from './Settings';
import { MissingNote } from '../components/ChannelPicker';
import EmbedPreview from './EmbedPreview';

type Style = 'embed' | 'card' | 'both';
interface Draft { id?: number; serverId: number; /** more servers shown in the same message (the main one is serverId) */ extraServerIds?: number[]; channelId: string; intervalSec: number; enabled: boolean; style: Style }

/** the sub-route: «new» opens an empty binding form, «new/<serverId>» opens it with that server chosen */
export default function DiscordPage({ sub = '' }: { sub?: string }) {
  const [servers, setServers] = useState<Server[]>([]);
  const [bindings, setBindings] = useState<Binding[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState('');
  const [settings, setSettings] = useState<SettingsInfo | null>(null);
  const [bot, setBot] = useState<BotStatus | null>(null);
  const [guilds, setGuilds] = useState<DiscordGuild[]>([]);
  const [rechecking, setRechecking] = useState(false);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [picked, setPicked] = useState<number[]>([]);
  // bindings removed with «Отменить» pending: hidden here until the request is really sent
  const [hidden, setHidden] = useState<number[]>([]);

  const load = () =>
    Promise.all([
      api<Server[]>('/servers'),
      api<Binding[]>('/bindings'),
      api<SettingsInfo>('/settings'),
      api<BotStatus>('/bot/status'),
      // the channel list is only for the setup wizard: a failure here is not a page error
      api<DiscordGuild[]>('/discord/channels').catch(() => [] as DiscordGuild[]),
    ])
      .then(([s, b, st, bs, g]) => { setServers(s); setBindings(b); setSettings(st); setBot(bs); setGuilds(Array.isArray(g) ? g : []); })
      .catch((e) => setError(e.message))
      .finally(() => setLoaded(true));
  usePoll(load, 15_000);

  // /admin/discord/new[/<serverId>]: open the form once the servers are known
  const openedFor = useRef('');
  useEffect(() => {
    if (!sub.startsWith('new')) { openedFor.current = ''; return; }
    if (!loaded || openedFor.current === sub || servers.length === 0) return;
    openedFor.current = sub;
    const want = Number(sub.split('/')[1]);
    const target = servers.find((x) => x.id === want) ?? servers[0];
    setDraft({ serverId: target.id, channelId: '', intervalSec: 60, enabled: true, style: 'embed' });
  }, [sub, loaded, servers]);
  const closeDraft = () => {
    setDraft(null);
    if (sub.startsWith('new')) navigate('/admin/discord');
  };

  const server = (id: number) => servers.find((s) => s.id === id);
  const shown = bindings.filter((b) => !hidden.includes(b.id));

  // a binding is easy to create again and the Discord message stays, so it goes away at once and can be taken back for 6 s
  const removeMany = (ids: number[], text: string) => {
    setHidden((h) => [...h, ...ids]);
    setPicked((p) => p.filter((x) => !ids.includes(x)));
    undoable({
      text,
      restore: () => setHidden((h) => h.filter((x) => !ids.includes(x))),
      commit: async () => {
        try {
          if (ids.length === 1) await api(`/bindings/${ids[0]}`, 'DELETE');
          else await api('/bindings/bulk', 'POST', { ids, action: 'delete' });
        } catch (e) {
          setError((e as Error).message);
          toast('Не удалось удалить привязку', 'err');
        }
        setHidden((h) => h.filter((x) => !ids.includes(x)));
        load();
      },
    });
  };
  const remove = (b: Binding) => removeMany([b.id], 'Привязка удалена');

  const bulk = async (action: 'pause' | 'resume' | 'delete') => {
    if (action === 'delete') {
      removeMany(picked, `Удалено привязок: ${picked.length}`);
      return;
    }
    await api('/bindings/bulk', 'POST', { ids: picked, action })
      .then(() => toast(action === 'pause' ? 'Поставлены на паузу' : 'Включены'))
      .catch((e: Error) => setError(e.message));
    setPicked([]);
    load();
  };
  const pick = (id: number) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));

  const toggle = async (b: Binding) => {
    await api(`/bindings/${b.id}`, 'PUT', { serverId: b.serverId, extraServerIds: (b.serverIds ?? []).slice(1), channelId: b.channelId, intervalSec: b.intervalSec, enabled: !b.enabled, style: b.style }).catch((e) => setError(e.message));
    load();
  };

  const wizard = computeWizard({ tokenSet: !!settings?.discordTokenSet, bot, guilds, bindings, serverCount: servers.length });
  const recheck = async () => {
    setRechecking(true);
    await load();
    setRechecking(false);
  };
  const newDraft = () => { if (servers.length > 0) setDraft({ serverId: servers[0].id, channelId: '', intervalSec: 60, enabled: true, style: 'embed' }); };

  return (
    <AdminPage
      head={(
        <PageHead
          icon={<IconDiscord />}
          title="Discord"
          subtitle="Куда бот публикует состояние серверов"
          hint="Привязка = «этот сервер показывать в этом канале». Бот отправит одно сообщение и будет обновлять его само. В одном сообщении можно показать сразу несколько серверов."
          help={<p>Выберите главный игровой сервер и канал Discord. Если серверов несколько, отметьте остальные: все они появятся в одном сообщении (до 10). Сообщение можно оформить карточкой, картинкой или обеими способами. Привязку можно поставить на паузу, не удаляя сообщение в Discord.</p>}
        >
          <button data-tour="bind-channel" className="btn" disabled={servers.length === 0} onClick={() => setDraft({ serverId: servers[0].id, channelId: '', intervalSec: 60, enabled: true, style: 'embed' })}>+ Привязать канал</button>
        </PageHead>
      )}
    >
      {error && servers.length === 0 && bindings.length === 0 && !settings ? <LoadError error={error} onRetry={() => void load()} /> : <ErrorLine text={error} />}
      {loaded && settings && !settings.discordTokenSet && (
        <Notice action={<GoLink href="/admin/settings/bot">Указать токен в настройках</GoLink>}>
          Бот не подключён: без токена он не сможет писать в Discord.
        </Notice>
      )}
      {loaded && servers.length === 0 && (
        <Notice tone="info" action={<GoLink href="/admin/servers/new">Добавить сервер</GoLink>}>
          Сначала добавьте сервер: привязывать пока нечего.
        </Notice>
      )}

      <Strip>
        <div className="flex items-center gap-3">
          <span className="font-black">Бот</span>
          <BotPill status={bot} tokenSet={!!settings?.discordTokenSet} />
        </div>
        {settings?.discordTokenSet && bot?.state === 'online' && typeof bot.guildCount === 'number' && (
          <span className="text-sm font-bold text-mute">
            Серверов Discord: {bot.guildCount}
            {bot.guildCount > 0 ? ` · каналов для публикации: ${bot.channelCount ?? 0}` : ''}
          </span>
        )}
        {settings?.discordTokenSet && <InviteButton url={bot?.inviteUrl ?? null} className="btn-soft btn-sm" />}
        {settings?.discordTokenSet && bot?.state === 'error' && bot.error && <p className="w-full text-sm font-bold text-bad">{bot.error}</p>}
      </Strip>

      {settings?.discordTokenSet && bot?.state === 'online' && bot.guildCount === 0 && (
        <Notice
          tone="warn"
          action={bot.inviteUrl ? <a className="btn btn-sm" href={bot.inviteUrl} target="_blank" rel="noreferrer">Пригласить бота<span aria-hidden>↗</span></a> : undefined}
        >
          Бот в сети, но не добавлен ни на один сервер Discord (его могли исключить). Сообщения не публикуются, команды не работают. Пригласите бота заново по ссылке.
        </Notice>
      )}

      {settings?.discordTokenSet && bot?.state === 'online' && (
        <div className="panel space-y-2 p-5">
          <h2 className="text-lg font-black">Команды бота</h2>
          {bot.commands === 0 && (
            <Notice tone="info" action={bot.inviteUrl ? <a className="btn btn-sm" href={bot.inviteUrl} target="_blank" rel="noreferrer">Пригласить бота<span aria-hidden>↗</span></a> : undefined}>
              Команды ещё не зарегистрированы. Переприглашите бота со ссылкой ниже, чтобы работали команды /register.
            </Notice>
          )}
          <ul className="space-y-1.5">
            {(bot.commandList ?? []).map((c) => (
              <li key={c.name} className="text-sm">
                <code className="font-black">{c.name}</code> <span className="font-semibold text-mute">{c.description}</span>
              </li>
            ))}
          </ul>
          {bot.inviteUrl && (
            <p className="text-sm font-semibold text-mute">
              Команды работают, если бот приглашён со ссылкой с правом «applications.commands»: <a className="btn-link" href={bot.inviteUrl} target="_blank" rel="noreferrer">ссылка-приглашение</a>.
            </p>
          )}
        </div>
      )}

      {loaded && settings && (!wizard.complete || wizardOpen) && (
        <DiscordWizard
          input={{ tokenSet: !!settings.discordTokenSet, bot, guilds, bindings, serverCount: servers.length }}
          busy={rechecking}
          onRecheck={() => void recheck()}
          onCreateBinding={newDraft}
          inviteUrl={bot?.inviteUrl ?? null}
          onClose={wizard.complete ? () => setWizardOpen(false) : undefined}
        />
      )}
      {loaded && settings && wizard.complete && !wizardOpen && (
        <p className="text-sm font-bold"><button type="button" className="btn-link" onClick={() => setWizardOpen(true)}>Мастер подключения</button></p>
      )}

      {!loaded && <div className="skeleton panel h-64" aria-busy="true" aria-label="Загрузка" />}

      {loaded && settings && shown.length === 0 && (
        <Empty art={<DiscordArt />} title="Каналов пока нет" text="Привяжите канал, и бот опубликует там карточку выбранного сервера.">
          {servers.length > 0
            ? <button className="btn mt-3" onClick={() => setDraft({ serverId: servers[0].id, channelId: '', intervalSec: 60, enabled: true, style: 'embed' })}>+ Привязать канал</button>
            : <a className="btn mt-3" href="/admin/servers/new">Сначала добавьте сервер</a>}
        </Empty>
      )}

      {shown.length > 1 && (
        <div className="flex flex-wrap items-center gap-2 rounded-ui-lg bg-soft px-4 py-2.5">
          <label className="flex items-center gap-2 font-bold">
            <input type="checkbox" className="h-4 w-4 accent-brand" checked={picked.length === shown.length} onChange={(e) => setPicked(e.target.checked ? shown.map((b) => b.id) : [])} />
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
        {shown.map((b) => {
          const s = server(b.serverId);
          return (
            <div key={b.id} className={`panel min-w-0 space-y-3 p-5 ${picked.includes(b.id) ? 'ring-2 ring-brand/60' : ''}`}>
              <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 items-center gap-3">
                  {shown.length > 1 && <input type="checkbox" className="h-4 w-4 shrink-0 accent-brand" checked={picked.includes(b.id)} onChange={() => pick(b.id)} aria-label="Выбрать привязку" />}
                  {s && <GameAvatar game={s.game} size={40} />}
                  <div className="min-w-0">
                    <div className="line-clamp-2 wrap-break-word font-black leading-tight" title={s?.name}>{s?.name ?? `Сервер #${b.serverId}`}</div>
                    <div className="truncate text-sm font-bold text-mute" title={`ID канала ${b.channelId}`}>
                      {b.channelName ? `# ${b.channelName}${b.guildName ? ` · ${b.guildName}` : ''}` : `Канал ${b.channelId}`}
                    </div>
                  </div>
                </div>
                {!b.enabled ? <span className="pill pill-mute">ПАУЗА</span> : b.lastError ? <span className="pill pill-bad">ОШИБКА</span> : b.lastUpdate ? <span className="pill pill-ok">РАБОТАЕТ</span> : <span className="pill pill-warn">ОЖИДАНИЕ</span>}
              </div>

              {(b.serverIds ?? []).length > 1 && (
                <div className="flex flex-wrap items-center gap-2 rounded-2xl bg-soft px-3 py-2">
                  <span className="flex -space-x-2">
                    {(b.serverIds ?? []).slice(0, 5).map((id) => {
                      const x = server(id);
                      return x ? <span key={id} className="rounded-xl ring-2 ring-[rgb(var(--soft))]" title={x.name}><GameAvatar game={x.game} size={28} /></span> : null;
                    })}
                  </span>
                  <span className="min-w-0 text-sm font-extrabold text-mute">
                    {(b.serverIds ?? []).length} {plural((b.serverIds ?? []).length, ['сервер', 'сервера', 'серверов'])} в одном сообщении
                  </span>
                </div>
              )}
              {b.style !== 'card' && <EmbedPreview serverId={b.serverId} intervalSec={b.intervalSec} />}
              {b.style !== 'card' && (b.serverIds ?? []).length > 1 && (
                <p className="-mt-1 text-sm font-semibold text-mute">В предпросмотре показан первый сервер, остальные идут следом в том же сообщении.</p>
              )}
              {b.style !== 'embed' && (
                <img
                  src={`/api/card/${b.serverId}.png?v=${s?.updatedAt ?? 0}`}
                  alt={`Карточка: ${s?.name ?? ''}`}
                  loading="lazy"
                  className="aspect-5/2 w-full rounded-2xl bg-soft object-cover"
                />
              )}

              {b.lastError && b.enabled && <p className="rounded-xl bg-badbg px-3 py-2 text-sm font-bold text-bad">{b.lastError}</p>}
              <div className="flex justify-between text-sm font-bold text-mute">
                <span>Каждые {b.intervalSec} с</span>
                <span>Обновлено: {ago(b.lastUpdate)}</span>
              </div>
              <div className="flex items-center justify-end gap-1.5" role="group" aria-label="Действия с привязкой">
                <button type="button" className="row-act" title={b.enabled ? 'Поставить на паузу' : 'Включить'} aria-label={b.enabled ? 'Поставить на паузу' : 'Включить'} onClick={() => void toggle(b)}>
                  {b.enabled ? <IconPause /> : <IconPlay />}
                </button>
                <button type="button" className="row-act" title="Изменить" aria-label="Изменить" onClick={() => setDraft({ id: b.id, serverId: b.serverId, extraServerIds: (b.serverIds ?? []).slice(1), channelId: b.channelId, intervalSec: b.intervalSec, enabled: b.enabled, style: b.style })}>
                  <IconEdit />
                </button>
                <button type="button" className="row-act row-act-danger" title="Удалить" aria-label="Удалить" onClick={() => void remove(b)}>
                  <IconTrash />
                </button>
              </div>
            </div>
          );
        })}
      </div>

      <PlayersShownCard />
      {loaded && <DiscordExtras servers={servers} />}
      <DeliveryList />

      {draft && (
        <BindingForm
          servers={servers}
          initial={draft}
          onClose={closeDraft}
          onSaved={(url) => {
            const first = bindings.length === 0 && !draft.id;
            closeDraft();
            if (first && url) toast('Привязка сохранена. Бот отправит сообщение в течение минуты', 'ok', undefined, { label: 'Открыть канал в Discord', href: url });
            else toast('Привязка сохранена');
            void load();
          }}
        />
      )}
    </AdminPage>
  );
}

function BindingForm({ servers, initial, onClose, onSaved }: { servers: Server[]; initial: Draft; onClose: () => void; onSaved: (channelUrl?: string) => void }) {
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

  const extras = (f.extraServerIds ?? []).filter((x) => x !== f.serverId && servers.some((s) => s.id === x));
  const others = servers.filter((s) => s.id !== f.serverId);
  const hasList = !!guilds && guilds.length > 0;
  const guild = guilds?.find((g) => g.id === guildId);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!/^\d{15,25}$/.test(f.channelId)) return setError('Выберите канал из списка или введите его ID');
    setBusy(true);
    setError('');
    const { id, ...rest } = f;
    const body = { ...rest, extraServerIds: extras };
    try {
      await api(id ? `/bindings/${id}` : '/bindings', id ? 'PUT' : 'POST', body);
      // a link to the channel is known only when it was picked from the bot's own list (then the Discord server id is known)
      const picked = !manual && guild?.channels.some((c) => c.id === f.channelId);
      onSaved(picked && guild ? `https://discord.com/channels/${guild.id}/${f.channelId}` : undefined);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  return (
    <Modal title={f.id ? 'Изменить привязку' : 'Новая привязка'} onClose={onClose}>
      <form onSubmit={submit} className="space-y-3.5">
        <Field label="Сервер">
          <select id="bind-server" className="input" value={f.serverId} onChange={(e) => setF({ ...f, serverId: Number(e.target.value), extraServerIds: extras.filter((x) => x !== Number(e.target.value)) })}>
            {servers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </Field>
        {others.length > 0 && (
          <fieldset className="space-y-2">
            <legend className="label">Показать в этом же сообщении ещё серверы</legend>
            <div className="max-h-48 space-y-1 overflow-y-auto rounded-2xl bg-soft p-2">
              {others.map((s) => {
                const on = extras.includes(s.id);
                const full = !on && extras.length >= 9;
                return (
                  <label key={s.id} className={`flex min-h-[44px] cursor-pointer items-center gap-3 rounded-xl px-2 py-1.5 hover:bg-card ${full ? 'opacity-50' : ''}`}>
                    <input
                      type="checkbox"
                      className="h-4 w-4 shrink-0 accent-brand"
                      checked={on}
                      disabled={full}
                      onChange={(e) => setF({ ...f, extraServerIds: e.target.checked ? [...extras, s.id] : extras.filter((x) => x !== s.id) })}
                    />
                    <GameAvatar game={s.game} size={28} />
                    <span className="min-w-0 flex-1 truncate font-bold">{s.name}</span>
                  </label>
                );
              })}
            </div>
            <p className="text-sm font-semibold text-mute">Все выбранные серверы будут в одном сообщении. Максимум 10.</p>
          </fieldset>
        )}

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
              <button type="button" className="btn-link" onClick={() => setManual(true)}>Ввести ID канала вручную</button>
              <button type="button" className="btn-link" onClick={refresh} disabled={refreshing}>{refreshing ? 'Обновляю…' : 'Обновить список'}</button>
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
              {hasList && <button type="button" className="btn-link" onClick={() => setManual(false)}>Выбрать из списка</button>}
              <button type="button" className="btn-link" onClick={refresh} disabled={refreshing}>{refreshing ? 'Обновляю…' : 'Обновить список'}</button>
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
        <label className="flex items-center gap-3 font-bold text-mute">
          <Switch id="bind-enabled" checked={f.enabled} onChange={(on) => setF({ ...f, enabled: on })} /> Включена
        </label>
        <ErrorLine text={error} />
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" className="btn btn-ghost" onClick={onClose}>Отмена</button>
          <Button loading={busy}>Сохранить</Button>
        </div>
      </form>
    </Modal>
  );
}
