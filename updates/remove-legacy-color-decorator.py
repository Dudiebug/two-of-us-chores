from pathlib import Path
import re
p = Path('public/admin.js')
s = p.read_text()
s = s.replace('  let colorMap = new Map();\n  let colorRefreshTimer = 0;\n', '', 1)
pattern = re.compile(r'''\n  function applyUserColors\(\) \{.*?\n  \}\n\n  function scheduleColorRefresh\(\) \{.*?\n  \}\n\n  async function refreshColors\(\) \{.*?\n  \}\n\n  new MutationObserver\(applyUserColors\)\.observe\(document\.body, \{ childList: true, subtree: true \}\);\n''', re.S)
s, count = pattern.subn('\n', s, count=1)
assert count == 1
old = '''  document.addEventListener("change", (event) => {
    if (event.target.matches("#groupSelect")) scheduleColorRefresh();
    if (event.target.matches('#adminDialog select[name="colorKey"]')) {
      const swatch = event.target.closest("label")?.querySelector(".user-color-swatch");
      if (swatch) swatch.dataset.userColor = normalizeColor(event.target.value);
    }
  });
  window.addEventListener("chores-admin-changed", scheduleColorRefresh);
  window.addEventListener("popstate", scheduleColorRefresh);
  installCreateUserColorField();
  scheduleColorRefresh();
'''
new = '''  document.addEventListener("change", (event) => {
    if (event.target.matches('#adminDialog select[name="colorKey"]')) {
      const swatch = event.target.closest("label")?.querySelector(".user-color-swatch");
      if (swatch) swatch.dataset.userColor = normalizeColor(event.target.value);
    }
  });
  installCreateUserColorField();
'''
assert old in s
s = s.replace(old, new, 1)
p.write_text(s)
print('Removed the obsolete page-wide admin color decorator')
