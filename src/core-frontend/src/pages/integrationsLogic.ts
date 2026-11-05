/** Admin → Интеграции: ready-to-paste snippets for the badge and the widget of one server. */

export interface Snippets {
  badge: string;
  page: string;
  widget: string;
  markdown: string;
  html: string;
  bbcode: string;
  iframe: string;
  /** the picture card (PNG), with its snippets */
  card: string;
  cardHtml: string;
  cardMarkdown: string;
}

const attr = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
/** brackets would break a Markdown image text */
const mdText = (s: string) => s.replace(/[[\]\\]/g, '\\$&').replace(/[\r\n]+/g, ' ');

export type WidgetTheme = 'auto' | 'light' | 'dark';
export type WidgetSize = 's' | 'm' | 'l';
export const WIDGET_SIZES: Record<WidgetSize, { w: number; h: number }> = { s: { w: 240, h: 120 }, m: { w: 320, h: 140 }, l: { w: 420, h: 170 } };
export interface BuilderOpts {
  /** the widget palette; «auto» follows the visitor's system setting */
  theme?: WidgetTheme;
  size?: WidgetSize;
  /** corner radius of the widget (0..24) and its font family */
  radius?: number;
  font?: 'sans' | 'serif' | 'mono';
  /** the picture card of the server (PNG) */
  cardStyle?: 'split' | 'strip';
  cardTheme?: 'dark' | 'light';
}

export function badgeSnippets(origin: string, id: number, name: string, opts: BuilderOpts = {}): Snippets {
  const base = origin.replace(/\/+$/, '');
  const badge = `${base}/badge/servers/${id}.svg`;
  const page = `${base}/servers/${id}`;
  const wq = [opts.theme && opts.theme !== 'auto' ? `theme=${opts.theme}` : '', opts.radius != null && opts.radius !== 8 ? `radius=${Math.min(24, Math.max(0, Math.round(opts.radius)))}` : '', opts.font && opts.font !== 'sans' ? `font=${opts.font}` : ''].filter(Boolean).join('&');
  const widget = `${base}/widget/servers/${id}${wq ? `?${wq}` : ''}`;
  const { w, h } = WIDGET_SIZES[opts.size ?? 'm'];
  const cardQuery = [opts.cardStyle === 'strip' ? 'style=strip' : '', opts.cardTheme === 'light' ? 'theme=light' : ''].filter(Boolean).join('&');
  const card = `${base}/api/card/${id}.png${cardQuery ? `?${cardQuery}` : ''}`;
  return {
    card,
    cardHtml: `<a href="${page}"><img src="${card}" alt="${attr(name)}" style="max-width:100%"></a>`,
    cardMarkdown: `[![${mdText(name)}](${card})](${page})`,
    badge,
    page,
    widget,
    markdown: `[![${mdText(name)}](${badge})](${page})`,
    html: `<a href="${page}"><img src="${badge}" alt="${attr(name)}"></a>`,
    bbcode: `[url=${page}][img]${badge}[/img][/url]`,
    iframe: `<iframe src="${widget}" width="${w}" height="${h}" style="border:0" loading="lazy" title="${attr(name)}"></iframe>`,
  };
}
