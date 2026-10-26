# История изменений | Changelog

Что меняется для пользователей и администраторов, по-русски и по-английски. Панель показывает записи во вкладке
«Настройки → Обновления и копии → Что нового» на языке интерфейса, а текст релиза на GitHub собирается из раздела с номером
версии (сначала русский, потом английский).
What changes for users and administrators, in Russian and English. The panel shows the entries on the Updates tab in the
interface language; the GitHub release text is built from the section of the version (Russian first, then English).

## Правила | Rules

- Каждая строка пишется как `эмодзи русский текст | английский текст`. Эмодзи ставится один раз, перед русской частью.
  Every line is `emoji Russian text | English text`; the emoji is written once, in front of the Russian part.
- Группы: `### ✨ Новое | New`, `### 🐛 Исправлено | Fixed`, `### 🔧 Прочее | Other`.
- Пометки в конце русской части: `[migration]` — меняется база данных, `[env]` — нужны новые настройки сервера, `⚠` в начале — несовместимое изменение.
- Новые пункты идут в раздел «Не выпущено». Релиз выпускается только по команде владельца: тогда раздел переименовывается в `## <версия> · <дата>` (версия из `version.txt`).

## Не выпущено | Unreleased

### ✨ Новое | New
- 🌐 Описания версий на двух языках: панель показывает русский или английский текст, релиз на GitHub — оба | Release notes in two languages: the panel shows Russian or English, the GitHub release shows both

### 🐛 Исправлено | Fixed
- 🔁 Бот в Discord больше не дублирует сообщения: новое сообщение статуса публикуется, только если старое действительно удалено, а оповещения и новости при повторной отправке не создают копий | The Discord bot no longer duplicates messages: a new status message is posted only when the old one is really gone, and alerts and news cannot be posted twice on a retry

## 1.0.0.3 · 26.10.2026

### ✨ Новое | New
- 🔢 Вкладка «Обновления»: понятные номера версий (например, 1.0.0.7), этапы обновления (скачивание, копия, установка, проверка), журнал обновлений | Updates tab: readable version numbers (like 1.0.0.7), update steps (download, copy, install, check) and an update log
- ⚠️ Перед обновлением видно, сколько игроков онлайн и когда была последняя копия | Before an update you see how many players are online and when the last backup was made
- 📰 «Что нового» берёт записи из этого файла, группирует по версиям и подсвечивает то, чего у вас ещё нет | “What is new” reads this file, groups it by version and highlights what you do not have yet
- 🔔 Уведомление в Discord-канал оповещений: вышла новая версия, обновление завершилось, не удалось или выполнен откат | A notice in the Discord alerts channel: a new version is out, the update finished, failed, or was rolled back
- 🧭 Выбор канала обновлений (релизы или свежая main) прямо в панели и кнопка «Пропустить эту версию» | Update channel choice (releases or fresh main) right in the panel and a “Skip this version” button
- 💚 Страница «Здоровье»: единый график с подсказкой и управлением с клавиатуры; страница «Состояние» стала нагляднее | Health page: one chart with a tooltip and keyboard control; the Status page is easier to read
- 🗞️ Список новостей: время чтения и счётчик реакций | News list: reading time and a reactions counter

### 🐛 Исправлено | Fixed
- 🎨 Контраст цвета акцента в светлой теме: текст-ссылка на светлых поверхностях теперь не ниже 4,5:1 для всех игр | Accent colour contrast in the light theme: link text on light surfaces is now at least 4.5:1 for every game
- 🧱 На странице сервера нет пустого места под блоком «Последние события» | No empty gap under “Recent events” on the server page

### 🔧 Прочее | Other
- 🚦 Релизы выпускаются вручную: пока релиз не выпущен, серверы не получают новую версию | Releases are cut by hand: until one is published, servers do not get a new version
