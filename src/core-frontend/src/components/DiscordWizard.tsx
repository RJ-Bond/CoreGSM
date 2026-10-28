import type { ReactNode } from 'react';
import type { Binding, BotStatus, DiscordGuild } from '../api';
import { IconCheck, IconRefresh } from '../icons';
import { t, useI18n } from '../i18n';

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

  const botText = i.bot?.state === 'connecting' ? t('d2.dw.bot.connecting')
    : i.bot?.state === 'error' ? t('d2.dw.bot.error')
      : t('d2.dw.bot.offline');

  const steps: WizardStep[] = [
    {
      id: 'token',
      title: t('d2.dw.s1.title'),
      state: stateOf(0),
      text: done[0] ? t('d2.dw.s1.done') : t('d2.dw.s1.todo'),
    },
    {
      id: 'bot',
      title: t('d2.dw.s2.title'),
      state: stateOf(1),
      text: done[1] ? `${t('d2.dw.s2.online')}${i.bot?.tag ? `: ${i.bot.tag}` : ''}.` : i.tokenSet ? botText : t('d2.dw.s2.first'),
      problem: !done[1] && i.bot?.state === 'error' && i.bot.error ? i.bot.error : undefined,
    },
    {
      id: 'guild',
      title: t('d2.dw.s3.title'),
      state: stateOf(2),
      text: done[2]
        ? t('d2.dw.s3.done', { n: guildCount })
        : t('d2.dw.s3.todo'),
    },
    {
      id: 'channel',
      title: t('d2.dw.s4.title'),
      state: stateOf(3),
      text: done[3]
        ? t('d2.dw.s4.done')
        : bound && missing.length > 0
          ? t('d2.dw.s4.missing', { list: missing.join(', ') })
          : i.serverCount === 0
            ? t('d2.dw.s4.addServer')
            : channels.length > 0
              ? t('d2.dw.s4.pick')
              : t('d2.dw.s4.noChannels'),
      problem: bound && missing.length > 0 ? t('d2.dw.s4.noPerms', { list: missing.join(', ') }) : undefined,
    },
    {
      id: 'message',
      title: t('d2.dw.s5.title'),
      state: stateOf(4),
      text: done[4] ? t('d2.dw.s5.done') : t('d2.dw.s5.todo'),
      problem: !done[4] ? i.bindings.find((b) => b.lastError)?.lastError ?? undefined : undefined,
    },
  ];
  return { steps, complete: first === -1, current: first };
}

/** Stepper card: shown while the connection is incomplete (or when reopened by hand). */
export function DiscordWizard({
  input, busy, onRecheck, onCreateBinding, inviteUrl, settingsHref = '/admin/settings/bot', onClose,
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
  useI18n();
  const { steps, complete, current } = computeWizard(input);
  const actionFor = (s: WizardStep): ReactNode => {
    if (s.state !== 'current') return null;
    if (s.id === 'token') return <a className="btn btn-sm" href={settingsHref}>{t('d2.dw.a.token')}</a>;
    if (s.id === 'bot') return <a className="btn btn-soft btn-sm" href={settingsHref}>{t('d2.dw.a.botSettings')}</a>;
    if (s.id === 'guild') return inviteUrl ? <a className="btn btn-sm" href={inviteUrl} target="_blank" rel="noreferrer">{t('d2.dw.a.invite')}<span aria-hidden>↗</span></a> : null;
    if (s.id === 'channel') {
      if (input.serverCount === 0) return <a className="btn btn-sm" href="/admin/servers/new">{t('d2.dw.a.addServer')}</a>;
      if (input.bindings.length === 0) return <button type="button" className="btn btn-sm" onClick={onCreateBinding}>{t('d2.dw.a.bind')}</button>;
      return null;
    }
    return null;
  };

  return (
    <section className="panel space-y-4 p-5 sm:p-6" aria-labelledby="dw-title" data-complete={complete ? 'true' : undefined}>
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <h2 id="dw-title" className="text-lg font-black">{t('d2.dw.title')}</h2>
          <p className="font-semibold text-mute">{complete ? t('d2.dw.ready') : t('d2.dw.step', { a: current + 1, b: steps.length })}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className="btn btn-soft btn-sm" onClick={onRecheck} disabled={busy} aria-busy={busy || undefined}>
            <IconRefresh spinning={busy} />
            {t('d2.dw.check')}
          </button>
          {onClose && <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>{t('d2.ac.cm.hide')}</button>}
        </div>
      </div>
      <ol className="dw-steps">
        {steps.map((s, n) => (
          <li key={s.id} className="dw-step" data-state={s.state} aria-current={s.state === 'current' ? 'step' : undefined}>
            <span className="dw-mark" aria-hidden>{s.state === 'done' ? <IconCheck size={16} /> : n + 1}</span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-x-2">
                <span className="font-black">{s.title}</span>
                <span className="sr-only">{s.state === 'done' ? t('d2.dw.sr.done') : s.state === 'current' ? t('d2.dw.sr.current') : t('d2.dw.sr.blocked')}</span>
              </div>
              {s.state !== 'blocked' && <p className="text-sm font-semibold text-mute">{s.text}</p>}
              {s.problem && s.state === 'current' && <p className="mt-1 rounded-xl bg-badbg px-3 py-1.5 text-sm font-bold text-bad" role="alert">{s.problem}</p>}
              {s.state === 'current' && (
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  {actionFor(s)}
                  <button type="button" className="btn btn-soft btn-sm" onClick={onRecheck} disabled={busy}>{t('d2.dw.checkAgain')}</button>
                </div>
              )}
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
