/**
 * Admin → Система: probes, small programs on other machines that check the game servers from there. A server the
 * panel cannot reach but a probe can has a network problem between them, not an outage.
 */
import { useEffect, useState, type FormEvent } from 'react';
import { api } from '../api';
import { t, useI18n } from '../i18n';
import { confirmDialog } from '../confirm';
import { Button, ErrorLine, Field, IconCopy, IconRefresh, IconTrash, Modal, Section, ago, toast, SkeletonRows } from '../ui';

interface Probe { id: number; name: string; createdAt: number; lastSeen: number | null; ip: string | null; version: string | null; alive: boolean; servers: number; online: number }
interface Issued { token: string; commands: { docker: string; node: string } }

function Copyable({ label, text }: { label: string; text: string }) {
  useI18n();
  return (
    <div>
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="label mb-0!">{label}</span>
        <button type="button" className="btn-link btn-xs" onClick={() => void navigator.clipboard?.writeText(text).then(() => toast(t('pb.copied')))}><IconCopy size={14} /> {t('common.copy')}</button>
      </div>
      <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-all rounded-xl bg-soft px-3 py-2 font-mono text-fs-sm font-semibold">{text}</pre>
    </div>
  );
}

export default function ProbesSection() {
  useI18n();
  const [list, setList] = useState<Probe[] | null>(null);
  const [error, setError] = useState('');
  const [adding, setAdding] = useState(false);
  const [issued, setIssued] = useState<(Issued & { name: string }) | null>(null);
  const load = () => api<Probe[]>('/probes').then(setList).catch((e: Error) => setError(e.message));
  useEffect(() => { void load(); }, []);

  const rotate = async (p: Probe) => {
    if (!(await confirmDialog({ title: t('pb.rotateQ', { name: p.name }), text: t('pb.rotateText'), confirmLabel: t('pb.rotateBtn') }))) return;
    await api<Issued>(`/probes/${p.id}/token`, 'POST').then((r) => setIssued({ ...r, name: p.name })).catch((e: Error) => setError(e.message));
  };
  const remove = async (p: Probe) => {
    if (!(await confirmDialog({ title: t('pb.deleteQ', { name: p.name }), text: t('pb.deleteText'), confirmLabel: t('pb.delete'), danger: true }))) return;
    await api(`/probes/${p.id}`, 'DELETE').then(load).catch((e: Error) => setError(e.message));
  };

  return (
    <Section
      title={t('pb.title')}
      description={t('pb.desc')}
      actions={<button type="button" className="btn btn-soft btn-sm" onClick={() => setAdding(true)}>{t('pb.add')}</button>}
    >
      <ErrorLine text={error} />
      {!list && !error && <SkeletonRows n={2} />}
      {list && list.length === 0 && <p className="text-sm font-semibold text-mute">{t('pb.empty')}</p>}
      <ul className="grid grid-cols-[minmax(0,1fr)] gap-2">
        {list?.map((p) => (
          <li key={p.id} className="flex flex-wrap items-center gap-3 rounded-2xl bg-soft px-3 py-2.5">
            <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${p.alive ? 'bg-ok' : 'bg-mute'}`} aria-label={p.alive ? t('pb.alive') : t('pb.dead')} role="img" />
            <span className="min-w-0 flex-1">
              <span className="block font-extrabold">📍 {p.name}</span>
              <span className="block text-sm font-semibold text-mute">
                {p.lastSeen ? `${t('pb.alive')} ${ago(p.lastSeen)}${p.alive ? ` · ${t('pb.sees', { online: p.online, servers: p.servers })}` : ''}${p.ip ? ` · ${p.ip}` : ''}` : t('pb.never')}
              </span>
            </span>
            <button type="button" className="row-act" aria-label={t('pb.newKey')} title={t('pb.newKey')} onClick={() => void rotate(p)}><IconRefresh /></button>
            <button type="button" className="row-act row-act-danger" aria-label={t('pb.delete')} title={t('pb.delete')} onClick={() => void remove(p)}><IconTrash /></button>
          </li>
        ))}
      </ul>
      {adding && <AddProbe onClose={() => setAdding(false)} onDone={(r) => { setAdding(false); setIssued(r); void load(); }} />}
      {issued && (
        <Modal title={t('pb.probeTitle', { name: issued.name })} onClose={() => { setIssued(null); void load(); }}>
          <div className="space-y-3.5">
            <p className="font-semibold">{t('pb.run')}</p>
            <Copyable label={t('pb.docker')} text={issued.commands.docker} />
            <Copyable label={t('pb.node')} text={issued.commands.node} />
            <p className="text-sm font-semibold text-mute">{t('pb.appears')}</p>
            <div className="flex justify-end"><button type="button" className="btn" onClick={() => { setIssued(null); void load(); }}>{t('pb.done')}</button></div>
          </div>
        </Modal>
      )}
    </Section>
  );
}

function AddProbe({ onClose, onDone }: { onClose: () => void; onDone: (r: Issued & { name: string }) => void }) {
  useI18n();
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
    <Modal title={t('pb.newTitle')} onClose={onClose}>
      <form onSubmit={submit} className="space-y-3.5">
        <Field label={t('pb.f.name')}><input className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={40} placeholder={t('pb.f.ph')} required autoFocus /></Field>
        <ErrorLine text={error} />
        <div className="flex justify-end gap-2">
          <button type="button" className="btn btn-ghost" onClick={onClose}>{t('common.cancel')}</button>
          <Button loading={busy}>{t('pb.create')}</Button>
        </div>
      </form>
    </Modal>
  );
}
