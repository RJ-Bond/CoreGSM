/** The memo about /clear: shown in /help (Moderation) and by the «How it works» button of the confirmation. */
import { EmbedBuilder } from 'discord.js';
import { footerOf, getStyle } from './style.js';

/** the fields of the memo (also used inside the help card) */
export const CLEAR_GUIDE_FIELDS: { name: string; value: string }[] = [
  { name: '📝 Примеры', value: '`/clear` — весь чат\n`/clear count:50` — последние 50 сообщений\n`/clear user:@Вася` — только его сообщения' },
  { name: '✅ Что удаляется', value: 'Сообщения младше 14 дней: быстро, по 100 за раз. Перед удалением бот показывает, сколько их найдено.' },
  { name: '📌 Закреплённые', value: 'Остаются на месте. Кнопкой «Закреплённые» их можно удалить тоже.' },
  { name: '⏳ Старше 14 дней', value: 'Discord не даёт удалить их пачкой. Кнопка «Старые: удалять по одному» уберёт и их, но медленно: около 3 сообщений в секунду.' },
  { name: '⏹️ Остановка', value: 'После подтверждения 3 секунды на раздумье, дальше кнопка «Остановить» работает в любой момент. Уже удалённое не вернуть.' },
  { name: '🛡️ Защита', value: 'В панели (Discord → Модерация): защищённые каналы, пауза между очистками и журнал очисток.' },
];

export const CLEAR_GUIDE_FIELDS_EN: { name: string; value: string }[] = [
  { name: '📝 Examples', value: '`/clear` — the whole chat\n`/clear count:50` — the last 50 messages\n`/clear user:@Vasya` — only their messages' },
  { name: '✅ What gets deleted', value: 'Messages younger than 14 days: fast, 100 at a time. Before deleting the bot shows how many were found.' },
  { name: '📌 Pinned', value: 'They stay. The «Pinned» button lets you delete them too.' },
  { name: '⏳ Older than 14 days', value: 'Discord does not let the bot delete them in bulk. «Old: delete one by one» removes them too, but slowly: about 3 messages a second.' },
  { name: '⏹️ Stopping', value: 'After the confirmation there are 3 seconds to think, then «Stop» works at any moment. What is deleted cannot be brought back.' },
  { name: '🛡️ Protection', value: 'In the panel (Discord → Moderation): protected channels, a pause between cleanings and a cleaning log.' },
];

export function clearGuideEmbed(): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(getStyle().accent)
    .setTitle('🧹 Команда /clear: как это работает')
    .setDescription('Очищает чат в канале, где вы её набрали. Только для администраторов сервера и всегда с подтверждением.')
    .addFields(CLEAR_GUIDE_FIELDS)
    .setFooter(footerOf('Памятка'));
}
