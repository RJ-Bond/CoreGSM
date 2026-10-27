// The «Список» and «ТВ» views of the servers page.
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Server } from '../../api';
import { gameColor, gameLabel } from '../../games';
import { AnimatedNumber, GameAvatar, MiniSpark, StatusPill, ago, isLag, plural, num } from '../../ui';
import MaintenanceChip from '../MaintenanceChip';
import { CapacityBar, CountReact, StatusFlash, reactionOf, type Reactions } from './serverUi';

export interface ListSort { key: 'name' | 'players' | 'ping' | 'up'; dir: 'asc' | 'desc' }
export type ServersView = 'tiles' | 'list' | 'chart';
export const VIEW_KEY = 'coregsm_servers_view';

export function readView(): ServersView {
  try {
    const v = localStorage.getItem(VIEW_KEY);
    return v === 'list' || v === 'chart' ? v : 'tiles';
  } catch {
    return 'tiles';
  }
}
export function saveView(v: ServersView) {
  try {
    localStorage.setItem(VIEW_KEY, v);
  } catch {
    /* not remembered */
  }
}

const fmtUp = (v: number) => `${num(v)}%`;

/** copies the address; the button shows a check mark for a moment */
function CopyAddress({ text, className = '' }: { text: string; className?: string }) {
  const [done, setDone] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const copy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    let ok = false;
    try {
      await navigator.clipboard.writeText(text);
      ok = true;
    } catch {
      try {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        ok = document.execCommand('copy');
        ta.remove();
      } catch {
        ok = false;
      }
    }
    if (!ok) return;
    setDone(true);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setDone(false), 1500);
  };
  return (
    <button type="button" onClick={(e) => void copy(e)} className={`${done ? 'btn-success' : 'btn-soft'} btn-xs max-w-full ${className}`} title="Скопировать адрес" aria-label={`Скопировать адрес ${text}`}>
      <span className="truncate font-mono">{text}</span>
      <span aria-hidden className="shrink-0">{done ? '✓' : '⧉'}</span>
    </button>
  );
}

// ---------- list ----------
interface RowProps {
  s: Server;
  uptime?: number;
  fav: boolean | null;
  onFav: () => void;
  onOpen: () => void;
  rx: Reactions;
  favButton: React.ReactNode;
  /** selection mode of the bulk actions: the row gets a checkbox and a click toggles it */
  select?: SelectProps;
}

/** selection mode (administrators): `has` tells whether a server is selected */
export interface SelectProps {
  on: boolean;
  has: (id: number) => boolean;
  toggle: (id: number) => void;
}

function ListRow({ s, uptime, onOpen, rx, favButton, select }: RowProps) {
  const r = reactionOf(rx, s.id);
  const lag = isLag(s);
  const kind = s.maintenance ? 'maint' : !s.hasStatus ? 'mute' : !s.online ? 'bad' : lag ? 'warn' : 'ok';
  const label = s.maintenance ? 'Обслуживание' : !s.hasStatus ? 'Ожидание ответа' : !s.online ? 'Офлайн' : lag ? 'Лаги' : 'Онлайн';
  return (
    <div
      className={`srv-tr ${s.online ? '' : 'off'} ${select?.on && select.has(s.id) ? 'selected' : ''}`}
      onClick={select?.on ? () => select.toggle(s.id) : onOpen}
    >
      <div className="srv-td-dot">
        {select?.on && (
          <input
            type="checkbox"
            className="srv-check"
            checked={select.has(s.id)}
            onChange={() => select.toggle(s.id)}
            onClick={(e) => e.stopPropagation()}
            aria-label={`Выбрать: ${s.name}`}
          />
        )}
        <StatusFlash r={r}><span className={`srv-dot ${kind}`} role="img" aria-label={label} title={label} /></StatusFlash>
      </div>
      <div className="srv-td-name">
        <GameAvatar game={s.game} size={28} />
        <div className="min-w-0">
          <a href={`/servers/${s.id}`} onClick={(e) => e.stopPropagation()} className="srv-tr-title" title={s.name}>{s.name}</a>
          <span className="srv-tr-sub">{gameLabel(s.game)}{s.online && s.map ? ` · ${s.map}` : ''}</span>
          {s.maintenance && <MaintenanceChip m={s.maintenance} className="mt-0.5" />}
        </div>
      </div>
      <div className="srv-td-addr"><CopyAddress text={s.address} /></div>
      <div className="srv-td-pl">
        {s.online ? (
          <>
            <b className="srv-tr-count tabular-nums"><CountReact r={r}><AnimatedNumber value={s.players} /></CountReact><span>/{s.maxPlayers}</span></b>
            <CapacityBar players={s.players} max={s.maxPlayers} color={gameColor(s.game)} showPct={false} slots={false} />
          </>
        ) : (
          <span className="srv-tr-off" title={s.error ?? undefined}>{s.hasStatus ? `не отвечает · ${ago(s.updatedAt)}` : 'ожидаем ответ'}</span>
        )}
      </div>
      <div className="srv-td-ping" data-label="Пинг">{s.online && s.ping != null ? <span className={lag ? 'text-warn' : ''}>{s.ping}<small> мс</small></span> : '–'}</div>
      <div className="srv-td-up" data-label="Аптайм">{uptime != null ? fmtUp(uptime) : '–'}</div>
      <div className="srv-td-fav">{favButton}</div>
    </div>
  );
}

export function ServersList({ servers, uptime, rx, favOf, onOpen, renderFav, select, sort, onSort }: {
  select?: SelectProps;
  sort?: ListSort | null;
  onSort?: (k: ListSort['key']) => void;
  servers: Server[];
  uptime: Map<number, number>;
  rx: Reactions;
  favOf: (id: number) => boolean | null;
  onOpen: (s: Server) => void;
  renderFav: (s: Server, on: boolean) => React.ReactNode;
}) {
  return (
    <div className={`panel srv-tbl fade-in ${select?.on ? 'selecting' : ''}`} aria-label="Серверы">
      <div className="srv-tr srv-th">
        <div className="srv-td-dot" />
        {([['name', 'srv-td-name', 'Сервер'], ['players', 'srv-td-pl', 'Игроки'], ['ping', 'srv-td-ping', 'Пинг'], ['up', 'srv-td-up', 'Аптайм']] as const).filter(([k]) => k === 'name').map(([k, cls, label]) => (
          <div key={k} className={cls} aria-sort={sort?.key === k ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined}>
            <button type="button" className="srv-sort" onClick={() => onSort?.(k)} title="Сортировать">
              {label}<span aria-hidden>{sort?.key === k ? (sort.dir === 'asc' ? ' ↑' : ' ↓') : ''}</span>
            </button>
          </div>
        ))}
        <div className="srv-td-addr">Адрес</div>
        {([['name', 'srv-td-name', 'Сервер'], ['players', 'srv-td-pl', 'Игроки'], ['ping', 'srv-td-ping', 'Пинг'], ['up', 'srv-td-up', 'Аптайм']] as const).filter(([k]) => k !== 'name').map(([k, cls, label]) => (
          <div key={k} className={cls} aria-sort={sort?.key === k ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined}>
            <button type="button" className="srv-sort" onClick={() => onSort?.(k)} title="Сортировать">
              {label}<span aria-hidden>{sort?.key === k ? (sort.dir === 'asc' ? ' ↑' : ' ↓') : ''}</span>
            </button>
          </div>
        ))}
        <div className="srv-td-fav" />
      </div>
      {servers.map((s) => {
        const fav = favOf(s.id);
        return (
          <ListRow
            key={s.id}
            s={s}
            uptime={uptime.get(s.id)}
            fav={fav}
            onFav={() => undefined}
            onOpen={() => onOpen(s)}
            rx={rx}
            favButton={fav != null ? renderFav(s, fav) : null}
            select={select}
          />
        );
      })}
    </div>
  );
}

// ---------- TV ----------
