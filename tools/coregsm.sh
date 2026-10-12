#!/usr/bin/env bash
# coregsm: CoreGSM manager (menu + commands). Installed to /usr/local/bin/coregsm by install.sh.
#
#   coregsm                 interactive menu
#   coregsm update [--check|--force|--yes|--auto]   (--from-panel: reads the request file; "rollback" = roll back)
#   coregsm rollback [--yes]                         previous version + database from the pre-update backup
#   coregsm status | doctor | logs [service] | start | stop | restart
#   coregsm backup | restore [file] | domain | reset-password | uninstall
set -uo pipefail
export PATH="$PATH:/usr/local/sbin:/usr/sbin:/sbin"
export LC_ALL=C.UTF-8

# where the panel lives: APP_DIR from the environment, else the directory written by the installer, else /app (older installs)
if [ -z "${APP_DIR:-}" ]; then
  if [ -s /etc/coregsm/app_dir ]; then APP_DIR="$(head -n1 /etc/coregsm/app_dir)"; else APP_DIR=/app; fi
fi
BASE="${COREGSM_BASE:-https://raw.githubusercontent.com/RJ-Bond/CoreGSM/refs/heads/main}"
UPD="$APP_DIR/update"
BACKUPS="$APP_DIR/backups"
PREV="$APP_DIR/.prev"
LOG="$UPD/update.log"
KEEP_BACKUPS=10
BIN=/usr/local/bin/coregsm

# ---------- look & feel: one accent colour, dim hints, no boxes ----------
if [ -t 1 ]; then
  ACC=$'\e[38;5;99m'; OKC=$'\e[38;5;78m'; WRN=$'\e[38;5;214m'; BAD=$'\e[38;5;203m'
  DIM=$'\e[2m'; BLD=$'\e[1m'; NC=$'\e[0m'
else
  ACC=''; OKC=''; WRN=''; BAD=''; DIM=''; BLD=''; NC=''
fi
RULE="$(printf '─%.0s' $(seq 1 46))"

say()  { printf '  %s\n' "$*"; }
ok()   { printf '  %s✔%s %s\n' "$OKC" "$NC" "$*"; }
warn() { printf '  %s⚠%s %s\n' "$WRN" "$NC" "$*"; }
bad()  { printf '  %s✖%s %s\n' "$BAD" "$NC" "$*" >&2; }
dim()  { printf '  %s%s%s\n' "$DIM" "$*" "$NC"; }
hr()   { printf '  %s%s%s\n' "$DIM" "$RULE" "$NC"; }
kv()   { printf '  %s%s%*s%s %s\n' "$DIM" "$1" $((14 - ${#1})) '' "$NC" "$2"; }
title() { printf '\n  %s%s%s\n' "$BLD" "$1" "$NC"; hr; }

tty_read() { read -r "$@" < /dev/tty; }
pause() { printf '\n  %sEnter — назад%s ' "$DIM" "$NC"; tty_read _ || true; }
ask_yn() { # ask_yn "Вопрос" -> 0 if yes (default: no)
  local a; printf '  %s [д/Н] ' "$1"; tty_read a || return 1
  case "${a,,}" in д|да|y|yes) return 0 ;; *) return 1 ;; esac
}
spin() { # spin "text" cmd...   (runs the command quietly, shows a short status)
  local msg="$1"; shift
  [ -t 1 ] && printf '  %s…%s %s' "$DIM" "$NC" "$msg"
  if "$@" >/dev/null 2>&1; then
    [ -t 1 ] && printf '\r'
    printf '  %s✔%s %s\n' "$OKC" "$NC" "$msg"; return 0
  fi
  [ -t 1 ] && printf '\r'
  printf '  %s✖%s %s\n' "$BAD" "$NC" "$msg"; return 1
}

need_root() { [ "$(id -u)" -eq 0 ] || { bad "Запустите от root: sudo coregsm"; exit 1; }; }
installed() { [ -f "$APP_DIR/.env" ] && [ -f "$APP_DIR/docker-compose.yml" ]; }
need_installed() { installed || { bad "CoreGSM не установлен. Запустите install.sh"; exit 1; }; }

envget() { grep -E "^$1=" "$APP_DIR/.env" 2>/dev/null | tail -n1 | cut -d= -f2- || true; }
dc() { (cd "$APP_DIR" && docker compose "$@"); }

env_set() { # env_set KEY VALUE  -> replaces or appends the line in .env, keeping everything else (and the file mode)
  local f="$APP_DIR/.env" tmp
  [ -f "$f" ] || return 0
  tmp="$(mktemp)"
  if grep -qE "^$1=" "$f"; then
    K="$1" V="$2" awk 'BEGIN{k=ENVIRON["K"]; v=ENVIRON["V"]} index($0, k "=") == 1 {print k "=" v; next} {print}' "$f" > "$tmp"
  else
    { cat "$f"; printf '%s=%s\n' "$1" "$2"; } > "$tmp"
  fi
  cat "$tmp" > "$f"
  rm -f "$tmp"
}

is_local_name() { # IPv4, localhost or a private suffix: Let's Encrypt is impossible for these
  [[ "$1" =~ ^([0-9]{1,3}\.){3}[0-9]{1,3}$ ]] && return 0
  [[ "$1" =~ (^localhost$|\.(local|lan|home|internal|test|localdomain)$|\.home\.arpa$) ]] && return 0
  return 1
}

# days until the panel certificate expires (fails when there is no certificate)
cert_days() {
  local d crt end ts
  d="$(envget DOMAIN)"; crt="$APP_DIR/certbot/conf/live/$d/fullchain.pem"
  [ -f "$crt" ] || return 1
  end="$(openssl x509 -enddate -noout -in "$crt" 2>/dev/null | cut -d= -f2)"; [ -n "$end" ] || return 1
  ts="$(date -d "$end" +%s 2>/dev/null)" || return 1
  echo $(( (ts - $(date +%s)) / 86400 ))
}
cert_kind() { # letsencrypt | selfsigned
  [ -f "$APP_DIR/certbot/conf/live/$(envget DOMAIN)/.selfsigned" ] && echo selfsigned || echo letsencrypt
}

PROXY_ARGS=()
_p="$(envget PROXY_URL)"; [ -n "$_p" ] && PROXY_ARGS=(--proxy "${_p/#socks5:/socks5h:}")
fetch() { curl -fsSL --max-time "${FETCH_TIMEOUT:-60}" ${PROXY_ARGS[@]+"${PROXY_ARGS[@]}"} "$1"; }

# raw.githubusercontent.com is cached for minutes after a push, so a fresh version.txt/install.sh can look
# "old" for a while. The GitHub API serves the file as it is now; the plain URL stays as the fallback.
api_url() { # api_url FILE -> https://api.github.com/repos/OWNER/REPO/contents/FILE?ref=BRANCH
  local m
  m="$(printf '%s' "$BASE" | sed -nE 's#^https://raw\.githubusercontent\.com/([^/]+)/([^/]+)/(refs/heads/)?([^/]+)/?$#\1/\2 \4#p')"
  [ -n "$m" ] || return 1
  printf 'https://api.github.com/repos/%s/contents/%s?ref=%s' "${m% *}" "$1" "${m#* }"
}
fetch_repo() { # fetch_repo FILE -> the file's content
  local u
  if u="$(api_url "$1")" && curl -fsSL --max-time "${FETCH_TIMEOUT:-60}" -H 'Accept: application/vnd.github.raw+json' -H 'User-Agent: coregsm' \
       ${PROXY_ARGS[@]+"${PROXY_ARGS[@]}"} "$u" 2>/dev/null; then return 0; fi
  fetch "$BASE/$1"
}

# ---------- state ----------
panel_url() { printf 'https://%s' "$(envget DOMAIN)"; }
cur_build() { envget APP_VERSION; }

remote_build() { # cached for 10 minutes so the menu opens instantly
  local f="$UPD/.remote" b=""
  if [ -f "$f" ] && [ $(( $(date +%s) - $(stat -c %Y "$f") )) -lt 600 ]; then cat "$f"; return; fi
  b="$(FETCH_TIMEOUT=4 fetch_repo version.txt 2>/dev/null | sed -n 's/^build=//p' | head -n1)"
  if [ -n "$b" ]; then mkdir -p "$UPD"; printf '%s' "$b" > "$f"; fi
  printf '%s' "$b"
}
update_available() { local l; l="$(remote_build)"; [ -n "$l" ] && [ "$l" != "$(cur_build)" ]; }

stack_state() { # prints: up | partial | down
  local total running
  total="$(dc config --services 2>/dev/null | wc -l)"
  running="$(dc ps --status running --services 2>/dev/null | wc -l)"
  if [ "$total" -gt 0 ] && [ "$running" -ge "$total" ]; then echo up
  elif [ "$running" -gt 0 ]; then echo partial
  else echo down; fi
}
state_label() {
  case "$(stack_state)" in
    up) printf '%s● работает%s' "$OKC" "$NC" ;;
    partial) printf '%s◐ работает частично%s' "$WRN" "$NC" ;;
    *) printf '%s○ остановлена%s' "$BAD" "$NC" ;;
  esac
}
healthy() { # healthy SECONDS
  local d t="${1:-60}" i
  d="$(envget DOMAIN)"
  for ((i = 0; i < t; i += 3)); do
    curl -fsk --noproxy "*" --max-time 3 --resolve "${d}:443:127.0.0.1" "https://${d}/api/health" >/dev/null 2>&1 && return 0
    sleep 3
  done
  return 1
}

# LOGO-BEGIN (generated by tools/gen-logo-ansi.cjs from docs/logo.png; do not edit by hand)
logo_rows_large=(
  '\033[0m \033[0m\033[38;2;136;124;236m▄\033[0m\033[38;2;131;118;235m▄\033[38;2;146;134;237m\033[48;2;129;117;233m▀\033[38;2;129;117;233m\033[48;2;127;115;232m▀\033[38;2;127;115;232m\033[48;2;125;113;231m▀\033[38;2;125;113;231m\033[48;2;123;111;230m▀\033[38;2;123;111;230m\033[48;2;121;109;228m▀\033[38;2;121;109;228m\033[48;2;119;107;227m▀\033[38;2;119;107;227m\033[48;2;117;105;226m▀\033[38;2;117;105;226m\033[48;2;115;103;224m▀\033[38;2;115;103;224m\033[48;2;113;101;223m▀\033[38;2;113;101;223m\033[48;2;112;100;222m▀\033[38;2;111;100;222m\033[48;2;110;98;220m▀\033[38;2;110;98;220m\033[48;2;108;96;219m▀\033[38;2;108;96;219m\033[48;2;106;94;218m▀\033[38;2;106;94;218m\033[48;2;104;92;216m▀\033[38;2;104;92;216m\033[48;2;102;90;215m▀\033[38;2;102;90;215m\033[48;2;100;88;214m▀\033[38;2;100;88;214m\033[48;2;98;86;213m▀\033[38;2;98;86;213m\033[48;2;96;85;211m▀\033[38;2;96;84;211m\033[48;2;94;83;210m▀\033[38;2;113;104;215m\033[48;2;92;81;209m▀\033[0m\033[38;2;90;79;207m▄\033[0m\033[38;2;93;82;207m▄\033[0m \033[0m'
  '\033[0m\033[38;2;146;134;237m▄\033[38;2;131;118;235m\033[48;2;129;117;233m▀\033[38;2;129;117;233m\033[48;2;127;115;232m▀\033[38;2;127;115;232m\033[48;2;125;113;231m▀\033[38;2;125;113;231m\033[48;2;123;111;230m▀\033[38;2;123;111;230m\033[48;2;121;109;228m▀\033[38;2;121;109;228m\033[48;2;119;107;227m▀\033[38;2;119;107;227m\033[48;2;117;105;226m▀\033[38;2;117;105;226m\033[48;2;115;103;224m▀\033[38;2;115;103;224m\033[48;2;113;101;223m▀\033[38;2;114;102;223m\033[48;2;112;100;222m▀\033[38;2;112;100;222m\033[48;2;110;98;220m▀\033[38;2;110;98;220m\033[48;2;108;96;219m▀\033[38;2;108;96;219m\033[48;2;106;94;218m▀\033[38;2;106;94;218m\033[48;2;104;92;216m▀\033[38;2;104;92;216m\033[48;2;102;90;215m▀\033[38;2;102;90;215m\033[48;2;100;88;214m▀\033[38;2;100;88;214m\033[48;2;98;86;213m▀\033[38;2;98;86;213m\033[48;2;96;84;211m▀\033[38;2;96;85;211m\033[48;2;94;83;210m▀\033[38;2;94;83;210m\033[48;2;92;81;209m▀\033[38;2;92;81;209m\033[48;2;90;79;207m▀\033[38;2;90;79;207m\033[48;2;88;77;206m▀\033[38;2;88;77;206m\033[48;2;86;75;202m▀\033[38;2;86;75;202m\033[48;2;84;73;198m▀\033[0m\033[38;2;102;92;201m▄\033[0m'
  '\033[38;2;129;117;233m\033[48;2;127;115;232m▀\033[38;2;127;115;232m\033[48;2;125;113;231m▀\033[38;2;125;113;231m\033[48;2;123;111;230m▀\033[38;2;123;111;230m\033[48;2;121;109;228m▀\033[38;2;121;109;228m\033[48;2;119;107;227m▀\033[38;2;119;107;227m\033[48;2;117;105;226m▀\033[38;2;117;105;226m\033[48;2;115;103;224m▀\033[38;2;115;103;224m\033[48;2;113;101;223m▀\033[38;2;113;101;223m\033[48;2;254;254;254m▀\033[38;2;112;100;222m\033[48;2;254;254;254m▀\033[38;2;254;254;254m\033[48;2;254;254;254m▀\033[38;2;254;254;254m\033[48;2;254;254;254m▀\033[38;2;254;254;254m\033[48;2;254;254;254m▀\033[38;2;254;254;254m\033[48;2;254;254;254m▀\033[38;2;254;254;254m\033[48;2;254;254;254m▀\033[38;2;254;254;254m\033[48;2;254;254;254m▀\033[38;2;254;254;254m\033[48;2;254;254;254m▀\033[38;2;96;85;211m\033[48;2;254;254;254m▀\033[38;2;94;83;210m\033[48;2;254;254;254m▀\033[38;2;92;81;209m\033[48;2;90;79;207m▀\033[38;2;90;79;207m\033[48;2;88;77;206m▀\033[38;2;88;77;206m\033[48;2;86;75;202m▀\033[38;2;86;75;202m\033[48;2;84;73;198m▀\033[38;2;84;73;198m\033[48;2;82;71;195m▀\033[38;2;82;71;195m\033[48;2;80;69;191m▀\033[38;2;80;69;191m\033[48;2;78;68;187m▀\033[0m'
  '\033[38;2;125;113;231m\033[48;2;123;111;230m▀\033[38;2;123;111;230m\033[48;2;121;109;228m▀\033[38;2;121;109;228m\033[48;2;119;107;227m▀\033[38;2;119;107;227m\033[48;2;117;105;226m▀\033[38;2;117;105;226m\033[48;2;115;103;224m▀\033[38;2;115;103;224m\033[48;2;113;101;223m▀\033[38;2;113;101;223m\033[48;2;254;254;254m▀\033[38;2;254;254;254m\033[48;2;254;254;254m▀\033[38;2;254;254;254m\033[48;2;254;254;254m▀\033[38;2;254;254;254m\033[48;2;254;254;254m▀\033[38;2;254;254;254m\033[48;2;254;254;254m▀\033[38;2;254;254;254m\033[48;2;254;254;254m▀\033[38;2;254;254;254m\033[48;2;254;254;254m▀\033[38;2;254;254;254m\033[48;2;254;254;254m▀\033[38;2;254;254;254m\033[48;2;254;254;254m▀\033[38;2;254;254;254m\033[48;2;254;254;254m▀\033[38;2;254;254;254m\033[48;2;254;254;254m▀\033[38;2;254;254;254m\033[48;2;254;254;254m▀\033[38;2;254;254;254m\033[48;2;88;77;206m▀\033[38;2;88;77;206m\033[48;2;86;75;202m▀\033[38;2;86;75;202m\033[48;2;84;73;198m▀\033[38;2;84;73;198m\033[48;2;82;71;195m▀\033[38;2;82;71;195m\033[48;2;80;69;191m▀\033[38;2;80;69;191m\033[48;2;78;68;187m▀\033[38;2;78;68;187m\033[48;2;76;66;183m▀\033[38;2;76;66;183m\033[48;2;74;64;180m▀\033[0m'
  '\033[38;2;121;109;228m\033[48;2;119;107;227m▀\033[38;2;119;107;227m\033[48;2;117;105;226m▀\033[38;2;117;105;226m\033[48;2;115;103;224m▀\033[38;2;115;103;224m\033[48;2;113;101;223m▀\033[38;2;113;101;223m\033[48;2;112;100;222m▀\033[38;2;111;100;222m\033[48;2;110;98;220m▀\033[38;2;252;252;253m\033[48;2;108;96;219m▀\033[38;2;254;254;254m\033[48;2;106;94;218m▀\033[38;2;254;254;254m\033[48;2;254;254;254m▀\033[38;2;254;254;254m\033[48;2;254;254;254m▀\033[38;2;254;254;254m\033[48;2;100;88;214m▀\033[38;2;100;88;214m\033[48;2;98;86;213m▀\033[38;2;98;86;213m\033[48;2;96;85;211m▀\033[38;2;96;84;211m\033[48;2;94;83;210m▀\033[38;2;94;83;210m\033[48;2;92;81;209m▀\033[38;2;92;81;209m\033[48;2;90;79;207m▀\033[38;2;90;79;207m\033[48;2;88;77;206m▀\033[38;2;88;77;206m\033[48;2;86;75;202m▀\033[38;2;86;75;202m\033[48;2;84;73;198m▀\033[38;2;40;160;100m\033[48;2;40;160;100m▀\033[38;2;40;160;100m\033[48;2;80;69;191m▀\033[38;2;80;69;191m\033[48;2;78;68;187m▀\033[38;2;78;68;187m\033[48;2;76;66;183m▀\033[38;2;76;66;183m\033[48;2;74;64;180m▀\033[38;2;74;64;179m\033[48;2;72;62;176m▀\033[38;2;72;62;176m\033[48;2;70;60;172m▀\033[0m'
  '\033[38;2;117;105;226m\033[48;2;115;103;224m▀\033[38;2;115;103;224m\033[48;2;113;101;223m▀\033[38;2;114;102;223m\033[48;2;112;100;222m▀\033[38;2;112;100;222m\033[48;2;110;98;220m▀\033[38;2;110;98;220m\033[48;2;108;96;219m▀\033[38;2;155;148;231m\033[48;2;235;234;250m▀\033[38;2;106;94;218m\033[48;2;235;234;250m▀\033[38;2;104;92;216m\033[48;2;235;234;250m▀\033[38;2;102;90;215m\033[48;2;100;88;214m▀\033[38;2;100;88;214m\033[48;2;98;86;213m▀\033[38;2;98;86;213m\033[48;2;96;85;211m▀\033[38;2;96;85;211m\033[48;2;94;83;210m▀\033[38;2;94;83;210m\033[48;2;92;81;209m▀\033[38;2;92;81;209m\033[48;2;90;79;207m▀\033[38;2;90;79;207m\033[48;2;88;77;206m▀\033[38;2;88;77;206m\033[48;2;86;75;202m▀\033[38;2;86;75;202m\033[48;2;84;73;198m▀\033[38;2;84;73;198m\033[48;2;82;71;195m▀\033[38;2;82;71;195m\033[48;2;80;69;191m▀\033[38;2;80;69;191m\033[48;2;78;68;187m▀\033[38;2;78;68;187m\033[48;2;76;66;183m▀\033[38;2;76;66;183m\033[48;2;74;64;179m▀\033[38;2;74;64;180m\033[48;2;72;62;176m▀\033[38;2;72;62;176m\033[48;2;70;60;172m▀\033[38;2;70;60;172m\033[48;2;68;58;168m▀\033[38;2;68;58;168m\033[48;2;66;56;164m▀\033[0m'
  '\033[38;2;113;101;223m\033[48;2;111;100;222m▀\033[38;2;112;100;222m\033[48;2;110;98;220m▀\033[38;2;110;98;220m\033[48;2;108;96;219m▀\033[38;2;108;96;219m\033[48;2;106;94;218m▀\033[38;2;106;94;218m\033[48;2;104;92;216m▀\033[38;2;235;234;250m\033[48;2;235;234;250m▀\033[38;2;235;234;250m\033[48;2;235;234;250m▀\033[38;2;235;234;250m\033[48;2;235;234;250m▀\033[38;2;98;86;213m\033[48;2;96;84;211m▀\033[38;2;96;85;211m\033[48;2;94;83;210m▀\033[38;2;94;83;210m\033[48;2;92;81;209m▀\033[38;2;92;81;209m\033[48;2;90;79;207m▀\033[38;2;90;79;207m\033[48;2;88;77;206m▀\033[38;2;88;77;206m\033[48;2;86;75;202m▀\033[38;2;86;75;202m\033[48;2;84;73;198m▀\033[38;2;84;73;198m\033[48;2;82;71;195m▀\033[38;2;82;71;195m\033[48;2;80;69;191m▀\033[38;2;80;69;191m\033[48;2;78;68;187m▀\033[38;2;78;68;187m\033[48;2;76;66;183m▀\033[38;2;76;66;183m\033[48;2;74;64;179m▀\033[38;2;239;181;66m\033[48;2;239;181;66m▀\033[38;2;72;62;176m\033[48;2;70;60;172m▀\033[38;2;70;60;172m\033[48;2;68;58;168m▀\033[38;2;68;58;168m\033[48;2;66;56;164m▀\033[38;2;66;56;164m\033[48;2;64;54;161m▀\033[38;2;64;54;161m\033[48;2;62;52;157m▀\033[0m'
  '\033[38;2;110;98;220m\033[48;2;108;96;219m▀\033[38;2;108;96;219m\033[48;2;106;94;218m▀\033[38;2;106;94;218m\033[48;2;104;92;216m▀\033[38;2;104;92;216m\033[48;2;102;90;215m▀\033[38;2;102;90;215m\033[48;2;100;88;214m▀\033[38;2;235;234;250m\033[48;2;98;86;213m▀\033[38;2;235;234;250m\033[48;2;96;85;211m▀\033[38;2;235;234;250m\033[48;2;94;83;210m▀\033[38;2;94;83;210m\033[48;2;92;81;209m▀\033[38;2;92;81;209m\033[48;2;90;79;207m▀\033[38;2;90;79;207m\033[48;2;88;77;206m▀\033[38;2;88;77;206m\033[48;2;86;75;202m▀\033[38;2;86;75;202m\033[48;2;84;73;198m▀\033[38;2;84;73;198m\033[48;2;82;71;195m▀\033[38;2;82;71;195m\033[48;2;80;69;191m▀\033[38;2;80;69;191m\033[48;2;78;68;187m▀\033[38;2;78;68;187m\033[48;2;76;66;183m▀\033[38;2;76;66;183m\033[48;2;74;64;180m▀\033[38;2;74;64;179m\033[48;2;72;62;176m▀\033[38;2;72;62;176m\033[48;2;70;60;172m▀\033[38;2;70;60;172m\033[48;2;68;58;168m▀\033[38;2;68;58;168m\033[48;2;66;56;164m▀\033[38;2;66;56;164m\033[48;2;64;54;161m▀\033[38;2;64;54;161m\033[48;2;62;53;157m▀\033[38;2;62;52;157m\033[48;2;60;51;153m▀\033[38;2;60;51;153m\033[48;2;58;49;149m▀\033[0m'
  '\033[38;2;106;94;218m\033[48;2;104;92;216m▀\033[38;2;104;92;216m\033[48;2;102;90;215m▀\033[38;2;102;90;215m\033[48;2;100;88;214m▀\033[38;2;100;88;214m\033[48;2;98;86;213m▀\033[38;2;98;86;213m\033[48;2;96;85;211m▀\033[38;2;96;84;211m\033[48;2;94;83;210m▀\033[38;2;94;83;210m\033[48;2;236;235;249m▀\033[38;2;92;81;209m\033[48;2;236;235;249m▀\033[38;2;236;235;249m\033[48;2;236;235;249m▀\033[38;2;236;235;249m\033[48;2;236;235;249m▀\033[38;2;86;75;202m\033[48;2;236;235;249m▀\033[38;2;84;73;198m\033[48;2;82;71;195m▀\033[38;2;82;71;195m\033[48;2;80;69;191m▀\033[38;2;80;69;191m\033[48;2;78;68;187m▀\033[38;2;78;68;187m\033[48;2;76;66;183m▀\033[38;2;76;66;183m\033[48;2;74;64;180m▀\033[38;2;74;64;179m\033[48;2;212;210;238m▀\033[38;2;72;62;176m\033[48;2;70;60;172m▀\033[38;2;70;60;172m\033[48;2;68;58;168m▀\033[38;2;234;70;82m\033[48;2;234;70;82m▀\033[38;2;66;56;164m\033[48;2;234;70;82m▀\033[38;2;64;54;161m\033[48;2;62;52;157m▀\033[38;2;62;52;157m\033[48;2;60;51;153m▀\033[38;2;60;51;153m\033[48;2;58;49;149m▀\033[38;2;58;49;149m\033[48;2;56;47;146m▀\033[38;2;56;47;146m\033[48;2;54;45;142m▀\033[0m'
  '\033[38;2;102;90;215m\033[48;2;100;88;214m▀\033[38;2;100;88;214m\033[48;2;98;86;213m▀\033[38;2;98;86;213m\033[48;2;96;85;211m▀\033[38;2;96;84;211m\033[48;2;94;83;210m▀\033[38;2;94;83;210m\033[48;2;92;81;209m▀\033[38;2;92;81;209m\033[48;2;90;79;207m▀\033[38;2;228;226;246m\033[48;2;88;77;206m▀\033[38;2;236;235;249m\033[48;2;236;235;249m▀\033[38;2;236;235;249m\033[48;2;236;235;249m▀\033[38;2;236;235;249m\033[48;2;236;235;249m▀\033[38;2;236;235;249m\033[48;2;236;235;249m▀\033[38;2;236;235;249m\033[48;2;236;235;249m▀\033[38;2;236;235;249m\033[48;2;236;235;249m▀\033[38;2;236;235;249m\033[48;2;236;235;249m▀\033[38;2;236;235;249m\033[48;2;236;235;249m▀\033[38;2;236;235;249m\033[48;2;236;235;249m▀\033[38;2;236;235;249m\033[48;2;236;235;249m▀\033[38;2;236;235;249m\033[48;2;236;235;249m▀\033[38;2;66;56;164m\033[48;2;236;235;249m▀\033[38;2;64;54;161m\033[48;2;62;52;157m▀\033[38;2;62;52;157m\033[48;2;60;51;153m▀\033[38;2;60;51;153m\033[48;2;58;49;149m▀\033[38;2;58;49;149m\033[48;2;56;47;146m▀\033[38;2;56;47;146m\033[48;2;54;45;142m▀\033[38;2;54;45;142m\033[48;2;52;43;138m▀\033[38;2;52;43;138m\033[48;2;50;41;134m▀\033[0m'
  '\033[38;2;98;86;213m\033[48;2;96;84;211m▀\033[38;2;96;85;211m\033[48;2;94;83;210m▀\033[38;2;94;83;210m\033[48;2;92;81;209m▀\033[38;2;92;81;209m\033[48;2;90;79;207m▀\033[38;2;90;79;207m\033[48;2;88;77;206m▀\033[38;2;88;77;206m\033[48;2;86;75;202m▀\033[38;2;86;75;202m\033[48;2;84;73;198m▀\033[38;2;84;73;198m\033[48;2;82;71;195m▀\033[38;2;82;71;195m\033[48;2;80;69;191m▀\033[38;2;236;235;249m\033[48;2;78;68;187m▀\033[38;2;236;235;249m\033[48;2;195;191;231m▀\033[38;2;236;235;249m\033[48;2;236;235;249m▀\033[38;2;236;235;249m\033[48;2;236;235;249m▀\033[38;2;236;235;249m\033[48;2;236;235;249m▀\033[38;2;236;235;249m\033[48;2;236;235;249m▀\033[38;2;236;235;249m\033[48;2;236;235;249m▀\033[38;2;236;235;249m\033[48;2;236;235;249m▀\033[38;2;236;235;249m\033[48;2;62;52;157m▀\033[38;2;236;235;249m\033[48;2;60;51;153m▀\033[38;2;60;51;153m\033[48;2;58;49;149m▀\033[38;2;58;49;149m\033[48;2;56;47;146m▀\033[38;2;56;47;146m\033[48;2;54;45;142m▀\033[38;2;54;45;142m\033[48;2;52;43;138m▀\033[38;2;52;43;138m\033[48;2;50;41;134m▀\033[38;2;50;41;134m\033[48;2;48;39;130m▀\033[38;2;48;39;131m\033[48;2;46;37;127m▀\033[0m'
  '\033[0m\033[38;2;113;104;215m▀\033[38;2;92;81;209m\033[48;2;90;79;207m▀\033[38;2;90;79;207m\033[48;2;88;77;206m▀\033[38;2;88;77;206m\033[48;2;86;75;202m▀\033[38;2;86;75;202m\033[48;2;84;73;198m▀\033[38;2;84;73;198m\033[48;2;82;71;195m▀\033[38;2;82;71;195m\033[48;2;80;69;191m▀\033[38;2;80;69;191m\033[48;2;78;68;187m▀\033[38;2;78;68;187m\033[48;2;76;66;183m▀\033[38;2;76;66;183m\033[48;2;74;64;180m▀\033[38;2;74;64;180m\033[48;2;72;62;176m▀\033[38;2;72;62;176m\033[48;2;70;60;172m▀\033[38;2;70;60;172m\033[48;2;68;58;168m▀\033[38;2;68;58;168m\033[48;2;66;56;164m▀\033[38;2;66;56;164m\033[48;2;64;54;161m▀\033[38;2;64;54;161m\033[48;2;62;53;157m▀\033[38;2;62;52;157m\033[48;2;60;51;153m▀\033[38;2;60;51;153m\033[48;2;58;49;149m▀\033[38;2;58;49;149m\033[48;2;56;47;146m▀\033[38;2;56;47;146m\033[48;2;54;45;142m▀\033[38;2;54;45;142m\033[48;2;52;43;138m▀\033[38;2;52;43;138m\033[48;2;50;41;134m▀\033[38;2;50;41;134m\033[48;2;48;39;131m▀\033[38;2;48;39;131m\033[48;2;46;37;127m▀\033[38;2;46;37;127m\033[48;2;44;36;123m▀\033[0m\033[38;2;68;61;138m▀\033[0m'
  '\033[0m \033[0m\033[38;2;93;82;207m▀\033[0m\033[38;2;86;75;202m▀\033[38;2;84;73;198m\033[48;2;102;92;201m▀\033[38;2;82;71;195m\033[48;2;80;69;191m▀\033[38;2;80;69;191m\033[48;2;78;68;187m▀\033[38;2;78;68;187m\033[48;2;76;66;183m▀\033[38;2;76;66;183m\033[48;2;74;64;180m▀\033[38;2;74;64;179m\033[48;2;72;62;176m▀\033[38;2;72;62;176m\033[48;2;70;60;172m▀\033[38;2;70;60;172m\033[48;2;68;58;168m▀\033[38;2;68;58;168m\033[48;2;66;56;164m▀\033[38;2;66;56;164m\033[48;2;64;54;161m▀\033[38;2;64;54;161m\033[48;2;62;52;157m▀\033[38;2;62;52;157m\033[48;2;60;51;153m▀\033[38;2;60;51;153m\033[48;2;58;49;149m▀\033[38;2;58;49;149m\033[48;2;56;47;146m▀\033[38;2;56;47;146m\033[48;2;54;45;142m▀\033[38;2;54;45;142m\033[48;2;52;43;138m▀\033[38;2;52;43;138m\033[48;2;50;41;134m▀\033[38;2;50;41;134m\033[48;2;48;39;131m▀\033[38;2;48;39;130m\033[48;2;46;37;127m▀\033[38;2;46;37;127m\033[48;2;68;61;138m▀\033[0m\033[38;2;44;36;123m▀\033[0m\033[38;2;49;41;123m▀\033[0m \033[0m'
)
logo_rows_small=(
  '\033[0m\033[38;2;129;116;233m▄\033[38;2;129;116;233m\033[48;2;124;111;230m▀\033[38;2;124;111;230m\033[48;2;119;106;226m▀\033[38;2;119;106;226m\033[48;2;113;101;223m▀\033[38;2;113;101;223m\033[48;2;108;97;220m▀\033[38;2;108;97;220m\033[48;2;254;254;254m▀\033[38;2;103;92;216m\033[48;2;98;87;213m▀\033[38;2;98;87;213m\033[48;2;93;82;209m▀\033[38;2;93;82;209m\033[48;2;88;77;206m▀\033[0m\033[38;2;83;72;196m▄\033[0m'
  '\033[38;2;124;111;230m\033[48;2;119;106;226m▀\033[38;2;119;106;226m\033[48;2;113;101;223m▀\033[38;2;113;101;223m\033[48;2;108;97;220m▀\033[38;2;254;254;254m\033[48;2;254;254;254m▀\033[38;2;254;254;254m\033[48;2;98;87;213m▀\033[38;2;254;254;254m\033[48;2;93;82;209m▀\033[38;2;254;254;254m\033[48;2;88;77;206m▀\033[38;2;88;77;206m\033[48;2;40;160;100m▀\033[38;2;83;72;196m\033[48;2;78;67;186m▀\033[38;2;78;67;186m\033[48;2;72;62;177m▀\033[0m'
  '\033[38;2;113;101;223m\033[48;2;108;97;220m▀\033[38;2;108;97;220m\033[48;2;103;92;216m▀\033[38;2;235;234;250m\033[48;2;235;234;250m▀\033[38;2;98;87;213m\033[48;2;93;82;209m▀\033[38;2;93;82;209m\033[48;2;88;77;206m▀\033[38;2;88;77;206m\033[48;2;83;72;196m▀\033[38;2;83;72;196m\033[48;2;78;67;186m▀\033[38;2;78;67;186m\033[48;2;72;62;177m▀\033[38;2;72;62;177m\033[48;2;67;57;167m▀\033[38;2;67;57;167m\033[48;2;62;52;157m▀\033[0m'
  '\033[38;2;103;92;216m\033[48;2;98;87;213m▀\033[38;2;98;87;213m\033[48;2;93;82;209m▀\033[38;2;93;82;209m\033[48;2;88;77;206m▀\033[38;2;236;235;249m\033[48;2;236;235;249m▀\033[38;2;83;72;196m\033[48;2;236;235;249m▀\033[38;2;78;67;186m\033[48;2;236;235;249m▀\033[38;2;72;62;176m\033[48;2;236;235;249m▀\033[38;2;234;70;82m\033[48;2;62;52;157m▀\033[38;2;62;52;157m\033[48;2;57;48;147m▀\033[38;2;57;48;147m\033[48;2;52;43;137m▀\033[0m'
  '\033[0m\033[38;2;93;82;209m▀\033[38;2;88;77;206m\033[48;2;83;72;196m▀\033[38;2;83;72;196m\033[48;2;78;67;186m▀\033[38;2;78;67;186m\033[48;2;72;62;177m▀\033[38;2;72;62;177m\033[48;2;67;57;167m▀\033[38;2;74;64;170m\033[48;2;62;52;157m▀\033[38;2;62;52;157m\033[48;2;57;48;147m▀\033[38;2;57;48;147m\033[48;2;52;43;137m▀\033[38;2;52;43;137m\033[48;2;46;38;128m▀\033[0m\033[38;2;46;38;128m▀\033[0m'
)
# LOGO-END

logo_ok() {
  [ -t 1 ] && [ -z "${NO_COLOR:-}" ] && case "${COLORTERM:-}" in truecolor|24bit) return 0 ;; *) return 1 ;; esac
}

header() {
  [ -t 1 ] && clear
  local cur latest
  cur="$(cur_build)"
  if logo_ok; then
    local i
    echo
    for i in "${!logo_rows_small[@]}"; do
      case "$i" in
        1) printf '  %b   %s%sCoreGSM%s\n' "${logo_rows_small[$i]}" "$BLD" "$ACC" "$NC" ;;
        2) printf '  %b   %s%s%s\n' "${logo_rows_small[$i]}" "$DIM" "панель мониторинга игровых серверов" "$NC" ;;
        3) printf '  %b   %s%s%s\n' "${logo_rows_small[$i]}" "$DIM" "${cur:+сборка ${cur:0:7}}" "$NC" ;;
        *) printf '  %b\n' "${logo_rows_small[$i]}" ;;
      esac
    done
  else
    printf '\n  %s▌%s%scoregsm%s  %s%s%s\n' "$ACC" "$NC" "$BLD" "$NC" "$DIM" "${cur:+v${cur:0:7}}" "$NC"
  fi
  hr
  kv "Панель" "${ACC}$(panel_url)${NC}"
  kv "Папка" "${DIM}${APP_DIR}${NC}"
  kv "Состояние" "$(state_label)"
  latest="$(remote_build)"
  if [ -n "$latest" ] && [ "$latest" != "$cur" ]; then kv "Обновление" "${WRN}⬆ доступна ${latest:0:7}${NC}"; fi
  hr
}

item() { # item KEY "Название" "подсказка"
  printf '   %s%s%s  %s%*s%s%s%s\n' "$ACC" "$1" "$NC" "$2" $((24 - ${#2})) '' "$DIM" "${3:-}" "$NC"
}

# ---------- status / doctor ----------
cmd_status() {
  need_installed
  title "Состояние"
  local svc st
  while IFS=$'\t' read -r svc st; do
    case "$st" in
      running) printf '   %s●%s %-14s %s\n' "$OKC" "$NC" "$svc" "работает" ;;
      *) printf '   %s○%s %-14s %s%s%s\n' "$BAD" "$NC" "$svc" "$BAD" "${st:-остановлен}" "$NC" ;;
    esac
  done < <(dc ps -a --format '{{.Service}}\t{{.State}}' 2>/dev/null | sort)
  hr
  if healthy 3; then kv "Панель" "${OKC}отвечает${NC}"; else kv "Панель" "${BAD}не отвечает${NC}"; fi
  local days kind lbl
  if days="$(cert_days)"; then
    kind="$(cert_kind)"; lbl="Let's Encrypt"; [ "$kind" = selfsigned ] && lbl="самоподписанный"
    if [ "$days" -lt 14 ]; then kv "Сертификат" "${WRN}${lbl}, осталось ${days} дн. — скоро истечёт${NC}"; else kv "Сертификат" "${lbl}, ещё ${days} дн."; fi
  fi
  kv "Версия" "$(cur_build | cut -c1-7)"
  if rollback_available; then kv "Откат" "возможен (coregsm rollback)"; fi
  local latest; latest="$(remote_build)"
  if [ -n "$latest" ] && [ "$latest" != "$(cur_build)" ]; then kv "Обновление" "${WRN}⬆ ${latest:0:7}${NC}  (coregsm update)"; fi
  local last; last="$(ls -1t "$BACKUPS" 2>/dev/null | head -n1)"
  kv "Копия" "${last:-нет}"
}

cmd_doctor() {
  need_installed
  local d out="$APP_DIR/doctor-report.txt"
  d="$(envget DOMAIN)"
  {
    echo "CoreGSM doctor, $(date -u '+%Y-%m-%d %H:%M UTC')"
    echo "build: $(cur_build)   domain: $d   proxy: $([ -n "$(envget PROXY_URL)" ] && echo yes || echo no)"
    . /etc/os-release 2>/dev/null; echo "os: ${PRETTY_NAME:-?}   kernel: $(uname -r)   arch: $(uname -m)"
    echo; echo "== docker"; docker --version; docker compose version
    echo; echo "== containers"; dc ps -a 2>&1
    echo; echo "== resources"; free -h | sed -n '1,2p'; df -h "$APP_DIR" | tail -n1
    echo; echo "== listening 80/443"; ss -ltnp 2>/dev/null | grep -E ':(80|443)\b' || echo "none"
    echo; echo "== ufw"; ufw status 2>&1 | head -n 12
    echo; echo "== panel health"
    curl -sk --noproxy "*" --max-time 5 --resolve "${d}:443:127.0.0.1" "https://${d}/api/health" || echo "no answer"
    echo; echo "== dns ($d)"; getent ahostsv4 "$d" 2>&1 | head -n 2
    local crt="$APP_DIR/certbot/conf/live/$d/fullchain.pem"
    if [ -f "$crt" ]; then echo; echo "== certificate"; openssl x509 -noout -subject -enddate -in "$crt" 2>&1; [ -f "$(dirname "$crt")/.selfsigned" ] && echo "self-signed"; echo "days left: $(cert_days)   local_mode: $(envget LOCAL_MODE)   cert_mode: $(envget CERT_MODE)"; fi
    echo; echo "== updater"; systemctl is-active coregsm-update.path 2>&1; ls -la "$UPD" 2>&1 | head -n 8
    local s; for s in backend bot nginx-proxy; do echo; echo "== log: $s (last 25)"; dc logs --no-color --tail=25 "$s" 2>&1; done
  } > "$out" 2>&1
  chmod 600 "$out"
  title "Диагностика"
  # a short verdict on screen, the full report in a file
  local problems=0
  [ "$(stack_state)" = up ] && ok "Все контейнеры запущены" || { bad "Не все контейнеры запущены"; problems=$((problems + 1)); }
  healthy 3 && ok "Панель отвечает на запросы" || { bad "Панель не отвечает"; problems=$((problems + 1)); }
  ss -ltn 2>/dev/null | grep -qE ':443\b' && ok "Порт 443 слушается" || { bad "Порт 443 не слушается"; problems=$((problems + 1)); }
  ufw status 2>/dev/null | grep -q "443" && ok "Файрвол пропускает 80 и 443" || warn "В UFW не видно правил для 443"
  local cdays
  if cdays="$(cert_days)"; then
    if [ "$cdays" -lt 14 ]; then warn "Сертификат истекает через ${cdays} дн."; problems=$((problems + 1)); else ok "Сертификат действует ещё ${cdays} дн."; fi
  fi
  local free; free="$(df -P "$APP_DIR" | awk 'NR==2{print int($4/1024)}')"
  [ "$free" -gt 1024 ] && ok "Свободно места: ${free} МБ" || { warn "Мало места на диске: ${free} МБ"; problems=$((problems + 1)); }
  hr
  if [ "$problems" -eq 0 ]; then ok "Проблем не найдено"; else warn "Найдено проблем: $problems"; fi
  dim "Полный отчёт для поддержки: $out"
}

# Daily check (coregsm-health.timer): a warning in the journal and in /var/log/coregsm-health.log when the
# certificate expires in less than 14 days (renewal does not work) or the panel does not answer.
cmd_health() {
  installed || return 0
  local days msg f=/var/log/coregsm-health.log
  if days="$(cert_days)"; then
    if [ "$days" -lt 14 ]; then
      msg="Сертификат $(envget DOMAIN) истекает через ${days} дн. Проверьте: docker compose logs certbot (cd $APP_DIR)"
      [ "$(cert_kind)" = selfsigned ] && msg="$msg; для самоподписанного: sudo bash install.sh --install"
      printf '%s WARN %s\n' "$(date '+%F %T')" "$msg" >> "$f"
      warn "$msg"
      command -v logger >/dev/null 2>&1 && logger -t coregsm -p daemon.warning "$msg"
    else
      dim "Сертификат действует ещё ${days} дн."
    fi
  fi
  if ! healthy 6; then
    msg="Панель не отвечает на https://$(envget DOMAIN)/api/health"
    printf '%s WARN %s\n' "$(date '+%F %T')" "$msg" >> "$f"
    warn "$msg"
    command -v logger >/dev/null 2>&1 && logger -t coregsm -p daemon.warning "$msg"
  fi
  [ -f "$f" ] && chmod 600 "$f"
  return 0
}

# ---------- logs / start / stop ----------
cmd_logs() {
  need_installed
  local svc="${1:-}"
  if [ -z "$svc" ]; then
    title "Журналы"
    item 1 "Бэкенд" "API и опрос серверов"
    item 2 "Бот" "подключение к Discord"
    item 3 "Nginx" "HTTPS и запросы"
    item 4 "Все сервисы"
    printf '\n  %sВыбор:%s ' "$DIM" "$NC"; local k; tty_read -n1 k; echo
    case "$k" in 1) svc=backend ;; 2) svc=bot ;; 3) svc=nginx-proxy ;; 4) svc="" ;; *) return 0 ;; esac
    dim "Ctrl+C — вернуться"
  fi
  trap ':' INT
  dc logs --tail=60 -f ${svc:+"$svc"}
  trap - INT
}

cmd_power() { # cmd_power start|stop|restart
  need_installed
  case "$1" in
    start) spin "Запускаю контейнеры" dc up -d ;;
    stop) spin "Останавливаю контейнеры" dc stop ;;
    restart) spin "Перезапускаю контейнеры" dc restart ;;
  esac
}

screen_power() {
  header; title "Запуск и остановка"
  item 1 "Перезапустить" "все сервисы"
  item 2 "Остановить" "данные сохраняются"
  item 3 "Запустить"
  printf '\n  %sВыбор:%s ' "$DIM" "$NC"; local k; tty_read -n1 k; echo
  case "$k" in 1) cmd_power restart ;; 2) cmd_power stop ;; 3) cmd_power start ;; *) return 0 ;; esac
  pause
}

# ---------- installer download / run ----------
download_installer() { # download_installer EXPECTED_SHA -> prints path
  local tmp i; tmp="$(mktemp)"
  for i in 1 2 3 4; do
    if fetch_repo install.sh > "$tmp" && [ "$(sha256sum "$tmp" | cut -d' ' -f1)" = "$1" ] && bash -n "$tmp"; then
      printf '%s' "$tmp"; return 0
    fi
    sleep "${RETRY_SLEEP:-8}"
  done
  rm -f "$tmp"; return 1
}

run_installer() { # run_installer FILE  (DOMAIN / LE_EMAIL / PROXY_URL may be set by the caller)
  SKIP_UPDATE=1 COREGSM_FROM_MANAGER=1 bash "$1" --install
}

remote_meta() { # sets R_BUILD R_SHA
  local meta; meta="$(fetch_repo version.txt)" || return 1
  R_BUILD="$(printf '%s\n' "$meta" | sed -n 's/^build=//p' | head -n1)"
  R_SHA="$(printf '%s\n' "$meta" | sed -n 's/^sha256=//p' | head -n1)"
  [ -n "$R_BUILD" ] && [ -n "$R_SHA" ]
}

# ---------- backups ----------
data_volume() { docker volume ls -q 2>/dev/null | grep -E 'coregsm-data$' | head -n1; }

# Image for one-off commands on the data volume: busybox, or (offline) the backend image itself.
helper_image() {
  if docker image inspect busybox >/dev/null 2>&1; then echo busybox; return; fi
  if docker pull -q busybox >/dev/null 2>&1; then echo busybox; return; fi
  echo coregsm-backend
}

# An archive "coregsm-[TAG-]DATE.tgz" holds: coregsm.db (consistent copy), env, certs.tgz, and (new)
# files.tgz + files.list with the news pictures and the brand logo from the data volume. The panel's own
# scheduled backups (/data/backups) and *.db-wal/-shm files are not part of it.
backup_create() { # backup_create [tag]  -> prints the archive path
  local tag="${1:-}" tmp name vol pat
  mkdir -p "$BACKUPS"; chmod 700 "$BACKUPS"
  tmp="$(mktemp -d)"; vol="$(data_volume)"
  name="coregsm-${tag:+$tag-}$(date +%Y%m%d-%H%M%S).tgz"

  if [ "$(dc ps --status running --services 2>/dev/null | grep -c '^backend$')" -gt 0 ]; then
    # consistent online copy with SQLite's own backup API
    dc exec -T backend node -e "require('better-sqlite3')('/data/coregsm.db').backup('/data/.backup.db').then(()=>process.exit(0),e=>{console.error(e);process.exit(1)})" >/dev/null 2>&1 \
      && docker cp "$(dc ps -q backend):/data/.backup.db" "$tmp/coregsm.db" >/dev/null 2>&1
    dc exec -T backend rm -f /data/.backup.db >/dev/null 2>&1
  fi
  if [ ! -f "$tmp/coregsm.db" ] && [ -n "$vol" ] && docker image inspect coregsm-backend >/dev/null 2>&1; then
    # backend stopped: let SQLite merge the write-ahead log into the copy (the backend image has the driver)
    docker run --rm -u 0 --entrypoint node -v "$vol:/data:ro" -v "$tmp:/out" coregsm-backend \
      -e "const D=require('better-sqlite3');const s=new D('/data/coregsm.db',{readonly:true});s.backup('/out/coregsm.db').then(()=>process.exit(0),e=>{console.error(e);process.exit(1)})" >/dev/null 2>&1 \
      || rm -f "$tmp/coregsm.db"
  fi
  if [ ! -f "$tmp/coregsm.db" ] && [ -n "$vol" ]; then
    docker run --rm -u 0 --entrypoint sh -v "$vol:/data:ro" -v "$tmp:/out" "$(helper_image)" -c 'cp /data/coregsm.db /out/coregsm.db' >/dev/null 2>&1
  fi
  [ -f "$tmp/coregsm.db" ] || { rm -rf "$tmp"; return 1; }

  if [ -n "$vol" ]; then
    # news pictures and brand logo; files.list is kept only when the archive really holds them
    docker run --rm -u 0 --entrypoint sh -v "$vol:/data:ro" -v "$tmp:/out" "$(helper_image)" -c \
      'cd /data && ls -d news brand-logo.* 2>/dev/null > /out/files.list; if [ -s /out/files.list ]; then tar czf /out/files.tgz -T /out/files.list || rm -f /out/files.list /out/files.tgz; fi; exit 0' >/dev/null 2>&1 || true
  fi

  cp "$APP_DIR/.env" "$tmp/env"
  [ -d "$APP_DIR/certbot/conf" ] && tar czf "$tmp/certs.tgz" -C "$APP_DIR" certbot/conf 2>/dev/null
  tar czf "$BACKUPS/$name" -C "$tmp" . && chmod 600 "$BACKUPS/$name"
  rm -rf "$tmp"
  # keep the newest $KEEP_BACKUPS archives of each kind (auto, pre-update, before-restore, manual, ...)
  if [ -n "$tag" ]; then pat="coregsm-$tag-[0-9]*.tgz"; else pat="coregsm-[0-9]*.tgz"; fi
  ls -1t "$BACKUPS"/$pat 2>/dev/null | tail -n +$((KEEP_BACKUPS + 1)) | xargs -r rm -f
  printf '%s' "$BACKUPS/$name"
}

# Writes data from an extracted archive (DIR) into the data volume.
#   MODE db   : only coregsm.db (rollback)
#   MODE full : the database, news/ and brand-logo.* (restore); an old archive without files.list leaves
#               the current pictures alone
# The caller stops backend and bot first.
restore_volume() { # restore_volume DIR db|full
  local vol script
  vol="$(data_volume)"; [ -n "$vol" ] || return 1
  script='cp /in/coregsm.db /data/coregsm.db && rm -f /data/coregsm.db-wal /data/coregsm.db-shm && chown 1000:1000 /data/coregsm.db || exit 1'
  if [ "$2" = full ]; then
    script="$script"'; if [ -f /in/files.list ]; then rm -rf /data/news; rm -f /data/brand-logo.*; if [ -f /in/files.tgz ]; then tar xzf /in/files.tgz -C /data || exit 1; fi; fi; chown -R 1000:1000 /data/news /data/brand-logo.* 2>/dev/null; exit 0'
  fi
  docker run --rm -u 0 --entrypoint sh -v "$vol:/data" -v "$1:/in:ro" "$(helper_image)" -c "$script" >/dev/null 2>&1
}

cmd_backup() {
  need_installed
  local f
  if [ "${1:-}" = "--auto" ]; then backup_create auto >/dev/null && exit 0 || exit 1; fi
  f="$(backup_create)" && { ok "Копия создана"; dim "$f"; } || { bad "Не удалось создать копию"; return 1; }
}

pick_backup() { # prints the chosen path
  local -a files=(); local i=1 f k
  mapfile -t files < <(ls -1t "$BACKUPS"/coregsm-*.tgz 2>/dev/null | head -n 9)
  [ "${#files[@]}" -gt 0 ] || { bad "Копий нет. Создайте: coregsm backup" >&2; return 1; }
  for f in "${files[@]}"; do
    printf '   %s%d%s  %s  %s%s%s\n' "$ACC" "$i" "$NC" "$(basename "$f" .tgz | sed 's/^coregsm-//')" "$DIM" "$(du -h "$f" | cut -f1)" "$NC" >&2
    i=$((i + 1))
  done
  printf '\n  %sНомер:%s ' "$DIM" "$NC" >&2; tty_read -n1 k; echo >&2
  [[ "$k" =~ ^[1-9]$ ]] && [ "$k" -le "${#files[@]}" ] || return 1
  printf '%s' "${files[$((k - 1))]}"
}

cmd_restore() {
  need_installed
  local file="${1:-}" tmp vol
  if [ -z "$file" ]; then title "Восстановление"; file="$(pick_backup)" || return 0; fi
  [ -f "$file" ] || { bad "Файл не найден: $file"; return 1; }
  tmp="$(mktemp -d)"
  tar xzf "$file" -C "$tmp" || { bad "Архив повреждён"; rm -rf "$tmp"; return 1; }
  [ -f "$tmp/coregsm.db" ] || { bad "В архиве нет базы данных"; rm -rf "$tmp"; return 1; }
  say "Будут заменены: база данных, картинки новостей и логотип (если они есть в копии),"
  say "а также секреты JWT_SECRET и INTERNAL_TOKEN (они должны совпадать с базой)."
  say "Домен, версия и сертификаты этого сервера не меняются."
  ask_yn "Восстановить из $(basename "$file")?" || { dim "Отменено"; rm -rf "$tmp"; return 0; }
  local with_certs=0
  if [ -f "$tmp/certs.tgz" ]; then
    echo; say "В копии есть сертификаты и адрес (домен) прежнего сервера."
    dim "Нужны только при возврате на тот же адрес. При переносе на другой сервер ответьте «нет»."
    ask_yn "Восстановить также сертификаты и домен из копии?" && with_certs=1
  fi
  spin "Страховочная копия текущего состояния" backup_create before-restore || warn "Страховочная копия не создана"

  spin "Останавливаю сервисы" dc stop backend bot
  restore_volume "$tmp" full && ok "База данных и файлы восстановлены" || { bad "Не удалось записать данные"; rm -rf "$tmp"; return 1; }
  if [ -f "$tmp/env" ]; then
    local k v
    for k in JWT_SECRET INTERNAL_TOKEN; do
      v="$(grep -E "^$k=" "$tmp/env" | tail -n1 | cut -d= -f2-)"
      [ -n "$v" ] && env_set "$k" "$v"
    done
    ok "Секреты JWT_SECRET и INTERNAL_TOKEN восстановлены"
    if [ "$with_certs" = 1 ]; then
      for k in DOMAIN LE_EMAIL LOCAL_MODE CERT_MODE; do
        grep -qE "^$k=" "$tmp/env" && env_set "$k" "$(grep -E "^$k=" "$tmp/env" | tail -n1 | cut -d= -f2-)"
      done
      if ! grep -qE '^LOCAL_MODE=' "$tmp/env"; then
        if is_local_name "$(envget DOMAIN)"; then env_set LOCAL_MODE 1; else env_set LOCAL_MODE 0; fi
      fi
    fi
  fi
  if [ "$with_certs" = 1 ] && [ -f "$tmp/certs.tgz" ]; then tar xzf "$tmp/certs.tgz" -C "$APP_DIR" && ok "Сертификаты и домен восстановлены"; fi
  rm -rf "$tmp"
  spin "Запускаю сервисы" dc up -d
}

# ---------- timers (daily backup, nightly auto-update) ----------
timer_on() { systemctl is-enabled "coregsm-$1.timer" >/dev/null 2>&1; }
timer_set() { # timer_set backup|autoupdate on|off
  local name="$1" mode="$2" exec_line at desc
  case "$name" in
    backup) exec_line="$BIN backup --auto"; at="04:00"; desc="CoreGSM daily backup" ;;
    autoupdate) exec_line="$BIN update --auto"; at="04:30"; desc="CoreGSM nightly update" ;;
  esac
  if [ "$mode" = on ]; then
    printf '[Unit]\nDescription=%s\n\n[Service]\nType=oneshot\nEnvironment=APP_DIR=%s\nExecStart=%s\n' "$desc" "$APP_DIR" "$exec_line" > "/etc/systemd/system/coregsm-$name.service"
    printf '[Unit]\nDescription=%s\n\n[Timer]\nOnCalendar=*-*-* %s:00\nRandomizedDelaySec=300\nPersistent=true\n\n[Install]\nWantedBy=timers.target\n' "$desc" "$at" > "/etc/systemd/system/coregsm-$name.timer"
    systemctl daemon-reload; systemctl enable --now "coregsm-$name.timer" >/dev/null 2>&1
  else
    systemctl disable --now "coregsm-$name.timer" >/dev/null 2>&1
    rm -f "/etc/systemd/system/coregsm-$name.timer" "/etc/systemd/system/coregsm-$name.service"; systemctl daemon-reload
  fi
}
flag() { if timer_on "$1"; then printf '%sвключено%s' "$OKC" "$NC"; else printf 'выключено'; fi; }

screen_backups() {
  while true; do
    header; title "Резервные копии"
    kv "Хранится" "$(ls -1 "$BACKUPS"/coregsm-*.tgz 2>/dev/null | wc -l) шт. из $KEEP_BACKUPS"
    kv "Последняя" "$(ls -1t "$BACKUPS" 2>/dev/null | head -n1 | sed 's/^coregsm-//; s/\.tgz$//')"
    echo
    item 1 "Создать копию" "база, картинки, .env, сертификаты"
    item 2 "Восстановить" "из выбранной копии"
    item 3 "Копия каждую ночь" "$(flag backup)"
    printf '\n  %sВыбор:%s ' "$DIM" "$NC"; local k; tty_read -n1 k; echo
    case "$k" in
      1) cmd_backup; pause ;;
      2) cmd_restore; pause ;;
      3) if timer_on backup; then timer_set backup off; ok "Ночные копии выключены"; else timer_set backup on; ok "Копия будет создаваться каждую ночь в 04:00"; fi; pause ;;
      *) return 0 ;;
    esac
  done
}

# ---------- update (with rollback) ----------
# Rollback is possible while the previous images (:prev tags), the source snapshot and the pre-update backup
# exist. They are taken by snapshot_create before an update and consumed by a successful rollback.
rollback_available() {
  [ -f "$PREV/src.tgz" ] || return 1
  local b; b="$(cat "$PREV/pre_backup" 2>/dev/null)"
  [ -n "$b" ] && [ -f "$b" ] || return 1
  docker images --format '{{.Repository}}:{{.Tag}}' 2>/dev/null | grep -qE '^coregsm-.*:prev$'
}

# status.json: {"state":"running|done|error","message":"...","time":<ms>,"rollback_available":true|false}
status_file() { # status_file STATE MESSAGE  (the panel shows this)
  local msg rb=false; msg="$(printf '%s' "$2" | tr -d '\n\r' | sed 's/["\\]/ /g')"
  rollback_available && rb=true
  mkdir -p "$UPD"
  printf '{"state":"%s","message":"%s","time":%s000,"rollback_available":%s}\n' "$1" "$msg" "$(date +%s)" "$rb" > "$UPD/status.json.tmp"
  mv -f "$UPD/status.json.tmp" "$UPD/status.json"; chmod 644 "$UPD/status.json"
}

prev_images() { docker images --format '{{.Repository}}:{{.Tag}}' 2>/dev/null | grep -E '^coregsm-.*:prev$'; }

snapshot_create() {
  mkdir -p "$PREV"
  rm -f "$PREV/pre_backup"
  # drop the :prev tags of an older snapshot, so old and new images never mix
  prev_images | xargs -r docker rmi >/dev/null 2>&1
  cur_build > "$PREV/version"
  cp -f "$APP_DIR/.env" "$PREV/env"
  tar czf "$PREV/src.tgz" -C "$APP_DIR" docker-compose.yml core-backend core-frontend core-bot nginx 2>/dev/null
  local img f
  for img in $(dc config --images 2>/dev/null | grep '^coregsm-'); do
    docker image inspect "$img" >/dev/null 2>&1 && docker tag "$img" "${img%%:*}:prev"
  done
  f="$(backup_create pre-update 2>/dev/null)" && [ -f "$f" ] && printf '%s' "$f" > "$PREV/pre_backup"
  return 0
}

# the sources of the version that is still running (after a failed build the new ones are on disk already)
restore_sources() { [ -f "$PREV/src.tgz" ] && tar xzf "$PREV/src.tgz" -C "$APP_DIR" 2>/dev/null; return 0; }

RB_ERR=""; RB_DB=0
# Back to the previous version: sources and APP_VERSION, :prev images, the database from the pre-update backup
# (only coregsm.db: .env, certificates, news pictures and the logo stay as they are), then start.
rollback_apply() {
  RB_ERR=""; RB_DB=0
  [ -f "$PREV/src.tgz" ] || { RB_ERR="нет снимка предыдущей версии"; return 1; }
  tar xzf "$PREV/src.tgz" -C "$APP_DIR" || { RB_ERR="не удалось распаковать снимок файлов"; return 1; }
  env_set APP_VERSION "$(cat "$PREV/version" 2>/dev/null)"
  local img
  for img in $(prev_images); do
    docker tag "$img" "${img%:prev}:latest"
  done
  local pre; pre="$(cat "$PREV/pre_backup" 2>/dev/null)"
  if [ -n "$pre" ] && [ -f "$pre" ]; then
    status_file running "Откат к предыдущей версии: восстанавливаю базу данных…"
    local tmp; tmp="$(mktemp -d)"
    tar xzf "$pre" -C "$tmp" ./coregsm.db 2>/dev/null || tar xzf "$pre" -C "$tmp" 2>/dev/null
    if [ ! -f "$tmp/coregsm.db" ]; then
      rm -rf "$tmp"; RB_ERR="копия базы перед обновлением повреждена"; return 1
    fi
    dc stop backend bot >/dev/null 2>&1
    if restore_volume "$tmp" db; then RB_DB=1; say "База данных восстановлена из $(basename "$pre")"
    else rm -rf "$tmp"; RB_ERR="не удалось записать базу данных"; return 1; fi
    rm -rf "$tmp"
  else
    warn "Копия базы перед обновлением не найдена: база не изменена"
  fi
  status_file running "Откат к предыдущей версии: запускаю прежние контейнеры…"
  dc up -d --no-build >/dev/null 2>&1
  if ! healthy 90; then RB_ERR="прежняя версия не отвечает после запуска"; return 1; fi
  # the snapshot is used up: rolling back twice would only bring the old database back again
  rm -f "$PREV/src.tgz" "$PREV/pre_backup"
  prev_images | xargs -r docker rmi >/dev/null 2>&1
  return 0
}

acquire_lock() {
  mkdir -p "$UPD"
  if command -v flock >/dev/null 2>&1; then
    exec 9> "$UPD/.lock"; flock -n 9 || { say "Обновление уже выполняется"; return 1; }
  fi
  return 0
}

# Rollback to the previous version (panel button: request file "rollback"; or "coregsm rollback").
# rollback_flow ASK: ASK=1 asks for a confirmation first (terminal)
rollback_flow() {
  local ask="${1:-0}" prev
  if ! rollback_available; then
    bad "Откат невозможен: нет снимка предыдущей версии или копии базы (создаются при обновлении)"
    status_file error "Откат не удался: нет сохранённого снимка предыдущей версии или копии базы. Откат доступен только после обновления"
    return 1
  fi
  prev="$(cat "$PREV/version" 2>/dev/null)"
  if [ "$ask" = 1 ]; then
    title "Откат"
    kv "Установлено" "$(cur_build | cut -c1-7)"; kv "Вернуть" "${prev:0:7}"
    warn "База данных вернётся к состоянию перед обновлением: изменения после него будут потеряны."
    ask_yn "Откатить?" || { dim "Отменено"; return 0; }
  fi
  status_file running "Откат к предыдущей версии…"
  : > "$LOG"
  rollback_apply >> "$LOG" 2>&1; local rc=$?
  [ "$ask" = 1 ] && sed 's/\x1b\[[0-9;]*m//g' "$LOG"
  if [ "$rc" -eq 0 ]; then
    status_file done "Откат выполнен: работает версия ${prev:0:7}"
    ok "Откат выполнен: работает версия ${prev:0:7}"; return 0
  fi
  status_file error "Откат не удался: ${RB_ERR:-причина в журнале}. Запустите: coregsm doctor"
  bad "Откат не удался: ${RB_ERR:-причина в журнале}. Запустите: coregsm doctor"
  return 1
}

cmd_rollback() {
  local a ask=1
  for a in "$@"; do
    case "$a" in --yes|-y) ask=0 ;; *) bad "Неизвестный параметр: $a"; return 2 ;; esac
  done
  need_root; need_installed
  acquire_lock || return 0
  rollback_flow "$ask"
}

cmd_update() {
  local check=0 force=0 panel=0 auto=0 yes=0 a
  for a in "$@"; do
    case "$a" in
      --check) check=1 ;; --force) force=1 ;; --from-panel) panel=1 ;; --auto) auto=1 ;; --yes|-y) yes=1 ;;
      *) bad "Неизвестный параметр: $a"; return 2 ;;
    esac
  done
  need_root; need_installed
  mkdir -p "$UPD"
  # The request file tells what the panel wants: the word "rollback" = roll back to the previous version,
  # anything else (a timestamp, empty) = update. It is consumed first, otherwise the systemd path unit
  # would fire again.
  local req=""
  if [ "$panel" = 1 ]; then
    req="$(head -c 256 "$UPD/request" 2>/dev/null | tr -d '\r' | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')"
    rm -f "$UPD/request"
  fi
  acquire_lock || return 0
  if [ "$panel" = 1 ] && [ "$req" = rollback ]; then rollback_flow 0; return $?; fi
  local quiet=0; { [ "$panel" = 1 ] || [ "$auto" = 1 ]; } && quiet=1
  fail() { bad "$1"; [ "$check" = 1 ] || status_file error "$1"; return 1; }

  remote_meta || { fail "Не удалось получить version.txt из репозитория"; return 1; }
  local current latest; current="$(cur_build)"; latest="$R_BUILD"; : > "$UPD/.remote"; printf '%s' "$latest" > "$UPD/.remote"

  if [ "$check" = 1 ]; then
    kv "Установлено" "${current:-?}"; kv "В репозитории" "$latest"
    if [ "$current" = "$latest" ]; then ok "Последняя версия"; return 0; fi
    warn "Доступно обновление: coregsm update"; return 10
  fi
  if [ "$current" = "$latest" ] && [ "$force" = 0 ]; then
    ok "У вас последняя версия (${current:0:7})"; dim "Переустановить файлы: coregsm update --force"
    [ "$panel" = 1 ] && status_file done "Уже установлена последняя версия (${latest:0:7})"
    return 0
  fi

  if [ "$quiet" = 0 ] && [ "$yes" = 0 ]; then
    title "Обновление"
    kv "Установлено" "${current:0:7}"; kv "Новая" "${ACC}${latest:0:7}${NC}"
    local news
    news="$(fetch "https://api.github.com/repos/RJ-Bond/CoreGSM/commits?per_page=5" 2>/dev/null | grep -m5 '"message":' | sed 's/.*"message": *"//; s/\\n.*//; s/".*//')"
    if [ -n "$news" ]; then echo; dim "Последние изменения:"; printf '%s\n' "$news" | sed "s/^/    ${DIM}·${NC} /"; fi
    echo; dim "Перед обновлением создаётся копия; при сбое выполнится откат."
    ask_yn "Обновить сейчас?" || { dim "Отменено"; return 0; }
  fi

  status_file running "Скачиваю версию ${latest:0:7}"
  local tmp; tmp="$(download_installer "$R_SHA")" || { fail "Контрольная сумма install.sh не совпала с version.txt. Подождите пару минут (кэш GitHub) и повторите"; return 1; }
  ok "Файл проверен (sha256)"

  status_file running "Сохраняю копию и образы для отката"
  spin "Копия данных и образов для отката" snapshot_create

  status_file running "Устанавливаю версию ${latest:0:7}: сборка и перезапуск контейнеров"
  : > "$LOG"
  run_installer "$tmp" 2>&1 | tee -a "$LOG"; local rc="${PIPESTATUS[0]}"
  rm -f "$tmp"

  if [ "$rc" -eq 0 ] && healthy 120; then
    # the new build id is stamped only now, after the health check
    env_set APP_VERSION "$latest"
    docker image prune -f >/dev/null 2>&1
    status_file done "Обновлено до версии ${latest:0:7}"; echo; ok "Обновлено до ${latest:0:7}"; return 0
  fi
  if [ "$rc" -ne 0 ] && healthy 6; then
    # pull the actual cause out of the installer output so it is visible in the panel and on screen
    local reason
    reason="$(sed 's/\x1b\[[0-9;]*m//g' "$LOG" 2>/dev/null | grep -E '✖|FATAL|Не удалось|Недостаточно|Мало места|ERROR' | grep -v 'Подробности' | sed 's/\. Полный журнал:.*//' | tail -n 2 | tr -s ' \n' ' ' | cut -c1-220)"
    # still the old version: it keeps its build id, and if the build failed the new sources go back as well
    [ -n "$current" ] && env_set APP_VERSION "$current"
    grep -q 'Запуск контейнеров' "$LOG" 2>/dev/null || restore_sources
    status_file error "Обновление не удалось (код $rc): ${reason:-причина в журнале}. Прежняя версия продолжает работать. Журнал: /var/log/coregsm-install.log"
    bad "Обновление не удалось (код $rc), прежняя версия работает."
    [ -n "$reason" ] && say "Причина: $reason"
    dim "Последние строки журнала:"; tail -n 12 "$LOG" 2>/dev/null | sed 's/\x1b\[[0-9;]*m//g; s/^/    /'
    dim "Полный журнал: /var/log/coregsm-install.log"
    return "$rc"
  fi
  warn "Новая версия не запустилась. Возвращаю предыдущую…"
  status_file running "Новая версия не запустилась. Откат к предыдущей версии…"
  if rollback_apply; then
    local dbnote=""; [ "$RB_DB" = 1 ] && dbnote=" (база данных восстановлена из копии перед обновлением)"
    status_file error "Обновление не удалось, выполнен откат на ${current:0:7}${dbnote}. Журнал: /var/log/coregsm-install.log"
    ok "Откат выполнен: работает версия ${current:0:7}"
  else
    status_file error "Обновление не удалось и откат не помог: ${RB_ERR:-причина неизвестна}. Запустите: coregsm doctor"
    bad "Откат не удался: ${RB_ERR:-причина неизвестна}. Запустите: coregsm doctor"
  fi
  return 1
}

screen_update() {
  header; title "Обновление"
  cmd_update --check >/dev/null 2>&1; local rc=$?
  if [ "$rc" -eq 10 ]; then
    cmd_update
  else
    ok "У вас последняя версия"
    echo; item 1 "Переустановить файлы" "вернёт изменённые вручную"
    item 2 "Автообновление по ночам" "$(flag autoupdate)"
    rollback_available && item 3 "Откатить обновление" "версия $(cat "$PREV/version" 2>/dev/null | cut -c1-7), вместе с базой"
    printf '\n  %sВыбор:%s ' "$DIM" "$NC"; local k; tty_read -n1 k; echo
    case "$k" in
      1) cmd_update --force --yes ;;
      3) cmd_rollback ;;
      2) if timer_on autoupdate; then timer_set autoupdate off; ok "Автообновление выключено"; else timer_set autoupdate on; ok "Проверка и обновление каждую ночь в 04:30"; fi ;;
      *) return 0 ;;
    esac
  fi
  pause
}

# ---------- domain / proxy ----------
screen_domain() {
  while true; do
    header; title "Домен и прокси"
    kv "Адрес" "$(envget DOMAIN)"
    kv "Прокси" "$([ -n "$(envget PROXY_URL)" ] && echo 'задан для установки' || echo 'нет')"
    echo
    item 1 "Сменить домен или IP" "перевыпуск сертификата"
    item 2 "Прокси для установки" "apt, Docker, сборка"
    dim "Прокси бота для Discord задаётся в панели: Настройки."
    printf '\n  %sВыбор:%s ' "$DIM" "$NC"; local k; tty_read -n1 k; echo
    case "$k" in
      1) change_domain; pause ;;
      2) change_proxy; pause ;;
      *) return 0 ;;
    esac
  done
}

with_installer() { # with_installer  -> runs the verified installer; caller exports DOMAIN/LE_EMAIL/PROXY_URL
  remote_meta || { bad "Не удалось получить version.txt"; return 1; }
  local tmp; tmp="$(download_installer "$R_SHA")" || { bad "Не удалось скачать установщик"; return 1; }
  run_installer "$tmp"; local rc=$?; rm -f "$tmp"; return $rc
}

change_domain() {
  local d email=""
  say "Домен (gsm.example.com) или IP локальной сети:"; printf '  > '; tty_read d
  d="$(printf '%s' "$d" | tr '[:upper:]' '[:lower:]' | tr -d ' ')"
  [ -n "$d" ] || { dim "Отменено"; return 0; }
  if ! [[ "$d" =~ ^([0-9]{1,3}\.){3}[0-9]{1,3}$ || "$d" =~ \.(local|lan|home|internal|test)$ || "$d" = localhost ]]; then
    printf '  E-mail для Let'"'"'s Encrypt: '; tty_read email
  fi
  ask_yn "Переключить панель на $d?" || { dim "Отменено"; return 0; }
  DOMAIN="$d" LE_EMAIL="$email" with_installer && ok "Готово: https://$d"
}

change_proxy() {
  local p
  say "Прокси: socks5://host:1080 или http://host:3128 (пусто — отключить):"; printf '  > '; tty_read p
  ask_yn "Применить?" || { dim "Отменено"; return 0; }
  PROXY_URL="${p:--}" with_installer && ok "Прокси для установки обновлён"
}

# ---------- admin password ----------
cmd_reset_password() {
  need_installed
  local p1 p2
  title "Сброс пароля администратора"
  printf '  Новый пароль (от 10 символов): '; tty_read -s p1; echo
  [ "${#p1}" -ge 10 ] || { bad "Пароль слишком короткий"; return 1; }
  printf '  Повторите пароль: '; tty_read -s p2; echo
  [ "$p1" = "$p2" ] || { bad "Пароли не совпадают"; return 1; }
  # the first administrator (lowest id with role admin); all of their sessions are closed, nothing else is touched
  local js
  js="$(cat << 'JS'
const db = require('better-sqlite3')('/data/coregsm.db');
const b = require('bcryptjs');
const row = db.prepare("SELECT MIN(id) AS id FROM users WHERE role='admin'").get();
if (!row || !row.id) { console.error('no admin'); process.exit(1); }
const r = db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(b.hashSync(process.env.NEWPW, 12), row.id);
if (!r.changes) { console.error('no user'); process.exit(1); }
db.prepare('DELETE FROM sessions WHERE user_id=?').run(row.id);
JS
)"
  if dc exec -T -e NEWPW="$p1" backend node -e "$js" >/dev/null 2>&1; then
    ok "Пароль изменён, все сеансы администратора закрыты"
  else
    bad "Не удалось изменить пароль (панель ещё не настроена или backend остановлен)"; return 1
  fi
}

# ---------- uninstall ----------
cmd_uninstall() {
  need_root
  title "Удаление CoreGSM"
  item 1 "Только контейнеры" "данные и файлы остаются"
  item 2 "Всё приложение" "контейнеры, база, $APP_DIR"
  item 3 "Всё и Docker" "ещё и сам Docker, правила UFW"
  printf '\n  %sВыбор:%s ' "$DIM" "$NC"; local k; tty_read -n1 k; echo
  case "$k" in 1|2|3) ;; *) dim "Отменено"; return 0 ;; esac

  if [ "$k" = 3 ]; then
    local others; others="$(docker ps -aq 2>/dev/null | wc -l)"
    warn "Будет удалён Docker вместе со ВСЕМИ контейнерами и образами на сервере."
    [ "$others" -gt 0 ] && warn "Сейчас контейнеров в системе: $others (включая не относящиеся к CoreGSM)."
  fi
  echo; say "Для подтверждения введите слово ${BLD}УДАЛИТЬ${NC}:"; printf '  > '; local w; tty_read w
  [ "$w" = "УДАЛИТЬ" ] || { dim "Отменено"; return 0; }

  if [ "$k" -ge 2 ] && installed; then
    local f; f="$(backup_create final 2>/dev/null)"
    if [ -n "$f" ] && [ -f "$f" ] && mv "$f" "/root/$(basename "$f")"; then
      ok "Последняя копия: /root/$(basename "$f")"
    else
      warn "Последнюю копию создать не удалось: данные будут удалены безвозвратно."
      say "Чтобы всё равно удалить без копии, введите ${BLD}БЕЗ КОПИИ${NC}:"; printf '  > '; local w2; tty_read w2
      [ "$w2" = "БЕЗ КОПИИ" ] || { dim "Отменено, ничего не удалено"; return 0; }
    fi
  fi

  if installed; then
    if [ "$k" = 1 ]; then spin "Удаляю контейнеры" dc down --remove-orphans
    else spin "Удаляю контейнеры и данные" dc down -v --rmi local --remove-orphans; fi
  fi
  docker images --format '{{.Repository}}:{{.Tag}}' 2>/dev/null | grep -E '^coregsm-.*:prev$' | xargs -r docker rmi >/dev/null 2>&1

  if [ "$k" -ge 2 ]; then
    local t
    for t in coregsm-update.path coregsm-backup.timer coregsm-autoupdate.timer coregsm-health.timer; do systemctl disable --now "$t" >/dev/null 2>&1; done
    rm -f /etc/systemd/system/coregsm-* /etc/bash_completion.d/coregsm /usr/local/bin/coregsm-update /var/log/coregsm-health.log
    # proxy settings the installer wrote (Docker picks the drop-in removal up at its next restart)
    grep -qs "managed by CoreGSM installer" /etc/apt/apt.conf.d/99coregsm-proxy && rm -f /etc/apt/apt.conf.d/99coregsm-proxy
    grep -qs "managed by CoreGSM installer" /etc/systemd/system/docker.service.d/coregsm-proxy.conf && rm -f /etc/systemd/system/docker.service.d/coregsm-proxy.conf
    rmdir /etc/systemd/system/docker.service.d 2>/dev/null
    systemctl daemon-reload
    rm -rf "$APP_DIR"
    rm -rf /etc/coregsm
    ok "Файлы приложения удалены"
  fi
  if [ "$k" = 3 ]; then
    ufw delete allow 80/tcp >/dev/null 2>&1; ufw delete allow 443/tcp >/dev/null 2>&1
    spin "Удаляю Docker" apt-get purge -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
    rm -rf /var/lib/docker /var/lib/containerd /etc/apt/sources.list.d/docker.list /etc/apt/keyrings/docker.asc
    ok "Docker удалён, правила 80 и 443 убраны из UFW (SSH не тронут)"
  fi
  echo
  if [ "$k" = 1 ]; then ok "Готово. Вернуть: coregsm start"
  else ok "CoreGSM удалён"; rm -f "$BIN"; fi
}

# ---------- menu ----------
menu() {
  need_root; need_installed
  while true; do
    header
    item 1 "Обновить" "проверка и установка"
    item 2 "Состояние" "и диагностика"
    item 3 "Журналы"
    item 4 "Запуск и остановка"
    item 5 "Резервные копии"
    item 6 "Домен и прокси"
    item 7 "Сбросить пароль"
    echo "   ${DIM}──${NC}"
    item 8 "Удалить"
    item 0 "Выйти"
    printf '\n  %sВыбор:%s ' "$DIM" "$NC"; local k; tty_read -n1 k || exit 0; echo
    case "$k" in
      1) screen_update ;;
      2) screen_status ;;
      3) cmd_logs ;;
      4) screen_power ;;
      5) screen_backups ;;
      6) screen_domain ;;
      7) header; cmd_reset_password; pause ;;
      8) header; cmd_uninstall; pause; installed || exit 0 ;;
      0|q|"") exit 0 ;;
    esac
  done
}
screen_status() {
  header; cmd_status
  printf '
  %sД — диагностика, Enter — назад%s ' "$DIM" "$NC"; local k; tty_read -n1 k; echo
  case "${k,,}" in д|d) cmd_doctor; pause ;; esac
}

usage() {
  cat << 'HELP'
  coregsm                     меню управления
  coregsm update              обновить (--check, --force, --yes)
  coregsm rollback            откатить последнее обновление вместе с базой (--yes)
  coregsm status              состояние сервисов
  coregsm doctor              диагностика и отчёт для поддержки
  coregsm logs [сервис]       журналы (backend, bot, nginx-proxy)
  coregsm start|stop|restart  управление контейнерами
  coregsm backup              создать резервную копию
  coregsm restore [файл]      восстановить из копии
  coregsm domain              сменить домен или IP
  coregsm reset-password      сбросить пароль администратора
  coregsm uninstall           удалить
HELP
}

main() {
  local cmd="${1:-menu}"; [ $# -gt 0 ] && shift
  case "$cmd" in
    menu) menu ;;
    update) cmd_update "$@" ;;
    rollback) cmd_rollback "$@" ;;
    health) cmd_health ;;
    status) cmd_status ;;
    doctor) cmd_doctor ;;
    logs) cmd_logs "$@" ;;
    start|stop|restart) need_root; cmd_power "$cmd" ;;
    backup) need_root; cmd_backup "$@" ;;
    restore) need_root; cmd_restore "$@" ;;
    domain) need_root; need_installed; change_domain ;;
    reset-password) need_root; cmd_reset_password ;;
    uninstall) cmd_uninstall ;;
    -h|--help|help) usage ;;
    *) bad "Неизвестная команда: $cmd"; usage; exit 2 ;;
  esac
}

main "$@"
