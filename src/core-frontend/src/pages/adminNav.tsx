import type { ReactNode } from 'react';
import { IconBell, IconCards, IconWrench, IconDiscord, IconJournal, IconNews, IconServers, IconSettings, IconStart, IconSystem, IconTrophy, IconUsers } from '../ui';

/** One place that knows every admin section: the sidebar, the start page and Ctrl+K all read it. */
export interface AdminSection {
  id: string;
  label: string;
  icon: () => ReactNode;
  /** one line: what this section is for (the «Где что находится» map) */
  desc: string;
  /** extra words Ctrl+K matches */
  keywords: string;
}

export const START_SECTION: AdminSection = {
  id: 'start',
  label: 'Начало работы',
  icon: IconStart,
  desc: 'Пошаговый список: что настроить в первую очередь.',
  keywords: 'старт начало первые шаги чек-лист помощь с чего начать новичок',
};

const S = {
  servers: { id: 'servers', label: 'Серверы', icon: IconServers, desc: 'Игровые серверы: добавить, изменить адрес, удалить.', keywords: 'игра адрес порт добавить сервер опрос' },
  discord: { id: 'discord', label: 'Discord', icon: IconDiscord, desc: 'В какой канал бот публикует карточку сервера.', keywords: 'привязка канал бот сообщение embed' },
  news: { id: 'news', label: 'Новости', icon: IconNews, desc: 'Написать объявление и отправить его в Discord.', keywords: 'новость объявление публикация вайп шаблон запланировать' },
  alerts: { id: 'alerts', label: 'Оповещения', icon: IconBell, desc: 'Сообщение в Discord, если игровой сервер упал или вернулся.', keywords: 'упал недоступен уведомление падение упоминание here everyone' },
  maintenance: { id: 'maintenance', label: 'Обслуживание', icon: IconWrench, desc: 'Окна технических работ: во время них падение сервера не считается сбоем.', keywords: 'тех работы обслуживание окно перезагрузка обновление простой плановые расписание' },
  cards: { id: 'cards', label: 'Карточки', icon: IconCards, desc: 'Картинки состояния серверов со ссылкой, которую можно вставить куда угодно.', keywords: 'картинка баннер ссылка png' },
  community: { id: 'community', label: 'Сообщество', icon: IconTrophy, desc: 'Сезоны и зал славы, отзывы о серверах, галерея скриншотов игроков.', keywords: 'сезон вайп зал славы рейтинг отзывы звёзды модерация галерея скриншоты' },
  users: { id: 'users', label: 'Пользователи', icon: IconUsers, desc: 'Аккаунты, роли, регистрация и правила сообщества.', keywords: 'роли модератор администратор игрок регистрация заявки правила пароль доступ аккаунт' },
  journal: { id: 'journal', label: 'Журнал', icon: IconJournal, desc: 'Кто и что менял в панели, с датой и временем.', keywords: 'аудит история действия изменения кто менял лог' },
  system: { id: 'system', label: 'Система', icon: IconSystem, desc: 'Здоровье панели: версия, диск, бот, сертификат, диагностика.', keywords: 'сертификат https ssl диагностика проверка диск память версия uptime состояние' },
  settings: { id: 'settings', label: 'Настройки', icon: IconSettings, desc: 'Токен бота, оформление, пароль, обновления и резервные копии.', keywords: 'токен прокси пароль оформление цвет логотип обновление копия бэкап безопасность' },
} satisfies Record<string, AdminSection>;

export interface AdminGroup { title: string; sections: AdminSection[] }

export const ADMIN_GROUPS: AdminGroup[] = [
  { title: 'Основное', sections: [S.servers, S.discord, S.news] },
  { title: 'Мониторинг', sections: [S.alerts, S.maintenance, S.cards] },
  { title: 'Люди', sections: [S.community, S.users, S.journal] },
  { title: 'Система', sections: [S.system, S.settings] },
];

/** every section in the order of the sidebar, «Начало работы» first */
export const ADMIN_SECTIONS: AdminSection[] = [START_SECTION, ...ADMIN_GROUPS.flatMap((g) => g.sections)];

export const SETTINGS_TABS = [
  { id: 'bot', label: 'Бот и Discord', keywords: 'токен бот прокси proxy вход через discord client secret redirect oauth пригласить' },
  { id: 'brand', label: 'Оформление', keywords: 'название цвет логотип тема пресет брендинг внешний вид' },
  { id: 'security', label: 'Безопасность', keywords: 'пароль сеансы сессии вход домен порты' },
  { id: 'updates', label: 'Обновления и копии', keywords: 'обновление обновить версия откат резервная копия бэкап backup восстановить скачать расписание шифрование' },
] as const;

export interface AdminLink { label: string; hint: string; href: string; keywords: string; icon: () => ReactNode }

/** deeper places found only by searching (Ctrl+K) */
export const ADMIN_LINKS: AdminLink[] = [
  ...SETTINGS_TABS.map((t) => ({ label: `Настройки: ${t.label}`, hint: 'Настройки', href: `/admin/settings/${t.id}`, keywords: t.keywords, icon: IconSettings })),
  { label: 'Резервные копии', hint: 'Настройки · Обновления и копии', href: '/admin/settings/updates', keywords: 'резервная копия бэкап backup восстановить скачать расписание', icon: IconSettings },
  { label: 'Откат обновления', hint: 'Настройки · Обновления и копии', href: '/admin/settings/updates', keywords: 'откатить вернуть предыдущую версию rollback', icon: IconSettings },
  { label: 'Токен Discord-бота', hint: 'Настройки · Бот и Discord', href: '/admin/settings/bot', keywords: 'токен прокси proxy бот developer portal', icon: IconSettings },
  { label: 'Пароль администратора', hint: 'Настройки · Безопасность', href: '/admin/settings/security', keywords: 'сменить пароль безопасность', icon: IconSettings },
  { label: 'Сертификат HTTPS', hint: 'Система', href: '/admin/system', keywords: 'ssl срок сертификат истекает домен', icon: IconSystem },
  { label: 'Диагностика', hint: 'Система', href: '/admin/system', keywords: 'проверка здоровье состояние', icon: IconSystem },
  { label: 'Роли и доступ', hint: 'Пользователи', href: '/admin/users', keywords: 'роли модератор администратор регистрация правила заявки публичная панель', icon: IconUsers },
  { label: 'Написать новость', hint: 'Новости', href: '/admin/news/new', keywords: 'новость объявление шаблон опубликовать запланировать', icon: IconNews },
  { label: 'Привязать канал Discord', hint: 'Discord', href: '/admin/discord/new', keywords: 'привязка канал сообщение бот', icon: IconDiscord },
  { label: 'Добавить сервер', hint: 'Серверы', href: '/admin/servers/new', keywords: 'новый игровой сервер игра адрес', icon: IconServers },
];
