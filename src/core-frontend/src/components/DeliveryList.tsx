import { useEffect, useState, type JSX } from 'react';
import { api, ApiError } from '../api';
import {
  KIND_LABEL, STATUS_LABEL, attemptsText, canRetry, countdownText,
  type DeliveryKind, type DeliveryResponse, type DeliveryStatus,
} from '../deliveries';
import { IconBell, IconDiscord, IconNews, IconRefresh, IconUsers, Section, ago, toast, usePoll } from '../ui';

const KIND_ICON: Record<DeliveryKind, () => JSX.Element> = {
  news: () => <IconNews size={18} />,
  alert: () => <IconBell size={18} />,
  dm: () => <IconUsers size={18} />,
  status: () => <IconDiscord size={18} />,
};

const STATUS_PILL: Record<DeliveryStatus, string> = {
  pending: 'pill pill-mute',
  sending: 'pill pill-mute',
  sent: 'pill pill-ok',
  error: 'pill pill-warn',
  dead: 'pill pill-bad',
};

const FILTERS: { id: DeliveryStatus | ''; label: string }[] = [
  { id: '', label: 'Все' },
  { id: 'pending', label: 'В очереди' },
  { id: 'sending', label: 'Отправляются' },
  { id: 'sent', label: 'Доставлено' },
  { id: 'error', label: 'С ошибкой' },
  { id: 'dead', label: 'Не доставлено' },
];

/** «Доставка»: the queue of messages the bot sends to Discord, with retries. Hidden when the backend has no queue. */
export default function DeliveryList() {
  const [data, setData] = useState<DeliveryResponse | null>(null);
  const [gone, setGone] = useState(false);
  const [status, setStatus] = useState<DeliveryStatus | ''>('');
  const [kind, setKind] = useState<DeliveryKind | ''>('');
  const [busy, setBusy] = useState<number[]>([]);
  const [now, setNow] = useState(Date.now());
  const [fetchedAt, setFetchedAt] = useState(0);

  const load = () =>
    api<DeliveryResponse>(`/deliveries?${new URLSearchParams({ ...(status ? { status } : {}), ...(kind ? { kind } : {}), limit: '30' })}`)
      .then((r) => {
        setData({ counts: r.counts ?? { pending: 0, sending: 0, sent: 0, error: 0, dead: 0 }, items: Array.isArray(r.items) ? r.items : [] });
        setFetchedAt(Date.now());
        setGone(false);
      })
      .catch((e: Error) => { if (e instanceof ApiError && (e.status === 404 || e.status === 403)) setGone(true); else if (!data) setGone(true); });
  usePoll(load, 10_000);
  // a changed filter reloads at once
  useEffect(() => { if (fetchedAt) void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [status, kind]);

  // the countdown ticks once a second while something waits for its next try
  const waiting = !!data?.items.some((i) => i.nextTryAt != null);
  useEffect(() => {
    if (!waiting) return;
    const t = setInterval(() => { if (!document.hidden) setNow(Date.now()); }, 1000);
    return () => clearInterval(t);
  }, [waiting]);

  const retry = async (id: number) => {
    setBusy((b) => [...b, id]);
    try {
      await api(`/deliveries/${id}/retry`, 'POST');
      toast('Сообщение поставлено в очередь снова');
      await load();
    } catch (e) {
      toast(e instanceof ApiError && e.status === 409 ? 'Эту доставку уже нельзя повторить' : (e as Error).message, 'err');
      void load();
    } finally {
      setBusy((b) => b.filter((x) => x !== id));
    }
  };

  if (gone) return null;
  const counts = data?.counts;
  const total = counts ? Object.values(counts).reduce((s, n) => s + n, 0) : 0;

  return (
    <Section
      title="Доставка"
      description="Очередь сообщений в Discord: новости, оповещения и карточки статуса. Неудачные попытки повторяются сами, до 8 раз."
      actions={(
        <select className="input w-auto!" value={kind} onChange={(e) => setKind(e.target.value as DeliveryKind | '')} aria-label="Тип сообщений">
          <option value="">Все типы</option>
          {(Object.keys(KIND_LABEL) as DeliveryKind[]).map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
        </select>
      )}
    >
      <div className="flex flex-wrap gap-2" role="group" aria-label="Фильтр по состоянию">
        {FILTERS.map((f) => {
          const n = f.id === '' ? total : counts?.[f.id] ?? 0;
          return (
            <button key={f.id || 'all'} type="button" className={`chip-filter ${status === f.id ? 'on' : ''}`} aria-pressed={status === f.id} onClick={() => setStatus(f.id)}>
              {f.label}<span className="opacity-70">&nbsp;{n}</span>
            </button>
          );
        })}
      </div>

      {!data ? (
        <div className="skeleton h-24 rounded-ui-lg" aria-busy="true" aria-label="Загрузка" />
      ) : data.items.length === 0 ? (
        <p className="rounded-ui-lg bg-soft px-4 py-3 font-semibold text-mute">
          {status || kind ? 'Под этот фильтр ничего не попало.' : 'Очередь пуста: сообщения уходят сразу.'}
        </p>
      ) : (
        <ul className="divide-y divide-line rounded-ui-lg border border-line">
          {data.items.map((it) => (
            <li key={it.id} className="flex flex-wrap items-start gap-x-3 gap-y-2 px-4 py-3">
              <span className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-full bg-soft text-link" title={KIND_LABEL[it.kind]} role="img" aria-label={KIND_LABEL[it.kind]}>
                {KIND_ICON[it.kind]()}
              </span>
              <div className="min-w-0 flex-1 basis-56">
                <div className="wrap-break-word font-extrabold">{it.summary || KIND_LABEL[it.kind]}</div>
                <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm font-semibold text-mute">
                  <span className={STATUS_PILL[it.status]}>{STATUS_LABEL[it.status]}</span>
                  <span>попытки {attemptsText(it.attempts)}</span>
                  {it.status === 'sent' && it.sentAt ? <span>{ago(it.sentAt)}</span> : <span>создано {ago(it.createdAt)}</span>}
                  {it.nextTryAt != null && it.status !== 'sent' && it.status !== 'dead' && <span>следующая попытка {countdownText(it.nextTryAt, now)}</span>}
                </div>
                {it.lastError && it.status !== 'sent' && <p className="mt-1 wrap-break-word rounded-xl bg-badbg px-3 py-1.5 text-sm font-bold text-bad">{it.lastError}</p>}
              </div>
              {canRetry(it.status) && (
                <button type="button" className="btn btn-soft btn-sm" disabled={busy.includes(it.id)} onClick={() => void retry(it.id)}>
                  <IconRefresh size={14} />Повторить
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}
