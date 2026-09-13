(() => {
  "use strict";

  const selector = 'meta[name="theme-color"]';
  const systemTheme = window.matchMedia("(prefers-color-scheme: dark)");

  function syncThemeColor() {
    const styles = getComputedStyle(document.documentElement);
    const color = styles.getPropertyValue("--canvas").trim() || styles.backgroundColor.trim();
    if (!color) return;

    let meta = document.querySelector(selector);
    if (!meta) {
      meta = document.createElement("meta");
      meta.name = "theme-color";
      document.head.append(meta);
    }
    meta.content = color;

    document.querySelectorAll(selector).forEach((candidate) => {
      if (candidate !== meta) candidate.remove();
    });
  }

  syncThemeColor();
  systemTheme.addEventListener?.("change", syncThemeColor);
  new MutationObserver(syncThemeColor).observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-theme"],
  });
})();
