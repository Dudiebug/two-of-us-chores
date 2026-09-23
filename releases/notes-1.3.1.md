# Chores 1.3.1

Android-only FCM registration hotfix for existing Chores installations.

- Existing 1.2/1.3 Android installs now refresh their Firebase Cloud Messaging token whenever the native immediate-check path runs.
- The refreshed token is staged before the existing native poll, which synchronizes it through the existing `/api/native-notifications/token` endpoint.
- If Firebase token retrieval is temporarily unavailable, the existing authenticated polling fallback still runs.
- No Chores server code, API, database, or web UI changes are included in 1.3.1.
- Package remains `net.dudiebug.chores`.
- Version is 1.3.1 / version code 12.
- Signed with the same replacement Android signing identity as Chores 1.2.6 and 1.3.0.

The Chores server must already have the Firebase service-account configuration required by 1.3.0. Install `chores-1.3.1.apk` directly over 1.3.0, then open Chores once so the configured notification path refreshes and synchronizes the FCM token.
