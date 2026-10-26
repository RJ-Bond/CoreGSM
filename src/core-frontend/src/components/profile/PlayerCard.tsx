import { useEffect, useState, type FormEvent } from 'react';
import { api, type NickStatus, type PlayerProfile } from '../../api';
import { useAuth } from '../../auth';
import { t } from '../../i18n';
import { ago, Button, CopyButton, ErrorLine, Section, Switch, TextField, toast, errText } from '../../ui';
import { isObject, useFetched } from './useFetched';

const NICK_MAX = 32;
const BIO_MAX = 280;

/** address of the public page: the panel's own address with /u/<username> */
export const publicLink = (username: string) => `${window.location.origin}/u/${encodeURIComponent(username)}`;

/** «Профиль игрока»: in-game nick, a short bio and the public-profile switch with the link */
export function PlayerCard() {
  const { me } = useAuth();
  const { data, reload } = useFetched<PlayerProfile>('/me/player', isObject);
  const status = useFetched<NickStatus>('/me/nick-status', isObject);
  const [nick, setNick] = useState('');
  const [bio, setBio] = useState('');
  const [pub, setPub] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!data) return;
    setNick(data.gameNick ?? '');
    setBio(data.bio ?? '');
    setPub(!!data.publicProfile);
  }, [data]);

  if (!me || data === null) return null; // the API is unavailable: the panel is hidden
  const dirty = !!data && (nick.trim() !== (data.gameNick ?? '') || bio.trim() !== (data.bio ?? '') || pub !== !!data.publicProfile);
  const link = publicLink(me.username);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await api('/me/player', 'PUT', { gameNick: nick.trim(), bio: bio.trim(), publicProfile: pub });
      toast(t('pf.player.saved'));
      reload();
      status.reload();
    } catch (err) {
      setError(errText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} noValidate>
      <Section title={t('pf.player.title')} description={t('pf.player.desc')}>
        {data === undefined ? (
          <div className="skeleton h-40 rounded-2xl bg-soft" />
        ) : (
          <>
            <TextField id="pl-nick" label={t('pf.player.nick')} value={nick} onChange={setNick} maxLength={NICK_MAX} autoComplete="off" placeholder={t('pf.player.nickPh')} hint={t('pf.player.nickHint')} />
            {!!data?.gameNick && status.data && status.data.nick === data.gameNick && (
              status.data.seen ? (
                <p className="text-sm font-bold text-ok" role="status">
                  {t('pf.nick.seen', { when: status.data.lastSeenAt ? ago(status.data.lastSeenAt) : '–' })}
                </p>
              ) : (
                <div className="space-y-2 rounded-xl bg-warnbg px-3 py-2" role="status">
                  <p className="text-sm font-bold text-warn">{t('pf.nick.unseen')}</p>
                  {status.data.similar.length > 0 && (
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-bold text-mute">{t('pf.nick.similar')}</span>
                      {status.data.similar.slice(0, 5).map((s) => (
                        <button key={s} type="button" className="btn btn-soft btn-xs" onClick={() => setNick(s.slice(0, NICK_MAX))}>{s}</button>
                      ))}
                    </div>
                  )}
                </div>
              )
            )}
            <TextField
              id="pl-bio"
              label={t('pf.player.bio')}
              value={bio}
              onChange={setBio}
              multiline
              rows={3}
              maxLength={BIO_MAX}
              hint={`${bio.length} / ${BIO_MAX}`}
            />
            <div className="space-y-3 rounded-2xl bg-soft p-4">
              <label className="flex cursor-pointer items-start gap-3">
                <Switch checked={pub} onChange={setPub} className="mt-0.5" />
                <span className="min-w-0">
                  <span className="block font-extrabold">{t('pf.player.public')}</span>
                  <span className="block text-sm font-semibold text-mute">{t('pf.player.publicHint')}</span>
                </span>
              </label>
              {pub && (
                <div className="flex flex-wrap items-center gap-2">
                  <a href={link} className="min-w-0 flex-1 basis-56 truncate rounded-xl bg-card px-3 py-2 font-mono text-sm font-bold text-link hover:underline" target="_blank" rel="noreferrer">{link}</a>
                  <CopyButton text={link} label={t('common.copy')} />
                </div>
              )}
              {pub && !!data && !data.publicProfile && <p className="text-sm font-bold text-mute">{t('pf.player.saveToPublish')}</p>}
            </div>
            <ErrorLine text={error} />
            <Button loading={busy} disabled={!dirty}>{t('common.save')}</Button>
          </>
        )}
      </Section>
    </form>
  );
}
