# Chores 1.2 — accounts, groups and native notification repair

## Scope / plan

1. Migrate the SQLite schema (v6 -> v7) without changing existing IDs, password hashes,
   chores, history or undo snapshots. Replace fixed account constraints with usernames,
   administrator/active flags, groups and memberships.
2. Enforce active membership on every state, chore, history, live-event and notification
   read/mutation; recheck after asynchronous boundaries. No implicit global admin data access.
3. Provide terminal bootstrap for a custom first administrator and optional additional
   users/groups. Passwords go directly to password hashes in SQLite, not environment files.
4. Replace the public two-person selector with username/password login. Populate members,
   assignment and filters dynamically; add group switching and administrative account/group UI.
5. Repair Android bridge readiness and permission flow without weakening the site's CSP.
   Keep one notification UI owner, an Android settings action, and actual poll results.
6. Refresh launcher/site/notification assets and retain the name Chores, package identity
   and signing certificate. Test source, migration, HTTP isolation, rendered UI and Android.

## Upgrade

Run `cd /opt/two-of-us-chores && bash install.sh --update` on the LXC. The installer
backs up the database/config/revision before updating. Install the signed 1.2 APK over
1.1/1.1.1. Update the server before testing the APK.

Legacy Dylan and Mady passwords are preserved. Username login is `dylan` / `mady`;
all existing content is migrated into `Home`. For this legacy installation, Dylan is
the initial administrator; Mady remains a regular group member. New installations
have NO automatic Dylan/Mady accounts: terminal setup defines their administrator.
Administration can explicitly grant other administrators, but cannot remove/disable
the last active administrator. Do not expose a public unauthenticated setup wizard.

Fresh LXC installation runs `deploy/bootstrap.mjs` after infrastructure setup. Docker
users should bootstrap the persistent volume while the service is stopped, using:
`docker compose run --rm -v "$PWD/.env:/run/chores-setup.env:ro" chores node deploy/bootstrap.mjs /run/chores-setup.env`.
The config must reference paths inside the container. Keep the config read-only and
private; the database is the sole account store. A bootstrap interrupted before commit
creates no partial accounts. Existing accounts are never overwritten by setup.

## Administration and privacy

Admin creates users/groups in the Admin panel and adds/removes memberships. A user
can belong to multiple groups. Group members share management of that group's chores.
An admin manages identity and membership, not all chore content automatically. They
must explicitly add themselves to a group to see it; changes are audited. This is
application-level isolation, not protection from the server/database owner.

Reassign/remove a member's outstanding chores before removing their membership.
Disable accounts rather than deleting history. Group archival hides its contents and
stops scheduling. Removing membership filters out queued native notifications and
closes its live stream immediately. Already delivered OS notifications cannot be recalled
from other devices. Notification-time preferences are per user and interpreted in each
group's timezone. No public user/group directory is provided at login.

## Android notification contract

The native app's own service is `ChoresNotifications`. The exact same-origin
`/native-bridge.js` URL is intercepted inside the APK to load its bundled Capacitor
bridge as an external script; ordinary browsers receive a no-op. The CSP remains strict.
`getStatus` checks the real native plugin, configuration and Android permission. The UI
waits for bridge readiness, requests permission after authenticated app initialization,
and distinguishes denial, missing/outdated APK, expired registration and network errors.
Denials are respected; Android settings are opened rather than repeatedly requesting.
The `Send test` native route does not send a parallel Chrome Web Push test. Delivery is
reported only after the native worker actually posts a notification.

Background notifications still use WorkManager polling (minimum periodic interval 15
minutes, potentially longer under battery optimization), NOT FCM realtime push. No FCM
credentials were provided and no Firebase project was created. Browser Web Push remains
unchanged. No foreground-service/battery exemption is silently enabled.

## Verification record

- Automated Node 24 test suite: see workflow run for final counts.
- Added HTTP isolation, admin lifecycle, membership revocation, native queue and
  per-group timezone tests; bootstrapping tests exercise the real SQLite schema.
- Existing recurrence, completion/undo, backup, installer and security regressions retained.
- Android instrumentation covers a strict-CSP document, external bridge restoration,
  actual POST_NOTIFICATIONS dialog, granting permission and a native Chores notification.
- Browser smoke covers username login, chore assignment, administrator create-user/group.
- Local managed Chromium refused HTTP navigation with ERR_BLOCKED_BY_ADMINISTRATOR;
  rendered browser verification runs in the GitHub test environment instead.
- Review is self-review, not independent security certification. Target-phone and LXC
  observations remain required; an emulator/build result is not a claim about the phone.

Rollback: stop the service and restore the pre-update code AND SQLite backup together.
Never point an older binary at schema v7 and assume downgrade is supported.
