// The «Список» and «ТВ» views of the servers page.
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Server } from '../../api';
import { gameColor, gameLabel } from '../../games';
import { AnimatedNumber, GameAvatar, StatusPill, ago, isLag, plural } from '../../ui';
import MaintenanceChip from '../MaintenanceChip';
import { CapacityBar, CountReact, StatusFlash, reactionOf, type Reactions } from './serverUi';

export type ServersView = 'tiles' | 'list' | 'tv';
export const VIEW_KEY = 'coregsm_servers_view';

export function readView(): ServersView {
  try {
    const v = localStorage.getItem(VIEW_KEY);
    return v === 'list' || v === 'tv' ? v : 'tiles';
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
    <button type="button" onClick={(e) => void copy(e)} className={`srv-copy ${done ? 'done' : ''} ${className}`} title="Скопировать адрес" aria-label={`Скопировать адрес ${text}`}>
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
}

function ListRow({ s, uptime, onOpen, rx, favButton }: RowProps) {
  const r = reactionOf(rx, s.id);
  const lag = isLag(s);
  return (
    <div
     
      className={`srv-row ${s.online ? '' : 'off'}`}
      onClick={onOpen}
    >
      <div className="srv-c-status"><StatusFlash r={r}><StatusPill online={s.online} known={s.hasStatus} lag={lag} maintenance={!!s.maintenance} /></StatusFlash></div>
      <div className="srv-c-name">
        <GameAvatar game={s.game} size={36} />
        <div className="min-w-0">
          <a href={`#/servers/${s.id}`} onClick={(e) => e.stopPropagation()} className="block truncate font-extrabold hover:text-link" title={s.name}>{s.name}</a>
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

export function ServersList({ servers, uptime, rx, favOf, onOpen, renderFav }: {
  servers: Server[];
  uptime: Map<number, number>;
  rx: Reactions;
  favOf: (id: number) => boolean | null;
  onOpen: (s: Server) => void;
  renderFav: (s: Server, on: boolean) => React.ReactNode;
}) {
  return (
    <div className="panel srv-list fade-in" aria-label="Серверы">
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
          />
        );
      })}
    </div>
  );
}

// ---------- TV ----------
function useNow(ms: number): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = window.setInterval(() => setNow(new Date()), ms);
    return () => window.clearInterval(t);
  }, [ms]);
  return now;
}

function TvCard({ s, uptime, rx }: { s: Server; uptime?: number; rx: Reactions }) {
  const r = reactionOf(rx, s.id);
  const lag = isLag(s);
  const color = gameColor(s.game);
  return (
    <article className={`srv-tv-card ${s.online ? '' : 'off'}`} style={{ ['--accent' as string]: color }}>
      <header className="flex items-center gap-4">
        <GameAvatar game={s.game} size={64} />
        <div className="min-w-0 flex-1">
          <h2 className="srv-tv-name" title={s.name}>{s.name}</h2>
          <div className="srv-tv-sub">{gameLabel(s.game)}{s.online && s.map ? ` · ${s.map}` : ''}</div>
        </div>
        <div className="srv-tv-pill"><StatusFlash r={r}><StatusPill online={s.online} known={s.hasStatus} lag={lag} maintenance={!!s.maintenance} /></StatusFlash></div>
      </header>
      {s.maintenance && <MaintenanceChip m={s.maintenance} glass className="mt-3 self-start" />}

      {s.online ? (
        <>
          <div className="srv-tv-count">
            <CountReact r={r}><AnimatedNumber value={s.players} className="srv-tv-big" /></CountReact>
            <span className="srv-tv-max">/ {s.maxPlayers}<small>{plural(s.maxPlayers, ['игрок', 'игрока', 'игроков'])}</small></span>
          </div>
          <CapacityBar players={s.players} max={s.maxPlayers} color={color} big />
        </>
      ) : (
        <div className="srv-tv-down">
          <div className="text-[clamp(22px,2.4vw,40px)] font-black leading-tight">{s.hasStatus ? 'Сервер не отвечает' : 'Ожидаем первый ответ'}</div>
          {s.hasStatus && <div className="mt-1 text-[clamp(14px,1.3vw,22px)] font-bold opacity-80">Последний ответ: {ago(s.updatedAt)}</div>}
        </div>
      )}

      <footer className="srv-tv-foot">
        <span>{s.online && s.ping != null ? <>пинг <b className={lag ? 'text-warn' : ''}>{s.ping} мс</b></> : 'пинг –'}</span>
        {uptime != null && <span>аптайм <b>{fmtUp(uptime)}</b></span>}
        <span className="truncate font-mono">{s.address}</span>
      </footer>
    </article>
  );
}

/** a full-screen wall display: big cards, clock, no admin chrome. Esc or the button leaves it. */
export function ServersTv({ servers, uptime, rx, updatedAt, onExit }: {
  servers: Server[];
  uptime: Map<number, number>;
  rx: Reactions;
  updatedAt: number;
  onExit: () => void;
}) {
  const now = useNow(1000);
  const root = useRef<HTMLDivElement>(null);
  const exitRef = useRef(onExit);
  exitRef.current = onExit;

  useEffect(() => {
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const el = root.current;
    // full screen where the browser allows it (needs the click that opened the mode); the overlay works without it
    try {
      void el?.requestFullscreen?.().catch(() => undefined);
    } catch {
      /* not available */
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') exitRef.current(); };
    const onFs = () => { if (!document.fullscreenElement) exitRef.current(); };
    window.addEventListener('keydown', onKey);
    document.addEventListener('fullscreenchange', onFs);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener('keydown', onKey);
      document.removeEventListener('fullscreenchange', onFs);
      try {
        if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
      } catch {
        /* ignore */
      }
    };
  }, []);

  const online = servers.filter((s) => s.online);
  const players = online.reduce((n, s) => n + s.players, 0);
  const slots = online.reduce((n, s) => n + s.maxPlayers, 0);
  const n = servers.length;
  const cols = n <= 1 ? 1 : n <= 4 ? 2 : n <= 9 ? 3 : 4;

  return createPortal(
    <div ref={root} className="srv-tv" role="dialog" aria-label="ТВ-режим">
      <div className="srv-tv-top">
        <div className="srv-tv-clock">
          <div className="srv-tv-time">{now.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</div>
          <div className="srv-tv-date">{now.toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' })}</div>
        </div>
        <div className="srv-tv-total">
          <div className="srv-tv-total-n"><AnimatedNumber value={players} /><small>{slots > 0 ? ` / ${slots}` : ''}</small></div>
          <div className="srv-tv-total-k">игроков онлайн · серверов {online.length} из {n}</div>
        </div>
        <div className="srv-tv-actions">
          <span className="srv-tv-live"><span className="live-dot" aria-hidden />{updatedAt ? `обновлено ${ago(updatedAt)}` : 'загрузка'}</span>
          <button type="button" className="btn btn-soft" onClick={onExit} autoFocus>Выйти (Esc)</button>
        </div>
      </div>
      <div className="srv-tv-grid" style={{ ['--cols' as string]: cols }}>
        {servers.map((s) => <TvCard key={s.id} s={s} uptime={uptime.get(s.id)} rx={rx} />)}
      </div>
    </div>,
    document.body,
  );
}
