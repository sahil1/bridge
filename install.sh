#!/bin/sh
# Install Bridge AI on a Mac with one command:
#
#   curl -fsSL https://raw.githubusercontent.com/sahil1/bridge/main/install.sh | sh
#
# Downloads the app for your Mac (Apple Silicon or Intel), puts it in Applications and opens it.
# Run it again to update. Options, as environment variables:
#   BRIDGE_VERSION=v1.23.1   a specific release instead of the latest
#   BRIDGE_APP_DIR=~/Apps    where to put the app (default /Applications, or ~/Applications)
#   BRIDGE_ZIP=./file.zip    install from a zip you already have
set -eu

REPO="sahil1/bridge"
APP="Bridge AI.app"

say() { printf '%s\n' "$*"; }
fail() { printf 'Bridge AI install: %s\n' "$*" >&2; exit 1; }

[ "$(uname -s)" = "Darwin" ] || fail "this installer is for macOS. On Windows and Linux, see https://github.com/$REPO#desktop-app"

case "$(uname -m)" in
  arm64) ARCH=arm64; KIND="Apple Silicon" ;;
  x86_64) ARCH=x64; KIND="Intel" ;;
  *) fail "unsupported Mac: $(uname -m)" ;;
esac
# An Intel shell on an Apple Silicon Mac (Rosetta) still gets the faster native app.
if [ "$ARCH" = x64 ] && [ "$(sysctl -in hw.optional.arm64 2>/dev/null)" = 1 ]; then ARCH=arm64; KIND="Apple Silicon"; fi

if [ -n "${BRIDGE_APP_DIR:-}" ]; then DEST="$BRIDGE_APP_DIR"
elif [ -w /Applications ]; then DEST=/Applications
else DEST="$HOME/Applications"
fi
mkdir -p "$DEST"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

if [ -n "${BRIDGE_ZIP:-}" ]; then
  cp "$BRIDGE_ZIP" "$TMP/bridge.zip"
else
  if [ -n "${BRIDGE_VERSION:-}" ]; then URL="https://github.com/$REPO/releases/download/$BRIDGE_VERSION/Bridge-AI-mac-$ARCH.zip"
  else URL="https://github.com/$REPO/releases/latest/download/Bridge-AI-mac-$ARCH.zip"
  fi
  say "Downloading Bridge AI for $KIND Macs..."
  curl -fL --progress-bar "$URL" -o "$TMP/bridge.zip" || fail "couldn't download $URL"
fi

say "Installing to $DEST..."
ditto -x -k "$TMP/bridge.zip" "$TMP/app" || fail "the download looks damaged; run the installer again"
[ -d "$TMP/app/$APP" ] || fail "the download doesn't contain $APP"

# Updating: close the running app and stop its server, so the new version starts fresh. Your
# agents' sessions resume when it starts again.
if [ -d "$DEST/$APP" ]; then
  pkill -TERM -f "$DEST/$APP/Contents/MacOS/" 2>/dev/null && sleep 1 || true
  PIDFILE="${BRIDGE_HOME:-$HOME/.bridge-ai}/cache/server.pid"
  if [ -f "$PIDFILE" ]; then
    PID="$(cat "$PIDFILE" 2>/dev/null || true)"
    case "$(ps -o command= -p "$PID" 2>/dev/null || true)" in
      *"$APP"*) kill "$PID" 2>/dev/null || true; sleep 1 ;;
    esac
  fi
  rm -rf "$DEST/$APP"
fi

mv "$TMP/app/$APP" "$DEST/$APP"
# Downloaded with curl, so macOS hasn't flagged it; clear the flag anyway in case a zip was copied
# in from a browser download.
xattr -dr com.apple.quarantine "$DEST/$APP" 2>/dev/null || true

VERSION="$(defaults read "$DEST/$APP/Contents/Info.plist" CFBundleShortVersionString 2>/dev/null || echo '')"
say "Bridge AI ${VERSION:+$VERSION }is installed in $DEST."
if [ -z "${BRIDGE_NO_OPEN:-}" ]; then
  open "$DEST/$APP"
  say "Opening it now. Next time, find it in Launchpad or Spotlight, or press Option+Command+A."
fi
