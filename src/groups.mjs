import { randomUUID } from "node:crypto";
import { passwordHash } from "./security.mjs";

export const SCHEMA_VERSION = 7;
export const fail = (status, message) => Object.assign(new Error(message), { status });
export const usernameKey = (value) => String(value || "").trim().toLowerCase();
export function validateUsername(value) {
  const key = usernameKey(value);
  if (!/^[a-z0-9][a-z0-9._-]{2,39}$/.test(key)) throw fail(400, "Username must be 3–40 letters, numbers, dots, underscores or hyphens.");
  return key;
}
export function validateName(value) {
  if (typeof value !== "string" || !value.trim() || value.trim().length > 80 || /[\x00-\x1f\x7f]/.test(value)) throw fail(400, "Name must be 1–80 characters.");
  return value.trim();
}
export function validateZone(value) {
  if (typeof value !== "string" || value.length > 100) throw fail(400, "Invalid timezone");
  try { new Intl.DateTimeFormat("en", { timeZone: value }); } catch { throw fail(400, "Invalid timezone"); }
  return value;
}
export function migrateGroups(db, timeZone) {
  const oldVersion = db.prepare("PRAGMA user_version").get().user_version;
  if (oldVersion > SCHEMA_VERSION) throw new Error("Database is newer than this application. Restore a matching release.");
  if (db.prepare("SELECT 1 FROM pragma_table_info('users') WHERE name='username'").get()) { db.exec(`PRAGMA user_version=${SCHEMA_VERSION}`); return; }
  // SQLite's documented rebuild procedure: disable FKs outside the transaction,
  // copy to a new table, replace it without renaming the OLD table, then check.
  db.exec("PRAGMA foreign_keys=OFF; BEGIN IMMEDIATE;");
  try {
    db.exec(`CREATE TABLE users_v7 (
      id TEXT PRIMARY KEY, username TEXT NOT NULL COLLATE NOCASE UNIQUE,
      name TEXT NOT NULL, initial TEXT NOT NULL,
      password_salt TEXT NOT NULL, password_hash TEXT NOT NULL,
      digest_time TEXT, missed_alert_time TEXT, default_reminder_time TEXT,
      activity_notifications INTEGER NOT NULL DEFAULT 1 CHECK(activity_notifications IN (0,1)),
      updated_at TEXT NOT NULL,
      is_admin INTEGER NOT NULL DEFAULT 0 CHECK(is_admin IN (0,1)),
      active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1))
    ) STRICT;
    INSERT INTO users_v7 SELECT id,lower(name),name,initial,password_salt,password_hash,
      digest_time,missed_alert_time,default_reminder_time,activity_notifications,updated_at,
      CASE WHEN id='D' THEN 1 ELSE 0 END,1 FROM users;
    DROP TABLE users;
    ALTER TABLE users_v7 RENAME TO users;
    CREATE TABLE groups (
      id TEXT PRIMARY KEY, name TEXT NOT NULL COLLATE NOCASE UNIQUE,
      time_zone TEXT NOT NULL, archived_at TEXT, created_at TEXT NOT NULL
    ) STRICT;
    CREATE TABLE group_members (
      group_id TEXT NOT NULL REFERENCES groups(id), user_id TEXT NOT NULL REFERENCES users(id),
      joined_at TEXT NOT NULL, PRIMARY KEY(group_id,user_id)
    ) STRICT;
    CREATE TABLE admin_audit (
      id INTEGER PRIMARY KEY AUTOINCREMENT, actor_id TEXT REFERENCES users(id),
      action TEXT NOT NULL, target_id TEXT NOT NULL, created_at TEXT NOT NULL
    ) STRICT;`);
    if (db.prepare("SELECT 1 FROM users LIMIT 1").get()) {
      const now = new Date().toISOString();
      db.prepare("INSERT INTO groups(id,name,time_zone,created_at) VALUES ('legacy','Home',?,?)").run(validateZone(timeZone), now);
      db.prepare("INSERT INTO group_members SELECT 'legacy',id,? FROM users").run(now);
    }
    for (const table of ["chores", "completion_history"]) {
      db.exec(`ALTER TABLE ${table} ADD COLUMN group_id TEXT NOT NULL DEFAULT 'legacy' REFERENCES groups(id);
        CREATE INDEX ${table}_group ON ${table}(group_id,id);`);
    }
    db.exec(`ALTER TABLE native_notification_events ADD COLUMN group_id TEXT REFERENCES groups(id);
      UPDATE native_notification_events SET group_id='legacy' WHERE EXISTS(SELECT 1 FROM groups WHERE id='legacy');
      UPDATE completion_history SET undo_snapshot=json_set(undo_snapshot,'$.group_id',group_id) WHERE undo_snapshot IS NOT NULL;
      CREATE INDEX memberships_user ON group_members(user_id,group_id);`);
    if (db.prepare("SELECT 1 FROM groups WHERE id='legacy'").get()) {
      db.exec(`UPDATE notification_markers SET marker_key=
        substr(marker_key,1,instr(marker_key,':')) || 'legacy:' || substr(marker_key,instr(marker_key,':')+1)
        WHERE marker_key LIKE 'digest:%' OR marker_key LIKE 'missed:%' OR marker_key LIKE 'chore:%'`);
    }
    if (db.prepare("PRAGMA foreign_key_check").all().length) throw new Error("Group migration failed foreign key validation");
    db.exec(`PRAGMA user_version=${SCHEMA_VERSION}; COMMIT;`);
  } catch (error) { db.exec("ROLLBACK"); throw error; }
  finally { db.exec("PRAGMA foreign_keys=ON"); }
}
export function groupsForUser(db, userId) {
  return db.prepare(`SELECT g.id,g.name,g.time_zone AS timeZone FROM groups g
    JOIN group_members m ON m.group_id=g.id JOIN users u ON u.id=m.user_id
    WHERE m.user_id=? AND u.active=1 AND g.archived_at IS NULL ORDER BY g.created_at,g.id`).all(userId);
}
export function requireGroup(db, userId, groupId = null) {
  const groups = groupsForUser(db, userId);
  const group = groupId ? groups.find((g) => g.id === groupId) : groups[0];
  if (!group) throw fail(404, "Group not found");
  return group;
}
export function requireAssignee(db, groupId, userId) {
  if (!db.prepare(`SELECT 1 FROM group_members m JOIN users u ON u.id=m.user_id
    WHERE m.group_id=? AND m.user_id=? AND u.active=1`).get(groupId, userId)) throw fail(400, "Choose an active member of this group");
}
export function requireAdmin(db, userId) {
  if (!db.prepare("SELECT 1 FROM users WHERE id=? AND active=1 AND is_admin=1").get(userId)) throw fail(403, "Administrator access required");
}
export async function makeUser(db, { username, name, password, isAdmin = false }, actorId = null) {
  username = validateUsername(username); name = validateName(name || username);
  if (typeof password !== "string" || password.length < 12 || password.length > 200) throw fail(400, "Password must be 12–200 characters");
  if (typeof isAdmin !== "boolean") throw fail(400, "Invalid administrator setting");
  const hash = await passwordHash(password);
  if (actorId) requireAdmin(db, actorId);
  const id = randomUUID();
  try { db.prepare(`INSERT INTO users(id,username,name,initial,password_salt,password_hash,updated_at,is_admin)
    VALUES (?,?,?,?,?,?,?,?)`).run(id, username, name, [...name][0].toUpperCase(), hash.salt, hash.hash, new Date().toISOString(), Number(isAdmin)); }
  catch (error) { if (/UNIQUE/.test(error.message)) throw fail(409, "Username is already in use"); throw error; }
  audit(db, actorId, "user.create", id);
  return id;
}
export function makeGroup(db, { name, timeZone }, actorId = null) {
  name = validateName(name); timeZone = validateZone(timeZone);
  const id = randomUUID();
  try { db.prepare("INSERT INTO groups(id,name,time_zone,created_at) VALUES (?,?,?,?)").run(id, name, timeZone, new Date().toISOString()); }
  catch (error) { if (/UNIQUE/.test(error.message)) throw fail(409, "Group name is already in use"); throw error; }
  audit(db, actorId, "group.create", id);
  return id;
}
export function audit(db, actorId, action, targetId) {
  db.prepare("INSERT INTO admin_audit(actor_id,action,target_id,created_at) VALUES (?,?,?,?)").run(actorId, action, targetId, new Date().toISOString());
}
