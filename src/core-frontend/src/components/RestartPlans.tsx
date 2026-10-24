/**
 * Admin → Обслуживание: scheduled restarts per server (days and time, the warning in Discord and in the game chat,
 * the restart command over RCON) and the RCON connection itself.
 */
import { useEffect, useState } from 'react';
import { api, type Server } from '../api';
import { useAuth } from '../auth';
import { confirmDialog } from '../confirm';
import { Button, ErrorLine, Field, GameAvatar, Modal, Section, Switch, fmtDateTime, toast } from '../ui';
import { ChannelPicker } from './ChannelPicker';
import '../styles/admin.css';

interface Plan {
  enabled: boolean;
  days: number;
  atMin: number;
  durationMin: number;
  warnMin: number;
  channelId: string;
  command: string;
  say: string;
  next: number | null;
  lastResult: string | null;
  lastRunAt: number | null;
  suggestedHour: number | null;
  timezone: string;
  rcon: { port: number | null; configured: boolean };
}

const DAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
const hhmm = (min: number) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
const daysText = (d: number) => (d === 127 ? 'каждый день' : d === 0 ? 'дни не выбраны' : DAYS.filter((_, i) => d & (1 << i)).join(', '));

export default function RestartPlans({ servers }: { servers: Server[] }) {
  const [plans, setPlans] = useState<Record<number, Plan>>({});
  const [open, setOpen] = useState<Server | null>(null);
  useEffect(() => {
    for (const s of servers) api<Plan>(`/servers/${s.id}/restart`).then((p) => setPlans((x) => ({ ...x, [s.id]: p }))).catch(() => undefined);
  }, [servers]);
  if (!servers.length) return null;
  return (
    <Section
      title="Плановые перезапуски"
      description="Панель заранее предупредит игроков в Discord и в игровом чате, на время перезапуска откроет окно обслуживания (это не будет считаться сбоем) и, если настроен RCON, сама отправит серверу команду перезапуска."
    >
      <ul className="grid gap-2">
        {servers.map((s) => {
          const p = plans[s.id];
          return (
            <li key={s.id} className="flex flex-wrap items-center gap-3 rounded-2xl bg-soft px-3 py-2.5">
              <GameAvatar game={s.game} size={32} />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-extrabold">{s.name}</span>
                <span className="block text-sm font-semibold text-mute">
                  {!p ? <span className="skeleton inline-block h-3 w-40 rounded-full align-middle" /> : p.enabled ? `${daysText(p.days)} в ${hhmm(p.atMin)}${p.next ? ` · следующий ${fmtDateTime(p.next)}` : ''}` : 'выключено'}
                  {p?.rcon.configured ? ' · RCON подключён' : ''}
                </span>
                {p?.lastResult && <span className="block text-xs font-bold text-mute">Последний раз {p.lastRunAt ? fmtDateTime(p.lastRunAt) : ''}: {p.lastResult}</span>}
              </span>
              {p?.enabled && <span className="pill pill-ok">включено</span>}
              <button type="button" className="btn btn-soft btn-sm" onClick={() => setOpen(s)} disabled={!p}>Настроить</button>
            </li>
          );
        })}
      </ul>
      {open && plans[open.id] && (
        <PlanModal server={open} plan={plans[open.id]} onClose={() => setOpen(null)} onSaved={(p) => { setPlans((x) => ({ ...x, [open.id]: p })); }} />
      )}
    </Section>
  );
}

function PlanModal({ server, plan, onClose, onSaved }: { server: Server; plan: Plan; onClose: () => void; onSaved: (p: Plan) => void }) {
  const { isAdmin } = useAuth();
  const [f, setF] = useState(plan);
  const [time, setTime] = useState(hhmm(plan.atMin));
  const [port, setPort] = useState(plan.rcon.port ? String(plan.rcon.port) : '');
  const [password, setPassword] = useState('');
  const [testCmd, setTestCmd] = useState('status');
  const [answer, setAnswer] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  const minutes = () => {
    const [h, m] = time.split(':').map(Number);
    return (h || 0) * 60 + (m || 0);
  };
  const save = async () => {
    setBusy('save');
    setError('');
    try {
      let p = await api<Plan>(`/servers/${server.id}/restart`, 'PUT', { enabled: f.enabled, days: f.days, atMin: minutes(), durationMin: f.durationMin, warnMin: f.warnMin, channelId: f.channelId, command: f.command, say: f.say });
      if (isAdmin && (port !== (plan.rcon.port ? String(plan.rcon.port) : '') || password)) {
        p = await api<Plan>(`/servers/${server.id}/rcon`, 'PUT', { port: port ? Number(port) : null, ...(password ? { password } : {}) });
      }
      onSaved(p);
      toast('Перезапуски сохранены');
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy('');
    }
  };
  const test = async () => {
    setBusy('test');
    setAnswer(null);
    try {
      if (port && (password || port !== String(plan.rcon.port ?? ''))) {
        const p = await api<Plan>(`/servers/${server.id}/rcon`, 'PUT', { port: Number(port), ...(password ? { password } : {}) });
        onSaved(p);
        setPassword('');
      }
      const r = await api<{ ok: boolean; answer: string }>(`/servers/${server.id}/rcon/test`, 'POST', { command: testCmd });
      setAnswer({ ok: r.ok, text: r.answer || 'Сервер выполнил команду и ничего не ответил' });
    } catch (e) {
      setAnswer({ ok: false, text: (e as Error).message });
    } finally {
      setBusy('');
    }
  };
  const now = async () => {
    if (!(await confirmDialog({ title: `Перезапустить «${server.name}» сейчас?`, text: 'Без предупреждения игроков: откроется окно обслуживания и, если настроен RCON, уйдёт команда перезапуска.', confirmLabel: 'Перезапустить', danger: true }))) return;
    setBusy('now');
    await api<Plan>(`/servers/${server.id}/restart/now`, 'POST').then((p) => { onSaved(p); toast(p.lastResult ?? 'Готово'); }).catch((e: Error) => setError(e.message)).finally(() => setBusy(''));
  };

  return (
    <Modal title={`Перезапуски: ${server.name}`} onClose={onClose}>
      <div className="space-y-4">
        <label className="flex cursor-pointer items-center gap-3 font-extrabold">
          <Switch checked={f.enabled} onChange={(on) => setF({ ...f, enabled: on })} /> Перезапускать по расписанию
        </label>
        <fieldset>
          <legend className="label">Дни</legend>
          <div className="flex flex-wrap gap-1.5">
            {DAYS.map((d, i) => {
              const on = !!(f.days & (1 << i));
              return <button key={d} type="button" className={`rp-day ${on ? 'is-on' : ''}`} aria-pressed={on} onClick={() => setF({ ...f, days: f.days ^ (1 << i) })}>{d}</button>;
            })}
          </div>
        </fieldset>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Время"><input className="input" type="time" value={time} onChange={(e) => setTime(e.target.value)} required /></Field>
          <Field label="Предупредить, мин"><input className="input" type="number" min={0} max={120} value={f.warnMin} onChange={(e) => setF({ ...f, warnMin: Number(e.target.value) })} /></Field>
          <Field label="Длится, мин"><input className="input" type="number" min={1} max={240} value={f.durationMin} onChange={(e) => setF({ ...f, durationMin: Number(e.target.value) })} /></Field>
        </div>
        {plan.suggestedHour != null && (
          <p className="-mt-2 text-sm font-semibold text-mute">
            Время панели: {plan.timezone}. Меньше всего игроков обычно в {String(plan.suggestedHour).padStart(2, '0')}:00.{' '}
            <button type="button" className="btn-link btn-xs" onClick={() => setTime(`${String(plan.suggestedHour).padStart(2, '0')}:00`)}>Поставить это время</button>
          </p>
        )}
        <div>
          <span className="label">Канал Discord для предупреждений</span>
          <ChannelPicker id="restart-channel" value={f.channelId} onChange={(v) => setF({ ...f, channelId: v })} />
          <p className="mt-1 text-sm font-semibold text-mute">Не выбран: сообщения уйдут в канал оповещений.</p>
        </div>

        <fieldset className="space-y-3 rounded-2xl bg-soft p-3.5">
          <legend className="px-1 font-extrabold">RCON (необязательно)</legend>
          <p className="text-sm font-semibold text-mute">Для Minecraft, CS, ARK, V Rising, Palworld и других игр с Source RCON. Rust (WebRCON) пока не поддерживается.</p>
          {isAdmin ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Порт RCON"><input className="input" inputMode="numeric" value={port} onChange={(e) => setPort(e.target.value.replace(/\D/g, ''))} placeholder="например 25575" /></Field>
              <Field label={plan.rcon.configured ? 'Пароль (пусто: оставить прежний)' : 'Пароль'}><input className="input" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
            </div>
          ) : (
            <p className="text-sm font-bold">{plan.rcon.configured ? `Подключён, порт ${plan.rcon.port}` : 'Не подключён: порт и пароль задаёт администратор'}</p>
          )}
          <Field label="Команда перезапуска"><input className="input font-mono" value={f.command} onChange={(e) => setF({ ...f, command: e.target.value })} placeholder="например stop, quit или shutdown" maxLength={200} /></Field>
          <Field label="Сообщение в игровой чат ({text} — текст предупреждения)"><input className="input font-mono" value={f.say} onChange={(e) => setF({ ...f, say: e.target.value })} maxLength={200} /></Field>
          <p className="text-sm font-semibold text-mute">Команда только останавливает сервер: запустить его снова должен хостинг или сервис, который следит за процессом.</p>
          {isAdmin && (
            <div className="flex flex-wrap items-end gap-2">
              <div className="min-w-40 flex-1"><Field label="Проверить команду"><input className="input font-mono" value={testCmd} onChange={(e) => setTestCmd(e.target.value)} /></Field></div>
              <Button type="button" className="btn-soft" loading={busy === 'test'} disabled={!port} onClick={() => void test()}>Выполнить</Button>
            </div>
          )}
          {answer && <pre className={`whitespace-pre-wrap rounded-xl px-3 py-2 text-sm font-semibold ${answer.ok ? 'bg-okbg text-ok' : 'bg-badbg text-bad'}`}>{answer.text}</pre>}
        </fieldset>

        <ErrorLine text={error} />
        <div className="flex flex-wrap justify-between gap-2">
          <Button type="button" className="btn-ghost text-bad" loading={busy === 'now'} onClick={() => void now()}>Перезапустить сейчас</Button>
          <div className="flex gap-2">
            <button type="button" className="btn btn-ghost" onClick={onClose}>Отмена</button>
            <Button type="button" loading={busy === 'save'} onClick={() => void save()}>Сохранить</Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
