import { useState } from 'react';
import { api, type Server } from '../api';
import { confirmDialog } from '../confirm';
import { t, useI18n } from '../i18n';
import { AdminPage, CopyButton, Empty, ErrorLine, Field, LoadError, PageHead, Section, IconServers, SkeletonRows, fmtDateTime, toast, usePoll } from '../ui';
import { IconKey } from '../icons';
import { badgeSnippets, type WidgetSize, type WidgetTheme } from './integrationsLogic';

interface ApiKey {
  id: number;
  name: string;
  prefix: string;
  createdAt: number;
  createdBy: string;
  lastUsedAt: number | null;
  revokedAt: number | null;
  rateLimit: number;
}
type Created = ApiKey & { key: string };

/** Admin → Интеграции: keys for the public API, snippets for badges and widgets. */
export default function AdminIntegrations() {
  useI18n();
  const [keys, setKeys] = useState<ApiKey[] | null>(null);
  const [servers, setServers] = useState<Server[]>([]);
  const [error, setError] = useState('');
  const load = () =>
    Promise.all([api<ApiKey[]>('/integrations/keys'), api<Server[]>('/servers')])
      .then(([k, s]) => { setKeys(k); setServers(s); setError(''); })
      .catch((e: Error) => setError(e.message));
  usePoll(load, 30_000);

  return (
    <AdminPage
      head={<PageHead icon={<IconKey />} title={t('intg.title')} subtitle={t('intg.sub')} />}
    >
      {error && <LoadError error={error} onRetry={() => void load()} />}
      <KeysSection keys={keys} onChanged={() => void load()} />
      <SnippetsSection servers={servers} />
    </AdminPage>
  );
}

function KeysSection({ keys, onChanged }: { keys: ApiKey[] | null; onChanged: () => void }) {
  const [name, setName] = useState('');
  const [limit, setLimit] = useState('60');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [created, setCreated] = useState<Created | null>(null);

  const create = async () => {
    setBusy(true);
    setError('');
    try {
      const c = await api<Created>('/integrations/keys', 'POST', { name: name.trim(), rateLimit: Number(limit) || 60 });
      setCreated(c);
      setName('');
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const revoke = async (k: ApiKey) => {
    if (!(await confirmDialog({ title: t('intg.revoke.t', { name: k.name }), text: t('intg.revoke.x'), confirmLabel: t('intg.revoke'), danger: true }))) return;
    try {
      await api(`/integrations/keys/${k.id}`, 'DELETE');
      toast(t('intg.revoked'));
      if (created?.id === k.id) setCreated(null);
      onChanged();
    } catch (e) {
      toast((e as Error).message);
    }
  };

  const active = (keys ?? []).filter((k) => !k.revokedAt);
  const revoked = (keys ?? []).filter((k) => k.revokedAt);
  const origin = window.location.origin;

  return (
    <Section title={t('intg.keys.title')} description={t('intg.keys.desc')}>
      {created && (
        <div className="space-y-2 rounded-2xl border border-line bg-soft p-4" role="status">
          <p className="font-extrabold">{t('intg.created', { name: created.name })}</p>
          <div className="flex flex-wrap items-center gap-2">
            <code className="min-w-0 flex-1 break-all rounded-xl bg-bg px-3 py-2 font-mono text-sm font-bold">{created.key}</code>
            <CopyButton text={created.key} />
            <button type="button" className="btn btn-soft btn-sm" onClick={() => setCreated(null)}>{t('intg.saved')}</button>
          </div>
          <p className="text-sm font-semibold text-mute">{t('intg.example')} <code className="break-all">curl -H &quot;Authorization: Bearer {created.key}&quot; {origin}/api/v1/servers</code></p>
        </div>
      )}
      <form className="grid items-end gap-3 sm:grid-cols-[1fr_9rem_auto]" onSubmit={(e) => { e.preventDefault(); void create(); }}>
        <Field label={t('intg.f.name')}>
          <input className="input" value={name} maxLength={60} placeholder={t('intg.f.namePh')} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label={t('intg.f.limit')}>
          <input className="input" type="number" min={1} max={6000} value={limit} onChange={(e) => setLimit(e.target.value)} />
        </Field>
        <button type="submit" className="btn" disabled={busy || !name.trim()}>{t('intg.create')}</button>
      </form>
      <ErrorLine text={error} />

      {keys === null && <SkeletonRows n={2} />}
      {keys && !keys.length && <Empty title={t('intg.empty.t')} text={t('intg.empty.x')} art={<IconKey />} />}
      {active.length > 0 && (
        <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line">
          {active.map((k) => (
            <li key={k.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3">
              <div className="min-w-0 flex-1 basis-48">
                <div className="truncate font-extrabold">{k.name}</div>
                <div className="text-sm font-semibold text-mute"><code>{k.prefix}…</code> · {t('intg.rate', { n: k.rateLimit })}</div>
              </div>
              <div className="text-sm font-semibold text-mute">
                {k.createdBy ? t('intg.createdBy', { when: fmtDateTime(k.createdAt), who: k.createdBy }) : t('intg.createdAt', { when: fmtDateTime(k.createdAt) })}<br />
                {k.lastUsedAt ? t('intg.usedAt', { when: fmtDateTime(k.lastUsedAt) }) : t('intg.unused')}
              </div>
              <button type="button" className="btn btn-soft btn-sm" onClick={() => void revoke(k)}>{t('intg.revoke')}</button>
            </li>
          ))}
        </ul>
      )}
      {revoked.length > 0 && (
        <details className="text-sm font-semibold text-mute">
          <summary className="cursor-pointer">{t('intg.revokedList', { n: revoked.length })}</summary>
          <ul className="mt-2 space-y-1">
            {revoked.map((k) => <li key={k.id}>{k.name} · <code>{k.prefix}…</code> · {t('intg.revokedAt', { when: fmtDateTime(k.revokedAt!) })}</li>)}
          </ul>
        </details>
      )}
      <p className="text-sm font-semibold text-mute">
        {t('intg.openapi')} <a className="text-link underline" href="/api/v1/openapi.json" target="_blank" rel="noreferrer">/api/v1/openapi.json</a>. {t('intg.hdr')}
      </p>
    </Section>
  );
}

const WIDGET_PX = { s: { w: 240, h: 120 }, m: { w: 320, h: 140 }, l: { w: 420, h: 170 } } as const;

function SnippetsSection({ servers }: { servers: Server[] }) {
  const [sel, setSel] = useState<number | null>(null);
  const id = sel ?? servers[0]?.id ?? null;
  const s = servers.find((x) => x.id === id);
  const [theme, setTheme] = useState<WidgetTheme>('auto');
  const [size, setSize] = useState<WidgetSize>('m');
  const [cardStyle, setCardStyle] = useState<'split' | 'strip'>('split');
  const [cardTheme, setCardTheme] = useState<'dark' | 'light'>('dark');
  const sn = s ? badgeSnippets(window.location.origin, s.id, s.customName || s.name, { theme, size, cardStyle, cardTheme }) : null;
  return (
    <Section title={t('intg.snip.title')} description={t('intg.snip.desc')}>
      {!servers.length ? (
        <Empty art={<IconServers />} title={t('intg.snip.none.t')} text={t('intg.snip.none.x')} />
      ) : (
        <>
          <Field label={t('intg.snip.server')}>
            <select className="input" value={id ?? ''} onChange={(e) => setSel(Number(e.target.value))}>
              {servers.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
            </select>
          </Field>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Field label={t('intg.opt.theme')}>
              <select className="input" value={theme} onChange={(e) => setTheme(e.target.value as WidgetTheme)}>
                <option value="auto">{t('intg.opt.auto')}</option>
                <option value="light">{t('intg.opt.light')}</option>
                <option value="dark">{t('intg.opt.dark')}</option>
              </select>
            </Field>
            <Field label={t('intg.opt.size')}>
              <select className="input" value={size} onChange={(e) => setSize(e.target.value as WidgetSize)}>
                <option value="s">{t('intg.opt.sizeS')}</option>
                <option value="m">{t('intg.opt.sizeM')}</option>
                <option value="l">{t('intg.opt.sizeL')}</option>
              </select>
            </Field>
            <Field label={t('intg.opt.cardStyle')}>
              <select className="input" value={cardStyle} onChange={(e) => setCardStyle(e.target.value as 'split' | 'strip')}>
                <option value="split">{t('intg.opt.split')}</option>
                <option value="strip">{t('intg.opt.strip')}</option>
              </select>
            </Field>
            <Field label={t('intg.opt.cardTheme')}>
              <select className="input" value={cardTheme} onChange={(e) => setCardTheme(e.target.value as 'dark' | 'light')}>
                <option value="dark">{t('intg.opt.dark')}</option>
                <option value="light">{t('intg.opt.light')}</option>
              </select>
            </Field>
          </div>
          {sn && (
            <div className="grid items-start gap-4 md:grid-cols-2">
              <div className="space-y-3">
                <div className="flex min-h-12 items-center rounded-2xl bg-soft px-4"><img src={sn.badge} alt={t('intg.snip.badgeAlt')} height={20} /></div>
                <Snippet label={t('intg.snip.md')} text={sn.markdown} />
                <Snippet label="HTML" text={sn.html} />
                <Snippet label="BBCode" text={sn.bbcode} />
              </div>
              <div className="space-y-3">
                <iframe key={sn.widget} title={t('intg.snip.widgetTitle')} src={sn.widget} style={{ width: `min(100%, ${WIDGET_PX[size].w}px)`, height: WIDGET_PX[size].h }} className="block rounded-2xl border-0" loading="lazy" />
                <Snippet label={t('intg.snip.widget')} text={sn.iframe} />
              </div>
              <div className="space-y-3 md:col-span-2">
                <img key={sn.card} src={sn.card} alt={t('intg.snip.cardAlt')} className="block h-auto max-w-full rounded-2xl" loading="lazy" />
                <div className="grid gap-3 md:grid-cols-2">
                  <Snippet label={t('intg.snip.cardHtml')} text={sn.cardHtml} />
                  <Snippet label={t('intg.snip.cardMd')} text={sn.cardMarkdown} />
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </Section>
  );
}

function Snippet({ label, text }: { label: string; text: string }) {
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-2">
        <span className="label">{label}</span>
        <CopyButton text={text} />
      </div>
      <textarea aria-label={label} className="input font-mono text-xs" readOnly rows={3} value={text} onFocus={(e) => e.currentTarget.select()} />
    </div>
  );
}
