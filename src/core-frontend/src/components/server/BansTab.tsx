import { t, useI18n } from '../../i18n';
import { BansView } from '../../pages/Bans';

/** the tab «Баны» of a server: the bans that hold on it (and the history of this server) */
export default function BansTab({ serverId }: { serverId: number }) {
  useI18n();
  return (
    <section className="tile tile-in p-4 sm:p-5">
      <h2 className="mb-3 text-base font-extrabold">{t('d2.sd.bans')}</h2>
      <BansView serverId={serverId} />
    </section>
  );
}
