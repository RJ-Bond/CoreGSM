import { useMemo, useState } from 'react';
import { api, type CertInfo } from '../api';
import { t, useI18n } from '../i18n';
import { Gauge, usageTone, type GaugeTone } from '../components/Gauge';
import HealthHistoryCard, { type HealthFlag } from '../components/HealthHistoryCard';
import ProbesSection from '../components/ProbesSection';
import { AdminPage, ErrorLine, GoLink, LoadError, IconDatabase, IconDisk, IconMemory, IconSystem, Notice, PageHead, Section, Strip, ago, fmtDateTime, fmtTime, usePoll } from '../ui';

interface Health {
  version: string | null;
  versionName?: string | null;
  uptimeSec: number;
  node: string;
  dbBytes: number | null;
  diskFree: number | null;
  diskTotal: number | null;
  memoryMb: number;
  load1?: number;
  cpuCount?: number;
  counts: { servers: number; online: number; bindings: number; users: number; history: number };
  bot: { state: string; tag: string | null; error: string | null; updatedAt: number };
  guilds: number;
  publicBase: string | null;
  cert?: CertInfo;
  flags?: HealthFlag[];
}
interface Check { id: string; label: string; status: 'ok' | 'warn' | 'fail'; detail: string }

const mb = (n: number | null) => (n == null ? '–' : n > 1073741824 ? t('d2.sys.gb', { v: (n / 1073741824).toFixed(1) }) : t('d2.sys.mb', { v: (n / 1048576).toFixed(1) }));
const dur = (s: number) => (s < 3600 ? t('dur.m', { n: Math.floor(s / 60) }) : s < 86400 ? t('dur.hm', { h: Math.floor(s / 3600), m: Math.floor((s % 3600) / 60) }) : t('d2.sys.dur.dh', { d: Math.floor(s / 86400), h: Math.floor((s % 86400) / 3600) }));

// the backend reports the process memory and the database file only, so they are drawn against a fixed reference size
const MEM_REF_MB = 512;
const DB_REF_BYTES = 1024 * 1048576;

const certTone = (c: CertInfo): GaugeTone => (c.daysLeft == null ? 'mute' : c.daysLeft <= 0 ? 'bad' : c.daysLeft <= 14 ? 'warn' : 'ok');
const certText = (c: CertInfo) => {
  if (c.daysLeft == null) return t('d2.sys.cert.none');
  const d = c.daysLeft;
  return d <= 0 ? t('d2.sys.cert.expired') : t('pf.stats.days', { n: d });
};

/** Health, diagnostics and the certificate; the backups live under Settings → «Обновления и копии». */
export default function SystemPage() {
  useI18n();
  const [h, setH] = useState<Health | null>(null);
  const [checks, setChecks] = useState<{ at: number; list: Check[] } | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState('');
  const [histFlags, setHistFlags] = useState<HealthFlag[]>([]);

  const load = () => api<Health>('/system').then((r) => { setH(r); setError(''); }).catch((e: Error) => setError(e.message));
  usePoll(load, 15_000);

  const run = async () => {
    setRunning(true);
    await api<{ at: number; checks: Check[] }>('/system/run', 'POST').then((r) => setChecks({ at: r.at, list: r.checks })).catch((e: Error) => setError(e.message));
    setRunning(false);
  };

  // warnings from /system and from the history, one per kind (the earliest «с» wins)
  const flags = useMemo(() => {
    const m = new Map<string, HealthFlag>();
    for (const f of [...(h?.flags ?? []), ...histFlags]) {
      const old = m.get(f.kind);
      if (!old || f.since < old.since) m.set(f.kind, f);
    }
    return [...m.values()].sort((a, b) => a.since - b.since);
  }, [h, histFlags]);

  const diskUsed = h && h.diskTotal && h.diskFree != null ? 1 - h.diskFree / h.diskTotal : null;
  const memFrac = h ? h.memoryMb / MEM_REF_MB : null;
  const cpuFrac = h && h.load1 != null && h.cpuCount ? h.load1 / h.cpuCount : null;
  const dbFrac = h && h.dbBytes != null ? h.dbBytes / DB_REF_BYTES : null;

  const botTone: GaugeTone = !h ? 'mute' : h.bot.state === 'online' ? 'ok' : h.bot.state === 'connecting' ? 'warn' : h.bot.state === 'error' ? 'bad' : 'mute';
  const status: { k: string; v: string; sub?: string; tone: GaugeTone }[] = h
    ? [
        { k: t('d2.sys.s.version'), v: h.versionName || (h.version ? h.version.slice(0, 7) : t('d2.sys.s.fromSource')), sub: `Node ${h.node}`, tone: 'mute' },
        { k: t('d2.sys.s.uptime'), v: dur(h.uptimeSec), tone: 'ok' },
        { k: t('d2.sys.s.servers'), v: t('d2.sys.s.serversOnline', { a: h.counts.online, b: h.counts.servers }), tone: h.counts.servers === 0 ? 'mute' : h.counts.online === h.counts.servers ? 'ok' : h.counts.online === 0 ? 'bad' : 'warn' },
        { k: t('d2.sys.s.bindings'), v: String(h.counts.bindings), sub: t('d2.sys.s.guilds', { n: h.guilds }), tone: 'mute' },
        { k: t('d2.sys.s.bot'), v: h.bot.state === 'online' ? t('d2.sys.bot.online') : h.bot.state === 'idle' ? t('d2.sys.bot.idle') : h.bot.state === 'connecting' ? t('d2.sys.bot.connecting') : t('d2.sys.bot.error'), sub: h.bot.tag ?? (h.bot.updatedAt ? ago(h.bot.updatedAt) : undefined), tone: botTone },
        ...(h.cert ? [{ k: t('d2.sys.cert.title'), v: certText(h.cert), sub: [h.cert.issuer, h.cert.selfSigned ? t('d2.sys.cert.self') : null].filter(Boolean).join(' · ') || undefined, tone: certTone(h.cert) }] : []),
        { k: t('d2.sys.s.users'), v: String(h.counts.users), tone: 'mute' as GaugeTone },
      ]
    : [];
  const dot = { ok: 'dot-ok', warn: 'dot-warn', fail: 'dot-bad' } as const;

  return (
    <AdminPage
      head={(
        <PageHead
          icon={<IconSystem />}
          title={t('d2.sys.title')}
          subtitle={t('d2.sys.subtitle')}
          hint={t('d2.sys.hint')}
          help={<p>{t('d2.sys.help')}</p>}
        >
          <button className="btn" onClick={run} disabled={running}>{running ? t('d2.sys.running') : t('d2.sys.run')}</button>
        </PageHead>
      )}
    >
      {error && !h ? <LoadError error={error} onRetry={() => void load()} /> : <ErrorLine text={error} />}

      {flags.length > 0 && (
        <div className="space-y-2" role="group" aria-label={t('d2.sys.warnings')}>
          {flags.map((f) => (
            <Notice key={f.kind} tone="warn">
              {f.text}<span className="font-semibold opacity-80"> · {t('d2.sys.since')} {new Date(f.since).toDateString() === new Date().toDateString() ? fmtTime(f.since) : fmtDateTime(f.since)}</span>
            </Notice>
          ))}
        </div>
      )}

      {h ? (
        <>
          <div className="grid grid-cols-1 gap-4 min-[460px]:grid-cols-2 xl:grid-cols-4" role="group" aria-label={t('d2.sys.resources')}>
            <div className="panel p-5 text-center">
              <Gauge
                value={diskUsed}
                label={t('d2.sys.disk.used')}
                display={diskUsed == null ? '–' : `${Math.round(diskUsed * 100)} %`}
                caption={h.diskFree != null ? t('d2.sys.disk.free', { v: mb(h.diskFree) }) : undefined}
                icon={<IconDisk size={18} />}
              />
              <div className="mt-2 font-extrabold">{t('d2.sys.disk')}</div>
              <div className="text-sm font-semibold text-mute">{h.diskTotal ? t('d2.sys.disk.total', { v: mb(h.diskTotal) }) : t('d2.sys.disk.unknown')}</div>
            </div>
            <div className="panel p-5 text-center">
              <Gauge value={cpuFrac} tone={usageTone(cpuFrac)} label={t('d2.sys.cpu.load')} display={cpuFrac == null ? '–' : `${Math.round(cpuFrac * 100)} %`} caption={h.load1 != null ? `load ${h.load1}` : undefined} icon={<IconSystem size={18} />} />
              <div className="mt-2 font-extrabold">{t('d2.sys.cpu')}</div>
              <div className="text-sm font-semibold text-mute">{h.cpuCount ? t('d2.sys.cpu.cores', { n: h.cpuCount }) : t('d2.sys.noData')}</div>
            </div>
            <div className="panel p-5 text-center">
              <Gauge value={memFrac} tone={usageTone(memFrac)} label={t('d2.sys.mem.label')} display={t('d2.sys.mb', { v: h.memoryMb })} caption={t('d2.sys.mem.of', { v: MEM_REF_MB })} icon={<IconMemory size={18} />} />
              <div className="mt-2 font-extrabold">{t('d2.sys.mem')}</div>
              <div className="text-sm font-semibold text-mute">{t('d2.sys.mem.hint', { v: MEM_REF_MB })}</div>
            </div>
            <div className="panel p-5 text-center">
              <Gauge value={dbFrac} tone={usageTone(dbFrac)} label={t('d2.sys.db')} display={mb(h.dbBytes)} caption={t('d2.sys.db.ref')} icon={<IconDatabase size={18} />} />
              <div className="mt-2 font-extrabold">{t('d2.sys.db')}</div>
              <div className="text-sm font-semibold text-mute">{t('d2.sys.db.points', { n: h.counts.history.toLocaleString('ru-RU') })}</div>
            </div>
          </div>

          {h.cert && h.cert.daysLeft != null && (
            <Section title={t('d2.sys.cert.title')} description={h.cert.notAfter ? t('d2.sys.cert.until', { when: fmtDateTime(h.cert.notAfter) }) : undefined}>
              <div className="cert-bar" role="img" aria-label={t('d2.sys.cert.daysLeft', { n: h.cert.daysLeft })}>
                <i className={`is-${certTone(h.cert)}`} style={{ width: `${Math.max(2, Math.min(100, (h.cert.daysLeft / 90) * 100))}%` }} />
              </div>
              <p className="text-sm font-semibold text-mute">
                {t('d2.sys.cert.of90', { left: certText(h.cert) })}{h.cert.selfSigned ? ` · ${t('d2.sys.cert.selfWarn')}` : h.cert.issuer ? ` · ${t('d2.sys.cert.issuer', { name: h.cert.issuer })}` : ''}.
                {h.cert.daysLeft <= 14 ? ` ${t('d2.sys.cert.renew')}` : ''}
              </p>
            </Section>
          )}

          <Section title={t('d2.sys.state')}>
            <ul className="divide-y divide-line">
              {status.map((r) => (
                <li key={r.k} className="flex flex-wrap items-center gap-x-3 gap-y-0.5 py-2.5">
                  <span aria-hidden className={`h-2.5 w-2.5 shrink-0 rounded-full dot-${r.tone}`} />
                  <span className="font-extrabold">{r.k}</span>
                  {r.sub && <span className="min-w-0 wrap-break-word text-sm font-semibold text-mute">{r.sub}</span>}
                  <span className={`ml-auto font-black tabular-nums ${r.tone === 'bad' ? 'text-bad' : r.tone === 'warn' ? 'text-warn' : ''}`}>{r.v}</span>
                </li>
              ))}
            </ul>
          </Section>
        </>
      ) : (
        <div className="skeleton panel h-40" aria-busy="true" aria-label={t('d2.news.loading')} />
      )}

      <HealthHistoryCard onFlags={setHistFlags} />

      <Section title={t('d2.sys.diag')} description={t('d2.sys.diag.desc')}>
        {!checks && <p className="text-sm font-semibold text-mute">{t('d2.sys.diag.empty')}</p>}
        {checks && (
          <>
            <ul className="divide-y divide-line rounded-ui-lg border border-line">
              {checks.list.map((c) => (
                <li key={c.id} className="flex items-start gap-3 px-4 py-2.5">
                  <span className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${dot[c.status]}`} role="img" aria-label={c.status === 'ok' ? t('d2.sys.c.ok') : c.status === 'warn' ? t('d2.sys.c.warn') : t('d2.sys.c.fail')} />
                  <div className="min-w-0">
                    <div className="font-extrabold">{c.label}</div>
                    <div className="wrap-break-word text-sm font-semibold text-mute">{c.detail}</div>
                  </div>
                </li>
              ))}
            </ul>
            <p className="text-sm font-semibold text-mute">{t('d2.sys.checked', { when: fmtDateTime(checks.at) })}</p>
          </>
        )}
      </Section>

      <ProbesSection />

      <Strip>
        <div className="min-w-0">
          <h2 className="text-lg font-black">{t('d2.sys.backups')}</h2>
          <p className="font-semibold text-mute">{t('d2.sys.backups.text')}</p>
        </div>
        <GoLink href="/admin/settings/updates">{t('d2.sys.backups.link')}</GoLink>
      </Strip>
    </AdminPage>
  );
}
