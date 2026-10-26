import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { api, getToken, type Server, type Session } from '../api';
import EmailVerifyState from '../components/EmailVerifyState';
import { useAuth } from '../auth';
import { restartTour } from '../components/Tour';
import { confirmDialog } from '../confirm';
import { t, useI18n, type TKey } from '../i18n';
import { ActivityFeed } from '../components/profile/Activity';
import { AvatarEditor } from '../components/profile/AvatarEditor';
import { BannerEditor } from '../components/profile/BannerEditor';
import { bannerStyle } from '../components/profile/banner';
import { AchievementsGrid, AchievementsPreview } from '../components/profile/Achievements';
import { RankCard, RankHeaderBadge, VrAchievementsGrid, useMyRank } from '../components/profile/VrRank';
import { JournalCard } from '../components/profile/Journal';
import { NewDeviceBanner } from '../components/profile/NewDeviceBanner';
import { PushCard } from '../components/profile/PushCard';
import { FollowsCard } from '../components/profile/Follows';
import { NewsSubsCard } from '../components/profile/NewsSubs';
import { TwoFactorCard } from '../components/profile/TwoFactorCard';
import { AppearanceCard, RegionCard } from '../components/profile/LookRegion';
import { PlayerCard } from '../components/profile/PlayerCard';
import { StatsPanel, StatsSummary, useMyStats } from '../components/profile/Stats';
import { deviceName } from '../components/profile/format';
import { IconUser } from '../icons';
import { IcoDiscord, IcoGamepad, IcoHome, IcoLogout, IcoShield, IcoSliders } from '../components/profile/bits';
import { isNewDeviceDismissed } from '../security';
import { ago, Button, ErrorLine, isLag, FieldError, GameAvatar, PageHead, PasswordField, PasswordStrength, Section, StatusPill, UserAvatar, toast, useRoute, errText } from '../ui';

type Tab = 'overview' | 'player' | 'look' | 'security';
const TABS: { id: Tab; label: TKey; icon: ReactNode }[] = [
  { id: 'overview', label: 'pf.tab.overview', icon: <IcoHome /> },
  { id: 'player', label: 'pf.tab.player', icon: <IcoGamepad /> },
  { id: 'look', label: 'pf.tab.look', icon: <IcoSliders /> },
  { id: 'security', label: 'pf.tab.security', icon: <IcoShield /> },
];

/** The signed-in user's own page: tabs «Обзор», «Игрок», «Оформление и регион», «Безопасность». The tab lives in the address (/profile/security). */
export default function ProfilePage() {
  const { me } = useAuth();
  const { sub } = useRoute();
  useI18n();
  if (!me) return null;
  const newLogin = !!me.newDevice && !isNewDeviceDismissed(me.newDevice.ts);
  const first = sub.split('/')[0];
  const tab: Tab = TABS.some((x) => x.id === first) ? (first as Tab) : 'overview';

  return (
    <div className="space-y-5">
      <PageHead title={t('pf.title')} subtitle={t('pf.subtitle')} icon={<IconUser />} />

      <div className="pf-tabs">
        <nav className="seg" aria-label={t('pf.tabs')}>
          {TABS.map((x) => (
            <a key={x.id} href={`/profile/${x.id}`} className="seg-item pf-tab" aria-current={tab === x.id ? 'page' : undefined}>
              {x.icon}{t(x.label)}
              {x.id === 'security' && newLogin && <span className="pf-tab-dot" title={t('pf.tab.alert')}><span className="sr-only">{t('pf.tab.alert')}</span></span>}
            </a>
          ))}
        </nav>
      </div>

      {tab === 'overview' && <OverviewTab />}
      {tab === 'player' && <PlayerTab />}
      {tab === 'look' && <LookTab />}
      {tab === 'security' && <SecurityTab />}
    </div>
  );
}

// ---------- «Обзор» ----------
function OverviewTab() {
  const { me, isAdmin, logout, reload } = useAuth();
  const [favs, setFavs] = useState<Server[] | null>(null);
  const [editBanner, setEditBanner] = useState(false);
  const stats = useMyStats(30);
  const rank = useMyRank().data;

  useEffect(() => {
    Promise.all([api<number[]>('/favorites'), api<Server[]>('/servers')])
      .then(([ids, servers]) => setFavs(servers.filter((s) => ids.includes(s.id))))
      .catch(() => setFavs([]));
  }, []);
  if (!me) return null;

  const role = me.role === 'admin' ? t('pf.role.admin') : me.role === 'moderator' ? t('pf.role.moderator') : t('pf.role.player');

  return (
    <div className="space-y-5">
      <NewDeviceBanner />
      <Greeting name={me.username} lastSeen={stats.data?.lastSeenAt ?? null} />
      <div className="panel pf-hero">
        <div className="pf-banner" style={bannerStyle(me.bannerUrl, me.bannerPreset)}>
          <button type="button" className="pf-banner-btn" aria-expanded={editBanner} onClick={() => setEditBanner((v) => !v)}>
            {editBanner ? t('pf.banner.close') : t('pf.banner.edit')}
          </button>
        </div>
        <div className="pf-hero-body">
          <div className="pf-hero-avatar"><AvatarEditor onChanged={reload} size={80} ring={rank && rank.nick ? rank.rank.color : null} /></div>
          <div className="min-w-0 flex-1 basis-56 pt-3">
            <div className="line-clamp-2 wrap-break-word text-2xl font-black leading-tight">{me.username}</div>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <span className={`pill ${isAdmin ? 'pill-ok' : 'pill-mute'}`}>{role}</span>
              <RankHeaderBadge />
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              {me.discordName && <span className="pf-meta"><IcoDiscord />{me.discordName}</span>}
            </div>
          </div>
          <button className="btn btn-soft btn-sm pf-icon-btn mt-3" onClick={logout} title={t('hdr.logout')} aria-label={t('hdr.logout')}><IcoLogout /><span className="max-sm:sr-only">{t('hdr.logout')}</span></button>
        </div>
      </div>

      {editBanner && <BannerEditor onChanged={reload} />}

      <StatsSummary data={stats.data} />

      <div className="grid items-start gap-5 lg:grid-cols-2">
        <div className="space-y-5">
          <AchievementsPreview />
          <Section title={t('pf.favs.title')}>
            {favs === null && <div className="skeleton h-20 rounded-2xl bg-soft" />}
            {favs && favs.length === 0 && <p className="font-semibold text-mute">{t('pf.favs.none')}</p>}
            {favs?.map((s) => (
              <a key={s.id} href={`/servers/${s.id}`} className="flex items-center gap-3 rounded-2xl bg-soft px-3 py-2.5 transition hover:ring-2 hover:ring-brand/30">
                <GameAvatar game={s.game} size={36} />
                <span className="min-w-0 flex-1 truncate font-bold">{s.name}</span>
                <StatusPill online={s.online} known={s.hasStatus} lag={isLag(s)} />
              </a>
            ))}
          </Section>
        </div>
        <ActivityFeed />
      </div>

      {isAdmin && (
        <Section title={t('pf.tour.title')} description={t('pf.tour.text')} actions={<button className="btn btn-soft" onClick={() => restartTour(me.username)}>{t('pf.tour.again')}</button>} />
      )}
    </div>
  );
}

/** «Добрый день, имя» and when the player was last in the game */
function Greeting({ name, lastSeen }: { name: string; lastSeen: number | null }) {
  const h = new Date().getHours();
  const key = h < 5 ? 'pf.greet.night' : h < 12 ? 'pf.greet.morning' : h < 18 ? 'pf.greet.day' : 'pf.greet.evening';
  return (
    <div className="pf-greet">
      <h2>{t(key, { name })}</h2>
      {lastSeen ? <p>{t('pf.greet.seen', { when: ago(lastSeen) })}</p> : null}
    </div>
  );
}

// ---------- «Игрок» ----------
function PlayerTab() {
  return (
    <div className="space-y-5">
      <PlayerCard />
      <RankCard />
      <StatsPanel />
      <AchievementsGrid />
      <VrAchievementsGrid />
    </div>
  );
}

// ---------- «Оформление и регион» ----------
function LookTab() {
  return (
    <div className="grid items-start gap-5 md:grid-cols-2">
      <AppearanceCard />
      <RegionCard />
    </div>
  );
}

// ---------- «Безопасность» ----------
function SecurityTab() {
  const { me, reload } = useAuth();
  const [rev, setRev] = useState(0);
  if (!me) return null;
  return (
    <div className="space-y-5">
      <NewDeviceBanner onRevoked={() => setRev((x) => x + 1)} />
      <div className="grid items-start gap-5 md:grid-cols-2">
        <EmailCard onChanged={reload} />
        <PasswordCard hasPassword={me.hasPassword} discordLinked={!!me.discordName} onChanged={reload} />
        <TwoFactorCard />
        <DiscordCard onChanged={reload} />
        <PushCard />
        <FollowsCard />
        <NewsSubsCard />
        <SessionsCard key={rev} />
      </div>
      <JournalCard onRevoked={() => setRev((x) => x + 1)} />
    </div>
  );
}

function PasswordCard({ hasPassword, discordLinked, onChanged }: { hasPassword: boolean; discordLinked: boolean; onChanged: () => Promise<void> }) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [again, setAgain] = useState('');
  const [againErr, setAgainErr] = useState('');
  const [curErr, setCurErr] = useState('');
  const [nextErr, setNextErr] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const curRef = useRef<HTMLInputElement>(null);
  const nextRef = useRef<HTMLInputElement>(null);
  const againRef = useRef<HTMLInputElement>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setCurErr(''); setNextErr(''); setAgainErr(''); setError('');
    if (hasPassword && !current) { setCurErr(t('pf.pass.enterCurrent')); curRef.current?.focus(); return; }
    if (next.length < 8) { setNextErr(t('pf.pass.min')); nextRef.current?.focus(); return; }
    if (again !== next) { setAgainErr(t('pf.pass.mismatch')); againRef.current?.focus(); return; }
    setBusy(true);
    try {
      await api('/auth/password', 'POST', hasPassword ? { current, next, confirm: again } : { next, confirm: again });
      toast(hasPassword ? t('pf.pass.changed') : t('pf.pass.set'));
      setCurrent('');
      setNext('');
      setAgain('');
      await onChanged();
    } catch (err) {
      setError(errText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} noValidate className="panel space-y-3.5 p-6">
      <h2 className="text-lg font-black">{hasPassword ? t('pf.pass.titleChange') : t('pf.pass.titleSet')}</h2>
      {!hasPassword && <p className="font-semibold text-mute">{discordLinked ? t('pf.pass.discordNoNeed') : t('pf.pass.discordOnly')}</p>}
      {hasPassword && (
        <PasswordField id="pf-current" ref={curRef} label={t('pf.pass.current')} value={current} onChange={setCurrent} autoComplete="current-password" error={curErr} />
      )}
      <PasswordField id="pf-next" ref={nextRef} label={t('pf.pass.new')} value={next} onChange={setNext} autoComplete="new-password" error={nextErr}>
        <PasswordStrength password={next} />
      </PasswordField>
      <PasswordField id="pf-again" ref={againRef} label={t('pf.pass.again')} value={again} onChange={(v) => { setAgain(v); setAgainErr(''); }} autoComplete="new-password" error={againErr} />
      {again && next && again === next && !againErr && <p className="-mt-1 text-sm font-bold text-ok">{t('pf.pass.match')}</p>}
      <ErrorLine text={error} />
      <Button loading={busy}>{hasPassword ? t('pf.pass.save') : t('pf.pass.titleSet')}</Button>
    </form>
  );
}

/** Account e-mail: a recovery and notification address. Changing it asks for the current password. */
function EmailCard({ onChanged }: { onChanged: () => Promise<void> }) {
  const { me } = useAuth();
  const [email, setEmail] = useState(me?.email ?? '');
  const [current, setCurrent] = useState('');
  const [error, setError] = useState('');
  const [fieldErr, setFieldErr] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { setEmail(me?.email ?? ''); }, [me?.email]);
  if (!me) return null;
  const saved = me.email ?? '';
  const dirty = email.trim().toLowerCase() !== saved.toLowerCase();

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(''); setFieldErr('');
    const v = email.trim();
    if (v && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v)) { setFieldErr(t('pf.email.invalid')); return; }
    if (me.hasPassword && !current) { setError(t('pf.email.needPassword')); return; }
    setBusy(true);
    try {
      await api('/me/email', 'PUT', { email: v, current: me.hasPassword ? current : undefined });
      toast(v ? t('pf.email.saved') : t('pf.email.removed'));
      setCurrent('');
      await onChanged();
    } catch (err) {
      setError(errText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} noValidate className="panel space-y-3.5 p-6">
      <h2 className="text-lg font-black">{t('pf.email.title')}</h2>
      <p className="font-semibold text-mute">{t('pf.email.text')}</p>
      <div>
        <label htmlFor="pf-email" className="label">{t('pf.email.address')}</label>
        <input id="pf-email" className="input" type="email" inputMode="email" autoComplete="email" value={email} onChange={(e) => { setEmail(e.target.value); setFieldErr(''); }} placeholder="name@example.com" aria-invalid={fieldErr ? true : undefined} />
        <FieldError id="pf-email-err" text={fieldErr} />
      </div>
      {dirty && me.hasPassword && (
        <PasswordField id="pf-email-pass" label={t('pf.email.confirm')} value={current} onChange={setCurrent} autoComplete="current-password" />
      )}
      {!dirty && <EmailVerifyState />}
      <ErrorLine text={error} />
      <Button loading={busy} disabled={!dirty}>{email.trim() ? t('pf.email.save') : t('pf.email.remove')}</Button>
    </form>
  );
}

function DiscordCard({ onChanged }: { onChanged: () => Promise<void> }) {
  const { me, access } = useAuth();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  if (!me) return null;

  const unlink = async () => {
    const ok = await confirmDialog({ title: t('pf.discord.unlinkTitle'), text: t('pf.discord.unlinkText'), confirmLabel: t('pf.discord.unlink'), cancelLabel: t('common.cancel'), danger: true });
    if (!ok) return;
    setBusy(true);
    setError('');
    try {
      await api('/me/discord', 'DELETE');
      toast(t('pf.discord.unlinked'));
      await onChanged();
    } catch (err) {
      setError(errText(err));
    } finally {
      setBusy(false);
    }
  };
  const link = () => { window.location.href = `/api/auth/discord/start?mode=link&t=${encodeURIComponent(getToken())}`; };

  return (
    <div className="panel space-y-3.5 p-6">
      <h2 className="text-lg font-black">Discord</h2>
      {me.discordName ? (
        <>
          <div className="flex items-center gap-3 rounded-2xl bg-soft px-3 py-2.5">
            <UserAvatar name={me.discordName} url={me.avatarUrl} size={40} tone="brand" />
            <div className="min-w-0 flex-1">
              <div className="truncate font-extrabold">{me.discordName}</div>
              <div className="text-sm font-semibold text-mute">{t('pf.discord.linked')}</div>
            </div>
            <button className="btn btn-danger btn-sm" onClick={() => void unlink()} disabled={busy}>{t('pf.discord.unlink')}</button>
          </div>
          <ErrorLine text={error} />
        </>
      ) : (
        <>
          <p className="font-semibold text-mute">
            {access.discordLogin ? t('pf.discord.linkText') : t('pf.discord.notConfigured')}
          </p>
          <button className="btn" onClick={link} disabled={!access.discordLogin}>{t('pf.discord.link')}</button>
        </>
      )}
    </div>
  );
}

function SessionsCard() {
  const [list, setList] = useState<Session[] | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    api<Session[]>('/sessions').then(setList).catch((e: Error) => { setList([]); setError(e.message); });
  }, []);
  useEffect(load, [load]);

  const end = async (s: Session) => {
    setError('');
    await api(`/sessions/${s.id}`, 'DELETE').then(() => toast(t('pf.sessions.ended'))).catch((e: Error) => setError(e.message));
    load();
  };
  const endOthers = async () => {
    const ok = await confirmDialog({ title: t('pf.sessions.endAllTitle'), text: t('pf.sessions.endAllText'), confirmLabel: t('pf.sessions.endConfirm'), cancelLabel: t('common.cancel'), danger: true });
    if (!ok) return;
    setBusy(true);
    setError('');
    await api<{ revoked: number }>('/sessions/revoke-others', 'POST')
      .then((r) => toast(t('pf.sessions.revoked', { n: r.revoked })))
      .catch((e: Error) => setError(e.message));
    setBusy(false);
    load();
  };

  const others = list?.filter((s) => !s.current).length ?? 0;

  return (
    <div className="panel space-y-3 p-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-black">{t('pf.sessions.title')}</h2>
        {others > 0 && <button className="btn btn-soft btn-sm" onClick={() => void endOthers()} disabled={busy}>{t('pf.sessions.endOthers')}</button>}
      </div>
      {list === null && <div className="skeleton h-16 rounded-2xl bg-soft" />}
      <ul className="space-y-2">
        {list?.map((s) => (
          <li key={s.id} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-2xl bg-soft px-4 py-3">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-extrabold">{deviceName(s.ua)}</span>
                {s.current && <span className="pill pill-ok">{t('pf.sessions.thisDevice')}</span>}
              </div>
              <div className="truncate text-sm font-semibold text-mute">
                {s.ip || t('pf.sessions.ipUnknown')} · {s.current ? t('pf.sessions.now') : ago(s.lastSeen)}
              </div>
            </div>
            {!s.current && <button className="btn btn-danger btn-sm" onClick={() => void end(s)}>{t('pf.sessions.end')}</button>}
          </li>
        ))}
      </ul>
      <FieldError id="sessions-err" text={error} />
    </div>
  );
}
