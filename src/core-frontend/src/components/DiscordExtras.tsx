/**
 * Admin → Discord: roles the bot gives by itself (autoroles) and voice channels it renames into a live counter.
 */
import { useEffect, useState, type FormEvent } from 'react';
import { api, type Server } from '../api';
import { confirmDialog } from '../confirm';
import { Button, ErrorLine, Field, IconTrash, Modal, Section, plural, toast, SkeletonRows, errText } from '../ui';

interface Extras {
  autoroles: { id: number; guildId: string; roleId: string; roleName: string | null; roleColor: number; kind: Kind; threshold: number; serverId: number | null; members: number; error: string | null }[];
  counters: { id: number; channelId: string; channelName: string | null; guildName: string | null; template: string; serverId: number | null; preview: string; error: string | null }[];
  guilds: { id: string; name: string; roles: { id: string; name: string; color: number }[]; voice: { id: string; name: string }[] }[];
}
type Kind = 'online' | 'week_top' | 'hours';

const KIND_TEXT: Record<Kind, (t: number) => string> = {
  online: () => 'Сейчас в игре',
  week_top: (t) => (t > 1 ? `Топ-${t} недели по часам` : 'Игрок недели (больше всех часов за 7 дней)'),
  hours: (t) => `Наиграл ${t} ч и больше`,
};
const TEMPLATES = ['🟢 Онлайн: {players}', '{status} Онлайн: {players}/{max}', '🎮 Игроков: {players} · серверов {online}/{servers}'];

const roleDot = (color: number) => (color ? `#${color.toString(16).padStart(6, '0')}` : 'rgb(var(--mute))');

export default function DiscordExtras({ servers }: { servers: Server[] }) {
  const [x, setX] = useState<Extras | null>(null);
  const [error, setError] = useState('');
  const [form, setForm] = useState<'role' | 'counter' | null>(null);
  const load = () => api<Extras>('/discord/extras').then(setX).catch((e: Error) => setError(e.message));
  useEffect(() => { void load(); }, []);

  const serverName = (id: number | null) => (id ? servers.find((s) => s.id === id)?.name ?? `#${id}` : 'все серверы');
  const del = async (what: 'autoroles' | 'counters', id: number, text: string) => {
    if (!(await confirmDialog({ title: 'Удалить?', text, confirmLabel: 'Удалить', danger: true }))) return;
    await api(`/discord/${what}/${id}`, 'DELETE').then(load).catch((e: Error) => setError(e.message));
  };

  const noRoles = !!x && x.guilds.every((g) => g.roles.length === 0);
  const noVoice = !!x && x.guilds.every((g) => g.voice.length === 0);
  return (
    <>
      <Section
        title="Автороли"
        description="Бот сам выдаёт и снимает роли в Discord: «Сейчас в игре», «Игрок недели», «Ветеран 100 ч». Роли получают только игроки, которые связали Discord с игровым ником (команда /register)."
        actions={<button type="button" className="btn btn-soft btn-sm" onClick={() => setForm('role')} disabled={!x || noRoles}>Добавить роль</button>}
      >
        <ErrorLine text={error} />
        {noRoles && <p className="rounded-xl bg-warnbg px-3 py-2 text-sm font-bold text-warn">Бот не видит ролей, которые может выдавать. Дайте боту право «Управлять ролями» и поднимите его роль выше тех, что он будет выдавать.</p>}
        {!x && !error && <SkeletonRows n={2} />}
        {x && x.autoroles.length === 0 && !noRoles && <p className="text-sm font-semibold text-mute">Пока нет ни одной автороли.</p>}
        <ul className="grid grid-cols-[minmax(0,1fr)] gap-2">
          {x?.autoroles.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center gap-3 rounded-2xl bg-soft px-3 py-2.5">
              <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: roleDot(r.roleColor) }} aria-hidden />
              <span className="min-w-0 flex-1">
                <span className="block font-extrabold">@{r.roleName ?? r.roleId}</span>
                <span className="block text-sm font-semibold text-mute">{KIND_TEXT[r.kind](r.threshold)} · {serverName(r.serverId)} · сейчас у {r.members} {plural(r.members, ['игрока', 'игроков', 'игроков'])}</span>
                {r.error && <span className="mt-1 block text-sm font-bold text-bad">{r.error}</span>}
              </span>
              <button type="button" className="row-act row-act-danger" aria-label="Удалить автороль" title="Удалить" onClick={() => void del('autoroles', r.id, 'Бот перестанет выдавать эту роль. Уже выданные роли останутся у игроков.')}><IconTrash /></button>
            </li>
          ))}
        </ul>
      </Section>

      <Section
        title="Счётчик онлайна в голосовом канале"
        description="Бот переименовывает голосовой канал в живой счётчик, например «🟢 Онлайн: 42». Discord разрешает менять название канала нечасто, поэтому счётчик обновляется раз в 5 минут."
        actions={<button type="button" className="btn btn-soft btn-sm" onClick={() => setForm('counter')} disabled={!x || noVoice}>Добавить счётчик</button>}
      >
        {!x && !error && <SkeletonRows n={1} />}
        {noVoice && <p className="rounded-xl bg-warnbg px-3 py-2 text-sm font-bold text-warn">Бот не видит голосовых каналов, которые может переименовать. Дайте ему право «Управлять каналами» на нужном канале.</p>}
        <ul className="grid grid-cols-[minmax(0,1fr)] gap-2">
          {x?.counters.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center gap-3 rounded-2xl bg-soft px-3 py-2.5">
              <span className="min-w-0 flex-1">
                <span className="block font-extrabold">🔊 {c.preview}</span>
                <span className="block text-sm font-semibold text-mute">Канал «{c.channelName ?? c.channelId}»{c.guildName ? ` на «${c.guildName}»` : ''} · {serverName(c.serverId)} · шаблон <code>{c.template}</code></span>
                {c.error && <span className="mt-1 block text-sm font-bold text-bad">{c.error}</span>}
              </span>
              <button type="button" className="row-act row-act-danger" aria-label="Удалить счётчик" title="Удалить" onClick={() => void del('counters', c.id, 'Бот перестанет обновлять название этого канала.')}><IconTrash /></button>
            </li>
          ))}
        </ul>
      </Section>

      {form && x && <ExtraForm kind={form} extras={x} servers={servers} onClose={() => setForm(null)} onSaved={() => { setForm(null); void load(); toast(form === 'role' ? 'Автороль добавлена: бот начнёт выдавать её в течение минуты' : 'Счётчик добавлен: бот переименует канал в течение минуты'); }} />}
    </>
  );
}

function ExtraForm({ kind, extras, servers, onClose, onSaved }: { kind: 'role' | 'counter'; extras: Extras; servers: Server[]; onClose: () => void; onSaved: () => void }) {
  const guilds = extras.guilds.filter((g) => (kind === 'role' ? g.roles.length : g.voice.length) > 0);
  const [guildId, setGuildId] = useState(guilds[0]?.id ?? '');
  const g = guilds.find((x) => x.id === guildId);
  const [target, setTarget] = useState('');
  const [rule, setRule] = useState<Kind>('online');
  const [threshold, setThreshold] = useState(100);
  const [template, setTemplate] = useState(TEMPLATES[0]);
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
    <Modal title={kind === 'role' ? 'Новая автороль' : 'Новый счётчик'} onClose={onClose}>
      <form onSubmit={submit} className="space-y-3.5">
        {guilds.length > 1 && (
          <Field label="Сервер Discord">
            <select className="input" value={guildId} onChange={(e) => { setGuildId(e.target.value); setTarget(''); }}>
              {guilds.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
            </select>
          </Field>
        )}
        <Field label={kind === 'role' ? 'Роль' : 'Голосовой канал'}>
          <select className="input" value={target} onChange={(e) => setTarget(e.target.value)} required>
            <option value="" disabled>Выберите…</option>
            {kind === 'role' ? g?.roles.map((r) => <option key={r.id} value={r.id}>@{r.name}</option>) : g?.voice.map((v) => <option key={v.id} value={v.id}>🔊 {v.name}</option>)}
          </select>
        </Field>
        {kind === 'role' ? (
          <>
            <Field label="Кому выдавать">
              <select className="input" value={rule} onChange={(e) => { const k = e.target.value as Kind; setRule(k); setThreshold(k === 'hours' ? 100 : 1); }}>
                <option value="online">Тем, кто сейчас в игре (снимается при выходе)</option>
                <option value="week_top">Самым активным за 7 дней</option>
                <option value="hours">Наигравшим N часов (за последние 90 дней)</option>
              </select>
            </Field>
            {rule !== 'online' && (
              <Field label={rule === 'hours' ? 'Сколько часов' : 'Сколько игроков из топа'}>
                <input className="input" type="number" min={1} max={rule === 'hours' ? 10000 : 25} value={threshold} onChange={(e) => setThreshold(Number(e.target.value))} required />
              </Field>
            )}
          </>
        ) : (
          <>
            <Field label="Название канала">
              <input className="input" value={template} onChange={(e) => setTemplate(e.target.value)} maxLength={100} required list="counter-templates" />
            </Field>
            <datalist id="counter-templates">{TEMPLATES.map((t) => <option key={t} value={t} />)}</datalist>
            <p className="-mt-2 text-sm font-semibold text-mute">{'{players}'} игроков, {'{max}'} мест, {'{online}'} серверов в сети, {'{servers}'} всего, {'{status}'} 🟢/🟡/🔴, {'{name}'} название сервера</p>
          </>
        )}
        <Field label="Считать по серверу">
          <select className="input" value={serverId ?? ''} onChange={(e) => setServerId(e.target.value ? Number(e.target.value) : null)}>
            <option value="">Все серверы</option>
            {servers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </Field>
        <ErrorLine text={error} />
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" className="btn btn-ghost" onClick={onClose}>Отмена</button>
          <Button loading={busy}>Добавить</Button>
        </div>
      </form>
    </Modal>
  );
}
