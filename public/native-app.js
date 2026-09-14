(() => {
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
