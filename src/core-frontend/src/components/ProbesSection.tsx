/**
 * Admin → Система: probes, small programs on other machines that check the game servers from there. A server the
 * panel cannot reach but a probe can has a network problem between them, not an outage.
 */
import { useEffect, useState, type FormEvent } from 'react';
import { api } from '../api';
import { t, useI18n } from '../i18n';
import { confirmDialog } from '../confirm';
import { t, useI18n } from '../i18n';
import { Button, ErrorLine, Field, IconCopy, IconRefresh, IconTrash, Modal, Section, ago, toast, SkeletonRows } from '../ui';

interface Probe { id: number; name: string; createdAt: number; lastSeen: number | null; ip: string | null; version: string | null; alive: boolean; servers: number; online: number }
interface Issued { token: string; commands: { docker: string; node: string } }

function Copyable({ label, text }: { label: string; text: string }) {
  useI18n();
  return (
    <div>
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="label mb-0!">{label}</span>
        <button type="button" className="btn-link btn-xs" onClick={() => void navigator.clipboard?.writeText(text).then(() => toast(t('d2.pr.copied')))}><IconCopy size={14} /> {t('common.copy')}</button>
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
    if (!(await confirmDialog({ title: t('d2.pr.c.keyTitle', { name: p.name }), text: t('d2.pr.c.keyText'), confirmLabel: t('d2.pr.c.keyConfirm') }))) return;
    await api<Issued>(`/probes/${p.id}/token`, 'POST').then((r) => setIssued({ ...r, name: p.name })).catch((e: Error) => setError(e.message));
  };
  const remove = async (p: Probe) => {
    if (!(await confirmDialog({ title: t('d2.pr.c.delTitle', { name: p.name }), text: t('d2.pr.c.delText'), confirmLabel: t('d2.news.delete'), danger: true }))) return;
    await api(`/probes/${p.id}`, 'DELETE').then(load).catch((e: Error) => setError(e.message));
  };

  return (
    <Section
      title={t('d2.pr.title')}
      description={t('d2.pr.desc')}
      actions={<button type="button" className="btn btn-soft btn-sm" onClick={() => setAdding(true)}>{t('d2.pr.add')}</button>}
    >
      <ErrorLine text={error} />
      {!list && !error && <SkeletonRows n={2} />}
      {list && list.length === 0 && <p className="text-sm font-semibold text-mute">{t('d2.pr.none')}</p>}
      <ul className="grid grid-cols-[minmax(0,1fr)] gap-2">
        {list?.map((p) => (
          <li key={p.id} className="flex flex-wrap items-center gap-3 rounded-2xl bg-soft px-3 py-2.5">
            <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${p.alive ? 'bg-ok' : 'bg-mute'}`} aria-label={p.alive ? t('d2.pr.alive') : t('d2.pr.dead')} role="img" />
            <span className="min-w-0 flex-1">
              <span className="block font-extrabold">📍 {p.name}</span>
              <span className="block text-sm font-semibold text-mute">
                {p.lastSeen ? `${t('d2.pr.seen', { ago: ago(p.lastSeen) })}${p.alive ? ` · ${t('d2.pr.sees', { a: p.online, b: p.servers })}` : ''}${p.ip ? ` · ${p.ip}` : ''}` : t('d2.pr.never')}
              </span>
            </span>
            <button type="button" className="row-act" aria-label={t('d2.pr.newKey')} title={t('d2.pr.newKey')} onClick={() => void rotate(p)}><IconRefresh /></button>
            <button type="button" className="row-act row-act-danger" aria-label={t('d2.news.delete')} title={t('d2.news.delete')} onClick={() => void remove(p)}><IconTrash /></button>
          </li>
        ))}
      </ul>
      {adding && <AddProbe onClose={() => setAdding(false)} onDone={(r) => { setAdding(false); setIssued(r); void load(); }} />}
      {issued && (
        <Modal title={t('d2.pr.probe', { name: issued.name })} onClose={() => { setIssued(null); void load(); }}>
          <div className="space-y-3.5">
            <p className="font-semibold">{t('d2.pr.run')}</p>
            <Copyable label={t('d2.pr.docker')} text={issued.commands.docker} />
            <Copyable label={t('d2.pr.node')} text={issued.commands.node} />
            <p className="text-sm font-semibold text-mute">{t('d2.pr.appears')}</p>
            <div className="flex justify-end"><button type="button" className="btn" onClick={() => { setIssued(null); void load(); }}>{t('wn.done')}</button></div>
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
    <Modal title={t('d2.pr.newProbe')} onClose={onClose}>
      <form onSubmit={submit} className="space-y-3.5">
        <Field label={t('d2.pr.name')}><input className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={40} placeholder={t('d2.pr.nameEx')} required autoFocus /></Field>
        <ErrorLine text={error} />
        <div className="flex justify-end gap-2">
          <button type="button" className="btn btn-ghost" onClick={onClose}>{t('common.cancel')}</button>
          <Button loading={busy}>{t('d2.pr.create')}</Button>
        </div>
      </form>
    </Modal>
  );
}
