import { useState } from 'react';
import { LIMITS, totalLength, type Draft } from './model';
import { t, useI18n } from '../../i18n';

function Bar({ label, value, max, detail }: { label: string; value: number; max: number; detail?: string }) {
  useI18n();
  const r = max ? value / max : 0;
  const tone = r > 1 ? 'bad' : r >= 0.8 ? 'warn' : 'ok';
  const color = tone === 'bad' ? 'rgb(var(--bad))' : tone === 'warn' ? '#f0b232' : 'rgb(var(--brand))';
  return (
    <li className="space-y-1">
      <div className="flex items-baseline justify-between gap-2 text-sm">
        <span className="font-bold">{label}{detail && <span className="ml-1.5 text-xs font-semibold text-mute">{detail}</span>}</span>
        <span className={`text-xs font-extrabold tabular-nums ${tone === 'bad' ? 'text-bad' : tone === 'warn' ? 'text-warn' : 'text-mute'}`}>{value}/{max}{tone === 'bad' ? ` · ${t('d2.lim.over')}` : ''}</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-soft" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={max} aria-valuenow={Math.min(value, max)}>
        <div className="h-full rounded-full" style={{ width: `${Math.min(100, r * 100)}%`, background: color }} />
      </div>
    </li>
  );
}

/** One panel with every Discord limit that matters for the open embed and the whole message. */
export function LimitsPanel({ d, active }: { d: Draft; active: number }) {
  useI18n();
  const [open, setOpen] = useState(false);
  const e = d.embeds[active] ?? d.embeds[0];
  if (!e) return null;
  const worstName = e.fields.reduce((m, f) => Math.max(m, f.name.length), 0);
  const worstValue = e.fields.reduce((m, f) => Math.max(m, f.value.length), 0);
  const total = totalLength(d);
  // the worst share of any limit: the panel stays folded while everything is comfortably inside, opens itself near a limit
  const worst = Math.max(d.content.length / LIMITS.content, e.title.length / LIMITS.title, e.description.length / LIMITS.description, worstName / LIMITS.fieldName, worstValue / LIMITS.fieldValue, e.footer.length / LIMITS.footer, e.fields.length / LIMITS.fields, d.embeds.length / LIMITS.embeds, total / LIMITS.total);
  const shown = open || worst >= 0.8;
  return (
    <section className="panel space-y-3 p-4" aria-label={t('d2.lim.label')}>
      <div className="flex items-center gap-3">
        <h2 className="text-lg font-black">{t('d2.lim.title')}</h2>
        <span className={`pill ${worst > 1 ? 'pill-bad' : worst >= 0.8 ? 'pill-warn' : 'pill-ok'}`}>{worst > 1 ? t('d2.lim.exceeded') : worst >= 0.8 ? t('d2.lim.near') : t('d2.lim.ok')}</span>
        {worst < 0.8 && <button type="button" className="btn-link ml-auto text-sm" aria-expanded={open} onClick={() => setOpen((v) => !v)}>{open ? t('d2.ac.cm.hide') : t('d2.lim.more')}</button>}
      </div>
      {shown && <div>
        <p className="text-xs font-semibold text-mute">{d.embeds.length > 1 ? t('d2.lim.block', { n: active + 1 }) : t('d2.lim.hint')}</p>
      </div>}
      {shown && <ul className="space-y-2.5">
        <Bar label={t('d2.lim.content')} value={d.content.length} max={LIMITS.content} />
        <Bar label={t('d2.ws.newsTitle')} value={e.title.length} max={LIMITS.title} />
        <Bar label={t('d2.lim.desc')} value={e.description.length} max={LIMITS.description} />
        <Bar label={t('d2.lim.fieldName')} value={worstName} max={LIMITS.fieldName} detail={t('d2.lim.longest')} />
        <Bar label={t('d2.lim.fieldValue')} value={worstValue} max={LIMITS.fieldValue} detail={t('d2.lim.longest')} />
        <Bar label={t('d2.lim.footer')} value={e.footer.length} max={LIMITS.footer} />
        <Bar label={t('d2.lim.fields')} value={e.fields.length} max={LIMITS.fields} />
        <Bar label={t('d2.lim.embeds')} value={d.embeds.length} max={LIMITS.embeds} />
        <Bar label={t('d2.lim.total')} value={total} max={LIMITS.total} />
      </ul>}
    </section>
  );
}
