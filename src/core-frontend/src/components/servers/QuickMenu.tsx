/** «⋯» on a server card: copy the address, start the game, share the link: without opening the server first. */
import { connectGuide } from '../../connectGuides';
import type { Server } from '../../api';
import { t, useI18n } from '../../i18n';
import { toast } from '../../ui';
import MoreMenu, { type MoreItem } from '../server/MoreMenu';

export function QuickMenu({ s, glass = false }: { s: Server; glass?: boolean }) {
  useI18n();
  const link = connectGuide(s.game, s.address).link;
  const url = `${window.location.origin}/servers/${s.id}`;
  const copy = async (text: string, done: string) => {
    try { await navigator.clipboard.writeText(text); toast(done); } catch { /* nothing to show: the text stays on the page */ }
  };
  const share = async () => {
    if (typeof navigator.share === 'function') {
      try { await navigator.share({ title: s.name, url }); } catch { /* closed by the user */ }
    } else await copy(url, t('srv.quick.linkCopied'));
  };
  const items: MoreItem[] = [
    { key: 'copy', label: t('srv.quick.copy'), onSelect: () => void copy(s.address, t('srv.addr.copied')) },
    ...(link ? [{ key: 'play', label: link.label, onSelect: () => { window.location.href = link.href; } }] : []),
    { key: 'share', label: t('srv.quick.share'), onSelect: () => void share() },
  ];
  return <MoreMenu items={items} iconOnly label={t('srv.quick.label', { name: s.name })} className={`${glass ? 'btn-icon-glass' : 'btn-icon-ghost'} btn-icon-sm`} />;
}
