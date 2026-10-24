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
- Строки интерфейса добавляйте в `locales/ru.ts` и `locales/en.ts` одновременно.
- Миграции базы только добавляются в конец `migrations.ts`; выпущенные не правятся.
- Классы кнопок берите из `styles/buttons.css` (тест `buttons.test.ts` проверяет, что каждый класс существует).

## Скриншоты интерфейса

Ветки вида `ui/*` запускают сборку скриншотов (`ci-screenshots`), по ним удобно проверять вёрстку на телефоне и в светлой теме.

## Безопасность

Не публикуйте уязвимости в issue, см. [SECURITY.md](SECURITY.md).
