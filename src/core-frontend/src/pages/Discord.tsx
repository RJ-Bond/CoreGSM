import { useState, type FormEvent } from 'react';
import { api, type Binding, type Server } from '../api';
import { ErrorLine, Field, Modal, PageHead, ago, usePoll } from '../ui';

interface Draft { id?: number; serverId: number; channelId: string; intervalSec: number; enabled: boolean }

export default function DiscordPage() {
  const [servers, setServers] = useState<Server[]>([]);
  const [bindings, setBindings] = useState<Binding[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState('');

  const load = () =>
    Promise.all([api<Server[]>('/servers'), api<Binding[]>('/bindings')])
      .then(([s, b]) => { setServers(s); setBindings(b); })
      .catch((e) => setError(e.message));
  usePoll(load, 10_000);

  const name = (id: number) => servers.find((s) => s.id === id)?.name ?? `#${id}`;

  const remove = async (b: Binding) => {
    if (!window.confirm('Удалить привязку? Сообщение в Discord останется, но обновляться перестанет.')) return;
    await api(`/bindings/${b.id}`, 'DELETE').catch((e) => setError(e.message));
    load();
  };

  const toggle = async (b: Binding) => {
    await api(`/bindings/${b.id}`, 'PUT', { serverId: b.serverId, channelId: b.channelId, intervalSec: b.intervalSec, enabled: !b.enabled }).catch((e) => setError(e.message));
    load();
  };

  return (
    <div className="space-y-5">
      <PageHead title="discord">
        <button className="btn" disabled={servers.length === 0} onClick={() => setDraft({ serverId: servers[0].id, channelId: '', intervalSec: 60, enabled: true })}>+ Привязать канал</button>
      </PageHead>
      <ErrorLine text={error} />

      <div className="max-w-2xl space-y-1 rounded border border-line bg-panel p-3 text-mute">
        <p><span className="text-blurple-soft">1.</span> Пригласите бота на сервер с правами «Просмотр канала», «Отправка сообщений», «Прикрепление файлов», «Встраивание ссылок».</p>
        <p><span className="text-blurple-soft">2.</span> В Discord включите режим разработчика, нажмите правой кнопкой на канал и выберите «Копировать ID канала».</p>
        <p><span className="text-blurple-soft">3.</span> Привяжите канал к серверу. Бот отправит одно сообщение и будет его редактировать по таймеру.</p>
      </div>

      <div className="overflow-x-auto rounded border border-line bg-panel">
        <table className="w-full min-w-[680px] border-collapse">
          <thead>
            <tr>{['Состояние', 'Сервер', 'ID канала', 'Интервал', 'Обновлено', ''].map((h) => <th key={h} className="th">{h}</th>)}</tr>
          </thead>
          <tbody>
            {bindings.map((b) => (
              <tr key={b.id} className="hover:bg-raise/60">
                <td className="td">
                  {!b.enabled ? <span className="text-mute">● ПАУЗА</span> : b.lastError ? <span className="text-bad" title={b.lastError}>● ОШИБКА</span> : b.lastUpdate ? <span className="text-ok">● РАБОТАЕТ</span> : <span className="text-warn">● ОЖИДАНИЕ</span>}
                  {b.lastError && b.enabled && <div className="max-w-[220px] truncate text-[11px] text-bad/80" title={b.lastError}>{b.lastError}</div>}
                </td>
                <td className="td">{name(b.serverId)}</td>
                <td className="td text-mute">{b.channelId}</td>
                <td className="td">{b.intervalSec} с</td>
                <td className="td text-mute">{ago(b.lastUpdate)}</td>
                <td className="td whitespace-nowrap text-right">
                  <button className="btn btn-ghost mr-2 !py-0.5" onClick={() => toggle(b)}>{b.enabled ? 'Пауза' : 'Включить'}</button>
                  <button className="btn btn-ghost mr-2 !py-0.5" onClick={() => setDraft({ id: b.id, serverId: b.serverId, channelId: b.channelId, intervalSec: b.intervalSec, enabled: b.enabled })}>Изменить</button>
                  <button className="btn btn-danger !py-0.5" onClick={() => remove(b)}>Удалить</button>
                </td>
              </tr>
            ))}
            {bindings.length === 0 && <tr><td colSpan={6} className="px-3 py-10 text-center text-mute">Каналов нет. Привяжите первый.</td></tr>}
          </tbody>
        </table>
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
      <form onSubmit={submit} className="space-y-3">
        <Field label="Сервер">
          <select id="bind-server" className="input" value={f.serverId} onChange={(e) => setF({ ...f, serverId: Number(e.target.value) })}>
            {servers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </Field>
        <Field label="ID канала Discord">
          <input id="bind-channel" className="input" value={f.channelId} onChange={(e) => setF({ ...f, channelId: e.target.value.trim() })} placeholder="123456789012345678" required pattern="\d{15,25}" inputMode="numeric" autoFocus />
        </Field>
        <Field label="Интервал обновления, секунд (30–3600)">
          <input id="bind-interval" className="input" type="number" min={30} max={3600} value={f.intervalSec} onChange={(e) => setF({ ...f, intervalSec: Number(e.target.value) })} required />
        </Field>
        <label className="flex items-center gap-2 text-mute">
          <input id="bind-enabled" type="checkbox" checked={f.enabled} onChange={(e) => setF({ ...f, enabled: e.target.checked })} /> Включена
        </label>
        <ErrorLine text={error} />
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" className="btn btn-ghost" onClick={onClose}>Отмена</button>
          <button className="btn" disabled={busy}>Сохранить</button>
        </div>
      </form>
    </Modal>
  );
}
