#!/usr/bin/env bash
# Disposable Debian/systemd smoke test with rootless Podman; no host service changes.
set -euo pipefail
cd "$(dirname "$0")/.."
command -v podman >/dev/null
[[ "$(podman info --format '{{.Host.Security.Rootless}}')" == true ]] || { echo 'Run this test with rootless Podman.' >&2; exit 1; }
image="localhost/chores-install-test:$$"
container="chores-install-test-$$"
context="$(mktemp -d)"
cleanup() {
  local status=$?
  if [[ $status -ne 0 ]] && podman container exists "$container"; then
    podman exec "$container" journalctl -u two-of-us-chores --no-pager
    podman exec "$container" git -C /opt/two-of-us-chores status --short
  fi
  if podman container exists "$container"; then podman rm -f "$container" >/dev/null; fi
  if podman image exists "$image"; then podman rmi "$image" >/dev/null; fi
  rm -rf -- "$context"
}
trap cleanup EXIT
cp -r src public deploy install.sh package.json pnpm-lock.yaml .gitignore "$context/"
cat > "$context/Containerfile" <<'BUILD'
FROM docker.io/library/debian:13-slim
RUN apt-get update && apt-get install -y systemd systemd-sysv git ca-certificates && rm -rf /var/lib/apt/lists/*
COPY . /opt/two-of-us-chores/
RUN cd /opt/two-of-us-chores && git init -b main && git add . && git -c user.name=Test -c user.email=test@example.com commit -m candidate
CMD ["/sbin/init"]
BUILD
podman build -q -t "$image" "$context"
# systemd needs mount-namespace capability inside the rootless user namespace
# to apply the production unit's filesystem restrictions. No host capability grant.
podman run -d --name "$container" --systemd=always --cap-add=SYS_ADMIN "$image"
for attempt in {1..20}; do
  if podman exec "$container" test -d /run/systemd/system; then break; fi
  sleep 1
done
# .invalid deliberately cannot pass the public HTTPS check; local install must succeed.
set +e
podman exec -i "$container" bash /opt/two-of-us-chores/install.sh <<'ANSWERS'
https://chores.invalid/
127.0.0.1
America/Los_Angeles
3000
yes
test@example.com
dylan-smoke-test-password
dylan-smoke-test-password
mady-smoke-test-password
mady-smoke-test-password
ANSWERS
status=$?
set -e
[[ $status -eq 1 ]] || { echo "Expected incomplete public setup exit 1, got $status"; exit 1; }
podman exec "$container" systemctl is-active two-of-us-chores
podman exec "$container" systemctl is-enabled two-of-us-chores
podman exec "$container" node /opt/two-of-us-chores/deploy/check-setup.mjs --local
podman exec "$container" bash -c 'test "$(stat -c %a /etc/two-of-us-chores.env)" = 600'
# Persist a real login session and chore through reconfiguration, update and reboot.
podman exec "$container" node --input-type=module -e '
  import assert from "node:assert/strict";
  import { writeFileSync } from "node:fs";
  const base = "http://127.0.0.1:3000";
  const login = await fetch(base + "/api/session", { method: "POST", headers: { Origin: "https://chores.invalid", "Content-Type": "application/json" }, body: JSON.stringify({ userId: "D", password: "dylan-smoke-test-password" }) });
  assert.equal(login.status, 200);
  assert.match(login.headers.get("set-cookie"), /Secure/);
  const cookie = login.headers.get("set-cookie").split(";")[0];
  writeFileSync("/root/smoke-cookie", cookie, { mode: 0o600 });
  const chore = await fetch(base + "/api/chores", { method: "POST", headers: { Origin: "https://chores.invalid", "Content-Type": "application/json", Cookie: cookie }, body: JSON.stringify({ title: "Survive update and reboot", assigneeId: "D", scheduleKind: "once", nextDue: "2099-01-01", reminderMode: "off" }) });
  assert.equal(chore.status, 201);
'
podman exec "$container" cp /etc/two-of-us-chores.env /tmp/before.env
set +e
printf '\n\n\n\n\n\n' | podman exec -i "$container" bash /opt/two-of-us-chores/install.sh --configure
status=$?
set -e
[[ $status -eq 1 ]]
podman exec "$container" cmp /tmp/before.env /etc/two-of-us-chores.env
podman exec "$container" bash -e -c '
  git clone /opt/two-of-us-chores /tmp/upstream
  cd /tmp/upstream
  echo updated > update-marker.txt
  git add update-marker.txt
  git -c user.name=Test -c user.email=test@example.com commit -m update
  git -C /opt/two-of-us-chores remote add origin /tmp/upstream
'
set +e
podman exec "$container" bash /opt/two-of-us-chores/install.sh --update
status=$?
set -e
[[ $status -eq 1 ]]
podman exec "$container" test -f /opt/two-of-us-chores/update-marker.txt
podman exec "$container" cmp /tmp/before.env /etc/two-of-us-chores.env
podman restart "$container"
for attempt in {1..20}; do
  if podman exec "$container" node /opt/two-of-us-chores/deploy/check-setup.mjs --local; then
    podman exec "$container" node --input-type=module -e '
      import assert from "node:assert/strict";
      import { readFileSync } from "node:fs";
      const response = await fetch("http://127.0.0.1:3000/api/state", { headers: { Cookie: readFileSync("/root/smoke-cookie", "utf8") } });
      assert.equal(response.status, 200);
      assert.ok((await response.json()).chores.some((chore) => chore.title === "Survive update and reboot"));
    '
    echo 'PASS: native Debian install, private config, login, key-preserving reconfigure, backed-up update, and session/chore persistence after container restart.'
    exit 0
  fi
  sleep 1
done
podman exec "$container" journalctl -u two-of-us-chores --no-pager
exit 1
