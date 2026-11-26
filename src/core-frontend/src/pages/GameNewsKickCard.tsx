/** The card of the moderation commands: kick, ban, warnings and the ladder. */
import { useState } from 'react';
import { api } from '../api';
import { Switch } from '../components/Switch';
import { AutoText, FoldCard, VarChips } from '../components/GameNewsParts';
import { ChatLines } from '../components/NewsEditor';
import { t, useI18n } from '../i18n';
import { kickLine, modLine, DEFAULT_KICK, isHex, type KickSettings } from '../gameNews';
import { ScopeNote, useScope } from './GameNewsScope';
import { EmptyState, SubTabs, WithPreview } from './GameNewsUi';
import { ChannelName, ChannelPicker } from '../components/ChannelPicker';
import { Field, SaveBadge, useAutosave } from '../ui';
import { IconEdit } from '../icons';
import { ColorField } from './GameNewsFields';

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
            {!(f.ladder ?? []).length && <Field label={t('gn.kk.warnLimit')}>
              <input className="input w-32" type="number" min={0} max={20} value={f.warnLimit} onChange={(e) => set('warnLimit', Number(e.target.value))} />
            </Field>}
            <Field label={t('gn.kk.warnDays')}>
              <input className="input w-32" type="number" min={1} max={365} value={f.warnDays} onChange={(e) => set('warnDays', Number(e.target.value))} />
            </Field>
            {!(f.ladder ?? []).length && <Field label={t('gn.kk.warnAction')}>
              <select className="input w-48" value={f.warnAction} onChange={(e) => set('warnAction', e.target.value === 'ban' ? 'ban' : 'kick')}>
                <option value="kick">{t('gn.kk.warnActionKick')}</option>
                <option value="ban">{t('gn.kk.warnActionBan')}</option>
              </select>
            </Field>}
            {!(f.ladder ?? []).length && f.warnAction === 'ban' && (
              <Field label={t('gn.kk.warnBanTime')}>
                <p className="mb-1 text-xs text-mute">{t('gn.kk.warnBanTimeHint')}</p>
                <input className="input w-32 font-mono" value={f.warnBanTime} maxLength={12} onChange={(e) => set('warnBanTime', e.target.value)} />
              </Field>
            )}
          </div>
          <div className="space-y-2" data-testid="warn-ladder">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h4 className="font-extrabold">{t('gn.kk.ladder')}</h4>
                <p className="text-sm font-semibold text-mute">{t('gn.kk.ladderNote')}</p>
              </div>
              <button type="button" className="btn btn-soft btn-sm" disabled={(f.ladder ?? []).length >= 6} onClick={() => set('ladder', [...(f.ladder ?? []), { at: Math.max(0, ...(f.ladder ?? []).map((x) => x.at)) + 1, action: 'kick', time: '1d' }])}>{t('gn.kk.ladderAdd')}</button>
            </div>
            {(f.ladder ?? []).map((r, i) => (
              <div key={i} className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-bold">{t('gn.kk.ladderAt')}</span>
                <input className="input w-20" type="number" min={1} max={50} aria-label={t('gn.kk.ladderAt')} value={r.at} onChange={(e) => set('ladder', (f.ladder ?? []).map((x, j) => (j === i ? { ...x, at: Number(e.target.value) } : x)))} />
                <select className="input w-40" aria-label={t('gn.kk.warnAction')} value={r.action} onChange={(e) => set('ladder', (f.ladder ?? []).map((x, j) => (j === i ? { ...x, action: e.target.value === 'ban' ? 'ban' : 'kick' } : x)))}>
                  <option value="kick">{t('gn.kk.warnActionKick')}</option>
                  <option value="ban">{t('gn.kk.warnActionBan')}</option>
                </select>
                {r.action === 'ban' && <input className="input w-28 font-mono" aria-label={t('gn.kk.warnBanTime')} value={r.time} maxLength={12} onChange={(e) => set('ladder', (f.ladder ?? []).map((x, j) => (j === i ? { ...x, time: e.target.value } : x)))} />}
                <button type="button" className="btn btn-ghost btn-sm" aria-label={t('common.remove')} onClick={() => set('ladder', (f.ladder ?? []).filter((_, j) => j !== i))}>{t('common.remove')}</button>
              </div>
            ))}
          </div>
        </WithPreview>
      )}

      {part === 'reasons' && (
        <div className="space-y-3">
          <p className="text-sm font-semibold text-mute">{t('gn.kk.reasonsNote')}</p>
          {f.reasons.length === 0 && <EmptyState icon={<IconEdit size={22} />} title={t('gn.kk.reasonsEmpty')} hint={t('gn.kk.reasonsEmptyHint')} />}
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
