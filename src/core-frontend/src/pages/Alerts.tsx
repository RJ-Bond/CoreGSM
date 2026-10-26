import { useState } from 'react';
import { t, useI18n, type TKey } from '../i18n';
import DigestSection from '../components/DigestSection';
import { api, type SettingsInfo } from '../api';
import { ChannelPicker } from '../components/ChannelPicker';
import { AlertsArt } from '../components/Illustrations';
import { AdminPage, ErrorLine, GoLink, IconBell, LoadError, Notice, PageHead, Section, Switch, ago, toast, usePoll } from '../ui';

interface AlertsInfo {
  enabled: boolean;
  channelId: string;
  channelName: string | null;
  guildName: string | null;
  afterMin: number;
  mention: 'none' | 'here' | 'everyone';
  smart?: { low: boolean; ping: boolean; full: boolean };
  quiet?: { enabled: boolean; from: number; to: number; now: boolean };
  recent: { id: number; kind: keyof typeof KIND; serverName: string; status: string; error: string | null; createdAt: number; sentAt: number | null }[];
}

const KIND = {
  down: { label: 'al.k.down', cls: 'pill-bad' },
  up: { label: 'al.k.up', cls: 'pill-ok' },
  test: { label: 'al.k.test', cls: 'pill-mute' },
  low: { label: 'al.k.low', cls: 'pill-warn' },
  ping: { label: 'al.k.ping', cls: 'pill-warn' },
  full: { label: 'al.k.full', cls: 'pill-mute' },
  digest: { label: 'al.k.digest', cls: 'pill-ok' },
  restart: { label: 'al.k.restart', cls: 'pill-mute' },
  update: { label: 'al.k.update', cls: 'pill-ok' },
  disk: { label: 'al.k.disk', cls: 'pill-warn' },
  poll: { label: 'al.k.poll', cls: 'pill-ok' },
} as const satisfies Record<string, { label: TKey; cls: string }>;
/** a kind the panel does not know (a newer server, an old row) must not break the page */
const kindOf = (k: string): { label: TKey; cls: string } => (KIND as Record<string, { label: TKey; cls: string }>)[k] ?? KIND.test;

const SMART: { key: 'low' | 'ping' | 'full'; title: TKey; text: TKey }[] = [
  { key: 'low', title: 'al.s.low', text: 'al.s.lowText' },
  { key: 'ping', title: 'al.s.ping', text: 'al.s.pingText' },
  { key: 'full', title: 'al.s.full', text: 'al.s.fullText' },
];

/** what each kind of message looks like in the channel */
const SAMPLES: { kind: keyof typeof KIND; icon: string; text: TKey; on: (i: AlertsInfo) => boolean }[] = [
  { kind: 'down', icon: '🔴', text: 'al.m.down', on: (i) => i.enabled },
  { kind: 'up', icon: '🟢', text: 'al.m.up', on: (i) => i.enabled },
  { kind: 'low', icon: '📉', text: 'al.m.low', on: (i) => i.enabled && !!i.smart?.low },
  { kind: 'ping', icon: '📶', text: 'al.m.ping', on: (i) => i.enabled && !!i.smart?.ping },
  { kind: 'full', icon: '👥', text: 'al.m.full', on: (i) => i.enabled && !!i.smart?.full },
];

/** the cards of the message kinds: a sample line and whether the kind is on */
function KindCards({ info }: { info: AlertsInfo }) {
  const where = info.channelId ? (info.channelName ? `# ${info.channelName}` : t('al.where.channel', { id: info.channelId })) : t('al.where.none');
  return (
    <Section title={t('al.kinds')} description={t('al.kinds.text')}>
      <div className="al-kinds">
        {SAMPLES.map((x) => {
          const on = x.on(info);
          return (
            <div key={x.kind} className={`al-kind ${on ? '' : 'is-off'}`}>
              <div className="flex items-center gap-2"><span className={`pill ${KIND[x.kind].cls}`}>{t(KIND[x.kind].label)}</span><span className="ml-auto text-xs font-bold text-mute">{on ? t('al.on') : t('al.off')}</span></div>
              <p className="al-msg"><span aria-hidden>{x.icon}</span> {t(x.text)}</p>
              <p className="text-xs font-semibold text-mute">{where}</p>
            </div>
          );
        })}
      </div>
    </Section>
  );
}

const HOURS = Array.from({ length: 24 }, (_, h) => h);
const hh = (h: number) => `${String(h).padStart(2, '0')}:00`;

/** quiet hours: the messages keep coming, only without @here / @everyone */
function QuietHours({ info, save }: { info: AlertsInfo; save: (p: { quiet: { enabled: boolean; from: number; to: number } }, done?: string) => Promise<void> }) {
  const q = info.quiet ?? { enabled: false, from: 23, to: 8, now: false };
  const set = (patch: Partial<{ enabled: boolean; from: number; to: number }>) => void save({ quiet: { enabled: q.enabled, from: q.from, to: q.to, ...patch } });
  const span = q.from === q.to ? 0 : (q.to - q.from + 24) % 24;
  return (
    <Section title={t('al.q.title')} description={t('al.q.text')}>
      <label className="flex cursor-pointer items-center gap-3">
        <Switch checked={q.enabled} onChange={(on) => set({ enabled: on })} />
        <span className="font-extrabold">{t('al.q.noMention')}</span>
        {q.enabled && <span className={`pill ml-auto ${q.now ? 'pill-warn' : 'pill-mute'}`}>{q.now ? t('al.q.now') : t('al.q.normal')}</span>}
      </label>
      {q.enabled && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <label htmlFor="quiet-from" className="label">{t('al.q.from')}</label>
              <select id="quiet-from" className="input" value={q.from} onChange={(e) => set({ from: Number(e.target.value) })}>{HOURS.map((h) => <option key={h} value={h}>{hh(h)}</option>)}</select>
            </div>
            <div>
              <label htmlFor="quiet-to" className="label">{t('al.q.to')}</label>
              <select id="quiet-to" className="input" value={q.to} onChange={(e) => set({ to: Number(e.target.value) })}>{HOURS.map((h) => <option key={h} value={h}>{hh(h)}</option>)}</select>
            </div>
            <p className="pb-2 text-sm font-semibold text-mute">{span === 0 ? t('al.q.same') : t('al.q.span', { n: span })}</p>
          </div>
          {/* the day at a glance: shaded cells are quiet */}
          <div className="qh-day" role="img" aria-label={t('al.q.aria', { a: hh(q.from), b: hh(q.to) })}>
            {HOURS.map((h) => {
              const quiet = span > 0 && (q.from < q.to ? h >= q.from && h < q.to : h >= q.from || h < q.to);
              return <span key={h} className={quiet ? 'is-quiet' : ''} title={`${hh(h)}${quiet ? t('al.q.quiet') : ''}`} />;
            })}
          </div>
          <div className="qh-ticks" aria-hidden><span>0</span><span>6</span><span>12</span><span>18</span><span>24</span></div>
        </div>
      )}
    </Section>
  );
}

/** the delivery queue in one line: how many left, are waiting, failed */
function Queue({ recent }: { recent: AlertsInfo['recent'] }) {
  const sent = recent.filter((r) => r.status === 'sent').length;
  const wait = recent.filter((r) => r.status === 'queued' || r.status === 'sending').length;
  const bad = recent.filter((r) => r.status === 'error').length;
  const pct = (n: number) => `${(n / recent.length) * 100}%`;
  return (
    <div className="space-y-1.5">
      <div className="al-queue" role="img" aria-label={t('al.queue.aria', { sent, wait, bad })}>
        <i className="is-ok" style={{ width: pct(sent) }} /><i className="is-warn" style={{ width: pct(wait) }} /><i className="is-bad" style={{ width: pct(bad) }} />
      </div>
      <p className="text-xs font-bold text-mute">{t('al.queue.line', { sent, wait, bad })}{bad > 0 ? t('al.queue.first') : ''}</p>
    </div>
  );
}

/** Messages to a Discord channel when a game server stops answering and when it is back. */
export default function AlertsPage() {
  useI18n();
  const [info, setInfo] = useState<AlertsInfo | null>(null);
  const [error, setError] = useState('');
  const [changing, setChanging] = useState(false);
  const [tokenSet, setTokenSet] = useState<boolean | null>(null);

  const load = () => {
    api<SettingsInfo>('/settings').then((s) => setTokenSet(s.discordTokenSet)).catch(() => undefined);
    return api<AlertsInfo>('/alerts').then((a) => { setInfo(a); setError(''); }).catch((e: Error) => setError(e.message));
  };
  usePoll(load, 10_000);

  const save = async (patch: Partial<Pick<AlertsInfo, 'enabled' | 'channelId' | 'afterMin' | 'mention' | 'smart'>> & { quiet?: { enabled: boolean; from: number; to: number } }, done?: string) => {
    await api<AlertsInfo>('/alerts', 'PUT', patch)
      .then((a) => { setInfo(a); setError(''); if (done) toast(done); })
      .catch((e: Error) => setError(e.message));
  };
  const test = async () => {
    await api<AlertsInfo>('/alerts/test', 'POST').then((a) => { setInfo(a); toast(t('al.test.done')); }).catch((e: Error) => setError(e.message));
  };

  return (
    <AdminPage
      narrow
      head={(
        <PageHead
          icon={<IconBell />}
          title={t('al.title')}
          subtitle={t('al.sub')}
          hint={t('al.hint')}
          help={<p>{t('al.help')}</p>}
        >
          <button className="btn btn-soft" onClick={() => void test()} disabled={!info?.channelId}>{t('al.sendTest')}</button>
        </PageHead>
      )}
    >
      {error && !info ? <LoadError error={error} onRetry={() => void load()} /> : <ErrorLine text={error} />}
      {tokenSet === false && (
        <Notice action={<GoLink href="/admin/settings/bot">{t('al.noToken')}</GoLink>}>
          {t('al.noTokenText')}
        </Notice>
      )}

      {info && (
        <Section>
          <label className="flex cursor-pointer items-start gap-3">
            <Switch className="mt-0.5" checked={info.enabled} onChange={(on) => void save({ enabled: on }, on ? t('al.on.done') : t('al.off.done'))} />
            <span>
              <span className="block font-extrabold">{t('al.enable')}</span>
              <span className="block text-sm font-semibold text-mute">{t('al.enableText')}</span>
            </span>
          </label>

          <div>
            <span className="label">{t('al.channel')}</span>
            <div className="flex flex-wrap items-center gap-3">
              <span className="font-black">{info.channelId ? (info.channelName ? `# ${info.channelName}${info.guildName ? ` · ${info.guildName}` : ''}` : t('al.channel.n', { id: info.channelId })) : t('al.channel.none')}</span>
              <button className="btn btn-soft btn-sm" onClick={() => setChanging((v) => !v)} aria-expanded={changing}>{info.channelId ? t('al.change') : t('al.pick')}</button>
            </div>
            {changing && (
              <div className="mt-3">
                <ChannelPicker id="alerts-channel" value={info.channelId} onChange={(v) => { if (/^\d{15,25}$/.test(v)) { void save({ channelId: v }, t('al.channel.saved')); setChanging(false); } }} />
              </div>
            )}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="alerts-after" className="label">{t('al.after')}</label>
              <select id="alerts-after" className="input" value={info.afterMin} onChange={(e) => void save({ afterMin: Number(e.target.value) }, t('al.saved'))}>
                {[1, 2, 3, 5, 10, 15, 30, 60].map((m) => <option key={m} value={m}>{t('al.after.n', { n: m })}</option>)}
              </select>
              <p className="mt-1 text-sm font-semibold text-mute">{t('al.afterText')}</p>
            </div>
            <div>
              <label htmlFor="alerts-mention" className="label">{t('al.mention')}</label>
              <select id="alerts-mention" className="input" value={info.mention} onChange={(e) => void save({ mention: e.target.value as AlertsInfo['mention'] }, t('al.saved'))}>
                <option value="none">{t('al.mention.none')}</option>
                <option value="here">{t('al.mention.here')}</option>
                <option value="everyone">@everyone</option>
              </select>
              <p className="mt-1 text-sm font-semibold text-mute">{t('al.mentionText')}</p>
            </div>
          </div>
        </Section>
      )}

      {info && (
        <Section title={t('al.smart')} description={t('al.smartText')}>
          {SMART.map((r) => (
            <label key={r.key} className="flex cursor-pointer items-start gap-3">
              <Switch className="mt-0.5" checked={!!info.smart?.[r.key]} disabled={!info.enabled} onChange={(on) => void save({ smart: { ...(info.smart ?? { low: false, ping: false, full: false }), [r.key]: on } }, on ? t('al.smart.on') : t('al.smart.off'))} />
              <span>
                <span className="block font-extrabold">{t(r.title)}</span>
                <span className="block text-sm font-semibold text-mute">{t(r.text)}</span>
              </span>
            </label>
          ))}
          {!info.enabled && <p className="text-sm font-semibold text-mute">{t('al.smart.first')}</p>}
        </Section>
      )}

      {info && <KindCards info={info} />}

      {info && <QuietHours info={info} save={save} />}

      <DigestSection alertsChannel={info?.channelId ?? ''} />

      <Section title={t('al.recent')}>
        {!info && <div className="skeleton h-14 rounded-ui-lg" aria-busy="true" aria-label={t('al.loading')} />}
        {info && info.recent.length === 0 && (
          <div className="fade-in flex flex-col items-center gap-1 py-2 text-center">
            <AlertsArt />
            <p className="font-extrabold">{t('al.none')}</p>
            <p className="max-w-sm text-sm font-semibold text-mute">
              {info.channelId ? t('al.none.ch') : t('al.none.noCh')}
            </p>
            {!info.channelId && <button className="btn mt-2" onClick={() => setChanging(true)}>{t('al.pick')}</button>}
          </div>
        )}
        {info && info.recent.length > 0 && <Queue recent={info.recent} />}
        <ul className="divide-y divide-line">
          {info && [...info.recent].sort((a, b) => Number(b.status === 'error') - Number(a.status === 'error')).map((r) => (
            <li key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5">
              <span className={`pill ${kindOf(r.kind).cls}`}>{t(kindOf(r.kind).label)}</span>
              <span className="min-w-0 flex-1 truncate font-bold">{r.serverName}</span>
              {r.status === 'sent' && <span className="text-sm font-semibold text-mute">{t('al.sent', { ago: ago(r.sentAt) })}</span>}
              {(r.status === 'queued' || r.status === 'sending') && <span className="text-sm font-semibold text-warn">{t('al.waits')}</span>}
              {r.status === 'error' && <span className="text-sm font-bold text-bad" title={r.error ?? ''}>{t('al.failed', { e: r.error ?? '' })}</span>}
            </li>
          ))}
        </ul>
      </Section>
    </AdminPage>
  );
}
