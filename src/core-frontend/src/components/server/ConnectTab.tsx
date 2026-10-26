import { useEffect, useId, useRef, useState } from 'react';
import { applyConnectTemplates, connectGuide } from '../../connectGuides';
import { useGameProfiles } from '../../gameProfiles';
import { t, useI18n } from '../../i18n';
import { IconCheckMark, IconCopy, Notice, toast } from '../../ui';
import { SectionCard, type SectionState } from './Sections';
import QrCode from './QrCode';
import { stagger } from './helpers';

/** a big value with a big «Копировать» button */
function BigCopy({ label, value, id }: { label: string; value: string; id: string }) {
  const [done, setDone] = useState(false);
  const timer = useRef(0);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setDone(true);
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setDone(false), 1600);
    } catch {
      toast(value, 'info', 8000);
    }
  };
  return (
    <div className="min-w-0">
      <div id={id} className="mb-1 text-fs-sm font-extrabold text-mute">{label}</div>
      <div className="cn-big">
        <code title={value} aria-labelledby={id}>{value}</code>
        <button type="button" className="btn btn-lg" onClick={() => void copy()} aria-describedby={id}>
          {done ? <IconCheckMark /> : <IconCopy />}
          <span aria-live="polite">{done ? t('srv.cn.copied') : t('srv.cn.copy')}</span>
        </button>
      </div>
    </div>
  );
}

/** «Как подключиться»: three numbered steps (copy, open the game, connect) and a QR code for a phone */
export default function ConnectTab({ game, address, sections }: { game: string; address: string; sections: SectionState }) {
  useI18n();
  const uid = useId();
  const profile = useGameProfiles()?.[game];
  const guide = applyConnectTemplates(connectGuide(game, address), profile?.connect, address, profile?.defaultPort);
  const note = typeof profile?.connect?.note === 'string' ? profile.connect.note.trim() : '';
  const addr = guide.copy.find((c) => c.label === 'Адрес') ?? { label: 'Адрес', value: address.trim() };
  const command = guide.copy.find((c) => /команд/i.test(c.label));
  const steam = guide.link && guide.link.href.startsWith('steam://') ? guide.link : null;
  const parts = guide.copy.filter((c) => c.label === 'Хост' || c.label === 'Порт');
  const qrOptions = [
    ...(guide.link ? [{ k: 'link', label: t('srv.cn.qrLink'), value: guide.link.href }] : []),
    { k: 'addr', label: t('srv.cn.qrAddr'), value: address.trim() },
  ];
  const [qk, setQk] = useState(qrOptions[0].k);
  const qr = qrOptions.find((o) => o.k === qk) ?? qrOptions[0];

  return (
    <div className="grid gap-3.5 lg:grid-cols-12">
      <SectionCard id="cn-steps" state={sections} className="lg:col-span-7" style={stagger(0)} title={guide.title}>
        {note && <div className="mb-4"><Notice tone="info">{note}</Notice></div>}

        <ol className="cn-wizard">
          <li className="cn-step cn-step-big">
            <span className="cn-num" aria-hidden>1</span>
            <div className="min-w-0 flex-1 space-y-3">
              <h3 className="cn-h">{t('srv.cn.s1')}</h3>
              <BigCopy id={`${uid}-a`} label={addr.label} value={addr.value} />
              {command && <BigCopy id={`${uid}-c`} label={command.label} value={command.value} />}
              {steam && <BigCopy id={`${uid}-s`} label={t('srv.cn.steamLink')} value={steam.href} />}
              {parts.length > 0 && (
                <p className="text-sm font-semibold text-mute">
                  {t('srv.cn.parts')}{' '}
                  {parts.map((p) => (
                    <button key={p.label} type="button" className="cn-part" onClick={() => void navigator.clipboard?.writeText(p.value).then(() => toast(t('srv.cn.copied')), () => toast(p.value, 'info', 6000))}>
                      {p.label}: <code>{p.value}</code>
                    </button>
                  ))}
                </p>
              )}
            </div>
          </li>
          <li className="cn-step cn-step-big">
            <span className="cn-num" aria-hidden>2</span>
            <div className="min-w-0 flex-1 space-y-2">
              <h3 className="cn-h">{t('srv.cn.s2')}</h3>
              <ul className="cn-sub">
                {guide.steps.map((s, i) => <li key={i}>{s}</li>)}
              </ul>
            </div>
          </li>
          <li className="cn-step cn-step-big">
            <span className="cn-num" aria-hidden>3</span>
            <div className="min-w-0 flex-1 space-y-3">
              <h3 className="cn-h">{t('srv.cn.s3')}</h3>
              {guide.link ? (
                <a href={guide.link.href} className="btn btn-lg btn-block sm:w-auto" data-magnetic>{guide.link.label}</a>
              ) : (
                <p className="font-semibold leading-snug text-mute">{t('srv.cn.s3text')}</p>
              )}
            </div>
          </li>
        </ol>
      </SectionCard>

      <SectionCard id="cn-qr" state={sections} className="lg:col-span-5" style={stagger(1)} title={t('srv.cn.qrTitle')}>
        <p className="mb-3 text-sm font-semibold text-mute">
          {qr.k === 'link' ? t('srv.cn.qrHintLink') : t('srv.cn.qrHintAddr')}
        </p>
        {qrOptions.length > 1 && (
          <div className="seg mb-3" role="group" aria-label={t('srv.cn.qrWhat')}>
            {qrOptions.map((o) => (
              <button key={o.k} type="button" className="seg-item" aria-pressed={qk === o.k} onClick={() => setQk(o.k)}>{o.label}</button>
            ))}
          </div>
        )}
        <QrCode text={qr.value} label={`QR: ${qr.value}`} />
        <p className="mt-3 break-all text-center font-mono text-xs font-semibold text-mute">{qr.value}</p>
      </SectionCard>
    </div>
  );
}
