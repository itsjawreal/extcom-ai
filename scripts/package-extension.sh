#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DIST="$ROOT/apps/extension/dist"
VERSION=$(node -p "require('$ROOT/apps/extension/manifest.json').version")
OUTPUT="$ROOT/release/extcom-ai-v$VERSION.zip"
STAGE=$(mktemp -d)

cleanup() {
  rm -rf "$STAGE"
}
trap cleanup EXIT

cd "$ROOT"
npm run build:extension

for required in manifest.json content.js content.css pageInsert.js serviceWorker.js popup.html popup.js icons/icon128.png; do
  if [[ ! -f "$DIST/$required" ]]; then
    echo "Missing required extension artifact: $required" >&2
    exit 1
  fi
done

BUILT_VERSION=$(node -p "require('$DIST/manifest.json').version")
if [[ "$BUILT_VERSION" != "$VERSION" ]]; then
  echo "Built manifest version $BUILT_VERSION does not match source version $VERSION" >&2
  exit 1
fi

cp -R "$DIST/." "$STAGE/"
find "$STAGE" -type f -name '*.map' -delete
mkdir -p "$(dirname "$OUTPUT")"

cd "$STAGE"
python3 -m zipfile -c "$OUTPUT" ./*

if unzip -Z1 "$OUTPUT" | grep -Eq '(^|/)(\.env|node_modules|src)(/|$)|\.map$'; then
  echo "Release ZIP contains development files or secrets" >&2
  exit 1
fi

unzip -tq "$OUTPUT"
echo "Extension package ready: $OUTPUT"
