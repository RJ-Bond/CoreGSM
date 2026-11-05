import { useState } from 'react';
import { api } from '../api';
import { t } from '../i18n';
import { Button, Section, fail, toast } from '../ui';
import { ChannelPicker } from './ChannelPicker';

/** posts the «Accept the rules» card: the button gives the member the chosen role */
export default function VerifyCard() {
  const [channelId, setChannelId] = useState('');
  const [roleId, setRoleId] = useState('');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const valid = /^\d{15,25}$/.test(channelId) && /^\d{15,25}$/.test(roleId.trim()) && text.trim().length >= 3;

  const send = async () => {
    setBusy(true);
    try {
      await api('/discord/verify-card', 'POST', { channelId, roleId: roleId.trim(), text: text.trim() });
      toast(t('vfy.sent'));
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section title={t('vfy.title')}>
      <p className="mb-3 text-sm font-semibold text-mute">{t('vfy.help')}</p>
      <div className="grid gap-3">
        <div>
          <span className="label">{t('gw.channel')}</span>
          <ChannelPicker id="vfy-channel" value={channelId} onChange={setChannelId} />
        </div>
        <div>
          <label htmlFor="vfy-role" className="label">{t('vfy.role')}</label>
          <input id="vfy-role" className="input w-full" inputMode="numeric" placeholder={t('gw.roleHint')} value={roleId} onChange={(e) => setRoleId(e.target.value)} />
        </div>
        <div>
          <label htmlFor="vfy-text" className="label">{t('vfy.text')}</label>
          <textarea id="vfy-text" className="input min-h-28 w-full" maxLength={1500} value={text} onChange={(e) => setText(e.target.value)} />
        </div>
        <div><Button type="button" loading={busy} disabled={!valid} onClick={() => void send()}>{t('vfy.send')}</Button></div>
      </div>
    </Section>
  );
}
