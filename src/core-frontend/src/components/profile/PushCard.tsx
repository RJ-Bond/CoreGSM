/** Profile → Безопасность: notifications on this device (Web Push), the same as the inbox in the header. */
import { useEffect, useState } from 'react';
import { api } from '../../api';
import { Button, ErrorLine, Section, Switch, toast } from '../../ui';

type State = 'unsupported' | 'denied' | 'off' | 'on' | 'loading';

const b64ToBytes = (s: string) => {
  const raw = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
};
const supported = () => typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

interface InstallPrompt extends Event { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> }
const installPrompt = () => (window as unknown as { __installPrompt?: InstallPrompt }).__installPrompt;

interface Quiet { enabled: boolean; fromMin: number; toMin: number; tz: number }
const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const toMin = (v: string) => { const [h, m] = v.split(':').map(Number); return Number.isFinite(h) && Number.isFinite(m) ? h * 60 + m : null; };

/** quiet hours: no pushes to the devices in this window of the user's own day (the inbox still collects them) */
function QuietHours() {
  const [q, setQ] = useState<Quiet | null>(null);
  useEffect(() => { api<Quiet>('/push/quiet').then(setQ).catch(() => undefined); }, []);
  if (!q) return null;
  const save = (next: Quiet) => {
    const body = { ...next, tz: -new Date().getTimezoneOffset() };
    setQ(body);
    api<Quiet>('/push/quiet', 'PUT', body).then(() => toast('Сохранено')).catch((e: Error) => toast(e.message));
  };
  return (
    <div className="mt-4 space-y-2 border-t border-line pt-4">
      <label className="flex cursor-pointer items-center gap-3 font-extrabold">
        <Switch checked={q.enabled} onChange={(v) => save({ ...q, enabled: v })} />
        Тихие часы
      </label>
      <p className="text-sm font-semibold text-mute">В это время уведомления на устройства не приходят. Они остаются в колокольчике в шапке сайта.</p>
      {q.enabled && (
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-sm font-bold">с <input type="time" className="input w-auto" value={hhmm(q.fromMin)} onChange={(e) => { const m = toMin(e.target.value); if (m != null) save({ ...q, fromMin: m }); }} /></label>
          <label className="flex items-center gap-2 text-sm font-bold">до <input type="time" className="input w-auto" value={hhmm(q.toMin)} onChange={(e) => { const m = toMin(e.target.value); if (m != null) save({ ...q, toMin: m }); }} /></label>
        </div>
      )}
    </div>
  );
}

export function PushCard() {
  const [state, setState] = useState<State>('loading');
  const [installable, setInstallable] = useState(() => !!installPrompt());
  useEffect(() => {
    const on = () => setInstallable(true);
    window.addEventListener('coregsm:installable', on);
    return () => window.removeEventListener('coregsm:installable', on);
  }, []);
  const install = async () => {
    const p = installPrompt();
    if (!p) return;
    await p.prompt();
    const { outcome } = await p.userChoice;
    if (outcome === 'accepted') {
      (window as unknown as { __installPrompt?: InstallPrompt }).__installPrompt = undefined;
      setInstallable(false);
    }
  };
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!supported()) return setState('unsupported');
    if (Notification.permission === 'denied') return setState('denied');
    navigator.serviceWorker.ready.then((r) => r.pushManager.getSubscription()).then((s) => setState(s ? 'on' : 'off')).catch(() => setState('off'));
  }, []);

  const turnOn = async () => {
    setBusy(true);
    setError('');
    try {
      if ((await Notification.requestPermission()) !== 'granted') return setState('denied');
      const { publicKey } = await api<{ publicKey: string }>('/push/key');
      const reg = await navigator.serviceWorker.ready;
      const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(publicKey) }));
      await api('/push/subscribe', 'POST', sub.toJSON());
      setState('on');
      toast('Уведомления на этом устройстве включены');
    } catch (e) {
      setError((e as Error).message || 'Браузер не разрешил уведомления');
    } finally {
      setBusy(false);
    }
  };
  const turnOff = async () => {
    setBusy(true);
    try {
      const sub = await (await navigator.serviceWorker.ready).pushManager.getSubscription();
      if (sub) {
        await api('/push/subscribe', 'DELETE', { endpoint: sub.endpoint }).catch(() => undefined);
        await sub.unsubscribe();
      }
      setState('off');
    } finally {
      setBusy(false);
    }
  };
  const test = async () => {
    setBusy(true);
    await api<{ sent: number }>('/push/test', 'POST').then((r) => toast(r.sent ? 'Тестовое уведомление отправлено' : 'Не получилось доставить: включите уведомления заново')).catch((e: Error) => setError(e.message)).finally(() => setBusy(false));
  };

  return (
    <Section title="Уведомления на этом устройстве" description="Сервер упал или вернулся, на заполненном сервере освободилось место: придёт уведомление, даже если панель закрыта. Какие серверы — выбирается кнопкой «Подписаться» на странице сервера.">
      {state === 'unsupported' && <p className="text-sm font-semibold text-mute">Этот браузер не умеет получать уведомления от сайтов. На iPhone сначала добавьте панель на экран «Домой».</p>}
      {state === 'denied' && <p className="text-sm font-semibold text-warn">Уведомления запрещены в настройках браузера для этого сайта. Разрешите их там и обновите страницу.</p>}
      {(state === 'on' || state === 'off') && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <label className="flex cursor-pointer items-center gap-3 font-extrabold">
            <Switch checked={state === 'on'} disabled={busy} onChange={(v) => void (v ? turnOn() : turnOff())} />
            {state === 'on' ? 'Включены' : 'Выключены'}
          </label>
          {state === 'on' && <Button type="button" className="btn-soft btn-sm" loading={busy} onClick={() => void test()}>Проверить</Button>}
        </div>
      )}
      {installable && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-soft px-3 py-2.5">
          <span className="text-sm font-semibold">Установите панель как приложение: своя иконка, отдельное окно и уведомления как у приложений.</span>
          <button type="button" className="btn btn-sm" onClick={() => void install()}>Установить</button>
        </div>
      )}
      {state === 'on' && <QuietHours />}
      <ErrorLine text={error} />
    </Section>
  );
}
