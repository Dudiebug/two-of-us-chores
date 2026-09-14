import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, stat, writeFile, rm, symlink } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { parseEnv } from "node:util";
import { openDatabase } from "../src/db.mjs";
import { bootstrapAccounts } from "../deploy/bootstrap.mjs";
import { passwordMatches } from "../src/security.mjs";
import { writeConfig, validateConfig } from "../deploy/configure.mjs";

const helper = new URL("../deploy/create-lxc-config.sh", import.meta.url).pathname;
const answers = "https://chores.example.com/\n127.0.0.1\nAmerica/Los_Angeles\n3000\ny\npush@example.com\ndylan-test-password\ndylan-test-password\nmady-test-password\nmady-test-password\n";

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), "chores-setup-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const config = join(directory, "app.env");
  const run = (input) => spawnSync("bash", [helper], {
    input, encoding: "utf8", timeout: 15000,
    env: { PATH: process.env.PATH, CONFIG_PATH: config, SETUP_DATA_DIR: join(directory, "data") },
  });
  return { directory, config, run };
}

test("guided config normalizes browser URL, generates keys and writes privately", async (t) => {
  const { config, directory, run } = await fixture(t);
  const result = run(answers);
  assert.equal(result.status, 0, result.stderr);
  const env = parseEnv(await readFile(config, "utf8"));
  assert.equal(env.APP_ORIGIN, "https://chores.example.com");
  assert.equal(env.DATABASE_PATH, join(directory, "data", "chores.db"));
  assert.equal(env.VAPID_SUBJECT, "mailto:push@example.com");
  assert.equal(Buffer.from(env.VAPID_PUBLIC_KEY, "base64url").length, 65);
  assert.equal(Buffer.from(env.VAPID_PRIVATE_KEY, "base64url").length, 32);
  assert.equal((await stat(config)).mode & 0o777, 0o600);
  assert.ok(!result.stdout.includes(env.VAPID_PRIVATE_KEY));
  assert.ok(!result.stdout.includes(env.DYLAN_PASSWORD));
});

test("rerun changes origin while preserving passwords, push keys and custom paths", async (t) => {
  const { config, run } = await fixture(t);
  assert.equal(run(answers).status, 0);
  await writeFile(config, (await readFile(config, "utf8")) + "EXTRA_SETTING='keep me'\n");
  const before = parseEnv(await readFile(config, "utf8"));
  const result = run("https://new.example.com\n\n\n\n\n\n");
  assert.equal(result.status, 0, result.stderr);
  const after = parseEnv(await readFile(config, "utf8"));
  assert.equal(after.APP_ORIGIN, "https://new.example.com");
  delete before.APP_ORIGIN;
  delete after.APP_ORIGIN;
  assert.deepEqual(after, before);
});

test("invalid input and interrupted prompts leave existing config unchanged", async (t) => {
  const { config, run } = await fixture(t);
  assert.equal(run(answers).status, 0);
  const before = await readFile(config, "utf8");
  for (const input of ["https://example.com/subpath\n127.0.0.1\nUTC\n3000\nn\n", "https://new.example.com\n"]) {
    assert.notEqual(run(input).status, 0);
    assert.equal(await readFile(config, "utf8"), before);
  }
});

test("push can be disabled without deleting an existing key pair", async (t) => {
  const { config, run } = await fixture(t);
  assert.equal(run(answers).status, 0);
  const before = parseEnv(await readFile(config, "utf8"));
  assert.equal(run("\n\n\n\nno\n").status, 0);
  const disabled = parseEnv(await readFile(config, "utf8"));
  assert.equal(disabled.VAPID_SUBJECT, "");
  assert.equal(disabled.VAPID_PRIVATE_KEY, before.VAPID_PRIVATE_KEY);
  assert.equal(run("\n\n\n\nyes\npush@example.com\n").status, 0);
  assert.deepEqual(parseEnv(await readFile(config, "utf8")), before);
});

test("existing database is retained without asking for or resetting account passwords", async (t) => {
  const { config, directory, run } = await fixture(t);
  const database = join(directory, "data", "chores.db");
  const db = await openDatabase(database, { D: "existing-dylan-password", M: "existing-mady-password" });
  const before = db.prepare("SELECT id,password_hash FROM users ORDER BY id").all();
  const result = run("https://chores.example.com\n127.0.0.1\nUTC\n3000\nno\n");
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(db.prepare("SELECT id,password_hash FROM users ORDER BY id").all(), before);
  assert.equal(parseEnv(await readFile(config, "utf8")).DYLAN_PASSWORD, undefined);
  db.close();
});

test("shell-like password text stays literal and config symlinks are refused", async (t) => {
  const { directory, config, run } = await fixture(t);
  const marker = join(directory, "must-not-exist");
  const password = `literal-$(touch ${marker})-password`;
  const result = run(answers.replaceAll("dylan-test-password", password));
  assert.equal(result.status, 0, result.stderr);
  assert.equal(parseEnv(await readFile(config, "utf8")).DYLAN_PASSWORD, undefined);
  const db = await openDatabase(":memory:");
  await bootstrapAccounts(db, { admin: { username: "customadmin", password } });
  const user = db.prepare("SELECT * FROM users WHERE username='customadmin'").get();
  assert.ok(await passwordMatches(password, user.password_salt, user.password_hash));
  db.close();
  await assert.rejects(stat(marker), { code: "ENOENT" });
  const link = join(directory, "link.env");
  await symlink(config, link);
  assert.throws(() => writeConfig(link, { APP_ORIGIN: "https://other.example.com" }), /regular file/);
  const brokenLink = join(directory, "broken-link.env");
  await symlink(join(directory, "missing.env"), brokenLink);
  assert.throws(() => writeConfig(brokenLink, { APP_ORIGIN: "https://other.example.com" }), /regular file/);
  assert.equal(parseEnv(await readFile(config, "utf8")).DYLAN_PASSWORD, undefined);
});

test("invalid ports, origins, data paths and mismatched push keys cannot replace config", async (t) => {
  const { config, run } = await fixture(t);
  assert.equal(run(answers).status, 0);
  const before = await readFile(config, "utf8");
  const env = parseEnv(before);
  for (const changes of [
    { PORT: "0" }, { PORT: "65536" }, { PORT: "3000x" },
    { APP_ORIGIN: "http://chores.example.com" }, { APP_ORIGIN: "https://chores.example.com/app" },
    { LISTEN_HOST: "not-an-address" }, { DATA_DIR: "relative" },
    { VAPID_PUBLIC_KEY: "broken" }, { HOUSEHOLD_TIMEZONE: "not/a/timezone" },
  ]) {
    assert.throws(() => writeConfig(config, validateConfig({ ...env, ...changes })));
    assert.equal(await readFile(config, "utf8"), before);
  }
  assert.throws(() => writeConfig(config, { ...env, EXTRA_SETTING: "line1\nline2" }));
  assert.equal(await readFile(config, "utf8"), before);
});
