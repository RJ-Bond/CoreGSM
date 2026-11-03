/** Texts and names of the news subscriptions (pure, no database). */

export const NEWS_RUBRICS = ['announcement', 'wipe', 'update', 'event', 'maintenance', 'other'] as const;
export type Rubric = (typeof NEWS_RUBRICS)[number];

export const RUBRIC_EMOJI: Record<Rubric, string> = { announcement: '📣', wipe: '🧹', update: '🛠️', event: '🎉', maintenance: '🔧', other: '📰' };

/** «🧹 Новая новость: …» for the bell and the DM */
export const newsNoticeText = (category: string, title: string): string => `${RUBRIC_EMOJI[category as Rubric] ?? '📰'} Новая новость: «${title.slice(0, 120)}»`;

export const normRubric = (c: unknown): Rubric => ((NEWS_RUBRICS as readonly string[]).includes(String(c)) ? (c as Rubric) : 'announcement');
