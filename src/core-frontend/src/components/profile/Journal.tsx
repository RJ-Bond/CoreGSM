import { useState } from 'react';
import { api, type JournalItem } from '../../api';
import { confirmDialog } from '../../confirm';
import type { TKey } from '../../i18n';
import { t } from '../../i18n';
import { ago, fmtDateTime, IconLogout, Section, toast } from '../../ui';
import { deviceName } from './format';
import { JournalIcon } from './icons';
import { isArray, useFetched } from './useFetched';

type Filter = 'all' | 'logins' | 'secrets' | 'links';

const FILTERS: { id: Filter; label: TKey; kinds: string[] | null }[] = [
  { id: 'all', label: 'pf.journal.f.all', kinds: null },
  { id: 'logins', label: 'pf.journal.f.logins', kinds: ['login', 'login_new_device', 'login_failed', 'sessions_revoked'] },
  { id: 'secrets', label: 'pf.journal.f.secrets', kinds: ['password_changed', 'email_changed'] },
  { id: 'links', label: 'pf.journal.f.links', kinds: ['discord_linked', 'discord_unlinked', 'register_discord', 'nick_seen'] },
];

const KIND_LABEL: Record<string, TKey> = {
  login: 'pf.journal.k.login',
  login_failed: 'pf.journal.k.login_failed',
  login_new_device: 'pf.journal.k.login_new_device',
  password_changed: 'pf.journal.k.password_changed',
  email_changed: 'pf.journal.k.email_changed',
  discord_linked: 'pf.journal.k.discord_linked',
  discord_unlinked: 'pf.journal.k.discord_unlinked',
  avatar_changed: 'pf.journal.k.avatar_changed',
  banner_changed: 'pf.journal.k.banner_changed',
  sessions_revoked: 'pf.journal.k.sessions_revoked',
  prefs_changed: 'pf.journal.k.prefs_changed',
  profile_changed: 'pf.journal.k.profile_changed',
  register_discord: 'pf.journal.k.register_discord',
  nick_seen: 'pf.journal.k.nick_seen',
};

/** «Журнал аккаунта»: a timeline of the account's own events and the «Выйти на всех устройствах» button */
export function JournalCard({ onRevoked }: { onRevoked?: () => void }) {
  const { data, reload } = useFetched<JournalItem[]>('/me/journal?limit=50', isArray);
  const [filter, setFilter] = useState<Filter>('all');
  const [busy, setBusy] = useState(false);

  const revokeOthers = async () => {
    const ok = await confirmDialog({
      title: t('pf.journal.revokeTitle'),
      text: t('pf.journal.revokeText'),
      confirmLabel: t('pf.journal.revokeConfirm'),
      cancelLabel: t('common.cancel'),
      danger: true,
    });
    if (!ok) return;
    setBusy(true);
    try {
      const r = await api<{ revoked: number }>('/sessions/revoke-others', 'POST');
      toast(t('pf.sessions.revoked', { n: r.revoked ?? 0 }));
      onRevoked?.();
      reload();
    } catch (e) {
      toast((e as Error).message, 'err');
    } finally {
      setBusy(false);
    }
  };

  const kinds = FILTERS.find((f) => f.id === filter)?.kinds ?? null;
  const rows = (data ?? []).filter((r) => !kinds || kinds.includes(r.kind));

  return (
    <Section
      title={t('pf.journal.title')}
      description={t('pf.journal.desc')}
      actions={
        <button type="button" className="btn btn-danger" onClick={() => void revokeOthers()} disabled={busy}>
          <IconLogout size={18} />
          {t('pf.journal.revokeAll')}
        </button>
      }
    >
      {data === null ? (
        <p className="font-semibold text-mute">{t('pf.journal.unavailable')}</p>
      ) : (
        <>
          <div className="pf-chips" role="group" aria-label={t('pf.journal.filter')}>
            {FILTERS.map((f) => (
              <button key={f.id} type="button" className="pf-chip" aria-pressed={filter === f.id} onClick={() => setFilter(f.id)}>{t(f.label)}</button>
            ))}
          </div>
          {data === undefined && <div className="skeleton h-24 rounded-2xl bg-soft" />}
          {data && rows.length === 0 && <p className="font-semibold text-mute">{t('pf.journal.none')}</p>}
          {rows.length > 0 && (
            <ul className="pf-line">
              {rows.map((r) => {
                const bad = r.kind === 'login_failed';
                const label = KIND_LABEL[r.kind];
                const device = r.ua ? deviceName(r.ua) : '';
                return (
                  <li key={String(r.id)}>
                    <span className={`pf-dot ${bad ? 'is-bad' : ''}`} aria-hidden><JournalIcon kind={r.kind} /></span>
                    <div className="min-w-0 flex-1 pt-0.5">
                      <div className="wrap-break-word font-extrabold">{label ? t(label) : r.kind}</div>
                      <div className="wrap-break-word text-sm font-semibold text-mute">
                        {[device, r.ip].filter(Boolean).join(' · ') || t('pf.journal.noDevice')}
                        {' · '}
                        <span title={fmtDateTime(r.ts)}>{ago(r.ts)}</span>
                      </div>
                      {r.detail && <div className="mt-0.5 wrap-break-word text-sm font-semibold text-mute">{r.detail}</div>}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}
    </Section>
  );
}
