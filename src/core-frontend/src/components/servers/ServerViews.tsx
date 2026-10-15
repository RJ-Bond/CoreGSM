// The «Список» and «ТВ» views of the servers page.
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Server } from '../../api';
import { gameColor, gameLabel } from '../../games';
import { AnimatedNumber, GameAvatar, StatusPill, ago, isLag, plural } from '../../ui';
import MaintenanceChip from '../MaintenanceChip';
import { CapacityBar, CountReact, StatusFlash, reactionOf, type Reactions } from './serverUi';

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

const fmtUp = (v: number) => `${(Math.round(v * 10) / 10).toLocaleString('ru-RU')}%`;

/** copies the address; the button shows a check mark for a moment */
function CopyAddress({ text, className = '' }: { text: string; className?: string }) {
  const [done, setDone] = useState(false);
  const timer = useRef<number>();
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
  return (
    <div
      className={`srv-row ${s.online ? '' : 'off'} ${select?.on && select.has(s.id) ? 'selected' : ''}`}
      onClick={select?.on ? () => select.toggle(s.id) : onOpen}
    >
      <div className="srv-c-status">
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
        <StatusFlash r={r}><StatusPill online={s.online} known={s.hasStatus} lag={lag} maintenance={!!s.maintenance} /></StatusFlash>
      </div>
      <div className="srv-c-name">
        <GameAvatar game={s.game} size={36} />
        <div className="min-w-0">
          <a href={`/servers/${s.id}`} onClick={(e) => e.stopPropagation()} className="block truncate font-extrabold hover:text-link" title={s.name}>{s.name}</a>
          <div className="truncate text-[13px] font-bold text-mute">{gameLabel(s.game)}{s.online && s.map ? ` · ${s.map}` : ''}</div>
          {s.maintenance && <MaintenanceChip m={s.maintenance} className="mt-0.5" />}
        </div>
      </div>
      <div className="srv-c-players">
        {s.online ? (
          <>
            <div className="flex items-baseline gap-1 font-extrabold tabular-nums">
              <CountReact r={r}><AnimatedNumber value={s.players} /></CountReact>
              <span className="text-mute">/ {s.maxPlayers}</span>
            </div>
            <CapacityBar players={s.players} max={s.maxPlayers} color={gameColor(s.game)} />
          </>
        ) : (
          <span className="truncate text-[13px] font-bold text-mute" title={s.error ?? undefined}>{s.hasStatus ? `Не отвечает · ${ago(s.updatedAt)}` : 'Ожидаем ответ'}</span>
        )}
      </div>
      <div className="srv-c-ping" data-label="Пинг">{s.online && s.ping != null ? <span className={lag ? 'text-warn' : ''}>{s.ping} мс</span> : '–'}</div>
      <div className="srv-c-up" data-label="Аптайм">{uptime != null ? fmtUp(uptime) : '–'}</div>
      <div className="srv-c-addr"><CopyAddress text={s.address} /></div>
      <div className="srv-c-fav">{favButton}</div>
    </div>
  );
}

export function ServersList({ servers, uptime, rx, favOf, onOpen, renderFav, select }: {
  select?: SelectProps;
  servers: Server[];
  uptime: Map<number, number>;
  rx: Reactions;
  favOf: (id: number) => boolean | null;
  onOpen: (s: Server) => void;
  renderFav: (s: Server, on: boolean) => React.ReactNode;
}) {
  return (
    <div className={`panel srv-list fade-in ${select?.on ? "selecting" : ""}`} aria-label="Серверы">
      <div className="srv-row srv-head">
        <div className="srv-c-status">Статус</div>
        <div className="srv-c-name">Сервер</div>
        <div className="srv-c-players">Игроки</div>
        <div className="srv-c-ping">Пинг</div>
        <div className="srv-c-up">Аптайм 30 дн</div>
        <div className="srv-c-addr">Адрес</div>
        <div className="srv-c-fav" />
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
