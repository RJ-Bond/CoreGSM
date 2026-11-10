import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { Switch } from '../components/Switch';
import { AutoText, FoldCard, VarChips } from '../components/GameNewsParts';
import { ChatLines, NewsEditor, NewsPreview } from '../components/NewsEditor';
import { confirmDialog } from '../confirm';
import { t, useI18n } from '../i18n';
import {
  ANSI_COLORS, CHAT_KINDS, CHAT_PRESETS, SWATCHES, accentLine, commandLine, kickLine, modLine, DEFAULT_KICK, WELCOME_STYLES, WELCOME_VARIABLES, composeLine, isHex, validateNews,
  type AnsiColor, type ChatColors, type ChatKind, type ChatSettings, type Extras, type JoinLeave, type KickSettings, type RegisterSettings, type Welcome, type WelcomeStyle,
} from '../gameNews';
import { ScopeNote, useScope } from './GameNewsScope';
import { EmptyState, SubTabs, WithPreview } from './GameNewsUi';
import { ChannelName, ChannelPicker } from '../components/ChannelPicker';
import { Field, SaveBadge, errText, toast, useAutosave } from '../ui';

const onOff = (b: boolean) => (b ? t('gn.f.on') : t('gn.f.off'));

/**
 * The greeting for a player who joins, shown by the plugin to that player only. One text for everybody, or one for a
 * newcomer and one for a returning player (switch between them above the editor); ready styles to start from.
 */
export function WelcomeCard({ initial }: { initial: Welcome }) {
  useI18n();
  const sc = useScope();
  const [f, setF] = useState<Welcome>(initial);
  const [saved, setSaved] = useState<Welcome>(initial);
  const [which, setWhich] = useState<'back' | 'new'>('back');
  const set = <K extends keyof Welcome>(k: K, v: Welcome[K]) => setF((x) => ({ ...x, [k]: v }));
  const auto = useAutosave({
    value: f,
    saved,
    delay: 900,
    validate: (v) => {
      if (!v.enabled && !v.text.trim() && !v.newText.trim()) return null;
      const p = validateNews(v.text);
      if (p) return t(p === 'long' ? 'gn.hint.long' : 'gn.hint.text');
      const q = v.split ? validateNews(v.newText) : null;
      return q ? t(q === 'long' ? 'gn.hint.long' : 'gn.hint.text') : null;
    },
    save: async (v) => { await api(`/game-news/welcome${sc.q}`, 'PUT', v); setSaved(v); sc.changed(); },
  });

  const editingNew = f.split && which === 'new';
  const text = editingNew ? f.newText : f.text;
  const setText = (v: string) => set(editingNew ? 'newText' : 'text', v);

  const applyStyle = async (st: WelcomeStyle) => {
    if ((f.text.trim() || f.newText.trim()) && !(await confirmDialog({ title: t('gn.w.styleTitle'), text: t('gn.w.styleText'), confirmLabel: t('gn.w.styleApply') }))) return;
    setF((x) => ({ ...x, text: st.text, newText: st.newText, split: true }));
  };

  return (
    <FoldCard
      id="welcome"
      defaultOpen
      title={t('gn.w.title')}
      summary={f.enabled ? (f.split ? t('gn.w.sumSplit') : t('gn.w.sumOne')) : t('gn.w.sumOff')}
      on={f.enabled}
      status={<SaveBadge status={auto.status} error={auto.error} retry={auto.retry} />}
    >
      <ScopeNote part="welcome" />
      <p className="text-sm font-semibold text-mute">{t('gn.w.note')}</p>

      <label className="flex items-center gap-3 font-bold">
        <Switch checked={f.enabled} onChange={(v) => set('enabled', v)} />
        {t('gn.w.enabled')}
      </label>

      <div className="flex flex-wrap items-center gap-2" role="group" aria-label={t('gn.w.styles')}>
        <span className="text-sm font-bold text-mute">{t('gn.w.styles')}:</span>
        {WELCOME_STYLES.map((st) => (
          <button key={st.id} type="button" className="chip-filter" onClick={() => void applyStyle(st)}>{t(`gn.w.style.${st.id}` as 'gn.w.style.classic')}</button>
        ))}
      </div>

      <label className="flex items-start gap-3 font-bold">
        <Switch className="mt-0.5" checked={f.split} onChange={(v) => set('split', v)} />
        <span>
          {t('gn.w.split')}
          <span className="block text-sm font-semibold text-mute">{t('gn.w.splitNote')}</span>
        </span>
      </label>

      {f.split && (
        <div className="flex flex-wrap gap-2" role="tablist" aria-label={t('gn.w.split')}>
          {(['back', 'new'] as const).map((w) => (
            <button key={w} type="button" role="tab" aria-selected={which === w} className={`chip-filter ${which === w ? 'on' : ''}`} onClick={() => setWhich(w)}>
              {t(w === 'back' ? 'gn.w.textBack' : 'gn.w.textNew')}
            </button>
          ))}
        </div>
      )}

      <NewsEditor value={text} onChange={setText} templates={false} vars={WELCOME_VARIABLES} label={f.split ? t(which === 'new' ? 'gn.w.textNew' : 'gn.w.textBack') : t('gn.w.text')} />
      <NewsPreview text={text || f.text} welcome />
      {auto.invalid && f.enabled && <p className="text-sm font-semibold text-danger">{auto.error}</p>}
    </FoldCard>
  );
}

/** a colour: the palette, the system picker and a HEX box */
const RECENT_KEY = 'coregsm.gn.recentColors';
const readRecent = (): string[] => { try { return (JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]') as string[]).filter(isHex).slice(0, 6); } catch { return []; } };
const SWATCH_HEX = new Set(SWATCHES.map((c) => c.hex));

function ColorField({ label, value, onChange, gameHex }: { label: string; value: string; onChange: (v: string) => void; gameHex?: string }) {
  const [recent, setRecent] = useState<string[]>(readRecent);
  // a colour that was picked stays in the «recent» row of every colour field (kept in this browser)
  const remember = (v: string) => {
    if (!isHex(v) || SWATCH_HEX.has(v.toUpperCase())) return;
    const next = [v.toUpperCase(), ...readRecent().filter((x) => x.toUpperCase() !== v.toUpperCase())].slice(0, 6);
    try { localStorage.setItem(RECENT_KEY, JSON.stringify(next)); } catch { /* private mode */ }
    setRecent(next);
  };
  return (
    <div className="space-y-1.5">
      <span className="text-sm font-bold">{label}</span>
      <div className="flex flex-wrap items-center gap-2">
        {SWATCHES.map((c) => (
          <button
            key={c.id}
            type="button"
            className={`h-7 w-7 rounded-full border ${value.toUpperCase() === c.hex ? 'border-ink ring-2 ring-ink/40' : 'border-line'}`}
            style={{ background: c.hex }}
            aria-label={`${label}: ${c.hex}`}
            aria-pressed={value.toUpperCase() === c.hex}
            onClick={() => onChange(c.hex)}
          />
        ))}
        <input type="color" className="h-8 w-10 cursor-pointer rounded border border-line bg-transparent p-0.5" value={isHex(value) ? value : '#FFFFFF'} aria-label={label} onChange={(e) => onChange(e.target.value.toUpperCase())} />
        <input className="input w-28 font-mono text-sm" value={value} maxLength={7} aria-label={`${label} HEX`} onChange={(e) => onChange(e.target.value)} onBlur={() => remember(value)} />
        {gameHex && value.toUpperCase() !== gameHex && <button type="button" className="btn btn-ghost btn-sm" onClick={() => onChange(gameHex)}>{t('gn.col.game')}</button>}
      </div>
      {recent.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-bold text-mute">{t('gn.col.recent')}</span>
          {recent.map((c) => (
            <button key={c} type="button" className={`h-6 w-6 rounded-full border ${value.toUpperCase() === c ? 'border-ink ring-2 ring-ink/40' : 'border-line'}`} style={{ background: c }} aria-label={`${label}: ${c}`} onClick={() => onChange(c)} />
          ))}
        </div>
      )}
    </div>
  );
}

/** «* Игрок {name} подключился к серверу.»: shown to everybody when a player joins or leaves, with the colours chosen here. */
export function JoinLeaveCard({ initial }: { initial: JoinLeave }) {
  useI18n();
  const sc = useScope();
  const [f, setF] = useState<JoinLeave>(initial);
  const [saved, setSaved] = useState<JoinLeave>(initial);
  const set = <K extends keyof JoinLeave>(k: K, v: JoinLeave[K]) => setF((x) => ({ ...x, [k]: v }));
  const auto = useAutosave({
    value: f,
    saved,
    delay: 800,
    validate: (v) => {
      if (!isHex(v.nameColor) || !isHex(v.textColor)) return t('gn.jl.badColor');
      if ((v.joinEnabled && !v.joinText.trim()) || (v.leaveEnabled && !v.leaveText.trim())) return t('gn.hint.text');
      return null;
    },
    save: async (v) => { await api(`/game-news/joinleave${sc.q}`, 'PUT', v); setSaved(v); sc.changed(); },
  });
  const sample = (text: string) => composeLine(text, isHex(f.nameColor) ? f.nameColor : '#B86BFF', isHex(f.textColor) ? f.textColor : '#5FD068').replace(/\{name\}/g, 'WhiteLegioN');

  return (
    <FoldCard
      id="joinleave"
      title={t('gn.jl.title')}
      summary={t('gn.jl.sum', { join: onOff(f.joinEnabled), leave: onOff(f.leaveEnabled) })}
      on={f.joinEnabled || f.leaveEnabled}
      status={<SaveBadge status={auto.status} error={auto.error} retry={auto.retry} />}
    >
      <ScopeNote part="joinleave" />
      <p className="text-sm font-semibold text-mute">{t('gn.jl.note')}</p>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-2">
          <label className="flex items-center gap-3 font-bold">
            <Switch checked={f.joinEnabled} onChange={(v) => set('joinEnabled', v)} />
            {t('gn.jl.join')}
          </label>
          <AutoText value={f.joinText} maxLength={200} aria-label={t('gn.jl.join')} onChange={(e) => set('joinText', e.target.value)} />
        </div>
        <div className="space-y-2">
          <label className="flex items-center gap-3 font-bold">
            <Switch checked={f.leaveEnabled} onChange={(v) => set('leaveEnabled', v)} />
            {t('gn.jl.leave')}
          </label>
          <AutoText value={f.leaveText} maxLength={200} aria-label={t('gn.jl.leave')} onChange={(e) => set('leaveText', e.target.value)} />
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <ColorField label={t('gn.jl.nameColor')} value={f.nameColor} gameHex="#B86BFF" onChange={(v) => set('nameColor', v)} />
        <ColorField label={t('gn.jl.textColor')} value={f.textColor} gameHex="#5FD068" onChange={(v) => set('textColor', v)} />
      </div>

      <VarChips vars={[{ name: 'name', example: 'WhiteLegioN' }]} onPick={(v) => set('joinText', `${f.joinText} ${v}`.trim())} />
      <ChatLines lines={[sample(f.joinText), sample(f.leaveText)]} />
      <p className="text-sm font-semibold text-mute">{t('gn.jl.nameHint')}</p>
      {auto.invalid && <p className="text-sm font-semibold text-danger">{auto.error}</p>}
    </FoldCard>
  );
}

/**
 * Registration in the panel from the game: a player without an account is told to type .register <password> <again>,
 * the account is made with the game nickname as the login, and the player is reminded to link Discord.
 */
export function RegisterCard({ initial }: { initial: RegisterSettings }) {
  useI18n();
  const sc = useScope();
  const [f, setF] = useState<RegisterSettings>(initial);
  const [saved, setSaved] = useState<RegisterSettings>(initial);
  const set = <K extends keyof RegisterSettings>(k: K, v: RegisterSettings[K]) => setF((x) => ({ ...x, [k]: v }));
  const auto = useAutosave({
    value: f,
    saved,
    delay: 900,
    validate: (v) => {
      if (![v.nickColor, v.numberColor, v.rankColor].every(isHex)) return t('gn.jl.badColor');
      if (!Number.isInteger(v.remindMinutes) || v.remindMinutes < 0 || v.remindMinutes > 1440) return t('gn.rg.badRemind');
      if (!Number.isInteger(v.discordEveryHours) || v.discordEveryHours < 1 || v.discordEveryHours > 720) return t('gn.rg.badHours');
      return [v.promptText, v.doneText, v.discordText, v.pendingText, v.loginText, v.nickTakenText, v.remindText, v.autoLoginText, v.lastSeenText, v.rankText].some((x) => !x.trim()) ? t('gn.hint.text') : null;
    },
    save: async (v) => { await api(`/game-news/register-settings${sc.q}`, 'PUT', v); setSaved(v); sc.changed(); },
  });
  const sample = (text: string, color: string) => commandLine(color, text.replace(/\{login\}/g, 'WhiteLegioN').replace(/\{panel\}/g, 'coregsm.example.com'));
  const nickC = isHex(f.nickColor) ? f.nickColor : '#FFCC33';
  const numC = isHex(f.numberColor) ? f.numberColor : '#4DE0E0';

  const field = (label: string, key: 'promptText' | 'doneText' | 'discordText' | 'pendingText' | 'loginText' | 'nickTakenText' | 'remindText' | 'autoLoginText' | 'lastSeenText') => (
    <Field label={label}>
      <AutoText value={f[key]} maxLength={300} onChange={(e) => set(key, e.target.value)} />
    </Field>
  );

  return (
    <FoldCard
      id="register"
      title={t('gn.rg.title')}
      summary={f.enabled ? t('gn.rg.sumOn') : t('gn.rg.sumOff')}
      on={f.enabled}
      status={<SaveBadge status={auto.status} error={auto.error} retry={auto.retry} />}
    >
      <ScopeNote part="register" />
      <p className="text-sm font-semibold text-mute">{t('gn.rg.note')}</p>

      <label className="flex items-center gap-3 font-bold">
        <Switch checked={f.enabled} onChange={(v) => set('enabled', v)} />
        {t('gn.rg.enabled')}
      </label>

      <div className="grid gap-4 lg:grid-cols-2">
        {field(t('gn.rg.prompt'), 'promptText')}
        {field(t('gn.rg.done'), 'doneText')}
        {field(t('gn.rg.discord'), 'discordText')}
        {field(t('gn.rg.pending'), 'pendingText')}
        {field(t('gn.rg.login'), 'loginText')}
        {field(t('gn.rg.nickTaken'), 'nickTakenText')}
        {field(t('gn.rg.remindText'), 'remindText')}
      </div>

      <label className="flex items-center gap-3 font-bold">
        <Switch checked={f.autoLoginEnabled} onChange={(v) => set('autoLoginEnabled', v)} />
        {t('gn.rg.autoOn')}
      </label>
      {f.autoLoginEnabled && field(t('gn.rg.auto'), 'autoLoginText')}
      <label className="flex items-center gap-3 font-bold">
        <Switch checked={f.lastSeenEnabled} onChange={(v) => set('lastSeenEnabled', v)} />
        {t('gn.rg.lastOn')}
      </label>
      {f.lastSeenEnabled && field(t('gn.rg.last'), 'lastSeenText')}

      <label className="flex items-center gap-3 font-bold">
        <Switch checked={f.rankEnabled} onChange={(v) => set('rankEnabled', v)} />
        {t('gn.rg.rankOn')}
      </label>
      {f.rankEnabled && (
        <Field label={t('gn.rg.rank')}>
          <AutoText value={f.rankText} maxLength={300} onChange={(e) => set('rankText', e.target.value)} />
        </Field>
      )}

      <p className="text-sm font-semibold text-mute">{t('gn.rg.colors')}</p>
      <div className="grid gap-4 lg:grid-cols-3">
        <ColorField label={t('gn.rg.nickColor')} value={f.nickColor} gameHex="#FFCC33" onChange={(v) => set('nickColor', v)} />
        <ColorField label={t('gn.rg.numberColor')} value={f.numberColor} gameHex="#4DE0E0" onChange={(v) => set('numberColor', v)} />
        {!f.rankByTier && <ColorField label={t('gn.rg.rankColor')} value={f.rankColor} gameHex="#B9A7FF" onChange={(v) => set('rankColor', v)} />}
      </div>
      <label className="flex items-center gap-3 font-bold">
        <Switch checked={f.rankByTier} onChange={(v) => set('rankByTier', v)} />
        {t('gn.rg.rankByTier')}
      </label>

      <Field label={t('gn.rg.remind')}>
        <p className="mb-1 text-xs text-mute">{t('gn.rg.remindHint')}</p>
        <input className="input w-32" type="number" min={0} max={1440} value={f.remindMinutes} onChange={(e) => set('remindMinutes', Number(e.target.value))} />
      </Field>

      <Field label={t('gn.rg.hours')}>
        <input className="input w-32" type="number" min={1} max={720} value={f.discordEveryHours} onChange={(e) => set('discordEveryHours', Number(e.target.value))} />
      </Field>

      <VarChips vars={[{ name: 'login', example: 'WhiteLegioN' }, { name: 'panel', example: 'coregsm.example.ru' }]} onPick={(v) => set('promptText', `${f.promptText} ${v}`.trim())} />
      <ChatLines lines={[sample(f.promptText, '#FFCC33'), sample(f.doneText, '#5FD068'), sample(f.loginText, '#5FD068'), accentLine('#FFCC33', f.nickTakenText.replace(/\{name\}/g, 'WhiteLegioN'), [['WhiteLegioN', nickC]]), ...(f.autoLoginEnabled ? [sample(f.autoLoginText, '#5FD068')] : []), ...(f.lastSeenEnabled ? [accentLine('#D7CCF5', f.lastSeenText.replace(/\{name\}/g, 'WhiteLegioN').replace(/\{date\}/g, '10.12.2026').replace(/\{time\}/g, '10:00'), [['WhiteLegioN', nickC], ['10.12.2026', numC], ['10:00', numC]])] : []), ...(f.rankEnabled ? [accentLine('#A9B8C9', f.rankText.replace(/\{name\}/g, 'WhiteLegioN').replace(/\{rank\}/g, 'Охотник на кровь').replace(/\{hours\}/g, '42').replace(/\{next\}/g, ' · до «Страж замка» ещё 28 ч'), [['WhiteLegioN', nickC], ['Охотник на кровь', f.rankByTier ? '#D8C9FF' : (isHex(f.rankColor) ? f.rankColor : '#B9A7FF')], ['42', numC], [' · до «Страж замка» ещё 28 ч', '#8A94A3', false]])] : []), sample(f.discordText, '#6EC1FF')]} />
      <p className="text-sm font-semibold text-mute">{t('gn.rg.vars')}</p>
      <p className="text-sm font-semibold text-danger">{t('gn.rg.warn')}</p>
      {auto.invalid && <p className="text-sm font-semibold text-danger">{auto.error}</p>}
    </FoldCard>
  );
}

/**
 * Moderation from the game (.kick, .ban, .warn, .unban): how it reads in the chat (words and colours of the nickname, the reason and the
 * administrator), what it asks for and refuses, what the player is told in private, how long a warning counts, the short names of reasons.
 * Everything is set here; one card, one setting, four parts.
 */
export function KickCard({ initial }: { initial: KickSettings }) {
  useI18n();
  const sc = useScope();
  const [f, setF] = useState<KickSettings>(initial);
  const [saved, setSaved] = useState<KickSettings>(initial);
  const [part, setPart] = useState<'kick' | 'ban' | 'warn' | 'reasons'>('kick');
  const set = <K extends keyof KickSettings>(k: K, v: KickSettings[K]) => setF((x) => ({ ...x, [k]: v }));
  const auto = useAutosave({
    value: f,
    saved,
    delay: 900,
    validate: (v) => {
      if ([v.template, v.banTemplate, v.warnTemplate, v.unbanTemplate, v.banJoinText, v.blockJoinText, v.notifyText, v.defaultReason].some((x) => !x.trim())) return t('gn.hint.text');
      if (![v.textColor, v.nameColor, v.reasonColor, v.adminColor].every(isHex)) return t('gn.jl.badColor');
      if (v.reasons.some((r) => !r.key.trim() || !r.text.trim())) return t('gn.kk.reasonEmpty');
      return null;
    },
    save: async (v) => { await api(`/game-news/kick-settings${sc.q}`, 'PUT', v); setSaved(v); sc.changed(); },
  });
  const safe = (v: KickSettings): KickSettings => ({ ...v, textColor: isHex(v.textColor) ? v.textColor : DEFAULT_KICK.textColor, nameColor: isHex(v.nameColor) ? v.nameColor : DEFAULT_KICK.nameColor, reasonColor: isHex(v.reasonColor) ? v.reasonColor : DEFAULT_KICK.reasonColor, adminColor: isHex(v.adminColor) ? v.adminColor : DEFAULT_KICK.adminColor });
  const sv = safe(f);
  const reasonText = f.reasons[0]?.text ?? f.defaultReason;
  const priv = (text: string, vars: { reason?: string; n?: number; limit?: number; until?: string; left?: string }) =>
    modLine({ ...sv, nameColor: sv.textColor, adminColor: sv.textColor, reasonColor: '#FFCC33' }, text.replace(/\{until\}/g, vars.until ?? '').replace(/\{left\}/g, vars.left ?? ''), { reason: vars.reason, n: vars.n, limit: vars.limit });
  const [pickLog, setPickLog] = useState(false);
  const varsAll = [{ name: 'name', example: 'WhiteLegioN' }, { name: 'reason', example: reasonText }, { name: 'admin', example: 'Админ' }];

  const switchRow = (key: 'requireReason' | 'protectAdmins' | 'announce' | 'notifyPlayer', label: Parameters<typeof t>[0], note: Parameters<typeof t>[0]) => (
    <label key={key} className="flex items-start gap-3 font-bold">
      <Switch className="mt-0.5" checked={f[key]} onChange={(v) => set(key, v)} />
      <span>{t(label)}<span className="block text-sm font-semibold text-mute">{t(note)}</span></span>
    </label>
  );

  return (
    <FoldCard
      id="kick"
      title={t('gn.kk.title')}
      summary={f.enabled ? t('gn.kk.sumOn') : t('gn.kk.sumOff')}
      on={f.enabled}
      status={<SaveBadge status={auto.status} error={auto.error} retry={auto.retry} />}
    >
      <ScopeNote part="kick" />
      <p className="text-sm font-semibold text-mute">{t('gn.kk.note')}</p>

      <label className="flex items-center gap-3 font-bold">
        <Switch checked={f.enabled} onChange={(v) => set('enabled', v)} />
        {t('gn.kk.enabled')}
      </label>

      <SubTabs
        label={t('gn.kk.title')}
        value={part}
        onChange={setPart}
        items={[{ id: 'kick', label: t('gn.kk.p.kick') }, { id: 'ban', label: t('gn.kk.p.ban') }, { id: 'warn', label: t('gn.kk.p.warn') }, { id: 'reasons', label: t('gn.kk.p.reasons'), badge: f.reasons.length }]}
      />

      {part === 'kick' && (
        <div className="space-y-4">
          <WithPreview
            preview={(
              <>
                <ChatLines lines={f.announce ? [kickLine(sv, 'WhiteLegioN', reasonText, 'Админ'), kickLine(sv, 'WhiteLegioN', f.defaultReason, 'Админ')] : []} />
                {f.notifyPlayer && <ChatLines lines={[priv(f.notifyText, { reason: reasonText })]} />}
                {!f.announce && <p className="text-sm font-semibold text-mute">{t('gn.kk.quiet')}</p>}
              </>
            )}
          >
            <Field label={t('gn.kk.template')}>
              <AutoText value={f.template} maxLength={300} onChange={(e) => set('template', e.target.value)} />
            </Field>
            <VarChips vars={varsAll} onPick={(v) => set('template', `${f.template} ${v}`.trim())} />
            <div className="grid gap-4 sm:grid-cols-2">
              <ColorField label={t('gn.kk.textColor')} value={f.textColor} gameHex={DEFAULT_KICK.textColor} onChange={(v) => set('textColor', v)} />
              <ColorField label={t('gn.kk.nameColor')} value={f.nameColor} gameHex={DEFAULT_KICK.nameColor} onChange={(v) => set('nameColor', v)} />
              <ColorField label={t('gn.kk.reasonColor')} value={f.reasonColor} gameHex={DEFAULT_KICK.reasonColor} onChange={(v) => set('reasonColor', v)} />
              <ColorField label={t('gn.kk.adminColor')} value={f.adminColor} gameHex={DEFAULT_KICK.adminColor} onChange={(v) => set('adminColor', v)} />
            </div>
          </WithPreview>

          <div className="space-y-2">
            {switchRow('announce', 'gn.kk.announce', 'gn.kk.announceNote')}
            {switchRow('notifyPlayer', 'gn.kk.notify', 'gn.kk.notifyNote')}
          </div>
          {f.notifyPlayer && (
            <Field label={t('gn.kk.notifyText')}>
              <AutoText value={f.notifyText} maxLength={300} onChange={(e) => set('notifyText', e.target.value)} />
            </Field>
          )}

          <div className="grid gap-4 sm:grid-cols-3">
            <Field label={t('gn.kk.defaultReason')}>
              <input className="input" value={f.defaultReason} maxLength={100} onChange={(e) => set('defaultReason', e.target.value)} />
            </Field>
            <Field label={t('gn.kk.cooldown')}>
              <input className="input w-32" type="number" min={0} max={3600} value={f.cooldownSec} onChange={(e) => set('cooldownSec', Number(e.target.value))} />
            </Field>
            <Field label={t('gn.kk.block')}>
              <input className="input w-32" type="number" min={0} max={1440} value={f.rejoinBlockMin} onChange={(e) => set('rejoinBlockMin', Number(e.target.value))} />
            </Field>
          </div>
          {f.rejoinBlockMin > 0 && (
            <Field label={t('gn.kk.blockText')}>
              <AutoText value={f.blockJoinText} maxLength={300} onChange={(e) => set('blockJoinText', e.target.value)} />
            </Field>
          )}

          <div className="space-y-2">
            {switchRow('requireReason', 'gn.kk.requireReason', 'gn.kk.requireReasonNote')}
            {switchRow('protectAdmins', 'gn.kk.protect', 'gn.kk.protectNote')}
          </div>

          <div className="space-y-2 rounded-xl border border-line px-4 py-3">
            <div className="font-extrabold">{t('gn.kk.logTitle')}</div>
            <p className="text-sm font-semibold text-mute">{t('gn.kk.logNote')}</p>
            <div className="flex flex-wrap items-center gap-2">
              {f.logChannelId ? <ChannelName id={f.logChannelId} /> : <span className="pill pill-mute">{t('gn.kk.logNone')}</span>}
              <button type="button" className="btn btn-soft btn-sm" onClick={() => setPickLog((v) => !v)}>{f.logChannelId ? t('gn.kk.logChange') : t('gn.kk.logPick')}</button>
              {f.logChannelId && <button type="button" className="btn btn-ghost btn-sm" onClick={() => set('logChannelId', '')}>{t('gn.kk.logOff')}</button>}
            </div>
            {pickLog && <ChannelPicker id="kick-log" value={f.logChannelId} onChange={(v) => { if (/^\d{15,25}$/.test(v)) { set('logChannelId', v); setPickLog(false); } }} />}
          </div>
        </div>
      )}

      {part === 'ban' && (
        <WithPreview
          preview={(
            <>
              <ChatLines lines={f.announce ? [modLine(sv, f.banTemplate, { name: 'WhiteLegioN', reason: reasonText, admin: 'Админ', time: t('gn.kk.sampleTime') }), modLine(sv, f.unbanTemplate, { name: 'WhiteLegioN', admin: 'Админ' })] : []} />
              <ChatLines lines={[priv(f.banJoinText, { reason: reasonText, until: t('gn.kk.sampleUntil') })]} />
            </>
          )}
        >
          <label className="flex items-center gap-3 font-bold">
            <Switch checked={f.banEnabled} onChange={(v) => set('banEnabled', v)} />
            {t('gn.kk.banEnabled')}
          </label>
          <p className="text-sm font-semibold text-mute">{t('gn.kk.banNote')}</p>
          <Field label={t('gn.kk.banTemplate')}>
            <AutoText value={f.banTemplate} maxLength={300} onChange={(e) => set('banTemplate', e.target.value)} />
          </Field>
          <VarChips vars={[...varsAll, { name: 'time', example: t('gn.kk.sampleTime') }]} onPick={(v) => set('banTemplate', `${f.banTemplate} ${v}`.trim())} />
          <Field label={t('gn.kk.unbanTemplate')}>
            <AutoText value={f.unbanTemplate} maxLength={300} onChange={(e) => set('unbanTemplate', e.target.value)} />
          </Field>
          <VarChips vars={[{ name: 'name', example: 'WhiteLegioN' }, { name: 'admin', example: 'Админ' }]} onPick={(v) => set('unbanTemplate', `${f.unbanTemplate} ${v}`.trim())} />
          <Field label={t('gn.kk.banJoin')}>
            <AutoText value={f.banJoinText} maxLength={300} onChange={(e) => set('banJoinText', e.target.value)} />
          </Field>
          <VarChips vars={[{ name: 'reason', example: reasonText }, { name: 'until', example: t('gn.kk.sampleUntil') }]} onPick={(v) => set('banJoinText', `${f.banJoinText} ${v}`.trim())} />
          <Field label={t('gn.kk.banScope')}>
            <p className="mb-1 text-xs text-mute">{t('gn.kk.banScopeHint')}</p>
            <select className="input w-64" value={f.banScope} onChange={(e) => set('banScope', e.target.value === 'server' ? 'server' : 'all')}>
              <option value="all">{t('gn.kk.banScopeAll')}</option>
              <option value="server">{t('gn.kk.banScopeServer')}</option>
            </select>
          </Field>
          <label className="flex items-start gap-3 font-bold">
            <Switch className="mt-0.5" checked={f.banDm} onChange={(v) => set('banDm', v)} />
            <span>{t('gn.kk.banDm')}<span className="block text-sm font-semibold text-mute">{t('gn.kk.banDmNote')}</span></span>
          </label>
        </WithPreview>
      )}

      {part === 'warn' && (
        <WithPreview preview={<ChatLines lines={f.announce ? [modLine(sv, f.warnTemplate, { name: 'WhiteLegioN', reason: reasonText, admin: 'Админ', n: 2, limit: f.warnLimit })] : []} />}>
          <label className="flex items-center gap-3 font-bold">
            <Switch checked={f.warnEnabled} onChange={(v) => set('warnEnabled', v)} />
            {t('gn.kk.warnEnabled')}
          </label>
          <p className="text-sm font-semibold text-mute">{t('gn.kk.warnNote')}</p>
          <Field label={t('gn.kk.warnTemplate')}>
            <AutoText value={f.warnTemplate} maxLength={300} onChange={(e) => set('warnTemplate', e.target.value)} />
          </Field>
          <VarChips vars={[...varsAll, { name: 'n', example: '2' }, { name: 'limit', example: String(f.warnLimit) }]} onPick={(v) => set('warnTemplate', `${f.warnTemplate} ${v}`.trim())} />
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t('gn.kk.warnLimit')}>
              <input className="input w-32" type="number" min={0} max={20} value={f.warnLimit} onChange={(e) => set('warnLimit', Number(e.target.value))} />
            </Field>
            <Field label={t('gn.kk.warnDays')}>
              <input className="input w-32" type="number" min={1} max={365} value={f.warnDays} onChange={(e) => set('warnDays', Number(e.target.value))} />
            </Field>
            <Field label={t('gn.kk.warnAction')}>
              <select className="input w-48" value={f.warnAction} onChange={(e) => set('warnAction', e.target.value === 'ban' ? 'ban' : 'kick')}>
                <option value="kick">{t('gn.kk.warnActionKick')}</option>
                <option value="ban">{t('gn.kk.warnActionBan')}</option>
              </select>
            </Field>
            {f.warnAction === 'ban' && (
              <Field label={t('gn.kk.warnBanTime')}>
                <p className="mb-1 text-xs text-mute">{t('gn.kk.warnBanTimeHint')}</p>
                <input className="input w-32 font-mono" value={f.warnBanTime} maxLength={12} onChange={(e) => set('warnBanTime', e.target.value)} />
              </Field>
            )}
          </div>
        </WithPreview>
      )}

      {part === 'reasons' && (
        <div className="space-y-3">
          <p className="text-sm font-semibold text-mute">{t('gn.kk.reasonsNote')}</p>
          {f.reasons.length === 0 && <EmptyState icon="📝" title={t('gn.kk.reasonsEmpty')} hint={t('gn.kk.reasonsEmptyHint')} />}
          <ul className="space-y-2">
            {f.reasons.map((r, i) => (
              <li key={i} className="flex flex-wrap items-center gap-2">
                <input className="input w-20 font-mono" value={r.key} maxLength={12} aria-label={t('gn.kk.reasonKey')} placeholder="1" onChange={(e) => set('reasons', f.reasons.map((x, j) => (j === i ? { ...x, key: e.target.value } : x)))} />
                <span aria-hidden className="text-mute">→</span>
                <input className="input min-w-0 flex-1 basis-56" value={r.text} maxLength={100} aria-label={t('gn.kk.reasonText')} placeholder={t('gn.kk.reasonText')} onChange={(e) => set('reasons', f.reasons.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)))} />
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => set('reasons', f.reasons.filter((_, j) => j !== i))}>{t('gn.rs.delete')}</button>
              </li>
            ))}
          </ul>
          <button type="button" className="btn btn-soft btn-sm" disabled={f.reasons.length >= 20} onClick={() => set('reasons', [...f.reasons, { key: String(f.reasons.length + 1), text: '' }])}>{t('gn.kk.reasonAdd')}</button>
          <p className="text-sm font-semibold text-mute">{t('gn.kk.reasonsEx', { key: f.reasons[0]?.key ?? '1', text: reasonText })}</p>
        </div>
      )}
      {auto.invalid && <p className="text-sm font-semibold text-danger">{auto.error}</p>}
    </FoldCard>
  );
}

/** «через 10 / 5 / 1 минуту» before a planned restart: one switch */
export function RestartCard({ enabled, onChange }: { enabled: boolean; onChange: (v: boolean) => void }) {
  useI18n();
  return (
    <FoldCard id="restart" title={t('gn.a.countdown')} summary={t('gn.rs.sum')} on={enabled}>
      <label className="flex items-start gap-3 font-bold">
        <Switch className="mt-0.5" checked={enabled} onChange={onChange} />
        <span>
          {t('gn.a.countdown')}
          <span className="block text-sm font-semibold text-mute">{t('gn.a.countdownNote')}</span>
        </span>
      </label>
    </FoldCard>
  );
}

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
          <label key={k} className="flex items-start gap-3 font-bold">
            <Switch className="mt-0.5" checked={st.kinds[k]} disabled={busy === k} onChange={(v) => void send({ kinds: { [k]: v } }, k, true)} />
            <span>
              {t(`gn.ch.kind.${k}` as 'gn.ch.kind.global')}
              <span className="block text-sm font-semibold text-mute">{t(`gn.ch.kindNote.${k}` as 'gn.ch.kindNote.global')}</span>
            </span>
          </label>
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

/** what {discord} and {tip} stand for: a link or a name, and a list of tips (one at random each time). */
export function ExtrasCard({ initial }: { initial: Extras }) {
  useI18n();
  const [discord, setDiscord] = useState(initial.discord);
  const [tips, setTips] = useState(initial.tips.join('\n'));
  const value: Extras = { discord: discord.trim(), tips: tips.split('\n').map((x) => x.trim()).filter(Boolean) };
  const [saved, setSaved] = useState<Extras>(value);
  const auto = useAutosave({
    value,
    saved,
    delay: 900,
    validate: (v) => (v.tips.length > 20 ? t('gn.x.tooMany') : null),
    save: async (v) => { await api('/game-news/extras', 'PUT', v); setSaved(v); },
  });

  return (
    <FoldCard
      id="extras"
      title={t('gn.x.title')}
      summary={t('gn.x.sum', { discord: value.discord || '—', n: value.tips.length })}
      status={<SaveBadge status={auto.status} error={auto.error} retry={auto.retry} />}
    >
      <p className="text-sm font-semibold text-mute">{t('gn.x.note')}</p>
      <Field label={t('gn.x.discord')}>
        <input className="input" value={discord} maxLength={100} placeholder="discord.gg/..." onChange={(e) => setDiscord(e.target.value)} />
      </Field>
      <Field label={t('gn.x.tips')}>
        <AutoText className="min-h-24 text-sm" value={tips} placeholder={t('gn.x.tipsEx')} onChange={(e) => setTips(e.target.value)} />
      </Field>
      {auto.invalid && <p className="text-sm font-semibold text-danger">{auto.error}</p>}
    </FoldCard>
  );
}
