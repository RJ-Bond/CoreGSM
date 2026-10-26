import type { ReactNode } from 'react';

/** small outline icons for the footer links (currentColor, decorative: the text next to them is the name) */
const svg = (d: ReactNode) => (
  <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
    {d}
  </svg>
);

export const FootServers = () => svg(<><rect x="3" y="4" width="18" height="6.5" rx="2" /><rect x="3" y="13.5" width="18" height="6.5" rx="2" /><path d="M7 7.25h.01M7 16.75h.01" /></>);
export const FootNews = () => svg(<><path d="M4 5h13a2 2 0 0 1 2 2v12H6a2 2 0 0 1-2-2V5Z" /><path d="M19 9h2v8a2 2 0 0 1-2 2M8 9h7M8 13h7" /></>);
export const FootStatus = () => svg(<path d="M3 12h4l2.5 7 5-14L17 12h4" />);
export const FootCommunity = () => svg(<><circle cx="9" cy="8" r="3.2" /><path d="M3 20c0-3.3 2.7-5.5 6-5.5s6 2.2 6 5.5" /><circle cx="17" cy="9" r="2.4" /><path d="M16.5 14.6c2.6.2 4.5 2 4.5 4.9" /></>);
export const FootGallery = () => svg(<><rect x="3" y="4" width="18" height="16" rx="2.5" /><circle cx="9" cy="10" r="1.8" /><path d="m21 16-5-5-8 8" /></>);
export const FootTag = () => svg(<><path d="M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8Z" /><path d="M7.5 7.5h.01" /></>);
