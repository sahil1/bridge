#!/bin/bash
# Setup's "Everything" on a Mac (server/index.js, /api/setup/run): Apple's command line developer
# tools, Homebrew and the programs it brings, in the "Set up Bridge AI" terminal tab, where you can
# watch it. Your Mac's password is asked once, at the start, and only when something here needs it.
#   setup-mac.sh [devtools] [homebrew] [brew=<path>] [<formula>...]
#     devtools    Apple's command line developer tools, the way Homebrew's installer gets them:
#                 softwareupdate, without a window, else macOS's own window. With homebrew too,
#                 Homebrew's installer brings them itself, so they're left to it.
#     homebrew    Homebrew, with its own installer (github.com/Homebrew/install)
#     brew=<path> the Homebrew that's here already
#     <formula>   what then installs with Homebrew (ical-buddy, whisper-cpp)
# It ends with "Setup stopped before the end" when something didn't work (Bridge AI reads that).
# BRIDGE_SETUP_STANDINS (tests): a folder whose programs are used first, so nothing real runs.

PATH="${BRIDGE_SETUP_STANDINS:+$BRIDGE_SETUP_STANDINS:}/usr/bin:/bin:/usr/sbin:/sbin:$PATH"
devtools=
homebrew=
brew=
formulas=()
for a in "$@"; do
  case "$a" in
    devtools) devtools=1 ;;
    homebrew) homebrew=1 ;;
    brew=*) brew="${a#brew=}" ;;
    *) formulas+=("$a") ;;
  esac
done

say() { printf '\n==> %s\n' "$*"; }
stop() { echo; echo "Setup stopped before the end. What went wrong is above. Close this tab, then try again in Bridge AI."; exit 1; }
# The tools are here: their folder (what xcode-select says, never asking) has a real git.
tools() { local d; d=$(xcode-select -p 2>/dev/null) && [ -x "$d/usr/bin/git" ]; }

# One password for all of it. sudo remembers it for 5 minutes, and the developer tools alone take
# longer than that, so it's kept fresh while this runs (and only then: it stops when this ends).
if [ -n "$devtools$homebrew" ]; then
  sudo -v -p "Password for this Mac, to set up Bridge AI: " || stop
  ( while kill -0 $$ 2>/dev/null && sudo -n -v 2>/dev/null; do sleep 50; done ) >/dev/null 2>&1 &
  keep=$!
  trap 'kill "$keep" 2>/dev/null' EXIT
fi

if [ -n "$devtools" ] && [ -z "$homebrew" ] && ! tools; then
  say "Apple's command line developer tools: about 1 GB from Apple, so this takes a while"
  # As Homebrew's installer does it: while this file is there, softwareupdate lists the tools.
  placeholder=/tmp/.com.apple.dt.CommandLineTools.installondemand.in-progress
  sudo touch "$placeholder"
  # The newest it lists, by the Xcode version each ends with (a beta only when that's all there is).
  labels=$(softwareupdate -l 2>/dev/null | sed -n 's/^ *\* *Label: *//p' | grep 'Command Line Tools')
  newest() { awk '{ v = $0; sub(/.*Xcode[- ]*/, "", v); print v "\t" $0 }' | sort -V | tail -n 1 | cut -f 2-; }
  label=$(printf '%s\n' "$labels" | grep -vi beta | newest)
  [ -n "$label" ] || label=$(printf '%s\n' "$labels" | newest)
  if [ -n "$label" ]; then
    say "sudo softwareupdate -i \"$label\""
    sudo softwareupdate -i "$label" && sudo xcode-select --switch /Library/Developer/CommandLineTools
  fi
  sudo rm -f "$placeholder"
  # Not listed, or it didn't install: macOS's own window, then wait for it (an hour at most).
  if ! tools; then
    say "Click Install in the window macOS opened. This carries on by itself once the tools are installed."
    xcode-select --install
    n=0
    until tools || [ "$n" -ge 720 ]; do sleep 5; n=$((n + 1)); done
    tools || stop
  fi
fi

if [ -n "$homebrew" ]; then
  say "Homebrew"
  NONINTERACTIVE=1 /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)" || stop
  # Not on the PATH until your shell profile says so: where its installer puts it.
  brew=$(command -v brew 2>/dev/null || { [ -x /opt/homebrew/bin/brew ] && echo /opt/homebrew/bin/brew; } || echo /usr/local/bin/brew)
fi

if [ "${#formulas[@]}" -gt 0 ]; then
  say "brew install ${formulas[*]}"
  HOMEBREW_NO_ASK=1 "${brew:-brew}" install "${formulas[@]}" || stop
fi
