/**
 * /clear: wipes the chat of the channel where it was typed. Only for server administrators, always with a
 * confirmation. The confirmation card shows what is found (how many messages, how many are pinned or too old), has quick
 * amounts (10 / 50 / 100 / all) and a switch for the pinned messages; its buttons live two minutes and answer only to the
 * person who typed the command. After «Yes» a three-second countdown leaves time to stop; then the private message shows the
 * progress (speed and time left) with a «Stop» button. At the end the channel gets a short notice that removes itself, and the
 * log channel of the panel gets a record.
 *
 * The panel (Discord → Moderation) can switch the command off, protect channels, set the pause between cleanings and the log channel.
 * Discord deletes messages in bulk only while they are younger than 14 days: older ones stay. Pinned ones stay unless chosen.
 */
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, PermissionFlagsBits, type ButtonInteraction, type ChatInputCommandInteraction } from 'discord.js';
import {
  COUNTDOWN_SECONDS, CONFIRM_TTL_MS, MAX_COUNT, MAX_RUN_MS, QUICK_COUNTS, SCAN_LIMIT, clearId, cooldownLeft, durationText, estimate, etaText, expectedTotal, isExpired, messages, normalizeCount, parseClearId, pickLine, readModeration, sortPage, speedText, stopId, waitText,
  type ClearState, type Estimate, type Moderation, type MsgLike,
} from './clearLogic.js';
import { backendJson } from './backend.js';
import { humanDiscordError } from './errors.js';
import { log } from './log.js';
import { COLORS, bar10, replyEmbed } from './replies.js';
import { footerOf, getStyle } from './style.js';

export const CLEAR_COMMANDS = [
  {
    name: 'clear',
    description: 'Очистить чат в этом канале (для администраторов, с подтверждением)',
    dm_permission: false,
    default_member_permissions: String(PermissionFlagsBits.Administrator),
    options: [
      { type: 4, name: 'count', description: `Сколько последних сообщений удалить (по умолчанию весь чат, не больше ${MAX_COUNT})`, min_value: 1, max_value: MAX_COUNT, required: false },
      { type: 6, name: 'user', description: 'Удалить только сообщения этого участника', required: false },
    ],
  },
];
export const CLEAR_NAMES = new Set(CLEAR_COMMANDS.map((c) => c.name));

const EPHEMERAL = 64;
const NEED = [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.ManageMessages];
const NEED_TEXT = 'Боту нужны в этом канале права «Просмотр канала», «Читать историю сообщений» и «Управлять сообщениями». Выдайте их роли бота или пригласите бота заново по ссылке из панели.';

type RawMsg = { id: string; createdTimestamp: number; pinned: boolean; author?: { id: string } | null };

/** the part of a text channel that the run needs (kept small on purpose) */
interface Cleanable {
  id: string;
  messages: { fetch: (o: { limit: number; before?: string }) => Promise<Map<string, RawMsg>> };
  bulkDelete: (ids: string[], filterOld: boolean) => Promise<{ size: number }>;
  send?: (o: unknown) => Promise<{ delete: () => Promise<unknown> }>;
}

/** channels where a run is going now; `stop` is set by the «Stop» button */
const running = new Map<string, { stop: boolean }>();
/** when each channel was cleaned last (for the pause of the panel) */
const lastDone = new Map<string, number>();
/** what the preview found, kept half a minute so that the buttons answer at once */
const scans = new Map<string, { at: number; list: MsgLike[]; complete: boolean }>();

const empty = () => ({ components: [] as never[] });
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const toLike = (m: RawMsg): MsgLike => ({ id: m.id, createdTimestamp: m.createdTimestamp, pinned: m.pinned, authorId: m.author?.id ?? '' });
const oldestId = (page: RawMsg[]) => page.reduce((a, b) => (b.createdTimestamp < a.createdTimestamp ? b : a)).id;

/** looks through the newest SCAN_LIMIT messages of the channel (not deleting anything) */
async function scan(ch: Cleanable, fresh = false) {
  const hit = scans.get(ch.id);
  if (!fresh && hit && Date.now() - hit.at < 30_000) return hit;
  const list: MsgLike[] = [];
  let cursor: string | undefined;
  let complete = false;
  while (list.length < SCAN_LIMIT) {
    const page = [...(await ch.messages.fetch({ limit: 100, ...(cursor ? { before: cursor } : {}) })).values()];
    list.push(...page.map(toLike));
    if (page.length < 100) {
      complete = true;
      break;
    }
    cursor = oldestId(page);
  }
  if (scans.size > 50) scans.clear();
  const r = { at: Date.now(), list, complete };
  scans.set(ch.id, r);
  return r;
}

const who = (st: ClearState) => (st.target ? `только сообщения <@${st.target}>` : '');
const amountText = (st: ClearState) => (st.count ? `последние **${messages(st.count)}**` : '**весь чат**');

function confirmView(channelId: string, userId: string, st: ClearState, at: number, e: Estimate) {
  const found = e.complete ? `${e.scanned}` : `${e.scanned}+`;
  const embed = new EmbedBuilder()
    .setColor(COLORS.warn)
    .setTitle('🧹 Очистить канал?')
    .setDescription(`Канал <#${channelId}>: будут удалены ${amountText(st)}${st.target ? `, ${who(st)}` : ''}.\nВернуть сообщения после удаления нельзя.`)
    .addFields(
      { name: '🔎 Просмотрено', value: found, inline: true },
      { name: '🗑️ Будет удалено', value: e.deletable ? `**${e.complete || (st.count && e.deletable >= st.count) ? e.deletable : `${e.deletable}+`}**` : '0', inline: true },
      { name: '📌 Закреплённые', value: e.pinned || !st.pinned ? `${e.pinned} — ${st.pinned ? 'удалятся' : 'останутся'}` : 'удалятся', inline: true },
    )
    .setFooter(footerOf(`Подтвердите в течение ${Math.round(CONFIRM_TTL_MS / 60_000)} мин`));
  if (e.old) embed.addFields({ name: '⏳ Старше 14 дней', value: `${e.old}${e.complete ? '' : '+'} — останутся: Discord не удаляет такие пачкой`, inline: false });
  const amounts = [...new Set([...(st.count && !(QUICK_COUNTS as readonly number[]).includes(st.count) ? [st.count] : []), ...QUICK_COUNTS])];
  const row1 = new ActionRowBuilder<ButtonBuilder>().addComponents(
    amounts.map((n) =>
      new ButtonBuilder()
        .setCustomId(clearId('set', userId, { ...st, count: n }, at))
        .setLabel(n ? String(n) : 'Всё')
        .setStyle(n === st.count ? ButtonStyle.Primary : ButtonStyle.Secondary),
    ),
  );
  const row2 = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(clearId('set', userId, { ...st, pinned: !st.pinned }, at))
      .setLabel(st.pinned ? 'Закреплённые: удалить тоже' : 'Закреплённые: оставить')
      .setEmoji('📌')
      .setStyle(st.pinned ? ButtonStyle.Danger : ButtonStyle.Secondary),
  );
  const row3 = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(clearId('go', userId, st, at)).setLabel(e.deletable ? 'Да, очистить' : 'Удалять нечего').setEmoji('🧹').setStyle(ButtonStyle.Danger).setDisabled(!e.deletable),
    new ButtonBuilder().setCustomId(clearId('no', userId, st, at)).setLabel('Отмена').setStyle(ButtonStyle.Secondary),
  );
  return { embeds: [embed], components: [row1, row2, row3] };
}

const stopRow = (channelId: string, danger = false) =>
  new ActionRowBuilder<ButtonBuilder>().addComponents(new ButtonBuilder().setCustomId(stopId(channelId)).setLabel('Остановить').setEmoji('⏹️').setStyle(danger ? ButtonStyle.Danger : ButtonStyle.Secondary));

function countdownView(channelId: string, left: number) {
  const e = new EmbedBuilder()
    .setColor(COLORS.warn)
    .setTitle(`⏳ Старт через ${left}…`)
    .setDescription('Передумали? Нажмите «Остановить», пока ничего не удалено.')
    .setFooter(footerOf('Очистка'));
  return { embeds: [e], components: [stopRow(channelId, true)] };
}

function progressView(channelId: string, total: number, deleted: number, elapsed: number) {
  const speed = speedText(deleted, elapsed);
  const eta = etaText(deleted, total, elapsed);
  const e = new EmbedBuilder()
    .setColor(getStyle().accent)
    .setTitle('🧹 Очищаю канал…')
    .setDescription(total ? `${bar10(Math.min(1, deleted / total))} **${deleted}** из ${total}` : `Удалено: **${messages(deleted)}**`)
    .addFields({ name: '⏱️ Прошло', value: durationText(elapsed), inline: true })
    .setFooter(footerOf('Очистка'));
  if (speed) e.addFields({ name: '⚡ Скорость', value: speed, inline: true });
  if (eta) e.addFields({ name: '🏁 Осталось', value: eta, inline: true });
  return { embeds: [e], components: [stopRow(channelId)] };
}

interface Totals { deleted: number; pinned: number; old: number }
type Outcome = 'ok' | 'stopped' | 'error';

function resultEmbed(t: Totals, elapsed: number, outcome: Outcome, st: ClearState, reason = '') {
  const color = outcome === 'error' ? COLORS.bad : outcome === 'stopped' ? COLORS.warn : t.deleted ? COLORS.ok : getStyle().accent;
  const title = outcome === 'error' ? '❌ Очистка прервана' : outcome === 'stopped' ? '⏹️ Остановлено' : t.deleted ? '✨ Канал очищен' : 'Удалять было нечего';
  const e = new EmbedBuilder().setColor(color).setTitle(title).setFooter(footerOf('Очистка'));
  e.setDescription(t.deleted ? `Удалено **${messages(t.deleted)}** за ${durationText(elapsed)}${st.target ? ` (${who(st)})` : ''}.` : 'В канале нет сообщений, которые можно удалить.');
  const speed = speedText(t.deleted, elapsed);
  if (speed) e.addFields({ name: '⚡ Скорость', value: speed, inline: true });
  if (t.pinned) e.addFields({ name: '📌 Закреплённых оставлено', value: String(t.pinned), inline: true });
  if (t.old) e.addFields({ name: '⏳ Старше 14 дней', value: `${t.old}+ осталось: Discord не удаляет такие пачкой` });
  if (reason) e.addFields({ name: 'Причина', value: reason.slice(0, 500) });
  return e;
}

const noPerm = (text: string) => ({ ...replyEmbed('Недостаточно прав', text, COLORS.bad), ...empty() });

/** everything that can forbid a cleaning of this channel; a text for the person, or null when it is allowed */
async function forbidden(i: ChatInputCommandInteraction | ButtonInteraction, ch: Cleanable | null): Promise<{ title: string; text: string; mod?: undefined } | { mod: Moderation; title?: undefined; text?: undefined }> {
  if (!i.guild || !ch) return { title: 'Только на сервере', text: 'Команда работает в канале Discord-сервера.' };
  if (!i.memberPermissions?.has(PermissionFlagsBits.Administrator)) return { title: 'Недостаточно прав', text: 'Очищать чат могут только администраторы сервера.' };
  if (i.appPermissions && !i.appPermissions.has(NEED)) return { title: 'Недостаточно прав', text: NEED_TEXT };
  const r = await backendJson<unknown>('/internal/moderation').catch(() => null);
  const mod = r?.ok ? readModeration(r.data) : null;
  // the panel decides what is protected: without its answer nothing is cleaned
  if (!mod) return { title: 'Панель не отвечает', text: 'Не удалось получить настройки модерации. Попробуйте ещё раз чуть позже.' };
  if (!mod.enabled) return { title: 'Команда выключена', text: 'Администратор отключил `/clear` в панели (Discord → Модерация).' };
  if (mod.protectedChannels.includes(ch.id)) return { title: 'Канал защищён', text: `Канал <#${ch.id}> отмечен в панели как защищённый: очищать его нельзя.` };
  if (running.has(ch.id)) return { title: 'Уже идёт', text: 'В этом канале очистка уже выполняется.' };
  const wait = cooldownLeft(lastDone.get(ch.id), mod.cooldown, Date.now());
  if (wait) return { title: 'Подождите немного', text: `Этот канал только что очищали. Следующая очистка через ${waitText(wait)}.` };
  return { mod };
}

const asChannel = (i: ChatInputCommandInteraction | ButtonInteraction) => (i.channel && typeof (i.channel as unknown as Cleanable).bulkDelete === 'function' ? (i.channel as unknown as Cleanable) : null);

export async function handleClearCommand(i: ChatInputCommandInteraction): Promise<void> {
  try {
    await i.deferReply({ flags: EPHEMERAL });
    const ch = asChannel(i);
    const f = await forbidden(i, ch);
    if (!f.mod || !ch) {
      await i.editReply(replyEmbed(f.title ?? 'Сюда нельзя', f.text ?? 'В этом канале очистка не поддерживается.', f.title === 'Уже идёт' || f.title === 'Подождите немного' ? COLORS.warn : COLORS.bad));
      return;
    }
    const st: ClearState = { count: normalizeCount(i.options.getInteger('count')), pinned: false, target: i.options.getUser('user')?.id ?? '' };
    const s = await scan(ch, true);
    await i.editReply(confirmView(ch.id, i.user.id, st, Date.now(), estimate(s.list, s.complete, Date.now(), st)));
  } catch (e) {
    log('/clear failed:', (e as Error).message);
    await i.editReply(replyEmbed('Не получилось', humanDiscordError(e), COLORS.bad)).catch(() => undefined);
  }
}

export async function handleClearButton(i: ButtonInteraction): Promise<void> {
  const p = parseClearId(i.customId);
  if (!p) return;
  try {
    if (!i.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
      await i.reply({ ...noPerm('Это действие доступно только администраторам сервера.'), flags: EPHEMERAL });
      return;
    }
    if (p.action === 'stop') {
      const r = running.get(p.userId);
      if (r) r.stop = true;
      await i.deferUpdate();
      return;
    }
    if (i.user.id !== p.userId) {
      await i.reply({ ...replyEmbed('Это не ваша очистка', 'Подтвердить может только тот, кто набрал команду. Наберите `/clear` сами.', COLORS.warn), flags: EPHEMERAL });
      return;
    }
    if (p.action === 'no') {
      await i.update({ ...replyEmbed('Отменено', 'Ничего не удалено.', COLORS.ok), ...empty() });
      return;
    }
    if (isExpired(p.at, Date.now())) {
      await i.update({ ...replyEmbed('Время вышло', 'Подтверждение устарело. Наберите `/clear` ещё раз.', COLORS.warn), ...empty() });
      return;
    }
    await i.deferUpdate();
    const ch = asChannel(i);
    const f = await forbidden(i, ch);
    if (!f.mod || !ch) {
      await i.editReply({ ...replyEmbed(f.title ?? 'Сюда нельзя', f.text ?? 'В этом канале очистка не поддерживается.', COLORS.bad), ...empty() });
      return;
    }
    const st: ClearState = { count: p.count, pinned: p.pinned, target: p.target };
    if (p.action === 'set') {
      const s = await scan(ch);
      await i.editReply(confirmView(ch.id, p.userId, st, p.at, estimate(s.list, s.complete, Date.now(), st)));
      return;
    }
    await run(i, ch, st, f.mod);
  } catch (e) {
    log('/clear button failed:', (e as Error).message);
    const out = { ...replyEmbed('Не получилось', humanDiscordError(e), COLORS.bad), ...empty() };
    await (i.deferred || i.replied ? i.editReply(out) : i.update(out)).catch(() => undefined);
  }
}

async function run(i: ButtonInteraction, ch: Cleanable, st: ClearState, mod: Moderation): Promise<void> {
  const state = { stop: false };
  running.set(ch.id, state);
  const cached = scans.get(ch.id);
  const total = expectedTotal(cached ? estimate(cached.list, cached.complete, Date.now(), st) : null, st.count);
  const t: Totals = { deleted: 0, pinned: 0, old: 0 };
  let started = Date.now();
  let outcome: Outcome = 'ok';
  let reason = '';
  try {
    // a pause to change one's mind
    for (let left = COUNTDOWN_SECONDS; left > 0 && !state.stop; left--) {
      await i.editReply(countdownView(ch.id, left)).catch(() => undefined);
      await sleep(1000);
    }
    started = Date.now();
    if (!state.stop) await i.editReply(progressView(ch.id, total, 0, 0)).catch(() => undefined);
    let cursor: string | undefined;
    let shown = 0;
    while (!state.stop && Date.now() - started < MAX_RUN_MS) {
      const room = st.count ? st.count - t.deleted : Infinity;
      if (room <= 0) break;
      const raw = [...(await ch.messages.fetch({ limit: 100, ...(cursor ? { before: cursor } : {}) })).values()];
      if (!raw.length) break;
      cursor = oldestId(raw);
      const s = sortPage(raw.map(toLike), Date.now(), st, room);
      t.pinned += s.pinned;
      t.old += s.old;
      if (s.del.length) t.deleted += (await ch.bulkDelete(s.del, true)).size;
      // newest first: once an old message is met, everything after it is old as well
      if (s.old > 0 || raw.length < 100) break;
      if (Date.now() - shown > 2000) {
        shown = Date.now();
        await i.editReply(progressView(ch.id, total, t.deleted, Date.now() - started)).catch(() => undefined);
      }
    }
    if (state.stop) outcome = 'stopped';
  } catch (e) {
    outcome = 'error';
    const code = (e as { code?: number }).code;
    reason = code === 50013 || code === 50001 ? NEED_TEXT : humanDiscordError(e);
    log('/clear run failed:', (e as Error).message);
  } finally {
    running.delete(ch.id);
    scans.delete(ch.id);
    if (t.deleted) lastDone.set(ch.id, Date.now());
  }
  const elapsed = Date.now() - started;
  await i.editReply({ embeds: [resultEmbed(t, elapsed, outcome, st, reason)], ...empty() }).catch(() => undefined);
  await Promise.all([notice(i, ch, t, st), record(i, mod, ch, t, elapsed, outcome, st, reason)]);
}

/** a short notice for everybody in the channel; it removes itself */
async function notice(i: ButtonInteraction, ch: Cleanable, t: Totals, st: ClearState): Promise<void> {
  if (!t.deleted || !ch.send) return;
  const style = getStyle();
  const n = new EmbedBuilder()
    .setColor(style.accent)
    .setAuthor({ name: (i.user.globalName ?? i.user.username).slice(0, 100), iconURL: i.user.displayAvatarURL({ size: 64 }) })
    .setTitle('🧹 Канал очищен')
    .setDescription(pickLine(Math.random()))
    .addFields({ name: 'Удалено', value: messages(t.deleted), inline: true }, { name: 'Кто убрался', value: `<@${i.user.id}>`, inline: true })
    .setFooter(footerOf('Очистка'));
  if (st.target) n.addFields({ name: 'Чьи сообщения', value: `<@${st.target}>`, inline: true });
  if (style.logoUrl) n.setThumbnail(style.logoUrl);
  const sent = await ch.send({ embeds: [n], allowedMentions: { parse: [] } }).catch(() => null);
  if (sent) setTimeout(() => void sent.delete().catch(() => undefined), 15_000);
}

/** a record in the log channel of the panel */
async function record(i: ButtonInteraction, mod: Moderation, ch: Cleanable, t: Totals, elapsed: number, outcome: Outcome, st: ClearState, reason: string): Promise<void> {
  if (!mod.logChannelId || (!t.deleted && outcome !== 'error')) return;
  try {
    const target = (await i.client.channels.fetch(mod.logChannelId)) as unknown as { send?: (o: unknown) => Promise<unknown> } | null;
    if (!target?.send) return;
    const e = new EmbedBuilder()
      .setColor(outcome === 'error' ? COLORS.bad : outcome === 'stopped' ? COLORS.warn : COLORS.ok)
      .setTitle('🧹 Очистка канала')
      .setThumbnail(i.user.displayAvatarURL({ size: 64 }))
      .addFields(
        { name: 'Модератор', value: `<@${i.user.id}> (${i.user.username})`, inline: true },
        { name: 'Канал', value: `<#${ch.id}>`, inline: true },
        { name: 'Итог', value: outcome === 'ok' ? 'завершено' : outcome === 'stopped' ? 'остановлено' : 'ошибка', inline: true },
        { name: 'Удалено', value: String(t.deleted), inline: true },
        { name: 'Время', value: durationText(elapsed), inline: true },
        { name: 'Что просили', value: `${st.count ? `последние ${st.count}` : 'весь чат'}${st.target ? `, только <@${st.target}>` : ''}${st.pinned ? ', включая закреплённые' : ''}`, inline: false },
      )
      .setTimestamp(new Date())
      .setFooter(footerOf('Журнал'));
    if (t.pinned) e.addFields({ name: '📌 Закреплённых оставлено', value: String(t.pinned), inline: true });
    if (t.old) e.addFields({ name: '⏳ Старше 14 дней', value: `${t.old}+`, inline: true });
    if (reason) e.addFields({ name: 'Причина', value: reason.slice(0, 500) });
    await target.send({ embeds: [e], allowedMentions: { parse: [] } });
  } catch (e) {
    log('/clear log record failed:', (e as Error).message);
  }
}
