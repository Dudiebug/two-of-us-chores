import test from "node:test";
import assert from "node:assert/strict";
import { createECDH } from "node:crypto";
import { createPush } from "../src/push.mjs";
import { openDatabase } from "../src/db.mjs";

const PASSWORDS = { DYLAN_PASSWORD: "dylan-test-password", MADY_PASSWORD: "mady-test-password" };

function vapidEnv() {
  const key = createECDH("prime256v1");
  key.generateKeys();
  return {
    VAPID_SUBJECT: "mailto:test@example.com",
    VAPID_PUBLIC_KEY: key.getPublicKey("base64url"),
    VAPID_PRIVATE_KEY: key.getPrivateKey("base64url"),
  };
}

test("expired push cleanup preserves a replaced subscription", async () => {
  const db = await openDatabase(":memory:", PASSWORDS);
  const original = {
    endpoint: "https://push.example.test/original",
    p256dh: Buffer.alloc(65, 1).toString("base64url"),
    auth: Buffer.alloc(16, 2).toString("base64url"),
  };
  const expired = {
    endpoint: "https://push.example.test/expired",
    p256dh: Buffer.alloc(65, 3).toString("base64url"),
    auth: Buffer.alloc(16, 4).toString("base64url"),
  };
  const replacement = {
    p256dh: Buffer.alloc(65, 5).toString("base64url"),
    auth: Buffer.alloc(16, 6).toString("base64url"),
  };
  const now = new Date().toISOString();
  const insert = (row) => db.prepare(`INSERT INTO push_subscriptions
    (endpoint,user_id,p256dh,auth,created_at,updated_at) VALUES (?,?,?,?,?,?)`)
    .run(row.endpoint, "D", row.p256dh, row.auth, now, now);
  insert(original);
  insert(expired);

  try {
    const push = createPush(db, vapidEnv(), async ({ endpoint }) => {
      if (endpoint === original.endpoint) {
        db.prepare("UPDATE push_subscriptions SET user_id='M',p256dh=?,auth=? WHERE endpoint=?")
          .run(replacement.p256dh, replacement.auth, endpoint);
      }
      throw Object.assign(new Error("subscription expired"), { statusCode: 410 });
    });
    assert.equal(await push.send("D", "Missed chores", "Bins"), false);
    const kept = db.prepare("SELECT user_id,p256dh,auth FROM push_subscriptions WHERE endpoint=?").get(original.endpoint);
    assert.equal(kept.user_id, "M");
    assert.equal(kept.p256dh, replacement.p256dh);
    assert.equal(kept.auth, replacement.auth);
    assert.equal(db.prepare("SELECT 1 FROM push_subscriptions WHERE endpoint=?").get(expired.endpoint), undefined);
  } finally {
    db.close();
  }
});
