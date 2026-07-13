#!/bin/sh
set -eu

cd "$(dirname "$0")/.."

command -v 7z >/dev/null 2>&1 || {
  echo "7z is required to build the XPI." >&2
  exit 1
}

node --check background.js
node --check api/globalImapSearch/implementation.js
node --check results/results.js
python3 -m json.tool manifest.json >/dev/null
python3 -m json.tool api/globalImapSearch/schema.json >/dev/null

version=$(sed -n 's/^[[:space:]]*"version": "\([^"]*\)",/\1/p' manifest.json)
test -n "$version"

mkdir -p dist
archive="dist/global-imap-server-search-$version.xpi"
rm -f "$archive"

7z a -tzip "$archive" \
  manifest.json \
  background.js \
  api \
  results \
  icons \
  _locales \
  LICENSE \
  PRIVACY.md >/dev/null

7z t "$archive" >/dev/null
echo "$archive"

