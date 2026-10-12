import type { Server } from '../../api';
import { GameAvatar } from '../../ui';
import { LIMITS } from './model';

/** pick up to five servers whose live status card is appended to the message */
export function StatusServers({ servers, value, onChange }: { servers: Server[]; value: number[]; onChange: (ids: number[]) => void }) {
  const toggle = (id: number) => {
    if (value.includes(id)) onChange(value.filter((x) => x !== id));
    else if (value.length < LIMITS.statusServers) onChange([...value, id]);
  };
  return (
    <div className="space-y-2">
      <ul className="grid gap-2 sm:grid-cols-2">
        {servers.map((s) => {
          const on = value.includes(s.id);
          const full = !on && value.length >= LIMITS.statusServers;
          return (
            <li key={s.id}>
              <label className={`flex cursor-pointer items-center gap-3 rounded-2xl border-2 p-2.5 transition ${on ? 'border-brand bg-brand/10' : 'border-line'} ${full ? 'cursor-not-allowed opacity-50' : ''}`}>
                <input type="checkbox" className="h-4 w-4 shrink-0 accent-[rgb(var(--brand))]" checked={on} disabled={full} onChange={() => toggle(s.id)} />
                <GameAvatar game={s.game} size={32} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-extrabold">{s.name}</span>
                  <span className="block text-xs font-semibold text-mute">{s.online ? `онлайн · ${s.players}/${s.maxPlayers}` : 'офлайн'}</span>
                </span>
              </label>
            </li>
          );
        })}
      </ul>
      <p className="text-xs font-semibold text-mute">Выбрано {value.length} из {LIMITS.statusServers}. Карточки добавляются под сообщением и обновляются автоматически.</p>
    </div>
  );
}
