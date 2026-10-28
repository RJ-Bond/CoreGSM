/**
 * Admin → Discord: roles the bot gives by itself (autoroles) and voice channels it renames into a live counter.
 */
import { useEffect, useState, type FormEvent } from 'react';
import { api, type Server } from '../api';
import { t, useI18n } from '../i18n';
import { confirmDialog } from '../confirm';
import { Button, ErrorLine, Field, IconTrash, Modal, Section, toast, SkeletonRows, errText } from '../ui';

interface Extras {
  autoroles: { id: number; guildId: string; roleId: string; roleName: string | null; roleColor: number; kind: Kind; threshold: number; serverId: number | null; members: number; error: string | null }[];
  counters: { id: number; channelId: string; channelName: string | null; guildName: string | null; template: string; serverId: number | null; preview: string; error: string | null }[];
  guilds: { id: string; name: string; roles: { id: string; name: string; color: number }[]; voice: { id: string; name: string }[] }[];
}
type Kind = 'online' | 'week_top' | 'hours';

const KIND_TEXT: Record<Kind, (n: number) => string> = {
  online: () => t('d2.dx.k.online'),
  week_top: (n) => (n > 1 ? t('d2.dx.k.top', { n }) : t('d2.dx.k.topOne')),
  hours: (n) => t('d2.dx.k.hours', { n }),
};
const templates = () => [t('d2.dx.tpl1'), t('d2.dx.tpl2'), t('d2.dx.tpl3')];

const roleDot = (color: number) => (color ? `#${color.toString(16).padStart(6, '0')}` : 'rgb(var(--mute))');

export default function DiscordExtras({ servers }: { servers: Server[] }) {
  useI18n();
  const [x, setX] = useState<Extras | null>(null);
  const [error, setError] = useState('');
  const [form, setForm] = useState<'role' | 'counter' | null>(null);
  const load = () => api<Extras>('/discord/extras').then(setX).catch((e: Error) => setError(e.message));
  useEffect(() => { void load(); }, []);

  const serverName = (id: number | null) => (id ? servers.find((s) => s.id === id)?.name ?? `#${id}` : t('d2.dx.allServers'));
  const del = async (what: 'autoroles' | 'counters', id: number, text: string) => {
    if (!(await confirmDialog({ title: t('d2.dx.delQ'), text, confirmLabel: t('d2.news.delete'), danger: true }))) return;
    await api(`/discord/${what}/${id}`, 'DELETE').then(load).catch((e: Error) => setError(e.message));
  };

  const noRoles = !!x && x.guilds.every((g) => g.roles.length === 0);
  const noVoice = !!x && x.guilds.every((g) => g.voice.length === 0);
  return (
    <>
      <Section
        title={t('d2.dx.roles')}
        description={t('d2.dx.rolesDesc')}
        actions={<button type="button" className="btn btn-soft btn-sm" onClick={() => setForm('role')} disabled={!x || noRoles}>{t('d2.dx.addRole')}</button>}
      >
        <ErrorLine text={error} />
        {noRoles && <p className="rounded-xl bg-warnbg px-3 py-2 text-sm font-bold text-warn">{t('d2.dx.noRoles')}</p>}
        {!x && !error && <SkeletonRows n={2} />}
        {x && x.autoroles.length === 0 && !noRoles && <p className="text-sm font-semibold text-mute">{t('d2.dx.noAuto')}</p>}
        <ul className="grid grid-cols-[minmax(0,1fr)] gap-2">
          {x?.autoroles.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center gap-3 rounded-2xl bg-soft px-3 py-2.5">
              <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: roleDot(r.roleColor) }} aria-hidden />
              <span className="min-w-0 flex-1">
                <span className="block font-extrabold">@{r.roleName ?? r.roleId}</span>
                <span className="block text-sm font-semibold text-mute">{KIND_TEXT[r.kind](r.threshold)} · {serverName(r.serverId)} · {t('d2.dx.members', { n: r.members })}</span>
                {r.error && <span className="mt-1 block text-sm font-bold text-bad">{r.error}</span>}
              </span>
              <button type="button" className="row-act row-act-danger" aria-label={t('d2.dx.delRole')} title={t('d2.news.delete')} onClick={() => void del('autoroles', r.id, t('d2.dx.delRoleText'))}><IconTrash /></button>
            </li>
          ))}
        </ul>
      </Section>

      <Section
        title={t('d2.dx.counter')}
        description={t('d2.dx.counterDesc')}
        actions={<button type="button" className="btn btn-soft btn-sm" onClick={() => setForm('counter')} disabled={!x || noVoice}>{t('d2.dx.addCounter')}</button>}
      >
        {!x && !error && <SkeletonRows n={1} />}
        {noVoice && <p className="rounded-xl bg-warnbg px-3 py-2 text-sm font-bold text-warn">{t('d2.dx.noVoice')}</p>}
        <ul className="grid grid-cols-[minmax(0,1fr)] gap-2">
          {x?.counters.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center gap-3 rounded-2xl bg-soft px-3 py-2.5">
              <span className="min-w-0 flex-1">
                <span className="block font-extrabold">🔊 {c.preview}</span>
                <span className="block text-sm font-semibold text-mute">{t('d2.dx.channel', { name: c.channelName ?? c.channelId })}{c.guildName ? ` ${t('d2.dx.onGuild', { name: c.guildName })}` : ''} · {serverName(c.serverId)} · {t('d2.dx.template')} <code>{c.template}</code></span>
                {c.error && <span className="mt-1 block text-sm font-bold text-bad">{c.error}</span>}
              </span>
              <button type="button" className="row-act row-act-danger" aria-label={t('d2.dx.delCounter')} title={t('d2.news.delete')} onClick={() => void del('counters', c.id, t('d2.dx.delCounterText'))}><IconTrash /></button>
            </li>
          ))}
        </ul>
      </Section>

      {form && x && <ExtraForm kind={form} extras={x} servers={servers} onClose={() => setForm(null)} onSaved={() => { setForm(null); void load(); toast(form === 'role' ? t('d2.dx.t.role') : t('d2.dx.t.counter')); }} />}
    </>
  );
}

function ExtraForm({ kind, extras, servers, onClose, onSaved }: { kind: 'role' | 'counter'; extras: Extras; servers: Server[]; onClose: () => void; onSaved: () => void }) {
  useI18n();
  const guilds = extras.guilds.filter((g) => (kind === 'role' ? g.roles.length : g.voice.length) > 0);
  const [guildId, setGuildId] = useState(guilds[0]?.id ?? '');
  const g = guilds.find((x) => x.id === guildId);
  const [target, setTarget] = useState('');
  const [rule, setRule] = useState<Kind>('online');
  const [threshold, setThreshold] = useState(100);
  const [template, setTemplate] = useState(templates()[0]);
  const [serverId, setServerId] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      if (kind === 'role') await api('/discord/autoroles', 'POST', { guildId, roleId: target, kind: rule, threshold: rule === 'hours' ? threshold : rule === 'week_top' ? Math.max(1, Math.min(25, threshold)) : 0, serverId });
      else await api('/discord/counters', 'POST', { channelId: target, template, serverId });
      onSaved();
    } catch (err) {
      setError(errText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={kind === 'role' ? t('d2.dx.newRole') : t('d2.dx.newCounter')} onClose={onClose}>
      <form onSubmit={submit} className="space-y-3.5">
        {guilds.length > 1 && (
          <Field label={t('d2.dx.guild')}>
            <select className="input" value={guildId} onChange={(e) => { setGuildId(e.target.value); setTarget(''); }}>
              {guilds.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
            </select>
          </Field>
        )}
        <Field label={kind === 'role' ? t('d2.dx.role') : t('d2.dx.voice')}>
          <select className="input" value={target} onChange={(e) => setTarget(e.target.value)} required>
            <option value="" disabled>{t('d2.dx.choose')}</option>
            {kind === 'role' ? g?.roles.map((r) => <option key={r.id} value={r.id}>@{r.name}</option>) : g?.voice.map((v) => <option key={v.id} value={v.id}>🔊 {v.name}</option>)}
          </select>
        </Field>
        {kind === 'role' ? (
          <>
            <Field label={t('d2.dx.whom')}>
              <select className="input" value={rule} onChange={(e) => { const k = e.target.value as Kind; setRule(k); setThreshold(k === 'hours' ? 100 : 1); }}>
                <option value="online">{t('d2.dx.w.online')}</option>
                <option value="week_top">{t('d2.dx.w.top')}</option>
                <option value="hours">{t('d2.dx.w.hours')}</option>
              </select>
            </Field>
            {rule !== 'online' && (
              <Field label={rule === 'hours' ? t('d2.dx.howManyHours') : t('d2.dx.howManyTop')}>
                <input className="input" type="number" min={1} max={rule === 'hours' ? 10000 : 25} value={threshold} onChange={(e) => setThreshold(Number(e.target.value))} required />
              </Field>
            )}
          </>
        ) : (
          <>
            <Field label={t('d2.dx.chName')}>
              <input className="input" value={template} onChange={(e) => setTemplate(e.target.value)} maxLength={100} required list="counter-templates" />
            </Field>
            <datalist id="counter-templates">{templates().map((tp) => <option key={tp} value={tp} />)}</datalist>
            <p className="-mt-2 text-sm font-semibold text-mute">{t('d2.dx.vars')}</p>
          </>
        )}
        <Field label={t('d2.dx.countBy')}>
          <select className="input" value={serverId ?? ''} onChange={(e) => setServerId(e.target.value ? Number(e.target.value) : null)}>
            <option value="">{t('sn.f.all')}</option>
            {servers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </Field>
        <ErrorLine text={error} />
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" className="btn btn-ghost" onClick={onClose}>{t('common.cancel')}</button>
          <Button loading={busy}>{t('d2.dx.add')}</Button>
        </div>
      </form>
    </Modal>
  );
}
