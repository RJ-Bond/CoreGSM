import { useState } from 'react';
import type { NewsReaction, PublicNewsFull, Server } from '../../api';
import { t } from '../../i18n';
import { toast } from '../../ui';
import { cardOf, NewsCover } from './PublicFeed';
import { IconCopyLink } from './NewsIcons';
import {
  ActionButtons, AuthorLine, ChangesBlock, Countdown, GalleryGrid, GalleryViewer, NewsText, Reactions, StatusCards,
} from './NewsParts';

/** one news item in full: cover, text, what changed, server cards, gallery, buttons, reactions, previous / next */
export function NewsArticle({
  item, servers, canReact, onReactions, preview = false,
}: {
  item: PublicNewsFull;
  servers: Server[] | null;
  canReact: boolean;
  onReactions: (r: NewsReaction[]) => void;
  /** the editor's «Как будет на сайте»: no navigation, no reactions */
  preview?: boolean;
}) {
  const c = cardOf(item);
  const [viewer, setViewer] = useState<number | null>(null);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href.split('?')[0]);
      toast(t('nw.copied'));
    } catch {
      toast(t('nw.copyFail'), 'err');
    }
  };

  return (
    <article className="nw-article">
      <NewsCover c={c} servers={servers} as="h1" tall />
      <div className="nw-article-in">
        {(c.author || c.countdownAt) && (
          <div className="nf-meta">
            {c.author && <AuthorLine name={c.author.name} icon={c.author.icon} role={c.role} />}
            {c.countdownAt && <Countdown at={c.countdownAt} label={c.countdownLabel} />}
          </div>
        )}
        {(c.text || c.fields.length > 0) && <NewsText className="nw-prose-lg" text={c.text} fields={c.fields} />}
        <ChangesBlock changes={c.changes} />
        <StatusCards ids={c.statusIds} servers={servers} />
        <GalleryGrid urls={c.gallery} onOpen={setViewer} />
        {(c.actions.length > 0 || c.link) && (
          <div className="nw-actions-wrap">
            <ActionButtons actions={c.actions} />
            {c.link && <a className="btn btn-soft" href={c.link} target="_blank" rel="noopener noreferrer">{t('nw.openLink')}</a>}
          </div>
        )}
        {!preview && (
          <>
            <Reactions id={item.id} reactions={item.reactions} canReact={canReact} onChange={onReactions} />
            <div className="nw-toolbar">
              <a className="btn btn-soft" href="/news">{t('nw.back')}</a>
              <button type="button" className="btn btn-soft" onClick={() => void copy()}>
                <IconCopyLink />
                {t('nw.copyLink')}
              </button>
            </div>
          </>
        )}
      </div>
      {!preview && (item.prev || item.next) && (
        <nav className="nw-prevnext" aria-label={t('nw.prevnext')}>
          {item.prev ? (
            <a href={`/news/${item.prev.id}`} className="nw-pn nw-pn-prev">
              <span className="nw-pn-kicker">← {t('nw.prev')}</span>
              <span className="nw-pn-title">{item.prev.title}</span>
            </a>
          ) : <span />}
          {item.next ? (
            <a href={`/news/${item.next.id}`} className="nw-pn nw-pn-next">
              <span className="nw-pn-kicker">{t('nw.next')} →</span>
              <span className="nw-pn-title">{item.next.title}</span>
            </a>
          ) : <span />}
        </nav>
      )}
      {viewer != null && c.gallery.length > 0 && <GalleryViewer urls={c.gallery} index={Math.min(viewer, c.gallery.length - 1)} onIndex={setViewer} onClose={() => setViewer(null)} />}
    </article>
  );
}
