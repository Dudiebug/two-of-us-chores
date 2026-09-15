from pathlib import Path

# Backend: user color is a normal authenticated preference, not admin-only.
p = Path('src/server.mjs')
s = p.read_text()
anchor = 'import { newSession, parseCookies, passwordHash, passwordMatches, sessionCookie, SESSION_COOKIE, tokenHash } from "./security.mjs";\n'
addition = anchor + 'import { validateUserColor } from "./user-colors.mjs";\n'
if 'import { validateUserColor } from "./user-colors.mjs";' not in s:
    assert anchor in s
    s = s.replace(anchor, addition, 1)
old = '''async function updateSettings(req, res, db, userId, changed) {
  const body = await readJson(req);
  if (!isRecord(body)) throw bad("Settings must be an object");
  const keys = ["digestTime", "missedAlertTime", "defaultReminderTime"];
  if (!keys.some((key) => Object.prototype.hasOwnProperty.call(body, key)) && !Object.prototype.hasOwnProperty.call(body, "activityNotifications")) throw bad("No settings supplied");
  if (Object.prototype.hasOwnProperty.call(body, "activityNotifications") && typeof body.activityNotifications !== "boolean") throw bad("Activity notification preference must be true or false");
  const current = db.prepare("SELECT digest_time,missed_alert_time,default_reminder_time,activity_notifications FROM users WHERE id=?").get(userId);
  const currentValues = [current.digest_time, current.missed_alert_time, current.default_reminder_time];
  const values = keys.map((key, index) => {
    if (!Object.prototype.hasOwnProperty.call(body, key)) return currentValues[index];
    if (body[key] !== null && (typeof body[key] !== "string" || !TIME.test(body[key]))) throw bad("Times must use HH:MM");
    return body[key];
  });
  db.prepare(`UPDATE users SET digest_time=?,missed_alert_time=?,default_reminder_time=?,activity_notifications=?,updated_at=? WHERE id=?`)
    .run(...values, Object.prototype.hasOwnProperty.call(body, "activityNotifications") ? Number(body.activityNotifications) : current.activity_notifications, new Date().toISOString(), userId);
  changed(userId);
  return noContent(res);
}
'''
new = '''async function updateSettings(req, res, db, userId, changed) {
  const body = await readJson(req);
  if (!isRecord(body)) throw bad("Settings must be an object");
  const keys = ["digestTime", "missedAlertTime", "defaultReminderTime"];
  const hasActivity = Object.prototype.hasOwnProperty.call(body, "activityNotifications");
  const hasColor = Object.prototype.hasOwnProperty.call(body, "colorKey");
  if (!keys.some((key) => Object.prototype.hasOwnProperty.call(body, key)) && !hasActivity && !hasColor) throw bad("No settings supplied");
  if (hasActivity && typeof body.activityNotifications !== "boolean") throw bad("Activity notification preference must be true or false");
  const current = db.prepare("SELECT digest_time,missed_alert_time,default_reminder_time,activity_notifications,color_key FROM users WHERE id=?").get(userId);
  const currentValues = [current.digest_time, current.missed_alert_time, current.default_reminder_time];
  const values = keys.map((key, index) => {
    if (!Object.prototype.hasOwnProperty.call(body, key)) return currentValues[index];
    if (body[key] !== null && (typeof body[key] !== "string" || !TIME.test(body[key]))) throw bad("Times must use HH:MM");
    return body[key];
  });
  const colorKey = hasColor ? validateUserColor(body.colorKey) : current.color_key;
  const colorChanged = colorKey !== current.color_key;
  db.prepare(`UPDATE users SET digest_time=?,missed_alert_time=?,default_reminder_time=?,activity_notifications=?,color_key=?,updated_at=? WHERE id=?`)
    .run(...values, hasActivity ? Number(body.activityNotifications) : current.activity_notifications, colorKey, new Date().toISOString(), userId);
  // Notification times are private to this user. A color is visible to every group
  // member, so notify all connected clients when it changes.
  if (colorChanged) changed(); else changed(userId);
  return noContent(res);
}
'''
assert old in s
s = s.replace(old, new, 1)
p.write_text(s)

# Settings UI: put the six theme-safe colors under the user's own preferences.
p = Path('public/index.html')
s = p.read_text()
s = s.replace('<link rel="stylesheet" href="/user-colors.css?v=1.2.4">', '<link rel="stylesheet" href="/user-colors.css?v=1.2.4" data-user-colors>', 1)
anchor = '''          <section class="settings-section" aria-labelledby="pushTitle">
'''
color_form = '''          <form id="userColorForm" class="settings-section" novalidate>
            <div><h3 id="userColorTitle">Your color</h3><p class="field-hint">Used for your name, assigned chores, calendar dots, and history. This preference follows your account on every device.</p></div>
            <div class="self-color-options" id="userColorOptions" role="radiogroup" aria-labelledby="userColorTitle">
              <label><input type="radio" name="userColor" value="teal"><span class="self-color-choice" data-user-color="teal"><i aria-hidden="true"></i><strong>Teal</strong></span></label>
              <label><input type="radio" name="userColor" value="rose"><span class="self-color-choice" data-user-color="rose"><i aria-hidden="true"></i><strong>Rose</strong></span></label>
              <label><input type="radio" name="userColor" value="blue"><span class="self-color-choice" data-user-color="blue"><i aria-hidden="true"></i><strong>Blue</strong></span></label>
              <label><input type="radio" name="userColor" value="violet"><span class="self-color-choice" data-user-color="violet"><i aria-hidden="true"></i><strong>Violet</strong></span></label>
              <label><input type="radio" name="userColor" value="amber"><span class="self-color-choice" data-user-color="amber"><i aria-hidden="true"></i><strong>Amber</strong></span></label>
              <label><input type="radio" name="userColor" value="green"><span class="self-color-choice" data-user-color="green"><i aria-hidden="true"></i><strong>Green</strong></span></label>
            </div>
            <p class="form-message" id="userColorError" role="alert" hidden></p>
            <div class="inline-actions"><button class="button button-secondary" type="submit">Save color</button><span class="success-text" id="userColorSuccess" hidden>Saved.</span></div>
          </form>
'''
if 'id="userColorForm"' not in s:
    assert anchor in s
    s = s.replace(anchor, color_form + anchor, 1)
p.write_text(s)

# Normal app settings behavior.
p = Path('public/app.js')
s = p.read_text()
old = '''  function fillSettings() {
    const settings = state.user || {};
    $("#signedInAs").textContent = `Signed in as ${settings.name || ownerName(settings.id)}`;
    applyTheme(state.theme, { save: false });
    setTimeSetting("digest", settings.digestTime);
'''
new = '''  function fillSettings() {
    const settings = state.user || {};
    $("#signedInAs").textContent = `Signed in as ${settings.name || ownerName(settings.id)}`;
    applyTheme(state.theme, { save: false });
    const colorKey = userColors.has(settings.colorKey) ? settings.colorKey : "teal";
    const colorInput = $(`#userColorOptions input[value="${colorKey}"]`);
    if (colorInput) colorInput.checked = true;
    setTimeSetting("digest", settings.digestTime);
'''
assert old in s
s = s.replace(old, new, 1)
anchor = '''  async function saveSettings(event) {
'''
handler = '''  async function saveUserColor(event) {
    event.preventDefault();
    if (!state.online || !state.user) { showToast("Reconnect before changing your color.", "error"); return; }
    const errorNode = $("#userColorError");
    errorNode.hidden = true;
    const colorKey = $("#userColorOptions input[name=userColor]:checked")?.value;
    if (!userColors.has(colorKey)) { errorNode.textContent = "Choose one of the available colors."; errorNode.hidden = false; return; }
    try {
      await jsonRequest("/api/settings", "PATCH", { colorKey });
      state.user = { ...state.user, colorKey };
      state.users = state.users.map((user) => user.id === state.user.id ? { ...user, colorKey } : user);
      render();
      $("#userColorSuccess").hidden = false;
      window.setTimeout(() => { $("#userColorSuccess").hidden = true; }, 2400);
      showToast("Color updated.");
    } catch (requestError) { errorNode.textContent = requestError.message; errorNode.hidden = false; }
  }

'''
if 'async function saveUserColor(event)' not in s:
    assert anchor in s
    s = s.replace(anchor, handler + anchor, 1)
old = '    $("#settingsForm").addEventListener("submit", saveSettings);\n'
new = '    $("#userColorForm").addEventListener("submit", saveUserColor);\n' + old
assert old in s
s = s.replace(old, new, 1)
p.write_text(s)

# Theme-safe visual radio choices.
p = Path('public/user-colors.css')
s = p.read_text()
if '.self-color-options {' not in s:
    s += '''
.self-color-options { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:.6rem; }
.self-color-options label { position:relative; min-width:0; }
.self-color-options input { position:absolute; opacity:0; width:1px; height:1px; }
.self-color-choice { min-height:46px; display:flex; align-items:center; justify-content:center; gap:.45rem; padding:.55rem .65rem; border:1px solid var(--line); border-radius:12px; background:var(--user-bg); color:var(--user-ink); cursor:pointer; }
.self-color-choice i { width:14px; height:14px; border-radius:50%; background:var(--user-dot); flex:none; }
.self-color-options input:checked + .self-color-choice { border-color:var(--user-dot); box-shadow:0 0 0 2px var(--user-dot); }
.self-color-options input:focus-visible + .self-color-choice { outline:2px solid var(--focus); outline-offset:2px; }
@media (max-width:480px) { .self-color-options { grid-template-columns:repeat(2,minmax(0,1fr)); } }
'''
p.write_text(s)

# Extend the existing rendered-phone test to prove a non-admin-gated settings control changes the live UI.
p = Path('tools/browser-smoke-1.2.4.py')
s = p.read_text()
anchor = '''        for trigger, dialog, close in [
'''
probe = '''        page.locator('#settingsButton').click()
        page.locator('#settingsDialog').wait_for(state='visible')
        page.locator('#userColorOptions input[value="green"]').check()
        page.locator('#userColorForm button[type=submit]').click()
        page.locator('#userColorSuccess').wait_for(state='visible')
        assert page.locator('.filter-button[data-filter="D"]').get_attribute('data-user-color') == 'green'
        assert page.locator('.filter-button[data-filter="D"]').evaluate('(el) => getComputedStyle(el).backgroundColor') != dylan_bg
        page.locator('#closeSettingsButton').click()
        page.locator('#settingsDialog').wait_for(state='hidden')

'''
if "#userColorOptions input[value=\"green\"]" not in s:
    assert anchor in s
    s = s.replace(anchor, probe + anchor, 1)
p.write_text(s)

print('Applied Chores 1.2.4 self-service user color setting')
