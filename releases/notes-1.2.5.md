# Chores 1.2.5

Self-service color update fix.

- Forces browsers and the Android WebView to load the current application module containing the Settings color-save handler.
- Verifies a non-admin can save their own color through Settings.
- Verifies the request payload and response, `/api/state`, visible UI update, and persistence after reload.

Update the LXC first: `cd /opt/two-of-us-chores && bash install.sh --update`.
Then install the signed `chores-1.2.5.apk` over the existing Android app. No uninstall is required.
