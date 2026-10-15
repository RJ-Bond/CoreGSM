import { useState, type ReactNode } from 'react';
import { AccentPicker } from '../components/AccentPicker';
import { BtnSpinner } from '../components/Button';
import { SplitButton } from '../components/SplitButton';
import { Gauge } from '../components/Gauge';
import MaintenanceChip from '../components/MaintenanceChip';
import { buildSparkline } from '../sparkline';
import { confirmDialog, promptDialog } from '../confirm';
import { SubscribeForm } from '../components/server/SubscribeMenu';
import { badgeText, type SubKind } from '../notifications';
import { unreadableSecrets } from '../security';
import {
  AdminPage, Button, Empty, ErrorLine, FieldError, FillBar, GoLink, ICON_SET, IconBell, IconPlus, IconRefresh, IconTrash, IconEdit, Modal,
  Notice, PageHead, PasswordField, SaveBadge, Section, Spinner, StateView, StatusPill, Strip, Switch, TextField, ThemeToggle, toast, undoable,
  type SaveStatus,
} from '../ui';

/** reference page for future screens: /_ui (administrators only, not listed in any menu) */

const RADII: [string, string][] = [['sm', '8 px'], ['md', '12 px'], ['lg', '16 px'], ['xl', '26 px'], ['pill', '9999 px']];
const SHADOWS: [string, string][] = [['shadow-1', 'мелкие элементы'], ['shadow-2', 'карточки'], ['shadow-3', 'всплывающее']];
const SURFACES: [string, string, string][] = [
  ['page', 'bg-page', 'фон страницы'], ['card', 'bg-card', 'карточка'], ['raised', 'bg-raised', 'диалоги, меню'], ['soft', 'bg-soft', 'поля, подложки'],
];
const TEXTS: [string, string][] = [['text-ink', 'Основной текст'], ['text-mute', 'Вторичный текст'], ['text-link', 'Ссылка и акцент'], ['text-ok', 'Успех'], ['text-warn', 'Внимание'], ['text-bad', 'Ошибка']];

function Block({ title, note, children }: { title: string; note?: ReactNode; children: ReactNode }) {
  return (
    <Section title={title} description={note}>
      {children}
    </Section>
  );
}

const Row = ({ label, children }: { label?: string; children: ReactNode }) => (
  <div className="space-y-2">
    {label && <div className="text-sm font-extrabold text-mute">{label}</div>}
    <div className="flex flex-wrap items-center gap-2.5">{children}</div>
  </div>
);

/** one specimen (buttons, pill, field, switch, card) that is shown in a forced theme next to the other one */
/** bell badge, subscription kinds, new-device strip and the unreadable-secrets list: the pieces of the notification and security extras */
function NotifyExtras() {
  const [kinds, setKinds] = useState<SubKind[]>(['free_slot']);
  const secrets = unreadableSecrets(['discord_token', 'smtp_password', 'proxy_url']);
  return (
    <div className="space-y-4">
      <Row label="Колокольчик: значок непрочитанных (до 99, дальше 99+)">
        {[0, 3, 99, 150].map((n) => (
          <span key={n} className="relative grid h-10 w-10 place-items-center rounded-full bg-soft text-mute">
            <IconBell size={20} />
            {badgeText(n) && <span className="absolute -right-1 -top-1 min-w-[18px] rounded-full bg-bad px-1 text-center text-[11px] font-extrabold leading-[18px] text-white shadow-[0_0_0_2px_rgb(var(--card))]">{badgeText(n)}</span>}
          </span>
        ))}
      </Row>
      <div className="max-w-md"><SubscribeForm kinds={kinds} onChange={setKinds} discordLinked={false} idPrefix="kit-sub" /></div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2.5 rounded-2xl bg-warnbg px-4 py-3 text-warn">
        <span className="min-w-0 flex-1 basis-60 text-sm font-bold">Вход с нового устройства: Chrome на Windows. Это были вы?</span>
        <span className="flex gap-2"><button className="btn btn-soft btn-sm">Это я</button><button className="btn btn-danger btn-sm">Нет, выйти на всех устройствах</button></span>
      </div>
      <div className="space-y-2 rounded-ui-lg bg-warnbg p-4 text-warn">
        <h3 className="font-black">Часть секретов не удалось прочитать</h3>
        <ul className="list-disc pl-5 font-bold">{secrets.map((x) => <li key={x.id}>{x.label}</li>)}</ul>
      </div>
    </div>
  );
}

/** the button system: every variant at every size, then the states; `compact` is the short version shown in both themes */
const BTN_VARIANTS: [string, string][] = [
  ['btn', 'Основная'], ['btn btn-soft', 'Мягкая'], ['btn btn-outline', 'Контур'], ['btn btn-ghost', 'Призрачная'],
  ['btn btn-danger', 'Опасная'], ['btn btn-danger-solid', 'Удалить'], ['btn btn-success', 'Успех'], ['btn btn-success-solid', 'Готово'], ['btn btn-warn', 'Внимание'],
];
const BTN_SIZES: [string, string][] = [['btn-xs', 'XS 28'], ['btn-sm', 'SM 34'], ['', 'MD 42'], ['btn-lg', 'LG 50']];

function ButtonKit({ compact = false }: { compact?: boolean }) {
  const [pressed, setPressed] = useState({ a: true, b: false });
  const [group, setGroup] = useState('week');
  const sizes = compact ? BTN_SIZES.filter(([c]) => c === 'btn-sm' || c === '') : BTN_SIZES;
  return (
    <div className="space-y-4">
      {sizes.map(([sz, name]) => (
        <Row key={name} label={`Размер ${name} px`}>
          {BTN_VARIANTS.map(([cls, label]) => <button key={cls} type="button" className={`${cls} ${sz}`}>{label}</button>)}
        </Row>
      ))}
      <Row label="Недоступные (disabled)">
        {BTN_VARIANTS.map(([cls, label]) => <button key={cls} type="button" className={cls} disabled>{label}</button>)}
      </Row>
      <Row label="Загрузка (aria-busy, спиннер перед текстом)">
        {BTN_VARIANTS.map(([cls, label]) => <button key={cls} type="button" className={cls} disabled aria-busy="true"><BtnSpinner />{label}</button>)}
      </Row>
      <Row label="Переключатели (aria-pressed)">
        <button type="button" className="btn btn-soft" aria-pressed={pressed.a} onClick={() => setPressed((p) => ({ ...p, a: !p.a }))}>Включено</button>
        <button type="button" className="btn btn-soft" aria-pressed={pressed.b} onClick={() => setPressed((p) => ({ ...p, b: !p.b }))}>Выключено</button>
        <button type="button" className="btn btn-outline" aria-pressed>Контур</button>
        <button type="button" className="btn btn-ghost" aria-pressed>Призрачная</button>
        <button type="button" className="btn-icon" aria-pressed aria-label="Закреплено"><IconBell /></button>
      </Row>
      <Row label="С иконкой и во всю ширину">
        <button type="button" className="btn"><IconPlus size={16} />С иконкой</button>
        <button type="button" className="btn btn-soft btn-sm"><IconRefresh size={16} />Обновить</button>
        <button type="button" className="btn btn-outline btn-sm"><IconEdit size={16} />Изменить</button>
        <button type="button" className="btn btn-danger btn-sm"><IconTrash size={16} />Удалить</button>
        <button type="button" className="btn btn-block">Во всю ширину</button>
      </Row>
      <Row label="Иконки-кнопки (всегда с aria-label)">
        <button type="button" className="btn-icon" aria-label="Обновить"><IconRefresh /></button>
        <button type="button" className="btn-icon-sm" aria-label="Обновить"><IconRefresh size={16} /></button>
        <button type="button" className="btn-icon-ghost" aria-label="Обновить"><IconRefresh /></button>
        <button type="button" className="btn-icon-danger" aria-label="Удалить"><IconTrash /></button>
        <button type="button" className="row-act" aria-label="Изменить"><IconEdit /></button>
        <button type="button" className="row-act row-act-danger" aria-label="Удалить"><IconTrash /></button>
        <button type="button" className="btn-icon" aria-label="Недоступно" disabled><IconRefresh /></button>
      </Row>
      <Row label="Текстовые: действие внутри текста">
        <span className="text-sm font-semibold">Обновите данные: <button type="button" className="btn-link">обновить список</button> или <button type="button" className="btn-link-danger">удалить токен</button>.</span>
      </Row>
      <Row label="Группа и составная кнопка">
        <span className="btn-group" role="group" aria-label="Период">
          {[['day', 'День'], ['week', 'Неделя'], ['month', 'Месяц']].map(([k, label]) => (
            <button key={k} type="button" className="btn btn-soft btn-sm" aria-pressed={group === k} onClick={() => setGroup(k)}>{label}</button>
          ))}
        </span>
        <span className="btn-group" role="group" aria-label="Действия">
          <button type="button" className="btn btn-outline btn-sm">Назад</button>
          <button type="button" className="btn btn-outline btn-sm">Вперёд</button>
        </span>
        <SplitButton label="Опросить" onClick={() => undefined} items={[{ key: 'a', label: 'Опросить все', hint: 'Все выбранные', onSelect: () => undefined }, { key: 'b', label: 'Только онлайн', onSelect: () => undefined }]} />
      </Row>
      <Row label="На градиенте и на обложке">
        <div className="cover-grad flex flex-wrap items-center gap-2.5 rounded-ui-lg p-4" style={{ ['--c1' as string]: '#4338ca', ['--c2' as string]: '#7c3aed' }}>
          <button type="button" className="btn-cta">Подключиться</button>
          <button type="button" className="btn-on-grad">Белая</button>
          <button type="button" className="btn-ghost-on-grad">Прозрачная</button>
          <button type="button" className="btn-glass"><IconBell size={18} />Подписаться</button>
          <button type="button" className="btn-glass-quiet">Тихая</button>
          <button type="button" className="btn-glass-quiet btn-glass-danger">Опасная</button>
          <button type="button" className="btn-icon-glass" aria-label="В избранное">☆</button>
          <button type="button" className="btn-glass" disabled>Недоступна</button>
          <span className="chip-on-grad">Чип</span>
        </div>
      </Row>
    </div>
  );
}

function Specimen() {
  const [on, setOn] = useState(true);
  const [seg, setSeg] = useState('a');
  return (
    <div className="space-y-3.5">
      <div className="panel space-y-3 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <button className="btn btn-sm">Основная</button>
          <button className="btn btn-soft btn-sm">Мягкая</button>
          <button className="btn btn-danger btn-sm">Опасная</button>
          <span className="pill pill-ok">ОНЛАЙН</span>
          <span className="pill pill-warn">ЛАГИ</span>
          <span className="pill pill-bad">ОФЛАЙН</span>
          <span className="pill pill-mute">ОЖИДАНИЕ</span>
        </div>
        <ButtonKit compact />
        <input className="input" defaultValue="Поле ввода" aria-label="Пример поля" />
        <label className="flex items-center gap-3 text-sm font-bold"><Switch checked={on} onChange={setOn} /> Переключатель</label>
        <div className="seg">
          {['a', 'b', 'c'].map((k, i) => <button key={k} type="button" className="seg-item" aria-pressed={seg === k} onClick={() => setSeg(k)}>Вкладка {i + 1}</button>)}
        </div>
      </div>
      <div className="panel panel-raised space-y-1 p-4">
        <div className="font-black">Приподнятая поверхность</div>
        <p className="text-sm font-semibold text-mute">Диалоги и меню: на один шаг светлее карточки.</p>
        <a href="/_ui" className="text-sm font-extrabold text-link hover:underline">Ссылка</a>
      </div>
    </div>
  );
}

export default function UiKitPage() {
  const [seg, setSeg] = useState('day');
  const [sw, setSw] = useState({ a: true, b: false });
  const [text, setText] = useState('Мой сервер');
  const [pw, setPw] = useState('');
  const [busy, setBusy] = useState(false);
  const [deleted, setDeleted] = useState(false);
  const [dialog, setDialog] = useState(false);
  const states: SaveStatus[] = ['idle', 'dirty', 'saving', 'saved', 'error'];

  return (
    <AdminPage
      head={(
        <PageHead
          title="UI-кит"
          subtitle="Справочник компонентов: кнопки, поля, карточки, уведомления, иконки"
          hint="Эталон для новых экранов: берите компоненты и токены отсюда, а не придумывайте новые значения. Страница доступна только администраторам."
          icon={<IconBell />}
        >
          <ThemeToggle />
        </PageHead>
      )}
    >
      <Block title="Обе темы рядом" note="Один и тот же набор в светлой и тёмной теме независимо от выбранной сейчас.">
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="kit-theme" data-kit-theme="light"><div className="mb-3 text-sm font-extrabold text-mute">Светлая</div><Specimen /></div>
          <div className="kit-theme" data-kit-theme="dark"><div className="mb-3 text-sm font-extrabold text-mute">Тёмная</div><Specimen /></div>
        </div>
      </Block>

      <Block title="Токены" note="Один набор радиусов и теней. В коде: rounded-ui-sm|md|lg|xl|pill, shadow-1|2|3, bg-page|card|raised|soft.">
        <Row label="Радиусы">
          {RADII.map(([k, px]) => (
            <div key={k} className="grid h-16 w-24 place-items-center border border-line bg-soft text-sm font-extrabold" style={{ borderRadius: `var(--r-${k})` }}>
              <span>{k}<span className="block text-xs font-semibold text-mute">{px}</span></span>
            </div>
          ))}
        </Row>
        <Row label="Тени">
          {SHADOWS.map(([k, d]) => (
            <div key={k} className={`grid h-20 w-36 place-items-center rounded-ui-lg bg-card text-center text-sm font-extrabold ${k}`}>
              <span>{k}<span className="block text-xs font-semibold text-mute">{d}</span></span>
            </div>
          ))}
        </Row>
        <Row label="Поверхности">
          {SURFACES.map(([k, cls, d]) => (
            <div key={k} className={`h-16 w-36 rounded-ui-md border border-line p-2 text-sm font-extrabold ${cls}`}>{k}<span className="block text-xs font-semibold text-mute">{d}</span></div>
          ))}
        </Row>
        <Row label="Текст (контраст не ниже 4.5:1 на карточке и подложке)">
          {TEXTS.map(([cls, t]) => <span key={cls} className={`rounded-ui-md bg-soft px-3 py-1.5 font-bold ${cls}`}>{t}</span>)}
        </Row>
      </Block>

      <Block
        title="Кнопки"
        note="Одна основная кнопка на экран, остальные мягкие или контурные; «Отмена» призрачная, опасное с подтверждением. В диалогах основная справа. Размеры: XS и SM в панелях инструментов и строках, MD в формах, LG для главного действия на экране. На телефоне высота не меньше 44 px. Иконка-кнопка всегда с aria-label."
      >
        <ButtonKit />
        <Row label="Компонент Button (loading, variant, size)">
          <Button loading={busy} onClick={() => { setBusy(true); window.setTimeout(() => setBusy(false), 1500); }}>{busy ? 'Сохраняю…' : 'С индикатором'}</Button>
          <Button variant="outline" size="sm">Контур</Button>
          <Button variant="ghost" size="sm">Призрачная</Button>
          <Button variant="danger-solid" size="lg">Крупная опасная</Button>
        </Row>
      </Block>

      <Block title="Статусы и пилюли">
        <Row>
          <span className="pill pill-ok">ГОТОВО</span>
          <span className="pill pill-warn">ВНИМАНИЕ</span>
          <span className="pill pill-bad">ОШИБКА</span>
          <span className="pill pill-mute">НЕЙТРАЛЬНО</span>
          <StatusPill online known />
          <StatusPill online known lag />
          <StatusPill online={false} known />
          <StatusPill online={false} known={false} />
        </Row>
        <Row label="Прогресс">
          <div className="w-full max-w-sm space-y-2">
            <FillBar value={30} max={100} color="rgb(var(--ok))" />
            <FillBar value={78} max={100} color="rgb(var(--warn))" />
            <FillBar value={95} max={100} color="rgb(var(--bad))" />
          </div>
        </Row>
      </Block>

      <Block title="Поля ввода" note="Проверка идёт при вводе, сообщение под полем. Изменённое поле показывает состояние сохранения.">
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField id="kit-text" label="Обычное поле" value={text} onChange={setText} hint="Подсказка под полем" />
          <TextField id="kit-err" label="С ошибкой" value="" onChange={() => undefined} error="Название не может быть пустым" />
          <TextField id="kit-dis" label="Недоступно" value="Только чтение" onChange={() => undefined} disabled />
          <div>
            <label htmlFor="kit-sel" className="label">Выпадающий список</label>
            <select id="kit-sel" className="input" defaultValue="2">
              <option value="1">Каждый день</option>
              <option value="2">Каждую неделю</option>
              <option value="0">Выключено</option>
            </select>
          </div>
          <TextField id="kit-area" label="Многострочное" value={text} onChange={setText} multiline rows={3} />
          <PasswordField id="kit-pw" label="Пароль" value={pw} onChange={setPw} autoComplete="new-password" hint="От 10 символов" />
        </div>
        <Row label="Состояния сохранения (SaveBadge)">
          {states.map((st) => (
            <span key={st} className="rounded-ui-md bg-soft px-3 py-1.5"><SaveBadge status={st} error={st === 'error' ? 'нет связи' : undefined} retry={st === 'error' ? () => undefined : undefined} />{st === 'idle' && <span className="text-sm font-semibold text-mute">пусто</span>}</span>
          ))}
        </Row>
        <FieldError id="kit-fe" text="Так выглядит сообщение об ошибке поля" />
      </Block>

      <Block title="Переключатели, флажки, сегменты">
        <div className="space-y-3">
          <label className="flex items-center gap-3 font-bold"><Switch checked={sw.a} onChange={(v) => setSw({ ...sw, a: v })} />Включён</label>
          <label className="flex items-center gap-3 font-bold"><Switch checked={sw.b} onChange={(v) => setSw({ ...sw, b: v })} />Выключен</label>
          <label className="flex items-center gap-3 font-bold opacity-100"><Switch checked disabled onChange={() => undefined} />Недоступен</label>
          <label className="flex items-center gap-3 font-bold"><input type="checkbox" defaultChecked />Флажок</label>
        </div>
        <Row label="Сегментированный переключатель">
          <div className="seg" role="group" aria-label="Период">
            {[['day', 'День'], ['week', 'Неделя'], ['month', 'Месяц']].map(([id, l]) => (
              <button key={id} type="button" className="seg-item" aria-pressed={seg === id} onClick={() => setSeg(id)}>{l}</button>
            ))}
          </div>
          <button type="button" className="chip-filter on">Фильтр включён</button>
          <button type="button" className="chip-filter">Фильтр</button>
        </Row>
        <AccentPicker />
      </Block>

      <Block title="Карточки и панели">
        <div className="grid gap-4 md:grid-cols-3">
          <div className="panel p-5"><div className="font-black">panel</div><p className="text-sm font-semibold text-mute">Карточка по умолчанию: радиус xl, тень 2.</p></div>
          <div className="tile tile-hover p-5"><div className="font-black">tile-hover</div><p className="text-sm font-semibold text-mute">Наведение меняет только тень.</p></div>
          <div className="panel panel-raised p-5"><div className="font-black">panel-raised</div><p className="text-sm font-semibold text-mute">Над карточкой: тень 3.</p></div>
        </div>
        <Section title="Section" description="Заголовок, пояснение и действия справа: так устроены все разделы админки." actions={<button className="btn btn-soft btn-sm">Действие</button>} tone="soft">
          <p className="font-semibold text-mute">Вложенная мягкая секция.</p>
        </Section>
        <Strip><span className="font-black">Strip</span><span className="text-sm font-semibold text-mute">тонкая карточка для панели инструментов</span><button className="btn btn-soft btn-sm">Кнопка</button></Strip>
        <div className="space-y-2.5">
          <Notice tone="info" action={<GoLink href="/_ui">Перейти</GoLink>}>Информационная полоса с действием.</Notice>
          <Notice tone="warn">Предупреждение: проверьте настройки.</Notice>
          <Notice tone="bad">Ошибка: что-то пошло не так.</Notice>
          <ErrorLine text="ErrorLine: короткая ошибка запроса" />
        </div>
      </Block>

      <Block title="Пустое состояние" note="Семейство StateView: empty, error (с «Повторить»), forbidden, notfound, offline. Empty — старое имя варианта empty.">
        <Empty title="Здесь пока пусто" text="Объясните, что это за раздел, и дайте один понятный шаг.">
          <button className="btn mt-3"><IconPlus size={16} />Добавить</button>
        </Empty>
        <div className="grid gap-3 md:grid-cols-2">
          <StateView kind="error" compact onRetry={() => toast('Повтор запроса')} />
          <StateView kind="forbidden" compact />
          <StateView kind="notfound" compact action={<a className="btn btn-soft" href="/servers">К серверам</a>} />
          <StateView kind="offline" compact onRetry={() => toast('Повтор запроса')} />
        </div>
      </Block>

      <Block title="Уведомления" note="toast(text), toast(text, 'err') и toast(text, { action: { label, onClick }, duration }). Удаление с отменой: undoable().">
        <Row>
          <button className="btn btn-soft" onClick={() => toast('Настройки сохранены')}>Успех</button>
          <button className="btn btn-soft" onClick={() => toast('Не удалось сохранить', 'err')}>Ошибка</button>
          <button className="btn btn-soft" onClick={() => toast('Сеанс завершён', 'info')}>Информация</button>
          <button className="btn btn-soft" onClick={() => toast('Элемент удалён', { action: { label: 'Отменить', onClick: () => toast('Восстановлено') }, duration: 6000 })}>С отменой</button>
          <button
            className="btn btn-soft"
            disabled={deleted}
            onClick={() => { setDeleted(true); undoable({ text: 'Пример удалён', commit: () => toast('Удаление выполнено'), restore: () => setDeleted(false) }); }}
          >
            {deleted ? 'Скрыто на 6 секунд' : 'Отложенное удаление'}
          </button>
        </Row>
      </Block>

      <Block title="Уведомления и безопасность" note="Колокольчик в шапке, подписка на сервер, баннер входа с нового устройства и предупреждение о нечитаемых секретах после восстановления копии.">
        <NotifyExtras />
      </Block>

      <Block title="Диалоги">
        <Row>
          <button className="btn btn-soft" onClick={() => setDialog(true)}>Modal</button>
          <button className="btn btn-soft" onClick={() => void confirmDialog({ title: 'Продолжить?', text: 'Обычное подтверждение без риска.', confirmLabel: 'Продолжить' })}>confirmDialog</button>
          <button className="btn btn-soft" onClick={() => void confirmDialog({ title: 'Удалить сервер?', text: 'Это действие нельзя отменить.', confirmLabel: 'Удалить', danger: true })}>Опасное подтверждение</button>
          <button className="btn btn-soft" onClick={() => void promptDialog({ title: 'Новое имя', label: 'Имя', value: 'Сервер' })}>promptDialog</button>
        </Row>
        {dialog && (
          <Modal title="Диалог" onClose={() => setDialog(false)}>
            <div className="space-y-3">
              <p className="font-semibold text-mute">Окно с заголовком и кнопкой закрытия: на телефоне это нижний лист.</p>
              <TextField id="kit-modal" label="Поле" value={text} onChange={setText} />
              <div className="flex justify-end gap-2"><button className="btn btn-soft" onClick={() => setDialog(false)}>Закрыть</button></div>
            </div>
          </Modal>
        )}
      </Block>

      <Block title="Загрузка">
        <div className="space-y-3">
          <div className="skeleton panel h-16" aria-hidden />
          <div className="space-y-2" aria-hidden>
            <div className="skeleton skel-line w-2/3" />
            <div className="skeleton skel-line w-1/2" />
            <div className="skeleton skel-line w-5/6" />
          </div>
          <div className="flex items-center gap-2 font-bold text-mute"><Spinner />Идёт загрузка…</div>
        </div>
      </Block>

      <Block title="Круговые индикаторы" note="Цвет по порогам: до 75 % спокойный, от 75 % жёлтый, от 90 % красный. Значение всегда написано в центре.">
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <Gauge value={0.32} label="Диск" display="32 %" caption="спокойно" />
          <Gauge value={0.78} label="Память" display="78 %" caption="внимание" />
          <Gauge value={0.94} label="База" display="94 %" caption="критично" />
          <Gauge value={null} label="Нет данных" display="–" caption="неизвестно" />
        </div>
      </Block>

      <Block title="Обслуживание и графики состояния" note="Метка «Тех. работы до …» и статус «Обслуживание» вместо Офлайн; статичные спарклайны на странице «Система».">
        <Row label="Статус и метка">
          <StatusPill online={false} known maintenance />
          <MaintenanceChip m={{ name: 'Обновление игры', until: Date.now() + 40 * 60_000 }} />
          <div className="cover-grad flex flex-wrap items-center gap-2.5 rounded-ui-lg p-3" style={{ ['--c1' as string]: '#4338ca', ['--c2' as string]: '#7c3aed' }}>
            <StatusPill glass online={false} known maintenance />
            <MaintenanceChip glass m={{ name: '', until: Date.now() + 40 * 60_000 }} />
          </div>
        </Row>
        <Row label="Спарклайн">
          {[[3, 4, 3, 6, 8, 7, 9, 12, 10, 11], [5, 5, 5, 5, 5, 5]].map((v, i) => {
            const sp = buildSparkline(v, 160, 40);
            return (
              <svg key={i} viewBox="0 0 160 40" width="160" height="40" className="rounded-ui-md bg-soft" role="img" aria-label={`Пример графика ${i + 1}`}>
                <path d={sp.area} className="fill-link" opacity="0.12" />
                <path d={sp.path} fill="none" className="stroke-link" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
              </svg>
            );
          })}
        </Row>
      </Block>

      <Block title="Иконки" note="Один набор: сетка 24 px, штрих 2 px, цвет currentColor. Импорт из '../ui' (или из '../icons').">
        <div className="kit-grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(5.5rem, 1fr))' }}>
          {ICON_SET.map(([name, Ic]) => (
            <div key={name} className="kit-icon">{Ic({ size: 24 })}<span>Icon{name}</span></div>
          ))}
        </div>
      </Block>
    </AdminPage>
  );
}
