import { useRef, useState, useEffect } from 'react';
import { api, type Server } from '../api';
import { t, useI18n } from '../i18n';
import { CardsArt } from '../components/Illustrations';
import { promptDialog } from '../confirm';
import { AdminPage, Burst, Empty, ErrorLine, IconCards, LoadError, IconCheck, IconCopy, IconRefresh, PageHead, toast, usePoll } from '../ui';

export default function CardsPage() {
  useI18n();
  const [servers, setServers] = useState<Server[]>([]);
  const [loaded, setLoaded] = useState(false);
  // bumped by the "Обновить" button only; otherwise a picture is reloaded when the server's own data changed (updatedAt)
  const [forced, setForced] = useState(0);
  const [copied, setCopied] = useState<number | null>(null);
  const [error, setError] = useState('');
  const [style, setStyleS] = useState<'split' | 'strip'>(() => { try { return localStorage.getItem('coregsm_card_style') === 'strip' ? 'strip' : 'split'; } catch { return 'split'; } });
  const [theme, setThemeS] = useState<'dark' | 'light'>(() => { try { return localStorage.getItem('coregsm_card_theme') === 'light' ? 'light' : 'dark'; } catch { return 'dark'; } });
  const setStyle = (v: 'split' | 'strip') => { setStyleS(v); try { localStorage.setItem('coregsm_card_style', v); } catch { /* private mode */ } };
  const setTheme = (v: 'dark' | 'light') => { setThemeS(v); try { localStorage.setItem('coregsm_card_theme', v); } catch { /* private mode */ } };
  // the pictures refresh themselves every 30 seconds, so the page works as a live preview
  const [tick, setTick] = useState(0);
  useEffect(() => { const id = window.setInterval(() => setTick((n) => n + 1), 30_000); return () => window.clearInterval(id); }, []);
  const q = (extra = '') => `${style === 'strip' ? 'style=strip&' : ''}${theme === 'light' ? 'theme=light&' : ''}${extra}`.replace(/&$/, '');
  const copyTimer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(copyTimer.current), []);

  const load = () =>
    api<Server[]>('/servers')
      .then((s) => { setServers(s); setError(''); })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoaded(true));
  usePoll(load, 15_000);

  const copy = async (s: { id: number; name: string }, html = false) => {
    const link = `${window.location.origin}/api/card/${s.id}.png${q() ? `?${q()}` : ''}`;
    const url = html ? `<img src="${link}" alt="${s.name.replace(/"/g, "&quot;")}" width="600">` : link;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(s.id);
      toast(html ? t('cards.codeCopied') : t('cards.linkCopied'));
      window.clearTimeout(copyTimer.current);
      copyTimer.current = window.setTimeout(() => setCopied(null), 1800);
    } catch {
      await promptDialog({ title: html ? t('cards.code') : t('cards.imgLink'), label: html ? t('cards.copyCode') : t('cards.copyLink'), value: url, readOnly: true });
    }
  };

  const [spin, setSpin] = useState(false);
  const refresh = () => {
    setForced((n) => n + 1);
    setSpin(true);
    void load().finally(() => window.setTimeout(() => setSpin(false), 500));
  };

  return (
    <AdminPage
      head={(
        <PageHead
          icon={<IconCards />}
          title="Карточки"
          subtitle="Картинки состояния серверов"
          hint="Карточка — это картинка с онлайном сервера, которая обновляется сама. Ссылку на неё можно вставить на сайт или в чат."
          help={<p>Ссылка открыта: картинку видят все, у кого она есть. Бот использует такие же карточки в сообщениях Discord, если выбран стиль «Картинка» (раздел «Discord»).</p>}
        >
          <button className="btn btn-soft" onClick={refresh} aria-busy={spin || undefined}><IconRefresh spinning={spin} />Обновить</button>
        </PageHead>
      )}
    >
      {error && servers.length === 0 ? <LoadError error={error} onRetry={() => void load()} /> : <ErrorLine text={error} />}
      {!loaded && (
        <div className="grid gap-5 xl:grid-cols-2" aria-busy="true" aria-label="Загрузка">
          {[0, 1].map((i) => <div key={i} className="skeleton panel h-[330px]" />)}
        </div>
      )}
      {loaded && !error && servers.length === 0 && (
        <Empty art={<CardsArt />} title="Карточек пока нет" text="Сначала добавьте сервер на вкладке «Серверы»: для каждого появится своя картинка.">
          <a className="btn mt-3" href="/admin/servers/new">Добавить сервер</a>
        </Empty>
      )}
      {servers.length > 0 && (
        <div className="flex flex-wrap items-center gap-3">
          <div className="seg" role="group" aria-label={t('cards.style')}>
            <button type="button" className="seg-item" aria-pressed={style === 'split'} onClick={() => setStyle('split')}>{t('cards.split')}</button>
            <button type="button" className="seg-item" aria-pressed={style === 'strip'} onClick={() => setStyle('strip')}>{t('cards.strip')}</button>
          </div>
          <div className="seg" role="group" aria-label={t('cards.theme')}>
            <button type="button" className="seg-item" aria-pressed={theme === 'dark'} onClick={() => setTheme('dark')}>{t('cards.dark')}</button>
            <button type="button" className="seg-item" aria-pressed={theme === 'light'} onClick={() => setTheme('light')}>{t('cards.light')}</button>
          </div>
        </div>
      )}
      <div className="fade-in grid gap-5 lg:grid-cols-2">
        {servers.map((s) => (
          <div key={s.id} className="panel space-y-3 p-5">
            <img src={`/api/card/${s.id}.png?${q(`v=${s.updatedAt ?? 0}&r=${forced}&a=${tick}`)}`} alt={`Карточка ${s.name}`} loading="lazy" className="w-full rounded-ui-lg bg-soft" />
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="min-w-0 wrap-break-word font-black">{s.name}</span>
              <div className="flex flex-wrap gap-2">
                <button className="btn btn-soft btn-sm" onClick={() => void copy(s)}>
                  <span className="copy-ico" data-done={copied === s.id} aria-hidden>
                    <span className="ico-copy inline-grid"><IconCopy /></span>
                    <IconCheck size={16} className="ico-check" />
                    {copied === s.id && <Burst />}
                  </span>
                  {copied === s.id ? 'Скопировано' : 'Копировать ссылку'}
                </button>
                <button className="btn btn-soft btn-sm" onClick={() => void copy(s, true)} title={t('cards.codeTip')}>{t('cards.code')}</button>
                <a className="btn btn-soft btn-sm" href={`/api/card/${s.id}.png${q() ? `?${q()}` : ''}`} target="_blank" rel="noreferrer">Открыть</a>
                <a className="btn btn-soft btn-sm" href={`/api/card/${s.id}.png${q() ? `?${q()}` : ''}`} download={`card-${s.id}.png`}>{t('cards.download')}</a>
              </div>
            </div>
          </div>
        ))}
      </div>
      {servers.length > 1 && (
        <div className="panel space-y-3 p-5">
          <h2 className="font-black">{t('cards.all')}</h2>
          <p className="text-sm text-mute">{t('cards.allText')}</p>
          <img src={`/api/card/all.png?${theme === 'light' ? 'theme=light&' : ''}r=${forced}&a=${tick}`} alt={t('cards.all')} loading="lazy" className="w-full max-w-3xl rounded-ui-lg bg-soft" />
          <div className="flex flex-wrap gap-2">
            <button className="btn btn-soft btn-sm" onClick={() => { const u = `${window.location.origin}/api/card/all.png${theme === 'light' ? '?theme=light' : ''}`; void navigator.clipboard?.writeText(u).then(() => toast(t('cards.linkCopied')), () => undefined); }}>{t('cards.copyLinkBtn')}</button>
          </div>
        </div>
      )}
    </AdminPage>
  );
}
