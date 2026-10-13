import type { ReactNode } from 'react';
import type { Binding, BotStatus, DiscordGuild } from '../api';
import { IconCheck, IconRefresh } from '../icons';

export type WizardState = 'done' | 'current' | 'blocked';

export interface WizardInput {
  tokenSet: boolean;
  bot: BotStatus | null;
  guilds: DiscordGuild[];
  bindings: Binding[];
  serverCount: number;
}

export interface WizardStep {
  id: 'token' | 'bot' | 'guild' | 'channel' | 'message';
  title: string;
  state: WizardState;
  /** what to do now (or what was achieved, for finished steps) */
  text: string;
  /** a problem found at this step (permissions, bot error) */
  problem?: string;
}

/** The five steps of connecting the bot, computed from /settings, /bot/status, /discord/channels and /bindings. */
export function computeWizard(i: WizardInput): { steps: WizardStep[]; complete: boolean; current: number } {
  const botOnline = i.bot?.state === 'online';
  const guildCount = typeof i.bot?.guildCount === 'number' ? i.bot.guildCount : i.guilds.length;
  const channels = i.guilds.flatMap((g) => g.channels);
  const bound = i.bindings.length > 0;
  const missing = Array.from(new Set(i.bindings.flatMap((b) => channels.find((c) => c.id === b.channelId)?.missing ?? [])));
  const posted = i.bindings.some((b) => !!b.messageId || !!b.lastUpdate);

  const done = [i.tokenSet, i.tokenSet && botOnline, i.tokenSet && botOnline && guildCount > 0, bound && missing.length === 0, posted && bound];
  const first = done.findIndex((d) => !d);
  const stateOf = (n: number): WizardState => (done[n] ? 'done' : n === first ? 'current' : 'blocked');

  const botText = i.bot?.state === 'connecting' ? 'Бот подключается к Discord, это занимает несколько секунд. Нажмите «Проверить», чтобы обновить.'
    : i.bot?.state === 'error' ? 'Discord не принял токен или недоступен. Проверьте токен и прокси в настройках, затем проверьте снова.'
      : 'Бот ещё не в сети. Сохраните токен: подключение начнётся само.';

  const steps: WizardStep[] = [
    {
      id: 'token',
      title: 'Токен введён',
      state: stateOf(0),
      text: done[0] ? 'Токен бота сохранён в настройках.' : 'Создайте бота в Discord Developer Portal и вставьте его токен в настройках панели.',
    },
    {
      id: 'bot',
      title: 'Бот подключён',
      state: stateOf(1),
      text: done[1] ? `Бот в сети${i.bot?.tag ? `: ${i.bot.tag}` : ''}.` : i.tokenSet ? botText : 'Сначала введите токен.',
      problem: !done[1] && i.bot?.state === 'error' && i.bot.error ? i.bot.error : undefined,
    },
    {
      id: 'guild',
      title: 'Бот приглашён на сервер Discord',
      state: stateOf(2),
      text: done[2]
        ? `Бот есть на серверах Discord: ${guildCount}.`
        : 'Откройте приглашение, выберите свой сервер Discord и подтвердите права бота. Потом нажмите «Проверить».',
    },
    {
      id: 'channel',
      title: 'Канал выбран, права в порядке',
      state: stateOf(3),
      text: done[3]
        ? 'Канал привязан, у бота есть права на встраивания и файлы.'
        : bound && missing.length > 0
          ? `В выбранном канале боту не хватает прав: ${missing.join(', ')}. Выдайте их роли бота в настройках канала и нажмите «Проверить».`
          : i.serverCount === 0
            ? 'Сначала добавьте игровой сервер, который бот будет показывать.'
            : channels.length > 0
              ? 'Выберите канал и игровой сервер: бот будет публиковать там одно обновляемое сообщение.'
              : 'Бот пока не видит каналов, куда может писать. Выдайте его роли права «Просмотр канала», «Отправка сообщений», «Встраивание ссылок», «Прикрепление файлов».',
      problem: bound && missing.length > 0 ? `Нет прав: ${missing.join(', ')}` : undefined,
    },
    {
      id: 'message',
      title: 'Первое сообщение опубликовано',
      state: stateOf(4),
      text: done[4] ? 'Бот отправил сообщение и обновляет его по таймеру.' : 'Бот отправит сообщение в течение минуты после создания привязки. Нажмите «Проверить», чтобы увидеть результат.',
      problem: !done[4] ? i.bindings.find((b) => b.lastError)?.lastError ?? undefined : undefined,
    },
  ];
  return { steps, complete: first === -1, current: first };
}

/** Stepper card: shown while the connection is incomplete (or when reopened by hand). */
export function DiscordWizard({
  input, busy, onRecheck, onCreateBinding, inviteUrl, settingsHref = '#/admin/settings/bot', onClose,
}: {
  input: WizardInput;
  busy: boolean;
  onRecheck: () => void;
  onCreateBinding: () => void;
  inviteUrl: string | null;
  settingsHref?: string;
  /** shown only when the wizard was reopened after completion */
  onClose?: () => void;
}) {
  const { steps, complete, current } = computeWizard(input);
  const actionFor = (s: WizardStep): ReactNode => {
    if (s.state !== 'current') return null;
    if (s.id === 'token') return <a className="btn btn-sm" href={settingsHref}>Указать токен</a>;
    if (s.id === 'bot') return <a className="btn btn-soft btn-sm" href={settingsHref}>Открыть настройки бота</a>;
    if (s.id === 'guild') return inviteUrl ? <a className="btn btn-sm" href={inviteUrl} target="_blank" rel="noreferrer">Открыть приглашение<span aria-hidden>↗</span></a> : null;
    if (s.id === 'channel') {
      if (input.serverCount === 0) return <a className="btn btn-sm" href="#/admin/servers/new">Добавить сервер</a>;
      if (input.bindings.length === 0) return <button type="button" className="btn btn-sm" onClick={onCreateBinding}>Создать первую привязку</button>;
      return null;
    }
    return null;
  };

  return (
    <section className="panel space-y-4 p-5 sm:p-6" aria-labelledby="dw-title" data-complete={complete ? 'true' : undefined}>
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <h2 id="dw-title" className="text-lg font-black">Мастер подключения</h2>
          <p className="font-semibold text-mute">{complete ? 'Всё готово: бот публикует сообщения.' : `Шаг ${current + 1} из ${steps.length}`}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className="btn btn-soft btn-sm" onClick={onRecheck} disabled={busy} aria-busy={busy || undefined}>
            <IconRefresh spinning={busy} />
            Проверить
          </button>
          {onClose && <button type="button" className="btn btn-soft btn-sm" onClick={onClose}>Скрыть</button>}
        </div>
      </div>
      <ol className="dw-steps">
        {steps.map((s, n) => (
          <li key={s.id} className="dw-step" data-state={s.state} aria-current={s.state === 'current' ? 'step' : undefined}>
            <span className="dw-mark" aria-hidden>{s.state === 'done' ? <IconCheck size={16} /> : n + 1}</span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-x-2">
                <span className="font-black">{s.title}</span>
                <span className="sr-only">{s.state === 'done' ? ': выполнено' : s.state === 'current' ? ': текущий шаг' : ': недоступно, пока не выполнены предыдущие шаги'}</span>
              </div>
              {s.state !== 'blocked' && <p className="text-sm font-semibold text-mute">{s.text}</p>}
              {s.problem && s.state === 'current' && <p className="mt-1 rounded-xl bg-badbg px-3 py-1.5 text-sm font-bold text-bad" role="alert">{s.problem}</p>}
              {s.state === 'current' && (
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  {actionFor(s)}
                  <button type="button" className="btn btn-soft btn-sm" onClick={onRecheck} disabled={busy}>Проверить снова</button>
                </div>
              )}
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
