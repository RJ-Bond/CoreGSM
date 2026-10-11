#!/usr/bin/env bash
# Builds the monolithic install.sh: installer-head.sh + every file from src/ embedded as a heredoc.
set -euo pipefail
cd "$(dirname "$0")/.."

DELIM='__COREGSM_EOF__'
GEN="$(mktemp)"
trap 'rm -f "$GEN"' EXIT

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
  done < <(find src -type f \
      -not -path '*/node_modules/*' -not -path '*/dist/*' -not -path '*/.*/*' -not -name 'package-lock.json' \
      | LC_ALL=C sort)
  echo '}'
} > "$GEN"

awk -v f="$GEN" '$0 == "@@GENERATE_FUNCTION@@" { while ((getline l < f) > 0) print l; next } { print }' \
  tools/installer-head.sh | tr -d '\r' > install.sh
chmod +x install.sh
bash -n install.sh
echo "install.sh built: $(wc -l < install.sh) lines, $(wc -c < install.sh) bytes"
