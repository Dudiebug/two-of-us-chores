(() => {
  "use strict";
  const native = () => window.Capacitor?.getPlatform?.() === "android" || /(?:TwoOfUs|Chores)Capacitor\//.test(navigator.userAgent);
  if (!native()) return;
  const $ = (s) => document.querySelector(s);
  const deviceKey = "two-of-us-native-device-id";
  let pluginPromise;
  let busy = false;
  function plugin() {
    return pluginPromise ||= new Promise((resolve, reject) => {
      const start = Date.now();
      const find = () => {
        const cap = window.Capacitor;
        const existing = cap?.Plugins?.ChoresNotifications;
        if (existing?.getStatus) { resolve(existing); return; }
        if (cap?.PluginHeaders?.some((p) => p.name === "ChoresNotifications" && p.methods?.some((m) => m.name === "getStatus")) && cap.registerPlugin) {
          resolve(cap.registerPlugin("ChoresNotifications")); return;
        }
        if (Date.now() - start > 5000) { pluginPromise = null; reject(new Error("Android bridge unavailable. Install Chores 1.2 and update the server, then tap Retry.")); return; }
        setTimeout(find, 100);
      }; find();
    });
  }
  function deviceId() {
    let id = localStorage.getItem(deviceKey);
    if (!id) { id = crypto.randomUUID(); localStorage.setItem(deviceKey, id); } return id;
  }
  async function request(path, method, body) {
    const r = await fetch(path, { method, credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const text = await r.text(); let value; try { value = text ? JSON.parse(text) : {}; } catch { throw new Error("Update the Chores server; the notification endpoint returned an invalid response."); }
    if (!r.ok) throw new Error(value.error || `Server returned ${r.status}`); return value;
  }
  async function refresh(text) {
    if (!$("#pushStatus")) return;
    $("#iosPushHint").hidden = true; $("#pushTestButton").hidden = true;
    try {
      const p = await plugin(); const s = await p.getStatus();
      $("#pushStatus").textContent = text || (s.notifications === "denied" ? "Notifications are blocked in Android settings." : s.configured ? `Native notifications enabled.${s.lastError ? ` ${s.lastError}.` : ""} Background checks may be delayed.` : "Allow notifications to receive chore reminders from Chores.");
      $("#pushButton").textContent = s.notifications === "denied" ? "Open Android settings" : s.configured ? "Disable notifications" : "Enable notifications";
      $("#pushTestButton").hidden = !s.configured || s.notifications !== "granted";
    } catch (e) { $("#pushStatus").textContent = e.message; $("#pushButton").textContent = "Retry"; }
    $("#pushButton").disabled = busy; $("#pushTestButton").disabled = busy;
  }
  async function enable() {
    const p = await plugin(); let s = await p.getStatus();
    if (s.notifications === "denied") { await p.openSettings(); return; }
    if (s.notifications !== "granted") s = await p.requestPermissions();
    if (s.notifications !== "granted") throw new Error("Notification permission was not granted. Enable it in Android settings to receive reminders.");
    const data = await request("/api/native-device", "POST", { deviceId: deviceId() });
    try { await p.configure({ token: data.token, cursor: data.cursor }); }
    catch (error) { await request("/api/native-device", "DELETE", { deviceId: deviceId() }).catch(() => {}); throw error; }
    localStorage.removeItem("two-of-us-native-notifications");
  }
  async function disable() {
    const p = await plugin(); await p.disable();
    await request("/api/native-device", "DELETE", { deviceId: deviceId() });
  }
  async function operation(fn) {
    if (busy) return; busy = true;
    try { await fn(); busy = false; await refresh(); }
    catch (e) { busy = false; await refresh(e.message); }
  }
  window.ChoresNative = {
    refresh, disable,
    initialize: () => operation(async () => {
      const p = await plugin(); const s = await p.getStatus();
      // An OS denial is respected; no persistent JS flag is set before a prompt succeeds.
      if (s.notifications === "prompt") await enable();
      else if (s.configured) await p.pollNow();
    }),
    toggle: () => operation(async () => {
      const p = await plugin(); const s = await p.getStatus();
      if (s.notifications === "denied") await p.openSettings(); else if (s.configured) await disable(); else await enable();
    }),
    test: () => operation(async () => {
      const p = await plugin(); let s = await p.getStatus();
      if (!s.configured) await enable();
      await request("/api/native-test", "POST", { deviceId: deviceId() });
      const result = await p.pollNow();
      if (result.expired) throw new Error("Notification registration expired. Disable and enable notifications again.");
      if (result.blocked) throw new Error("Android is blocking Chores notifications. Check the app's notification settings.");
      if (!(result.posted > 0)) throw new Error("No notification was received from the server. Check the server version and your registration.");
    }),
  };
  document.addEventListener("visibilitychange", () => { if (!document.hidden && !busy) refresh(); });
})();
