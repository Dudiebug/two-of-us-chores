import test from "node:test";
import assert from "node:assert/strict";
import { openDatabase } from "../src/db.mjs";
import { createApp } from "../src/server.mjs";

const ORIGIN = "http://localhost:3000";
const PASSWORDS = { DYLAN_PASSWORD: "dylan-test-password", MADY_PASSWORD: "mady-test-password" };

test("a normal user can change their own predefined color in Settings", async (t) => {
  const db = await openDatabase(":memory:", PASSWORDS);
  const app = await createApp({
    db,
    env: { APP_ORIGIN: ORIGIN, ALLOW_INSECURE_LOCALHOST: "true" },
    push: { configured: false, publicKey: null, send: async () => false },
  });
  await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => app.server.close(resolve)));
  const base = `http://127.0.0.1:${app.server.address().port}`;

  assert.equal(db.prepare("SELECT is_admin FROM users WHERE id='M'").get().is_admin, 0, "Mady must be a non-admin for this test");

  const login = await fetch(base + "/api/session", {
    method: "POST",
    headers: { Origin: ORIGIN, "Content-Type": "application/json" },
    body: JSON.stringify({ username: "mady", password: PASSWORDS.MADY_PASSWORD }),
  });
  assert.equal(login.status, 200);
  const cookie = login.headers.get("set-cookie")?.split(";", 1)[0];
  assert.ok(cookie);

  const patch = (colorKey) => fetch(base + "/api/settings", {
    method: "PATCH",
    headers: { Origin: ORIGIN, "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify({ colorKey }),
  });

  assert.equal((await patch("green")).status, 204);
  let state = await fetch(base + "/api/state", { headers: { Cookie: cookie } });
  assert.equal(state.status, 200);
  state = await state.json();
  assert.equal(state.user.colorKey, "green");
  assert.equal(state.users.find((user) => user.id === "M").colorKey, "green");

  const invalid = await patch("#ff00ff");
  assert.equal(invalid.status, 400);
  assert.match((await invalid.json()).error, /available user colors/);
  assert.equal(db.prepare("SELECT color_key FROM users WHERE id='M'").get().color_key, "green");
});
