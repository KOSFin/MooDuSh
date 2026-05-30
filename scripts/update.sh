#!/usr/bin/env sh
set -eu

ROOT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
REPOSITORY_URL="${REPOSITORY_URL:-https://github.com/KOSFin/MooDuSh-from-syncshare}"
ARTIFACT_NAME="${ARTIFACT_NAME:-moodush-extension.zip}"

cd "$ROOT_DIR"

if command -v curl >/dev/null 2>&1; then
  DOWNLOADER="curl -fsSL"
elif command -v wget >/dev/null 2>&1; then
  DOWNLOADER="wget -qO-"
else
  echo "curl or wget is required."
  exit 1
fi

API_URL="$(printf '%s' "$REPOSITORY_URL" | sed 's#https://github.com/#https://api.github.com/repos/#')/releases/latest"
TMP_DIR="$(mktemp -d)"
cleanup() {
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT

echo "MooDuSh: locating latest GitHub Release..."
RELEASE_JSON="$($DOWNLOADER "$API_URL")"
DOWNLOAD_URL="$(printf '%s' "$RELEASE_JSON" | sed -n 's/.*"browser_download_url": "\(.*'"$ARTIFACT_NAME"'\)".*/\1/p' | head -n 1)"

if [ -z "$DOWNLOAD_URL" ]; then
  echo "Could not find $ARTIFACT_NAME in latest release."
  exit 1
fi

echo "MooDuSh: downloading $ARTIFACT_NAME..."
$DOWNLOADER "$DOWNLOAD_URL" > "$TMP_DIR/$ARTIFACT_NAME"

echo "MooDuSh: replacing extension files..."
unzip -oq "$TMP_DIR/$ARTIFACT_NAME" -d "$ROOT_DIR"

echo "Done. Open chrome://extensions/ and reload MooDuSh."
