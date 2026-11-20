import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { api } from '../api';
import { soon } from '../components/GameNewsParts';
import { IconClock, IconDoor, IconLink, IconShield, IconUser } from '../components/GameNewsIcons';
import type { ModBan, ModEntry } from '../gameNews';
import { t, useI18n } from '../i18n';
import { Modal } from '../ui';
import type { ConnectionItem } from './connectionsLogic';
import { playTime, playerFacts, type PlayerFacts } from './profileLogic';

/** a click on a nickname anywhere in the plugin page opens the card of the player */
export const ProfileContext = createContext<(nick: string) => void>(() => undefined);
export const useOpenProfile = () => useContext(ProfileContext);

interface Link { platformId: string; masked: string; nick: string; username: string; status: string; discord: boolean; linkedAt: number }

const fmt = (ts: number) => new Date(ts).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

function Fact({ icon, label, value, hint, tone = 'soft' }: { icon: ReactNode; label: string; value: string; hint?: string; tone?: 'soft' | 'bad' | 'warn' }) {
  const cls = tone === 'bad' ? 'bg-badbg text-bad' : tone === 'warn' ? 'bg-warnbg text-warn' : 'bg-card text-link';
  return (
    <div className="flex items-center gap-3 rounded-2xl bg-soft px-3 py-2.5">
      <span aria-hidden className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl ${cls}`}>{icon}</span>
      <span className="min-w-0">
        <span className="block text-xs font-bold text-mute">{label}</span>
        <span className="block font-black leading-tight tabular-nums">{value}</span>
        {hint && <span className="block truncate text-xs font-semibold text-mute">{hint}</span>}
      </span>
    </div>
  );
}

/** the card of a player: how long and how often he plays, what moderation did, whose account he is, the last visits */
export function PlayerProfile({ nick, onClose, onFilter }: { nick: string; onClose: () => void; onFilter: (nick: string) => void }) {
  useI18n();
  const [facts, setFacts] = useState<PlayerFacts | null>(null);
  const [link, setLink] = useState<Link | null | undefined>(undefined);
  const [log, setLog] = useState<ModEntry[]>([]);

  useEffect(() => {
    let off = false;
    setFacts(null);
    const q = encodeURIComponent(nick);
    void Promise.all([
      api<{ items: ConnectionItem[] }>(`/game-news/connections?player=${q}&limit=300`).then((r) => r.items).catch(() => [] as ConnectionItem[]),
      api<{ bans: ModBan[]; log: ModEntry[] }>(`/game-news/moderation?player=${q}`).catch(() => ({ bans: [] as ModBan[], log: [] as ModEntry[] })),
      api<{ items: Link[] }>('/game-news/links').then((r) => r.items).catch(() => [] as Link[]),
    ]).then(([conn, mod, links]) => {
      if (off) return;
      setFacts(playerFacts(nick, conn, mod.log, mod.bans));
      setLog(mod.log.filter((l) => l.nick.toLowerCase() === nick.toLowerCase()).slice(0, 5));
      setLink(links.find((l) => l.nick.toLowerCase() === nick.toLowerCase()) ?? null);
    });
    return () => { off = true; };
  }, [nick]);

  const pt = facts ? playTime(facts.minutes) : null;
  return (
    <Modal title={nick} onClose={onClose}>
      {!facts ? <div className="skeleton h-32 rounded-2xl" aria-busy="true" /> : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2 text-sm font-bold">
            {link
              ? <span className="pill pill-ok inline-flex items-center gap-1"><IconLink size={14} />{t('gn.pf.linked', { name: link.username })}{link.discord ? ' · Discord' : ''}</span>
              : link === null && <span className="pill pill-mute">{t('gn.pf.notLinked')}</span>}
            {facts.active.length > 0 && <span className="pill pill-bad inline-flex items-center gap-1"><IconShield size={14} />{t('gn.pf.banned', { n: facts.active.length })}</span>}
          </div>
          <div className="grid gap-2.5 sm:grid-cols-2">
            <Fact icon={<IconDoor size={18} />} label={t('gn.pf.visits')} value={String(facts.visits)} hint={facts.lastReason ? t('gn.pf.lastReason', { r: facts.lastReason }) : undefined} />
            <Fact icon={<IconClock size={18} />} label={t('gn.pf.time')} value={pt ? (pt.h > 0 ? t('gn.pf.hm', { h: pt.h, m: pt.m }) : t('gn.pf.m', { m: pt.m })) : '—'} />
            <Fact icon={<IconUser size={18} />} label={t('gn.pf.last')} value={facts.lastSeen ? soon(facts.lastSeen) : '—'} hint={facts.lastSeen ? fmt(facts.lastSeen) : undefined} />
            <Fact icon={<IconShield size={18} />} label={t('gn.pf.mod')} value={t('gn.pf.modLine', { k: facts.kicks, w: facts.warns, b: facts.bans })} tone={facts.warns + facts.bans + facts.kicks > 0 ? 'warn' : 'soft'} />
          </div>
          {log.length > 0 && (
            <section>
              <h4 className="mb-1 text-xs font-extrabold text-mute">{t('gn.pf.history')}</h4>
              <ul className="space-y-1 text-sm">
                {log.map((l) => (
                  <li key={l.id} className="flex flex-wrap items-center gap-2">
                    <time className="tabular-nums text-mute">{fmt(l.ts)}</time>
                    <span className={l.kind === 'unban' ? 'pill pill-ok' : 'pill pill-warn'}>{t(`gn.md.k.${l.kind}` as 'gn.md.k.kick')}</span>
                    {l.reason && <span className="min-w-0 truncate font-semibold">{l.reason}</span>}
                    <span className="text-mute">{l.admin}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {facts.recent.length > 0 && (
            <section>
              <h4 className="mb-1 text-xs font-extrabold text-mute">{t('gn.pf.recent')}</h4>
              <ul className="space-y-1 text-sm">
                {facts.recent.map((c) => (
                  <li key={c.id} className="flex flex-wrap items-center gap-2">
                    <time className="tabular-nums text-mute">{fmt(c.ts)}</time>
                    <span className={c.kind === 'join' ? 'pill pill-ok' : /^Timeout/.test(c.reason) ? 'pill pill-warn' : 'pill pill-mute'}>{c.kind === 'join' ? t('gn.cn.join') : c.reason || '—'}</span>
                    {c.serverName && <span className="min-w-0 truncate text-mute">{c.serverName}</span>}
                  </li>
                ))}
              </ul>
            </section>
          )}
          <div className="flex flex-wrap justify-end gap-2">
            <button type="button" className="btn btn-soft" onClick={() => { onFilter(nick); onClose(); }}>{t('gn.pf.filter')}</button>
            <button type="button" className="btn btn-ghost" onClick={onClose}>{t('common.close')}</button>
          </div>
        </div>
      )}
    </Modal>
  );
}
