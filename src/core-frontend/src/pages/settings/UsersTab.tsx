/** Users: registration and access settings, pending requests, roles and passwords. */
import { useEffect, useRef, useState } from 'react';
import { type Access, api, type Perm, PERM_LABELS, type UserRow } from '../../api';
import '../../styles/admin.css';
import { useAuth } from '../../auth';
import { Switch as ToggleSwitch } from '../../components/Switch';
import { promptDialog } from '../../confirm';
import { getPrefs, t, useI18n, type TKey } from '../../i18n';
import { AdminPage, DiscordBadge, ErrorLine, GoLink, IconKey, IconTrash, IconUsers, PageHead, SaveBadge, Section, TextField, UserAvatar, ago, toast, undoable, useAutosave } from '../../ui';
import { SaveBarProvider, useSaveBar, useSaveBarActive } from '../../saveBar';

function Switch({ on, onChange, label, hint }: { on: boolean; onChange: (v: boolean) => void; label: string; hint: string }) {
  return (
    <label className="flex cursor-pointer items-start gap-3">
      <ToggleSwitch className="mt-0.5" checked={on} onChange={onChange} />
      <span>
        <span className="block font-extrabold">{label}</span>
        <span className="block text-sm font-semibold text-mute">{hint}</span>
      </span>
    </label>
  );
}

/** ready sets of moderator permissions */
const PERM_PRESETS: { label: TKey; perms: Perm[] }[] = [
  { label: 'us.preset.news', perms: ['news'] },
  { label: 'us.preset.comm', perms: ['news', 'moderation', 'journal'] },
  { label: 'us.preset.srv', perms: ['servers', 'maintenance'] },
  { label: 'us.preset.none', perms: [] },
];

const ONLINE_MS = 5 * 60_000;
/** «в сети» / «был 3 ч назад» / «ещё не заходил» */
function seenText(u: UserRow, now = Date.now()): { online: boolean; text: string } {
  if (!u.lastSeen) return { online: false, text: t('us.seen.never') };
  if (now - u.lastSeen < ONLINE_MS) return { online: true, text: t('us.seen.online') };
  return { online: false, text: t('us.seen.was', { ago: ago(u.lastSeen) }) };
}

const ROLE_LABEL = (r: UserRow['role']): string => t(`us.role.${r}` as const);

/** The users page: the rules text joins the common save bar. */
export function UsersTab() {
  return <SaveBarProvider><UsersTabInner /></SaveBarProvider>;
}

function UsersTabInner() {
  useI18n();
  const { me, reload } = useAuth();
  const [access, setAccess] = useState<Access | null>(null);
  const [users, setUsers] = useState<UserRow[]>([]);
  const [error, setError] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [q, setQ] = useState('');
  const [roleFilter, setRoleFilter] = useState<'all' | UserRow['role']>('all');
  const [picked, setPicked] = useState<number[]>([]);
  const [hidden, setHidden] = useState<number[]>([]);
  const [rules, setRules] = useState('');
  const rulesInit = useRef(false);

  const load = () => {
    api<Access>('/access').then((a) => {
      setAccess(a);
      // the text is taken from the server once: a later reload must not replace what is being typed
      if (!rulesInit.current) { rulesInit.current = true; setRules(a.rules ?? ''); }
    }).catch((e) => setError(e.message));
    api<UserRow[]>('/users').then(setUsers).catch((e) => setError(e.message)).finally(() => setLoaded(true));
  };
  useEffect(load, []);

  const save = async (patch: Partial<Access>) => {
    await api<Access>('/access', 'PUT', patch).then((a) => { setAccess(a); void reload(); toast(t('us.saved')); }).catch((e) => setError(e.message));
  };
  const approve = async (u: UserRow) => {
    await api(`/users/${u.id}/approve`, 'POST').then(() => toast(t('us.approved', { name: u.username }))).catch((e) => setError(e.message));
    load();
  };
  // an account that is deleted goes out of the list at once and can be taken back for 6 s; the request is sent after that
  const dropUsers = (list: UserRow[], text: string) => {
    const ids = list.map((u) => u.id);
    setHidden((h) => [...h, ...ids]);
    setPicked((p) => p.filter((x) => !ids.includes(x)));
    undoable({
      text,
      restore: () => setHidden((h) => h.filter((x) => !ids.includes(x))),
      commit: async () => {
        const res = await Promise.allSettled(ids.map((id) => api(`/users/${id}`, 'DELETE')));
        if (res.some((r) => r.status === 'rejected')) setError(t('us.delFail'));
        setHidden((h) => h.filter((x) => !ids.includes(x)));
        load();
      },
    });
  };
  const reject = (u: UserRow) => dropUsers([u], t('us.rejected'));
  const approveMany = async (list: UserRow[]) => {
    const res = await Promise.allSettled(list.map((u) => api(`/users/${u.id}/approve`, 'POST')));
    const bad = res.filter((r) => r.status === 'rejected').length;
    toast(bad ? t('us.approvedMany', { a: list.length - bad, b: bad }) : t('us.approvedAll', { n: list.length }), bad ? 'err' : undefined);
    setPicked([]);
    load();
  };
  // the rules text is saved as you type (after a pause and on leaving the field); the text is never replaced under the cursor
  const bar = useSaveBarActive();
  const rulesAuto = useAutosave({
    manual: bar,
    value: rules,
    saved: access?.rules ?? '',
    enabled: !!access,
    delay: 1200,
    equal: (a, b) => a.trim() === b.trim(),
    validate: (v) => (v.length > 5000 ? t('us.rulesMax') : null),
    save: async (v) => {
      const a = await api<Access>('/access', 'PUT', { rules: v.trim() });
      setAccess(a);
      void reload();
    },
  });
  useSaveBar('rules', t('us.rulesBar'), rulesAuto.status, rulesAuto.saveNow, () => setRules(access?.rules ?? ''));
  const setPerms = async (u: UserRow, perms: Perm[]) => {
    await api(`/users/${u.id}`, 'PUT', { role: u.role, perms }).then(() => { toast(t('us.permsSaved')); void load(); }).catch((e) => setError(e.message));
  };
  const setRole = async (u: UserRow, role: UserRow['role']) => {
    await api(`/users/${u.id}`, 'PUT', { role }).then(() => toast(t('us.roleChanged'))).catch((e) => setError(e.message));
    load();
  };
  const resetPassword = async (u: UserRow) => {
    const pw = await promptDialog({
      title: t('us.pwTitle', { name: u.username }),
      label: t('us.pwLabel'),
      password: true,
      confirmLabel: t('us.pwBtn'),
      validate: (v) => (v.length < 8 ? t('us.pwMin') : null),
    });
    if (!pw) return;
    await api(`/users/${u.id}/password`, 'PUT', { password: pw }).then(() => toast(t('us.pwDone'))).catch((e) => setError(e.message));
  };
  const remove = (u: UserRow) => dropUsers([u], t('us.userDeleted'));

  const visible = users.filter((u) => !hidden.includes(u.id));
  const pendingUsers = visible.filter((u) => u.status === 'pending');
  const needle = q.trim().toLowerCase();
  const listed = visible.filter((u) => (roleFilter === 'all' || u.role === roleFilter) && (!needle || `${u.username} ${u.discordName ?? ''}`.toLowerCase().includes(needle)));
  const pickedPending = pendingUsers.filter((u) => picked.includes(u.id));
  const togglePick = (id: number) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));

  return (
    <AdminPage
      head={(
        <PageHead
          icon={<IconUsers />}
          title={t('us.title')}
          subtitle={t('us.sub')}
          hint={t('us.hint')}
          help={<p>{t('us.help')}</p>}
        >
          <a className="btn btn-soft" href="/admin/journal">{t('us.journal')}</a>
        </PageHead>
      )}
    >
      <Section title={t('us.who')}>
        {access && (
          <>
            <Switch on={access.publicPanel} onChange={(v) => void save({ publicPanel: v })} label={t('us.public')} hint={t('us.publicHint')} />
            <Switch on={access.registration} onChange={(v) => void save({ registration: v })} label={t('us.reg')} hint={t('us.regHint')} />
            <div className="pl-8">
              <label htmlFor="reg-mode" className="label">{t('us.regMode')}</label>
              <select id="reg-mode" className="input w-auto! max-w-full" value={access.registrationMode} disabled={!access.registration} onChange={(e) => void save({ registrationMode: e.target.value as Access['registrationMode'] })}>
                <option value="open">{t('us.regOpen')}</option>
                <option value="approval">{t('us.regApproval')}</option>
              </select>
            </div>
          </>
        )}
        <p className="text-sm font-semibold text-mute">{t('us.guestNote')}</p>
        <div className="rounded-ui-lg bg-soft px-4 py-3 text-sm font-semibold text-mute">
          <p><b className="text-ink">{t('us.r.player')}</b>{t('us.r.playerText')}</p>
          <p><b className="text-ink">{t('us.r.mod')}</b>{t('us.r.modText')}</p>
          <p><b className="text-ink">{t('us.r.admin')}</b>{t('us.r.adminText')}</p>
        </div>
      </Section>

      <Section
        title={t('us.rules')}
        description={t('us.rulesText')}
        actions={<SaveBadge status={rulesAuto.status} error={rulesAuto.error} retry={rulesAuto.retry} />}
      >
        <TextField
          id="rules"
          label={t('us.rulesLabel')}
          multiline
          rows={6}
          maxLength={5000}
          value={rules}
          onChange={setRules}
          onBlur={rulesAuto.flush}
          error={rulesAuto.invalid ? rulesAuto.error : undefined}
          placeholder={t('us.rulesHolder')}
          hint={`${rules.length} / 5000`}
          className="min-h-32"
        />
      </Section>

      {pendingUsers.length > 0 && (
        <Section
          title={t('us.req')}
          actions={(
            <>
              <button type="button" className="btn btn-soft btn-sm" onClick={() => setPicked(pickedPending.length === pendingUsers.length ? [] : pendingUsers.map((u) => u.id))}>
                {pickedPending.length === pendingUsers.length ? t('us.unselect') : t('us.selectAll')}
              </button>
              {pickedPending.length > 0 && (
                <>
                  <button type="button" className="btn btn-sm" onClick={() => void approveMany(pickedPending)}>{t('us.approveN', { n: pickedPending.length })}</button>
                  <button type="button" className="btn btn-danger btn-sm" onClick={() => dropUsers(pickedPending, t('us.rejectedN', { n: pickedPending.length }))}>{t('us.rejectN', { n: pickedPending.length })}</button>
                </>
              )}
            </>
          )}
        >
          <ul className="divide-y divide-line">
            {pendingUsers.map((u) => (
              <li key={u.id} className="us-req flex flex-wrap items-center gap-2 py-2.5">
                <input type="checkbox" className="srv-check" checked={picked.includes(u.id)} onChange={() => togglePick(u.id)} aria-label={t('us.pick', { name: u.username })} />
                <UserAvatar name={u.username} url={u.avatarUrl} size={40} tone="brand" />
                <span className="min-w-0 flex-1">
                  <span className="flex min-w-0 items-center gap-2 font-extrabold">
                    <span className="truncate">{u.username}</span>
                    {u.discordName && <DiscordBadge name={u.discordName} />}
                  </span>
                  <span className="block text-xs font-semibold text-mute">{u.createdAt ? t('us.reqAt', { ago: ago(u.createdAt) }) : t('us.reqWait')}{access?.rules ? t('us.reqRules') : ''}</span>
                </span>
                <button className="btn btn-sm" onClick={() => void approve(u)}>{t('us.approve')}</button>
                <button className="btn btn-danger btn-sm" onClick={() => void reject(u)}>{t('us.reject')}</button>
              </li>
            ))}
          </ul>
        </Section>
      )}

      <Section title={t('us.users')}>
        <ErrorLine text={error} />
        <div className="flex flex-wrap items-center gap-2">
          <input className="input max-w-xs" type="search" placeholder={t('us.search')} value={q} onChange={(e) => setQ(e.target.value)} aria-label={t('us.searchAria')} />
          <div className="seg" role="group" aria-label={t('us.roleAria')}>
            {([['all', t('us.f.all')], ['admin', t('us.f.admin')], ['moderator', t('us.f.mod')], ['player', t('us.f.player')]] as const).map(([id, label]) => (
              <button key={id} type="button" className="seg-item" aria-pressed={roleFilter === id} onClick={() => setRoleFilter(id)}>{label}</button>
            ))}
          </div>
        </div>
        {!loaded && <div className="space-y-2" aria-busy="true" aria-label={t('us.loading')}>{[0, 1, 2].map((i) => <div key={i} className="skeleton h-12 rounded-2xl" />)}</div>}
        {loaded && listed.length === 0 && <p className="font-semibold text-mute">{t('us.none')}</p>}
        <ul className="divide-y divide-line">
          {listed.map((u) => (
            <li key={u.id} className="us-row flex flex-wrap items-center gap-2 py-2.5">
              <span className="us-av">
                <UserAvatar name={u.username} url={u.avatarUrl} size={40} tone="brand" />
                {seenText(u).online && <i className="us-online" title={t('us.onlineTip')} />}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-extrabold">
                  {u.username}{u.username === me?.username ? t('us.you') : ''}
                  {u.discordName && <span className="ml-2 align-middle"><DiscordBadge name={u.discordName} /></span>}
                </span>
                <span className={`block text-xs font-semibold ${seenText(u).online ? 'text-ok' : 'text-mute'}`}>{seenText(u).text}{u.createdAt ? t('us.since', { d: new Date(u.createdAt).toLocaleDateString(getPrefs().lang === 'en' ? 'en-US' : 'ru-RU') }) : ''}</span>
              </span>
              {u.status === 'pending' && <span className="pill pill-warn">{t('us.pending')}</span>}
              <span className={`pill ${u.role === 'admin' ? 'pill-bad' : u.role === 'moderator' ? 'pill-warn' : 'pill-mute'}`}>{ROLE_LABEL(u.role).toUpperCase()}</span>
              <select className="input w-auto! py-1.5!" value={u.role} onChange={(e) => void setRole(u, e.target.value as UserRow['role'])} aria-label={t('us.roleOf', { name: u.username })}>
                <option value="player">{t('us.role.player')}</option>
                <option value="moderator">{t('us.role.moderator')}</option>
                <option value="admin">{t('us.role.admin')}</option>
              </select>
              <button type="button" className="row-act" title={t('us.pwTip')} aria-label={t('us.pwOf', { name: u.username })} onClick={() => void resetPassword(u)}><IconKey /></button>
              <button type="button" className="row-act row-act-danger" title={t('us.delTip')} aria-label={t('us.delOf', { name: u.username })} onClick={() => void remove(u)} disabled={u.username === me?.username}><IconTrash /></button>
              {u.role === 'moderator' && (
                <fieldset className="us-perms basis-full">
                  <legend className="sr-only">{t('us.permsOf', { name: u.username })}</legend>
                  <span className="basis-full flex flex-wrap items-center gap-1.5 pb-1">
                    <span className="text-xs font-extrabold uppercase tracking-wide text-mute">{t('us.set')}</span>
                    <span className="text-xs font-extrabold text-mute" aria-live="polite">{t('us.given', { n: (u.perms ?? []).length, m: PERM_LABELS.length })}</span>
                    {PERM_PRESETS.map((p) => (
                      <button key={p.label} type="button" className="us-preset" aria-pressed={p.perms.length > 0 && p.perms.length === (u.perms ?? []).length && p.perms.every((x) => (u.perms ?? []).includes(x))} onClick={() => void setPerms(u, p.perms)}>{t(p.label)}</button>
                    ))}
                  </span>
                  {PERM_LABELS.map((p) => {
                    const on = (u.perms ?? []).includes(p.id);
                    return (
                      <label key={p.id} className={`us-perm ${on ? 'is-on' : ''}`} title={t(`us.perm.${p.id}.hint` as const)}>
                        <input type="checkbox" checked={on} onChange={(e) => void setPerms(u, e.target.checked ? [...(u.perms ?? []), p.id] : (u.perms ?? []).filter((x) => x !== p.id))} />
                        <span><b>{t(`us.perm.${p.id}` as const)}</b> <span className="text-mute">· {t(`us.perm.${p.id}.hint` as const)}</span></span>
                      </label>
                    );
                  })}
                </fieldset>
              )}
            </li>
          ))}
        </ul>
        <p className="text-sm font-semibold text-mute">{t('us.pwNote')} <GoLink href="/admin/settings/security">{t('us.pwLink')}</GoLink>.</p>
      </Section>
    </AdminPage>
  );
}
