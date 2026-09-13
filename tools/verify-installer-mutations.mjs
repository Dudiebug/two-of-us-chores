// Deliberate bugs in disposable copies: verify that the relevant regressions fail.
import assert from "node:assert/strict";
import { cp, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
const root = new URL("..", import.meta.url).pathname;
const mutants = [
  ["rotated keys on rerun", "deploy/configure.mjs", 'choices.SETUP_PUSH === "yes" && !next.VAPID_PUBLIC_KEY && !next.VAPID_PRIVATE_KEY', 'choices.SETUP_PUSH === "yes"', "test/setup.test.mjs", "rerun changes origin while preserving passwords"],
  ["disabled origin protection", "src/server.mjs", "if (req.headers.origin !== origin)", "if (false)", "test/setup-check.test.mjs", "setup check exercises the real login origin gate"],
  ["dirty update allowed", "install.sh", '[[ -z "$(git -C "$APP_DIR" status --porcelain)" ]]', "true", "test/install.test.mjs", "dirty and diverged checkouts are rejected"],
];
for (const [label, file, before, after, suite, expectedFailure] of mutants) {
  const temporary = await mkdtemp(join(tmpdir(), "chores-mutant-"));
  try {
    for (const path of ["src", "public", "deploy", "test", "install.sh", "package.json"]) await cp(join(root, path), join(temporary, path), { recursive: true });
    await symlink(join(root, "node_modules"), join(temporary, "node_modules"));
    const source = await readFile(join(temporary, file), "utf8");
    assert.equal(source.split(before).length, 2, `Mutation target must occur once: ${label}`);
    await writeFile(join(temporary, file), source.replace(before, after));
    const result = spawnSync(process.execPath, ["--test", "--test-reporter=tap", suite], { cwd: temporary, encoding: "utf8", timeout: 30000 });
    assert.equal(result.status, 1, `${label}: suite did not reject the bug\n${result.stdout}\n${result.stderr}`);
    assert.ok(result.stdout.split("\n").some((line) => line.startsWith("not ok ") && line.includes(expectedFailure)), `${label}: expected regression did not fail`);
    console.log(`PASS: rejected ${label}`);
  } finally { await rm(temporary, { recursive: true, force: true }); }
}
