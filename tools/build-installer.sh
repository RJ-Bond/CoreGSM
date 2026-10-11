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
    -not -path '*/node_modules/*' -not -path '*/dist/*' -not -path '*/.*/*' -not -name 'package-lock.json' \
  | LC_ALL=C sort > "$FILES"

# Build id: hash of everything that ends up inside install.sh. Same sources -> same id.
BUILD_ID="$( { cat tools/installer-head.sh tools/coregsm.sh; while IFS= read -r f; do printf '%s\n' "$f"; tr -d '\r' < "$f"; done < "$FILES"; } | sha256sum | cut -c1-12 )"

{
  echo 'generate_project() {'
  echo '  mkdir -p "$APP_DIR"'
  while IFS= read -r f; do
    rel="${f#src/}"
    if grep -q "$DELIM" "$f"; then echo "Delimiter found inside $f" >&2; exit 1; fi
    echo "  mkdir -p \"\$APP_DIR/$(dirname "$rel")\""
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

awk -v gen="$GEN" -v mgr="$MANAGER" -v build="$BUILD_ID" '
  $0 == "@@GENERATE_FUNCTION@@" { while ((getline l < gen) > 0) print l; next }
  $0 == "@@MANAGER_SCRIPT@@"    { while ((getline l < mgr) > 0) print l; next }
  { gsub(/@@BUILD_ID@@/, build); print }
' tools/installer-head.sh | tr -d '\r' > install.sh
chmod +x install.sh
bash -n install.sh
bash -n tools/coregsm.sh

printf 'build=%s\nsha256=%s\n' "$BUILD_ID" "$(sha256sum install.sh | cut -d' ' -f1)" > version.txt
echo "install.sh built: $(wc -l < install.sh) lines, $(wc -c < install.sh) bytes, build $BUILD_ID"
