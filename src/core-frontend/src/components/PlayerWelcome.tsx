import { useState } from 'react';
import { useAuth } from '../auth';
import { t, useI18n } from '../i18n';

const keyOf = (name: string) => `coregsm_welcome_${name}`;
const seen = (name: string): boolean => { try { return localStorage.getItem(keyOf(name)) === '1'; } catch { return true; } };

/** the first sign-in of a player: three things the panel can do for them, once, instead of a long tour */
export default function PlayerWelcome() {
  useI18n();
  const { me } = useAuth();
  const [gone, setGone] = useState(false);
  if (!me || me.role !== 'player' || gone || seen(me.username)) return null;
  const close = () => { setGone(true); try { localStorage.setItem(keyOf(me.username), '1'); } catch { /* shown again next time */ } };
  const steps = [
    { icon: '★', title: t('welcome.fav'), text: t('welcome.favText') },
    { icon: '🔔', title: t('welcome.sub'), text: t('welcome.subText') },
    { icon: '🎮', title: t('welcome.nick'), text: t('welcome.nickText') },
  ];
  return (
    <aside className="pw" role="dialog" aria-label={t('welcome.title')}>
      <h2>{t('welcome.title', { name: me.username })}</h2>
      <ol>
        {steps.map((s) => (
          <li key={s.title}>
            <span className="pw-ico" aria-hidden>{s.icon}</span>
            <span><b>{s.title}</b><small>{s.text}</small></span>
          </li>
        ))}
      </ol>
      <div className="pw-act">
        <a className="btn btn-sm" href="/profile" onClick={close}>{t('welcome.toProfile')}</a>
        <button type="button" className="btn btn-soft btn-sm" onClick={close}>{t('welcome.ok')}</button>
      </div>
    </aside>
  );
}
