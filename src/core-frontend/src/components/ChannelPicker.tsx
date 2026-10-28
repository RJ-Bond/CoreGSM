import { useEffect, useState } from 'react';
import { api, type DiscordGuild } from '../api';
import { t, useI18n } from '../i18n';

// the list of the bot's servers and channels, asked once a minute at most and shared by every label on the page
let listAt = 0;
let listP: Promise<DiscordGuild[]> | null = null;
function guildList(force = false): Promise<DiscordGuild[]> {
  if (force || !listP || Date.now() - listAt > 60_000) {
    listAt = Date.now();
    listP = api<DiscordGuild[]>('/discord/channels').catch(() => { listP = null; return [] as DiscordGuild[]; });
  }
  return listP;
}

/** «# general · My server» for a channel the bot can see, null when it does not know the channel */
export function channelLabelOf(guilds: DiscordGuild[], id: string, withGuild = true): string | null {
  for (const g of guilds) {
    const c = g.channels.find((x) => x.id === id);
    if (c) return `# ${c.name}${withGuild && guilds.length > 1 ? ` · ${g.name}` : ''}`;
  }
  return null;
}

/** a Discord channel written by its name, not by its number (the number only when the bot does not know the channel) */
export function ChannelName({ id, known }: { id: string; /** a name the panel already has (it wins over the list) */ known?: string | null }) {
  const [label, setLabel] = useState<string | null>(known ? `# ${known}` : null);
  useEffect(() => {
    if (known) { setLabel(`# ${known}`); return; }
    let alive = true;
    void guildList().then((g) => { if (alive) setLabel(channelLabelOf(g, id)); });
    return () => { alive = false; };
  }, [id, known]);
  return <>{label ?? t('ch.n', { id })}</>;
}

/** A warning under the select when the chosen channel lacks soft permissions (embeds/images). */
export function MissingNote({ guild, channelId }: { guild?: DiscordGuild; channelId: string }) {
  useI18n();
  const missing = guild?.channels.find((c) => c.id === channelId)?.missing;
  if (!missing?.length) return null;
  return (
    <p className="rounded-xl bg-warnbg px-3 py-2 text-sm font-bold text-warn">
      {t('d2.chp.missing', { list: missing.join(', ') })}
    </p>
  );
}

/**
 * Pick a Discord channel by name (the bot reports the servers and channels it can post in),
 * with a manual ID field as a fallback.
 */
export function ChannelPicker({ value, onChange, id = 'channel' }: { value: string; onChange: (channelId: string) => void; id?: string }) {
  useI18n();
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
            <select id={`${id}-guild`} aria-label={t('d2.dx.guild')} className="input" value={guildId} onChange={(e) => { setGuildId(e.target.value); onChange(''); }}>
              {guilds!.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
            </select>
          )}
          <select id={id} aria-label={t('d2.dg.channel')} className={`input ${guilds!.length > 1 ? '' : 'sm:col-span-2'}`} value={value} onChange={(e) => onChange(e.target.value)}>
            <option value="" disabled>{t('d2.chp.choose')}</option>
            {guild?.channels.map((c) => <option key={c.id} value={c.id}>{`# ${c.name}${c.missing?.length ? ' ⚠' : ''}`}</option>)}
          </select>
        </div>
        <MissingNote guild={guild} channelId={value} />
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm font-extrabold">
          <button type="button" className="btn-link" onClick={() => setManual(true)}>{t('d2.chp.manual')}</button>
          <button type="button" className="btn-link" onClick={refresh} disabled={busy}>{busy ? t('d2.srv.refreshing') : t('d2.chp.refresh')}</button>
        </div>
      </div>
    );
  }
  return (
    <div className="space-y-2">
      <input id={id} className="input font-mono" value={value} onChange={(e) => onChange(e.target.value.trim())} placeholder={t('d2.chp.idEx')} inputMode="numeric" />
      <p className="text-sm font-semibold text-mute">
        {guilds && guilds.length === 0 ? <>{t('d2.chp.noChannels')} <a href="/admin/discord" className="font-extrabold text-link hover:underline">{t('d2.chp.checkBot')}</a>{' '}</> : ''}
        {t('d2.chp.devMode')}
      </p>
      <div className="flex gap-4 text-sm font-extrabold">
        {hasList && <button type="button" className="btn-link" onClick={() => setManual(false)}>{t('d2.chp.fromList')}</button>}
        <button type="button" className="btn-link" onClick={refresh} disabled={busy}>{busy ? t('d2.srv.refreshing') : t('d2.chp.refresh')}</button>
      </div>
    </div>
  );
}
