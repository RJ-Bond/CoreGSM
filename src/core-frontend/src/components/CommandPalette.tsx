import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { api, type Server } from '../api';
import { useAuth } from '../auth';
import { useBackdropClose, useDialogFocus } from '../confirm';
import { gameLabel } from '../games';
import { ADMIN_LINKS, ADMIN_SECTIONS, SECTION_PERM } from '../pages/adminNav';
import { confirmDialog } from '../confirm';
import { GameAvatar, IconCards, IconCopy, IconMoon, IconNews, IconRefresh, IconServers, IconSun, IconTrophy, IconWrench, currentTheme, setThemeChoice, toast, useDensity, navigate } from '../ui';

type Group = 'Серверы' | 'Разделы' | 'Действия';

interface Item {
  key: string;
  group: Group;
  label: string;
  hint: string;
  href: string;
  /** an action instead of a link: runs after the palette closes */
  run?: () => void;
  icon: ReactNode;
  /** lower-case text the query is matched against */
  hay: string;
  /** found only by typing: not listed while the query is empty */
  searchOnly?: boolean;
}

/** lower case, «ё» as «е»: a query matches either way */
const norm = (t: string) => t.toLowerCase().replace(/ё/g, 'е');

const IconPulse = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
  </svg>
);
const IconUser = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <circle cx="12" cy="8" r="4" />
    <path d="M4 21a8 8 0 0 1 16 0" />
  </svg>
);

const IconDensity = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M4 6h16M4 10h16M4 14h16M4 18h16" />
  </svg>
);

const sectionItem = (key: string, label: string, hint: string, href: string, icon: ReactNode, keywords = '', searchOnly = false): Item => ({
  key, group: 'Разделы', label, hint, href, icon, hay: norm(`${label} ${hint} ${keywords}`), searchOnly,
});

/**
 * Ctrl/Cmd+K: jump to a server or a section. A modal combobox: focus stays in the input, the list is driven with
 * the arrow keys (aria-activedescendant), Enter opens, Escape closes. Focus returns to whatever opened it.
 */
export default function CommandPalette({ onClose, isStaff, isAdmin }: { onClose: () => void; isStaff: boolean; isAdmin: boolean }) {
  const { me, logout } = useAuth();
  const perms = me?.perms ?? (isAdmin ? ['news', 'moderation', 'servers', 'maintenance', 'journal'] : []);
  const box = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const uid = useId();
  const listId = `${uid}-list`;
  const [q, setQ] = useState('');
  const [servers, setServers] = useState<Server[] | null>(null);
  const [active, setActive] = useState(0);
  const [density, setDensity] = useDensity();

  useDialogFocus(box, onClose, () => input.current);
  const bd = useBackdropClose(onClose);

  // the list of servers is loaded once, when the palette opens
  useEffect(() => {
    let alive = true;
    api<Server[]>('/servers').then((s) => { if (alive) setServers(s); }).catch(() => { if (alive) setServers([]); });
    return () => { alive = false; };
  }, []);

  const items = useMemo(() => {
    const out: Item[] = [];
    for (const s of servers ?? []) {
      out.push({
        key: `s${s.id}`,
        group: 'Серверы',
        label: s.name,
        hint: `${gameLabel(s.game)} · ${s.address}`,
        href: `/servers/${s.id}`,
        icon: <GameAvatar game={s.game} size={32} />,
        hay: norm(`${s.name} ${gameLabel(s.game)} ${s.address}`),
      });
    }
    out.push(
      sectionItem('p-servers', 'Серверы', 'Список серверов', '/servers', <IconServers />),
      sectionItem('p-news', 'Новости', 'Лента новостей', '/news', <IconNews />),
      sectionItem('p-status', 'Статус', 'Доступность за 30 дней', '/status', <IconPulse />),
      sectionItem('p-community', 'Сообщество', 'Кто играет, сезон, зал славы', '/community', <IconTrophy />, 'игроки рейтинг топ сезон'),
      sectionItem('p-gallery', 'Галерея', 'Скриншоты игроков', '/gallery', <IconCards />, 'скриншоты картинки фото загрузить', true),
    );
    if (isStaff) {
      const sections = isAdmin ? ADMIN_SECTIONS : ADMIN_SECTIONS.filter((x) => SECTION_PERM[x.id] && perms.includes(SECTION_PERM[x.id]!));
      for (const sec of sections) out.push(sectionItem(`a-${sec.id}`, sec.label, `Админка · ${sec.desc}`, `/admin/${sec.id}`, sec.icon(), `${sec.keywords} админка`));
      if (isAdmin) {
        ADMIN_LINKS.forEach((l, i) => out.push(sectionItem(`l-${i}`, l.label, `Админка · ${l.hint}`, l.href, l.icon(), `${l.keywords} админка`, true)));
      } else if (perms.includes('news')) {
        out.push(sectionItem('l-news-new', 'Написать новость', 'Админка · Новости', '/admin/news/new', <IconNews />, 'новость объявление', true));
      }
    }
    if (me) out.push(sectionItem('p-profile', 'Профиль', me.username, '/profile', <IconUser />));
    // actions on a server, found by typing its name: copy the address, poll it now, restart it
    const act = (key: string, label: string, hint: string, words: string, icon: ReactNode, run: () => void) =>
      out.push({ key, group: 'Действия', label, hint, href: '', run, icon, hay: norm(`${label} ${hint} ${words}`), searchOnly: true });
    for (const s of servers ?? []) {
      act(`copy-${s.id}`, `Скопировать адрес: ${s.name}`, s.address, 'адрес ip подключиться копировать', <IconCopy />, () => {
        void navigator.clipboard?.writeText(s.address).then(() => toast('Адрес скопирован'));
      });
      if (perms.includes('servers')) {
        act(`poll-${s.id}`, `Опросить сейчас: ${s.name}`, 'Свежие онлайн, карта и пинг', 'обновить опросить проверить', <IconRefresh />, () => {
          void api(`/servers/${s.id}/refresh`, 'POST').then(() => toast(`«${s.name}» опрошен`)).catch((e: Error) => toast(e.message, 'err'));
        });
      }
      if (perms.includes('maintenance')) {
        act(`restart-${s.id}`, `Перезапустить: ${s.name}`, 'Окно обслуживания и команда по RCON', 'перезапуск рестарт restart', <IconWrench />, () => {
          void confirmDialog({ title: `Перезапустить «${s.name}» сейчас?`, text: 'Без предупреждения игроков: откроется окно обслуживания и, если настроен RCON, уйдёт команда перезапуска.', confirmLabel: 'Перезапустить', danger: true }).then((ok) => {
            if (ok) void api<{ lastResult: string | null }>(`/servers/${s.id}/restart/now`, 'POST').then((r) => toast(r.lastResult ?? 'Готово')).catch((e: Error) => toast(e.message, 'err'));
          });
        });
      }
    }
    if (isAdmin) {
      act('act-digest', 'Отправить итоги недели сейчас', 'Картинка с итогами в канал Discord', 'дайджест итоги неделя отчёт', <IconNews />, () => {
        void api('/digest/send', 'POST').then(() => toast('Итоги недели поставлены в очередь')).catch((e: Error) => toast(e.message, 'err'));
      });
      act('act-season', 'Начать новый сезон', 'Сообщество · Сезоны', 'сезон вайп wipe рейтинг', <IconTrophy />, () => navigate('/admin/community/seasons'));
    }
    const theme = currentTheme();
    for (const [t, label, icon] of [['dark', 'Тёмная тема', <IconMoon key="m" />], ['light', 'Светлая тема', <IconSun key="s" />], ['auto', 'Тема как в системе', <IconSun key="a" />]] as const) {
      if (t === theme) continue;
      out.push({ key: `theme-${t}`, group: 'Действия', label, hint: 'Оформление панели', href: '', run: () => setThemeChoice(t), icon, hay: norm(`${label} тема оформление цвет ночь день dark light`) });
    }
    if (me) act('act-logout', 'Выйти', me.username, 'выход logout', <IconUser />, () => logout());
    const compact = density === 'compact';
    out.push({
      key: 'act-density',
      group: 'Действия',
      label: 'Сменить плотность',
      hint: compact ? 'Сейчас компактная, переключить на обычную' : 'Сейчас обычная, переключить на компактную',
      href: '',
      run: () => { setDensity(compact ? 'normal' : 'compact'); toast(compact ? 'Плотность: обычная' : 'Плотность: компактная'); },
      icon: <IconDensity />,
      hay: norm('сменить плотность компактная обычная вид отступы density'),
    });
    return out;
  }, [servers, isStaff, isAdmin, me, density, perms, logout]);

  const results = useMemo(() => {
    const words = norm(q).split(/\s+/).filter(Boolean);
    const hit = words.length ? items.filter((it) => words.every((w) => it.hay.includes(w))) : items.filter((it) => !it.searchOnly);
    const servs = hit.filter((i) => i.group === 'Серверы').slice(0, words.length ? 10 : 6);
    const secs = hit.filter((i) => i.group === 'Разделы');
    const acts = hit.filter((i) => i.group === 'Действия');
    return [...servs, ...secs, ...acts];
  }, [items, q]);

  useEffect(() => setActive(0), [q]);
  const safeActive = Math.min(active, Math.max(0, results.length - 1));

  useEffect(() => {
    list.current?.querySelector<HTMLElement>(`[data-idx="${safeActive}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [safeActive, results]);

  const go = (it: Item | undefined) => {
    if (!it) return;
    onClose();
    if (it.run) it.run();
    else navigate(it.href);
  };

  const onKey = (e: React.KeyboardEvent) => {
    const n = results.length;
    if (e.key === 'ArrowDown') { e.preventDefault(); if (n) setActive((safeActive + 1) % n); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); if (n) setActive((safeActive - 1 + n) % n); }
    else if (e.key === 'Home') { e.preventDefault(); setActive(0); }
    else if (e.key === 'End') { e.preventDefault(); setActive(Math.max(0, n - 1)); }
    else if (e.key === 'Enter') { e.preventDefault(); go(results[safeActive]); }
  };

  const groups: Group[] = ['Серверы', 'Разделы', 'Действия'];
  const optId = (i: number) => `${uid}-opt-${i}`;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/45 p-3 pt-[8dvh] backdrop-blur-xs sm:pt-[12dvh]" {...bd}>
      <div
        ref={box}
        role="dialog"
        aria-modal="true"
        aria-label="Поиск по панели"
        tabIndex={-1}
        className="pop panel w-full max-w-xl overflow-hidden outline-hidden"
      >
        <div className="flex items-center gap-3 border-b border-line px-4 py-2.5">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden className="shrink-0 text-mute">
            <circle cx="11" cy="11" r="7" />
            <path d="M21 21l-4.3-4.3" />
          </svg>
          <input
            ref={input}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={onKey}
            role="combobox"
            aria-expanded="true"
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={results.length ? optId(safeActive) : undefined}
            aria-label="Поиск серверов и разделов"
            placeholder="Найти сервер или раздел…"
            autoComplete="off"
            spellCheck={false}
            className="min-h-[44px] min-w-0 flex-1 bg-transparent text-fs-lg focus-visible:ring-0 font-bold text-ink outline-hidden placeholder:font-semibold placeholder:text-mute"
          />
          <button
            type="button"
            onClick={onClose}
            className="btn-soft btn-xs max-sm:hidden"
            aria-label="Закрыть поиск"
          >
            Esc
          </button>
          <button
            type="button"
            onClick={onClose}
            className="btn-icon shrink-0 sm:hidden"
            aria-label="Закрыть поиск"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        </div>

        <div ref={list} id={listId} role="listbox" aria-label="Результаты" className="max-h-[min(60dvh,26rem)] overflow-y-auto overscroll-contain p-2">
          {groups.map((g) => {
            const rows = results.map((it, idx) => ({ it, idx })).filter((r) => r.it.group === g);
            if (!rows.length) return null;
            const gid = `${uid}-g-${g}`;
            return (
              <div key={g} role="group" aria-labelledby={gid}>
                <div id={gid} className="px-3 pb-1 pt-2 text-xs font-extrabold uppercase tracking-wider text-mute">{g}</div>
                {rows.map(({ it, idx }) => (
                  <div
                    key={it.key}
                    id={optId(idx)}
                    role="option"
                    aria-selected={idx === safeActive}
                    data-idx={idx}
                    onMouseMove={() => idx !== safeActive && setActive(idx)}
                    onClick={() => go(it)}
                    className={`flex min-h-[48px] cursor-pointer items-center gap-3 rounded-2xl px-3 py-2 ${idx === safeActive ? 'bg-soft' : ''}`}
                  >
                    <span className={`grid h-8 w-8 shrink-0 place-items-center ${it.group === 'Серверы' ? '' : 'rounded-xl bg-card text-link shadow-pop'}`}>{it.icon}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-extrabold leading-tight">{it.label}</span>
                      <span className="block truncate text-sm font-semibold text-mute">{it.hint}</span>
                    </span>
                    {idx === safeActive && <span aria-hidden className="hidden rounded-md bg-card px-1.5 py-0.5 text-xs font-extrabold text-mute sm:inline">Enter</span>}
                  </div>
                ))}
              </div>
            );
          })}
          {results.length === 0 && (
            <p className="px-4 py-8 text-center font-semibold text-mute">
              {servers === null ? 'Загрузка…' : 'Ничего не найдено. Попробуйте другое слово.'}
            </p>
          )}
        </div>

        <div className="hidden items-center gap-4 border-t border-line px-4 py-2 text-xs font-bold text-mute sm:flex">
          <span>↑ ↓ выбрать</span>
          <span>Enter открыть</span>
          <span>Esc закрыть</span>
          <span className="ml-auto">Ctrl K</span>
        </div>
        <p className="sr-only" role="status">{results.length ? `Найдено: ${results.length}` : 'Ничего не найдено'}</p>
      </div>
    </div>
  );
}
