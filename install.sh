#!/usr/bin/env bash
# Native Debian LXC installer. No commands run when sourced by the test harness.
set -Eeuo pipefail
SOURCE_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR=/opt/two-of-us-chores
CONFIG_PATH=/etc/two-of-us-chores.env
LOCK_PATH=/run/lock/two-of-us-chores-install.lock
SERVICE=two-of-us-chores.service
NODE_VERSION=24.21.0
PNPM_VERSION=11.16.0

require_host() {
  [[ $EUID -eq 0 ]] || { echo 'Run as root inside the Debian LXC (or use sudo bash install.sh).' >&2; return 1; }
  source /etc/os-release
  [[ "$ID" == debian && "$VERSION_ID" == 13 ]] || { echo 'This installer supports Debian 13 LXC guests. See docs/PROXMOX.md for manual setup.' >&2; return 1; }
  [[ -d /run/systemd/system && ! -d /etc/pve ]] || { echo 'Run inside a systemd LXC guest, not on the Proxmox host.' >&2; return 1; }
}

install_runtime() {
  apt-get update
  apt-get install -y ca-certificates curl xz-utils git util-linux
  if command -v node >/dev/null 2>&1; then
    node -e 'if (process.versions.node.split(".")[0] !== "24") process.exit(1)' || {
      echo 'An incompatible Node version is installed. Use a fresh Debian LXC or install Node 24 first.' >&2; return 1;
    }
  else
    local arch archive temporary
    case "$(dpkg --print-architecture)" in
      amd64) arch=x64 ;;
      arm64) arch=arm64 ;;
      *) echo 'Supported architectures: amd64 and arm64.' >&2; return 1 ;;
    esac
    archive="node-v${NODE_VERSION}-linux-${arch}.tar.xz"
    temporary="$(mktemp -d)"
    # Official release and matching checksum manifest; no remote shell execution.
    curl --fail --silent --show-error --location --proto '=https' --proto-redir '=https' \
      "https://nodejs.org/dist/v${NODE_VERSION}/${archive}" -o "$temporary/$archive"
    curl --fail --silent --show-error --location --proto '=https' --proto-redir '=https' \
      "https://nodejs.org/dist/v${NODE_VERSION}/SHASUMS256.txt" -o "$temporary/SHASUMS256.txt"
    (cd "$temporary"; grep "  ${archive}$" SHASUMS256.txt | sha256sum --check --strict)
    (umask 022; tar -xJf "$temporary/$archive" -C /usr/local --strip-components=1)
    rm -rf -- "$temporary"
  fi
  NODE_BIN="$(command -v node)"
  case "$NODE_BIN" in
    /usr/bin/node|/usr/local/bin/node) ;;
    *) echo 'Use a system Node installation in /usr/bin or /usr/local/bin so the service can access it.' >&2; return 1 ;;
  esac
}

install_dependencies() {
  # Corepack is bundled with the supported Node 24 release. Do not replace npm.
  (umask 022; COREPACK_ENABLE_DOWNLOAD_PROMPT=0 COREPACK_ENABLE_AUTO_PIN=0 corepack pnpm@"$PNPM_VERSION" --dir "$APP_DIR" install --frozen-lockfile --prod)
  # A clone made under a restrictive administrator umask must still be readable
  # by the service account. Do not change .git or private environment files.
  chmod a+rx "$APP_DIR"
  chmod -R a+rX "$APP_DIR/src" "$APP_DIR/public" "$APP_DIR/node_modules"
}
configure_app() { CONFIG_PATH="$CONFIG_PATH" bash "$APP_DIR/deploy/create-lxc-config.sh"; }
stop_service() { systemctl stop "$SERVICE"; }
start_service() { systemctl enable "$SERVICE"; systemctl restart "$SERVICE"; }
backup_install() {
  local required="$1" revision bundle
  revision="$(git -C "$APP_DIR" rev-parse HEAD)"
  bundle="$(node "$APP_DIR/deploy/maintenance.mjs" backup "$CONFIG_PATH" "$revision" "$required")"
  if [[ -n "$bundle" ]]; then echo "Recovery backup: $bundle (database, private config and previous revision)."; fi
}
prepare_state() {
  local paths path
  id chores >/dev/null 2>&1 || useradd --system --user-group --home-dir /var/lib/two-of-us-chores --no-create-home --shell /usr/sbin/nologin chores
  paths="$(node "$APP_DIR/deploy/maintenance.mjs" paths "$CONFIG_PATH")"
  while IFS= read -r path; do
    [[ -n "$path" && "$path" != / ]] || { echo 'Unsafe or empty data directory.' >&2; return 1; }
    install -d -o chores -g chores -m 0700 "$path"
  done <<<"$paths"
}
install_service() {
  # All variable paths are fixed by this installer, never supplied by a web request.
  local temporary paths path
  temporary="$(mktemp)"
  sed "s|/usr/local/bin/node|$NODE_BIN|" "$APP_DIR/deploy/two-of-us-chores.service" > "$temporary"
  paths="$(node "$APP_DIR/deploy/maintenance.mjs" paths "$CONFIG_PATH")"
  while IFS= read -r path; do
    # Existing custom state paths must remain writable under systemd hardening.
    [[ "$path" != *[\"%\\]* ]] || { echo 'State paths cannot contain quotes, percent signs or backslashes.' >&2; return 1; }
  done <<<"$paths"
  install -m 0644 "$temporary" "/etc/systemd/system/$SERVICE"
  rm -f "$temporary"
  install -d -m 0755 "/etc/systemd/system/$SERVICE.d"
  {
    echo '[Service]'
    while IFS= read -r path; do printf 'ReadWritePaths="%s"\n' "$path"; done <<<"$paths"
  } > "/etc/systemd/system/$SERVICE.d/state.conf"
  chmod 0644 "/etc/systemd/system/$SERVICE.d/state.conf"
  systemd-analyze verify "/etc/systemd/system/$SERVICE"
  systemctl daemon-reload
}
check_local() {
  local attempt
  for attempt in {1..10}; do
    if CONFIG_PATH="$CONFIG_PATH" node "$APP_DIR/deploy/check-setup.mjs" --local; then return; fi
    sleep 1
  done
  echo "App did not become ready. Inspect: journalctl -u $SERVICE -n 50 --no-pager" >&2
  return 1
}
check_public() { CONFIG_PATH="$CONFIG_PATH" node "$APP_DIR/deploy/check-setup.mjs" "$@"; }

main() {
  local mode="${1:-install}" target branch
  case "$mode" in
    --help|-h)
      echo 'Usage: bash install.sh [--configure | --update | --check [HTTPS_BROWSER_URL]]'
      echo 'Default: guided install or reconfigure. --update backs up before a fast-forward update.'
      return ;;
    install|--configure|--update|--check) ;;
    *) echo 'Unknown option. Use bash install.sh --help.' >&2; return 1 ;;
  esac
  require_host
  umask 077
  exec 8>"$LOCK_PATH"
  flock -n 8 || { echo 'Another installer is running.' >&2; return 1; }
  if [[ "$mode" == --check ]]; then
    check_public "${2:-}"
    return
  fi
  trap 'echo "Setup stopped. The service may be stopped. Keep the recovery backup; see docs/PROXMOX.md for recovery." >&2' ERR
  if [[ "$mode" == --update ]]; then
    [[ -z "$(git -C "$APP_DIR" status --porcelain)" ]] || { echo 'Update stopped: checkout has local changes. Commit or move them first.' >&2; return 1; }
    branch="$(git -C "$APP_DIR" symbolic-ref --short HEAD)"
    git -C "$APP_DIR" fetch origin "$branch"
    target="$(git -C "$APP_DIR" rev-parse FETCH_HEAD)"
    git -C "$APP_DIR" merge-base --is-ancestor HEAD "$target" || { echo 'Update stopped: local and remote history diverged.' >&2; return 1; }
    stop_service
    backup_install required
    (umask 022; git -C "$APP_DIR" merge --ff-only "$target")
  else
    if [[ "$SOURCE_DIR" != "$APP_DIR" && ! -e "$APP_DIR" ]]; then
      [[ -z "$(git -C "$SOURCE_DIR" status --porcelain)" ]] || { echo 'Install from a clean Git clone so local edits are not lost.' >&2; return 1; }
      (umask 022; git clone --no-hardlinks "$SOURCE_DIR" "$APP_DIR")
      git -C "$APP_DIR" remote set-url origin "$(git -C "$SOURCE_DIR" remote get-url origin)"
    fi
    [[ -f "$APP_DIR/package.json" ]] || { echo "Application checkout missing at $APP_DIR." >&2; return 1; }
    if [[ -f "$CONFIG_PATH" ]]; then
      # Existing installations have Node already. Stop before taking the recovery copy.
      if systemctl cat "$SERVICE" >/dev/null 2>&1; then stop_service; fi
      backup_install optional
    fi
  fi
  if [[ "$mode" != --configure ]]; then
    install_runtime
    install_dependencies
  else
    NODE_BIN="$(command -v node)"
  fi
  if [[ "$mode" != --update ]]; then configure_app; fi
  prepare_state
  install_service
  start_service
  check_local
  if ! check_public; then
    echo 'App is running locally; public HTTPS setup still needs attention.' >&2
    echo 'Point your existing proxy to the printed upstream using HTTP, preserve Origin, and disable buffering for /api/events.' >&2
    echo 'Then run: bash install.sh --check https://YOUR-BROWSER-HOSTNAME' >&2
    trap - ERR
    return 1
  fi
  echo 'Ready. Open the configured HTTPS URL to sign in.'
  trap - ERR
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then main "$@"; fi
