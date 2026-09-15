import { requireGroup, requireAssignee, groupsForUser, usernameKey } from "./groups.mjs";
import { adminRequest } from "./admin.mjs";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { openDatabase, publicState, transaction, CAN_UNDO } from "./db.mjs";
import { daysBetween, localDateTime, nextOccurrence, normalizeSchedule, shiftSeries } from "./recurrence.mjs";
import { createPush } from "./push.mjs";
import { createScheduler, rolloverMissed } from "./scheduler.mjs";
import { newSession, parseCookies, passwordHash, passwordMatches, sessionCookie, SESSION_COOKIE, tokenHash } from "./security.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const JSON_LIMIT = 32 * 1024;
const SESSION_MS = 30 * 86400_000;
const LOGIN_WINDOW_MS = 15 * 60_000;
const TIME = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const staticCache = new Map();
const PUBLIC_FILES = new Set(["/native-bridge.js", "/login.css", "/login.js", "/manifest.webmanifest", "/icon.svg", "/icon-192.png", "/icon-512.png", "/sw.js", "/offline.html", "/.well-known/assetlinks.json"]);
const PRIVATE_FILES = new Set(["/app.js", "/calendar-recurrence.js", "/styles.css", "/user-colors.css", "/mobile-dialogs.css", "/native-app.js", "/admin.js"]);

export async function createApp(options = {}) {
  const env = { ...process.env, ...options.env };
  const appOrigin = parseOrigin(env.APP_ORIGIN || "http://localhost:3000");
  const localInsecure = appOrigin.startsWith("http://") && /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(appOrigin)
    && env.ALLOW_INSECURE_LOCALHOST === "true";
  if (!appOrigin.startsWith("https://") && !localInsecure) {
    throw new Error("APP_ORIGIN must use HTTPS unless ALLOW_INSECURE_LOCALHOST=true for localhost");
  }

  const db = options.db || await openDatabase(
    env.DATABASE_PATH || join(env.DATA_DIR || join(ROOT, "data"), "chores.db"),
    env,
  );
  if (!db.prepare("SELECT 1 FROM users LIMIT 1").get()) throw new Error("No accounts configured. Run node deploy/bootstrap.mjs before starting Chores.");
  const push = options.push || createPush(db, env);
  const clock = options.now || (() => new Date());
  const clients = new Map();
  const throttle = new Map();
  const broadcast = (targetUserId = null, groupId = null) => {
    for (const [res, client] of clients) {
      if (!db.prepare("SELECT 1 FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND u.active=1 AND s.expires_at>?").get(client.tokenHash, new Date().toISOString()) || !groupsForUser(db, client.userId).some((g) => g.id === client.groupId)) {
        clients.delete(res); res.end(); continue;
      }
      if (targetUserId && client.userId !== targetUserId) continue;
      if (groupId && client.groupId !== groupId) continue;
      try {
        if (!res.writableEnded) res.write(`event: change\ndata: {"at":${Date.now()}}\n\n`);
      } catch {
        clients.delete(res);
      }
    }
  };
  const timeZone = env.HOUSEHOLD_TIMEZONE || "America/Los_Angeles";
  const sendWebPush = push.send.bind(push);
  const send = async (userId, title, body, options = {}) => {
    if (!db.prepare("SELECT 1 FROM users WHERE id=? AND active=1").get(userId)) return false;
    if (options.groupId && !groupsForUser(db, userId).some((g) => g.id === options.groupId)) return false;
    const queued = queueNativeNotification(db, userId, title, body, options);
    let delivered = false;
    try { delivered = await sendWebPush(userId, title, body, options); } catch (error) { if (!queued) throw error; }
    return queued || delivered;
  };
  const notify = (actorId, title, body, key, groupId) => activityNotification(db, send, actorId, title, body, key, groupId);
  const scheduler = createScheduler({ db, timeZone, send, changed: broadcast, now: clock });
  const cleanupTimer = setInterval(() => purgeExpiredSessions(db), 60_000);
  cleanupTimer.unref?.();
  purgeExpiredSessions(db);
  await scheduler.tick();

  const server = createServer(async (req, res) => {
    securityHeaders(res, !localInsecure);
    try {
      const url = new URL(req.url || "/", appOrigin);
      const path = url.pathname;
      if (req.method === "GET" && path === "/healthz") return json(res, 200, { ok: true });
      if (req.method !== "GET" && path.startsWith("/api/")) enforceMutation(req, appOrigin, needsJsonBody(req, path));
      if (req.method === "POST" && path === "/api/session") return await login(req, res, db, localInsecure, throttle);
      if (req.method === "GET" && path === "/api/native-notifications") return nativeNotifications(req, res, db, url);

      const session = authenticate(req, db);
      if (req.method === "GET" && path === "/") return redirect(res, session ? "/app" : "/login");
      if (req.method === "GET" && path === "/login") return session ? redirect(res, "/app") : staticFile("/login.html", res, true);
      if (req.method === "GET" && path === "/app") return session ? staticFile("/index.html", res, false) : redirect(res, "/login");
      if (req.method === "GET" && PUBLIC_FILES.has(path)) return staticFile(path, res, true);
      if (req.method === "GET" && PRIVATE_FILES.has(path)) {
        if (!session) return json(res, 401, { error: "Please sign in" });
        return staticFile(path, res, false);
      }
      if (path.startsWith("/api/") && !session) return json(res, 401, { error: "Please sign in" });
      if (req.method === "DELETE" && path === "/api/session") {
        db.prepare("DELETE FROM push_subscriptions WHERE session_hash=?").run(session.tokenHash);
        db.prepare("DELETE FROM sessions WHERE token_hash=?").run(session.tokenHash);
        closeStreams(clients, (client) => client.tokenHash === session.tokenHash);
        res.setHeader("Set-Cookie", sessionCookie("", !localInsecure, 0));
        return noContent(res);
      }
      if (path.startsWith("/api/admin/")) {
        const data = req.method === "GET" ? null : await readJson(req);
        return json(res, 200, await adminRequest(db, session.userId, req.method, path, data, () => broadcast()));
      }
      const selected = url.searchParams.get("groupId");
      if (req.method === "GET" && path === "/api/state") {
        const group = selected ? requireGroup(db, session.userId, selected) : groupsForUser(db, session.userId)[0];
        const zone = group?.timeZone || timeZone;
        return json(res, 200, publicState(db, session.userId, {
          timeZone: zone, today: localDateTime(zone, clock()).date,
        }, group?.id));
      }
      const groupScoped = path === "/api/events" || path.startsWith("/api/chores") || path.startsWith("/api/history");
      const group = groupScoped ? requireGroup(db, session.userId, selected) : null;
      if (group) req.choreGroupId = group.id;
      const groupChanged = (userId = null) => broadcast(userId, group?.id);
      const groupNotify = (actorId, title, body, key) => notify(actorId, title, body, key, group.id);
      if (req.method === "GET" && path === "/api/events") return events(req, res, { ...session, groupId: group.id }, clients);
      if (req.method === "POST" && path === "/api/native-device") return registerNativeDevice(req, res, db, session);
      if (req.method === "DELETE" && path === "/api/native-device") return removeNativeDevice(req, res, db, session);
      if (req.method === "GET" && path === "/api/push-key") {
        return json(res, 200, { configured: push.configured, publicKey: push.publicKey });
      }
      if (req.method === "POST" && path === "/api/native-test") {
        const body = await readJson(req);
        if (!validNativeDeviceId(body.deviceId) || !db.prepare("SELECT 1 FROM native_devices WHERE device_id=? AND user_id=? AND session_hash=?").get(body.deviceId, session.userId, session.tokenHash)) throw Object.assign(new Error("Enable native notifications first"), { status: 409 });
        queueNativeNotification(db, session.userId, "Chores", "Native notifications are working on this device.", {});
        return noContent(res);
      }
      if (req.method === "POST" && path === "/api/push-test") return await pushTest(res, send, session.userId);
      if (req.method === "POST" && path === "/api/chores") return await createChore(req, res, db, groupChanged, session.userId, groupNotify);
      if (req.method === "PATCH" && /^\/api\/chores\/\d+$/.test(path)) {
        return await editChore(req, res, db, Number(path.split("/").pop()), groupChanged, session.userId, groupNotify, group.id);
      }
      if (req.method === "DELETE" && /^\/api\/chores\/\d+$/.test(path)) {
        return await deleteChore(res, db, Number(path.split("/").pop()), groupChanged, session.userId, groupNotify, group.id);
      }
      if (req.method === "POST" && /^\/api\/chores\/\d+\/complete$/.test(path)) {
        return await completeChore(req, res, db, Number(path.split("/")[3]), session.userId, groupChanged, group.timeZone, clock, groupNotify);
      }
      if (req.method === "POST" && /^\/api\/history\/\d+\/undo$/.test(path)) {
        await readJson(req);
        return await undoCompletion(res, db, Number(path.split("/")[3]), session.userId, groupChanged, clock, groupNotify, group.id);
      }
      if (req.method === "PATCH" && path === "/api/settings") return await updateSettings(req, res, db, session.userId, broadcast);
      if (req.method === "PATCH" && path === "/api/password") return await changePassword(req, res, db, session, clients);
      if (req.method === "PUT" && path === "/api/push-subscriptions") return await putSubscription(req, res, db, session);
      if (req.method === "DELETE" && path === "/api/push-subscriptions") return await removeSubscription(req, res, db, session.userId);
      if (req.method === "GET") throw notFound();
      return json(res, 404, { error: "Not found" });
    } catch (error) {
      const status = error.status || 400;
      if (status >= 500) console.error(error);
      return json(res, status, { error: status >= 500 ? "Server error" : error.message });
    }
  });

  server.on("close", () => {
    scheduler.stop();
    clearInterval(cleanupTimer);
    for (const res of clients.keys()) res.end();
    clients.clear();
    db.close();
  });
  return { server, db, scheduler };
}

async function login(req, res, db, localInsecure, throttle) {
  const body = await readJson(req);
  if (!isRecord(body) || (typeof body.username !== "string" && typeof body.userId !== "string") || typeof body.password !== "string"
    || body.password.length > 200) throw bad("Invalid credentials");
  const name = usernameKey(body.username || body.userId);
  if (!name || name.length > 40) throw bad("Invalid credentials");
  // Bound keys and rate-limit by source too; unknown usernames get the same error.
  if (throttle.size > 10000) throw Object.assign(new Error("Too many attempts. Try again later."), { status: 429 });
  const key = `${req.socket.remoteAddress || "unknown"}`;
  const state = throttle.get(key) || { count: 0, since: Date.now() };
  if (Date.now() - state.since > LOGIN_WINDOW_MS) Object.assign(state, { count: 0, since: Date.now() });
  if (state.count >= 8) throw Object.assign(new Error("Too many attempts. Try again later."), { status: 429 });

  const user = body.username !== undefined ? db.prepare("SELECT * FROM users WHERE username=? COLLATE NOCASE AND active=1").get(name) : db.prepare("SELECT * FROM users WHERE id=? AND active=1").get(body.userId);
  if (!user || !(await passwordMatches(body.password, user.password_salt, user.password_hash))) {
    state.count += 1;
    throttle.set(key, state);
    throw bad("Invalid credentials");
  }
  throttle.delete(key);
  const session = newSession();
  const now = new Date();
  purgeExpiredSessions(db, now.toISOString());
  db.prepare("INSERT INTO sessions(token_hash,user_id,expires_at,created_at) VALUES (?,?,?,?)")
    .run(session.hash, user.id, new Date(now.getTime() + SESSION_MS).toISOString(), now.toISOString());
  res.setHeader("Set-Cookie", sessionCookie(session.token, !localInsecure));
  return json(res, 200, { user: { id: user.id, username: user.username, name: user.name, initial: user.initial, isAdmin: Boolean(user.is_admin) } });
}

function authenticate(req, db) {
  purgeExpiredSessions(db);
  const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
  if (!token || token.length > 256) return null;
  const hash = tokenHash(token);
  const row = db.prepare("SELECT s.user_id,s.expires_at FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>? AND u.active=1 ")
    .get(hash, new Date().toISOString());
  return row ? { userId: row.user_id, tokenHash: hash, expiresAt: row.expires_at } : null;
}

async function createChore(req, res, db, changed, userId, notify) {
  const chore = validatedChore(await readJson(req));
  requireGroup(db, userId, req.choreGroupId);
  requireAssignee(db, req.choreGroupId, chore.assigneeId);
  const now = new Date().toISOString();
  const result = db.prepare(`INSERT INTO chores(group_id,title,assignee_id,schedule_kind,schedule_interval,next_due,anchor_date,
    weekdays_mask,month_day,reminder_mode,reminder_time,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(req.choreGroupId, chore.title, chore.assigneeId, chore.schedule_kind, chore.schedule_interval, chore.next_due, chore.anchor_date,
      chore.weekdays_mask, chore.month_day, chore.reminderMode, chore.reminderTime, now, now);
  changed();
  await notify(userId, "Chore added", `${userName(db, userId)} added ${chore.title} for ${userName(db, chore.assigneeId)}.`, `create:${result.lastInsertRowid}`);
  return json(res, 201, { id: Number(result.lastInsertRowid) });
}

async function editChore(req, res, db, id, changed, userId, notify, groupId) {
  const current = db.prepare("SELECT * FROM chores WHERE id=? AND group_id=?").get(id, groupId);
  if (!current) throw notFound();
  const body = await readJson(req);
  const chore = validatedChore(body);
  requireGroup(db, userId, groupId);
  requireAssignee(db, groupId, chore.assigneeId);
  const hasRevision = Object.prototype.hasOwnProperty.call(body, "revision");
  if (hasRevision && (!Number.isInteger(body.revision) || body.revision < 1)) throw bad("Revision is required");
  const now = new Date().toISOString();
  const result = db.prepare(`UPDATE chores SET title=?,assignee_id=?,schedule_kind=?,schedule_interval=?,next_due=?,anchor_date=?,
    weekdays_mask=?,month_day=?,reminder_mode=?,reminder_time=?,missed_count=0,revision=revision+1,updated_at=?
    WHERE id=? AND group_id=?${hasRevision ? " AND revision=?" : ""}`)
    .run(chore.title, chore.assigneeId, chore.schedule_kind, chore.schedule_interval, chore.next_due, chore.anchor_date,
      chore.weekdays_mask, chore.month_day, chore.reminderMode, chore.reminderTime, now, id, groupId,
      ...(hasRevision ? [body.revision] : []));
  if (!result.changes) throw conflict();
  changed();
  if (choreChanged(current, chore)) {
    const action = current.assignee_id !== chore.assigneeId ? `assigned ${chore.title} to ${userName(db, chore.assigneeId)}` : `updated ${chore.title}`;
    await notify(userId, "Chore updated", `${userName(db, userId)} ${action}.`, `edit:${id}:${current.revision}`);
  }
  return noContent(res);
}

async function deleteChore(res, db, id, changed, userId, notify, groupId) {
  const current = db.prepare("SELECT title FROM chores WHERE id=? AND group_id=?").get(id, groupId);
  if (!current || !db.prepare("DELETE FROM chores WHERE id=? AND group_id=?").run(id, groupId).changes) throw notFound();
  changed();
  await notify(userId, "Chore removed", `${userName(db, userId)} removed ${current.title}.`, `delete:${id}`);
  return noContent(res);
}

async function completeChore(req, res, db, id, userId, changed, timeZone, now, notify) {
  const body = await readJson(req);
  if (!isRecord(body) || !Number.isInteger(body.revision) || body.revision < 1) throw bad("Revision is required");
  requireGroup(db, userId, req.choreGroupId);
  const outcome = transaction(db, () => {
    const completedAt = now().toISOString();
    const completedOn = localDateTime(timeZone, new Date(completedAt)).date;
    const chore = db.prepare("SELECT * FROM chores WHERE id=? AND group_id=?").get(id, req.choreGroupId);
    if (!chore) throw notFound();
    if (chore.revision !== body.revision) throw conflict();
    const recordCompletion = () => Number(db.prepare(`INSERT INTO completion_history
      (chore_id,title,assignee_id,completed_by_id,due_date,schedule_kind,completed_at,completed_on,undo_snapshot,undo_revision,group_id)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
      .run(id, chore.title, chore.assignee_id, userId, chore.next_due, chore.schedule_kind, completedAt, completedOn,
        JSON.stringify(chore), chore.revision + 1, req.choreGroupId).lastInsertRowid);
    if (chore.schedule_kind === "once") {
      const result = db.prepare("DELETE FROM chores WHERE id=? AND revision=? AND group_id=?").run(id, body.revision, req.choreGroupId);
      if (!result.changes) throw conflict();
      return { removed: true, title: chore.title, completionId: recordCompletion() };
    }
    const effective = chore.next_due < completedOn
      ? shiftSeries(chore, daysBetween(chore.next_due, completedOn))
      : chore;
    const nextDue = nextOccurrence(effective);
    const result = db.prepare(`UPDATE chores SET next_due=?,missed_count=0,last_completed_at=?,last_completed_by=?,
      anchor_date=?,weekdays_mask=?,month_day=?,revision=revision+1,updated_at=? WHERE id=? AND revision=? AND group_id=?`)
      .run(nextDue, completedAt, userId, effective.anchor_date, effective.weekdays_mask, effective.month_day,
        completedAt, id, body.revision, req.choreGroupId);
    if (!result.changes) throw conflict();
    return { nextDue, title: chore.title, completionId: recordCompletion() };
  });
  changed();
  await notify(userId, "Chore completed", `${userName(db, userId)} completed ${outcome.title || "a chore"}.`, `complete:${id}:${body.revision}`);
  delete outcome.title;
  return json(res, 200, outcome);
}

async function undoCompletion(res, db, id, userId, changed, now, notify, groupId) {
  requireGroup(db, userId, groupId);
  if (!db.prepare("SELECT 1 FROM completion_history WHERE id=? AND group_id=?").get(id, groupId)) throw notFound();
  const title = transaction(db, () => {
    const record = db.prepare(`SELECT * FROM completion_history WHERE id=? AND group_id=? AND (${CAN_UNDO})`).get(id, groupId);
    if (!record) throw Object.assign(new Error("This completion can no longer be undone. Refresh the list."), { status: 409 });
    const chore = JSON.parse(record.undo_snapshot);
    if (chore.group_id !== groupId) throw conflict();
    requireAssignee(db, groupId, chore.assignee_id);
    chore.revision = record.undo_revision + 1;
    chore.updated_at = now().toISOString();
    const columns = db.prepare("PRAGMA table_info(chores)").all().map(({ name }) => name);
    if (record.schedule_kind === "once") {
      db.prepare(`INSERT INTO chores (${columns.join(",")}) VALUES (${columns.map(() => "?").join(",")})`).run(...columns.map((column) => chore[column]));
    } else {
      const fields = columns.filter((column) => column !== "id");
      const result = db.prepare(`UPDATE chores SET ${fields.map((column) => `${column}=?`).join(",")} WHERE id=? AND revision=? AND group_id=?`)
        .run(...fields.map((column) => chore[column]), record.chore_id, record.undo_revision, groupId);
      if (!result.changes) throw conflict();
    }
    db.prepare("DELETE FROM completion_history WHERE id=? AND group_id=?").run(id, groupId);
    return record.title;
  });
  changed();
  await notify(userId, "Completion undone", `${userName(db, userId)} marked ${title} as unfinished.`, `undo:${id}`);
  return noContent(res);
}

async function updateSettings(req, res, db, userId, changed) {
  const body = await readJson(req);
  if (!isRecord(body)) throw bad("Settings must be an object");
  const keys = ["digestTime", "missedAlertTime", "defaultReminderTime"];
  if (!keys.some((key) => Object.prototype.hasOwnProperty.call(body, key)) && !Object.prototype.hasOwnProperty.call(body, "activityNotifications")) throw bad("No settings supplied");
  if (Object.prototype.hasOwnProperty.call(body, "activityNotifications") && typeof body.activityNotifications !== "boolean") throw bad("Activity notification preference must be true or false");
  const current = db.prepare("SELECT digest_time,missed_alert_time,default_reminder_time,activity_notifications FROM users WHERE id=?").get(userId);
  const currentValues = [current.digest_time, current.missed_alert_time, current.default_reminder_time];
  const values = keys.map((key, index) => {
    if (!Object.prototype.hasOwnProperty.call(body, key)) return currentValues[index];
    if (body[key] !== null && (typeof body[key] !== "string" || !TIME.test(body[key]))) throw bad("Times must use HH:MM");
    return body[key];
  });
  db.prepare(`UPDATE users SET digest_time=?,missed_alert_time=?,default_reminder_time=?,activity_notifications=?,updated_at=? WHERE id=?`)
    .run(...values, Object.prototype.hasOwnProperty.call(body, "activityNotifications") ? Number(body.activityNotifications) : current.activity_notifications, new Date().toISOString(), userId);
  changed(userId);
  return noContent(res);
}

async function changePassword(req, res, db, session, clients) {
  const body = await readJson(req);
  if (!isRecord(body) || typeof body.currentPassword !== "string" || typeof body.newPassword !== "string") {
    throw bad("Current and new passwords are required");
  }
  const user = db.prepare("SELECT * FROM users WHERE id=?").get(session.userId);
  if (!(await passwordMatches(body.currentPassword, user.password_salt, user.password_hash))) {
    throw bad("Current password is incorrect");
  }
  const next = await passwordHash(body.newPassword);
  transaction(db, () => {
    db.prepare("UPDATE users SET password_salt=?,password_hash=?,updated_at=? WHERE id=?")
      .run(next.salt, next.hash, new Date().toISOString(), session.userId);
    db.prepare("DELETE FROM sessions WHERE user_id=? AND token_hash<>?").run(session.userId, session.tokenHash);
    db.prepare("DELETE FROM push_subscriptions WHERE user_id=? AND session_hash<>?").run(session.userId, session.tokenHash);
  });
  closeStreams(clients, (client) => client.userId === session.userId && client.tokenHash !== session.tokenHash);
  return noContent(res);
}

function validNativeDeviceId(value) {
  return typeof value === "string" && /^[A-Za-z0-9._:-]{8,128}$/.test(value);
}

async function registerNativeDevice(req, res, db, session) {
  const body = await readJson(req);
  const deviceId = body?.deviceId;
  if (!validNativeDeviceId(deviceId)) throw bad("Invalid native device ID");
  const issued = newSession();
  const now = new Date().toISOString();
  transaction(db, () => {
    db.prepare("DELETE FROM native_devices WHERE user_id=? AND device_id=?").run(session.userId, deviceId);
    db.prepare(`INSERT INTO native_devices(token_hash,user_id,session_hash,device_id,created_at,updated_at)
      VALUES (?,?,?,?,?,?)`).run(issued.hash, session.userId, session.tokenHash, deviceId, now, now);
  });
  const cursor = Number(db.prepare("SELECT COALESCE(MAX(id),0) AS id FROM native_notification_events WHERE user_id=?").get(session.userId).id || 0);
  return json(res, 200, { token: issued.token, cursor });
}

async function removeNativeDevice(req, res, db, session) {
  const body = await readJson(req);
  if (!validNativeDeviceId(body?.deviceId)) throw bad("Invalid native device ID");
  db.prepare("DELETE FROM native_devices WHERE user_id=? AND device_id=? AND session_hash=?")
    .run(session.userId, body.deviceId, session.tokenHash);
  return noContent(res);
}

function nativeNotifications(req, res, db, url) {
  const match = /^Bearer\s+([A-Za-z0-9_-]{20,256})$/i.exec(req.headers.authorization || "");
  if (!match) return json(res, 401, { error: "Native device authentication required" });
  const device = db.prepare(`SELECT d.token_hash,d.user_id FROM native_devices d
    JOIN sessions s ON s.token_hash=d.session_hash JOIN users u ON u.id=d.user_id
    WHERE d.token_hash=? AND s.expires_at>? AND u.active=1`).get(tokenHash(match[1]), new Date().toISOString());
  if (!device) return json(res, 401, { error: "Native device token expired" });
  const rawAfter = url.searchParams.get("after") || "0";
  if (!/^\d{1,18}$/.test(rawAfter)) throw bad("Invalid notification cursor");
  const after = Number(rawAfter);
  if (!Number.isSafeInteger(after) || after < 0) throw bad("Invalid notification cursor");
  const events = db.prepare(`SELECT e.id,e.title,e.body,e.url,e.tag,e.group_id AS groupId,e.created_at AS createdAt
    FROM native_notification_events e WHERE e.user_id=? AND e.id>? AND (e.group_id IS NULL OR EXISTS (
      SELECT 1 FROM group_members m JOIN groups g ON g.id=m.group_id
      WHERE m.group_id=e.group_id AND m.user_id=e.user_id AND g.archived_at IS NULL
    )) ORDER BY e.id LIMIT 100`).all(device.user_id, after);
  const cursor = events.length ? Number(events[events.length - 1].id) : after;
  db.prepare("UPDATE native_devices SET updated_at=? WHERE token_hash=?").run(new Date().toISOString(), device.token_hash);
  return json(res, 200, { events, cursor });
}

function queueNativeNotification(db, userId, title, body, options = {}) {
  if (!db.prepare("SELECT 1 FROM native_devices WHERE user_id=? LIMIT 1").get(userId)) return false;
  const now = new Date().toISOString();
  db.prepare(`INSERT INTO native_notification_events(user_id,title,body,url,tag,created_at,group_id)
    VALUES (?,?,?,?,?,?,?)`).run(userId, String(title), String(body), options.url || "/app", options.tag || null, now, options.groupId || null);
  // Native clients use a cursor. A one-week retention bound prevents an abandoned
  // device from growing this table forever while still tolerating long offline gaps.
  const cutoff = new Date(Date.now() - 7 * 86400_000).toISOString();
  db.prepare("DELETE FROM native_notification_events WHERE created_at<?").run(cutoff);
  return true;
}

async function putSubscription(req, res, db, session) {
  const body = await readJson(req);
  const endpoint = body?.endpoint;
  const p256dh = body?.keys?.p256dh;
  const auth = body?.keys?.auth;
  if (!validEndpoint(endpoint) || !validKey(p256dh, 65) || !validKey(auth, 16)) throw bad("Invalid push subscription");
  const existing = db.prepare("SELECT user_id FROM push_subscriptions WHERE endpoint=?").get(endpoint);
  if (existing && existing.user_id !== session.userId) throw conflict();
  const now = new Date().toISOString();
  db.prepare(`INSERT INTO push_subscriptions(endpoint,user_id,session_hash,p256dh,auth,created_at,updated_at) VALUES (?,?,?,?,?,?,?)
    ON CONFLICT(endpoint) DO UPDATE SET session_hash=excluded.session_hash,p256dh=excluded.p256dh,auth=excluded.auth,updated_at=excluded.updated_at`)
    .run(endpoint, session.userId, session.tokenHash, p256dh, auth, now, now);
  return noContent(res);
}

async function removeSubscription(req, res, db, userId) {
  const { endpoint } = await readJson(req);
  if (!validEndpoint(endpoint)) throw bad("Endpoint is required");
  db.prepare("DELETE FROM push_subscriptions WHERE endpoint=? AND user_id=?").run(endpoint, userId);
  return noContent(res);
}

async function pushTest(res, send, userId) {
  const sent = await send(userId, "Chores", "Push notifications are working on this device.", { url: "/app", tag: "two-of-us-test" });
  if (!sent) throw Object.assign(new Error("Enable push on this device first"), { status: 409 });
  return noContent(res);
}

async function activityNotification(db, send, actorId, title, body, key, groupId) {
  const users = db.prepare(`SELECT u.id FROM users u JOIN group_members m ON m.user_id=u.id
    WHERE m.group_id=? AND u.id<>? AND u.active=1 AND u.activity_notifications=1`).all(groupId, actorId);
  for (const user of users) {
    try { await send(user.id, title, body, { groupId, url: `/app?groupId=${encodeURIComponent(groupId)}`, tag: `activity-${groupId}-${key}` }); }
    catch (error) { console.error("activity notification failed", error?.name || "Error"); }
  }
}

function choreChanged(current, chore) {
  return current.title !== chore.title || current.assignee_id !== chore.assigneeId || current.schedule_kind !== chore.schedule_kind
    || current.schedule_interval !== chore.schedule_interval || current.next_due !== chore.next_due || current.anchor_date !== chore.anchor_date
    || current.weekdays_mask !== chore.weekdays_mask || current.month_day !== chore.month_day || current.reminder_mode !== chore.reminderMode
    || current.reminder_time !== chore.reminderTime;
}

function userName(db, userId) { return db.prepare("SELECT name FROM users WHERE id=?").get(userId)?.name || "Member"; }

function purgeExpiredSessions(db, now = new Date().toISOString()) {
  db.prepare("DELETE FROM push_subscriptions WHERE session_hash IN (SELECT token_hash FROM sessions WHERE expires_at<=?)").run(now);
  db.prepare("DELETE FROM sessions WHERE expires_at<=?").run(now);
}

function validatedChore(body) {
  if (!isRecord(body)) throw bad("Chore must be an object");
  const title = typeof body.title === "string" ? body.title.trim() : "";
  if (!title || title.length > 120) throw bad("Title must be 1-120 characters");
  if (typeof body.assigneeId !== "string" || body.assigneeId.length > 80) throw bad("Choose a group member");
  let schedule;
  try {
    schedule = normalizeSchedule({
      kind: body.scheduleKind,
      interval: body.scheduleInterval,
      nextDue: body.nextDue,
      anchorDate: body.anchorDate,
      monthDay: body.monthDay,
      weekdays: body.weekdays,
    });
  } catch (error) {
    throw bad(error.message);
  }
  const reminderMode = body.reminderMode ?? "inherit";
  if (!["inherit", "override", "off"].includes(reminderMode)) throw bad("Choose a reminder option");
  const reminderTime = reminderMode === "override" ? body.reminderTime : null;
  if (reminderMode === "override" && (typeof reminderTime !== "string" || !TIME.test(reminderTime))) {
    throw bad("Choose a reminder time");
  }
  return { title, assigneeId: body.assigneeId, ...schedule, reminderMode, reminderTime };
}

function enforceMutation(req, origin, needsJson) {
  if (req.headers.origin !== origin) throw Object.assign(new Error(
    `Cross-origin request rejected. This server expects ${origin}. Check the browser URL and reverse proxy, then restart the service after changing its configuration.`,
  ), { status: 403 });
  if (needsJson && req.headers["content-type"]?.split(";")[0].trim().toLowerCase() !== "application/json") {
    throw Object.assign(new Error("JSON required"), { status: 415 });
  }
}

function needsJsonBody(req, path) {
  return req.method !== "DELETE" || path === "/api/push-subscriptions";
}

async function readJson(req) {
  const length = Number(req.headers["content-length"]);
  if (Number.isFinite(length) && length > JSON_LIMIT) throw Object.assign(new Error("Request too large"), { status: 413 });
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += Buffer.byteLength(chunk);
    if (size > JSON_LIMIT) throw Object.assign(new Error("Request too large"), { status: 413 });
    chunks.push(chunk);
  }
  let body;
  try { body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"); } catch { throw bad("Invalid JSON"); }
  if (!isRecord(body)) throw bad("JSON object required");
  return body;
}

function events(req, res, session, clients) {
  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.write("event: ready\ndata: {}\n\n");
  clients.set(res, session);
  const heartbeat = setInterval(() => {
    try {
      if (new Date(session.expiresAt) <= new Date()) return res.end();
      if (!res.writableEnded) res.write(": keepalive\n\n");
    } catch { cleanup(); }
  }, 20_000);
  const cleanup = () => { clearInterval(heartbeat); clients.delete(res); };
  req.on("close", cleanup);
  res.on("error", cleanup);
}

function closeStreams(clients, predicate) {
  for (const [res, client] of clients) {
    if (!predicate(client)) continue;
    clients.delete(res);
    res.end();
  }
}

async function staticFile(pathname, res, isPublic = false) {
  let decoded;
  try { decoded = decodeURIComponent(pathname); } catch { throw notFound(); }
  const publicRoot = resolve(join(ROOT, "public"));
  const file = join(publicRoot, decoded === "/" ? "index.html" : decoded.slice(1));
  if (!within(publicRoot, file)) throw notFound();
  try {
    let data = staticCache.get(file);
    if (!data) {
      data = await readFile(file);
      staticCache.set(file, data);
    }
    res.writeHead(200, {
      "Content-Type": mime(file),
      "Content-Length": data.byteLength,
      "Cache-Control": "no-store",
    });
    res.end(data);
  } catch {
    throw notFound();
  }
}

function securityHeaders(res, secure) {
  res.setHeader("Content-Security-Policy", "default-src 'self'; img-src 'self' data: https:; script-src 'self'; style-src 'self'; connect-src 'self'; manifest-src 'self'; worker-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
  if (secure) res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
}

function parseOrigin(value) {
  let url;
  try { url = new URL(value); } catch { throw new Error("APP_ORIGIN must be a valid origin"); }
  if (url.username || url.password || url.pathname !== "/" || url.search || url.hash) throw new Error("APP_ORIGIN must be an origin");
  return url.origin;
}

function within(root, file) {
  const path = relative(root, resolve(file));
  return path === "" || (path && !path.startsWith("..") && !path.includes(`..${"/"}`));
}

function validEndpoint(value) {
  if (typeof value !== "string" || value.length > 2048) return false;
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    return url.protocol === "https:" && !url.username && !url.password
      && (host === "fcm.googleapis.com" || host === "updates.push.services.mozilla.com" || host === "push.services.mozilla.com" || host.endsWith(".push.apple.com"));
  } catch { return false; }
}

function validKey(value, bytes) {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]+$/.test(value)) return false;
  try {
    return Buffer.from(value.replace(/-/g, "+").replace(/_/g, "/"), "base64").length === bytes;
  } catch {
    return false;
  }
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function json(res, status, value) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(JSON.stringify(value));
}

function redirect(res, location) { res.writeHead(302, { Location: location, "Cache-Control": "no-store" }); res.end(); }
function noContent(res) { res.writeHead(204); res.end(); }
function bad(message) { return Object.assign(new Error(message), { status: 400 }); }
function conflict() { return Object.assign(new Error("This chore changed on another device"), { status: 409 }); }
function notFound() { return Object.assign(new Error("Not found"), { status: 404 }); }

function mime(file) {
  return ({
    ".css": "text/css; charset=utf-8",
    ".html": "text/html; charset=utf-8",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".png": "image/png",
    ".svg": "image/svg+xml",
    ".webmanifest": "application/manifest+json; charset=utf-8",
  })[extname(file).toLowerCase()] || "application/octet-stream";
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { server } = await createApp();
  const port = Number(process.env.PORT || 3000);
  const host = process.env.LISTEN_HOST || "0.0.0.0";
  server.listen(port, host, () => console.log(`Two of Us listening on ${host}:${server.address().port}`));
}
