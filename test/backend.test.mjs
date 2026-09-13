import test from "node:test";
import assert from "node:assert/strict";
import { openDatabase } from "../src/db.mjs";
import { createApp } from "../src/server.mjs";
import { rolloverMissed } from "../src/scheduler.mjs";

const PASSWORDS = { DYLAN_PASSWORD: "dylan-test-password", MADY_PASSWORD: "mady-test-password" };
const PUSH_KEYS = {
  p256dh: Buffer.alloc(65, 1).toString("base64url"),
  auth: Buffer.alloc(16, 2).toString("base64url"),
};

async function undoFixture(t, kind = "daily", nextDue = "2024-06-01") {
  const sent = [];
  const app = await runningApp(t, () => new Date("2024-06-04T17:00:00.000Z"), {
    configured: true, publicKey: "test", send: async (...args) => { sent.push(args); return true; },
  });
  const login = (userId) => app.request("/api/session", { method: "POST", body: JSON.stringify({ userId, password: PASSWORDS[userId === "D" ? "DYLAN_PASSWORD" : "MADY_PASSWORD"] }) });
  await login("D");
  const input = { title: "Undo laundry", assigneeId: "M", scheduleKind: kind, scheduleInterval: 1, nextDue, reminderMode: "override", reminderTime: "10:30" };
  const created = await app.request("/api/chores", { method: "POST", body: JSON.stringify(input) });
  const { id } = await created.json();
  const before = app.db.prepare("SELECT * FROM chores WHERE id=?").get(id);
  const complete = async () => {
    const { revision } = app.db.prepare("SELECT revision FROM chores WHERE id=?").get(id);
    const response = await app.request(`/api/chores/${id}/complete`, { method: "POST", body: JSON.stringify({ revision }) });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.ok(Number.isSafeInteger(body.completionId), "completion must identify its history record");
    return body.completionId;
  };
  const completionId = await complete();
  const undo = (historyId = completionId) => app.request(`/api/history/${historyId}/undo`, { method: "POST", body: "{}" });
  const state = async () => (await app.request("/api/state")).json();
  return { ...app, id, before, input, completionId, complete, undo, state, login, sent };
}

for (const kind of ["once", "daily", "weekly", "monthly"]) {
  test(`Undo restores ${kind} chore details and is safe to retry`, async (t) => {
    const app = await undoFixture(t, kind);
    const record = (await app.state()).history[0];
    assert.equal(record.canUndo, true);
    assert.equal("undo_snapshot" in record, false);
    await app.login("M");
    const responses = await Promise.all([app.undo(), app.undo()]);
    assert.deepEqual(responses.map((r) => r.status).sort(), [204, 409]);
    const restored = app.db.prepare("SELECT * FROM chores WHERE id=?").get(app.id);
    const { revision, updated_at, ...details } = restored;
    const { revision: oldRevision, updated_at: oldUpdated, ...original } = app.before;
    assert.deepEqual(details, original);
    assert.ok(revision > oldRevision + 1);
    assert.equal((await app.state()).history.length, 0);
    assert.equal(app.sent.filter((message) => message[1] === "Completion undone").length, 1);
    assert.equal(app.sent.at(-1)[0], "D");
    assert.ok(await app.complete() > app.completionId, "history IDs must not be reused");
  });
}

for (const change of ["edit", "delete", "complete", "rollover"]) {
  test(`Undo cannot overwrite ${change} or re-enable an older completion`, async (t) => {
    const app = await undoFixture(t);
    if (change === "edit") assert.equal((await app.request(`/api/chores/${app.id}`, { method: "PATCH", body: JSON.stringify({ ...app.input, title: "Changed elsewhere" }) })).status, 204);
    if (change === "delete") assert.equal((await app.request(`/api/chores/${app.id}`, { method: "DELETE" })).status, 204);
    if (change === "complete") assert.equal((await app.undo(await app.complete())).status, 204);
    if (change === "rollover") rolloverMissed(app.db, "2024-06-10");
    const before = await app.state();
    assert.equal(before.history.find((r) => r.id === app.completionId).canUndo, false);
    assert.equal((await app.undo()).status, 409);
    assert.deepEqual(await app.state(), before);
  });
}

test("Undo requires a session, same origin, and rolls back a partial restoration", async (t) => {
  const app = await undoFixture(t, "once");
  const path = `/api/history/${app.completionId}/undo`;
  assert.equal((await fetch(app.url + path, { method: "POST", headers: { Origin: "http://localhost:3000", "Content-Type": "application/json" }, body: "{}" })).status, 401);
  assert.equal((await fetch(app.url + path, { method: "POST", headers: { Origin: "https://attacker.example", Cookie: app.cookie.value, "Content-Type": "application/json" }, body: "{}" })).status, 403);
  const before = await app.state();
  app.db.exec("CREATE TRIGGER fail_undo BEFORE DELETE ON completion_history BEGIN SELECT RAISE(ABORT, 'test rollback'); END");
  assert.notEqual((await app.undo()).status, 204);
  assert.deepEqual(await app.state(), before);
  app.db.exec("DROP TRIGGER fail_undo");
  assert.equal((await app.undo()).status, 204);
});

test("concurrent edit and Undo cannot overwrite each other", async (t) => {
  const app = await undoFixture(t);
  const revision = app.db.prepare("SELECT revision FROM chores WHERE id=?").get(app.id).revision;
  const [edit, undo] = await Promise.all([
    app.request(`/api/chores/${app.id}`, { method: "PATCH", body: JSON.stringify({ ...app.input, title: "Newer title", revision }) }),
    app.undo(),
  ]);
  assert.deepEqual([edit.status, undo.status].sort(), [204, 409]);
  const state = await app.state();
  assert.equal(state.chores[0].title, edit.status === 204 ? "Newer title" : app.before.title);
  assert.equal(state.history.length, edit.status === 204 ? 1 : 0);
});

test("activity delivery failure does not turn a committed completion or Undo into an API failure", async (t) => {
  let failDelivery = false;
  const app = await runningApp(t, undefined, { configured: true, send: async () => { if (failDelivery) throw new Error("test push unavailable"); return true; } });
  await app.request("/api/session", { method: "POST", body: JSON.stringify({ userId: "D", password: PASSWORDS.DYLAN_PASSWORD }) });
  const created = await app.request("/api/chores", { method: "POST", body: JSON.stringify({ title: "Bins", assigneeId: "D", scheduleKind: "once", nextDue: "2099-01-01" }) });
  const { id } = await created.json();
  failDelivery = true;
  const completed = await app.request(`/api/chores/${id}/complete`, { method: "POST", body: '{"revision":1}' });
  assert.equal(completed.status, 200);
  const { completionId } = await completed.json();
  assert.equal((await app.request(`/api/history/${completionId}/undo`, { method: "POST", body: "{}" })).status, 204);
  assert.equal(app.db.prepare("SELECT count(*) AS n FROM chores").get().n, 1);
  assert.equal(app.db.prepare("SELECT count(*) AS n FROM completion_history").get().n, 0);
});

async function runningApp(t, now, push = { configured: false, publicKey: null, send: async () => false }) {
  const db = await openDatabase(":memory:", PASSWORDS);
  const app = await createApp({
    db,
    env: { APP_ORIGIN: "http://localhost:3000", ALLOW_INSECURE_LOCALHOST: "true" },
    push,
    now,
  });
  await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  const address = app.server.address();
  const cookie = { value: "", header: "" };
  t.after(() => {
    app.server.closeAllConnections?.();
    return new Promise((resolve) => app.server.close(resolve));
  });
  return {
    db,
    cookie,
    url: `http://127.0.0.1:${address.port}`,
    request: async (path, init = {}) => {
      const headers = new Headers(init.headers);
      headers.set("Origin", "http://localhost:3000");
      if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
      if (cookie.value) headers.set("Cookie", cookie.value);
      const response = await fetch(`http://127.0.0.1:${address.port}${path}`, { ...init, headers });
      const setCookie = response.headers.get("set-cookie");
      if (setCookie) {
        cookie.header = setCookie;
        cookie.value = setCookie.split(";")[0];
      }
      return response;
    },
  };
}

test("authentication enforces same-origin writes and protects state", async (t) => {
  const app = await runningApp(t);
  const crossOrigin = await fetch(`${app.url}/api/session`, {
    method: "POST",
    headers: { Origin: "https://attacker.example", "Content-Type": "application/json" },
    body: JSON.stringify({ userId: "D", password: PASSWORDS.DYLAN_PASSWORD }),
  });
  assert.equal(crossOrigin.status, 403);
  assert.equal((await app.request("/api/state")).status, 401);
  const login = await app.request("/api/session", {
    method: "POST",
    body: JSON.stringify({ userId: "D", password: PASSWORDS.DYLAN_PASSWORD }),
  });
  assert.equal(login.status, 200);
  assert.match(app.cookie.header, /HttpOnly/);
  assert.match(app.cookie.header, /SameSite=Strict/);
  const state = await app.request("/api/state");
  assert.equal(state.status, 200);
  const stateBody = await state.json();
  assert.equal(stateBody.household.timeZone, "America/Los_Angeles");
  assert.match(stateBody.household.today, /^\d{4}-\d{2}-\d{2}$/);

  const changed = await app.request("/api/password", {
    method: "PATCH",
    body: JSON.stringify({ currentPassword: PASSWORDS.DYLAN_PASSWORD, newPassword: "dylan-new-password" }),
  });
  assert.equal(changed.status, 204);
  const oldLogin = await app.request("/api/session", {
    method: "POST", body: JSON.stringify({ userId: "D", password: PASSWORDS.DYLAN_PASSWORD }),
  });
  assert.equal(oldLogin.status, 400);
  const newLogin = await app.request("/api/session", {
    method: "POST", body: JSON.stringify({ userId: "D", password: "dylan-new-password" }),
  });
  assert.equal(newLogin.status, 200);
});

test("login throttle blocks the ninth failure in its window", async (t) => {
  const app = await runningApp(t);
  const statuses = [];
  for (let attempt = 0; attempt < 9; attempt += 1) {
    const response = await app.request("/api/session", {
      method: "POST", body: JSON.stringify({ userId: "D", password: "bad" }),
    });
    statuses.push(response.status);
  }
  assert.deepEqual(statuses.slice(0, 8), Array(8).fill(400));
  assert.equal(statuses[8], 429);
});

test("activity notifications reach only the other person who opted in", async (t) => {
  const sent = [];
  const app = await runningApp(t, undefined, {
    configured: true,
    publicKey: "test-key",
    async send(...message) { sent.push(message); return true; },
  });
  await app.request("/api/session", { method: "POST", body: JSON.stringify({ userId: "D", password: PASSWORDS.DYLAN_PASSWORD }) });
  const created = await app.request("/api/chores", {
    method: "POST", body: JSON.stringify({ title: "Bins", assigneeId: "D", scheduleKind: "once", nextDue: "2099-01-01", reminderMode: "off" }),
  });
  assert.equal(created.status, 201);
  assert.deepEqual(sent[0].slice(0, 3), ["M", "Chore added", "Dylan added Bins for Dylan."]);

  await app.request("/api/session", { method: "POST", body: JSON.stringify({ userId: "M", password: PASSWORDS.MADY_PASSWORD }) });
  assert.equal((await app.request("/api/settings", { method: "PATCH", body: JSON.stringify({ activityNotifications: false }) })).status, 204);
  await app.request("/api/session", { method: "POST", body: JSON.stringify({ userId: "D", password: PASSWORDS.DYLAN_PASSWORD }) });
  assert.equal((await app.request("/api/chores", {
    method: "POST", body: JSON.stringify({ title: "Laundry", assigneeId: "M", scheduleKind: "once", nextDue: "2099-01-01", reminderMode: "off" }),
  })).status, 201);
  assert.equal(sent.length, 1);

  assert.equal((await app.request("/api/push-test", { method: "POST", body: "{}" })).status, 204);
  assert.deepEqual(sent[1].slice(0, 3), ["D", "Two of Us", "Push notifications are working on this device."]);
});

test("API validates chore input and rejects stale atomic completion", async (t) => {
  const app = await runningApp(t, () => new Date("2024-06-04T17:00:00.000Z"));
  assert.equal((await app.request("/api/session", {
    method: "POST", body: JSON.stringify({ userId: "M", password: PASSWORDS.MADY_PASSWORD }),
  })).status, 200);
  const invalid = await app.request("/api/chores", {
    method: "POST", body: JSON.stringify({ title: "", assigneeId: "D", scheduleKind: "daily", nextDue: "2024-01-01" }),
  });
  assert.equal(invalid.status, 400);
  const created = await app.request("/api/chores", {
    method: "POST",
    body: JSON.stringify({ title: "Take bins", assigneeId: "D", scheduleKind: "daily", scheduleInterval: 1, nextDue: "2099-01-01" }),
  });
  assert.equal(created.status, 201);
  const id = (await created.json()).id;
  const state = await (await app.request("/api/state")).json();
  const revision = state.chores.find((chore) => chore.id === id).revision;
  const first = await app.request(`/api/chores/${id}/complete`, { method: "POST", body: JSON.stringify({ revision }) });
  const second = await app.request(`/api/chores/${id}/complete`, { method: "POST", body: JSON.stringify({ revision }) });
  assert.equal(first.status, 200);
  assert.equal(second.status, 409);
  const after = await (await app.request("/api/state")).json();
  assert.equal(after.history.length, 1);
  assert.deepEqual(after.history[0], {
    id: 1,
    choreId: id,
    title: "Take bins",
    assigneeId: "D",
    completedById: "M",
    dueDate: "2099-01-01",
    scheduleKind: "daily",
    completedAt: "2024-06-04T17:00:00.000Z",
    completedOn: "2024-06-04",
    canUndo: true,
  });
});

test("one-time completion removes the active chore but retains its snapshot", async (t) => {
  const app = await runningApp(t, () => new Date("2024-06-04T17:00:00.000Z"));
  assert.equal((await app.request("/api/session", {
    method: "POST", body: JSON.stringify({ userId: "M", password: PASSWORDS.MADY_PASSWORD }),
  })).status, 200);
  const created = await app.request("/api/chores", {
    method: "POST",
    body: JSON.stringify({ title: "Take out trash", assigneeId: "M", scheduleKind: "once", nextDue: "2024-06-01" }),
  });
  const id = (await created.json()).id;
  const before = await (await app.request("/api/state")).json();
  const chore = before.chores.find(({ id: choreId }) => choreId === id);
  const completed = await app.request(`/api/chores/${id}/complete`, {
    method: "POST", body: JSON.stringify({ revision: chore.revision }),
  });
  assert.equal(completed.status, 200);
  assert.deepEqual(await completed.json(), { removed: true, completionId: 1 });

  const after = await (await app.request("/api/state")).json();
  assert.equal(after.chores.some(({ id: choreId }) => choreId === id), false);
  assert.deepEqual(after.history[0], {
    id: 1,
    choreId: id,
    title: "Take out trash",
    assigneeId: "M",
    completedById: "M",
    dueDate: "2024-06-01",
    scheduleKind: "once",
    completedAt: "2024-06-04T17:00:00.000Z",
    completedOn: "2024-06-04",
    canUndo: true,
  });
  assert.equal(after.history.length, 1);
});

test("overdue recurring completion shifts the series before advancing", async (t) => {
  const app = await runningApp(t, () => new Date("2024-06-04T17:00:00.000Z"));
  const login = await app.request("/api/session", {
    method: "POST", body: JSON.stringify({ userId: "M", password: PASSWORDS.MADY_PASSWORD }),
  });
  assert.equal(login.status, 200);
  const created = await app.request("/api/chores", {
    method: "POST",
    body: JSON.stringify({
      title: "Bins", assigneeId: "M", scheduleKind: "daily", scheduleInterval: 1,
      nextDue: "2024-06-01", reminderMode: "off",
    }),
  });
  assert.equal(created.status, 201);
  const createdBody = await created.json();
  const state = await (await app.request("/api/state")).json();
  assert.equal(state.household.today, "2024-06-04");
  const chore = state.chores.find(({ id }) => id === createdBody.id);
  const completed = await app.request(`/api/chores/${chore.id}/complete`, {
    method: "POST", body: JSON.stringify({ revision: chore.revision }),
  });
  assert.equal(completed.status, 200);
  assert.equal((await completed.json()).nextDue, "2024-06-05");
  const after = await (await app.request("/api/state")).json();
  const updated = after.chores.find(({ id }) => id === chore.id);
  assert.equal(updated.anchorDate, "2024-06-04");
  assert.equal(updated.missedCount, 0);
  assert.equal(updated.revision, chore.revision + 1);
  assert.deepEqual(after.history[0], {
    id: 1,
    choreId: chore.id,
    title: "Bins",
    assigneeId: "M",
    completedById: "M",
    dueDate: "2024-06-01",
    scheduleKind: "daily",
    completedAt: "2024-06-04T17:00:00.000Z",
    completedOn: "2024-06-04",
    canUndo: true,
  });
});

test("login is public while app documents and code require a session", async (t) => {
  const app = await runningApp(t);
  const login = await app.request("/login");
  assert.equal(login.status, 200);
  assert.match(await login.text(), /Sign in to view and update the shared list/);

  const appDocument = await app.request("/app", { redirect: "manual" });
  assert.equal(appDocument.status, 302);
  assert.equal(appDocument.headers.get("location"), "/login");
  for (const path of ["/app.js", "/styles.css", "/calendar-recurrence.js"]) {
    assert.equal((await app.request(path)).status, 401, `${path} must not load before sign-in`);
  }
  for (const path of ["/icon.svg", "/icon-192.png", "/manifest.webmanifest", "/sw.js"]) {
    assert.equal((await app.request(path)).status, 200, `${path} must remain available for installation and push`);
  }

  const loginResponse = await app.request("/api/session", {
    method: "POST", body: JSON.stringify({ userId: "D", password: PASSWORDS.DYLAN_PASSWORD }),
  });
  assert.equal(loginResponse.status, 200);
  assert.match(await (await app.request("/app")).text(), /id="appView"/);
  const appScript = await app.request("/app.js");
  assert.equal(appScript.status, 200);
  assert.equal(appScript.headers.get("cache-control"), "no-store");
  const subscription = await app.request("/api/push-subscriptions", { method: "PUT", body: JSON.stringify({ endpoint: "https://fcm.googleapis.com/fcm/send/current-device", keys: PUSH_KEYS }) });
  assert.equal(subscription.status, 204);
  assert.ok(app.db.prepare("SELECT session_hash FROM push_subscriptions").get().session_hash);
  assert.equal((await app.request("/api/session", { method: "DELETE", body: "{}" })).status, 204);
  assert.equal(app.db.prepare("SELECT 1 FROM push_subscriptions").get(), undefined);
});

test("static files return MIME types and missing files do not break the server", async (t) => {
  const app = await runningApp(t);
  const root = await app.request("/", { redirect: "manual" });
  assert.equal(root.status, 302);
  assert.equal(root.headers.get("location"), "/login");

  const missing = await app.request("/missing-static-file.js");
  assert.equal(missing.status, 404);
  assert.equal((await app.request("/login")).status, 200);

  for (const [path, type] of [["/login.js", "text/javascript"], ["/login.css", "text/css"], ["/icon.svg", "image/svg+xml"], ["/icon-192.png", "image/png"], ["/manifest.webmanifest", "application/manifest+json"]]) {
    const response = await app.request(path);
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type"), new RegExp(`^${type.replace("+", "\\+")}`));
  }
});

test("authenticated SSE and push subscription ownership are enforced", async (t) => {
  const app = await runningApp(t);
  const unauthenticated = await app.request("/api/events");
  assert.equal(unauthenticated.status, 401);
  await app.request("/api/session", { method: "POST", body: JSON.stringify({ userId: "M", password: PASSWORDS.MADY_PASSWORD }) });
  const endpoint = "https://fcm.googleapis.com/fcm/send/subscription";
  const invalid = await app.request("/api/push-subscriptions", {
    method: "PUT", body: JSON.stringify({ endpoint, keys: { p256dh: "a".repeat(32), auth: PUSH_KEYS.auth } }),
  });
  assert.equal(invalid.status, 400);
  const subscription = await app.request("/api/push-subscriptions", {
    method: "PUT", body: JSON.stringify({ endpoint, keys: PUSH_KEYS }),
  });
  assert.equal(subscription.status, 204);
  assert.equal(app.db.prepare("SELECT user_id FROM push_subscriptions WHERE endpoint=?").get(endpoint).user_id, "M");
  const removed = await app.request("/api/push-subscriptions", { method: "DELETE", body: JSON.stringify({ endpoint }) });
  assert.equal(removed.status, 204);
  assert.equal(app.db.prepare("SELECT 1 FROM push_subscriptions WHERE endpoint=?").get(endpoint), undefined);

  const events = await app.request("/api/events");
  assert.equal(events.status, 200);
  assert.match(events.headers.get("content-type"), /text\/event-stream/);
  events.body?.cancel();
});
