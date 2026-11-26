/** The card of the game chat in Discord, with the preview of the messages. */
import { Fragment, useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { Switch } from '../components/Switch';
import { FoldCard } from '../components/GameNewsParts';
import { t, useI18n } from '../i18n';
import { ANSI_COLORS, CHAT_KINDS, CHAT_PRESETS, type AnsiColor, type ChatColors, type ChatKind, type ChatSettings } from '../gameNews';
import { ScopeNote, useScope } from './GameNewsScope';
import { SayCheck } from './GameNewsSayCheck';
import { Field, SaveBadge, errText, toast, useAutosave } from '../ui';

/** the colours of an ansi block of Discord, as Discord draws them on a dark background */
const ANSI_CSS: Record<AnsiColor, string> = {
  gray: '#8a919a', red: '#dc322f', green: '#859900', yellow: '#b58900', blue: '#268bd2', pink: '#d33682', cyan: '#2aa198', white: '#ffffff',
};

/** one colour of the eight: a swatch and a list */
function AnsiSelect({ value, onChange, label }: { value: AnsiColor; onChange: (v: AnsiColor) => void; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span aria-hidden className="inline-block h-3.5 w-3.5 shrink-0 rounded-full border border-line" style={{ background: ANSI_CSS[value] }} />
      <select className="input w-32 py-1 text-sm" value={value} aria-label={label} onChange={(e) => onChange(e.target.value as AnsiColor)}>
        {ANSI_COLORS.map((c) => <option key={c} value={c}>{t(`gn.ch.c.${c}` as 'gn.ch.c.gray')}</option>)}
      </select>
    </span>
  );
}

/** the sample lines of the chat as Discord will draw them (colours of the ansi block) */
function DiscordPreview({ colors, joinText, leaveText, kickText, showTime, sender }: { colors: Record<ChatKind, ChatColors>; joinText: string; leaveText: string; kickText: string; showTime: boolean; sender: string }) {
  const nick = 'WhiteLegioN';
  const clock = new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  const name = sender.trim() || t('gn.ch.webhookName');
  const chat = (k: 'global' | 'clan' | 'local', tag: string, text: string) => (
    <p key={k} className="wrap-break-word">
      {showTime && <span style={{ color: ANSI_CSS[colors[k].tag] }}>[{clock}] </span>}
      <span style={{ color: ANSI_CSS[colors[k].tag], fontWeight: 800 }}>[«{tag}»]</span>{' '}
      <span style={{ color: ANSI_CSS[colors[k].name], fontWeight: 800 }}>{nick}</span>
      <span style={{ color: ANSI_CSS[colors[k].text] }}>: {text}</span>
    </p>
  );
  const event = (k: 'join' | 'leave', template: string) => {
    const parts = template.replace(/[<>]/g, '').split('{name}');
    return (
      <p key={k} className="wrap-break-word">
        {showTime && <span style={{ color: ANSI_CSS[colors[k].text] }}>[{clock}] </span>}
        {parts.map((p, i) => (
          <span key={i}>
            <span style={{ color: ANSI_CSS[colors[k].text] }}>{p}</span>
            {i < parts.length - 1 && <span style={{ color: ANSI_CSS[colors[k].name], fontWeight: 800 }}>{nick}</span>}
          </span>
        ))}
      </p>
    );
  };
  // a kick: the words red, the nickname green, the reason (the «tag» colour) yellow
  const kick = () => (
    <p key="kick" className="wrap-break-word">
      {showTime && <span style={{ color: ANSI_CSS[colors.kick.text] }}>[{clock}] </span>}
      {kickText.replace(/[<>]/g, '').split(/(\{(?:name|reason|admin)\})/).filter(Boolean).map((p, i) => (
        p === '{name}' ? <span key={i} style={{ color: ANSI_CSS[colors.kick.name], fontWeight: 800 }}>{nick}</span>
          : p === '{reason}' ? <span key={i} style={{ color: ANSI_CSS[colors.kick.tag], fontWeight: 800 }}>{t('gn.kk.sampleReason')}</span>
            : p === '{admin}' ? <span key={i} style={{ color: ANSI_CSS.cyan, fontWeight: 800 }}>{t('gn.kk.sampleAdmin')}</span>
              : <span key={i} style={{ color: ANSI_CSS[colors.kick.text] }}>{p}</span>
      ))}
    </p>
  );
  // a message of the panel: the mark, the name of the rule, the words
  const announce = () => (
    <p key="announce" className="wrap-break-word">
      {showTime && <span style={{ color: ANSI_CSS[colors.announce.text] }}>[{clock}] </span>}
      <span style={{ color: ANSI_CSS[colors.announce.tag], fontWeight: 800 }}>* [{t('gn.ch.ann.sampleLabel')}]</span>{' '}
      <span style={{ color: ANSI_CSS[colors.announce.name], fontWeight: 800 }}>{t('gn.ch.ann.sampleName')}</span>
      <span style={{ color: ANSI_CSS[colors.announce.text] }}>: {t('gn.ch.ann.sampleText')}</span>
    </p>
  );
  // a message of a webhook as Discord draws it: a round picture, the name with the «БОТ» mark, the time, the code block
  return (
    <div className="flex gap-3 rounded-lg p-3" style={{ background: '#313338', color: '#dbdee1' }} aria-label={t('gn.ch.look')}>
      <span aria-hidden className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-extrabold" style={{ background: '#5865f2', color: '#fff' }}>
        {name.slice(0, 1).toUpperCase()}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="font-bold text-white">{name}</span>
          <span className="rounded px-1 text-fs-2xs font-extrabold uppercase" style={{ background: '#5865f2', color: '#fff' }}>{t('gn.ch.botMark')}</span>
          <span className="text-xs" style={{ color: '#949ba4' }}>{t('gn.ch.today', { time: clock })}</span>
        </div>
        <div className="mt-1 rounded-md border p-3 font-mono text-sm leading-relaxed" style={{ background: '#2b2d31', borderColor: '#1e1f22' }}>
          {chat('global', t('gn.ch.label.global'), 'Привет всем!')}
          {chat('clan', `${t('gn.ch.label.clan')} Ночные`, 'Сбор у замка')}
          {chat('local', t('gn.ch.label.local'), 'Кто рядом?')}
          {event('join', joinText)}
          {event('leave', leaveText)}
          {kick()}
          {announce()}
        </div>
      </div>
    </div>
  );
}

/**
 * The chat of the game server for the administrators in Discord: one channel (its webhook), a switch for each kind of
 * line that goes there and how the lines look (the colours of the game, or plain). The address is a secret: it is sent
 * to the panel and never shown again (only «set» and the tail).
 */
export function ChatCard({ initial, joinText, leaveText, kickText }: { initial: ChatSettings; joinText: string; leaveText: string; kickText: string }) {
  useI18n();
  const sc = useScope();
  const [st, setSt] = useState<ChatSettings>(initial);
  const [busy, setBusy] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState('');
  const hookInput = useRef<HTMLInputElement>(null);
  // the address box takes the focus when it opens
  useEffect(() => { if (editing) hookInput.current?.focus(); }, [editing]);

  const refresh = () => api<{ chat: ChatSettings }>(`/game-news/rules${sc.q}`).then((d) => setSt(d.chat)).catch(() => undefined);
  const send = async (body: Record<string, unknown>, who: string, quiet = false): Promise<boolean> => {
    setBusy(who);
    try { await api(`/game-news/chat-settings${sc.q}`, 'PUT', body); await refresh(); sc.changed(); if (!quiet) toast(t('gn.ch.saved')); return true; } catch (e) { toast(errText(e), 'err'); return false; } finally { setBusy(null); }
  };
  const test = async (palette = false) => {
    setBusy('test');
    try {
      const r = await api<{ ok: boolean }>(`/game-news/chat-test${sc.q}${palette ? `${sc.q ? '&' : '?'}palette=1` : ''}`, 'POST');
      toast(r.ok ? t('gn.ch.testOk') : t('gn.ch.testFail'), r.ok ? undefined : 'err');
    } catch (e) { toast(errText(e), 'err'); } finally { setBusy(null); }
  };

  // how the lines look: saved by itself a moment after a change
  const [look, setLook] = useState({ style: initial.style, senderName: initial.senderName, showTime: initial.showTime, colors: initial.colors });
  const [lookSaved, setLookSaved] = useState(look);
  const auto = useAutosave({
    value: look,
    saved: lookSaved,
    delay: 700,
    save: async (v) => { await api(`/game-news/chat-settings${sc.q}`, 'PUT', v); setLookSaved(v); sc.changed(); },
  });
  const setColor = (k: ChatKind, part: keyof ChatColors, v: AnsiColor) => setLook((x) => ({ ...x, colors: { ...x.colors, [k]: { ...x.colors[k], [part]: v } } }));

  const shown = CHAT_KINDS.filter((k) => st.kinds[k]);
  const summary = !st.set
    ? t('gn.ch.sumNoHook')
    : shown.length ? t('gn.ch.sumKinds', { list: shown.map((k) => t(`gn.ch.short.${k}` as 'gn.ch.short.global')).join(', ') }) : t('gn.ch.sumNone');

  return (
    <FoldCard
      id="chat"
      defaultOpen
      title={t('gn.ch.title')}
      summary={summary}
      on={st.enabled && st.set && shown.length > 0}
      status={<SaveBadge status={auto.status} error={auto.error} retry={auto.retry} />}
    >
      <ScopeNote part="chat" />
      <p className="text-sm font-semibold text-mute">{t('gn.ch.note')}</p>

      <label className="flex items-center gap-3 font-bold">
        <Switch checked={st.enabled} disabled={busy === 'switch'} onChange={(v) => void send({ enabled: v }, 'switch', true)} />
        {t('gn.ch.enabled')}
      </label>

      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-extrabold">{t('gn.ch.channel')}</span>
          <span className={st.set ? 'pill pill-ok' : 'pill pill-mute'}>{st.set ? t('gn.ch.set', { tail: st.tail }) : t('gn.ch.unset')}</span>
          {st.set && <button type="button" className="btn btn-soft btn-sm" disabled={busy === 'test'} onClick={() => void test()}>{t('gn.ch.test')}</button>}
          {st.set && <button type="button" className="btn btn-ghost btn-sm" disabled={busy === 'test'} title={t('gn.ch.paletteNote')} onClick={() => void test(true)}>{t('gn.ch.palette')}</button>}
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setEditing((v) => !v); setValue(''); }}>{st.set ? t('gn.ch.edit') : t('gn.ch.add')}</button>
          {st.set && <button type="button" className="btn btn-ghost btn-sm" disabled={busy === 'clear'} onClick={() => void send({ clear: true }, 'clear')}>{t('gn.ch.clear')}</button>}
        </div>
        {editing && (
          <div className="flex flex-wrap items-center gap-2">
            <input
              className="input min-w-0 flex-1 basis-64 font-mono text-sm"
              type="password"
              autoComplete="off"
              ref={hookInput}
              value={value}
              placeholder="https://discord.com/api/webhooks/…"
              aria-label={t('gn.ch.channel')}
              onChange={(e) => setValue(e.target.value)}
            />
            <button type="button" className="btn btn-sm" disabled={!value.trim() || busy === 'webhook'} onClick={() => void send({ webhook: value.trim() }, 'webhook').then((ok) => { if (ok) { setEditing(false); setValue(''); } })}>{t('common.save')}</button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setEditing(false); setValue(''); }}>{t('common.cancel')}</button>
          </div>
        )}
      </div>

      <label className="flex items-start gap-3 font-bold">
        <Switch className="mt-0.5" checked={st.fromDiscord} disabled={busy === 'fromDiscord' || !st.set} onChange={(v) => void send({ fromDiscord: v }, 'fromDiscord', true)} />
        <span>
          {t('gn.ch.fromDiscord')}
          <span className="block text-sm font-semibold text-mute">{t(st.set ? 'gn.ch.fromDiscordNote' : 'gn.ch.fromDiscordNeed')}</span>
        </span>
      </label>

      {st.fromDiscord && <SayCheck />}

      {st.fromDiscord && (
        <div className="space-y-2 rounded-xl border border-line px-4 py-3">
          <div className="font-extrabold">{t('gn.ch.confirm')}</div>
          <p className="text-sm font-semibold text-mute">{t('gn.ch.confirmMarks')}</p>
          <label className="flex items-start gap-3 font-bold">
            <Switch className="mt-0.5" checked={st.confirmCard} disabled={busy === 'confirmCard'} onChange={(v) => void send({ confirmCard: v }, 'confirmCard', true)} />
            <span>{t('gn.ch.confirmCard')}<span className="block text-sm font-semibold text-mute">{t('gn.ch.confirmCardNote')}</span></span>
          </label>
          <label className="flex items-start gap-3 font-bold">
            <Switch className="mt-0.5" checked={st.confirmLine} disabled={busy === 'confirmLine'} onChange={(v) => void send({ confirmLine: v }, 'confirmLine', true)} />
            <span>{t('gn.ch.confirmLine')}<span className="block text-sm font-semibold text-mute">{t('gn.ch.confirmLineNote')}</span></span>
          </label>
        </div>
      )}

      <fieldset className="space-y-2">
        <legend className="mb-1 font-extrabold">{t('gn.ch.what')}</legend>
        {CHAT_KINDS.map((k) => (
          <Fragment key={k}>
            <label className="flex items-start gap-3 font-bold">
              <Switch className="mt-0.5" checked={st.kinds[k]} disabled={busy === k} onChange={(v) => void send({ kinds: { [k]: v } }, k, true)} />
              <span>
                {t(`gn.ch.kind.${k}` as 'gn.ch.kind.global')}
                <span className="block text-sm font-semibold text-mute">{t(`gn.ch.kindNote.${k}` as 'gn.ch.kindNote.global')}</span>
              </span>
            </label>
            {k === 'announce' && st.kinds.announce && (
              <div className="ml-12 space-y-1.5 rounded-xl bg-soft px-4 py-3" role="group" aria-label={t('gn.ch.ann.title')}>
                <div className="text-sm font-extrabold">{t('gn.ch.ann.title')}</div>
                {(['auto', 'restart', 'manual'] as const).map((src) => (
                  <label key={src} className="flex items-start gap-3 text-sm font-bold">
                    <Switch className="mt-0.5" checked={st.announce[src]} disabled={busy === `ann-${src}`} onChange={(v) => void send({ announce: { [src]: v } }, `ann-${src}`, true)} />
                    <span>{t(`gn.ch.ann.${src}` as 'gn.ch.ann.auto')}<span className="block font-semibold text-mute">{t(`gn.ch.ann.${src}Note` as 'gn.ch.ann.autoNote')}</span></span>
                  </label>
                ))}
              </div>
            )}
          </Fragment>
        ))}
      </fieldset>

      <div className="space-y-3">
        <h4 className="font-extrabold">{t('gn.ch.look')}</h4>
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label={t('gn.ch.presets')}>
          <span className="text-sm font-bold text-mute">{t('gn.ch.presets')}</span>
          {CHAT_PRESETS.map((p) => (
            <button key={p.id} type="button" className="chip-filter" onClick={() => setLook((x) => ({ ...x, style: p.style, ...(p.style === 'ansi' ? { colors: p.colors } : {}) }))}>
              {t(`gn.ch.preset.${p.id}` as 'gn.ch.preset.game')}
            </button>
          ))}
        </div>
        <div className="grid gap-4 lg:grid-cols-2">
          <Field label={t('gn.ch.style')}>
            <select className="input" value={look.style} onChange={(e) => setLook((x) => ({ ...x, style: e.target.value as 'ansi' | 'plain' }))}>
              <option value="ansi">{t('gn.ch.style.ansi')}</option>
              <option value="plain">{t('gn.ch.style.plain')}</option>
            </select>
          </Field>
          <Field label={t('gn.ch.sender')}>
            <input className="input" value={look.senderName} maxLength={80} placeholder={t('gn.ch.senderEx')} onChange={(e) => setLook((x) => ({ ...x, senderName: e.target.value }))} />
          </Field>
        </div>
        <p className="text-sm font-semibold text-mute">{t('gn.ch.senderNote')}</p>
        <label className="flex items-start gap-3 font-bold">
          <Switch className="mt-0.5" checked={look.showTime} onChange={(v) => setLook((x) => ({ ...x, showTime: v }))} />
          <span>
            {t('gn.ch.time')}
            <span className="block text-sm font-semibold text-mute">{t('gn.ch.timeNote')}</span>
          </span>
        </label>

        {look.style === 'ansi' && (
          <>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[34rem] text-left text-sm">
                <thead>
                  <tr className="text-mute">
                    <th className="py-1.5 pr-3 font-bold">{t('gn.ch.colors')}</th>
                    <th className="py-1.5 pr-3 font-bold">{t('gn.ch.col.tag')}</th>
                    <th className="py-1.5 pr-3 font-bold">{t('gn.ch.col.name')}</th>
                    <th className="py-1.5 font-bold">{t('gn.ch.col.text')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {CHAT_KINDS.map((k) => {
                    const event = k === 'join' || k === 'leave';
                    return (
                      <tr key={k}>
                        <td className="py-1.5 pr-3 font-bold">{t(`gn.ch.kind.${k}` as 'gn.ch.kind.global')}</td>
                        <td className="py-1.5 pr-3">{event ? <span className="text-mute">—</span> : <AnsiSelect label={`${t(`gn.ch.kind.${k}` as 'gn.ch.kind.global')}: ${t('gn.ch.col.tag')}`} value={look.colors[k].tag} onChange={(v) => setColor(k, 'tag', v)} />}</td>
                        <td className="py-1.5 pr-3"><AnsiSelect label={`${t(`gn.ch.kind.${k}` as 'gn.ch.kind.global')}: ${t('gn.ch.col.name')}`} value={look.colors[k].name} onChange={(v) => setColor(k, 'name', v)} /></td>
                        <td className="py-1.5"><AnsiSelect label={`${t(`gn.ch.kind.${k}` as 'gn.ch.kind.global')}: ${t('gn.ch.col.text')}`} value={look.colors[k].text} onChange={(v) => setColor(k, 'text', v)} /></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <DiscordPreview colors={look.colors} joinText={joinText} leaveText={leaveText} kickText={kickText} showTime={look.showTime} sender={look.senderName} />
            <p className="text-sm font-semibold text-mute">{t('gn.ch.ansiNote')}</p>
          </>
        )}
      </div>

      <p className="text-sm font-semibold text-mute">{t('gn.ch.hint')}</p>
      <p className="text-sm font-semibold text-danger">{t('gn.ch.privacy')}</p>
    </FoldCard>
  );
}
