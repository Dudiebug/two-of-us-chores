import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { backup, DatabaseSync } from "node:sqlite";

export async function createBackup(sourcePath, destinationPath) {
  mkdirSync(dirname(destinationPath), { recursive: true });
  const source = new DatabaseSync(sourcePath, { readOnly: true, defensive: true });
  try {
    return await backup(source, destinationPath);
  } finally {
    source.close();
  }
}

const source = process.env.DATABASE_PATH || join(process.env.DATA_DIR || "data", "chores.db");
const destination = process.argv[2] || join(
  process.env.BACKUP_DIR || "backups",
  `chores-${new Date().toISOString().replace(/[:.]/g, "-")}.db`,
);

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  console.log(await createBackup(source, destination));
  console.log(destination);
}
