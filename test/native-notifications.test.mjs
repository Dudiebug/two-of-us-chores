import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("Capacitor native notifications have a separate authenticated delivery path", async () => {
  const [db, server, html, bridge, plugin, worker, buildScript, capacitorConfig] = await Promise.all([
    readFile(new URL("../src/db.mjs", import.meta.url), "utf8"),
    readFile(new URL("../src/server.mjs", import.meta.url), "utf8"),
    readFile(new URL("../public/index.html", import.meta.url), "utf8"),
    readFile(new URL("../public/native-app.js", import.meta.url), "utf8"),
    readFile(new URL("../android/native/ChoresNotificationsPlugin.java", import.meta.url), "utf8"),
    readFile(new URL("../android/native/ChoresNotificationWorker.java", import.meta.url), "utf8"),
    readFile(new URL("../android/build-capacitor-1-1-1.sh", import.meta.url), "utf8"),
    readFile(new URL("../android/capacitor/capacitor.config.json", import.meta.url), "utf8"),
  ]);
  const config = JSON.parse(capacitorConfig);
  assert.match(db, /CREATE TABLE IF NOT EXISTS native_devices/);
  assert.match(db, /CREATE TABLE IF NOT EXISTS native_notification_events/);
  assert.match(server, /path === "\/api\/native-notifications"/);
  assert.match(server, /path === "\/api\/native-device"/);
  assert.match(server, /queueNativeNotification/);
  assert.match(server, /return queued \|\| delivered/);
  assert.match(html, /native-app\.js\?v=1\.1\.0/);
  assert.match(bridge, /ChoresNotifications/);
  assert.match(bridge, /requestPermissions\(\{ apis: \["notifications"\] \}\)/);
  assert.match(bridge, /requestInitialPermissionOnce/);
  assert.match(bridge, /\/api\/native-device/);
  assert.match(bridge, /\/api\/push-test/);
  assert.match(plugin, /@CapacitorPlugin/);
  assert.match(plugin, /name = "ChoresNotifications"/);
  assert.match(plugin, /Manifest\.permission\.POST_NOTIFICATIONS/);
  assert.match(plugin, /requestPermissionForAlias\("notifications"/);
  assert.match(plugin, /void configure\(PluginCall call\)/);
  assert.match(plugin, /void pollNow\(PluginCall call\)/);
  assert.match(worker, /class ChoresNotificationWorker extends Worker/);
  assert.match(worker, /\/api\/native-notifications\?after=/);
  assert.match(worker, /NotificationCompat\.Builder/);
  assert.match(buildScript, /registerPlugin\(ChoresNotificationsPlugin\.class\)/);
  assert.match(buildScript, /androidx\.work:work-runtime:2\.11\.2/);
  assert.equal(config.appName, "Chores");
  assert.equal(config.appId, "net.dudiebug.chores");
});
