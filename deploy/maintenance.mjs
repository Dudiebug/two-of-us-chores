import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { readConfig } from "./configure.mjs";
import { createBackup } from "../src/backup.mjs";

async function main() {
  const [command, configPath, revision, required] = process.argv.slice(2);
  const config = readConfig(configPath);
  if (command === "backup") {
    if (!config.DATABASE_PATH || !existsSync(config.DATABASE_PATH)) {
      if (required === "required") throw Error("Installed database is missing. Update stopped; check DATABASE_PATH before proceeding.");
      if (existsSync(configPath)) {
        // Even an interrupted first install may already contain valuable push keys.
        copyFileSync(configPath, `${configPath}.before-install`);
        chmodSync(`${configPath}.before-install`, 0o600);
      }
      return;
    }
    if (!/^[0-9a-f]{40,64}$/.test(revision)) throw Error("A valid previous Git revision is required for recovery.");
    const backups = config.BACKUP_DIR || join(dirname(config.DATABASE_PATH), "backups");
    mkdirSync(backups, { recursive: true, mode: 0o700 });
    const bundle = mkdtempSync(join(backups, "before-update-"));
    chmodSync(bundle, 0o700);
    await createBackup(config.DATABASE_PATH, join(bundle, "chores.db"));
    chmodSync(join(bundle, "chores.db"), 0o600);
    const db = new DatabaseSync(join(bundle, "chores.db"), { readOnly: true });
    try {
      const rows = db.prepare("PRAGMA integrity_check").all();
      if (rows.length !== 1 || rows[0].integrity_check !== "ok") throw Error("Backup failed its SQLite integrity check; update stopped.");
    } finally { db.close(); }
    writeFileSync(join(bundle, "app.env"), readFileSync(configPath), { mode: 0o600, flag: "wx" });
    writeFileSync(join(bundle, "revision.txt"), `${revision}\n`, { mode: 0o600, flag: "wx" });
    console.log(bundle);
  } else if (command === "paths") {
    console.log([config.DATA_DIR, dirname(config.DATABASE_PATH), config.BACKUP_DIR].join("\n"));
  } else {
    throw Error("Usage: node deploy/maintenance.mjs backup|paths CONFIG [REVISION] [required]");
  }
}
main().catch((error) => { console.error(error.message); process.exitCode = 1; });
