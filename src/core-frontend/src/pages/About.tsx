import { t, useI18n } from '../i18n';
import { IconBell, IconChat, IconDisk, IconPlug, IconPeople, IconSend, IconSignal } from '../components/GameNewsIcons';
import { IconBan, IconTrend } from '../icons';
import { PageHead, IconServers } from '../ui';
import type { ComponentType } from 'react';
import type { IconProps } from '../icons';

const FEATURES: { id: string; icon: ComponentType<IconProps>; href?: string }[] = [
  { id: 'servers', icon: IconSignal, href: '/servers' },
  { id: 'status', icon: IconTrend, href: '/status' },
  { id: 'news', icon: IconSend, href: '/news' },
  { id: 'bot', icon: IconChat },
  { id: 'plugin', icon: IconPlug },
  { id: 'bans', icon: IconBan, href: '/bans' },
  { id: 'community', icon: IconPeople, href: '/community' },
  { id: 'alerts', icon: IconBell },
  { id: 'backup', icon: IconDisk },
];

/** «О проекте»: what the panel does, in a few lines for a visitor who has just arrived (public, no sign-in needed) */
export default function AboutPage({ brand }: { brand: string }) {
  useI18n();
  return (
    <div className="space-y-6">
      <PageHead icon={<IconServers />} title={t('about.title', { brand })} subtitle={t('about.sub')} />
      <section className="panel p-5 sm:p-6">
        <p className="max-w-3xl text-lg font-semibold leading-relaxed">{t('about.lead', { brand })}</p>
      </section>

      <section aria-label={t('about.what')}>
        <h2 className="t-section mb-3">{t('about.what')}</h2>
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {FEATURES.map((f) => {
            const body = (
              <>
                <span aria-hidden className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-soft text-link"><f.icon size={22} /></span>
                <span className="min-w-0">
                  <span className="t-card block">{t(`about.f.${f.id}` as 'about.f.servers')}</span>
                  <span className="t-caption block">{t(`about.f.${f.id}Text` as 'about.f.serversText')}</span>
                </span>
              </>
            );
            return (
              <li key={f.id}>
                {f.href
                  ? <a href={f.href} className="panel m-hover flex h-full items-start gap-3.5 p-4 hover:shadow-pop">{body}</a>
                  : <div className="panel flex h-full items-start gap-3.5 p-4">{body}</div>}
              </li>
            );
          })}
        </ul>
      </section>

      <section aria-label={t('about.how')} className="panel p-5 sm:p-6">
        <h2 className="t-section mb-3">{t('about.how')}</h2>
        <ol className="grid gap-4 md:grid-cols-3">
          {[1, 2, 3].map((n) => (
            <li key={n} className="flex items-start gap-3">
              <span aria-hidden className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-brand text-sm font-black text-white">{n}</span>
              <span className="min-w-0">
                <span className="t-card block">{t(`about.s${n}` as 'about.s1')}</span>
                <span className="t-caption block">{t(`about.s${n}Text` as 'about.s1Text')}</span>
              </span>
            </li>
          ))}
        </ol>
      </section>

      <p className="t-caption">
        {t('about.api')} <a className="text-link underline" href="/api/v1/openapi.json" target="_blank" rel="noopener noreferrer">/api/v1/openapi.json</a>
      </p>
    </div>
  );
}
