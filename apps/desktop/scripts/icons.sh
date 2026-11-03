#!/bin/sh
# Gera assets/icon.png (1024) e icon.iconset a partir de assets/icon.svg. Só macOS (qlmanage + sips).
set -e
cd "$(dirname "$0")/.."
tmp=$(mktemp -d)
qlmanage -t -s 1024 -o "$tmp" assets/icon.svg >/dev/null 2>&1
cp "$tmp/icon.svg.png" assets/icon.png
rm -rf icon.iconset "$tmp" && mkdir icon.iconset
for s in 16 32 128 256 512; do
  sips -z $s $s assets/icon.png --out icon.iconset/icon_${s}x${s}.png >/dev/null
  sips -z $((s * 2)) $((s * 2)) assets/icon.png --out icon.iconset/icon_${s}x${s}@2x.png >/dev/null
done
