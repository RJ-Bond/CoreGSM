import { useEffect, useState } from 'react';
import { api } from '../api';
import { CONC_MAX, CONC_MIN, FAIL_MAX, FAIL_MIN, confirmDelayText, durationText, validatePoll, type PollSettings } from '../pollSettings';
import { FieldError, SaveBadge, Section, ago, plural, useAutosave } from '../ui';

/** «Опрос серверов»: when a failure is confirmed, how many servers are asked at once, and the numbers of the last poll. */
export default function PollSettingsCard() {
  const [srv, setSrv] = useState<PollSettings | null>(null);
  const [gone, setGone] = useState(false);
  const [fail, setFail] = useState('3');
  const [conc, setConc] = useState('8');

  useEffect(() => {
    let alive = true;
    api<PollSettings>('/settings/poll')
      .then((r) => {
        if (!alive) return;
        setSrv(r);
        setFail(String(r.failThreshold));
        setConc(String(r.concurrency));
      })
      .catch(() => { if (alive) setGone(true); });
    return () => { alive = false; };
  }, []);

  const value = { failThreshold: Number(fail), concurrency: Number(conc) };
  const err = validatePoll(value);
  const auto = useAutosave({
    value,
    saved: srv ? { failThreshold: srv.failThreshold, concurrency: srv.concurrency } : value,
    enabled: !!srv,
    delay: 700,
    validate: (v) => validatePoll(v),
    save: async (v) => {
      const r = await api<PollSettings>('/settings/poll', 'PUT', { failThreshold: v.failThreshold, concurrency: v.concurrency });
      setSrv((s) => (s ? { ...s, last: r.last ?? s.last } : s));
    },
  });

  // the backend is older than the panel (or the poll settings are not available): the card is simply not shown
  if (gone) return null;
  if (!srv) return <div className="skeleton panel h-40" aria-busy="true" aria-label="Загрузка" />;
  const last = srv.last;

  return (
    <Section
      title="Опрос серверов"
      description="Как панель проверяет игровые серверы и когда считает, что сервер действительно недоступен. Изменения сохраняются сами."
      actions={<SaveBadge status={auto.status} error={auto.error} retry={auto.retry} />}
    >
      <div className="grid gap-4 min-[520px]:grid-cols-2">
        <div>
          <label htmlFor="poll-fail" className="label">Неудачных опросов подряд до сбоя</label>
          <select id="poll-fail" className="input" value={fail} onChange={(e) => setFail(e.target.value)} onBlur={auto.flush} aria-describedby="poll-fail-hint">
            {Array.from({ length: FAIL_MAX - FAIL_MIN + 1 }, (_, i) => FAIL_MIN + i).map((n) => (
              <option key={n} value={n}>{n}</option>
            ))}
          </select>
          <p id="poll-fail-hint" className="mt-1.5 text-sm font-semibold text-mute">
            Сбой подтверждается {confirmDelayText(Number(fail) || 1)}. Так одиночная потеря пакета не вызывает тревогу, но настоящее падение заметно позже.
          </p>
        </div>
        <div>
          <label htmlFor="poll-conc" className="label">Серверов опрашивается одновременно</label>
          <input
            id="poll-conc"
            className="input"
            type="number"
            inputMode="numeric"
            min={CONC_MIN}
            max={CONC_MAX}
            value={conc}
            onChange={(e) => setConc(e.target.value)}
            onBlur={auto.flush}
            aria-invalid={err && value.concurrency !== srv.concurrency ? true : undefined}
            aria-describedby="poll-conc-hint"
          />
          <p id="poll-conc-hint" className="mt-1.5 text-sm font-semibold text-mute">
            От {CONC_MIN} до {CONC_MAX}. Больше значение, быстрее обход, но выше нагрузка на панель и сеть.
          </p>
        </div>
      </div>
      <FieldError id="poll-err" text={err && (value.failThreshold !== srv.failThreshold || value.concurrency !== srv.concurrency) ? err : undefined} />

      <div className="rounded-ui-lg bg-soft px-4 py-3">
        <div className="text-sm font-extrabold text-mute">Последний обход</div>
        {last ? (
          <p className="mt-0.5 font-bold">
            {ago(last.at)}: {last.servers} {plural(last.servers, ['сервер', 'сервера', 'серверов'])} за {durationText(last.durationMs)}
            {' · '}{last.failures === 0 ? 'без ошибок' : <span className="text-warn">{last.failures} {plural(last.failures, ['ошибка', 'ошибки', 'ошибок'])}</span>}
            {' · '}по {last.concurrency} одновременно
          </p>
        ) : (
          <p className="mt-0.5 font-semibold text-mute">Обход ещё не выполнялся.</p>
        )}
      </div>
    </Section>
  );
}
