# Участие в разработке

Спасибо, что хотите помочь. Коротко, как устроен проект и что проверяет CI.

## Запуск для разработки

```bash
cd src/core-backend && npm ci
DB_PATH=./data/dev.db JWT_SECRET=dev-secret-dev-secret INTERNAL_TOKEN=dev-token-dev-token SETUP_TOKEN=dev-code npm start   # код мастера: dev-code
cd src/core-frontend && npm ci && npm run dev        # панель на :5173, /api проксируется на :3000
```

## Перед PR

- `npm run typecheck` и `npm test` в `src/core-backend`, `src/core-frontend`, `src/core-bot`.
- `install.sh` и `version.txt` **генерируются**: после правок в `src/**` и `tools/**` выполните `bash tools/build-installer.sh` и закоммитьте результат (иначе упадёт проверка `up-to-date`).
- Тексты ошибок API живут в `src/core-backend/src/errors.ts` и обязаны иметь перевод в `src/core-frontend/src/locales/errors.en.ts` (тест `errors.test.ts` следит за этим).
- Бэкенд `src/core-backend/src` разложен по областям: `news/`, `alerts/` (оповещения, рассылки), `discord/`, `images/` (карточки, графики, обложки), `profile/`, `security/` (вход, ключи, баны), `monitoring/` (опрос серверов, игры), `community/`, `admin/` (копии, обновления, API); общее (`db`, `config`, `errors`, `http`, `index`) и `routes/` лежат в корне. Рядом с `xxx.ts` живёт чистая логика `xxxLogic.ts`, которую тестируют без ввода-вывода.
- Строки интерфейса добавляйте в `locales/ru.ts` и `locales/en.ts` одновременно.
- Миграции базы только добавляются в конец `migrations.ts`; выпущенные не правятся.
- Классы кнопок берите из `styles/buttons.css` (тест `buttons.test.ts` проверяет, что каждый класс существует).

## Windows

Тесты фронтенда (`vitest`) запускайте из каталога, путь к которому начинается с **заглавной** буквы диска (`D:\...`, а не `d:\...`): при строчной букве vitest загружает себя дважды и все файлы падают с `Cannot read properties of undefined (reading 'config')`. Тесты бэкенда (`node --test`) этой привычки не требуют.

## Документация

Устройство, эксплуатация, модель данных и пределы описаны в [docs/](docs/architecture.md). Если меняете поведение, которое там описано (таблицы, API, переменные окружения), поправьте документ в том же PR.

## Скриншоты интерфейса

Ветки вида `ui/*` запускают сборку скриншотов (`ci-screenshots`), по ним удобно проверять вёрстку на телефоне и в светлой теме.

## Безопасность

Не публикуйте уязвимости в issue, см. [SECURITY.md](SECURITY.md).
