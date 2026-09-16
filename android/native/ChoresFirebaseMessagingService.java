package net.dudiebug.chores;

import com.google.firebase.messaging.FirebaseMessagingService;
import com.google.firebase.messaging.RemoteMessage;
import org.json.JSONObject;
import java.util.Map;

public class ChoresFirebaseMessagingService extends FirebaseMessagingService {
    @Override public void onNewToken(String token) {
        ChoresNotificationWorker.saveFirebaseToken(this, token);
    }

    @Override public void onMessageReceived(RemoteMessage message) {
        if (!ChoresNotificationWorker.isConfigured(this) || !ChoresNotificationWorker.canNotify(this)) return;
        Map<String, String> data = message.getData();
        long id;
        try { id = Long.parseLong(data.getOrDefault("eventId", "0")); }
        catch (NumberFormatException error) { return; }
        if (id <= 0) return;
        synchronized (ChoresNotificationWorker.LOCK) {
            long cursor = ChoresNotificationWorker.prefs(this).getLong("cursor", 0L);
            if (id <= cursor || ChoresNotificationWorker.alreadyDelivered(this, id)) return;
            try {
                JSONObject event = new JSONObject().put("id", id)
                    .put("title", data.getOrDefault("title", "Chores"))
                    .put("body", data.getOrDefault("body", ""))
                    .put("url", data.getOrDefault("url", "/app"));
                ChoresNotificationWorker.postNotification(this, event);
                ChoresNotificationWorker.rememberDelivered(this, id);
            } catch (Exception ignored) {}
        }
    }
}
