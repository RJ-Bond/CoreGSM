import { useEffect, useState } from 'react';
import { api, type StatusInfo, type StatusServer } from '../api';
import { gameGradient, gameLabel } from '../games';
import { t, useI18n } from '../i18n';
// straight from the modules, not through ../ui (that one re-exports authParts, which imports this file: a cycle)
import { AnimatedNumber } from '../ui/motion';
import { GameAvatar, Logo } from '../ui/blocks';

/**
 * Decorative "bento" tiles around the sign-in card (wide screens only). They show live numbers when the panel
 * is public (GET /status) and quiet generic tiles otherwise. Purely decorative: hidden from assistive tech.
 */
export default function AuthShowcase({ side }: { side: 'left' | 'right' }) {
  useI18n();
  const [info, setInfo] = useState<StatusInfo | null>(null);

  useEffect(() => {
    let alive = true;
    api<StatusInfo>('/status').then((s) => { if (alive) setInfo(s); }).catch(() => undefined);
    return () => { alive = false; };
  }, []);

  const servers = info?.servers ?? [];
  const online = servers.filter((s) => s.online);
  const players = online.reduce((n, s) => n + s.players, 0);
  const top: StatusServer | undefined = [...online].sort((a, b) => b.players - a.players)[0];

  if (side === 'left') {
    return (
      <div aria-hidden className="hidden flex-col items-end gap-4 xl:flex">
        {top ? (
          <div className="showcase-tile w-72 -rotate-2 rounded-ui-xl p-5 text-white shadow-soft" style={{ background: `linear-gradient(135deg, ${gameGradient(top.game)[0]}, ${gameGradient(top.game)[1]})`, animationDelay: '.15s' }}>
            <div className="flex items-center gap-3">
              <GameAvatar game={top.game} size={40} glass />
              <div className="min-w-0">
                <div className="truncate text-fs-base font-extrabold leading-tight">{top.name}</div>
                <div className="truncate text-xs font-bold opacity-85">{gameLabel(top.game)}</div>
              </div>
            </div>
            <div className="mt-4 flex items-baseline gap-2">
              <span className="text-5xl font-extrabold leading-none tabular-nums" style={{ letterSpacing: '-0.04em' }}><AnimatedNumber value={top.players} /></span>
              <span className="font-bold opacity-90">/ {top.maxPlayers}</span>
              <span className="ml-auto rounded-full bg-white/25 px-2.5 py-0.5 text-xs font-extrabold">{t('d2.srv.f.online').toUpperCase()}</span>
            </div>
          </div>
        ) : (
          <div className="showcase-tile panel w-72 -rotate-2 p-5" style={{ animationDelay: '.15s' }}>
            <Logo size={44} alt="" />
            <div className="mt-3 text-lg font-extrabold leading-tight">{t('d2.as.watched')}</div>
            <p className="mt-1 text-sm font-semibold text-mute">{t('d2.as.watchedText')}</p>
          </div>
        )}
        <div className="showcase-tile panel w-56 rotate-1 p-4" style={{ animationDelay: '.3s' }}>
          <div className="stat-k">{t('d2.as.serversOnline')}</div>
          <div className="stat-v">
            {servers.length ? <><AnimatedNumber value={online.length} /><small> {t('d2.as.of', { n: servers.length })}</small></> : '·'}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div aria-hidden className="hidden flex-col items-start gap-4 xl:flex">
      <div className="showcase-tile panel w-60 rotate-2 p-4" style={{ animationDelay: '.25s' }}>
        <div className="stat-k">{t('d2.as.playersNow')}</div>
        <div className="stat-v">{servers.length ? <AnimatedNumber value={players} /> : '·'}</div>
      </div>
      <div className="showcase-tile panel w-72 -rotate-1 space-y-2.5 p-4" style={{ animationDelay: '.4s' }}>
        <div className="stat-k">{t('d2.as.state')}</div>
        {(servers.length ? servers.slice(0, 4) : []).map((s) => (
          <div key={s.id} className="flex items-center gap-2.5">
            <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${s.online ? 'bg-ok' : 'bg-bad'}`} />
            <span className="min-w-0 flex-1 truncate text-sm font-bold">{s.name}</span>
            <span className="text-sm font-extrabold tabular-nums text-mute">{s.online ? `${s.players}/${s.maxPlayers}` : '—'}</span>
          </div>
        ))}
        {!servers.length && (
          <p className="text-sm font-semibold text-mute">{t('d2.as.note')}</p>
        )}
      </div>
      <div className="showcase-tile panel flex w-56 rotate-1 items-center gap-3 p-4" style={{ animationDelay: '.55s' }}>
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-soft text-xl">💬</span>
        <div className="text-sm font-bold leading-snug">{t('d2.as.cards')}</div>
      </div>
    </div>
  );
}
