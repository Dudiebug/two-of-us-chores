import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { passwordHash } from "./security.mjs";
import { migrateGroups, groupsForUser, requireGroup } from "./groups.mjs";

const SCHEMA_VERSION = 6;

// The same eligibility rule serves the UI and the transactional undo guard.
export const CAN_UNDO = `undo_snapshot IS NOT NULL AND (
  (schedule_kind='once' AND NOT EXISTS (SELECT 1 FROM chores WHERE id=chore_id)) OR
  (schedule_kind!='once' AND EXISTS (SELECT 1 FROM chores WHERE id=chore_id AND revision=undo_revision))
)`;

export async function openDatabase(path, passwords = {}) {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path, {
    enableForeignKeyConstraints: true,
    timeout: 5_000,
    defensive: true,
  });
  db.exec("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000; PRAGMA trusted_schema=OFF;");
  if (db.prepare("PRAGMA user_version").get().user_version > 7) throw new Error("Database requires a newer Chores release");
  ensureSchema(db, false);
  await seedUsers(db, passwords);
  ensureSchema(db);
  migrateGroups(db, passwords.HOUSEHOLD_TIMEZONE || "America/Los_Angeles");
  return db;
}

function ensureSchema(db, includeChores = true) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY CHECK(id IN ('D','M')),
      name TEXT NOT NULL UNIQUE,
      initial TEXT NOT NULL UNIQUE,
      password_salt TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      digest_time TEXT,
      missed_alert_time TEXT,
      default_reminder_time TEXT,
      activity_notifications INTEGER NOT NULL DEFAULT 1 CHECK(activity_notifications IN (0,1)),
      updated_at TEXT NOT NULL
    ) STRICT;
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL
    ) STRICT;
    CREATE TABLE IF NOT EXISTS push_subscriptions (
      endpoint TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      session_hash TEXT,
      p256dh TEXT NOT NULL,
      auth TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    ) STRICT;
    CREATE TABLE IF NOT EXISTS notification_markers (
      marker_key TEXT PRIMARY KEY,
      sent_at TEXT NOT NULL
    ) STRICT;
    CREATE TABLE IF NOT EXISTS native_devices (
      token_hash TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      session_hash TEXT NOT NULL REFERENCES sessions(token_hash) ON DELETE CASCADE,
      device_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(user_id,device_id)
    ) STRICT;
    CREATE TABLE IF NOT EXISTS native_notification_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      url TEXT NOT NULL DEFAULT '/app',
      tag TEXT,
      created_at TEXT NOT NULL
    ) STRICT;
  `);
  ensureColumn(db, "users", "activity_notifications", "INTEGER NOT NULL DEFAULT 1 CHECK(activity_notifications IN (0,1))");
  ensureColumn(db, "push_subscriptions", "session_hash", "TEXT");
  db.exec("DELETE FROM push_subscriptions WHERE session_hash IS NULL");

  if (!includeChores) return;

  const existing = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='chores'").get();
  if (existing && !String(existing.sql).includes("'every'")) migrateChores(db);
  else createChoresTable(db);
  createCompletionHistoryTable(db);
  transaction(db, () => {
    ensureColumn(db, "completion_history", "undo_snapshot", "TEXT");
    ensureColumn(db, "completion_history", "undo_revision", "INTEGER");
    for (const [table, create] of [["chores", createChoresTable], ["completion_history", createCompletionHistoryTable]]) {
      const sql = db.prepare("SELECT sql FROM sqlite_master WHERE name=?").get(table).sql;
      if (sql.includes("AUTOINCREMENT")) continue;
      db.exec(`ALTER TABLE ${table} RENAME TO ${table}_before_v5`);
      create(db);
      const columns = db.prepare(`PRAGMA table_info(${table}_before_v5)`).all().map(({name}) => name).join(",");
      db.exec(`INSERT INTO ${table} (${columns}) SELECT ${columns} FROM ${table}_before_v5; DROP TABLE ${table}_before_v5`);
    }
    // Completed one-time chores may have higher IDs than any remaining live row.
    const maximum = db.prepare("SELECT MAX(id) AS id FROM (SELECT id FROM chores UNION ALL SELECT chore_id AS id FROM completion_history)").get().id || 0;
    if (!db.prepare("SELECT 1 FROM sqlite_sequence WHERE name='chores'").get()) {
      db.prepare("INSERT INTO sqlite_sequence(name,seq) VALUES ('chores',?)").run(maximum);
    } else db.prepare("UPDATE sqlite_sequence SET seq=MAX(seq,?) WHERE name='chores'").run(maximum);
    db.exec(`
      CREATE INDEX IF NOT EXISTS history_chore ON completion_history(chore_id);
      CREATE TRIGGER IF NOT EXISTS invalidate_undo_update AFTER UPDATE ON chores BEGIN
        UPDATE completion_history SET undo_snapshot=NULL,undo_revision=NULL WHERE chore_id=OLD.id;
      END;
      CREATE TRIGGER IF NOT EXISTS invalidate_undo_delete AFTER DELETE ON chores BEGIN
        UPDATE completion_history SET undo_snapshot=NULL,undo_revision=NULL WHERE chore_id=OLD.id;
      END;
    `);
  });

  db.exec(`
    CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires_at);
    CREATE INDEX IF NOT EXISTS chores_due ON chores(next_due);
    CREATE INDEX IF NOT EXISTS subscriptions_user ON push_subscriptions(user_id);
    CREATE INDEX IF NOT EXISTS native_devices_user ON native_devices(user_id);
    CREATE INDEX IF NOT EXISTS native_events_user_id ON native_notification_events(user_id,id);

  `);
}

function ensureColumn(db, table, column, definition) {
  if (!db.prepare(`SELECT 1 FROM pragma_table_info(?) WHERE name=?`).get(table, column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

function createChoresTable(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS chores (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL CHECK(length(title) BETWEEN 1 AND 120),
      assignee_id TEXT NOT NULL REFERENCES users(id),
      schedule_kind TEXT NOT NULL CHECK(schedule_kind IN ('once','daily','every','weekly','monthly')),
      schedule_interval INTEGER NOT NULL CHECK(schedule_interval BETWEEN 1 AND 365),
      next_due TEXT NOT NULL,
      anchor_date TEXT NOT NULL,
      weekdays_mask INTEGER NOT NULL DEFAULT 0 CHECK(weekdays_mask BETWEEN 0 AND 127),
      month_day INTEGER CHECK(month_day IS NULL OR month_day BETWEEN 1 AND 31),
      reminder_mode TEXT NOT NULL DEFAULT 'inherit' CHECK(reminder_mode IN ('inherit','override','off')),
      reminder_time TEXT,
      missed_count INTEGER NOT NULL DEFAULT 0 CHECK(missed_count >= 0),
      last_completed_at TEXT,
      last_completed_by TEXT REFERENCES users(id),
      revision INTEGER NOT NULL DEFAULT 1 CHECK(revision >= 1),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
      ${db.prepare("SELECT 1 FROM sqlite_master WHERE name='groups'").get() ? ",group_id TEXT NOT NULL DEFAULT 'legacy' REFERENCES groups(id)" : ""}
    ) STRICT;
  `);
}

function createCompletionHistoryTable(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS completion_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chore_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      assignee_id TEXT NOT NULL REFERENCES users(id),
      completed_by_id TEXT NOT NULL REFERENCES users(id),
      due_date TEXT NOT NULL,
      schedule_kind TEXT NOT NULL CHECK(schedule_kind IN ('once','daily','every','weekly','monthly')),
      completed_at TEXT NOT NULL,
      completed_on TEXT NOT NULL,
      undo_snapshot TEXT,
      undo_revision INTEGER
      ${db.prepare("SELECT 1 FROM sqlite_master WHERE name='groups'").get() ? ",group_id TEXT NOT NULL DEFAULT 'legacy' REFERENCES groups(id)" : ""}
    ) STRICT;
  `);
}

function migrateChores(db) {
  transaction(db, () => {
    db.exec("ALTER TABLE chores RENAME TO chores_before_v2");
    createChoresTable(db);
    db.exec(`INSERT INTO chores
      (id,title,assignee_id,schedule_kind,schedule_interval,next_due,anchor_date,weekdays_mask,month_day,
       reminder_mode,reminder_time,missed_count,last_completed_at,last_completed_by,revision,created_at,updated_at)
      SELECT id,title,assignee_id,schedule_kind,schedule_interval,next_due,anchor_date,weekdays_mask,month_day,
       reminder_mode,reminder_time,missed_count,last_completed_at,last_completed_by,revision,created_at,updated_at
      FROM chores_before_v2`);
    db.exec("DROP TABLE chores_before_v2");
  });
}

async function seedUsers(db, passwords) {
  // Compatibility bootstrap for existing deployments/test fixtures only. New installs use deploy/bootstrap.mjs.
  if (db.prepare("SELECT COUNT(*) AS n FROM users").get().n) return;
  if (!(passwords.DYLAN_PASSWORD || passwords.D) && !(passwords.MADY_PASSWORD || passwords.M)) return;
  const definitions = [
    ["D", "Dylan", passwords.DYLAN_PASSWORD ?? passwords.D],
    ["M", "Mady", passwords.MADY_PASSWORD ?? passwords.M],
  ];
  const missing = definitions.filter(([id]) => !db.prepare("SELECT 1 FROM users WHERE id=?").get(id));
  for (const [, name, password] of missing) {
    if (!password) throw new Error(`${name.toUpperCase()}_PASSWORD is required on first run`);
  }
  const hashed = await Promise.all(missing.map(async ([id, name, password]) => [id, name, await passwordHash(password)]));
  if (!hashed.length) return;
  const now = new Date().toISOString();
  transaction(db, () => {
    const insert = db.prepare(`INSERT INTO users
      (id,name,initial,password_salt,password_hash,updated_at) VALUES (?,?,?,?,?,?)`);
    for (const [id, name, value] of hashed) insert.run(id, name, id, value.salt, value.hash, now);
  });
}

export function transaction(db, fn) {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = fn();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    try { db.exec("ROLLBACK"); } catch {}
    throw error;
  }
}

export function publicState(db, userId, household = {}, selectedGroup = null) {
  const groups = groupsForUser(db, userId);
  const group = selectedGroup ? requireGroup(db, userId, selectedGroup) : groups[0] || null;
  const groupId = group?.id || null;
  const user = db.prepare(`SELECT id,username,name,initial,is_admin AS isAdmin,active,digest_time AS digestTime,
    missed_alert_time AS missedAlertTime,default_reminder_time AS defaultReminderTime,activity_notifications AS activityNotifications
    FROM users WHERE id=?`).get(userId);
  const chores = db.prepare(`SELECT id,group_id AS groupId,title,assignee_id AS assigneeId,schedule_kind AS scheduleKind,
    schedule_interval AS scheduleInterval,next_due AS nextDue,anchor_date AS anchorDate,
    weekdays_mask AS weekdaysMask,month_day AS monthDay,reminder_mode AS reminderMode,
    reminder_time AS reminderTime,missed_count AS missedCount,last_completed_at AS lastCompletedAt,
    last_completed_by AS lastCompletedBy,revision,created_at AS createdAt,updated_at AS updatedAt
    FROM chores WHERE group_id=? ORDER BY next_due,id`).all(groupId);
  const history = db.prepare(`SELECT id,chore_id AS choreId,title,assignee_id AS assigneeId,
    completed_by_id AS completedById,due_date AS dueDate,schedule_kind AS scheduleKind,
    completed_at AS completedAt,completed_on AS completedOn,(${CAN_UNDO}) AS canUndo
    FROM completion_history WHERE group_id=? ORDER BY completed_at DESC,id DESC`).all(groupId).map((row) => ({ ...row, canUndo: Boolean(row.canUndo) }));
  return {
    user,
    groups, activeGroup: group,
    users: group ? db.prepare(`SELECT u.id,u.name,u.initial,u.active FROM users u JOIN group_members m ON m.user_id=u.id WHERE m.group_id=? ORDER BY u.name,u.id`).all(group.id) : [],
    chores,
    history,
    household,
  };
}
