import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { openDatabase } from "../src/db.mjs";
import { createBackup } from "../src/backup.mjs";

const PASSWORDS = { DYLAN_PASSWORD: "dylan-test-password", MADY_PASSWORD: "mady-test-password" };

test("backup creates a restorable, integrity-checked database", async () => {
  const directory = await mkdtemp(join(tmpdir(), "chores-backup-"));
  const source = join(directory, "chores.db");
  const backup = join(directory, "backup.db");
  const restored = join(directory, "restored.db");
  const sourceDb = await openDatabase(source, PASSWORDS);
  const now = new Date().toISOString();
  sourceDb.prepare(`INSERT INTO chores(title,assignee_id,schedule_kind,schedule_interval,next_due,anchor_date,
    weekdays_mask,month_day,reminder_mode,reminder_time,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run("Bins", "D", "once", 1, "2030-01-01", "2030-01-01", 0, null, "off", null, now, now);
  sourceDb.close();

  try {
    await createBackup(source, backup);
    await createBackup(backup, restored);

    for (const path of [backup, restored]) {
      const db = new DatabaseSync(path, { readOnly: true, defensive: true });
      try {
        assert.equal(db.prepare("PRAGMA integrity_check").get().integrity_check, "ok");
        assert.equal(db.prepare("SELECT title FROM chores").get().title, "Bins");
      } finally {
        db.close();
      }
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
