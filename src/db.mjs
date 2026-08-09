import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { passwordHash } from "./security.mjs";

const SCHEMA_VERSION = 3;

export async function openDatabase(path, passwords = {}) {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path, {
    enableForeignKeyConstraints: true,
    timeout: 5_000,
    defensive: true,
  });
  db.exec("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000; PRAGMA trusted_schema=OFF;");
  ensureSchema(db, false);
  await seedUsers(db, passwords);
  ensureSchema(db);
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
      p256dh TEXT NOT NULL,
      auth TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    ) STRICT;
    CREATE TABLE IF NOT EXISTS notification_markers (
      marker_key TEXT PRIMARY KEY,
      sent_at TEXT NOT NULL
    ) STRICT;
  `);

  if (!includeChores) return;

  const existing = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='chores'").get();
  if (existing && !String(existing.sql).includes("'every'")) migrateChores(db);
  else createChoresTable(db);
  createCompletionHistoryTable(db);

  db.exec(`
    CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires_at);
    CREATE INDEX IF NOT EXISTS chores_due ON chores(next_due);
    CREATE INDEX IF NOT EXISTS subscriptions_user ON push_subscriptions(user_id);
    PRAGMA user_version=${SCHEMA_VERSION};
  `);
}

function createChoresTable(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS chores (
      id INTEGER PRIMARY KEY,
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
    ) STRICT;
  `);
}

function createCompletionHistoryTable(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS completion_history (
      id INTEGER PRIMARY KEY,
      chore_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      assignee_id TEXT NOT NULL REFERENCES users(id),
      completed_by_id TEXT NOT NULL REFERENCES users(id),
      due_date TEXT NOT NULL,
      schedule_kind TEXT NOT NULL CHECK(schedule_kind IN ('once','daily','every','weekly','monthly')),
      completed_at TEXT NOT NULL,
      completed_on TEXT NOT NULL
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

export function publicState(db, userId, household = {}) {
  const user = db.prepare(`SELECT id,name,initial,digest_time AS digestTime,
    missed_alert_time AS missedAlertTime,default_reminder_time AS defaultReminderTime
    FROM users WHERE id=?`).get(userId);
  const chores = db.prepare(`SELECT id,title,assignee_id AS assigneeId,schedule_kind AS scheduleKind,
    schedule_interval AS scheduleInterval,next_due AS nextDue,anchor_date AS anchorDate,
    weekdays_mask AS weekdaysMask,month_day AS monthDay,reminder_mode AS reminderMode,
    reminder_time AS reminderTime,missed_count AS missedCount,last_completed_at AS lastCompletedAt,
    last_completed_by AS lastCompletedBy,revision,created_at AS createdAt,updated_at AS updatedAt
    FROM chores ORDER BY next_due,id`).all();
  const history = db.prepare(`SELECT id,chore_id AS choreId,title,assignee_id AS assigneeId,
    completed_by_id AS completedById,due_date AS dueDate,schedule_kind AS scheduleKind,
    completed_at AS completedAt,completed_on AS completedOn
    FROM completion_history ORDER BY completed_at DESC,id DESC`).all();
  return {
    user,
    users: [{ id: "D", name: "Dylan", initial: "D" }, { id: "M", name: "Mady", initial: "M" }],
    chores,
    history,
    household,
  };
}
