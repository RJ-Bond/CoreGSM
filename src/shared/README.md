# Общие типы ответов API | Shared API types

Здесь определения форм ответов, которые знают и бэкенд, и панель. Правьте файл в `types/`, затем запустите `node tools/sync-shared.mjs`:
файл копируется в `core-backend/src/shared/` и `core-frontend/src/shared/` (сборка каждого образа видит только свою папку, поэтому общая папка
снаружи не подходит). Проверка `node tools/sync-shared.mjs --check` идёт в тесте бэкенда (он входит в CI): копия, которая отличается от оригинала, ломает сборку.

Types of the answers that both the backend and the panel know. Edit the file in `types/`, then run `node tools/sync-shared.mjs`: it is copied into
`core-backend/src/shared/` and `core-frontend/src/shared/` (each image build sees only its own folder, so a shared folder outside does not work).
`node tools/sync-shared.mjs --check` runs in a backend test (so in CI): a copy that differs from the original fails.

Сейчас здесь формы банов; остальные типы переезжают сюда по мере правок. | Bans so far; other types move here as they are touched.
