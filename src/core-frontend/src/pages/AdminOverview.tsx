import { useState } from 'react';
import { useAuth } from '../auth';
import { delta, dayKey, healthScore } from './adminLogic';
import { api, type BackupInfo, type BotStatus, type CertInfo, type Server, type UpdateInfo, type UserRow } from '../api';
import type { OverviewData } from '../components/servers/overviewLogic';
import { t, useI18n, type TKey } from '../i18n';
import { AdminPage, Button, PageHead, Section, SmoothArea, ago, fmtDateTime, toast, usePoll, fail } from '../ui';
import { Icon } from '../icons';
import { downloadFile } from './Backups';

interface AuditRow { id: number; ts: number; actor: string; action: string; detail: string }

interface Raw {
  servers: Server[] | null;
  overview: OverviewData | null;
  users: UserRow[] | null;
  backups: BackupInfo | null;
  update: UpdateInfo | null;
  bot: BotStatus | null;
  cert: CertInfo | null;
  audit: AuditRow[] | null;
}

interface Attention { id: string; tone: 'bad' | 'warn' | 'info'; text: string; href: string }

const ok = <T,>(r: PromiseSettledResult<T>): T | null => (r.status === 'fulfilled' ? r.value : null);
const WEEK = 7 * 86_400_000;

function Tile({ label, value, sub, tone, href, change, spark }: { label: string; value: string; sub?: string; tone?: 'ok' | 'warn' | 'bad'; href?: string; change?: { text: string; tone: 'up' | 'down' } | null; spark?: number[] }) {
  useI18n();
  const body = (
    <>
      <span className="adm-tile-k">{label}</span>
      <span className="adm-tile-row">
        <span className={`adm-tile-v ${tone ? `is-${tone}` : ''}`}>{value}</span>
        {change && <span className={`adm-delta is-${change.tone}`} title={t('d2.ao.24h')}>{change.text}</span>}
      </span>
      {spark && spark.length >= 3 && <SmoothArea values={spark} color="rgb(var(--link))" w={160} h={28} fill={0.18} strokeWidth={1.5} className="adm-tile-spark" label={label} />}
      {sub && <span className="adm-tile-s">{sub}</span>}
    </>
  );
  return href ? <a href={href} className="adm-tile">{body}</a> : <div className="adm-tile">{body}</div>;
}

const REASON_TEXT: Record<string, TKey> = {
  down: 'd2.ao.r.down',
  bot: 'd2.ao.r.bot',
  cert: 'd2.ao.r.cert',
  backup: 'd2.ao.r.backup',
  pending: 'd2.ao.r.pending',
  update: 'd2.ao.r.update',
};

/** The ring of the panel's health: the number in the middle, the reasons under it */
function HealthRing({ score, reasons }: { score: number; reasons: { id: string; cost: number; tone: string }[] }) {
  useI18n();
  const R = 38;
  const C = 2 * Math.PI * R;
  const tone = score >= 90 ? 'ok' : score >= 65 ? 'warn' : 'bad';
  return (
    <section className="panel adm-health" aria-label={t('d2.ao.health')}>
      <svg viewBox="0 0 100 100" className="adm-ring" role="img" aria-label={t('d2.ao.healthScore', { n: score })}>
        <circle cx="50" cy="50" r={R} className="adm-ring-bg" />
        <circle cx="50" cy="50" r={R} className={`adm-ring-fg is-${tone}`} strokeDasharray={C} strokeDashoffset={C * (1 - score / 100)} transform="rotate(-90 50 50)" />
        <text x="50" y="56" textAnchor="middle" className="adm-ring-n">{score}</text>
      </svg>
      <div className="min-w-0">
        <p className="font-extrabold">{score >= 90 ? t('d2.ao.h.ok') : score >= 65 ? t('d2.ao.h.look') : t('d2.ao.h.act')}</p>
        {reasons.length === 0 ? (
          <p className="text-sm font-semibold text-mute">{t('d2.ao.h.allOk')}</p>
        ) : (
          <ul className="mt-1 flex flex-wrap gap-1.5">
            {reasons.map((r) => <li key={r.id} className={`adm-reason is-${r.tone}`}>{REASON_TEXT[r.id] ? t(REASON_TEXT[r.id]) : r.id} <b>−{r.cost}</b></li>)}
          </ul>
        )}
      </div>
    </section>
  );
}

const DUTY: { id: string; text: TKey; href: string }[] = [
  { id: 'servers', text: 'd2.ao.duty.servers', href: '/admin/servers' },
  { id: 'users', text: 'd2.ao.duty.users', href: '/admin/users' },
  { id: 'backup', text: 'd2.ao.duty.backup', href: '/admin/settings/updates' },
  { id: 'journal', text: 'd2.ao.duty.journal', href: '/admin/journal' },
];

/** The checks of the day: kept in this browser, start anew each day */
function Duty() {
  useI18n();
  const key = `adm-duty-${dayKey()}`;
  const [done, setDone] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem(key) ?? '[]') as string[]; } catch { return []; }
  });
  const toggle = (id: string) => {
    const next = done.includes(id) ? done.filter((x) => x !== id) : [...done, id];
    setDone(next);
    try { localStorage.setItem(key, JSON.stringify(next)); } catch { /* private mode */ }
  };
  const left = DUTY.filter((d) => !done.includes(d.id)).length;
  return (
    <Section title={t('d2.ao.duty')} description={left === 0 ? t('d2.ao.duty.allDone') : t('d2.ao.duty.left', { a: left, b: DUTY.length })}>
      <ul className="space-y-1.5">
        {DUTY.map((d) => (
          <li key={d.id} className="adm-duty">
            <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2.5">
              <input type="checkbox" checked={done.includes(d.id)} onChange={() => toggle(d.id)} />
              <span className={`font-bold ${done.includes(d.id) ? 'text-mute line-through' : ''}`}>{t(d.text)}</span>
            </label>
            <a href={d.href} className="text-sm font-extrabold text-link hover:underline">{t('d2.ao.open')}</a>
          </li>
        ))}
      </ul>
    </Section>
  );
}

function auditTone(action: string): string {
  if (/delete|remove|удал/i.test(action)) return 'is-del';
  if (/create|add|создан|добав/i.test(action)) return 'is-add';
  if (/login|password|2fa|security|вход|парол/i.test(action)) return 'is-sec';
  return '';
}

/** «Сводка»: the state of the panel now, what needs attention, the last actions and the common jobs in one click */
export default function AdminOverview() {
  useI18n();
  const [raw, setRaw] = useState<Raw | null>(null);
  const [busy, setBusy] = useState<'poll' | 'backup' | null>(null);
  const { me } = useAuth();
  const [mine, setMine] = useState(false);

  const load = async () => {
    const [servers, overview, users, backups, update, bot, sys, audit] = await Promise.allSettled([
      api<Server[]>('/servers'),
      api<OverviewData>('/overview?hours=24'),
      api<UserRow[]>('/users'),
      api<BackupInfo>('/backups'),
      api<UpdateInfo>('/update/status'),
      api<BotStatus>('/bot/status'),
      api<{ cert?: CertInfo }>('/system'),
      api<AuditRow[]>('/audit?limit=30'),
    ]);
    setRaw({
      servers: ok(servers), overview: ok(overview), users: ok(users), backups: ok(backups), update: ok(update), bot: ok(bot),
      cert: ok(sys)?.cert ?? null, audit: ok(audit),
    });
  };
  usePoll(load, 30_000);

  const servers = raw?.servers ?? [];
  const online = servers.filter((s) => s.online).length;
  const down = servers.filter((s) => !s.online && s.hasStatus && !s.maintenance);
  const players = servers.reduce((n, s) => n + (s.online ? s.players : 0), 0);
  const pending = (raw?.users ?? []).filter((u) => u.status === 'pending').length;
  const lastBackup = raw?.backups?.items.reduce<number>((m, b) => Math.max(m, b.createdAt), 0) ?? 0;

  const attention: Attention[] = [];
  if (down.length > 0) {
    const names = down.slice(0, 3).map((s) => s.name).join(', ');
    attention.push({ id: 'down', tone: 'bad', text: t('adm.ov.down', { names }) + (down.length > 3 ? t('adm.ov.downMore', { k: down.length - 3 }) : ''), href: '/admin/servers' });
  }
  if (raw?.bot?.state === 'error') attention.push({ id: 'bot', tone: 'bad', text: t('adm.ov.botErr'), href: '/admin/settings/bot' });
  if (raw?.cert && raw.cert.daysLeft != null && raw.cert.daysLeft <= 14) {
    attention.push({ id: 'cert', tone: raw.cert.daysLeft <= 0 ? 'bad' : 'warn', text: raw.cert.daysLeft <= 0 ? t('adm.ov.certGone') : t('adm.ov.certSoon', { k: raw.cert.daysLeft }), href: '/admin/system' });
  }
  if (pending > 0) attention.push({ id: 'pending', tone: 'warn', text: t('adm.ov.pend', { k: pending }), href: '/admin/users' });
  if (raw?.update?.available) attention.push({ id: 'update', tone: 'info', text: t('adm.ov.upd'), href: '/admin/settings/updates' });
  if (raw?.backups) {
    if (raw.backups.items.length === 0) attention.push({ id: 'nobackup', tone: 'warn', text: t('adm.ov.noBackups'), href: '/admin/settings/updates' });
    else if (Date.now() - lastBackup > WEEK) attention.push({ id: 'oldbackup', tone: 'warn', text: t('adm.ov.oldBackup'), href: '/admin/settings/updates' });
  }

  const points = raw?.overview?.points ?? [];
  const series = points.map((p) => p.players);
  const health = healthScore({
    servers: servers.length, down: down.length, botError: raw?.bot?.state === 'error', certDays: raw?.cert?.daysLeft ?? null,
    pending, updateAvailable: !!raw?.update?.available, backupAgeMs: lastBackup ? Date.now() - lastBackup : null, backupsKnown: !!raw?.backups,
  });
  const avatarOf = (name: string) => raw?.users?.find((u) => u.username === name)?.avatarUrl ?? null;
  const auditRows = (raw?.audit ?? []).filter((r) => !mine || r.actor === me?.username).slice(0, 10);

  const pollAll = async () => {
    setBusy('poll');
    await Promise.allSettled(servers.map((s) => api(`/servers/${s.id}/refresh`, 'POST')));
    toast(t('adm.ov.polled'));
    await load();
    setBusy(null);
  };
  const backupNow = async () => {
    setBusy('backup');
    try {
      await downloadFile('/backup', 'coregsm-backup.tar.gz');
      toast(t('adm.ov.backupDone'));
    } catch (e) {
      fail(e);
    }
    setBusy(null);
  };

  return (
    <AdminPage head={<PageHead title={t('adm.ov.title')} subtitle={t('adm.ov.subtitle')} icon={<Icon size={22}><rect x="3" y="3" width="7" height="9" rx="1.5" /><rect x="14" y="3" width="7" height="5" rx="1.5" /><rect x="14" y="12" width="7" height="9" rx="1.5" /><rect x="3" y="16" width="7" height="5" rx="1.5" /></Icon>} />}>
      {!raw ? (
        <div className="space-y-5" aria-busy="true" aria-label={t('adm.loading')}>
          <div className="adm-tiles">{[0, 1, 2, 3, 4].map((i) => <div key={i} className="skeleton h-24 rounded-2xl" />)}</div>
          <div className="skeleton tile h-32" />
        </div>
      ) : (
        <>
          <HealthRing score={health.score} reasons={health.reasons} />

          <div className="adm-tiles">
            <Tile label={t('adm.ov.servers')} value={servers.length ? `${online} / ${servers.length}` : '–'} tone={servers.length === 0 ? undefined : down.length ? 'bad' : 'ok'} href="/admin/servers" />
            <Tile label={t('adm.ov.players')} value={String(players)} change={delta(players, series[0])} spark={series} href="/admin/servers" />
            <Tile label={t('adm.ov.pending')} value={raw.users ? String(pending) : '–'} tone={pending > 0 ? 'warn' : undefined} href="/admin/users" />
            <Tile label={t('adm.ov.backup')} value={raw.backups ? (lastBackup ? ago(lastBackup) : t('adm.ov.noBackup')) : '–'} tone={raw.backups && (!lastBackup || Date.now() - lastBackup > WEEK) ? 'warn' : undefined} href="/admin/settings/updates" />
            <Tile label={t('adm.ov.version')} value={raw.update?.currentLabel || (raw.update?.current ? raw.update.current.slice(0, 7) : '–')} sub={raw.update?.available ? t('adm.ov.upd') : undefined} tone={raw.update?.available ? 'warn' : undefined} href="/admin/settings/updates" />
          </div>

          {servers.length > 0 && (
            <div className="adm-now" role="list" aria-label={t('d2.ao.now')}>
              {servers.map((s) => (
                <a key={s.id} role="listitem" href={`/servers/${s.id}`} className={`adm-now-card ${s.maintenance ? 'is-maint' : s.online ? 'is-on' : 'is-off'}`}>
                  <span className="adm-now-dot" aria-hidden />
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-extrabold">{s.name}</span>
                    <span className="block text-xs font-semibold tabular-nums text-mute">{s.maintenance ? t('d2.ao.maint') : s.online ? `${s.players} / ${s.maxPlayers}` : t('d2.ao.down')}</span>
                  </span>
                </a>
              ))}
            </div>
          )}

          <Section title={t('adm.ov.attn')}>
            {attention.length === 0 ? (
              <div className="st-calm">
                <span aria-hidden>✓</span>
                <div>
                  <p className="font-extrabold">{t('adm.ov.allGood')}</p>
                  <p className="text-sm font-semibold text-mute">{t('adm.ov.allGoodText')}</p>
                </div>
              </div>
            ) : (
              <ul className="space-y-2">
                {attention.map((a) => (
                  <li key={a.id} className={`adm-attn is-${a.tone}`}>
                    <span className="adm-attn-dot" aria-hidden />
                    <span className="min-w-0 flex-1 font-bold">{a.text}</span>
                    <a href={a.href} className="btn btn-soft btn-sm">{t('adm.ov.fix')}</a>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <div className="grid items-start gap-5 lg:grid-cols-2">
            <Section title={t('adm.ov.chart')} description={raw.overview?.peak ? t('adm.ov.chartPeak', { k: raw.overview.peak.players }) : undefined}>
              {series.length >= 3 ? (
                <SmoothArea values={series} color="rgb(var(--link))" w={400} h={90} fill={0.22} strokeWidth={2} className="h-24" label={t('adm.ov.chart')} />
              ) : (
                <p className="font-semibold text-mute">{t('adm.ov.chartNone')}</p>
              )}
            </Section>

            <Section title={t('adm.ov.quick')}>
              <div className="flex flex-wrap gap-2">
                <a href="/admin/servers/new" className="btn">{t('adm.ov.addServer')}</a>
                <a href="/admin/news/new" className="btn btn-soft">{t('adm.ov.writeNews')}</a>
                <Button type="button" variant="soft" loading={busy === 'poll'} disabled={servers.length === 0} onClick={() => void pollAll()}>{t('adm.ov.pollAll')}</Button>
                <Button type="button" variant="soft" loading={busy === 'backup'} onClick={() => void backupNow()}>{t('adm.ov.backupNow')}</Button>
              </div>
            </Section>
          </div>

          <div className="grid items-start gap-5 lg:grid-cols-[2fr_1fr]">
            <Section
              title={t('adm.ov.recent')}
              actions={
                <span className="flex items-center gap-3">
                  <button type="button" className="adm-chip" aria-pressed={mine} onClick={() => setMine((v) => !v)}>{t('d2.ao.mine')}</button>
                  <a href="/admin/journal" className="text-sm font-extrabold text-link hover:underline">{t('adm.ov.journal')}</a>
                </span>
              }
            >
              {auditRows.length > 0 ? (
                <ul className="divide-y divide-line">
                  {auditRows.map((r) => {
                    const pic = avatarOf(r.actor);
                    return (
                      <li key={r.id} className="flex items-center gap-3 py-2">
                        {pic ? (
                          <img src={pic} alt="" width={28} height={28} loading="lazy" referrerPolicy="no-referrer" className="adm-av" />
                        ) : (
                          <span className="adm-av" aria-hidden>{r.actor.slice(0, 1).toUpperCase()}</span>
                        )}
                        <div className="min-w-0 flex-1">
                          <p className="truncate"><span className={`adm-act ${auditTone(r.action)}`}>{r.action}</span>{r.detail && <span className="ml-2 font-semibold text-mute">{r.detail}</span>}</p>
                          <p className="text-xs font-semibold text-mute" title={fmtDateTime(r.ts)}>{r.actor} · {ago(r.ts)}</p>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className="font-semibold text-mute">{mine ? t('d2.ao.noMine') : t('adm.ov.noEvents')}</p>
              )}
            </Section>
            <Duty />
          </div>
        </>
      )}
    </AdminPage>
  );
}
