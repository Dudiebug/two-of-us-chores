(() => {
  "use strict";

  // Shared browser-shell behavior. This file is loaded by both login and app pages.
  const themeMetaSelector = 'meta[name="theme-color"]';
  const systemTheme = window.matchMedia("(prefers-color-scheme: dark)");

  function syncThemeColor() {
    const styles = getComputedStyle(document.documentElement);
    const color = styles.getPropertyValue("--canvas").trim() || styles.backgroundColor.trim();
    if (!color) return;

    let meta = document.querySelector(themeMetaSelector);
    if (!meta) {
      meta = document.createElement("meta");
      meta.name = "theme-color";
      document.head.append(meta);
    }
    meta.content = color;
    document.querySelectorAll(themeMetaSelector).forEach((candidate) => {
      if (candidate !== meta) candidate.remove();
    });
  }

  syncThemeColor();
  systemTheme.addEventListener?.("change", syncThemeColor);
  new MutationObserver(syncThemeColor).observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-theme"],
  });

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  }

  const form = document.querySelector("#loginForm");
  if (!form) return;

  const error = document.querySelector("#loginError");
  const password = document.querySelector("#loginPassword");
  document.querySelector("#togglePassword").addEventListener("click", (event) => {
    const visible = password.type === "password";
    password.type = visible ? "text" : "password";
    event.currentTarget.textContent = visible ? "Hide" : "Show";
    event.currentTarget.setAttribute("aria-label", visible ? "Hide password" : "Show password");
    event.currentTarget.setAttribute("aria-pressed", String(visible));
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    error.hidden = true;
    if (!form.reportValidity()) return;
    const button = form.querySelector("button[type=submit]");
    button.disabled = true;
    try {
      const response = await fetch("/api/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ userId: document.querySelector("#loginUser").value, password: document.querySelector("#loginPassword").value }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || "Unable to sign in");
      document.querySelector("#loginPassword").value = "";
      location.replace("/app");
    } catch (requestError) {
      error.textContent = requestError.message;
      error.hidden = false;
    } finally {
      button.disabled = false;
    }
  });
})();
