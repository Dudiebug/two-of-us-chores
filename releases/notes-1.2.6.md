# Chores 1.2.6

Mobile popup sizing hotfix.

- Audited every app dialog on phone layouts.
- Add Chore, Edit Chore, Settings, Delete Confirmation, and Admin now all use the same Settings mobile height.
- Sheets stop below the top safe area, keeping the X reachable.
- Long edit/settings/admin content scrolls inside the popup instead of pushing the sheet higher.
- Desktop dialog sizing is unchanged.
- No database, group, notification, or user-color behavior changes.

Update the LXC first: `cd /opt/two-of-us-chores && bash install.sh --update`.
Then install `chores-1.2.6.apk` over the existing Android app. No uninstall is required.
