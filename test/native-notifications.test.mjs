import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("Capacitor native notifications have a separate authenticated delivery path", async () => {
  const [db, server, html, bridge, runner] = await Promise.all([
    readFile(new URL("../src/db.mjs", import.meta.url), "utf8"),
    readFile(new URL("../src/server.mjs", import.meta.url), "utf8"),
    readFile(new URL("../public/index.html", import.meta.url), "utf8"),
    readFile(new URL("../public/native-app.js", import.meta.url), "utf8"),
    readFile(new URL("../android/capacitor/www/runners/notifications.js", import.meta.url), "utf8"),
  ]);
  assert.match(db, /CREATE TABLE IF NOT EXISTS native_devices/);
  assert.match(db, /CREATE TABLE IF NOT EXISTS native_notification_events/);
  assert.match(server, /path === "\/api\/native-notifications"/);
  assert.match(server, /path === "\/api\/native-device"/);
  assert.match(server, /queueNativeNotification/);
  assert.match(server, /return queued \|\| delivered/);
  assert.match(html, /native-app\.js\?v=1\.1\.0/);
  assert.match(bridge, /BackgroundRunner/);
  assert.match(bridge, /\/api\/native-device/);
  assert.match(bridge, /\/api\/push-test/);
  assert.match(runner, /CapacitorNotifications\.schedule/);
  assert.match(runner, /Authorization/);
  assert.match(runner, /\/api\/native-notifications\?after=/);
});
