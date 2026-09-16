# Chores 1.2.6

Mobile popup-height hotfix.

- Add Chore, Edit Chore, Settings, Admin, and confirmation sheets now share the same mobile height.
- Dialog headers and close buttons remain reachable below the safe-area gap.
- Long dialog content scrolls inside the body while headers and bottom actions remain visible.
- Desktop dialog behavior is unchanged.

The previous Android signing key could not be recovered, so this APK starts a replacement signing identity with certificate SHA-256:

`f959bb255ce581d5f6222b6828b0446872b597f68009259c5d9798544c8eb59c`

Android cannot install this APK over Chores 1.2.5 or earlier. Update the server first:

`cd /opt/two-of-us-chores && bash install.sh --update`

Then uninstall the existing Chores Android app and install `chores-1.2.6.apk`. Server-side chore, account, and history data remain on the Chores server; local sign-in and notification settings must be configured again after installation.

Package: `net.dudiebug.chores`

Version: `1.2.6` / version code `10`

App label: `Chores`
