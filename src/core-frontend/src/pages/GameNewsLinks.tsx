import { useState } from 'react';
import { api } from '../api';
import { soon } from '../components/GameNewsParts';
import { confirmDialog } from '../confirm';
import { t, useI18n } from '../i18n';
import { errText, toast, usePoll } from '../ui';
import { EmptyState } from './GameNewsUi';

interface Link { platformId: string; masked: string; nick: string; username: string; status: string; discord: boolean; linkedAt: number }

/** the players whose game account is linked to an account of the panel (by .register or .login), with a way to unlink one */
export function LinksTab() {
  useI18n();
  const [items, setItems] = useState<Link[] | null>(null);
  const [query, setQuery] = useState('');
  const load = () => api<{ items: Link[] }>('/game-news/links').then((d) => setItems(d.items)).catch(() => undefined);
  usePoll(load, 20_000);

  const unlink = async (l: Link) => {
    if (!(await confirmDialog({ title: t('gn.lk.unlinkTitle', { nick: l.nick || l.masked }), text: t('gn.lk.unlinkText', { user: l.username }), danger: true, confirmLabel: t('gn.lk.unlink') }))) return;
    try { await api(`/game-news/links/${l.platformId}`, 'DELETE'); toast(t('gn.lk.unlinked')); await load(); } catch (e) { toast(errText(e as Error), 'err'); }
  };
  const q = query.trim().toLowerCase();
  const list = (items ?? []).filter((l) => !q || l.nick.toLowerCase().includes(q) || l.username.toLowerCase().includes(q));

  return (
    <section className="panel space-y-3 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="font-extrabold">{t('gn.lk.title')}</h3>
          <p className="text-sm font-semibold text-mute">{t('gn.lk.note')}</p>
        </div>
        {items && items.length > 4 && <input className="input w-56" value={query} placeholder={t('gn.lk.search')} aria-label={t('gn.lk.search')} onChange={(e) => setQuery(e.target.value)} />}
      </div>
      {items == null && <div className="skeleton h-24 rounded-xl" aria-busy="true" />}
      {items && items.length === 0 && <EmptyState icon="🔗" title={t('gn.lk.empty')} hint={t('gn.lk.emptyHint')} />}
      {items && items.length > 0 && list.length === 0 && <p className="text-sm font-semibold text-mute">{t('gn.lk.none')}</p>}
      {list.length > 0 && (
        <ul className="divide-y divide-line">
          {list.map((l) => (
            <li key={l.platformId} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-3">
              <span aria-hidden className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-soft font-extrabold">{(l.nick || l.username).slice(0, 1).toUpperCase()}</span>
              <div className="min-w-0 flex-1 basis-56">
                <div className="wrap-break-word font-bold">{l.nick || '—'} <span className="font-semibold text-mute">→ {l.username}</span></div>
                <div className="text-sm font-semibold text-mute">
                  {l.masked} · {soon(l.linkedAt)}
                  {l.discord && ` · ${t('gn.lk.discord')}`}
                  {l.status !== 'active' && ` · ${t('gn.lk.pending')}`}
                </div>
              </div>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => void unlink(l)}>{t('gn.lk.unlink')}</button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
