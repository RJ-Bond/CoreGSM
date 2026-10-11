import { useState, type FormEvent } from 'react';
import { api, type Server, type ServerInput } from '../api';
import { GAMES, gameColor, gameLabel } from '../games';
import { Empty, ErrorLine, Field, FillBar, GameAvatar, Modal, PageHead, Spark, StatusPill, ago, usePoll } from '../ui';

const empty: ServerInput = { name: '', game: 'minecraft', host: '', port: 25565, queryPort: null, displayAddress: '' };

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

  const add = () => setEditing({ data: empty });

  return (
    <div className="space-y-6">
      <PageHead title="Серверы" subtitle="Состояние ваших игровых серверов в реальном времени">
        <button className="btn" onClick={add}>+ Добавить сервер</button>
      </PageHead>
      <ErrorLine text={error} />

      {servers.length > 0 && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {[
            ['Серверов', servers.length],
            ['Онлайн', `${online.length} из ${servers.length}`],
            ['Игроков', players],
            ['Средний пинг', avg == null ? '–' : `${avg} мс`],
          ].map(([k, v]) => (
            <div key={k} className="panel px-5 py-4">
              <div className="text-[13px] font-extrabold text-mute">{k}</div>
              <div className="text-3xl font-black tabular-nums text-brand">{v}</div>
            </div>
          ))}
        </div>
      )}

      {!loaded && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2].map((i) => <div key={i} className="skeleton panel h-56" />)}
        </div>
      )}

      {loaded && servers.length === 0 && (
        <Empty title="Добавьте первый сервер" text="Укажите игру и адрес, и панель начнёт показывать онлайн, карту и пинг. Потом привяжите Discord-канал.">
          <button className="btn mt-3" onClick={add}>+ Добавить сервер</button>
        </Empty>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {servers.map((s) => {
          const color = gameColor(s.game);
          const lag = s.ping != null && s.ping > 100;
          return (
            <article key={s.id} className="pop panel flex flex-col gap-3 p-5">
              <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 items-center gap-3">
                  <GameAvatar game={s.game} />
                  <div className="min-w-0">
                    <h3 className="line-clamp-3 break-words font-black leading-tight" title={s.name}>{s.name}</h3>
                    <div className="truncate text-[13px] font-bold text-mute">{gameLabel(s.game)}</div>
                  </div>
                </div>
                <StatusPill online={s.online} known={s.hasStatus} lag={lag} />
              </div>

              <div className="flex items-baseline gap-1.5">
                <span className="text-4xl font-black tabular-nums">{s.online ? s.players : '–'}</span>
                {s.online && <span className="font-extrabold text-mute">/ {s.maxPlayers}</span>}
                <span className="ml-auto text-[13px] font-bold text-mute">{s.online && s.ping != null ? `${s.ping} мс` : ''}</span>
              </div>
              <FillBar value={s.online ? s.players : 0} max={s.maxPlayers} color={color} />
              <Spark serverId={s.id} color={color} />

              <div className="flex items-center justify-between gap-2 text-[13px] font-bold text-mute">
                <span className="truncate font-mono text-[12px]" title={s.address}>{s.address}</span>
                <span className="shrink-0">{s.online && s.map ? s.map : ago(s.updatedAt)}</span>
              </div>
              {!s.online && s.error && <p className="truncate rounded-xl bg-badbg px-3 py-1.5 text-[12px] font-bold text-bad" title={s.error}>{s.error}</p>}

              <div className="mt-auto flex gap-2 pt-1">
                <button className="btn btn-soft btn-sm" onClick={() => setEditing({ id: s.id, data: { name: s.customName, game: s.game, host: s.host, port: s.port, queryPort: s.queryPort, displayAddress: s.displayAddress } })}>Изменить</button>
                <button className="btn btn-danger btn-sm" onClick={() => remove(s)}>Удалить</button>
              </div>
            </article>
          );
        })}
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
      <form onSubmit={submit} className="space-y-3.5">
        <Field label="Название (необязательно)">
          <input id="srv-name" className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} maxLength={64} autoFocus placeholder="определится само по ответу сервера" />
        </Field>
        <p className="-mt-1.5 text-[13px] font-semibold text-mute">Оставьте пустым: панель возьмёт название, которое сервер сообщает сам (например, из настроек Minecraft или CS2). Своё название задайте, только если хотите его переопределить.</p>
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
            <Field label="Адрес для опроса (IP или домен)">
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
        <Field label="Адрес для отображения (необязательно)">
          <input id="srv-display" className="input font-mono" value={f.displayAddress} onChange={(e) => setF({ ...f, displayAddress: e.target.value.trim() })} maxLength={100} placeholder="play.example.com:25565 или внешний IP" />
        </Field>
        <p className="-mt-1.5 text-[13px] font-semibold text-mute">Панель опрашивает сервер по адресу выше, а людям на странице и в карточке Discord показывает этот адрес. Подойдёт, если сервер стоит в локальной сети и снаружи доступен по другому IP или домену.</p>
        <ErrorLine text={error} />
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" className="btn btn-soft" onClick={onClose}>Отмена</button>
          <button className="btn" disabled={busy}>{busy ? 'Опрашиваю сервер…' : 'Сохранить'}</button>
        </div>
      </form>
    </Modal>
  );
}
