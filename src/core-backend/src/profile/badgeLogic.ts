/**
 * The SVG badge and the HTML of the embeddable widget of one server. Pure string building: the text is escaped here,
 * nothing needs skia-canvas or a database.
 */

export interface BadgeServer {
  name: string;
  hasStatus: boolean;
  online: boolean;
  players: number;
  maxPlayers: number;
}

export type BadgeState = 'online' | 'full' | 'offline' | 'unknown';

export const BADGE_COLORS: Record<BadgeState, string> = {
  online: '#2ea043',
  full: '#bf8700',
  offline: '#d1242f',
  unknown: '#6e7781',
};

export const escapeXml = (s: string): string =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);

export const stateOf = (s: BadgeServer): BadgeState => {
  if (!s.hasStatus) return 'unknown';
  if (!s.online) return 'offline';
  return s.maxPlayers > 0 && s.players >= s.maxPlayers ? 'full' : 'online';
};

/** the right half of the badge: "12/32", "12" (no limit known), "офлайн" or "нет данных" */
export const valueText = (s: BadgeServer): string => {
  const st = stateOf(s);
  if (st === 'unknown') return 'нет данных';
  if (st === 'offline') return 'офлайн';
  return s.maxPlayers > 0 ? `${s.players}/${s.maxPlayers}` : String(s.players);
};

/** a name shortened to `max` characters with an ellipsis (counts code points, so no half an emoji) */
export const clip = (text: string, max: number): string => {
  const chars = Array.from(text.replace(/[\u0000-\u001f\u007f]+/g, ' ').trim());
  return chars.length > max ? `${chars.slice(0, max - 1).join('')}…` : chars.join('');
};

/** a rough text width for Verdana 11 px: narrow, normal and wide characters */
export const textWidth = (text: string): number => {
  let w = 0;
  for (const ch of Array.from(text)) {
    if (/[ilI.,:;'|!]/.test(ch)) w += 3.6;
    else if (/[mwMW@%]/.test(ch) || /[А-ЯЁЖШЩЮЫ]/.test(ch)) w += 9.2;
    else if (ch.charCodeAt(0) > 0x2e80) w += 12;
    else w += 6.9;
  }
  return Math.ceil(w);
};

/** the badge in the flat style: name on grey, the number of players on a colour that tells the state */
export function badgeSvg(s: BadgeServer): string {
  const label = clip(s.name, 28) || 'Сервер';
  const value = valueText(s);
  const color = BADGE_COLORS[stateOf(s)];
  const lw = textWidth(label) + 20;
  const vw = textWidth(value) + 20;
  const w = lw + vw;
  const title = escapeXml(`${label}: ${value}`);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="20" role="img" aria-label="${title}"><title>${title}</title>`
    + '<linearGradient id="s" x2="0" y2="100%"><stop offset="0" stop-color="#bbb" stop-opacity=".1"/><stop offset="1" stop-opacity=".1"/></linearGradient>'
    + `<clipPath id="r"><rect width="${w}" height="20" rx="3" fill="#fff"/></clipPath>`
    + `<g clip-path="url(#r)"><rect width="${lw}" height="20" fill="#555"/><rect x="${lw}" width="${vw}" height="20" fill="${color}"/><rect width="${w}" height="20" fill="url(#s)"/></g>`
    + '<g fill="#fff" text-anchor="middle" font-family="Verdana,DejaVu Sans,Geneva,sans-serif" font-size="11">'
    + `<text x="${lw / 2}" y="15" fill="#010101" fill-opacity=".3">${escapeXml(label)}</text><text x="${lw / 2}" y="14">${escapeXml(label)}</text>`
    + `<text x="${lw + vw / 2}" y="15" fill="#010101" fill-opacity=".3">${escapeXml(value)}</text><text x="${lw + vw / 2}" y="14">${escapeXml(value)}</text>`
    + '</g></svg>';
}

/** the badge for a server that does not exist or is hidden */
export const notFoundBadge = (): string => badgeSvg({ name: 'CoreGSM', hasStatus: false, online: false, players: 0, maxPlayers: 0 });

export interface WidgetData extends BadgeServer {
  game: string;
  map: string | null;
  ping: number | null;
  /** where the link of the widget leads (absolute address of the server page) */
  url: string;
  brand: string;
}

const STATE_LABEL: Record<BadgeState, string> = { online: 'В сети', full: 'Сервер полон', offline: 'Не в сети', unknown: 'Нет данных' };

/** a small self-contained page for an <iframe>: no scripts, no external resources, light and dark */
export function widgetHtml(d: WidgetData): string {
  const st = stateOf(d);
  const color = BADGE_COLORS[st];
  const pct = d.maxPlayers > 0 ? Math.min(100, Math.round((d.players / d.maxPlayers) * 100)) : 0;
  const rows: string[] = [];
  if (st === 'online' || st === 'full') {
    rows.push(`<div class="n">${escapeXml(d.maxPlayers > 0 ? `${d.players} / ${d.maxPlayers}` : String(d.players))}<span> игроков</span></div>`);
    if (d.maxPlayers > 0) rows.push(`<div class="bar"><i style="width:${pct}%"></i></div>`);
    const facts = [d.map ? `Карта: ${d.map}` : '', d.ping != null ? `Пинг: ${d.ping} мс` : ''].filter(Boolean);
    if (facts.length) rows.push(`<div class="f">${escapeXml(facts.join(' · '))}</div>`);
  }
  return `<!doctype html>
<html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">
<title>${escapeXml(d.name)}</title>
<style>
:root{--bg:#fff;--fg:#1f2328;--mut:#656d76;--line:#d0d7de;--st:${color}}
@media (prefers-color-scheme:dark){:root{--bg:#161b22;--fg:#e6edf3;--mut:#8b949e;--line:#30363d}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);font:14px/1.4 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
a{display:block;color:inherit;text-decoration:none;padding:12px 14px;border:1px solid var(--line);border-left:4px solid var(--st);border-radius:8px}
.h{display:flex;align-items:center;gap:8px;font-weight:600}
.h b{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1}
.s{font-size:12px;font-weight:600;color:var(--st);white-space:nowrap}
.n{font-size:22px;font-weight:700;margin-top:6px}.n span{font-size:13px;font-weight:400;color:var(--mut)}
.bar{height:6px;border-radius:3px;background:var(--line);margin-top:6px;overflow:hidden}.bar i{display:block;height:100%;background:var(--st)}
.f{margin-top:6px;font-size:12px;color:var(--mut)}
.b{margin-top:8px;font-size:11px;color:var(--mut)}
</style></head><body>
<a href="${escapeXml(d.url)}" target="_blank" rel="noopener">
<div class="h"><b>${escapeXml(clip(d.name, 60))}</b><span class="s">${STATE_LABEL[st]}</span></div>
${rows.join('\n')}
<div class="b">${escapeXml(d.brand)}</div>
</a></body></html>`;
}
