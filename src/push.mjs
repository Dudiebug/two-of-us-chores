import webpush from "web-push";

export function createPush(db, env = process.env, sendNotification = (...args) => webpush.sendNotification(...args)) {
  const configured = Boolean(env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY && env.VAPID_SUBJECT);
  if (configured) webpush.setVapidDetails(env.VAPID_SUBJECT, env.VAPID_PUBLIC_KEY, env.VAPID_PRIVATE_KEY);

  return {
    configured,
    publicKey: configured ? env.VAPID_PUBLIC_KEY : null,
    async send(userId, title, body, options = {}) {
      if (!configured) return false;
      const subscriptions = db.prepare("SELECT endpoint,user_id,p256dh,auth FROM push_subscriptions WHERE user_id=?").all(userId);
      let delivered = 0;
      const failures = [];
      await Promise.all(subscriptions.map(async (row) => {
        try {
          await sendNotification(
            { endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } },
            JSON.stringify({ title, body, url: options.url || "/app", tag: options.tag }),
          );
          delivered += 1;
        } catch (error) {
          if ([404, 410].includes(error?.statusCode ?? error?.status)) {
            db.prepare("DELETE FROM push_subscriptions WHERE endpoint=? AND user_id=? AND p256dh=? AND auth=?")
              .run(row.endpoint, row.user_id, row.p256dh, row.auth);
          } else {
            failures.push(error);
          }
        }
      }));
      if (!delivered && failures.length) return false;
      return delivered > 0;
    },
  };
}
