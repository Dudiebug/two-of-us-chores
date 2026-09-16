import { isAbsolute } from "node:path";
import { GoogleAuth } from "google-auth-library";

const FCM_SCOPE = "https://www.googleapis.com/auth/firebase.messaging";
const INVALID_TOKEN_CODES = new Set(["UNREGISTERED", "SENDER_ID_MISMATCH"]);

export function validFcmToken(value) {
  return typeof value === "string" && value.length >= 20 && value.length <= 4096
    && /^[A-Za-z0-9._~:+\/-]+$/.test(value);
}

export function createFcm(db, env = process.env, options = {}) {
  const keyFile = String(env.FIREBASE_SERVICE_ACCOUNT_PATH || "").trim();
  if (!keyFile) return { configured: false, send: async () => false };
  if (!isAbsolute(keyFile)) throw new Error("FIREBASE_SERVICE_ACCOUNT_PATH must be an absolute path");

  const auth = options.auth || new GoogleAuth({ keyFilename: keyFile, scopes: [FCM_SCOPE] });
  let clientPromise;
  let projectIdPromise;
  return createFcmSender(db, async (token, message) => {
    clientPromise ||= options.client ? Promise.resolve(options.client) : auth.getClient();
    projectIdPromise ||= Promise.resolve(env.FIREBASE_PROJECT_ID || auth.getProjectId());
    const [authorized, project] = await Promise.all([clientPromise, projectIdPromise]);
    if (!project) throw new Error("Firebase project ID is unavailable");
    return authorized.request({
      url: `https://fcm.googleapis.com/v1/projects/${encodeURIComponent(project)}/messages:send`,
      method: "POST",
      timeout: 10_000,
      data: { message: { token, ...message } },
    });
  });
}

export function createFcmSender(db, request) {
  return {
    configured: true,
    async send(userId, event) {
      const devices = db.prepare(`SELECT fcm_token AS token FROM native_devices
        WHERE user_id=? AND fcm_token IS NOT NULL ORDER BY created_at`).all(userId);
      let delivered = false;
      let failure;
      for (const { token } of devices) {
        if (!validFcmToken(token)) {
          db.prepare("UPDATE native_devices SET fcm_token=NULL WHERE user_id=? AND fcm_token=?").run(userId, token);
          continue;
        }
        try {
          await request(token, fcmMessage(event));
          delivered = true;
        } catch (error) {
          if (invalidToken(error)) {
            db.prepare("UPDATE native_devices SET fcm_token=NULL WHERE user_id=? AND fcm_token=?").run(userId, token);
            continue;
          }
          failure ||= error;
        }
      }
      if (failure && !delivered) throw failure;
      return delivered;
    },
  };
}

function fcmMessage(event) {
  const data = {
    eventId: String(event.id),
    title: String(event.title),
    body: String(event.body),
    url: String(event.url || "/app"),
  };
  if (event.tag) data.tag = String(event.tag);
  if (event.groupId) data.groupId = String(event.groupId);
  return { data, android: { priority: "HIGH", ttl: "604800s" } };
}

function invalidToken(error) {
  const details = error?.response?.data?.error?.details;
  return Array.isArray(details) && details.some((detail) => INVALID_TOKEN_CODES.has(detail?.errorCode));
}
