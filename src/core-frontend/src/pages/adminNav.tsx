import type { ReactNode } from 'react';
import type { Perm } from '../api';
import { t } from '../i18n';
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
  get label() { return t('adm.s.start'); },
  icon: IconStart,
  get desc() { return t('adm.d.start'); },
  keywords: 'старт начало первые шаги чек-лист помощь с чего начать новичок',
};

const S = {
  servers: { id: 'servers', get label() { return t('adm.s.servers'); }, icon: IconServers, get desc() { return t('adm.d.servers'); }, keywords: 'игра адрес порт добавить сервер опрос' },
  discord: { id: 'discord', get label() { return t('adm.s.discord'); }, icon: IconDiscord, get desc() { return t('adm.d.discord'); }, keywords: 'привязка канал бот сообщение embed' },
  news: { id: 'news', get label() { return t('adm.s.news'); }, icon: IconNews, get desc() { return t('adm.d.news'); }, keywords: 'новость объявление публикация вайп шаблон запланировать' },
  alerts: { id: 'alerts', get label() { return t('adm.s.alerts'); }, icon: IconBell, get desc() { return t('adm.d.alerts'); }, keywords: 'упал недоступен уведомление падение упоминание here everyone' },
  maintenance: { id: 'maintenance', get label() { return t('adm.s.maintenance'); }, icon: IconWrench, get desc() { return t('adm.d.maintenance'); }, keywords: 'тех работы обслуживание окно перезагрузка обновление простой плановые расписание' },
  cards: { id: 'cards', get label() { return t('adm.s.cards'); }, icon: IconCards, get desc() { return t('adm.d.cards'); }, keywords: 'картинка баннер ссылка png' },
  community: { id: 'community', get label() { return t('adm.s.community'); }, icon: IconTrophy, get desc() { return t('adm.d.community'); }, keywords: 'сезон вайп зал славы рейтинг отзывы звёзды модерация галерея скриншоты' },
  users: { id: 'users', get label() { return t('adm.s.users'); }, icon: IconUsers, get desc() { return t('adm.d.users'); }, keywords: 'роли модератор администратор игрок регистрация заявки правила пароль доступ аккаунт' },
  journal: { id: 'journal', get label() { return t('adm.s.journal'); }, icon: IconJournal, get desc() { return t('adm.d.journal'); }, keywords: 'аудит история действия изменения кто менял лог' },
  system: { id: 'system', get label() { return t('adm.s.system'); }, icon: IconSystem, get desc() { return t('adm.d.system'); }, keywords: 'сертификат https ssl диагностика проверка диск память версия uptime состояние' },
  settings: { id: 'settings', get label() { return t('adm.s.settings'); }, icon: IconSettings, get desc() { return t('adm.d.settings'); }, keywords: 'токен прокси пароль оформление цвет логотип обновление копия бэкап безопасность' },
} satisfies Record<string, AdminSection>;

/** the permission that opens a section to a moderator (sections not listed are for administrators only) */
export const SECTION_PERM: Partial<Record<string, Perm>> = { news: 'news', community: 'moderation', servers: 'servers', maintenance: 'maintenance', journal: 'journal' };

export interface AdminGroup { title: string; sections: AdminSection[] }

export const ADMIN_GROUPS: AdminGroup[] = [
  { get title() { return t('adm.g.main'); }, sections: [S.servers, S.discord, S.news] },
  { get title() { return t('adm.g.mon'); }, sections: [S.alerts, S.maintenance, S.cards] },
  { get title() { return t('adm.g.people'); }, sections: [S.community, S.users, S.journal] },
  { get title() { return t('adm.g.sys'); }, sections: [S.system, S.settings] },
];

/** every section in the order of the sidebar, «Начало работы» first */
export const ADMIN_SECTIONS: AdminSection[] = [START_SECTION, ...ADMIN_GROUPS.flatMap((g) => g.sections)];

export const SETTINGS_TABS = [
  { id: 'bot', get label() { return t('adm.tab.bot'); }, keywords: 'токен бот прокси proxy вход через discord client secret redirect oauth пригласить' },
  { id: 'brand', get label() { return t('adm.tab.brand'); }, keywords: 'название цвет логотип тема пресет брендинг внешний вид' },
  { id: 'security', get label() { return t('adm.tab.security'); }, keywords: 'пароль сеансы сессии вход домен порты' },
  { id: 'updates', get label() { return t('adm.tab.updates'); }, keywords: 'обновление обновить версия откат резервная копия бэкап backup восстановить скачать расписание шифрование' },
] as const;

export interface AdminLink { label: string; hint: string; href: string; keywords: string; icon: () => ReactNode }

/** deeper places found only by searching (Ctrl+K) */
export const ADMIN_LINKS: AdminLink[] = [
  ...SETTINGS_TABS.map((tab) => ({ label: `Настройки: ${tab.label}`, hint: 'Настройки', href: `/admin/settings/${tab.id}`, keywords: tab.keywords, icon: IconSettings })),
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
