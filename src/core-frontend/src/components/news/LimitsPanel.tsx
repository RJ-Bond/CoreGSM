import { LIMITS, totalLength, type Draft } from './model';

function Bar({ label, value, max, detail }: { label: string; value: number; max: number; detail?: string }) {
  const r = max ? value / max : 0;
  const tone = r > 1 ? 'bad' : r >= 0.8 ? 'warn' : 'ok';
  const color = tone === 'bad' ? 'rgb(var(--bad))' : tone === 'warn' ? '#f0b232' : 'rgb(var(--brand))';
  return (
    <li className="space-y-1">
      <div className="flex items-baseline justify-between gap-2 text-sm">
        <span className="font-bold">{label}{detail && <span className="ml-1.5 text-xs font-semibold text-mute">{detail}</span>}</span>
        <span className={`text-xs font-extrabold tabular-nums ${tone === 'bad' ? 'text-bad' : tone === 'warn' ? 'text-warn' : 'text-mute'}`}>{value}/{max}{tone === 'bad' ? ' · превышено' : ''}</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-soft" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={max} aria-valuenow={Math.min(value, max)}>
        <div className="h-full rounded-full" style={{ width: `${Math.min(100, r * 100)}%`, background: color }} />
      </div>
    </li>
  );
}

/** One panel with every Discord limit that matters for the open embed and the whole message. */
export function LimitsPanel({ d, active }: { d: Draft; active: number }) {
  const e = d.embeds[active] ?? d.embeds[0];
  if (!e) return null;
  const worstName = e.fields.reduce((m, f) => Math.max(m, f.name.length), 0);
  const worstValue = e.fields.reduce((m, f) => Math.max(m, f.value.length), 0);
  const total = totalLength(d);
  return (
    <section className="panel space-y-3 p-4" aria-label="Лимиты Discord">
      <div>
        <h2 className="text-lg font-black">Лимиты</h2>
        <p className="text-xs font-semibold text-mute">{d.embeds.length > 1 ? `Показаны значения для блока ${active + 1}; сумма: по всему сообщению.` : 'Ограничения Discord для этого сообщения.'}</p>
      </div>
      <ul className="space-y-2.5">
        <Bar label="Текст сообщения" value={d.content.length} max={LIMITS.content} />
        <Bar label="Заголовок" value={e.title.length} max={LIMITS.title} />
        <Bar label="Основной текст" value={e.description.length} max={LIMITS.description} />
        <Bar label="Название поля" value={worstName} max={LIMITS.fieldName} detail="самое длинное" />
        <Bar label="Значение поля" value={worstValue} max={LIMITS.fieldValue} detail="самое длинное" />
        <Bar label="Подпись" value={e.footer.length} max={LIMITS.footer} />
        <Bar label="Полей" value={e.fields.length} max={LIMITS.fields} />
        <Bar label="Embed-блоков" value={d.embeds.length} max={LIMITS.embeds} />
        <Bar label="Всего символов во всех embed" value={total} max={LIMITS.total} />
      </ul>
    </section>
  );
}
