package net.dudiebug.chores;

import android.Manifest;
import android.app.*;
import android.content.*;
import android.content.pm.PackageManager;
import android.os.Build;
import androidx.annotation.NonNull;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.content.ContextCompat;
import androidx.work.Worker;
import androidx.work.WorkerParameters;
import androidx.work.OneTimeWorkRequest;
import androidx.work.ExistingWorkPolicy;
import androidx.work.Constraints;
import androidx.work.NetworkType;
import androidx.work.WorkManager;
import com.getcapacitor.JSObject;
import org.json.*;
import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.util.LinkedHashSet;

public class ChoresNotificationWorker extends Worker {
    static final String API = "https://chores.dudiebug.net";
    static final String CHANNEL = "chores-reminders";
    static final String TOKEN_SYNC_WORK = "chores-firebase-token-sync";
    static final Object LOCK = new Object();
    public ChoresNotificationWorker(@NonNull Context context, @NonNull WorkerParameters params) { super(context, params); }
    @NonNull @Override public Result doWork() {
        try { poll(getApplicationContext()); return Result.success(); }
        catch (Exception error) { return Result.retry(); }
    }
    static SharedPreferences prefs(Context c) { return c.getSharedPreferences("chores_native_notifications", Context.MODE_PRIVATE); }
    static void saveConfiguration(Context c, String token, long cursor) {
        synchronized (LOCK) { prefs(c).edit().putString("token", token).putLong("cursor", cursor).remove("deliveredIds").remove("lastError").commit(); }
    }
    static void stageFirebaseToken(Context c, String token) {
        if (token == null || token.isEmpty()) return;
        synchronized (LOCK) { prefs(c).edit().putString("pendingFcmToken", token).commit(); }
    }
    static void saveFirebaseToken(Context c, String token) {
        stageFirebaseToken(c, token);
        if (isConfigured(c)) scheduleImmediate(c);
    }
    static void scheduleImmediate(Context c) {
        OneTimeWorkRequest request = new OneTimeWorkRequest.Builder(ChoresNotificationWorker.class)
            .setConstraints(new Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build()).build();
        WorkManager.getInstance(c).enqueueUniqueWork(TOKEN_SYNC_WORK, ExistingWorkPolicy.REPLACE, request);
    }
    static void clearConfiguration(Context c) {
        synchronized (LOCK) { prefs(c).edit().clear().commit(); NotificationManagerCompat.from(c).cancelAll(); }
    }
    static boolean isConfigured(Context c) { return !prefs(c).getString("token", "").isEmpty(); }
    static boolean canNotify(Context c) {
        if (Build.VERSION.SDK_INT >= 33 && ContextCompat.checkSelfPermission(c, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) return false;
        if (!NotificationManagerCompat.from(c).areNotificationsEnabled()) return false;
        if (Build.VERSION.SDK_INT < 26) return true;
        NotificationChannel channel = c.getSystemService(NotificationManager.class).getNotificationChannel(CHANNEL);
        return channel == null || channel.getImportance() != NotificationManager.IMPORTANCE_NONE;
    }
    static JSObject poll(Context context) throws Exception {
        String token; long cursor;
        synchronized (LOCK) { token = prefs(context).getString("token", ""); cursor = prefs(context).getLong("cursor", 0L); }
        JSObject result = new JSObject(); result.put("posted", 0);
        if (token.isEmpty()) { result.put("expired", true); return result; }
        boolean syncFailed = false;
        try {
            if (!syncFirebaseToken(context, token)) { result.put("expired", true); return result; }
        } catch (Exception error) {
            syncFailed = true;
            synchronized (LOCK) { if (token.equals(prefs(context).getString("token", ""))) prefs(context).edit().putString("lastError", "Firebase token update failed").apply(); }
        }
        if (!canNotify(context)) { result.put("blocked", true); return result; }
        HttpURLConnection connection = (HttpURLConnection) new URL(API + "/api/native-notifications?after=" + cursor).openConnection();
        connection.setInstanceFollowRedirects(false); // Never forward the bearer token to another origin.
        connection.setConnectTimeout(10000); connection.setReadTimeout(10000);
        connection.setRequestProperty("Authorization", "Bearer " + token);
        connection.setRequestProperty("Accept", "application/json");
        try {
            int status = connection.getResponseCode();
            if (status == 401) {
                synchronized (LOCK) { if (token.equals(prefs(context).getString("token", ""))) clearConfiguration(context); }
                result.put("expired", true); return result;
            }
            if (status != 200) throw new IOException("Notification server returned " + status);
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            try (InputStream in = connection.getInputStream()) {
                byte[] buffer = new byte[4096]; int n;
                while ((n = in.read(buffer)) != -1) { if (out.size() + n > 1048576) throw new IOException("Notification response too large"); out.write(buffer, 0, n); }
            }
            JSONObject root = new JSONObject(out.toString(StandardCharsets.UTF_8.name()));
            JSONArray events = root.getJSONArray("events"); int posted = 0; int delivered = 0;
            synchronized (LOCK) {
                // A sign-out/account change while HTTP was in flight invalidates this batch.
                if (!token.equals(prefs(context).getString("token", ""))) { result.put("expired", true); return result; }
                long latest = prefs(context).getLong("cursor", 0L);
                for (int i = 0; i < events.length(); i++) {
                    JSONObject event = events.getJSONObject(i); long id = event.getLong("id");
                    if (id <= latest) continue;
                    if (!canNotify(context)) { result.put("blocked", true); break; }
                    if (consumeDelivered(context, id)) delivered++;
                    else { postNotification(context, event); posted++; }
                    latest = id;
                    prefs(context).edit().putLong("cursor", latest).commit();
                }
                SharedPreferences.Editor editor = prefs(context).edit().putString("lastCheck", Long.toString(System.currentTimeMillis()));
                if (!syncFailed) editor.remove("lastError");
                editor.apply();
            }
            result.put("posted", posted); result.put("delivered", delivered); return result;
        } catch (Exception error) {
            synchronized (LOCK) { if (token.equals(prefs(context).getString("token", ""))) prefs(context).edit().putString("lastError", "Network or server check failed").apply(); }
            throw error;
        } finally { connection.disconnect(); }
    }
    static boolean syncFirebaseToken(Context context, String nativeToken) throws Exception {
        String fcmToken;
        synchronized (LOCK) { fcmToken = prefs(context).getString("pendingFcmToken", ""); }
        if (fcmToken.isEmpty()) return true;
        byte[] body = new JSONObject().put("fcmToken", fcmToken).toString().getBytes(StandardCharsets.UTF_8);
        HttpURLConnection connection = (HttpURLConnection) new URL(API + "/api/native-notifications/token").openConnection();
        connection.setInstanceFollowRedirects(false);
        connection.setConnectTimeout(10000); connection.setReadTimeout(10000);
        connection.setRequestMethod("PUT"); connection.setDoOutput(true); connection.setFixedLengthStreamingMode(body.length);
        connection.setRequestProperty("Authorization", "Bearer " + nativeToken);
        connection.setRequestProperty("Content-Type", "application/json");
        try {
            try (OutputStream out = connection.getOutputStream()) { out.write(body); }
            int status = connection.getResponseCode();
            if (status == 401) {
                synchronized (LOCK) { if (nativeToken.equals(prefs(context).getString("token", ""))) clearConfiguration(context); }
                return false;
            }
            if (status != 204) throw new IOException("Firebase token server returned " + status);
            synchronized (LOCK) {
                if (fcmToken.equals(prefs(context).getString("pendingFcmToken", ""))) prefs(context).edit().remove("pendingFcmToken").commit();
            }
            return true;
        } finally { connection.disconnect(); }
    }
    static boolean alreadyDelivered(Context context, long id) {
        synchronized (LOCK) { return deliveredIds(context).contains(id); }
    }
    static void rememberDelivered(Context context, long id) {
        synchronized (LOCK) {
            LinkedHashSet<Long> ids = deliveredIds(context); ids.add(id);
            while (ids.size() > 200) ids.remove(ids.iterator().next());
            JSONArray stored = new JSONArray(); for (long value : ids) stored.put(value);
            prefs(context).edit().putString("deliveredIds", stored.toString()).commit();
        }
    }
    static boolean consumeDelivered(Context context, long id) {
        synchronized (LOCK) {
            LinkedHashSet<Long> ids = deliveredIds(context);
            if (!ids.remove(id)) return false;
            JSONArray stored = new JSONArray(); for (long value : ids) stored.put(value);
            prefs(context).edit().putString("deliveredIds", stored.toString()).commit(); return true;
        }
    }
    private static LinkedHashSet<Long> deliveredIds(Context context) {
        LinkedHashSet<Long> ids = new LinkedHashSet<>();
        try {
            JSONArray stored = new JSONArray(prefs(context).getString("deliveredIds", "[]"));
            for (int i = 0; i < stored.length(); i++) ids.add(stored.getLong(i));
        } catch (JSONException ignored) {}
        return ids;
    }
    static void postNotification(Context c, JSONObject event) {
        if (Build.VERSION.SDK_INT >= 26) {
        NotificationManager manager = c.getSystemService(NotificationManager.class);
        NotificationChannel channel = new NotificationChannel(CHANNEL, "Chore reminders", NotificationManager.IMPORTANCE_DEFAULT);
        channel.setDescription("Group activity and chore reminders"); manager.createNotificationChannel(channel);
        }
        Intent launch = c.getPackageManager().getLaunchIntentForPackage(c.getPackageName());
        int id = (int) (event.optLong("id", 1L) % Integer.MAX_VALUE);
        PendingIntent pending = null;
        if (launch != null) {
            launch.addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
            pending = PendingIntent.getActivity(c, id, launch, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        }
        NotificationCompat.Builder builder = new NotificationCompat.Builder(c, CHANNEL).setSmallIcon(R.drawable.ic_stat_chores)
            .setContentTitle(event.optString("title", "Chores")).setContentText(event.optString("body", ""))
            .setStyle(new NotificationCompat.BigTextStyle().bigText(event.optString("body", "")))
            .setAutoCancel(true).setOnlyAlertOnce(true).setCategory(NotificationCompat.CATEGORY_REMINDER);
        if (pending != null) builder.setContentIntent(pending);
        NotificationManagerCompat.from(c).notify(id, builder.build());
    }
}
