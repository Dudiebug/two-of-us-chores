# Two of Us Chores

Two-user chore app for Dylan and Mady. It is one Node 24 process backed by SQLite, with server-sent events for live refresh and optional Web Push notifications.

**Deploy on Proxmox:** follow the [native LXC setup guide](docs/PROXMOX.md).
It includes container creation, Node installation, systemd, your existing HTTPS
proxy, push keys, and copyable backup/update/restore commands. Docker is optional.

## How to use

1. Open your HTTPS app URL, choose Dylan or Mady, and enter that person's password.
2. On **Today**, use **+** to add a chore. Choose its owner, due date, repeat schedule,
   and reminder. Tap the arrow on a chore to edit it; removal is inside the edit form.
3. Tick its square checkbox when finished. A one-time chore leaves the active list;
   a repeating chore advances to its next due date. **Undo** is available in the
   completion message and eligible History entries.
4. In **Calendar**, select a date, move between weeks, jump to a month, or return to
   Today. **Show more days** extends the agenda. Everyone/Dylan/Mady filters work
   across views. Future projected repeats are previews, not independently completable chores.
5. **History** shows who completed each chore and when. An Undo button disappears
   when the chore has changed since that completion.
6. Open the gear for **Settings**: choose System/Light/Dark/Pink, install the app,
   configure notifications, change your password, or sign out.

Schedules support Once, Daily, Every N days, selected weekdays, and Monthly.
For weekly chores, include the due date's weekday. Monthly chores retain their
day-of-month anchor and use the last day in shorter months. Late schedules shift
forward according to the household date; notification times use the household timezone.

To receive push, the server needs VAPID configuration and a trusted HTTPS URL.
Install through the browser menu; on iPhone/iPad, add to the Home Screen and open
the installed app first. In Settings, select **Enable push**, allow permission,
then **Send test**. Choose daily digest, missed-chore alert, default reminder times,
and whether the other person's changes should notify you. Enable each device
separately. Signing out removes that session's push subscription.

Offline, previously loaded chores remain visible and changes are disabled until
reconnection. Private app assets/data are not cached for an offline cold start.

## B Agenda interface and Undo

The mobile interface uses owner-tinted agenda cards, square completion checkboxes,
bottom navigation, and a floating add button. Settings holds theme, notification,
installation, password, and sign-out controls. Today remains the initial view.

Undo appears for ten seconds after completion (paused while hovered or focused)
and remains in History while that completion is eligible. Either household member
can restore a chore, including its previous schedule and reminders. Editing,
deleting, completing again, or automatic schedule rollover ends eligibility.
Undo does not recall an already delivered notification.

Schema version 5 migrates existing data on startup, preserves IDs, prevents their
reuse, and stores private restoration snapshots for new completions. Older history
remains visible without Undo. Before deploying this version, take the normal
database backup described below. To roll back deployment, restore that backup
alongside the previous application version; do not run old code against the
migrated database.

`POST /api/chores/:id/complete` now also returns `completionId`.
`GET /api/state` history entries include `canUndo`, never the private snapshot.
`POST /api/history/:id/undo` accepts an empty JSON object and returns 204 on success
or 409 when no longer eligible; the existing authentication/origin rules apply.

For rendered UI verification, `tools/verify-ui.mjs` uses an existing Playwright
installation, an isolated in-memory app, and a temporary Chromium browser. Set
`PLAYWRIGHT_MODULE` to that installation's `index.mjs` and, if needed,
`PLAYWRIGHT_BROWSERS_PATH` to its browser directory, then run
`node tools/verify-ui.mjs`. Screenshots are written to `design/verification/`.
No browser automation dependency is added to the production app.

## Run locally

Install Node 24 first. The container example uses `/data`; for local development,
edit the copied `.env` to use `APP_ORIGIN=http://localhost:3000`,
`ALLOW_INSECURE_LOCALHOST=true`, `LISTEN_HOST=127.0.0.1`, `DATA_DIR=./data`,
`DATABASE_PATH=./data/chores.db`, and `BACKUP_DIR=./backups`. Replace both initial
passwords. Leave the three VAPID settings empty if you do not need local push.

```sh
git clone https://github.com/Dudiebug/two-of-us-chores.git
cd two-of-us-chores
cp .env.example .env
chmod 600 .env
nano .env
corepack enable
corepack prepare pnpm@11.16.0 --activate
pnpm install --frozen-lockfile
node --env-file=.env src/server.mjs
```

Open the configured `APP_ORIGIN`. `pnpm start` expects environment variables already
provided by Docker/systemd/the shell; it does not automatically read `.env`.
`pnpm test` runs the automated suite, including the HTTP integration test.
In another terminal in the same directory, create a local backup with:

```sh
node --env-file=.env src/backup.mjs "./backups/chores-$(date -u +%Y%m%dT%H%M%SZ).db"
```

## Docker deployment

1. Copy `.env.example` to `.env` and replace both initial passwords with unique 10-200 character secrets.
2. Set `APP_ORIGIN` to the exact public HTTPS origin, including a non-default port if one is used. Set `HOUSEHOLD_TIMEZONE=America/Los_Angeles` and keep `ALLOW_INSECURE_LOCALHOST=false`.
3. Start the single service:

```sh
docker compose up -d --build
docker compose ps
curl -fsS http://127.0.0.1:3000/healthz
```

The image runs as the built-in `node` user, installs dependencies with Corepack and the committed `pnpm-lock.yaml`, drops all Linux capabilities, enables `no-new-privileges`, and keeps the root filesystem read-only. Only the named `chore-data` volume is writable at `/data`. The container port is fixed at 3000. Compose binds it to loopback by default, allowing Caddy, Nginx Proxy Manager, Traefik, or an equivalent HTTPS proxy on the same guest to forward to `127.0.0.1:3000`. If the proxy runs in another guest, set `BIND_ADDRESS` to this LXC's private IP and firewall port 3000 so only the proxy can reach it. Configure the proxy for long-lived SSE responses without buffering. Do not expose the HTTP port directly to the Internet.

The Compose resource settings are one CPU and a 256 MB memory ceiling. They are limits, not a usage claim. Verify the real footprint during idle and active use with `docker stats "$(docker compose ps -q chores)"`.

## Environment

| Variable | Purpose |
| --- | --- |
| `APP_ORIGIN` | Exact browser origin; HTTPS is required outside explicit localhost development. |
| `BIND_ADDRESS` | `127.0.0.1` for a same-host proxy; the LXC's private IP for a separate proxy guest. |
| `LISTEN_HOST` | Node listening interface: defaults to `0.0.0.0` for Docker compatibility; use the LXC private IP for a separate proxy, or `127.0.0.1` for same-host access. `BIND_ADDRESS` only controls Docker's published port. |
| `DYLAN_PASSWORD`, `MADY_PASSWORD` | First-run credentials only; changing `.env` later does not overwrite existing hashes. |
| `HOUSEHOLD_TIMEZONE` | IANA timezone used for dates and notification times; defaults to `America/Los_Angeles`. |
| `DATA_DIR`, `DATABASE_PATH` | Persistent SQLite location; Docker defaults to `/data/chores.db`. |
| `BACKUP_DIR` | Default backup directory; Docker defaults to `/data/backups`. |
| `VAPID_SUBJECT`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` | Optional Web Push configuration. Set all three or leave all three empty. |
| `ALLOW_INSECURE_LOCALHOST` | `true` only for local HTTP development. |

VAPID keys can be generated after dependencies are installed with `pnpm exec web-push generate-vapid-keys`. Push still requires HTTPS and, on iOS/iPadOS, an installed Home Screen PWA.

## Proxmox LXC deployment

Use the [native Node/systemd LXC guide](docs/PROXMOX.md) for the lightweight setup.
The checked-in [service unit](deploy/two-of-us-chores.service) and
[LXC environment template](deploy/lxc.env.example) match its commands. This approach
does not need Docker nesting or a privileged LXC.

Point the existing HTTPS reverse proxy at port 3000 as described above. The public hostname must exactly match `APP_ORIGIN`; Web Push and service workers do not work over ordinary HTTP. The LXC also needs outbound HTTPS access to browser push services. Keep the VAPID private key and `.env` out of backups that are shared or published.

After opening the public URL, sign in, install the app from the browser menu, enable push in Settings, and use **Send test**. On iPhone and iPad, add the site to the Home Screen before enabling push. The sign-in page is public, but the app document, styles, JavaScript, recurrence module, and chore data are served only to authenticated sessions.

## Online backup, restore, and integrity check

`pnpm run backup` uses Node's SQLite online backup API, so it can run while the service is serving requests. Store the resulting file outside the only copy of the Docker volume when possible:

```sh
docker compose exec chores pnpm run backup -- /data/backups/chores-$(date -u +%Y%m%dT%H%M%SZ).db
docker compose exec chores node --input-type=module -e 'import { DatabaseSync } from "node:sqlite"; const db = new DatabaseSync(process.argv[1], { readOnly: true }); console.log(db.prepare("PRAGMA integrity_check").get()); db.close();' /data/backups/chores-20260807T120000Z.db
```

Replace the example timestamp in the integrity command with the backup just created. A healthy result contains `integrity_check: 'ok'`.

Restore only a validated backup. Stop the service first, preserve the current database, replace the main file, remove stale SQLite sidecars, then start and check health:

```sh
docker compose stop chores
docker compose run --rm --no-deps chores sh -c 'cp /data/chores.db /data/chores.db.before-restore && cp /data/backups/chores-20260807T120000Z.db /data/chores.db && rm -f /data/chores.db-wal /data/chores.db-shm'
docker compose up -d chores
curl -fsS http://127.0.0.1:3000/healthz
```

Replace the example backup name. The `.before-restore` copy is a local rollback aid; keep an independent backup before restoring. Never use `docker compose down -v` during routine redeploys because `-v` deletes the persistent named volume.

## Proxmox snapshot notes

An online SQLite backup is the application-level backup and should be copied off the Docker host. A Proxmox snapshot is an additional rollback point, not a substitute for that backup. For a Docker installation inside a Proxmox LXC, snapshot the container's underlying storage; for a VM, snapshot the VM storage that contains Docker's data-root and the named volume. Quiesce the app first when practical:

```sh
docker compose stop chores
# On the Proxmox host, use the matching storage command, for example:
pct snapshot <CTID> chores-before-maintenance --description "SQLite app stopped"
# or, for a VM:
qm snapshot <VMID> chores-before-maintenance --description "SQLite app stopped"
docker compose start chores
```

The `pct`/`qm` command must be run on the Proxmox host with the correct ID and storage policy. Snapshot retention, replication, and rollback procedures are Proxmox-specific; test a restore before relying on one.

## Verification

Automated checks:

```sh
corepack enable
corepack prepare pnpm@11.16.0 --activate
pnpm install --frozen-lockfile
pnpm test
docker compose config
docker compose build
```

The integration test exercises the HTTP API: health, fixed-user login, cookie flags, origin enforcement, input rejection, two authenticated sessions, SSE change delivery, stale-revision conflict handling, one-time completion, recurring completion, and deletion. It does not prove browser rendering, one-second latency, PWA installation, push delivery, or device behavior. `docker compose build` checks the pnpm frozen install and requires the frontend worker's `public/` files to be present.

Exact manual checks on a deployed build:

- In two authenticated browser sessions, create, edit, complete, and delete a chore. Confirm the second session updates within one second.
- Disconnect the browser, confirm the offline banner and disabled writes, reconnect, and confirm a state refetch.
- Exercise loading, empty, validation, server-error, light, dark, keyboard-only, mobile, desktop, and reduced-motion states.
- Install the PWA in Chromium and Safari on macOS. On an available iPhone or iPad, add it to the Home Screen before testing push permission and notification clicks.
- Recreate the container with `docker compose up -d --build --force-recreate` and confirm existing chores remain in `/data`.
- Create a backup, run `PRAGMA integrity_check`, restore it after stopping the service, and confirm health plus the restored chore data.
- Observe idle and active CPU and memory with `docker stats --no-stream "$(docker compose ps -q chores)"`; record measured values instead of assuming the Compose ceilings are actual usage.
