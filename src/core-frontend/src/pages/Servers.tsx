import { useState, type FormEvent } from 'react';
import { api, type Server, type ServerInput } from '../api';
import { GAMES, gameLabel } from '../games';
import { Bar, ErrorLine, Field, Modal, PageHead, Status, ago, usePoll } from '../ui';

const empty: ServerInput = { name: '', game: 'minecraft', host: '', port: 25565, queryPort: null };

export default function ServersPage() {
  const [servers, setServers] = useState<Server[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [editing, setEditing] = useState<{ id?: number; data: ServerInput } | null>(null);
  const [error, setError] = useState('');

  const load = () =>
    api<Server[]>('/servers')
      .then((s) => { setServers(s); setError(''); })
      .catch((e) => setError(e.message))
      .finally(() => setLoaded(true));
  usePoll(load, 10_000);

  const online = servers.filter((s) => s.online);
  const players = online.reduce((n, s) => n + s.players, 0);
  const pings = online.filter((s) => s.ping != null).map((s) => s.ping as number);
  const avg = pings.length ? Math.round(pings.reduce((a, b) => a + b, 0) / pings.length) : null;

  const remove = async (s: Server) => {
    if (!window.confirm(`Удалить сервер «${s.name}» вместе с привязками к Discord?`)) return;
    await api(`/servers/${s.id}`, 'DELETE').catch((e) => setError(e.message));
    load();
  };

  return (
    <div className="space-y-5">
      <PageHead title="servers">
        <button className="btn" onClick={() => setEditing({ data: empty })}>+ Добавить сервер</button>
      </PageHead>
      <ErrorLine text={error} />

      <div className="grid grid-cols-2 gap-px border border-line bg-line lg:grid-cols-4">
        {[
          ['Серверов', servers.length],
          ['Онлайн', online.length],
          ['Игроков', players],
          ['Ср. пинг', avg == null ? '–' : `${avg} мс`],
        ].map(([k, v]) => (
          <div key={k} className="bg-panel px-3 py-2.5">
            <div className="text-[10px] uppercase tracking-widest text-mute">{k}</div>
            <div className="text-2xl text-blurple-soft">{v}</div>
          </div>
        ))}
      </div>

      <div className="overflow-x-auto rounded border border-line bg-panel">
        <table className="w-full min-w-[720px] border-collapse">
          <thead>
            <tr>
              {['Статус', 'Сервер', 'Игра', 'Игроки', 'Карта', 'Пинг', 'Обновлено', ''].map((h) => (
                <th key={h} className="th">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {servers.map((s) => (
              <tr key={s.id} className="hover:bg-raise/60">
                <td className="td"><Status online={s.online} known={s.hasStatus} /></td>
                <td className="td">
                  <div>{s.name}</div>
                  <div className="text-[11px] text-mute">{s.host}:{s.port}</div>
                  {!s.online && s.error && <div className="max-w-xs truncate text-[11px] text-bad/80" title={s.error}>{s.error}</div>}
                </td>
                <td className="td text-mute">{gameLabel(s.game)}</td>
                <td className="td">
                  {s.online ? (<><Bar value={s.players} max={s.maxPlayers} warn={s.maxPlayers > 0 && s.players / s.maxPlayers > 0.9} />{s.players}/{s.maxPlayers}</>) : <span className="text-mute">–</span>}
                </td>
                <td className="td text-mute">{s.online ? s.map ?? '–' : '–'}</td>
                <td className={`td ${s.ping != null && s.ping > 100 ? 'text-warn' : ''}`}>{s.online && s.ping != null ? s.ping : '–'}</td>
                <td className="td text-mute">{ago(s.updatedAt)}</td>
                <td className="td whitespace-nowrap text-right">
                  <button className="btn btn-ghost mr-2 !py-0.5" onClick={() => setEditing({ id: s.id, data: { name: s.name, game: s.game, host: s.host, port: s.port, queryPort: s.queryPort } })}>Изменить</button>
                  <button className="btn btn-danger !py-0.5" onClick={() => remove(s)}>Удалить</button>
                </td>
              </tr>
            ))}
            {loaded && servers.length === 0 && (
              <tr><td colSpan={8} className="px-3 py-10 text-center text-mute">Серверов пока нет. Нажмите «Добавить сервер».</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {editing && <ServerForm initial={editing.data} id={editing.id} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />}
    </div>
  );
}

function ServerForm({ initial, id, onClose, onSaved }: { initial: ServerInput; id?: number; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState(initial);
  const [custom, setCustom] = useState(!GAMES.some((g) => g.id === initial.game));
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const pickGame = (v: string) => {
    if (v === '__custom') { setCustom(true); return; }
    setCustom(false);
    const g = GAMES.find((x) => x.id === v);
    setF((p) => ({ ...p, game: v, port: g && (!p.host || p.port === GAMES.find((x) => x.id === p.game)?.port) ? g.port : p.port }));
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api(id ? `/servers/${id}` : '/servers', id ? 'PUT' : 'POST', f);
      onSaved();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  return (
    <Modal title={id ? 'Изменить сервер' : 'Новый сервер'} onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <Field label="Название">
          <input id="srv-name" className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required maxLength={64} autoFocus />
        </Field>
        <Field label="Игра">
          <select id="srv-game" className="input" value={custom ? '__custom' : f.game} onChange={(e) => pickGame(e.target.value)}>
            {GAMES.map((g) => <option key={g.id} value={g.id}>{g.label}</option>)}
            <option value="__custom">Другая (ввести GameDig ID)…</option>
          </select>
        </Field>
        {custom && (
          <Field label="GameDig ID">
            <input id="srv-gameid" className="input" value={f.game} onChange={(e) => setF({ ...f, game: e.target.value.trim() })} placeholder="например, arma3" required pattern="[A-Za-z0-9_]+" />
          </Field>
        )}
        <div className="grid grid-cols-3 gap-3">
          <div className="col-span-2">
            <Field label="Адрес (IP или домен)">
              <input id="srv-host" className="input" value={f.host} onChange={(e) => setF({ ...f, host: e.target.value.trim() })} required placeholder="play.example.com" />
            </Field>
          </div>
          <Field label="Порт">
            <input id="srv-port" className="input" type="number" min={1} max={65535} value={f.port} onChange={(e) => setF({ ...f, port: Number(e.target.value) })} required />
          </Field>
        </div>
        <Field label="Query-порт (если отличается)">
          <input id="srv-qport" className="input" type="number" min={1} max={65535} value={f.queryPort ?? ''} onChange={(e) => setF({ ...f, queryPort: e.target.value ? Number(e.target.value) : null })} placeholder="не указан" />
        </Field>
        <ErrorLine text={error} />
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" className="btn btn-ghost" onClick={onClose}>Отмена</button>
          <button className="btn" disabled={busy}>{busy ? 'Опрашиваю сервер…' : 'Сохранить'}</button>
        </div>
      </form>
    </Modal>
  );
}
