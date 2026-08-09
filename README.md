# Two of Us Chores

Two-user chore app for Dylan and Mady. It is one Node 24 process backed by SQLite, with server-sent events for live refresh and optional Web Push notifications.

## Run locally

```sh
cp .env.example .env
# For local-only development, set APP_ORIGIN=http://localhost:3000 and
# ALLOW_INSECURE_LOCALHOST=true in .env.
corepack enable
corepack prepare pnpm@11.16.0 --activate
pnpm install --frozen-lockfile
pnpm start
```

Open the configured `APP_ORIGIN`. `pnpm test` runs the automated suite, including the HTTP integration test. The local backup command uses the configured `DATABASE_PATH` (or `DATA_DIR/chores.db`) and writes to the optional path passed after `--`:

```sh
pnpm run backup -- ./backups/chores-$(date -u +%Y%m%dT%H%M%SZ).db
```

## Docker deployment

1. Copy `.env.example` to `.env` and replace both initial passwords with unique 10-200 character secrets.
2. Set `APP_ORIGIN` to the exact public HTTPS origin, including a non-default port if one is used. Keep `ALLOW_INSECURE_LOCALHOST=false`.
3. Start the single service:

```sh
docker compose up -d --build
docker compose ps
curl -fsS http://127.0.0.1:3000/healthz
```

The image runs as the built-in `node` user, installs dependencies with Corepack and the committed `pnpm-lock.yaml`, drops all Linux capabilities, enables `no-new-privileges`, and keeps the root filesystem read-only. Only the named `chore-data` volume is writable at `/data`. The container port is fixed at 3000 and Compose binds it to loopback so an existing Caddy, Nginx Proxy Manager, Traefik, or equivalent HTTPS proxy can forward to `127.0.0.1:3000`; configure that proxy for long-lived SSE responses without buffering. Do not expose the HTTP port directly to the Internet.

The Compose resource settings are one CPU and a 256 MB memory ceiling. They are limits, not a usage claim. Verify the real footprint during idle and active use with `docker stats "$(docker compose ps -q chores)"`.

## Environment

| Variable | Purpose |
| --- | --- |
| `APP_ORIGIN` | Exact browser origin; HTTPS is required outside explicit localhost development. |
| `DYLAN_PASSWORD`, `MADY_PASSWORD` | First-run credentials only; changing `.env` later does not overwrite existing hashes. |
| `HOUSEHOLD_TIMEZONE` | IANA timezone used for dates and notification times; defaults to `America/Chicago`. |
| `DATA_DIR`, `DATABASE_PATH` | Persistent SQLite location; Docker defaults to `/data/chores.db`. |
| `BACKUP_DIR` | Default backup directory; Docker defaults to `/data/backups`. |
| `VAPID_SUBJECT`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` | Optional Web Push configuration. Set all three or leave all three empty. |
| `ALLOW_INSECURE_LOCALHOST` | `true` only for local HTTP development. |

VAPID keys can be generated after dependencies are installed with `pnpm exec web-push generate-vapid-keys`. Push still requires HTTPS and, on iOS/iPadOS, an installed Home Screen PWA.

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
