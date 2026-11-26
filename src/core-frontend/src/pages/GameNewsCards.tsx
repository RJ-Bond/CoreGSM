import { useState } from 'react';
import { api } from '../api';
import { Switch } from '../components/Switch';
import { AutoText, FoldCard, VarChips } from '../components/GameNewsParts';
import { ChatLines, NewsEditor, NewsPreview } from '../components/NewsEditor';
import { confirmDialog } from '../confirm';
import { t, useI18n } from '../i18n';
import { accentLine, commandLine, WELCOME_STYLES, WELCOME_VARIABLES, composeLine, isHex, validateNews, type Extras, type JoinLeave, type RegisterSettings, type Welcome, type WelcomeStyle } from '../gameNews';
import { ScopeNote, useScope } from './GameNewsScope';
import { Field, SaveBadge, useAutosave } from '../ui';
import { ColorField, onOff } from './GameNewsFields';
export { KickCard } from './GameNewsKickCard';
export { ChatCard } from './GameNewsChatCard';

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
