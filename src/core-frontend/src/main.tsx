import React from 'react';
import ReactDOM from 'react-dom/client';
// variable Manrope: has Latin and Cyrillic subsets, one file per subset covers weights 200-800 (font-black maps to 800)
import '@fontsource-variable/manrope/wght.css';
import './index.css';
import App from './App';
import { initDensity, installMagnetic, installSegIndicator } from './useMotion';

// before the first paint: the saved density, the magnetic call-to-action buttons and the sliding tab pill
initDensity();
installMagnetic();
installSegIndicator();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

// installable as an app (home screen on phones, window on desktop)
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => { navigator.serviceWorker.register('/sw.js').catch(() => undefined); });
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
