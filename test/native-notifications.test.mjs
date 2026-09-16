import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("Capacitor native notifications have a separate authenticated delivery path", async () => {
  const [db, server, fcm, html, bridge, plugin, worker, firebaseService, buildScript, capacitorConfig, firebaseConfig] = await Promise.all([
    readFile(new URL("../src/db.mjs", import.meta.url), "utf8"),
    readFile(new URL("../src/server.mjs", import.meta.url), "utf8"),
    readFile(new URL("../src/fcm.mjs", import.meta.url), "utf8"),
    readFile(new URL("../public/index.html", import.meta.url), "utf8"),
    readFile(new URL("../public/native-app.js", import.meta.url), "utf8"),
    readFile(new URL("../android/native/ChoresNotificationsPlugin.java", import.meta.url), "utf8"),
    readFile(new URL("../android/native/ChoresNotificationWorker.java", import.meta.url), "utf8"),
    readFile(new URL("../android/native/ChoresFirebaseMessagingService.java", import.meta.url), "utf8"),
    readFile(new URL("../android/build-1.3.sh", import.meta.url), "utf8"),
    readFile(new URL("../android/capacitor/capacitor.config.json", import.meta.url), "utf8"),
    readFile(new URL("../android/firebase/google-services.json", import.meta.url), "utf8"),
  ]);
  const config = JSON.parse(capacitorConfig);
  assert.match(db, /CREATE TABLE IF NOT EXISTS native_devices/);
  assert.match(db, /CREATE TABLE IF NOT EXISTS native_notification_events/);
  assert.match(db, /fcm_token TEXT/);
  assert.match(server, /path === "\/api\/native-notifications"/);
  assert.match(server, /path === "\/api\/native-device"/);
  assert.match(server, /queueNativeNotification/);
  assert.match(server, /return queued \|\| delivered/);
  assert.match(server, /\/api\/native-notifications\/token/);
  assert.match(fcm, /fcm\.googleapis\.com\/v1\/projects/);
  assert.match(fcm, /priority: "HIGH"/);
  assert.match(html, /native-app\.js\?v=1\.3\.0/);
  assert.match(bridge, /ChoresNotifications/);
  assert.match(bridge, /requestPermissions\(\)/);
  assert.match(bridge, /initialize:/);
  assert.match(bridge, /\/api\/native-device/);
  assert.match(bridge, /\/api\/native-test/);
  assert.match(bridge, /getFirebaseToken\(\)/);
  assert.match(plugin, /@CapacitorPlugin/);
  assert.match(plugin, /name = "ChoresNotifications"/);
  assert.match(plugin, /Manifest\.permission\.POST_NOTIFICATIONS/);
  assert.match(plugin, /requestPermissionForAlias\("notifications"/);
  assert.match(plugin, /void configure\(PluginCall call\)/);
  assert.match(plugin, /void pollNow\(PluginCall call\)/);
  assert.match(plugin, /FirebaseMessaging\.getInstance\(\)\.getToken\(\)/);
  assert.match(worker, /class ChoresNotificationWorker extends Worker/);
  assert.match(worker, /\/api\/native-notifications\?after=/);
  assert.match(worker, /NotificationCompat\.Builder/);
  assert.match(worker, /consumeDelivered/);
  assert.match(worker, /\/api\/native-notifications\/token/);
  assert.match(firebaseService, /extends FirebaseMessagingService/);
  assert.match(firebaseService, /rememberDelivered/);
  assert.match(buildScript, /ChoresFirebaseMessagingService/);
  assert.match(buildScript, /androidx\.work:work-runtime:2\.11\.2/);
  assert.match(buildScript, /com\.google\.firebase:firebase-messaging/);
  assert.match(buildScript, /versionCode 11/);
  assert.match(buildScript, /versionName \"1\.3\.0\"/);
  assert.equal(config.appName, "Chores");
  assert.equal(config.appId, "net.dudiebug.chores");
  assert.equal(JSON.parse(firebaseConfig).client[0].client_info.android_client_info.package_name, "net.dudiebug.chores");
  assert.doesNotMatch(firebaseConfig, /private_key|client_email/);
});
