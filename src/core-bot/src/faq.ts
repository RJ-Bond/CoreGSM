/** /faq (answers written in the panel, with suggestions while typing) and the answer when somebody mentions the bot in a question. */
import { EmbedBuilder, type AutocompleteInteraction, type ChatInputCommandInteraction, type Message } from 'discord.js';
import { backendJson } from './backend.js';
import { faqAllowed, mentionQuestion } from './faqLogic.js';
import { langOf } from './helpData.js';
import { log } from './log.js';
import { footerOf, getStyle } from './style.js';

export const FAQ_COMMANDS = [
  {
    name: 'faq',
    description: 'Ответ на частый вопрос о сообществе и серверах',
    description_localizations: { 'en-US': 'Answer to a frequent question about the community and servers', 'en-GB': 'Answer to a frequent question about the community and servers' },
    options: [
      {
        type: 3,
        name: 'question',
        description: 'Вопрос: начните вводить и выберите из списка',
        description_localizations: { 'en-US': 'Question: start typing and pick from the list', 'en-GB': 'Question: start typing and pick from the list' },
        required: true,
        autocomplete: true,
      },
    ],
  },
];
export const FAQ_NAMES = new Set(FAQ_COMMANDS.map((c) => c.name));

interface Answer { id: number; title: string; answer: string }

function card(a: Answer): EmbedBuilder {
  return new EmbedBuilder().setTitle(`💬 ${a.title}`.slice(0, 256)).setDescription(a.answer.slice(0, 4000)).setColor(getStyle().accent).setFooter(footerOf('FAQ'));
}

export async function faqAutocomplete(i: AutocompleteInteraction): Promise<void> {
  let items: { name: string; value: string }[] = [];
  try {
    const r = await backendJson<{ items?: { name: string; value: string }[] }>(`/internal/faq/suggest?q=${encodeURIComponent(String(i.options.getFocused()).slice(0, 60))}`, { signal: AbortSignal.timeout(2000) });
    items = r.data?.items ?? [];
  } catch {
    items = [];
  }
  await i.respond(items.slice(0, 25)).catch((e) => log('faq autocomplete failed:', (e as Error).message));
}

export async function handleFaq(i: ChatInputCommandInteraction): Promise<void> {
  const en = langOf(i.locale) === 'en';
  try {
    await i.deferReply();
  } catch (e) {
    log('faq: could not acknowledge:', (e as Error).message);
    return;
  }
  const v = i.options.getString('question', true);
  const path = /^\d+$/.test(v) ? `/internal/faq/${v}` : null;
  const r = path
    ? await backendJson<Answer>(path).catch(() => null)
    : await backendJson<Answer>('/internal/faq/match', { method: 'POST', body: JSON.stringify({ text: v }) }).catch(() => null);
  if (!r?.data || !r.ok) {
    await i.editReply({ content: en ? 'No ready answer for that. Ask the moderators.' : 'Готового ответа на это нет. Спросите у модераторов.' }).catch(() => undefined);
    return;
  }
  await i.editReply({ embeds: [card(r.data)], allowedMentions: { parse: [] } }).catch((e) => log('faq reply failed:', (e as Error).message));
}

const last = new Map<string, number>();

/** a message that mentions the bot with a question: answer with the matching entry, once per channel pause, stay silent otherwise */
export async function handleFaqMessage(m: Message): Promise<void> {
  const me = m.client.user?.id;
  if (!me || m.author.bot || !m.guildId || !m.mentions.users.has(me)) return;
  const q = mentionQuestion(m.content, me);
  if (!q) return;
  const r = await backendJson<Answer>('/internal/faq/match', { method: 'POST', body: JSON.stringify({ text: q }), signal: AbortSignal.timeout(3000) }).catch(() => null);
  if (!r?.ok || !r.data) return;
  if (!faqAllowed(last, m.channelId, Date.now())) return;
  await m.reply({ embeds: [card(r.data)], allowedMentions: { parse: [], repliedUser: false } }).catch((e) => log('faq answer failed:', (e as Error).message));
}
