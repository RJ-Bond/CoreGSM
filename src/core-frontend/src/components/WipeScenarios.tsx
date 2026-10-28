/**
 * Admin → Обслуживание: the wipe scenario of a server. One plan holds everything around a wipe: warnings in Discord
 * and in the game chat, the maintenance window, the wipe commands (RCON, with a new seed), a new season and the news.
 */
import { useEffect, useState } from 'react';
import { api, type Server } from '../api';
import { t, useI18n, type TKey } from '../i18n';
import { confirmDialog } from '../confirm';
import { t, useI18n, type TKey } from '../i18n';
import { Button, ErrorLine, Field, GameAvatar, Modal, Section, fmtDateTime, toast, errText } from '../ui';
import { ChannelPicker } from './ChannelPicker';
import '../styles/admin.css';

interface Step { step: string; ok: boolean; text: string; at: number }
interface Wipe {
  id: number;
  name: string;
  wipeAt: number;
  status: 'scheduled' | 'done' | 'missed' | 'cancelled';
  announceMin: number[];
  sayMin: number[];
  channelId: string;
  durationMin: number;
  commands: string[];
  seedMode: 'none' | 'random' | 'fixed';
  seed: string;
  seasonName: string;
  newsChannelId: string;
  newsTitle: string;
  newsText: string;
  mention: 'none' | 'here' | 'everyone';
  steps: Step[];
  failed: number;
}

const ANNOUNCE: { m: number; label: TKey }[] = [{ m: 10_080, label: 'd2.ws.a.week' }, { m: 1440, label: 'd2.ws.a.day' }, { m: 180, label: 'd2.ws.a.3h' }, { m: 60, label: 'd2.ws.a.h' }, { m: 10, label: 'd2.ws.a.10m' }];
const SAY: { m: number; label: TKey }[] = [{ m: 30, label: 'd2.ws.a.30m' }, { m: 10, label: 'd2.ws.a.10m' }, { m: 5, label: 'd2.ws.a.5m' }, { m: 1, label: 'd2.ws.a.1m' }];
const STEP_LABEL: Record<string, TKey> = { window: 'd2.ws.s.window', commands: 'd2.ws.s.commands', season: 'd2.ws.s.season', news: 'd2.ws.s.news', discord: 'd2.ws.s.discord', say: 'd2.ws.s.say', missed: 'd2.ws.s.missed' };
const STATUS: Record<Wipe['status'], { text: TKey; cls: string }> = {
  scheduled: { text: 'd2.ws.st.scheduled', cls: 'pill pill-ok' },
  done: { text: 'd2.ws.st.done', cls: 'pill pill-mute' },
  missed: { text: 'd2.ws.st.missed', cls: 'pill pill-bad' },
  cancelled: { text: 'd2.ws.st.cancelled', cls: 'pill pill-mute' },
};

/** the value of <input type="datetime-local"> for a timestamp (the browser's time zone) */
const localInput = (ts: number) => {
  const d = new Date(ts - new Date(ts).getTimezoneOffset() * 60_000);
  return d.toISOString().slice(0, 16);
};

const blank = (): Wipe => ({
  id: 0,
  name: t('d2.ws.defName'),
  wipeAt: Date.now() + 3 * 86_400_000,
  status: 'scheduled',
  announceMin: [1440, 60, 10],
  sayMin: [10, 1],
  channelId: '',
  durationMin: 15,
  commands: [],
  seedMode: 'none',
  seed: '',
  seasonName: '',
  newsChannelId: '',
  newsTitle: t('d2.ws.defNewsTitle'),
  newsText: t('d2.ws.defNewsText'),
  mention: 'none',
  steps: [],
  failed: 0,
});

export default function WipeScenarios({ servers }: { servers: Server[] }) {
  useI18n();
  const [open, setOpen] = useState<Server | null>(null);
  const [next, setNext] = useState<Record<number, Wipe | null>>({});
  const load = () => {
    for (const s of servers) {
      api<Wipe[]>(`/servers/${s.id}/wipes`)
        .then((l) => setNext((x) => ({ ...x, [s.id]: l.find((w) => w.status === 'scheduled') ?? null })))
        .catch(() => undefined);
    }
  };
  useEffect(load, [servers]);
  if (!servers.length) return null;
  return (
    <Section
      title={t('d2.ws.title')}
      description={t('d2.ws.desc')}
    >
      <ul className="grid grid-cols-[minmax(0,1fr)] gap-2">
        {servers.map((s) => {
          const w = next[s.id];
          return (
            <li key={s.id} className="flex flex-wrap items-center gap-3 rounded-2xl bg-soft px-3 py-2.5">
              <GameAvatar game={s.game} size={32} />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-extrabold">{s.name}</span>
                <span className="block text-sm font-semibold text-mute">
                  {w === undefined ? <span className="skeleton inline-block h-3 w-40 rounded-full align-middle" /> : w ? `${w.name} · ${fmtDateTime(w.wipeAt)}` : t('d2.ws.none')}
                </span>
              </span>
              {w && <span className="pill pill-ok">{t('d2.ws.st.scheduled')}</span>}
              <button type="button" className="btn btn-soft btn-sm" onClick={() => setOpen(s)}>{t('d2.ws.scenarios')}</button>
            </li>
          );
        })}
      </ul>
      {open && <WipeModal server={open} onClose={() => { setOpen(null); load(); }} />}
    </Section>
  );
}

function WipeModal({ server, onClose }: { server: Server; onClose: () => void }) {
  useI18n();
  const [list, setList] = useState<Wipe[] | null>(null);
  const [edit, setEdit] = useState<Wipe | null>(null);
  const [error, setError] = useState('');
  const load = () => api<Wipe[]>(`/servers/${server.id}/wipes`).then(setList).catch((e: Error) => setError(e.message));
  useEffect(() => { void load(); }, []);

  const remove = async (w: Wipe) => {
    if (w.status === 'scheduled' && !(await confirmDialog({ title: t('d2.ws.c.title', { name: w.name }), text: t('d2.ws.c.text'), confirmLabel: t('d2.ws.c.confirm'), danger: true }))) return;
    await api(`/wipes/${w.id}`, 'DELETE').then(() => load()).catch((e: Error) => setError(e.message));
  };

  if (edit) return <WipeForm server={server} wipe={edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); void load(); }} />;
  return (
    <Modal title={t('d2.ws.wipes', { name: server.name })} onClose={onClose}>
      <div className="space-y-3">
        <ErrorLine text={error} />
        {list === null ? <div className="skeleton h-20 rounded-2xl" /> : list.length === 0 ? <p className="text-sm font-semibold text-mute">{t('d2.ws.empty')}</p> : (
          <ul className="grid grid-cols-[minmax(0,1fr)] gap-2">
            {list.map((w) => (
              <li key={w.id} className="rounded-2xl bg-soft px-3.5 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-extrabold">{w.name}</span>
                  <span className={STATUS[w.status].cls}>{t(STATUS[w.status].text)}</span>
                  {w.failed > 0 && <span className="pill pill-bad">{t('d2.ws.errors', { n: w.failed })}</span>}
                  <span className="ml-auto text-sm font-bold text-mute">{fmtDateTime(w.wipeAt)}</span>
                </div>
                {w.steps.length > 0 && (
                  <ul className="mt-2 space-y-0.5 text-sm font-semibold">
                    {w.steps.map((s, i) => <li key={i} className={s.ok ? 'text-mute' : 'text-bad'}>{s.ok ? '✓' : '✗'} {STEP_LABEL[s.step] ? t(STEP_LABEL[s.step]) : s.step}: {s.text}</li>)}
                  </ul>
                )}
                <div className="mt-2 flex gap-2">
                  {w.status === 'scheduled' && <button type="button" className="btn btn-soft btn-sm" onClick={() => setEdit(w)}>{t('d2.news.change')}</button>}
                  <button type="button" className="btn btn-ghost btn-sm text-bad" onClick={() => void remove(w)}>{w.status === 'scheduled' ? t('d2.ws.cancel') : t('common.remove')}</button>
                </div>
              </li>
            ))}
          </ul>
        )}
        <div className="flex justify-between gap-2">
          <button type="button" className="btn btn-ghost" onClick={onClose}>{t('common.close')}</button>
          <Button type="button" onClick={() => setEdit(blank())}>{t('d2.ws.schedule')}</Button>
        </div>
      </div>
    </Modal>
  );
}

function WipeForm({ server, wipe, onClose, onSaved }: { server: Server; wipe: Wipe; onClose: () => void; onSaved: () => void }) {
  useI18n();
  const [f, setF] = useState(wipe);
  const [at, setAt] = useState(localInput(wipe.wipeAt));
  const [cmds, setCmds] = useState(wipe.commands.join('\n'));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const toggle = (key: 'announceMin' | 'sayMin', m: number) =>
    setF((x) => ({ ...x, [key]: x[key].includes(m) ? x[key].filter((v) => v !== m) : [...x[key], m] }));

  const save = async () => {
    const ts = new Date(at).getTime();
    if (!Number.isFinite(ts)) return setError(t('d2.ws.e.date'));
    setBusy(true);
    setError('');
    const body = {
      name: f.name, wipeAt: ts, announceMin: f.announceMin, sayMin: f.sayMin, channelId: f.channelId, durationMin: f.durationMin,
      commands: cmds.split('\n').map((c) => c.trim()).filter(Boolean), seedMode: f.seedMode, seed: f.seed, seasonName: f.seasonName,
      newsChannelId: f.newsChannelId, newsTitle: f.newsTitle, newsText: f.newsText, mention: f.mention,
    };
    try {
      await (wipe.id ? api(`/wipes/${wipe.id}`, 'PUT', body) : api(`/servers/${server.id}/wipes`, 'POST', body));
      toast(t('d2.ws.t.saved'));
      onSaved();
    } catch (e) {
      setError(errText(e));
    }
    setBusy(false);
  };

  return (
    <Modal title={wipe.id ? t('d2.ws.edit') : t('d2.ws.schedule')} onClose={onClose}>
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label={t('d2.sf.name')}><input className="input" maxLength={60} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
          <Field label={t('d2.ws.when')}><input className="input" type="datetime-local" value={at} onChange={(e) => setAt(e.target.value)} /></Field>
          <Field label={t('d2.ws.window')}><input className="input" type="number" min={1} max={240} value={f.durationMin} onChange={(e) => setF({ ...f, durationMin: Number(e.target.value) })} /></Field>
        </div>

        <fieldset className="space-y-3 rounded-2xl bg-soft p-3.5">
          <legend className="px-1 font-extrabold">{t('d2.ws.g1')}</legend>
          <div>
            <span className="label">{t('d2.ws.inDiscord')}</span>
            <div className="flex flex-wrap gap-1.5">
              {ANNOUNCE.map((a) => <button key={a.m} type="button" className={`rp-day ${f.announceMin.includes(a.m) ? 'is-on' : ''}`} aria-pressed={f.announceMin.includes(a.m)} onClick={() => toggle('announceMin', a.m)}>{t(a.label)}</button>)}
            </div>
          </div>
          <div>
            <span className="label">{t('d2.ws.inGame')}</span>
            <div className="flex flex-wrap gap-1.5">
              {SAY.map((a) => <button key={a.m} type="button" className={`rp-day ${f.sayMin.includes(a.m) ? 'is-on' : ''}`} aria-pressed={f.sayMin.includes(a.m)} onClick={() => toggle('sayMin', a.m)}>{t(a.label)}</button>)}
            </div>
          </div>
          <div>
            <span className="label">{t('d2.ws.channel')}</span>
            <ChannelPicker id="wipe-channel" value={f.channelId} onChange={(v) => setF({ ...f, channelId: v })} />
            <p className="mt-1 text-sm font-semibold text-mute">{t('d2.ws.channelNote')}</p>
          </div>
        </fieldset>

        <fieldset className="space-y-3 rounded-2xl bg-soft p-3.5">
          <legend className="px-1 font-extrabold">{t('d2.ws.g2')}</legend>
          <Field label={t('d2.ws.rcon')}>
            <textarea className="input min-h-20 font-mono" value={cmds} onChange={(e) => setCmds(e.target.value)} placeholder={'server.seed {seed}\nserver.writecfg'} />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t('d2.ws.seedLabel')}>
              <select className="input" value={f.seedMode} onChange={(e) => setF({ ...f, seedMode: e.target.value as Wipe['seedMode'] })}>
                <option value="none">{t('d2.ws.seed.none')}</option>
                <option value="random">{t('d2.ws.seed.random')}</option>
                <option value="fixed">{t('d2.ws.seed.fixed')}</option>
              </select>
            </Field>
            {f.seedMode === 'fixed' && <Field label={t('d2.ws.seed')}><input className="input font-mono" maxLength={40} value={f.seed} onChange={(e) => setF({ ...f, seed: e.target.value })} /></Field>}
          </div>
          <Field label={t('d2.ws.season')}><input className="input" maxLength={60} value={f.seasonName} onChange={(e) => setF({ ...f, seasonName: e.target.value })} placeholder={t('d2.ws.seasonEx')} /></Field>
          <p className="text-sm font-semibold text-mute">{t('d2.ws.vars')}</p>
        </fieldset>

        <fieldset className="space-y-3 rounded-2xl bg-soft p-3.5">
          <legend className="px-1 font-extrabold">{t('d2.ws.g3')}</legend>
          <div>
            <span className="label">{t('d2.ws.newsChannel')}</span>
            <ChannelPicker id="wipe-news-channel" value={f.newsChannelId} onChange={(v) => setF({ ...f, newsChannelId: v })} />
          </div>
          {f.newsChannelId && (
            <>
              <Field label={t('d2.ws.newsTitle')}><input className="input" maxLength={200} value={f.newsTitle} onChange={(e) => setF({ ...f, newsTitle: e.target.value })} /></Field>
              <Field label={t('d2.ws.newsText')}><textarea className="input min-h-20" maxLength={2000} value={f.newsText} onChange={(e) => setF({ ...f, newsText: e.target.value })} /></Field>
              <Field label={t('d2.ws.mention')}>
                <select className="input" value={f.mention} onChange={(e) => setF({ ...f, mention: e.target.value as Wipe['mention'] })}>
                  <option value="none">{t('d2.ws.mention.none')}</option>
                  <option value="here">@here</option>
                  <option value="everyone">@everyone</option>
                </select>
              </Field>
            </>
          )}
        </fieldset>

        <ErrorLine text={error} />
        <div className="flex justify-end gap-2">
          <button type="button" className="btn btn-ghost" onClick={onClose}>{t('wn.back')}</button>
          <Button type="button" loading={busy} onClick={() => void save()}>{t('common.save')}</Button>
        </div>
      </div>
    </Modal>
  );
}
