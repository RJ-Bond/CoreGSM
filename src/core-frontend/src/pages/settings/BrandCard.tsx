/** Settings → Branding: community name, accent colours, theme presets and logo. */
import { useEffect, useRef, useState } from 'react';
import { onAccentChange, paintBrand } from '../../accent';
import { api, getToken } from '../../api';
import { useAuth } from '../../auth';
import { parseHex } from '../../colors';
import { AccentPicker } from '../../components/AccentPicker';
import { ErrorLine, FieldError, IconCheck, Logo, SaveBadge, Section, TextField, toast, useAutosave } from '../../ui';
import { errorText } from '../../apiErrors';

/** готовые темы: основной цвет и конец градиента */
const THEME_PRESETS = [
  { id: 'indigo', name: 'Индиго', c1: '#4f46e5', c2: '#3730a3' },
  { id: 'emerald', name: 'Изумруд', c1: '#059669', c2: '#047857' },
  { id: 'sunset', name: 'Закат', c1: '#ea580c', c2: '#be185d' },
  { id: 'ocean', name: 'Океан', c1: '#0284c7', c2: '#1d4ed8' },
  { id: 'fuchsia', name: 'Фуксия', c1: '#c026d3', c2: '#7e22ce' },
  { id: 'graphite', name: 'Графит', c1: '#475569', c2: '#0f172a' },
] as const;

/** название, цвет и логотип сообщества: изменения сохраняются сами */
export function BrandCard() {
  const { access, reload } = useAuth();
  const b = access.brand;
  const [name, setName] = useState(b.name);
  const [color, setColor] = useState(b.color);
  const [color2, setColor2] = useState(b.color2 ?? '');
  const [preset, setPreset] = useState(b.preset ?? '');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const swatches = ['#4f46e5', '#7c3aed', '#db2777', '#e11d48', '#ea580c', '#16a34a', '#0891b2', '#2563eb'];
  const savedRef = useRef(b);
  savedRef.current = b;

  const pickColor = (c: string) => { setColor(c); setColor2(''); setPreset(''); };
  const pickPreset = (p: (typeof THEME_PRESETS)[number]) => { setColor(p.c1); setColor2(p.c2); setPreset(p.id); };

  // live preview of the chosen colours across the whole panel (a game accent chosen in «Внешний вид» still wins, see accent.ts)
  useEffect(() => {
    paintBrand(color, color2 || undefined);
    const root = document.documentElement;
    const mo = new MutationObserver(() => paintBrand(color, color2 || undefined));
    mo.observe(root, { attributes: true, attributeFilter: ['data-theme'] });
    const off = onAccentChange(() => paintBrand(color, color2 || undefined));
    return () => {
      mo.disconnect();
      off();
      paintBrand(savedRef.current.color, savedRef.current.color2 || undefined);
    };
  }, [color, color2]);

  // name and colours are saved as you go: on a pause, on leaving the name field, on picking a colour
  const form = { name, color, color2, preset };
  const savedForm = { name: b.name, color: b.color, color2: b.color2 ?? '', preset: b.preset ?? '' };
  const nameError = !name.trim() ? 'Введите название сообщества' : name.trim().length > 32 ? 'Не длиннее 32 символов' : '';
  const colorError = parseHex(color) ? '' : 'Цвет должен быть в формате #RRGGBB';
  const auto = useAutosave({
    value: form,
    saved: savedForm,
    delay: 800,
    validate: (f) => (!f.name.trim() ? 'Введите название сообщества' : f.name.trim().length > 32 ? 'Не длиннее 32 символов' : parseHex(f.color) ? null : 'Цвет должен быть в формате #RRGGBB'),
    save: async (f) => {
      await api('/branding', 'PUT', { name: f.name.trim(), color: f.color, color2: f.color2, preset: f.preset });
      await reload();
    },
  });

  const upload = async (file: File) => {
    setBusy(true);
    setError('');
    try {
      const r = await fetch('/api/branding/logo', { method: 'PUT', headers: { 'Content-Type': file.type, Authorization: `Bearer ${getToken() ?? ''}` }, body: file });
      if (!r.ok) throw new Error(errorText(await r.json().catch(() => null), 'Не удалось загрузить'));
      toast('Логотип обновлён');
      await reload();
    } catch (x) {
      setError((x as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const clearLogo = async () => { await api('/branding/logo', 'DELETE').catch(() => undefined); toast('Логотип сброшен'); await reload(); };

  return (
    <Section
      title="Оформление"
      description="Название, цвет и логотип вашего сообщества. Они видны в панели, на странице входа и в подвале сообщений Discord. Изменения сохраняются сами."
      actions={<SaveBadge status={auto.status} error={auto.error} retry={auto.retry} />}
      data-tour="brand"
    >
      <TextField
        id="brand-name"
        label="Название"
        value={name}
        maxLength={32}
        onChange={setName}
        error={nameError && name !== b.name ? nameError : undefined}
        onBlur={auto.flush}
        hint={`${name.trim().length} / 32`}
      />
      <div>
        <span className="label">Тема</span>
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
          {THEME_PRESETS.map((p) => {
            const on = preset === p.id;
            return (
              <button type="button" key={p.id} onClick={() => pickPreset(p)} aria-pressed={on} className={`rounded-ui-lg border bg-card p-2 text-left ${on ? 'border-transparent ring-2 ring-ink ring-offset-2 ring-offset-card' : 'border-line hover:shadow-1'}`}>
                <span className="block h-12 rounded-ui-md" style={{ background: `linear-gradient(135deg, ${p.c1}, ${p.c2})` }} />
                <span className="mt-1.5 block px-0.5 text-sm font-extrabold">{p.name}</span>
              </button>
            );
          })}
        </div>
      </div>
      <div>
        <span className="label">Свой цвет</span>
        <div className="flex flex-wrap items-center gap-2">
          {swatches.map((c) => (
            <button type="button" key={c} onClick={() => pickColor(c)} aria-label={c} aria-pressed={!preset && color === c} className={`h-9 w-9 rounded-full ring-offset-2 ring-offset-card ${!preset && color === c ? 'ring-2 ring-ink' : ''}`} style={{ background: c }} />
          ))}
          <input type="color" value={parseHex(color) ? color : '#4f46e5'} onChange={(e) => pickColor(e.target.value)} className="h-9 w-12 cursor-pointer rounded-ui-sm border border-line bg-card" aria-label="Свой цвет" />
        </div>
        <FieldError id="brand-color-err" text={colorError} />
      </div>
      <div>
        <span className="label">Как это выглядит</span>
        <div className="flex flex-wrap items-center gap-4 rounded-ui-lg border border-line bg-soft p-4">
          <Logo size={44} />
          <div className="min-w-0">
            <div className="truncate text-base font-black">{name.trim() || 'CoreGSM'}</div>
            <div className="text-sm font-semibold text-mute">Мониторинг игровых серверов</div>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <span className="btn pointer-events-none" aria-hidden>Кнопка</span>
            <span className="grid h-9 w-9 place-items-center rounded-ui-md bg-gradient-to-br from-brand to-brand-2 text-white shadow-1" aria-hidden>
              <IconCheck size={18} />
            </span>
          </div>
        </div>
      </div>
      <div>
        <span className="label">Логотип</span>
        <div className="flex flex-wrap items-center gap-3">
          <Logo size={48} />
          <label className="btn btn-soft btn-sm cursor-pointer">
            {busy ? 'Загружаю…' : 'Загрузить картинку'}
            <input type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); e.target.value = ''; }} />
          </label>
          {b.hasLogo && <button type="button" className="btn btn-soft btn-sm" onClick={() => void clearLogo()}>Сбросить</button>}
          <span className="text-sm font-semibold text-mute">PNG, JPG или WebP до 3 МБ, лучше квадрат</span>
        </div>
      </div>
      <ErrorLine text={error} />
      <div className="border-t border-line pt-4">
        <AccentPicker />
      </div>
    </Section>
  );
}
