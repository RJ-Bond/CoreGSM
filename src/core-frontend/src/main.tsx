import React from 'react';
import ReactDOM from 'react-dom/client';
// variable Manrope: has Latin and Cyrillic subsets, one file per subset covers weights 200-800 (font-black maps to 800)
import '@fontsource-variable/golos-text/wght.css';
// the serif of the news headlines (Cyrillic)
import '@fontsource-variable/literata/wght.css';
import './index.css';
import './styles/servers.css';
import './styles/detail.css';
import './styles/system.css';
import './styles/news.css';
import './styles/news-page.css';
import './styles/profile.css';
// the button system last: one source of truth for every .btn* class
import './styles/buttons.css';
import App from './App';
import { RootBoundary } from './RootBoundary';
import { api, getToken } from './api';
import { toast } from './ui/toast';
import { initAppearance } from './appearance';
import { initDensity, installMagnetic, installSegIndicator } from './useMotion';

// before the first paint: the accessibility options (less motion, large text, high contrast), the saved density, the magnetic call-to-action buttons and the sliding tab pill
initAppearance();
initDensity();
installMagnetic();
installSegIndicator();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <RootBoundary>
      <App />
    </RootBoundary>
  </React.StrictMode>,
);

// installable as an app (home screen on phones, window on desktop)
// the browser offers to install the panel as an app: keep the offer for the «Установить приложение» button
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  (window as unknown as { __installPrompt?: Event }).__installPrompt = e;
  window.dispatchEvent(new Event('coregsm:installable'));
});
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => { navigator.serviceWorker.register('/sw.js').catch(() => undefined); });
  // a new service worker took over a page that was already controlled: the page may run old scripts next to new
  // ones, so offer a reload (not forced: the person may be in the middle of a form)
  const hadController = !!navigator.serviceWorker.controller;
  let offered = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || offered) return;
    offered = true;
    toast('Доступна новая версия панели', { kind: 'ok', duration: 60000, action: { label: 'Обновить', onClick: () => location.reload() } });
  });
  // the browser renewed the push subscription: the service worker subscribed again, the signed-in page stores it
  navigator.serviceWorker.addEventListener('message', (e: MessageEvent) => {
    if (e.data && e.data.type === 'push-resubscribe' && e.data.subscription && getToken()) {
      void api('/push/subscribe', 'POST', e.data.subscription).catch(() => undefined);
    }
  });
}

// pause decorative animations while the page is not visible or the window is not focused (see the black-square note in index.css)
{
  const sync = () => document.documentElement.toggleAttribute('data-hidden', document.hidden || !document.hasFocus());
  document.addEventListener('visibilitychange', sync);
  window.addEventListener('blur', sync);
  window.addEventListener('focus', sync);
  sync();
}

if (/[?&]flashdebug=1/.test(location.search)) void import('./flashDebug').then((m) => m.installFlashDebug());
{
  const m = location.search.match(/[?&]flat=(\w+)/);
  if (m) document.documentElement.setAttribute('data-flat', m[1]);
}
