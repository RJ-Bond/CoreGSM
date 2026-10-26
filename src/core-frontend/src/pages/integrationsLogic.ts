/** Admin → Интеграции: ready-to-paste snippets for the badge and the widget of one server. */

export interface Snippets {
  badge: string;
  page: string;
  widget: string;
  markdown: string;
  html: string;
  bbcode: string;
  iframe: string;
}

const attr = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
/** brackets would break a Markdown image text */
const mdText = (s: string) => s.replace(/[[\]\\]/g, '\\$&').replace(/[\r\n]+/g, ' ');

export function badgeSnippets(origin: string, id: number, name: string): Snippets {
  const base = origin.replace(/\/+$/, '');
  const badge = `${base}/badge/servers/${id}.svg`;
  const page = `${base}/servers/${id}`;
  const widget = `${base}/widget/servers/${id}`;
  return {
    badge,
    page,
    widget,
    markdown: `[![${mdText(name)}](${badge})](${page})`,
    html: `<a href="${page}"><img src="${badge}" alt="${attr(name)}"></a>`,
    bbcode: `[url=${page}][img]${badge}[/img][/url]`,
    iframe: `<iframe src="${widget}" width="320" height="140" style="border:0" loading="lazy" title="${attr(name)}"></iframe>`,
  };
}
