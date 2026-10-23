#!/bin/sh
# Install Bridge AI on macOS or Linux with one command:
#
#   curl -fsSL https://raw.githubusercontent.com/sahil1/bridge/main/install.sh | sh
#
# macOS: downloads the app for your Mac (Apple Silicon or Intel), puts it in Applications, opens it.
# Linux: installs the .deb on Debian and Ubuntu (asks for your password), otherwise the AppImage in
#        ~/.local with a menu entry. (Windows: see install.ps1.)
# Run it again to update. Options, as environment variables:
#   BRIDGE_VERSION=v1.24.0   a specific release instead of the latest
#   BRIDGE_APP_DIR=~/Apps    macOS: where to put the app (default /Applications, or ~/Applications)
#   BRIDGE_ZIP=./file.zip    macOS: install from a zip you already have
#   BRIDGE_FILE=./file       Linux: install from a .deb or .AppImage you already have
set -eu

REPO="sahil1/bridge"
APP="Bridge AI.app"

say() { printf '%s\n' "$*"; }
fail() { printf 'Bridge AI install: %s\n' "$*" >&2; exit 1; }

url_for() {
  if [ -n "${BRIDGE_VERSION:-}" ]; then echo "https://github.com/$REPO/releases/download/$BRIDGE_VERSION/$1"
  else echo "https://github.com/$REPO/releases/latest/download/$1"
  fi
}

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# ---------- Linux ----------
install_linux() {
  [ "$(uname -m)" = x86_64 ] || fail "Bridge AI is built for 64-bit Intel/AMD Linux so far; on $(uname -m), run it from source: https://github.com/$REPO#from-source"
  if command -v apt-get >/dev/null 2>&1 && command -v dpkg >/dev/null 2>&1; then
    FILE="$TMP/Bridge-AI-linux-amd64.deb"
    if [ -n "${BRIDGE_FILE:-}" ]; then cp "$BRIDGE_FILE" "$FILE"
    else say "Downloading Bridge AI..."; curl -fL --progress-bar "$(url_for Bridge-AI-linux-amd64.deb)" -o "$FILE" || fail "couldn't download the .deb"
    fi
    pkill -TERM -x bridge-ai 2>/dev/null && sleep 1 || true
    say "Installing (this asks for your password)..."
    SUDO=""; [ "$(id -u)" = 0 ] || SUDO=sudo
    $SUDO apt-get install -y "$FILE" || fail "apt couldn't install the package"
    BIN=bridge-ai
  else
    DIR="$HOME/.local/share/bridge-ai"; BIN="$HOME/.local/bin/bridge-ai"
    mkdir -p "$DIR" "$HOME/.local/bin" "$HOME/.local/share/applications" "$HOME/.local/share/icons/hicolor/512x512/apps"
    if [ -n "${BRIDGE_FILE:-}" ]; then cp "$BRIDGE_FILE" "$TMP/app"
    else say "Downloading Bridge AI..."; curl -fL --progress-bar "$(url_for Bridge-AI-linux-x86_64.AppImage)" -o "$TMP/app" || fail "couldn't download the AppImage"
    fi
    pkill -TERM -f "$DIR/Bridge-AI.AppImage" 2>/dev/null && sleep 1 || true
    mv "$TMP/app" "$DIR/Bridge-AI.AppImage"; chmod +x "$DIR/Bridge-AI.AppImage"
    ln -sf "$DIR/Bridge-AI.AppImage" "$BIN"
    curl -fsSL "https://raw.githubusercontent.com/$REPO/main/public/icon-512.png" -o "$HOME/.local/share/icons/hicolor/512x512/apps/bridge-ai.png" 2>/dev/null || true
    printf '[Desktop Entry]\nName=Bridge AI\nComment=Run and talk to all your AI coding agents\nExec=%s %%U\nIcon=bridge-ai\nType=Application\nCategories=Development;\nTerminal=false\n' "$DIR/Bridge-AI.AppImage" > "$HOME/.local/share/applications/bridge-ai.desktop"
    say "Installed to $DIR, with a menu entry and the command $BIN."
    # AppImages need FUSE 2, which newer distributions leave out.
    if ! ldconfig -p 2>/dev/null | grep -q 'libfuse\.so\.2'; then
      say "If it doesn't open: install FUSE 2 (Ubuntu and Debian: sudo apt install libfuse2; Fedora: sudo dnf install fuse-libs)."
    fi
  fi
  say "Bridge AI is installed."
  if [ -z "${BRIDGE_NO_OPEN:-}" ] && { [ -n "${DISPLAY:-}" ] || [ -n "${WAYLAND_DISPLAY:-}" ]; }; then
    nohup "$BIN" >/dev/null 2>&1 &
    say "Opening it now. Next time, find it in your applications menu."
  fi
}

case "$(uname -s)" in
  Darwin) ;;
  Linux) install_linux; exit 0 ;;
  *) fail "this installer is for macOS and Linux. On Windows, in PowerShell: irm https://raw.githubusercontent.com/$REPO/main/install.ps1 | iex" ;;
esac

# ---------- macOS ----------

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

if [ -n "${BRIDGE_ZIP:-}" ]; then
  cp "$BRIDGE_ZIP" "$TMP/bridge.zip"
else
  URL="$(url_for "Bridge-AI-mac-$ARCH.zip")"
  say "Downloading Bridge AI for $KIND Macs..."
  curl -fL --progress-bar "$URL" -o "$TMP/bridge.zip" || fail "couldn't download $URL"
fi

say "Installing to $DEST..."
ditto -x -k "$TMP/bridge.zip" "$TMP/app" || fail "the download looks damaged; run the installer again"
[ -d "$TMP/app/$APP" ] || fail "the download doesn't contain $APP"

# Updating: close the running app and stop its server, so the new version starts fresh. Your
# agents keep running in its terminal host, which shows as "Bridge AI terminal host" rather than
# the app's path, so this leaves it be; the new version picks them up (or, if its host is too
# different, resumes their sessions).
if [ -d "$DEST/$APP" ]; then
  # -a: include our own parents (and the signal must come first on macOS). When the app updates itself, it started this installer, and
  # without -a macOS pkill skips it and its server, leaving the old version running.
  pkill -TERM -a -f "$DEST/$APP/Contents/MacOS/" 2>/dev/null && sleep 1 || true
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
