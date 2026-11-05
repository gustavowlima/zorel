#!/bin/sh
# The macOS release, built on this Mac and signed with the Developer ID in its keychain (the certificate never leaves
# it). Run after the version's tag: CI creates the release and adds Windows and Linux; this adds the Mac files.
#
# Once per Mac:
#   Xcode › Settings › Accounts › Manage Certificates › + › Developer ID Application
#   xcrun notarytool store-credentials zorel --apple-id <email> --team-id <team id>   (an app-specific password)
# Then, for each release (from the repository's root): bun run release:mac
#
# ZOREL_SIGN_IDENTITY picks a certificate (its SHA-1) when the keychain has more than one; ZOREL_NOTARY_PROFILE names
# another notarytool profile than "zorel".
set -eu

cd "$(dirname "$0")/.."
VERSION=$(bun -e 'console.log(require("./package.json").version)')
TAG="v$VERSION"
OUT=artifacts
APP="$OUT/mac-arm64/Zorel.app"
PROFILE="${ZOREL_NOTARY_PROFILE:-zorel}"

fail() {
  echo "✗ $1" >&2
  exit 1
}

[ "$(uname -s)" = Darwin ] || fail "Run this on a Mac."
[ "$(uname -m)" = arm64 ] || fail "Run this on an Apple silicon Mac (the release is arm64)."

# The certificate: the one named, or the keychain's only Developer ID Application.
IDENTITY="${ZOREL_SIGN_IDENTITY:-}"
if [ -z "$IDENTITY" ]; then
  FOUND=$(security find-identity -v -p codesigning | awk '/"Developer ID Application/ { print $2 }')
  [ -n "$FOUND" ] || fail "No Developer ID Application certificate in the keychain (Xcode › Settings › Accounts › Manage Certificates)."
  [ "$(echo "$FOUND" | wc -l | tr -d ' ')" = 1 ] || fail "More than one Developer ID certificate: set ZOREL_SIGN_IDENTITY to the SHA-1 of the one to use (security find-identity -v -p codesigning)."
  IDENTITY=$FOUND
fi

# The notarization credentials, checked before a 10-minute build.
xcrun notarytool history --keychain-profile "$PROFILE" >/dev/null 2>&1 ||
  fail "No working notarytool profile \"$PROFILE\": xcrun notarytool store-credentials $PROFILE --apple-id <email> --team-id <team id>"

# The release the tag made (CI), and room for the build: the app, its Chromium, the .dmg and the .zip.
gh release view "$TAG" >/dev/null 2>&1 || fail "No release $TAG yet: push the tag first (git tag $TAG && git push origin $TAG) and let CI create it."
FREE_GB=$(($(df -k . | awk 'NR==2 {print $4}') / 1048576))
[ "$FREE_GB" -ge 10 ] || fail "Only $FREE_GB GB free: the build needs about 10 GB."

echo "Zorel $VERSION: building, signing with $IDENTITY and notarizing (profile $PROFILE)…"
bun run prerelease
rm -rf "$OUT"
# ZOREL_SIGN_IDENTITY keeps adhoc-sign.cjs out of the way; APPLE_KEYCHAIN_PROFILE turns on electron-builder's notarization.
ZOREL_SIGN_IDENTITY="$IDENTITY" APPLE_KEYCHAIN_PROFILE="$PROFILE" CSC_IDENTITY_AUTO_DISCOVERY=false \
  bunx electron-builder --mac --arm64 --publish never -c.mac.identity="$IDENTITY"

# What Gatekeeper will check on a user's Mac: every program signed, the app notarized with its ticket attached.
codesign --verify --deep --strict "$APP" || fail "The app's signature doesn't verify."
codesign --verify --strict "$APP/Contents/Resources/zorel-server" || fail "zorel-server isn't signed."
xcrun stapler validate "$APP" >/dev/null || fail "The app has no notarization ticket."
spctl --assess --type execute "$APP" || fail "Gatekeeper refuses the app."

# Next to the release's Windows and Linux files; latest-mac.yml is what installed apps update from.
gh release upload "$TAG" "$OUT/zorel-mac-arm64.dmg" "$OUT/zorel-mac-arm64.dmg.blockmap" "$OUT/zorel-mac-arm64.zip" "$OUT/zorel-mac-arm64.zip.blockmap" "$OUT/latest-mac.yml" --clobber
echo "✓ Zorel $VERSION for macOS is signed, notarized and on the $TAG release."
