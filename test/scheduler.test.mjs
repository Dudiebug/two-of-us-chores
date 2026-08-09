import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase } from "../src/db.mjs";
import { createScheduler, rolloverMissed } from "../src/scheduler.mjs";

const PASSWORDS = { DYLAN_PASSWORD: "dylan-test-password", MADY_PASSWORD: "mady-test-password" };

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "chores-scheduler-"));
  const path = join(directory, "chores.db");
  const db = await openDatabase(path, PASSWORDS);
  return { db, path };
}

function insertChore(db, values) {
  const now = new Date().toISOString();
  return db.prepare(`INSERT INTO chores(title,assignee_id,schedule_kind,schedule_interval,next_due,anchor_date,
    weekdays_mask,month_day,reminder_mode,reminder_time,missed_count,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(values.title, values.assigneeId || "D", values.scheduleKind || "daily", values.interval || 1,
      values.nextDue, values.anchorDate || values.nextDue, values.weekdaysMask || 0, values.monthDay || null,
      values.reminderMode || "inherit", values.reminderTime || null, values.missedCount || 0, now, now);
}

test("rollover shifts all late days in one transaction", async () => {
  const { db } = await fixture();
  try {
    insertChore(db, { title: "Bins", nextDue: "2024-06-01", scheduleKind: "daily", missedCount: 0 });
    const shifted = rolloverMissed(db, "2024-06-04", "2024-06-04T12:00:00.000Z");
    assert.equal(shifted.length, 1);
    assert.equal(shifted[0].days, 3);
    assert.equal(db.prepare("SELECT next_due,missed_count,revision FROM chores").get().next_due, "2024-06-04");
    assert.equal(db.prepare("SELECT missed_count FROM chores").get().missed_count, 3);
    assert.equal(db.prepare("SELECT revision FROM chores").get().revision, 2);
  } finally {
    db.close();
  }
});

test("missed and digest notifications group and deduplicate across restart", async () => {
  const { db, path } = await fixture();
  const sent = [];
  try {
    db.prepare("UPDATE users SET missed_alert_time='09:00',digest_time='09:00' WHERE id='D'").run();
    insertChore(db, { title: "Laundry", nextDue: "2024-06-10", missedCount: 1 });
    insertChore(db, { title: "Kitchen", nextDue: "2024-06-10" });
    const scheduler = createScheduler({
      db,
      timeZone: "America/Chicago",
      now: () => new Date("2024-06-10T14:00:00.000Z"),
      send: async (userId, title, body) => { sent.push({ userId, title, body }); return true; },
    });
    await scheduler.tick();
    await scheduler.tick();
    scheduler.stop();
    assert.equal(sent.length, 2);
    assert.match(sent.find((item) => item.title === "Missed chores").body, /Laundry/);
    assert.match(sent.find((item) => item.title === "Today at home").body, /Kitchen/);
    db.close();

    const reopened = await openDatabase(path, PASSWORDS);
    try {
      const restarted = createScheduler({
        db: reopened,
        timeZone: "America/Chicago",
        now: () => new Date("2024-06-10T14:00:00.000Z"),
        send: async () => { throw new Error("duplicate notification"); },
      });
      await restarted.tick();
      restarted.stop();
      assert.equal(reopened.prepare("SELECT count(*) AS count FROM notification_markers").get().count, 2);
    } finally {
      reopened.close();
    }
  } catch (error) {
    try { db.close(); } catch {}
    throw error;
  }
});
