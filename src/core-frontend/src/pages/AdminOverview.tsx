import { useState } from 'react';
import { api, type BackupInfo, type BotStatus, type CertInfo, type Server, type UpdateInfo, type UserRow } from '../api';
import type { OverviewData } from '../components/servers/overviewLogic';
import { t, useI18n } from '../i18n';
import { AdminPage, Button, PageHead, Section, SmoothArea, ago, fmtDateTime, toast, usePoll } from '../ui';
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

function Tile({ label, value, sub, tone, href }: { label: string; value: string; sub?: string; tone?: 'ok' | 'warn' | 'bad'; href?: string }) {
  const body = (
    <>
      <span className="adm-tile-k">{label}</span>
      <span className={`adm-tile-v ${tone ? `is-${tone}` : ''}`}>{value}</span>
      {sub && <span className="adm-tile-s">{sub}</span>}
    </>
  );
  return href ? <a href={href} className="adm-tile">{body}</a> : <div className="adm-tile">{body}</div>;
}

/** «Сводка»: the state of the panel now, what needs attention, the last actions and the common jobs in one click */
export default function AdminOverview() {
  useI18n();
  const [raw, setRaw] = useState<Raw | null>(null);
  const [busy, setBusy] = useState<'poll' | 'backup' | null>(null);

  const load = async () => {
    const [servers, overview, users, backups, update, bot, sys, audit] = await Promise.allSettled([
      api<Server[]>('/servers'),
      api<OverviewData>('/overview?hours=24'),
      api<UserRow[]>('/users'),
      api<BackupInfo>('/backups'),
      api<UpdateInfo>('/update/status'),
      api<BotStatus>('/bot/status'),
      api<{ cert?: CertInfo }>('/system'),
      api<AuditRow[]>('/audit?limit=5'),
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
      toast((e as Error).message, 'err');
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
          <div className="adm-tiles">
            <Tile label={t('adm.ov.servers')} value={servers.length ? `${online} / ${servers.length}` : '–'} tone={servers.length === 0 ? undefined : down.length ? 'bad' : 'ok'} href="/admin/servers" />
            <Tile label={t('adm.ov.players')} value={String(players)} href="/admin/servers" />
            <Tile label={t('adm.ov.pending')} value={raw.users ? String(pending) : '–'} tone={pending > 0 ? 'warn' : undefined} href="/admin/users" />
            <Tile label={t('adm.ov.backup')} value={raw.backups ? (lastBackup ? ago(lastBackup) : t('adm.ov.noBackup')) : '–'} tone={raw.backups && (!lastBackup || Date.now() - lastBackup > WEEK) ? 'warn' : undefined} href="/admin/settings/updates" />
            <Tile label={t('adm.ov.version')} value={raw.update?.current ? raw.update.current.slice(0, 7) : '–'} sub={raw.update?.available ? t('adm.ov.upd') : undefined} tone={raw.update?.available ? 'warn' : undefined} href="/admin/settings/updates" />
          </div>

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

          <Section title={t('adm.ov.recent')} actions={<a href="/admin/journal" className="text-sm font-extrabold text-link hover:underline">{t('adm.ov.journal')}</a>}>
            {raw.audit && raw.audit.length > 0 ? (
              <ul className="divide-y divide-line">
                {raw.audit.map((r) => (
                  <li key={r.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 py-2">
                    <span className="w-32 shrink-0 text-sm font-semibold tabular-nums text-mute" title={fmtDateTime(r.ts)}>{ago(r.ts)}</span>
                    <span className="font-extrabold">{r.action}</span>
                    {r.detail && <span className="min-w-0 truncate font-semibold text-mute">{r.detail}</span>}
                    <span className="ml-auto rounded-full bg-soft px-2.5 py-0.5 text-sm font-bold text-link">{r.actor}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="font-semibold text-mute">{t('adm.ov.noEvents')}</p>
            )}
          </Section>
        </>
      )}
    </AdminPage>
  );
}
