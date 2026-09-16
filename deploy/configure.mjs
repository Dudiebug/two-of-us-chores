import { existsSync, readFileSync, writeFileSync, renameSync, unlinkSync, lstatSync } from "node:fs";
import { dirname, isAbsolute, join } from "node:path";
import { networkInterfaces } from "node:os";
import { isIP } from "node:net";
import { parseEnv } from "node:util";
import { fileURLToPath } from "node:url";
import { createECDH, randomBytes } from "node:crypto";

export const CONFIG_PATH = "/etc/two-of-us-chores.env";
export const DATA_DIR = "/var/lib/two-of-us-chores";

export function readConfig(path) {
  const info = lstatSync(path, { throwIfNoEntry: false });
  if (!info) return {};
  if (!info.isFile()) throw Error("Configuration must be a regular file, not a symlink.");
  return parseEnv(readFileSync(path, "utf8"));
}

export function browserOrigin(value) {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw Error("Enter the HTTPS browser URL without a path, query or credentials.");
  }
  return url.origin;
}

export function validateConfig(config) {
  config.APP_ORIGIN = browserOrigin(config.APP_ORIGIN);
  if (!isIP(config.LISTEN_HOST)) throw Error("Listening address must be an IPv4 or IPv6 address.");
  if (!/^\d+$/.test(config.PORT) || Number(config.PORT) < 1024 || Number(config.PORT) > 65535) {
    throw Error("App port must be a number between 1024 and 65535.");
  }
  new Intl.DateTimeFormat("en", { timeZone: config.HOUSEHOLD_TIMEZONE });
  for (const key of ["DATA_DIR", "DATABASE_PATH", "BACKUP_DIR"]) {
    if (!isAbsolute(config[key] || "")) throw Error(`${key} must be an absolute path.`);
  }
  if (config.FIREBASE_SERVICE_ACCOUNT_PATH && !isAbsolute(config.FIREBASE_SERVICE_ACCOUNT_PATH)) {
    throw Error("FIREBASE_SERVICE_ACCOUNT_PATH must be an absolute path.");
  }
  if (config.VAPID_SUBJECT) {
    if (!/^mailto:[^\s@]+@[^\s@]+\.[^\s@]+$/.test(config.VAPID_SUBJECT) && !/^https:\/\//.test(config.VAPID_SUBJECT)) {
      throw Error("Push contact must be a mailto: email or HTTPS URL.");
    }
    const key = createECDH("prime256v1");
    key.setPrivateKey(Buffer.from(config.VAPID_PRIVATE_KEY || "", "base64url"));
    if (key.getPublicKey("base64url") !== config.VAPID_PUBLIC_KEY) throw Error("Existing push keys do not match; restore the original pair.");
  }
  return config;
}

export function writeConfig(path, config) {
  // Single-quoted values have the same literal meaning in Node and systemd.
  // Never source this file as shell code. Reject unsupported text before writing.
  const lines = Object.keys(config).sort().map((key) => {
    const value = config[key];
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) || /['\x00-\x1f\x7f]/.test(value)) {
      throw Error(`Unsupported quote or control character in ${key}. Configuration was not changed.`);
    }
    return `${key}='${value}'`;
  });
  const info = lstatSync(path, { throwIfNoEntry: false });
  if (info && !info.isFile()) throw Error("Configuration must be a regular file.");
  const temporary = join(dirname(path), `.chores-config-${randomBytes(8).toString("hex")}`);
  try {
    writeFileSync(temporary, lines.join("\n") + "\n", { mode: 0o600, flag: "wx" });
    renameSync(temporary, path);
  } finally {
    if (existsSync(temporary)) unlinkSync(temporary);
  }
}

async function main() {
  const [command, path = CONFIG_PATH] = process.argv.slice(2);
  const current = readConfig(path);
  const dataDir = current.DATA_DIR || process.env.SETUP_DATA_DIR || DATA_DIR;
  const database = current.DATABASE_PATH || join(dataDir, "chores.db");
  if (command === "defaults") {
    const ips = Object.values(networkInterfaces()).flat().filter((entry) => !entry.internal && entry.family === "IPv4").map((entry) => entry.address);
    const unique = [...new Set(ips)];
    if (unique.length > 1) console.error(`Available IPv4 addresses: ${unique.join(", ")}. Choose the one your proxy can reach.`);
    console.log([
      current.APP_ORIGIN || "", current.LISTEN_HOST || (unique.length === 1 ? unique[0] : ""),
      current.HOUSEHOLD_TIMEZONE || Intl.DateTimeFormat().resolvedOptions().timeZone,
      current.PORT || "3000", current.VAPID_SUBJECT ? "yes" : "no",
      current.VAPID_SUBJECT?.replace(/^mailto:/, "") || "",
      existsSync(database) || (current.DYLAN_PASSWORD && current.MADY_PASSWORD) ? "keep" : "new",
    ].join("\n"));
  } else if (command === "save") {
    const choices = process.env;
    const next = {
      ...current,
      APP_ORIGIN: choices.SETUP_ORIGIN, LISTEN_HOST: choices.SETUP_HOST,
      PORT: choices.SETUP_PORT, HOUSEHOLD_TIMEZONE: choices.SETUP_TIMEZONE,
      ALLOW_INSECURE_LOCALHOST: "false", DATA_DIR: dataDir, DATABASE_PATH: database,
      BACKUP_DIR: current.BACKUP_DIR || join(dataDir, "backups"),
      VAPID_SUBJECT: choices.SETUP_PUSH === "yes" ? (/^https:\/\//.test(choices.SETUP_CONTACT) ? choices.SETUP_CONTACT : `mailto:${choices.SETUP_CONTACT}`) : "",
      VAPID_PUBLIC_KEY: current.VAPID_PUBLIC_KEY || "", VAPID_PRIVATE_KEY: current.VAPID_PRIVATE_KEY || "",
    };
    if (choices.SETUP_PUSH === "yes" && !next.VAPID_PUBLIC_KEY && !next.VAPID_PRIVATE_KEY) {
      const { default: webpush } = await import("web-push");
      const keys = webpush.generateVAPIDKeys();
      next.VAPID_PUBLIC_KEY = keys.publicKey;
      next.VAPID_PRIVATE_KEY = keys.privateKey;
    }
    if (choices.SETUP_DYLAN_PASSWORD) next.DYLAN_PASSWORD = choices.SETUP_DYLAN_PASSWORD;
    if (choices.SETUP_MADY_PASSWORD) next.MADY_PASSWORD = choices.SETUP_MADY_PASSWORD;
    validateConfig(next);
    writeConfig(path, next);
    console.log(`Saved ${path}. Existing accounts and push keys are preserved.`);
  } else {
    throw Error("Usage: node deploy/configure.mjs defaults|save [config path]");
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => { console.error(error.message); process.exitCode = 1; });
}
