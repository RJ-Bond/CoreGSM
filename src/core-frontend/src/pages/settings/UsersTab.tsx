/** Users: registration and access settings, pending requests, roles and passwords. */
import { useEffect, useRef, useState } from 'react';
import { type Access, api, type Perm, PERM_LABELS, type UserRow } from '../../api';
import '../../styles/admin.css';
import { useAuth } from '../../auth';
import { Switch as ToggleSwitch } from '../../components/Switch';
import { promptDialog } from '../../confirm';
import { AdminPage, DiscordBadge, ErrorLine, GoLink, IconKey, IconTrash, IconUsers, PageHead, SaveBadge, Section, TextField, UserAvatar, toast, undoable, useAutosave } from '../../ui';
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
const PERM_PRESETS: { label: string; perms: Perm[] }[] = [
  { label: 'Редактор новостей', perms: ['news'] },
  { label: 'Модератор сообщества', perms: ['news', 'moderation', 'journal'] },
  { label: 'Админ серверов', perms: ['servers', 'maintenance'] },
  { label: 'Снять все', perms: [] },
];

const ROLE_LABEL: Record<UserRow['role'], string> = { player: 'Игрок', moderator: 'Модератор', admin: 'Администратор' };

/** The users page: the rules text joins the common save bar. */
export function UsersTab() {
  return <SaveBarProvider><UsersTabInner /></SaveBarProvider>;
}

function UsersTabInner() {
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
    await api<Access>('/access', 'PUT', patch).then((a) => { setAccess(a); void reload(); toast('Сохранено'); }).catch((e) => setError(e.message));
  };
  const approve = async (u: UserRow) => {
    await api(`/users/${u.id}/approve`, 'POST').then(() => toast(`«${u.username}» одобрен`)).catch((e) => setError(e.message));
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
        if (res.some((r) => r.status === 'rejected')) setError('Не всех удалось удалить');
        setHidden((h) => h.filter((x) => !ids.includes(x)));
        load();
      },
    });
  };
  const reject = (u: UserRow) => dropUsers([u], 'Заявка отклонена');
  const approveMany = async (list: UserRow[]) => {
    const res = await Promise.allSettled(list.map((u) => api(`/users/${u.id}/approve`, 'POST')));
    const bad = res.filter((r) => r.status === 'rejected').length;
    toast(bad ? `Одобрено: ${list.length - bad}, не удалось: ${bad}` : `Одобрено заявок: ${list.length}`, bad ? 'err' : undefined);
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
    validate: (v) => (v.length > 5000 ? 'Не больше 5000 символов' : null),
    save: async (v) => {
      const a = await api<Access>('/access', 'PUT', { rules: v.trim() });
      setAccess(a);
      void reload();
    },
  });
  useSaveBar('rules', 'правила сообщества', rulesAuto.status, rulesAuto.saveNow, () => setRules(access?.rules ?? ''));
  const setPerms = async (u: UserRow, perms: Perm[]) => {
    await api(`/users/${u.id}`, 'PUT', { role: u.role, perms }).then(() => { toast('Права модератора сохранены'); void load(); }).catch((e) => setError(e.message));
  };
  const setRole = async (u: UserRow, role: UserRow['role']) => {
    await api(`/users/${u.id}`, 'PUT', { role }).then(() => toast('Роль изменена')).catch((e) => setError(e.message));
    load();
  };
  const resetPassword = async (u: UserRow) => {
    const pw = await promptDialog({
      title: `Новый пароль для «${u.username}»`,
      label: 'Новый пароль (от 8 символов)',
      password: true,
      confirmLabel: 'Сменить пароль',
      validate: (v) => (v.length < 8 ? 'Минимум 8 символов' : null),
    });
    if (!pw) return;
    await api(`/users/${u.id}/password`, 'PUT', { password: pw }).then(() => toast('Пароль изменён')).catch((e) => setError(e.message));
  };
  const remove = (u: UserRow) => dropUsers([u], 'Пользователь удалён');

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
          title="Пользователи"
          subtitle="Аккаунты, роли, регистрация и правила"
          hint="Здесь решается, кто может открывать панель, регистрироваться и что кому разрешено. Роль определяет права человека."
          help={<p>Игрок только смотрит серверы и новости. Модератор ещё и пишет новости. Администратор управляет всем. Все действия администраторов попадают в журнал.</p>}
        >
          <a className="btn btn-soft" href="/admin/journal">Журнал: кто что менял</a>
        </PageHead>
      )}
    >
      <Section title="Кто видит панель">
        {access && (
          <>
            <Switch on={access.publicPanel} onChange={(v) => void save({ publicPanel: v })} label="Открыта для всех" hint="Серверы и новости видны без входа. Выключите, чтобы панель открывалась только после авторизации." />
            <Switch on={access.registration} onChange={(v) => void save({ registration: v })} label="Регистрация игроков" hint="Любой желающий может создать аккаунт игрока (без прав администратора)." />
            <div className="pl-8">
              <label htmlFor="reg-mode" className="label">Режим регистрации</label>
              <select id="reg-mode" className="input w-auto! max-w-full" value={access.registrationMode} disabled={!access.registration} onChange={(e) => void save({ registrationMode: e.target.value as Access['registrationMode'] })}>
                <option value="open">Открытая: сразу</option>
                <option value="approval">По заявке: после одобрения администратором</option>
              </select>
            </div>
          </>
        )}
        <p className="text-sm font-semibold text-mute">Игроки и гости только смотрят серверы и новости. Добавлять серверы и менять настройки могут администраторы.</p>
        <div className="rounded-ui-lg bg-soft px-4 py-3 text-sm font-semibold text-mute">
          <p><b className="text-ink">Игрок</b>: смотрит серверы и новости, ведёт свой профиль.</p>
          <p><b className="text-ink">Модератор</b>: пишет, публикует и удаляет новости, меняет канал новостей по умолчанию. Серверы, настройки, пользователи и система ему недоступны.</p>
          <p><b className="text-ink">Администратор</b>: полный доступ ко всему.</p>
        </div>
      </Section>

      <Section
        title="Правила сообщества"
        description="Если текст задан, при регистрации нужно подтвердить согласие с ним. Оставьте пустым, чтобы правил не было. Текст сохраняется сам."
        actions={<SaveBadge status={rulesAuto.status} error={rulesAuto.error} retry={rulesAuto.retry} />}
      >
        <TextField
          id="rules"
          label="Текст правил"
          multiline
          rows={6}
          maxLength={5000}
          value={rules}
          onChange={setRules}
          onBlur={rulesAuto.flush}
          error={rulesAuto.invalid ? rulesAuto.error : undefined}
          placeholder="1. Уважайте других игроков…"
          hint={`${rules.length} / 5000`}
          className="min-h-32"
        />
      </Section>

      {pendingUsers.length > 0 && (
        <Section
          title="Заявки на регистрацию"
          actions={(
            <>
              <button type="button" className="btn btn-soft btn-sm" onClick={() => setPicked(pickedPending.length === pendingUsers.length ? [] : pendingUsers.map((u) => u.id))}>
                {pickedPending.length === pendingUsers.length ? 'Снять выбор' : 'Выбрать все'}
              </button>
              {pickedPending.length > 0 && (
                <>
                  <button type="button" className="btn btn-sm" onClick={() => void approveMany(pickedPending)}>Одобрить ({pickedPending.length})</button>
                  <button type="button" className="btn btn-danger btn-sm" onClick={() => dropUsers(pickedPending, `Отклонено заявок: ${pickedPending.length}`)}>Отклонить ({pickedPending.length})</button>
                </>
              )}
            </>
          )}
        >
          <ul className="divide-y divide-line">
            {pendingUsers.map((u) => (
              <li key={u.id} className="flex flex-wrap items-center gap-2 py-2.5">
                <input type="checkbox" className="srv-check" checked={picked.includes(u.id)} onChange={() => togglePick(u.id)} aria-label={`Выбрать: ${u.username}`} />
                <UserAvatar name={u.username} url={u.avatarUrl} size={32} tone="brand" />
                <span className="flex min-w-0 flex-1 items-center gap-2 font-bold">
                  <span className="truncate">{u.username}</span>
                  {u.discordName && <DiscordBadge name={u.discordName} />}
                </span>
                <button className="btn btn-sm" onClick={() => void approve(u)}>Одобрить</button>
                <button className="btn btn-danger btn-sm" onClick={() => void reject(u)}>Отклонить</button>
              </li>
            ))}
          </ul>
        </Section>
      )}

      <Section title="Пользователи">
        <ErrorLine text={error} />
        <div className="flex flex-wrap items-center gap-2">
          <input className="input max-w-xs" type="search" placeholder="Поиск по имени…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Поиск пользователя" />
          <div className="seg" role="group" aria-label="Роль">
            {([['all', 'Все'], ['admin', 'Админы'], ['moderator', 'Модераторы'], ['player', 'Игроки']] as const).map(([id, label]) => (
              <button key={id} type="button" className="seg-item" aria-pressed={roleFilter === id} onClick={() => setRoleFilter(id)}>{label}</button>
            ))}
          </div>
        </div>
        {!loaded && <div className="space-y-2" aria-busy="true" aria-label="Загрузка">{[0, 1, 2].map((i) => <div key={i} className="skeleton h-12 rounded-2xl" />)}</div>}
        {loaded && listed.length === 0 && <p className="font-semibold text-mute">Никого не найдено.</p>}
        <ul className="divide-y divide-line">
          {listed.map((u) => (
            <li key={u.id} className="flex flex-wrap items-center gap-2 py-2.5">
              <UserAvatar name={u.username} url={u.avatarUrl} size={32} tone="brand" />
              <span className="min-w-0 flex-1 truncate font-bold">
                {u.username}{u.username === me?.username ? ' (вы)' : ''}
                {u.discordName && <span className="ml-2 align-middle"><DiscordBadge name={u.discordName} /></span>}
              </span>
              {u.status === 'pending' && <span className="pill pill-warn">ЗАЯВКА</span>}
              <span className={`pill ${u.role === 'admin' ? 'pill-bad' : u.role === 'moderator' ? 'pill-warn' : 'pill-mute'}`}>{ROLE_LABEL[u.role].toUpperCase()}</span>
              <select className="input w-auto! py-1.5!" value={u.role} onChange={(e) => void setRole(u, e.target.value as UserRow['role'])} aria-label={`Роль ${u.username}`}>
                <option value="player">Игрок</option>
                <option value="moderator">Модератор</option>
                <option value="admin">Администратор</option>
              </select>
              <button type="button" className="row-act" title="Сменить пароль" aria-label={`Сменить пароль: ${u.username}`} onClick={() => void resetPassword(u)}><IconKey /></button>
              <button type="button" className="row-act row-act-danger" title="Удалить" aria-label={`Удалить: ${u.username}`} onClick={() => void remove(u)} disabled={u.username === me?.username}><IconTrash /></button>
              {u.role === 'moderator' && (
                <fieldset className="us-perms basis-full">
                  <legend className="sr-only">Права модератора {u.username}</legend>
                  <span className="basis-full flex flex-wrap items-center gap-1.5 pb-1">
                    <span className="text-xs font-extrabold uppercase tracking-wide text-mute">Набор:</span>
                    {PERM_PRESETS.map((p) => (
                      <button key={p.label} type="button" className="us-preset" onClick={() => void setPerms(u, p.perms)}>{p.label}</button>
                    ))}
                  </span>
                  {PERM_LABELS.map((p) => {
                    const on = (u.perms ?? []).includes(p.id);
                    return (
                      <label key={p.id} className={`us-perm ${on ? 'is-on' : ''}`} title={p.hint}>
                        <input type="checkbox" checked={on} onChange={(e) => void setPerms(u, e.target.checked ? [...(u.perms ?? []), p.id] : (u.perms ?? []).filter((x) => x !== p.id))} />
                        <span><b>{p.label}</b> <span className="text-mute">· {p.hint}</span></span>
                      </label>
                    );
                  })}
                </fieldset>
              )}
            </li>
          ))}
        </ul>
        <p className="text-sm font-semibold text-mute">Пароль самого администратора меняется в <GoLink href="/admin/settings/security">Настройки: Безопасность</GoLink>.</p>
      </Section>
    </AdminPage>
  );
}
