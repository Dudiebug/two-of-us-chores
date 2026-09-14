const API = "https://chores.dudiebug.net";
const TOKEN_KEY = "native-notifications-token";
const CURSOR_KEY = "native-notifications-cursor";

function getValue(key, fallback = "") {
  try { return CapacitorKV.get(key)?.value || fallback; } catch { return fallback; }
}

function setValue(key, value) {
  try { CapacitorKV.set(key, String(value)); } catch {}
}

function clearValue(key) {
  try { CapacitorKV.remove(key); } catch {}
}

async function poll(resolve, reject) {
  const token = getValue(TOKEN_KEY);
  if (!token) { resolve({ count: 0, disabled: true }); return; }
  const cursor = Number(getValue(CURSOR_KEY, "0")) || 0;
  try {
    const response = await fetch(`${API}/api/native-notifications?after=${cursor}`, {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
    });
    if (response.status === 401) {
      clearValue(TOKEN_KEY);
      clearValue(CURSOR_KEY);
      resolve({ count: 0, expired: true });
      return;
    }
    if (!response.ok) throw new Error(`Notification poll failed (${response.status})`);
    const payload = await response.json();
    const events = Array.isArray(payload?.events) ? payload.events : [];
    if (events.length) {
      CapacitorNotifications.schedule(events.map((event) => ({
        id: Number(event.id % 2147483000),
        title: event.title,
        body: event.body,
        group: "two-of-us-chores",
        autoCancel: true,
        extra: { url: event.url || "/app", eventId: event.id },
      })));
    }
    setValue(CURSOR_KEY, Number(payload?.cursor ?? cursor));
    resolve({ count: events.length });
  } catch (error) {
    reject(error?.message || String(error));
  }
}

addEventListener("configure", (resolve, reject, args) => {
  try {
    if (!args?.enabled) {
      clearValue(TOKEN_KEY);
      clearValue(CURSOR_KEY);
      resolve({ enabled: false });
      return;
    }
    if (typeof args.token !== "string" || !args.token) throw new Error("Missing native notification token");
    setValue(TOKEN_KEY, args.token);
    setValue(CURSOR_KEY, Number(args.cursor || 0));
    resolve({ enabled: true });
  } catch (error) {
    reject(error?.message || String(error));
  }
});

addEventListener("poll", poll);
addEventListener("nativeNotificationsPoll", poll);
