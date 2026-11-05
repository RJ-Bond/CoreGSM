import { IconArrow } from '../ui';
import { t, useI18n } from '../i18n';
import { NotFoundArt } from './Illustrations';
import { StateView } from './StateView';

/** Unknown route or unknown server id. `kind` only changes the wording; both buttons are always there. */
export default function NotFound({ kind = 'page' }: { kind?: 'page' | 'server' }) {
  useI18n();
  return (
    <StateView
      kind="notfound"
      heading="h1"
      className="mx-auto max-w-xl gap-3! sm:py-14!"
      art={(
        <>
          <NotFoundArt />
          <p className="nf-code text-6xl font-black leading-none tracking-tighter sm:text-7xl" aria-hidden>404</p>
        </>
      )}
      title={kind === 'server' ? t('d2.nf.server') : t('d2.nf.page')}
      text={kind === 'server'
        ? t('d2.nf.serverText')
        : t('d2.nf.pageText')}
    >
      <a className="btn" href="/" data-magnetic>
        {t('d2.nf.home')}
        <IconArrow />
      </a>
      <a className="btn btn-soft" href="/servers">{t('d2.nf.toServers')}</a>
      <button type="button" className="btn btn-soft" onClick={() => window.dispatchEvent(new Event('coregsm:palette'))}>{t('d2.nf.search')}</button>
      <nav className="nf-links" aria-label={t('d2.nf.also')}>
        <span>{t('d2.nf.also')}</span>
        <a href="/news">{t('nav.news')}</a>
        <a href="/status">{t('nav.status')}</a>
        <a href="/community">{t('nav.community')}</a>
      </nav>
    </StateView>
  );
}
