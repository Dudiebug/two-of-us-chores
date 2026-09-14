import { passwordHash } from "./security.mjs";
import { audit, fail, makeGroup, makeUser, requireAdmin, validateName, validateUsername, validateZone } from "./groups.mjs";
import { transaction } from "./db.mjs";

// This module is called only after the session + same-origin mutation gates.
export async function adminRequest(db, actorId, method, path, body, changed) {
  requireAdmin(db, actorId);
  if (method === "GET" && path === "/api/admin/state") {
    return { users: db.prepare("SELECT id,username,name,initial,is_admin AS isAdmin,active FROM users ORDER BY username").all(),
      groups: db.prepare("SELECT id,name,time_zone AS timeZone,archived_at AS archivedAt FROM groups ORDER BY name").all(),
      memberships: db.prepare("SELECT group_id AS groupId,user_id AS userId FROM group_members").all() };
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) throw fail(400, "JSON object required");
  if (method === "POST" && path === "/api/admin/users") {
    const id = await makeUser(db, body, actorId); changed(); return { id };
  }
  if (method === "POST" && path === "/api/admin/groups") {
    const id = makeGroup(db, body, actorId); changed(); return { id };
  }
  const userMatch = /^\/api\/admin\/users\/([A-Za-z0-9-]+)$/.exec(path);
  if (method === "PATCH" && userMatch) {
    const id = userMatch[1];
    const previous = db.prepare("SELECT * FROM users WHERE id=?").get(id);
    if (!previous) throw fail(404, "User not found");
    const name = body.name === undefined ? previous.name : validateName(body.name);
    const username = body.username === undefined ? previous.username : validateUsername(body.username);
    for (const key of ["active", "isAdmin"]) if (body[key] !== undefined && typeof body[key] !== "boolean") throw fail(400, `Invalid ${key}`);
    const active = body.active === undefined ? previous.active : Number(body.active);
    const isAdmin = body.isAdmin === undefined ? previous.is_admin : Number(body.isAdmin);
    let hash;
    if (body.password !== undefined) {
      if (typeof body.password !== "string" || body.password.length < 12 || body.password.length > 200) throw fail(400, "Password must be 12–200 characters");
      hash = await passwordHash(body.password);
    }
    transaction(db, () => {
      requireAdmin(db, actorId); // Recheck after async password hashing.
      if ((!active || !isAdmin) && !db.prepare("SELECT 1 FROM users WHERE active=1 AND is_admin=1 AND id<>?").get(id)) throw fail(409, "Keep at least one active administrator");
      if (db.prepare("SELECT 1 FROM users WHERE username=? COLLATE NOCASE AND id<>?").get(username, id)) throw fail(409, "Username is already in use");
      db.prepare("UPDATE users SET username=?,name=?,initial=?,active=?,is_admin=?,updated_at=? WHERE id=?")
        .run(username, name, [...name][0].toUpperCase(), active, isAdmin, new Date().toISOString(), id);
      if (hash) db.prepare("UPDATE users SET password_salt=?,password_hash=? WHERE id=?").run(hash.salt, hash.hash, id);
      // Disabled accounts, password resets and authority changes revoke every session/device.
      if (!active || hash || isAdmin !== previous.is_admin) {
        db.prepare("DELETE FROM push_subscriptions WHERE user_id=?").run(id);
        db.prepare("DELETE FROM sessions WHERE user_id=?").run(id);
      }
      audit(db, actorId, hash ? "user.password-reset" : "user.update", id);
    });
    changed(); return { ok: true };
  }
  const groupMatch = /^\/api\/admin\/groups\/([A-Za-z0-9-]+)$/.exec(path);
  if (method === "PATCH" && groupMatch) {
    const id = groupMatch[1];
    const current = db.prepare("SELECT * FROM groups WHERE id=?").get(id);
    if (!current) throw fail(404, "Group not found");
    if (body.archived !== undefined && typeof body.archived !== "boolean") throw fail(400, "Invalid archive setting");
    const name = body.name === undefined ? current.name : validateName(body.name);
    const zone = body.timeZone === undefined ? current.time_zone : validateZone(body.timeZone);
    const archived = body.archived === undefined ? current.archived_at : body.archived ? new Date().toISOString() : null;
    if (db.prepare("SELECT 1 FROM groups WHERE name=? COLLATE NOCASE AND id<>?").get(name, id)) throw fail(409, "Group name is already in use");
    transaction(db, () => {
      db.prepare("UPDATE groups SET name=?,time_zone=?,archived_at=? WHERE id=?").run(name, zone, archived, id);
      audit(db, actorId, "group.update", id);
    });
    changed(); return { ok: true };
  }
  const membership = /^\/api\/admin\/groups\/([A-Za-z0-9-]+)\/members\/([A-Za-z0-9-]+)$/.exec(path);
  if (membership && ["PUT", "DELETE"].includes(method)) {
    const [, groupId, userId] = membership;
    transaction(db, () => {
      if (!db.prepare("SELECT 1 FROM groups WHERE id=? AND archived_at IS NULL").get(groupId) || !db.prepare("SELECT 1 FROM users WHERE id=?").get(userId)) throw fail(404, "User or group not found");
      if (method === "PUT") {
        if (!db.prepare("SELECT 1 FROM users WHERE id=? AND active=1").get(userId)) throw fail(400, "Enable the account before adding it to a group");
        db.prepare("INSERT OR IGNORE INTO group_members(group_id,user_id,joined_at) VALUES (?,?,?)").run(groupId, userId, new Date().toISOString());
      } else {
        if (db.prepare("SELECT 1 FROM chores WHERE group_id=? AND assignee_id=? LIMIT 1").get(groupId, userId)) throw fail(409, "Reassign or remove this user's active chores before removing membership");
        db.prepare("DELETE FROM group_members WHERE group_id=? AND user_id=?").run(groupId, userId);
        db.prepare("DELETE FROM native_notification_events WHERE group_id=? AND user_id=?").run(groupId, userId);
      }
      audit(db, actorId, method === "PUT" ? "membership.add" : "membership.remove", `${groupId}:${userId}`);
    });
    changed(); return { ok: true };
  }
  throw fail(404, "Not found");
}
