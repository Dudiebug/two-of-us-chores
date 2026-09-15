from pathlib import Path

p = Path("src/db.mjs")
s = p.read_text()

old = 'import { migrateGroups, groupsForUser, requireGroup } from "./groups.mjs";'
new = old + '\nimport { ensureUserColors } from "./user-colors.mjs";'
if new not in s:
    assert old in s
    s = s.replace(old, new, 1)

old = '  migrateGroups(db, passwords.HOUSEHOLD_TIMEZONE || "America/Los_Angeles");\n  return db;'
new = '  migrateGroups(db, passwords.HOUSEHOLD_TIMEZONE || "America/Los_Angeles");\n  ensureUserColors(db);\n  return db;'
if new not in s:
    assert old in s
    s = s.replace(old, new, 1)

old = '  const user = db.prepare(`SELECT id,username,name,initial,is_admin AS isAdmin,active,digest_time AS digestTime,'
new = '  const user = db.prepare(`SELECT id,username,name,initial,is_admin AS isAdmin,active,color_key AS colorKey,digest_time AS digestTime,'
if new not in s:
    assert old in s
    s = s.replace(old, new, 1)

old = 'users: group ? db.prepare(`SELECT u.id,u.name,u.initial,u.active FROM users u JOIN group_members m ON m.user_id=u.id WHERE m.group_id=? ORDER BY u.name,u.id`).all(group.id) : [],'
new = 'users: group ? db.prepare(`SELECT u.id,u.name,u.initial,u.active,u.color_key AS colorKey FROM users u JOIN group_members m ON m.user_id=u.id WHERE m.group_id=? ORDER BY u.name,u.id`).all(group.id) : [],'
if new not in s:
    assert old in s
    s = s.replace(old, new, 1)

p.write_text(s)
print("Applied user color migration and public-state fields to src/db.mjs")
