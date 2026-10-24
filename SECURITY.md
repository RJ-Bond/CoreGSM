# Security policy / Политика безопасности

## Supported versions / Поддерживаемые версии

Only the newest release receives fixes (`coregsm update` installs it). Fixes are not backported.

Исправления выходят только для последнего релиза (его ставит `coregsm update`).

## Reporting a vulnerability / Как сообщить об уязвимости

Please do **not** open a public issue for a security problem.

Report it privately through GitHub: open the **Security** tab of this repository and choose
**Report a vulnerability** (<https://github.com/RJ-Bond/CoreGSM/security/advisories/new>). Include what you found, how to
reproduce it, and which version you tested (`coregsm update --check` prints the installed build).

Не открывайте публичный issue с описанием уязвимости. Сообщите о ней приватно через GitHub: вкладка **Security**
репозитория, кнопка **Report a vulnerability**. Опишите, что нашли, как это повторить и на какой версии (`coregsm update --check` показывает установленную сборку).

You can expect an answer within a few days. A fix is released as a normal update; the report is made public after
the fix is out.

Ответ ожидайте в течение нескольких дней. Исправление выходит обычным обновлением, подробности публикуются после него.

## What is in scope / Что считается уязвимостью

- Access to the panel or its data without the right role, session theft, CSRF, injection.
- Reading or changing secrets stored by the panel (the Discord token, SMTP password, RCON passwords, backups).
- Running code on the server through the panel, the bot or the update mechanism.

Weak settings made by the administrator (an easy password, a public panel on purpose) are not vulnerabilities.
