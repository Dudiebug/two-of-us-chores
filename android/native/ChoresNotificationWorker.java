package net.dudiebug.chores;

import android.Manifest;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.os.Build;

import androidx.annotation.NonNull;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.content.ContextCompat;
import androidx.work.Worker;
import androidx.work.WorkerParameters;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

public class ChoresNotificationWorker extends Worker {
    private static final String API = "https://chores.dudiebug.net";
    private static final String PREFS = "chores_native_notifications";
    private static final String TOKEN = "token";
    private static final String CURSOR = "cursor";
    private static final String CHANNEL_ID = "chores-reminders";

    public ChoresNotificationWorker(@NonNull Context context, @NonNull WorkerParameters params) {
        super(context, params);
    }

    @NonNull
    @Override
    public Result doWork() {
        try {
            poll(getApplicationContext());
            return Result.success();
        } catch (Exception error) {
            return Result.retry();
        }
    }

    static void saveConfiguration(Context context, String token, long cursor) {
        prefs(context).edit().putString(TOKEN, token).putLong(CURSOR, cursor).apply();
    }

    static void clearConfiguration(Context context) {
        prefs(context).edit().clear().apply();
    }

    static boolean isConfigured(Context context) {
        return !prefs(context).getString(TOKEN, "").isEmpty();
    }

    private static SharedPreferences prefs(Context context) {
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    private static void poll(Context context) throws Exception {
        SharedPreferences preferences = prefs(context);
        String token = preferences.getString(TOKEN, "");
        if (token == null || token.isEmpty()) return;
        long cursor = preferences.getLong(CURSOR, 0L);

        HttpURLConnection connection = (HttpURLConnection) new URL(
            API + "/api/native-notifications?after=" + cursor
        ).openConnection();
        connection.setRequestMethod("GET");
        connection.setConnectTimeout(15000);
        connection.setReadTimeout(15000);
        connection.setRequestProperty("Authorization", "Bearer " + token);
        connection.setRequestProperty("Accept", "application/json");

        int status = connection.getResponseCode();
        if (status == 401) {
            clearConfiguration(context);
            connection.disconnect();
            return;
        }
        if (status < 200 || status >= 300) {
            connection.disconnect();
            throw new IllegalStateException("Notification poll failed: " + status);
        }

        String payload;
        try (InputStream stream = connection.getInputStream()) {
            payload = readAll(stream);
        } finally {
            connection.disconnect();
        }

        JSONObject root = new JSONObject(payload);
        JSONArray events = root.optJSONArray("events");
        if (events == null) events = new JSONArray();
        ensureChannel(context);
        for (int i = 0; i < events.length(); i++) {
            JSONObject event = events.getJSONObject(i);
            postNotification(context, event);
        }
        long nextCursor = root.optLong("cursor", cursor);
        preferences.edit().putLong(CURSOR, nextCursor).apply();
    }

    private static String readAll(InputStream stream) throws Exception {
        StringBuilder builder = new StringBuilder();
        try (BufferedReader reader = new BufferedReader(new InputStreamReader(stream, StandardCharsets.UTF_8))) {
            String line;
            while ((line = reader.readLine()) != null) builder.append(line);
        }
        return builder.toString();
    }

    private static void ensureChannel(Context context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        NotificationChannel channel = new NotificationChannel(
            CHANNEL_ID,
            "Chore reminders",
            NotificationManager.IMPORTANCE_DEFAULT
        );
        channel.setDescription("Chore reminders and household activity");
        manager.createNotificationChannel(channel);
    }

    private static void postNotification(Context context, JSONObject event) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU
            && ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            return;
        }

        Intent launch = context.getPackageManager().getLaunchIntentForPackage(context.getPackageName());
        PendingIntent pendingIntent = null;
        if (launch != null) {
            launch.addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
            launch.putExtra("chores_url", event.optString("url", "/app"));
            pendingIntent = PendingIntent.getActivity(
                context,
                (int) (event.optLong("id", 0L) % Integer.MAX_VALUE),
                launch,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
            );
        }

        NotificationCompat.Builder builder = new NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_stat_chores)
            .setContentTitle(event.optString("title", "Chores"))
            .setContentText(event.optString("body", ""))
            .setStyle(new NotificationCompat.BigTextStyle().bigText(event.optString("body", "")))
            .setAutoCancel(true)
            .setPriority(NotificationCompat.PRIORITY_DEFAULT)
            .setCategory(NotificationCompat.CATEGORY_REMINDER);
        if (pendingIntent != null) builder.setContentIntent(pendingIntent);

        int id = (int) (event.optLong("id", System.currentTimeMillis()) % Integer.MAX_VALUE);
        NotificationManagerCompat.from(context).notify(id, builder.build());
    }
}
