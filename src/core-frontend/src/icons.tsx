import type { ReactNode } from 'react';

/**
 * The panel's single icon set: 24 px grid, 2 px stroke, round caps and joins, `currentColor`.
 * Every icon takes `size` (CSS px, each icon has a sensible default) and `className`; none carries its own colour.
 * ui.tsx re-exports all of them, so pages keep importing from './ui'. Brand marks and game pictograms live elsewhere
 * (gameIcons.ts, the Discord logo in ui.tsx) because they are filled shapes, not strokes.
 */
export interface IconProps { size?: number; className?: string }

/** the 24 x 24 stroke frame; use it for one-off icons so they match the set */
export function Icon({ children, size = 20, className }: { children: ReactNode; size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden className={className}>
      {children}
    </svg>
  );
}

const make = (draw: ReactNode, def = 20) =>
  function Glyph({ size = def, className }: IconProps = {}) {
    return <Icon size={size} className={className}>{draw}</Icon>;
  };

// ---- navigation ----
export const IconServers = make(<><rect x="3" y="4" width="18" height="6" rx="2" /><rect x="3" y="14" width="18" height="6" rx="2" /><path d="M7 7h.01M7 17h.01" /></>);
export const IconCards = make(<><rect x="3" y="4" width="18" height="16" rx="3" /><circle cx="9" cy="10" r="1.5" /><path d="M21 16l-5-5-8 8" /></>);
export const IconDiscord = make(<path d="M21 12a8 8 0 0 1-11.5 7.2L4 20l1-4.2A8 8 0 1 1 21 12z" />);
export const IconSettings = make(<><path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0" /><circle cx="16" cy="6" r="2" /><circle cx="10" cy="12" r="2" /><circle cx="18" cy="18" r="2" /></>);
export const IconNews = make(<><path d="M3 11v2a1 1 0 0 0 1 1h2l5 4V6L6 10H4a1 1 0 0 0-1 1z" /><path d="M15.5 8.5a5 5 0 0 1 0 7M18 6a8 8 0 0 1 0 12" /></>);
export const IconUser = make(<><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></>, 22);
export const IconUsers = make(<><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" /></>, 22);
export const IconJournal = make(<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />, 22);
/** heartbeat line: the System and Status pages */
export const IconSystem = make(<path d="M22 12h-4l-3 9L9 3l-3 9H2" />, 22);
/** a chart with a rising line: the Health page */
export const IconHealth = make(<><path d="M3 3v18h18" /><path d="M7 15l4-5 3 3 5-7" /></>, 22);
export const IconStart = make(<path d="M5 21V4M5 4h11l-2 4 2 4H5" />, 22);
export const IconBell = make(<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.94 1.94 0 0 0 3.4 0" />, 22);

// ---- theme ----
export const IconSun = make(<><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></>);
export const IconMoon = make(<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />);
export const IconAuto = make(<><circle cx="12" cy="12" r="9" /><path d="M12 3a9 9 0 0 1 0 18z" fill="currentColor" /></>);
export const IconPalette = make(<><path d="M12 3a9 9 0 1 0 0 18c1.1 0 1.8-.8 1.8-1.7 0-.5-.2-.9-.5-1.2-.3-.3-.5-.7-.5-1.1 0-.9.7-1.6 1.6-1.6H17a4 4 0 0 0 4-4C21 6.5 17 3 12 3z" /><path d="M7.5 11h.01M10 7.5h.01M14.5 7.5h.01" /></>);

// ---- actions (18 px: rows and toolbars) ----
export const IconEdit = make(<><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" /></>, 18);
export const IconTrash = make(<><path d="M3 6h18" /><path d="M8 6V4h8v2" /><path d="M6 6l1 14h10l1-14" /><path d="M10 11v6M14 11v6" /></>, 18);
export const IconPause = make(<path d="M8 5v14M16 5v14" />, 18);
export const IconPlay = make(<path d="M7 4.5v15l12-7.5z" />, 18);
export const IconKey = make(<><circle cx="8" cy="15" r="4" /><path d="M10.8 12.2L20 3M16 7l3 3" /></>, 18);
export const IconDownload = make(<path d="M12 4v11M7 11l5 5 5-5M5 20h14" />, 18);
export const IconUpload = make(<path d="M12 20V9M7 13l5-5 5 5M5 4h14" />, 18);
export const IconRestore = make(<><path d="M3 12a9 9 0 1 0 3-6.7M3 4v5h5" /><path d="M12 8v4l3 2" /></>, 18);
export const IconUndo = make(<path d="M9 14L4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3" />, 18);
export const IconCopyPlus = make(<><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15V6a2 2 0 0 1 2-2h9" /></>, 18);
export const IconLinkOut = make(<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" />, 18);
export const IconPlus = make(<path d="M12 5v14M5 12h14" />, 18);
export const IconClose = make(<path d="M6 6l12 12M18 6L6 18" />, 18);
export const IconCheck = make(<path d="M5 12.5l4.5 4.5L19 7.5" />, 18);
export const IconSearch = make(<><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" /></>, 18);
export const IconLogout = make(<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" />);
export const IconEye = make(<><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" /></>);
export const IconEyeOff = make(<path d="M3 3l18 18M10.6 5.1A10 10 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-3.2 4M6.5 6.6C3.7 8.4 2 12 2 12s3.6 7 10 7c1.7 0 3.2-.4 4.5-1M9.9 9.9a3 3 0 0 0 4.2 4.2" />);
export const IconChevronDown = make(<path d="M6 9l6 6 6-6" />, 18);
export const IconArrowUp = make(<path d="M12 19V5M5 12l7-7 7 7" />, 22);

// ---- status and feedback ----
export const IconInfo = make(<><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8h.01" /></>);
export const IconWarn = make(<><path d="M12 3l10 18H2z" /><path d="M12 10v5M12 18h.01" /></>);
export const IconError = make(<><circle cx="12" cy="12" r="9" /><path d="M12 7v6M12 16.5h.01" /></>);
export const IconOk = make(<><circle cx="12" cy="12" r="9" /><path d="M8 12.5l3 3 5-6" /></>);

// ---- system ----
export const IconDisk = make(<><path d="M3 14l2.2-8.2A2 2 0 0 1 7.1 4h9.8a2 2 0 0 1 1.9 1.8L21 14" /><rect x="3" y="14" width="18" height="6" rx="2" /><path d="M7 17h.01M11 17h.01" /></>);
export const IconMemory = make(<><rect x="4" y="7" width="16" height="10" rx="2" /><path d="M8 7v-2M12 7v-2M16 7v-2M8 19v-2M12 19v-2M16 19v-2" /></>);
export const IconDatabase = make(<><ellipse cx="12" cy="5.5" rx="8" ry="3" /><path d="M4 5.5v13c0 1.7 3.6 3 8 3s8-1.3 8-3v-13M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3" /></>);
export const IconShield = make(<path d="M12 3l8 3v6c0 4.5-3.2 8-8 9-4.8-1-8-4.5-8-9V6z" />);
export const IconClock = make(<><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>);
export const IconWrench = make(<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />, 22);
export const IconBot = make(<><rect x="4" y="8" width="16" height="12" rx="3" /><path d="M12 4v4M9 13h.01M15 13h.01M9.5 16.5h5" /></>);

// ---- icons with a small motion of their own (classes in index.css; the motion stops for reduced motion) ----
/** circular arrows; turns on click and spins while `spinning` (busy) */
export const IconRefresh = ({ spinning = false, size = 16 }: { spinning?: boolean; size?: number }) => (
  <span className={`ico-refresh inline-grid ${spinning ? 'spinning' : ''}`} aria-hidden>
    <Icon size={size}><path d="M20 11a8 8 0 0 0-14.5-4.1M4 4v4h4M4 13a8 8 0 0 0 14.5 4.1M20 20v-4h-4" /></Icon>
  </span>
);
/** arrow that nudges forward when its button is hovered */
export const IconArrow = () => (
  <span className="ico-nudge inline-grid" aria-hidden>
    <Icon size={16}><path d="M5 12h14M13 6l6 6-6 6" /></Icon>
  </span>
);
export const IconCheckMark = () => (
  <span className="star-pop inline-grid" aria-hidden>
    <Icon size={16}><path d="M5 12.5l4.5 4.5L19 7.5" /></Icon>
  </span>
);
export const IconShare = () => (
  <span className="ico-share inline-grid" aria-hidden>
    <Icon size={16}><path d="M7 17L17 7M9 7h8v8" /></Icon>
  </span>
);
export const IconCopy = make(<><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15V6a2 2 0 0 1 2-2h9" /></>, 16);

/** the catalogue the UI kit page shows (name, component); keep new icons in this list */
export const ICON_SET: [string, (p: IconProps) => ReactNode][] = [
  ['Servers', IconServers], ['Cards', IconCards], ['Discord', IconDiscord], ['Settings', IconSettings], ['News', IconNews],
  ['Users', IconUsers], ['Journal', IconJournal], ['System', IconSystem], ['Health', IconHealth], ['Start', IconStart], ['Bell', IconBell],
  ['Sun', IconSun], ['Moon', IconMoon], ['Auto', IconAuto], ['Palette', IconPalette],
  ['Edit', IconEdit], ['Trash', IconTrash], ['Pause', IconPause], ['Play', IconPlay], ['Key', IconKey],
  ['Download', IconDownload], ['Upload', IconUpload], ['Restore', IconRestore], ['Undo', IconUndo], ['Copy', IconCopy],
  ['LinkOut', IconLinkOut], ['Plus', IconPlus], ['Close', IconClose], ['Check', IconCheck], ['Search', IconSearch],
  ['Logout', IconLogout], ['Eye', IconEye], ['EyeOff', IconEyeOff], ['ChevronDown', IconChevronDown], ['ArrowUp', IconArrowUp],
  ['Info', IconInfo], ['Warn', IconWarn], ['Error', IconError], ['Ok', IconOk],
  ['Disk', IconDisk], ['Memory', IconMemory], ['Database', IconDatabase], ['Shield', IconShield], ['Clock', IconClock], ['Bot', IconBot], ['Wrench', IconWrench],
];
export const IconGrid = make(<><rect x="3" y="3" width="7.5" height="7.5" rx="2" /><rect x="13.5" y="3" width="7.5" height="7.5" rx="2" /><rect x="3" y="13.5" width="7.5" height="7.5" rx="2" /><rect x="13.5" y="13.5" width="7.5" height="7.5" rx="2" /></>);
export const IconTrend = make(<path d="M3 17l6-6 4 4 8-8M15 7h6v6" />);
export const IconBars = make(<path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />);
export const IconBolt = make(<path d="M13 2L4 14h7l-1 8 9-12h-7l1-8z" />);
export const IconPlug = make(<path d="M9 2v5M15 2v5M6 7h12v4a6 6 0 0 1-12 0V7zM12 17v5" />);
export const IconTrophy = make(<path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0V4zM7 6H4a3 3 0 0 0 3 4M17 6h3a3 3 0 0 1-3 4" />);
