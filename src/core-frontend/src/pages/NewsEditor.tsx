import { useEffect, useRef, useState, type ReactNode } from 'react';
import { api, getToken, type NewsItem, type NewsPayload, type NewsSettings } from '../api';
import { ChannelPicker } from '../components/ChannelPicker';
import { ErrorLine, Field, toast } from '../ui';
import { EmbedView, type DiscordEmbed } from './EmbedPreview';

// ---------- draft <-> payload ----------
interface FieldRow { name: string; value: string; inline: boolean }
interface Draft {
  channelId: string;
  content: string;
  mention: 'none' | 'here' | 'everyone';
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

const blank = (channelId: string): Draft => ({
  channelId, content: '', mention: 'none', title: '', url: '', description: '', color: 0x5865f2, authorName: '', authorIcon: '',
  thumbnail: '', imageUrl: '', imageUpload: '', fields: [], footer: '', timestamp: false,
});

function toPayload(d: Draft): NewsPayload {
  return {
    content: d.content,
    mention: d.mention,
    embed: {
      title: d.title,
      url: d.url,
      description: d.description,
      color: d.color,
      author: { name: d.authorName, iconUrl: d.authorIcon },
      thumbnailUrl: d.thumbnail,
      image: { url: d.imageUrl, upload: d.imageUpload || undefined },
      fields: d.fields.filter((f) => f.name.trim() || f.value.trim()),
      footer: { text: d.footer },
      timestamp: d.timestamp,
    },
  };
}

function fromPayload(p: NewsPayload, channelId: string): Draft {
  const e = p.embed ?? {};
  return {
    channelId,
    content: p.content ?? '',
    mention: p.mention ?? 'none',
    title: e.title ?? '',
    url: e.url ?? '',
    description: e.description ?? '',
    color: e.color ?? 0x5865f2,
    authorName: e.author?.name ?? '',
    authorIcon: e.author?.iconUrl ?? '',
    thumbnail: e.thumbnailUrl ?? '',
    imageUrl: e.image?.url ?? '',
    imageUpload: e.image?.upload ?? '',
    fields: (e.fields ?? []).map((f) => ({ name: f.name, value: f.value, inline: !!f.inline })),
    footer: e.footer?.text ?? '',
    timestamp: !!e.timestamp,
  };
}

const imageSrc = (d: Draft) => (d.imageUpload ? `/api/news/images/${d.imageUpload}` : d.imageUrl);

function previewOf(d: Draft): { content: string; embed: DiscordEmbed | null } {
  const mention = d.mention === 'everyone' ? '@everyone' : d.mention === 'here' ? '@here' : '';
  const content = [mention, d.content.trim()].filter(Boolean).join('\n');
  const fields = d.fields.filter((f) => f.name.trim() && f.value.trim());
  const img = imageSrc(d);
  const has = d.title || d.description || d.authorName || d.thumbnail || img || fields.length || d.footer;
  if (!has) return { content, embed: null };
  return {
    content,
    embed: {
      title: d.title || undefined,
      url: d.url || undefined,
      description: d.description || undefined,
      color: d.color,
      author: d.authorName ? { name: d.authorName, icon_url: d.authorIcon || undefined } : undefined,
      thumbnail: d.thumbnail ? { url: d.thumbnail } : undefined,
      image: img ? { url: img } : undefined,
      fields,
      footer: d.footer ? { text: d.footer } : undefined,
      timestamp: d.timestamp ? new Date().toISOString() : undefined,
    },
  };
}

const embedLength = (d: Draft) =>
  d.title.length + d.description.length + d.authorName.length + d.footer.length + d.fields.reduce((n, f) => n + f.name.length + f.value.length, 0);

// ---------- ready-made starting points ----------
export const TEMPLATES: { id: string; label: string; apply: Partial<Draft> }[] = [
  { id: 'announce', label: '📢 Объявление', apply: { title: '📢 Важное объявление', description: 'Здесь текст объявления.\n\nМожно использовать **жирный**, *курсив* и списки:\n- первый пункт\n- второй пункт', color: 0x5865f2, mention: 'none', fields: [], footer: '', timestamp: true } },
  { id: 'restart', label: '🔄 Перезапуск', apply: { title: '🔄 Перезапуск сервера', description: 'Сервер будет перезапущен **ВРЕМЯ** (МСК). Это займёт несколько минут. Сохраните прогресс заранее.', color: 0x3b82f6, mention: 'none', fields: [], footer: '', timestamp: true } },
  { id: 'wipe', label: '🧹 Вайп', apply: { title: '🧹 Вайп сервера', description: 'Вайп состоится **ДАТА** в **ВРЕМЯ** (МСК).\nСервер будет недоступен около часа.', color: 0xf97316, mention: 'here', fields: [{ name: '🗑️ Что сбросится', value: 'Карта, постройки, ресурсы', inline: true }, { name: '✅ Что останется', value: 'Донат, ранги, привилегии', inline: true }], footer: 'Спасибо, что играете с нами', timestamp: true } },
  { id: 'maint', label: '🛠️ Тех. работы', apply: { title: '🛠️ Технические работы', description: 'Сервер временно недоступен: мы проводим плановые работы.', color: 0xf0b232, mention: 'none', fields: [{ name: '🕒 Начало', value: 'ДАТА, ВРЕМЯ', inline: true }, { name: '⏳ Длительность', value: 'около 30 минут', inline: true }], footer: '', timestamp: true } },
  { id: 'update', label: '🚀 Обновление', apply: { title: '🚀 Обновление сервера', description: '**Что нового:**\n- ✨ Новая функция\n- 🐛 Исправлены ошибки\n- ⚡ Улучшена производительность', color: 0x23a55a, mention: 'none', fields: [], footer: '', timestamp: true } },
  { id: 'event', label: '🎉 Ивент', apply: { title: '🎉 Ивент: НАЗВАНИЕ', description: 'Приглашаем всех на ивент! Будет весело.', color: 0xeb459e, mention: 'here', fields: [{ name: '📅 Когда', value: 'ДАТА, ВРЕМЯ', inline: true }, { name: '📍 Где', value: 'Сервер / локация', inline: true }, { name: '🏆 Награда', value: 'Призы победителям', inline: true }], footer: '', timestamp: false } },
  { id: 'giveaway', label: '🎁 Розыгрыш', apply: { title: '🎁 Розыгрыш', description: 'Разыгрываем **ПРИЗ**! Условия ниже.', color: 0xf0b232, mention: 'everyone', fields: [{ name: '📝 Как участвовать', value: 'Поставьте реакцию 🎉 под этим сообщением', inline: false }, { name: '⏰ Итоги', value: 'ДАТА, ВРЕМЯ', inline: false }], footer: 'Удачи!', timestamp: false } },
];

const PALETTE: [string, number][] = [
  ['Фиолетовый', 0x5865f2], ['Зелёный', 0x23a55a], ['Жёлтый', 0xf0b232], ['Красный', 0xf23f42], ['Оранжевый', 0xf97316],
  ['Розовый', 0xeb459e], ['Бирюзовый', 0x14b8a6], ['Синий', 0x3b82f6], ['Серый', 0x4e5058], ['Белый', 0xffffff],
];

const EMOJIS = ['📢', '📣', '🔔', '🎉', '🎊', '🎁', '🏆', '🥇', '⭐', '🌟', '✨', '🔥', '💥', '⚡', '🚀', '🆕', '✅', '❌', '⚠️', '❗', '❓', '🛠️', '🔧', '⚙️', '🧹', '🗑️', '📅', '🗓️', '⏰', '🕒', '⏳', '📍', '🌍', '🗺️', '🎮', '🕹️', '👑', '⚔️', '🛡️', '🏹', '💎', '💰', '🪙', '❤️', '💜', '💙', '💚', '👍', '👏', '🙌', '🤝', '💬', '📝', '📌', '🔗', '🖼️', '🎤', '🎧', '📈', '🟢', '🟡', '🔴', '🔵'];

const hex = (n: number) => `#${n.toString(16).padStart(6, '0')}`;
const toLocalInput = (ms: number) => {
  const d = new Date(ms - new Date(ms).getTimezoneOffset() * 60_000);
  return d.toISOString().slice(0, 16);
};

async function uploadImage(file: File): Promise<string> {
  if (file.size > 8 * 1024 * 1024) throw new Error('Файл больше 8 МБ');
  const res = await fetch('/api/news/images', { method: 'POST', headers: { 'Content-Type': file.type, Authorization: `Bearer ${getToken()}` }, body: file });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error ?? `Ошибка ${res.status}`);
  return (data as { name: string }).name;
}

// ---------- small editor widgets ----------
function Counter({ value, max }: { value: number; max: number }) {
  return <span className={`text-xs font-bold tabular-nums ${value > max ? 'text-bad' : 'text-mute'}`}>{value}/{max}</span>;
}

function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="panel space-y-3.5 p-5">
      <div>
        <h2 className="text-lg font-black">{title}</h2>
        {hint && <p className="text-sm font-semibold text-mute">{hint}</p>}
      </div>
      {children}
    </section>
  );
}

/** Text area with a Discord-markdown toolbar and an emoji picker. */
function MarkdownField({ id, label, value, onChange, max, rows = 6, placeholder }: { id: string; label: string; value: string; onChange: (v: string) => void; max: number; rows?: number; placeholder?: string }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [emoji, setEmoji] = useState(false);

  const edit = (build: (sel: string, before: string, after: string) => { text: string; selStart: number; selEnd: number }) => {
    const ta = ref.current;
    if (!ta) return;
    const s = ta.selectionStart, e = ta.selectionEnd;
    const r = build(value.slice(s, e), value.slice(0, s), value.slice(e));
    onChange(r.text);
    requestAnimationFrame(() => { ta.focus(); ta.setSelectionRange(r.selStart, r.selEnd); });
  };
  const wrap = (mark: string, placeholder = 'текст') => edit((sel, before, after) => {
    const inner = sel || placeholder;
    return { text: before + mark + inner + mark + after, selStart: before.length + mark.length, selEnd: before.length + mark.length + inner.length };
  });
  const prefixLines = (prefix: string) => edit((sel, before, after) => {
    const inner = (sel || 'текст').split('\n').map((l) => prefix + l).join('\n');
    return { text: before + inner + after, selStart: before.length, selEnd: before.length + inner.length };
  });
  const link = () => edit((sel, before, after) => {
    const label = sel || 'текст ссылки';
    const text = `${before}[${label}](https://)${after}`;
    const start = before.length + label.length + 3;
    return { text, selStart: start, selEnd: start + 8 };
  });
  const insert = (t: string) => edit((_sel, before, after) => ({ text: before + t + after, selStart: before.length + t.length, selEnd: before.length + t.length }));

  const Btn = ({ onClick, title, children }: { onClick: () => void; title: string; children: ReactNode }) => (
    <button type="button" title={title} aria-label={title} onClick={onClick} className="grid h-8 min-w-8 place-items-center rounded-lg px-1.5 text-sm font-bold text-ink transition hover:bg-soft">
      {children}
    </button>
  );

  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between">
        <label htmlFor={id} className="label !mb-0">{label}</label>
        <Counter value={value.length} max={max} />
      </div>
      <div className="relative rounded-2xl border-2 border-line focus-within:border-brand">
        <div className="flex flex-wrap items-center gap-0.5 border-b-2 border-line px-1.5 py-1">
          <Btn onClick={() => wrap('**')} title="Жирный"><b>Ж</b></Btn>
          <Btn onClick={() => wrap('*')} title="Курсив"><i>К</i></Btn>
          <Btn onClick={() => wrap('__')} title="Подчёркнутый"><u>Ч</u></Btn>
          <Btn onClick={() => wrap('~~')} title="Зачёркнутый"><s>З</s></Btn>
          <Btn onClick={() => wrap('||')} title="Спойлер">▒</Btn>
          <Btn onClick={() => wrap('`', 'код')} title="Код"><span className="font-mono">{'<>'}</span></Btn>
          <span className="mx-1 h-5 w-px bg-line" />
          <Btn onClick={() => prefixLines('> ')} title="Цитата">❝</Btn>
          <Btn onClick={() => prefixLines('- ')} title="Список">•≡</Btn>
          <Btn onClick={() => prefixLines('## ')} title="Заголовок">H</Btn>
          <Btn onClick={link} title="Ссылка">🔗</Btn>
          <Btn onClick={() => setEmoji((v) => !v)} title="Эмодзи">😀</Btn>
        </div>
        {emoji && (
          <div className="absolute right-0 top-11 z-20 grid w-72 max-w-[85vw] grid-cols-8 gap-0.5 rounded-2xl bg-card p-2 shadow-soft ring-2 ring-line">
            {EMOJIS.map((e) => (
              <button key={e} type="button" className="grid h-8 w-8 place-items-center rounded-lg text-lg hover:bg-soft" onClick={() => { insert(e); setEmoji(false); }}>{e}</button>
            ))}
          </div>
        )}
        <textarea
          id={id}
          ref={ref}
          rows={rows}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="w-full resize-y rounded-b-2xl bg-card px-3.5 py-2.5 font-semibold text-ink placeholder:font-normal placeholder:text-mute/80 focus:outline-none"
        />
      </div>
    </div>
  );
}

function ColorPicker({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {PALETTE.map(([name, c]) => (
        <button
          key={c}
          type="button"
          title={name}
          aria-label={name}
          aria-pressed={value === c}
          onClick={() => onChange(c)}
          className={`h-8 w-8 rounded-full border-2 transition ${value === c ? 'scale-110 border-ink' : 'border-line'}`}
          style={{ background: hex(c) }}
        />
      ))}
      <label className="ml-1 flex cursor-pointer items-center gap-2 text-sm font-extrabold text-mute">
        <input type="color" value={hex(value)} onChange={(e) => onChange(parseInt(e.target.value.slice(1), 16))} className="h-8 w-10 cursor-pointer rounded border-2 border-line bg-card" aria-label="Свой цвет" />
        свой
      </label>
    </div>
  );
}

function ImageInput({ label, url, upload, onUrl, onUpload, allowUpload }: { label: string; url: string; upload: string; onUrl: (v: string) => void; onUpload: (name: string) => void; allowUpload?: boolean }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const pick = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    setErr('');
    try { onUpload(await uploadImage(file)); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <div className="space-y-2">
      <span className="label !mb-0">{label}</span>
      {upload ? (
        <div className="flex items-center gap-3 rounded-2xl bg-soft p-2">
          <img src={`/api/news/images/${upload}`} alt="" className="h-14 w-14 rounded-xl object-cover" />
          <span className="min-w-0 flex-1 truncate text-sm font-bold">Загруженная картинка</span>
          <button type="button" className="btn btn-danger btn-sm" onClick={() => onUpload('')}>Убрать</button>
        </div>
      ) : (
        <div className="flex gap-2">
          <input className="input" value={url} onChange={(e) => onUrl(e.target.value.trim())} placeholder="https://… ссылка на картинку" />
          {allowUpload && (
            <label className={`btn btn-soft shrink-0 cursor-pointer ${busy ? 'pointer-events-none opacity-60' : ''}`}>
              {busy ? 'Загрузка…' : 'Загрузить'}
              <input type="file" accept="image/png,image/jpeg,image/gif,image/webp" className="hidden" onChange={(e) => { void pick(e.target.files?.[0]); e.target.value = ''; }} />
            </label>
          )}
        </div>
      )}
      {err && <p className="text-sm font-bold text-bad">{err}</p>}
    </div>
  );
}

// ---------- the editor ----------
export default function NewsEditor({ id, template }: { id: number | null; template?: string }) {
  const [d, setD] = useState<Draft | null>(null);
  const [item, setItem] = useState<NewsItem | null>(null);
  const [makeDefault, setMakeDefault] = useState(false);
  const [scheduling, setScheduling] = useState(false);
  const [repeat, setRepeat] = useState<'none' | 'daily' | 'weekly' | 'monthly'>('none');
  const [when, setWhen] = useState(() => toLocalInput(Date.now() + 3600_000));
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        if (id) {
          const n = await api<NewsItem>(`/news/${id}`);
          setItem(n);
          setD(fromPayload(n.payload, n.channelId));
          if (n.scheduledAt) setWhen(toLocalInput(n.scheduledAt));
          setRepeat(n.repeat ?? 'none');
        } else {
          const s = await api<NewsSettings>('/news/settings');
          const tpl = TEMPLATES.find((x) => x.id === template);
          setD({ ...blank(s.channelId ?? ''), ...(tpl?.apply ?? {}), channelId: s.channelId ?? '' });
        }
      } catch (e) {
        setError((e as Error).message);
      }
    })();
  }, [id]);

  if (!d) return error ? <ErrorLine text={error} /> : <div className="skeleton panel h-64" />;

  const set = (patch: Partial<Draft>) => setD((cur) => (cur ? { ...cur, ...patch } : cur));
  const isSent = item?.status === 'sent' || item?.status === 'edit_queued';
  const total = embedLength(d);
  const preview = previewOf(d);

  const applyTemplate = (t: (typeof TEMPLATES)[number]) => {
    const dirty = d.title || d.description || d.content || d.fields.length;
    if (dirty && !window.confirm('Заменить текущий текст шаблоном?')) return;
    set({ ...blank(d.channelId), ...t.apply, channelId: d.channelId });
  };

  const save = async (action: 'draft' | 'now' | 'schedule') => {
    setBusy(true);
    setError('');
    try {
      const body = {
        channelId: d.channelId,
        payload: toPayload(d),
        action,
        scheduledAt: action === 'schedule' ? new Date(when).getTime() : undefined,
        repeat: action === 'schedule' ? repeat : undefined,
      };
      if (action === 'schedule' && !(new Date(when).getTime() > Date.now())) throw new Error('Выберите время в будущем');
      await api(id ? `/news/${id}` : '/news', id ? 'PUT' : 'POST', body);
      if (makeDefault && d.channelId) await api('/news/settings', 'PUT', { channelId: d.channelId });
      toast(action === 'now' ? 'Новость отправляется в Discord' : action === 'schedule' ? 'Новость запланирована' : isSent ? 'Изменения отправлены в Discord' : 'Черновик сохранён');
      window.location.hash = '#/admin/news';
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  const noChannel = !/^\d{15,25}$/.test(d.channelId);

  return (
    <div className="space-y-5">
      <a href="#/admin/news" className="inline-flex items-center gap-1 font-extrabold text-link hover:underline">← Все новости</a>
      <div>
        <h1 className="text-3xl font-black tracking-tight">{id ? (isSent ? 'Правка опубликованной новости' : 'Редактирование новости') : 'Новая новость'}</h1>
        {isSent && <p className="mt-0.5 font-semibold text-mute">Сообщение в Discord будет отредактировано, новое отправлено не будет.</p>}
      </div>

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,430px)]">
        <div className="space-y-5">
          <Section title="Куда отправить">
            <Field label="Канал">
              {isSent ? <p className="font-bold">{item?.channelName ? `# ${item.channelName}` : item?.channelId}{item?.guildName ? ` · ${item.guildName}` : ''}</p> : <ChannelPicker id="news-channel" value={d.channelId} onChange={(v) => set({ channelId: v })} />}
            </Field>
            {!isSent && (
              <label className="flex items-center gap-2 text-sm font-bold text-mute">
                <input type="checkbox" className="h-4 w-4 accent-brand" checked={makeDefault} onChange={(e) => setMakeDefault(e.target.checked)} /> Сделать каналом новостей по умолчанию
              </label>
            )}
            <Field label="Упоминание">
              <select id="news-mention" className="input" value={d.mention} onChange={(e) => set({ mention: e.target.value as Draft['mention'] })}>
                <option value="none">Без упоминания</option>
                <option value="here">@here: онлайн-участникам</option>
                <option value="everyone">@everyone: всем</option>
              </select>
            </Field>
            {d.mention !== 'none' && <p className="-mt-2 text-sm font-semibold text-mute">Чтобы упоминание сработало, у бота должно быть право «Упоминать @everyone, @here и все роли» в этом канале.</p>}
          </Section>

          {!id && (
            <Section title="Шаблон" hint="Готовая заготовка, которую можно изменить. Слова ДАТА, ВРЕМЯ и т. п. замените на свои.">
              <div className="flex flex-wrap gap-2">
                {TEMPLATES.map((t) => <button key={t.id} type="button" className="btn btn-soft btn-sm" onClick={() => applyTemplate(t)}>{t.label}</button>)}
                <button type="button" className="btn btn-soft btn-sm" onClick={() => set({ ...blank(d.channelId) })}>Очистить</button>
              </div>
            </Section>
          )}

          <Section title="Текст" hint="Обычный текст над рамкой. Можно оставить пустым.">
            <MarkdownField id="news-content" label="Сообщение" value={d.content} onChange={(v) => set({ content: v })} max={2000} rows={3} placeholder="Например: Друзья, у нас новости!" />
          </Section>

          <Section title="Оформление (embed)" hint="Цветная карточка с заголовком, текстом, полями и картинкой.">
            <Field label="Цвет полосы"><ColorPicker value={d.color} onChange={(c) => set({ color: c })} /></Field>
            <div>
              <div className="mb-1.5 flex items-center justify-between"><label htmlFor="news-title" className="label !mb-0">Заголовок</label><Counter value={d.title.length} max={256} /></div>
              <input id="news-title" className="input" value={d.title} onChange={(e) => set({ title: e.target.value })} maxLength={256} placeholder="📢 Заголовок новости" />
            </div>
            <Field label="Ссылка заголовка (необязательно)">
              <input id="news-url" className="input" value={d.url} onChange={(e) => set({ url: e.target.value.trim() })} placeholder="https://…" />
            </Field>
            <MarkdownField id="news-desc" label="Основной текст" value={d.description} onChange={(v) => set({ description: v })} max={4096} rows={8} placeholder="Расскажите, что произошло. Поддерживается оформление Discord." />

            <details className="rounded-2xl border-2 border-line px-4 py-2.5" open={!!(d.authorName || d.thumbnail || d.imageUrl || d.imageUpload)}>
              <summary className="cursor-pointer select-none font-extrabold text-link">Автор, миниатюра и большая картинка</summary>
              <div className="mt-3 space-y-3.5">
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Автор (имя)"><input className="input" value={d.authorName} onChange={(e) => set({ authorName: e.target.value })} maxLength={256} placeholder="Администрация" /></Field>
                  <Field label="Аватар автора (ссылка)"><input className="input" value={d.authorIcon} onChange={(e) => set({ authorIcon: e.target.value.trim() })} placeholder="https://…" /></Field>
                </div>
                <Field label="Миниатюра справа сверху (ссылка)"><input className="input" value={d.thumbnail} onChange={(e) => set({ thumbnail: e.target.value.trim() })} placeholder="https://…" /></Field>
                <ImageInput label="Большая картинка внизу" url={d.imageUrl} upload={d.imageUpload} onUrl={(v) => set({ imageUrl: v })} onUpload={(n) => set({ imageUpload: n, imageUrl: n ? '' : d.imageUrl })} allowUpload />
              </div>
            </details>
          </Section>

          <Section title="Поля" hint="Блоки «название и значение». Короткие можно ставить в ряд по три.">
            {d.fields.map((f, i) => (
              <div key={i} className="space-y-2 rounded-2xl bg-soft p-3">
                <div className="flex gap-2">
                  <input aria-label="Название поля" className="input" value={f.name} maxLength={256} placeholder="Название" onChange={(e) => set({ fields: d.fields.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) })} />
                  <button type="button" className="btn btn-danger btn-sm shrink-0" aria-label="Удалить поле" onClick={() => set({ fields: d.fields.filter((_, j) => j !== i) })}>✕</button>
                </div>
                <textarea aria-label="Текст поля" className="input min-h-[4.5rem]" rows={2} value={f.value} maxLength={1024} placeholder="Текст" onChange={(e) => set({ fields: d.fields.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)) })} />
                <label className="flex items-center gap-2 text-sm font-bold text-mute">
                  <input type="checkbox" className="h-4 w-4 accent-brand" checked={f.inline} onChange={(e) => set({ fields: d.fields.map((x, j) => (j === i ? { ...x, inline: e.target.checked } : x)) })} /> В ряд с соседними
                </label>
              </div>
            ))}
            <button type="button" className="btn btn-soft btn-sm" disabled={d.fields.length >= 25} onClick={() => set({ fields: [...d.fields, { name: '', value: '', inline: d.fields.length > 0 && d.fields.length < 3 }] })}>+ Добавить поле</button>
          </Section>

          <Section title="Подпись">
            <div>
              <div className="mb-1.5 flex items-center justify-between"><label htmlFor="news-footer" className="label !mb-0">Текст внизу</label><Counter value={d.footer.length} max={2048} /></div>
              <input id="news-footer" className="input" value={d.footer} onChange={(e) => set({ footer: e.target.value })} maxLength={2048} placeholder="Например: Администрация сервера" />
            </div>
            <label className="flex items-center gap-2 text-sm font-bold text-mute">
              <input type="checkbox" className="h-4 w-4 accent-brand" checked={d.timestamp} onChange={(e) => set({ timestamp: e.target.checked })} /> Показывать время публикации
            </label>
          </Section>
        </div>

        <aside className="space-y-4 lg:sticky lg:top-4">
          <div className="panel p-4">
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-lg font-black">Предпросмотр</h2>
              <span className={`text-xs font-bold tabular-nums ${total > 6000 ? 'text-bad' : 'text-mute'}`} title="Лимит Discord на весь embed">{total}/6000</span>
            </div>
            {preview.content || preview.embed ? <EmbedView content={preview.content} embed={preview.embed} /> : <p className="py-10 text-center font-semibold text-mute">Начните писать: здесь появится сообщение, как оно будет выглядеть в Discord.</p>}
          </div>

          <div className="panel space-y-3 p-4">
            <ErrorLine text={error} />
            {noChannel && !isSent && <p className="text-sm font-bold text-mute">Выберите канал, чтобы опубликовать или запланировать.</p>}
            {isSent ? (
              <button className="btn w-full" disabled={busy} onClick={() => save('draft')}>{busy ? 'Сохраняю…' : 'Сохранить изменения в Discord'}</button>
            ) : (
              <>
                <button className="btn w-full" disabled={busy || noChannel} onClick={() => save('now')}>{busy ? 'Отправляю…' : 'Опубликовать сейчас'}</button>
                {scheduling ? (
                  <div className="space-y-2 rounded-2xl bg-soft p-3">
                    <label htmlFor="news-when" className="label">Когда опубликовать</label>
                    <input id="news-when" type="datetime-local" className="input" value={when} min={toLocalInput(Date.now())} onChange={(e) => setWhen(e.target.value)} />
                    <label htmlFor="news-repeat" className="label">Повторять</label>
                    <select id="news-repeat" className="input" value={repeat} onChange={(e) => setRepeat(e.target.value as typeof repeat)}>
                      <option value="none">Не повторять</option>
                      <option value="daily">Каждый день</option>
                      <option value="weekly">Каждую неделю</option>
                      <option value="monthly">Каждый месяц</option>
                    </select>
                    <div className="flex gap-2">
                      <button className="btn flex-1" disabled={busy || noChannel} onClick={() => save('schedule')}>Запланировать</button>
                      <button className="btn btn-soft" onClick={() => setScheduling(false)}>Отмена</button>
                    </div>
                  </div>
                ) : (
                  <button className="btn btn-soft w-full" disabled={busy || noChannel} onClick={() => setScheduling(true)}>Запланировать на время…</button>
                )}
                <button className="btn btn-soft w-full" disabled={busy || noChannel} onClick={() => save('draft')}>Сохранить как черновик</button>
              </>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}
