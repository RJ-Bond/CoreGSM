import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  api, ApiError, type DiscordGuild, type NewsAuthor, type NewsAutosave, type NewsItem, type NewsPayload, type NewsSettings, type NewsTestResult, type NewsTestStatus, type NewsVariable, type Server,
} from '../api';
import { confirmDialog } from '../confirm';
import { ChannelPicker } from '../components/ChannelPicker';
import { ChecklistModal } from '../components/news/Checklist';
import { FieldsBuilder } from '../components/news/FieldsBuilder';
import { HistoryPanel } from '../components/news/HistoryPanel';
import { ImageDrop } from '../components/news/ImageDrop';
import { LimitsPanel } from '../components/news/LimitsPanel';
import { Counter, MarkdownField } from '../components/news/MarkdownField';
import {
  LIMITS, PALETTE, PRESETS, TEMPLATES, applyPreset, applyTemplate as applyTpl, blank, blankEmbed, embedHasContent, fromPayload, gameColors, hex, parseHex, payloadKey, presetOf,
  newKey, sampleVars, toLocalInput, toPayload, totalLength, uploadImage, type Draft, type EmbedDraft, type VarServer,
} from '../components/news/model';
import { Preview } from '../components/news/Preview';
import { PublicFeed } from '../components/news/PublicFeed';
import { CATEGORY_LABEL_RU, CHANGE_LABEL_RU, CHANGE_ORDER, NEWS_CATEGORIES, isChangeKind, isHttpsUrl } from '../components/news/newsLogic';
import { GAMES } from '../games';
import { StatusServers } from '../components/news/StatusServers';
import type { PreviewPart } from './EmbedPreview';
import { Button, ErrorLine, Field, GoLink, IconNews, Notice, PageHead, SplitButton, StateView, Switch, errorKind, fmtDateTime, toast, navigate } from '../ui';

export { TEMPLATES };

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

function ColorPicker({ value, onChange, games }: { value: number; onChange: (n: number) => void; games: [string, number][] }) {
  const dot = (name: string, c: number) => (
    <button
      key={`${name}-${c}`}
      type="button"
      title={name}
      aria-label={name}
      aria-pressed={value === c}
      onClick={() => onChange(c)}
      className={`h-8 w-8 rounded-full border-2 transition ${value === c ? 'scale-110 border-ink' : 'border-line'}`}
      style={{ background: hex(c) }}
    />
  );
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        {PALETTE.map(([n, c]) => dot(n, c))}
        <label className="ml-1 flex cursor-pointer items-center gap-2 text-sm font-extrabold text-mute">
          <input type="color" value={hex(value)} onChange={(e) => onChange(parseHex(e.target.value))} className="h-8 w-10 cursor-pointer rounded border-2 border-line bg-card" aria-label="Свой цвет" />
          свой
        </label>
      </div>
      {games.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-extrabold uppercase tracking-wide text-mute">Игры</span>
          {games.map(([n, c]) => dot(n, c))}
        </div>
      )}
    </div>
  );
}

const PART_ID: Record<PreviewPart['part'], string> = {
  content: 'news-content', title: 'news-title', description: 'news-desc', author: 'news-author', thumbnail: 'news-thumb', image: 'news-image', footer: 'news-footer', field: 'news-f',
};

// ---------- the editor ----------
export default function NewsEditor({ id, template }: { id: number | null; template?: string }) {
  const [d, setD] = useState<Draft | null>(null);
  const [author, setAuthor] = useState<NewsAuthor | null>(null);
  const [item, setItem] = useState<NewsItem | null>(null);
  const [settings, setSettings] = useState<NewsSettings | null>(null);
  const [servers, setServers] = useState<Server[] | null>(null);
  const [variables, setVariables] = useState<NewsVariable[] | undefined>(undefined);
  const [channelNames, setChannelNames] = useState<Record<string, string>>({});
  const [active, setActive] = useState(0);
  const [mobileTab, setMobileTab] = useState<'editor' | 'preview'>('editor');
  const [moreOpen, setMoreOpen] = useState(false);
  const [makeDefault, setMakeDefault] = useState(false);
  const [scheduling, setScheduling] = useState(false);
  const [repeat, setRepeat] = useState<'none' | 'daily' | 'weekly' | 'monthly'>('none');
  const [when, setWhen] = useState(() => toLocalInput(Date.now() + 3600_000));
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [check, setCheck] = useState<'now' | 'schedule' | 'edit' | null>(null);
  const [testing, setTesting] = useState(false);
  const [pickTest, setPickTest] = useState(false);
  const [restore, setRestore] = useState<{ payload: NewsPayload; channelId?: string; ts?: number } | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [pvTab, setPvTab] = useState<'discord' | 'site'>('discord');

  const baseline = useRef('');
  const autosaveOff = useRef(false);
  const akey = id ? String(id) : 'new';
  const primary = useRef<() => void>(() => undefined);

  // ----- load -----
  useEffect(() => {
    let dead = false;
    (async () => {
      try {
        const s = await api<NewsSettings>('/news/settings').catch(() => null);
        if (dead) return;
        setSettings(s);
        let draft: Draft;
        if (id) {
          const n = await api<NewsItem>(`/news/${id}`);
          if (dead) return;
          setItem(n);
          draft = fromPayload(n.payload, n.channelId);
          if (n.scheduledAt) setWhen(toLocalInput(n.scheduledAt));
          setRepeat(n.repeat ?? 'none');
        } else {
          const tpl = TEMPLATES.find((x) => x.id === template);
          const b = blank(s?.channelId ?? '');
          draft = tpl ? applyTpl(b, tpl.apply) : b;
          // the author is the person who writes: Discord nick and picture when linked, else the site profile
          try {
            const a = await api<NewsAuthor>('/me/author');
            if (dead) return;
            setAuthor(a);
            if (!draft.embeds[0]!.authorName) draft = { ...draft, embeds: draft.embeds.map((x, i) => (i === 0 ? { ...x, authorName: a.name, authorIcon: a.iconUrl ?? '' } : x)) };
          } catch {
            /* the author stays empty */
          }
        }
        baseline.current = payloadKey(toPayload(draft));
        setD(draft);
        // an unsaved draft from a previous session
        api<NewsAutosave | null>(`/news/autosave?key=${encodeURIComponent(akey)}`)
          .then((r) => {
            if (dead || !r?.payload) return;
            const { channelId: savedChannel, ...saved } = r.payload as typeof r.payload & { channelId?: string };
            if (payloadKey(saved as typeof r.payload) === baseline.current) return;
            setRestore({ payload: saved as typeof r.payload, channelId: r.channelId ?? savedChannel ?? undefined, ts: r.updatedAt ?? r.ts ?? undefined });
          })
          .catch((e) => { if (e instanceof ApiError && e.status === 404) autosaveOff.current = true; });
      } catch (e) {
        if (!dead) setError((e as Error).message);
      }
    })();
    api<Server[]>('/servers').then((s) => !dead && Array.isArray(s) && setServers(s)).catch(() => undefined);
    api<NewsVariable[] | { variables: NewsVariable[] }>('/news/variables')
      .then((v) => {
        const list = Array.isArray(v) ? v : v?.variables;
        if (!dead && Array.isArray(list) && list.length) setVariables(list);
      })
      .catch(() => undefined);
    api<DiscordGuild[]>('/discord/channels')
      .then((g) => {
        const m: Record<string, string> = {};
        for (const gg of g) for (const c of gg.channels) m[c.id] = c.name;
        if (!dead) setChannelNames(m);
      })
      .catch(() => undefined);
    return () => { dead = true; };
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  // ----- autosave: 1.5 s after the last change -----
  useEffect(() => {
    if (!d || restore || autosaveOff.current) return;
    const payload = toPayload(d);
    if (payloadKey(payload) === baseline.current) return;
    const t = setTimeout(() => {
      api(`/news/autosave`, 'PUT', { key: akey, payload: { ...payload, channelId: d.channelId } })
        .then(() => setSavedAt(Date.now()))
        .catch((e) => { if (e instanceof ApiError && (e.status === 404 || e.status === 405)) autosaveOff.current = true; });
    }, 1500);
    return () => clearTimeout(t);
  }, [d, restore, akey]);

  // ----- Ctrl+Enter publishes -----
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); primary.current(); }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);

  const varServers = useMemo<VarServer[] | null>(
    () => servers?.map((s) => ({ id: s.id, name: s.name, online: s.online, players: s.players, maxPlayers: s.maxPlayers, address: s.address, map: s.map, ping: s.ping })) ?? null,
    [servers],
  );
  const vars = useMemo(() => sampleVars(varServers), [varServers]);
  const games = useMemo(() => gameColors(servers?.map((s) => s.game)), [servers]);

  if (!d) {
    return error ? (
      <StateView kind={errorKind(error)} text={errorKind(error) === 'error' ? error : undefined} onRetry={() => window.location.reload()}>
        <a className="btn btn-soft" href="/admin/news">К новостям</a>
      </StateView>
    ) : (
      <div className="space-y-5" aria-busy="true" aria-label="Загрузка">
        <div className="skeleton h-9 w-56 rounded-full" />
        <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,460px)]">
          <div className="space-y-5">
            <div className="skeleton panel h-52" />
            <div className="skeleton panel h-60" />
            <div className="skeleton panel h-72" />
          </div>
          <div className="space-y-4">
            <div className="skeleton panel h-64" />
            <div className="skeleton panel h-32" />
          </div>
        </div>
      </div>
    );
  }

  const set = (patch: Partial<Draft>) => setD((cur) => (cur ? { ...cur, ...patch } : cur));
  const cur = Math.min(active, d.embeds.length - 1);
  const e = d.embeds[cur];
  const useProfileAuthor = async () => {
    try {
      const a = author ?? (await api<NewsAuthor>('/me/author'));
      setAuthor(a);
      setE({ authorName: a.name, authorIcon: a.iconUrl ?? '' });
    } catch (err) {
      setError((err as Error).message);
    }
  };
  const setE = (patch: Partial<EmbedDraft>) => setD((c) => (c ? { ...c, embeds: c.embeds.map((x, i) => (i === cur ? { ...x, ...patch } : x)) } : c));
  const isSent = item?.status === 'sent' || item?.status === 'edit_queued';
  const total = totalLength(d);
  const noChannel = !/^\d{15,25}$/.test(d.channelId);
  const dirtyText = !!d.content || d.embeds.some(embedHasContent);

  // ----- click in the preview -> the matching control -----
  const focusPart = (p: PreviewPart) => {
    setMobileTab('editor');
    if (p.embed !== cur && p.part !== 'content') setActive(p.embed);
    if (p.part === 'author' || p.part === 'thumbnail' || p.part === 'image') setMoreOpen(true);
    const elId = p.part === 'field' ? `news-f${p.field ?? 0}-name` : PART_ID[p.part];
    setTimeout(() => {
      const el = document.getElementById(elId);
      if (!el) return;
      el.scrollIntoView({ block: 'center', behavior: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
      el.focus({ preventScroll: true });
      const host = el.closest('.flash-host') ?? el;
      host.classList.remove('flash-ctl');
      void (host as HTMLElement).offsetWidth;
      host.classList.add('flash-ctl');
      setTimeout(() => host.classList.remove('flash-ctl'), 1400);
    }, 60);
  };

  const pasteImage = async (file: File) => {
    try {
      const name = await uploadImage(file);
      setE({ imageUpload: name, imageUrl: '' });
      setMoreOpen(true);
      toast('Картинка загружена из буфера');
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const applyTemplate = async (t: (typeof TEMPLATES)[number]) => {
    if (dirtyText && !(await confirmDialog({ title: 'Заменить текущий текст шаблоном?', text: 'Введённый текст будет потерян.', confirmLabel: 'Заменить' }))) return;
    setD((c) => (c ? { ...applyTpl(c, t.apply), statusServerIds: c.statusServerIds } : c));
    setActive(0);
  };

  const addEmbed = () => {
    if (d.embeds.length >= LIMITS.embeds) return;
    set({ embeds: [...d.embeds, blankEmbed()] });
    setActive(d.embeds.length);
  };
  const removeEmbed = async () => {
    if (d.embeds.length <= 1) return;
    if (embedHasContent(e) && !(await confirmDialog({ title: `Удалить embed ${cur + 1}?`, confirmLabel: 'Удалить', danger: true }))) return;
    set({ embeds: d.embeds.filter((_, i) => i !== cur) });
    setActive(Math.max(0, cur - 1));
  };

  // ----- saving -----
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
      await api(`/news/autosave?key=${encodeURIComponent(akey)}`, 'DELETE').catch(() => undefined);
      baseline.current = payloadKey(toPayload(d));
      toast(action === 'now' ? 'Новость отправляется в Discord' : action === 'schedule' ? 'Новость запланирована' : isSent ? 'Изменения отправлены в Discord' : 'Черновик сохранён');
      navigate('/admin/news');
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
      setCheck(null);
    }
  };

  const request = (mode: 'now' | 'schedule' | 'edit') => {
    setError('');
    if (mode === 'schedule' && !(new Date(when).getTime() > Date.now())) { setError('Выберите время в будущем'); return; }
    setCheck(mode);
  };
  primary.current = () => {
    if (busy || check) return;
    if (isSent) request('edit');
    else if (scheduling) request('schedule');
    else request('now');
  };

  const sendTest = async () => {
    setTesting(true);
    setError('');
    try {
      const r = await api<NewsTestResult>('/news/test', 'POST', { payload: toPayload(d), channelId: settings?.testChannelId || undefined });
      let st: NewsTestStatus = { status: 'pending' };
      for (let i = 0; i < 20 && st.status === 'pending'; i++) {
        await new Promise((res) => setTimeout(res, 1000));
        st = await api<NewsTestStatus>(`/news/test/${r.testId}`);
      }
      if (st.status === 'sent') toast('Тестовое сообщение отправлено');
      else if (st.status === 'error') setError(st.error || 'Не удалось отправить тест');
      else toast('Тест поставлен в очередь', 'ok');
    } catch (err) {
      setError(err instanceof ApiError && err.status === 404 ? 'Тестовая отправка недоступна на этом сервере.' : (err as Error).message);
    } finally {
      setTesting(false);
    }
  };

  const setTestChannel = async (channelId: string) => {
    if (!/^\d{15,25}$/.test(channelId)) return;
    await api('/news/settings', 'PUT', { testChannelId: channelId }).catch((err) => setError(err.message));
    const s = await api<NewsSettings>('/news/settings').catch(() => null);
    if (s) setSettings(s);
    setPickTest(false);
  };

  const doRestore = () => {
    if (!restore) return;
    const nd = fromPayload(restore.payload, restore.channelId && /^\d{15,25}$/.test(restore.channelId) ? restore.channelId : d.channelId);
    setD(nd);
    setActive(0);
    setRestore(null);
    toast('Черновик восстановлен');
  };
  const dropRestore = () => {
    setRestore(null);
    void api(`/news/autosave?key=${encodeURIComponent(akey)}`, 'DELETE').catch(() => undefined);
  };

  const hasLive = d.statusServerIds.length > 0;

  const actions = (
    <div className="panel fixed inset-x-0 bottom-0 z-30 max-h-[75dvh] space-y-3 overflow-auto rounded-b-none p-4 pb-[max(1rem,env(safe-area-inset-bottom))] lg:static lg:max-h-none lg:overflow-visible lg:rounded-b-3xl lg:pb-4">
      <ErrorLine text={error} />
      {noChannel && !isSent && <p className="text-sm font-bold text-mute">Выберите канал, чтобы опубликовать или запланировать.</p>}
      {isSent ? (
        <Button className="w-full" loading={busy} onClick={() => request('edit')}>{busy ? 'Сохраняю…' : 'Сохранить изменения в Discord'}</Button>
      ) : (
        <>
          <SplitButton
            className="w-full"
            magnetic
            loading={busy}
            disabled={noChannel}
            label={busy ? 'Отправляю…' : 'Опубликовать сейчас'}
            onClick={() => request('now')}
            menuLabel="Другие способы публикации"
            items={[
              { key: 'schedule', label: 'Запланировать…', hint: 'Выбрать дату и время', onSelect: () => setScheduling(true) },
              { key: 'draft', label: 'Сохранить как черновик', hint: 'Ничего не отправляется в Discord', onSelect: () => void save('draft') },
            ]}
          />
          {scheduling && (
            <div className="space-y-2 rounded-2xl bg-soft p-3">
              <label htmlFor="news-when" className="label">Когда опубликовать</label>
              <input id="news-when" type="datetime-local" className="input" value={when} min={toLocalInput(Date.now())} onChange={(ev) => setWhen(ev.target.value)} />
              <label htmlFor="news-repeat" className="label">Повторять</label>
              <select id="news-repeat" className="input" value={repeat} onChange={(ev) => setRepeat(ev.target.value as typeof repeat)}>
                <option value="none">Не повторять</option>
                <option value="daily">Каждый день</option>
                <option value="weekly">Каждую неделю</option>
                <option value="monthly">Каждый месяц</option>
              </select>
              <div className="flex gap-2">
                <Button variant="ghost" onClick={() => setScheduling(false)}>Отмена</Button>
                <Button className="flex-1" loading={busy} disabled={noChannel} onClick={() => request('schedule')}>Запланировать</Button>
              </div>
            </div>
          )}
        </>
      )}
      <div className="flex flex-wrap items-center gap-2 border-t-2 border-line pt-3">
        <Button variant="soft" loading={testing} disabled={!settings?.testChannelId && noChannel} onClick={() => void sendTest()}>Отправить тест</Button>
        <span className="min-w-0 flex-1 text-xs font-semibold text-mute">
          {settings?.testChannelId
            ? <>Тест уйдёт в {settings.testChannelName ? `# ${settings.testChannelName}` : `канал ${settings.testChannelId}`}{settings.testGuildName ? ` · ${settings.testGuildName}` : ''}. </>
            : 'Тестовый канал не задан: тест уйдёт в канал новости. '}
          <button type="button" className="btn-link" onClick={() => setPickTest((v) => !v)} aria-expanded={pickTest}>{settings?.testChannelId ? 'Изменить' : 'Выбрать'}</button>
        </span>
        {pickTest && <div className="w-full"><ChannelPicker id="news-test-channel" value={settings?.testChannelId ?? ''} onChange={(v) => void setTestChannel(v)} /></div>}
      </div>
      {savedAt && <p className="text-xs font-semibold text-mute">Черновик автоматически сохранён в {fmtDateTime(savedAt)}</p>}
    </div>
  );

  const scheduleText = check === 'schedule' ? `Будет опубликовано ${fmtDateTime(new Date(when).getTime())}.` : undefined;

  return (
    <div className="space-y-5 pb-40 lg:pb-0">
      <a href="/admin/news" className="inline-flex items-center gap-1 font-extrabold text-link hover:underline">← Все новости</a>
      <PageHead
        icon={<IconNews />}
        title={id ? (isSent ? 'Правка опубликованной новости' : 'Редактирование новости') : 'Новая новость'}
        subtitle={isSent ? 'Сообщение в Discord будет отредактировано, новое отправлено не будет.' : undefined}
        hint="Заполните канал и текст, проверьте предпросмотр справа и нажмите «Опубликовать сейчас». Можно запланировать или сохранить как черновик."
        help={<p>Нажмите на часть сообщения в предпросмотре, чтобы перейти к её полю. Ctrl+Enter публикует. Слова ДАТА и ВРЕМЯ в шаблонах замените на свои. Перед отправкой панель проверяет лимиты Discord и типичные ошибки. Изменения сохраняются в черновик автоматически.</p>}
      />

      {restore && (
        <Notice
          tone="info"
          action={
            <span className="flex gap-3">
              <button type="button" className="btn-link btn-link-tone" onClick={doRestore}>Восстановить</button>
              <button type="button" className="btn-link btn-link-tone" onClick={dropRestore}>Отбросить</button>
            </span>
          }
        >
          Найден несохранённый черновик{restore.ts ? ` от ${fmtDateTime(restore.ts)}` : ''}.
        </Notice>
      )}

      <div className="seg lg:hidden" role="group" aria-label="Режим">
        <button type="button" className="seg-item" aria-pressed={mobileTab === 'editor'} onClick={() => setMobileTab('editor')}>Редактор</button>
        <button type="button" className="seg-item" aria-pressed={mobileTab === 'preview'} onClick={() => setMobileTab('preview')}>Превью</button>
      </div>

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,460px)]">
        <div className={`space-y-5 ${mobileTab === 'preview' ? 'hidden lg:block lg:space-y-5' : ''}`}>
          <Section title="Куда отправить">
            <Field label="Канал">
              {isSent ? <p className="font-bold">{item?.channelName ? `# ${item.channelName}` : item?.channelId}{item?.guildName ? ` · ${item.guildName}` : ''}</p> : <ChannelPicker id="news-channel" value={d.channelId} onChange={(v) => set({ channelId: v })} />}
            </Field>
            {!isSent && noChannel && (
              <p className="-mt-1 text-sm font-semibold text-mute">
                Канал не выбран. Задайте канал по умолчанию, и он будет подставляться в каждую новую новость:{' '}
                <GoLink href="/admin/news">Выбрать канал по умолчанию</GoLink>
              </p>
            )}
            {!isSent && (
              <label className="flex items-center gap-3 text-sm font-bold text-mute">
                <Switch checked={makeDefault} onChange={setMakeDefault} /> Сделать каналом новостей по умолчанию
              </label>
            )}
            <Field label="Упоминание">
              <select id="news-mention" className="input" value={d.mention} onChange={(ev) => set({ mention: ev.target.value as Draft['mention'] })}>
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
                {TEMPLATES.map((t) => <button key={t.id} type="button" className="btn btn-soft btn-sm" onClick={() => void applyTemplate(t)}>{t.label}</button>)}
                <button type="button" className="btn btn-soft btn-sm" onClick={() => { set({ ...blank(d.channelId), statusServerIds: d.statusServerIds }); setActive(0); }}>Очистить</button>
              </div>
            </Section>
          )}

          <Section title="Текст" hint="Обычный текст над рамкой. Можно оставить пустым.">
            <MarkdownField id="news-content" label="Сообщение" value={d.content} onChange={(v) => set({ content: v })} max={LIMITS.content} rows={3} placeholder="Например: Друзья, у нас новости!" variables={variables} onImage={(f) => void pasteImage(f)} />
          </Section>

          <Section title="Оформление (embed)" hint="Цветная карточка с заголовком, текстом, полями и картинкой. В одном сообщении можно несколько блоков.">
            <div className="no-scrollbar flex items-center gap-2 overflow-x-auto" role="tablist" aria-label="Embed-блоки">
              <div className="seg flex w-fit shrink-0">
                {d.embeds.map((x, i) => (
                  <button key={i} type="button" role="tab" aria-selected={i === cur} aria-pressed={i === cur} className="seg-item whitespace-nowrap" onClick={() => setActive(i)}>
                    Embed {i + 1}{!embedHasContent(x) && <span className="ml-1 text-mute" aria-label="пустой">·</span>}
                  </button>
                ))}
              </div>
              <button type="button" className="btn btn-soft btn-sm shrink-0" disabled={d.embeds.length >= LIMITS.embeds} onClick={addEmbed}>+ Добавить embed</button>
              {d.embeds.length > 1 && <button type="button" className="btn btn-danger btn-sm shrink-0" onClick={() => void removeEmbed()}>Удалить Embed {cur + 1}</button>}
            </div>

            <div>
              <span className="label">Тип сообщения</span>
              <div className="flex flex-wrap gap-2" role="group" aria-label="Тип сообщения">
                {PRESETS.map((p) => {
                  const on = presetOf(e)?.id === p.id;
                  return (
                    <button key={p.id} type="button" aria-pressed={on} onClick={() => setE(applyPreset(e, p))} className="btn btn-soft btn-sm">
                      <span aria-hidden className="mr-1.5 inline-block h-2.5 w-2.5 rounded-full" style={{ background: hex(p.color) }} />{p.icon} {p.label}
                    </button>
                  );
                })}
              </div>
            </div>

            <Field label="Цвет полосы"><ColorPicker value={e.color} onChange={(c) => setE({ color: c })} games={games} /></Field>
            <div>
              <div className="mb-1.5 flex items-center justify-between"><label htmlFor="news-title" className="label !mb-0">Заголовок</label><Counter value={e.title.length} max={LIMITS.title} /></div>
              <input id="news-title" className="input" value={e.title} onChange={(ev) => setE({ title: ev.target.value })} placeholder="📢 Заголовок новости" />
            </div>
            <Field label="Ссылка заголовка (необязательно)">
              <input id="news-url" className="input" value={e.url} onChange={(ev) => setE({ url: ev.target.value.trim() })} placeholder="https://…" />
            </Field>
            <MarkdownField id="news-desc" label="Основной текст" value={e.description} onChange={(v) => setE({ description: v })} max={LIMITS.description} rows={8} placeholder="Расскажите, что произошло. Поддерживается оформление Discord." variables={variables} onImage={(f) => void pasteImage(f)} />

            <details className="rounded-2xl border-2 border-line px-4 py-2.5" open={moreOpen || !!(e.authorName || e.thumbnail || e.imageUrl || e.imageUpload)} onToggle={(ev) => setMoreOpen(ev.currentTarget.open)}>
              <summary className="cursor-pointer select-none font-extrabold text-link">Автор, миниатюра и большая картинка</summary>
              <div className="mt-3 space-y-3.5">
                <div className="flex flex-wrap items-center gap-2">
                  <button type="button" className="btn btn-soft btn-sm" onClick={() => void useProfileAuthor()}>Из профиля{author?.source === 'discord' ? ' (Discord)' : ''}</button>
                  <span className="text-sm font-semibold text-mute">Ник и фото берутся из Discord, если он привязан, иначе из профиля на сайте; регистр ника как в Discord.</span>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="block"><span className="label">Автор (имя)</span><input id="news-author" className="input" value={e.authorName} onChange={(ev) => setE({ authorName: ev.target.value })} placeholder="Администрация" /></label>
                  <label className="block"><span className="label">Аватар автора (ссылка)</span><input className="input" value={e.authorIcon} onChange={(ev) => setE({ authorIcon: ev.target.value.trim() })} placeholder="https://…" /></label>
                </div>
                <ImageDrop id="news-thumb" label="Миниатюра справа сверху" url={e.thumbnail} upload="" onUrl={(v) => setE({ thumbnail: v })} onUpload={() => undefined} minWidth={80} />
                <ImageDrop id="news-image" label="Большая картинка внизу" url={e.imageUrl} upload={e.imageUpload} onUrl={(v) => setE({ imageUrl: v })} onUpload={(n) => setE({ imageUpload: n, imageUrl: n ? '' : e.imageUrl })} allowUpload minWidth={400} />
              </div>
            </details>
          </Section>

          <Section title="Поля" hint="Блоки «название и значение». Перетаскивайте за ручку или используйте стрелки; короткие поля можно ставить в ряд по три.">
            <FieldsBuilder fields={e.fields} onChange={(f) => setE({ fields: f })} variables={variables} />
          </Section>

          <Section title="Подпись">
            <div>
              <div className="mb-1.5 flex items-center justify-between"><label htmlFor="news-footer" className="label !mb-0">Текст внизу</label><Counter value={e.footer.length} max={LIMITS.footer} /></div>
              <input id="news-footer" className="input" value={e.footer} onChange={(ev) => setE({ footer: ev.target.value })} placeholder="Например: Администрация сервера" />
            </div>
            <label className="flex items-center gap-3 text-sm font-bold text-mute">
              <Switch checked={e.timestamp} onChange={(on) => setE({ timestamp: on })} /> Показывать время публикации
            </label>
          </Section>

          {servers && servers.length > 0 && (
            <Section title="Статус серверов" hint="Живой блок: бот добавит карточки выбранных серверов (онлайн, игроки) и будет обновлять их.">
              <StatusServers servers={servers} value={d.statusServerIds} onChange={(ids) => set({ statusServerIds: ids })} />
            </Section>
          )}

          <Section title="На сайте" hint="Эти поля видны только на странице новостей панели; в Discord они не попадают.">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Рубрика">
                <select id="news-category" className="input" value={d.category} onChange={(ev) => set({ category: ev.target.value as Draft['category'] })}>
                  {NEWS_CATEGORIES.map((c) => <option key={c} value={c}>{CATEGORY_LABEL_RU[c]}</option>)}
                </select>
              </Field>
              <Field label="Игра (для обложки по умолчанию)">
                <select id="news-game" className="input" value={d.game} onChange={(ev) => set({ game: ev.target.value })}>
                  <option value="">нет</option>
                  {GAMES.map((g) => <option key={g.id} value={g.id}>{g.label}</option>)}
                </select>
              </Field>
            </div>
            <label className="flex items-center gap-3 text-sm font-bold text-mute">
              <Switch checked={d.pinned} onChange={(on) => set({ pinned: on })} /> Закрепить вверху ленты
            </label>

            <div className="space-y-2">
              <span className="label !mb-0">Отсчёт времени</span>
              <div className="grid gap-2 sm:grid-cols-2">
                <input id="news-cd-at" type="datetime-local" className="input" aria-label="Когда" value={d.countdownAt} onChange={(ev) => set({ countdownAt: ev.target.value })} />
                <input id="news-cd-label" className="input" aria-label="Подпись отсчёта" maxLength={LIMITS.countdownLabel} placeholder="Вайп" value={d.countdownLabel} onChange={(ev) => set({ countdownLabel: ev.target.value })} />
              </div>
              <p className="text-xs font-semibold text-mute">На сайте: «Вайп через 2 д 4 ч 10 мин», после времени «Началось». {d.countdownAt && <button type="button" className="btn-link" onClick={() => set({ countdownAt: '', countdownLabel: '' })}>Убрать отсчёт</button>}</p>
            </div>

            <div className="space-y-2">
              <span className="label !mb-0">Галерея ({d.gallery.length} из {LIMITS.gallery})</span>
              {d.gallery.map((g, i) => (
                <ImageDrop
                  key={g.k}
                  id={'news-gal-' + i}
                  label={'Картинка ' + (i + 1)}
                  url={g.url}
                  upload={g.upload}
                  allowUpload
                  minWidth={400}
                  onUrl={(v) => set({ gallery: d.gallery.map((x) => (x.k === g.k ? { ...x, url: v, upload: v ? '' : x.upload } : x)) })}
                  onUpload={(n) => set({ gallery: n ? d.gallery.map((x) => (x.k === g.k ? { ...x, upload: n, url: '' } : x)) : d.gallery.filter((x) => x.k !== g.k) })}
                />
              ))}
              <button type="button" className="btn btn-soft btn-sm" disabled={d.gallery.length >= LIMITS.gallery} onClick={() => set({ gallery: [...d.gallery, { k: newKey(), url: '', upload: '' }] })}>+ Добавить картинку</button>
            </div>

            <div className="space-y-2">
              <span className="label !mb-0">Что изменилось ({d.changes.length} из {LIMITS.changes})</span>
              {d.changes.map((c, i) => (
                <div key={c.k} className="nw-edit-row">
                  <select aria-label={'Тип изменения ' + (i + 1)} className="input" value={c.kind} onChange={(ev) => { const v = ev.target.value; if (isChangeKind(v)) set({ changes: d.changes.map((x) => (x.k === c.k ? { ...x, kind: v } : x)) }); }}>
                    {CHANGE_ORDER.map((k) => <option key={k} value={k}>{CHANGE_LABEL_RU[k]}</option>)}
                  </select>
                  <input aria-label={'Текст изменения ' + (i + 1)} className="input" maxLength={LIMITS.changeText} value={c.text} placeholder="Что именно" onChange={(ev) => set({ changes: d.changes.map((x) => (x.k === c.k ? { ...x, text: ev.target.value } : x)) })} />
                  <button type="button" className="btn btn-danger btn-sm" onClick={() => set({ changes: d.changes.filter((x) => x.k !== c.k) })}>Убрать</button>
                </div>
              ))}
              <button type="button" className="btn btn-soft btn-sm" disabled={d.changes.length >= LIMITS.changes} onClick={() => set({ changes: [...d.changes, { k: newKey(), kind: 'add', text: '' }] })}>+ Добавить пункт</button>
            </div>

            <div className="space-y-2">
              <span className="label !mb-0">Кнопки ({d.actions.length} из {LIMITS.actions})</span>
              {d.actions.map((a, i) => {
                const bad = !!a.url.trim() && !isHttpsUrl(a.url);
                return (
                  <div key={a.k} className="space-y-1">
                    <div className="nw-edit-row">
                      <input aria-label={'Подпись кнопки ' + (i + 1)} className="input" maxLength={LIMITS.actionLabel} value={a.label} placeholder="Подробнее" onChange={(ev) => set({ actions: d.actions.map((x) => (x.k === a.k ? { ...x, label: ev.target.value } : x)) })} />
                      <input aria-label={'Ссылка кнопки ' + (i + 1)} aria-invalid={bad} className="input" value={a.url} placeholder="https://…" onChange={(ev) => set({ actions: d.actions.map((x) => (x.k === a.k ? { ...x, url: ev.target.value.trim() } : x)) })} />
                      <button type="button" className="btn btn-danger btn-sm" onClick={() => set({ actions: d.actions.filter((x) => x.k !== a.k) })}>Убрать</button>
                    </div>
                    {bad && <p className="text-sm font-bold text-bad" role="alert">Ссылка должна начинаться с https://</p>}
                  </div>
                );
              })}
              <button type="button" className="btn btn-soft btn-sm" disabled={d.actions.length >= LIMITS.actions} onClick={() => set({ actions: [...d.actions, { k: newKey(), label: '', url: '' }] })}>+ Добавить кнопку</button>
            </div>
          </Section>

          {id && <HistoryPanel id={id} locked={item?.status === 'sending' || item?.status === 'queued'} onRestored={(it) => { setItem(it); const nd = fromPayload(it.payload, it.channelId); baseline.current = payloadKey(toPayload(nd)); setD(nd); setActive(0); }} />}
        </div>

        <aside className="space-y-4 lg:sticky lg:top-4 lg:max-h-[calc(100dvh-2rem)] lg:space-y-4 lg:overflow-y-auto lg:overscroll-contain">
          <div className={mobileTab === 'editor' ? 'hidden space-y-4 lg:block' : 'space-y-4'}>
            <div className="seg" role="group" aria-label="Вид предпросмотра">
              <button type="button" className="seg-item" aria-pressed={pvTab === 'discord'} onClick={() => setPvTab('discord')}>В Discord</button>
              <button type="button" className="seg-item" aria-pressed={pvTab === 'site'} onClick={() => setPvTab('site')}>Как будет на сайте</button>
            </div>
            {pvTab === 'discord' ? (
              <Preview draft={d} vars={vars} servers={servers} channelNames={channelNames} onPick={focusPart} total={total} />
            ) : (
              <div className="panel p-3">
                <PublicFeed
                  flat
                  servers={servers}
                  items={[{ id: id ?? 0, status: 'draft', title: d.embeds[0]?.title ?? '', payload: toPayload(d), sentAt: item?.sentAt ?? Date.now(), category: d.category, pinned: d.pinned, authorRole: null, reactions: [] }]}
                />
                {!embedHasContent(d.embeds[0] ?? blankEmbed()) && !d.content && <p className="py-6 text-center font-semibold text-mute">Начните писать: здесь появится карточка новости.</p>}
              </div>
            )}
            {hasLive && <p className="px-1 text-xs font-semibold text-mute">Карточки серверов показаны образцом: настоящие данные появятся при отправке.</p>}
            <LimitsPanel d={d} active={cur} />
          </div>
          {actions}
        </aside>
      </div>

      {check && (
        <ChecklistModal
          draft={d}
          mode={check}
          scheduleText={scheduleText}
          busy={busy}
          onClose={() => setCheck(null)}
          onConfirm={() => void save(check === 'edit' ? 'draft' : check)}
        />
      )}
    </div>
  );
}
