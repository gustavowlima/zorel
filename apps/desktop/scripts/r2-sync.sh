#!/bin/sh
# Copies a GitHub release's files to the R2 bucket that serves downloads, under latest/: what install.sh and the apps'
# updater read (the repository can be private). The builds go first and the latest*.yml last, so no app sees a
# version before its files are there.
#   apps/desktop/scripts/r2-sync.sh v0.2.1
# Needs gh (signed in, or GH_TOKEN) and wrangler signed in to the bucket's account (or CLOUDFLARE_API_TOKEN and
# CLOUDFLARE_ACCOUNT_ID). ponytail: wrangler uploads up to 300 MiB per file (the AppImage is ~285); past that, the
# S3 API (aws s3 cp, multipart) instead.
set -eu
TAG="$1"
REPO="${ZOREL_REPO:-gustavowlima/zorel}"
BUCKET="${ZOREL_BUCKET:-zorel-releases}"
WRANGLER="bunx wrangler@4.151.3"

DIR=$(mktemp -d "${TMPDIR:-/tmp}/zorel-r2.XXXXXX") # TMPDIR: somewhere with room for the builds (~850 MB)
trap 'rm -rf "$DIR"' EXIT
gh release download "$TAG" --repo "$REPO" --dir "$DIR"

put() { # put <file> <cache-control>
  $WRANGLER r2 object put "$BUCKET/latest/$1" --file "$DIR/$1" --cache-control "$2" --remote
}
for f in "$DIR"/*; do
  n=$(basename "$f")
  case "$n" in
    latest*.yml) ;;
    install.sh) put "$n" "no-cache" ;;
    *) put "$n" "public, max-age=300" ;; # same names every version: short, so a new one shows up soon
  esac
done
for f in "$DIR"/latest*.yml; do put "$(basename "$f")" "no-cache"; done
