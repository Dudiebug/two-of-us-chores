import { fileURLToPath } from "node:url";
import { browserOrigin, CONFIG_PATH, readConfig, validateConfig } from "./configure.mjs";

export async function checkEndpoint(base, origin) {
  try {
    const health = await fetch(`${base}/healthz`, { redirect: "manual", signal: AbortSignal.timeout(5000) });
    if (health.status !== 200 || (await health.json()).ok !== true) throw Error(`Health check failed (HTTP ${health.status}); check the upstream address and redirects.`);
    // An empty login is rejected before password throttling and creates no session.
    const response = await fetch(`${base}/api/session`, {
      method: "POST", headers: { Origin: origin, "Content-Type": "application/json" }, body: "{}",
      redirect: "manual", signal: AbortSignal.timeout(5000),
    });
    const body = await response.json();
    if (response.status === 403 && body.error?.startsWith("Cross-origin request rejected")) {
      return { ok: false, message: `${body.error} Compare APP_ORIGIN with ${origin}, preserve the browser Origin header at the proxy, and restart the app after configuration changes.` };
    }
    if (response.status !== 400 || body.error !== "Invalid credentials") {
      return { ok: false, message: `Unexpected login response (HTTP ${response.status}). Check proxy redirects, access rules and upstream address.` };
    }
    return { ok: true, message: "Health and login origin check passed." };
  } catch (error) {
    return { ok: false, message: `Cannot verify ${base}: ${error.cause?.code || error.message}. Check service status, DNS, certificate trust and proxy routing.` };
  }
}

export function upstreamAddress(config) {
  let host = config.LISTEN_HOST;
  if (host === "0.0.0.0") host = "127.0.0.1";
  if (host === "::") host = "::1";
  return `http://${host.includes(":") ? `[${host}]` : host}:${config.PORT}`;
}

async function main() {
  const args = process.argv.slice(2);
  const localOnly = args[0] === "--local";
  if (localOnly) args.shift();
  const config = validateConfig(readConfig(process.env.CONFIG_PATH || CONFIG_PATH));
  const origin = args[0] ? browserOrigin(args[0]) : config.APP_ORIGIN;
  console.log(`Configured browser URL: ${config.APP_ORIGIN}`);
  console.log(`Proxy upstream: ${upstreamAddress(config)} (HTTP)`);
  let ok = true;
  if (origin !== config.APP_ORIGIN) {
    console.error(`FAIL: Browser URL ${origin} differs from APP_ORIGIN. Run bash install.sh --configure to correct it.`);
    ok = false;
  }
  for (const [label, address] of [["Local app", upstreamAddress(config)], ...(!localOnly ? [["Public HTTPS", origin]] : [])]) {
    const result = await checkEndpoint(address, origin);
    console.log(`${result.ok ? "PASS" : "FAIL"}: ${label}: ${result.message}`);
    ok &&= result.ok;
  }
  if (!ok) process.exitCode = 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => { console.error(error.message); process.exitCode = 1; });
}
