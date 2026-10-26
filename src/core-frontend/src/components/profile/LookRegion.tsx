import { useMemo, useState, type CSSProperties } from 'react';
import { ACCENT_MODES, useAccentMode, type AccentMode } from '../../accent';
import { useAppearance, type Appearance } from '../../appearance';
import { gameColor } from '../../games';
import { type Prefs, type TKey, t, updatePrefs, useI18n } from '../../i18n';
import { fmtDateTime, Section, Switch, toast, useDensity, type Density } from '../../ui';

const ACCENT_TEXT: Record<AccentMode, { label: TKey; hint: TKey }> = {
  auto: { label: 'pf.accent.auto', hint: 'pf.accent.autoHint' },
  vrising: { label: 'pf.accent.vrising', hint: 'pf.accent.vrisingHint' },
  icarus: { label: 'pf.accent.icarus', hint: 'pf.accent.icarusHint' },
  brand: { label: 'pf.accent.brand', hint: 'pf.accent.brandHint' },
};
const swatch: Record<string, string | undefined> = { vrising: gameColor('vrising'), icarus: gameColor('icarus') };

/** «Оформление»: panel density and the game accent (both kept in this browser only) */
export function AppearanceCard() {
  useI18n();
  const [density, setDensity] = useDensity();
  const [mode, setMode] = useAccentMode();
  const [look, setLook] = useAppearance();
  const a11y: [keyof Appearance, TKey, TKey][] = [
    ['reduceMotion', 'pf.a11y.motion', 'pf.a11y.motionHint'],
    ['largeText', 'pf.a11y.text', 'pf.a11y.textHint'],
    ['highContrast', 'pf.a11y.contrast', 'pf.a11y.contrastHint'],
    ['liteData', 'pf.a11y.lite', 'pf.a11y.liteHint'],
  ];
  const options: [Density, TKey, TKey][] = [
    ['normal', 'pf.density.normal', 'pf.density.normalHint'],
    ['compact', 'pf.density.compact', 'pf.density.compactHint'],
  ];
  return (
    <Section title={t('pf.look.title')}>
      <div>
        <span id="density-label" className="label">{t('pf.density.label')}</span>
        <div className="seg" role="group" aria-labelledby="density-label">
          {options.map(([id, label]) => (
            <button key={id} type="button" className="seg-item" aria-pressed={density === id} onClick={() => setDensity(id)}>{t(label)}</button>
          ))}
        </div>
        <p className="mt-2 text-sm font-semibold text-mute">{t(options.find((o) => o[0] === density)?.[2] ?? 'pf.density.normalHint')} {t('pf.thisBrowser')}</p>
      </div>
      <div>
        <span id="accent-label" className="label">{t('pf.accent.label')}</span>
        <div className="seg flex-wrap" role="group" aria-labelledby="accent-label">
          {ACCENT_MODES.map((o) => (
            <button key={o.id} type="button" className="seg-item" aria-pressed={mode === o.id} onClick={() => setMode(o.id)}>
              {swatch[o.id] && <span className="accent-dot" style={{ '--sw': swatch[o.id] } as CSSProperties} aria-hidden />}
              {t(ACCENT_TEXT[o.id].label)}
            </button>
          ))}
        </div>
        <p className="mt-2 text-sm font-semibold text-mute">{t(ACCENT_TEXT[mode].hint)} {t('pf.thisBrowser')}</p>
      </div>
      <div role="group" aria-labelledby="a11y-label">
        <span id="a11y-label" className="label">{t('pf.a11y.label')}</span>
        <ul className="space-y-1">
          {a11y.map(([key, label, hint]) => (
            <li key={key}>
              <label className="flex cursor-pointer items-start gap-3 rounded-ui-lg px-1 py-1.5 max-sm:min-h-[44px]">
                <Switch className="mt-0.5" checked={look[key]} onChange={(on) => setLook({ [key]: on })} />
                <span className="min-w-0">
                  <span className="block font-extrabold">{t(label)}</span>
                  <span className="block text-sm font-semibold text-mute">{t(hint)}</span>
                </span>
              </label>
            </li>
          ))}
        </ul>
        <p className="mt-1 text-sm font-semibold text-mute">{t('pf.thisBrowser')}</p>
      </div>
    </Section>
  );
}

const FALLBACK_ZONES = [
  'UTC', 'Europe/Kaliningrad', 'Europe/Moscow', 'Europe/Samara', 'Asia/Yekaterinburg', 'Asia/Omsk', 'Asia/Krasnoyarsk', 'Asia/Irkutsk',
  'Asia/Yakutsk', 'Asia/Vladivostok', 'Asia/Magadan', 'Asia/Kamchatka', 'Europe/Kyiv', 'Europe/Minsk', 'Europe/London', 'Europe/Berlin',
  'Europe/Paris', 'Asia/Almaty', 'Asia/Tbilisi', 'Asia/Dubai', 'Asia/Tokyo', 'America/New_York', 'America/Chicago', 'America/Los_Angeles',
];

function zoneList(): string[] {
  try {
    const f = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf;
    const z = f?.('timeZone');
    if (z && z.length > 0) return z.includes('UTC') ? z : ['UTC', ...z];
  } catch { /* old browser */ }
  return FALLBACK_ZONES;
}

const systemZone = () => {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch { return ''; }
};

/** «Язык и регион»: language, time zone, 24/12 h and date order; applies at once, everywhere, and is saved to the account */
export function RegionCard() {
  const { prefs } = useI18n();
  const [busy, setBusy] = useState(false);
  const zones = useMemo(zoneList, []);
  const sys = systemZone();
  const zoneOptions = prefs.timezone && !zones.includes(prefs.timezone) ? [prefs.timezone, ...zones] : zones;

  const change = async (patch: Partial<Prefs>) => {
    setBusy(true);
    try {
      await updatePrefs(patch);
      toast(t('pf.region.saved'));
    } catch (e) {
      // the choice already works in this browser; only the account copy was not saved
      toast(`${t('pf.region.notSynced')} ${(e as Error).message}`, 'err');
    } finally {
      setBusy(false);
    }
  };

  const seg = <V extends string>(id: string, label: TKey, value: V, items: [V, string][], key: keyof Prefs) => (
    <div>
      <span id={id} className="label">{t(label)}</span>
      <div className="seg flex-wrap" role="group" aria-labelledby={id}>
        {items.map(([v, text]) => (
          <button key={v} type="button" className="seg-item" aria-pressed={value === v} disabled={busy} onClick={() => void change({ [key]: v } as Partial<Prefs>)}>{text}</button>
        ))}
      </div>
    </div>
  );

  return (
    <Section title={t('pf.region.title')} description={t('pf.region.desc')}>
      {seg('lang-label', 'pf.region.lang', prefs.lang, [['ru', 'Русский'], ['en', 'English']], 'lang')}

      <div>
        <label htmlFor="tz-select" className="label">{t('pf.region.tz')}</label>
        <select id="tz-select" className="input" value={prefs.timezone} disabled={busy} onChange={(e) => void change({ timezone: e.target.value })}>
          <option value="">{t('pf.region.tzSystem')}{sys ? ` (${sys})` : ''}</option>
          {zoneOptions.map((z) => <option key={z} value={z}>{z.replace(/_/g, ' ')}</option>)}
        </select>
      </div>

      {seg('tf-label', 'pf.region.timeFormat', prefs.timeFormat, [['24', t('pf.region.tf24')], ['12', t('pf.region.tf12')]], 'timeFormat')}
      {seg('df-label', 'pf.region.dateFormat', prefs.dateFormat, [['dmy', t('pf.region.dmy')], ['mdy', t('pf.region.mdy')], ['iso', t('pf.region.iso')]], 'dateFormat')}

      <p className="rounded-2xl bg-soft px-4 py-3 font-bold" aria-live="polite">
        <span className="text-mute">{t('pf.region.example')} </span>
        {fmtDateTime(Date.now())}
      </p>
    </Section>
  );
}
