/**
 * Admin → Обслуживание: the wipe scenario of a server. One plan holds everything around a wipe: warnings in Discord
 * and in the game chat, the maintenance window, the wipe commands (RCON, with a new seed), a new season and the news.
 */
import { useEffect, useState } from 'react';
import { api, type Server } from '../api';
import { confirmDialog } from '../confirm';
import { Button, ErrorLine, Field, GameAvatar, Modal, Section, fmtDateTime, toast, errText } from '../ui';
import { ChannelPicker } from './ChannelPicker';
import '../styles/admin.css';

interface Step { step: string; ok: boolean; text: string; at: number }
interface Wipe {
  id: number;
  name: string;
  wipeAt: number;
  status: 'scheduled' | 'done' | 'missed' | 'cancelled';
  announceMin: number[];
  sayMin: number[];
  channelId: string;
  durationMin: number;
  commands: string[];
  seedMode: 'none' | 'random' | 'fixed';
  seed: string;
  seasonName: string;
  newsChannelId: string;
  newsTitle: string;
  newsText: string;
  mention: 'none' | 'here' | 'everyone';
  steps: Step[];
  failed: number;
}

const ANNOUNCE = [{ m: 10_080, label: 'за неделю' }, { m: 1440, label: 'за сутки' }, { m: 180, label: 'за 3 часа' }, { m: 60, label: 'за час' }, { m: 10, label: 'за 10 мин' }];
const SAY = [{ m: 30, label: 'за 30 мин' }, { m: 10, label: 'за 10 мин' }, { m: 5, label: 'за 5 мин' }, { m: 1, label: 'за минуту' }];
const STEP_LABEL: Record<string, string> = { window: 'Окно обслуживания', commands: 'Команды вайпа', season: 'Новый сезон', news: 'Новость', discord: 'Сообщение в Discord', say: 'Игровой чат', missed: 'Пропущен' };
const STATUS: Record<Wipe['status'], { text: string; cls: string }> = {
  scheduled: { text: 'запланирован', cls: 'pill pill-ok' },
  done: { text: 'выполнен', cls: 'pill pill-mute' },
  missed: { text: 'пропущен', cls: 'pill pill-bad' },
  cancelled: { text: 'отменён', cls: 'pill pill-mute' },
};

/** the value of <input type="datetime-local"> for a timestamp (the browser's time zone) */
const localInput = (ts: number) => {
  const d = new Date(ts - new Date(ts).getTimezoneOffset() * 60_000);
  return d.toISOString().slice(0, 16);
};

const blank = (): Wipe => ({
  id: 0,
  name: 'Вайп',
  wipeAt: Date.now() + 3 * 86_400_000,
  status: 'scheduled',
  announceMin: [1440, 60, 10],
  sayMin: [10, 1],
  channelId: '',
  durationMin: 15,
  commands: [],
  seedMode: 'none',
  seed: '',
  seasonName: '',
  newsChannelId: '',
  newsTitle: 'Вайп на {server} прошёл',
  newsText: 'Сервер {server} вайпнут {date} в {time}. Новая карта уже ждёт: заходите!',
  mention: 'none',
  steps: [],
  failed: 0,
});

export default function WipeScenarios({ servers }: { servers: Server[] }) {
  const [open, setOpen] = useState<Server | null>(null);
  const [next, setNext] = useState<Record<number, Wipe | null>>({});
  const load = () => {
    for (const s of servers) {
      api<Wipe[]>(`/servers/${s.id}/wipes`)
        .then((l) => setNext((x) => ({ ...x, [s.id]: l.find((w) => w.status === 'scheduled') ?? null })))
        .catch(() => undefined);
    }
  };
  useEffect(load, [servers]);
  if (!servers.length) return null;
  return (
    <Section
      title="Сценарий вайпа"
      description="Один сценарий на весь вайп: предупреждения в Discord и игровом чате, окно обслуживания, команды вайпа с новым сидом, новый сезон и новость «вайп прошёл». Каждый шаг выполняется один раз."
    >
      <ul className="grid gap-2">
        {servers.map((s) => {
          const w = next[s.id];
          return (
            <li key={s.id} className="flex flex-wrap items-center gap-3 rounded-2xl bg-soft px-3 py-2.5">
              <GameAvatar game={s.game} size={32} />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-extrabold">{s.name}</span>
                <span className="block text-sm font-semibold text-mute">
                  {w === undefined ? <span className="skeleton inline-block h-3 w-40 rounded-full align-middle" /> : w ? `${w.name} · ${fmtDateTime(w.wipeAt)}` : 'вайп не запланирован'}
                </span>
              </span>
              {w && <span className="pill pill-ok">запланирован</span>}
              <button type="button" className="btn btn-soft btn-sm" onClick={() => setOpen(s)}>Сценарии</button>
            </li>
          );
        })}
      </ul>
      {open && <WipeModal server={open} onClose={() => { setOpen(null); load(); }} />}
    </Section>
  );
}

function WipeModal({ server, onClose }: { server: Server; onClose: () => void }) {
  const [list, setList] = useState<Wipe[] | null>(null);
  const [edit, setEdit] = useState<Wipe | null>(null);
  const [error, setError] = useState('');
  const load = () => api<Wipe[]>(`/servers/${server.id}/wipes`).then(setList).catch((e: Error) => setError(e.message));
  useEffect(() => { void load(); }, []);

  const remove = async (w: Wipe) => {
    if (w.status === 'scheduled' && !(await confirmDialog({ title: `Отменить «${w.name}»?`, text: 'Предупреждения и шаги вайпа выполняться не будут.', confirmLabel: 'Отменить вайп', danger: true }))) return;
    await api(`/wipes/${w.id}`, 'DELETE').then(() => load()).catch((e: Error) => setError(e.message));
  };

  if (edit) return <WipeForm server={server} wipe={edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); void load(); }} />;
  return (
    <Modal title={`Вайпы: ${server.name}`} onClose={onClose}>
      <div className="space-y-3">
        <ErrorLine text={error} />
        {list === null ? <div className="skeleton h-20 rounded-2xl" /> : list.length === 0 ? <p className="text-sm font-semibold text-mute">Сценариев пока нет.</p> : (
          <ul className="grid gap-2">
            {list.map((w) => (
              <li key={w.id} className="rounded-2xl bg-soft px-3.5 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-extrabold">{w.name}</span>
                  <span className={STATUS[w.status].cls}>{STATUS[w.status].text}</span>
                  {w.failed > 0 && <span className="pill pill-bad">ошибок: {w.failed}</span>}
                  <span className="ml-auto text-sm font-bold text-mute">{fmtDateTime(w.wipeAt)}</span>
                </div>
                {w.steps.length > 0 && (
                  <ul className="mt-2 space-y-0.5 text-sm font-semibold">
                    {w.steps.map((s, i) => <li key={i} className={s.ok ? 'text-mute' : 'text-bad'}>{s.ok ? '✓' : '✗'} {STEP_LABEL[s.step] ?? s.step}: {s.text}</li>)}
                  </ul>
                )}
                <div className="mt-2 flex gap-2">
                  {w.status === 'scheduled' && <button type="button" className="btn btn-soft btn-sm" onClick={() => setEdit(w)}>Изменить</button>}
                  <button type="button" className="btn btn-ghost btn-sm text-bad" onClick={() => void remove(w)}>{w.status === 'scheduled' ? 'Отменить' : 'Убрать'}</button>
                </div>
              </li>
            ))}
          </ul>
        )}
        <div className="flex justify-between gap-2">
          <button type="button" className="btn btn-ghost" onClick={onClose}>Закрыть</button>
          <Button type="button" onClick={() => setEdit(blank())}>Запланировать вайп</Button>
        </div>
      </div>
    </Modal>
  );
}

function WipeForm({ server, wipe, onClose, onSaved }: { server: Server; wipe: Wipe; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState(wipe);
  const [at, setAt] = useState(localInput(wipe.wipeAt));
  const [cmds, setCmds] = useState(wipe.commands.join('\n'));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const toggle = (key: 'announceMin' | 'sayMin', m: number) =>
    setF((x) => ({ ...x, [key]: x[key].includes(m) ? x[key].filter((v) => v !== m) : [...x[key], m] }));

  const save = async () => {
    const ts = new Date(at).getTime();
    if (!Number.isFinite(ts)) return setError('Укажите дату и время вайпа');
    setBusy(true);
    setError('');
    const body = {
      name: f.name, wipeAt: ts, announceMin: f.announceMin, sayMin: f.sayMin, channelId: f.channelId, durationMin: f.durationMin,
      commands: cmds.split('\n').map((c) => c.trim()).filter(Boolean), seedMode: f.seedMode, seed: f.seed, seasonName: f.seasonName,
      newsChannelId: f.newsChannelId, newsTitle: f.newsTitle, newsText: f.newsText, mention: f.mention,
    };
    try {
      await (wipe.id ? api(`/wipes/${wipe.id}`, 'PUT', body) : api(`/servers/${server.id}/wipes`, 'POST', body));
      toast('Сценарий сохранён');
      onSaved();
    } catch (e) {
      setError(errText(e));
    }
    setBusy(false);
  };

  return (
    <Modal title={wipe.id ? 'Изменить вайп' : 'Запланировать вайп'} onClose={onClose}>
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Название"><input className="input" maxLength={60} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
          <Field label="Когда (ваше время)"><input className="input" type="datetime-local" value={at} onChange={(e) => setAt(e.target.value)} /></Field>
          <Field label="Окно обслуживания, мин"><input className="input" type="number" min={1} max={240} value={f.durationMin} onChange={(e) => setF({ ...f, durationMin: Number(e.target.value) })} /></Field>
        </div>

        <fieldset className="space-y-3 rounded-2xl bg-soft p-3.5">
          <legend className="px-1 font-extrabold">1. Предупреждения</legend>
          <div>
            <span className="label">В Discord</span>
            <div className="flex flex-wrap gap-1.5">
              {ANNOUNCE.map((a) => <button key={a.m} type="button" className={`rp-day ${f.announceMin.includes(a.m) ? 'is-on' : ''}`} aria-pressed={f.announceMin.includes(a.m)} onClick={() => toggle('announceMin', a.m)}>{a.label}</button>)}
            </div>
          </div>
          <div>
            <span className="label">В игровом чате (нужен RCON)</span>
            <div className="flex flex-wrap gap-1.5">
              {SAY.map((a) => <button key={a.m} type="button" className={`rp-day ${f.sayMin.includes(a.m) ? 'is-on' : ''}`} aria-pressed={f.sayMin.includes(a.m)} onClick={() => toggle('sayMin', a.m)}>{a.label}</button>)}
            </div>
          </div>
          <div>
            <span className="label">Канал Discord</span>
            <ChannelPicker id="wipe-channel" value={f.channelId} onChange={(v) => setF({ ...f, channelId: v })} />
            <p className="mt-1 text-sm font-semibold text-mute">Не выбран: сообщения уйдут в канал оповещений.</p>
          </div>
        </fieldset>

        <fieldset className="space-y-3 rounded-2xl bg-soft p-3.5">
          <legend className="px-1 font-extrabold">2. В момент вайпа</legend>
          <Field label="Команды RCON, по одной в строке (необязательно)">
            <textarea className="input min-h-20 font-mono" value={cmds} onChange={(e) => setCmds(e.target.value)} placeholder={'server.seed {seed}\nserver.writecfg'} />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Сид {seed}">
              <select className="input" value={f.seedMode} onChange={(e) => setF({ ...f, seedMode: e.target.value as Wipe['seedMode'] })}>
                <option value="none">Не менять</option>
                <option value="random">Случайный (выберет панель)</option>
                <option value="fixed">Свой</option>
              </select>
            </Field>
            {f.seedMode === 'fixed' && <Field label="Сид"><input className="input font-mono" maxLength={40} value={f.seed} onChange={(e) => setF({ ...f, seed: e.target.value })} /></Field>}
          </div>
          <Field label="Новый сезон (пусто: не начинать)"><input className="input" maxLength={60} value={f.seasonName} onChange={(e) => setF({ ...f, seasonName: e.target.value })} placeholder="например Сезон {date}" /></Field>
          <p className="text-sm font-semibold text-mute">Окно обслуживания открывается всегда, чтобы вайп не считался сбоем. В командах и текстах работают {'{server}'}, {'{date}'}, {'{time}'} и {'{seed}'}.</p>
        </fieldset>

        <fieldset className="space-y-3 rounded-2xl bg-soft p-3.5">
          <legend className="px-1 font-extrabold">3. Новость после вайпа</legend>
          <div>
            <span className="label">Канал новостей (не выбран: новости не будет)</span>
            <ChannelPicker id="wipe-news-channel" value={f.newsChannelId} onChange={(v) => setF({ ...f, newsChannelId: v })} />
          </div>
          {f.newsChannelId && (
            <>
              <Field label="Заголовок"><input className="input" maxLength={200} value={f.newsTitle} onChange={(e) => setF({ ...f, newsTitle: e.target.value })} /></Field>
              <Field label="Текст"><textarea className="input min-h-20" maxLength={2000} value={f.newsText} onChange={(e) => setF({ ...f, newsText: e.target.value })} /></Field>
              <Field label="Упоминание">
                <select className="input" value={f.mention} onChange={(e) => setF({ ...f, mention: e.target.value as Wipe['mention'] })}>
                  <option value="none">Без упоминания</option>
                  <option value="here">@here</option>
                  <option value="everyone">@everyone</option>
                </select>
              </Field>
            </>
          )}
        </fieldset>

        <ErrorLine text={error} />
        <div className="flex justify-end gap-2">
          <button type="button" className="btn btn-ghost" onClick={onClose}>Назад</button>
          <Button type="button" loading={busy} onClick={() => void save()}>Сохранить</Button>
        </div>
      </div>
    </Modal>
  );
}
