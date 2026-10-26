import { getToken, type NewsCategory, type NewsChangeKind, type NewsEmbed, type NewsPayload } from '../../api';
import { isHttpsUrl, isChangeKind, normCategory } from './newsLogic';
import { GAMES } from '../../games';
import { errorText } from '../../apiErrors';

// ---------- limits (Discord) ----------
export const LIMITS = {
  content: 2000,
  title: 256,
  description: 4096,
  author: 256,
  fieldName: 256,
  fieldValue: 1024,
  fields: 25,
  footer: 2048,
  total: 6000,
  embeds: 10,
  statusServers: 5,
  gallery: 6,
  changes: 20,
  changeText: 200,
  actions: 3,
  actionLabel: 40,
  countdownLabel: 60,
} as const;

// ---------- draft <-> payload ----------
export interface FieldRow { k: string; name: string; value: string; inline: boolean }

export interface EmbedDraft {
  title: string;
  url: string;
  description: string;
  color: number;
  authorName: string;
  authorIcon: string;
  thumbnail: string;
  imageUrl: string;
  imageUpload: string;
  fields: FieldRow[];
  footer: string;
  timestamp: boolean;
}

export interface Draft {
  channelId: string;
  content: string;
  mention: 'none' | 'here' | 'everyone';
  /** the first one is `payload.embed`, the others `payload.extraEmbeds` */
  embeds: EmbedDraft[];
  statusServerIds: number[];
  // site-only fields (the Discord message ignores them)
  category: NewsCategory;
  pinned: boolean;
  game: string;
  gallery: GalleryRow[];
  changes: ChangeRow[];
  /** value of a datetime-local input ('' = no countdown) */
  countdownAt: string;
  countdownLabel: string;
  actions: ActionRow[];
}

export interface GalleryRow { k: string; url: string; upload: string }
export interface ChangeRow { k: string; kind: NewsChangeKind; text: string }
export interface ActionRow { k: string; label: string; url: string }

let keySeq = 0;
export const newKey = () => `f${Date.now().toString(36)}${(keySeq++).toString(36)}`;

export const blankEmbed = (): EmbedDraft => ({
  title: '', url: '', description: '', color: 0x5865f2, authorName: '', authorIcon: '',
  thumbnail: '', imageUrl: '', imageUpload: '', fields: [], footer: '', timestamp: false,
});

export const blankSite = (): Pick<Draft, 'category' | 'pinned' | 'game' | 'gallery' | 'changes' | 'countdownAt' | 'countdownLabel' | 'actions'> => ({
  category: 'announcement', pinned: false, game: '', gallery: [], changes: [], countdownAt: '', countdownLabel: '', actions: [],
});

export const blank = (channelId: string): Draft => ({ channelId, content: '', mention: 'none', embeds: [blankEmbed()], statusServerIds: [], ...blankSite() });

function embedToPayload(d: EmbedDraft): NewsEmbed {
  return {
    title: d.title,
    url: d.url,
    description: d.description,
    color: d.color,
    author: { name: d.authorName, iconUrl: d.authorIcon },
    thumbnailUrl: d.thumbnail,
    image: { url: d.imageUrl, upload: d.imageUpload || undefined },
    fields: d.fields.filter((f) => f.name.trim() || f.value.trim()).map((f) => ({ name: f.name, value: f.value, inline: f.inline })),
    footer: { text: d.footer },
    timestamp: d.timestamp,
  };
}

export function toPayload(d: Draft): NewsPayload {
  const p: NewsPayload = { content: d.content, mention: d.mention, embed: embedToPayload(d.embeds[0] ?? blankEmbed()) };
  if (d.embeds.length > 1) p.extraEmbeds = d.embeds.slice(1).map(embedToPayload);
  if (d.statusServerIds.length) p.statusServerIds = d.statusServerIds;
  if (d.category !== 'announcement') p.category = d.category;
  if (d.pinned) p.pinned = true;
  if (d.game) p.game = d.game;
  const gallery = d.gallery.filter((g) => g.upload || g.url.trim()).slice(0, LIMITS.gallery).map((g) => (g.upload ? { upload: g.upload } : { url: g.url.trim() }));
  if (gallery.length) p.gallery = gallery;
  const changes = d.changes.filter((c) => c.text.trim()).slice(0, LIMITS.changes).map((c) => ({ kind: c.kind, text: c.text.trim() }));
  if (changes.length) p.changes = changes;
  const at = d.countdownAt ? new Date(d.countdownAt).getTime() : NaN;
  if (Number.isFinite(at)) {
    p.countdownAt = at;
    if (d.countdownLabel.trim()) p.countdownLabel = d.countdownLabel.trim();
  }
  const actions = d.actions.filter((a) => a.label.trim() && a.url.trim()).slice(0, LIMITS.actions).map((a) => ({ label: a.label.trim(), url: a.url.trim() }));
  if (actions.length) p.actions = actions;
  return p;
}

function embedFromPayload(e: NewsEmbed | undefined): EmbedDraft {
  const x = e ?? {};
  return {
    title: x.title ?? '',
    url: x.url ?? '',
    description: x.description ?? '',
    color: x.color ?? 0x5865f2,
    authorName: x.author?.name ?? '',
    authorIcon: x.author?.iconUrl ?? '',
    thumbnail: x.thumbnailUrl ?? '',
    imageUrl: x.image?.url ?? '',
    imageUpload: x.image?.upload ?? '',
    fields: (x.fields ?? []).map((f) => ({ k: newKey(), name: f.name, value: f.value, inline: !!f.inline })),
    footer: x.footer?.text ?? '',
    timestamp: !!x.timestamp,
  };
}

export function fromPayload(p: NewsPayload, channelId: string): Draft {
  return {
    channelId,
    content: p.content ?? '',
    mention: p.mention ?? 'none',
    embeds: [embedFromPayload(p.embed), ...(p.extraEmbeds ?? []).map((e) => embedFromPayload(e))].slice(0, LIMITS.embeds),
    statusServerIds: (p.statusServerIds ?? []).slice(0, LIMITS.statusServers),
    category: normCategory(p.category),
    pinned: !!p.pinned,
    game: typeof p.game === 'string' ? p.game : '',
    gallery: (Array.isArray(p.gallery) ? p.gallery : []).slice(0, LIMITS.gallery).map((g) => ({ k: newKey(), url: g?.url ?? '', upload: g?.upload ?? '' })),
    changes: (Array.isArray(p.changes) ? p.changes : []).slice(0, LIMITS.changes).map((c) => ({ k: newKey(), kind: isChangeKind(c?.kind) ? c.kind : 'change', text: c?.text ?? '' })),
    countdownAt: typeof p.countdownAt === 'number' && Number.isFinite(p.countdownAt) && p.countdownAt > 0 ? toLocalInput(p.countdownAt) : '',
    countdownLabel: p.countdownLabel ?? '',
    actions: (Array.isArray(p.actions) ? p.actions : []).slice(0, LIMITS.actions).map((a) => ({ k: newKey(), label: a?.label ?? '', url: a?.url ?? '' })),
  };
}

/** stable string of a payload: "did anything change" */
export const payloadKey = (p: NewsPayload) => JSON.stringify(p);

export const imageSrc = (e: EmbedDraft) => (e.imageUpload ? `/api/news/images/${e.imageUpload}` : e.imageUrl);

export const embedLength = (e: EmbedDraft) =>
  e.title.length + e.description.length + e.authorName.length + e.footer.length + e.fields.reduce((n, f) => n + f.name.length + f.value.length, 0);

export const embedHasContent = (e: EmbedDraft) =>
  !!(e.title.trim() || e.description.trim() || e.authorName.trim() || e.thumbnail || imageSrc(e) || e.footer.trim() || e.fields.some((f) => f.name.trim() && f.value.trim()));

// ---------- ready-made starting points ----------
export interface TemplateApply extends Partial<Omit<EmbedDraft, 'fields'>> {
  mention?: Draft['mention'];
  fields?: { name: string; value: string; inline: boolean }[];
}

export const TEMPLATES: { id: string; label: string; apply: TemplateApply }[] = [
  { id: 'announce', label: '📢 Объявление', apply: { title: '📢 Важное объявление', description: 'Здесь текст объявления.\n\nМожно использовать **жирный**, *курсив* и списки:\n- первый пункт\n- второй пункт', color: 0x5865f2, mention: 'none', fields: [], footer: '', timestamp: true } },
  { id: 'restart', label: '🔄 Перезапуск', apply: { title: '🔄 Перезапуск сервера', description: 'Сервер будет перезапущен **ВРЕМЯ** (МСК). Это займёт несколько минут. Сохраните прогресс заранее.', color: 0x3b82f6, mention: 'none', fields: [], footer: '', timestamp: true } },
  { id: 'wipe', label: '🧹 Вайп', apply: { title: '🧹 Вайп сервера', description: 'Вайп состоится **ДАТА** в **ВРЕМЯ** (МСК).\nСервер будет недоступен около часа.', color: 0xf97316, mention: 'here', fields: [{ name: '🗑️ Что сбросится', value: 'Карта, постройки, ресурсы', inline: true }, { name: '✅ Что останется', value: 'Донат, ранги, привилегии', inline: true }], footer: 'Спасибо, что играете с нами', timestamp: true } },
  { id: 'maint', label: '🛠️ Тех. работы', apply: { title: '🛠️ Технические работы', description: 'Сервер временно недоступен: мы проводим плановые работы.', color: 0xf0b232, mention: 'none', fields: [{ name: '🕒 Начало', value: 'ДАТА, ВРЕМЯ', inline: true }, { name: '⏳ Длительность', value: 'около 30 минут', inline: true }], footer: '', timestamp: true } },
  { id: 'update', label: '🚀 Обновление', apply: { title: '🚀 Обновление сервера', description: '**Что нового:**\n- ✨ Новая функция\n- 🐛 Исправлены ошибки\n- ⚡ Улучшена производительность', color: 0x23a55a, mention: 'none', fields: [], footer: '', timestamp: true } },
  { id: 'event', label: '🎉 Ивент', apply: { title: '🎉 Ивент: НАЗВАНИЕ', description: 'Приглашаем всех на ивент! Будет весело.', color: 0xeb459e, mention: 'here', fields: [{ name: '📅 Когда', value: 'ДАТА, ВРЕМЯ', inline: true }, { name: '📍 Где', value: 'Сервер / локация', inline: true }, { name: '🏆 Награда', value: 'Призы победителям', inline: true }], footer: '', timestamp: false } },
  { id: 'tournament', label: '🏆 Турнир', apply: { title: '🏆 Турнир: НАЗВАНИЕ', description: 'Открываем регистрацию на турнир! Собирайте команды.', color: 0xf0b232, mention: 'here', fields: [{ name: '📅 Старт', value: 'ДАТА, ВРЕМЯ', inline: true }, { name: '👥 Формат', value: 'Команды по N человек', inline: true }, { name: '🏅 Призы', value: 'Места и награды', inline: false }, { name: '📝 Как записаться', value: 'Где и до какого числа', inline: false }], footer: '', timestamp: true } },
  { id: 'giveaway', label: '🎁 Розыгрыш', apply: { title: '🎁 Розыгрыш', description: 'Разыгрываем **ПРИЗ**! Условия ниже.', color: 0xf0b232, mention: 'everyone', fields: [{ name: '📝 Как участвовать', value: 'Поставьте реакцию 🎉 под этим сообщением', inline: false }, { name: '⏰ Итоги', value: 'ДАТА, ВРЕМЯ', inline: false }], footer: 'Удачи!', timestamp: false } },
];

/** apply a template to the first embed (and mention) of a draft, keeping the channel */
export function applyTemplate(d: Draft, t: TemplateApply): Draft {
  const { mention, fields, ...rest } = t;
  const e: EmbedDraft = { ...blankEmbed(), ...rest, fields: (fields ?? []).map((f) => ({ ...f, k: newKey() })) };
  return { ...blank(d.channelId), mention: mention ?? 'none', embeds: [e], category: d.category, pinned: d.pinned, game: d.game, gallery: d.gallery, changes: d.changes, countdownAt: d.countdownAt, countdownLabel: d.countdownLabel, actions: d.actions };
}

// ---------- message types: colour + icon + title prefix ----------
export interface Preset { id: string; label: string; icon: string; color: number }
export const PRESETS: Preset[] = [
  { id: 'update', label: 'Обновление', icon: '🚀', color: 0x23a55a },
  { id: 'event', label: 'Событие', icon: '🎉', color: 0xeb459e },
  { id: 'wipe', label: 'Вайп', icon: '🧹', color: 0xf97316 },
  { id: 'maint', label: 'Технические работы', icon: '🛠️', color: 0xf0b232 },
  { id: 'announce', label: 'Объявление', icon: '📢', color: 0x5865f2 },
];

const ICONS = PRESETS.map((p) => p.icon);

export function applyPreset(e: EmbedDraft, p: Preset): EmbedDraft {
  let title = e.title;
  for (const i of ICONS) if (title.startsWith(i)) { title = title.slice(i.length).trimStart(); break; }
  return { ...e, color: p.color, title: `${p.icon} ${title}`.trimEnd().slice(0, LIMITS.title) };
}

export const presetOf = (e: EmbedDraft) => PRESETS.find((p) => e.color === p.color && e.title.startsWith(p.icon));

// ---------- colours ----------
export const PALETTE: [string, number][] = [
  ['Фиолетовый', 0x5865f2], ['Зелёный', 0x23a55a], ['Жёлтый', 0xf0b232], ['Красный', 0xf23f42], ['Оранжевый', 0xf97316],
  ['Розовый', 0xeb459e], ['Бирюзовый', 0x14b8a6], ['Синий', 0x3b82f6], ['Серый', 0x4e5058], ['Белый', 0xffffff],
];

export const hex = (n: number) => `#${n.toString(16).padStart(6, '0')}`;
export const parseHex = (h: string) => parseInt(h.replace('#', ''), 16);

/** accent colours of games: V Rising purple, Icarus yellow and the games of the user's servers */
export function gameColors(gameIds: string[] = []): [string, number][] {
  const ids = ['vrising', 'icarus', ...gameIds];
  const seen = new Set<number>();
  const out: [string, number][] = [];
  for (const id of ids) {
    const g = GAMES.find((x) => x.id === id);
    if (!g) continue;
    const c = parseHex(g.color);
    if (!Number.isFinite(c) || seen.has(c)) continue;
    seen.add(c);
    out.push([g.label, c]);
  }
  return out;
}

// ---------- misc helpers ----------
export const toLocalInput = (ms: number) => {
  const d = new Date(ms - new Date(ms).getTimezoneOffset() * 60_000);
  return d.toISOString().slice(0, 16);
};

export const MAX_UPLOAD = 8 * 1024 * 1024;

export async function uploadImage(file: File): Promise<string> {
  if (!/^image\/(png|jpeg|gif|webp)$/.test(file.type)) throw new Error('Нужна картинка PNG, JPEG, GIF или WebP');
  if (file.size > MAX_UPLOAD) throw new Error('Файл больше 8 МБ');
  const res = await fetch('/api/news/images', { method: 'POST', headers: { 'Content-Type': file.type, Authorization: `Bearer ${getToken()}` }, body: file });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(errorText(data, `Ошибка ${res.status}`));
  return (data as { name: string }).name;
}

// ---------- variables ----------
export interface VarServer { id: number; name: string; online: boolean; players: number; maxPlayers: number; address: string; map: string | null; ping: number | null }
export interface VarSample { players: number; online: number; servers: number; date: string; time: string; byId: Map<number, VarServer> }

export function sampleVars(servers: VarServer[] | null, now = new Date()): VarSample {
  const list = servers ?? [];
  const p = (n: number) => String(n).padStart(2, '0');
  return {
    players: list.reduce((n, s) => n + (s.online ? s.players : 0), 0),
    online: list.filter((s) => s.online).length,
    servers: list.length,
    date: `${p(now.getDate())}.${p(now.getMonth() + 1)}.${now.getFullYear()}`,
    time: `${p(now.getHours())}:${p(now.getMinutes())}`,
    byId: new Map(list.map((s) => [s.id, s])),
  };
}

export function resolveVars(text: string, v: VarSample): string {
  if (!text || !text.includes('{')) return text;
  return text
    .replace(/\{(players|online|servers|date|time)\}/g, (_m, k: 'players' | 'online' | 'servers' | 'date' | 'time') => String(v[k]))
    .replace(/\{server\.(\d+)\.(name|players|max|online|address|map|ping)\}/g, (m, id: string, k: string) => {
      const s = v.byId.get(Number(id));
      if (!s) return m;
      switch (k) {
        case 'name': return s.name;
        case 'players': return String(s.players);
        case 'max': return String(s.maxPlayers);
        case 'online': return s.online ? 'онлайн' : 'офлайн';
        case 'address': return s.address;
        case 'map': return s.map ?? '–';
        default: return s.ping != null ? `${s.ping} мс` : '–';
      }
    });
}

// ---------- validation (limits) ----------
/** keys of preview parts that exceed a Discord limit: `${embed}:title`, `${embed}:field:${i}`, `content` ... */
export function invalidParts(d: Draft): Set<string> {
  const s = new Set<string>();
  if (d.content.length + (d.mention !== 'none' ? 9 : 0) > LIMITS.content) s.add('content');
  d.embeds.forEach((e, i) => {
    if (e.title.length > LIMITS.title) s.add(`${i}:title`);
    if (e.description.length > LIMITS.description) s.add(`${i}:description`);
    if (e.authorName.length > LIMITS.author) s.add(`${i}:author`);
    if (e.footer.length > LIMITS.footer) s.add(`${i}:footer`);
    e.fields.forEach((f, j) => {
      if (f.name.length > LIMITS.fieldName || f.value.length > LIMITS.fieldValue) s.add(`${i}:field:${j}`);
    });
  });
  return s;
}

export const totalLength = (d: Draft) => d.embeds.reduce((n, e) => n + embedLength(e), 0);

// ---------- pre-send checklist ----------
export interface Check { level: 'ok' | 'warn' | 'error'; text: string }

const TEMPLATE_WORDS = /(^|[^А-ЯЁа-яёA-Za-z0-9_])(ДАТА|ВРЕМЯ|НАЗВАНИЕ|ПРИЗ)(?![А-ЯЁа-яёA-Za-z0-9_])/g;

/** links in a Discord-markdown text: http:// ones, an empty [text]() and a bare «www.» that is not a link in Discord */
export function linkProblems(text: string): { insecure: number; empty: number; bare: number } {
  return {
    empty: (text.match(/\[[^\]]*\]\(\s*\)/g) ?? []).length,
    insecure: (text.match(/\bhttp:\/\/[^\s)>\]]+/gi) ?? []).length,
    bare: (text.match(/(^|[\s(])www\.[^\s)]+/gi) ?? []).length,
  };
}

export function runChecks(d: Draft): Check[] {
  const out: Check[] = [];
  const noChannel = !/^\d{15,25}$/.test(d.channelId);
  out.push(noChannel ? { level: 'error', text: 'Не выбран канал для отправки.' } : { level: 'ok', text: 'Канал выбран.' });

  const hasEmbed = d.embeds.some(embedHasContent);
  const empty = !d.content.trim() && !hasEmbed && d.statusServerIds.length === 0;
  out.push(empty ? { level: 'error', text: 'Сообщение пустое: добавьте текст, заголовок или картинку.' } : { level: 'ok', text: 'В сообщении есть содержимое.' });

  if (d.embeds.length > LIMITS.embeds) out.push({ level: 'error', text: `Embed-блоков ${d.embeds.length}, максимум ${LIMITS.embeds}.` });
  const total = totalLength(d);
  if (total > LIMITS.total) out.push({ level: 'error', text: `Суммарная длина embed ${total} символов, максимум ${LIMITS.total}.` });
  const bad = invalidParts(d);
  if (bad.size) out.push({ level: 'error', text: `Превышены лимиты Discord в ${bad.size} ${bad.size === 1 ? 'месте' : 'местах'} (подсвечено красным в предпросмотре).` });

  if (d.mention === 'everyone' || /@everyone/.test(d.content) || d.embeds.some((e) => /@everyone/.test(e.description))) {
    out.push({ level: 'warn', text: 'Сообщение упомянет @everyone: уведомление получат все участники сервера. Убедитесь, что это нужно.' });
  } else if (d.mention === 'here' || /@here/.test(d.content)) {
    out.push({ level: 'warn', text: 'Сообщение упомянет @here: уведомление получат все, кто сейчас онлайн.' });
  }

  const badAction = d.actions.filter((a) => (a.label.trim() || a.url.trim()) && !(a.label.trim() && isHttpsUrl(a.url))).length;
  if (badAction) out.push({ level: 'warn', text: `Кнопок на сайте с пустой подписью или ссылкой не по https://: ${badAction}. Они не будут показаны.` });
  if (d.countdownAt && new Date(d.countdownAt).getTime() < Date.now()) out.push({ level: 'warn', text: 'Время отсчёта уже прошло: на сайте будет «Началось».' });

  const httpImg: string[] = [];
  d.embeds.forEach((e) => {
    for (const u of [e.imageUrl, e.thumbnail, e.authorIcon]) if (u && !/^https:\/\//i.test(u)) httpImg.push(u);
  });
  if (httpImg.length) out.push({ level: 'warn', text: 'Ссылка на картинку не начинается с https://: Discord может её не показать.' });

  const half = d.embeds.reduce((n, e) => n + e.fields.filter((f) => !!f.name.trim() !== !!f.value.trim()).length, 0);
  if (half) out.push({ level: 'warn', text: `Полей с пустым названием или значением: ${half}. Они не будут показаны.` });

  const allText = [d.content, ...d.embeds.flatMap((e) => [e.description, ...e.fields.map((f) => f.value)])].join('\n');
  const lp = linkProblems(allText);
  if (lp.empty) out.push({ level: 'warn', text: `Ссылок без адреса: ${lp.empty}. Текст в скобках пустой, ссылка не откроется.` });
  if (lp.insecure) out.push({ level: 'warn', text: `Ссылок без https://: ${lp.insecure}. Браузер предупредит об опасном соединении.` });
  if (lp.bare) out.push({ level: 'warn', text: `Адресов, начинающихся с www., без http(s)://: ${lp.bare}. Discord не сделает их ссылкой.` });

  const first = d.embeds[0];
  if (first && embedHasContent(first) && !first.title.trim()) out.push({ level: 'warn', text: 'У новости нет заголовка: на сайте она будет без названия.' });
  const external = d.embeds.filter((e) => e.imageUrl.trim() && !e.imageUpload).length + d.gallery.filter((g) => g.url.trim() && !g.upload).length;
  if (external) out.push({ level: 'warn', text: `Картинок по внешней ссылке: ${external}. Чужой сайт может убрать или не открыть файл: надёжнее загрузить картинку в редактор.` });
  if (first && embedHasContent(first) && !first.imageUrl.trim() && !first.imageUpload && d.gallery.length === 0) out.push({ level: 'ok', text: 'Обложки нет: на сайте её нарисует панель.' });

  const texts = [d.content, ...d.embeds.flatMap((e) => [e.title, e.description, e.footer, e.authorName, ...e.fields.flatMap((f) => [f.name, f.value])])];
  const words = new Set<string>();
  for (const t of texts) for (const m of t.matchAll(TEMPLATE_WORDS)) words.add(m[2]);
  if (words.size) out.push({ level: 'warn', text: `В тексте остались слова шаблона: ${[...words].join(', ')}. Замените их на свои.` });

  return out;
}
