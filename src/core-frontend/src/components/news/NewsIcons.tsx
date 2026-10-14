import type { ReactNode } from 'react';
import type { NewsCategory, NewsChangeKind } from '../../api';
import { Icon } from '../../icons';

/** one small inline pictogram per news category and per kind of change (colours come from news.css tone classes) */
const CATEGORY_PATHS: Record<NewsCategory, ReactNode> = {
  // megaphone
  announcement: <><path d="M3 11v2a1 1 0 0 0 1 1h2l5 4V6L6 10H4a1 1 0 0 0-1 1z" /><path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13" /></>,
  // refresh / reset
  wipe: <><path d="M20 12a8 8 0 1 1-2.6-5.9" /><path d="M20 4v5h-5" /></>,
  // arrow up in a circle
  update: <><circle cx="12" cy="12" r="9" /><path d="M12 16V8M8.5 11.5 12 8l3.5 3.5" /></>,
  // star
  event: <path d="m12 3 2.6 5.4 5.9.8-4.3 4.1 1 5.9L12 16.5 6.8 19.2l1-5.9L3.5 9.2l5.9-.8z" />,
  // wrench
  maintenance: <path d="M14.7 6.3a4 4 0 0 0-5.4 5.1L3.5 17.2a1.8 1.8 0 0 0 2.6 2.6l5.8-5.8a4 4 0 0 0 5.1-5.4l-2.4 2.4-2.1-.5-.5-2.1z" />,
  // info
  other: <><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8h.01" /></>,
};

export function CategoryIcon({ category, size = 16 }: { category: NewsCategory; size?: number }) {
  return <Icon size={size}>{CATEGORY_PATHS[category]}</Icon>;
}

export function PinIcon({ size = 14 }: { size?: number }) {
  return (
    <Icon size={size}>
      <path d="M9 4h6l-1 5 3 3v2H7v-2l3-3z" />
      <path d="M12 14v6" />
    </Icon>
  );
}

const CHANGE_PATHS: Record<NewsChangeKind, ReactNode> = {
  add: <path d="M12 5v14M5 12h14" />,
  fix: <path d="m5 12.5 4.2 4.2L19 7" />,
  remove: <path d="M5 12h14" />,
  change: <><path d="M4 12a8 8 0 0 1 13.7-5.6L20 8.5" /><path d="M20 4v4.5h-4.5" /><path d="M20 12a8 8 0 0 1-13.7 5.6L4 15.5" /><path d="M4 20v-4.5h4.5" /></>,
};

export function ChangeIcon({ kind, size = 16 }: { kind: NewsChangeKind; size?: number }) {
  return <Icon size={size}>{CHANGE_PATHS[kind]}</Icon>;
}

export const IconCopyLink = ({ size = 16 }: { size?: number }) => (
  <Icon size={size}>
    <path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1" />
    <path d="M14 10a4 4 0 0 0-5.7 0l-3 3A4 4 0 0 0 11 18.7l1-1" />
  </Icon>
);
