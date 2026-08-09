import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { TextDecoder } from "node:util";
import { after, before, test } from "node:test";
import { createApp } from "../src/server.mjs";

let app;
let base;
let origin;
let dataDir;
let events;

before(async () => {
  dataDir = await mkdtemp(join(tmpdir(), "two-of-us-integration-"));
  const port = await freePort();
  origin = `http://127.0.0.1:${port}`;
  app = await createApp({
    env: {
      APP_ORIGIN: origin,
      ALLOW_INSECURE_LOCALHOST: "true",
      DATABASE_PATH: join(dataDir, "chores.db"),
      DYLAN_PASSWORD: "dylan-integration-password",
      MADY_PASSWORD: "mady-integration-password",
      HOUSEHOLD_TIMEZONE: "America/Chicago",
    },
    push: { configured: false, publicKey: null, async send() { return false; } },
    now: () => new Date("2024-06-04T17:00:00.000Z"),
  });
  await new Promise((resolve, reject) => {
    app.server.once("error", reject);
    app.server.listen(port, "127.0.0.1", resolve);
  });
  base = origin;
});

after(async () => {
  await events?.close();
  if (app?.server.listening) await new Promise((resolve) => app.server.close(resolve));
  await rm(dataDir, { recursive: true, force: true });
});

test("two authenticated sessions synchronize and enforce mutation safety", async () => {
  const health = await api("/healthz");
  assert.equal(health.status, 200);
  assert.deepEqual(health.body, { ok: true });

  const unauthorized = await api("/api/state");
  assert.equal(unauthorized.status, 401);

  const dylanLogin = await api("/api/session", {
    method: "POST",
    body: { userId: "D", password: "dylan-integration-password" },
  });
  const madyLogin = await api("/api/session", {
    method: "POST",
    body: { userId: "M", password: "mady-integration-password" },
  });
  assert.equal(dylanLogin.status, 200);
  assert.equal(madyLogin.status, 200);
  assert.match(dylanLogin.setCookie, /HttpOnly/);
  assert.match(dylanLogin.setCookie, /SameSite=Strict/);
  assert.doesNotMatch(dylanLogin.setCookie, /Secure/);
  const dylanCookie = dylanLogin.setCookie.split(";", 1)[0];
  const madyCookie = madyLogin.setCookie.split(";", 1)[0];

  const invalid = await api("/api/chores", {
    method: "POST",
    cookie: dylanCookie,
    body: { title: "", assigneeId: "D", scheduleKind: "once", nextDue: "2099-01-01" },
  });
  assert.equal(invalid.status, 400);
  const crossOrigin = await api("/api/chores", {
    method: "POST",
    cookie: dylanCookie,
    originHeader: "https://evil.example",
    body: choreInput("Cross-origin", "once"),
  });
  assert.equal(crossOrigin.status, 403);

  events = await openEvents(dylanCookie);
  const created = await api("/api/chores", {
    method: "POST",
    cookie: dylanCookie,
    body: choreInput("Laundry", "daily"),
  });
  assert.equal(created.status, 201);
  await events.nextChange();

  let state = await api("/api/state", { cookie: madyCookie });
  assert.equal(state.status, 200);
  assert.equal(state.body.chores[0].title, "Laundry");
  const id = created.body.id;
  const revision = state.body.chores[0].revision;

  const edited = await api(`/api/chores/${id}`, {
    method: "PATCH",
    cookie: madyCookie,
    body: choreInput("Laundry edited", "daily", "M"),
  });
  assert.equal(edited.status, 204);
  await events.nextChange();

  state = await api("/api/state", { cookie: dylanCookie });
  const editedChore = state.body.chores.find((chore) => chore.id === id);
  assert.equal(editedChore.title, "Laundry edited");
  assert.equal(editedChore.assigneeId, "M");

  const completionRevision = editedChore.revision;
  const completions = await Promise.all([
    api(`/api/chores/${id}/complete`, { method: "POST", cookie: dylanCookie, body: { revision: completionRevision } }),
    api(`/api/chores/${id}/complete`, { method: "POST", cookie: madyCookie, body: { revision: completionRevision } }),
  ]);
  assert.deepEqual(completions.map(({ status }) => status).sort(), [200, 409]);
  state = await api("/api/state", { cookie: dylanCookie });
  const completed = state.body.chores.find((chore) => chore.id === id);
  assert.equal(completed.nextDue, "2099-01-02");
  assert.equal(completed.revision, completionRevision + 1);
  assert.equal(state.body.history.length, 1);
  const recurringHistory = state.body.history[0];
  assert.equal(recurringHistory.id, 1);
  assert.equal(recurringHistory.choreId, id);
  assert.equal(recurringHistory.title, "Laundry edited");
  assert.equal(recurringHistory.assigneeId, "M");
  assert.ok(["D", "M"].includes(recurringHistory.completedById));
  assert.equal(recurringHistory.dueDate, "2099-01-01");
  assert.equal(recurringHistory.scheduleKind, "daily");
  assert.equal(recurringHistory.completedAt, "2024-06-04T17:00:00.000Z");
  assert.equal(recurringHistory.completedOn, "2024-06-04");

  const oneTime = await api("/api/chores", {
    method: "POST",
    cookie: dylanCookie,
    body: choreInput("One time", "once"),
  });
  assert.equal(oneTime.status, 201);
  await events.nextChange();
  const oneTimeState = await api("/api/state", { cookie: madyCookie });
  const oneTimeChore = oneTimeState.body.chores.find(({ id }) => id === oneTime.body.id);
  const oneTimeComplete = await api(`/api/chores/${oneTime.body.id}/complete`, {
    method: "POST",
    cookie: madyCookie,
    body: { revision: oneTimeChore.revision },
  });
  assert.equal(oneTimeComplete.status, 200);
  assert.deepEqual(oneTimeComplete.body, { removed: true });
  await events.nextChange();
  const afterOneTime = await api("/api/state", { cookie: madyCookie });
  assert.equal(afterOneTime.body.chores.some(({ id }) => id === oneTime.body.id), false);
  assert.equal(afterOneTime.body.history.length, 2);
  assert.deepEqual(afterOneTime.body.history[0], {
    id: 2,
    choreId: oneTime.body.id,
    title: "One time",
    assigneeId: "D",
    completedById: "M",
    dueDate: "2099-01-01",
    scheduleKind: "once",
    completedAt: "2024-06-04T17:00:00.000Z",
    completedOn: "2024-06-04",
  });
  assert.equal(afterOneTime.body.history[1].choreId, id);

  const removed = await api(`/api/chores/${id}`, { method: "DELETE", cookie: dylanCookie });
  assert.equal(removed.status, 204);
  const loggedOut = await api("/api/session", { method: "DELETE", cookie: madyCookie });
  assert.equal(loggedOut.status, 204);
  assert.equal((await api("/api/state", { cookie: madyCookie })).status, 401);
  assert.equal(revision, 1);
});

function choreInput(title, scheduleKind, assigneeId = "D") {
  return {
    title,
    assigneeId,
    scheduleKind,
    scheduleInterval: 1,
    nextDue: "2099-01-01",
    weekdays: [],
    reminderMode: "off",
  };
}

async function api(path, { method = "GET", cookie, body, originHeader = origin } = {}) {
  const headers = new Headers();
  if (originHeader !== undefined) headers.set("Origin", originHeader);
  if (cookie) headers.set("Cookie", cookie);
  if (method !== "GET" && method !== "HEAD") headers.set("Content-Type", "application/json");
  const response = await fetch(`${base}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let parsed = null;
  if (text) parsed = JSON.parse(text);
  return {
    status: response.status,
    body: parsed,
    setCookie: response.headers.get("set-cookie") || "",
  };
}

async function openEvents(cookie) {
  const response = await fetch(`${base}/api/events`, { headers: { Cookie: cookie } });
  assert.equal(response.status, 200);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  return {
    async nextChange() {
      while (true) {
        const match = buffer.match(/event: change\ndata: ([^\n]+)\n\n/);
        if (match) {
          buffer = buffer.slice(match.index + match[0].length);
          return JSON.parse(match[1]);
        }
        const next = await reader.read();
        if (next.done) throw new Error("SSE stream closed before a change event");
        buffer += decoder.decode(next.value, { stream: true });
      }
    },
    async close() { await reader.cancel(); },
  };
}

async function freePort() {
  const probe = createServer();
  await new Promise((resolve, reject) => {
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", resolve);
  });
  const { port } = probe.address();
  await new Promise((resolve, reject) => probe.close((error) => error ? reject(error) : resolve()));
  return port;
}
