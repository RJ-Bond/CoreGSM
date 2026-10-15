/** Users: registration and access settings, pending requests, roles and passwords. */
import { useEffect, useRef, useState } from 'react';
import { type Access, api, type UserRow } from '../../api';
import { useAuth } from '../../auth';
import { Switch as ToggleSwitch } from '../../components/Switch';
import { confirmDialog, promptDialog } from '../../confirm';
import { AdminPage, ErrorLine, GoLink, IconKey, IconTrash, IconUsers, PageHead, SaveBadge, Section, TextField, toast, useAutosave } from '../../ui';

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

const ROLE_LABEL: Record<UserRow['role'], string> = { player: 'Игрок', moderator: 'Модератор', admin: 'Администратор' };

export function UsersTab() {
  const { me, reload } = useAuth();
  const [access, setAccess] = useState<Access | null>(null);
  const [users, setUsers] = useState<UserRow[]>([]);
  const [error, setError] = useState('');
  const [rules, setRules] = useState('');
  const rulesInit = useRef(false);

  const load = () => {
    api<Access>('/access').then((a) => {
      setAccess(a);
      // the text is taken from the server once: a later reload must not replace what is being typed
      if (!rulesInit.current) { rulesInit.current = true; setRules(a.rules ?? ''); }
    }).catch((e) => setError(e.message));
    api<UserRow[]>('/users').then(setUsers).catch((e) => setError(e.message));
  };
  useEffect(load, []);

  const save = async (patch: Partial<Access>) => {
    await api<Access>('/access', 'PUT', patch).then((a) => { setAccess(a); void reload(); toast('Сохранено'); }).catch((e) => setError(e.message));
  };
  const approve = async (u: UserRow) => {
    await api(`/users/${u.id}/approve`, 'POST').then(() => toast(`«${u.username}» одобрен`)).catch((e) => setError(e.message));
    load();
  };
  const reject = async (u: UserRow) => {
    if (!(await confirmDialog({ title: `Отклонить заявку «${u.username}»?`, confirmLabel: 'Отклонить', danger: true }))) return;
    await api(`/users/${u.id}`, 'DELETE').then(() => toast('Заявка отклонена')).catch((e) => setError(e.message));
    load();
  };
  // the rules text is saved as you type (after a pause and on leaving the field); the text is never replaced under the cursor
  const rulesAuto = useAutosave({
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
  const remove = async (u: UserRow) => {
    if (!(await confirmDialog({ title: `Удалить пользователя «${u.username}»?`, confirmLabel: 'Удалить', danger: true }))) return;
    await api(`/users/${u.id}`, 'DELETE').then(() => toast('Пользователь удалён')).catch((e) => setError(e.message));
    load();
  };

  const pendingUsers = users.filter((u) => u.status === 'pending');

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
              <select id="reg-mode" className="input !w-auto max-w-full" value={access.registrationMode} disabled={!access.registration} onChange={(e) => void save({ registrationMode: e.target.value as Access['registrationMode'] })}>
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
        <Section title="Заявки на регистрацию">
          <ul className="divide-y divide-line">
            {pendingUsers.map((u) => (
              <li key={u.id} className="flex flex-wrap items-center gap-2 py-2.5">
                <span className="min-w-0 flex-1 truncate font-bold">{u.username}{u.discordName ? ` · Discord: ${u.discordName}` : ''}</span>
                <button className="btn btn-sm" onClick={() => void approve(u)}>Одобрить</button>
                <button className="btn btn-danger btn-sm" onClick={() => void reject(u)}>Отклонить</button>
              </li>
            ))}
          </ul>
        </Section>
      )}

      <Section title="Пользователи">
        <ErrorLine text={error} />
        <ul className="divide-y divide-line">
          {users.map((u) => (
            <li key={u.id} className="flex flex-wrap items-center gap-2 py-2.5">
              <span className="min-w-0 flex-1 truncate font-bold">
                {u.username}{u.username === me?.username ? ' (вы)' : ''}
                {u.discordName && <span className="ml-2 text-sm font-semibold text-mute">Discord: {u.discordName}</span>}
              </span>
              {u.status === 'pending' && <span className="pill pill-warn">ЗАЯВКА</span>}
              <span className={`pill ${u.role === 'admin' ? 'pill-bad' : u.role === 'moderator' ? 'pill-warn' : 'pill-mute'}`}>{ROLE_LABEL[u.role].toUpperCase()}</span>
              <select className="input !w-auto !py-1.5" value={u.role} onChange={(e) => void setRole(u, e.target.value as UserRow['role'])} aria-label={`Роль ${u.username}`}>
                <option value="player">Игрок</option>
                <option value="moderator">Модератор</option>
                <option value="admin">Администратор</option>
              </select>
              <button type="button" className="row-act" title="Сменить пароль" aria-label={`Сменить пароль: ${u.username}`} onClick={() => void resetPassword(u)}><IconKey /></button>
              <button type="button" className="row-act row-act-danger" title="Удалить" aria-label={`Удалить: ${u.username}`} onClick={() => void remove(u)} disabled={u.username === me?.username}><IconTrash /></button>
            </li>
          ))}
        </ul>
        <p className="text-sm font-semibold text-mute">Пароль самого администратора меняется в <GoLink href="/admin/settings/security">Настройки: Безопасность</GoLink>.</p>
      </Section>
    </AdminPage>
  );
}
