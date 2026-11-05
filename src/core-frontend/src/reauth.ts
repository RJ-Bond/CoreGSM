/** Asks for the password (and the code of the second factor) when the server wants a protected action confirmed. */
import { api, setReauthHandler } from './api';
import { promptDialog } from './confirm';
import { t } from './i18n';
import { errText, toast } from './ui';

interface Info { active: boolean; method: 'password' | 'name'; twoFactor: boolean }

export async function askReauth(): Promise<boolean> {
  let info: Info;
  try {
    info = await api<Info>('/auth/reauth');
  } catch {
    return false;
  }
  if (info.active) return true;
  for (let attempt = 0; attempt < 3; attempt++) {
    const byName = info.method === 'name';
    const secret = await promptDialog({ title: t('su.title'), text: t('su.text'), label: byName ? t('su.name') : t('su.pass'), password: !byName, confirmLabel: t('su.go') });
    if (secret === null || secret === '') return false;
    let code: string | undefined;
    if (info.twoFactor) {
      const c = await promptDialog({ title: t('su.title'), text: t('su.codeText'), label: t('su.code'), confirmLabel: t('su.go') });
      if (c === null || c === '') return false;
      code = c.trim();
    }
    try {
      await api('/auth/reauth', 'POST', { ...(byName ? { confirm: secret } : { password: secret }), ...(code ? { code } : {}) });
      return true;
    } catch (e) {
      toast(errText(e), 'err');
    }
  }
  return false;
}

setReauthHandler(askReauth);
