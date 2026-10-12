import React from 'react';
import ReactDOM from 'react-dom/client';
// variable Manrope: has Latin and Cyrillic subsets, one file per subset covers weights 200-800 (font-black maps to 800)
import '@fontsource-variable/manrope/wght.css';
import './index.css';
import App from './App';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

// installable as an app (home screen on phones, window on desktop)
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => { navigator.serviceWorker.register('/sw.js').catch(() => undefined); });
}
