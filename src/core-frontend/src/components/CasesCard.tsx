import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import { t, useI18n, type TKey } from '../i18n';
import { Button, Section, fail, toast } from '../ui';

type Kind = 'warn' | 'ban' | 'unban' | 'kick' | 'timeout' | 'unmute' | 'appeal';
interface Case { id: number; userId: string; userName: string; modName: string; kind: Kind; reason: string; link: string; createdAt: number; expiresAt: number | null; revokedAt: number | null }
interface Resp { items: Case[]; total: number; page: number; pageSize: number; counts: Record<string, number>; now: number }

const KINDS: Kind[] = ['warn', 'ban', 'unban', 'kick', 'timeout', 'unmute', 'appeal'];
const KIND_LABEL: Record<Kind, TKey> = { warn: 'mc.k.warn', ban: 'mc.k.ban', unban: 'mc.k.unban', kick: 'mc.k.kick', timeout: 'mc.k.timeout', unmute: 'mc.k.unmute', appeal: 'mc.k.appeal' };
const KIND_EMOJI: Record<Kind, string> = { warn: '⚠️', ban: '🔨', unban: '🔓', kick: '👢', timeout: '🔇', unmute: '🔊', appeal: '📨' };
const KIND_PILL: Record<Kind, string> = { warn: 'pill pill-warn', ban: 'pill pill-bad', unban: 'pill pill-ok', kick: 'pill pill-warn', timeout: 'pill pill-mute', unmute: 'pill pill-ok', appeal: 'pill pill-mute' };

/**
 * «Наказания»: the records of the moderation commands (warnings, bans, kicks, mutes, appeals) with a search and a filter;
 * an active warning can be withdrawn here.
 */
export default function CasesCard() {
  useI18n();
  const [kind, setKind] = useState<Kind | ''>('');
  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(0);
  const [data, setData] = useState<Resp | null>(null);
  const [busy, setBusy] = useState(0);

  const load = useCallback(() => {
    const params = new URLSearchParams({ page: String(page) });
    if (kind) params.set('kind', kind);
    if (query.trim()) params.set('q', query.trim());
    return api<Resp>(`/moderation/cases?${params.toString()}`).then(setData).catch(() => undefined);
  }, [kind, query, page]);
  useEffect(() => { void load(); }, [load]);

  const revoke = async (c: Case) => {
    setBusy(c.id);
    try {
      await api(`/moderation/cases/${c.id}/revoke`, 'POST');
      toast(t('mc.revoked'));
      await load();
    } catch (e) {
      fail(e);
    } finally {
      setBusy(0);
    }
  };

  const state = (c: Case, now: number): { text: TKey; pill: string } | null => {
    if (c.revokedAt) return { text: 'mc.s.revoked', pill: 'pill pill-mute' };
    if (c.kind === 'warn') return c.expiresAt && c.expiresAt < now ? { text: 'mc.s.expired', pill: 'pill pill-mute' } : { text: 'mc.s.active', pill: 'pill pill-warn' };
    return null;
  };
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <Section title={t('mc.title')}>
      <p className="mb-3 text-sm font-semibold text-mute">{t('mc.help')}</p>
      <form className="mb-3 flex flex-wrap items-center gap-2" onSubmit={(e) => { e.preventDefault(); setPage(0); setQuery(q); }}>
        <label htmlFor="cases-q" className="sr-only">{t('mc.search')}</label>
        <input id="cases-q" className="input w-56" value={q} placeholder={t('mc.search')} onChange={(e) => setQ(e.target.value)} />
        <button type="submit" className="btn btn-soft btn-sm">{t('mc.find')}</button>
      </form>
      <div className="mb-3 flex flex-wrap gap-2" role="group" aria-label={t('mc.filter')}>
        <button type="button" className={`chip-filter ${kind === '' ? 'on' : ''}`} aria-pressed={kind === ''} onClick={() => { setKind(''); setPage(0); }}>{t('mc.all')}</button>
        {KINDS.map((k) => (
          <button key={k} type="button" className={`chip-filter ${kind === k ? 'on' : ''}`} aria-pressed={kind === k} onClick={() => { setKind(k); setPage(0); }}>
            {KIND_EMOJI[k]} {t(KIND_LABEL[k])}{data?.counts[k] ? ` · ${data.counts[k]}` : ''}
          </button>
        ))}
      </div>
      {!data ? null : data.items.length === 0 ? (
        <p className="text-sm font-semibold text-mute">{t('mc.empty')}</p>
      ) : (
        <ul className="space-y-2">
          {data.items.map((c) => {
            const st = state(c, data.now);
            return (
              <li key={c.id} className="rounded-xl border border-line p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={KIND_PILL[c.kind]}>{KIND_EMOJI[c.kind]} {t(KIND_LABEL[c.kind])}</span>
                  <span className="font-black">{c.userName || c.userId}</span>
                  <span className="text-sm font-semibold text-mute">{c.userId}</span>
                  {st && <span className={st.pill}>{t(st.text)}</span>}
                  <span className="ml-auto text-sm font-semibold text-mute">{new Date(c.createdAt).toLocaleString()}</span>
                </div>
                <p className="mt-1 text-sm">{c.reason || t('mc.noReason')}</p>
                <div className="mt-1 flex flex-wrap items-center gap-3 text-sm font-semibold text-mute">
                  <span>{t('mc.by', { name: c.modName || '—' })}</span>
                  {c.link && <a className="underline" href={c.link} target="_blank" rel="noreferrer noopener">{t('mc.link')}</a>}
                  {c.kind === 'warn' && st?.text === 'mc.s.active' && <Button type="button" loading={busy === c.id} onClick={() => void revoke(c)}>{t('mc.revoke')}</Button>}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {data && pages > 1 && (
        <div className="mt-3 flex items-center gap-3">
          <button type="button" className="btn btn-soft btn-sm" disabled={page === 0} onClick={() => setPage(page - 1)}>{t('mc.prev')}</button>
          <span className="text-sm font-semibold text-mute">{t('mc.page', { n: page + 1, m: pages, total: data.total })}</span>
          <button type="button" className="btn btn-soft btn-sm" disabled={page >= pages - 1} onClick={() => setPage(page + 1)}>{t('mc.next')}</button>
        </div>
      )}
    </Section>
  );
}
