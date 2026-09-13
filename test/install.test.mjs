import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, rm, cp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";

const root = new URL("..", import.meta.url).pathname;
const installer = join(root, "install.sh");
function git(cwd, ...args) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8", env: { ...process.env, GIT_AUTHOR_NAME: "Installer Test", GIT_AUTHOR_EMAIL: "test@example.com", GIT_COMMITTER_NAME: "Installer Test", GIT_COMMITTER_EMAIL: "test@example.com" } });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}
async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), "chores-install-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const remote = join(directory, "remote");
  const app = join(directory, "app");
  await mkdir(remote);
  git(remote, "init", "-b", "main");
  await writeFile(join(remote, "version.txt"), "old");
  git(remote, "add", "."); git(remote, "commit", "-m", "old");
  git(directory, "clone", remote, app);
  const previous = git(app, "rev-parse", "HEAD");
  await writeFile(join(remote, "version.txt"), "new");
  git(remote, "commit", "-am", "new");
  const log = join(directory, "operations");
  // Real Git/filesystem; substitute only workstation-inappropriate host/service boundaries.
  const run = (extra = "", mode = "--update") => spawnSync("bash", ["-c", `
    source "$1"
    APP_DIR="$2"; SOURCE_DIR="$2"; CONFIG_PATH="$3/app.env"; LOCK_PATH="$3/install.lock"; TEST_LOG="$4"
    require_host() { :; }
    install_runtime() { echo runtime >> "$TEST_LOG"; }
    install_dependencies() { echo dependencies >> "$TEST_LOG"; }
    configure_app() { echo configure >> "$TEST_LOG"; }
    prepare_state() { echo state >> "$TEST_LOG"; }
    install_service() { echo unit >> "$TEST_LOG"; }
    stop_service() { echo stop >> "$TEST_LOG"; }
    start_service() { echo start >> "$TEST_LOG"; }
    backup_install() { test "$(cat "$APP_DIR/version.txt")" = old; echo backup >> "$TEST_LOG"; }
    check_local() { echo local-check >> "$TEST_LOG"; }
    check_public() { echo public-check >> "$TEST_LOG"; }
    ${extra}
    main "$5"
  `, "test", installer, app, directory, log, mode], { encoding: "utf8", timeout: 15000 });
  return { directory, app, previous, log, run };
}

test("update backs up before changing code, installs dependencies and restarts without prompting", async (t) => {
  const f = await fixture(t);
  const result = f.run();
  assert.equal(result.status, 0, result.stderr);
  assert.equal(await readFile(join(f.app, "version.txt"), "utf8"), "new");
  const log = await readFile(f.log, "utf8");
  assert.ok(log.indexOf("stop") < log.indexOf("backup"));
  assert.ok(log.indexOf("backup") < log.indexOf("dependencies"));
  assert.ok(log.indexOf("dependencies") < log.indexOf("start"));
  assert.match(log, /local-check/);
  assert.ok(!log.includes("configure"));
});

test("backup failure prevents checkout/dependency changes", async (t) => {
  const f = await fixture(t);
  const result = f.run('backup_install() { echo backup-failed >> "$TEST_LOG"; return 1; }');
  assert.notEqual(result.status, 0);
  assert.equal(git(f.app, "rev-parse", "HEAD"), f.previous);
  assert.ok(!(await readFile(f.log, "utf8")).includes("dependencies"));
});

test("dirty and diverged checkouts are rejected before stopping the service", async (t) => {
  const f = await fixture(t);
  await writeFile(join(f.app, "version.txt"), "local change");
  assert.notEqual(f.run().status, 0);
  await assert.rejects(readFile(f.log), { code: "ENOENT" });
  git(f.app, "commit", "-am", "local commit");
  assert.notEqual(f.run().status, 0);
  await assert.rejects(readFile(f.log), { code: "ENOENT" });
});

test("dependency installation failure keeps the service stopped after taking a backup", async (t) => {
  const f = await fixture(t);
  const result = f.run('install_dependencies() { echo dependencies-failed >> "$TEST_LOG"; return 1; }');
  assert.notEqual(result.status, 0);
  const log = await readFile(f.log, "utf8");
  assert.match(log, /backup/);
  assert.ok(!log.includes("start"));
  assert.match(result.stderr, /recovery backup/);
});

test("private recovery bundle contains restorable data, config and previous revision", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "chores-recovery-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const database = join(directory, "chores.db");
  const db = new DatabaseSync(database);
  db.exec("CREATE TABLE sample (value TEXT); INSERT INTO sample VALUES ('keep this chore')");
  db.close();
  const config = join(directory, "app.env");
  const configText = `DATABASE_PATH='${database}'\nBACKUP_DIR='${directory}/backups'\nDYLAN_PASSWORD='private-test-password'\n`;
  await writeFile(config, configText, { mode: 0o600 });
  const result = spawnSync(process.execPath, [join(root, "deploy/maintenance.mjs"), "backup", config, "a".repeat(40), "required"], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  const bundle = result.stdout.trim();
  assert.equal(await readFile(join(bundle, "app.env"), "utf8"), configText);
  assert.equal((await readFile(join(bundle, "revision.txt"), "utf8")).trim(), "a".repeat(40));
  const restored = join(directory, "restored.db");
  await cp(join(bundle, "chores.db"), restored);
  const check = new DatabaseSync(restored);
  assert.equal(check.prepare("PRAGMA integrity_check").get().integrity_check, "ok");
  assert.equal(check.prepare("SELECT value FROM sample").get().value, "keep this chore");
  check.close();
});
