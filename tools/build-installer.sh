#!/usr/bin/env bash
# Builds the monolithic install.sh (installer-head.sh + every file from src/ embedded as a heredoc)
# and version.txt (build id + SHA-256 of install.sh) that installed servers compare against.
set -euo pipefail
cd "$(dirname "$0")/.."

DELIM='__COREGSM_EOF__'
GEN="$(mktemp)"
FILES="$(mktemp)"
trap 'rm -f "$GEN" "$FILES"' EXIT

find src -type f \
    -not -path '*/node_modules/*' -not -path '*/dist/*' -not -path '*/.*/*' \
    -not -path '*/data/*' -not -path '*/test/*' -not -name '*.db' -not -name '*.db-*' -not -name '*.log' \
  | LC_ALL=C sort > "$FILES"

# Build id: hash of everything that ends up inside install.sh. Same sources -> same id.
is_binary() { case "$1" in *.png|*.ico|*.jpg|*.jpeg|*.gif|*.webp|*.woff|*.woff2) return 0 ;; *) return 1 ;; esac; }

BUILD_ID="$( { cat tools/installer-head.sh tools/coregsm.sh; while IFS= read -r f; do printf '%s\n' "$f"; if is_binary "$f"; then cat "$f"; else tr -d '\r' < "$f"; fi; done < "$FILES"; } | sha256sum | cut -c1-12 )"

{
  echo 'generate_project() {'
  echo '  mkdir -p "$APP_DIR"'
  while IFS= read -r f; do
    rel="${f#src/}"
    echo "  mkdir -p \"\$APP_DIR/$(dirname "$rel")\""
    if is_binary "$f"; then
      # binary assets (icons) travel as base64 so the heredoc stays plain text
      echo "  base64 -d > \"\$APP_DIR/$rel\" << '$DELIM'"
      base64 -w 76 "$f"
      echo "$DELIM"
      continue
    fi
    if grep -q "$DELIM" "$f"; then echo "Delimiter found inside $f" >&2; exit 1; fi
    echo "  cat > \"\$APP_DIR/$rel\" << '$DELIM'"
    tr -d '\r' < "$f"
    if [ -n "$(tail -c1 "$f")" ]; then echo; fi
    echo "$DELIM"
    case "$rel" in *.sh) echo "  chmod +x \"\$APP_DIR/$rel\"" ;; esac
  done < "$FILES"
  echo '}'
} > "$GEN"

MANAGER="$(mktemp)"
trap 'rm -f "$GEN" "$FILES" "$MANAGER"' EXIT
tr -d '\r' < tools/coregsm.sh > "$MANAGER"
if grep -q '^MANAGER$' "$MANAGER"; then echo "Delimiter MANAGER found inside coregsm.sh" >&2; exit 1; fi

# The pretty version "1.0.0.7": the base from VERSION plus a counter that grows whenever the build id changes.
# Unchanged sources keep their label, so the CI check "install.sh is up to date" stays stable.
BASE_VERSION="$(tr -d ' \r\n' < VERSION 2>/dev/null)"; [ -n "$BASE_VERSION" ] || BASE_VERSION=1.0.0
PREV_BUILD="$(sed -n 's/^build=//p' version.txt 2>/dev/null | head -n1)"
PREV_VER="$(sed -n 's/^version=//p' version.txt 2>/dev/null | head -n1)"
if [ "$PREV_BUILD" = "$BUILD_ID" ] && [ -n "$PREV_VER" ] && [ "${PREV_VER%.*}" = "$BASE_VERSION" ]; then
  VERSION_LABEL="$PREV_VER"
else
  n=0; [ "${PREV_VER%.*}" = "$BASE_VERSION" ] && n="${PREV_VER##*.}"
  case "$n" in ''|*[!0-9]*) n=0 ;; esac
  VERSION_LABEL="$BASE_VERSION.$((n + 1))"
fi

awk -v gen="$GEN" -v mgr="$MANAGER" -v build="$BUILD_ID" -v ver="$VERSION_LABEL" '
  $0 == "@@GENERATE_FUNCTION@@" { while ((getline l < gen) > 0) print l; next }
  $0 == "@@MANAGER_SCRIPT@@"    { while ((getline l < mgr) > 0) print l; next }
  { gsub(/@@BUILD_ID@@/, build); gsub(/@@VERSION@@/, ver); print }
' tools/installer-head.sh | tr -d '\r' > install.sh
chmod +x install.sh
bash -n install.sh
bash -n tools/coregsm.sh

printf 'build=%s\nsha256=%s\nversion=%s\n' "$BUILD_ID" "$(sha256sum install.sh | cut -d' ' -f1)" "$VERSION_LABEL" > version.txt
echo "install.sh built: $(wc -l < install.sh) lines, $(wc -c < install.sh) bytes, build $BUILD_ID, version $VERSION_LABEL"
