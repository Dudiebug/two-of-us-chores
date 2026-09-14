import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase, publicState } from "../src/db.mjs";
import { createApp } from "../src/server.mjs";
import { createBackup } from "../src/backup.mjs";

const passwords = { D: "dylan-test-password", M: "mady-test-password" };
const insertChore = (db) => db.prepare(`INSERT INTO chores
  (title,assignee_id,schedule_kind,schedule_interval,next_due,anchor_date,created_at,updated_at)
  VALUES ('Bins','D','once',1,'2099-01-01','2099-01-01','2026-09-12','2026-09-12')`).run();

test("v4 upgrade preserves data, reserves historical IDs, and keeps legacy history read-only", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "chores-migration-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, "v4.db");
  let db = await openDatabase(path, passwords);
  // Recreate the exact previous table shapes: no AUTOINCREMENT or undo metadata.
  db.exec("DROP TRIGGER invalidate_undo_update; DROP TRIGGER invalidate_undo_delete;");
  for (const table of ["chores", "completion_history"]) {
    const sql = db.prepare("SELECT sql FROM sqlite_master WHERE name=?").get(table).sql
      .replace(" AUTOINCREMENT", "").replace(",\n      undo_snapshot TEXT,\n      undo_revision INTEGER", "");
    db.exec(`DROP TABLE ${table}`);
    db.exec(sql);
  }
  db.exec("PRAGMA user_version=4");
  const oldId = Number(insertChore(db).lastInsertRowid);
  db.prepare(`INSERT INTO completion_history
    (id,chore_id,title,assignee_id,completed_by_id,due_date,schedule_kind,completed_at,completed_on)
    VALUES (80,90,'Deleted chore','D','M','2099-01-01','once','2026-09-12','2026-09-12')`).run();
  const before = db.prepare("SELECT * FROM chores").all();
  db.close();
  db = await openDatabase(path);
  assert.deepEqual(db.prepare("SELECT * FROM chores").all(), before);
  assert.equal(db.prepare("PRAGMA user_version").get().user_version, 7);
  assert.equal(publicState(db, "D").history[0].canUndo, false);
  const newId = Number(insertChore(db).lastInsertRowid);
  assert.ok(newId > 90);
  db.prepare("DELETE FROM chores WHERE id=?").run(newId);
  assert.ok(Number(insertChore(db).lastInsertRowid) > newId);
  assert.equal(db.prepare("SELECT id FROM chores WHERE id=?").get(oldId).id, oldId);
  assert.equal(db.prepare("PRAGMA integrity_check").get().integrity_check, "ok");
  assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
  db.close();
  db = await openDatabase(path);
  assert.equal(publicState(db, "D").history[0].id, 80);
  db.close();
});

test("an eligible completion survives restart and backup, then undoes through the real API", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "chores-undo-backup-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const source = join(directory, "chores.db");
  const backup = join(directory, "backup.db");
  const db = await openDatabase(source, passwords);
  const id = Number(insertChore(db).lastInsertRowid);
  async function start(database) {
    const app = await createApp({ db: database, env: { APP_ORIGIN: "http://localhost:3000", ALLOW_INSECURE_LOCALHOST: "true" }, push: { configured: false, send: async () => false } });
    await new Promise((resolve, reject) => { app.server.once("error", reject); app.server.listen(0, "127.0.0.1", resolve); });
    let cookie = "";
    const request = async (path, body) => {
      const response = await fetch(`http://127.0.0.1:${app.server.address().port}${path}`, {
        method: body ? "POST" : "GET", headers: { Origin: "http://localhost:3000", "Content-Type": "application/json", Cookie: cookie },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      if (response.headers.has("set-cookie")) cookie = response.headers.get("set-cookie").split(";")[0];
      return response;
    };
    await request("/api/session", { userId: "D", password: passwords.D });
    return { request, close: () => new Promise((resolve) => { app.server.closeAllConnections(); app.server.close(resolve); }) };
  }
  const initial = await start(db);
  let completionId;
  try {
    const completed = await initial.request(`/api/chores/${id}/complete`, { revision: 1 });
    assert.equal(completed.status, 200);
    completionId = (await completed.json()).completionId;
  } finally { await initial.close(); }
  await createBackup(source, backup);
  const restoredDb = await openDatabase(backup);
  const restored = await start(restoredDb);
  try {
    assert.equal((await (await restored.request("/api/state")).json()).history[0].canUndo, true);
    assert.equal((await restored.request(`/api/history/${completionId}/undo`, {})).status, 204);
    const state = await (await restored.request("/api/state")).json();
    assert.equal(state.history.length, 0);
    assert.equal(state.chores[0].id, id);
    assert.equal(state.chores[0].title, "Bins");
    assert.equal(restoredDb.prepare("PRAGMA integrity_check").get().integrity_check, "ok");
  } finally { await restored.close(); }
});
