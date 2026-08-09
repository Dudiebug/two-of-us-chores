import { daysBetween, localDateTime, shiftSeries } from "./recurrence.mjs";
import { transaction } from "./db.mjs";

export function rolloverMissed(db, today, now = new Date().toISOString()) {
  const rows = db.prepare("SELECT * FROM chores WHERE next_due < ? ORDER BY id").all(today);
  if (!rows.length) return [];
  return transaction(db, () => rows.map((row) => {
    const days = daysBetween(row.next_due, today);
    const next = shiftSeries(row, days);
    db.prepare(`UPDATE chores SET next_due=?,anchor_date=?,weekdays_mask=?,month_day=?,missed_count=?,
      revision=revision+1,updated_at=? WHERE id=? AND revision=?`)
      .run(next.next_due, next.anchor_date, next.weekdays_mask, next.month_day, next.missed_count, now, row.id, row.revision);
    return { ...next, id: row.id, days };
  }));
}

export function createScheduler({ db, timeZone, send, changed = () => {}, now = () => new Date() }) {
  let running = false;

  async function tick() {
    if (running) return;
    running = true;
    try {
      const local = localDateTime(timeZone, now());
      const shifted = rolloverMissed(db, local.date);
      if (shifted.length) changed();
      const users = db.prepare("SELECT id,digest_time,missed_alert_time,default_reminder_time FROM users").all();
      for (const user of users) {
        if (user.missed_alert_time === local.time) {
          const chores = db.prepare(`SELECT title FROM chores
            WHERE assignee_id=? AND missed_count>0 AND next_due<=? ORDER BY next_due,id`).all(user.id, local.date);
          if (chores.length) {
            await tryOnce(`missed:${user.id}:${local.date}`, db, () => send(user.id, "Missed chores", listBody(chores)));
          }
        }
        if (user.digest_time === local.time) {
          const chores = db.prepare(`SELECT title FROM chores
            WHERE assignee_id=? AND next_due<=? ORDER BY next_due,id`).all(user.id, local.date);
          if (chores.length) {
            await tryOnce(`digest:${user.id}:${local.date}`, db, () => send(user.id, "Today at home", listBody(chores)));
          }
        }
        const chores = db.prepare(`SELECT id,title,next_due,reminder_mode,reminder_time FROM chores
          WHERE assignee_id=? AND next_due=? AND reminder_mode!='off' ORDER BY id`).all(user.id, local.date);
        for (const chore of chores) {
          const time = chore.reminder_mode === "override" ? chore.reminder_time : user.default_reminder_time;
          if (time === local.time) {
            await tryOnce(`chore:${user.id}:${chore.id}:${chore.next_due}`, db,
              () => send(user.id, "Chore reminder", chore.title));
          }
        }
      }
    } finally {
      running = false;
    }
  }

  const timer = setInterval(() => tick().catch((error) => console.error("scheduler", error)), 60_000);
  timer.unref?.();
  return { tick, stop: () => clearInterval(timer) };
}

export async function tryOnce(key, db, action) {
  if (db.prepare("SELECT 1 FROM notification_markers WHERE marker_key=?").get(key)) return false;
  let sent;
  try {
    sent = await action();
  } catch (error) {
    console.error("notification", error);
    return false;
  }
  if (sent !== false) {
    db.prepare("INSERT OR IGNORE INTO notification_markers(marker_key,sent_at) VALUES (?,?)")
      .run(key, new Date().toISOString());
    return true;
  }
  return false;
}

function listBody(rows) {
  if (!rows.length) return "Nothing due.";
  return rows.length === 1 ? rows[0].title : `${rows.length} chores: ${rows.map(({ title }) => title).join(", ")}`;
}
