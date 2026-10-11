#!/usr/bin/env bash
# CoreGSM updater. Compares the installed build with the repository, downloads install.sh,
# verifies its SHA-256 against version.txt and re-runs it. Data and settings are kept.
#
#   coregsm-update            update if a newer build exists
#   coregsm-update --check    only report (exit code 10 = update available)
#   coregsm-update --force    reinstall even if the build is the same (repairs modified files)
#   coregsm-update --from-panel   used by the systemd unit that serves the panel's "Update" button
set -uo pipefail
export PATH="$PATH:/usr/local/sbin:/usr/sbin:/sbin"

APP_DIR="${APP_DIR:-/app}"
BASE="${COREGSM_BASE:-https://raw.githubusercontent.com/RJ-Bond/CoreGSM/refs/heads/main}"
UPD="$APP_DIR/update"
LOG="$UPD/update.log"
CHECK=0; FORCE=0; PANEL=0

for a in "$@"; do
  case "$a" in
    --check) CHECK=1 ;;
    --force) FORCE=1 ;;
    --from-panel) PANEL=1 ;;
    -h|--help) sed -n '2,10p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "Неизвестный параметр: $a" >&2; exit 2 ;;
  esac
done

[ "$(id -u)" -eq 0 ] || { echo "Запустите от root: sudo coregsm-update" >&2; exit 1; }

mkdir -p "$UPD"
# the request flag must go first, otherwise the systemd path unit would fire again
[ "$PANEL" = 1 ] && rm -f "$UPD/request"

# the panel reads this file to show progress
status() { # status STATE MESSAGE
  local msg
  msg="$(printf '%s' "$2" | tr -d '\n\r' | sed 's/["\\]/ /g')"
  printf '{"state":"%s","message":"%s","time":%s000}\n' "$1" "$msg" "$(date +%s)" > "$UPD/status.json.tmp"
  mv -f "$UPD/status.json.tmp" "$UPD/status.json"
  chmod 644 "$UPD/status.json"
}
fail() { echo "✖ $1" >&2; [ "$CHECK" = 1 ] || status error "$1"; exit 1; }

# one update at a time (flock is part of util-linux, always present on Debian)
if command -v flock >/dev/null 2>&1; then
  exec 9> "$UPD/.lock"
  flock -n 9 || { echo "Обновление уже выполняется"; exit 0; }
fi

current="$(grep -E '^APP_VERSION=' "$APP_DIR/.env" 2>/dev/null | tail -n1 | cut -d= -f2- || true)"
proxy="$(grep -E '^PROXY_URL=' "$APP_DIR/.env" 2>/dev/null | tail -n1 | cut -d= -f2- || true)"
fetch() { curl -fsSL --max-time 60 ${proxy:+--proxy "${proxy/#socks5:/socks5h:}"} "$1"; }

meta="$(fetch "$BASE/version.txt")" || fail "Не удалось скачать version.txt из репозитория"
latest="$(printf '%s\n' "$meta" | sed -n 's/^build=//p' | head -n1)"
want_sha="$(printf '%s\n' "$meta" | sed -n 's/^sha256=//p' | head -n1)"
[ -n "$latest" ] && [ -n "$want_sha" ] || fail "version.txt в репозитории повреждён"

echo "Установлено: ${current:-неизвестно}   В репозитории: $latest"

if [ "$CHECK" = 1 ]; then
  if [ "$current" = "$latest" ]; then echo "У вас последняя версия."; exit 0; fi
  echo "Доступно обновление. Выполните: sudo coregsm-update"
  exit 10
fi

if [ "$current" = "$latest" ] && [ "$FORCE" = 0 ]; then
  echo "У вас последняя версия. Для переустановки файлов: sudo coregsm-update --force"
  [ "$PANEL" = 1 ] && status done "Уже установлена последняя версия ($latest)"
  exit 0
fi

status running "Скачиваю версию $latest"
tmp="$(mktemp)"
trap 'rm -f "$tmp"' EXIT

# the raw CDN can lag behind version.txt for a few minutes: retry until the checksum matches
verified=0
for i in 1 2 3 4; do
  if fetch "$BASE/install.sh" > "$tmp" && [ "$(sha256sum "$tmp" | cut -d' ' -f1)" = "$want_sha" ]; then
    verified=1
    break
  fi
  echo "Контрольная сумма не совпала (попытка $i из 4), жду…"
  sleep 8
done
[ "$verified" = 1 ] || fail "Контрольная сумма install.sh не совпала с version.txt. Подождите пару минут (кэш GitHub) и повторите"
bash -n "$tmp" || fail "Скачанный install.sh содержит синтаксическую ошибку"
echo "✔ Файл проверен (sha256 совпал)"

status running "Устанавливаю версию $latest: сборка и перезапуск контейнеров"
: > "$LOG"
SKIP_UPDATE=1 bash "$tmp" 2>&1 | tee -a "$LOG"
rc="${PIPESTATUS[0]}"

if [ "$rc" -eq 0 ]; then
  status done "Обновлено до версии $latest"
  echo "✔ Обновлено до $latest"
else
  status error "Установка завершилась с ошибкой (код $rc). Журнал: $LOG"
  exit "$rc"
fi
