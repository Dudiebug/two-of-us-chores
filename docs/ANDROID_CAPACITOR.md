# Android Capacitor app

Release 1.1 replaces the Chrome-backed Trusted Web Activity with a Capacitor Android
container. The UI still loads from `https://chores.dudiebug.net`, but rendering happens
in the app WebView rather than a Chrome TWA. Notifications are posted by the native
Two of Us Chores package.

Release 1.3 adds Firebase Cloud Messaging for immediate Android delivery. The native
app registers its Firebase token with the authenticated Chores server, receives
high-priority data messages, and posts the notification itself. Token rotation is
updated with the device's separate bearer credential.

The existing native notification queue and WorkManager poll remain as the delivery
fallback. Android's periodic-work minimum is about 15 minutes and battery optimization
can delay it further. FCM-delivered event IDs are retained until the poll cursor catches
up, so the fallback does not alert twice for the same event. Opening the app and the
in-app notification test still dispatch a poll immediately.

Browser clients keep the existing VAPID Web Push path.
