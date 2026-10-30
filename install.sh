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

# BRIDGE_RELEASES: where releases are (tests point it at a server of their own).
RELEASES="${BRIDGE_RELEASES:-https://github.com/$REPO/releases}"
url_for() {
  if [ -n "${BRIDGE_VERSION:-}" ]; then echo "$RELEASES/download/$BRIDGE_VERSION/$1"
  else echo "$RELEASES/latest/download/$1"
  fi
}
# Downloads only follow redirects to https.
get() { curl --proto-redir '=https' -fL "$@"; }

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# A download must match the checksum its release lists (SHA256SUMS.txt, written when it was built),
# so a damaged or swapped file isn't installed.
check_sum() {
  [ -f "$TMP/SHA256SUMS.txt" ] || get -sS "$(url_for SHA256SUMS.txt)" -o "$TMP/SHA256SUMS.txt" 2>/dev/null || fail "couldn't download the release's checksums (SHA256SUMS.txt); run the installer again"
  WANT="$(awk -v n="$2" '$2 == n { print $1 }' "$TMP/SHA256SUMS.txt")"
  [ -n "$WANT" ] || fail "the release's checksums don't list $2"
  if command -v sha256sum >/dev/null 2>&1; then GOT="$(sha256sum "$1" | awk '{ print $1 }')"; else GOT="$(shasum -a 256 "$1" | awk '{ print $1 }')"; fi
  [ "$GOT" = "$WANT" ] || fail "the download of $2 doesn't match its checksum; run the installer again"
}

# ---------- Linux ----------
install_linux() {
  [ "$(uname -m)" = x86_64 ] || fail "Bridge AI is built for 64-bit Intel/AMD Linux so far; on $(uname -m), run it from source: https://github.com/$REPO#from-source"
  if command -v apt-get >/dev/null 2>&1 && command -v dpkg >/dev/null 2>&1; then
    FILE="$TMP/Bridge-AI-linux-amd64.deb"
    if [ -n "${BRIDGE_FILE:-}" ]; then cp "$BRIDGE_FILE" "$FILE"
    else say "Downloading Bridge AI..."; get --progress-bar "$(url_for Bridge-AI-linux-amd64.deb)" -o "$FILE" || fail "couldn't download the .deb"; check_sum "$FILE" Bridge-AI-linux-amd64.deb
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
    else say "Downloading Bridge AI..."; get --progress-bar "$(url_for Bridge-AI-linux-x86_64.AppImage)" -o "$TMP/app" || fail "couldn't download the AppImage"; check_sum "$TMP/app" Bridge-AI-linux-x86_64.AppImage
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

# From 3.4.0 the app needs macOS 13 (Ventura) or later, as its Electron does (BRIDGE_VERSION, for an
# older release, skips this).
MACOS="$(sw_vers -productVersion 2>/dev/null || echo 0)"
if [ -z "${BRIDGE_VERSION:-}" ] && ! [ "${BRIDGE_MACOS:-${MACOS%%.*}}" -ge 13 ] 2>/dev/null; then
  fail "Bridge AI needs macOS 13 (Ventura) or later, and this Mac has macOS $MACOS. Update macOS in System Settings › General › Software Update, then run this again."
fi

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
  get --progress-bar "$URL" -o "$TMP/bridge.zip" || fail "couldn't download $URL"
  check_sum "$TMP/bridge.zip" "Bridge-AI-mac-$ARCH.zip"
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
  # without -a macOS pkill skips it and its server, leaving the old version running. Contents/, not
  # Contents/MacOS/: from 3.0.1 the server runs on the Helper, in Contents/Frameworks.
  pkill -TERM -a -f "$DEST/$APP/Contents/" 2>/dev/null && sleep 1 || true
  # Except a terminal host on the app's own executable (3.0.0 and before): it checked in with macOS
  # as Bridge AI itself, so macOS would take the new version for open already and refuse to open it.
  # Stop that one; the new version resumes its agents. A host on the Helper stays.
  for HPID in $(pgrep -f "Bridge AI terminal host" 2>/dev/null || true); do
    if lsof -a -p "$HPID" -d txt -Fn 2>/dev/null | grep -qxF "n$DEST/$APP/Contents/MacOS/${APP%.app}"; then kill "$HPID" 2>/dev/null || true; sleep 1; fi
  done
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
