// Uses an existing Playwright installation; no application dependency is required.
// PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs node tools/verify-ui.mjs
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { createServer } from "node:http";
import { openDatabase } from "../src/db.mjs";
import { createApp } from "../src/server.mjs";

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const probe = createServer();
await new Promise((resolve, reject) => { probe.once("error", reject); probe.listen(0, "127.0.0.1", resolve); });
const port = probe.address().port;
await new Promise((resolve) => probe.close(resolve));
const origin = `http://127.0.0.1:${port}`;
const db = await openDatabase(":memory:", { D: "ui-test-password", M: "ui-test-password" });
const app = await createApp({ db, env: { APP_ORIGIN: origin, ALLOW_INSECURE_LOCALHOST: "true" },
  now: () => new Date("2026-09-12T18:00:00.000Z"), push: { configured: false, send: async () => false } });
await new Promise((resolve, reject) => { app.server.once("error", reject); app.server.listen(port, "127.0.0.1", resolve); });
let browser;
let checks = 0;
const out = new URL("../design/verification/", import.meta.url).pathname;
await mkdir(out, { recursive: true });
try {
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: "light" });
  const page = await context.newPage();
  page.setDefaultTimeout(8000);
  await page.clock.install({ time: new Date("2026-09-12T18:00:00Z") });
  const errors = [];
  const paths = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (request) => paths.push(new URL(request.url()).pathname));
  await page.goto(origin + "/app");
  await page.waitForURL("**/login");
  assert.equal(paths.includes("/app.js"), false);
  assert.equal(paths.includes("/api/state"), false);
  assert.equal(await page.getByText("Your chores stay hidden until you sign in.").count(), 0);
  await page.locator("#loginPassword").fill("ui-test-password");
  await page.locator("#togglePassword").click();
  assert.equal(await page.locator("#loginPassword").getAttribute("type"), "text");
  await page.locator("#togglePassword").click();
  await page.screenshot({ path: out + "login-390.png" });
  await page.locator("button[type=submit]").click();
  await page.waitForURL("**/app");
  await page.locator("#emptyState").waitFor({ state: "visible" });
  checks++;

  const create = async (title, assigneeId, scheduleKind = "once", nextDue = "2026-09-12") => {
    const response = await context.request.post(origin + "/api/chores", {
      headers: { Origin: origin }, data: { title, assigneeId, scheduleKind, nextDue, reminderMode: "off" },
    });
    assert.equal(response.status(), 201);
    return (await response.json()).id;
  };
  const recycling = await create("Take out recycling", "D", "daily");
  await create("Water the plants", "M");
  await create("Laundry", "D", "once", "2026-09-13");
  const longId = await create("Clean the kitchen, wipe every countertop, and put all the dishes away before dinner", "M", "once", "2026-09-13");
  await page.reload();
  await page.locator("#choreSections .chore-row").first().waitFor();

  async function fits(label) {
    const overflow = await page.evaluate(() => ({ width: innerWidth, body: document.documentElement.scrollWidth,
      dialogs: [...document.querySelectorAll("dialog[open]")].map((dialog) => [dialog.scrollWidth, dialog.clientWidth]) }));
    assert.ok(overflow.body <= overflow.width, `${label}: page overflow ${JSON.stringify(overflow)}`);
    assert.ok(overflow.dialogs.every(([scroll, width]) => scroll <= width + 1), `${label}: dialog overflow`);
    checks++;
  }

  // Negative control: the layout check must actually reject an overflowing page.
  await page.evaluate(() => { document.body.style.width = "4000px"; });
  await assert.rejects(() => fits("known-bad overflow"), /page overflow/);
  await page.evaluate(() => { document.body.style.width = ""; });

  for (const width of [320, 390, 768, 1280]) {
    await page.setViewportSize({ width, height: 844 });
    for (const view of ["today", "calendar", "history"]) {
      await page.locator(`#${view}Tab`).click();
      await fits(`${view}-${width}`);
      if (view === "calendar") {
        assert.equal(await page.locator("#calendarWeek button").count(), 7);
        const names = await page.locator(".day-name").allTextContents();
        assert.deepEqual(names, ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]);
        assert.equal(await page.locator(".is-projected input[type=checkbox]").count(), 0);
        await page.screenshot({ path: out + `calendar-${width}.png` });
      }
    }
    await page.locator("#settingsButton").click();
    for (const theme of ["light", "dark", "blush", "system"]) {
      await page.locator(`.theme-choice[data-theme-preview=${theme}]`).click();
      assert.equal(await page.locator(`input[name=theme][value=${theme}]`).isChecked(), true);
      await fits(`settings-${theme}-${width}`);
      if (width === 390 && ["dark", "blush"].includes(theme)) {
        await page.locator("#closeSettingsButton").click();
        await page.locator("#calendarTab").click();
        await page.screenshot({ path: out + `calendar-${theme}-390.png` });
        await page.locator("#settingsButton").click();
      }
    }
    await page.locator("#closeSettingsButton").click();
    await page.locator("#addChoreButton").click();
    await page.locator("#scheduleKind").selectOption("weekly");
    await fits(`form-${width}`);
    await page.locator("#cancelChoreButton").click();
  }

  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator("#todayTab").click();
  await page.screenshot({ path: out + "today-390.png" });
  const checkbox = page.locator(`#choreSections input[data-id="${recycling}"]`);
  const box = await checkbox.boundingBox();
  assert.equal(box.width, 24);
  assert.equal(box.height, 24);
  const hit = await checkbox.locator("..").boundingBox();
  assert.ok(hit.width >= 44 && hit.height >= 44);
  await checkbox.click();
  await page.locator("#toastUndo:not([disabled])").waitFor();
  await page.screenshot({ path: out + "completion-390.png" });
  await page.locator("#toast").hover();
  await page.clock.runFor(12000);
  assert.equal(await page.locator("#toast").isVisible(), true, "hover pauses the Undo timer");
  await page.mouse.move(0, 0);
  await page.locator("#toastUndo").focus();
  await page.clock.runFor(12000);
  assert.equal(await page.locator("#toast").isVisible(), true, "focus pauses the Undo timer");
  await page.locator("#toastUndo").click();
  await checkbox.waitFor();
  await checkbox.click();
  await page.locator("#toastUndo:not([disabled])").waitFor();
  await page.locator("#toastDismiss").click();
  await page.locator("#historyTab").click();
  await page.locator("#historyGroups [data-action=undo]").waitFor();
  await page.screenshot({ path: out + "history-390.png" });
  await page.locator("#historyGroups [data-action=undo]").click();
  await page.locator("#historyEmpty").waitFor();
  checks++;

  await page.locator("#todayTab").click();
  await checkbox.focus();
  await page.keyboard.press("Space");
  await page.locator("#toastUndo:not([disabled])").waitFor();
  await page.locator("#todayTab").focus();
  await page.mouse.move(0, 0);
  await page.clock.runFor(9000);
  assert.equal(await page.locator("#toast").isVisible(), true);
  await page.clock.runFor(1100);
  assert.equal(await page.locator("#toast").isVisible(), false, "Undo message expires after ten unpaused seconds");
  await page.keyboard.press("ArrowRight");
  assert.equal(await page.locator("#calendarTab").getAttribute("aria-selected"), "true");
  await page.locator("#nextWeek").click();
  await page.locator('[data-calendar-date="2026-09-13"]').click();
  assert.equal(await page.evaluate(() => document.activeElement.dataset.calendarDate), "2026-09-13");
  await page.locator("#calendarToday").click();
  await page.locator("#historyTab").click();
  await page.locator("#historyGroups [data-action=undo]").click();
  await page.locator("#historyEmpty").waitFor();
  checks++;

  await page.locator("#calendarTab").click();
  await page.locator(`#calendarAgenda [data-action=edit][data-id="${longId}"]`).click();
  await page.locator("#choreTitle").fill("Clean the kitchen");
  await page.screenshot({ path: out + "edit-390.png" });
  await page.locator("#deleteChoreButton").click();
  await page.screenshot({ path: out + "remove-390.png" });
  await page.locator("#cancelConfirmButton").click();
  await page.locator("#addChoreButton").click();
  await page.keyboard.press("Escape");
  assert.equal(await page.evaluate(() => document.activeElement.id), "addChoreButton");
  await page.setViewportSize({ width: 390, height: 460 });
  await page.locator("#addChoreButton").click();
  await page.locator("#choreTitle").fill("Keyboard layout check");
  await fits("short-viewport-with-keyboard");
  const saveBox = await page.locator("#saveChoreButton").boundingBox();
  assert.ok(saveBox.y >= 0 && saveBox.y + saveBox.height <= 460);
  await page.locator("#cancelChoreButton").click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator("#settingsButton").click();
  await page.screenshot({ path: out + "settings-390.png" });
  await page.locator("#sessionTitle").scrollIntoViewIfNeeded();
  await page.screenshot({ path: out + "security-390.png" });
  await page.locator("#closeSettingsButton").click();
  await context.setOffline(true);
  await page.locator("#offlineBanner").waitFor();
  assert.equal(await page.locator("#addChoreButton").isDisabled(), true);
  assert.equal(await page.locator("#calendarAgenda [data-action=complete]:enabled").count(), 0);
  await context.setOffline(false);
  await page.locator("#offlineBanner").waitFor({ state: "hidden" });
  await page.route("**/api/state", (route) => route.fulfill({ status: 503, contentType: "application/json", body: '{"error":"Test connection failure"}' }));
  await page.reload();
  await page.locator("#errorState").waitFor();
  await page.unroute("**/api/state");
  await page.locator("#retryButton").click();
  await page.locator("#errorState").waitFor({ state: "hidden" });
  checks++;
  await page.locator("#settingsButton").click();
  await page.locator("#logoutButton").click();
  await page.waitForURL("**/login");
  assert.deepEqual(errors, []);
  checks++;
  console.log(`PASS: ${checks} browser checks; screenshots saved in design/verification. Chromium ${browser.version()}`);
} finally {
  await browser?.close();
  app.server.closeAllConnections();
  await new Promise((resolve) => app.server.close(resolve));
}
