import { useState, type ReactNode } from 'react';
import { Icon, IconClock, IconMoon, IconServers, IconShield, IconSun } from '../../icons';

/** achievement icon slugs of the API -> our own small set (unknown slug: a star) */
export function AchievementIcon({ slug, size = 22 }: { slug: string; size?: number }): ReactNode {
  switch (slug) {
    case 'clock': return <IconClock size={size} />;
    case 'moon': return <IconMoon size={size} />;
    case 'sun': return <IconSun size={size} />;
    case 'server': return <IconServers size={size} />;
    case 'shield': return <IconShield size={size} />;
    case 'flame': return <Icon size={size}><path d="M12 3c.6 3.2 5 5.2 5 10a5 5 0 0 1-10 0c0-2 1-3.2 2-4.2.2 1.7 1 2.7 2 3 .4-3-1.2-5.2 1-8.8z" /></Icon>;
    case 'calendar': return <Icon size={size}><rect x="3" y="5" width="18" height="16" rx="3" /><path d="M3 10h18M8 3v4M16 3v4" /></Icon>;
    case 'crown': return <Icon size={size}><path d="M3 8l4.5 4L12 5l4.5 7L21 8l-2 11H5z" /></Icon>;
    case 'heart': return <Icon size={size}><path d="M20.8 5.6a5.2 5.2 0 0 0-7.4 0L12 7l-1.4-1.4a5.2 5.2 0 0 0-7.4 7.4L12 21.6l8.8-8.6a5.2 5.2 0 0 0 0-7.4z" /></Icon>;
    default: return <Icon size={size}><path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z" /></Icon>;
  }
}

/** account journal: one icon per event kind */
export function JournalIcon({ kind, size = 18 }: { kind: string; size?: number }): ReactNode {
  switch (kind) {
    case 'login': return <Icon size={size}><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4M10 17l5-5-5-5M15 12H3" /></Icon>;
    case 'login_new_device': return <Icon size={size}><rect x="3" y="4" width="18" height="12" rx="2" /><path d="M8 20h8M12 16v4" /></Icon>;
    case 'login_failed': return <Icon size={size}><path d="M12 3l10 18H2z" /><path d="M12 10v5M12 18h.01" /></Icon>;
    case 'password_changed': return <Icon size={size}><rect x="4" y="11" width="16" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></Icon>;
    case 'email_changed': return <Icon size={size}><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M3 7l9 6 9-6" /></Icon>;
    case 'discord_linked': return <Icon size={size}><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" /></Icon>;
    case 'discord_unlinked': return <Icon size={size}><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1M4 4l16 16" /></Icon>;
    case 'avatar_changed': return <Icon size={size}><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></Icon>;
    case 'banner_changed': return <Icon size={size}><rect x="3" y="4" width="18" height="16" rx="3" /><circle cx="9" cy="10" r="1.5" /><path d="M21 16l-5-5-8 8" /></Icon>;
    case 'sessions_revoked': return <IconShield size={size} />;
    case 'prefs_changed': return <Icon size={size}><path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0" /><circle cx="16" cy="6" r="2" /><circle cx="10" cy="12" r="2" /></Icon>;
    case 'profile_changed': return <Icon size={size}><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" /></Icon>;
    case 'register_discord': return <Icon size={size}><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0M19 3v4M17 5h4" /></Icon>;
    case 'nick_seen': return <Icon size={size}><circle cx="11" cy="11" r="7" /><path d="M21 21l-5-5M8 11l2 2 4-4" /></Icon>;
    default: return <Icon size={size}><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></Icon>;
  }
}

/** artwork of an achievement (public/achievements/<id>.png, or <id>-locked.png); the slug icon is the fallback when the file is missing */
export function AchievementArt({ id, slug, earned = true, size = 48 }: { id: string; slug: string; earned?: boolean; size?: number }) {
  const [failed, setFailed] = useState(false);
  if (failed || !/^[a-z0-9-]+$/i.test(id)) return <AchievementIcon slug={slug} size={Math.round(size * 0.5)} />;
  return (
    <img
      src={`/achievements/${id}${earned ? '' : '-locked'}.png`}
      width={size}
      height={size}
      alt=""
      loading="lazy"
      draggable={false}
      onError={() => setFailed(true)}
      style={{ width: size, height: size, objectFit: 'contain' }}
    />
  );
}
