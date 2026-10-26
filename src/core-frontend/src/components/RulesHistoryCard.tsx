import { useEffect, useState } from 'react';
import { api } from '../api';
import { t, useI18n } from '../i18n';
import { Section, ago } from '../ui';

interface History { current: number | null; players: number; versions: { version: number; text: string; createdAt: number; agreed: number }[] }

/** «История правил»: every version of the rules and how many players agreed to it; an old version can be put back. */
export default function RulesHistoryCard({ rulesKey, onRestore }: { rulesKey: string; onRestore: (text: string) => void }) {
  useI18n();
  const [h, setH] = useState<History | null>(null);
  const [open, setOpen] = useState<number | null>(null);

  // the text is saved by itself: look again a moment after it changes
  useEffect(() => {
    let alive = true;
    const id = window.setTimeout(() => { api<History>('/rules/history').then((x) => { if (alive) setH(x); }).catch(() => undefined); }, 1200);
    return () => { alive = false; window.clearTimeout(id); };
  }, [rulesKey]);

  if (!h || h.versions.length === 0) return null;
  return (
    <Section title={t('rl.history')} description={t('rl.historyHelp')}>
      <ul className="divide-y divide-line">
        {h.versions.map((v) => (
          <li key={v.version} className="py-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0">
                <span className="font-black">{t('rl.version', { v: v.version })}</span>
                {v.version === h.current && <span className="pill pill-ok ml-2">{t('rl.currentMark')}</span>}
                <span className="ml-2 text-sm font-semibold text-mute">{ago(v.createdAt)}</span>
                <span className="ml-2 text-sm font-semibold text-mute">{t('rl.agreed', { n: v.agreed, total: h.players })}</span>
              </div>
              <div className="flex gap-3">
                <button type="button" className="btn-link" aria-expanded={open === v.version} onClick={() => setOpen(open === v.version ? null : v.version)}>{open === v.version ? t('rl.hide') : t('rl.read')}</button>
                {v.version !== h.current && <button type="button" className="btn-link" onClick={() => onRestore(v.text)}>{t('rl.restore')}</button>}
              </div>
            </div>
            {open === v.version && <p className="mt-2 max-h-56 overflow-y-auto whitespace-pre-wrap rounded-ui-lg bg-soft p-3 text-sm font-semibold">{v.text}</p>}
          </li>
        ))}
      </ul>
    </Section>
  );
}
