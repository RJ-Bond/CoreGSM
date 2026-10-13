import { useRef, useState, type FormEvent } from 'react';
import { api, getToken, type ServerInput, type TestResult } from '../api';
import { GAMES } from '../games';
import GamePicker from '../components/GamePicker';
import { ErrorLine, Field, Modal } from '../ui';
import { COUNTRIES } from '../countries';
import { nextPort, shownFields, useGameProfiles } from '../gameProfiles';
import { t } from '../i18n';

export const emptyServer: ServerInput = { name: '', game: 'minecraft', host: '', port: 25565, queryPort: null, displayAddress: '', country: '' };

/** Add / edit a server. The first screen asks only what is needed; the rest is under "Дополнительно". */
export default function ServerForm({ initial, id, coverUrl, onCoverChanged, onClose, onSaved }: { initial: ServerInput; id?: number; coverUrl?: string | null; onCoverChanged?: () => void; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState(initial);
  const [cover, setCover] = useState<string | null>(coverUrl ?? null);
  const [coverBusy, setCoverBusy] = useState(false);

  const uploadCover = async (file: File) => {
    if (!id) return;
    setCoverBusy(true);
    setError('');
    try {
      const r = await fetch(`/api/servers/${id}/cover`, { method: 'PUT', headers: { 'Content-Type': file.type, Authorization: `Bearer ${getToken() ?? ''}` }, body: file });
      const j = (await r.json().catch(() => null)) as { coverUrl?: string; error?: string } | null;
      if (!r.ok) throw new Error(j?.error ?? 'Не удалось загрузить картинку (PNG, JPG или WebP до 5 МБ)');
      setCover(j?.coverUrl ?? null);
      onCoverChanged?.();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setCoverBusy(false);
    }
  };
  const removeCover = async () => {
    if (!id) return;
    setCoverBusy(true);
    try {
      await api(`/servers/${id}/cover`, 'DELETE');
      setCover(null);
      onCoverChanged?.();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setCoverBusy(false);
    }
  };
  const [custom, setCustom] = useState(!GAMES.some((g) => g.id === initial.game));
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState(false);
  const [test, setTest] = useState<TestResult | null>(null);

  // "advanced" is open when it already holds something (editing)
  const advancedUsed = !!(initial.name || initial.queryPort || initial.displayAddress || initial.country || coverUrl);

  const profiles = useGameProfiles();
  // true once the user typed a port themselves: a game change must not overwrite it
  const portTouched = useRef(false);

  const pickGame = (v: string) => {
    setTest(null);
    if (v === '__custom') { setCustom(true); return; }
    setCustom(false);
    const g = GAMES.find((x) => x.id === v);
    const nextDefault = profiles?.[v]?.defaultPort ?? g?.port;
    setF((p) => ({
      ...p,
      game: v,
      port: nextPort({
        current: p.port,
        touched: portTouched.current,
        hasHost: !!p.host,
        prevDefault: profiles?.[p.game]?.defaultPort ?? GAMES.find((x) => x.id === p.game)?.port,
        nextDefault,
      }),
    }));
  };

  const change = (patch: Partial<ServerInput>) => {
    setTest(null);
    setF((p) => ({ ...p, ...patch }));
  };

  const gameProfile = custom ? undefined : profiles?.[f.game];
  const fieldList = shownFields(gameProfile?.fields);

  const canTest = f.host.trim().length > 0 && f.game.length > 0 && f.port > 0;

  const runTest = async () => {
    setTesting(true);
    setError('');
    setTest(null);
    try {
      setTest(await api<TestResult>('/servers/test', 'POST', { game: f.game, host: f.host, port: f.port, queryPort: f.queryPort }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setTesting(false);
    }
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api(id ? `/servers/${id}` : '/servers', id ? 'PUT' : 'POST', f);
      onSaved();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  return (
    <Modal title={id ? 'Изменить сервер' : 'Новый сервер'} onClose={onClose}>
      <form onSubmit={submit} className="space-y-3.5">
        <div>
          <span className="label">Игра</span>
          <GamePicker id="srv-game" value={f.game} custom={custom} onPick={pickGame} autoFocus />
        </div>
        {custom && (
          <Field label="GameDig ID">
            <input id="srv-gameid" className="input" value={f.game} onChange={(e) => change({ game: e.target.value.trim() })} placeholder="например, arma3" required pattern="[A-Za-z0-9_]+" />
          </Field>
        )}
        <div className="grid grid-cols-3 gap-3">
          <div className="col-span-2">
            <Field label="Адрес для опроса (IP или домен)">
              <input id="srv-host" className="input" value={f.host} onChange={(e) => change({ host: e.target.value.trim() })} required placeholder="192.168.1.10" />
            </Field>
          </div>
          <Field label="Порт">
            <input id="srv-port" className="input" type="number" min={1} max={65535} value={f.port} onChange={(e) => { portTouched.current = true; change({ port: Number(e.target.value) }); }} required />
          </Field>
        </div>
        {gameProfile?.queryPortHint && <p className="-mt-2 text-sm font-semibold text-mute">{t('sf.queryHint', { hint: gameProfile.queryPortHint })}</p>}
        {fieldList.length > 0 && <p className="-mt-2 text-sm font-semibold text-mute">{t('sf.fields', { list: fieldList.map((k) => t(`sf.field.${k}` as const)).join(' / ') })}</p>}

        <div className="space-y-2">
          <button type="button" className="btn btn-soft" onClick={runTest} disabled={!canTest || testing}>
            {testing ? 'Опрашиваю…' : 'Проверить сервер'}
          </button>
          {test && test.online && (
            <div className="rounded-2xl bg-okbg px-4 py-3 text-sm font-bold text-ok" role="status">
              ✔ Сервер ответил{test.name ? `: «${test.name}»` : ''}
              <div className="mt-0.5 font-semibold">
                Игроков {test.players}/{test.maxPlayers}
                {test.map ? ` · карта ${test.map}` : ''}
                {test.ping != null ? ` · пинг ${test.ping} мс` : ''}
              </div>
            </div>
          )}
          {test && !test.online && (
            <div className="rounded-2xl bg-badbg px-4 py-3 text-sm font-bold text-bad" role="alert">
              ✖ {test.error ?? 'Сервер не ответил'}
            </div>
          )}
        </div>

        <details className="group rounded-2xl border-2 border-line px-4 py-2.5" open={advancedUsed}>
          <summary className="cursor-pointer select-none font-extrabold text-link">Дополнительно</summary>
          <div className="mt-3 space-y-3.5">
            <Field label="Название">
              <input id="srv-name" className="input" value={f.name} onChange={(e) => change({ name: e.target.value })} maxLength={64} placeholder="возьмётся из ответа сервера" />
            </Field>
            <p className="-mt-2 text-sm font-semibold text-mute">Оставьте пустым: панель использует название, которое сервер сообщает сам. Своё название переопределяет его.</p>
            <Field label="Query-порт (если отличается от порта игры)">
              <input id="srv-qport" className="input" type="number" min={1} max={65535} value={f.queryPort ?? ''} onChange={(e) => change({ queryPort: e.target.value ? Number(e.target.value) : null })} placeholder="не указан" />
            </Field>
            <Field label="Адрес для отображения">
              <input id="srv-display" className="input font-mono" value={f.displayAddress} onChange={(e) => change({ displayAddress: e.target.value.trim() })} maxLength={100} placeholder="play.example.com:25565 или внешний IP" />
            </Field>
            <Field label="Страна (для сообщения в Discord)">
              <select id="srv-country" className="input" value={f.country} onChange={(e) => change({ country: e.target.value })}>
                <option value="">Определить автоматически по адресу</option>
                {COUNTRIES.map(([code, name]) => <option key={code} value={code}>{name}</option>)}
              </select>
            </Field>
            <p className="-mt-2 text-sm font-semibold text-mute">Автоопределение не работает для адресов в локальной сети: выберите страну вручную, и флаг появится в сообщении.</p>
            <p className="-mt-2 text-sm font-semibold text-mute">Опрос идёт по адресу выше, а людям на странице и в карточке Discord показывается этот адрес. Нужен, если сервер в локальной сети, а снаружи доступен по другому IP или домену.</p>
            <div>
              <span className="label">Обложка</span>
              {id ? (
                <div className="flex flex-wrap items-center gap-3">
                  <div className="h-[72px] w-32 shrink-0 overflow-hidden rounded-xl border border-line bg-soft" style={cover ? { backgroundImage: `url(${cover})`, backgroundSize: 'cover', backgroundPosition: 'center' } : undefined} aria-hidden />
                  <label className="btn btn-soft btn-sm cursor-pointer">
                    {coverBusy ? 'Загружаю…' : 'Загрузить картинку'}
                    <input type="file" accept="image/png,image/jpeg,image/webp" className="hidden" disabled={coverBusy} onChange={(e) => { const file = e.target.files?.[0]; if (file) void uploadCover(file); e.target.value = ''; }} />
                  </label>
                  {cover && <button type="button" className="btn btn-soft btn-sm" onClick={() => void removeCover()} disabled={coverBusy}>Убрать</button>}
                  <span className="basis-full text-sm font-semibold text-mute">PNG, JPG или WebP до 5 МБ; обрезается до 16:9. Заменяет цветную обложку карточки и шапку страницы сервера.</span>
                </div>
              ) : (
                <p className="text-sm font-semibold text-mute">Картинку можно загрузить после создания сервера: откройте «Изменить».</p>
              )}
            </div>
          </div>
        </details>

        <ErrorLine text={error} />
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" className="btn btn-ghost" onClick={onClose}>Отмена</button>
          <button className="btn" disabled={busy || !canTest}>{busy ? 'Сохраняю…' : 'Сохранить'}</button>
        </div>
      </form>
    </Modal>
  );
}
