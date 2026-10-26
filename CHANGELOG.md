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
- 🌗 У админки своя тема: переключатель в шапке внутри админки меняет только её, публичный сайт остаётся как был; «Тема админки как на сайте» в Ctrl+K возвращает общую | The admin area has a theme of its own: the header switch inside the admin changes only it and the public site stays as it was; «Тема админки как на сайте» in Ctrl+K goes back to the shared one
- 🆕 После обновления панели администратору предлагается тур «Что нового»: заметки о выпусках, установленных с прошлого визита, по одной версии на шаг | After a panel update administrators are offered a «What's new» tour: the release notes of the versions installed since the last visit, one version per step
- 🔔 В шапке админки появился колокольчик «Требует внимания»: упавшие серверы, недоставленные сообщения, нет или устарела резервная копия, скорый конец сертификата, доступное обновление, ошибка бота, мало места на диске, заявки и жалобы — каждая строка ведёт в нужный раздел | A «Needs attention» bell in the admin header: servers down, undelivered messages, missing or old backup, certificate about to expire, available update, bot error, low disk space, pending requests and reports — each line leads to its section
- 💾 Когда на диске остаётся меньше 15% (или меньше 7% / 1 ГБ), в канал оповещений приходит предупреждение; повторяется не чаще раза в сутки, если не стало хуже | A warning goes to the alerts channel when less than 15% of the disk is free (or less than 7% / 1 GB); it repeats at most once a day unless it gets worse
- 🔗 В сообщениях об обновлении в Discord версии в первой строке («1.0.0.20 → 1.0.0.27»), заголовок и «… и ещё N» стали ссылками на релиз версии и на CHANGELOG в GitHub | In the Discord update notices the versions in the first line («1.0.0.20 → 1.0.0.27»), the title and the «… and N more» note are now links to the release of the version and to CHANGELOG on GitHub

## 1.0.0.27 · 26.10.2026

### ✨ Новое | New
- 📣 Страница статуса: администратор публикует короткие заметки наверху («Идут работы», «Причина найдена», «Починено») с важностью и привязкой к серверу; закрытые остаются две недели; форма — «Обслуживание → Сообщения на странице статуса» | Status page: administrators publish short notes at the top («Work in progress», «Cause found», «Fixed») with an importance level and an optional server; closed notes stay for two weeks; the form is in Maintenance → Messages on the status page
- 📆 Страница статуса: переключатель «30 / 90 дней» для полосок доступности (выбор запоминается) | Status page: a «30 / 90 days» switch for the availability bars (remembered)
- 📢 Канал для сообщений об обновлении панели выбирается отдельно в «Настройки → Обновления» (по умолчанию — канал оповещений) | The channel for the panel update notices is chosen separately in Settings → Updates (the alerts channel by default)
- 📣 Сообщения об обновлении в Discord стали подробнее: заголовок «версия → версия», сколько версий пропущено, список изменений по группам, предупреждения о миграции базы и новых настройках, дата выхода и «сколько дней назад» | Discord update notices are richer: a «version → version» title, how many versions were skipped, the changes by group, warnings about a database migration or new settings, the release date and its age
- 🌐 Язык сообщений об обновлении в Discord (русский или английский) выбирается в «Настройки → Обновления»; сообщения идут только в канал оповещений, без кнопок | The language of the Discord update notices (Russian or English) is chosen in Settings → Updates; the notices go to the alerts channel only, without buttons
- ⏰ Одно напоминание, если обновление не установили за 3–30 дней (по умолчанию 7, можно выключить); объявление о новой версии не приходит в тихие часы, а ждёт их конца; после обновления сообщение говорит, возможен ли откат | One reminder when an update is not installed within 3–30 days (7 by default, can be turned off); the new-version notice waits for the end of quiet hours; after an update the message says whether a rollback is possible
- 🖥️ Админка шире: на больших экранах контент занимает до 1600 px, а меню можно свернуть в узкую полосу иконок (запоминается в браузере) | The admin area is wider: content takes up to 1600 px on large screens, and the menu can shrink to a narrow icon strip (remembered in the browser)
- 📋 Таблица серверов: колонки «Карта», «Версия», «Каналы Discord» и «Обновлён», меню «Колонки» для выбора нужных (запоминается) | Servers table: Map, Version, Discord channels and Updated columns, and a «Columns» menu to pick the ones you need (remembered)
- 🖼️ Итоги недели: предпросмотр картинки справа от настроек и остаётся на виду при прокрутке; страница «Карточки» на очень широких экранах показывает три колонки | Weekly digest: the picture preview sits next to the settings and stays in view while scrolling; the Cards page shows three columns on very wide screens

### 🐛 Исправлено | Fixed
- ⚠️ Раздел «Оповещения» не открывался («Не удалось загрузить страницу»), если в истории было сообщение об обновлении панели; такие сообщения теперь показываются с меткой «Обновление панели», а неизвестный тип не ломает страницу | The Alerts section did not open («Could not load the page») when the history held a panel update notice; such messages now show with a «Panel update» label, and an unknown kind no longer breaks the page

## 1.0.0.20 · 26.10.2026

### ✨ Новое | New
- 🏅 Новое достижение в профиле появляется с анимацией: значок «выскакивает» и блестит, один раз в этом браузере (учитывает «уменьшить анимацию») | A newly earned achievement in the profile appears with an animation: the badge pops in and shines, once per browser (respects reduced motion)
- 🖼️ Обложки серверов, баннеры, аватары и скриншоты галереи отдаются в формате WebP браузерам, которые его поддерживают: страницы грузятся быстрее, файлы на диске не меняются | Server covers, banners, avatars and gallery screenshots are sent as WebP to browsers that support it: pages load faster, the files on disk are unchanged
- 🎮 Игры без своей иконки получают монограмму (две буквы названия) и свой цвет вместо серой заглушки; в настройках сообщения Discord можно поставить значок игры на цветную плашку (виден в светлой и тёмной теме) и включить или выключить график онлайна | A game without its own icon gets a monogram (two letters of its name) and its own colour instead of a grey placeholder; the Discord message settings can put the game icon on a coloured tile (readable in the light and the dark theme) and turn the online chart on or off
- 🔗 Картинка по умолчанию при вставке ссылки на панель теперь живая: название, логотип и «21 игрок онлайн · 3 из 4 серверов в сети» | The default link-preview picture is now live: the name, the logo and «21 players online · 3 of 4 servers up»
- ✨ Плавнее интерфейс: бейдж статуса «выскакивает» при смене состояния, число игроков в админской таблице анимируется, а меню и подсказки над окнами получили отдельный, более светлый уровень поверхности в тёмной теме | A smoother interface: the status badge pops when the state changes, the players number in the admin table is animated, and menus and tooltips above dialogs have their own, lighter surface level in the dark theme
- 🏅 В итогах недели появился «Герой недели» (игрок с наибольшим числом часов, ещё двое мелким шрифтом) и строка событий: рекорд онлайна, самый долгий сбой, новые игроки | The weekly picture got a «Hero of the week» (the player with the most hours, the next two in small print) and a line of events: the online record, the longest outage, new players
- 🪪 Карточка сервера: обложка размыта под затемнением, ники в игре показаны круглыми аватарками, а у сервера, который не отвечает или на обслуживании, карточка темнеет и пересекается плашкой «ОФЛАЙН · с 14:20» / «ОБСЛУЖИВАНИЕ · до 16:00»; график онлайна на карточке и под сообщением Discord рисуется одним кодом | The server card: the cover is blurred under a veil, players are shown as round avatars, and a server that is down or under maintenance gets a dimmed card with a banner «OFFLINE · since 14:20» / «MAINTENANCE · until 16:00»; the online chart on the card and under the Discord message is drawn by one piece of code
- 🧭 Админка компактнее: подсказка страницы показывается при первом визите и дальше сворачивается (кнопка «i» возвращает её), заголовки ниже, на телефоне без подзаголовка; проблемные строки таблицы серверов подсвечены цветом, в пустом журнале есть «Сбросить поиск» | The admin area is more compact: a page hint shows on the first visit and then folds (the «i» button brings it back), smaller headings, no subtitle on a phone; problem rows of the servers table are tinted, and the empty journal has a «Reset search» button
- 📈 Под сообщением сервера в Discord — мини-график онлайна за 24 часа (отключается настройкой `embed_chart` = 0), а шкала игроков по мере заполнения меняет цвет: последние клетки жёлтеют и краснеют | A 24-hour online chart under the server message in Discord (turn off with the `embed_chart` setting = 0), and the players bar changes colour as it fills: the last squares turn amber and red
- 🎨 Картинка недели стала нагляднее: стрелки тренда ▲▼, время пика онлайна, подсвеченный самый людный день, полоса аптайма у каждого сервера, строка «ещё N серверов» и светлое оформление на выбор | The weekly picture is easier to read: ▲▼ trend arrows, the time of the online peak, the busiest day highlighted, an uptime bar on every server, a «N more servers» row and a light look to choose from

### 🐛 Исправлено | Fixed
- 🖼️ Картинка «Неделя на …»: названия серверов целиком видно — общее начало («[RU] Just-Skill.Ru | …») убирается, длинное имя переносится на две строки, заголовок «Серверы» не слипается с подписью | The weekly picture: server names are readable — the shared start («[RU] Just-Skill.Ru | …») is dropped, long names wrap onto two lines, and the «Servers» heading no longer touches its caption

### 🔧 Прочее | Other
- 🌐 Переключатели картинки в Discord и тема итогов недели переведены на английский | The Discord picture switches and the weekly digest theme are translated to English

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
