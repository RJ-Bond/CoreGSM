import { useEffect, useRef, useState } from 'react';
import type { NewsReaction, PublicNews, PublicNewsFull, Server } from '../../api';
import { t } from '../../i18n';
import { ago, fmtDateTime, toast } from '../../ui';
import { cardOf, NewsCover, Row } from './PublicFeed';
import { IconCopyLink } from './NewsIcons';
import { Comments } from './Comments';
import { extractHeadings, readingMinutes, wasEdited } from './newsLogic';
import {
  ActionButtons, AuthorLine, ChangesBlock, Countdown, GalleryGrid, GalleryViewer, NewsText, Reactions, StatusCards,
} from './NewsParts';

/** a thin bar under the top edge that fills while the article is read */
function ReadProgress({ target }: { target: React.RefObject<HTMLElement | null> }) {
  const [p, setP] = useState(0);
  useEffect(() => {
    let raf = 0;
    const calc = () => {
      raf = 0;
      const el = target.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const total = r.height - window.innerHeight;
      setP(total <= 0 ? 0 : Math.max(0, Math.min(1, -r.top / total)));
    };
    const on = () => { if (!raf) raf = window.requestAnimationFrame(calc); };
    on();
    window.addEventListener('scroll', on, { passive: true });
    window.addEventListener('resize', on);
    return () => { window.removeEventListener('scroll', on); window.removeEventListener('resize', on); if (raf) window.cancelAnimationFrame(raf); };
  }, [target]);
  if (p <= 0.005) return null;
  return <div className="nw-progress" style={{ width: `${p * 100}%` }} role="progressbar" aria-label={t('nw.progress')} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(p * 100)} />;
}

/** «Наверх» after a long scroll */
function ToTop() {
  const [show, setShow] = useState(false);
  useEffect(() => {
    const on = () => setShow(window.scrollY > 900);
    on();
    window.addEventListener('scroll', on, { passive: true });
    return () => window.removeEventListener('scroll', on);
  }, []);
  if (!show) return null;
  const go = () => window.scrollTo({ top: 0, behavior: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  return <button type="button" className="nw-top" onClick={go} aria-label={t('nw.toTop')} title={t('nw.toTop')}><span aria-hidden>↑</span></button>;
}

/** one news item in full: cover, text, what changed, server cards, gallery, buttons, reactions, previous / next */
export function NewsArticle({
  item, servers, canReact, onReactions, preview = false, related = [],
}: {
  item: PublicNewsFull;
  servers: Server[] | null;
  canReact: boolean;
  onReactions: (r: NewsReaction[]) => void;
  /** the editor's «Как будет на сайте»: no navigation, no reactions */
  preview?: boolean;
  /** other news to read next («Читайте также») */
  related?: PublicNews[];
}) {
  const c = cardOf(item);
  const minutes = readingMinutes(`${c.text} ${c.fields.map((f) => f.value).join(' ')}`);
  const [viewer, setViewer] = useState<number | null>(null);
  const [coverOpen, setCoverOpen] = useState(false);
  const edited = !preview && wasEdited(item.sentAt, item.editedAt);
  const root = useRef<HTMLElement>(null);
  const headings = extractHeadings(c.text);
  const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';

  // a link to a part of the page (#nw-h-3): the text is drawn after the load, so jump once it is there
  useEffect(() => {
    const id = window.location.hash.slice(1);
    if (preview || !/^nw-h-\d+$/.test(id)) return;
    const timer = window.setTimeout(() => document.getElementById(id)?.scrollIntoView({ block: 'start' }), 150);
    return () => window.clearTimeout(timer);
  }, [preview, item.id]);

  const jump = (id: string) => {
    const el = document.getElementById(id);
    if (!el) return;
    const calm = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    el.scrollIntoView({ behavior: calm ? 'auto' : 'smooth', block: 'start' });
  };
  const share = async () => {
    try {
      await navigator.share({ title: c.title, url: `${window.location.origin}/n/${item.id}` });
    } catch {
      /* closed by the person */
    }
  };

  const copy = async () => {
    try {
      // /n/<id> carries the meta tags of a link preview and sends people on to the page
      await navigator.clipboard.writeText(`${window.location.origin}/n/${item.id}`);
      toast(t('nw.copied'));
    } catch {
      toast(t('nw.copyFail'), 'err');
    }
  };

  return (
    <article className="nw-article" ref={root}>
      {!preview && <ReadProgress target={root} />}
      <div className="nw-cover-zoomable">
        <NewsCover c={c} servers={servers} as="h1" tall />
        {c.image && !preview && <button type="button" className="nw-zoom" onClick={() => setCoverOpen(true)} aria-label={t('nw.zoomCover')} title={t('nw.zoomCover')}><span aria-hidden>⤢</span></button>}
      </div>
      <div className="nw-article-in">
        {(c.author || c.countdownAt || minutes > 0) && (
          <div className="nf-meta">
            {c.author && <AuthorLine name={c.author.name} icon={c.author.icon} role={c.role} />}
            {minutes > 0 && <span className="nw-read">{t('nw.readTime', { n: minutes })}</span>}
            {c.countdownAt && <Countdown at={c.countdownAt} label={c.countdownLabel} />}
            {edited && item.editedAt && <span className="nw-read" title={t('nw.updatedTip', { date: fmtDateTime(item.editedAt), n: item.edits ?? 0 })}>{t('nw.updated', { when: ago(item.editedAt) })}</span>}
          </div>
        )}
        {headings.length >= 3 && (
          <nav className="nw-toc" aria-label={t('nw.toc')}>
            <h2 className="nw-toc-h">{t('nw.toc')}</h2>
            <ol>
              {headings.map((h) => (
                <li key={h.id} className={`nw-toc-l${h.level}`}>
                  <button type="button" onClick={() => jump(h.id)}>{h.text}</button>
                </li>
              ))}
            </ol>
          </nav>
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
              {canShare && <button type="button" className="btn btn-soft" onClick={() => void share()}>{t('nw.share')}</button>}
              <button type="button" className="btn btn-soft" onClick={() => void copy()}>
                <IconCopyLink />
                {t('nw.copyLink')}
              </button>
            </div>
          </>
        )}
      </div>
      {!preview && <div className="nw-article-in"><Comments newsId={item.id} /></div>}
      {!preview && related.length > 0 && (
        <section className="nw-related" aria-label={t('nw.related')}>
          <h2 className="nw-h2">{t('nw.related')}</h2>
          <div className="nf-list">{related.map((n) => <Row key={n.id} c={cardOf(n)} servers={servers} />)}</div>
        </section>
      )}
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
      {!preview && <ToTop />}
      {coverOpen && c.image && <GalleryViewer urls={[c.image]} index={0} onIndex={() => undefined} onClose={() => setCoverOpen(false)} />}
      {viewer != null && c.gallery.length > 0 && <GalleryViewer urls={c.gallery} index={Math.min(viewer, c.gallery.length - 1)} onIndex={setViewer} onClose={() => setViewer(null)} />}
    </article>
  );
}
