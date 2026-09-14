import test from "node:test";
import assert from "node:assert/strict";
import { openDatabase } from "../src/db.mjs";
import { createApp } from "../src/server.mjs";
import { createScheduler } from "../src/scheduler.mjs";

async function fixture(t) {
  const db = await openDatabase(":memory:", { D: "Dylan-test-passphrase", M: "Mady-test-passphrase" });
  const sent = [];
  const app = await createApp({ db, env: { APP_ORIGIN: "http://localhost:3000", ALLOW_INSECURE_LOCALHOST: "true" }, push: { configured: true, publicKey: "test", send: async (...args) => { sent.push(args); return true; } } });
  await new Promise((r) => app.server.listen(0, "127.0.0.1", r));
  const origin = `http://127.0.0.1:${app.server.address().port}`;
  t.after(() => { app.server.closeAllConnections(); return new Promise((r) => app.server.close(r)); });
  const cookies = {};
  async function request(as, path, method = "GET", data, headers = {}) {
    const res = await fetch(origin + path, { method, headers: { Origin: "http://localhost:3000", Cookie: cookies[as] || "", ...data !== undefined ? { "Content-Type": "application/json" } : {}, ...headers }, body: data === undefined ? undefined : JSON.stringify(data) });
    if (res.headers.has("set-cookie")) cookies[as] = res.headers.get("set-cookie").split(";")[0];
    return res;
  }
  const login = async (as, username, password) => { const r = await request(as, "/api/session", "POST", { username, password }); assert.equal(r.status, 200, await r.text()); };
  await login("d", "DYLAN", "Dylan-test-passphrase");
  await login("m", "mady", "Mady-test-passphrase");
  const create = async (path, data) => { const r = await request("d", path, "POST", data); const b = await r.json(); assert.equal(r.status, 200, JSON.stringify(b)); return b.id; };
  const e = await create("/api/admin/users", { username: "elijah", name: "Elijah", password: "Elijah-test-passphrase" });
  const a = await create("/api/admin/users", { username: "aryona", name: "Aryona", password: "Aryona-test-passphrase" });
  const group = await create("/api/admin/groups", { name: "Elijah & Aryona", timeZone: "UTC" });
  for (const id of [e, a]) assert.equal((await request("d", `/api/admin/groups/${group}/members/${id}`, "PUT", {})).status, 200);
  await login("e", "elijah", "Elijah-test-passphrase");
  await login("a", "aryona", "Aryona-test-passphrase");
  const input = (assigneeId, title = "Private chore") => ({ title, assigneeId, scheduleKind: "once", nextDue: "2099-01-01" });
  return { db, request, login, create, e, a, group, sent, input, cookies, origin };
}

test("groups isolate every chore and history operation, including guessed IDs and admin non-members", async (t) => {
  const f = await fixture(t);
  const r = await f.request("e", `/api/chores?groupId=${f.group}`, "POST", f.input(f.a));
  assert.equal(r.status, 201); const { id } = await r.json();
  assert.deepEqual(f.sent.map((s) => s[0]), [f.a]);
  const mine = await (await f.request("d", "/api/state")).json();
  assert.equal(mine.chores.length, 0); assert.deepEqual(mine.users.map((u) => u.id), ["D", "M"]);
  assert.equal(mine.groups.length, 1);
  for (const who of ["d", "m"]) {
    for (const path of [`/api/state?groupId=${f.group}`, `/api/events?groupId=${f.group}`]) assert.equal((await f.request(who, path)).status, 404);
    for (const [path, method, data] of [[`/api/chores/${id}`, "PATCH", f.input("D")], [`/api/chores/${id}`, "DELETE", undefined], [`/api/chores/${id}/complete`, "POST", { revision: 1 }]]) {
      assert.equal((await f.request(who, path, method, data)).status, 404);
      assert.equal((await f.request(who, `${path}?groupId=${f.group}`, method, data)).status, 404);
    }
  }
  assert.equal((await f.request("d", "/api/chores", "POST", f.input(f.e))).status, 400);
  assert.equal((await f.request("e", `/api/chores/${id}?groupId=${f.group}`, "PATCH", f.input("M"))).status, 400);
  const done = await f.request("a", `/api/chores/${id}/complete?groupId=${f.group}`, "POST", { revision: 1 });
  assert.equal(done.status, 200); const { completionId } = await done.json();
  assert.equal((await f.request("d", `/api/history/${completionId}/undo`, "POST", {})).status, 404);
  assert.equal((await (await f.request("d", "/api/state")).json()).history.length, 0);
  assert.equal((await f.request("e", `/api/history/${completionId}/undo?groupId=${f.group}`, "POST", {})).status, 204);
});

test("admin account lifecycle protects last administrator and revokes sessions and native devices", async (t) => {
  const f = await fixture(t);
  assert.equal((await f.request("e", "/api/admin/state")).status, 403);
  assert.equal((await f.request("m", "/api/admin/users", "POST", { username: "bad", name: "Bad", password: "password-password" })).status, 403);
  for (const data of [{ active: false }, { isAdmin: false }]) assert.equal((await f.request("d", "/api/admin/users/D", "PATCH", data)).status, 409);
  assert.equal((await f.request("d", "/api/admin/users", "POST", { username: "ELIJAH", name: "Other", password: "password-password" })).status, 409);
  const device = await (await f.request("e", "/api/native-device", "POST", { deviceId: "elijah-phone" })).json();
  assert.equal((await f.request("d", `/api/admin/users/${f.e}`, "PATCH", { password: "new-elijah-passphrase" })).status, 200);
  assert.equal((await f.request("e", "/api/state")).status, 401);
  assert.equal((await f.request("none", "/api/native-notifications", "GET", undefined, { Authorization: `Bearer ${device.token}` })).status, 401);
  await f.login("e", "elijah", "new-elijah-passphrase");
  assert.equal((await f.request("d", `/api/admin/users/${f.e}`, "PATCH", { active: false })).status, 200);
  assert.equal((await f.request("e", "/api/state")).status, 401);
  assert.equal((await f.request("none", "/api/session", "POST", { username: "elijah", password: "new-elijah-passphrase" })).status, 400);
  const row = f.db.prepare("SELECT * FROM users WHERE id=?").get(f.e);
  assert.equal(row.active, 0); assert.ok(row.password_hash); assert.ok(!JSON.stringify(await (await f.request("d", "/api/admin/state")).json()).includes(row.password_hash));
});

test("membership removal and archival immediately revoke reads, SSE and queued native notifications", async (t) => {
  const f = await fixture(t);
  await f.request("d", `/api/admin/groups/${f.group}/members/D`, "PUT", {});
  const controller = new AbortController(); t.after(() => controller.abort());
  const stream = await fetch(f.origin + `/api/events?groupId=${f.group}`, { headers: { Cookie: f.cookies.d }, signal: controller.signal });
  const reader = stream.body.getReader(); await reader.read();
  const device = await (await f.request("d", "/api/native-device", "POST", { deviceId: "dylan-native-phone" })).json();
  await f.request("e", `/api/chores?groupId=${f.group}`, "POST", f.input(f.a));
  const queued = await (await f.request("none", "/api/native-notifications", "GET", undefined, { Authorization: `Bearer ${device.token}` })).json();
  assert.equal(queued.events.length, 1); assert.equal(queued.events[0].groupId, f.group);
  await f.request("d", `/api/admin/groups/${f.group}/members/D`, "DELETE", {});
  assert.equal((await f.request("d", `/api/state?groupId=${f.group}`)).status, 404);
  const pruned = await (await f.request("none", "/api/native-notifications", "GET", undefined, { Authorization: `Bearer ${device.token}` })).json();
  assert.equal(pruned.events.length, 0);
  let closed = false; for (let n = 0; n < 5; n++) { const next = await reader.read(); if (next.done) { closed = true; break; } }
  assert.ok(closed, "revoked SSE is closed, not left subscribed");
  assert.equal((await f.request("d", `/api/admin/groups/${f.group}/members/${f.a}`, "DELETE", {})).status, 409);
  await f.request("d", `/api/admin/groups/${f.group}`, "PATCH", { archived: true });
  assert.equal((await f.request("e", `/api/state?groupId=${f.group}`)).status, 404);
  assert.equal((await (await f.request("e", "/api/state")).json()).chores.length, 0);
});

test("scheduler separates group timezones, digests and notification recipients", async (t) => {
  const f = await fixture(t);
  const now = "2099-01-01T09:10:00.000Z";
  await f.request("e", `/api/chores?groupId=${f.group}`, "POST", f.input(f.e, "UTC secret"));
  await f.request("d", "/api/chores", "POST", f.input("D", "Pacific secret"));
  f.db.exec("UPDATE users SET digest_time='09:00'");
  const sent = [];
  const scheduler = createScheduler({ db: f.db, timeZone: "UTC", now: () => new Date(now), send: async (...s) => { sent.push(s); return true; } });
  t.after(() => scheduler.stop());
  await scheduler.tick(); await scheduler.tick();
  assert.equal(sent.length, 1); assert.equal(sent[0][0], f.e); assert.match(sent[0][2], /UTC secret/);
  assert.equal(sent[0][3].groupId, f.group); assert.ok(!sent[0][2].includes("Pacific"));
});
