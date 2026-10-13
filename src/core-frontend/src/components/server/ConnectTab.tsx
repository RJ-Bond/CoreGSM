import { useState } from 'react';
import { applyConnectTemplates, connectGuide } from '../../connectGuides';
import { useGameProfiles } from '../../gameProfiles';
import { CopyButton, Notice } from '../../ui';
import { SectionCard, type SectionState } from './Sections';
import QrCode from './QrCode';
import { stagger } from './helpers';

/** «Как подключиться»: what to paste (big copy buttons), numbered steps, QR code for a phone */
export default function ConnectTab({ game, address, sections }: { game: string; address: string; sections: SectionState }) {
  const profile = useGameProfiles()?.[game];
  const guide = applyConnectTemplates(connectGuide(game, address), profile?.connect, address, profile?.defaultPort);
  const note = typeof profile?.connect?.note === 'string' ? profile.connect.note.trim() : '';
  // values to paste: address first, the console command and the steam link where they exist
  const values = [
    ...guide.copy.filter((c) => c.label === 'Адрес' || /команд/i.test(c.label)),
    ...(guide.link && guide.link.href.startsWith('steam://') ? [{ label: 'Ссылка Steam', value: guide.link.href }] : []),
    ...guide.copy.filter((c) => c.label === 'Хост' || c.label === 'Порт'),
  ];
  const qrOptions = [
    ...(guide.link ? [{ k: 'link', label: 'Ссылка', value: guide.link.href }] : []),
    { k: 'addr', label: 'Адрес', value: address.trim() },
  ];
  const [qk, setQk] = useState(qrOptions[0].k);
  const qr = qrOptions.find((o) => o.k === qk) ?? qrOptions[0];

  return (
    <div className="grid gap-3.5 lg:grid-cols-12">
      <SectionCard id="cn-steps" state={sections} className="lg:col-span-7" style={stagger(0)} title={guide.title}>

        {note && <div className="mb-4"><Notice tone="info">{note}</Notice></div>}

        <h3 className="mb-2 text-[13px] font-extrabold uppercase tracking-wide text-mute">Что вставить</h3>
        <ul className="mb-5 space-y-2.5">
          {values.map((c) => (
            <li key={c.label} className="min-w-0">
              <div className="mb-1 text-[13px] font-extrabold text-mute">{c.label}</div>
              <div className="cn-big">
                <code title={c.value}>{c.value}</code>
                <CopyButton text={c.value} label="Копировать" />
              </div>
            </li>
          ))}
        </ul>

        <h3 className="mb-2 text-[13px] font-extrabold uppercase tracking-wide text-mute">Шаги</h3>
        <ol className="space-y-3.5">
          {guide.steps.map((s, i) => (
            <li key={i} className="cn-step">
              <span className="cn-num" aria-hidden>{i + 1}</span>
              <p className="min-w-0 break-words pt-1 font-semibold leading-snug"><span className="sr-only">Шаг {i + 1}. </span>{s}</p>
            </li>
          ))}
        </ol>
        {guide.link && (
          <a href={guide.link.href} className="btn mt-5 w-full sm:w-auto" data-magnetic>{guide.link.label}</a>
        )}
      </SectionCard>

      <SectionCard id="cn-qr" state={sections} className="lg:col-span-5" style={stagger(1)} title="QR-код для телефона">
        <p className="mb-3 text-sm font-semibold text-mute">
          Наведите камеру: {qr.k === 'link' ? 'ссылка откроется в Steam' : 'адрес сервера окажется в телефоне, останется вставить его в игру'}.
        </p>
        {qrOptions.length > 1 && (
          <div className="seg mb-3" role="group" aria-label="Что зашифровать в QR-коде">
            {qrOptions.map((o) => (
              <button key={o.k} type="button" className="seg-item" aria-pressed={qk === o.k} onClick={() => setQk(o.k)}>{o.label}</button>
            ))}
          </div>
        )}
        <QrCode text={qr.value} label={`QR-код: ${qr.value}`} />
        <p className="mt-3 break-all text-center font-mono text-xs font-semibold text-mute">{qr.value}</p>
      </SectionCard>
    </div>
  );
}
