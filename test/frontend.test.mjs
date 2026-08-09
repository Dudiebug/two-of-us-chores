import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const extractAttribute = (tag, name) => tag.match(new RegExp(`\\b${name}=["']([^"']+)["']`))?.[1];

test("authenticated UI is a dashboard with Today, Calendar, and History tools", async () => {
  const [html, script, styles, serviceWorker] = await Promise.all([
    readFile(new URL("../public/index.html", import.meta.url), "utf8"),
    readFile(new URL("../public/app.js", import.meta.url), "utf8"),
    readFile(new URL("../public/styles.css", import.meta.url), "utf8"),
    readFile(new URL("../public/sw.js", import.meta.url), "utf8"),
  ]);

  assert.match(html, /<div class="view-tabs" role="tablist" aria-label="Chore views">/);
  const tabTags = [...html.matchAll(/<button\b[^>]*\brole="tab"[^>]*>/g)].map(([tag]) => tag);
  assert.deepEqual(tabTags.map((tag) => extractAttribute(tag, "data-view")), ["today", "calendar", "history"]);
  assert.deepEqual(tabTags.map((tag) => extractAttribute(tag, "aria-controls")), ["todayPanel", "calendarPanel", "historyPanel"]);
  const panelTags = [...html.matchAll(/<section\b[^>]*\brole="tabpanel"[^>]*>/g)].map(([tag]) => tag);
  assert.deepEqual(panelTags.map((tag) => extractAttribute(tag, "id")), ["todayPanel", "calendarPanel", "historyPanel"]);
  assert.deepEqual(panelTags.map((tag) => extractAttribute(tag, "aria-labelledby")), ["todayTab", "calendarTab", "historyTab"]);
  assert.match(html, /id="calendarGrid"[^>]+role="grid"/);
  assert.match(script, /function todayChores\(\)/);
  assert.match(script, /function renderCalendar\(\)/);
  assert.match(script, /history:\s*\[\]/);
  assert.match(script, /state\.history\s*=\s*Array\.isArray\(data\?\.history\)\s*\?\s*data\.history\s*:\s*\[\]/);
  assert.match(script, /function filteredHistory\(\)/);
  assert.match(script, /function renderHistory\(\)/);
  assert.match(script, /state\.view\s*===\s*["']history["']\s*\)\s*renderHistory\(\)/);
  assert.match(script, /\$\("#historyGroups"\)\.innerHTML\s*=/);
  assert.match(script, /record\.completedOn\s*>=\s*monthStart\s*&&\s*record\.completedOn\s*<=\s*monthEnd\s*\)\s*addOccurrence\(record\.completedOn,\s*\{\s*type:\s*["']completed["'],\s*record\s*\}\)/);
  assert.doesNotMatch(html + script, /feedback-carousel|rhythm-pin|marquee-track|ScrollTrigger/);
  assert.match(styles, /\.owner-chip \{[^}]+var\(--owner-d-bg\)[^}]+var\(--owner-d-ink\)/);
  assert.match(styles, /\.owner-chip > span:first-child \{[^}]+var\(--avatar-bg\)[^}]+var\(--avatar-ink\)/);

  const expectedThemes = ["system", "light", "dark", "blush", "lavender", "mint", "sunshine", "flowers", "meadow-notes", "tidepool", "midnight-plum", "apricot", "forest-night", "sky-notebook", "pistachio", "lemonade"];
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
  assert.match(script, /occurrencesInRange\s*\(\s*chore\s*,\s*monthStart\s*,\s*monthEnd\s*\)/);

  const calendarMarkup = script.slice(script.indexOf("function calendarChoreMarkup"), script.indexOf("function animateCardExit"));
  assert.ok(calendarMarkup, "calendar chore markup should exist");
  const calendarEventsMarkup = script.slice(script.indexOf("function calendarEventsMarkup"), script.indexOf("function calendarChoreMarkup"));
  assert.match(calendarEventsMarkup, /entries\.slice\(\s*0\s*,\s*3\s*\)/);
  assert.match(calendarEventsMarkup, /entries\.slice\(\s*3\s*\)/);
  assert.match(calendarEventsMarkup, /<details class="calendar-more"><summary>\+\$\{remaining\.length\} more<\/summary>/);
  assert.match(calendarEventsMarkup, /<div class="calendar-more-list">\$\{remaining\.map\(markup\)\.join\(""\)\}<\/div>/);
  assert.match(calendarMarkup, /const projected = occurrenceDate !== chore\.nextDue/);
  const indicatorSource = calendarMarkup.slice(calendarMarkup.indexOf("const indicator"), calendarMarkup.indexOf("return `<div"));
  const questionMark = indicatorSource.indexOf("?");
  const colon = indicatorSource.lastIndexOf(":");
  assert.ok(questionMark >= 0 && colon > questionMark, "calendar indicator should branch on projection");
  const projectedIndicator = indicatorSource.slice(questionMark + 1, colon);
  const actionableIndicator = indicatorSource.slice(colon + 1);
  assert.match(projectedIndicator, /calendar-repeat/);
  assert.doesNotMatch(projectedIndicator, /calendar-check|data-action\s*=\s*["']complete["']/);
  assert.match(actionableIndicator, /calendar-check/);
  assert.match(actionableIndicator, /data-action\s*=\s*["']complete["']/);
  assert.doesNotMatch(actionableIndicator, /calendar-repeat/);

  const completedMarkup = script.slice(script.indexOf("function calendarCompletedMarkup"), script.indexOf("function safeDateLabel"));
  assert.match(completedMarkup, /calendar-chore is-completed/);
  assert.match(completedMarkup, /calendar-check is-completed/);
  assert.match(completedMarkup, /calendar-chore-title is-completed/);
  assert.match(completedMarkup, /role="img" aria-label="Completed"/);
  assert.doesNotMatch(completedMarkup, /<button\b|data-action\s*=/);

  const calendarCheck = styles.match(/(?:^|\n)\.calendar-check\s*\{([^}]+)\}/)?.[1];
  const calendarCheckIcon = styles.match(/(?:^|\n)\.calendar-check span\s*\{([^}]+)\}/)?.[1];
  assert.ok(calendarCheck, "calendar check styling should exist");
  assert.ok(calendarCheckIcon, "calendar check should have an inner visible element");
  assert.match(calendarCheck, /\bwidth:\s*2\.75rem\b/);
  assert.match(calendarCheck, /\bheight:\s*2\.75rem\b/);
  assert.match(calendarCheckIcon, /\bdisplay:\s*grid\b/);
  assert.match(calendarCheckIcon, /\bwidth:\s*1\.75rem\b/);
  assert.match(calendarCheckIcon, /\bheight:\s*1\.75rem\b/);
  assert.match(calendarCheckIcon, /\bbackground:\s*var\(--success\)/);
  assert.match(actionableIndicator, /<span\s+aria-hidden="true">/);

  assert.match(script, /navigator\.serviceWorker\.register\(\s*["']\/sw\.js["']\s*\)/);
  assert.match(serviceWorker, /const CACHE_NAME\s*=\s*["']two-of-us-shell-v12["']/);
  const shell = serviceWorker.match(/const SHELL\s*=\s*\[([\s\S]*?)\]/)?.[1];
  assert.ok(shell, "service worker should define its app shell");
  const shellEntries = [...shell.matchAll(/["']([^"']+)["']/g)].map(([, entry]) => entry);
  assert.ok(shellEntries.includes("/app.js?v=12"));
  assert.ok(shellEntries.includes("/calendar-recurrence.js"));
  assert.match(serviceWorker, /cache\.addAll\(\s*SHELL\s*\)/);

  const fetchStart = serviceWorker.indexOf('self.addEventListener("fetch"');
  assert.ok(fetchStart >= 0, "service worker should define a fetch handler");
  const fetchHandler = serviceWorker.slice(fetchStart);
  const networkFetch = fetchHandler.search(/fetch\s*\(\s*request\s*,\s*\{\s*cache\s*:\s*["']no-cache["']\s*\}\s*\)/);
  const cachedFallback = fetchHandler.search(/caches\.match\s*\(\s*request\s*\)/);
  assert.ok(networkFetch >= 0, "the fetch handler should try the network");
  assert.ok(cachedFallback > networkFetch, "the cache should be consulted after the network fails");
  const navigationFallback = fetchHandler.search(/if\s*\(\s*request\.mode\s*===\s*["']navigate["']\s*\)\s*return\s+caches\.match\(\s*["']\/index\.html["']\s*\)/);
  assert.ok(navigationFallback > cachedFallback, "index.html should be a navigation-only fallback");
});
