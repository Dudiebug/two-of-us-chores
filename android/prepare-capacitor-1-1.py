from pathlib import Path


def replace_once(path, old, new):
    p = Path(path)
    text = p.read_text()
    if new in text:
        return
    if old not in text:
        raise SystemExit(f"Unable to find expected anchor in {path}: {old[:80]!r}")
    p.write_text(text.replace(old, new, 1))


# Database schema: native devices are tied to authenticated sessions. Notification
# events are shared per user and each native device tracks its own cursor.
replace_once("src/db.mjs", "const SCHEMA_VERSION = 5;", "const SCHEMA_VERSION = 6;")
replace_once(
    "src/db.mjs",
    '''    CREATE TABLE IF NOT EXISTS notification_markers (\n      marker_key TEXT PRIMARY KEY,\n      sent_at TEXT NOT NULL\n    ) STRICT;\n''',
    '''    CREATE TABLE IF NOT EXISTS notification_markers (\n      marker_key TEXT PRIMARY KEY,\n      sent_at TEXT NOT NULL\n    ) STRICT;\n    CREATE TABLE IF NOT EXISTS native_devices (\n      token_hash TEXT PRIMARY KEY,\n      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,\n      session_hash TEXT NOT NULL REFERENCES sessions(token_hash) ON DELETE CASCADE,\n      device_id TEXT NOT NULL,\n      created_at TEXT NOT NULL,\n      updated_at TEXT NOT NULL,\n      UNIQUE(user_id,device_id)\n    ) STRICT;\n    CREATE TABLE IF NOT EXISTS native_notification_events (\n      id INTEGER PRIMARY KEY AUTOINCREMENT,\n      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,\n      title TEXT NOT NULL,\n      body TEXT NOT NULL,\n      url TEXT NOT NULL DEFAULT '/app',\n      tag TEXT,\n      created_at TEXT NOT NULL\n    ) STRICT;\n''',
)
replace_once(
    "src/db.mjs",
    '''    CREATE INDEX IF NOT EXISTS subscriptions_user ON push_subscriptions(user_id);\n    PRAGMA user_version=${SCHEMA_VERSION};\n''',
    '''    CREATE INDEX IF NOT EXISTS subscriptions_user ON push_subscriptions(user_id);\n    CREATE INDEX IF NOT EXISTS native_devices_user ON native_devices(user_id);\n    CREATE INDEX IF NOT EXISTS native_events_user_id ON native_notification_events(user_id,id);\n    PRAGMA user_version=${SCHEMA_VERSION};\n''',
)

# Serve the native bridge as an authenticated app asset.
replace_once(
    "src/server.mjs",
    'const PRIVATE_FILES = new Set(["/app.js", "/calendar-recurrence.js", "/styles.css"]);',
    'const PRIVATE_FILES = new Set(["/app.js", "/calendar-recurrence.js", "/styles.css", "/native-app.js"]);',
)

# Fan every notification out to both Web Push and the native polling queue. The
# scheduler considers a native queue delivery successful even if there is no web
# subscription, preventing repeated enqueueing every minute.
replace_once(
    "src/server.mjs",
    '''  const send = push.send.bind(push);\n  const notify = (actorId, title, body, key) => activityNotification(db, send, actorId, title, body, key);\n''',
    '''  const sendWebPush = push.send.bind(push);\n  const send = async (userId, title, body, options = {}) => {\n    const queued = queueNativeNotification(db, userId, title, body, options);\n    const delivered = await sendWebPush(userId, title, body, options);\n    return queued || delivered;\n  };\n  const notify = (actorId, title, body, key) => activityNotification(db, send, actorId, title, body, key);\n''',
)

# Native background polling authenticates with a device bearer token, so this route
# is handled before the normal cookie-session gate.
replace_once(
    "src/server.mjs",
    '''      if (req.method === "POST" && path === "/api/session") return await login(req, res, db, localInsecure, throttle);\n\n      const session = authenticate(req, db);\n''',
    '''      if (req.method === "POST" && path === "/api/session") return await login(req, res, db, localInsecure, throttle);\n      if (req.method === "GET" && path === "/api/native-notifications") return nativeNotifications(req, res, db, url);\n\n      const session = authenticate(req, db);\n''',
)
replace_once(
    "src/server.mjs",
    '''      if (req.method === "GET" && path === "/api/events") return events(req, res, session, clients);\n      if (req.method === "GET" && path === "/api/push-key") {\n''',
    '''      if (req.method === "GET" && path === "/api/events") return events(req, res, session, clients);\n      if (req.method === "POST" && path === "/api/native-device") return registerNativeDevice(req, res, db, session);\n      if (req.method === "DELETE" && path === "/api/native-device") return removeNativeDevice(req, res, db, session);\n      if (req.method === "GET" && path === "/api/push-key") {\n''',
)

# Add native device registration, queueing, and poll helpers immediately before the
# existing Web Push subscription handler.
server = Path("src/server.mjs")
server_text = server.read_text()
anchor = "async function putSubscription(req, res, db, session) {"
helpers = r'''function validNativeDeviceId(value) {
  return typeof value === "string" && /^[A-Za-z0-9._:-]{8,128}$/.test(value);
}

async function registerNativeDevice(req, res, db, session) {
  const body = await readJson(req);
  const deviceId = body?.deviceId;
  if (!validNativeDeviceId(deviceId)) throw bad("Invalid native device ID");
  const issued = newSession();
  const now = new Date().toISOString();
  transaction(db, () => {
    db.prepare("DELETE FROM native_devices WHERE user_id=? AND device_id=?").run(session.userId, deviceId);
    db.prepare(`INSERT INTO native_devices(token_hash,user_id,session_hash,device_id,created_at,updated_at)
      VALUES (?,?,?,?,?,?)`).run(issued.hash, session.userId, session.tokenHash, deviceId, now, now);
  });
  const cursor = Number(db.prepare("SELECT COALESCE(MAX(id),0) AS id FROM native_notification_events WHERE user_id=?").get(session.userId).id || 0);
  return json(res, 200, { token: issued.token, cursor });
}

async function removeNativeDevice(req, res, db, session) {
  const body = await readJson(req);
  if (!validNativeDeviceId(body?.deviceId)) throw bad("Invalid native device ID");
  db.prepare("DELETE FROM native_devices WHERE user_id=? AND device_id=? AND session_hash=?")
    .run(session.userId, body.deviceId, session.tokenHash);
  return noContent(res);
}

function nativeNotifications(req, res, db, url) {
  const match = /^Bearer\s+([A-Za-z0-9_-]{20,256})$/i.exec(req.headers.authorization || "");
  if (!match) return json(res, 401, { error: "Native device authentication required" });
  const device = db.prepare("SELECT token_hash,user_id FROM native_devices WHERE token_hash=?").get(tokenHash(match[1]));
  if (!device) return json(res, 401, { error: "Native device token expired" });
  const rawAfter = url.searchParams.get("after") || "0";
  if (!/^\d{1,18}$/.test(rawAfter)) throw bad("Invalid notification cursor");
  const after = Number(rawAfter);
  if (!Number.isSafeInteger(after) || after < 0) throw bad("Invalid notification cursor");
  const events = db.prepare(`SELECT id,title,body,url,tag,created_at AS createdAt
    FROM native_notification_events WHERE user_id=? AND id>? ORDER BY id LIMIT 100`).all(device.user_id, after);
  const cursor = events.length ? Number(events[events.length - 1].id) : after;
  db.prepare("UPDATE native_devices SET updated_at=? WHERE token_hash=?").run(new Date().toISOString(), device.token_hash);
  return json(res, 200, { events, cursor });
}

function queueNativeNotification(db, userId, title, body, options = {}) {
  if (!db.prepare("SELECT 1 FROM native_devices WHERE user_id=? LIMIT 1").get(userId)) return false;
  const now = new Date().toISOString();
  db.prepare(`INSERT INTO native_notification_events(user_id,title,body,url,tag,created_at)
    VALUES (?,?,?,?,?,?)`).run(userId, String(title), String(body), options.url || "/app", options.tag || null, now);
  // Native clients use a cursor. A one-week retention bound prevents an abandoned
  // device from growing this table forever while still tolerating long offline gaps.
  const cutoff = new Date(Date.now() - 7 * 86400_000).toISOString();
  db.prepare("DELETE FROM native_notification_events WHERE created_at<?").run(cutoff);
  return true;
}

'''
if "function validNativeDeviceId(value)" not in server_text:
    if anchor not in server_text:
        raise SystemExit("Unable to find push subscription handler anchor")
    server.write_text(server_text.replace(anchor, helpers + anchor, 1))

# Load the native bridge before the normal application module. It is inert in
# ordinary browsers and only takes over notification controls inside Capacitor.
replace_once(
    "public/index.html",
    '''    <script src="/login.js" defer></script>\n    <script src="/app.js?v=12" type="module"></script>\n''',
    '''    <script src="/login.js" defer></script>\n    <script src="/native-app.js?v=1.1.0" defer></script>\n    <script src="/app.js?v=12" type="module"></script>\n''',
)

Path("public/native-app.js").write_text(r'''(() => {
  "use strict";

  const LABEL = "net.dudiebug.chores.notifications";
  const ENABLED_KEY = "two-of-us-native-notifications";
  const DEVICE_KEY = "two-of-us-native-device-id";
  const isNative = () => window.Capacitor?.getPlatform?.() === "android" || /TwoOfUsCapacitor\/1\.1/.test(navigator.userAgent);
  if (!isNative()) return;

  const runner = () => window.Capacitor?.Plugins?.BackgroundRunner;
  const node = (selector) => document.querySelector(selector);
  const enabled = () => localStorage.getItem(ENABLED_KEY) === "1";

  function deviceId() {
    let value = localStorage.getItem(DEVICE_KEY);
    if (!value) {
      value = crypto.randomUUID ? crypto.randomUUID() : `android-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      localStorage.setItem(DEVICE_KEY, value);
    }
    return value;
  }

  async function jsonRequest(path, options = {}) {
    const response = await fetch(path, {
      credentials: "same-origin",
      ...options,
      headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    });
    const text = await response.text();
    const body = text ? JSON.parse(text) : null;
    if (!response.ok) throw new Error(body?.error || `Request failed (${response.status})`);
    return body;
  }

  async function dispatch(event, details = {}) {
    const plugin = runner();
    if (!plugin?.dispatchEvent) throw new Error("Native notification service is unavailable.");
    return plugin.dispatchEvent({ label: LABEL, event, details });
  }

  async function permissionStatus(request = false) {
    const plugin = runner();
    if (!plugin) return "denied";
    let status = await plugin.checkPermissions();
    if (request && ["prompt", "prompt-with-rationale"].includes(status?.notifications)) {
      status = await plugin.requestPermissions({ apis: ["notifications"] });
    }
    return status?.notifications || "denied";
  }

  async function enableNative() {
    if (await permissionStatus(true) !== "granted") throw new Error("Notifications are blocked in Android settings.");
    const data = await jsonRequest("/api/native-device", {
      method: "POST",
      body: JSON.stringify({ deviceId: deviceId() }),
    });
    await dispatch("configure", { enabled: true, token: data.token, cursor: data.cursor });
    localStorage.setItem(ENABLED_KEY, "1");
    await dispatch("poll");
  }

  async function disableNative() {
    try {
      await jsonRequest("/api/native-device", {
        method: "DELETE",
        body: JSON.stringify({ deviceId: deviceId() }),
      });
    } finally {
      localStorage.removeItem(ENABLED_KEY);
      await dispatch("configure", { enabled: false }).catch(() => {});
    }
  }

  async function refreshUi(message = null) {
    const status = node("#pushStatus");
    const button = node("#pushButton");
    const test = node("#pushTestButton");
    const hint = node("#iosPushHint");
    if (!status || !button || !test) return;
    if (hint) hint.hidden = true;
    const permission = await permissionStatus(false).catch(() => "denied");
    if (!runner()) {
      status.textContent = "Native notification service is unavailable.";
      button.disabled = true;
      test.hidden = true;
      return;
    }
    if (permission === "denied") {
      status.textContent = "Notifications are blocked in Android settings.";
      button.textContent = "Enable notifications";
      button.disabled = false;
      test.hidden = true;
      return;
    }
    if (enabled()) {
      status.textContent = message || "Native notifications are enabled for Two of Us Chores.";
      button.textContent = "Disable notifications";
      button.disabled = false;
      test.hidden = false;
    } else {
      status.textContent = message || "Native notifications are ready to enable.";
      button.textContent = "Enable notifications";
      button.disabled = false;
      test.hidden = true;
    }
  }

  async function toggleNative() {
    const button = node("#pushButton");
    if (button) button.disabled = true;
    try {
      if (enabled()) {
        await disableNative();
        await refreshUi("Native notifications disabled on this device.");
      } else {
        await enableNative();
        await refreshUi("Native notifications enabled for Two of Us Chores.");
      }
    } catch (error) {
      await refreshUi(error.message);
    }
  }

  async function testNative() {
    const button = node("#pushTestButton");
    if (button) button.disabled = true;
    try {
      if (!enabled()) await enableNative();
      await jsonRequest("/api/push-test", { method: "POST", body: "{}" });
      await dispatch("poll");
      await refreshUi("Test notification sent from Two of Us Chores.");
    } catch (error) {
      await refreshUi(error.message);
    } finally {
      if (button) button.disabled = false;
    }
  }

  document.addEventListener("click", (event) => {
    const target = event.target.closest?.("button");
    if (!target) return;
    if (target.id === "settingsButton") {
      setTimeout(() => refreshUi(), 0);
      return;
    }
    if (target.id === "pushButton") {
      event.preventDefault();
      event.stopImmediatePropagation();
      toggleNative();
      return;
    }
    if (target.id === "pushTestButton") {
      event.preventDefault();
      event.stopImmediatePropagation();
      testNative();
    }
  }, true);

  window.addEventListener("load", () => {
    if (enabled()) dispatch("poll").catch(() => {});
  });
})();
''')

Path("test/native-notifications.test.mjs").write_text(r'''import assert from "node:assert/strict";
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
''')

Path("docs/ANDROID_CAPACITOR.md").write_text('''# Android Capacitor app\n\nRelease 1.1 replaces the Chrome-backed Trusted Web Activity with a Capacitor Android\ncontainer. The UI still loads from `https://chores.dudiebug.net`, but rendering happens\nin the app WebView rather than a Chrome TWA. Notifications are posted by the native\nTwo of Us Chores package.\n\nBecause no Firebase project is required, native background delivery uses Capacitor\nBackground Runner. The server queues notification events and the app polls them in a\nnative background task. Android enforces a minimum periodic interval of about 15 minutes\nand may delay work further under battery optimization. Opening the app and the in-app\nnotification test dispatch a poll immediately.\n\nBrowser clients keep the existing VAPID Web Push path.\n''')
