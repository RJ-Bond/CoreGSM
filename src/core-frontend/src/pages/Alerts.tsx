import { useState } from 'react';
import DigestSection from '../components/DigestSection';
import { api, type SettingsInfo } from '../api';
import { ChannelPicker } from '../components/ChannelPicker';
import { AlertsArt } from '../components/Illustrations';
import { AdminPage, ErrorLine, GoLink, IconBell, LoadError, Notice, PageHead, Section, Switch, ago, toast, usePoll } from '../ui';

interface AlertsInfo {
  enabled: boolean;
  channelId: string;
  channelName: string | null;
  guildName: string | null;
  afterMin: number;
  mention: 'none' | 'here' | 'everyone';
  smart?: { low: boolean; ping: boolean; full: boolean };
  quiet?: { enabled: boolean; from: number; to: number; now: boolean };
  recent: { id: number; kind: keyof typeof KIND; serverName: string; status: string; error: string | null; createdAt: number; sentAt: number | null }[];
}

const KIND = {
  down: { label: 'Сервер упал', cls: 'pill-bad' },
  up: { label: 'Сервер вернулся', cls: 'pill-ok' },
  test: { label: 'Проверка', cls: 'pill-mute' },
  low: { label: 'Мало игроков', cls: 'pill-warn' },
  ping: { label: 'Вырос пинг', cls: 'pill-warn' },
  full: { label: 'Почти заполнен', cls: 'pill-mute' },
  digest: { label: 'Итоги недели', cls: 'pill-ok' },
  restart: { label: 'Перезапуск', cls: 'pill-mute' },
} as const;

const SMART: { key: 'low' | 'ping' | 'full'; title: string; text: string }[] = [
  { key: 'low', title: 'Необычно мало игроков', text: 'Онлайн 20 минут ниже трети обычного для этого дня недели и часа (по последним четырём неделям).' },
  { key: 'ping', title: 'Вырос пинг', text: 'Пинг 15 минут выше 150 мс и вдвое выше среднего за сутки.' },
  { key: 'full', title: 'Сервер почти заполнен', text: 'Занято 90% мест и больше 15 минут подряд: пора подумать о слотах.' },
];

/** what each kind of message looks like in the channel */
const SAMPLES: { kind: keyof typeof KIND; icon: string; text: string; on: (i: AlertsInfo) => boolean }[] = [
  { kind: 'down', icon: '🔴', text: 'Сервер «Survival» не отвечает уже 3 минуты', on: (i) => i.enabled },
  { kind: 'up', icon: '🟢', text: 'Сервер «Survival» снова в сети, простой 12 минут', on: (i) => i.enabled },
  { kind: 'low', icon: '📉', text: 'На «Survival» необычно мало игроков для этого часа', on: (i) => i.enabled && !!i.smart?.low },
  { kind: 'ping', icon: '📶', text: 'На «Survival» вырос пинг: 240 мс при обычных 60', on: (i) => i.enabled && !!i.smart?.ping },
  { kind: 'full', icon: '👥', text: '«Survival» заполнен на 94%', on: (i) => i.enabled && !!i.smart?.full },
];

/** the cards of the message kinds: a sample line and whether the kind is on */
function KindCards({ info }: { info: AlertsInfo }) {
  const where = info.channelId ? (info.channelName ? `# ${info.channelName}` : `канал ${info.channelId}`) : 'канал не выбран';
  return (
    <Section title="Какие сообщения приходят" description="Так они выглядят в канале; серые карточки выключены.">
      <div className="al-kinds">
        {SAMPLES.map((x) => {
          const on = x.on(info);
          return (
            <div key={x.kind} className={`al-kind ${on ? '' : 'is-off'}`}>
              <div className="flex items-center gap-2"><span className={`pill ${KIND[x.kind].cls}`}>{KIND[x.kind].label}</span><span className="ml-auto text-xs font-bold text-mute">{on ? 'включено' : 'выключено'}</span></div>
              <p className="al-msg"><span aria-hidden>{x.icon}</span> {x.text}</p>
              <p className="text-xs font-semibold text-mute">{where}</p>
            </div>
          );
        })}
      </div>
    </Section>
  );
}

const HOURS = Array.from({ length: 24 }, (_, h) => h);
const hh = (h: number) => `${String(h).padStart(2, '0')}:00`;

/** quiet hours: the messages keep coming, only without @here / @everyone */
function QuietHours({ info, save }: { info: AlertsInfo; save: (p: { quiet: { enabled: boolean; from: number; to: number } }, done?: string) => Promise<void> }) {
  const q = info.quiet ?? { enabled: false, from: 23, to: 8, now: false };
  const set = (patch: Partial<{ enabled: boolean; from: number; to: number }>) => void save({ quiet: { enabled: q.enabled, from: q.from, to: q.to, ...patch } });
  const span = q.from === q.to ? 0 : (q.to - q.from + 24) % 24;
  return (
    <Section title="Тихие часы" description="В эти часы сообщения о серверах всё равно приходят, но без @here и @everyone: никого не будят ночью.">
      <label className="flex cursor-pointer items-center gap-3">
        <Switch checked={q.enabled} onChange={(on) => set({ enabled: on })} />
        <span className="font-extrabold">Не упоминать в тихие часы</span>
        {q.enabled && <span className={`pill ml-auto ${q.now ? 'pill-warn' : 'pill-mute'}`}>{q.now ? 'сейчас тихие часы' : 'сейчас обычный режим'}</span>}
      </label>
      {q.enabled && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <label htmlFor="quiet-from" className="label">С</label>
              <select id="quiet-from" className="input" value={q.from} onChange={(e) => set({ from: Number(e.target.value) })}>{HOURS.map((h) => <option key={h} value={h}>{hh(h)}</option>)}</select>
            </div>
            <div>
              <label htmlFor="quiet-to" className="label">До</label>
              <select id="quiet-to" className="input" value={q.to} onChange={(e) => set({ to: Number(e.target.value) })}>{HOURS.map((h) => <option key={h} value={h}>{hh(h)}</option>)}</select>
            </div>
            <p className="pb-2 text-sm font-semibold text-mute">{span === 0 ? 'Начало и конец совпадают: тихих часов нет.' : `Тихих часов в сутки: ${span}. По времени панели.`}</p>
          </div>
          {/* the day at a glance: shaded cells are quiet */}
          <div className="qh-day" role="img" aria-label={`Тихие часы: с ${hh(q.from)} до ${hh(q.to)}`}>
            {HOURS.map((h) => {
              const quiet = span > 0 && (q.from < q.to ? h >= q.from && h < q.to : h >= q.from || h < q.to);
              return <span key={h} className={quiet ? 'is-quiet' : ''} title={`${hh(h)}${quiet ? ': тихо' : ''}`} />;
            })}
          </div>
          <div className="qh-ticks" aria-hidden><span>0</span><span>6</span><span>12</span><span>18</span><span>24</span></div>
        </div>
      )}
    </Section>
  );
}

/** the delivery queue in one line: how many left, are waiting, failed */
function Queue({ recent }: { recent: AlertsInfo['recent'] }) {
  const sent = recent.filter((r) => r.status === 'sent').length;
  const wait = recent.filter((r) => r.status === 'queued' || r.status === 'sending').length;
  const bad = recent.filter((r) => r.status === 'error').length;
  const pct = (n: number) => `${(n / recent.length) * 100}%`;
  return (
    <div className="space-y-1.5">
      <div className="al-queue" role="img" aria-label={`Отправлено ${sent}, ждёт ${wait}, ошибок ${bad}`}>
        <i className="is-ok" style={{ width: pct(sent) }} /><i className="is-warn" style={{ width: pct(wait) }} /><i className="is-bad" style={{ width: pct(bad) }} />
      </div>
      <p className="text-xs font-bold text-mute">Отправлено: {sent} · ждёт: {wait} · с ошибкой: {bad}{bad > 0 ? ' (они выше остальных)' : ''}</p>
    </div>
  );
}

/** Messages to a Discord channel when a game server stops answering and when it is back. */
export default function AlertsPage() {
  const [info, setInfo] = useState<AlertsInfo | null>(null);
  const [error, setError] = useState('');
  const [changing, setChanging] = useState(false);
  const [tokenSet, setTokenSet] = useState<boolean | null>(null);

  const load = () => {
    api<SettingsInfo>('/settings').then((s) => setTokenSet(s.discordTokenSet)).catch(() => undefined);
    return api<AlertsInfo>('/alerts').then((a) => { setInfo(a); setError(''); }).catch((e: Error) => setError(e.message));
  };
  usePoll(load, 10_000);

  const save = async (patch: Partial<Pick<AlertsInfo, 'enabled' | 'channelId' | 'afterMin' | 'mention' | 'smart'>> & { quiet?: { enabled: boolean; from: number; to: number } }, done?: string) => {
    await api<AlertsInfo>('/alerts', 'PUT', patch)
      .then((a) => { setInfo(a); setError(''); if (done) toast(done); })
      .catch((e: Error) => setError(e.message));
  };
  const test = async () => {
    await api<AlertsInfo>('/alerts/test', 'POST').then((a) => { setInfo(a); toast('Тестовое сообщение поставлено в очередь'); }).catch((e: Error) => setError(e.message));
  };

  return (
    <AdminPage
      narrow
      head={(
        <PageHead
          icon={<IconBell />}
          title="Оповещения"
          subtitle="Сообщение в Discord, когда игровой сервер перестал отвечать и когда вернулся"
          hint="Бот сам напишет в выбранный канал, если игровой сервер перестал отвечать, и сообщит, когда он вернулся."
          help={<p>Короткие сбои короче выбранного времени сообщений не вызывают. Упоминание @here или @everyone срабатывает только при падении. Перед включением можно отправить тестовое сообщение.</p>}
        >
          <button className="btn btn-soft" onClick={() => void test()} disabled={!info?.channelId}>Отправить тестовое сообщение</button>
        </PageHead>
      )}
    >
      {error && !info ? <LoadError error={error} onRetry={() => void load()} /> : <ErrorLine text={error} />}
      {tokenSet === false && (
        <Notice action={<GoLink href="/admin/settings/bot">Указать токен бота</GoLink>}>
          Оповещения не дойдут: у бота нет токена, он не подключён к Discord.
        </Notice>
      )}

      {info && (
        <Section>
          <label className="flex cursor-pointer items-start gap-3">
            <Switch className="mt-0.5" checked={info.enabled} onChange={(on) => void save({ enabled: on }, on ? 'Оповещения включены' : 'Оповещения выключены')} />
            <span>
              <span className="block font-extrabold">Оповещать о недоступности серверов</span>
              <span className="block text-sm font-semibold text-mute">Бот напишет в выбранный канал, а когда сервер вернётся, сообщит об этом и покажет, сколько он простоял.</span>
            </span>
          </label>

          <div>
            <span className="label">Канал для оповещений</span>
            <div className="flex flex-wrap items-center gap-3">
              <span className="font-black">{info.channelId ? (info.channelName ? `# ${info.channelName}${info.guildName ? ` · ${info.guildName}` : ''}` : `Канал ${info.channelId}`) : 'не выбран'}</span>
              <button className="btn btn-soft btn-sm" onClick={() => setChanging((v) => !v)} aria-expanded={changing}>{info.channelId ? 'Изменить' : 'Выбрать канал'}</button>
            </div>
            {changing && (
              <div className="mt-3">
                <ChannelPicker id="alerts-channel" value={info.channelId} onChange={(v) => { if (/^\d{15,25}$/.test(v)) { void save({ channelId: v }, 'Канал сохранён'); setChanging(false); } }} />
              </div>
            )}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="alerts-after" className="label">Считать сервер упавшим через</label>
              <select id="alerts-after" className="input" value={info.afterMin} onChange={(e) => void save({ afterMin: Number(e.target.value) }, 'Сохранено')}>
                {[1, 2, 3, 5, 10, 15, 30, 60].map((m) => <option key={m} value={m}>{m} {m === 1 ? 'минуту' : m < 5 ? 'минуты' : 'минут'} без ответа</option>)}
              </select>
              <p className="mt-1 text-sm font-semibold text-mute">Короткие сбои короче этого времени не отправляют сообщение.</p>
            </div>
            <div>
              <label htmlFor="alerts-mention" className="label">Кого упоминать при падении</label>
              <select id="alerts-mention" className="input" value={info.mention} onChange={(e) => void save({ mention: e.target.value as AlertsInfo['mention'] }, 'Сохранено')}>
                <option value="none">Никого</option>
                <option value="here">@here (кто в сети)</option>
                <option value="everyone">@everyone</option>
              </select>
              <p className="mt-1 text-sm font-semibold text-mute">Сообщение о возвращении сервера всегда без упоминания.</p>
            </div>
          </div>
        </Section>
      )}

      {info && (
        <Section title="Умные оповещения" description="Сервер работает, но что-то не так. Каждое правило срабатывает, только если условие держится какое-то время, и потом молчит несколько часов.">
          {SMART.map((r) => (
            <label key={r.key} className="flex cursor-pointer items-start gap-3">
              <Switch className="mt-0.5" checked={!!info.smart?.[r.key]} disabled={!info.enabled} onChange={(on) => void save({ smart: { ...(info.smart ?? { low: false, ping: false, full: false }), [r.key]: on } }, on ? 'Включено' : 'Выключено')} />
              <span>
                <span className="block font-extrabold">{r.title}</span>
                <span className="block text-sm font-semibold text-mute">{r.text}</span>
              </span>
            </label>
          ))}
          {!info.enabled && <p className="text-sm font-semibold text-mute">Сначала включите оповещения выше.</p>}
        </Section>
      )}

      {info && <KindCards info={info} />}

      {info && <QuietHours info={info} save={save} />}

      <DigestSection alertsChannel={info?.channelId ?? ''} />

      <Section title="Последние оповещения">
        {!info && <div className="skeleton h-14 rounded-ui-lg" aria-busy="true" aria-label="Загрузка" />}
        {info && info.recent.length === 0 && (
          <div className="fade-in flex flex-col items-center gap-1 py-2 text-center">
            <AlertsArt />
            <p className="font-extrabold">Пока ничего не отправлялось</p>
            <p className="max-w-sm text-sm font-semibold text-mute">
              {info.channelId ? 'Когда сервер перестанет отвечать, бот напишет в канал. Можно проверить заранее.' : 'Выберите канал: туда бот будет писать о падениях серверов.'}
            </p>
            {!info.channelId && <button className="btn mt-2" onClick={() => setChanging(true)}>Выбрать канал</button>}
          </div>
        )}
        {info && info.recent.length > 0 && <Queue recent={info.recent} />}
        <ul className="divide-y divide-line">
          {info && [...info.recent].sort((a, b) => Number(b.status === 'error') - Number(a.status === 'error')).map((r) => (
            <li key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5">
              <span className={`pill ${KIND[r.kind].cls}`}>{KIND[r.kind].label}</span>
              <span className="min-w-0 flex-1 truncate font-bold">{r.serverName}</span>
              {r.status === 'sent' && <span className="text-sm font-semibold text-mute">отправлено {ago(r.sentAt)}</span>}
              {(r.status === 'queued' || r.status === 'sending') && <span className="text-sm font-semibold text-warn">ждёт бота…</span>}
              {r.status === 'error' && <span className="text-sm font-bold text-bad" title={r.error ?? ''}>не отправлено: {r.error}</span>}
            </li>
          ))}
        </ul>
      </Section>
    </AdminPage>
  );
}
