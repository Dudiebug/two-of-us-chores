import test from "node:test";
import assert from "node:assert/strict";
import { openDatabase } from "../src/db.mjs";
import { createFcm, createFcmSender, validFcmToken } from "../src/fcm.mjs";

const PASSWORDS = { DYLAN_PASSWORD: "dylan-test-password", MADY_PASSWORD: "mady-test-password" };
const TOKEN = "fcm-token:abcdefghijklmnopqrstuvwxyz0123456789";

async function fixture(t) {
  const db = await openDatabase(":memory:", PASSWORDS);
  t.after(() => db.close());
  db.prepare(`INSERT INTO sessions(token_hash,user_id,expires_at,created_at) VALUES ('session','D','2099-01-01','2026-01-01')`).run();
  db.prepare(`INSERT INTO native_devices(token_hash,user_id,session_hash,device_id,fcm_token,created_at,updated_at)
    VALUES ('native','D','session','android-phone',?,'2026-01-01','2026-01-01')`).run(TOKEN);
  return db;
}

test("FCM sender emits an immediate high-priority data message", async (t) => {
  const db = await fixture(t);
  const sent = [];
  const fcm = createFcmSender(db, async (...args) => { sent.push(args); });
  assert.equal(await fcm.send("D", { id: 42, title: "Chore completed", body: "Bins", url: "/app?groupId=legacy", tag: "activity-42", groupId: "legacy" }), true);
  assert.deepEqual(sent, [[TOKEN, {
    data: { eventId: "42", title: "Chore completed", body: "Bins", url: "/app?groupId=legacy", tag: "activity-42", groupId: "legacy" },
    android: { priority: "HIGH", ttl: "604800s" },
  }]]);
});

test("FCM sender removes only an unregistered Firebase token and keeps polling fallback", async (t) => {
  const db = await fixture(t);
  const fcm = createFcmSender(db, async () => {
    throw { response: { data: { error: { details: [{ errorCode: "UNREGISTERED" }] } } } };
  });
  assert.equal(await fcm.send("D", { id: 1, title: "Chores", body: "Test" }), false);
  const device = db.prepare("SELECT token_hash,fcm_token FROM native_devices WHERE user_id='D'").get();
  assert.equal(device.token_hash, "native");
  assert.equal(device.fcm_token, null);
});

test("FCM sender preserves tokens on transient delivery failures", async (t) => {
  const db = await fixture(t);
  const error = new Error("temporary outage");
  const fcm = createFcmSender(db, async () => { throw error; });
  await assert.rejects(fcm.send("D", { id: 1, title: "Chores", body: "Test" }), error);
  assert.equal(db.prepare("SELECT fcm_token FROM native_devices WHERE user_id='D'").get().fcm_token, TOKEN);
});

test("FCM configuration is opt-in and token validation is bounded", async (t) => {
  const db = await fixture(t);
  assert.equal(createFcm(db, {}).configured, false);
  assert.throws(() => createFcm(db, { FIREBASE_SERVICE_ACCOUNT_PATH: "relative.json" }), /absolute path/);
  assert.equal(validFcmToken(TOKEN), true);
  assert.equal(validFcmToken("short"), false);
  assert.equal(validFcmToken("x".repeat(4097)), false);
});
