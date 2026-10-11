# CoreGSM

Self-hosted аналог DiscordGSM: веб-панель для мониторинга игровых серверов и бот, который публикует в Discord красивые PNG-карточки со статусом и обновляет их по таймеру.

- **Backend**: Node.js 20, TypeScript, Express, [GameDig](https://github.com/gamedig/node-gamedig), SQLite, генерация карточек на skia-canvas.
- **Frontend**: React, Tailwind CSS (дизайн Terminal Ops в цветах Discord), собирается в статику.
- **Bot**: discord.js 14, редактирует одно сообщение с карточкой в каждом привязанном канале.
- **Proxy**: nginx, HTTPS (Let's Encrypt, автопродление), редирект с HTTP.

## Установка

Нужен чистый Debian 13 (подойдёт и 12), root-доступ и домен, A-запись которого указывает на сервер.

```bash
git clone https://github.com/RJ-Bond/CoreGSM.git
cd CoreGSM
sudo bash install.sh
```

Скрипт спросит токен Discord-бота, домен и e-mail для Let's Encrypt, затем:

1. обновит систему и поставит curl, git, ufw, Docker Engine и Compose из репозитория docker.com;
2. откроет в UFW только SSH, 80 и 443;
3. создаст проект в `/app`, сгенерирует пароль администратора и секреты в `/app/.env`;
4. выпустит сертификат через Certbot (в Docker);
5. выполнит `docker compose up --build -d` и покажет адрес панели, логин `admin` и пароль.

Без вопросов:

```bash
sudo DISCORD_TOKEN=... DOMAIN=gsm.example.com LE_EMAIL=me@example.com -E bash install.sh
```

Повторный запуск безопасен: секреты и действующий сертификат сохраняются.

Если сертификат получить не удалось (например, DNS ещё не обновился), скрипт создаёт временный самоподписанный, а после исправления DNS достаточно запустить `install.sh` снова.

## Прокси (SOCKS5 / HTTP)

Установщик спросит прокси: `socks5://[user:pass@]host:1080`, `socks5h://...`, `http://[user:pass@]host:3128` или `https://...`. Enter означает работу без прокси. Адрес можно передать заранее: `PROXY_URL=socks5://127.0.0.1:1080`.

| Что | Через прокси |
| --- | --- |
| Бот → Discord (REST и gateway WebSocket) | да, SOCKS5 и HTTP |
| apt, curl, загрузка образов Docker при установке | да, SOCKS5 и HTTP |
| Сборка образов (npm) и продление сертификата | только HTTP/HTTPS (npm и certbot не умеют SOCKS) |
| Опрос игровых серверов (GameDig) | нет, всегда напрямую: это UDP/TCP-query, HTTP-прокси его не пропускает |
| Бот → backend внутри Docker | нет, напрямую |

Для SOCKS имена хостов резолвятся на стороне прокси (socks5h), поэтому блокировка DNS для Discord не мешает. Сменить прокси позже: поправьте `PROXY_URL` (и `BUILD_PROXY`) в `/app/.env` и выполните `cd /app && docker compose up -d bot`.

## Подключение бота

1. В [Discord Developer Portal](https://discord.com/developers/applications) создайте приложение, во вкладке Bot скопируйте токен.
2. Пригласите бота по ссылке OAuth2 с областью `bot` и правами View Channel, Send Messages, Attach Files, Embed Links.
3. В панели откройте «Серверы», добавьте игровой сервер, затем в «Discord» привяжите ID канала.

Токен можно изменить позже в `/app/.env`, затем `cd /app && docker compose up -d bot`.

## Структура

```
src/                  исходники, зеркалируют /app на сервере
  core-backend/       API, опрос серверов, рендер карточек
  core-frontend/      панель управления
  core-bot/           Discord-бот
  nginx/              реверс-прокси
  docker-compose.yml
tools/
  installer-head.sh   логика установщика
  build-installer.sh  собирает install.sh со всеми файлами внутри
install.sh            готовый монолитный установщик (генерируется)
docs/                 макеты дизайна
```

`install.sh` создаётся командой `bash tools/build-installer.sh`. Правьте файлы в `src/` и `tools/`, затем пересобирайте установщик.

## Разработка

```bash
cd src/core-backend && npm install && DB_PATH=./data/dev.db JWT_SECRET=dev-secret-dev-secret INTERNAL_TOKEN=dev-token-dev-token ADMIN_PASSWORD=admin12345 npm run build && npm start
cd src/core-frontend && npm install && npm run dev   # проксирует /api на localhost:3000
```

## Безопасность

- Наружу публикуются только порты 80 и 443 контейнера nginx; backend, бот и фронтенд доступны лишь внутри сети Docker.
- Вход ограничен по частоте (nginx и приложение), JWT живёт 7 дней, пароль хранится как bcrypt-хеш.
- PNG-карточка `/api/card/<id>.png` открыта без авторизации, чтобы её можно было вставлять в Discord. Она содержит только публичные данные о статусе сервера.

## Лицензия

MIT
