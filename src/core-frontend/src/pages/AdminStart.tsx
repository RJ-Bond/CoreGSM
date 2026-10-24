import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, type BotStatus, type SettingsInfo } from '../api';
import { useAuth } from '../auth';
import { t, useI18n } from '../i18n';
import { AdminPage, PageHead, IconStart, IconServers, IconNews, IconDownload, IconSystem, navigate, toast, usePoll } from '../ui';
import { ADMIN_GROUPS, START_SECTION } from './adminNav';
import { downloadFile } from './Backups';

type StepId = 'server' | 'bot' | 'channel' | 'news' | 'brand';
type StepState = 'done' | 'todo' | 'unknown';

interface StepView {
  id: StepId;
  short: string;
  title: string;
  why: string;
  href: string;
  cta: string;
  state: StepState;
  note?: string;
}

const skipKey = (u: string) => `coregsm_start_skipped_${u}`;
const readSkipped = (u: string): StepId[] => {
  try {
    const v = JSON.parse(localStorage.getItem(skipKey(u)) ?? '[]') as unknown;
    return Array.isArray(v) ? (v.filter((x) => typeof x === 'string') as StepId[]) : [];
  } catch {
    return [];
  }
};
const writeSkipped = (u: string, list: StepId[]) => {
  try { localStorage.setItem(skipKey(u), JSON.stringify(list)); } catch { /* not remembered */ }
};

interface Raw {
  servers: number | null;
  settings: SettingsInfo | null;
  bot: BotStatus | null;
  bindings: number | null;
  news: number | null;
}

const len = (v: unknown) => (Array.isArray(v) ? v.length : null);

/** Reads the real state of the panel and turns it into the checklist. A failing request only marks its step «неизвестно». */
function useStartSteps() {
  const { me, access } = useAuth();
  const { lang } = useI18n();
  const username = me?.username ?? '';
  const [raw, setRaw] = useState<Raw | null>(null);
  const [skipped, setSkipped] = useState<StepId[]>(() => readSkipped(username));

  usePoll(async () => {
    const [s, st, b, bi, n] = await Promise.allSettled([
      api<unknown[]>('/servers'),
      api<SettingsInfo>('/settings'),
      api<BotStatus>('/bot/status'),
      api<unknown[]>('/bindings'),
      api<unknown[]>('/news'),
    ]);
    setRaw({
      servers: s.status === 'fulfilled' ? len(s.value) : null,
      settings: st.status === 'fulfilled' ? st.value : null,
      bot: b.status === 'fulfilled' ? b.value : null,
      bindings: bi.status === 'fulfilled' ? len(bi.value) : null,
      news: n.status === 'fulfilled' ? len(n.value) : null,
    });
  }, 15_000);

  const brand = access.brand;
  const brandDone = brand.name.trim().toLowerCase() !== 'coregsm' || brand.color.toLowerCase() !== '#4f46e5' || brand.hasLogo || !!brand.color2 || !!brand.preset;

  const steps = useMemo<StepView[] | null>(() => {
    if (!raw) return null;
    const st = (n: number | null): StepState => (n === null ? 'unknown' : n > 0 ? 'done' : 'todo');
    let bot: StepState = 'unknown';
    let botNote: string | undefined;
    if (raw.settings) {
      if (!raw.settings.discordTokenSet) bot = 'todo';
      else if (!raw.bot) bot = 'done';
      else if (raw.bot.state === 'online') bot = 'done';
      else {
        bot = 'todo';
        botNote = raw.bot.state === 'error' && raw.bot.error ? t('start.botErr', { e: raw.bot.error }) : t('start.botWait');
      }
    }
    return [
      { id: 'server', short: t('start.server.short'), title: t('start.server.title'), why: t('start.server.why'), href: '/admin/servers/new', cta: t('start.server.cta'), state: st(raw.servers) },
      { id: 'bot', short: t('start.bot.short'), title: t('start.bot.title'), why: t('start.bot.why'), href: '/admin/settings/bot', cta: t('start.bot.cta'), state: bot, note: botNote },
      { id: 'channel', short: t('start.channel.short'), title: t('start.channel.title'), why: t('start.channel.why'), href: '/admin/discord', cta: t('start.channel.cta'), state: st(raw.bindings) },
      { id: 'news', short: t('start.news.short'), title: t('start.news.title'), why: t('start.news.why'), href: '/admin/news/new', cta: t('start.news.cta'), state: st(raw.news) },
      { id: 'brand', short: t('start.brand.short'), title: t('start.brand.title'), why: t('start.brand.why'), href: '/admin/settings/brand', cta: t('start.brand.cta'), state: brandDone ? 'done' : 'todo' },
    ];
  }, [raw, brandDone, lang]);

  const skip = (id: StepId) => setSkipped((cur) => { const n = cur.includes(id) ? cur : [...cur, id]; writeSkipped(username, n); return n; });
  const unskip = (id: StepId) => setSkipped((cur) => { const n = cur.filter((x) => x !== id); writeSkipped(username, n); return n; });

  const doneCount = steps ? steps.filter((s) => s.state === 'done').length : 0;
  // «resolved»: finished or consciously skipped: the start page then stops being the default
  const resolved = steps ? steps.every((s) => s.state === 'done' || skipped.includes(s.id)) : false;
  return { loading: steps === null, steps: steps ?? [], skipped, skip, unskip, doneCount, total: 5, resolved };
}

/** A compact progress card for the sidebar: «Настройка 4 из 5» with the first step left; hidden when everything is done or skipped. */
export function SetupProgress() {
  useI18n();
  const s = useStartSteps();
  if (s.loading || s.resolved || s.steps.length === 0) return null;
  const left = s.steps.find((x) => x.state !== 'done' && !s.skipped.includes(x.id));
  const pct = Math.round((s.doneCount / s.total) * 100);
  return (
    <div className="hidden md:block">
      <a href="/admin/start" className="adm-progress" aria-label={t('start.progress', { a: s.doneCount, b: s.total })}>
        <span className="flex items-baseline justify-between gap-2"><b>{t('start.setup')}</b><span>{t('start.ofTotal', { a: s.doneCount, b: s.total })}</span></span>
        <span className="adm-progress-bar" aria-hidden><i style={{ width: `${pct}%` }} /></span>
        {left && <span className="adm-progress-left">{t('start.next')} {left.short}</span>}
      </a>
    </div>
  );
}

/** `/admin` without a section: «Начало работы» while something is left, «Серверы» when everything is done. */
export function AdminHome() {
  const s = useStartSteps();
  useEffect(() => {
    if (s.loading) return;
    const target = s.resolved ? '/admin/servers' : '/admin/start';
    navigate(target, { replace: true });
  }, [s.loading, s.resolved]);
  return <StartSkeleton />;
}

function StartSkeleton() {
  return (
    <div className="space-y-5" aria-busy="true" aria-label={t('adm.loading')}>
      <div className="skeleton h-14 w-72 rounded-2xl" />
      <div className="skeleton tile h-28" />
      {[0, 1, 2].map((i) => <div key={i} className="skeleton tile h-24" />)}
    </div>
  );
}

const Check = ({ size = 22 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M5 12.5l4.5 4.5L19 7.5" />
  </svg>
);

function Ring({ done, total }: { done: number; total: number }) {
  const r = 30;
  const c = 2 * Math.PI * r;
  return (
    <div className="relative grid h-[76px] w-[76px] shrink-0 place-items-center" aria-hidden>
      <svg width="76" height="76" viewBox="0 0 76 76" className="-rotate-90">
        <circle cx="38" cy="38" r={r} fill="none" stroke="rgb(var(--soft))" strokeWidth="8" />
        <circle
          cx="38" cy="38" r={r} fill="none" stroke="rgb(var(--brand))" strokeWidth="8" strokeLinecap="round"
          strokeDasharray={c} strokeDashoffset={c * (1 - done / total)}
          style={{ transition: 'stroke-dashoffset .6s cubic-bezier(.2,.8,.2,1)' }}
          className="motion-reduce:transition-none!"
        />
      </svg>
      <span className="absolute text-lg font-black tabular-nums">{done}/{total}</span>
    </div>
  );
}

export default function AdminStart() {
  const { me } = useAuth();
  const s = useStartSteps();
  const [busy, setBusy] = useState(false);

  const firstTodo = s.steps.find((x) => x.state !== 'done' && !s.skipped.includes(x.id));
  const allDone = !s.loading && s.doneCount === s.total;
  const left = s.steps.filter((x) => x.state !== 'done');

  const backup = async () => {
    setBusy(true);
    try {
      await downloadFile('/backup', 'coregsm-backup.tar.gz');
      toast(t('start.backupDone'));
    } catch (e) {
      toast((e as Error).message, 'err');
    } finally {
      setBusy(false);
    }
  };

  const quick: { key: string; label: string; text: string; icon: ReactNode; href?: string; onClick?: () => void }[] = [
    { key: 'server', label: t('start.q.server'), text: t('start.q.server.t'), icon: <IconServers />, href: '/admin/servers/new' },
    { key: 'news', label: t('start.q.news'), text: t('start.q.news.t'), icon: <IconNews />, href: '/admin/news/new' },
    { key: 'backup', label: busy ? t('start.q.backupBusy') : t('start.q.backup'), text: t('start.q.backup.t'), icon: <IconDownload />, onClick: () => void backup() },
    { key: 'system', label: t('start.q.system'), text: t('start.q.system.t'), icon: <IconSystem />, href: '/admin/system' },
    { key: 'player', label: t('start.q.player'), text: t('start.q.player.t'), icon: <IconStart />, href: '/servers' },
  ];

  return (
    <AdminPage
      head={(
        <PageHead
          icon={<IconStart />}
          title={t('adm.s.start')}
          subtitle={me ? t('start.hello', { name: me.username }) : t('start.five')}
          hint={t('start.hint')}
          help={<p>{t('start.help')}</p>}
        />
      )}
    >

      {s.loading ? (
        <StartSkeleton />
      ) : (
        <>
          {allDone ? (
            <div className="tile fade-in flex flex-wrap items-center gap-4 p-5" role="status">
              <span className="pop grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-okbg text-ok"><Check size={30} /></span>
              <div className="min-w-0 flex-1 basis-60">
                <h2 className="text-xl font-extrabold leading-tight">{t('start.allDone')}</h2>
                <p className="font-semibold text-mute">{t('start.allDoneText')}</p>
              </div>
              <a className="btn" href="/admin/servers">{t('start.toServers')}</a>
            </div>
          ) : (
            <div className="tile flex flex-wrap items-center gap-4 p-5">
              <Ring done={s.doneCount} total={s.total} />
              <div className="min-w-0 flex-1 basis-60">
                <h2 className="text-xl font-extrabold leading-tight">{t('start.stepsDone', { a: s.doneCount, b: s.total })}</h2>
                <p className="font-semibold text-mute">
                  {left.length > 0 ? t('start.left', { list: left.map((x) => x.short).join(', ') }) : ''}
                </p>
              </div>
              {firstTodo && <a className="btn" href={firstTodo.href}>{t('start.continue')} {firstTodo.cta.toLowerCase()}</a>}
            </div>
          )}

          <ol className="space-y-3" aria-label={t('start.stepsLabel')}>
            {s.steps.map((st, i) => {
              const skipped = s.skipped.includes(st.id) && st.state !== 'done';
              const current = firstTodo?.id === st.id;
              return (
                <li key={st.id} className={`tile flex flex-wrap items-center gap-x-4 gap-y-3 p-4 sm:p-5 ${current ? 'ring-2 ring-brand/50' : ''}`}>
                  <span
                    className={`grid h-12 w-12 shrink-0 place-items-center rounded-2xl text-xl font-black ${
                      st.state === 'done' ? 'bg-okbg text-ok' : st.state === 'unknown' || skipped ? 'bg-soft text-mute' : 'bg-linear-to-br from-brand to-brand-2 text-white shadow-pop'
                    }`}
                    aria-hidden
                  >
                    {st.state === 'done' ? <Check /> : st.state === 'unknown' ? '?' : i + 1}
                  </span>
                  <div className="min-w-0 flex-1 basis-60">
                    <h3 className="flex flex-wrap items-center gap-2 font-extrabold leading-tight">
                      <span>{st.title}</span>
                      {st.state === 'done' && <span className="pill pill-ok">{t('start.pill.done')}</span>}
                      {st.state === 'unknown' && <span className="pill pill-mute">{t('start.pill.unknown')}</span>}
                      {skipped && <span className="pill pill-mute">{t('start.pill.skipped')}</span>}
                    </h3>
                    <p className="text-sm font-semibold text-mute">{st.why}</p>
                    {st.note && st.state !== 'done' && <p className="mt-1 text-sm font-bold text-warn">{st.note}</p>}
                  </div>
                  <div className="flex flex-wrap items-center gap-2 max-sm:w-full">
                    <a className={`btn ${current || st.state === 'unknown' ? '' : 'btn-soft'} ${st.state === 'done' ? 'btn-sm' : ''}`} href={st.href}>
                      {st.state === 'done' ? t('adm.open') : st.cta}
                    </a>
                    {st.state !== 'done' && !skipped && (
                      <button type="button" className="btn btn-ghost btn-sm" onClick={() => s.skip(st.id)}>
                        {t('start.skip')}
                      </button>
                    )}
                    {skipped && (
                      <button type="button" className="btn btn-ghost btn-sm" onClick={() => s.unskip(st.id)}>
                        {t('start.unskip')}
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ol>
        </>
      )}

      <section aria-labelledby="start-quick">
        <h2 id="start-quick" className="mb-3 text-lg font-black">{t('start.quick')}</h2>
        <div className="grid grid-cols-1 gap-3 min-[480px]:grid-cols-2 lg:grid-cols-3">
          {quick.map((q) => {
            const inner = (
              <>
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-soft text-link">{q.icon}</span>
                <span className="min-w-0">
                  <span className="block font-extrabold leading-tight">{q.label}</span>
                  <span className="block text-sm font-semibold text-mute">{q.text}</span>
                </span>
              </>
            );
            const cls = 'tile tile-hover flex items-center gap-3 p-3.5 text-left';
            return q.href ? (
              <a key={q.key} className={cls} href={q.href}>{inner}</a>
            ) : (
              <button key={q.key} type="button" className={cls} onClick={q.onClick} disabled={busy}>{inner}</button>
            );
          })}
        </div>
      </section>

      <details className="tile start-map group p-5 sm:p-6">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 [&::-webkit-details-marker]:hidden">
          <span>
            <span className="block text-lg font-black">{t('start.map')}</span>
            <span className="block font-semibold text-mute">{t('start.mapText')}</span>
          </span>
          <svg aria-hidden width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-mute transition-transform group-open:rotate-180"><path d="M6 9l6 6 6-6" /></svg>
        </summary>
        <div className="mt-4 grid gap-x-8 gap-y-5 md:grid-cols-2">
          {ADMIN_GROUPS.map((g, gi) => (
            <div key={g.title}>
              <div className="adm-group-title px-0!">{g.title}</div>
              <ul className="space-y-1">
                {gi === 0 && <MapRow id={START_SECTION.id} label={START_SECTION.label} desc={START_SECTION.desc} icon={START_SECTION.icon()} />}
                {g.sections.map((sec) => <MapRow key={sec.id} id={sec.id} label={sec.label} desc={sec.desc} icon={sec.icon()} />)}
              </ul>
            </div>
          ))}
        </div>
      </details>
    </AdminPage>
  );
}

function MapRow({ id, label, desc, icon }: { id: string; label: string; desc: string; icon: ReactNode }) {
  return (
    <li>
      <a href={`/admin/${id}`} className="flex items-start gap-3 rounded-ui-lg px-2 py-2 transition hover:bg-soft">
        <span className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-soft text-link">{icon}</span>
        <span className="min-w-0">
          <span className="block font-extrabold leading-tight">{label}</span>
          <span className="block text-sm font-semibold text-mute">{desc}</span>
        </span>
      </a>
    </li>
  );
}
