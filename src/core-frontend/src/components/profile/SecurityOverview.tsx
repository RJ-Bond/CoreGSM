import { useEffect, useState, type ReactNode } from 'react';
import { api } from '../../api';
import { useAuth } from '../../auth';
import { t, type TKey } from '../../i18n';
import { nextSecurityStep, securityChecks } from './heroLogic';

/** «Защита аккаунта: 3 из 4»: a bar, what is done and the first thing still worth doing */
export function SecurityScore() {
  const { me } = useAuth();
  const [tfa, setTfa] = useState<boolean | null>(null);
  useEffect(() => {
    api<{ enabled: boolean }>('/auth/2fa').then((r) => setTfa(!!r.enabled)).catch(() => setTfa(false));
  }, []);
  if (!me || tfa === null) return <div className="skeleton h-20 rounded-2xl bg-soft" />;
  const checks = securityChecks(me, tfa);
  const done = checks.filter((c) => c.ok).length;
  const next = nextSecurityStep(checks);
  return (
    <section className="panel pf-score" aria-label={t('pf.sec.score', { n: done, total: checks.length })}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-lg font-black">{t('pf.sec.score', { n: done, total: checks.length })}</h2>
        <span className={`text-sm font-extrabold ${next ? 'text-mute' : 'text-ok'}`}>{next ? t(`pf.sec.next.${next}` as TKey) : t('pf.sec.allDone')}</span>
      </div>
      <div className="pf-bar mt-3" role="progressbar" aria-valuemin={0} aria-valuemax={checks.length} aria-valuenow={done} aria-label={t('pf.sec.score', { n: done, total: checks.length })}>
        <i style={{ width: `${(done / checks.length) * 100}%` }} />
      </div>
      <ul className="pf-score-list">
        {checks.map((c) => (
          <li key={c.id} className={c.ok ? 'is-ok' : ''}>
            <span aria-hidden>{c.ok ? '✓' : '○'}</span>{t(`pf.sec.chk.${c.id}` as TKey)}
          </li>
        ))}
      </ul>
    </section>
  );
}

/** a group of settings cards that folds: the first one is open */
export function SecurityGroup({ title, hint, defaultOpen = false, children }: { title: string; hint?: string; defaultOpen?: boolean; children: ReactNode }) {
  return (
    <details className="pf-group" open={defaultOpen}>
      <summary className="pf-group-head">
        <span className="min-w-0">
          <span className="block text-lg font-black">{title}</span>
          {hint && <span className="block text-sm font-semibold text-mute">{hint}</span>}
        </span>
        <span className="pf-group-chev" aria-hidden>▾</span>
      </summary>
      <div className="pf-group-body">{children}</div>
    </details>
  );
}
