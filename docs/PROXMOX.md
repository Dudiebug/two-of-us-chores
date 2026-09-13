# Proxmox LXC: guided native installation

Run one Node 24 process with SQLite inside a **Debian 13 LXC**, managed by systemd.
Use an unprivileged LXC; Docker, nesting and a separate database server are not
needed. Start with 1 CPU, 512 MB RAM and 8 GB disk. These are suggested starting
allocations, not measured minimum requirements.

Traffic: browser → existing HTTPS reverse proxy → LXC address:3000 over HTTP.
The LXC needs outbound DNS/HTTPS during installation and for browser push. Use a
static IP or DHCP reservation so your proxy's upstream address stays stable.

## Install

Create a Debian 13 LXC in Proxmox, enable **Start at boot**, and open its console.
Run the following **as root inside the LXC**, not on the Proxmox host:

```bash
apt-get update && apt-get install -y git ca-certificates
git clone https://github.com/Dudiebug/two-of-us-chores.git /opt/two-of-us-chores
cd /opt/two-of-us-chores
bash install.sh
```

For a private repository, authenticate Git with your normal credential method
first. Never put a token in the clone URL. If cloned elsewhere, the installer
copies a clean checkout into `/opt/two-of-us-chores` and retains the original Git
remote. Continue using the installed checkout for later commands.

The installer:

- Installs Node 24.21.0 from the official Node distribution when Node is absent,
  verifies the archive checksum, and installs the committed production dependency
  lock using pnpm 11.16.0 through Corepack. An existing system Node 24 is reused;
  incompatible versions are rejected rather than overwritten.
- Suggests the detected LXC IPv4 address and system timezone. If multiple addresses
  exist, it displays them and asks you to choose. For a proxy in this same LXC,
  enter `127.0.0.1`. IPv6 listening addresses are also accepted.
- Asks for the **HTTPS URL you open in your browser**, account passwords on first
  installation, and whether you want push. The URL may have a trailing slash but
  must not contain a path, query, or credentials. The public hostname cannot be
  inferred from the LXC's private address.
- Generates push keys automatically if enabled. A contact email or HTTPS contact
  URL is required for push. Password input is hidden; use different passwords of
  12–200 characters without single quotes or control characters.
- Saves private configuration at `/etc/two-of-us-chores.env`, creates the `chores`
  service account and state directories, and enables/starts the systemd service.
- Checks local health and the login origin check, then checks the public HTTPS URL.

No configuration file needs to be manually edited for a normal install. Existing
accounts, database paths, extra environment settings and push keys are retained
on reruns. Blank answers accept the current values. Changing initial-password
variables does not reset existing accounts; change passwords in app Settings.
Disabling push retains the keys and clears the contact setting, so they can be
reused when push is enabled again. Configuration is validated before atomic write.

`npm start` is still the foreground application command and expects its environment
to be supplied. For an LXC, systemd handles that environment and keeps the app
running after the console closes or the guest restarts.

## Connect the existing reverse proxy

The installer prints the exact upstream address. In your proxy, create a host with:

| Setting | Value |
| --- | --- |
| Browser hostname | The hostname entered in the wizard |
| HTTPS certificate | A trusted certificate for that hostname, managed by your proxy |
| Upstream scheme | **HTTP**, even though the browser uses HTTPS |
| Upstream address / port | The printed LXC address and app port (default 3000) |
| Headers | Preserve the browser's `Origin` and public `Host` |
| Path | Serve at `/`, not under `/chores` or another subpath |
| Live updates | Disable buffering/caching for `/api/events`; allow long-lived responses |

For Nginx-based proxies, `proxy_buffering off; proxy_cache off; proxy_read_timeout 1h;`
applies to the events route. Use your proxy's supported UI/configuration. Setting
`X-Forwarded-Proto` alone does not fix a browser-origin mismatch: this app validates
`Origin` against the saved public URL.

If the proxy is in another guest, allow its private source IP to reach the app port
in the Proxmox firewall and deny other sources. Preserve existing management and
outbound access rules. If the proxy is in this LXC, bind to loopback instead.
Do not forward the app's HTTP port directly from the Internet. The installer does
not edit your proxy, router, DNS account or Proxmox firewall.

The initial install can end with **App is running locally; public HTTPS setup still
needs attention** and exit 1 while you configure the proxy. This is an incomplete
public setup, not a successful public check. After connecting the proxy, run:

```bash
cd /opt/two-of-us-chores
bash install.sh --check https://YOUR-BROWSER-HOSTNAME
```

Both checks should report PASS. A check from inside the LXC may require split DNS
or hairpin routing to reach your public hostname. Also open that URL from your
phone/computer to verify its DNS and certificate trust.

## Fix “Cross-origin request rejected”

The login error now includes the HTTPS URL the running server expects. It must
match the browser's scheme, hostname and non-default port. Use the diagnostic
command above with the URL currently shown in your browser. It checks health and
submits an empty login request to test the origin protection without sending a
password, creating a session, or consuming password attempts.

To correct the URL or listening address:

```bash
cd /opt/two-of-us-chores
bash install.sh --configure
```

Accept the existing values you want to keep. This backs up existing data/config,
reruns the wizard and restarts the service. If configuration is already correct,
check that the proxy preserves `Origin` and points to this app instance. Keep
`ALLOW_INSECURE_LOCALHOST=false`; no CORS wildcard or disabled origin check is needed.
Changing the public hostname may require reinstalling the PWA and enabling push
again at the new origin.

## Update

After the guided installer is installed, use this command instead of `git pull`:

```bash
cd /opt/two-of-us-chores
bash install.sh --update
```

It rejects uncommitted/untracked changes and diverged branches, fetches the matching
remote branch, stops the app, and creates an integrity-checked recovery bundle
**before** changing the installed revision or dependencies. It then fast-forwards,
installs locked dependencies, restarts the service and runs the setup checks.
Updates retain settings without prompting. Root's Git credentials must allow fetch.

Each recovery directory is printed and contains `chores.db`, `app.env` and
`revision.txt`. By default it lives under
`/var/lib/two-of-us-chores/backups/before-update-*`. The bundle is private and
contains credentials and push keys. Copy important backups off the LXC to private
storage; monitor disk usage and remove old bundles only after verifying a newer
backup. A Proxmox backup is useful additional protection.

If you are upgrading an older installation that does not yet have `install.sh`,
first use its existing backup procedure (or take a stopped-LXC backup), then
fast-forward the checkout and run `bash install.sh`. Subsequent updates use the
command above so the installer can record the old revision before changing it.

An update failure can leave the service stopped. If only the public HTTPS check
failed, the local service remains running. Inspect the error before restarting or
restoring; do not blindly run old code against a newer database schema.

## Recovery and routine backup

Inspect service state and logs:

```bash
systemctl status two-of-us-chores --no-pager
journalctl -u two-of-us-chores -n 50 --no-pager
```

Create an online database backup at any time (run as the service user so backup
files stay accessible to it):

```bash
systemd-run --wait --pipe --collect --uid=chores \
  --property=EnvironmentFile=/etc/two-of-us-chores.env \
  --working-directory=/opt/two-of-us-chores \
  /usr/local/bin/node /opt/two-of-us-chores/src/backup.mjs
```

If the installer reused `/usr/bin/node`, use that path in manual commands too.
For recovery after a failed update, select the exact printed recovery directory.
These commands assume the default data paths; use the saved `DATABASE_PATH` for a
custom installation:

```bash
cd /opt/two-of-us-chores
RECOVERY='/var/lib/two-of-us-chores/backups/CHANGE_ME_RECOVERY_DIRECTORY'
cat "$RECOVERY/revision.txt"
node --input-type=module -e 'import { DatabaseSync } from "node:sqlite"; const db = new DatabaseSync(process.argv[1], { readOnly: true }); const rows = db.prepare("PRAGMA integrity_check").all(); db.close(); if (rows.length !== 1 || rows[0].integrity_check !== "ok") process.exit(1);' "$RECOVERY/chores.db"
systemctl stop two-of-us-chores
cp -a /var/lib/two-of-us-chores "/var/lib/two-of-us-chores.before-restore-$(date -u +%Y%m%dT%H%M%SZ)"
git switch --detach "$(cat "$RECOVERY/revision.txt")"
COREPACK_ENABLE_AUTO_PIN=0 corepack pnpm@11.16.0 install --frozen-lockfile --prod
install -o root -g root -m 0600 "$RECOVERY/app.env" /etc/two-of-us-chores.env
install -o chores -g chores -m 0600 "$RECOVERY/chores.db" /var/lib/two-of-us-chores/chores.db
rm -f /var/lib/two-of-us-chores/chores.db-wal /var/lib/two-of-us-chores/chores.db-shm
systemctl start two-of-us-chores
```

Preserve the service unit/drop-in if customized. If a later release changes the
unit, restore its matching unit and run `systemctl daemon-reload` before starting.
After recovery, verify health and your chores through the browser. The checkout is
detached deliberately; return to your deployment branch when ready to retry the
update, while keeping the recovery bundle.

## Optional: create the LXC from the Proxmox shell

The Proxmox UI is sufficient. If you prefer its shell, select a Debian 13 template
from `pveam available --section system`, a free container ID, and your actual
storage/network settings. On the **Proxmox host**, substitute the placeholders:

```bash
CT_ID='CHANGE_ME_UNUSED_ID'
TEMPLATE_STORAGE='CHANGE_ME_TEMPLATE_STORAGE'
ROOTFS_STORAGE='CHANGE_ME_ROOTFS_STORAGE'
DEBIAN_TEMPLATE='CHANGE_ME_DEBIAN_13_TEMPLATE'
BRIDGE='CHANGE_ME_BRIDGE'
LXC_CIDR='CHANGE_ME_PRIVATE_IPV4_AND_PREFIX'
GATEWAY='CHANGE_ME_GATEWAY'
pveam download "$TEMPLATE_STORAGE" "$DEBIAN_TEMPLATE"
pct create "$CT_ID" "$TEMPLATE_STORAGE:vztmpl/$DEBIAN_TEMPLATE" \
  --hostname two-of-us-chores --ostype debian --unprivileged 1 \
  --cores 1 --memory 512 --swap 256 --rootfs "$ROOTFS_STORAGE:8" \
  --net0 "name=eth0,bridge=$BRIDGE,ip=$LXC_CIDR,gw=$GATEWAY,firewall=1" --onboot 1
pct start "$CT_ID"
pct enter "$CT_ID"
```

Then follow Install above. Do not convert an existing container's privilege mode
or disable LXC security settings for this app.

## Verification scope

`pnpm test` includes temporary config/key-preservation tests, real HTTP origin/proxy
checks, recovery restoration, and installer orchestration with host/service/package
operations substituted. `bash tools/verify-lxc-install.sh` additionally exercises
the installer in a disposable Debian 13 systemd container using rootless Podman.
It never installs a service on the development host. This is not a Proxmox LXC test.

On your actual LXC, verify startup after reboot, login via the trusted HTTPS URL,
live changes in two browsers, and real push from app Settings. Install the PWA
before enabling push on iOS/iPadOS. See the README for the full device checklist.

References: [Node distributions](https://nodejs.org/dist/),
[Corepack usage](https://github.com/nodejs/corepack#usage),
[Proxmox containers](https://pve.proxmox.com/pve-docs/chapter-pct.html),
[systemd execution](https://www.freedesktop.org/software/systemd/man/latest/systemd.exec.html),
[Nginx proxy buffering](https://nginx.org/en/docs/http/ngx_http_proxy_module.html#proxy_buffering).
