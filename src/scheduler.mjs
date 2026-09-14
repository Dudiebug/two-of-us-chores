import { daysBetween, localDateTime, shiftSeries } from "./recurrence.mjs";
import { transaction } from "./db.mjs";

export function rolloverMissed(db, today, now = new Date().toISOString(), groupId = null) {
  const rows = groupId ? db.prepare("SELECT * FROM chores WHERE group_id=? AND next_due < ? ORDER BY id").all(groupId, today)
    : db.prepare("SELECT * FROM chores WHERE next_due < ? ORDER BY id").all(today);
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
      const groups = db.prepare("SELECT id,time_zone FROM groups WHERE archived_at IS NULL").all();
      for (const group of groups) {
      const local = localDateTime(group.time_zone || timeZone, now());
      const shifted = rolloverMissed(db, local.date, now().toISOString(), group.id);
      if (shifted.length) changed(null, group.id);
      const users = db.prepare(`SELECT u.id,u.digest_time,u.missed_alert_time,u.default_reminder_time FROM users u
        JOIN group_members m ON m.user_id=u.id WHERE m.group_id=? AND u.active=1`).all(group.id);
      for (const user of users) {
        const missedSlot = recentSlot(local, user.missed_alert_time);
        if (missedSlot) {
          const chores = db.prepare(`SELECT title FROM chores
            WHERE group_id=? AND assignee_id=? AND missed_count>0 AND next_due<=? ORDER BY next_due,id`).all(group.id, user.id, missedSlot.date);
          if (chores.length) {
            await tryOnce(`missed:${group.id}:${user.id}:${missedSlot.date}`, db, () => send(user.id, "Missed chores", listBody(chores), { groupId: group.id, url: `/app?groupId=${group.id}`, tag: `missed-${group.id}-${missedSlot.date}` }));
          }
        }
        const digestSlot = recentSlot(local, user.digest_time);
        if (digestSlot) {
          const chores = db.prepare(`SELECT title FROM chores
            WHERE group_id=? AND assignee_id=? AND next_due<=? ORDER BY next_due,id`).all(group.id, user.id, digestSlot.date);
          if (chores.length) {
            await tryOnce(`digest:${group.id}:${user.id}:${digestSlot.date}`, db, () => send(user.id, "Today at home", listBody(chores), { groupId: group.id, url: `/app?groupId=${group.id}`, tag: `digest-${group.id}-${digestSlot.date}` }));
          }
        }
        const candidates = db.prepare(`SELECT id,title,next_due,reminder_mode,reminder_time FROM chores
          WHERE group_id=? AND assignee_id=? AND next_due BETWEEN ? AND ? AND reminder_mode!='off' ORDER BY id`).all(group.id, user.id, previousDate(local.date), local.date);
        for (const chore of candidates) {
          const time = chore.reminder_mode === "override" ? chore.reminder_time : user.default_reminder_time;
          const slot = recentSlot(local, time);
          if (slot && chore.next_due === slot.date) {
            await tryOnce(`chore:${group.id}:${user.id}:${chore.id}:${chore.next_due}`, db,
              () => send(user.id, "Chore reminder", chore.title, { groupId: group.id, url: `/app?groupId=${group.id}`, tag: `chore-${group.id}-${chore.id}-${chore.next_due}` }));
          }
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

function recentSlot(local, scheduled) {
  if (!scheduled) return null;
  const [hour, minute] = scheduled.split(":").map(Number);
  const [nowHour, nowMinute] = local.time.split(":").map(Number);
  if (![hour, minute, nowHour, nowMinute].every(Number.isInteger)) return null;
  let elapsed = (nowHour * 60 + nowMinute) - (hour * 60 + minute);
  let date = local.date;
  if (elapsed < 0) { elapsed += 1440; date = previousDate(date); }
  return elapsed <= 60 ? { date } : null;
}

function previousDate(iso) {
  const date = new Date(`${iso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
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
