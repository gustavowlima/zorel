#!/bin/sh
# Installs or updates Zorel (macOS and Linux; on Windows, the release's installer):
#   curl -fsSL https://github.com/gustavowlima/zorel/releases/latest/download/install.sh | sh
#
# macOS: the app goes to /Applications (or ~/Applications), replacing a running one (it is asked to quit first), and
# the download's quarantine mark is cleared: without a Developer ID the app is signed ad hoc, which macOS runs once
# that mark is gone. Updating is running this again; the app's update button does it.
# Linux: the AppImage in ~/.local/bin, with an entry (and its icon) in the applications menu.
# A download from the release is checked against the SHA-512 the release lists for it (latest-*.yml, written by
# electron-builder for the updaters) before anything is installed.
# Messages in Portuguese on a system set to Portuguese, in English otherwise.
# ZOREL_REPO: another repository's releases (a fork). ZOREL_ZIP / ZOREL_APPIMAGE: a URL or a local file instead of
# the latest release (to try a build; not verified).
set -e
REPO="${ZOREL_REPO:-gustavowlima/zorel}"
LATEST="https://github.com/$REPO/releases/latest/download"
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

case "${LANG:-}${LC_ALL:-}" in *pt*) PT=1 ;; *) PT= ;; esac
say() { if [ -n "$PT" ]; then echo "$1"; else echo "$2"; fi; }
fail() {
  say "✗ $1" "✗ $2" >&2
  exit 1
}
fetch() { # fetch <url or file> <to>
  case "$1" in
    http*) curl -fL --progress-bar -o "$2" "$1" ;;
    *) cp "$1" "$2" ;;
  esac
}
# The release's metadata for this system (version and hashes), fetched once.
meta() { # meta <latest-*.yml>
  curl -fsSL "$LATEST/$1" -o "$TMP/meta.yml" 2>/dev/null || fail "Não achei a versão mais recente em github.com/$REPO." "Couldn't find the latest release at github.com/$REPO."
  VERSION=$(awk '/^version:/ { print $2; exit }' "$TMP/meta.yml")
}
# verify <file> <published name>: the file's SHA-512 (base64) must be the one the release lists.
verify() {
  command -v openssl >/dev/null || fail "Pra conferir o download precisa do openssl. Instale e rode de novo." "Checking the download needs openssl. Install it and run this again."
  want=$(awk -v f="$2" '$0 ~ ("url: " f "$") { getline; sub(/.*sha512: */, ""); print; exit }' "$TMP/meta.yml")
  [ -n "$want" ] || fail "A versão mais recente não tem $2. Nada foi instalado." "The latest release doesn't list $2. Nothing was installed."
  got=$(openssl dgst -sha512 -binary "$1" | base64 | tr -d '\n')
  [ "$got" = "$want" ] || fail "O download veio diferente do publicado. Nada foi instalado." "The download doesn't match the release. Nothing was installed."
  say "✓ Download conferido" "✓ Download checked"
}
done_msg() { # done_msg <where>
  say "✓ Zorel ${VERSION:-} instalado em $1" "✓ Zorel ${VERSION:-} installed in $1"
  say "  Pra atualizar depois, rode o mesmo comando (ou use o botão de atualização no app)." "  To update later, run the same command again (or use the update button in the app)."
}

install_mac() {
  # Ask the chip: under Rosetta, uname says x86_64 on Apple silicon too.
  ARCH=x64
  [ "$(sysctl -n hw.optional.arm64 2>/dev/null)" = 1 ] && ARCH=arm64
  DEST=/Applications
  [ -w "$DEST" ] || DEST="$HOME/Applications"
  mkdir -p "$DEST"
  APP="$DEST/Zorel.app"

  [ -n "${ZOREL_ZIP:-}" ] || meta latest-mac.yml
  say "Baixando o Zorel ${VERSION:-}…" "Downloading Zorel ${VERSION:-}…"
  fetch "${ZOREL_ZIP:-$LATEST/zorel-mac-$ARCH.zip}" "$TMP/zorel.zip"
  [ -n "${ZOREL_ZIP:-}" ] || verify "$TMP/zorel.zip" "zorel-mac-$ARCH.zip"
  # Unpacked, then copied into place: about three times the download, free on this disk (a full disk failed midway
  # with "No space left on device" and left the old app; 2026-11-05).
  NEED=$(($(wc -c <"$TMP/zorel.zip") / 1024 * 3))
  FREE=$(df -k "$TMP" | awk 'NR==2 {print $4}')
  [ "$FREE" -ge "$NEED" ] || fail "Falta espaço em disco: o Zorel precisa de $((NEED / 1048576 + 1)) GB livres para atualizar." "Not enough disk space: Zorel needs $((NEED / 1048576 + 1)) GB free to update."
  ditto -x -k "$TMP/zorel.zip" "$TMP/app"
  [ -d "$TMP/app/Zorel.app" ] || fail "O arquivo baixado não tem o Zorel.app." "The download doesn't contain Zorel.app."

  # Copying over a running app breaks it: ask it to quit (it stops its server) and wait.
  running() { pgrep -f "$APP/Contents/MacOS/Zorel\$" >/dev/null; }
  if running; then
    say "Fechando o Zorel aberto…" "Closing the running Zorel…"
    osascript -e 'with timeout of 20 seconds' -e 'tell application "Zorel" to quit' -e 'end timeout' >/dev/null 2>&1 || true
    for _ in $(seq 1 30); do running || break; sleep 1; done
    running && fail "O Zorel não fechou. Feche com ⌘Q e rode de novo." "Zorel didn't close. Quit it with ⌘Q and run this again."
  fi

  rm -rf "$APP"
  ditto "$TMP/app/Zorel.app" "$APP"
  xattr -r -d com.apple.quarantine "$APP" >/dev/null 2>&1 || true
  done_msg "$APP"
  open "$APP"
}

install_linux() {
  case "$(uname -m)" in
    x86_64 | amd64) ARCH=x86_64 META=latest-linux.yml ;;
    aarch64 | arm64) ARCH=arm64 META=latest-linux-arm64.yml ;;
    *) fail "O Zorel roda em Linux x64 ou ARM64, não em $(uname -m)." "Zorel runs on x64 or ARM64 Linux, not on $(uname -m)." ;;
  esac
  DEST="$HOME/.local/bin"
  APP="$DEST/Zorel.AppImage"
  APPS="$HOME/.local/share/applications"
  mkdir -p "$DEST" "$APPS"
  running() { pgrep -f "^$APP( |\$)" >/dev/null; }
  if running; then
    say "Fechando o Zorel aberto…" "Closing the running Zorel…"
    pkill -TERM -f "^$APP( |\$)" 2>/dev/null || true
    for _ in $(seq 1 30); do running || break; sleep 1; done
    running && fail "O Zorel não fechou. Encerre pelo ícone na bandeja › Quit e rode de novo." "Zorel didn't close. Quit it (tray icon › Quit) and run this again."
  fi
  [ -n "${ZOREL_APPIMAGE:-}" ] || meta "$META"
  say "Baixando o Zorel ${VERSION:-}…" "Downloading Zorel ${VERSION:-}…"
  fetch "${ZOREL_APPIMAGE:-$LATEST/zorel-linux-$ARCH.AppImage}" "$TMP/Zorel.AppImage"
  [ -n "${ZOREL_APPIMAGE:-}" ] || verify "$TMP/Zorel.AppImage" "zorel-linux-$ARCH.AppImage"
  chmod +x "$TMP/Zorel.AppImage"
  mv -f "$TMP/Zorel.AppImage" "$APP"
  # In the applications menu with its own icon (the largest one inside the AppImage).
  ICON="$HOME/.local/share/icons/zorel.png"
  mkdir -p "$(dirname "$ICON")"
  (cd "$TMP" && "$APP" --appimage-extract 'usr/share/icons/hicolor/*/apps/*.png' >/dev/null 2>&1 &&
    cp "$(ls -S squashfs-root/usr/share/icons/hicolor/*/apps/*.png | head -1)" "$ICON") || ICON=zorel
  cat >"$APPS/zorel.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=Zorel
Comment=AI agents that work on your projects
Exec="$APP" %U
Icon=$ICON
Terminal=false
Categories=Development;
StartupWMClass=Zorel
EOF
  command -v update-desktop-database >/dev/null 2>&1 && update-desktop-database "$APPS" >/dev/null 2>&1 || true
  done_msg "$APP"
  if [ -n "${DISPLAY:-}${WAYLAND_DISPLAY:-}" ]; then nohup "$APP" >/dev/null 2>&1 & fi
}

case "$(uname -s)" in
  Darwin) install_mac ;;
  Linux) install_linux ;;
  *) fail "No Windows, baixe o instalador em https://github.com/$REPO/releases/latest" "On Windows, download the installer from https://github.com/$REPO/releases/latest" ;;
esac
