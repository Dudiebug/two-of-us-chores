# Chores 1.2.4

Mobile UI and user-color hotfix.

- Settings and Admin now use a shorter, safe-area-aware mobile sheet so the close button stays reachable.
- Their content scrolls inside the sheet while the header remains reachable.
- The New Chore dialog keeps its existing sizing.
- Fixes the user palette stylesheet not being served by the authenticated app.
- User colors now render directly on person filters, chore/history cards, calendar dots, and the selected assignee control.
- Keeps the single-group picker cleanup from 1.2.3.

Update the LXC first: `cd /opt/two-of-us-chores && bash install.sh --update`.
Then install `chores-1.2.4.apk` over the existing Android app. No uninstall is required.
