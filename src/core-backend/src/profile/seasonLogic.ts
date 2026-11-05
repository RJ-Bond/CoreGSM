/** The Discord message about a finished season: the podium and the length of the season. Pure, so it is tested on its own. */
import { COLORS } from '../discord/palette.js';

export interface PodiumRow { name: string; hours: number }

/** markdown characters of a nick, so a nick cannot format the message */
const SPECIAL = new Set(['*', '_', '~', '|', '>', String.fromCharCode(96), String.fromCharCode(92)]);
const esc = (v: string) => [...v].map((c) => (SPECIAL.has(c) ? String.fromCharCode(92) + c : c)).join('');

const MEDALS = ['🥇', '🥈', '🥉'];

export function seasonSummary(name: string, startsAt: number, endsAt: number, podium: PodiumRow[], next: string): { content: string; mention: 'none'; embed: Record<string, unknown> } {
  const days = Math.max(1, Math.round((endsAt - startsAt) / 86_400_000));
  const lines = podium.slice(0, 3).map((p, i) => `${MEDALS[i]} **${esc(p.name)}** · ${Math.round(p.hours * 10) / 10} ч`);
  return {
    content: '',
    mention: 'none',
    embed: {
      title: `🏁 Сезон «${name}» завершён`,
      description: `${lines.length ? lines.join('\n') : 'В этом сезоне никто не играл.'}\n\nСезон длился ${days} дн. Начинается «${next}»: лидерам нового сезона достанутся значки первых.`,
      color: COLORS.info,
    },
  };
}
