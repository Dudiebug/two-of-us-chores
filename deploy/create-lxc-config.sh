#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
CONFIG_PATH="${CONFIG_PATH:-/etc/two-of-us-chores.env}"
if [[ "$CONFIG_PATH" == /etc/* && $EUID -ne 0 ]]; then
  echo "Run this helper as root to write $CONFIG_PATH." >&2
  exit 1
fi
umask 077
# A second wizard must not overwrite changes made while the first is prompting.
exec 9>"${CONFIG_PATH}.lock"
flock -n 9 || { echo 'Another configuration wizard is running.' >&2; exit 1; }
defaults_output="$(node "$SCRIPT_DIR/configure.mjs" defaults "$CONFIG_PATH")"
mapfile -t defaults <<<"$defaults_output"

prompt_default() {
  local label="$1" default="$2" value
  read -r -p "$label [$default]: " value || { echo 'Setup cancelled: incomplete input.' >&2; return 1; }
  printf '%s' "${value:-$default}"
}
read_password() {
  local owner="$1" first second
  while true; do
    read -r -s -p "$owner initial password (12-200 characters): " first || return 1
    printf '\n' >&2
    read -r -s -p "Confirm $owner password: " second || return 1
    printf '\n' >&2
    if [[ "$first" != "$second" ]]; then
      echo 'Passwords do not match.' >&2
    elif (( ${#first} < 12 || ${#first} > 200 )); then
      echo 'Password must be 12-200 characters.' >&2
    elif [[ "$first" == *"'"* ]] || LC_ALL=C grep -q '[[:cntrl:]]' <<<"$first"; then
      echo 'Password cannot contain a single quote or control character.' >&2
    else
      printf '%s' "$first"
      return
    fi
  done
}

# Export only to the writer process; never put passwords in command arguments.
SETUP_ORIGIN="$(prompt_default 'HTTPS URL you will open in your browser' "${defaults[0]}")"
SETUP_HOST="$(prompt_default 'LXC address reachable by your proxy (127.0.0.1 for same-LXC proxy)' "${defaults[1]}")"
SETUP_TIMEZONE="$(prompt_default 'Household timezone' "${defaults[2]}")"
SETUP_PORT="$(prompt_default 'App port' "${defaults[3]}")"
SETUP_PUSH="$(prompt_default 'Enable browser push notifications? yes/no' "${defaults[4]}")"
case "${SETUP_PUSH,,}" in
  y|yes) SETUP_PUSH=yes ;;
  n|no) SETUP_PUSH=no ;;
  *) echo 'Answer yes or no for push notifications.' >&2; exit 1 ;;
esac
SETUP_CONTACT=''
if [[ "$SETUP_PUSH" == yes ]]; then
  SETUP_CONTACT="$(prompt_default 'Push contact email (or HTTPS contact URL)' "${defaults[5]}")"
fi
export SETUP_ORIGIN SETUP_HOST SETUP_TIMEZONE SETUP_PORT SETUP_PUSH SETUP_CONTACT
node "$SCRIPT_DIR/configure.mjs" save "$CONFIG_PATH"
