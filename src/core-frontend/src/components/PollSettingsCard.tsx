import { useEffect, useState } from 'react';
import { api } from '../api';
import { t } from '../i18n';
import { CONC_MAX, CONC_MIN, FAIL_MAX, FAIL_MIN, WINDOW_MAX, confirmDelayText, durationText, ruleText, validatePoll, type PollSettings } from '../pollSettings';
import { FieldError, SaveBadge, Section, Switch, ago, plural, useAutosave } from '../ui';
import { useSaveBar, useSaveBarActive } from '../saveBar';

/** «Опрос серверов»: when a failure is confirmed, how many servers are asked at once, and the numbers of the last poll. */
export default function PollSettingsCard() {
  const [srv, setSrv] = useState<PollSettings | null>(null);
  const [gone, setGone] = useState(false);
  const [fail, setFail] = useState('3');
  const [conc, setConc] = useState('8');
  const [failN, setFailN] = useState('');
  const [failM, setFailM] = useState('');
  const [veto, setVeto] = useState(false);

  useEffect(() => {
    let alive = true;
    api<PollSettings>('/settings/poll')
      .then((r) => {
        if (!alive) return;
        setSrv(r);
        setFail(String(r.failThreshold));
        setConc(String(r.concurrency));
        setFailN(r.failN ? String(r.failN) : '');
        setFailM(r.failM ? String(r.failM) : '');
        setVeto(!!r.probeVeto);
      })
      .catch(() => { if (alive) setGone(true); });
    return () => { alive = false; };
  }, []);

  const value = {
    failThreshold: Number(fail),
    concurrency: Number(conc),
    failN: failN.trim() === '' ? null : Number(failN),
    failM: failM.trim() === '' ? null : Number(failM),
    probeVeto: veto,
  };
  const savedOf = (r: PollSettings) => ({ failThreshold: r.failThreshold, concurrency: r.concurrency, failN: r.failN ?? null, failM: r.failM ?? null, probeVeto: !!r.probeVeto });
  const err = validatePoll(value);
  const bar = useSaveBarActive();
  const auto = useAutosave({
    manual: bar,
    value,
    saved: srv ? savedOf(srv) : value,
    enabled: !!srv,
    delay: 700,
    validate: (v) => validatePoll(v),
    save: async (v) => {
      const r = await api<PollSettings>('/settings/poll', 'PUT', { failThreshold: v.failThreshold, concurrency: v.concurrency, failN: v.failN, failM: v.failM, probeVeto: v.probeVeto });
      setSrv((s) => (s ? { ...s, ...savedOf(r), last: r.last ?? s.last } : s));
    },
  });

  useSaveBar('poll', 'опрос серверов', auto.status, auto.saveNow, () => { if (srv) { setFail(String(srv.failThreshold)); setConc(String(srv.concurrency)); setFailN(srv.failN ? String(srv.failN) : ''); setFailM(srv.failM ? String(srv.failM) : ''); setVeto(!!srv.probeVeto); } });

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
      <div>
        <div className="label">{t('poll.rule.title')}</div>
        <div className="flex flex-wrap items-center gap-2 font-bold">
          <label htmlFor="poll-n" className="sr-only">{t('poll.rule.nAria')}</label>
          <input id="poll-n" className="input w-24" type="number" inputMode="numeric" min={1} max={WINDOW_MAX} placeholder="N" value={failN} onChange={(e) => setFailN(e.target.value)} onBlur={auto.flush} aria-describedby="poll-rule-hint" />
          <span>{t('poll.rule.of')}</span>
          <label htmlFor="poll-m" className="sr-only">{t('poll.rule.mAria')}</label>
          <input id="poll-m" className="input w-24" type="number" inputMode="numeric" min={1} max={WINDOW_MAX} placeholder="M" value={failM} onChange={(e) => setFailM(e.target.value)} onBlur={auto.flush} aria-describedby="poll-rule-hint" />
          <span className="text-mute">{t('poll.rule.last')}</span>
        </div>
        <p id="poll-rule-hint" className="mt-1.5 text-sm font-semibold text-mute">
          {t('poll.rule.hint', { rule: ruleText(value.failN, value.failM, value.failThreshold || 1) })}
        </p>
        <label className="mt-3 flex items-start gap-3 font-bold">
          <Switch checked={veto} onChange={setVeto} className="mt-0.5" />
          <span>
            {t('poll.rule.veto')}
            <span className="block text-sm font-semibold text-mute">{t('poll.rule.vetoText')}</span>
          </span>
        </label>
      </div>
      <FieldError id="poll-err" text={err && (value.failThreshold !== srv.failThreshold || value.concurrency !== srv.concurrency || value.failN !== (srv.failN ?? null) || value.failM !== (srv.failM ?? null)) ? err : undefined} />

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
