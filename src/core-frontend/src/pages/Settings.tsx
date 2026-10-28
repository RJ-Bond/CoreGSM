import BackupsCard from './Backups';
import ConfigTransfer from '../components/ConfigTransfer';
import SmtpCard from '../components/SmtpCard';
import PollSettingsCard from '../components/PollSettingsCard';
import type { ReactNode } from 'react';
import { AdminPage, GoLink, IconSettings, PageHead, Section } from '../ui';
import { SETTINGS_TABS } from './adminNav';
import { BotCard } from './settings/BotCard';
import { BrandCard } from './settings/BrandCard';
import CustomGamesCard from '../components/CustomGamesCard';
import { PasswordCard } from './settings/PasswordCard';
import { UpdateCard } from './settings/UpdateCard';
import { SaveBarProvider } from '../saveBar';
import { t, useI18n } from '../i18n';
export { BotPill } from './settings/BotCard';
export { UsersTab } from './settings/UsersTab';

// the ids stay the canonical hashes (/admin/settings/bot|brand|security|updates); only the labels are friendlier
const TABS = SETTINGS_TABS;

const tabHints = (): Record<string, { hint: string; help: ReactNode }> => ({
  bot: {
    hint: t('d2.set.bot.hint'),
    help: (
      <>
        <p>{t('d2.set.bot.h0')}</p>
        <ol>
          <li>{t('d2.set.bot.h1')}</li>
          <li>{t('d2.set.bot.h2')}</li>
          <li>{t('d2.set.bot.h3')}</li>
        </ol>
        <p>{t('d2.set.bot.h4')}</p>
      </>
    ),
  },
  brand: {
    hint: t('d2.set.brand.hint'),
    help: <p>{t('d2.set.brand.help')}</p>,
  },
  security: {
    hint: t('d2.set.sec.hint'),
    help: <p>{t('d2.set.sec.help')}</p>,
  },
  updates: {
    hint: t('d2.set.upd.hint'),
    help: <p>{t('d2.set.upd.help')}</p>,
  },
});

export default function SettingsPage({ sub, updateAvailable }: { sub: string; updateAvailable: boolean }) {
  useI18n();
  const tab = TABS.some((x) => x.id === sub) ? sub : 'bot';
  const TAB_HINT = tabHints();
  return (
    <AdminPage
      narrow
      head={<PageHead key={tab} icon={<IconSettings />} title={t('d2.set.title')} subtitle={t('d2.set.subtitle')} hint={TAB_HINT[tab].hint} help={TAB_HINT[tab].help} />}
    >
      <SaveBarProvider>
      <nav className="flex w-full max-w-2xl gap-1 overflow-x-auto rounded-full bg-soft p-1" aria-label={t('d2.set.sections')}>
        {TABS.map((tb) => (
          <a
            key={tb.id}
            href={`/admin/settings/${tb.id}`}
            aria-current={tab === tb.id ? 'page' : undefined}
            className={`flex-1 whitespace-nowrap rounded-full px-4 py-1.5 text-center font-extrabold transition ${tab === tb.id ? 'bg-brand text-white shadow-1' : 'text-mute hover:text-ink'}`}
          >
            {tb.label}
            {tb.id === 'updates' && updateAvailable && <span className="update-dot ml-1.5 align-middle" title={t('d2.set.updAvail')} />}
          </a>
        ))}
      </nav>
      {tab === 'bot' && <><BotCard /><PollSettingsCard /><CustomGamesCard /></>}
      {tab === 'brand' && <BrandCard />}
      {tab === 'security' && (
        <>
          <PasswordCard />
          <SmtpCard />
          <Section title={t('d2.set.access')}>
            <p className="font-semibold text-mute">{t('d2.set.access1')}</p>
            <p className="font-semibold text-mute">{t('d2.set.access2')}</p>
            <div className="flex flex-wrap gap-x-5 gap-y-1">
              <GoLink href="/admin/users">{t('d2.set.usersLink')}</GoLink>
              <GoLink href="/profile">{t('d2.set.sessionsLink')}</GoLink>
            </div>
          </Section>
          <p className="font-semibold text-mute">
            {t('d2.set.domain1')} <span className="font-mono text-sm text-ink">/app/.env</span>{t('d2.set.domain2')} <span className="font-mono text-sm text-ink">sudo coregsm</span> {t('d2.set.domain3')}
          </p>
        </>
      )}
      {tab === 'updates' && (
        <>
          <UpdateCard />
          <BackupsCard />
          <ConfigTransfer />
        </>
      )}
      </SaveBarProvider>
    </AdminPage>
  );
}
