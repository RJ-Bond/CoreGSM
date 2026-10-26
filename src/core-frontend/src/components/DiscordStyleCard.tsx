import { useEffect, useState } from 'react';
import { api } from '../api';
import { t, useI18n } from '../i18n';
import { EmbedView, type DiscordEmbed } from '../pages/EmbedPreview';
import { Section, Switch, fail, toast } from '../ui';

interface Style { accent: string; logo: boolean; footer: string; brandAccent: string }
interface Sample { id: string; group: 'servers' | 'alerts' | 'community' | 'updates'; title: string; content?: string; embed: DiscordEmbed; buttons?: string[] }

const GROUPS = ['servers', 'alerts', 'community', 'updates'] as const;

/** «Вид сообщений бота»: one accent, signature and logo for everything the bot posts, and a gallery of every kind of message. */
export default function DiscordStyleCard() {
  useI18n();
  const [s, setS] = useState<Style | null>(null);
  const [footer, setFooter] = useState('');
  const [items, setItems] = useState<Sample[] | null>(null);
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');
  const [width, setWidth] = useState<'desktop' | 'phone'>('desktop');
  const [group, setGroup] = useState<(typeof GROUPS)[number]>('servers');
  const [busy, setBusy] = useState(false);

  const loadGallery = () => api<{ items: Sample[] }>('/admin/discord-gallery').then((r) => setItems(r.items)).catch(() => setItems([]));
  useEffect(() => {
    let alive = true;
    api<Style>('/settings/discord-style').then((r) => { if (alive) { setS(r); setFooter(r.footer); } }).catch(() => undefined);
    void loadGallery();
    return () => { alive = false; };
  }, []);
  if (!s) return null;

  const save = async (patch: Partial<Pick<Style, 'accent' | 'logo' | 'footer'>>) => {
    setBusy(true);
    try {
      const r = await api<Style>('/settings/discord-style', 'PUT', patch);
      setS(r);
      setFooter(r.footer);
      toast(t('ds.saved'));
      await loadGallery();
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };

  const shown = (items ?? []).filter((x) => x.group === group);
  return (
    <Section title={t('ds.title')} description={t('ds.help')}>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="ds-accent" className="label">{t('ds.accent')}</label>
          <div className="flex items-center gap-2">
            <input id="ds-accent" type="color" aria-label={t('ds.accent')} className="h-10 w-14 rounded-ui-lg border border-line bg-transparent" value={s.accent || s.brandAccent} disabled={busy} onChange={(e) => void save({ accent: e.target.value })} />
            {s.accent && <button type="button" className="btn-link" onClick={() => void save({ accent: '' })}>{t('ds.accentBrand')}</button>}
          </div>
          <p className="mt-1 text-sm font-semibold text-mute">{s.accent ? t('ds.accentOwn') : t('ds.accentFromBrand')}</p>
        </div>
        <div>
          <label htmlFor="ds-footer" className="label">{t('ds.footer')}</label>
          <input id="ds-footer" className="input" value={footer} maxLength={40} placeholder={t('ds.footerHolder')} onChange={(e) => setFooter(e.target.value)} onBlur={() => { if (footer.trim() !== s.footer) void save({ footer }); }} />
        </div>
      </div>
      <label className="mt-3 flex items-center gap-3 font-bold">
        <Switch id="ds-logo" checked={s.logo} onChange={(on) => void save({ logo: on })} /> {t('ds.logo')}
      </label>

      <h3 className="mb-2 mt-5 text-base font-black">{t('ds.gallery')}</h3>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <nav className="seg" aria-label={t('ds.gallery')}>
          {GROUPS.map((g) => <button key={g} type="button" className="seg-item" aria-current={group === g ? 'page' : undefined} onClick={() => setGroup(g)}>{t(`ds.g.${g}` as never)}</button>)}
        </nav>
        <button type="button" className="btn-link" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>{theme === 'dark' ? t('ds.light') : t('ds.dark')}</button>
        <button type="button" className="btn-link" onClick={() => setWidth(width === 'desktop' ? 'phone' : 'desktop')}>{width === 'desktop' ? t('ds.phone') : t('ds.desktop')}</button>
      </div>
      {items === null && <div className="skeleton h-40 rounded-2xl bg-soft" aria-hidden />}
      <div className="space-y-5">
        {shown.map((x) => (
          <figure key={x.id}>
            <figcaption className="mb-1 text-sm font-extrabold text-mute">{x.title}</figcaption>
            <EmbedView embed={Object.keys(x.embed).length ? x.embed : null} content={x.content} theme={theme} width={width}>
              {x.buttons && x.buttons.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-2" aria-hidden>
                  {x.buttons.map((b, i) => <span key={i} className="rounded-md bg-soft px-3 py-1 text-sm font-bold">{b}</span>)}
                </div>
              )}
            </EmbedView>
          </figure>
        ))}
      </div>
    </Section>
  );
}
