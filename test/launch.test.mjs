import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

for (const host of ["127.0.0.1", null]) {
  test(`documented env-file startup listens on ${host || "the Docker default"}`, async (t) => {
    const directory = await mkdtemp(join(tmpdir(), "chores-launch-"));
    const envFile = join(directory, "app.env");
    await writeFile(envFile, [
      "APP_ORIGIN=http://localhost:3000", "ALLOW_INSECURE_LOCALHOST=true", "PORT=0",
      `DATABASE_PATH=${join(directory, "chores.db")}`,
      "DYLAN_PASSWORD=launch-test-password", "MADY_PASSWORD=another-test-password",
      ...(host ? [`LISTEN_HOST=${host}`] : []),
    ].join("\n"), { mode: 0o600 });
    const child = spawn(process.execPath, [`--env-file=${envFile}`, "src/server.mjs"], {
      cwd: new URL("..", import.meta.url), env: { PATH: process.env.PATH }, stdio: ["ignore", "pipe", "pipe"],
    });
    t.after(async () => {
      if (child.exitCode === null && child.signalCode === null) { child.kill("SIGTERM"); await once(child, "exit"); }
      await rm(directory, { recursive: true, force: true });
    });
    const address = await new Promise((resolve, reject) => {
      let output = "";
      let errors = "";
      const timeout = setTimeout(() => reject(Error(`Startup timed out: ${errors}`)), 10000);
      child.stderr.on("data", (chunk) => { errors += chunk; });
      child.once("error", (error) => { clearTimeout(timeout); reject(error); });
      child.once("exit", () => { clearTimeout(timeout); reject(Error(`Server exited before health check: ${errors}`)); });
      child.stdout.on("data", (chunk) => {
        output += chunk;
        const match = output.match(/listening on ([\d.]+):(\d+)/);
        if (match) { clearTimeout(timeout); resolve({ host: match[1], port: match[2] }); }
      });
    });
    assert.equal(address.host, host || "0.0.0.0");
    const response = await fetch(`http://127.0.0.1:${address.port}/healthz`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true });
  });
}
