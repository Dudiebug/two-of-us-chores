export const USER_COLORS = Object.freeze(["teal", "rose", "blue", "violet", "amber", "green"]);

export function validateUserColor(value) {
  const key = String(value || "").trim().toLowerCase();
  if (!USER_COLORS.includes(key)) {
    throw Object.assign(new Error("Choose one of the available user colors"), { status: 400 });
  }
  return key;
}

export function ensureUserColors(db) {
  const exists = db.prepare("SELECT 1 FROM pragma_table_info('users') WHERE name='color_key'").get();
  if (!exists) {
    db.exec(`ALTER TABLE users ADD COLUMN color_key TEXT NOT NULL DEFAULT 'teal'
      CHECK(color_key IN ('teal','rose','blue','violet','amber','green'))`);
    // Preserve the previous two-person visual distinction on upgraded installs.
    db.exec("UPDATE users SET color_key='rose' WHERE id='M' OR lower(username)='mady'");
  }
}
