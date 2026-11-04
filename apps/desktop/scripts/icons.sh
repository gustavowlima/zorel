#!/bin/sh
# Renders assets/icon.svg to assets/icon.png (1024, transparent margin) with headless Chrome; electron-builder makes
# each platform's icons from it. CHROME points to the browser (default: Google Chrome on macOS). Quick Look's
# thumbnail (the old way) paints the transparent margin white.
set -e
cd "$(dirname "$0")/.."
chrome="${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
"$chrome" --headless --disable-gpu --hide-scrollbars --default-background-color=00000000 --window-size=1024,1024 \
  --screenshot="$PWD/assets/icon.png" "file://$PWD/assets/icon.svg" >/dev/null 2>&1
