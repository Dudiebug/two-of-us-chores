import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { migrateGroups } from '../src/groups.mjs';

test('v6 migration preserves notification deduplication across upgrade and repeated startup', () => {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec(`CREATE TABLE users(id TEXT PRIMARY KEY,name TEXT,initial TEXT,password_salt TEXT,password_hash TEXT,digest_time TEXT,missed_alert_time TEXT,default_reminder_time TEXT,activity_notifications INTEGER,updated_at TEXT);
      INSERT INTO users VALUES ('D','Dylan','D','salt','hash',NULL,NULL,NULL,1,'2026-09-14');
      CREATE TABLE chores(id INTEGER PRIMARY KEY); INSERT INTO chores VALUES (1);
      CREATE TABLE completion_history(id INTEGER PRIMARY KEY,undo_snapshot TEXT);
      CREATE TABLE native_notification_events(id INTEGER PRIMARY KEY);
      CREATE TABLE notification_markers(marker_key TEXT PRIMARY KEY,sent_at TEXT);
      INSERT INTO notification_markers VALUES ('digest:D:2026-09-14','preserved'),('chore:D:1:2026-09-14','preserved'),('other:unchanged','preserved');
      PRAGMA user_version=6;`);
    migrateGroups(db,'UTC');
    const values=db.prepare('SELECT marker_key FROM notification_markers ORDER BY marker_key').all().map(r=>r.marker_key);
    assert.deepEqual(values,['chore:legacy:D:1:2026-09-14','digest:legacy:D:2026-09-14','other:unchanged']);
    migrateGroups(db,'UTC');
    assert.deepEqual(db.prepare('SELECT marker_key FROM notification_markers ORDER BY marker_key').all().map(r=>r.marker_key),values);
    assert.equal(db.prepare("SELECT count(*) AS n FROM notification_markers WHERE sent_at='preserved'").get().n,3);
  } finally { db.close(); }
});
