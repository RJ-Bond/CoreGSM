// Pure helpers of the screenshot harness (no browser, no network): arguments, the page matrix, the report.

/** a named viewport, or a custom width: w900 -> 900 px wide */
export const viewportOf = (name) => {
  if (VIEWPORTS[name]) return VIEWPORTS[name];
  const m = /^w(\d{3,4})$/.exec(name);
  return m ? { width: Number(m[1]), height: 900, mobile: Number(m[1]) < 600 } : null;
};

export const VIEWPORTS = {
  desktop: { width: 1440, height: 900, mobile: false },
  tablet: { width: 820, height: 1100, mobile: false },
  phone: { width: 390, height: 844, mobile: true },
};

/** pages a guest can open (the panel is made public by the seed) */
export const GUEST_PAGES = [
  { id: 'servers', path: '/servers' },
  { id: 'server', path: '/servers/1' },
  { id: 'server-players', path: '/servers/1/players' },
  { id: 'server-history', path: '/servers/1/history' },
  { id: 'server-analytics', path: '/servers/1/analytics' },
  { id: 'server-events', path: '/servers/1/events' },
  { id: 'server-connect', path: '/servers/1/connect' },
  { id: 'server-offline', path: '/servers/8' },
  { id: 'news', path: '/news' },
  { id: 'news-item', path: '/news/1' },
  { id: 'status', path: '/status' },
  { id: 'community', path: '/community' },
  { id: 'gallery', path: '/gallery' },
  { id: 'login', path: '/login' },
  { id: 'register', path: '/register' },
  { id: 'not-found', path: '/404' },
];

/** pages of a signed-in administrator */
export const ADMIN_PAGES = [
  { id: 'admin-start', path: '/admin' },
  ...['servers', 'discord', 'news', 'alerts', 'maintenance', 'cards', 'community', 'users', 'journal', 'system'].map((s) => ({ id: `admin-${s}`, path: `/admin/${s}` })),
  ...['bot', 'brand', 'security', 'updates'].map((s) => ({ id: `admin-settings-${s}`, path: `/admin/settings/${s}` })),
  { id: 'profile', path: '/profile' },
];

export const HELP = `Screenshots and automatic UI checks of the panel (Chrome only, no extra packages).

  node tools/shots/run.mjs [options]

  --pages=a,b      page ids or "guest" / "admin" / "all"        (default: all)
  --viewports=a,b  desktop,tablet,phone or a width, w900                         (default: desktop,phone)
  --themes=a,b     dark,light                                    (default: dark)
  --base=URL       shoot a running panel instead of starting a demo stack (guest pages only unless --login is given)
  --login=user:pass  sign in on --base before the admin pages
  --out=DIR        where pictures and the report go              (default: shots-out)
  --full           full-page pictures (default: the first screen plus a full-page one)
  --no-axe         skip the accessibility scan (axe-core, WCAG A/AA, serious and critical only)
  --strict         warnings fail the run too
  --list           print the page ids and stop
  --keep           leave the demo stack running (prints its address)
`;

/** "--a=1 --b --c=x,y" -> { a: '1', b: true, c: 'x,y' } */
export function parseArgs(argv) {
  const out = {};
  for (const a of argv) {
    const m = /^--([a-z-]+)(?:=(.*))?$/i.exec(a);
    if (!m) throw new Error(`Unknown argument: ${a}`);
    out[m[1]] = m[2] === undefined ? true : m[2];
  }
  return out;
}

/** the list of {page, viewport, theme} to shoot; throws on an unknown name so a typo is not a silent empty run */
export function buildMatrix(opts, hasAdmin = true) {
  const all = [...GUEST_PAGES, ...ADMIN_PAGES.map((p) => ({ ...p, admin: true }))];
  const want = String(opts.pages ?? 'all').split(',').filter(Boolean);
  const picked = [];
  for (const w of want) {
    if (w === 'all') picked.push(...all);
    else if (w === 'guest') picked.push(...GUEST_PAGES);
    else if (w === 'admin') picked.push(...all.filter((p) => p.admin));
    else {
      const hit = all.filter((p) => p.id === w || p.id.startsWith(`${w}-`));
      if (!hit.length) throw new Error(`Unknown page "${w}". See --list.`);
      picked.push(...hit);
    }
  }
  const pages = [...new Map(picked.map((p) => [p.id, p])).values()].filter((p) => hasAdmin || !p.admin);
  const vps = String(opts.viewports ?? 'desktop,phone').split(',').filter(Boolean);
  for (const v of vps) if (!viewportOf(v)) throw new Error(`Unknown viewport "${v}" (desktop, tablet, phone or a width such as w900)`);
  const themes = String(opts.themes ?? 'dark').split(',').filter(Boolean);
  for (const t of themes) if (t !== 'dark' && t !== 'light') throw new Error(`Unknown theme "${t}" (dark, light)`);
  const rows = [];
  for (const theme of themes) for (const viewport of vps) for (const page of pages) rows.push({ page, viewport, theme });
  return rows;
}

/** "undefined", "NaN" and friends in the visible text of a page */
export const BAD_TEXT = /(?:^|[^\p{L}\p{N}_])(undefined|NaN|\[object Object\]|null|Invalid Date)(?![\p{L}\p{N}_])/u;

/** network answers that are not a bug of the page (a guest is not signed in; a missing optional picture) */
export function isExpectedFailure(url, status) {
  if (status === 401 && /\/api\/(me|auth\/session)(\?|$)/.test(url)) return true;
  if (/favicon\.ico|\/sw\.js/.test(url)) return true;
  return false;
}

/** sorts findings: errors first; returns the markdown report */
export function formatReport(results, { strict = false } = {}) {
  const errors = results.flatMap((r) => r.errors.map((m) => ({ r, m })));
  const warns = results.flatMap((r) => r.warnings.map((m) => ({ r, m })));
  const label = (r) => `${r.viewport}/${r.theme} ${r.id}`;
  const lines = ['# UI check report', '', `Pages shot: ${results.length}. Errors: ${errors.length}. Warnings: ${warns.length}.`, ''];
  if (errors.length) {
    lines.push('## Errors', '');
    for (const { r, m } of errors) lines.push(`- **${label(r)}**: ${m}  \n  ${r.file}`);
    lines.push('');
  }
  if (warns.length) {
    lines.push('## Warnings', '');
    for (const { r, m } of warns) lines.push(`- ${label(r)}: ${m}`);
    lines.push('');
  }
  if (!errors.length && !warns.length) lines.push('Nothing found.', '');
  const failed = errors.length > 0 || (strict && warns.length > 0);
  return { text: lines.join('\n'), failed, errors: errors.length, warnings: warns.length };
}
