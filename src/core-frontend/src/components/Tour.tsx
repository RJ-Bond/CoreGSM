import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { useAuth } from '../auth';
import { useDialogFocus } from '../confirm';
import { currentPath, navigate } from '../ui/route';

/**
 * First-run guided tour for administrators: a short list of coach-marks that walks through the admin area.
 * Shown once per user name (remembered in localStorage); "Показать подсказки заново" in the profile calls restartTour().
 *
 * Each step may point at an element. The selectors are tried in order, so a page can mark its own anchor with
 * data-tour="<name>" and the tour falls back to the section navigation. A missing anchor just centres the card.
 */

interface Step {
  title: string;
  text: string;
  /** hash route opened for this step */
  route: string;
  /** CSS selectors tried in order */
  anchors: string[];
}

const ADMIN_NAV = 'nav[aria-label="Разделы админки"]';
const SETTINGS_NAV = 'nav[aria-label="Разделы настроек"]';

const STEPS: Step[] = [
  {
    title: 'Добавьте игровой сервер',
    text: 'Добро пожаловать! Прогресс всегда виден в «Админка → Начало работы». Начнём с главного: в «Админка → Серверы» добавьте сервер, выбрав игру и указав адрес. Панель сразу начнёт показывать онлайн, карту и пинг.',
    route: '/admin/servers',
    anchors: ['[data-tour="add-server"]', `${ADMIN_NAV} a[href="/admin/servers"]`],
  },
  {
    title: 'Подключите Discord-бота',
    text: 'В «Настройки → Бот и Discord» вставьте токен бота из Discord Developer Portal и сохраните. После этого пригласите бота на свой Discord-сервер.',
    route: '/admin/settings/bot',
    anchors: ['[data-tour="bot-token"]', `${SETTINGS_NAV} a[href="/admin/settings/bot"]`],
  },
  {
    title: 'Привяжите канал',
    text: 'В разделе «Discord» выберите канал, куда бот будет публиковать карточку сервера. Сообщение обновляется по таймеру само.',
    route: '/admin/discord',
    anchors: ['[data-tour="bind-channel"]', `${ADMIN_NAV} a[href="/admin/discord"]`],
  },
  {
    title: 'Пишите новости',
    text: 'В «Новости» можно подготовить запись с картинкой, отправить её в Discord сразу или по расписанию и повторять по расписанию.',
    route: '/admin/news',
    anchors: ['[data-tour="news-new"]', `${ADMIN_NAV} a[href="/admin/news"]`],
  },
  {
    title: 'Настройте оформление',
    text: 'В «Настройки → Оформление» задайте название сообщества, логотип и фирменный цвет. На этом всё: подсказки можно показать снова в профиле.',
    route: '/admin/settings/brand',
    anchors: ['[data-tour="brand"]', `${SETTINGS_NAV} a[href="/admin/settings/brand"]`],
  },
];

const key = (username: string) => `coregsm_tour_${username}`;
const RESTART = 'coregsm:tour-restart';

const seen = (username: string) => {
  try { return localStorage.getItem(key(username)) === '1'; } catch { return true; }
};
const markSeen = (username: string) => {
  try { localStorage.setItem(key(username), '1'); } catch { /* private mode: it may show again next time */ }
};

/** forget that the tour was shown and start it now */
export function restartTour(username: string) {
  try { localStorage.removeItem(key(username)); } catch { /* ignore */ }
  window.dispatchEvent(new Event(RESTART));
}

/** mounted once for a signed-in layout */
export default function Tour() {
  const { me, isAdmin } = useAuth();
  const username = me?.username ?? '';
  const [open, setOpen] = useState(false);
  const [offer, setOffer] = useState(false);

  // first sign-in: only OFFER the tour (a small card in the corner); it never dims the page on its own
  useEffect(() => {
    if (!isAdmin || !username || seen(username)) { setOffer(false); return; }
    const t = window.setTimeout(() => setOffer(true), 2500);
    return () => window.clearTimeout(t);
  }, [isAdmin, username]);

  useEffect(() => {
    const again = () => { if (isAdmin && username) { setOffer(false); setOpen(true); } };
    window.addEventListener(RESTART, again);
    return () => window.removeEventListener(RESTART, again);
  }, [isAdmin, username]);

  const close = useCallback(() => {
    if (username) markSeen(username);
    setOpen(false);
  }, [username]);

  if (!isAdmin) return null;
  if (open) return <TourOverlay onClose={close} />;
  if (!offer) return null;
  return (
    <div role="dialog" aria-label="Подсказки по панели" className="pop panel fixed bottom-24 right-4 z-[60] w-[min(22rem,calc(100vw-2rem))] space-y-3 p-4 shadow-soft md:bottom-6">
      <div>
        <div className="font-black">Впервые в Админке?</div>
        <p className="text-sm font-semibold text-mute">Покажу за минуту, с чего начать: сервер, бот, канал, новости.</p>
      </div>
      <div className="flex gap-2">
        <button className="btn btn-sm" onClick={() => { setOffer(false); setOpen(true); }}>Показать</button>
        <button className="btn btn-soft btn-sm" onClick={() => { setOffer(false); if (username) markSeen(username); }}>Не нужно</button>
      </div>
    </div>
  );
}

const findAnchor = (step: Step): HTMLElement | null => {
  for (const sel of step.anchors) {
    const el = document.querySelector<HTMLElement>(sel);
    if (el && el.getClientRects().length > 0) return el;
  }
  return null;
};

const POP_W = 360;

function TourOverlay({ onClose }: { onClose: () => void }) {
  const [i, setI] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const [vw, setVw] = useState(window.innerWidth);
  const box = useRef<HTMLDivElement>(null);
  const step = STEPS[i];
  const last = i === STEPS.length - 1;

  useDialogFocus(box, onClose, () => box.current?.querySelector<HTMLElement>('[data-next]'));

  // open the step's page, then wait for the anchor to appear (pages load their data first)
  useEffect(() => {
    if (currentPath() !== step.route) {
      // replace, not push: the back button should not walk through the tour
      navigate(step.route, { replace: true });
    }
    setRect(null);
    let tries = 0;
    let alive = true;
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const look = () => {
      if (!alive) return;
      const el = findAnchor(step);
      if (el) {
        el.scrollIntoView({ block: 'center', inline: 'center', behavior: reduce ? 'auto' : 'smooth' });
        setRect(el.getBoundingClientRect());
      } else if (++tries < 25) {
        timer = window.setTimeout(look, 120);
      }
    };
    let timer = window.setTimeout(look, 150);
    return () => { alive = false; window.clearTimeout(timer); };
  }, [step]);

  // keep the spotlight on the anchor while scrolling / resizing
  useLayoutEffect(() => {
    let raf = 0;
    const update = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        setVw(window.innerWidth);
        const el = findAnchor(step);
        if (el) setRect(el.getBoundingClientRect());
      });
    };
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [step]);

  const mobile = vw < 640;
  const pad = 6;
  let popStyle: CSSProperties = {};
  if (!mobile) {
    if (rect) {
      const below = rect.bottom + pad + 14;
      const fitsBelow = below + 230 < window.innerHeight;
      const left = Math.min(Math.max(12, rect.left), Math.max(12, vw - POP_W - 12));
      popStyle = fitsBelow
        ? { left, top: below }
        : { left, bottom: Math.max(12, window.innerHeight - rect.top + pad + 14) };
    } else {
      popStyle = { left: '50%', top: '50%', transform: 'translate(-50%, -50%)' };
    }
  }

  return (
    <div className="fixed inset-0 z-[85]">
      {/* swallows clicks: the tour moves between pages itself */}
      <div className="absolute inset-0" />
      {rect ? (
        <div
          aria-hidden
          className="pointer-events-none absolute rounded-2xl transition-all duration-300"
          style={{
            top: rect.top - pad,
            left: rect.left - pad,
            width: rect.width + pad * 2,
            height: rect.height + pad * 2,
            boxShadow: '0 0 0 9999px rgb(0 0 0 / 0.58)',
            outline: '2px solid rgb(var(--link))',
          }}
        />
      ) : (
        <div aria-hidden className="absolute inset-0 bg-black/55" />
      )}

      <div
        ref={box}
        role="dialog"
        aria-modal="true"
        aria-labelledby="tour-title"
        aria-describedby="tour-text"
        tabIndex={-1}
        style={mobile ? undefined : { ...popStyle, width: POP_W }}
        className={`panel absolute space-y-3 p-5 shadow-pop outline-none max-sm:inset-x-0 max-sm:bottom-0 max-sm:rounded-b-none max-sm:pb-[max(1.25rem,env(safe-area-inset-bottom))] ${mobile ? '' : 'max-w-[calc(100vw-1.5rem)]'}`}
      >
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm font-extrabold text-mute" aria-live="polite">Шаг {i + 1} из {STEPS.length}</p>
          <div className="flex gap-1.5" aria-hidden>
            {STEPS.map((_, n) => (
              <span key={n} className={`h-1.5 rounded-full transition-all ${n === i ? 'w-5 bg-brand' : n < i ? 'w-1.5 bg-brand/50' : 'w-1.5 bg-field/60'}`} />
            ))}
          </div>
        </div>
        <h2 id="tour-title" className="text-lg font-black leading-snug">{step.title}</h2>
        <p id="tour-text" className="font-semibold leading-relaxed text-mute">{step.text}</p>
        <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Пропустить
          </button>
          <div className="flex gap-2">
            {i > 0 && (
              <button type="button" className="btn btn-soft" onClick={() => setI(i - 1)}>Назад</button>
            )}
            <button type="button" data-next className="btn" onClick={() => (last ? onClose() : setI(i + 1))}>
              {last ? 'Готово' : 'Далее'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
