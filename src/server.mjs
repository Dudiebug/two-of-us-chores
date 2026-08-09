import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { openDatabase, publicState, transaction } from "./db.mjs";
import { daysBetween, localDateTime, nextOccurrence, normalizeSchedule, shiftSeries } from "./recurrence.mjs";
import { createPush } from "./push.mjs";
import { createScheduler, rolloverMissed } from "./scheduler.mjs";
import { newSession, parseCookies, passwordHash, passwordMatches, sessionCookie, SESSION_COOKIE, tokenHash } from "./security.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const JSON_LIMIT = 32 * 1024;
const SESSION_MS = 30 * 86400_000;
const LOGIN_WINDOW_MS = 15 * 60_000;
const TIME = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const throttle = new Map();
const staticCache = new Map();

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
  const push = options.push || createPush(db, env);
  const clock = options.now || (() => new Date());
  const clients = new Map();
  const broadcast = (targetUserId = null) => {
    for (const [res, client] of clients) {
      if (targetUserId && client.userId !== targetUserId) continue;
      try {
        if (!res.writableEnded) res.write(`event: change\ndata: {"at":${Date.now()}}\n\n`);
      } catch {
        clients.delete(res);
      }
    }
  };
  const timeZone = env.HOUSEHOLD_TIMEZONE || "America/Chicago";
  const scheduler = createScheduler({ db, timeZone, send: push.send, changed: broadcast, now: clock });
  const startupNow = clock();
  if (rolloverMissed(db, localDateTime(timeZone, startupNow).date).length) broadcast();
  await scheduler.tick();

  const server = createServer(async (req, res) => {
    securityHeaders(res, !localInsecure);
    try {
      const url = new URL(req.url || "/", appOrigin);
      const path = url.pathname;
      if (req.method === "GET" && path === "/healthz") return json(res, 200, { ok: true });
      if (req.method !== "GET" && path.startsWith("/api/")) enforceMutation(req, appOrigin, needsJsonBody(req, path));
      if (req.method === "POST" && path === "/api/session") return await login(req, res, db, localInsecure);

      const session = authenticate(req, db);
      if (path.startsWith("/api/") && !session) return json(res, 401, { error: "Please sign in" });
      if (req.method === "DELETE" && path === "/api/session") {
        db.prepare("DELETE FROM sessions WHERE token_hash=?").run(session.tokenHash);
        closeStreams(clients, (client) => client.tokenHash === session.tokenHash);
        res.setHeader("Set-Cookie", sessionCookie("", !localInsecure, 0));
        return noContent(res);
      }
      if (req.method === "GET" && path === "/api/state") {
        return json(res, 200, publicState(db, session.userId, {
          timeZone,
          today: localDateTime(timeZone, clock()).date,
        }));
      }
      if (req.method === "GET" && path === "/api/events") return events(req, res, session, clients);
      if (req.method === "GET" && path === "/api/push-key") {
        return json(res, 200, { configured: push.configured, publicKey: push.publicKey });
      }
      if (req.method === "POST" && path === "/api/chores") return await createChore(req, res, db, broadcast);
      if (req.method === "PATCH" && /^\/api\/chores\/\d+$/.test(path)) {
        return await editChore(req, res, db, Number(path.split("/").pop()), broadcast);
      }
      if (req.method === "DELETE" && /^\/api\/chores\/\d+$/.test(path)) {
        return deleteChore(res, db, Number(path.split("/").pop()), broadcast);
      }
      if (req.method === "POST" && /^\/api\/chores\/\d+\/complete$/.test(path)) {
        return await completeChore(req, res, db, Number(path.split("/")[3]), session.userId, broadcast, timeZone, clock);
      }
      if (req.method === "PATCH" && path === "/api/settings") return await updateSettings(req, res, db, session.userId, broadcast);
      if (req.method === "PATCH" && path === "/api/password") return await changePassword(req, res, db, session, clients);
      if (req.method === "PUT" && path === "/api/push-subscriptions") return await putSubscription(req, res, db, session.userId);
      if (req.method === "DELETE" && path === "/api/push-subscriptions") return await removeSubscription(req, res, db, session.userId);
      if (req.method === "GET") return await staticFile(path, res);
      return json(res, 404, { error: "Not found" });
    } catch (error) {
      const status = error.status || 400;
      if (status >= 500) console.error(error);
      return json(res, status, { error: status >= 500 ? "Server error" : error.message });
    }
  });

  server.on("close", () => {
    scheduler.stop();
    for (const res of clients.keys()) res.end();
    clients.clear();
    db.close();
  });
  return { server, db, scheduler };
}

async function login(req, res, db, localInsecure) {
  const body = await readJson(req);
  if (!isRecord(body) || !["D", "M"].includes(body.userId) || typeof body.password !== "string"
    || body.password.length > 200) throw bad("Invalid credentials");
  const key = `${req.socket.remoteAddress || "unknown"}:${body.userId}`;
  const state = throttle.get(key) || { count: 0, since: Date.now() };
  if (Date.now() - state.since > LOGIN_WINDOW_MS) Object.assign(state, { count: 0, since: Date.now() });
  if (state.count >= 8) throw Object.assign(new Error("Too many attempts. Try again later."), { status: 429 });

  const user = db.prepare("SELECT * FROM users WHERE id=?").get(body.userId);
  if (!user || !(await passwordMatches(body.password, user.password_salt, user.password_hash))) {
    state.count += 1;
    throttle.set(key, state);
    throw bad("Invalid credentials");
  }
  throttle.delete(key);
  const session = newSession();
  const now = new Date();
  db.prepare("DELETE FROM sessions WHERE expires_at<=?").run(now.toISOString());
  db.prepare("INSERT INTO sessions(token_hash,user_id,expires_at,created_at) VALUES (?,?,?,?)")
    .run(session.hash, body.userId, new Date(now.getTime() + SESSION_MS).toISOString(), now.toISOString());
  res.setHeader("Set-Cookie", sessionCookie(session.token, !localInsecure));
  return json(res, 200, { user: { id: user.id, name: user.name, initial: user.initial } });
}

function authenticate(req, db) {
  const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
  if (!token || token.length > 256) return null;
  const hash = tokenHash(token);
  const row = db.prepare("SELECT user_id FROM sessions WHERE token_hash=? AND expires_at>? ")
    .get(hash, new Date().toISOString());
  return row ? { userId: row.user_id, tokenHash: hash } : null;
}

async function createChore(req, res, db, changed) {
  const chore = validatedChore(await readJson(req));
  const now = new Date().toISOString();
  const result = db.prepare(`INSERT INTO chores(title,assignee_id,schedule_kind,schedule_interval,next_due,anchor_date,
    weekdays_mask,month_day,reminder_mode,reminder_time,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(chore.title, chore.assigneeId, chore.schedule_kind, chore.schedule_interval, chore.next_due, chore.anchor_date,
      chore.weekdays_mask, chore.month_day, chore.reminderMode, chore.reminderTime, now, now);
  changed();
  return json(res, 201, { id: Number(result.lastInsertRowid) });
}

async function editChore(req, res, db, id, changed) {
  const current = db.prepare("SELECT revision FROM chores WHERE id=?").get(id);
  if (!current) throw notFound();
  const body = await readJson(req);
  const chore = validatedChore(body);
  const hasRevision = Object.prototype.hasOwnProperty.call(body, "revision");
  if (hasRevision && (!Number.isInteger(body.revision) || body.revision < 1)) throw bad("Revision is required");
  const now = new Date().toISOString();
  const result = db.prepare(`UPDATE chores SET title=?,assignee_id=?,schedule_kind=?,schedule_interval=?,next_due=?,anchor_date=?,
    weekdays_mask=?,month_day=?,reminder_mode=?,reminder_time=?,missed_count=0,revision=revision+1,updated_at=?
    WHERE id=?${hasRevision ? " AND revision=?" : ""}`)
    .run(chore.title, chore.assigneeId, chore.schedule_kind, chore.schedule_interval, chore.next_due, chore.anchor_date,
      chore.weekdays_mask, chore.month_day, chore.reminderMode, chore.reminderTime, now, id,
      ...(hasRevision ? [body.revision] : []));
  if (!result.changes) throw conflict();
  changed();
  return noContent(res);
}

function deleteChore(res, db, id, changed) {
  if (!db.prepare("DELETE FROM chores WHERE id=?").run(id).changes) throw notFound();
  changed();
  return noContent(res);
}

async function completeChore(req, res, db, id, userId, changed, timeZone, now) {
  const body = await readJson(req);
  if (!isRecord(body) || !Number.isInteger(body.revision) || body.revision < 1) throw bad("Revision is required");
  const outcome = transaction(db, () => {
    const completedAt = now().toISOString();
    const completedOn = localDateTime(timeZone, new Date(completedAt)).date;
    const chore = db.prepare("SELECT * FROM chores WHERE id=?").get(id);
    if (!chore) throw notFound();
    if (chore.revision !== body.revision) throw conflict();
    db.prepare(`INSERT INTO completion_history
      (chore_id,title,assignee_id,completed_by_id,due_date,schedule_kind,completed_at,completed_on)
      VALUES (?,?,?,?,?,?,?,?)`)
      .run(id, chore.title, chore.assignee_id, userId, chore.next_due, chore.schedule_kind, completedAt, completedOn);
    if (chore.schedule_kind === "once") {
      const result = db.prepare("DELETE FROM chores WHERE id=? AND revision=?").run(id, body.revision);
      if (!result.changes) throw conflict();
      return { removed: true };
    }
    const effective = chore.next_due < completedOn
      ? shiftSeries(chore, daysBetween(chore.next_due, completedOn))
      : chore;
    const nextDue = nextOccurrence(effective);
    const result = db.prepare(`UPDATE chores SET next_due=?,missed_count=0,last_completed_at=?,last_completed_by=?,
      anchor_date=?,weekdays_mask=?,month_day=?,revision=revision+1,updated_at=? WHERE id=? AND revision=?`)
      .run(nextDue, completedAt, userId, effective.anchor_date, effective.weekdays_mask, effective.month_day,
        completedAt, id, body.revision);
    if (!result.changes) throw conflict();
    return { nextDue };
  });
  changed();
  return json(res, 200, outcome);
}

async function updateSettings(req, res, db, userId, changed) {
  const body = await readJson(req);
  if (!isRecord(body)) throw bad("Settings must be an object");
  const keys = ["digestTime", "missedAlertTime", "defaultReminderTime"];
  if (!keys.some((key) => Object.prototype.hasOwnProperty.call(body, key))) throw bad("No settings supplied");
  const current = db.prepare("SELECT digest_time,missed_alert_time,default_reminder_time FROM users WHERE id=?").get(userId);
  const currentValues = [current.digest_time, current.missed_alert_time, current.default_reminder_time];
  const values = keys.map((key, index) => {
    if (!Object.prototype.hasOwnProperty.call(body, key)) return currentValues[index];
    if (body[key] !== null && (typeof body[key] !== "string" || !TIME.test(body[key]))) throw bad("Times must use HH:MM");
    return body[key];
  });
  db.prepare(`UPDATE users SET digest_time=?,missed_alert_time=?,default_reminder_time=?,updated_at=? WHERE id=?`)
    .run(...values, new Date().toISOString(), userId);
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
  });
  closeStreams(clients, (client) => client.userId === session.userId && client.tokenHash !== session.tokenHash);
  return noContent(res);
}

async function putSubscription(req, res, db, userId) {
  const body = await readJson(req);
  const endpoint = body?.endpoint;
  const p256dh = body?.keys?.p256dh;
  const auth = body?.keys?.auth;
  if (!validEndpoint(endpoint) || !validKey(p256dh, 65) || !validKey(auth, 16)) throw bad("Invalid push subscription");
  const now = new Date().toISOString();
  db.prepare(`INSERT INTO push_subscriptions(endpoint,user_id,p256dh,auth,created_at,updated_at) VALUES (?,?,?,?,?,?)
    ON CONFLICT(endpoint) DO UPDATE SET user_id=excluded.user_id,p256dh=excluded.p256dh,auth=excluded.auth,updated_at=excluded.updated_at`)
    .run(endpoint, userId, p256dh, auth, now, now);
  return noContent(res);
}

async function removeSubscription(req, res, db, userId) {
  const { endpoint } = await readJson(req);
  if (!validEndpoint(endpoint)) throw bad("Endpoint is required");
  db.prepare("DELETE FROM push_subscriptions WHERE endpoint=? AND user_id=?").run(endpoint, userId);
  return noContent(res);
}

function validatedChore(body) {
  if (!isRecord(body)) throw bad("Chore must be an object");
  const title = typeof body.title === "string" ? body.title.trim() : "";
  if (!title || title.length > 120) throw bad("Title must be 1-120 characters");
  if (!["D", "M"].includes(body.assigneeId)) throw bad("Choose Dylan or Mady");
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
  if (req.headers.origin !== origin) throw Object.assign(new Error("Cross-origin request rejected"), { status: 403 });
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
    try { if (!res.writableEnded) res.write(": keepalive\n\n"); } catch { cleanup(); }
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

async function staticFile(pathname, res) {
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
      "Cache-Control": file.endsWith("index.html") ? "no-cache" : "public, max-age=31536000, immutable",
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
  try { return new URL(value).protocol === "https:"; } catch { return false; }
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
    ".svg": "image/svg+xml",
    ".webmanifest": "application/manifest+json; charset=utf-8",
  })[extname(file).toLowerCase()] || "application/octet-stream";
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { server } = await createApp();
  const port = Number(process.env.PORT || 3000);
  server.listen(port, "0.0.0.0", () => console.log(`Two of Us listening on ${port}`));
}
