#!/usr/bin/env bash
# Builds a Chrome Web Store–ready zip in dist/ containing only the files the
# extension needs at runtime.
set -euo pipefail
cd "$(dirname "$0")/.."

version=$(node -p "require('./manifest.json').version")
out="dist/x-privacy-v${version}.zip"

mkdir -p dist
rm -f "$out"
zip -q -r "$out" \
  manifest.json \
  background.js \
  content.js \
  styles.css \
  popup.html \
  popup.css \
  popup.js \
  icons

echo "built $out ($(du -h "$out" | cut -f1))"
unzip -l "$out"
