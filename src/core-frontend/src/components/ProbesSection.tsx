/**
 * Admin → Система: probes, small programs on other machines that check the game servers from there. A server the
 * panel cannot reach but a probe can has a network problem between them, not an outage.
 */
import { useEffect, useState, type FormEvent } from 'react';
import { api } from '../api';
import { confirmDialog } from '../confirm';
import { Button, ErrorLine, Field, IconCopy, IconRefresh, IconTrash, Modal, Section, ago, toast, SkeletonRows } from '../ui';

interface Probe { id: number; name: string; createdAt: number; lastSeen: number | null; ip: string | null; version: string | null; alive: boolean; servers: number; online: number }
interface Issued { token: string; commands: { docker: string; node: string } }

function Copyable({ label, text }: { label: string; text: string }) {
  return (
    <div>
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="label !mb-0">{label}</span>
        <button type="button" className="btn-link btn-xs" onClick={() => void navigator.clipboard?.writeText(text).then(() => toast('Скопировано'))}><IconCopy size={14} /> Копировать</button>
      </div>
      <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-all rounded-xl bg-soft px-3 py-2 font-mono text-[12.5px] font-semibold">{text}</pre>
    </div>
  );
}

export default function ProbesSection() {
  const [list, setList] = useState<Probe[] | null>(null);
  const [error, setError] = useState('');
  const [adding, setAdding] = useState(false);
  const [issued, setIssued] = useState<(Issued & { name: string }) | null>(null);
  const load = () => api<Probe[]>('/probes').then(setList).catch((e: Error) => setError(e.message));
  useEffect(() => { void load(); }, []);

  const rotate = async (p: Probe) => {
    if (!(await confirmDialog({ title: `Новый ключ для «${p.name}»?`, text: 'Старый ключ перестанет работать: точку нужно будет перезапустить с новым.', confirmLabel: 'Выдать новый' }))) return;
    await api<Issued>(`/probes/${p.id}/token`, 'POST').then((r) => setIssued({ ...r, name: p.name })).catch((e: Error) => setError(e.message));
  };
  const remove = async (p: Probe) => {
    if (!(await confirmDialog({ title: `Удалить «${p.name}»?`, text: 'Её проверки пропадут со страниц серверов.', confirmLabel: 'Удалить', danger: true }))) return;
    await api(`/probes/${p.id}`, 'DELETE').then(load).catch((e: Error) => setError(e.message));
  };

  return (
    <Section
      title="Точки проверки"
      description="Небольшая программа на другом компьютере или VPS (в другом городе, у другого провайдера) проверяет игровые серверы оттуда. Если панель сервер не видит, а точки видят, — дело в сети между ними, а не в сервере. Игроки увидят на странице сервера, откуда он доступен."
      actions={<button type="button" className="btn btn-soft btn-sm" onClick={() => setAdding(true)}>Добавить точку</button>}
    >
      <ErrorLine text={error} />
      {!list && !error && <SkeletonRows n={2} />}
      {list && list.length === 0 && <p className="text-sm font-semibold text-mute">Точек пока нет: серверы проверяет только сама панель.</p>}
      <ul className="grid gap-2">
        {list?.map((p) => (
          <li key={p.id} className="flex flex-wrap items-center gap-3 rounded-2xl bg-soft px-3 py-2.5">
            <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${p.alive ? 'bg-ok' : 'bg-mute'}`} aria-label={p.alive ? 'на связи' : 'не на связи'} role="img" />
            <span className="min-w-0 flex-1">
              <span className="block font-extrabold">📍 {p.name}</span>
              <span className="block text-sm font-semibold text-mute">
                {p.lastSeen ? `на связи ${ago(p.lastSeen)}${p.alive ? ` · видит ${p.online} из ${p.servers}` : ''}${p.ip ? ` · ${p.ip}` : ''}` : 'ещё ни разу не выходила на связь'}
              </span>
            </span>
            <button type="button" className="row-act" aria-label="Новый ключ" title="Новый ключ" onClick={() => void rotate(p)}><IconRefresh /></button>
            <button type="button" className="row-act row-act-danger" aria-label="Удалить" title="Удалить" onClick={() => void remove(p)}><IconTrash /></button>
          </li>
        ))}
      </ul>
      {adding && <AddProbe onClose={() => setAdding(false)} onDone={(r) => { setAdding(false); setIssued(r); void load(); }} />}
      {issued && (
        <Modal title={`Точка «${issued.name}»`} onClose={() => { setIssued(null); void load(); }}>
          <div className="space-y-3.5">
            <p className="font-semibold">Запустите на нужной машине одну из команд. Ключ показывается только сейчас: сохраните команду, если понадобится повторить.</p>
            <Copyable label="Docker (проще всего)" text={issued.commands.docker} />
            <Copyable label="Или Node.js 18+" text={issued.commands.node} />
            <p className="text-sm font-semibold text-mute">Точка появится «на связи» через минуту после запуска.</p>
            <div className="flex justify-end"><button type="button" className="btn" onClick={() => { setIssued(null); void load(); }}>Готово</button></div>
          </div>
        </Modal>
      )}
    </Section>
  );
}

function AddProbe({ onClose, onDone }: { onClose: () => void; onDone: (r: Issued & { name: string }) => void }) {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    await api<Issued>('/probes', 'POST', { name: name.trim() })
      .then((r) => onDone({ ...r, name: name.trim() }))
      .catch((err: Error) => setError(err.message))
      .finally(() => setBusy(false));
  };
  return (
    <Modal title="Новая точка проверки" onClose={onClose}>
      <form onSubmit={submit} className="space-y-3.5">
        <Field label="Название (его увидят игроки)"><input className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={40} placeholder="Например: Франкфурт" required autoFocus /></Field>
        <ErrorLine text={error} />
        <div className="flex justify-end gap-2">
          <button type="button" className="btn btn-ghost" onClick={onClose}>Отмена</button>
          <Button loading={busy}>Создать</Button>
        </div>
      </form>
    </Modal>
  );
}
