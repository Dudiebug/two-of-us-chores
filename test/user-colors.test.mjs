import test from "node:test";
import assert from "node:assert/strict";
import { openDatabase, publicState } from "../src/db.mjs";
import { adminRequest } from "../src/admin.mjs";
import { USER_COLORS } from "../src/user-colors.mjs";

test("users have predefined colors that admins can change and group members can read", async () => {
  const db = await openDatabase(":memory:", {
    DYLAN_PASSWORD: "Dylan-password-123!",
    MADY_PASSWORD: "Mady-password-123!",
    HOUSEHOLD_TIMEZONE: "UTC",
  });
  try {
    assert.deepEqual(USER_COLORS, ["teal", "rose", "blue", "violet", "amber", "green"]);
    const initial = publicState(db, "D", { timeZone: "UTC", today: "2026-09-15" }, "legacy");
    assert.equal(initial.users.find((user) => user.id === "D").colorKey, "teal");
    assert.equal(initial.users.find((user) => user.id === "M").colorKey, "rose");

    await adminRequest(db, "D", "PATCH", "/api/admin/users/M", { colorKey: "violet" }, () => {});
    const changed = publicState(db, "D", { timeZone: "UTC", today: "2026-09-15" }, "legacy");
    assert.equal(changed.users.find((user) => user.id === "M").colorKey, "violet");

    await assert.rejects(
      adminRequest(db, "D", "PATCH", "/api/admin/users/M", { colorKey: "#ff00ff" }, () => {}),
      (error) => error.status === 400 && /available user colors/.test(error.message),
    );
  } finally {
    db.close();
  }
});
