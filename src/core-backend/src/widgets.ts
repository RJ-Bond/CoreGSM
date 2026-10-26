/**
 * Badges and widgets that need no key, for sites and forums (only while the panel is public):
 *
 *   GET /badge/servers/:id.svg   an SVG badge: server name and players / maximum, coloured by the state
 *   GET /widget/servers/:id      a small page for an <iframe> (the only path that may be framed)
 *
 * Both are cached for a minute and carry no addresses.
 */
import type { Express, Request, Response } from 'express';
import { publicPanel } from './auth.js';
import { badgeSvg, notFoundBadge, widgetHtml } from './badgeLogic.js';
import { getServer } from './serverData.js';
import { baseOf, brand, publicBase } from './site.js';
import { param } from './http.js';
import { gameLabel } from './games.js';

export const WIDGET_CACHE = 'public, max-age=60';

/** the shown name; when the server has no title (the name would be host:port) the game name stands in, never the internal address */
export const publicName = (sv: { name: string; host: string; port: number; game: string }): string => (sv.name === `${sv.host}:${sv.port}` ? gameLabel(sv.game) : sv.name);

export function registerWidgets(app: Express): void {
  app.get('/badge/servers/:file', (req: Request, res: Response) => {
    const m = /^(\d+)\.svg$/.exec(String(req.params.file));
    res.set({
      'Content-Type': 'image/svg+xml; charset=utf-8',
      'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'",
      'Cross-Origin-Resource-Policy': 'cross-origin',
      'X-Robots-Tag': 'noindex',
    });
    const sv = m && publicPanel() ? getServer(Number(m[1])) : null;
    if (!sv) {
      res.set('Cache-Control', 'public, max-age=30');
      return void res.status(404).send(notFoundBadge());
    }
    res.set('Cache-Control', WIDGET_CACHE);
    res.send(badgeSvg({ ...sv, name: publicName(sv) }));
  });

  app.get('/widget/servers/:id', param('id'), (req: Request, res: Response) => {
    // the one place where framing is allowed (securityHeaders denies it everywhere else)
    res.removeHeader('X-Frame-Options');
    res.set({
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors *",
      'X-Robots-Tag': 'noindex',
    });
    const sv = publicPanel() ? getServer(Number(req.params.id)) : null;
    if (!sv) {
      res.set('Cache-Control', 'public, max-age=30');
      return void res.status(404).send('<!doctype html><meta charset="utf-8"><title>Не найдено</title><body style="font:14px system-ui;padding:12px">Сервер недоступен</body>');
    }
    const base = publicBase() ?? baseOf(req);
    res.set('Cache-Control', WIDGET_CACHE);
    res.send(widgetHtml({ ...sv, name: publicName(sv), url: `${base}/servers/${sv.id}`, brand: brand().name }));
  });
}
