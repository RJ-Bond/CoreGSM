import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { GAMES } from '../games';
import { GameAvatar } from '../ui';

const CUSTOM = '__custom';

/**
 * A game chooser with the game icons (a native <select> cannot draw them). It opens inline, so it is never
 * clipped by a dialog: a search field, a scrollable list of games with their icons and an «Другая…» entry.
 * Keyboard: ↑ ↓ Home End move, Enter picks, Esc closes; typing filters the list.
 */
export default function GamePicker({
  value,
  custom,
  onPick,
  id,
  autoFocus,
}: {
  /** current game id */
  value: string;
  /** true when the «Другая» entry is active */
  custom: boolean;
  onPick: (id: string) => void;
  id?: string;
  autoFocus?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const btn = useRef<HTMLButtonElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const uid = useId();

  const needle = q.trim().toLowerCase();
  const items = useMemo(() => {
    const games = GAMES.filter((g) => !needle || g.label.toLowerCase().includes(needle) || g.id.includes(needle));
    return [...games.map((g) => ({ id: g.id, label: g.label })), ...(needle && !'другая'.includes(needle) && !'custom'.includes(needle) ? [] : [{ id: CUSTOM, label: 'Другая игра (ввести GameDig ID)…' }])];
  }, [needle]);

  const current = custom ? null : GAMES.find((g) => g.id === value);

  useEffect(() => {
    if (!open) return;
    const idx = Math.max(0, items.findIndex((i) => i.id === (custom ? CUSTOM : value)));
    setActive(idx);
    search.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => { setActive(0); }, [needle]);

  useEffect(() => {
    if (!open) return;
    list.current?.querySelector<HTMLElement>(`[data-i="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active, open]);

  const close = (refocus = true) => {
    setOpen(false);
    setQ('');
    if (refocus) btn.current?.focus();
  };
  const pick = (gid: string) => {
    onPick(gid);
    close();
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(items.length - 1, a + 1)); return; }
    if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); return; }
    if (e.key === 'Home' && !q) { e.preventDefault(); setActive(0); return; }
    if (e.key === 'End' && !q) { e.preventDefault(); setActive(items.length - 1); return; }
    if (e.key === 'Enter') { e.preventDefault(); const it = items[active]; if (it) pick(it.id); }
  };

  return (
    <div className="relative">
      <button
        ref={btn}
        id={id}
        type="button"
        className="input flex items-center gap-3 text-left"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={`${uid}-list`}
        autoFocus={autoFocus}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => { if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && !open) { e.preventDefault(); setOpen(true); } }}
      >
        {current ? <GameAvatar game={current.id} size={30} /> : <span aria-hidden className="grid h-[30px] w-[30px] place-items-center rounded-[9px] bg-soft text-sm font-black text-mute">?</span>}
        <span className="min-w-0 flex-1 truncate font-bold">{current ? current.label : 'Другая игра (GameDig ID)'}</span>
        <svg aria-hidden width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" className={`shrink-0 text-mute transition ${open ? 'rotate-180' : ''}`}><path d="m6 9 6 6 6-6" /></svg>
      </button>

      {open && (
        <div className="mt-2 overflow-hidden rounded-2xl border-2 border-line bg-card shadow-soft" onKeyDown={onKey}>
          <div className="border-b border-line p-2">
            <input
              ref={search}
              className="input !rounded-xl !py-2"
              type="search"
              placeholder="Найти игру…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              role="combobox"
              aria-expanded
              aria-controls={`${uid}-list`}
              aria-activedescendant={items[active] ? `${uid}-opt-${active}` : undefined}
              aria-label="Поиск игры"
            />
          </div>
          <ul ref={list} id={`${uid}-list`} role="listbox" aria-label="Игры" className="max-h-64 overflow-y-auto p-1.5">
            {items.length === 0 && <li className="px-3 py-3 text-sm font-semibold text-mute">Ничего не найдено</li>}
            {items.map((it, i) => {
              const selected = it.id === (custom ? CUSTOM : value);
              return (
                <li
                  key={it.id}
                  id={`${uid}-opt-${i}`}
                  data-i={i}
                  role="option"
                  aria-selected={selected}
                  onMouseEnter={() => setActive(i)}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => pick(it.id)}
                  className={`flex cursor-pointer items-center gap-3 rounded-xl px-2.5 py-2 font-bold transition-colors max-sm:min-h-[48px] ${i === active ? 'bg-soft' : ''} ${selected ? 'text-link' : ''}`}
                >
                  {it.id === CUSTOM ? (
                    <span aria-hidden className="grid h-[34px] w-[34px] shrink-0 place-items-center rounded-[10px] bg-soft text-lg font-black text-mute">+</span>
                  ) : (
                    <GameAvatar game={it.id} size={34} />
                  )}
                  <span className="min-w-0 flex-1 truncate">{it.label}</span>
                  {selected && <span aria-hidden className="text-link">✓</span>}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
