import { useEffect, useState, type ReactNode } from 'react';
import { useNickAvatar } from '../nickAvatars';

/** the picture of the panel account that linked this game nick; `children` (the letter on a colour) while there is none */
export default function NickPic({ name, size, className = '', children }: { name: string; size: number; className?: string; children: ReactNode }) {
  const url = useNickAvatar(name);
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [url]);
  if (!url || failed) return <>{children}</>;
  return (
    <img
      src={url}
      width={size}
      height={size}
      alt=""
      referrerPolicy="no-referrer"
      draggable={false}
      loading="lazy"
      onError={() => setFailed(true)}
      className={`shrink-0 object-cover ${className}`}
      style={{ width: size, height: size }}
    />
  );
}
