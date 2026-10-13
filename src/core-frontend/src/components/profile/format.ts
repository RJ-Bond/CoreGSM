import { t } from '../../i18n';

/** 3725 -> «1 ч 2 мин»; under a minute -> «45 с» */
export function fmtDuration(sec: number): string {
  const s = Math.max(0, Math.round(Number.isFinite(sec) ? sec : 0));
  if (s < 60) return t('dur.s', { n: s });
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h === 0) return t('dur.m', { n: m });
  return m === 0 ? t('dur.h', { n: h }) : t('dur.hm', { h, m });
}

/** "Chrome · Windows" from a User-Agent string */
export function deviceName(ua: string): string {
  if (!ua) return t('pf.device.unknown');
  const browser = /Edg\//.test(ua) ? 'Edge'
    : /OPR\/|Opera/.test(ua) ? 'Opera'
    : /YaBrowser/.test(ua) ? t('pf.device.yandex')
    : /Firefox\//.test(ua) ? 'Firefox'
    : /Chrome\/|CriOS/.test(ua) ? 'Chrome'
    : /Safari\//.test(ua) ? 'Safari'
    : '';
  const os = /Windows/.test(ua) ? 'Windows'
    : /Android/.test(ua) ? 'Android'
    : /iPhone|iPad|iPod/.test(ua) ? 'iOS'
    : /Mac OS X|Macintosh/.test(ua) ? 'macOS'
    : /Linux/.test(ua) ? 'Linux'
    : '';
  return [browser, os].filter(Boolean).join(' · ') || ua.slice(0, 40);
}
