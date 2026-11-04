#!/bin/sh
# Installs or updates Zorel (macOS and Linux; on Windows, the release's installer):
#   curl -fsSL https://github.com/gustavowlima/zorel/releases/latest/download/install.sh | sh
# ZOREL_REPO: another repository's releases (a fork).
#
# macOS: the app goes to /Applications (or ~/Applications), replacing a running one (it is asked to quit first), and
# the download's quarantine mark is cleared: without a Developer ID the app is signed ad hoc, which macOS runs once
# that mark is gone. Updating is running this again; the app's update button does it.
# Linux: the AppImage in ~/.local/bin, with an entry in the applications menu.
# ZOREL_ZIP / ZOREL_APPIMAGE: a URL or a local file instead of the latest release (to try a build; not verified).
# A download from the release is checked against the SHA-512 the release lists for it (latest-*.yml, written by
# electron-builder for the updaters) before anything is installed.
set -e
REPO="${ZOREL_REPO:-gustavowlima/zorel}"
LATEST="https://github.com/$REPO/releases/latest/download"
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

fetch() { # fetch <url or file> <to>
  case "$1" in
    http*) curl -fL --progress-bar -o "$2" "$1" ;;
    *) cp "$1" "$2" ;;
  esac
}
fail() {
  echo "$1" >&2
  exit 1
}
# verify <file> <release metadata file> <published name>: the file's SHA-512 (base64) must be the one listed.
verify() {
  command -v openssl >/dev/null || fail "Can't check the download: install openssl and run this again."
  want=$(curl -fsSL "$LATEST/$2" | awk -v f="$3" '$0 ~ ("url: " f "$") { getline; sub(/.*sha512: */, ""); print; exit }')
  [ -n "$want" ] || fail "The release doesn't list $3: nothing was installed."
  got=$(openssl dgst -sha512 -binary "$1" | base64 | tr -d '\n')
  [ "$got" = "$want" ] || fail "The download of $3 doesn't match the release: nothing was installed."
}

install_mac() {
  # Ask the chip: under Rosetta, uname says x86_64 on Apple silicon too.
  ARCH=x64
  [ "$(sysctl -n hw.optional.arm64 2>/dev/null)" = 1 ] && ARCH=arm64
  DEST=/Applications
  [ -w "$DEST" ] || DEST="$HOME/Applications"
  mkdir -p "$DEST"
  APP="$DEST/Zorel.app"

  echo "Downloading Zorel…"
  fetch "${ZOREL_ZIP:-$LATEST/zorel-mac-$ARCH.zip}" "$TMP/zorel.zip"
  [ -n "${ZOREL_ZIP:-}" ] || verify "$TMP/zorel.zip" latest-mac.yml "zorel-mac-$ARCH.zip"
  ditto -x -k "$TMP/zorel.zip" "$TMP/app"
  [ -d "$TMP/app/Zorel.app" ] || fail "The download doesn't contain Zorel.app."

  # Copying over a running app breaks it: ask it to quit (it stops its server) and wait.
  running() { pgrep -f "$APP/Contents/MacOS/Zorel\$" >/dev/null; }
  if running; then
    echo "Closing Zorel…"
    osascript -e 'with timeout of 20 seconds' -e 'tell application "Zorel" to quit' -e 'end timeout' >/dev/null 2>&1 || true
    for _ in $(seq 1 30); do running || break; sleep 1; done
    running && fail "Zorel didn't close. Quit it with ⌘Q and run this again."
  fi

  rm -rf "$APP"
  ditto "$TMP/app/Zorel.app" "$APP"
  xattr -r -d com.apple.quarantine "$APP" >/dev/null 2>&1 || true
  echo "Installed in $APP"
  open "$APP"
}

install_linux() {
  case "$(uname -m)" in
    x86_64 | amd64) ARCH=x86_64 ;;
    aarch64 | arm64) ARCH=arm64 ;;
    *) fail "Zorel runs on x64 or ARM64 Linux, not on $(uname -m)." ;;
  esac
  DEST="$HOME/.local/bin"
  APP="$DEST/Zorel.AppImage"
  mkdir -p "$DEST" "$HOME/.local/share/applications"
  running() { pgrep -f "^$APP( |\$)" >/dev/null; }
  if running; then
    echo "Closing Zorel…"
    pkill -TERM -f "^$APP( |\$)" 2>/dev/null || true
    for _ in $(seq 1 30); do running || break; sleep 1; done
    running && fail "Zorel didn't close. Quit it (tray icon › Quit) and run this again."
  fi
  echo "Downloading Zorel…"
  fetch "${ZOREL_APPIMAGE:-$LATEST/zorel-linux-$ARCH.AppImage}" "$TMP/Zorel.AppImage"
  META=latest-linux.yml
  [ "$ARCH" = arm64 ] && META=latest-linux-arm64.yml
  [ -n "${ZOREL_APPIMAGE:-}" ] || verify "$TMP/Zorel.AppImage" "$META" "zorel-linux-$ARCH.AppImage"
  chmod +x "$TMP/Zorel.AppImage"
  mv -f "$TMP/Zorel.AppImage" "$APP"
  cat >"$HOME/.local/share/applications/zorel.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=Zorel
Exec="$APP" %U
Icon=zorel
Terminal=false
Categories=Development;
StartupWMClass=Zorel
EOF
  echo "Installed: $APP"
  if [ -n "${DISPLAY:-}${WAYLAND_DISPLAY:-}" ]; then nohup "$APP" >/dev/null 2>&1 & fi
}

case "$(uname -s)" in
  Darwin) install_mac ;;
  Linux) install_linux ;;
  *) fail "On Windows, run the installer from https://github.com/$REPO/releases/latest" ;;
esac
