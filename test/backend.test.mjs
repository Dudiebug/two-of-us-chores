import test from "node:test";
import assert from "node:assert/strict";
import { openDatabase } from "../src/db.mjs";
import { createApp } from "../src/server.mjs";

const PASSWORDS = { DYLAN_PASSWORD: "dylan-test-password", MADY_PASSWORD: "mady-test-password" };
const PUSH_KEYS = {
  p256dh: Buffer.alloc(65, 1).toString("base64url"),
  auth: Buffer.alloc(16, 2).toString("base64url"),
};

async function runningApp(t, now) {
  const db = await openDatabase(":memory:", PASSWORDS);
  const app = await createApp({
    db,
    env: { APP_ORIGIN: "http://localhost:3000", ALLOW_INSECURE_LOCALHOST: "true" },
    push: { configured: false, publicKey: null, send: async () => false },
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
  assert.equal(stateBody.household.timeZone, "America/Chicago");
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
  assert.deepEqual(await completed.json(), { removed: true });

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
  });
});

test("static files return MIME types and missing files do not break the server", async (t) => {
  const app = await runningApp(t);
  const root = await app.request("/");
  assert.equal(root.status, 200);
  assert.match(root.headers.get("content-type"), /^text\/html/);
  assert.match(await root.text(), /<!doctype html>/i);

  const missing = await app.request("/missing-static-file.js");
  assert.equal(missing.status, 404);
  assert.equal((await app.request("/")).status, 200);

  for (const [path, type] of [["/app.js", "text/javascript"], ["/styles.css", "text/css"], ["/icon.svg", "image/svg+xml"], ["/manifest.webmanifest", "application/manifest+json"]]) {
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
  const endpoint = "https://push.example.test/subscription";
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
