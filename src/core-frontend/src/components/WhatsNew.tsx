import { useEffect, useRef, useState } from 'react';
import { api, type UpdateInfo, type UpdateNotes, type UpdateNotesRelease } from '../api';
import { useAuth } from '../auth';
import { useDialogFocus } from '../confirm';
import { getLang, t, type TKey } from '../i18n';
import { cleanNote, releasesSince } from '../pages/settings/updateLogic';

/**
 * «What's new» after a panel update: administrators see the release notes of the versions installed since they last looked,
 * one version per step. The version they have seen is remembered per user in localStorage; the very first visit only
 * remembers the current version (an offer about a fresh install would be noise).
 */
const key = (username: string) => `coregsm_whatsnew_${username}`;
const read = (username: string): string | null => {
  try { return localStorage.getItem(key(username)); } catch { return null; }
};
const write = (username: string, v: string) => {
  try { localStorage.setItem(key(username), v); } catch { /* private mode: it may be offered again */ }
};

export default function WhatsNew() {
  const { me, isAdmin } = useAuth();
  const username = me?.username ?? '';
  const [current, setCurrent] = useState<string | null>(null);
  const [rels, setRels] = useState<UpdateNotesRelease[]>([]);
  const [offer, setOffer] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!isAdmin || !username) return;
    let alive = true;
    api<UpdateInfo>('/update/status')
      .then(async (info) => {
        const cur = info.currentLabel ?? null;
        if (!alive || !cur) return;
        setCurrent(cur);
        const seen = read(username);
        if (!seen) { write(username, cur); return; }
        if (seen === cur) return;
        const n = await api<UpdateNotes>('/update/notes');
        if (!alive) return;
        const list = releasesSince(n.releases, seen, cur);
        // nothing readable to show (an old install, a downgrade): just remember where we are
        if (list.length === 0) { write(username, cur); return; }
        setRels(list);
        window.setTimeout(() => { if (alive) setOffer(true); }, 2500);
      })
      .catch(() => undefined);
    return () => { alive = false; };
  }, [isAdmin, username]);

  const done = () => {
    if (username && current) write(username, current);
    setOffer(false);
    setOpen(false);
  };

  if (!isAdmin || rels.length === 0) return null;
  if (open) return <Steps rels={rels} onClose={done} />;
  if (!offer) return null;
  return (
    <div role="dialog" aria-label={t('wn.title')} className="pop panel panel-raised fixed bottom-24 right-4 z-60 flex w-[min(22rem,calc(100vw-2rem))] items-center gap-3 p-3 md:left-4 md:right-auto">
      <div className="min-w-0 flex-1">
        <div className="text-sm font-black">{t('wn.offer', { v: current ?? '' })}</div>
        <button type="button" className="text-sm font-extrabold text-link underline" onClick={() => { setOffer(false); setOpen(true); }}>{t('wn.show')}</button>
      </div>
      <button type="button" className="btn-icon-ghost btn-icon-sm" aria-label={t('wn.dismiss')} title={t('wn.dismiss')} onClick={done}>×</button>
    </div>
  );
}

function Steps({ rels, onClose }: { rels: UpdateNotesRelease[]; onClose: () => void }) {
  // oldest first: the story of what changed reads in order
  const ordered = [...rels].reverse();
  const [i, setI] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  useDialogFocus(box, onClose, () => box.current?.querySelector<HTMLElement>('[data-next]'));
  const r = ordered[i]!;
  const last = i === ordered.length - 1;
  const en = getLang() === 'en';
  return (
    <div className="fixed inset-0 z-85 flex items-center justify-center bg-black/50 p-4">
      <div ref={box} role="dialog" aria-modal="true" aria-label={t('wn.title')} className="panel panel-raised flex max-h-[85dvh] w-[min(34rem,100%)] flex-col overflow-hidden">
        <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-3">
          <h2 className="text-lg font-black">{t('wn.version', { v: r.version ?? '' })}{r.date ? <span className="ml-2 text-sm font-semibold text-mute">{r.date}</span> : null}</h2>
          <span className="text-sm font-bold text-mute">{i + 1} / {ordered.length}</span>
        </div>
        <div className="overflow-y-auto px-5 py-4">
          {r.groups.map((g, gi) => (
            <section key={gi} className="mb-3 last:mb-0">
              <h3 className="mb-1 text-sm font-black text-mute">{en && g.titleEn ? g.titleEn : g.title}</h3>
              <ul className="space-y-1.5">
                {g.items.map((it, k) => (
                  <li key={k} className="text-sm font-semibold leading-snug">
                    {cleanNote(en && it.textEn ? it.textEn : it.text)}
                    {it.flags.map((f) => <span key={f} className="pill pill-warn ml-2">{t(`upd.fl.${f}` as TKey)}</span>)}
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
        <div className="flex items-center justify-between gap-2 border-t border-line px-5 py-3">
          <button type="button" className="btn-link" onClick={onClose}>{t('wn.skip')}</button>
          <div className="flex gap-2">
            {i > 0 && <button type="button" className="btn-soft" onClick={() => setI(i - 1)}>{t('wn.back')}</button>}
            <button type="button" data-next className="btn-primary" onClick={() => (last ? onClose() : setI(i + 1))}>{last ? t('wn.done') : t('wn.next')}</button>
          </div>
        </div>
      </div>
    </div>
  );
}
