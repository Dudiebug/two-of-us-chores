import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCallback);
export const SESSION_COOKIE = "chore_session";

export async function passwordHash(password, salt = randomBytes(16).toString("hex")) {
  if (typeof password !== "string" || password.length < 10 || password.length > 200) {
    throw new Error("Password must be 10-200 characters");
  }
  const key = await scrypt(password, salt, 64);
  return { salt, hash: Buffer.from(key).toString("hex") };
}

export async function passwordMatches(password, salt, expected) {
  if (typeof password !== "string" || typeof salt !== "string" || typeof expected !== "string") return false;
  try {
    const { hash } = await passwordHash(password, salt);
    const actual = Buffer.from(hash, "hex");
    const wanted = Buffer.from(expected, "hex");
    return actual.length === wanted.length && timingSafeEqual(actual, wanted);
  } catch {
    return false;
  }
}

export function newSession() {
  const token = randomBytes(32).toString("base64url");
  return { token, hash: tokenHash(token) };
}

export function tokenHash(token) {
  return createHash("sha256").update(token).digest("hex");
}

export function parseCookies(header = "") {
  const cookies = {};
  for (const part of String(header).split(";")) {
    const separator = part.indexOf("=");
    if (separator < 1) continue;
    const key = part.slice(0, separator).trim();
    try { cookies[key] = decodeURIComponent(part.slice(separator + 1).trim()); } catch {}
  }
  return cookies;
}

export function sessionCookie(token, secure, maxAge = 60 * 60 * 24 * 30) {
  const pieces = [`${SESSION_COOKIE}=${encodeURIComponent(token)}`, "Path=/", "HttpOnly", "SameSite=Strict", `Max-Age=${maxAge}`];
  if (!maxAge) pieces.push("Expires=Thu, 01 Jan 1970 00:00:00 GMT");
  if (secure) pieces.push("Secure");
  return pieces.join("; ");
}
