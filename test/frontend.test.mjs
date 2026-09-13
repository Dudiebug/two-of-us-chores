import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const extractAttribute = (tag, name) => tag.match(new RegExp(`\\b${name}=["']([^"']+)["']`))?.[1];

test("authenticated UI is a dashboard with Today, Calendar, and History tools", async () => {
  const [html, script, styles, serviceWorker, loginHtml, loginScript] = await Promise.all([
    readFile(new URL("../public/index.html", import.meta.url), "utf8"),
    readFile(new URL("../public/app.js", import.meta.url), "utf8"),
    readFile(new URL("../public/styles.css", import.meta.url), "utf8"),
    readFile(new URL("../public/sw.js", import.meta.url), "utf8"),
    readFile(new URL("../public/login.html", import.meta.url), "utf8"),
    readFile(new URL("../public/login.js", import.meta.url), "utf8"),
  ]);

  assert.match(html, /<div class="view-tabs" role="tablist" aria-label="Chore views">/);
  const tabTags = [...html.matchAll(/<button\b[^>]*\brole="tab"[^>]*>/g)].map(([tag]) => tag);
  assert.deepEqual(tabTags.map((tag) => extractAttribute(tag, "data-view")), ["today", "calendar", "history"]);
  assert.deepEqual(tabTags.map((tag) => extractAttribute(tag, "aria-controls")), ["todayPanel", "calendarPanel", "historyPanel"]);
  const panelTags = [...html.matchAll(/<section\b[^>]*\brole="tabpanel"[^>]*>/g)].map(([tag]) => tag);
  assert.deepEqual(panelTags.map((tag) => extractAttribute(tag, "id")), ["todayPanel", "calendarPanel", "historyPanel"]);
  assert.deepEqual(panelTags.map((tag) => extractAttribute(tag, "aria-labelledby")), ["todayTab", "calendarTab", "historyTab"]);
  assert.match(html, /id="calendarWeek"[^>]+role="list"/);
  assert.match(html, /id="calendarAgenda"/);
  assert.match(html, /id="calendarMonth" type="month"/);
  assert.match(script, /function todayChores\(\)/);
  assert.match(script, /function renderCalendar\(\)/);
  assert.match(script, /history:\s*\[\]/);
  assert.match(script, /state\.history\s*=\s*Array\.isArray\(data\?\.history\)\s*\?\s*data\.history\s*:\s*\[\]/);
  assert.match(script, /function filteredHistory\(\)/);
  assert.match(script, /function renderHistory\(\)/);
  assert.match(script, /state\.view\s*===\s*["']history["']\s*\)\s*renderHistory\(\)/);
  assert.match(script, /\$\("#historyGroups"\)\.innerHTML\s*=/);
  assert.match(script, /state\.calendarDays/);
  assert.match(script, /function agendaEntryMarkup\(entry\)/);
  assert.match(script, /data-calendar-date/);
  assert.doesNotMatch(html + script, /feedback-carousel|rhythm-pin|marquee-track|ScrollTrigger/);
  assert.match(styles, /\.chore-row, \.history-row \{[^}]+var\(--owner-d-bg\)/);
  assert.match(styles, /\.chore-row\[data-owner="M"\][^}]+var\(--owner-m-bg\)/);
  assert.match(script, /Assigned to \$/);
  assert.match(script, /class="check-button" type="checkbox"/);
  assert.match(html, /id="toastUndo"/);
  assert.match(script, /data-action="undo"/);
  assert.match(loginHtml, /id="togglePassword"/);
  assert.doesNotMatch(loginHtml, /Your chores stay hidden/);

  const expectedThemes = ["system", "light", "dark", "blush"];
  const themeInputs = [...html.matchAll(/<input\b[^>]*>/g)].map(([tag]) => tag).filter((tag) => extractAttribute(tag, "name") === "theme");
  assert.deepEqual(themeInputs.map((tag) => extractAttribute(tag, "value")), expectedThemes);
  const themePreviews = [...html.matchAll(/<span\b[^>]*\bdata-theme-preview="([^"]+)"[^>]*>/g)].map(([, value]) => value);
  assert.deepEqual(themePreviews, expectedThemes);

  const themeSet = script.match(/const themes = new Set\(\[([^\]]+)\]\)/)?.[1];
  assert.ok(themeSet, "app.js should define the supported theme values");
  assert.deepEqual([...themeSet.matchAll(/["']([^"']+)["']/g)].map(([, value]) => value), expectedThemes);

  const explicitThemes = expectedThemes.slice(1);
  const cssThemes = [...styles.matchAll(/:root\[data-theme="([^"]+)"\]\s*\{/g)].map(([, value]) => value);
  assert.deepEqual([...new Set(cssThemes)].sort(), [...explicitThemes].sort());
  for (const theme of explicitThemes) assert.match(styles, new RegExp(`:root\\[data-theme="${theme}"\\]\\s*\\{`));

  const scheduleSelect = html.match(/<select\b[^>]*\bname="scheduleKind"[^>]*>([\s\S]*?)<\/select>/)?.[1];
  assert.ok(scheduleSelect, "the chore form should expose recurrence choices");
  const recurrenceKinds = [...scheduleSelect.matchAll(/<option\b[^>]*>/g)].map(([tag]) => extractAttribute(tag, "value"));
  const expectedRecurrenceKinds = ["once", "daily", "every", "weekly", "monthly"];
  assert.deepEqual(recurrenceKinds, expectedRecurrenceKinds);
  for (const kind of expectedRecurrenceKinds) {
    assert.match(script, new RegExp(`(?:scheduleKind|kind)\\s*===\\s*["']${kind}["']`));
  }
  assert.match(script, /const recurring = kind !== "once"/);
  assert.match(script, /\$\("#weekdayPicker"\)\.hidden = kind !== "weekly"/);

  const appScriptTag = [...html.matchAll(/<script\b[^>]*>/gi)].map(([tag]) => tag).find((tag) => extractAttribute(tag, "src") === "/app.js?v=12");
  assert.ok(appScriptTag, "index.html should load app.js");
  assert.equal(extractAttribute(appScriptTag, "type"), "module");
  assert.match(script, /import\s*\{\s*occurrencesInRange\s*\}\s*from\s*["']\.\/calendar-recurrence\.js["']/);
  assert.match(script, /occurrencesInRange\s*\(\s*chore\s*,\s*selected\s*,\s*end\s*\)/);
  const agendaMarkup = script.slice(script.indexOf("function agendaEntryMarkup"), script.indexOf("function safeDateLabel"));
  assert.match(agendaMarkup, /const projected = occurrenceDate !== chore\.nextDue/);
  assert.match(agendaMarkup, /calendar-repeat/);
  assert.match(agendaMarkup, /completionCheckbox\(chore\)/);
  assert.match(agendaMarkup, /data-action="edit"/);
  assert.match(styles, /\.calendar-agenda\s*\{[^}]+padding/);
  assert.match(styles, /\.calendar-day-button\s*\{[^}]+min-height/);

  assert.match(script, /navigator\.serviceWorker\.register\(\s*["']\/sw\.js["']\s*\)/);
  assert.doesNotMatch(serviceWorker, /cache\.addAll|caches\.match|app\.js/);
  assert.match(serviceWorker, /data:\s*\{ url: payload\.url \}/);
  assert.match(serviceWorker, /new URL\(event\.notification\.data\?\.url \|\| "\/app"/);
  assert.match(loginHtml, /id="loginForm"/);
  assert.match(loginScript, /location\.replace\("\/app"\)/);
});
