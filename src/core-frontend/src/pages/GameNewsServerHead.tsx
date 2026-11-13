import { useState } from 'react';
import { api } from '../api';
import { t, useI18n } from '../i18n';
import { versionLess, type NewsServerInfo, type RulesState } from '../gameNews';
import { errText, toast } from '../ui';

/** «3 с назад» / «5 мин назад» / «2 ч назад» */
function ago(ts: number): string {
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (s < 90) return t('gn.ago.s', { n: s });
  if (s < 5400) return t('gn.ago.m', { n: Math.round(s / 60) });
  return t('gn.ago.h', { n: Math.round(s / 3600) });
}

/** opens a card (when it is folded) and brings it into view */
function goTo(card: string): void {
  const el = document.getElementById(`gn-card-${card}`);
  if (!el) return;
  const head = el.querySelector<HTMLButtonElement>('button[aria-expanded="false"]');
  head?.click();
  el.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/** the top of a server's page: who it is, is the plugin alive, what is on here (a click goes to the card) */
export function ServerHead({ server, rd, latest }: { server: NewsServerInfo; rd: RulesState; latest: string }) {
  useI18n();
  const [busy, setBusy] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [lang, setLang] = useState<'ru' | 'en'>(server.lang ?? 'ru');
  // «Обновить плагин»: the plugin downloads the newest release, it takes effect at the next restart; the answer is waited for a minute
  const update = async () => {
    setUpdating(true);
    try {
      const { id } = await api<{ id: number }>(`/game-news/targets/${server.id}/update`, 'POST');
      toast(t('gn.sh.updateSent'));
      for (let i = 0; i < 30; i++) {
        await new Promise((r) => setTimeout(r, 2000));
        const c = await api<{ state: string; result: string }>(`/game-news/commands/${id}`);
        if (c.state === 'done') { toast(c.result || t('gn.sh.updateDone')); return; }
        if (c.state === 'failed') { toast(c.result || t('gn.sh.updateFailed'), 'err'); return; }
      }
      toast(t('gn.sh.updateSlow'), 'err');
    } catch (e) { toast(errText(e), 'err'); } finally { setUpdating(false); }
  };
  const saveLang = async (v: 'ru' | 'en') => {
    setLang(v);
    try { await api(`/game-news/targets/${server.id}/lang`, 'PUT', { lang: v }); toast(t('gn.sh.langSaved')); } catch (e) { toast(errText(e), 'err'); }
  };
  const old = server.online && versionLess(server.pluginVersion, latest);
  const test = async () => {
    setBusy(true);
    try {
      await api('/game-news/send', 'POST', { serverIds: [server.id], text: `<color=#6EC1FF>* ${t('gn.sh.testText')}</color>` });
      toast(server.online ? t('gn.sh.testSent') : t('gn.sh.testQueued'));
    } catch (e) { toast(errText(e), 'err'); } finally { setBusy(false); }
  };
  const chips: { card: string; label: string; on: boolean }[] = [
    { card: 'welcome', label: t('gn.sh.welcome'), on: rd.welcome.enabled },
    { card: 'joinleave', label: t('gn.sh.joinleave'), on: rd.joinLeave.joinEnabled || rd.joinLeave.leaveEnabled },
    { card: 'register', label: t('gn.sh.register'), on: rd.register.enabled },
    { card: 'chat', label: t('gn.sh.chat'), on: rd.chat.enabled && rd.chat.set },
  ];
  return (
    <section className="panel space-y-3 p-5">
      <div className="flex flex-wrap items-start gap-3">
        <span aria-hidden className={`mt-2 inline-block h-3 w-3 shrink-0 rounded-full ${server.online ? 'bg-ok' : 'bg-mute'}`} />
        <div className="min-w-0 flex-1 basis-64">
          <h3 className="wrap-break-word text-lg font-extrabold">{server.name}</h3>
          <p className="text-sm font-semibold text-mute">
            {server.address}
            {server.pluginVersion && ` · v${server.pluginVersion}`}
            {server.lastSeen ? ` · ${t('gn.plugin.lastPoll', { time: ago(server.lastSeen) })}` : ''}
            {server.players != null && ` · ${t('gn.players', { n: server.players, max: server.maxPlayers ?? 0 })}`}
          </p>
          {server.pluginProblems && <p className="text-sm font-semibold text-danger">{t('gn.sh.problems', { list: server.pluginProblems })}</p>}
          {old && <p className="text-sm font-semibold text-warn">{t('gn.sh.old', { v: latest })} · <a className="text-link hover:underline" href="https://github.com/RJ-Bond/CoreGSM-Plugin/releases/latest" target="_blank" rel="noreferrer noopener">{t('gn.sh.download')}</a></p>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select className="input w-auto py-1 text-sm" value={lang} aria-label={t('gn.sh.lang')} title={t('gn.sh.langHint')} onChange={(e) => void saveLang(e.target.value === 'en' ? 'en' : 'ru')}>
            <option value="ru">RU</option>
            <option value="en">EN</option>
          </select>
          {server.online && (
            <button type="button" className={old || server.pluginProblems ? 'btn btn-sm' : 'btn btn-soft btn-sm'} disabled={updating} title={t('gn.sh.updateHint')} onClick={() => void update()}>{t('gn.sh.update')}</button>
          )}
          <button type="button" className="btn btn-soft btn-sm" disabled={busy} onClick={() => void test()}>{t('gn.sh.test')}</button>
        </div>
      </div>
      <div className="flex flex-wrap gap-2" role="group" aria-label={t('gn.sh.sum')}>
        {chips.map((c) => (
          <button key={c.card} type="button" className={`chip-filter gap-1.5 ${c.on ? 'on' : ''}`} onClick={() => goTo(c.card)}>
            <span aria-hidden>{c.on ? '●' : '○'}</span> {c.label}
          </button>
        ))}
      </div>
    </section>
  );
}
