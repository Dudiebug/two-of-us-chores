# Android Capacitor app

Release 1.1 replaces the Chrome-backed Trusted Web Activity with a Capacitor Android
container. The UI still loads from `https://chores.dudiebug.net`, but rendering happens
in the app WebView rather than a Chrome TWA. Notifications are posted by the native
Two of Us Chores package.

Because no Firebase project is required, native background delivery uses Capacitor
Background Runner. The server queues notification events and the app polls them in a
native background task. Android enforces a minimum periodic interval of about 15 minutes
and may delay work further under battery optimization. Opening the app and the in-app
notification test dispatch a poll immediately.

Browser clients keep the existing VAPID Web Push path.
