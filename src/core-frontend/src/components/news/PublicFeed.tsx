import { useState, type CSSProperties } from 'react';
import type { PublicNews } from '../../api';
import { fmtDate } from '../../ui';
import { DiscordMd, ThemeCtx, type DTheme } from './DiscordMd';

/** the news text uses the panel's own colours (light and dark), not Discord's */
const PANEL_THEME: DTheme = {
  name: 'light',
  outer: 'transparent',
  embed: 'transparent',
  embedBorder: 'transparent',
  text: 'rgb(var(--ink))',
  title: 'rgb(var(--ink))',
  muted: 'rgb(var(--mute))',
  link: 'rgb(var(--link))',
  code: 'rgb(var(--soft))',
  quote: 'rgb(var(--line))',
  spoilerHide: 'rgb(var(--soft))',
  spoilerShow: 'rgb(var(--soft))',
  mentionBg: 'rgb(var(--soft))',
  mentionFg: 'rgb(var(--link))',
  chipBg: 'rgb(var(--soft))',
};

interface Card {
  id: number;
  title: string;
  text: string;
  author: { name: string; icon?: string } | null;
  image: string | null;
  link: string | null;
  accent: string;
  at: number | null;
  fields: { name: string; value: string }[];
}

const hex = (n: number | undefined) => `#${(n ?? 0x5b4fe0).toString(16).padStart(6, '0')}`;

function cardOf(n: PublicNews): Card {
  const e = n.payload.embed;
  const img = e?.image?.upload ? `/api/news/images/${e.image.upload}` : e?.image?.url || e?.thumbnailUrl || null;
  const url = e?.url && /^https?:\/\//i.test(e.url) ? e.url : null;
  return {
    id: n.id,
    title: e?.title || n.title || 'Новость',
    text: (e?.description || n.payload.content || '').trim(),
    author: e?.author?.name ? { name: e.author.name, icon: e.author.iconUrl } : null,
    image: img,
    link: url,
    accent: hex(e?.color),
    at: n.sentAt,
    fields: (e?.fields ?? []).filter((f) => f.name && f.value).map((f) => ({ name: f.name, value: f.value })),
  };
}

function Author({ a }: { a: NonNullable<Card['author']> }) {
  return (
    <span className="nf-author">
      {a.icon && /^https?:\/\//i.test(a.icon) ? (
        <img src={a.icon} alt="" width={22} height={22} loading="lazy" />
      ) : (
        <span className="nf-ava" aria-hidden>{a.name.slice(0, 1).toUpperCase()}</span>
      )}
      {a.name}
    </span>
  );
}

function Body({ c }: { c: Card }) {
  return (
    <ThemeCtx.Provider value={PANEL_THEME}>
      <div className="nf-body">
        {c.text && <DiscordMd text={c.text} />}
        {c.fields.length > 0 && (
          <dl className="nf-fields">
            {c.fields.map((f, i) => (
              <div key={i}>
                <dt>{f.name}</dt>
                <dd><DiscordMd text={f.value} /></dd>
              </div>
            ))}
          </dl>
        )}
      </div>
    </ThemeCtx.Provider>
  );
}

const coverStyle = (c: Card): CSSProperties =>
  c.image
    ? { backgroundImage: `url("${c.image}")` }
    : { backgroundImage: `linear-gradient(135deg, ${c.accent}33, ${c.accent}14 55%, rgb(var(--soft)))` };

/** the latest news large (hero), the rest as a list with previews; light, no chat-client chrome */
export function PublicFeed({ items }: { items: PublicNews[] }) {
  const cards = [...items].sort((a, b) => (b.sentAt ?? 0) - (a.sentAt ?? 0)).map(cardOf);
  const [open, setOpen] = useState<Set<number>>(new Set());
  const toggle = (id: number) =>
    setOpen((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  if (cards.length === 0) return null;
  const [hero, ...rest] = cards;
  const h = hero!;
  const heroOpen = open.has(h.id);

  return (
    <div className="nf">
      <article className="nf-hero" style={{ ['--nf-accent' as string]: h.accent }}>
        {h.image && <div className="nf-hero-img" style={coverStyle(h)} role="img" aria-label={h.title} />}
        <div className="nf-hero-in">
          <div className="nf-meta">
            {h.at && <span className="nf-date">{fmtDate(h.at)}</span>}
            {h.author && <Author a={h.author} />}
          </div>
          <h2 className="nf-title">{h.title}</h2>
          <div className={`nf-text ${heroOpen ? '' : 'is-clamped'}`}><Body c={h} /></div>
          <div className="nf-actions">
            {(h.text.length > 220 || h.fields.length > 0) && (
              <button type="button" className="btn btn-soft" aria-expanded={heroOpen} onClick={() => toggle(h.id)}>
                {heroOpen ? 'Свернуть' : 'Читать полностью'}
              </button>
            )}
            {h.link && <a className="btn" href={h.link} target="_blank" rel="noopener noreferrer">Открыть ссылку →</a>}
          </div>
        </div>
      </article>

      {rest.length > 0 && <h3 className="nf-more">Ранее</h3>}
      <div className="nf-list">
        {rest.map((c) => {
          const isOpen = open.has(c.id);
          return (
            <article key={c.id} className="nf-item" style={{ ['--nf-accent' as string]: c.accent }}>
              <div className="nf-thumb" style={coverStyle(c)} aria-hidden />
              <div className="nf-item-in">
                <div className="nf-meta">
                  {c.at && <span className="nf-date">{fmtDate(c.at)}</span>}
                  {c.author && <Author a={c.author} />}
                </div>
                <h3 className="nf-item-title">{c.title}</h3>
                <div className={`nf-text ${isOpen ? '' : 'is-clamped-2'}`}><Body c={c} /></div>
                <div className="nf-actions">
                  {(c.text.length > 120 || c.fields.length > 0) && (
                    <button type="button" className="btn-link btn-xs" aria-expanded={isOpen} onClick={() => toggle(c.id)}>
                      {isOpen ? 'Свернуть' : 'Читать'}
                    </button>
                  )}
                  {c.link && <a className="btn-link btn-xs" href={c.link} target="_blank" rel="noopener noreferrer">Открыть ссылку →</a>}
                </div>
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}
