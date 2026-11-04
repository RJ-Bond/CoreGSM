/** The short notice about a sign-in from a device the account has not been seen on (bell, push, Discord message). */
export interface NewDeviceNotice {
  /** one line for the bell and the Discord message */
  text: string;
  /** the title of the push notification */
  title: string;
}

export function newDeviceNotice(lang: 'ru' | 'en', label: string): NewDeviceNotice {
  const device = label.trim().slice(0, 80) || (lang === 'en' ? 'an unknown device' : 'неизвестное устройство');
  return lang === 'en'
    ? { title: 'New sign-in', text: `New sign-in to your account from ${device}. If it was not you, change your password and end the other sessions.` }
    : { title: 'Новый вход', text: `Новый вход в ваш аккаунт с устройства: ${device}. Если это были не вы, смените пароль и завершите остальные сеансы.` };
}
