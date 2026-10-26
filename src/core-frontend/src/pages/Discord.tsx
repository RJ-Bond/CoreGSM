import { useEffect, useRef, useState, type FormEvent } from 'react';
import { api, type Binding, type BotStatus, type DiscordGuild, type Server, type SettingsInfo } from '../api';
import { DiscordWizard, computeWizard } from '../components/DiscordWizard';
import DeliveryList from '../components/DeliveryList';
import DiscordExtras from '../components/DiscordExtras';
import PlayersShownCard from '../components/PlayersShownCard';
import { DiscordArt } from '../components/Illustrations';
import { confirmDialog } from '../confirm';
import { t, useI18n } from '../i18n';
import { Button, Empty, ErrorLine, Field, LoadError, GameAvatar, GoLink, IconDiscord, IconEdit, IconPause, IconPlay, IconTrash, InviteButton, Modal, Notice, PageHead, Strip, Switch, AdminPage, ago, toast, undoable, usePoll, navigate } from '../ui';
import { BotPill } from './Settings';
import { MissingNote } from '../components/ChannelPicker';
import EmbedPreview from './EmbedPreview';

type Style = 'embed' | 'card' | 'both';
interface Draft { id?: number; serverId: number; /** more servers shown in the same message (the main one is serverId) */ extraServerIds?: number[]; channelId: string; intervalSec: number; enabled: boolean; style: Style }

/** the sub-route: «new» opens an empty binding form, «new/<serverId>» opens it with that server chosen */
export default function DiscordPage({ sub = '' }: { sub?: string }) {
  useI18n();
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
          toast(t('dc.delFail'), 'err');
        }
        setHidden((h) => h.filter((x) => !ids.includes(x)));
        load();
      },
    });
  };
  const remove = (b: Binding) => removeMany([b.id], t('dc.deleted'));

  const bulk = async (action: 'pause' | 'resume' | 'delete') => {
    if (action === 'delete') {
      removeMany(picked, t('dc.deletedN', { n: picked.length }));
      return;
    }
    await api('/bindings/bulk', 'POST', { ids: picked, action })
      .then(() => toast(action === 'pause' ? t('dc.paused') : t('dc.resumed')))
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
          subtitle={t('dc.sub')}
          hint={t('dc.hint')}
          help={<p>{t('dc.help')}</p>}
        >
          <button data-tour="bind-channel" className="btn" disabled={servers.length === 0} onClick={() => setDraft({ serverId: servers[0].id, channelId: '', intervalSec: 60, enabled: true, style: 'embed' })}>{t('dc.bind')}</button>
        </PageHead>
      )}
    >
      {error && servers.length === 0 && bindings.length === 0 && !settings ? <LoadError error={error} onRetry={() => void load()} /> : <ErrorLine text={error} />}
      {loaded && settings && !settings.discordTokenSet && (
        <Notice action={<GoLink href="/admin/settings/bot">{t('dc.setToken')}</GoLink>}>
          {t('dc.noToken')}
        </Notice>
      )}
      {loaded && servers.length === 0 && (
        <Notice tone="info" action={<GoLink href="/admin/servers/new">{t('dc.addServer')}</GoLink>}>
          {t('dc.noServers')}
        </Notice>
      )}

      <Strip>
        <div className="flex items-center gap-3">
          <span className={`dc-ring is-${bot?.state ?? 'idle'}`} aria-hidden title={bot?.tag ?? undefined} />
          <span className="font-black">{t('dc.bot')}</span>
          <BotPill status={bot} tokenSet={!!settings?.discordTokenSet} />
        </div>
        {settings?.discordTokenSet && bot?.state === 'online' && typeof bot.guildCount === 'number' && (
          <span className="text-sm font-bold text-mute">
            {t('dc.guilds', { n: bot.guildCount })}
            {bot.guildCount > 0 ? t('dc.channels', { n: bot.channelCount ?? 0 }) : ''}
          </span>
        )}
        {settings?.discordTokenSet && <InviteButton url={bot?.inviteUrl ?? null} className="btn-soft btn-sm" />}
        {settings?.discordTokenSet && bot?.state === 'error' && bot.error && <p className="w-full text-sm font-bold text-bad">{bot.error}</p>}
      </Strip>

      {settings?.discordTokenSet && bot?.state === 'online' && bot.guildCount === 0 && (
        <Notice
          tone="warn"
          action={bot.inviteUrl ? <a className="btn btn-sm" href={bot.inviteUrl} target="_blank" rel="noreferrer">{t('dc.invite')}<span aria-hidden>↗</span></a> : undefined}
        >
          {t('dc.noGuild')}
        </Notice>
      )}

      {settings?.discordTokenSet && bot?.state === 'online' && (
        <div className="panel space-y-2 p-5">
          <h2 className="text-lg font-black">{t('dc.cmds')}</h2>
          {bot.commands === 0 && (
            <Notice tone="info" action={bot.inviteUrl ? <a className="btn btn-sm" href={bot.inviteUrl} target="_blank" rel="noreferrer">{t('dc.invite')}<span aria-hidden>↗</span></a> : undefined}>
              {t('dc.cmds0')}
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
              {t('dc.cmdsNote')} <a className="btn-link" href={bot.inviteUrl} target="_blank" rel="noreferrer">{t('dc.inviteLink')}</a>.
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
        <p className="text-sm font-bold"><button type="button" className="btn-link" onClick={() => setWizardOpen(true)}>{t('dc.wizard')}</button></p>
      )}

      {!loaded && <div className="skeleton panel h-64" aria-busy="true" aria-label={t('dc.loading')} />}

      {loaded && settings && shown.length === 0 && (
        <Empty art={<DiscordArt />} title={t('dc.none')} text={t('dc.noneText')}>
          {servers.length > 0
            ? <button className="btn mt-3" onClick={() => setDraft({ serverId: servers[0].id, channelId: '', intervalSec: 60, enabled: true, style: 'embed' })}>{t('dc.bind')}</button>
            : <a className="btn mt-3" href="/admin/servers/new">{t('dc.addFirst')}</a>}
        </Empty>
      )}

      {shown.length > 1 && (
        <div className="flex flex-wrap items-center gap-2 rounded-ui-lg bg-soft px-4 py-2.5">
          <label className="flex items-center gap-2 font-bold">
            <input type="checkbox" className="h-4 w-4 accent-brand" checked={picked.length === shown.length} onChange={(e) => setPicked(e.target.checked ? shown.map((b) => b.id) : [])} />
            {picked.length ? t('dc.picked', { n: picked.length }) : t('dc.pickAll')}
          </label>
          {picked.length > 0 && (
            <div className="ml-auto flex flex-wrap gap-2">
              <button className="btn btn-soft btn-sm" onClick={() => void bulk('pause')}>{t('dc.pause')}</button>
              <button className="btn btn-soft btn-sm" onClick={() => void bulk('resume')}>{t('dc.resume')}</button>
              <button className="btn btn-danger btn-sm" onClick={() => void bulk('delete')}>{t('dc.delete')}</button>
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
                  {shown.length > 1 && <input type="checkbox" className="h-4 w-4 shrink-0 accent-brand" checked={picked.includes(b.id)} onChange={() => pick(b.id)} aria-label={t('dc.pickOne')} />}
                  {s && <GameAvatar game={s.game} size={40} />}
                  <div className="min-w-0">
                    <div className="line-clamp-2 wrap-break-word font-black leading-tight" title={s?.name}>{s?.name ?? t('dc.srv', { id: b.serverId })}</div>
                    <div className="truncate text-sm font-bold text-mute" title={t('dc.chId', { id: b.channelId })}>
                      {b.channelName ? `# ${b.channelName}${b.guildName ? ` · ${b.guildName}` : ''}` : t('dc.ch', { id: b.channelId })}
                    </div>
                  </div>
                </div>
                {!b.enabled ? <span className="pill pill-mute">{t('dc.st.paused')}</span> : b.lastError ? <span className="pill pill-bad">{t('dc.st.error')}</span> : b.lastUpdate ? <span className="pill pill-ok">{t('dc.st.ok')}</span> : <span className="pill pill-warn">{t('dc.st.wait')}</span>}
              </div>

              <ol className="dc-flow" aria-label={t('dc.flow')}>
                <li className="is-ok"><b>{t('dc.flow.server')}</b><span className="truncate">{s?.online ? t('dc.flow.online') : s ? t('dc.flow.down') : t('dc.flow.gone')}</span></li>
                <li className={bot?.state === 'online' ? 'is-ok' : 'is-bad'}><b>{t('dc.flow.channel')}</b><span className="truncate">{b.channelName ? `# ${b.channelName}` : t('dc.flow.nofound')}</span></li>
                <li className={!b.enabled ? 'is-mute' : b.lastError ? 'is-bad' : b.lastUpdate ? 'is-ok' : 'is-warn'}><b>{t('dc.flow.message')}</b><span className="truncate">{!b.enabled ? t('dc.flow.paused') : b.lastError ? t('dc.flow.err') : b.lastUpdate ? ago(b.lastUpdate) : t('dc.flow.waits')}</span></li>
              </ol>

              {(b.serverIds ?? []).length > 1 && (
                <div className="flex flex-wrap items-center gap-2 rounded-2xl bg-soft px-3 py-2">
                  <span className="flex -space-x-2">
                    {(b.serverIds ?? []).slice(0, 5).map((id) => {
                      const x = server(id);
                      return x ? <span key={id} className="rounded-xl ring-2 ring-[rgb(var(--soft))]" title={x.name}><GameAvatar game={x.game} size={28} /></span> : null;
                    })}
                  </span>
                  <span className="min-w-0 text-sm font-extrabold text-mute">
                    {t('dc.inOne', { n: (b.serverIds ?? []).length })}
                  </span>
                </div>
              )}
              {b.style !== 'card' && <EmbedPreview serverId={b.serverId} intervalSec={b.intervalSec} />}
              {b.style !== 'card' && (b.serverIds ?? []).length > 1 && (
                <p className="-mt-1 text-sm font-semibold text-mute">{t('dc.previewFirst')}</p>
              )}
              {b.style !== 'embed' && (
                <img
                  src={`/api/card/${b.serverId}.png?v=${s?.updatedAt ?? 0}`}
                  alt={t('dc.card', { name: s?.name ?? '' })}
                  loading="lazy"
                  className="aspect-5/2 w-full rounded-2xl bg-soft object-cover"
                />
              )}

              {b.lastError && b.enabled && <p className="rounded-xl bg-badbg px-3 py-2 text-sm font-bold text-bad">{b.lastError}</p>}
              <div className="flex justify-between text-sm font-bold text-mute">
                <span>{t('dc.every', { n: b.intervalSec })}</span>
                <span>{t('dc.updated', { ago: ago(b.lastUpdate) })}</span>
              </div>
              <div className="flex items-center justify-end gap-1.5" role="group" aria-label={t('dc.actions')}>
                <button type="button" className="row-act" title={b.enabled ? t('dc.doPause') : t('dc.doResume')} aria-label={b.enabled ? t('dc.doPause') : t('dc.doResume')} onClick={() => void toggle(b)}>
                  {b.enabled ? <IconPause /> : <IconPlay />}
                </button>
                <button type="button" className="row-act" title={t('dc.edit')} aria-label={t('dc.edit')} onClick={() => setDraft({ id: b.id, serverId: b.serverId, extraServerIds: (b.serverIds ?? []).slice(1), channelId: b.channelId, intervalSec: b.intervalSec, enabled: b.enabled, style: b.style })}>
                  <IconEdit />
                </button>
                <button type="button" className="row-act row-act-danger" title={t('dc.delete')} aria-label={t('dc.delete')} onClick={() => void remove(b)}>
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
            if (first && url) toast(t('dc.savedFirst'), 'ok', undefined, { label: t('dc.openCh'), href: url });
            else toast(t('dc.saved'));
            void load();
          }}
        />
      )}
    </AdminPage>
  );
}

function BindingForm({ servers, initial, onClose, onSaved }: { servers: Server[]; initial: Draft; onClose: () => void; onSaved: (channelUrl?: string) => void }) {
  useI18n();
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
    if (!/^\d{15,25}$/.test(f.channelId)) return setError(t('dc.pickErr'));
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
    <Modal title={f.id ? t('dc.f.edit') : t('dc.f.new')} onClose={onClose}>
      <form onSubmit={submit} className="space-y-3.5">
        <Field label={t('dc.f.server')}>
          <select id="bind-server" className="input" value={f.serverId} onChange={(e) => setF({ ...f, serverId: Number(e.target.value), extraServerIds: extras.filter((x) => x !== Number(e.target.value)) })}>
            {servers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </Field>
        {others.length > 0 && (
          <fieldset className="space-y-2">
            <legend className="label">{t('dc.f.more')}</legend>
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
            <p className="text-sm font-semibold text-mute">{t('dc.f.moreNote')}</p>
          </fieldset>
        )}

        {hasList && !manual ? (
          <>
            {guilds!.length > 1 && (
              <Field label={t('dc.f.guild')}>
                <select id="bind-guild" className="input" value={guildId} onChange={(e) => { setGuildId(e.target.value); setF({ ...f, channelId: '' }); }}>
                  {guilds!.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
                </select>
              </Field>
            )}
            <Field label={guilds!.length === 1 ? t('dc.f.chIn', { name: guild?.name ?? '' }) : t('dc.f.channel')}>
              <select id="bind-channel-pick" className="input" value={f.channelId} onChange={(e) => setF({ ...f, channelId: e.target.value })} required>
                <option value="" disabled>{t('dc.f.pick')}</option>
                {guild?.channels.map((c) => <option key={c.id} value={c.id}>{`# ${c.name}${c.missing?.length ? ' ⚠' : ''}`}</option>)}
              </select>
            </Field>
            <MissingNote guild={guild} channelId={f.channelId} />
            <div className="flex flex-wrap gap-x-4 gap-y-1">
              <button type="button" className="btn-link" onClick={() => setManual(true)}>{t('dc.f.manual')}</button>
              <button type="button" className="btn-link" onClick={refresh} disabled={refreshing}>{refreshing ? t('dc.f.refreshing') : t('dc.f.refresh')}</button>
            </div>
          </>
        ) : (
          <>
            <Field label={t('dc.f.chId')}>
              <input id="bind-channel" className="input font-mono" value={f.channelId} onChange={(e) => setF({ ...f, channelId: e.target.value.trim() })} placeholder="123456789012345678" required pattern="\d{15,25}" inputMode="numeric" autoFocus />
            </Field>
            <p className="-mt-2 text-sm font-semibold text-mute">
              {guilds && guilds.length === 0 && allGuilds.length === 0
                ? t('dc.f.help1')
                : guilds && guilds.length === 0
                  ? t('dc.f.help2', { names: allGuilds.map((g) => g.name).join('», «'), hidden: allGuilds.some((g) => g.hidden) ? t('dc.f.hidden', { n: allGuilds.reduce((n, g) => n + (g.hidden ?? 0), 0) }) : '' })
                  : t('dc.f.help3')}
            </p>
            <div className="flex flex-wrap gap-x-4 gap-y-1">
              {hasList && <button type="button" className="btn-link" onClick={() => setManual(false)}>{t('dc.f.fromList')}</button>}
              <button type="button" className="btn-link" onClick={refresh} disabled={refreshing}>{refreshing ? t('dc.f.refreshing') : t('dc.f.refresh')}</button>
            </div>
          </>
        )}

        <Field label={t('dc.f.style')}>
          <select id="bind-style" className="input" value={f.style} onChange={(e) => setF({ ...f, style: e.target.value as Style })}>
            <option value="embed">{t('dc.f.embed')}</option>
            <option value="card">{t('dc.f.cardOpt')}</option>
            <option value="both">{t('dc.f.both')}</option>
          </select>
        </Field>
        <Field label={t('dc.f.interval')}>
          <input id="bind-interval" className="input" type="number" min={30} max={3600} value={f.intervalSec} onChange={(e) => setF({ ...f, intervalSec: Number(e.target.value) })} required />
        </Field>
        <label className="flex items-center gap-3 font-bold text-mute">
          <Switch id="bind-enabled" checked={f.enabled} onChange={(on) => setF({ ...f, enabled: on })} /> {t('dc.f.enabled')}
        </label>
        <ErrorLine text={error} />
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" className="btn btn-ghost" onClick={onClose}>{t('common.cancel')}</button>
          <Button loading={busy}>{t('common.save')}</Button>
        </div>
      </form>
    </Modal>
  );
}
