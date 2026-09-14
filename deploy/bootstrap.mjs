import { createInterface } from "node:readline/promises";
import { Writable } from "node:stream";
import { fileURLToPath } from "node:url";
import { openDatabase } from "../src/db.mjs";
import { makeUser, makeGroup, validateUsername, validateName, validateZone } from "../src/groups.mjs";
import { readConfig, writeConfig } from "./configure.mjs";

export async function bootstrapAccounts(db, { admin, groupName = "Home", timeZone = "UTC", users = [] }) {
  if (db.prepare("SELECT 1 FROM users LIMIT 1").get()) throw new Error("Accounts already exist; use Administration in Chores.");
  validateZone(timeZone); validateName(groupName);
  const keys = new Set();
  for (const user of [admin, ...users]) {
    const key = validateUsername(user.username); validateName(user.name || key);
    if (keys.has(key)) throw new Error("Each account needs a unique username"); keys.add(key);
    if (typeof user.password !== "string" || user.password.length < 12 || user.password.length > 200) throw new Error("Password must be 12–200 characters");
    if (user.groupName) validateName(user.groupName);
  }
  // Bootstrap runs only while the server is stopped. All account/group creation
  // rolls back together if any operation fails; passwords never enter a config.
  db.exec("BEGIN IMMEDIATE");
  try {
    const groups = new Map();
    const initialGroupId = makeGroup(db, { name: groupName, timeZone }); groups.set(groupName.toLowerCase(), initialGroupId);
    const adminId = await makeUser(db, { ...admin, isAdmin: true });
    const join = (gid, uid) => db.prepare("INSERT INTO group_members VALUES (?,?,?)").run(gid, uid, new Date().toISOString());
    join(initialGroupId, adminId);
    for (const user of users) {
      const name = user.groupName || groupName;
      if (!groups.has(name.toLowerCase())) groups.set(name.toLowerCase(), makeGroup(db, { name, timeZone }));
      const id = await makeUser(db, { ...user, isAdmin: false }); join(groups.get(name.toLowerCase()), id);
    }
    db.exec("COMMIT"); return { adminId, initialGroupId };
  } catch (e) { db.exec("ROLLBACK"); throw e; }
}

async function main() {
  const path = process.argv[2] || "/etc/two-of-us-chores.env";
  const config = readConfig(path);
  if (!config.DATABASE_PATH) throw new Error("Configure DATABASE_PATH first");
  const db = await openDatabase(config.DATABASE_PATH, { HOUSEHOLD_TIMEZONE: config.HOUSEHOLD_TIMEZONE });
  try {
    if (!db.prepare("SELECT 1 FROM users LIMIT 1").get()) {
      if (!process.stdin.isTTY) throw new Error("Run account setup from an interactive terminal");
      let muted = false;
      const output = new Writable({ write(chunk, encoding, done) { if (!muted) process.stdout.write(chunk, encoding); done(); } });
      const rl = createInterface({ input: process.stdin, output, terminal: true });
      const ask = async (label, fallback = "") => (await rl.question(`${label}${fallback ? ` [${fallback}]` : ""}: `)).trim() || fallback;
      const password = async () => {
        process.stdout.write("Password (12–200 characters): "); muted = true;
        const value = await rl.question(""); muted = false; process.stdout.write("\nConfirm password: "); muted = true;
        const confirmation = await rl.question(""); muted = false; process.stdout.write("\n");
        if (value !== confirmation) throw new Error("Passwords do not match"); return value;
      };
      try {
        console.log("Create the administrator and your first group. No default accounts will be created.");
        const username = await ask("Administrator username"); const name = await ask("Administrator display name", username);
        const admin = { username, name, password: await password() };
        const groupName = await ask("Initial group name", "Home");
        const timeZone = await ask("Initial group timezone", config.HOUSEHOLD_TIMEZONE || "UTC");
        const users = [];
        while (/^y(es)?$/i.test(await ask("Add another user? yes/no", "no"))) {
          const username = await ask("Username"); const name = await ask("Display name", username);
          users.push({ username, name, password: await password(), groupName: await ask("Group name (existing or new)", groupName) });
        }
        await bootstrapAccounts(db, { admin, groupName, timeZone, users });
        console.log("Accounts created. Sign in with the administrator username to manage users and groups.");
      } finally { muted = false; rl.close(); }
    } else console.log("Existing accounts preserved. Manage users and groups in Chores → Admin.");
    if (config.DYLAN_PASSWORD || config.MADY_PASSWORD) {
      delete config.DYLAN_PASSWORD; delete config.MADY_PASSWORD; writeConfig(path, config);
    }
  } finally { db.close(); }
}
if (process.argv[1] === fileURLToPath(import.meta.url)) main().catch((e) => { console.error(e.message); process.exitCode = 1; });
