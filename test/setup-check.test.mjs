import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { openDatabase } from "../src/db.mjs";
import { createApp } from "../src/server.mjs";
import { checkEndpoint } from "../deploy/check-setup.mjs";

async function listen(t, server) {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => { server.closeAllConnections(); server.close(resolve); }));
  return `http://127.0.0.1:${server.address().port}`;
}

test("setup check exercises the real login origin gate without credentials or sessions", async (t) => {
  const db = await openDatabase(":memory:", { D: "dylan-test-password", M: "mady-test-password" });
  const app = await createApp({ db, env: { APP_ORIGIN: "https://chores.example.com" }, push: { configured: false, send: async () => false } });
  const upstream = await listen(t, app.server);
  assert.equal((await checkEndpoint(upstream, "https://chores.example.com")).ok, true);
  const bad = await checkEndpoint(upstream, "https://wrong.example.com");
  assert.equal(bad.ok, false);
  assert.match(bad.message, /origin/i);
  assert.match(bad.message, /https:\/\/chores.example.com/);
  assert.equal(db.prepare("SELECT count(*) AS n FROM sessions").get().n, 0);
  for (let i = 0; i < 10; i++) assert.equal((await checkEndpoint(upstream, "https://chores.example.com")).ok, true);
  const login = await fetch(`${upstream}/api/session`, { method: "POST", headers: { Origin: "https://chores.example.com", "Content-Type": "application/json" }, body: JSON.stringify({ userId: "D", password: "dylan-test-password" }) });
  assert.equal(login.status, 200);
  assert.match(login.headers.get("set-cookie"), /Secure/);
});

test("setup check rejects missing/rewritten Origin through a real HTTP proxy", async (t) => {
  const db = await openDatabase(":memory:", { D: "dylan-test-password", M: "mady-test-password" });
  const app = await createApp({ db, env: { APP_ORIGIN: "https://chores.example.com" }, push: { configured: false, send: async () => false } });
  const upstream = await listen(t, app.server);
  let preserve = true;
  const proxy = createServer(async (req, res) => {
    const headers = { "Content-Type": "application/json", "X-Forwarded-Proto": "https" };
    if (preserve && req.headers.origin) headers.Origin = req.headers.origin;
    const response = await fetch(upstream + req.url, { method: req.method, headers, ...(req.method === "POST" ? { body: "{}" } : {}) });
    res.writeHead(response.status, { "Content-Type": "application/json" });
    res.end(await response.text());
  });
  const url = await listen(t, proxy);
  assert.equal((await checkEndpoint(url, "https://chores.example.com")).ok, true);
  preserve = false;
  assert.equal((await checkEndpoint(url, "https://chores.example.com")).ok, false);
});

test("setup check fails closed on redirects, unrelated health responses and stopped services", async (t) => {
  for (const [status, body] of [[302, ""], [200, "<html>different app</html>"], [200, '{"ok":false}']]) {
    const server = createServer((_req, res) => { res.writeHead(status, { Location: "https://other.example.com" }); res.end(body); });
    const url = await listen(t, server);
    assert.equal((await checkEndpoint(url, "https://chores.example.com")).ok, false);
  }
  const stopped = createServer();
  await new Promise((resolve) => stopped.listen(0, "127.0.0.1", resolve));
  const port = stopped.address().port;
  await new Promise((resolve) => stopped.close(resolve));
  assert.equal((await checkEndpoint(`http://127.0.0.1:${port}`, "https://chores.example.com")).ok, false);
});
