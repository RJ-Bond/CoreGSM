/**
 * Error codes of the API. An error answer (status 400 and above) keeps its Russian text in `error` (the source
 * language, shown as is by older panels and the bot) and gets a stable `code`, plus `params` for the values a text
 * template holds ("{sec}"). The panel translates by the code (core-frontend/src/locales/errors.en.ts) and falls back
 * to the text. The handlers keep writing plain texts: `errorCodes` finds the code by the text, and
 * test/errors.test.ts fails when a text in the code is missing here or an entry here is no longer used.
 */
import type { RequestHandler } from 'express';

export const ERRORS = {
  // ---- request, access, limits ----
  bad_json: 'Некорректный JSON в запросе',
  too_large: 'Слишком большой запрос',
  bad_request: 'Некорректный запрос',
  internal_error: 'Внутренняя ошибка сервера',
  auth_required: 'Требуется вход',
  admin_only: 'Это действие доступно только администратору',
  staff_only: 'Это действие доступно администратору и модератору',
  csrf_header_missing: 'Запрос отклонён: не хватает заголовка X-CoreGSM',
  rate_limited: 'Слишком много запросов. Подождите минуту.',
  rate_limited_later: 'Слишком много запросов. Попробуйте позже.',
  too_many_attempts: 'Слишком много попыток. Подождите 10 минут.',
  bad_data: 'Неверные данные',
  bad_data_lower: 'неверные данные',
  check_form: 'Проверьте поля формы',
  check_fields: 'Проверьте поля',
  not_found: 'Не найдено',

  // ---- sign-in, setup, registration ----
  login_locked: 'Слишком много неверных попыток. Повторите через {sec} с.',
  ip_locked: 'Слишком много неудачных попыток входа с этого адреса. Повторите через {sec} с.',
  bad_credentials: 'Неверный логин или пароль',
  registration_pending: 'Заявка на регистрацию ещё не одобрена администратором',
  already_set_up: 'Панель уже настроена. Войдите под своим логином.',
  bad_setup_code: 'Неверный код установки',
  not_set_up: 'Панель ещё не настроена: сначала создайте администратора',
  registration_closed: 'Регистрация закрыта администратором',
  rules_required: 'Нужно согласиться с правилами сообщества',
  login_taken: 'Этот логин уже занят',
  too_many_registrations: 'Слишком много регистраций с этого адреса. Попробуйте позже.',
  username_format: 'Логин: 3-32 символа: буквы, цифры, пробел между словами, _ . -',
  password_min_10: 'Пароль должен быть не короче 10 символов',
  password_min_8: 'Пароль должен быть не короче 8 символов',

  // ---- the signed-in user ----
  new_password_min_8: 'Новый пароль должен быть не короче 8 символов',
  passwords_differ: 'Пароли не совпадают',
  wrong_current_password: 'Текущий пароль неверен',
  email_needs_password: 'Введите текущий пароль, чтобы изменить почту',
  check_address: 'Проверьте адрес',
  bad_email: 'Некорректный адрес электронной почты',
  email_taken: 'Этот адрес уже привязан к другому аккаунту',
  session_not_found: 'Сеанс не найден',
  set_password_first: 'Сначала задайте пароль в профиле: иначе войти будет нечем',
  unknown_timezone: 'Неизвестный часовой пояс',
  check_settings: 'Проверьте настройки',
  profile_text_limits: 'Ник — до 40 символов, о себе — до 200',
  unknown_banner: 'Неизвестный фон',
  profile_not_found: 'Профиль не найден или скрыт',
  image_unreadable: 'Не удалось прочитать картинку: выберите PNG, JPG или WebP',
  image_3mb: 'Нужна картинка PNG, JPG или WebP до 3 МБ',
  image_4mb: 'Нужна картинка PNG, JPG или WebP до 4 МБ',
  image_5mb: 'Нужна картинка PNG, JPG или WebP до 5 МБ',
  unknown_notification_type: 'Неизвестный тип уведомления',
  ids_or_all: 'Укажите ids или all',

  // ---- e-mail and password reset ----
  enter_login_or_email: 'Введите логин или адрес почты',
  mail_not_configured: 'Отправка почты не настроена администратором',
  mail_wait: 'Письмо уже отправлено. Подождите минуту перед повторной отправкой.',
  smtp_first: 'Сначала укажите SMTP-сервер и сохраните настройки',
  email_first: 'Сначала укажите адрес электронной почты',
  link_invalid: 'Ссылка недействительна или устарела',
  reset_link_invalid: 'Ссылка недействительна или устарела. Запросите сброс ещё раз.',
  test_mail_address: 'Укажите адрес, на который отправить пробное письмо',
  too_many_resets: 'Слишком много запросов на сброс пароля. Попробуйте позже.',
  smtp_host_format: 'Адрес сервера: только имя хоста или IP',

  // ---- users (administrators) ----
  request_not_found: 'Заявка не найдена',
  bad_role: 'Неверная роль',
  user_not_found: 'Пользователь не найден',
  last_admin_demote: 'Нельзя снять права с последнего администратора',
  last_admin_delete: 'Нельзя удалить последнего администратора',
  delete_self: 'Нельзя удалить собственную учётную запись',

  // ---- settings, branding, updates ----
  proxy_format: 'Прокси: host:port:логин:пароль, socks5://логин:пароль@host:port или http://host:port',
  branding_format: 'Название до 32 символов, цвет в виде #RRGGBB',
  players_shown_range: 'Число ников: от 0 до 20',
  poll_settings_range: 'Подтверждение недоступности: от 1 до 5 опросов, параллельность: от 1 до 32',
  update_not_configured: 'Обновление из панели не настроено на сервере. Выполните: sudo coregsm update',
  update_running: 'Обновление уже выполняется',
  update_request_failed: 'Не удалось создать запрос на обновление (нет прав на папку /app/update)',
  rollback_not_configured: 'Откат из панели не настроен на сервере. Выполните: sudo coregsm rollback',
  update_or_rollback_running: 'Сейчас выполняется обновление или откат',
  rollback_unavailable: 'Откат недоступен: предыдущая версия не сохранена',
  request_pending: 'Запрос уже ожидает выполнения',
  rollback_request_failed: 'Не удалось создать запрос на откат (нет прав на папку /app/update)',

  // ---- servers, Discord bindings, alerts, deliveries ----
  server_not_found: 'Сервер не найден',
  game_address_port: 'Укажите игру, адрес и порт',
  display_address_format: 'Адрес для отображения не должен содержать пробелов и кавычек',
  channel_id_format: 'ID канала — число из 15–25 цифр',
  alert_channel_first: 'Сначала выберите канал для оповещений',
  bulk_select: 'Выберите привязки и действие',
  delivery_not_found: 'Доставка не найдена',
  retry_failed_only: 'Повторить можно только неудавшуюся доставку',
  check_filter: 'Проверьте параметры фильтра',

  // ---- maintenance windows ----
  maintenance_not_found: 'Окно обслуживания не найдено',
  bad_date: 'Неверная дата',
  title_required: 'Укажите название',
  end_after_start: 'Окончание должно быть позже начала',
  window_max_7d: 'Окно обслуживания не может быть длиннее 7 суток',
  daily_max_24h: 'Ежедневное окно не может быть длиннее суток',

  // ---- news ----
  news_not_found: 'Новость не найдена',
  version_not_found: 'Версия не найдена',
  version_unrestorable: 'Эту версию нельзя восстановить: {reason}',
  news_time_draft_only: 'Время можно менять только у черновика или запланированной новости',
  news_sending: 'Новость сейчас отправляется, подождите несколько секунд',
  news_already_sent: 'Эта новость уже опубликована или отправляется',
  image_8mb: 'Загрузите картинку PNG, JPG, GIF или WebP до 8 МБ',
  test_channel_missing: 'Не задан тестовый канал: выберите его в настройках новостей',
  test_not_found: 'Тест не найден',
  bad_reaction: 'Неверная реакция',
  too_many_reactions: 'Слишком много реакций. Подождите минуту.',
  bad_draft: 'Неверные данные черновика',
  draft_too_large: 'Черновик слишком большой',
  bad_channel: 'Неверный канал',
  key_required: 'Укажите key',
  pinned_bool: 'Укажите pinned: true или false',
  publish_in_future: 'Укажите время публикации в будущем',
  publish_time_or_null: 'Укажите время публикации или null',
  news_channel_required: 'Выберите канал для новости',
  title_max: 'Заголовок: не более 256 символов',
  text_max: 'Текст: не более 4096 символов',
  field_name_required: 'У каждого поля должно быть название',
  field_value_required: 'У каждого поля должен быть текст',
  field_value_max: 'Текст поля: не более 1024 символов',
  fields_max: 'Полей не больше 25',
  content_max: 'Сообщение над embed: не более 2000 символов',
  extra_embeds_max: 'Дополнительных embed не больше 9',
  status_embeds_max: 'Статусов серверов не больше 5',
  gallery_max: 'В галерее не больше 6 картинок',
  change_required: 'Текст изменения не может быть пустым',
  change_max: 'Изменение: не более 200 символов',
  changes_max: 'Изменений не больше 20',
  countdown_label_max: 'Подпись таймера: не более 60 символов',
  button_label_required: 'У кнопки должна быть подпись',
  button_label_max: 'Подпись кнопки: не более 40 символов',
  buttons_max: 'Кнопок не больше 3',
  empty_message: 'Напишите текст или заполните embed: пустое сообщение отправить нельзя',
  embeds_max_10: 'В сообщении не больше 10 embed',
  embed_too_long: 'Embed длиннее 6000 символов (лимит Discord): сократите текст',
  embeds_too_long: 'Все embed вместе длиннее 6000 символов (лимит Discord): сократите текст',

  // ---- backups ----
  backup_op_failed: 'Не удалось выполнить операцию: {reason}',
  backup_not_found: 'Копия не найдена',
  backup_remote_https: 'Адрес для копии должен начинаться с https://',
  backup_passphrase_min: 'Пароль шифрования: не короче 8 символов',
  backup_settings_range: 'Проверьте поля: расписание off/daily/weekly, хранить от 1 до 30 копий',
  backup_busy: 'Резервная копия уже создаётся, подождите',
  backup_corrupt: 'Файл повреждён',
  backup_not_encrypted: 'Это не зашифрованная копия CoreGSM',
  backup_bad_passphrase: 'Неверный пароль шифрования или файл повреждён',
  backup_not_coregsm: 'Файл повреждён или это копия не от CoreGSM',
  backup_no_admin: 'В копии нет ни одного активного администратора: восстановление отменено, чтобы вы не потеряли доступ к панели',
  backup_bad_entry: 'В архиве есть недопустимый файл («{name}»). Восстановление отменено.',
  backup_needs_passphrase: 'Архив зашифрован: укажите пароль шифрования (тот, что был задан при создании копии)',
  backup_bad_structure: 'Архив повреждён или имеет неверную структуру',
  backup_no_db: 'В архиве нет базы данных (coregsm.db)',
  backup_wrong_file: 'Это не файл резервной копии CoreGSM (нужен .tar.gz или .db)',
  backup_wrong_file_short: 'Это не файл резервной копии CoreGSM',
  backup_too_large: 'Файл больше 300 МБ',
  upload_aborted: 'Загрузка прервана',
} as const satisfies Record<string, string>;

export type ErrorCode = keyof typeof ERRORS;

const exact = new Map<string, ErrorCode>();
const templates: { code: ErrorCode; re: RegExp; names: string[] }[] = [];
for (const [code, text] of Object.entries(ERRORS) as [ErrorCode, string][]) {
  const names = [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]);
  if (!names.length) {
    exact.set(text, code);
    continue;
  }
  const pattern = text
    .split(/\{\w+\}/)
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('([\\s\\S]+?)');
  templates.push({ code, re: new RegExp(`^${pattern}$`), names });
}

/** the code (and the values of a template) of an error text; null for a text that is not in the catalogue */
export function codeOf(text: string): { code: ErrorCode; params?: Record<string, string> } | null {
  const c = exact.get(text);
  if (c) return { code: c };
  for (const t of templates) {
    const m = t.re.exec(text);
    if (m) return { code: t.code, params: Object.fromEntries(t.names.map((n, i) => [n, m[i + 1]])) };
  }
  return null;
}

/** adds `code` (and `params`) to every error answer whose text is in the catalogue */
export const errorCodes: RequestHandler = (_req, res, next) => {
  const json = res.json.bind(res);
  res.json = (body?: unknown) => {
    if (res.statusCode >= 400 && body && typeof body === 'object' && !Array.isArray(body)) {
      const b = body as { error?: unknown; code?: unknown };
      if (typeof b.error === 'string' && b.code === undefined) {
        const m = codeOf(b.error);
        if (m) body = { ...b, code: m.code, ...(m.params ? { params: m.params } : {}) };
      }
    }
    return json(body);
  };
  next();
};
