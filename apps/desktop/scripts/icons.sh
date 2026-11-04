#!/bin/sh
# Generates assets/icon.png (1024) from assets/icon.svg; electron-builder makes the platform icons from it. macOS only (qlmanage).
set -e
cd "$(dirname "$0")/.."
tmp=$(mktemp -d)
qlmanage -t -s 1024 -o "$tmp" assets/icon.svg >/dev/null 2>&1
cp "$tmp/icon.svg.png" assets/icon.png
rm -rf "$tmp"
