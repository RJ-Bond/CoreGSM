// Admin → Обслуживание: notes shown on the public status page («Идут работы», «Причина найдена», «Починено»).
import { useEffect, useState, type FormEvent } from 'react';
import { api, type Server, type StatusNote } from '../api';
import { confirmDialog } from '../confirm';
import { t, useI18n } from '../i18n';
import { ago, ErrorLine, Section, errText, toast } from '../ui';

type Level = StatusNote['level'];
const LEVELS: Level[] = ['info', 'warn', 'bad', 'ok'];

export default function StatusNotesCard({ servers }: { servers: Server[] }) {
  useI18n();
  const [list, setList] = useState<StatusNote[] | null>(null);
  const [error, setError] = useState('');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [level, setLevel] = useState<Level>('info');
  const [serverId, setServerId] = useState('');
  const [busy, setBusy] = useState(false);

  const load = () => api<StatusNote[]>('/status/notes').then((l) => { setList(Array.isArray(l) ? l : []); setError(''); }).catch((e: unknown) => setError(errText(e)));
  useEffect(() => { void load(); }, []);

  const add = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api<StatusNote>('/status/notes', 'POST', { title, body, level, serverId: serverId ? Number(serverId) : null });
      setTitle(''); setBody(''); setLevel('info'); setServerId('');
      toast(t('sn.added'));
      await load();
    } catch (err) {
      setError(errText(err));
    } finally {
      setBusy(false);
    }
  };
  const toggle = async (n: StatusNote) => {
    try { await api<StatusNote>(`/status/notes/${n.id}`, 'PATCH', { resolved: n.resolvedAt == null }); await load(); } catch (err) { setError(errText(err)); }
  };
  const remove = async (n: StatusNote) => {
    if (!(await confirmDialog({ title: t('sn.deleteQ'), text: n.title, confirmLabel: t('sn.delete'), danger: true }))) return;
    try { await api(`/status/notes/${n.id}`, 'DELETE'); await load(); } catch (err) { setError(errText(err)); }
  };

  return (
    <Section title={t('sn.title')} description={t('sn.text')}>
      <ErrorLine text={error} />
      <form onSubmit={(e) => void add(e)} className="grid gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label htmlFor="sn-title" className="label">{t('sn.f.title')}</label>
          <input id="sn-title" className="input" value={title} maxLength={120} required onChange={(e) => setTitle(e.target.value)} />
        </div>
        <div className="sm:col-span-2">
          <label htmlFor="sn-body" className="label">{t('sn.f.body')}</label>
          <textarea id="sn-body" className="input min-h-20" value={body} maxLength={1000} onChange={(e) => setBody(e.target.value)} />
        </div>
        <div>
          <label htmlFor="sn-level" className="label">{t('sn.f.level')}</label>
          <select id="sn-level" className="input" value={level} onChange={(e) => setLevel(e.target.value as Level)}>
            {LEVELS.map((l) => <option key={l} value={l}>{t(`st.note.${l}` as const)}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="sn-server" className="label">{t('sn.f.server')}</label>
          <select id="sn-server" className="input" value={serverId} onChange={(e) => setServerId(e.target.value)}>
            <option value="">{t('sn.f.all')}</option>
            {servers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
        <div className="sm:col-span-2">
          <button className="btn" disabled={busy || !title.trim()}>{t('sn.add')}</button>
        </div>
      </form>
      {list && list.length > 0 && (
        <ul className="divide-y divide-line">
          {list.map((n) => (
            <li key={n.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5">
              <div className="min-w-0 flex-1 basis-56">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-extrabold wrap-break-word">{n.title}</span>
                  <span className={`pill ${n.resolvedAt != null ? 'pill-ok' : n.level === 'bad' ? 'pill-bad' : n.level === 'warn' ? 'pill-warn' : 'pill-mute'}`}>{n.resolvedAt != null ? t('st.note.done') : t(`st.note.${n.level}` as const)}</span>
                </div>
                <div className="text-sm font-semibold text-mute">{n.serverName ?? t('sn.f.all')} · {ago(n.createdAt)}</div>
              </div>
              <button type="button" className="btn btn-soft btn-sm" onClick={() => void toggle(n)}>{n.resolvedAt != null ? t('sn.reopen') : t('sn.resolve')}</button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => void remove(n)}>{t('sn.delete')}</button>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}
