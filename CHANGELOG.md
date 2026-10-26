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
- 🏅 Новое достижение в профиле появляется с анимацией: значок «выскакивает» и блестит, один раз в этом браузере (учитывает «уменьшить анимацию») | A newly earned achievement in the profile appears with an animation: the badge pops in and shines, once per browser (respects reduced motion)
- 🪪 Карточка сервера: обложка размыта под затемнением, ники в игре показаны круглыми аватарками, а у сервера, который не отвечает или на обслуживании, карточка темнеет и пересекается плашкой «ОФЛАЙН · с 14:20» / «ОБСЛУЖИВАНИЕ · до 16:00»; график онлайна на карточке и под сообщением Discord рисуется одним кодом | The server card: the cover is blurred under a veil, players are shown as round avatars, and a server that is down or under maintenance gets a dimmed card with a banner «OFFLINE · since 14:20» / «MAINTENANCE · until 16:00»; the online chart on the card and under the Discord message is drawn by one piece of code
- 🧭 Админка компактнее: подсказка страницы показывается при первом визите и дальше сворачивается (кнопка «i» возвращает её), заголовки ниже, на телефоне без подзаголовка; проблемные строки таблицы серверов подсвечены цветом, в пустом журнале есть «Сбросить поиск» | The admin area is more compact: a page hint shows on the first visit and then folds (the «i» button brings it back), smaller headings, no subtitle on a phone; problem rows of the servers table are tinted, and the empty journal has a «Reset search» button
- 📈 Под сообщением сервера в Discord — мини-график онлайна за 24 часа (отключается настройкой `embed_chart` = 0), а шкала игроков по мере заполнения меняет цвет: последние клетки жёлтеют и краснеют | A 24-hour online chart under the server message in Discord (turn off with the `embed_chart` setting = 0), and the players bar changes colour as it fills: the last squares turn amber and red
- 🎨 Картинка недели стала нагляднее: стрелки тренда ▲▼, время пика онлайна, подсвеченный самый людный день, полоса аптайма у каждого сервера, строка «ещё N серверов» и светлое оформление на выбор | The weekly picture is easier to read: ▲▼ trend arrows, the time of the online peak, the busiest day highlighted, an uptime bar on every server, a «N more servers» row and a light look to choose from

### 🐛 Исправлено | Fixed
- 🖼️ Картинка «Неделя на …»: названия серверов целиком видно — общее начало («[RU] Just-Skill.Ru | …») убирается, длинное имя переносится на две строки, заголовок «Серверы» не слипается с подписью | The weekly picture: server names are readable — the shared start («[RU] Just-Skill.Ru | …») is dropped, long names wrap onto two lines, and the «Servers» heading no longer touches its caption

## 1.0.0.9 · 26.10.2026

### ✨ Новое | New
- 🤖 Состояние Discord-бота в шапке панели для администратора (в сети, подключается, ошибка) — клик открывает настройки бота | The Discord bot state in the panel header for administrators (online, connecting, error) — a click opens the bot settings
- ⌨️ В палитре команд (Ctrl K) появились действия «Создать резервную копию» и «Проверить обновления» | The command palette (Ctrl K) got «Create a backup» and «Check for updates» actions
- 🚫 Блокировка пользователя с причиной и сроком (час, день, неделя, месяц или навсегда): человек сразу выходит отовсюду, при входе видит причину и срок [migration] | Blocking a user with a reason and a duration (an hour, a day, a week, a month or forever): the person is signed out everywhere at once and sees the reason and the end date when signing in
- 🧩 Матрица «роли × права» в настройках пользователей: права модераторов видны и переключаются в одной таблице | A «roles × permissions» matrix in the user settings: moderator permissions are shown and toggled in one table
- 🔖 Читаемая версия (например, 1.0.0.4) в подписи сообщений бота в Discord, на странице «Система» и на обзоре админки | The readable version (like 1.0.0.4) in the footer of the bot's Discord messages, on the System page and on the admin overview
- ↕️ Порядок серверов задаётся вручную: кнопки «выше/ниже» в админской таблице, тот же порядок в списке, на странице статуса и в Discord | Servers can be ordered by hand: up/down buttons in the admin table, the same order in the list, the status page and Discord [migration]
- 🔎 Фильтр и поиск в таблице серверов запоминаются: после перехода на другую страницу и возврата они на месте | The servers table remembers its filter and search when you leave the page and come back
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
