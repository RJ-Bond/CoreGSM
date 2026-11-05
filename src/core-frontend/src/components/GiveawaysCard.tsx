import { useEffect, useState } from 'react';
import { api } from '../api';
import { t } from '../i18n';
import { Button, Section, fail, toast } from '../ui';
import { ChannelName, ChannelPicker } from './ChannelPicker';

interface Item { id: number; prize: string; winners: number; endsAt: number; channelId: string; roleId: string; minHours: number; ended: boolean; winnerIds: string[]; entries: number }
const BLANK = { prize: '', winners: '1', hours: '24', minHours: '0', roleId: '', channelId: '' };

/** giveaways: the list with participants, «draw now» / «pick again», and a form to start one from the panel */
export default function GiveawaysCard() {
  const [items, setItems] = useState<Item[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState<typeof BLANK | null>(null);

  useEffect(() => {
    let alive = true;
    api<{ items: Item[] }>('/giveaways').then((r) => { if (alive) setItems(r.items); }).catch(() => undefined);
    return () => { alive = false; };
  }, []);
  if (!items) return null;

  const run = async (f: () => Promise<{ items: Item[] }>, ok: string) => {
    setBusy(true);
    try {
      setItems((await f()).items);
      toast(ok);
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };
  const start = async () => {
    if (!form) return;
    await run(() => api<{ items: Item[] }>('/giveaways', 'POST', { prize: form.prize, winners: Number(form.winners), hours: Number(form.hours), minHours: Number(form.minHours) || 0, roleId: form.roleId.trim(), channelId: form.channelId }), t('gw.started'));
    setForm(null);
  };
  const valid = !!form && form.prize.trim().length >= 2 && /^\d{15,25}$/.test(form.channelId) && Number(form.winners) >= 1 && Number(form.hours) > 0 && /^(\d{15,25})?$/.test(form.roleId.trim());

  return (
    <Section title={t('gw.title')}>
      <p className="mb-3 text-sm font-semibold text-mute">{t('gw.help')}</p>
      {items.length === 0 && !form && <p className="mb-3 text-sm font-semibold text-mute">{t('gw.empty')}</p>}
      <ul className="mb-3 grid gap-2">
        {items.map((g) => (
          <li key={g.id} className="rounded-xl border border-line p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <b>🎉 #{g.id} · {g.prize}</b>
              <span className="flex gap-2">
                {!g.ended && <button type="button" className="btn btn-soft btn-sm" disabled={busy} onClick={() => void run(() => api<{ items: Item[] }>(`/giveaways/${g.id}/end`, 'POST'), t('gw.drawn'))}>{t('gw.end')}</button>}
                {g.ended && <button type="button" className="btn btn-soft btn-sm" disabled={busy} onClick={() => void run(() => api<{ items: Item[] }>(`/giveaways/${g.id}/reroll`, 'POST'), t('gw.drawn'))}>{t('gw.reroll')}</button>}
                <button type="button" className="btn btn-soft btn-sm" disabled={busy} onClick={() => void run(() => api<{ items: Item[] }>(`/giveaways/${g.id}`, 'DELETE'), t('gw.deleted'))}>{t('ann.delete')}</button>
              </span>
            </div>
            <p className="mt-1 text-sm font-semibold text-mute">
              {g.ended ? t('gw.endedAt') : t('gw.endsAt', { d: new Date(g.endsAt).toLocaleString() })} · 👥 {g.entries} · 🏆 {g.winners}
              {g.minHours > 0 ? ` · ⏱️ ${g.minHours} ${t('gw.hoursShort')}` : ''} · <ChannelName id={g.channelId} />
            </p>
            {g.ended && <p className="mt-1 text-sm font-semibold">{g.winnerIds.length ? `🏆 ${g.winnerIds.join(', ')}` : t('gw.noWinners')}</p>}
          </li>
        ))}
      </ul>
      {form ? (
        <div className="grid gap-3">
          <div>
            <label htmlFor="gw-prize" className="label">{t('gw.prize')}</label>
            <input id="gw-prize" className="input w-full" maxLength={200} value={form.prize} onChange={(e) => setForm({ ...form, prize: e.target.value })} />
          </div>
          <div className="grid grid-cols-3 gap-2">
            <div>
              <label htmlFor="gw-winners" className="label">{t('gw.winners')}</label>
              <input id="gw-winners" type="number" min={1} max={20} className="input w-full" value={form.winners} onChange={(e) => setForm({ ...form, winners: e.target.value })} />
            </div>
            <div>
              <label htmlFor="gw-hours" className="label">{t('gw.hours')}</label>
              <input id="gw-hours" type="number" min={0.05} step="any" className="input w-full" value={form.hours} onChange={(e) => setForm({ ...form, hours: e.target.value })} />
            </div>
            <div>
              <label htmlFor="gw-min" className="label">{t('gw.minHours')}</label>
              <input id="gw-min" type="number" min={0} className="input w-full" value={form.minHours} onChange={(e) => setForm({ ...form, minHours: e.target.value })} />
            </div>
          </div>
          <div>
            <label htmlFor="gw-role" className="label">{t('gw.role')}</label>
            <input id="gw-role" className="input w-full" inputMode="numeric" placeholder={t('gw.roleHint')} value={form.roleId} onChange={(e) => setForm({ ...form, roleId: e.target.value })} />
          </div>
          <div>
            <span className="label">{t('gw.channel')}</span>
            <ChannelPicker id="gw-channel" value={form.channelId} onChange={(v) => setForm({ ...form, channelId: v })} />
          </div>
          <div className="flex gap-2">
            <Button type="button" loading={busy} disabled={!valid} onClick={() => void start()}>{t('gw.start')}</Button>
            <button type="button" className="btn btn-soft" onClick={() => setForm(null)}>{t('common.cancel')}</button>
          </div>
        </div>
      ) : (
        <button type="button" className="btn btn-soft" onClick={() => setForm({ ...BLANK })}>{t('gw.new')}</button>
      )}
    </Section>
  );
}
