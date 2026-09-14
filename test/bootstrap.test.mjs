import test from "node:test";
import assert from "node:assert/strict";
import { openDatabase } from "../src/db.mjs";
import { bootstrapAccounts } from "../deploy/bootstrap.mjs";
import { passwordMatches } from "../src/security.mjs";

test("new installation defines its own admin, users and private groups without D/M defaults", async () => {
  const db = await openDatabase(":memory:");
  try {
    const data = { admin: { username: "owner", name: "Owner", password: "owner-test-password" }, groupName: "First home", timeZone: "UTC", users: [
      { username: "one", name: "Alex", password: "one-test-password" }, { username: "two", name: "Alex", password: "two-test-password", groupName: "Second home" },
    ] };
    await bootstrapAccounts(db, data);
    const users = db.prepare("SELECT * FROM users ORDER BY username").all();
    assert.equal(users.length, 3); assert.equal(users.filter((u) => u.is_admin).length, 1);
    assert.equal(users.some((u) => ["D", "M"].includes(u.id)), false);
    assert.equal(db.prepare("SELECT count(*) AS n FROM groups").get().n, 2);
    const owner = users.find((u) => u.username === "owner");
    assert.ok(await passwordMatches(data.admin.password, owner.password_salt, owner.password_hash));
    assert.ok(!JSON.stringify(users).includes(data.admin.password));
    await assert.rejects(bootstrapAccounts(db, data), /Accounts already exist/);
    assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
  } finally { db.close(); }
});
test("interrupted/invalid bootstrap leaves no partial accounts and can be retried", async () => {
  const db = await openDatabase(":memory:");
  try {
    await assert.rejects(bootstrapAccounts(db, { admin: { username: "admin", password: "good-long-password" }, users: [{ username: "ADMIN", password: "other-good-password" }] }), /unique/);
    assert.equal(db.prepare("SELECT count(*) AS n FROM users").get().n, 0);
    assert.equal(db.prepare("SELECT count(*) AS n FROM groups").get().n, 0);
  } finally { db.close(); }
});
