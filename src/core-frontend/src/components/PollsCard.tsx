import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import { useAuth } from '../auth';
import { t, useI18n } from '../i18n';
import { fail, toast } from '../ui';

export interface PollView {
  id: number;
  question: string;
  closesAt: number | null;
  closed: boolean;
  total: number;
  options: { id: number; text: string; votes: number; pct: number }[];
  myVote: number | null;
}

/** one poll: buttons while it is open (a vote can be changed), bars with the results */
export function PollBlock({ poll, onChange }: { poll: PollView; onChange: (p: PollView) => void }) {
  useI18n();
  const [busy, setBusy] = useState(false);
  const vote = async (optionId: number) => {
    if (busy || poll.closed) return;
    setBusy(true);
    try {
      onChange(await api<PollView>(`/polls/${poll.id}/vote`, 'POST', { optionId }));
      toast(t('pl.voted'));
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="py-3">
      <div className="mb-2 font-black">{poll.question}</div>
      <ul className="space-y-2">
        {poll.options.map((o) => (
          <li key={o.id}>
            <button
              type="button"
              disabled={poll.closed || busy}
              onClick={() => void vote(o.id)}
              aria-pressed={poll.myVote === o.id}
              className={`relative w-full overflow-hidden rounded-ui-lg border px-3 py-2 text-left font-bold transition ${poll.myVote === o.id ? 'border-brand' : 'border-line'} ${poll.closed ? 'cursor-default' : 'hover:bg-soft'}`}
            >
              <span aria-hidden className="absolute inset-y-0 left-0 bg-brand/15" style={{ width: `${o.pct}%` }} />
              <span className="relative flex items-center justify-between gap-3">
                <span className="min-w-0 break-words">{poll.myVote === o.id ? '✓ ' : ''}{o.text}</span>
                <span className="shrink-0 text-sm text-mute">{o.pct}% · {o.votes}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-sm font-semibold text-mute">
        {t('pl.total', { n: poll.total })} · {poll.closed ? t('pl.closed') : poll.closesAt ? t('pl.until', { when: new Date(poll.closesAt).toLocaleString() }) : t('pl.open')}
      </p>
    </div>
  );
}

/** the open polls (and the latest finished ones) on the community page; only for signed-in users */
export default function PollsCard() {
  useI18n();
  const { me } = useAuth();
  const [polls, setPolls] = useState<PollView[] | null>(null);
  useEffect(() => {
    if (!me) { setPolls(null); return; }
    let alive = true;
    api<PollView[]>('/polls').then((r) => { if (alive) setPolls(r); }).catch(() => undefined);
    return () => { alive = false; };
  }, [me?.username]);
  const replace = useCallback((p: PollView) => setPolls((cur) => cur?.map((x) => (x.id === p.id ? p : x)) ?? cur), []);
  if (!me || !polls || polls.length === 0) return null;
  const shown = polls.filter((p) => !p.closed).concat(polls.filter((p) => p.closed).slice(0, 2));
  return (
    <section id="cm-polls" className="tile fade-in" aria-label={t('pl.title')}>
      <h2 className="mb-1 text-lg font-black">{t('pl.title')}</h2>
      <div className="divide-y divide-line">
        {shown.map((p) => <PollBlock key={p.id} poll={p} onChange={replace} />)}
      </div>
    </section>
  );
}
