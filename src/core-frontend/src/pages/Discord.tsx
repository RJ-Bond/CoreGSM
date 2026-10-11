import { useState, type FormEvent } from 'react';
import { api, type Binding, type BotStatus, type Server, type SettingsInfo } from '../api';
import { Empty, ErrorLine, Field, GameAvatar, InviteButton, Modal, PageHead, ago, usePoll } from '../ui';
import { BotPill } from './Settings';

interface Draft { id?: number; serverId: number; channelId: string; intervalSec: number; enabled: boolean }

export default function DiscordPage() {
  const [servers, setServers] = useState<Server[]>([]);
  const [bindings, setBindings] = useState<Binding[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState('');
  const [settings, setSettings] = useState<SettingsInfo | null>(null);
  const [bot, setBot] = useState<BotStatus | null>(null);

  const load = () =>
    Promise.all([api<Server[]>('/servers'), api<Binding[]>('/bindings'), api<SettingsInfo>('/settings'), api<BotStatus>('/bot/status')])
      .then(([s, b, st, bs]) => { setServers(s); setBindings(b); setSettings(st); setBot(bs); })
      .catch((e) => setError(e.message))
      .finally(() => setLoaded(true));
  usePoll(load, 10_000);

  const server = (id: number) => servers.find((s) => s.id === id);
  const working = bindings.some((b) => b.enabled && b.lastUpdate && !b.lastError);

  const remove = async (b: Binding) => {
    if (!window.confirm('Удалить привязку? Сообщение в Discord останется, но обновляться перестанет.')) return;
    await api(`/bindings/${b.id}`, 'DELETE').catch((e) => setError(e.message));
    load();
  };

  const toggle = async (b: Binding) => {
    await api(`/bindings/${b.id}`, 'PUT', { serverId: b.serverId, channelId: b.channelId, intervalSec: b.intervalSec, enabled: !b.enabled }).catch((e) => setError(e.message));
    load();
  };

  const steps = [
    { done: servers.length > 0, title: 'Добавьте сервер', text: 'На вкладке «Серверы».' },
    { done: bindings.length > 0, title: 'Пригласите бота и привяжите канал', text: 'Кнопка «Пригласить бота на сервер» выше откроет Discord: выберите сервер и подтвердите права.' },
    { done: working, title: 'Бот отправит карточку', text: 'Одно сообщение, которое потом обновляется по таймеру.' },
  ];

  return (
    <div className="space-y-6">
      <PageHead title="Discord" subtitle="Куда бот публикует карточки серверов">
        <button className="btn" disabled={servers.length === 0} onClick={() => setDraft({ serverId: servers[0].id, channelId: '', intervalSec: 60, enabled: true })}>+ Привязать канал</button>
      </PageHead>
      <ErrorLine text={error} />

      <div className="panel flex flex-wrap items-center justify-between gap-3 px-5 py-3">
        <div className="flex items-center gap-3">
          <span className="font-black">Бот</span>
          <BotPill status={bot} tokenSet={!!settings?.discordTokenSet} />
        </div>
        {!settings?.discordTokenSet && <a href="#/settings" className="font-extrabold text-brand hover:underline">Указать токен в настройках</a>}
        {settings?.discordTokenSet && <InviteButton url={bot?.inviteUrl ?? null} className="btn-soft btn-sm" />}
        {settings?.discordTokenSet && bot?.state === 'error' && bot.error && <span className="text-[13px] font-bold text-bad">{bot.error}</span>}
      </div>

      <ol className="grid gap-3 md:grid-cols-3">
        {steps.map((s, i) => (
          <li key={s.title} className="panel flex gap-3 p-4">
            <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-full font-black ${s.done ? 'bg-okbg text-ok' : 'bg-soft text-mute'}`}>{s.done ? '✓' : i + 1}</span>
            <div>
              <div className="font-black">{s.title}</div>
              <div className="text-[13px] font-semibold text-mute">{s.text}</div>
            </div>
          </li>
        ))}
      </ol>
      <p className="text-[13px] font-semibold text-mute">ID канала: включите в Discord режим разработчика, нажмите на канал правой кнопкой и выберите «Копировать ID канала».</p>

      {loaded && bindings.length === 0 && <Empty title="Каналов пока нет" text="Привяжите канал, и бот опубликует там карточку выбранного сервера." />}

      <div className="grid gap-4 md:grid-cols-2">
        {bindings.map((b) => {
          const s = server(b.serverId);
          return (
            <div key={b.id} className="panel space-y-3 p-5">
              <div className="flex items-center justify-between gap-3">
                <div className="flex min-w-0 items-center gap-3">
                  {s && <GameAvatar game={s.game} size={40} />}
                  <div className="min-w-0">
                    <div className="truncate font-black">{s?.name ?? `Сервер #${b.serverId}`}</div>
                    <div className="font-mono text-[12px] font-bold text-mute">#{b.channelId}</div>
                  </div>
                </div>
                {!b.enabled ? <span className="pill pill-mute">ПАУЗА</span> : b.lastError ? <span className="pill pill-bad">ОШИБКА</span> : b.lastUpdate ? <span className="pill pill-ok">РАБОТАЕТ</span> : <span className="pill pill-warn">ОЖИДАНИЕ</span>}
              </div>
              {b.lastError && b.enabled && <p className="rounded-xl bg-badbg px-3 py-1.5 text-[12px] font-bold text-bad">{b.lastError}</p>}
              <div className="flex justify-between text-[13px] font-bold text-mute">
                <span>Каждые {b.intervalSec} с</span>
                <span>Обновлено: {ago(b.lastUpdate)}</span>
              </div>
              <div className="flex flex-wrap gap-2">
                <button className="btn btn-soft btn-sm" onClick={() => toggle(b)}>{b.enabled ? 'Пауза' : 'Включить'}</button>
                <button className="btn btn-soft btn-sm" onClick={() => setDraft({ id: b.id, serverId: b.serverId, channelId: b.channelId, intervalSec: b.intervalSec, enabled: b.enabled })}>Изменить</button>
                <button className="btn btn-danger btn-sm" onClick={() => remove(b)}>Удалить</button>
              </div>
            </div>
          );
        })}
      </div>

      {draft && <BindingForm servers={servers} initial={draft} onClose={() => setDraft(null)} onSaved={() => { setDraft(null); load(); }} />}
    </div>
  );
}

function BindingForm({ servers, initial, onClose, onSaved }: { servers: Server[]; initial: Draft; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState(initial);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
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
        <Field label="ID канала Discord">
          <input id="bind-channel" className="input" value={f.channelId} onChange={(e) => setF({ ...f, channelId: e.target.value.trim() })} placeholder="123456789012345678" required pattern="\d{15,25}" inputMode="numeric" autoFocus />
        </Field>
        <Field label="Обновлять каждые, секунд (30–3600)">
          <input id="bind-interval" className="input" type="number" min={30} max={3600} value={f.intervalSec} onChange={(e) => setF({ ...f, intervalSec: Number(e.target.value) })} required />
        </Field>
        <label className="flex items-center gap-2 font-bold text-mute">
          <input id="bind-enabled" type="checkbox" className="h-4 w-4 accent-brand" checked={f.enabled} onChange={(e) => setF({ ...f, enabled: e.target.checked })} /> Включена
        </label>
        <ErrorLine text={error} />
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" className="btn btn-soft" onClick={onClose}>Отмена</button>
          <button className="btn" disabled={busy}>Сохранить</button>
        </div>
      </form>
    </Modal>
  );
}
