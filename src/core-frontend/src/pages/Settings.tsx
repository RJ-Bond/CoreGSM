import BackupsCard from './Backups';
import ConfigTransfer from '../components/ConfigTransfer';
import SmtpCard from '../components/SmtpCard';
import PollSettingsCard from '../components/PollSettingsCard';
import type { ReactNode } from 'react';
import { AdminPage, GoLink, IconSettings, PageHead, Section } from '../ui';
import { SETTINGS_TABS } from './adminNav';
import { BotCard } from './settings/BotCard';
import { BrandCard } from './settings/BrandCard';
import { PasswordCard } from './settings/PasswordCard';
import { UpdateCard } from './settings/UpdateCard';
export { BotPill } from './settings/BotCard';
export { UsersTab } from './settings/UsersTab';

// the ids stay the canonical hashes (/admin/settings/bot|brand|security|updates); only the labels are friendlier
const TABS = SETTINGS_TABS;

const TAB_HINT: Record<string, { hint: string; help: ReactNode }> = {
  bot: {
    hint: 'Здесь вы подключаете Discord-бота: он публикует сообщения и новости. Токен берётся в Discord Developer Portal.',
    help: (
      <>
        <p>Как получить токен:</p>
        <ol>
          <li>Откройте discord.com/developers, раздел Applications, и создайте приложение.</li>
          <li>На вкладке Bot нажмите Reset Token и скопируйте токен.</li>
          <li>Вставьте его ниже и сохраните, затем нажмите «Пригласить бота на сервер».</li>
        </ol>
        <p>Прокси нужен только если Discord недоступен с вашего сервера.</p>
      </>
    ),
  },
  brand: {
    hint: 'Название, цвет и логотип сообщества: их видят все посетители панели и участники в подвале сообщений Discord.',
    help: <p>Готовые темы меняют цвета всей панели сразу. Изменения применяются и сохраняются сами; пока идёт сохранение или если оно не удалось, цвета видны только вам как предпросмотр. «Акцент по игре» действует только в вашем браузере.</p>,
  },
  security: {
    hint: 'Пароль администратора и сведения о доступе: кто может входить в панель и регистрироваться.',
    help: <p>Пароль нужно менять, если им делились. Переключатели регистрации и правила сообщества находятся в разделе «Пользователи».</p>,
  },
  updates: {
    hint: 'Установка новых версий панели и резервные копии данных. Перед обновлением сохраняется копия базы, поэтому его можно откатить.',
    help: <p>Копия содержит серверы, привязки, пользователей, новости и токен бота, поэтому храните файлы бережно. Автоматические копии включаются расписанием ниже.</p>,
  },
};

export default function SettingsPage({ sub, updateAvailable }: { sub: string; updateAvailable: boolean }) {
  const tab = TABS.some((t) => t.id === sub) ? sub : 'bot';
  return (
    <AdminPage
      narrow
      head={<PageHead key={tab} icon={<IconSettings />} title="Настройки" subtitle="Бот, оформление, безопасность, обновления и копии" hint={TAB_HINT[tab].hint} help={TAB_HINT[tab].help} />}
    >
      <nav className="flex w-full max-w-2xl gap-1 overflow-x-auto rounded-full bg-soft p-1" aria-label="Разделы настроек">
        {TABS.map((t) => (
          <a
            key={t.id}
            href={`/admin/settings/${t.id}`}
            aria-current={tab === t.id ? 'page' : undefined}
            className={`flex-1 whitespace-nowrap rounded-full px-4 py-1.5 text-center font-extrabold transition ${tab === t.id ? 'bg-brand text-white shadow-1' : 'text-mute hover:text-ink'}`}
          >
            {t.label}
            {t.id === 'updates' && updateAvailable && <span className="update-dot ml-1.5 align-middle" title="Доступно обновление" />}
          </a>
        ))}
      </nav>
      {tab === 'bot' && <><BotCard /><PollSettingsCard /></>}
      {tab === 'brand' && <BrandCard />}
      {tab === 'security' && (
        <>
          <PasswordCard />
          <SmtpCard />
          <Section title="Вход и доступ">
            <p className="font-semibold text-mute">Кто может открыть панель, регистрироваться и какие у людей роли, настраивается в разделе «Пользователи».</p>
            <p className="font-semibold text-mute">Список ваших входов с устройств и выход со всех остальных находится в профиле.</p>
            <div className="flex flex-wrap gap-x-5 gap-y-1">
              <GoLink href="/admin/users">Пользователи и доступ</GoLink>
              <GoLink href="/profile">Мои сеансы в профиле</GoLink>
            </div>
          </Section>
          <p className="font-semibold text-mute">
            Домен и порты задаются при установке и хранятся в <span className="font-mono text-sm text-ink">/app/.env</span>. Изменить их можно командой <span className="font-mono text-sm text-ink">sudo coregsm</span> на сервере (пункт «Домен и прокси»).
          </p>
        </>
      )}
      {tab === 'updates' && (
        <>
          <UpdateCard />
          <BackupsCard />
          <ConfigTransfer />
        </>
      )}
    </AdminPage>
  );
}
