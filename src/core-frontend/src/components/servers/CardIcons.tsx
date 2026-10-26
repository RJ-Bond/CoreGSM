import type { ReactNode } from 'react';

/** small outline icons of the server cards (currentColor; decorative: the text next to them says the same) */
const ico = (d: ReactNode) => (
  <svg className="card-ico" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
    {d}
  </svg>
);

export const CardClock = () => ico(<><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>);
export const CardUptime = () => ico(<><path d="M12 3 4 6v6c0 4.5 3.2 7.6 8 9 4.8-1.4 8-4.5 8-9V6l-8-3Z" /><path d="m9 12 2 2 4-4" /></>);
export const CardMap = () => ico(<><path d="M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11Z" /><circle cx="12" cy="10" r="2.5" /></>);
export const CardTag = () => ico(<><path d="M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8Z" /><path d="M7.5 7.5h.01" /></>);
export const CardUsers = () => ico(<><circle cx="9" cy="8" r="3.2" /><path d="M3 20c0-3.3 2.7-5.5 6-5.5s6 2.2 6 5.5" /><circle cx="17" cy="9" r="2.4" /><path d="M16.5 14.6c2.6.2 4.5 2 4.5 4.9" /></>);
export const CardSeat = () => ico(<><path d="M6 11V6a3 3 0 0 1 3-3h6a3 3 0 0 1 3 3v5" /><path d="M4 11h16v5a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-5Z" /><path d="M7 18v3M17 18v3" /></>);
export const CardRefresh = () => ico(<><path d="M20 11a8 8 0 0 0-14.9-3M4 5v4h4" /><path d="M4 13a8 8 0 0 0 14.9 3M20 19v-4h-4" /></>);
