# Proxmox LXC setup: native Node + your existing HTTPS proxy

Run one Node 24 process under systemd inside a Debian 13 LXC. Docker is not
needed. Use an unprivileged LXC for a new install; an existing privileged Debian
LXC can follow the same inside-container steps. Do not convert an existing
container's privilege mode or disable its security settings for this app.

Traffic: browser → your HTTPS reverse proxy → LXC private IP:3000 → Node/SQLite.
HTTPS ends at the proxy; the private upstream connection is HTTP. The proxy must
reach the LXC, and the LXC needs outbound DNS/HTTPS for setup and browser push.
No public port forward to the LXC's port 3000 is needed.

Replace every `CHANGE_ME` value before running its block. Example IPs below are
documentation addresses, not working LAN addresses. Run commands in Bash. Start
with 1 CPU, 512 MB RAM and 8 GB disk; these are starting allocations, not measured
requirements. Leave room for backups and package installation.

## 1. Proxmox host: create the LXC

Run as root **on the Proxmox host**, not inside another container. If you already
have a suitable Debian LXC, skip creation and use `pct enter` with its real ID.

```bash
pveam update
pveam available --section system
pvesm status
pct list

CT_ID='CHANGE_ME_UNUSED_NUMERIC_ID'
TEMPLATE_STORAGE='CHANGE_ME_TEMPLATE_STORAGE' # e.g. local; must support vztmpl
ROOTFS_STORAGE='CHANGE_ME_DISK_STORAGE'      # e.g. local-lvm; must support rootdir
DEBIAN_TEMPLATE='CHANGE_ME_EXACT_DEBIAN_13_AMD64_TEMPLATE_FROM_PVEAM'
BRIDGE='CHANGE_ME_BRIDGE'                    # e.g. vmbr0
LXC_CIDR='CHANGE_ME_PRIVATE_IPV4_AND_PREFIX'  # e.g. 192.0.2.50/24
GATEWAY='CHANGE_ME_LAN_GATEWAY'

pveam download "$TEMPLATE_STORAGE" "$DEBIAN_TEMPLATE"
pct create "$CT_ID" "$TEMPLATE_STORAGE:vztmpl/$DEBIAN_TEMPLATE" \
  --hostname two-of-us-chores --ostype debian --unprivileged 1 \
  --cores 1 --memory 512 --swap 256 --rootfs "$ROOTFS_STORAGE:8" \
  --net0 "name=eth0,bridge=$BRIDGE,ip=$LXC_CIDR,gw=$GATEWAY,firewall=1" \
  --onboot 1
pct start "$CT_ID"
pct enter "$CT_ID"
```

No Docker `nesting` or `keyctl` feature is required for this native deployment.
Set any VLAN or custom DNS options appropriate to your network before proceeding.
Use the Proxmox console to administer this container; SSH is not required.

## 2. Inside the LXC: install the runtime

Run as root **inside the LXC**. This guide pins the tested Node 24.21.0 release and
pnpm 11.16.0. Check current Node 24 security releases before a later deployment;
stay on the supported 24.x major. Downloads come from the official Node site.
The SHA-256 comparison detects a damaged or mismatched archive; it is not a
separate signature verification.

```bash
set -euo pipefail
apt-get update
apt-get install -y ca-certificates curl xz-utils git openssl nano

case "$(dpkg --print-architecture)" in
  amd64) NODE_ARCH=x64 ;;
  arm64) NODE_ARCH=arm64 ;;
  *) echo 'This guide supports amd64/arm64 only'; exit 1 ;;
esac
NODE_VERSION=24.21.0
NODE_ARCHIVE="node-v${NODE_VERSION}-linux-${NODE_ARCH}.tar.xz"
NODE_SETUP_DIR=$(mktemp -d)
cd "$NODE_SETUP_DIR"
curl -fSLO "https://nodejs.org/dist/v${NODE_VERSION}/${NODE_ARCHIVE}"
curl -fSLO "https://nodejs.org/dist/v${NODE_VERSION}/SHASUMS256.txt"
grep "  ${NODE_ARCHIVE}$" SHASUMS256.txt | sha256sum --check --strict
tar -xJf "$NODE_ARCHIVE" -C /usr/local --strip-components=1
node --version
corepack enable
corepack prepare pnpm@11.16.0 --activate
pnpm --version
```

This installs Node in `/usr/local`; use a fresh application LXC to avoid
overwriting another service's runtime. The downloaded files remain in the printed
temporary directory if you need to inspect them (`echo "$NODE_SETUP_DIR"`).

## 3. Inside the LXC: install the application

```bash
git clone https://github.com/Dudiebug/two-of-us-chores.git /opt/two-of-us-chores
cd /opt/two-of-us-chores
pnpm install --frozen-lockfile --prod
id chores >/dev/null 2>&1 || useradd --system --user-group \
  --home-dir /var/lib/two-of-us-chores --no-create-home --shell /usr/sbin/nologin chores
install -d -o chores -g chores -m 0700 /var/lib/two-of-us-chores
install -d -o chores -g chores -m 0700 /var/lib/two-of-us-chores/backups
pnpm exec web-push generate-vapid-keys
```

For a private repository, authenticate Git using your normal GitHub credential
method first; do not put a token in the clone URL or this guide. Application code
stays owned by the administrator; the `chores` service user only needs read access.
Save the generated VAPID pair privately and reuse it on updates. Rotating it means
devices need to subscribe again.

## 4. Inside the LXC: configure passwords, address, and push

For the **first installation only**:

```bash
cd /opt/two-of-us-chores
install -o root -g root -m 0600 deploy/lxc.env.example /etc/two-of-us-chores.env
nano /etc/two-of-us-chores.env
```

Replace the placeholders in this file:

| Setting | Value |
| --- | --- |
| `APP_ORIGIN` | Your exact browser URL, e.g. `https://chores.your-domain.example`; no trailing slash/path. Include a non-default HTTPS port if used. |
| `LISTEN_HOST` | The LXC's private IPv4 address, e.g. `192.0.2.50`, replaced with your real LAN address. |
| `PORT` | `3000` |
| `DYLAN_PASSWORD`, `MADY_PASSWORD` | Different strong passwords of at least 12 characters (maximum 200). |
| `HOUSEHOLD_TIMEZONE` | Your household IANA timezone; default `America/Los_Angeles`. |
| `VAPID_SUBJECT` | A real contact such as `mailto:you@your-domain.example`. |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` | The pair generated in step 3. |
| `ALLOW_INSECURE_LOCALHOST` | Keep `false`. TLS is handled by the existing proxy. |

Keep the supplied paths under `/var/lib/two-of-us-chores`. If push is intentionally
disabled, set **all three** VAPID settings to empty values. Quote environment values
containing whitespace using normal systemd `EnvironmentFile` syntax; avoid multiline
passwords. The service manager reads this root-only file and passes the environment
to Node. Never commit it. Changing its password values after first startup does not
change existing accounts; use Settings → Change password instead.

## 5. Proxmox host and existing proxy: network access

On the **Proxmox host**, enable the Proxmox firewall at the Datacenter, Node, and
container levels as appropriate to your existing firewall setup. The LXC network
interface already has `firewall=1`; that alone does not enable every firewall level.
In the LXC Firewall rules, place these in order above any broader inbound allow:

1. IN ACCEPT, TCP, destination port 3000, source **your proxy's private IP/32**.
2. IN DROP, TCP, destination port 3000, all other sources.

Retain existing management rules and outbound DNS/HTTPS access. If the proxy uses
multiple source IPs, allow each before the drop rule. These rules must be active
before treating the app as isolated from other LAN clients. Test from the proxy
host and from a different LAN device; only the proxy should connect to port 3000.

In **your existing reverse proxy**, add an HTTPS virtual host:

- Public hostname: exactly the hostname in `APP_ORIGIN`, with a browser-trusted certificate.
- Upstream scheme: **HTTP**; address: **LXC private IP**; port: **3000**.
- Preserve the original `Host` and request `Origin`. Do not mount the app under a subpath.
- Disable proxy buffering/caching for `/api/events` and allow long-lived responses.
- Do not cache authenticated pages or API responses. Forward normal cookies unchanged.
- Do not place an additional interactive login wall in front of `/sw.js` or the manifest.

For Nginx-based proxies, `proxy_buffering off; proxy_cache off; proxy_read_timeout 1h;`
in the app location supports its live event stream. Configure these through your
proxy's supported UI/configuration without replacing unrelated virtual hosts.

The browser needs the trusted HTTPS URL for installation and push. A certificate
warning or a plain LAN HTTP URL is not a replacement. Web Push also needs an Internet
connection to the browser vendor's push service; the LXC does not need a public
inbound push port.

## 6. Inside the LXC: install and start the service

```bash
cd /opt/two-of-us-chores
install -o root -g root -m 0644 deploy/two-of-us-chores.service /etc/systemd/system/two-of-us-chores.service
systemd-analyze verify /etc/systemd/system/two-of-us-chores.service
systemctl daemon-reload
systemctl enable --now two-of-us-chores
systemctl status two-of-us-chores --no-pager
journalctl -u two-of-us-chores -n 50 --no-pager

LXC_IP='CHANGE_ME_PRIVATE_LXC_IP'
curl -fsS "http://${LXC_IP}:3000/healthz"
```

Expected health response: `{"ok":true}`. Run the same HTTP check **from the proxy
host**. Then check the public origin from your workstation:

```bash
curl -fsS https://CHANGE_ME_PUBLIC_HOSTNAME/healthz
```

The unit runs as `chores`, restarts after failure, and restricts filesystem writes
to its state directory and private temporary files. If the container reports a
systemd namespace restriction, inspect `journalctl` and your Proxmox/LXC policy;
do not blindly disable isolation or switch the container to privileged mode.

## 7. Browser: sign in, install, and test push

1. Open the public HTTPS URL and sign in as Dylan or Mady.
2. Add a chore; in a second signed-in browser confirm it appears automatically.
3. Install using the browser's install option. On iPhone/iPad, use Safari → Share →
   Add to Home Screen and launch that installed app before enabling notifications.
4. Open Settings → Push reminders → Enable push and accept permission. Use Send test.
5. Configure notification times for each person. Test with the app in the background.
6. Complete a chore and use Undo; check that the other browser refreshes.

Each device subscribes separately. Signing out removes that session's push subscription.
After signing in again, revisit notification settings. Push can be delayed by the
device/browser/OS; do not treat it as a guaranteed alarm.

## 8. Inside the LXC: backup and update

Create an online SQLite backup before every application/schema update. It contains
private chore/account/session data; keep it private and copy it off the LXC.
Back up the root-only environment file separately with appropriate protection.

```bash
cd /opt/two-of-us-chores
BACKUP_FILE="/var/lib/two-of-us-chores/backups/chores-$(date -u +%Y%m%dT%H%M%SZ).db"
runuser -u chores -- env DATABASE_PATH=/var/lib/two-of-us-chores/chores.db \
  /usr/local/bin/node src/backup.mjs "$BACKUP_FILE"
runuser -u chores -- /usr/local/bin/node --input-type=module -e \
  'import { DatabaseSync } from "node:sqlite"; const db=new DatabaseSync(process.argv[1],{readOnly:true}); const result=db.prepare("PRAGMA integrity_check").get().integrity_check; db.close(); console.log(result); if(result!=="ok")process.exit(1)' "$BACKUP_FILE"
git rev-parse HEAD
echo "$BACKUP_FILE"
```

Record that commit ID with that backup. Then update, keeping the environment file
and database in place:

```bash
cd /opt/two-of-us-chores
git status --short
git fetch origin
systemctl stop two-of-us-chores
git merge --ff-only origin/main
pnpm install --frozen-lockfile --prod
install -o root -g root -m 0644 deploy/two-of-us-chores.service /etc/systemd/system/two-of-us-chores.service
systemctl daemon-reload
systemctl start two-of-us-chores
systemctl status two-of-us-chores --no-pager
journalctl -u two-of-us-chores -n 50 --no-pager
```

Stop and inspect if Git reports local changes or the fast-forward fails; do not
discard them. Run these blocks in a `set -euo pipefail` Bash session so later steps
do not continue after a failure. A failed update may leave the service stopped;
inspect the failure or restore the prior release before starting it. Recheck
health, sign-in, live updates, and push afterward. Do not overwrite the environment
file with its example on updates. Apply any new required settings deliberately.

## 9. Inside the LXC: restore and roll back

Set `RESTORE_FILE` to an existing validated backup and `PREVIOUS_COMMIT` to the
matching recorded app revision. Restoring replaces subsequent data with the backup.
The commands preserve current database files in a recovery directory rather than
deleting them. Verify the selected backup before stopping the app.

```bash
set -euo pipefail
cd /opt/two-of-us-chores
RESTORE_FILE='CHANGE_ME_ABSOLUTE_BACKUP_DB_PATH'
PREVIOUS_COMMIT='CHANGE_ME_MATCHING_FULL_COMMIT_ID'
test -f "$RESTORE_FILE"
git cat-file -e "$PREVIOUS_COMMIT^{commit}"
node --input-type=module -e \
  'import { DatabaseSync } from "node:sqlite"; const db=new DatabaseSync(process.argv[1],{readOnly:true}); const result=db.prepare("PRAGMA integrity_check").get().integrity_check; db.close(); if(result!=="ok")throw Error(result); console.log(result)' "$RESTORE_FILE"
systemctl stop two-of-us-chores
RECOVERY_DIR=$(mktemp -d /var/lib/two-of-us-chores/before-restore.XXXXXX)
for file in /var/lib/two-of-us-chores/chores.db /var/lib/two-of-us-chores/chores.db-wal /var/lib/two-of-us-chores/chores.db-shm; do
  if test -f "$file"; then mv -- "$file" "$RECOVERY_DIR/"; fi
done
install -o chores -g chores -m 0600 "$RESTORE_FILE" /var/lib/two-of-us-chores/chores.db
git switch --detach "$PREVIOUS_COMMIT"
pnpm install --frozen-lockfile --prod
# If this revision includes its own service file, install that matching version.
if test -f deploy/two-of-us-chores.service; then
  install -m 0644 deploy/two-of-us-chores.service /etc/systemd/system/two-of-us-chores.service
fi
systemctl daemon-reload
systemctl start two-of-us-chores
systemctl status two-of-us-chores --no-pager
echo "Preserved pre-restore database files in: $RECOVERY_DIR"
```

Do not pair old code with a newly migrated database. Revalidate the service's
listening address when rolling back to code predating `LISTEN_HOST`. After a detached
rollback, a future update requires deliberately switching back to `main` before the
fast-forward update procedure. Proxmox snapshots/backups are useful additional
recovery points, but test a SQLite restore too; bind-mounted data may need separate
Proxmox backup configuration.

## Troubleshooting and verification limits

| Symptom | Check |
| --- | --- |
| Service won't start | `journalctl -u two-of-us-chores -n 100 --no-pager`; Node 24, env syntax, real private IP, initial passwords, directory ownership. |
| Proxy returns 502 | Service health, upstream HTTP/IP/port, proxy source address allowed by firewall. |
| Writes rejected | Exact `APP_ORIGIN`, preserved `Origin`, valid session, correct hostname/port. |
| Other browser doesn't refresh | `/api/events` remains open; proxy buffering/cache disabled; idle timeout sufficient. |
| Push unavailable | All three VAPID settings, trusted HTTPS, installed iOS app, OS/browser permissions, outbound HTTPS. |
| Password edit in env has no effect | Values seed new users only; change an existing password inside Settings. |

The repository's automated checks do not prove your Proxmox networking, systemd
sandbox, certificates, or physical-device push delivery. Validate them on your LXC.
Upstream references: [Proxmox container documentation](https://pve.proxmox.com/pve-docs/chapter-pct.html),
[Node 24 downloads](https://nodejs.org/download/release/latest-v24.x/),
[systemd service execution](https://www.freedesktop.org/software/systemd/man/latest/systemd.exec.html),
[Nginx proxy buffering](https://nginx.org/en/docs/http/ngx_http_proxy_module.html#proxy_buffering).
