#!/usr/bin/env bash
# The Android app's release key, made once on your Mac: npm run android:key
#
# Android installs an update only when it's signed with the same key as the app already on the
# phone, so this one key signs every Bridge-AI-android.apk from now on (.github/workflows/
# android.yml). It makes:
#   - the key: RSA 4096, in a self-signed certificate valid 30 years, in a PKCS12 keystore with a
#     long random password and the alias bridge-ai, at
#     ~/Library/Application Support/Bridge AI Release/android-release.p12 (readable only by you);
#   - its password, in your login Keychain ("Bridge AI Android release key", account bridge-ai);
#   - the three GitHub Actions secrets the release builds sign with, set with gh:
#     BRIDGE_ANDROID_P12 (the keystore, in base64), BRIDGE_ANDROID_PASSWORD, BRIDGE_ANDROID_ALIAS.
# It never replaces a key: with one already in any of those places it stops and changes nothing.
# The password is never printed.
#   npm run android:key -- --secrets      set the GitHub secrets again, from the key you have
#   npm run android:key -- --dry-run [--out DIR]
#       a throwaway key in DIR (a new temporary folder if not given), its password in
#       DIR/password.txt, with no Keychain and no GitHub. CI signs its check builds with one.
set -euo pipefail

REPO=sahil1/bridge
SERVICE="Bridge AI Android release key"
ALIAS=bridge-ai
DIR="$HOME/Library/Application Support/Bridge AI Release"
FILE=android-release.p12
SECRETS="BRIDGE_ANDROID_P12 BRIDGE_ANDROID_PASSWORD BRIDGE_ANDROID_ALIAS"

say() { printf '%s\n' "$*"; }
fail() { printf 'android-key: %s\n' "$*" >&2; exit 1; }

mode=create
out=
while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run) mode=dry ;;
    --secrets) mode=secrets ;;
    --out) [ $# -ge 2 ] || fail "--out needs a folder"; out=$2; shift ;;
    -h | --help) sed -n '2,/^set -e/p' "$0" | sed -e '$d' -e 's/^# \{0,1\}//'; exit 0 ;;
    *) fail "no option $1 (there are --dry-run, --out DIR and --secrets)" ;;
  esac
  shift
done
[ -z "$out" ] || [ "$mode" = dry ] || fail "--out is for --dry-run"
command -v openssl >/dev/null || fail "needs openssl"

# Everything made here is readable only by you, and what's half made goes when it stops.
umask 077
work=$(mktemp -d "${TMPDIR:-/tmp}/bridge-android-key.XXXXXX")
trap 'rm -rf "$work"' EXIT

# The password goes to openssl in its environment, never on a command line or the screen.
# The key is encrypted with it from the start, so it's never on disk in the clear.
make_key() {
  pw=$(openssl rand -hex 24)
  BRIDGE_KEY_PASS=$pw openssl req -x509 -newkey rsa:4096 -sha256 -days 10958 -subj "/CN=Bridge AI" \
    -keyout "$work/key.pem" -passout env:BRIDGE_KEY_PASS -out "$work/cert.pem" 2>"$work/log" ||
    { cat "$work/log" >&2; fail "openssl couldn't make the key"; }
  # AES, as Java's keystores read it (apksigner signs with it in CI), from macOS's openssl
  # (LibreSSL) or OpenSSL 3 alike.
  BRIDGE_KEY_PASS=$pw openssl pkcs12 -export -name "$ALIAS" -inkey "$work/key.pem" -passin env:BRIDGE_KEY_PASS \
    -in "$work/cert.pem" -keypbe AES-256-CBC -certpbe AES-256-CBC -macalg sha256 \
    -out "$work/$FILE" -passout env:BRIDGE_KEY_PASS 2>"$work/log" ||
    { cat "$work/log" >&2; fail "openssl couldn't make the keystore"; }
  rm -f "$work/key.pem"
  opens "$work/$FILE" || fail "the keystore just made doesn't open with its password"
}
opens() { BRIDGE_KEY_PASS=$pw openssl pkcs12 -in "$1" -noout -passin env:BRIDGE_KEY_PASS >/dev/null 2>&1; }
# The certificate's SHA-256, as apksigner, Google Play and Android's developer verification show it.
fingerprint() {
  BRIDGE_KEY_PASS=$pw openssl pkcs12 -in "$1" -nokeys -clcerts -passin env:BRIDGE_KEY_PASS 2>/dev/null |
    openssl x509 -noout -fingerprint -sha256 | sed 's/^[^=]*=//'
}

if [ "$mode" = dry ]; then
  [ -n "$out" ] || out=$(mktemp -d "${TMPDIR:-/tmp}/bridge-android-key-dry.XXXXXX")
  mkdir -p "$out"
  [ ! -e "$out/$FILE" ] || fail "there's a key in $out already; it's left as it is"
  make_key
  mv "$work/$FILE" "$out/$FILE"
  printf '%s' "$pw" >"$out/password.txt"
  chmod 600 "$out/$FILE" "$out/password.txt"
  say "Dry run: a throwaway key in $out ($FILE, its password in password.txt, alias $ALIAS)."
  say "For real it would go in $DIR, with its password in your login Keychain (\"$SERVICE\"),"
  say "and set $SECRETS on $REPO. Neither was touched."
  say "SHA-256 of its certificate: $(fingerprint "$out/$FILE")"
  exit 0
fi

# For real: the Keychain, and gh signed in as someone who can set the repo's secrets.
[ "$(uname -s)" = Darwin ] || fail "this keeps the password in macOS's Keychain, so it runs on a Mac (--dry-run works anywhere)"
command -v security >/dev/null || fail "needs macOS's security command"
command -v gh >/dev/null || fail "needs GitHub's gh: brew install gh, then gh auth login"
gh auth status >/dev/null 2>&1 || fail "gh isn't signed in: gh auth login"
[ "$(gh api "repos/$REPO" --jq .permissions.admin 2>/dev/null)" = true ] ||
  fail "your gh account can't set secrets on $REPO (that needs the repo's owner or an admin)"
in_keychain() { security find-generic-password -s "$SERVICE" -a "$ALIAS" >/dev/null 2>&1; }

send_secrets() {
  openssl base64 -A -in "$DIR/$FILE" | gh secret set BRIDGE_ANDROID_P12 --repo "$REPO" &&
    printf '%s' "$pw" | gh secret set BRIDGE_ANDROID_PASSWORD --repo "$REPO" &&
    printf '%s' "$ALIAS" | gh secret set BRIDGE_ANDROID_ALIAS --repo "$REPO"
}

if [ "$mode" = secrets ]; then
  [ -f "$DIR/$FILE" ] || fail "there's no release key at $DIR/$FILE (npm run android:key makes one)"
  pw=$(security find-generic-password -s "$SERVICE" -a "$ALIAS" -w 2>/dev/null) ||
    fail "your Keychain has no password for it (\"$SERVICE\")"
  opens "$DIR/$FILE" || fail "the Keychain's password doesn't open $DIR/$FILE"
  send_secrets || fail "GitHub's secrets weren't all set (above); nothing else changed"
  say "Release builds on $REPO sign with $DIR/$FILE now."
  say "SHA-256 of its certificate: $(fingerprint "$DIR/$FILE")"
  exit 0
fi

# Never a second key: phones with the app signed by the first couldn't update to it.
[ ! -e "$DIR/$FILE" ] ||
  fail "there's a release key already, $DIR/$FILE, and it's left as it is: a new one would stop existing installs from updating. To give it to GitHub again: npm run android:key -- --secrets"
! in_keychain ||
  fail "your Keychain has a password for \"$SERVICE\" already but there's no $DIR/$FILE. If you moved the key, put it back there. Nothing was changed."
names=$(gh secret list --repo "$REPO" --json name --jq '.[].name') || fail "couldn't read $REPO's secret names with gh"
for s in $SECRETS; do
  ! printf '%s\n' "$names" | grep -qx "$s" ||
    fail "$REPO has $s already, so its release builds sign with a key made before. Nothing was changed: a new key would stop existing installs from updating."
done

make_key
security add-generic-password -s "$SERVICE" -a "$ALIAS" -l "$SERVICE" \
  -j "The password of $DIR/$FILE (scripts/android-key.sh)" -w "$pw" ||
  fail "couldn't save the password in your Keychain, so the key wasn't kept"
[ "$(security find-generic-password -s "$SERVICE" -a "$ALIAS" -w 2>/dev/null)" = "$pw" ] ||
  fail "the Keychain didn't keep the password as given, so the key wasn't kept"
mkdir -p "$DIR"
chmod 700 "$DIR"
mv "$work/$FILE" "$DIR/$FILE"
chmod 600 "$DIR/$FILE"
send_secrets ||
  fail "the key is saved ($DIR/$FILE, its password in your Keychain) but GitHub's secrets weren't all set (above). Try again with: npm run android:key -- --secrets"

say ""
say "The Android release key is made."
say "  Key:       $DIR/$FILE"
say "  Password:  in your login Keychain as \"$SERVICE\" (account $ALIAS)"
say "  GitHub:    $SECRETS set on $REPO"
say "  SHA-256 of its certificate:"
say "    $(fingerprint "$DIR/$FILE")"
say ""
say "Back it up now: the file and its password together in your password manager, and one copy"
say "offline. Keychain Access shows the password (search for \"$SERVICE\"). If the key is lost,"
say "phones with Bridge AI can't update to a new APK: they'd uninstall it and pair again."
say ""
say "Each release from now on has Bridge-AI-android.apk. For one already out (3.8.0), once"
say ".github/workflows/android-apk.yml is on main:"
say "  gh workflow run android-apk.yml --repo $REPO -f tag=v3.8.0"
